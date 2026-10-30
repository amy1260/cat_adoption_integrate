"""Store listing photos locally. Facebook image URLs are signed and expire, so we keep our own copy."""
import base64
import hashlib
import io
from pathlib import Path

from PIL import Image

PHOTO_DIR = Path(__file__).resolve().parent / "static" / "photos"
MAX_SIDE = 640
MIN_SIDE = 120


def dhash(img, size=8):
    g = img.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            bits = (bits << 1) | (px[row * (size + 1) + col] > px[row * (size + 1) + col + 1])
    return f"{bits:016x}"


def save_bytes(raw):
    """Save photo bytes. Returns (public path, dhash), or (None, None) if unusable."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        return None, None
    if min(img.size) < MIN_SIDE:  # icons and stickers are not cat photos
        return None, None
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha1(raw).hexdigest()[:16] + ".jpg"
    img.save(PHOTO_DIR / name, "JPEG", quality=82)
    return f"/static/photos/{name}", dhash(img)


def save_data_url(data_url):
    """Save a `data:image/...;base64,` photo (what the browser sends)."""
    try:
        return save_bytes(base64.b64decode(data_url.split(",", 1)[1]))
    except Exception:
        return None, None


def download(url):
    """Fetch a photo by URL. Facebook CDN links work without a login but expire after a few days."""
    import requests
    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        return save_bytes(r.content)
    except Exception:
        return None, None


def first_image_url(item):
    """First photo URL of an Apify Facebook Groups Scraper item: its own, else the reshared post's.

    `attachments` is a list whose first entry is often just a media-set link, so take the first
    entry that carries an image.
    """
    def lists(key):
        # flattened datasets use 'sharedPost.media'; nested ones use item['sharedPost']['media']
        found = item.get(key)
        if found is None and "." in key:
            found = (item.get(key.split(".")[0]) or {}).get(key.split(".")[1])
        return found or []

    # a reshare keeps its photos in sharedPost.attachments, or in sharedPost.media for videos and reels
    for atts in (lists("attachments"), lists("sharedPost.attachments"), lists("sharedPost.media")):
        for a in atts:
            if not isinstance(a, dict):
                continue
            uri = (a.get("photo_image") or {}).get("uri") or (a.get("image") or {}).get("uri") or a.get("thumbnail")
            if uri:
                return uri
    return None
