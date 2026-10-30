"""Download an Apify dataset of Facebook group posts into data/apify/ for ingest.py.

    set APIFY_TOKEN=<your personal API token>      (Apify Console > Settings > API & Integrations)
    python apify_fetch.py <datasetId> [group]       group defaults to catparadise

Reading a dataset is free; only running the scraper Actor is billed. The token is read from the
environment so it never ends up in a file.
"""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

FIELDS = "time,url,text,user.name,sharedPost.text,sharedPost.url,sharedPost.user.name"


def fetch(dataset_id, token):
    items, offset = [], 0
    while True:
        r = requests.get(
            f"https://api.apify.com/v2/datasets/{dataset_id}/items",
            params={"format": "json", "clean": "true", "fields": FIELDS, "flatten": "user,sharedPost", "offset": offset, "limit": 1000},
            headers={"Authorization": f"Bearer {token}"}, timeout=120)
        r.raise_for_status()
        page = r.json()
        items += page
        if len(page) < 1000:
            return items
        offset += len(page)


if __name__ == "__main__":
    token = os.environ.get("APIFY_TOKEN")
    if not token or len(sys.argv) < 2:
        sys.exit(__doc__)
    group = sys.argv[2] if len(sys.argv) > 2 else "catparadise"
    items = fetch(sys.argv[1], token)
    out = Path(__file__).resolve().parent / "data" / "apify" / f"{group}_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    print(f"saved {len(items)} posts -> {out}")
