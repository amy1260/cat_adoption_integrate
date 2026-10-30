# 貓咪領養統整站 / Cat Adoption Hub

整合三種來源：全國動物收容管理系統（農業部開放資料）、臉書社團「貓咪天堂」公開貼文、網站使用者刊登。介面預設中文，可切換英文。

## 啟動
雙擊 `start.bat`，或：
```
pip install -r requirements.txt
python shelter.py      # 同步收容所資料（伺服器每 6 小時也會自動同步）
python app.py          # http://127.0.0.1:8765
```

## 匯入臉書貼文
貼文由使用者已登入的 Chrome 擷取，原始資料存於 `data/raw/`，再由 `ingest.py` 解析：
```
python ingest.py data/raw/catparadise_*.json
```
解析器 `parser.py` 會判斷是否為送養文（排除救援、求領養、已送養、送養會活動），並抽出品種、花色、性別、年齡、結紮／疫苗／愛滋白血、健康標籤、地區、聯絡方式。

### 用 Apify 抓取（建議，時間與網址最準確）
在 Apify 執行官方的 Facebook Groups Scraper（`apify/facebook-groups-scraper`，貼文按篇計費），再把結果下載匯入：
```
set APIFY_TOKEN=你的 Apify 個人 API token      (Apify Console > Settings > API & Integrations)
python apify_fetch.py <datasetId>               # 下載結果到 data/apify/（讀取資料集不收費）
python ingest.py data/apify/catparadise_*.json
```
Apify 回傳精確時間與貼文網址；轉分享的貼文會以原作者與原文網址匯入，同一篇被多人轉分享只會留一筆。

## 防止重複
- 同一來源內重複（相同網址、相同內容、相同照片、同聯絡人且資料相同）：直接擋下，上傳時回覆「已刊登過」。
- 不同來源疑似同一隻（例如臉書貼文與收容所同一收容編號、晶片號碼相同、內容或照片相同）：先暫不公開，列入「待確認重複」（網站右上導覽，僅本機可見），由你選「同一隻（合併）」或「不同隻（公開）」，也可復原。

## 檔案
`app.py` 網站與 API · `db.py` 資料庫 · `shelter.py` 收容所同步 · `parser.py` 貼文解析 · `dedupe.py` 重複比對 · `ingest.py` 臉書匯入 · `static/` 前端
