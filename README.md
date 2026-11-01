# 貓咪領養統整站 / Cat Adoption Hub

整合兩種來源：全國動物收容管理系統（農業部開放資料）、臉書社團「愛貓領養」公開貼文（2026-11-01 前為「貓咪天堂」，舊資料已下架並備份）。網站不開放民眾刊登，也不保存任何會員資料。介面預設中文，可切換英文。

## 啟動
雙擊 `start.bat`，或：
```
pip install -r requirements.txt
python shelter.py      # 同步收容所資料（伺服器每 6 小時也會自動同步）。開放資料比 pet.gov.tw 慢、也會漏貓，所以以官方「動物認領養」頁的貓清單為準：頁上有、開放資料沒有的補進來；頁上沒列的（含還在公告期、尚未開放認養的，以及開放資料誤標成貓的狗）下架
python shelter.py --status   # 同步後，逐隻核對官方頁面的「是否開放認領養」，已出所的下架（開放資料不會更新這件事；伺服器同步時每次也會核對 600 隻）
python shelter.py --photos   # 同步後，替開放資料沒附照片的貓，到 pet.gov.tw 該貓自己的頁面找照片（伺服器同步時每次也會補 300 隻）
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

### 抓最新 90 篇貼文並自動上架（`apify_latest.py`）
```
setx APIFY_TOKEN "你的 Apify 個人 API token"     # 只需一次，之後開新的終端機才會生效
setx GEMINI_API_KEY "你的 Google 金鑰"             # 語言模型分析用，https://aistudio.google.com/apikey
python apify_latest.py --plan                      # 只看這次會抓什麼、最多花多少，不會啟動抓取
python apify_latest.py                             # 抓「愛貓領養」社團最新 90 篇沒抓過的貼文，並上架
python apify_latest.py --posts 20                  # 改抓其他篇數
python apify_latest.py --status                    # 最近幾次的執行、花費、網站上的臉書貓咪
```
不會自動排程，只有手動執行時才抓（token 只讀環境變數、不寫進檔案）。抓取的社團是「愛貓領養」 https://www.facebook.com/groups/1612153615732604 （網站來源標示 `fb_aimao`）；2026-11-01 以前抓的是「貓咪天堂」，那批貓已下架，資料、照片與原始貼文備份在 `data/backups/facebook_catparadise_*/`，在修改紀錄裡也能逐筆還原。
- **不重複抓：** 每次抓到的貼文都記在資料庫 `fb_posts_seen`（依社團分開記）；下一次只請 Apify 抓「比這個社團已抓過最新那篇更新」的貼文，萬一還是有抓過的貼文回來，也會在匯入前剔除。距離上次新貼文超過 90 篇時，只取最新的 90 篇。
- **全自動流程：** 抓到的新貼文同一次執行內依序完成：①規則先篩掉明顯不是送養的貼文 → ②下載貼文第一張照片 → ③語言模型讀貼文（是不是真的送養文、性別、年齡、品種、花色、結紮疫苗、地區、聯絡方式） → ④與已上架的貓比對，不重複 → ⑤直接上架。**預設用 Google Gemini**（也認 `GOOGLE_API_KEY`）；沒設任何金鑰就只用規則解析，一樣會上架。
- **花費：** Facebook Groups Scraper（`apify/facebook-groups-scraper`）每篇約 0.005 美元，第二次起加日期篩選 0.002，每次啟動 0.001，第一次 90 篇最多約 0.46 美元，之後每次最多約 0.63 美元。每次執行都用 Apify 的 `maxTotalChargeUsd` 設上限；本月 Apify 額度不夠時不會啟動（額度讀自帳號的每月上限，可用 `APIFY_MONTHLY_BUDGET_USD` 自訂）。每次執行的結果記在 `apify_runs`。
- `CATADOPT_LLM=0` 關閉語言模型；`CATADOPT_LLM_MODEL` 換模型（Google 預設 `gemini-3.5-flash-lite`，約 2 秒一篇；`gemini-3.8-flash` 更聰明，但實測一篇要一分多鐘，不適合批次）；`CATADOPT_LLM_RUN_POSTS` 是單次執行最多讀幾篇（預設 300）；超過的貼文沿用規則解析，之後可用 `python llm_extract.py --backfill` 補讀。
- 模型失敗、被擋或金鑰有問題時，貼文沿用規則解析，不會漏掉；同一篇貼文的答案有快取，不會重複付費。遇到速率限制（429）會自動等待重試。想改用 Claude：設 `ANTHROPIC_API_KEY` 並讓 `CATADOPT_LLM_PROVIDER=anthropic`（或 `CATADOPT_LLM_MODEL=claude-...`）；兩種金鑰都有時預設用 Google。

**貓咪照片：** Apify 的資料已包含貼文的圖片網址（自己的貼文在 `attachments`，轉分享在 `sharedPost.attachments` 或 `sharedPost.media`）。`apify_fetch.py` 會挑出第一張，`ingest.py` 匯入時下載到 `static/photos/`（不直接引用 Facebook 網址，因為連結幾天後就會失效）。已匯入但沒有照片的貓咪，重新匯入同一批資料時會自動補上照片與原文網址。請在下載後儘快匯入。

### 年齡換算與 LLM 抽取
- **貼文年齡換算成現在年齡：** 貼文裡寫的年齡是「發文當天」的年齡。系統另存 `age_months_post`（貼文當時），再依發文日期換算成今天的年齡（`age_months`／年齡層），網站啟動時與每 6 小時自動更新；詳細頁會同時顯示貼文當時年齡。
- **用語言模型讀貼文：** `llm_extract.py` 請 Gemini（或 Claude）從貼文內文抽出性別、年齡、品種、花色、結紮／疫苗／愛滋白血、地區、聯絡方式，並判斷是不是真的送養文（排除救援、走失、活動、狗、已領養）。貼文原文完整保留在「詳細說明」。
  - 需要先設定金鑰：PowerShell `$env:GEMINI_API_KEY="..."`。匯入時加上 `--llm`（`python ingest.py --llm <檔案>`）才會用模型讀取新貼文；不加就沿用規則解析，不會花錢。Google 的費用要自己看 https://ai.google.dev/gemini-api/docs/pricing ，把單價設成 `CATADOPT_LLM_PRICE="每百萬輸入詞元美元,每百萬輸出詞元美元"` 才會顯示預估。
  - 已在資料庫裡的貼文：`python llm_extract.py --backfill`（會先顯示預估費用並詢問）。同一篇貼文的答案會存快取，不會重複付費。
  - 預設模型：有 Google 金鑰時 `gemini-3.5-flash-lite`，只有 Claude 金鑰時 `claude-opus-5-5`；可用 `--model` 指定。

## 公開網站（Netlify，唯讀）
```
python publish.py      # 產生 public_site/：只有訪客看得到的頁面、上架中的貓（data/cats.json）與照片
```
- 公開網站是純靜態檔案，**沒有伺服器、也沒有管理者 API**，所以審核、回報、缺照片、修改紀錄、編輯這些管理介面不會出現，也無法從網站修改任何資料；管理一律在這台電腦上用 `python app.py`（http://127.0.0.1:8765）。
- 待審核、已下架、已合併的貓，以及只有管理者會用到的欄位，都不會放進去。
- 訪客按「回報問題」會送到 Netlify Forms（Netlify > 專案 tw-cat-adoption-hub > Forms 查看）。
- 部署：Netlify 專案 `tw-cat-adoption-hub`（https://tw-cat-adoption-hub.netlify.app）。到 https://app.netlify.com/projects/tw-cat-adoption-hub/deploys ，把 `public_site` 資料夾整個拖進頁面上的拖放區即可上線。
- 資料有變（收容所同步、`python apify_latest.py`、管理者修改）之後，重跑 `python publish.py` 再拖放一次，網站才會更新。

## 防止重複
- 同一來源內重複（相同網址、相同內容、相同照片、同聯絡人且資料相同）：匯入時直接略過。
- 不同來源疑似同一隻（例如臉書貼文與收容所同一收容編號、晶片號碼相同、內容或照片相同）：先暫不公開，列入「待確認重複」（網站右上導覽，僅本機可見），由你選「同一隻（合併）」或「不同隻（公開）」，也可復原。

## 檔案
`app.py` 網站與 API（管理用，只在本機）· `publish.py` 產生公開唯讀網站 · `apify_latest.py` 抓最新貼文並上架 · `db.py` 資料庫 · `shelter.py` 收容所同步 · `parser.py` 貼文解析 · `dedupe.py` 重複比對 · `ingest.py` 臉書匯入 · `static/` 前端

## 缺照片的刊登（管理者）
沒有照片的貓（含收容所的貓；收容所的會先自動到官方頁面找，找不到才列入）維持上架，網站導覽列（僅本機可見）會出現「缺照片」與數量，卡片上也有「📷 缺照片」標籤。進入該頁可手動補照片：打開原文，在圖片上按右鍵「複製圖片」，回到頁面點虛線框按 Ctrl+V；也可選擇圖片檔或貼上圖片網址。
轉分享的貼文（reel、粉專貼文）的照片放在 `sharedPost.media`，`apify_fetch.py` 已會一併取出。

## 修改、修改紀錄與合併（管理者）
- **管理者**（只有執行網站的這台電腦）：詳細頁有「✏️ 編輯」可改所有欄位，收容所的貓也一樣（你改過的欄位會被記住，之後的收容所同步不會蓋掉；還原那次修改後才會恢復跟著官方資料更新）；「📜 修改紀錄」與導覽列的「修改紀錄」頁會列出每次修改的改前／改後，每筆都能一鍵還原（還原本身也能再還原）。紀錄只有管理者看得到。
- **重複合併**：「待確認重複」頁兩篇並排，按「保留這篇」選要留哪一篇，另一篇隱藏並顯示為「另有來源」；可勾選把另一篇才有的資料（照片、聯絡方式…）補進保留的這篇；合併隨時可復原。
- 管理者可按頁尾的「以訪客身分預覽」，看一般訪客看到的畫面。
- 目前「管理者」＝連線來自本機（127.0.0.1）。若之後要放到公開網路，需要另外加上管理者登入。
