# CLAUDE.md — 隨手記帳 (expense-tracker-pwa)

安卓記帳 PWA：手動記帳 + 台灣電子發票 QR Code 掃描記帳。離線優先（IndexedDB），備份/還原是純本機 JSON 檔匯出/匯入，**沒有任何後端**。**不是 APK**——手機透過 Chrome「加入主畫面」使用，沒有原生打包/發布流程。本機（Windows 開發機）沒有 Java/Android SDK/Gradle/Flutter，這是刻意選擇 PWA 路線的原因。

## 檔案結構

- `index.html` — App 殼層，hash routing 的 SPA，畫面內容由 `js/app.js` 動態組裝
- `js/db.js` — IndexedDB（`expenseTrackerDB` v1）：`entries`/`categories`/`settings` 三個 store 的 CRUD
- `js/invoice-parser.js` — 電子發票 QR 字串解析，可獨立用 Node 測試（不依賴 DOM）
- `js/scanner.js` — 相機擷取 + BarcodeDetector/jsQR 分派
- `js/charts.js` — vanilla SVG 圖表（分類佔比圖、收支趨勢圖），比照 dataviz skill
- `js/backup.js` — 備份匯出（下載 JSON 檔）/ 匯入（合併回 IndexedDB），純本機、無網路呼叫
- `js/app.js` — 路由 + 所有畫面渲染邏輯
- `lib/jsqr.min.js` — 內嵌（非 CDN）的 jsQR 備援解碼器，來源 unpkg `jsqr@1.4.0`，離線快取需要它
- `manual.html` — 使用手冊

## IndexedDB 設計決策

- `entries.id` 用 `crypto.randomUUID()`（client-side 產生），不是自增 ID——這樣本機新增的紀錄和從備份檔匯入回來的紀錄不會撞 ID，匯入時可以直接用 id 比對合併。
- `updatedAt`/`syncedAt` 欄位是從原本規劃的 Apps Script 雲端同步設計留下來的（見下面「已知的範圍縮減」），拿掉雲端同步後對匯出/匯入已經沒有必要，但拆掉這兩個欄位、改寫 `db.js` 的 CRUD 不划算，且 `DB.applyPulledEntries()`（依 `updatedAt` 較新者為準的 upsert）剛好可以原封不動拿來當匯入合併邏輯用，所以保留現狀，不強行清理。
- 刪除是軟刪除（`deleted` 標記 + 更新 `updatedAt`），不是真的從 IndexedDB 移除——這樣匯出備份、之後在別的裝置匯入時，才知道這筆該保持刪除狀態，而不是被誤判成新紀錄重新出現。
- `categories` 不存固定顏色欄位。圖表的分類配色是在 `charts.js` render 當下動態指定（依 `sortOrder` 取前 7 個分類對應固定色版 slot 1-7，其餘全部折進 slot 8「其他」），理由見下面「圖表配色」一節。

## 電子發票 QR 解析（`js/invoice-parser.js`）

欄位順序（77 碼固定寬度表頭 + 冒號分隔延伸欄位）是 2026-08 對照財政部電子發票證明聯 QR Code 規格（v1.8/1.9）的二手文件（含逐欄位解碼的真實範例字串）驗證過的，不是憑記憶硬編。表頭欄位順序：發票號碼(10)+開立日期民國年月日(7)+隨機碼(4)+銷售額十六進位(8)+總計額十六進位(8)+買方統編(8)+賣方統編(8)+加密驗證資訊(24)＝77碼，之後冒號分隔延伸欄位（自用區/品目筆數/編碼參數/品名數量單價...）。

**已知限制**：多品項發票的延伸欄位分組、以及右方品項明細 QR 的格式，只用單一品項的真實範例驗證過，沒有拿多品項的真實發票測試過。如果實際掃描多品項發票時欄位對不上，先檢查 `parseLeftQR()` 裡 `qrItemCount` 之後的 item-triplet 分組邏輯，而不是懷疑表頭那 77 碼（表頭已驗證穩定）。解析失敗一律回傳 `{ok:false, reason}`，UI 導向手動輸入，不會卡住或當機。

