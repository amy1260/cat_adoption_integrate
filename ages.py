"""A cat's age as stated in a post is its age on the day of the post; show how old it is now."""
from datetime import datetime

MONTH_DAYS = 30.4375


def group_of(months):
    if months is None:
        return "unknown"
    if months < 12:
        return "kitten"
    if months >= 84:
        return "senior"
    return "adult"


def months_now(age_months_post, posted_at, now=None):
    """Age in months today, from the age stated in the post and when it was posted."""
    if age_months_post is None:
        return None
    if not posted_at:
        return age_months_post
    try:
        posted = datetime.fromisoformat(posted_at)
    except ValueError:
        return age_months_post
    elapsed = max(0, int(((now or datetime.now()) - posted).days / MONTH_DAYS))
    return age_months_post + elapsed


def refresh(conn, now=None):
    """Bring every listing's current age (age_months) and age group up to date. Returns rows changed."""
    rows = conn.execute(
        "SELECT id, age_months_post, posted_at, age_months, age_group FROM cats WHERE age_months_post IS NOT NULL"
    ).fetchall()
    changed = 0
    for r in rows:
        m = months_now(r["age_months_post"], r["posted_at"], now)
        g = group_of(m)
        if m != r["age_months"] or g != r["age_group"]:
            conn.execute("UPDATE cats SET age_months=?, age_group=? WHERE id=?", (m, g, r["id"]))
            changed += 1
    return changed
