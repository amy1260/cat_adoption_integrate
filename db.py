import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "data" / "catadopt.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS cats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,            -- shelter | fb_crazycat | fb_catparadise | user
    source_id TEXT,
    source_url TEXT,
    title TEXT,
    name TEXT,
    breed TEXT,                      -- canonical key, e.g. mixed / ragdoll
    breed_text TEXT,                 -- original wording
    color TEXT,
    sex TEXT,                        -- M | F | U
    age_group TEXT,                  -- kitten | adult | senior | unknown
    age_months INTEGER,              -- age today (kept current by ages.refresh)
    age_months_post INTEGER,         -- age stated in the post, on the day it was posted
    age_text TEXT,
    neutered INTEGER,
    vaccinated INTEGER,
    fiv_felv TEXT,                   -- neg | pos
    health_tags TEXT,                -- JSON list
    health_note TEXT,
    region TEXT,
    district TEXT,
    location_text TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    contact_line TEXT,
    contact_other TEXT,
    description TEXT,
    photo TEXT,
    photo_hash TEXT,
    chip TEXT,
    shelter_no TEXT,
    available_from TEXT,
    posted_at TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',   -- open | closed
    dup_of INTEGER,
    review TEXT,                     -- NULL | pending | cleared | merged
    extracted_by TEXT,               -- rules | llm | user | open-data: where the fields came from
    edit_token_hash TEXT,            -- sha256 of the poster's secret; the secret itself is never stored
    locked TEXT,                     -- JSON list of fields the admin changed by hand; the shelter sync leaves them alone
    photo_checked_at TEXT,           -- last time the shelter's own page was searched for a photo
    shelter_state TEXT,              -- 是否開放認領養 as the shelter's own page shows it (e.g. 適合認養, ※已出所)
    state_checked_at TEXT,
    released INTEGER NOT NULL DEFAULT 0,   -- 1: the animal has left the shelter, so it is no longer listed
    UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_cats_region ON cats(region);
CREATE INDEX IF NOT EXISTS idx_cats_status ON cats(status, dup_of);
CREATE INDEX IF NOT EXISTS idx_cats_chip ON cats(chip);
CREATE INDEX IF NOT EXISTS idx_cats_shelter_no ON cats(shelter_no);
CREATE INDEX IF NOT EXISTS idx_cats_dup_of ON cats(dup_of);

-- Same cat possibly listed by two different sources; a human decides.
CREATE TABLE IF NOT EXISTS dup_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cat_id INTEGER NOT NULL,         -- the newer listing, held back until reviewed
    other_id INTEGER NOT NULL,       -- the listing it may duplicate
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decision TEXT,                   -- NULL (pending) | same | different
    decided_at TEXT,
    kept TEXT,                       -- new | existing: which listing stays when they are the same cat
    fill_edit INTEGER,               -- the edit that copied blanks into the kept listing (undone with the merge)
    UNIQUE (cat_id, other_id)
);

-- Every change to a listing: before and after, so it can be put back. Only the admin sees this.
CREATE TABLE IF NOT EXISTS cat_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cat_id INTEGER NOT NULL,
    actor TEXT NOT NULL,             -- admin | owner
    note TEXT,
    before TEXT NOT NULL,            -- JSON of the replaced values
    after TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reverted_by INTEGER              -- the edit that undid this one (-1: undone, nothing left to change)
);
CREATE INDEX IF NOT EXISTS idx_cat_edits_cat ON cat_edits(cat_id);

-- Every Facebook post a batch has taken (not only the cat listings), so the next batch, which starts at the
-- last one's posting time, never imports the same post twice.
CREATE TABLE IF NOT EXISTS fb_posts_seen (
    url TEXT PRIMARY KEY,
    time TEXT NOT NULL               -- ISO time of the post, UTC
);
CREATE INDEX IF NOT EXISTS idx_fb_posts_seen_time ON fb_posts_seen(time);

-- One row per Apify run started by fb_fetch.py: the window it asked for, what it returned and what it cost.
CREATE TABLE IF NOT EXISTS apify_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    kind TEXT NOT NULL,              -- batch (latest | backfill: the earlier daily job)
    run_id TEXT,
    status TEXT,
    posts INTEGER,
    cost_usd REAL,
    note TEXT
);

-- Small settings and progress markers, e.g. fb_checkpoint: where the next Facebook batch starts (fb_fetch.py).
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Answers the language model already gave, so a re-run never pays for the same post twice.
CREATE TABLE IF NOT EXISTS llm_cache (
    key TEXT PRIMARY KEY,            -- sha1 of model + prompt version + post text
    result TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Problems and suggestions sent by visitors from a cat's detail page.
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cat_id INTEGER NOT NULL,
    kind TEXT NOT NULL,              -- wrong_info | adopted | duplicate | inappropriate | suggestion | other
    message TEXT,
    contact TEXT,                    -- optional way to reach the reporter
    reporter TEXT,                   -- hashed address, only for spotting abuse
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',   -- open | resolved | dismissed
    handled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
"""

# Visible to the public: not merged into another listing and not awaiting review.
PUBLIC = "status='open' AND dup_of IS NULL AND (review IS NULL OR review='cleared')"


def connect():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init():
    with connect() as conn:
        conn.executescript(SCHEMA)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(cats)")}
        for col, ddl in (("review", "TEXT"), ("age_months_post", "INTEGER"), ("extracted_by", "TEXT"), ("edit_token_hash", "TEXT"),
                         ("locked", "TEXT"), ("photo_checked_at", "TEXT"), ("shelter_state", "TEXT"),
                         ("state_checked_at", "TEXT"), ("released", "INTEGER NOT NULL DEFAULT 0")):
            if col not in cols:  # databases created before this column existed
                conn.execute(f"ALTER TABLE cats ADD COLUMN {col} {ddl}")
        dcols = {r["name"] for r in conn.execute("PRAGMA table_info(dup_candidates)")}
        for col, ddl in (("kept", "TEXT"), ("fill_edit", "INTEGER")):
            if col not in dcols:
                conn.execute(f"ALTER TABLE dup_candidates ADD COLUMN {col} {ddl}")
        # Until now age_months held the age stated in the post; keep that as the starting point.
        conn.execute("UPDATE cats SET age_months_post=age_months WHERE age_months_post IS NULL AND age_months IS NOT NULL")
        conn.execute("UPDATE cats SET extracted_by='rules' WHERE extracted_by IS NULL AND source LIKE 'fb_%'")


def flag_for_review(conn, cat_id, other_id, reason):
    """Hold `cat_id` back and queue it for a human to compare with `other_id`."""
    from datetime import datetime
    conn.execute("UPDATE cats SET review='pending' WHERE id=?", (cat_id,))
    conn.execute(
        "INSERT OR IGNORE INTO dup_candidates (cat_id, other_id, reason, created_at) VALUES (?,?,?,?)",
        (cat_id, other_id, reason, datetime.now().isoformat(timespec="seconds")))
