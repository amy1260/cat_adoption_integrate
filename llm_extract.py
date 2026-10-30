"""Read a cat's details out of a free-text adoption post with Claude.

The rule-based parser in parser.py is fast but guesses wrong on loose wording ("7個月前，救了黑豆"
is not the cat's age; "混暹羅" is not a Siamese). This asks Claude for the same fields as strict JSON.
The post's own wording always stays in `description`; only the filterable fields come from here.

Needs credentials the Anthropic SDK can find (ANTHROPIC_API_KEY, or `ant auth login`). ingest.py uses it
only with --llm; otherwise it keeps the rule-based fields.

Back-fill the listings already in the database (asks before spending anything):

    python llm_extract.py --backfill
    python llm_extract.py --backfill --model claude-haiku-5-5     # about 40x cheaper, a bit less careful
"""
import argparse
import hashlib
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import db
from ages import group_of, refresh

MODEL = os.environ.get("CATADOPT_LLM_MODEL", "claude-opus-5-5")
PROMPT_VERSION = "v1"  # bump when SYSTEM or SCHEMA change so cached answers are not reused
PRICES = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.1, 0.5)}  # $/1M tokens

REGIONS = ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "臺中市", "彰化縣", "南投縣",
           "雲林縣", "嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣",
           "金門縣", "連江縣"]
BREEDS = ["mixed", "ragdoll", "british_shorthair", "american_shorthair", "scottish_fold", "persian", "siamese",
          "maine_coon", "bengal", "russian_blue", "munchkin", "exotic_shorthair", "norwegian_forest", "sphynx",
          "birman", "abyssinian", "chinchilla"]
HEALTH_TAGS = ["skin", "stomatitis", "kidney", "eye", "disability", "cold", "digestive", "heart", "diabetes",
               "dewormed", "healthy", "fiv_pos"]

SYSTEM = """You read Traditional Chinese posts from a Taiwanese cat-adoption Facebook group and extract facts about the cat being offered. Answer with the JSON the schema asks for.

Rules:
- Use only what the post states. If something is not stated, use null (or "unknown" for enums). Never guess from the photo captions or the comments.
- is_listing is true only when the post offers one or more specific cats for adoption now. It is false for: rescue or medical-help requests, lost or found cats, someone who wants to adopt, adoption events with no specific cat, complaints about a person, posts about dogs or other animals, posts saying the cat is already adopted, and empty reposts.
- age_months_at_post is the cat's age in months on the day of the post. 半歲=6, 1歲半=18, 快1歲=11, 兩個月=2, 約2-3個月=2, 3週=1. Ignore adopter requirements ("年滿25歲"), the age of a mother cat or another animal, and time references such as "7個月前，救了牠". If only a stage is given (幼貓, 成貓, 老貓) leave the months null and set age_group.
- sex: M for 公/男生/弟弟/♂, F for 母/女生/妹妹/♀, U when not stated or when the post offers cats of both sexes.
- breed: the key of a pedigree breed only when the post names one; an ordinary domestic cat (米克斯, 土貓, 家貓, or just a coat pattern) is "mixed", and a cross such as 混暹羅 is "mixed" with the detail in breed_text. Use "unknown" when the post gives no basis.
- color: the coat in short Traditional Chinese (橘貓, 橘白, 三花, 玳瑁, 賓士, 乳牛, 虎斑, 狸花, 黑貓, 白貓, 銀漸層...), or null.
- neutered and vaccinated: "yes" only when the post says it is done, "no" when it says it is not done yet, otherwise "unknown". fiv_felv: "neg" or "pos" from the 愛滋/白血 test result.
- health_note: one short Traditional Chinese phrase (at most 80 characters) about health problems, or null.
- region and district: where the cat is, as the official county or city name; "unknown" if the post does not say.
- If several cats are offered, describe the first or main one, set cat_count, and use unknown where the cats differ."""

