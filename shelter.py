"""Sync cats from the Ministry of Agriculture shelter open data."""
import base64
import json
import re
import ssl
import sys
import time
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import requests
from requests.adapters import HTTPAdapter

import db
from parser import parse_region

API = "https://data.moa.gov.tw/Service/OpenData/TransService.aspx"
PARAMS = {"UnitId": "QcbUEzN6E6DL", "animal_kind": "貓", "$top": 20000}
LIST_URL = "https://www.pet.gov.tw/AnimalApp/AnnounceMent.aspx?PageType=Transfer"

# Shelter codes, copied from the shelter drop-down on pet.gov.tw. A code is not always part of an animal's
# number (Yilan, Kinmen, Yunlin and Tainan use plain numbers), so those are looked up by shelter name.
SHELTER_CODES = {
    "新北市政府動物保護防疫處": "AAAAG", "新北市新店區公立動物之家": "AAACG", "新北市板橋區公立動物之家": "AAADG",
    "新北市中和區公立動物之家": "AAAEG", "新北市淡水區公立動物之家": "AAAFG", "新北市瑞芳區公立動物之家": "AAAGG",
    "新北市五股區公立動物之家": "AAAHG", "新北市八里區公立動物之家": "AAAIG", "新北市三芝區公立動物之家": "AAAJG",
    "宜蘭縣流浪動物中途之家": "BAAAG", "桃園市動物保護教育園區": "CAAAG", "新竹縣動物保護教育園區": "DAAAG",
    "苗栗縣動物保護教育園區": "EAAAG", "臺中市動物之家南屯園區": "FAAAG", "臺中市動物之家后里園區": "FAABG",
    "彰化縣流浪狗中途之家臨時收容所": "GAAAG", "南投縣公立動物收容所": "HAAAG", "雲林縣流浪動物收容所": "IAAAG",
    "嘉義縣動物保護教育園區": "JAAAG", "高雄市壽山動物保護教育園區": "LAAAG", "高雄市燕巢動物保護關愛園區": "LAABG",
    "屏東縣公立犬貓中途之家": "MAAAG", "屏東縣動物之家": "MAABG", "臺東縣動物收容中心": "NAAAG", "花蓮縣狗貓躍動園區": "OAAAG",
    "澎湖縣流浪動物收容中心": "PAAAG", "基隆市寵物銀行": "QAAAG", "新竹市動物保護教育園區": "RAAAG",
    "嘉義市動物保護教育園區": "TAAAG", "臺南市動物之家灣裡站": "UAAAG", "臺南市動物之家善化站": "UAABG",
    "臺北市動物之家": "VAAAG", "連江縣動物之家": "XAAAG", "金門縣動物收容中心": "YAAAG",
}
KNOWN_CODES = set(SHELTER_CODES.values())


def detail_url(r, today=None):
    """The pet.gov.tw page of this one animal (not the search page). Animals still in their announcement period
    live under PageType=Announce, the ones open for adoption under Adopt."""
    subid = (r.get("animal_subid") or "").strip()
    code = subid[:5] if subid[:5] in KNOWN_CODES else SHELTER_CODES.get((r.get("animal_place") or "").strip())
    if not subid or not code:
        return LIST_URL
    b64 = lambda text: base64.b64encode(text.encode("utf-8")).decode()
    page = "Announce" if (r.get("animal_opendate") or "") > (today or date.today().isoformat()) else "Adopt"
    return f"https://www.pet.gov.tw/AnimalApp/AnnounceSingle.aspx?PageType={page}&AcNum={b64(subid)}&UT={b64(code)}"


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
        "source": "shelter", "source_id": str(r["animal_id"]), "source_url": detail_url(r),
        "title": f"{r.get('animal_place')} #{r.get('animal_subid')}", "name": None,
        "breed": breed, "breed_text": breed_text, "color": (r.get("animal_colour") or "").strip() or None,
        "sex": {"M": "M", "F": "F"}.get(r.get("animal_sex"), "U"),
        "age_group": {"CHILD": "kitten", "ADULT": "adult"}.get(age, "unknown"),
        "age_months": None, "age_months_post": None, "age_text": None,
        "neutered": sterilized, "vaccinated": vaccinated, "fiv_felv": None,
        "health_tags": "[]", "health_note": None,
        "region": region, "district": district,
        "location_text": (r.get("animal_foundplace") or "").strip() or None,
        "contact_name": r.get("shelter_name") or r.get("animal_place"),
        "contact_phone": (r.get("shelter_tel") or "").strip() or None,
        "contact_line": None, "contact_other": (r.get("shelter_address") or "").strip() or None,
        "description": remark or None, "photo": photo, "photo_hash": None, "chip": None,
        "shelter_no": r.get("animal_subid"), "available_from": opendate if opendate and opendate < "2999" else None,
        "posted_at": (r.get("animal_createtime") or "").replace("/", "-") or None, "extracted_by": "open-data",
    }


