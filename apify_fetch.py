"""Download an Apify dataset of Facebook group posts into data/apify/ for ingest.py.

    PowerShell:  $env:APIFY_TOKEN="<your personal API token>"   (cmd: set APIFY_TOKEN=...)
                 (Apify Console > Settings > API & Integrations)
    python apify_fetch.py <datasetId> [group]                    group defaults to catparadise

Photo links expire after a few days, so run ingest.py soon after fetching. Reading a dataset is
free; only running the scraper Actor is billed. The token is read from the environment so it
never ends up in a file.
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

from images import first_image_url

# `sharedPost` is fetched whole: the API cannot select into its media list with dotted field names
# (that silently returns nothing), and a reshare's photos live there.
FIELDS = "time,url,text,user.name,attachments,sharedPost"


def fetch(dataset_id, token):
    items, offset = [], 0
    while True:
        r = requests.get(
            f"https://api.apify.com/v2/datasets/{dataset_id}/items",
            params={"format": "json", "clean": "true", "fields": FIELDS, "flatten": "user",
                    "offset": offset, "limit": 500},
            headers={"Authorization": f"Bearer {token}"}, timeout=180)
        r.raise_for_status()
        page = r.json()
        items += page
        if len(page) < 500:
            return items
        offset += len(page)


def slim(it):
    """Keep what ingest.py needs, and the first photo's URL; the raw media lists are huge."""
    shared = it.pop("sharedPost", None) or {}
    image_url = first_image_url({"attachments": it.get("attachments"), "sharedPost": shared})
    it.pop("attachments", None)
    it["sharedPost.text"] = shared.get("text")
    it["sharedPost.url"] = shared.get("url")
    it["sharedPost.user.name"] = (shared.get("user") or {}).get("name")
    it["image_url"] = image_url
    return it


if __name__ == "__main__":
    token = os.environ.get("APIFY_TOKEN")
    if not token or len(sys.argv) < 2:
        sys.exit(__doc__)
    group = sys.argv[2] if len(sys.argv) > 2 else "catparadise"
    items = [slim(it) for it in fetch(sys.argv[1], token)]
    print(f"{sum(1 for it in items if it['image_url'])} of {len(items)} posts have a photo")
    out = Path(__file__).resolve().parent / "data" / "apify" / f"{group}_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    print(f"saved {len(items)} posts -> {out}")
    print(f'next:  python ingest.py "{out}"')
