"""Extract structured cat info (breed, age, health, region, contact...) from free-text posts."""
import hashlib
import json
import re
from datetime import datetime, timedelta

CITY_KEYWORDS = [
    ("新北", "新北市"), ("臺北", "臺北市"), ("桃園", "桃園市"), ("臺中", "臺中市"),
    ("臺南", "臺南市"), ("高雄", "高雄市"), ("基隆", "基隆市"), ("新竹縣", "新竹縣"),
    ("新竹市", "新竹市"), ("新竹", "新竹市"), ("苗栗", "苗栗縣"), ("彰化", "彰化縣"),
    ("南投", "南投縣"), ("雲林", "雲林縣"), ("嘉義縣", "嘉義縣"), ("嘉義市", "嘉義市"),
    ("嘉義", "嘉義市"), ("屏東", "屏東縣"), ("宜蘭", "宜蘭縣"), ("花蓮", "花蓮縣"),
    ("臺東", "臺東縣"), ("澎湖", "澎湖縣"), ("金門", "金門縣"), ("馬祖", "連江縣"),
    ("連江", "連江縣"),
]
DISTRICTS = {
    "臺北市": "大安 信義 中山 松山 內湖 南港 士林 北投 文山 萬華 中正 大同",
    "新北市": "板橋 中和 永和 新莊 三重 蘆洲 土城 樹林 淡水 汐止 新店 林口 五股 泰山 三峽 鶯歌 深坑 石碇 八里 三芝",
    "桃園市": "中壢 平鎮 龍潭 楊梅 八德 大溪 蘆竹 大園 龜山 觀音",
    "臺中市": "北屯 西屯 南屯 太平 大里 霧峰 烏日 豐原 沙鹿 梧棲 潭子 大雅 神岡 后里",
    "臺南市": "永康 安南 安平 仁德 歸仁 新營 佳里 善化 新化",
    "高雄市": "左營 楠梓 鼓山 三民 苓雅 前鎮 鳳山 小港 岡山 燕巢 旗山 仁武 大寮 林園 鳥松",
}
DISTRICT_TO_CITY = {d: c for c, ds in DISTRICTS.items() for d in ds.split()}

BREEDS = [
    ("ragdoll", r"布偶"), ("british_shorthair", r"英短|英國短毛"),
    ("american_shorthair", r"美短|美國短毛"), ("scottish_fold", r"摺耳|折耳|蘇格蘭"),
    ("persian", r"波斯"), ("siamese", r"暹羅"), ("maine_coon", r"緬因"),
    ("bengal", r"孟加拉"), ("russian_blue", r"俄羅斯藍"), ("munchkin", r"曼赤肯|短腿貓"),
    ("exotic_shorthair", r"加菲|異國短毛"), ("norwegian_forest", r"挪威森林"),
    ("sphynx", r"無毛貓|斯芬克斯"), ("birman", r"伯曼"), ("abyssinian", r"阿比西尼亞"),
    ("chinchilla", r"金吉拉"), ("mixed", r"米克斯|混種|土貓|家貓|唐貓"),
]
COLORS = [
    "橘白", "橘貓", "橘色", "黃白", "虎斑白", "虎斑", "賓士", "乳牛", "三花", "玳瑁", "狸花", "黑白",
    "全黑", "黑貓", "白貓", "全白", "灰白", "灰貓", "藍白", "銀漸層", "金漸層", "奶茶", "藍貓", "重點色",
    "黑色", "白色", "黃色", "灰色", "橘色", "咖啡",
]
HEALTH_TAGS = {
    "skin": r"皮膚(?:病|炎|問題)|黴菌|貓癬|耳疥",
    "stomatitis": r"口炎",
    "kidney": r"腎(?:病|衰|臟|功能|指數)|慢性腎",
    "eye": r"失明|眼睛(?:潰瘍|感染|疾病)|單眼|瞎",
    "disability": r"癱瘓|殘(?:疾|缺|障)|跛|截肢|斷腿|後腳無力|身障",
    "cold": r"貓鼻支|感冒|打噴嚏|鼻支",
    "digestive": r"腹瀉|拉肚子|軟便|IBD|ibd",
    "heart": r"心臟|心雜音|HCM|hcm",
    "diabetes": r"糖尿",
    "dewormed": r"已驅蟲|有驅蟲|驅蟲完|體內外驅蟲",
    "healthy": r"身體健康|健康活潑|健康良好|健康的|健康寶寶|健康檢查正常",
}
HEALTH_LINE = re.compile(
    "|".join(list(HEALTH_TAGS.values()) + [r"結紮", r"絕育", r"疫苗", r"預防針", r"愛滋", r"白血", r"FIV", r"FeLV", r"晶片", r"健康"]))