## 相機掃描（`js/scanner.js`）

優先用原生 `BarcodeDetector`（只有 Android Chrome/ChromeOS 支援），沒有的話退回內嵌的 `jsQR`。**這台 Windows 開發機的 Chrome 永遠沒有 BarcodeDetector**，所以開發時測試到的一定是 jsQR 路徑；原生路徑只能在真實安卓手機上驗證到。

## Service Worker 快取

`service-worker.js` 的 `CACHE_NAME` 是版本化的（目前 `expense-tracker-v4`）。**改動任何被快取的檔案（`SHELL_FILES` 清單裡的檔案）之後，一定要把 `CACHE_NAME` 升版**，否則手機上的舊快取不會更新——這是本工作區 `ai-course-hub` 已經踩過的坑（改了資料但瀏覽器還吃舊版 JS）。

**光升版 `CACHE_NAME` 還不夠——`install` handler 必須用 `fetch(file, {cache:'reload'})` 而不是直接 `cache.addAll(SHELL_FILES)`。** 這是 2026-08 除錯相機掃描問題時實測踩到的坑：`cache.addAll()`／一般 `fetch()` 會遵守瀏覽器自己的 HTTP 快取判斷，如果使用者裝置上已經有舊版 `js/app.js` 等檔案的 HTTP 快取，就算 `CACHE_NAME` 已經升版、SW 也確實重新安裝了，新的 Cache Storage 裡可能還是被塞進那份「HTTP 層快取住的舊檔案」，版本號升級形同虛設，症狀是「明明部署了新程式碼，手機上還是跑舊版行為」。加上 `{cache:'reload'}` 強迫繞過 HTTP 快取直接打伺服器，才能保證版本升級真的生效。本機測試時也要記得：光重新整理常常還是吃到舊的 SW／HTTP 快取，最保險是每次都 `unregister()` 現有 SW＋清 `caches.keys()` 再重新導覽，或是在網址上加 `?nocache=N` 之類的參數繞過主文件快取（但子資源如 `js/*.js` 不會因為主文件網址變了就跟著繞過，這也是這次除錯時被誤導過的地方）。

`fetch` handler 目前仍保留跨 origin 請求一律 network-only 不快取的防呆邏輯，但這個 App 現在完全沒有任何跨 origin 網路呼叫（拿掉 Apps Script 同步後，`backup.js` 純本機操作），這段邏輯只是預防以後又加了網路呼叫時踩到快取坑，不是目前用得到的路徑。

## 圖表配色（`js/charts.js`）

沿用工作區 `dataviz` skill 的驗證過預設分類色版（8 個 slot，light/dark 都跑過 `validate_palette.js` 全部 PASS）。**顏色指定給「分類身分」，不是「排名」**——每個分類的顏色由 `sortOrder` 決定的固定順序指定（前 7 名各自的 slot 1-7），不會因為某次篩選、某個月分類金額排名變了就重新分配顏色，避免同一個分類在不同月份的報表裡顏色一直變動。超過 7 個有金額的分類，第 8 個以後全部折進「其他」（slot 8），不會生成第 9 種顏色（這是 dataviz skill 的硬性規則：類別色永遠不循環延伸）。

刻意不用任何 CDN 圖表庫（Chart.js 等）——這個 App 要能完全離線使用，CDN script 要嘛需要額外 vendor + 快取版本管理，要嘛離線時直接載入失敗；只有 2 種圖表類型（分類佔比、趨勢），手刻 SVG 成本可接受。

## 備份/還原（`js/backup.js`）

