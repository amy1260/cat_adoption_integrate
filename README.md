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
# PowerShell:  $env:APIFY_TOKEN="你的 Apify 個人 API token"      (cmd 則用 set APIFY_TOKEN=...)
# 取得位置：Apify Console > Settings > API & Integrations
python apify_fetch.py <datasetId>               # 下載結果到 data/apify/（讀取資料集不收費）
python ingest.py data/apify/catparadise_*.json
```
Apify 回傳精確時間與貼文網址；轉分享的貼文會以原作者與原文網址匯入，同一篇被多人轉分享只會留一筆。

**貓咪照片：** Apify 的資料已包含貼文的圖片網址（自己的貼文在 `attachments`，轉分享在 `sharedPost.attachments` 或 `sharedPost.media`）。`apify_fetch.py` 會挑出第一張，`ingest.py` 匯入時下載到 `static/photos/`（不直接引用 Facebook 網址，因為連結幾天後就會失效）。已匯入但沒有照片的貓咪，重新匯入同一批資料時會自動補上照片與原文網址。請在下載後儘快匯入。

### 年齡換算與 LLM 抽取
- **貼文年齡換算成現在年齡：** 貼文裡寫的年齡是「發文當天」的年齡。系統另存 `age_months_post`（貼文當時），再依發文日期換算成今天的年齡（`age_months`／年齡層），網站啟動時與每 6 小時自動更新；詳細頁會同時顯示貼文當時年齡。
- **用 Claude 讀貼文：** `llm_extract.py` 請 Claude 從貼文內文抽出性別、年齡、品種、花色、結紮／疫苗／愛滋白血、地區、聯絡方式，並判斷是不是真的送養文（排除救援、走失、活動、狗、已領養）。貼文原文完整保留在「詳細說明」。
  - 需要先設定金鑰：PowerShell `$env:ANTHROPIC_API_KEY="..."`。匯入時加上 `--llm`（`python ingest.py --llm <檔案>`）才會用 Claude 讀取新貼文並先顯示預估費用；不加就沿用規則解析，不會花錢。
  - 已在資料庫裡的貼文：`python llm_extract.py --backfill`（會先顯示預估費用並詢問）。同一篇貼文的答案會存快取，不會重複付費。
  - 預設模型 `claude-opus-5-5`；想省錢可加 `--model claude-haiku-5-5`（約便宜 40 倍，判斷略粗）。

## 防止重複
- 同一來源內重複（相同網址、相同內容、相同照片、同聯絡人且資料相同）：直接擋下，上傳時回覆「已刊登過」。
- 不同來源疑似同一隻（例如臉書貼文與收容所同一收容編號、晶片號碼相同、內容或照片相同）：先暫不公開，列入「待確認重複」（網站右上導覽，僅本機可見），由你選「同一隻（合併）」或「不同隻（公開）」，也可復原。

## 檔案
`app.py` 網站與 API · `db.py` 資料庫 · `shelter.py` 收容所同步 · `parser.py` 貼文解析 · `dedupe.py` 重複比對 · `ingest.py` 臉書匯入 · `static/` 前端