NOISE_LINE = re.compile(
    r"^(可能是.*圖像|未提供相片說明|分享的貼文|讚|回覆|分享|追蹤|加入|·|查看更多.*|顯示更多|\+\d+|"
    r"[\d,.]+[萬KkM]?|\d+:\d+ ?/ ?\d+:\d+|0:00 ?/ ?0:00|查看全部\d+則回覆|最相關|所有留言)\s*$")
TIME_LINE = re.compile(r"^(?:大約\s*)?(\d+)\s*(分鐘|小時|天|週|年)前?$|^剛剛$|^昨天|^(\d+)月(\d+)日|^(\d{4})年(\d+)月(\d+)日")

ADOPT_WORDS = re.compile(r"送養|認養|領養|找家|找新家|找主人|開放領養|待領養|求家|徵求(?:領養|認養|家)|尋找.{0,6}家")
EVENT_WORDS = re.compile(r"送養會|認養會|領養會|認養活動|送養活動|領養活動|市集|園遊會")
CONDITION_MARK = re.compile(r"(?:認養|領養|送養)(?:條件|須知|資格|辦法|流程)|(?:認養|領養)人(?:需|須|要|必須)|送養條件")
ADOPTER_AGE = re.compile(r"(?:年滿|滿|需滿|須滿|至少|超過|年齡)\s*\d{1,2}\s*歲|\d{1,2}\s*歲(?:以上|以下|才)")
CLOSED_WORDS = re.compile(r"已送養|已認養|已領養|已被領養|已有家|已結案|已找到家|已經有家|送養成功|已成功|已覓得|已經送養|已被認養|已順利")
SEEKING_WORDS = re.compile(r"想(?:要)?(?:認養|領養)|欲(?:認養|領養)|請問.{0,12}(?:認養|領養)|求(?:推薦|介紹)")
RESCUE_ONLY = re.compile(r"求救|救援|急救|募款|捐款|協尋|走失|尋貓|找飼主|車禍|被撞|急需|原放|出收容所|帶出所|抓貓|誘捕")

PHONE_MOBILE = re.compile(r"(?<!\d)(09\d{2})[-\s.]?(\d{3})[-\s.]?(\d{3})(?!\d)")
PHONE_LAND = re.compile(r"(?<!\d)\(?(0[2-8]\d?)\)?[-\s]?(\d{3,4})[-\s]?(\d{4})(?!\d)")
LINE_ID = re.compile(r"(?i)line\s*(?:id)?\s*[:：]?\s*(@?[A-Za-z0-9._-]{3,30})")
CHIP = re.compile(r"(?<!\d)(\d{15})(?!\d)")
SHELTER_NO = re.compile(r"(?<![A-Za-z0-9])([A-Z]{3,6}\d{9,13})(?![A-Za-z0-9])")


def norm_text(s):
    return s.replace("台", "臺")


def parse_relative_time(line, captured_at):
    line = line.strip()
    m = TIME_LINE.match(line)
    if not m:
        return None
    if line == "剛剛":
        return captured_at
    if line.startswith("昨天"):
        return captured_at - timedelta(days=1)
    if m.group(1):
        n, unit = int(m.group(1)), m.group(2)
        delta = {"分鐘": timedelta(minutes=n), "小時": timedelta(hours=n), "天": timedelta(days=n),
                 "週": timedelta(weeks=n), "年": timedelta(days=365 * n)}[unit]
        return captured_at - delta
    if m.group(5):
        return datetime(int(m.group(5)), int(m.group(6)), int(m.group(7)))
    month, day = int(m.group(3)), int(m.group(4))
    year = captured_at.year if (month, day) <= (captured_at.month, captured_at.day) else captured_at.year - 1
    try:
        return datetime(year, month, day)
    except ValueError:
        return None


def _flag_near(text, kw_pattern, neg_pattern=r"(?:未|沒|尚未|還沒|待|需|需要|須|預計|將|不|欲|要|可能)"):
    """True if keyword appears affirmatively, False if only negated, None if absent."""
    found = None
    for m in re.finditer(kw_pattern, text):
        before = text[max(0, m.start() - 4):m.start()]
        if re.search(neg_pattern + r"\s*(?:已|有)?\s*(?:打|施打|完成|做|辦)?$", before):
            found = found if found else False
        else:
            return True
    return found


