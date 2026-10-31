import hashlib
import json
import os
import threading
import time
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

import ages
import db
import edits
import fb_fetch
import ingest
import shelter
from images import download, save_bytes

BASE = Path(__file__).resolve().parent

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024

REGIONS = ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "臺中市", "彰化縣", "南投縣",
           "雲林縣", "嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣",
           "金門縣", "連江縣"]


def row_to_dict(r):
    d = dict(r)
    for k in ("edit_token_hash", "locked", "photo_checked_at", "state_checked_at", "released"):
        d.pop(k, None)
    d["health_tags"] = json.loads(d["health_tags"] or "[]")
    for k in ("neutered", "vaccinated"):
        d[k] = None if d[k] is None else bool(d[k])
    d["needs_photo"] = not d["photo"]  # shown to the admin, who can add one by hand
    return d


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/cats")
def list_cats():
    a = request.args
    where, params = [db.PUBLIC], []
    for col in ("region", "sex", "age_group", "source", "breed"):
        vals = [v for v in a.getlist(col) if v]
        if vals:
            where.append(f"{col} IN ({','.join('?' * len(vals))})")
            params += vals
    for col in ("neutered", "vaccinated"):
        if a.get(col) in ("0", "1"):
            where.append(f"{col}=?")
            params.append(int(a[col]))
    if a.get("fiv") in ("neg", "pos"):
        where.append("fiv_felv=?")
        params.append(a["fiv"])
    if a.get("q"):
        like = f"%{a['q']}%"
        where.append("(title LIKE ? OR description LIKE ? OR color LIKE ? OR breed_text LIKE ? OR contact_name LIKE ? "
                     "OR shelter_no LIKE ? OR chip LIKE ? OR name LIKE ?)")
        params += [like] * 8
    sql_where = " AND ".join(where)
    order = {"region": "region, posted_at DESC", "age": "age_months IS NULL, age_months"}.get(
        a.get("sort"), "COALESCE(posted_at, created_at) DESC")
    page = max(1, int(a.get("page", 1)))
    per = min(60, max(1, int(a.get("per_page", 24))))
    with db.connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM cats WHERE {sql_where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT *, (SELECT COUNT(*) FROM cats c2 WHERE c2.dup_of=cats.id) AS also_listed "
            f"FROM cats WHERE {sql_where} ORDER BY {order} LIMIT ? OFFSET ?",
            params + [per, (page - 1) * per]).fetchall()
    return jsonify({"total": total, "page": page, "per_page": per, "items": [row_to_dict(r) for r in rows]})


def _is_local():
    return request.remote_addr in ("127.0.0.1", "::1")


def _actor_for(conn, cat_id):
    """Only the admin (the machine running the site) may change a listing: ("admin", row), otherwise (None, row)
    and the caller answers 403. (None, None) if it does not exist."""
    row = conn.execute("SELECT * FROM cats WHERE id=?", (cat_id,)).fetchone()
    if row is None:
        return None, None
    return ("admin" if _is_local() else None), row


@app.get("/api/cats/<int:cat_id>")
def get_cat(cat_id):
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM cats WHERE id=?", (cat_id,)).fetchone()
        # waiting for review or taken down: only the admin may open it
        withheld = row and (row["review"] == "pending" or row["status"] == "closed")
        if not row or (withheld and not _is_local()):
            return jsonify({"error": "not_found"}), 404
        also = conn.execute(
            "WITH RECURSIVE tree(id) AS (SELECT id FROM cats WHERE dup_of=? UNION SELECT c.id FROM cats c JOIN tree t ON c.dup_of=t.id) "
            "SELECT c.id, c.source, c.source_url, c.contact_name, c.posted_at FROM cats c JOIN tree USING(id)",
            (cat_id,)).fetchall()
    d = row_to_dict(row)
    d["also_listed"] = [dict(a) for a in also]  # same cat confirmed as listed by other sources
    return jsonify(d)


@app.get("/api/meta")
def meta():
    with db.connect() as conn:
        base = db.PUBLIC
        by_source = {r[0]: r[1] for r in conn.execute(
            f"SELECT source, COUNT(*) FROM cats WHERE {base} GROUP BY source")}
        by_region = {r[0]: r[1] for r in conn.execute(
            f"SELECT region, COUNT(*) FROM cats WHERE {base} AND region IS NOT NULL GROUP BY region")}
        breeds = {r[0]: r[1] for r in conn.execute(
            f"SELECT breed, COUNT(*) FROM cats WHERE {base} AND breed IS NOT NULL GROUP BY breed")}
    return jsonify({"regions": REGIONS, "by_source": by_source, "by_region": by_region, "breeds": breeds})


