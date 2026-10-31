"""Fetch the Facebook group's posts in posting order, one batch at a time, each batch starting where the last
one stopped. The admin starts a batch from the site (管理者 > 臉書抓取); nothing runs on a schedule.

    python fb_fetch.py              fetch one batch (30 posts) from the checkpoint
    python fb_fetch.py 50           fetch 50
    python fb_fetch.py --status     where the next batch starts, and the recent runs

How a batch works: the first batch starts at START (2026-10-01 00:00 Taiwan time). The posts after the checkpoint
are taken oldest first, up to the batch size; the posting time of the last one becomes the next checkpoint. So a
batch of 30 whose 30th post was written at 14:32 makes the next batch start at 14:32.

Facebook only shows a group newest first, and Apify's own Groups Scraper cannot stop at an upper date, so this uses
memo23/facebook-public-group-posts-scraper, which takes a closed window (posts newer than X and older than Y) and
does not charge for the newer posts it pages past to reach it. Paging back still takes time (about 85 posts a
minute: over an hour to reach a month back in this group), so batches far in the past are slow and a bigger batch
then saves waiting; batches close to the present take a few minutes. A window that comes back cut short
(run limit or timeout) only counts up to its oldest post; the rest is asked for again, so no post is skipped.

Every batch then goes through the same steps as before (ingest.ingest_apify): first photo downloaded, the post read
by the language model (Google Gemini with GEMINI_API_KEY; see llm_extract.py), checked against the cats already
listed, and listed on the site. Needs APIFY_TOKEN.
"""
import json
import os
import sys
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

import db
import ingest
import llm_extract
from images import first_image_url

API = "https://api.apify.com/v2"
ACTOR = "memo23~facebook-public-group-posts-scraper"
GROUP = "catparadise"
GROUP_URL = "https://www.facebook.com/groups/3566080520078042"
START = os.environ.get("FB_FETCH_START") or "2026-10-01T00:00:00+08:00"
BATCH = 30
PRICE = {"post": 0.0015, "start": 0.008}    # USD at the free tier; only used to cap a run
WINDOW_LIMIT = 200       # most posts one window may return; a fuller window is narrowed
FIRST_WINDOW = timedelta(hours=6)           # until the group's pace is known
MAX_ROUNDS = 4           # Apify runs per batch at most
RUN_TIMEOUT = 3 * 60 * 60   # seconds; paging back is slow (about 85 posts a minute), a month back takes over an hour
LLM_RUN_USD = float(os.environ.get("CATADOPT_LLM_RUN_USD") or 2.0)
LLM_RUN_POSTS = int(os.environ.get("CATADOPT_LLM_RUN_POSTS") or 300)


