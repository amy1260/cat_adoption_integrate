"""Edit listings with a history: what changed, who changed it, and a way back.

Every change to a listing goes through apply_edit(), which writes one row to cat_edits holding the
values before and after. revert_edit() puts the old values back as a new edit, so a revert can itself
be reverted. The history is only ever shown to the admin.
"""
import hashlib
import hmac
import json
import secrets
from datetime import datetime

from ages import MONTH_DAYS, group_of

REGIONS = ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "臺中市", "彰化縣", "南投縣",
           "雲林縣", "嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣",
           "金門縣", "連江縣"]
HEALTH_TAGS = {"skin", "stomatitis", "kidney", "eye", "disability", "cold", "digestive", "heart", "diabetes",
               "dewormed", "healthy", "fiv_pos"}
TEXT_LIMITS = {"title": 80, "name": 40, "breed": 40, "breed_text": 80, "color": 40, "age_text": 40, "health_note": 240,
               "district": 40, "location_text": 200, "contact_name": 80, "contact_phone": 30, "contact_line": 60,
               "contact_other": 200, "description": 2000, "source_url": 500, "available_from": 20, "photo": 300,
               "photo_hash": 32}
# What the person who posted a listing may change (never status beyond taking it down, source or links).
OWNER_FIELDS = {"name", "title", "breed", "color", "sex", "age_now", "age_group", "neutered", "vaccinated", "fiv_felv",
                "health_tags", "health_note", "region", "district", "contact_name", "contact_phone", "contact_line",
                "contact_other", "description"}
# Photos only change through the upload endpoint, and taking a listing down or back up is DELETE / the admin's call.
ADMIN_FIELDS = OWNER_FIELDS | {"breed_text", "age_text", "location_text", "source_url", "available_from", "status"}
# Copied into the listing that is kept when two listings are merged, but only where it is still blank.
FILL_FIELDS = ["photo", "photo_hash", "contact_phone", "contact_line", "contact_other", "region", "district", "color",
               "breed", "breed_text", "health_note", "name", "source_url", "age_text", "location_text"]
COLUMNS = ADMIN_FIELDS - {"age_now"} | {"age_months", "age_months_post"}


class EditError(ValueError):
    def __init__(self, field, code="invalid"):
        super().__init__(f"{field}: {code}")
        self.field, self.code = field, code


def new_token():
    """A secret for the poster. Returns (secret to hand over once, hash to keep)."""
    secret = secrets.token_urlsafe(24)
    return secret, hash_token(secret)


def hash_token(secret):
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def token_ok(row, secret):
    stored = row["edit_token_hash"] if row is not None else None
    return bool(stored and secret and hmac.compare_digest(stored, hash_token(secret)))


def _tri(v):
    if v in (None, "", "unknown"):
        return None
    if v in (True, 1, "1", "yes"):
        return 1
    if v in (False, 0, "0", "no"):
        return 0
    raise ValueError


def elapsed_months(posted_at, now=None):
    try:
        posted = datetime.fromisoformat(posted_at)
    except (TypeError, ValueError):
        return 0
    return max(0, int(((now or datetime.now()) - posted).days / MONTH_DAYS))


def normalize(changes, allowed, posted_at=None):
    """Validate a dict of edits and turn it into database columns. Raises EditError on the first bad field."""
    out = {}
    for key, value in changes.items():
        if key not in allowed:
            raise EditError(key, "not_allowed")
        try:
            if key in TEXT_LIMITS:
                v = None if value is None else str(value).strip()
                if v and len(v) > TEXT_LIMITS[key]:
                    raise ValueError
                out[key] = v or None
            elif key in ("neutered", "vaccinated"):
                out[key] = _tri(value)
            elif key == "sex":
                if value not in ("M", "F", "U"):
                    raise ValueError
                out[key] = value
            elif key == "age_group":
                if value not in ("kitten", "adult", "senior", "unknown"):
                    raise ValueError
                out[key] = value
            elif key == "fiv_felv":
                if value not in (None, "", "neg", "pos"):
                    raise ValueError
                out[key] = value or None
            elif key == "status":
                if value not in ("open", "closed"):
                    raise ValueError
                out[key] = value
            elif key == "region":
                if value not in (None, "") and value not in REGIONS:
                    raise ValueError
                out[key] = value or None
            elif key == "health_tags":
                tags = [str(x) for x in (value or [])]
                if any(x not in HEALTH_TAGS for x in tags):
                    raise ValueError
                out[key] = json.dumps(sorted(set(tags)))
            elif key == "age_now":  # the age today; store what it was on the day of the post
                if value in (None, ""):
                    out.update(age_months=None, age_months_post=None)
                else:
                    months = int(value)
                    if not 0 <= months <= 300:
                        raise ValueError
                    out.update(age_months=months, age_months_post=max(0, months - elapsed_months(posted_at)),
                               age_group=group_of(months))
        except (TypeError, ValueError):
            raise EditError(key)
        if key == "contact_phone" and out.get(key) and not all(ch.isdigit() or ch in "-+() " for ch in out[key]):
            raise EditError(key)
    return out