def local_only(fn):
    """Admin endpoints are limited to the machine running the site."""
    @wraps(fn)
    def wrapper(*a, **kw):
        if request.remote_addr not in ("127.0.0.1", "::1"):
            return jsonify({"error": "forbidden"}), 403
        return fn(*a, **kw)
    return wrapper


def _review_rows(conn, decided):
    cond = "d.decision IS NOT NULL" if decided else "d.decision IS NULL"
    rows = conn.execute(
        f"SELECT d.id AS cand_id, d.reason, d.decision, d.kept, d.created_at AS flagged_at, d.cat_id, d.other_id "
        f"FROM dup_candidates d WHERE {cond} ORDER BY d.id DESC LIMIT 200").fetchall()
    out = []
    for r in rows:
        a = conn.execute("SELECT * FROM cats WHERE id=?", (r["cat_id"],)).fetchone()
        b = conn.execute("SELECT * FROM cats WHERE id=?", (r["other_id"],)).fetchone()
        if a and b:
            out.append({"cand_id": r["cand_id"], "reason": r["reason"], "decision": r["decision"],
                        "kept": r["kept"], "flagged_at": r["flagged_at"], "new": row_to_dict(a), "existing": row_to_dict(b)})
    return out


@app.get("/api/review")
@local_only
def review_list():
    with db.connect() as conn:
        return jsonify({"pending": _review_rows(conn, False), "decided": _review_rows(conn, True)})


@app.get("/api/review/count")
@local_only
def review_count():
    with db.connect() as conn:
        n = conn.execute("SELECT COUNT(*) FROM dup_candidates WHERE decision IS NULL").fetchone()[0]
    return jsonify({"pending": n})


@app.post("/api/review/<int:cand_id>")
@local_only
def review_decide(cand_id):
    """keep_new / keep_existing: same cat, the admin picks which listing stays (the other is hidden and shown as
    "also listed"); different: both stay; undo: put the decision back in the queue."""
    data = request.get_json(silent=True) or {}
    decision = {"same": "keep_existing"}.get(data.get("decision"), data.get("decision"))
    fill = data.get("fill", True) is not False  # copy what the hidden listing alone knows into the kept one
    if decision not in ("keep_new", "keep_existing", "different", "undo"):
        return jsonify({"error": "bad_decision"}), 400
    now = datetime.now().isoformat(timespec="seconds")
    with db.connect() as conn:
        cand = conn.execute("SELECT * FROM dup_candidates WHERE id=?", (cand_id,)).fetchone()
        if not cand:
            return jsonify({"error": "not_found"}), 404
        if decision != "undo" and cand["decision"]:
            return jsonify({"error": "already_decided"}), 409
        new_id, old_id = cand["cat_id"], cand["other_id"]
        if decision == "different":
            conn.execute("UPDATE cats SET dup_of=NULL, review='cleared' WHERE id=?", (new_id,))
            conn.execute("UPDATE dup_candidates SET decision='different', decided_at=? WHERE id=?", (now, cand_id))
        elif decision in ("keep_new", "keep_existing"):
            keep, drop = (new_id, old_id) if decision == "keep_new" else (old_id, new_id)
            fill_edit = edits.fill_blanks(conn, keep, drop) if fill else None
            conn.execute("UPDATE cats SET dup_of=NULL, review=CASE WHEN review='pending' THEN 'cleared' ELSE review END WHERE id=?", (keep,))
            conn.execute("UPDATE cats SET dup_of=?, review='merged' WHERE id=?", (keep, drop))
            conn.execute("UPDATE dup_candidates SET decision=?, kept=?, fill_edit=?, decided_at=? WHERE id=?",
                         (decision, "new" if keep == new_id else "existing", fill_edit, now, cand_id))
        else:  # undo
            if cand["fill_edit"]:
                try:
                    edits.revert_edit(conn, cand["fill_edit"], f"undo merge #{cand_id}")
                except edits.EditError:
                    pass  # already undone by hand
            if cand["kept"] == "new":  # the older listing had been hidden: bring it back
                conn.execute("UPDATE cats SET dup_of=NULL, review=NULL WHERE id=?", (old_id,))
            conn.execute("UPDATE cats SET dup_of=NULL, review='pending' WHERE id=?", (new_id,))
            conn.execute("UPDATE dup_candidates SET decision=NULL, kept=NULL, fill_edit=NULL, decided_at=NULL WHERE id=?", (cand_id,))
    return jsonify({"ok": True})


REPORT_KINDS = {"wrong_info", "adopted", "duplicate", "inappropriate", "suggestion", "other"}
MESSAGE_REQUIRED = {"wrong_info", "suggestion", "other"}
_report_log = {}  # reporter hash -> recent submission times, to stop spam


