"""Sync cats from the Ministry of Agriculture shelter open data."""
import json
import re
from datetime import datetime

import requests

import db
from parser import parse_region

API = "https://data.moa.gov.tw/Service/OpenData/TransService.aspx"
PARAMS = {"UnitId": "QcbUEzN6E6DL", "animal_kind": "貓", "$top": 20000}
LIST_URL = "https://www.pet.gov.tw/AnimalApp/AnnounceMent.aspx?PageType=Transfer"

BREED_MAP = [
    ("ragdoll", "布偶"), ("british_shorthair", "英國短毛|英短"), ("american_shorthair", "美國短毛|美短"),
    ("scottish_fold", "蘇格蘭|摺耳"), ("persian", "波斯"), ("siamese", "暹羅"), ("maine_coon", "緬因"),
    ("bengal", "孟加拉"), ("russian_blue", "俄羅斯藍"), ("munchkin", "曼赤肯"),
    ("exotic_shorthair", "異國短毛"), ("norwegian_forest", "挪威"), ("mixed", "混種"),
]


def _breed(variety):
    v = (variety or "").strip()
    for key, pat in BREED_MAP:
        if re.search(pat, v):
            return key, v
    return None, v or None


def _flag(v):
    return {"T": 1, "F": 0}.get(v)


def normalize(r):
    region, district = parse_region(r.get("shelter_address") or r.get("animal_place") or "")
    if not region:
        region, district = parse_region(r.get("animal_place") or "")
    breed, breed_text = _breed(r.get("animal_Variety"))
    age = r.get("animal_age")
    photo = (r.get("album_file") or "").strip() or None
    opendate = r.get("animal_opendate")
    remark = (r.get("animal_remark") or "").strip()
    sterilized = _flag(r.get("animal_sterilization"))
    vaccinated = _flag(r.get("animal_bacterin"))
    return {
        "source": "shelter", "source_id": str(r["animal_id"]), "source_url": LIST_URL,
        "title": f"{r.get('animal_place')} #{r.get('animal_subid')}", "name": None,
        "breed": breed, "breed_text": breed_text, "color": (r.get("animal_colour") or "").strip() or None,
        "sex": {"M": "M", "F": "F"}.get(r.get("animal_sex"), "U"),
        "age_group": {"CHILD": "kitten", "ADULT": "adult"}.get(age, "unknown"),
        "age_months": None, "age_text": None,
        "neutered": sterilized, "vaccinated": vaccinated, "fiv_felv": None,
        "health_tags": "[]", "health_note": None,
        "region": region, "district": district,
        "location_text": (r.get("animal_foundplace") or "").strip() or None,
        "contact_name": r.get("shelter_name") or r.get("animal_place"),
        "contact_phone": (r.get("shelter_tel") or "").strip() or None,
        "contact_line": None, "contact_other": (r.get("shelter_address") or "").strip() or None,
        "description": remark or None, "photo": photo, "photo_hash": None, "chip": None,
        "shelter_no": r.get("animal_subid"), "available_from": opendate if opendate and opendate < "2999" else None,
        "posted_at": (r.get("animal_createtime") or "").replace("/", "-") or None,
    }


COLUMNS = [
    "source", "source_id", "source_url", "title", "name", "breed", "breed_text", "color", "sex", "age_group",
    "age_months", "age_text", "neutered", "vaccinated", "fiv_felv", "health_tags", "health_note", "region",
    "district", "location_text", "contact_name", "contact_phone", "contact_line", "contact_other",
    "description", "photo", "photo_hash", "chip", "shelter_no", "available_from", "posted_at",
]


def sync(raw=None):
    if raw is None:
        resp = requests.get(API, params=PARAMS, timeout=120)
        resp.raise_for_status()
        raw = resp.json()
    now = datetime.now().isoformat(timespec="seconds")
    seen = set()
    added = updated = 0
    with db.connect() as conn:
        for r in raw:
            cat = normalize(r)
            seen.add(cat["source_id"])
            exists = conn.execute("SELECT id FROM cats WHERE source='shelter' AND source_id=?",
                                  (cat["source_id"],)).fetchone()
            if exists:
                sets = ", ".join(f"{c}=?" for c in COLUMNS[2:]) + ", status='open'"
                conn.execute(f"UPDATE cats SET {sets} WHERE id=?", [cat[c] for c in COLUMNS[2:]] + [exists["id"]])
                updated += 1
            else:
                cols = COLUMNS + ["created_at"]
                new_id = conn.execute(
                    f"INSERT INTO cats ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                    [cat[c] for c in COLUMNS] + [now]).lastrowid
                added += 1
                for other in conn.execute(
                        "SELECT id FROM cats WHERE source!='shelter' AND shelter_no=? AND dup_of IS NULL",
                        (cat["shelter_no"],)):  # an earlier post already advertises this shelter cat
                    db.flag_for_review(conn, other["id"], new_id, "shelter_no")
        if raw:  # cats no longer in the open data have been adopted or removed
            rows = conn.execute("SELECT id, source_id FROM cats WHERE source='shelter' AND status='open'").fetchall()
            gone = [row["id"] for row in rows if row["source_id"] not in seen]
            conn.executemany("UPDATE cats SET status='closed' WHERE id=?", [(i,) for i in gone])
        else:
            gone = []
    return {"added": added, "updated": updated, "closed": len(gone)}


if __name__ == "__main__":
    db.init()
    print(json.dumps(sync(), ensure_ascii=False))
