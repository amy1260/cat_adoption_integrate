"""Build the public, read-only copy of the site into public_site/, ready for static hosting (Netlify).

    python publish.py

Only what a visitor sees goes in: the browse/detail pages, the listed cats (data/cats.json) and their photos.
There is no server and no admin API on the public site, so the admin pages (review, reports, photos, edit
history, editing) cannot appear there and nothing can be changed from it; all of that stays on this computer
(python app.py, http://127.0.0.1:8765). Cats waiting for review, taken down or merged are left out, and so are
admin-only fields. Visitors' problem reports are sent to Netlify Forms (Netlify > the site > Forms).

    python publish.py --deploy      build, then upload it to Netlify (needs NETLIFY_AUTH_TOKEN, see netlify_reports.py)

While python app.py runs, this happens by itself: an admin change that shows on the public site (a duplicate
decided, a cat edited, listed or taken down, a photo, the shelter sync) is published to Netlify 30 seconds later.
Otherwise run it after the data changes (python apify_latest.py, say) and upload the folder.
"""
import io
import json
import shutil
import sys
import time
import zipfile
from datetime import date
from pathlib import Path

import requests

import db
import netlify_reports
from app import REGIONS, row_to_dict

BASE = Path(__file__).resolve().parent
OUT = BASE / "public_site"
PAGES = ["style.css", "i18n.js", "app.js", "static-api.js", "hero-1920.webp", "hero-800.webp"]
HIDDEN = ("photo_hash", "review", "dup_of", "extracted_by", "shelter_state", "status")

REPORT_FORM = """<!-- Netlify Forms reads this at deploy time; static-api.js posts the visitor's report to it. -->
<form name="report" data-netlify="true" netlify-honeypot="website" hidden>
  <input name="cat_id"><input name="cat"><input name="kind"><textarea name="message"></textarea><input name="contact">
  <input name="site_link"><input name="admin_link"><input name="source_url"><input name="website">
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


class DeployError(Exception):
    pass


def _zipped(folder):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(folder).as_posix())
    return buf.getvalue()


def deploy(tok=None, wait=180):
    """Build public_site/ and publish it as the live Netlify site. Waits for Netlify to finish, up to `wait` seconds."""
    tok = tok or netlify_reports.token()
    if not tok:
        raise DeployError("no_token")
    info = build()
    auth = {"Authorization": f"Bearer {tok}"}
    try:
        r = requests.post(f"{netlify_reports.API}/sites/{netlify_reports.SITE_ID}/deploys", data=_zipped(OUT),
                          headers={**auth, "Content-Type": "application/zip"}, timeout=300)
        if r.status_code in (401, 403):
            raise DeployError("token_rejected")
        if not r.ok:
            raise DeployError(f"http_{r.status_code}")
        dep = r.json()
        end = time.time() + wait
        while dep.get("state") not in ("ready", "error") and time.time() < end:
            time.sleep(3)
            dep = requests.get(f"{netlify_reports.API}/deploys/{dep['id']}", headers=auth, timeout=30).json()
    except requests.RequestException as e:
        raise DeployError(f"network: {e.__class__.__name__}") from None
    if dep.get("state") == "error":
        raise DeployError("netlify: " + (dep.get("error_message") or "deploy failed"))
    return {**info, "deploy_id": dep.get("id"), "state": dep.get("state"), "url": dep.get("ssl_url") or dep.get("url")}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    db.init()
    if "--deploy" in sys.argv:
        try:
            print(json.dumps(deploy(), ensure_ascii=False))
        except DeployError as e:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
    else:
        print(json.dumps(build(), ensure_ascii=False))