@app.post("/api/cats/<int:cat_id>/report")
def report_cat(cat_id):
    d = request.get_json(silent=True) or {}
    if d.get("website"):  # honeypot field: only bots fill it in
        return jsonify({"ok": True})
    kind = d.get("kind")
    message = (d.get("message") or "").strip()[:1000]
    contact = (d.get("contact") or "").strip()[:120] or None
    errors = {}
    if kind not in REPORT_KINDS:
        errors["kind"] = "required"
    if kind in MESSAGE_REQUIRED and len(message) < 5:
        errors["message"] = "too_short"
    if errors:
        return jsonify({"error": "validation", "fields": errors}), 400
    who = hashlib.sha1(f"catadopt|{request.remote_addr}".encode()).hexdigest()[:16]
    now = time.time()
    recent = [t for t in _report_log.get(who, []) if now - t < 3600]
    if len(recent) >= 5:
        return jsonify({"error": "rate_limited"}), 429
    _report_log[who] = recent + [now]
    with db.connect() as conn:
        if not conn.execute("SELECT 1 FROM cats WHERE id=?", (cat_id,)).fetchone():
            return jsonify({"error": "not_found"}), 404
        if conn.execute("SELECT 1 FROM reports WHERE cat_id=? AND kind=? AND reporter=? AND created_at > ? AND status='open'",
                        (cat_id, kind, who, (datetime.now() - timedelta(days=1)).isoformat(timespec="seconds"))).fetchone():
            return jsonify({"ok": True})  # already received; don't pile up repeats
        conn.execute("INSERT INTO reports (cat_id, kind, message, contact, reporter, created_at) VALUES (?,?,?,?,?,?)",
                     (cat_id, kind, message or None, contact, who, datetime.now().isoformat(timespec="seconds")))
    return jsonify({"ok": True}), 201


@app.get("/api/photos/missing")
@local_only
def photos_missing():
    """Listings that stay up without a photo, so the admin can add one by hand."""
    with db.connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM cats WHERE photo IS NULL AND released=0 AND {db.PUBLIC} ORDER BY source='shelter', posted_at DESC").fetchall()
    return jsonify({"items": [row_to_dict(r) for r in rows]})


@app.get("/api/photos/count")
@local_only
def photos_count():
    with db.connect() as conn:
        n = conn.execute(f"SELECT COUNT(*) FROM cats WHERE photo IS NULL AND released=0 AND {db.PUBLIC}").fetchone()[0]
    return jsonify({"missing": n})


@app.post("/api/cats/<int:cat_id>/photo")
def set_photo(cat_id):
    """Attach or replace a photo (admin only)."""
    with db.connect() as conn:
        actor, row = _actor_for(conn, cat_id)
    if row is None:
        return jsonify({"error": "not_found"}), 404
    if actor is None:
        return jsonify({"error": "forbidden"}), 403
    upload = request.files.get("photo")
    url = (request.form.get("url") or "").strip()
    if upload and (upload.filename or upload.mimetype.startswith("image/")):
        path, phash = save_bytes(upload.read())
    elif url.startswith(("http://", "https://")):
        path, phash = download(url)
    else:
        return jsonify({"error": "no_image"}), 400
    if not path:
        return jsonify({"error": "unusable_image"}), 422
    with db.connect() as conn:
        edits.apply_edit(conn, cat_id, {"photo": path, "photo_hash": phash}, actor, "photo")
    return jsonify({"photo": path})


@app.put("/api/cats/<int:cat_id>")
def update_cat(cat_id):
    """Change a listing (admin only). Everything is recorded in the edit history."""
    body = request.get_json(silent=True) or {}
    with db.connect() as conn:
        actor, row = _actor_for(conn, cat_id)
        if row is None:
            return jsonify({"error": "not_found"}), 404
        if actor is None:
            return jsonify({"error": "forbidden"}), 403
        try:
            cols = edits.normalize(body, edits.ADMIN_FIELDS, row["posted_at"], row)
        except edits.EditError as e:
            return jsonify({"error": "validation", "fields": {e.field: e.code}}), 400
        edit_id = edits.apply_edit(conn, cat_id, cols, actor)
        fresh = conn.execute("SELECT * FROM cats WHERE id=?", (cat_id,)).fetchone()
    return jsonify({"ok": True, "edit_id": edit_id, "cat": row_to_dict(fresh)})


@app.delete("/api/cats/<int:cat_id>")
def unlist_cat(cat_id):
    """Take a listing down (not erased: the admin can bring it back from the edit history)."""
    with db.connect() as conn:
        actor, row = _actor_for(conn, cat_id)
        if row is None:
            return jsonify({"error": "not_found"}), 404
        if actor is None:
            return jsonify({"error": "forbidden"}), 403
        edits.apply_edit(conn, cat_id, {"status": "closed"}, actor, "unlisted")
    return jsonify({"ok": True})