COLUMNS = [
    "source", "source_id", "source_url", "title", "name", "breed", "breed_text", "color", "sex", "age_group",
    "age_months", "age_months_post", "age_text", "neutered", "vaccinated", "fiv_felv", "health_tags", "health_note", "region",
    "district", "location_text", "contact_name", "contact_phone", "contact_line", "contact_other",
    "description", "photo", "photo_hash", "chip", "shelter_no", "available_from", "posted_at", "extracted_by",
]


def _insert(conn, cat, now):
    cols = COLUMNS + ["created_at"]
    new_id = conn.execute(f"INSERT INTO cats ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                          [cat[c] for c in COLUMNS] + [now]).lastrowid
    for other in conn.execute("SELECT id FROM cats WHERE source!='shelter' AND shelter_no=? AND dup_of IS NULL",
                              (cat["shelter_no"],)):  # an earlier post already advertises this shelter cat
        db.flag_for_review(conn, other["id"], new_id, "shelter_no")


def sync(raw=None, official=None):
    """Bring the shelter cats up to date. The open data is the main feed, but it lags behind pet.gov.tw: it misses
    cats the site already lists and keeps listing ones it no longer does. So when `official` (the rows of the
    site's 動物認領養 page, see official_list) is known, that list decides which cats are open: it adds the cats
    the open data lacks and takes down the ones the page does not list. Without it (the page could not be read,
    or only `raw` was given) the open data alone decides."""
    if raw is None:
        resp = requests.get(API, params=PARAMS, timeout=120)
        resp.raise_for_status()
        raw = resp.json()
        if official is None:
            try:
                official = official_list()
            except (requests.RequestException, ValueError) as e:
                print("shelter: official list unavailable, using the open data only:", e, file=sys.stderr)
    now = datetime.now().isoformat(timespec="seconds")
    seen = set()
    added = updated = 0
    extra = []                              # cats on the official page that the open data does not have
    if official is not None:
        have = {r["animal_subid"] for r in raw}
        with db.connect() as conn:
            have |= {r[0] for r in conn.execute("SELECT shelter_no FROM cats WHERE source='shelter'")}
        session = _session()
        for row in official:
            if row["AcceptNum"] not in have and row.get("ShelterName") and row.get("UserTag"):
                # (the page also lists a few damaged old records with no shelter at all; there is nobody to ask about those)
                cat = official_cat(session, row)
                if cat:
                    extra.append(cat)
    opened = closed_official = closed = 0
    with db.connect() as conn:
        for r in raw:
            cat = normalize(r)
            seen.add(cat["source_id"])
            exists = conn.execute("SELECT id, locked FROM cats WHERE source='shelter' AND source_id=?",
                                  (cat["source_id"],)).fetchone()
            if not exists:   # a cat that was first added from the official page now shows up in the open data
                exists = conn.execute("SELECT id, locked FROM cats WHERE source='shelter' AND shelter_no=? AND source_id LIKE 'o:%'",
                                      (cat["shelter_no"],)).fetchone()
                if exists:
                    conn.execute("UPDATE cats SET source_id=? WHERE id=?", (cat["source_id"], exists["id"]))
            if exists:
                locked = set(json.loads(exists["locked"] or "[]"))   # what the admin changed by hand stays
                cols = [c for c in COLUMNS[2:] if c not in locked and not (c == "photo" and not cat["photo"])]
                reopen = official is None and "status" not in locked   # with the official list, it decides below
                sets = ", ".join([f"{c}=?" for c in cols] + (["status=CASE WHEN released=1 THEN status ELSE 'open' END"] if reopen else []))
                conn.execute(f"UPDATE cats SET {sets} WHERE id=?", [cat[c] for c in cols] + [exists["id"]])
                updated += 1
            else:
                _insert(conn, cat, now)
                added += 1
        for cat in extra:
            if not conn.execute("SELECT 1 FROM cats WHERE source='shelter' AND (source_id=? OR shelter_no=?)",
                                (cat["source_id"], cat["shelter_no"])).fetchone():
                _insert(conn, cat, now)
                added += 1
        if official is not None:
            listed = {r["AcceptNum"] for r in official}
            for row in conn.execute("SELECT id, shelter_no, status, released, locked FROM cats WHERE source='shelter'").fetchall():
                if "status" in json.loads(row["locked"] or "[]"):
                    continue
                if row["shelter_no"] in listed:
                    if row["status"] != "open" or row["released"]:
                        conn.execute("UPDATE cats SET status='open', released=0 WHERE id=?", (row["id"],))
                        opened += 1
                elif row["status"] == "open":
                    conn.execute("UPDATE cats SET status='closed' WHERE id=?", (row["id"],))
                    closed_official += 1
            closed = closed_official
        elif raw:  # cats no longer in the open data have been adopted or removed
            rows = conn.execute("SELECT id, source_id FROM cats WHERE source='shelter' AND status='open'").fetchall()
            gone = [row["id"] for row in rows if row["source_id"] not in seen and not row["source_id"].startswith("o:")]
            conn.executemany("UPDATE cats SET status='closed' WHERE id=?", [(i,) for i in gone])
            closed = len(gone)
        else:
            closed = 0
    out = {"added": added, "updated": updated, "closed": closed}
    if official is not None:
        out.update(official=len(official), reopened=opened, from_official=len(extra))
    return out


class _PetGov(HTTPAdapter):
    """pet.gov.tw's certificate lacks a Subject Key Identifier, which Python's strict mode refuses. Only that
    strictness is relaxed; the certificate chain and host name are still verified."""

    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
        super().init_poolmanager(*args, ssl_context=ctx, **kwargs)


def _session():
    session = requests.Session()
    session.mount("https://", _PetGov())
    return session


ADOPT_URL = "https://www.pet.gov.tw/AnimalApp/AnnounceMent.aspx?PageType=Adopt"
MIN_OFFICIAL = 300   # fewer cats than this on the page means it was read wrongly: never take cats down because of it


def _handler(session, param):
    resp = session.post(HANDLER, data={"Method": "AnimalsFront", "Param": json.dumps(param)}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def official_list(session=None):
    """The cats on pet.gov.tw's 動物認領養 page (the animals that can be adopted today), as the page lists them."""
    body = _handler(session or _session(), {"action": "AnnounceMentData", "_FrontParam": {
        "PageSize": 5000, "PageNo": 1, "AcNum": "", "CNum": "", "Shelter": "", "aType": "1", "aBreed": "",
        "PageType": "Adopt", "PetSex": "", "HAIRCOLOR": "", "County": "", "Age": "", "County2": "", "DistrictTeam": ""}})
    if not body.get("Success"):
        raise ValueError(f"pet.gov.tw list: {body.get('ErrorMessage')}")
    rows = json.loads(body["Message"])
    if len(rows) < MIN_OFFICIAL or len({r["AcceptNum"] for r in rows}) != len(rows):
        raise ValueError(f"pet.gov.tw list looks wrong ({len(rows)} rows)")
    return rows


def _pic_url(session, pic):
    """pet.gov.tw photo of a picture id from the page (png or jpg; a wrong extension answers with a web page)."""
    for ext in ("png", "jpg"):
        url = f"https://www.pet.gov.tw/Upload/pic/{pic}.{ext}"
        try:
            r = session.get(url, timeout=30)
        except requests.RequestException:
            return None
        if r.ok and r.headers.get("content-type", "").startswith("image/"):
            return url
    return None


def official_cat(session, row):
    """A cat on the official list that the open data lacks, built from the page's own record of it. None when the
    page could not be read (it is tried again at the next sync). A record the page lists but cannot show (a few
    have damaged numbers) is kept with what the list says, linking to the list."""
    no, place = row["AcceptNum"], (row.get("ShelterName") or "").strip()
    info = None
    try:
        body = _handler(session, {"action": "AnnounceMentDataDetail", "_FrontParam": {
            "AcNum": no, "Shelter": row["UserTag"], "MenuID": 2, "PageType": "Adopt"}})
    except (requests.RequestException, ValueError):
        return None
    if body.get("Success"):
        info = json.loads(body["Message"])[0]
    elif body.get("ErrorMessage") != NO_RECORD:
        return None
    d = info or {}
    address = (d.get("收容所地址") or "").strip()
    region, district = parse_region(address or place)
    if not region:
        region, district = parse_region(place)
    breed, breed_text = _breed(d.get("品種/物種") or row.get("breedName"))
    age = d.get("年齡") or ""
    opened = (d.get("開放日期") or "").replace("/", "-")
    pic = d.get("img1") or row.get("pic")
    link = detail_url({"animal_subid": no, "animal_place": place, "animal_opendate": ""}) if info else ADOPT_URL
    return {
        "source": "shelter", "source_id": f"o:{no}", "source_url": ADOPT_URL if link == LIST_URL else link,
        "title": f"{place} #{no}", "name": (d.get("動物名") or d.get("AnimalName") or "").strip() or None,
        "breed": breed, "breed_text": breed_text, "color": (d.get("毛色") or "").strip() or None,
        "sex": {"公": "M", "母": "F"}.get(d.get("動物性別") or row.get("sexName"), "U"),
        "age_group": "kitten" if re.search("未離乳|幼", age) else "adult" if "成年" in age else "senior" if "老" in age else "unknown",
        "age_months": None, "age_months_post": None, "age_text": None,
        "neutered": {"是": 1, "否": 0}.get(d.get("是否絕育")), "vaccinated": None, "fiv_felv": None,
        "health_tags": "[]", "health_note": None, "region": region, "district": district,
        "location_text": (d.get("捕獲地址") or row.get("areaName") or "").strip() or None,
        "contact_name": place, "contact_phone": (d.get("收容所電話") or "").strip() or None,
        "contact_line": None, "contact_other": address or None,
        "description": (d.get("描述") or "").strip() or None,
        "photo": _pic_url(session, pic) if pic else None, "photo_hash": None, "chip": (d.get("晶片號碼") or "").strip() or None,
        "shelter_no": no, "available_from": opened if opened and opened < "2999" else None,
        "posted_at": (d.get("入所日期") or "").replace("/", "-") or date.today().isoformat(), "extracted_by": "open-data",
    }


def page_photo(session, url):
    """The photo the shelter's own page shows for one animal, or None when the page only has the placeholder."""
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    m = re.search(r'og:image"\s+content="([^"]*)"', resp.text)
    img = m.group(1).strip() if m else ""
    return img if "/Upload/" in img else None


HANDLER = "https://www.pet.gov.tw/handler/AnimalsCore.ashx"
NO_RECORD = "查無資料"


def page_state(session, url):
    """What the shelter's own page says about one animal: (是否開放認領養, left_shelter). The open data keeps
    listing animals long after they left, so this is the only reliable place. ("查無資料", False) when the
    official system has no record of it under either page type (the link is dead); None on any other failure."""
    q = parse_qs(urlparse(url).query)
    unb64 = lambda v: base64.b64decode(v + "=" * (-len(v) % 4)).decode("utf-8")
    body = None
    for page in dict.fromkeys([q["PageType"][0], "Adopt", "Announce"]):
        param = {"action": "AnnounceMentDataDetail", "_FrontParam": {
            "AcNum": unb64(q["AcNum"][0]), "Shelter": unb64(q["UT"][0]), "MenuID": 1 if page == "Announce" else 2, "PageType": page}}
        resp = session.post(HANDLER, data={"Method": "AnimalsFront", "Param": json.dumps(param)}, timeout=30)
        resp.raise_for_status()
        body = resp.json()
        if body.get("Success"):
            break
    if not body.get("Success"):
        return (NO_RECORD, False) if body.get("ErrorMessage") == NO_RECORD else None
    info = json.loads(body["Message"])[0]
    final = info.get("FinalDate")
    left = bool(final and not final.startswith("1900")) or "已出所" in (info.get("是否開放認領養") or "")
    return (info.get("是否開放認領養") or "").strip(), left


def check_status(limit=None, pause=0.25):
    """Take animals that have left the shelter (已出所) off the site. Animals that are still there are looked at
    again after a few days; ones that left are never asked about again. An animal the admin has put back
    by hand (status is locked) is left alone."""
    now = datetime.now()
    session = _session()
    try:
        listed = {r["AcceptNum"] for r in official_list(session)}   # the page still lists these: they have not left
    except (requests.RequestException, ValueError):
        listed = set()
    with db.connect() as conn:
        due = [r for r in conn.execute(
            "SELECT id, source_url, locked, shelter_state, shelter_no FROM cats WHERE source='shelter' AND released=0 AND status='open' "
            "AND source_url LIKE '%AnnounceSingle%' AND (state_checked_at IS NULL OR state_checked_at < ?) "
            "ORDER BY photo IS NOT NULL, state_checked_at IS NOT NULL, state_checked_at, id",
            ((now - timedelta(days=2)).isoformat(),)) if r["shelter_no"] not in listed][:limit or None]
        released = failed = 0
        for row in due:
            try:
                state = page_state(session, row["source_url"])
            except (requests.RequestException, ValueError, KeyError):
                failed += 1
                continue
            stamp = datetime.now().isoformat(timespec="seconds")
            # No record at all is believed on the second sighting, so one odd answer cannot take a cat off the site.
            gone = state is not None and (state[1] or (state[0] == NO_RECORD and row["shelter_state"] == NO_RECORD))
            if gone and "status" not in json.loads(row["locked"] or "[]"):
                conn.execute("UPDATE cats SET shelter_state=?, state_checked_at=?, released=1, status='closed' WHERE id=?",
                             (state[0], stamp, row["id"]))
                released += 1
            else:
                conn.execute("UPDATE cats SET shelter_state=COALESCE(?, shelter_state), state_checked_at=? WHERE id=?",
                             (state[0] if state else None, stamp, row["id"]))
            conn.commit()
            time.sleep(pause)
    return {"checked": len(due) - failed, "released": released, "failed": failed}


def fill_photos(limit=None, pause=0.3):
    """Many cats have no photo in the open data but do on pet.gov.tw. Look on each one's page, a few at a time:
    newly announced cats are looked at again after a day (photos often arrive late), older ones after a week."""
    now = datetime.now()
    session = _session()
    with db.connect() as conn:
        due = conn.execute(
            "SELECT id, source_url, locked FROM cats WHERE source='shelter' AND status='open' AND photo IS NULL "
            "AND source_url LIKE '%AnnounceSingle%' AND (photo_checked_at IS NULL OR photo_checked_at < "
            "CASE WHEN created_at > ? THEN ? ELSE ? END) ORDER BY photo_checked_at IS NOT NULL, id LIMIT ?",
            ((now - timedelta(days=14)).isoformat(), (now - timedelta(days=1)).isoformat(),
             (now - timedelta(days=7)).isoformat(), limit or -1)).fetchall()
        found = failed = 0
        for row in due:
            if "photo" in json.loads(row["locked"] or "[]"):
                continue
            try:
                photo = page_photo(session, row["source_url"])
            except requests.RequestException:
                failed += 1
                continue
            conn.execute("UPDATE cats SET photo=COALESCE(?, photo), photo_checked_at=? WHERE id=?",
                         (photo, datetime.now().isoformat(timespec="seconds"), row["id"]))
            conn.commit()
            found += bool(photo)
            time.sleep(pause)
    return {"checked": len(due) - failed, "found": found, "failed": failed}


if __name__ == "__main__":
    db.init()
    print(json.dumps(sync(), ensure_ascii=False))
    if "--status" in sys.argv:
        print(json.dumps(check_status(), ensure_ascii=False))
    if "--photos" in sys.argv:
        print(json.dumps(fill_photos(), ensure_ascii=False))