def parse_age(text):
    """Return (age_months, age_group, age_text)."""
    t = ADOPTER_AGE.sub(" ", text)
    m = re.search(r"(\d{1,2})\s*歲半", t)
    if m:
        months = int(m.group(1)) * 12 + 6
        return months, _group(months), m.group(0)
    m = re.search(r"(\d{1,2}(?:\.\d)?)\s*(?:[-~～到至]\s*\d{1,2}(?:\.\d)?\s*)?(?:個月|个月|月齡|月大)(?!前|後|內|以上)", t)
    if m and float(m.group(1)) <= 36:
        months = max(1, round(float(m.group(1))))
        return months, _group(months), m.group(0)
    m = re.search(r"(\d{1,2})\s*歲\s*(?:又|零)?\s*(\d{1,2})\s*個?月", t)
    if m:
        months = int(m.group(1)) * 12 + int(m.group(2))
        return months, _group(months), m.group(0)
    m = re.search(r"(\d{1,2}(?:\.\d)?)\s*(?:歲|岁)", t)
    if m and float(m.group(1)) <= 22:
        months = int(float(m.group(1)) * 12)
        return months, _group(months), m.group(0)
    if re.search(r"半歲", t):
        return 6, "kitten", "半歲"
    m = re.search(r"(\d{1,2})\s*(?:個月(?!前|後|內|以上)|个月|月齡|月大|m(?![a-z]))", t)
    if m and int(m.group(1)) <= 24:
        months = int(m.group(1))
        return months, _group(months), m.group(0)
    m = re.search(r"(\d{1,2})\s*(?:週|周)(?:齡|大)?", t)
    if m and int(m.group(1)) <= 40:
        months = max(1, int(m.group(1)) // 4)
        return months, "kitten", m.group(0)
    m = re.search(r"(20\d{2})\s*年(?:\s*\d{1,2}\s*月)?\s*(?:出生|生)", t)
    if m:
        months = max(0, (datetime.now().year - int(m.group(1))) * 12)
        return months, _group(months), m.group(0)
    if re.search(r"老貓|高齡|老年|老爺|老奶", t):
        return None, "senior", "老貓"
    if re.search(r"幼貓|奶貓|小貓|貓寶寶|寶寶|BB|bb", t):
        return None, "kitten", "幼貓"
    if re.search(r"成貓|大貓", t):
        return None, "adult", "成貓"
    return None, "unknown", None


def _group(months):
    if months < 12:
        return "kitten"
    if months >= 84:
        return "senior"
    return "adult"


def parse_sex(text):
    m = re.search(r"性別\s*[:：]?\s*(公|母|男|女)", text)
    if m:
        return "M" if m.group(1) in "公男" else "F"
    male = re.search(r"公貓|男生|男孩|男寶|男喵|弟弟|帥哥|小男生|小公|♂", text)
    female = re.search(r"母貓|女生|女孩|女寶|女喵|妹妹|美女|小女生|小母|♀", text)
    if male and not female:
        return "M"
    if female and not male:
        return "F"
    return "U"


def parse_region(text):
    t = norm_text(text)
    for kw, city in CITY_KEYWORDS:
        if kw in t:
            return city, _district(t, city)
    for d, city in DISTRICT_TO_CITY.items():
        if d in t:
            return city, d
    return None, None


def _district(t, city):
    for d in DISTRICTS.get(city, "").split():
        if d in t:
            return d
    return None


def parse_contact(text, author=None):
    phones = [f"{a}-{b}-{c}" for a, b, c in PHONE_MOBILE.findall(text)]
    if not phones:
        phones = [f"{a}-{b}-{c}" for a, b, c in PHONE_LAND.findall(text)]
    line_id = None
    for m in LINE_ID.finditer(text):
        cand = m.group(1)
        if re.search(r"[A-Za-z0-9]", cand) and cand.lower() not in {"id", "line", "me"}:
            line_id = cand
            break
    other = None
    if re.search(r"私訊|私我|messenger|inbox|PM", text):
        other = "Facebook 私訊"
    elif re.search(r"留言", text):
        other = "Facebook 留言"
    return {"phone": phones[0] if phones else None, "line": line_id, "other": other}


def parse_health(text):
    tags = [k for k, pat in HEALTH_TAGS.items() if re.search(pat, text)]
    neutered = _flag_near(text, r"結紮|節紮|絕育")
    vaccinated = _flag_near(text, r"疫苗|預防針|三合一|四合一|五合一")
    fiv = None
    m = re.search(r"(愛滋|FIV|fiv|白血|FeLV|felv|愛白)[^。\n，,]{0,6}?(陰|陽)", text)
    if m:
        fiv = "neg" if m.group(2) == "陰" else "pos"
        if fiv == "pos":
            tags.append("fiv_pos")
    if re.search(r"(?:未|沒)(?:結紮|節紮|絕育)", text) and neutered:
        neutered = False
    lines = [l for l in re.split(r"[\n。]", text) if HEALTH_LINE.search(l)]
    note = "；".join(l.strip() for l in lines)[:240] or None
    return {"neutered": neutered, "vaccinated": vaccinated, "fiv_felv": fiv,
            "tags": sorted(set(tags)), "note": note}


def parse_breed_color(text):
    breed = None
    for key, pat in BREEDS:
        if re.search(pat, text):
            breed = key
            break
    hits = [(text.find(c), -len(c), c) for c in COLORS if c in text]
    color = min(hits)[2] if hits else None
    if breed is None and color:
        breed = "mixed"
    return breed, color


def clean_post_lines(lines, captured_at):
    """Split a raw harvested feed item into (author, posted_at, body_lines, original_author)."""
    head = lines[:14]
    time_idx = [i for i, l in enumerate(head) if TIME_LINE.match(l.strip())]
    author = lines[0] if lines else None
    posted_at = None
    body_start = 1 if lines else 0  # skip the author line when no timestamp is found
    orig_author = None
    if time_idx:
        posted_at = parse_relative_time(head[time_idx[0]], captured_at)
        last = time_idx[-1]
        body_start = last + 1
        if last != time_idx[0]:  # shared post: original poster before the second timestamp
            j = last - 1
            while j > 0 and head[j].strip() in {"·", "追蹤", "加入"}:
                j -= 1
            orig_author = head[j].strip()
    body = []
    for l in lines[body_start:]:
        l = l.strip()
        if not l or NOISE_LINE.match(l) or l == "顯示較少":
            continue
        if l == "讚" or "身分留言" in l or re.match(r"^查看.{0,8}則?(?:留言|回覆)", l) or TIME_LINE.match(l):
            if TIME_LINE.match(l) and len(body) >= 3:  # comment: [author, text, time]
                body = body[:-2] if len(body[-1]) <= 60 and len(body[-2]) <= 40 else body
            break
        body.append(re.sub(r"[\s…]*(?:顯示較少|顯示更多|查看更多)$", "", l))
    return author, orig_author, posted_at, body


def classify(text):
    """Return 'adoptable', or the reason a post is not an open adoption listing."""
    head = text[:400]
    if CLOSED_WORDS.search(head):
        return "closed"
    if EVENT_WORDS.search(head):
        return "event"
    if SEEKING_WORDS.search(text) and not re.search(r"送養", text):
        return "seeking"
    if not ADOPT_WORDS.search(text):
        return "not_adoption"
    if RESCUE_ONLY.search(text[:300]) and not re.search(r"送養|開放領養|認養條件|領養條件|找新家", text):
        return "rescue"
    return "adoptable"


def parse_post(group, item, captured_at):
    """item: {'lines': [...], 'link': str|None} harvested from the Facebook feed page."""
    lines = [l.strip() for l in item["lines"] if l and l.strip()]
    author, orig_author, posted_at, body = clean_post_lines(lines, captured_at)
    link = item.get("link")
    if link and link.startswith("/"):
        link = "https://www.facebook.com" + link
    return build_cat(group, "\n".join(body), orig_author or author, posted_at, link, author)


def build_cat(source, text, contact_name, posted_at, link, poster=None):
    """Classify a post's text and extract its fields. Returns (cat, "ok") or (None, reason)."""
    if len(text) < 12:
        return None, "empty"
    verdict = classify(text)
    if verdict != "adoptable":
        return None, verdict
    cut = CONDITION_MARK.search(text)
    profile = text[:cut.start()] if cut and cut.start() > 30 else text
    age_months, age_group, age_text = parse_age(profile)
    breed, color = parse_breed_color(profile)
    region, district = parse_region(text)
    health = parse_health(profile)
    contact = parse_contact(text)
    chips = CHIP.findall(text)
    snos = SHELTER_NO.findall(text)
    first_line = text.split("\n")[0]
    digest = hashlib.sha1(((poster or contact_name or "") + "|" + re.sub(r"\s+", "", text)[:200]).encode("utf-8")).hexdigest()[:20]
    cat = {
        "source": source, "source_id": digest, "source_url": link,
        "title": first_line[:80], "name": None, "breed": breed, "breed_text": None, "color": color,
        "sex": parse_sex(profile), "age_group": age_group, "age_months": age_months, "age_text": age_text,
        "neutered": None if health["neutered"] is None else int(health["neutered"]),
        "vaccinated": None if health["vaccinated"] is None else int(health["vaccinated"]),
        "fiv_felv": health["fiv_felv"], "health_tags": json.dumps(health["tags"]),
        "health_note": health["note"], "region": region, "district": district,
        "location_text": None, "contact_name": contact_name,
        "contact_phone": contact["phone"], "contact_line": contact["line"],
        "contact_other": contact["other"], "description": text[:2000],
        "photo": None, "photo_hash": None, "chip": chips[0] if chips else None,
        "shelter_no": snos[0] if snos else None, "available_from": None,
        "posted_at": posted_at.isoformat(timespec="minutes") if posted_at else None,
    }
    return cat, "ok"
