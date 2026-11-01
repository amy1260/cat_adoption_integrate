"""Fetch the newest posts of the Facebook group 愛貓領養 with Apify and put the cats on the site, in one step.

    PowerShell:  setx APIFY_TOKEN "<your personal API token>"      (then open a new terminal)
    python apify_latest.py              fetch the newest 90 posts not fetched before, and list the cats
    python apify_latest.py --posts 20   another number of posts
    python apify_latest.py --plan       only show what it would fetch and the most it can cost; starts nothing
    python apify_latest.py --status     recent runs, what they cost, what is on the site

Nothing runs by itself: a fetch happens only when this is started. The token is read from the environment only,
so it never ends up in a file.

No post is fetched twice: every post a run returns is remembered (table fb_posts_seen, per group), the next run
asks the scraper only for posts newer than the newest one already fetched from this group, and any post that still
comes back is dropped before it is imported. When more than 90 new posts were written since the last run, the
newest 90 are taken.

Until 2026-11-01 the group was 貓咪天堂 (3566080520078042, source fb_catparadise); its listings were taken down and
backed up in data/backups/facebook_catparadise_*/ when the group was changed.

Each new post then goes through the rest of the pipeline with nobody in the loop (ingest.ingest_apify): the rules
drop what is plainly not an adoption post, the first photo is downloaded (Facebook's links expire in days), a
language model reads the text (is it really an adoption post, and sex, age, breed, colour, health, place, contact;
Google Gemini with GEMINI_API_KEY, Claude with ANTHROPIC_API_KEY, CATADOPT_LLM=0 turns it off), the cat is checked
against the ones already listed so nothing appears twice, and it goes on the site.

Cost (Facebook Groups Scraper, pay per event: 0.005 USD per post on the free tier, +0.002 per post with the date
filter that every run after the first uses, 0.001 per run): at most about 0.46 USD for the first 90 posts
and 0.63 USD for later runs. Every run is capped
with Apify's own maxTotalChargeUsd, and it does not start when the month's Apify budget cannot cover that cap.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

import db
import ingest
import llm_extract
from apify_fetch import fetch, slim

API = "https://api.apify.com/v2"
ACTOR = "apify~facebook-groups-scraper"
GROUP = "aimao"                 # source fb_aimao on the site (ingest.GROUPS)
GROUP_URL = "https://www.facebook.com/groups/1612153615732604"   # 愛貓領養
POSTS = 90
# USD per event at the free tier (higher tiers pay less, so this only over-estimates).
PRICE = {"post": 0.005, "date_filter": 0.002, "start": 0.001}
RUN_TIMEOUT = 25 * 60
LLM_RUN_USD = float(os.environ.get("CATADOPT_LLM_RUN_USD") or 2.0)    # most one run may spend on the model reading posts
LLM_RUN_POSTS = int(os.environ.get("CATADOPT_LLM_RUN_POSTS") or 300)  # ... and the most posts it reads


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def account(token):
    """(monthly budget, spent so far this cycle) from the Apify account."""
    r = requests.get(f"{API}/users/me/limits", headers=_headers(token), timeout=60)
    r.raise_for_status()
    d = r.json()["data"]
    cap = float(os.environ.get("APIFY_MONTHLY_BUDGET_USD") or d["limits"]["maxMonthlyUsageUsd"])
    return cap, float(d["current"]["monthlyUsageUsd"])


def posts_cost(n, dated):
    return PRICE["start"] + n * (PRICE["post"] + (PRICE["date_filter"] if dated else 0))


def run_actor(token, posts, max_usd, newer_than=None):
    """Start the scraper, wait for it, return (run record, dataset items). Apify stops the run at max_usd."""
    body = {"startUrls": [{"url": GROUP_URL}], "resultsLimit": posts, "viewOption": "CHRONOLOGICAL"}
    if newer_than:
        body["onlyPostsNewerThan"] = newer_than
    r = requests.post(f"{API}/acts/{ACTOR}/runs", params={"maxTotalChargeUsd": f"{max_usd:.4f}"},
                      headers=_headers(token), json=body, timeout=60)
    r.raise_for_status()
    run = r.json()["data"]
    deadline = time.time() + RUN_TIMEOUT
    while run["status"] in ("READY", "RUNNING", "TIMING-OUT", "ABORTING") and time.time() < deadline:
        time.sleep(10)
        g = requests.get(f"{API}/actor-runs/{run['id']}", headers=_headers(token), timeout=60)
        g.raise_for_status()
        run = g.json()["data"]
    items = [slim(it) for it in fetch(run["defaultDatasetId"], token)] if run.get("defaultDatasetId") else []
    return run, items


def _utc(t):
    return datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(timezone.utc)


def newest_seen(conn, group=GROUP):
    t = conn.execute("SELECT MAX(time) FROM fb_posts_seen WHERE grp=?", (group,)).fetchone()[0]
    return _utc(t).strftime("%Y-%m-%dT%H:%M:%S") if t else None


def new_posts(conn, items, limit):
    """The newest `limit` posts of a run that were never fetched before (one per URL)."""
    out, urls = [], set()
    for it in sorted((it for it in items if it.get("url") and it.get("time")), key=lambda it: _utc(it["time"]), reverse=True):
        if it["url"] in urls or conn.execute("SELECT 1 FROM fb_posts_seen WHERE url=?", (it["url"],)).fetchone():
            continue
        urls.add(it["url"])
        out.append(it)
    return out[:limit]


def llm_on():
    """Posts are read by the language model whenever credentials exist (GEMINI_API_KEY for Google, or ANTHROPIC_API_KEY
    for Claude); CATADOPT_LLM=0 switches it off."""
    return os.environ.get("CATADOPT_LLM") != "0" and llm_extract.has_credentials()


def run(token, posts=POSTS, dry=False, log=print):
    """Fetch the newest `posts` posts not fetched before and list the cats. Returns a summary, or None when nothing
    was started."""
    db.init()
    with db.connect() as conn:
        newer = newest_seen(conn)
    cap = posts_cost(posts, dated=bool(newer))
    budget, used = account(token)
    log(f"apify: up to {posts} newest posts" + (f" newer than {newer} (UTC)" if newer else " (first run)")
        + f", at most {cap:.3f} USD; this month {used:.2f} of {budget:.2f} USD used")
    log(f"apify: posts are read by {llm_extract.MODEL} ({llm_extract.provider()})" if llm_on()
        else "apify: no model credentials (GEMINI_API_KEY): posts are read by the rules only")
    if budget - used < cap:
        log("apify: not enough Apify budget left this month for this run; nothing was started")
        return None
    if dry:
        return None
    run_, items = run_actor(token, posts, cap, newer)
    with db.connect() as conn:
        fresh = new_posts(conn, items, posts)
        for it in fresh:
            conn.execute("INSERT OR IGNORE INTO fb_posts_seen (url, time, grp) VALUES (?,?,?)", (it["url"], it["time"], GROUP))
        conn.commit()
    # photo download, language model, duplicate check and listing (see ingest.ingest_apify)
    stats = ingest.ingest_apify(GROUP, fresh, llm=llm_on(), max_usd=LLM_RUN_USD, max_posts=LLM_RUN_POSTS) if fresh else {}
    with db.connect() as conn:
        conn.execute("INSERT INTO apify_runs (started_at, kind, run_id, status, posts, cost_usd, note) VALUES (?,?,?,?,?,?,?)",
                     (datetime.now().isoformat(timespec="seconds"), "latest", run_.get("id"), run_.get("status"),
                      len(fresh), run_.get("usageTotalUsd"), json.dumps(stats, ensure_ascii=False)))
    summary = {"status": run_.get("status"), "returned": len(items), "new": len(fresh),
               "skipped_already_fetched": len(items) - len(fresh), "cost_usd": run_.get("usageTotalUsd"), "stats": stats}
    log(f"apify: {run_.get('status')}: {len(items)} posts returned, {len(fresh)} new, "
        f"{run_.get('usageTotalUsd')} USD; {stats}")
    return summary


def status(log=print):
    """Recent runs, what they cost, and what the site holds from Facebook."""
    db.init()
    with db.connect() as conn:
        for r in conn.execute("SELECT * FROM apify_runs ORDER BY id DESC LIMIT 10"):
            log(f"{r['started_at']}  {r['status']:10} posts={r['posts']} cost={r['cost_usd']}  {r['note'] or ''}")
        total = conn.execute("SELECT COALESCE(SUM(cost_usd),0), COUNT(*) FROM apify_runs").fetchone()
        seen = conn.execute("SELECT COUNT(*), MIN(time), MAX(time) FROM fb_posts_seen WHERE grp=?", (GROUP,)).fetchone()
        by = conn.execute("SELECT COALESCE(extracted_by,'-') k, COUNT(*) n FROM cats WHERE source=? "
                          f"AND {db.PUBLIC} GROUP BY 1", (f"fb_{GROUP}",)).fetchall()
    log(f"runs: {total[1]}, spent {total[0]:.3f} USD; posts fetched {seen[0]} ({seen[1]} .. {seen[2]})")
    log("listings on the site from Facebook, by how they were read: " + (", ".join(f"{r['k']} {r['n']}" for r in by) or "none"))


if __name__ == "__main__":
    if "--status" in sys.argv:
        sys.exit(status())
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        sys.exit(__doc__)
    n = POSTS
    if "--posts" in sys.argv:
        try:
            n = max(1, min(500, int(sys.argv[sys.argv.index("--posts") + 1])))
        except (IndexError, ValueError):
            sys.exit("--posts needs a number, e.g. --posts 50")
    run(token, n, dry="--plan" in sys.argv)