def _utc(text):
    t = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def _iso(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _user_env(name):
    """The variable from this process, or (Windows) the one saved with setx, which a process started earlier
    does not see. Read when needed so a token is never written anywhere."""
    if os.environ.get(name):
        return os.environ[name]
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            value = winreg.QueryValueEx(key, name)[0]
        os.environ[name] = value
        return value
    except (ImportError, OSError):
        return None


def token():
    return _user_env("APIFY_TOKEN")


def _kv(conn, key, default=None):
    row = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def _set(conn, key, value):
    conn.execute("INSERT INTO kv (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def checkpoint(conn):
    return _utc(_kv(conn, "fb_checkpoint", START))


def llm_on():
    """Posts are read by the language model whenever credentials exist (GEMINI_API_KEY for Google, or ANTHROPIC_API_KEY
    for Claude); CATADOPT_LLM=0 switches it off."""
    _user_env("GEMINI_API_KEY")
    on = os.environ.get("CATADOPT_LLM") != "0" and llm_extract.has_credentials()
    if on and not os.environ.get("CATADOPT_LLM_MODEL") and llm_extract.provider_of(llm_extract.MODEL) != llm_extract.provider():
        llm_extract.MODEL = llm_extract.DEFAULT_MODELS[llm_extract.provider()]   # the key showed up after start-up
    return on


def _item(raw):
    """A post of this scraper in the shape ingest.ingest_apify reads (that of Apify's Groups Scraper)."""
    return {"url": raw.get("url") or raw.get("facebookUrl"), "time": _utc(raw["time"]).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "text": raw.get("text"), "user.name": (raw.get("user") or {}).get("name"),
            "sharedPost.text": raw.get("attachedStoryText"), "sharedPost.url": None, "sharedPost.user.name": None,
            "image_url": first_image_url({"attachments": raw.get("attachments")})}


def run_window(tok, newer, older, limit=WINDOW_LIMIT):
    """One Apify run for the posts written between `newer` and `older` -> (run record, items newest first)."""
    body = {"startUrls": [GROUP_URL], "maxItems": limit, "viewOption": "CHRONOLOGICAL",
            "onlyPostsNewerThan": _iso(newer), "onlyPostsOlderThan": _iso(older)}
    cap = PRICE["start"] + limit * PRICE["post"]
    head = {"Authorization": f"Bearer {tok}"}
    r = requests.post(f"{API}/acts/{ACTOR}/runs", params={"maxTotalChargeUsd": f"{cap:.4f}", "timeout": RUN_TIMEOUT},
                      headers=head, json=body, timeout=60)
    r.raise_for_status()
    run = r.json()["data"]
    deadline = time.time() + RUN_TIMEOUT + 120
    while run["status"] in ("READY", "RUNNING", "TIMING-OUT", "ABORTING") and time.time() < deadline:
        time.sleep(10)
        g = requests.get(f"{API}/actor-runs/{run['id']}", headers=head, timeout=60)
        g.raise_for_status()
        run = g.json()["data"]
    items = []
    if run.get("defaultDatasetId"):
        g = requests.get(f"{API}/datasets/{run['defaultDatasetId']}/items", params={"clean": "true", "format": "json"},
                         headers=head, timeout=180)
        g.raise_for_status()
        items = [_item(x) for x in g.json() if x.get("time") and (x.get("url") or x.get("facebookUrl"))]
    return run, items


def _record(conn, run, posts, note):
    conn.execute("INSERT INTO apify_runs (started_at, kind, run_id, status, posts, cost_usd, note) VALUES (?,?,?,?,?,?,?)",
                 (datetime.now().isoformat(timespec="seconds"), "batch", run.get("id"), run.get("status"), posts,
                  run.get("usageTotalUsd"), note))


def plan(collected, start, covered, seen):
    """The posts known complete (written from `start` up to `covered`), not imported before, oldest first."""
    return sorted((it for it in collected.values() if start <= _utc(it["time"]) <= covered and it["url"] not in seen),
                  key=lambda it: (it["time"], it["url"]))


def run_batch(tok, n=BATCH, log=print, window=None):
    """Fetch the next n posts after the checkpoint and list them. Returns a summary dict."""
    db.init()
    now = datetime.now(timezone.utc)
    with db.connect() as conn:
        start = checkpoint(conn)
        seen = {r[0] for r in conn.execute("SELECT url FROM fb_posts_seen WHERE time >= ?", (_iso(start),))}
        pace = float(_kv(conn, "fb_posts_per_hour", "0") or 0)
    span = window or (timedelta(hours=max(0.5, n / pace * 1.3)) if pace else FIRST_WINDOW)
    log(f"fb: next batch of {n} posts from {start.astimezone(timezone(timedelta(hours=8))):%Y-%m-%d %H:%M} (Taiwan time)")
    limit = max(WINDOW_LIMIT, 2 * n)
    collected, covered, cost, rounds, fetched = {}, start, 0.0, 0, 0
    ready = []
    while rounds < MAX_ROUNDS and covered < now:
        ready = plan(collected, start, covered, seen)
        if len(ready) >= n:
            break
        older = min(covered + span, now)
        log(f"fb: asking Apify for posts {_iso(covered)} .. {_iso(older)} UTC")
        run, items = run_window(tok, covered - timedelta(seconds=1), older, limit)   # a post at the very checkpoint too
        rounds += 1
        fetched += len(items)
        cost += float(run.get("usageTotalUsd") or 0)
        with db.connect() as conn:
            _record(conn, run, len(items), f"{_iso(covered)}..{_iso(older)}")
        for it in items:
            collected.setdefault(it["url"], it)
        complete = run.get("status") == "SUCCEEDED" and len(items) < limit
        log(f"fb: {len(items)} posts, {run.get('status')}, {run.get('usageTotalUsd')} USD"
            + ("" if complete else " (cut short: asking again for the part before its oldest post)"))
        if complete:
            hours = (older - covered).total_seconds() / 3600
            if hours > 0.25 and items:
                with db.connect() as conn:
                    _set(conn, "fb_posts_per_hour", f"{len(items) / hours:.2f}")
            covered = older
            if len(items) < n // 2:
                span *= 2
        else:   # only the newest part of the window came back; the rest is asked for again, narrower
            oldest = min((_utc(it["time"]) for it in items), default=None)
            span = max(timedelta(minutes=10), ((oldest or older) - covered) / 2)
    ready = plan(collected, start, covered, seen)
    batch = ready[:n]
    summary = {"fetched": fetched, "used": len(batch), "added": 0, "cost_usd": round(cost, 4), "runs": rounds}
    with db.connect() as conn:
        for it in batch:
            conn.execute("INSERT OR IGNORE INTO fb_posts_seen (url, time) VALUES (?,?)", (it["url"], it["time"]))
        # the next batch starts at the last post taken; with none, after the stretch known to be empty
        nxt = _utc(batch[-1]["time"]) if batch else covered
        _set(conn, "fb_checkpoint", _iso(nxt) + "Z")
        conn.commit()
    stats = ingest.ingest_apify(GROUP, batch, llm=llm_on(), max_usd=LLM_RUN_USD, max_posts=LLM_RUN_POSTS) if batch else {}
    summary.update(added=stats.get("added", 0), stats=stats, checkpoint=_iso(nxt) + "Z")
    log(f"fb: took {len(batch)} posts, {summary['added']} new listings, {stats}; next batch from "
        f"{nxt.astimezone(timezone(timedelta(hours=8))):%Y-%m-%d %H:%M} (Taiwan time)")
    return summary


# ---- the admin page starts a batch in the background and watches it -------------------------------------
_lock = threading.Lock()
_state = {"running": False, "log": [], "last_result": None, "error": None, "started_at": None}


def start(n=BATCH):
    """Start a batch in a background thread. (True, None), or (False, reason)."""
    tok = token()
    if not tok:
        return False, "APIFY_TOKEN is not set"
    if not _lock.acquire(blocking=False):
        return False, "a batch is already running"
    _state.update(running=True, log=[], error=None, started_at=datetime.now().isoformat(timespec="seconds"))

    def work():
        try:
            _state["last_result"] = run_batch(tok, n, log=lambda m: _state["log"].append(f"{datetime.now():%H:%M:%S} {m}"))
        except Exception as e:  # shown on the admin page; the checkpoint only moves when a batch is stored
            _state["error"] = f"{type(e).__name__}: {str(e)[:300]}"
        finally:
            _state["running"] = False
            _lock.release()
    threading.Thread(target=work, daemon=True).start()
    return True, None


def status():
    db.init()
    with db.connect() as conn:
        cp = checkpoint(conn)
        runs = [dict(r) for r in conn.execute(
            "SELECT started_at, status, posts, cost_usd, note FROM apify_runs WHERE kind='batch' ORDER BY id DESC LIMIT 8")]
    return {"checkpoint": _iso(cp) + "Z", "batch": BATCH, "token": bool(token()), "running": _state["running"],
            "started_at": _state["started_at"], "log": _state["log"][-40:], "last_result": _state["last_result"],
            "error": _state["error"], "llm": llm_extract.MODEL if llm_on() else None, "runs": runs}


if __name__ == "__main__":
    if "--status" in sys.argv:
        print(json.dumps(status(), ensure_ascii=False, indent=1))
        sys.exit()
    tok = token()
    if not tok:
        sys.exit(__doc__)
    args = [a for a in sys.argv[1:] if a.isdigit()]
    print(json.dumps(run_batch(tok, int(args[0]) if args else BATCH), ensure_ascii=False))