_NULLABLE_STR = {"anyOf": [{"type": "string"}, {"type": "null"}]}
_NULLABLE_INT = {"anyOf": [{"type": "integer"}, {"type": "null"}]}
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["is_listing", "cat_count", "name", "sex", "age_months_at_post", "age_group", "age_text", "breed",
                 "breed_text", "color", "neutered", "vaccinated", "fiv_felv", "health_tags", "health_note",
                 "region", "district", "contact_phone", "contact_line"],
    "properties": {
        "is_listing": {"type": "boolean"},
        "cat_count": {"type": "integer"},
        "name": _NULLABLE_STR,
        "sex": {"type": "string", "enum": ["M", "F", "U"]},
        "age_months_at_post": _NULLABLE_INT,
        "age_group": {"type": "string", "enum": ["kitten", "adult", "senior", "unknown"]},
        "age_text": _NULLABLE_STR,
        "breed": {"type": "string", "enum": BREEDS + ["unknown"]},
        "breed_text": _NULLABLE_STR,
        "color": _NULLABLE_STR,
        "neutered": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "vaccinated": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "fiv_felv": {"type": "string", "enum": ["neg", "pos", "unknown"]},
        "health_tags": {"type": "array", "items": {"type": "string", "enum": HEALTH_TAGS}},
        "health_note": _NULLABLE_STR,
        "region": {"type": "string", "enum": REGIONS + ["unknown"]},
        "district": _NULLABLE_STR,
        "contact_phone": _NULLABLE_STR,
        "contact_line": _NULLABLE_STR,
    },
}


def has_credentials():
    """True when the Anthropic SDK can find a key or login."""
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                or (Path.home() / ".config" / "anthropic").exists())


def enabled():
    """ingest.py reads posts with Claude only when asked (python ingest.py --llm, or CATADOPT_LLM=1):
    a key sitting in the environment for other reasons must not start billing by itself."""
    return os.environ.get("CATADOPT_LLM") == "1" and has_credentials()


def _key(text, posted_at, model):
    raw = f"{model}|{PROMPT_VERSION}|{(posted_at or '')[:10]}|{text}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def extract(client, text, posted_at, model=None):
    """One post -> the extracted dict, or None when the model declined or answered unusably."""
    when = (posted_at or "unknown").replace("T", " ")
    response = client.messages.create(
        model=model or MODEL,
        max_tokens=4000,
        system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": f"Posted at (Taiwan time): {when}\n\nPost:\n<<<\n{text}\n>>>"}],
    )
    if response.stop_reason != "end_turn":  # refusal, or cut off at max_tokens
        return None
    body = next((b.text for b in response.content if b.type == "text"), None)
    try:
        return json.loads(body) if body else None
    except json.JSONDecodeError:
        return None


def estimate_cost(n, model):
    price_in, price_out = PRICES.get(model, PRICES["claude-opus-5-5"])
    return n * (1900 * price_in + 350 * price_out) / 1_000_000


def extract_many(items, model=None, client=None, workers=4, say=print):
    """items: [(text, posted_at)] -> [dict | None], same order. Answers already paid for come from the cache."""
    model = model or MODEL
    keys = [_key(t, p, model) for t, p in items]
    results = [None] * len(items)
    with db.connect() as conn:
        cached = {r["key"]: r["result"] for r in conn.execute(
            f"SELECT key, result FROM llm_cache WHERE key IN ({','.join('?' * len(keys))})", keys)} if keys else {}
    todo = []
    for i, k in enumerate(keys):
        if k in cached:
            results[i] = json.loads(cached[k])
        else:
            todo.append(i)
    if todo:
        if client is None:
            import anthropic
            client = anthropic.Anthropic()
        say(f"asking {model} about {len(todo)} posts ({len(items) - len(todo)} answered from cache)...")

        def work(i):
            try:
                return i, extract(client, items[i][0], items[i][1], model)
            except Exception as e:  # one bad post must not lose the others
                say(f"  post {i}: {type(e).__name__}: {str(e)[:120]}")
                return i, None

        with ThreadPoolExecutor(max_workers=workers) as pool:
            for n, (i, ex) in enumerate(pool.map(work, todo), 1):
                results[i] = ex
                if ex is not None:
                    with db.connect() as conn:
                        conn.execute("INSERT OR REPLACE INTO llm_cache (key, result, created_at) VALUES (?,?,?)",
                                     (keys[i], json.dumps(ex, ensure_ascii=False), datetime.now().isoformat(timespec="seconds")))
                if n % 25 == 0:
                    say(f"  {n}/{len(todo)}")
    return results


def _tri(v):
    return {"yes": 1, "no": 0}.get(v)


