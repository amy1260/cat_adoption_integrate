"""Unit tests for parser.classify(). Run: python -m unittest test_classify -v

Cases marked KNOWN_GAP document current false positives/negatives; they assert today's behaviour so a rule change
that fixes one shows up as a failure to update on purpose.
"""
import unittest

import parser as P

CASES = [
    # (label, text, expected)
    ("plain adoption", "小橘 2歲公貓 已結紮 送養 台北市 line:abc123", "adoptable"),
    ("looking for a home", "三個月奶貓找新家，已打疫苗，高雄", "adoptable"),
    ("adoption with env photo", "米克斯幼貓，環境照如圖，歡迎詢問", "adoptable"),
    ("closed: 已送養", "已送養！謝謝大家的幫忙，小花有家了", "closed"),
    ("closed: 已被領養", "這隻貓已被領養，感謝關心", "closed"),
    ("closed beyond 400 chars is ignored", "送養小黑，母貓，已結紮。" + "很乖。" * 200 + "已送養", "adoptable"),
    ("event", "本週末舉辦送養會，歡迎來認識毛孩", "event"),
    ("event: market", "動保市集活動，現場有貓咪", "event"),
    ("seeking adopter", "請問哪裡可以領養貓咪？想領養一隻", "seeking"),
    ("seeking but also 送養 is not seeking", "想領養的人請看，這隻貓送養中，台中", "adoptable"),
    ("not adoption", "今天天氣很好，貓咪在曬太陽", "not_adoption"),
    ("rescue only", "車禍癱瘓，求救！請求有人帶出所治療", "not_adoption"),  # no adoption word: stops at not_adoption
    ("rescue with adoption word", "車禍癱瘓，求救！帶出所後需要求家，請協助", "rescue"),
    ("rescue but listing for adoption", "車禍後康復，開放領養，台北", "adoptable"),
    ("lost cat", "走失貓咪，協尋，請聯絡我", "not_adoption"),
    ("too short", "送養貓", "empty"),
    # KNOWN_GAP: current behaviour, probably not what we want
    ("KNOWN_GAP closed word in recap of an open listing", "已送養的貓咪近況分享。目前還有小白送養中，台北", "closed"),
    ("KNOWN_GAP unlisted wording", "徵家庭收編，奶貓兩隻，台南", "not_adoption"),
]


def verdict(text):
    return "empty" if len(text) < 12 else P.classify(text)


class ClassifyTests(unittest.TestCase):
    def test_cases(self):
        for label, text, expected in CASES:
            with self.subTest(label):
                self.assertEqual(verdict(text), expected)

    def test_order_closed_beats_event(self):
        self.assertEqual(P.classify("已送養，謝謝送養會的志工"), "closed")

    def test_order_event_beats_seeking(self):
        self.assertEqual(P.classify("領養會現場，想領養的人請洽櫃檯"), "event")

    def test_rescue_window_is_300_chars(self):
        late = "求家貓咪。" + "很乖。" * 120 + "車禍求救"   # rescue word after char 300
        self.assertEqual(P.classify(late), "adoptable")
        early = "車禍求救" + "求家貓咪。" + "很乖。" * 120
        self.assertEqual(P.classify(early), "rescue")


if __name__ == "__main__":
    unittest.main()
