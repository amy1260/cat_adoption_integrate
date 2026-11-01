"""Build the public, read-only copy of the site into public_site/, ready for static hosting (Netlify).

    python publish.py

Only what a visitor sees goes in: the browse/detail pages, the listed cats (data/cats.json) and their photos.
There is no server and no admin API on the public site, so the admin pages (review, reports, photos, edit
history, editing) cannot appear there and nothing can be changed from it; all of that stays on this computer
(python app.py, http://127.0.0.1:8765). Cats waiting for review, taken down or merged are left out, and so are
admin-only fields. Visitors' problem reports are sent to Netlify Forms (Netlify > the site > Forms).

Run it again after the data changes (shelter sync, python apify_latest.py, an edit) and deploy the folder again.
"""
import json
import shutil
from datetime import date
from pathlib import Path

import db
from app import REGIONS, row_to_dict

BASE = Path(__file__).resolve().parent
OUT = BASE / "public_site"
PAGES = ["style.css", "i18n.js", "app.js", "static-api.js", "hero-1600.webp", "hero-800.webp"]
HIDDEN = ("photo_hash", "review", "dup_of", "extracted_by", "shelter_state", "status")

REPORT_FORM = """<!-- Netlify Forms reads this at deploy time; static-api.js posts the visitor's report to it. -->
<form name="report" data-netlify="true" netlify-honeypot="website" hidden>
  <input name="cat_id"><input name="cat"><input name="kind"><textarea name="message"></textarea><input name="contact"><input name="website">
</form>
"""

NETLIFY_TOML = """# Plain files, nothing to build.
[build]
  publish = "."

[[headers]]
  for = "/data/*"
  [headers.values]
    Cache-Control = "public, max-age=300"

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
"""


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "static" / "photos").mkdir(parents=True)
    (OUT / "data").mkdir()
    with db.connect() as conn:
        rows = conn.execute(f"SELECT * FROM cats WHERE {db.PUBLIC}").fetchall()
        cats = []
        for r in rows:
            d = row_to_dict(r)
            d["also_listed"] = [dict(a) for a in conn.execute(
                "WITH RECURSIVE tree(id) AS (SELECT id FROM cats WHERE dup_of=? UNION SELECT c.id FROM cats c JOIN tree t ON c.dup_of=t.id) "
                "SELECT c.id, c.source, c.source_url, c.contact_name, c.posted_at FROM cats c JOIN tree USING(id)", (r["id"],))]
            for k in HIDDEN:
                d.pop(k, None)
            d["status"] = "open"
            d["needs_photo"] = False
            cats.append(d)
    meta = {"regions": REGIONS, "by_source": {}, "by_region": {}, "breeds": {}, "updated": date.today().isoformat()}
    for c in cats:
        meta["by_source"][c["source"]] = meta["by_source"].get(c["source"], 0) + 1
        if c["region"]:
            meta["by_region"][c["region"]] = meta["by_region"].get(c["region"], 0) + 1
        if c["breed"]:
            meta["breeds"][c["breed"]] = meta["breeds"].get(c["breed"], 0) + 1
    photos = 0
    for c in cats:   # our own copies of Facebook photos; shelter photos stay on pet.gov.tw
        p = c.get("photo") or ""
        if p.startswith("/static/photos/"):
            src = BASE / p.lstrip("/")
            if src.is_file():
                shutil.copy2(src, OUT / p.lstrip("/"))
                photos += 1
            else:
                c["photo"] = None
    (OUT / "data" / "cats.json").write_text(json.dumps(cats, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "data" / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    for f in PAGES:
        shutil.copy2(BASE / "static" / f, OUT / "static" / f)
    html = (BASE / "static" / "index.html").read_text(encoding="utf-8")
    html = html.replace('<script src="/static/i18n.js"></script>',
                        '<script src="/static/static-api.js"></script>\n<script src="/static/i18n.js"></script>', 1)
    html = html.replace("</body>", REPORT_FORM + "</body>", 1)
    (OUT / "index.html").write_text(html, encoding="utf-8")
    (OUT / "netlify.toml").write_text(NETLIFY_TOML, encoding="utf-8")
    return {"cats": len(cats), "photos": photos, "by_source": meta["by_source"], "folder": str(OUT)}


if __name__ == "__main__":
    db.init()
    print(json.dumps(build(), ensure_ascii=False))