def apply(cat, ex):
    """Overlay the model's reading on a rule-parsed listing. Returns (cat, None) or (None, reason to skip)."""
    if not ex["is_listing"]:
        return None, "llm_not_listing"
    cat["sex"] = ex["sex"]
    months = ex["age_months_at_post"]
    if months is not None and 0 <= months <= 300:
        cat["age_months_post"] = cat["age_months"] = months
        cat["age_group"] = group_of(months)
    else:  # a stage word only, or nothing: the group is all we know and it cannot be advanced with time
        cat["age_months_post"] = cat["age_months"] = None
        cat["age_group"] = ex["age_group"]
    cat["age_text"] = ex["age_text"] or cat.get("age_text")
    cat["breed"] = None if ex["breed"] == "unknown" else ex["breed"]
    cat["breed_text"] = ex["breed_text"]
    cat["color"] = ex["color"]
    cat["neutered"] = _tri(ex["neutered"])
    cat["vaccinated"] = _tri(ex["vaccinated"])
    cat["fiv_felv"] = None if ex["fiv_felv"] == "unknown" else ex["fiv_felv"]
    tags = list(ex["health_tags"])
    if cat["fiv_felv"] == "pos" and "fiv_pos" not in tags:
        tags.append("fiv_pos")
    cat["health_tags"] = json.dumps(sorted(set(tags)))
    cat["health_note"] = ex["health_note"]
    if ex["region"] != "unknown":  # when the model finds no place, keep what the rules found
        cat["region"], cat["district"] = ex["region"], ex["district"] or cat.get("district")
    cat["name"] = ex["name"]
    cat["contact_phone"] = cat.get("contact_phone") or ex["contact_phone"]
    cat["contact_line"] = cat.get("contact_line") or ex["contact_line"]
    cat["extracted_by"] = "llm"
    return cat, None


UPDATE_FIELDS = ["sex", "age_months", "age_months_post", "age_group", "age_text", "breed", "breed_text", "color",
                 "neutered", "vaccinated", "fiv_felv", "health_tags", "health_note", "region", "district", "name",
                 "contact_phone", "contact_line", "extracted_by"]


def backfill(model=None, limit=None, force=False, assume_yes=False, dry_run=False):
    model = model or MODEL
    with db.connect() as conn:
        where = "source LIKE 'fb_%' AND status='open'" + ("" if force else " AND COALESCE(extracted_by,'rules')!='llm'")
        rows = conn.execute(f"SELECT * FROM cats WHERE {where} ORDER BY posted_at DESC" + (f" LIMIT {int(limit)}" if limit else "")).fetchall()
        paid = {r["key"] for r in conn.execute("SELECT key FROM llm_cache")}
    if not rows:
        print("Nothing to do: every Facebook listing was already read by the model.")
        return
    fresh = sum(1 for r in rows if _key(r["description"] or "", r["posted_at"], model) not in paid)
    print(f"{len(rows)} listings; {fresh} not yet asked. Model {model}: about ${estimate_cost(fresh, model):.2f} "
          f"(rough: ~1,900 tokens in and ~350 out per post).")
    if fresh and not assume_yes and input("Go ahead? [y/N] ").strip().lower() != "y":
        print("Cancelled; nothing was spent.")
        return
    results = extract_many([(r["description"] or "", r["posted_at"]) for r in rows], model)
    changed = closed = failed = 0
    with db.connect() as conn:
        for r, ex in zip(rows, results):
            if ex is None:
                failed += 1
                continue
            cat = dict(r)
            new, reason = apply(cat, ex)
            if new is None:
                closed += 1
                if not dry_run:
                    conn.execute("UPDATE cats SET status='closed' WHERE id=?", (r["id"],))
                print(f"  not a listing, hidden: {(r['title'] or '')[:40]}")
                continue
            changed += 1
            if not dry_run:
                conn.execute(f"UPDATE cats SET {', '.join(f + '=?' for f in UPDATE_FIELDS)} WHERE id=?",
                             [new[f] for f in UPDATE_FIELDS] + [r["id"]])
        if not dry_run:
            refresh(conn)
    print(f"updated {changed}, hidden {closed}, left unchanged because the model failed {failed}"
          + (" (dry run: nothing written)" if dry_run else ""))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--backfill", action="store_true", help="re-read Facebook listings already in the database")
    ap.add_argument("--model", help=f"default {MODEL} (or set CATADOPT_LLM_MODEL)")
    ap.add_argument("--limit", type=int, help="only the newest N listings")
    ap.add_argument("--force", action="store_true", help="also redo listings the model already read")
    ap.add_argument("--yes", action="store_true", help="do not ask before spending")
    ap.add_argument("--dry-run", action="store_true", help="show what would change; write nothing")
    args = ap.parse_args()
    if not args.backfill:
        ap.error("nothing to do; use --backfill")
    if not has_credentials():
        sys.exit("No Claude credentials found. Set ANTHROPIC_API_KEY (PowerShell: $env:ANTHROPIC_API_KEY=\"...\").")
    db.init()
    backfill(args.model, args.limit, args.force, args.yes, args.dry_run)
