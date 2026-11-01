"""Type a post and see how parser.classify() judges it.

    python classify_try.py                 interactive: paste text, finish with an empty line (Ctrl+Z Enter / Ctrl+D to quit)
    python classify_try.py "post text"     classify one post
    python classify_try.py -f post.txt     classify the text in a file (UTF-8)
"""
import re
import sys

import parser as P

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

RULES = [  # same order as parser.classify(); shows which patterns matched, not only the verdict
    ("closed", "前 400 字", lambda t: P.CLOSED_WORDS.search(t[:400])),
    ("event", "前 400 字", lambda t: P.EVENT_WORDS.search(t[:400])),
    ("seeking", "全文（且沒有「送養」）", lambda t: P.SEEKING_WORDS.search(t) and not re.search(r"送養", t)),
    ("not_adoption", "全文沒有送養相關詞", lambda t: not P.ADOPT_WORDS.search(t)),
    ("rescue", "前 300 字（且沒有送養/環境照等）",
     lambda t: P.RESCUE_ONLY.search(t[:300]) and not re.search(r"送養|開放領養|認養條件|領養條件|找新家|環境照", t)),
]


def explain(text):
    verdict = "empty" if len(text) < 12 else P.classify(text)
    print(f"\n結果：{verdict}")
    if len(text) < 12:
        print("  內文少於 12 字，build_cat 直接略過")
        return verdict
    for name, scope, test in RULES:
        hit = test(text)
        print(f"  {'命中' if hit else '    '} {name:<13}{scope}")
        if hit and not isinstance(hit, bool) and hasattr(hit, "group"):
            print(f"       關鍵字：{hit.group(0)}")
    return verdict


def main():
    args = sys.argv[1:]
    if args and args[0] == "-f":
        explain(open(args[1], encoding="utf-8").read().strip())
    elif args:
        explain(" ".join(args))
    else:
        print("貼上貼文內容，空白行結束一篇；Ctrl+Z 然後 Enter 離開。")
        buf = []
        for line in sys.stdin:
            if line.strip():
                buf.append(line.rstrip("\n"))
            elif buf:
                explain("\n".join(buf))
                buf = []
        if buf:
            explain("\n".join(buf))


if __name__ == "__main__":
    main()
