"""Turn harvested Facebook feed items into cat listings, skipping non-adoption posts and duplicates."""
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import db
from dedupe import find_duplicate
from parser import parse_post
from shelter import COLUMNS

GROUPS = {"catparadise"}
CUTOFF_DAYS = 92  # keep roughly the last three months


def insert_cat(conn, cat, dup_of=None):
    cols = COLUMNS + ["created_at", "dup_of"]
    cur = conn.execute(f"INSERT INTO cats ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                       [cat.get(c) for c in COLUMNS] + [datetime.now().isoformat(timespec="seconds"), dup_of])
    return cur.lastrowid


def ingest_fb(group, captured_at, posts, save_raw=True):
    if group not in GROUPS:
        raise ValueError(f"unknown group {group}")
    captured = datetime.fromisoformat(captured_at)
    source = f"fb_{group}"
    if save_raw:
        raw_dir = Path(__file__).resolve().parent / "data" / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        (raw_dir / f"{group}_{stamp}.json").write_text(
            json.dumps({"group": group, "captured_at": captured_at, "posts": posts}, ensure_ascii=False),
            encoding="utf-8")
    cutoff = captured - timedelta(days=CUTOFF_DAYS)
    stats = Counter()
    with db.connect() as conn:
        for item in posts:
            cat, reason = parse_post(source, item, captured)
            if cat is None:
                stats[reason] += 1
                continue
            if cat["posted_at"] and datetime.fromisoformat(cat["posted_at"]) < cutoff:
                stats["too_old"] += 1
                continue
            exists = conn.execute("SELECT id FROM cats WHERE source=? AND source_id=?",
                                  (source, cat["source_id"])).fetchone()
            if exists:
                stats["already_imported"] += 1
                continue
            dup, why, kind = find_duplicate(conn, cat)
            if kind == "hard":
                stats[f"blocked_duplicate_{why}"] += 1
                continue
            new_id = insert_cat(conn, cat)
            if kind == "review":
                db.flag_for_review(conn, new_id, dup["id"], why)
                stats["needs_review"] += 1
            else:
                stats["added"] += 1
    return dict(stats)


if __name__ == "__main__":
    db.init()
    for path in sys.argv[1:]:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(data, list):  # Apify dataset items; group is the file-name prefix
            print(path, ingest_apify(Path(path).name.split("_")[0], data, save_raw=False))
        else:
            print(path, ingest_fb(data["group"], data["captured_at"], data["posts"], save_raw=False))


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
    used so several reshares of one post collapse into a single listing.
    """
    from parser import build_cat
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
    with db.connect() as conn:
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
                continue
            if conn.execute("SELECT 1 FROM cats WHERE source=? AND source_id=?", (source, cat["source_id"])).fetchone():
                stats["already_imported"] += 1
                continue
            dup, why, kind = find_duplicate(conn, cat)
            if kind == "hard":
                stats[f"blocked_duplicate_{why}"] += 1
                continue
            new_id = insert_cat(conn, cat)
            if kind == "review":
                db.flag_for_review(conn, new_id, dup["id"], why)
                stats["needs_review"] += 1
            else:
                stats["added"] += 1
    return dict(stats)
