"""Duplicate detection so the same cat is never listed twice (across sources and uploads)."""
import re

TEXT_SIM_SAME_CONTACT = 0.70
TEXT_SIM_ANY = 0.88
TEXT_SIM_PROFILE = 0.35
PHOTO_HAMMING = 6


def _norm(s):
    return re.sub(r"[\s\W_]+", "", (s or "").lower())


def bigrams(s):
    s = _norm(s)
    return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) > 1 else set()


def text_similarity(a, b):
    x, y = bigrams(a), bigrams(b)
    if not x or not y:
        return 0.0
    return len(x & y) / len(x | y)


def hamming(h1, h2):
    return bin(int(h1, 16) ^ int(h2, 16)).count("1")


def _digits(s):
    return re.sub(r"\D", "", s or "")


def _same_contact(a, b):
    pa, pb = _digits(a.get("contact_phone")), _digits(b["contact_phone"])
    if pa and pb and pa == pb:
        return True
    la, lb = (a.get("contact_line") or "").lower(), (b["contact_line"] or "").lower()
    return bool(la and lb and la == lb)


def find_duplicate(conn, cat):
    """Return (existing_row, reason, kind) when `cat` may already be listed, else (None, None, None).

    kind is "hard" for a repeat within the same source (blocked outright) and "review" when a
    different source lists what looks like the same cat (kept aside for a human to confirm).
    """
    row, reason = _match(conn, cat)
    if not row:
        return None, None, None
    return row, reason, "hard" if row["source"] == cat["source"] else "review"


def _match(conn, cat):
    if cat.get("source_url"):
        row = conn.execute("SELECT * FROM cats WHERE source_url=? AND dup_of IS NULL", (cat["source_url"],)).fetchone()
        if row:
            return row, "same_url"
    for col in ("chip", "shelter_no"):
        if cat.get(col):
            row = conn.execute(f"SELECT * FROM cats WHERE {col}=? AND dup_of IS NULL", (cat[col],)).fetchone()
            if row:
                return row, col
    candidates = conn.execute(
        "SELECT * FROM cats WHERE dup_of IS NULL AND status='open' AND source!='shelter'").fetchall()
    if cat.get("photo_hash"):
        for row in candidates:
            # Two posts of one Facebook group often share a banner or album cover, so the photo only
            # counts across different sources, or for visitor uploads where the photo is the cat itself.
            strong = row["source"] != cat["source"] or cat["source"] == "user"
            if strong and row["photo_hash"] and hamming(row["photo_hash"], cat["photo_hash"]) <= PHOTO_HAMMING:
                return row, "same_photo"
    for row in candidates:
        sim = text_similarity(row["description"], cat.get("description"))
        if sim >= TEXT_SIM_ANY:
            return row, "same_text"
        if _same_contact(cat, row):
            if sim >= TEXT_SIM_SAME_CONTACT:
                return row, "same_contact_text"
            same_profile = (
                cat.get("sex") == row["sex"] and cat.get("sex") != "U"
                and cat.get("age_group") == row["age_group"] and cat.get("age_group") != "unknown"
                and cat.get("region") == row["region"]
                and cat.get("color") and cat.get("color") == row["color"]
            )
            if same_profile and sim >= TEXT_SIM_PROFILE:
                return row, "same_profile"
    return None, None
