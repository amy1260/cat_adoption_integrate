"""Bring the problem reports visitors sent from the public site (Netlify Forms) into the admin's report list.

    python netlify_reports.py          sync now

The public site has no server, so its reports go to Netlify Forms (form "report"). This reads them with the Netlify
API and adds the ones not seen before to the local reports table, where they are handled like any other report
(python app.py, http://127.0.0.1:8765/#/reports). A report deleted on Netlify (or marked as spam there) is deleted
here too. The admin's report page syncs by itself when it is opened.

It needs a Netlify personal access token (Netlify > User settings > Applications > Personal access tokens), read
from the environment only:
    PowerShell:  setx NETLIFY_AUTH_TOKEN "<your token>"      (then open a new terminal)
"""
import hashlib
import json
import os
import sys
from datetime import datetime

import requests

import db

SITE_ID = "9424480b-5d52-4888-9835-e64de05483d9"   # Netlify project tw-cat-adoption-hub
FORM_NAME = "report"
API = "https://api.netlify.com/api/v1"
PER_PAGE = 100
KINDS = {"wrong_info", "adopted", "duplicate", "inappropriate", "suggestion", "other"}


class PullError(Exception):
    pass


def token():
    """The token from the environment. A program opened before `setx` (a terminal inside an app that was already
    running, say) does not see the new variable, so on Windows the user's saved variables are read as well."""
    tok = os.environ.get("NETLIFY_AUTH_TOKEN", "").strip()
    if not tok and sys.platform == "win32":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
                tok = str(winreg.QueryValueEx(key, "NETLIFY_AUTH_TOKEN")[0]).strip()
        except OSError:
            pass
    return tok


def _get(path, tok, **params):
    try:
        r = requests.get(API + path, headers={"Authorization": f"Bearer {tok}"}, params=params, timeout=30)
    except requests.RequestException as e:
        raise PullError(f"network: {e.__class__.__name__}") from None
    if r.status_code in (401, 403):
        raise PullError("token_rejected")
    if not r.ok:
        raise PullError(f"http_{r.status_code}")
    return r.json()


def _local_time(stamp):
    """Netlify's UTC time as local time, in the format the reports table uses."""
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone().replace(tzinfo=None).isoformat(timespec="seconds")
    except (AttributeError, ValueError):
        return datetime.now().isoformat(timespec="seconds")


def add_submissions(conn, subs):
    """Store Netlify submissions not stored before. Returns (new, already had, skipped)."""
    new = had = skipped = 0
    for s in reversed(subs):   # Netlify lists newest first; store oldest first
        sid = str(s.get("id") or "")
        d = s.get("data") or {}
        if not sid:
            skipped += 1
            continue
        if conn.execute("SELECT 1 FROM reports WHERE netlify_id=?", (sid,)).fetchone():
            had += 1
            continue
        try:
            cat_id = int(str(d.get("cat_id", "")).strip())
        except ValueError:
            skipped += 1
            continue
        kind = d.get("kind") if d.get("kind") in KINDS else "other"
        if d.get("website"):   # honeypot: only bots fill it in
            skipped += 1
            continue
        ip = d.get("ip") or s.get("ip") or ""
        who = hashlib.sha1(f"catadopt|{ip}".encode()).hexdigest()[:16] if ip else None
        conn.execute(
            "INSERT INTO reports (cat_id, kind, message, contact, reporter, created_at, netlify_id) VALUES (?,?,?,?,?,?,?)",
            (cat_id, kind, (d.get("message") or "").strip()[:1000] or None, (d.get("contact") or "").strip()[:120] or None,
             who, _local_time(s.get("created_at")), sid))
        new += 1
    return new, had, skipped


def pull(tok=None):
    """Match the local copy to Netlify: add the new submissions, delete the ones no longer on Netlify."""
    tok = tok or token()
    if not tok:
        raise PullError("no_token")
    forms = _get(f"/sites/{SITE_ID}/forms", tok)
    form = next((f for f in forms if f.get("name") == FORM_NAME), None)
    if not form:   # nothing sent yet, or the form itself is gone: leave the local copy alone
        return {"new": 0, "had": 0, "skipped": 0, "removed": 0, "note": "no_form_yet"}
    subs, page = [], 1
    while True:   # every page: what is missing from the whole list was deleted on Netlify
        batch = _get(f"/forms/{form['id']}/submissions", tok, per_page=PER_PAGE, page=page)
        subs += batch
        if len(batch) < PER_PAGE:
            break
        page += 1
    with db.connect() as conn:
        new, had, skipped = add_submissions(conn, subs)
        on_netlify = {str(s.get("id")) for s in subs if s.get("id")}
        gone = [r["id"] for r in conn.execute("SELECT id, netlify_id FROM reports WHERE netlify_id IS NOT NULL")
                if r["netlify_id"] not in on_netlify]
        conn.executemany("DELETE FROM reports WHERE id=?", [(i,) for i in gone])
    return {"new": new, "had": had, "skipped": skipped, "removed": len(gone)}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    db.init()
    try:
        print(json.dumps(pull(), ensure_ascii=False))
    except PullError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