def apply_edit(conn, cat_id, columns, actor, note=None):
    """Write `columns` to the listing and record the change. Returns the edit id, or None if nothing changed."""
    row = conn.execute("SELECT * FROM cats WHERE id=?", (cat_id,)).fetchone()
    if row is None:
        raise LookupError(cat_id)
    before = {k: row[k] for k in columns if row[k] != columns[k]}
    if not before:
        return None
    after = {k: columns[k] for k in before}
    sets = ", ".join(f"{k}=?" for k in after)
    conn.execute(f"UPDATE cats SET {sets} WHERE id=?", list(after.values()) + [cat_id])
    cur = conn.execute(
        "INSERT INTO cat_edits (cat_id, actor, note, before, after, created_at) VALUES (?,?,?,?,?,?)",
        (cat_id, actor, note, json.dumps(before, ensure_ascii=False), json.dumps(after, ensure_ascii=False),
         datetime.now().isoformat(timespec="seconds")))
    return cur.lastrowid


def revert_edit(conn, edit_id, note=None):
    """Put back the values an edit replaced. Returns the new edit id, or None when the listing already has them."""
    edit = conn.execute("SELECT * FROM cat_edits WHERE id=?", (edit_id,)).fetchone()
    if edit is None:
        raise LookupError(edit_id)
    if edit["reverted_by"]:
        raise EditError("edit", "already_reverted")
    before = json.loads(edit["before"])
    new_id = apply_edit(conn, edit["cat_id"], before, "admin", note or f"revert #{edit_id}")
    conn.execute("UPDATE cat_edits SET reverted_by=? WHERE id=?", (new_id or -1, edit_id))
    return new_id


def fill_blanks(conn, keep_id, drop_id):
    """When merging two listings, copy into the one that stays what only the other one knows."""
    keep = conn.execute("SELECT * FROM cats WHERE id=?", (keep_id,)).fetchone()
    drop = conn.execute("SELECT * FROM cats WHERE id=?", (drop_id,)).fetchone()
    fill = {f: drop[f] for f in FILL_FIELDS if not keep[f] and drop[f]}
    if keep["age_months_post"] is None and drop["age_months_post"] is not None:
        fill.update(age_months_post=drop["age_months_post"], age_months=drop["age_months"], age_group=drop["age_group"])
    if keep["sex"] == "U" and drop["sex"] != "U":
        fill["sex"] = drop["sex"]
    for f in ("neutered", "vaccinated", "fiv_felv"):
        if keep[f] is None and drop[f] is not None:
            fill[f] = drop[f]
    return apply_edit(conn, keep_id, fill, "admin", f"merge: filled blanks from #{drop_id}") if fill else None


def history(conn, cat_id=None, limit=200):
    where, params = ("WHERE e.cat_id=?", [cat_id]) if cat_id else ("", [])
    rows = conn.execute(
        f"SELECT e.*, c.title AS cat_title, c.name AS cat_name, c.source AS cat_source FROM cat_edits e "
        f"LEFT JOIN cats c ON c.id=e.cat_id {where} ORDER BY e.id DESC LIMIT ?", params + [limit]).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["before"], d["after"] = json.loads(r["before"]), json.loads(r["after"])
        cur = conn.execute("SELECT * FROM cats WHERE id=?", (r["cat_id"],)).fetchone()
        # True while the listing still holds exactly what this edit wrote (no later edit has changed it)
        d["is_current"] = bool(cur) and all(cur[k] == v for k, v in d["after"].items())
        out.append(d)
    return out