@app.get("/api/admin/edits")
@local_only
def admin_edits():
    cat_id = request.args.get("cat_id", type=int)
    with db.connect() as conn:
        return jsonify({"items": edits.history(conn, cat_id, min(500, request.args.get("limit", 200, type=int)))})


@app.post("/api/admin/edits/<int:edit_id>/revert")
@local_only
def admin_revert(edit_id):
    with db.connect() as conn:
        try:
            new_id = edits.revert_edit(conn, edit_id)
        except LookupError:
            return jsonify({"error": "not_found"}), 404
        except edits.EditError as e:
            return jsonify({"error": e.code}), 409
    return jsonify({"ok": True, "edit_id": new_id})


@app.get("/api/reports")
@local_only
def reports_list():
    status = request.args.get("status", "open")
    where = "r.status='open'" if status == "open" else "r.status!='open'"
    with db.connect() as conn:
        rows = conn.execute(
            f"SELECT r.* FROM reports r WHERE {where} ORDER BY r.id DESC LIMIT 200").fetchall()
        out = []
        for r in rows:
            cat = conn.execute("SELECT * FROM cats WHERE id=?", (r["cat_id"],)).fetchone()
            out.append({**dict(r), "reporter": None, "cat": row_to_dict(cat) if cat else None})
    return jsonify({"items": out})


@app.get("/api/reports/count")
@local_only
def reports_count():
    with db.connect() as conn:
        n = conn.execute("SELECT COUNT(*) FROM reports WHERE status='open'").fetchone()[0]
    return jsonify({"open": n})


@app.post("/api/reports/<int:report_id>")
@local_only
def reports_handle(report_id):
    """resolve / dismiss / reopen a report; close_cat also takes the listing offline (e.g. already adopted)."""
    action = (request.get_json(silent=True) or {}).get("action")
    if action not in ("resolve", "dismiss", "reopen", "close_cat"):
        return jsonify({"error": "bad_action"}), 400
    now = datetime.now().isoformat(timespec="seconds")
    with db.connect() as conn:
        rep = conn.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
        if not rep:
            return jsonify({"error": "not_found"}), 404
        if action == "reopen":
            conn.execute("UPDATE reports SET status='open', handled_at=NULL WHERE id=?", (report_id,))
        else:
            if action == "close_cat":
                conn.execute("UPDATE cats SET status='closed' WHERE id=?", (rep["cat_id"],))
            status = "dismissed" if action == "dismiss" else "resolved"
            conn.execute("UPDATE reports SET status=?, handled_at=? WHERE id=?", (status, now, report_id))
    return jsonify({"ok": True})


@app.post("/api/ingest/fb")
@local_only
def ingest_fb_endpoint():
    data = request.get_json(force=True)
    stats = ingest.ingest_fb(data["group"], data["captured_at"], data["posts"])
    return jsonify(stats)


@app.after_request
def cors(resp):
    if request.path == "/api/ingest/fb":
        resp.headers["Access-Control-Allow-Origin"] = "https://www.facebook.com"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp


@app.route("/api/ingest/fb", methods=["OPTIONS"])
def ingest_preflight():
    return ("", 204)


@app.get("/api/admin/fb-fetch")
@local_only
def fb_fetch_status():
    return jsonify(fb_fetch.status())


@app.post("/api/admin/fb-fetch")
@local_only
def fb_fetch_start():
    """The admin starts the next batch of Facebook posts (see fb_fetch.py); it runs in the background."""
    try:
        n = int((request.get_json(silent=True) or {}).get("posts") or fb_fetch.BATCH)
    except (TypeError, ValueError):
        return jsonify({"error": "invalid_count"}), 400
    ok, why = fb_fetch.start(max(1, min(n, 1000)))
    if not ok:
        return jsonify({"error": why}), 409
    return jsonify(fb_fetch.status()), 202


def _sync_loop():
    while True:
        time.sleep(6 * 3600)
        try:
            shelter.sync()
            shelter.check_status(limit=600)  # drop animals that have left the shelter (已出所)
            shelter.fill_photos(limit=300)  # photos that only the shelter's own page has
            with db.connect() as conn:
                ages.refresh(conn)  # a cat posted as "3 months old" keeps growing
        except Exception as e:  # keep the loop alive; stale data is better than none
            print("shelter sync failed:", e)


if __name__ == "__main__":
    db.init()
    with db.connect() as conn:
        ages.refresh(conn)
    threading.Thread(target=_sync_loop, daemon=True).start()
    app.run(host="127.0.0.1", port=8765, debug=False)
