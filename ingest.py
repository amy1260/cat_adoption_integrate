"""Turn harvested Facebook posts into cat listings, skipping non-adoption posts and duplicates."""
import glob
import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import ages
import db
import llm_extract
from dedupe import find_duplicate
from images import download, first_image_url, save_data_url
from parser import build_cat, parse_post
from shelter import COLUMNS

GROUPS = {"catparadise"}
CUTOFF_DAYS = 92  # keep roughly the last three months


def insert_cat(conn, cat, dup_of=None):
    cols = COLUMNS + ["created_at", "dup_of"]
    cur = conn.execute(f"INSERT INTO cats ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                       [cat.get(c) for c in COLUMNS] + [datetime.now().isoformat(timespec="seconds"), dup_of])
    return cur.lastrowid


def _attach_photo(cat, photo):
    """Store the post's first photo on the listing. `photo` is a data URL (Chrome) or a URL (Apify)."""
    if cat.get("photo") or not photo:
        return bool(cat.get("photo"))
    saver = save_data_url if photo.startswith("data:") else download
    cat["photo"], cat["photo_hash"] = saver(photo)
    return bool(cat["photo"])


def _enrich(conn, row, cat):
    """Give an existing listing the photo and URL that a later harvest found for it."""
    sets, vals = [], []
    if cat.get("photo") and not row["photo"]:
        sets += ["photo=?", "photo_hash=?"]
        vals += [cat["photo"], cat["photo_hash"]]
    if cat.get("source_url") and not row["source_url"]:
        sets.append("source_url=?")
        vals.append(cat["source_url"])
    if sets:
        conn.execute(f"UPDATE cats SET {', '.join(sets)} WHERE id=?", vals + [row["id"]])
    return bool(sets)


def _store(conn, source, cat, photo, stats):
    """Insert a parsed post unless it is already listed; re-harvests only top up the photo and URL."""
    exists = conn.execute("SELECT * FROM cats WHERE source=? AND source_id=?", (source, cat["source_id"])).fetchone()
    if exists:
        if not exists["photo"] and _attach_photo(cat, photo) and _enrich(conn, exists, cat):
            stats["photo_added"] += 1
        else:
            stats["already_imported"] += 1
        return
    dup, why, kind = find_duplicate(conn, cat)
    if kind == "hard":
        if not dup["photo"] and _attach_photo(cat, photo):  # e.g. another member resharing a post we hold
            _enrich(conn, dup, cat)
            stats["photo_added"] += 1
        stats[f"blocked_duplicate_{why}"] += 1
        return
    _attach_photo(cat, photo)
    new_id = insert_cat(conn, cat)
    if kind == "review":
        db.flag_for_review(conn, new_id, dup["id"], why)
        stats["needs_review"] += 1
    else:
        stats["added"] += 1


def _llm_pass(entries, stats):
    """Let Claude read each post (when credentials exist): drop what is not a listing, fix the fields."""
    if not entries or not llm_extract.enabled():
        return entries
    print(f"reading {len(entries)} posts with Claude: about ${llm_extract.estimate_cost(len(entries), llm_extract.MODEL):.2f} "
          f"with {llm_extract.MODEL} (answers already paid for are reused)")
    results = llm_extract.extract_many([(c["description"], c["posted_at"]) for c, _ in entries])
    kept = []
    for (cat, photo), ex in zip(entries, results):
        if ex is None:  # the model failed on this post: keep the rule-based reading
            stats["llm_failed"] += 1
            kept.append((cat, photo))
            continue
        cat, reason = llm_extract.apply(cat, ex)
        if cat is None:
            stats[reason] += 1
        else:
            kept.append((cat, photo))
    return kept


def _finish(source, entries, stats):
    """Read the parsed posts with the model, store them, then bring every listing's age up to date."""
    entries = _llm_pass(entries, stats)
    with db.connect() as conn:
        for cat, photo in entries:
            _store(conn, source, cat, photo, stats)
        ages.refresh(conn)


def ingest_fb(group, captured_at, posts, save_raw=True):
    """Posts scraped from the Facebook page in the user's Chrome; each may carry `img` (a data URL)."""
    if group not in GROUPS:
        raise ValueError(f"unknown group {group}")
    captured = datetime.fromisoformat(captured_at)
    source = f"fb_{group}"
    if save_raw:
        raw_dir = Path(__file__).resolve().parent / "data" / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        (raw_dir / f"{group}_{datetime.now():%Y%m%d_%H%M%S}.json").write_text(
            json.dumps({"group": group, "captured_at": captured_at,
                        "posts": [{k: v for k, v in p.items() if k != "img"} for p in posts]}, ensure_ascii=False),
            encoding="utf-8")
    cutoff = captured - timedelta(days=CUTOFF_DAYS)
    stats = Counter()
    entries = []
    for item in posts:
        cat, reason = parse_post(source, item, captured)
        if cat is None:
            stats[reason] += 1
        elif cat["posted_at"] and datetime.fromisoformat(cat["posted_at"]) < cutoff:
            stats["too_old"] += 1
        else:
            entries.append((cat, item.get("img")))
    _finish(source, entries, stats)
    return dict(stats)


def _taiwan_time(iso_utc):
    """Apify timestamps are UTC (e.g. 2026-10-30T20:47:47.000Z); the site shows Taiwan time."""
    return datetime.fromisoformat(iso_utc.replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None)


def _field(item, path):
    """Read 'a.b' from an item whether the dataset is flattened ({'a.b': x}) or nested ({'a': {'b': x}})."""
    if path in item:
        return item[path]
    cur = item
    for part in path.split("."):
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def ingest_apify(group, items, save_raw=True):
    """Import items from the Apify Facebook Groups Scraper dataset.

    A reshare has empty `text` and the real post in `sharedPost`; the original author and URL are
    used so several reshares of one post collapse into a single listing. `image_url` (added by
    apify_fetch.py) or the raw `attachments` give the post's first photo, which is downloaded here.
    """
    if group not in GROUPS:
        raise ValueError(f"unknown group {group}")
    source = f"fb_{group}"
    if save_raw:
        raw_dir = Path(__file__).resolve().parent / "data" / "apify"
        raw_dir.mkdir(parents=True, exist_ok=True)
        (raw_dir / f"{group}_{datetime.now():%Y%m%d_%H%M%S}.json").write_text(
            json.dumps(items, ensure_ascii=False), encoding="utf-8")
    cutoff = datetime.now() - timedelta(days=CUTOFF_DAYS)
    stats = Counter()
    entries = []
    for it in items:
        text = "\n".join(t for t in (_field(it, "text"), _field(it, "sharedPost.text")) if t and t.strip())
        if not it.get("time"):
            stats["no_time"] += 1
            continue
        posted_at = _taiwan_time(it["time"])
        if posted_at < cutoff:
            stats["too_old"] += 1
            continue
        poster = _field(it, "user.name")
        author = _field(it, "sharedPost.user.name") or poster
        link = _field(it, "sharedPost.url") or _field(it, "url")
        cat, reason = build_cat(source, text, author, posted_at, link, poster)
        if cat is None:
            stats[reason] += 1
        else:
            entries.append((cat, it.get("image_url") or first_image_url(it)))
    _finish(source, entries, stats)
    return dict(stats)


if __name__ == "__main__":
    db.init()
    args = [a for a in sys.argv[1:] if a != "--llm"]
    if "--llm" in sys.argv[1:]:  # explicit consent to pay for reading each post with Claude
        os.environ["CATADOPT_LLM"] = "1"
        if not llm_extract.has_credentials():
            sys.exit("--llm needs Claude credentials: set ANTHROPIC_API_KEY first.")
    # PowerShell does not expand wildcards for programs, so do it here
    paths = sorted(p for arg in args for p in (glob.glob(arg) or [arg]))
    if not paths or not all(Path(p).exists() for p in paths):
        sys.exit("No input files found. Download the Apify dataset first:  python apify_fetch.py <datasetId>")
    for path in paths:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(data, list):  # Apify dataset items; group is the file-name prefix
            print(path, ingest_apify(Path(path).name.split("_")[0], data, save_raw=False))
        else:
            print(path, ingest_fb(data["group"], data["captured_at"], data["posts"], save_raw=False))
