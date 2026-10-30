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
    age_months INTEGER,
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
    UNIQUE (cat_id, other_id)
);
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
        if "review" not in cols:  # databases created before the review queue existed
            conn.execute("ALTER TABLE cats ADD COLUMN review TEXT")


def flag_for_review(conn, cat_id, other_id, reason):
    """Hold `cat_id` back and queue it for a human to compare with `other_id`."""
    from datetime import datetime
    conn.execute("UPDATE cats SET review='pending' WHERE id=?", (cat_id,))
    conn.execute(
        "INSERT OR IGNORE INTO dup_candidates (cat_id, other_id, reason, created_at) VALUES (?,?,?,?)",
        (cat_id, other_id, reason, datetime.now().isoformat(timespec="seconds")))