**這個專案原本設計是 Google Sheet + Apps Script 雲端推送備份/拉取還原（沿用 `member-license-gate` skill 的骨架），已在 2026-08 拿掉、換成純本機 JSON 檔匯出/匯入。** 原因：使用者實測後回饋「Apps Script 一般人不會用」——部署步驟（貼程式碼進 Apps Script 編輯器、設定 Web App 存取權限、過 Google OAuth 同意畫面）對非技術背景的使用者來說門檻太高，即使那套骨架本身技術上是可靠、已驗證過的。改成匯出/匯入 JSON 檔之後，不需要任何帳號、部署、程式碼貼上，使用者只要會「下載檔案」「選擇檔案上傳」這兩個手機基本操作即可；代價是失去自動化與即時性——是「按一下才備份/還原」，不會自動同步，換裝置要自己手動搬檔案（例如透過使用者原本就在用的 Google Drive／Dropbox 之類雲端硬碟資料夾）。

匯出：`DB.listEntries({includeDeleted:true})` + `DB.listCategories({includeArchived:true})` 打包成一個 JSON，用 `Blob` + `<a download>` 觸發瀏覽器下載，檔名帶日期。匯入：讀檔案文字 `JSON.parse`，分類直接逐筆 `DB.putCategory`（upsert），紀錄透過 `DB.applyPulledEntries()`（原本為雲端同步寫的、以 `updatedAt` 較新者為準的 upsert 邏輯）合併——這個函式名稱還留著「Pulled」字樣是因為直接沿用原本同步模組的合併邏輯沒有改名，語意上完全通用，不是遺漏。匯入永遠是合併不是覆蓋，所以在全新裝置上匯入等同完整還原，重複匯入同一份備份也不會有副作用。

如果之後又有人想要「真正的自動雲端同步」，可以考慮 Firebase/Firestore 這類設定介面比 Apps Script 友善（網頁主控台點選、貼設定值，不用寫/貼一整段後端程式碼、不用跑「部署 Web App」那套流程）的免費後端，但這不是目前的實作，需要重新設計。

## 預覽

於本資料夾用靜態伺服器預覽（port 見 `.claude/launch.json`，目前登記為 8784）。**相機掃描與 PWA 安裝在區網 `http://` 下測不了**（`getUserMedia`/Service Worker 都需要 HTTPS 或 `localhost`）——列表/新增(手動)/分類/報表/設定等不需要相機的畫面可以在區網下正常測試。

正式部署：GitHub Pages，公開 repo <https://github.com/M255525/expense-tracker-pwa>，網址 <https://m255525.github.io/expense-tracker-pwa/>（`main` 分支 `/` 根目錄）。手機端相機/安裝驗證要用這個網址（已確認是 secure context，`isSecureContext === true`，Service Worker 也已在此 scope 成功註冊）。repo 是公開的，但只有程式碼——記帳資料只存在使用者自己的手機 IndexedDB（與自己另外存放的匯出備份檔），不會出現在 repo 裡。之後改動要記得 `git push`（GitHub Pages 會自動重新部署，通常數十秒內生效），並比照上面「Service Worker 快取」一節的規則升版 `CACHE_NAME`。

## 已知的範圍縮減（非遺漏，是刻意的取捨）

- 沒有做拍照 OCR 記帳（`source:'receipt-photo'` 欄位有保留但沒實作）——電子發票 QR 掃描已經涵蓋主要情境，OCR 準確度不穩定且需要額外服務。
- 沒有真正的自動/即時多裝置同步——已經試過 Google Sheet + Apps Script 版本，但對非技術使用者門檻太高而拿掉，改成手動匯出/匯入 JSON 檔（見上面「備份/還原」一節），這是有意識的取捨，不是還沒做完。
- 圖表沒有實作 dataviz skill 裡「texture fill」這個可選的無障礙管道（CVD/列印/forced-colors 情境的紋理備援）——目前只用「數字直接標籤 + 表格檢視」滿足對比度不足時的 relief 規則，texture 是進一步加強項，非必要。
