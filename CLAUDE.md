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

## 頂部跑馬燈（2026-08-05 新增）

`#marqueeBar` 顯示跟工作區其他工具（`ai-video-studio` 主版等）共用同一份 Google Sheet 維護的公告內容，同一個授權伺服器 Apps Script 網址（`AKfycbwKX0.../exec`）。這個 App **沒有序號登入機制**，所以做法是頁面載入時直接 POST 一個空序號給該網址——`doPost` 不論序號是否有效都會附上 `marquee` 陣列，前端只取這個欄位，忽略 `valid`/`reason`。`localStorage` key 為 `etpMarquee`，先讀快取立即顯示、再背景 fetch，每 20 分鐘重抓一次；抓取失敗靜默忽略（`catch(()=>{})`），不影響原本離線優先的記帳功能。跑馬燈維護方式：直接編輯共用的 Google Sheet 內容即可，不需要重新部署這個 App。

**版面整合方式跟其他工具不同，是刻意的**：`#app` 是 `min-height:100vh` 的 flex column、`main` 自己 `overflow-y:auto` 內部捲動（body/window 本身不捲動），跟 `ai-video-studio` 那種單純頁面用 `position:fixed` + `body` 加 `padding-top` 的做法不一樣——這裡把 `#marqueeBar` 插進 `#app` 內、當 `header.topbar` 前面的一個普通 flex item（`flex:0 0 auto`），讓 flexbox 自然把 `header`／`main` 往下推。`header.topbar` 本身是 `position:sticky;top:0`，但因為它的捲動祖先（window）從不實際捲動，插入跑馬燈只是改變它在 flow 裡的靜態位置，不需要額外調整 sticky 的 `top` 偏移量。

改了 `index.html`／`css/app.css`／`js/app.js` 之後記得比照「Service Worker 快取」一節升版 `CACHE_NAME`（已因這次改動升到 `expense-tracker-v9`）。

## 設定頁「關於」區塊（2026-08-05 新增）

`js/app.js` 的 `renderSettings()` 最下面新增「關於」卡片：使用警語（僅供個人記帳與教學示範使用、資料僅存本機不上傳）＋「創作者：蔡豐全（Mark Tsai）」，比照工作區其他單檔工具（如 `Dashboard/index.html`）的 footer 慣例，但這裡放在設定頁而不是每個畫面都顯示的固定 footer——手機版面寸土寸金，且這個 App 是 hash routing 多畫面 SPA，不像其他工具是單頁工具、footer 只需顯示一次。

## 兩層分類：大分類／子分類（2026-08-17 新增）

`categories` store 新增 `parentId` 欄位：`null`＝大分類，指向另一筆 categories.id＝該大分類底下的子分類。**只支援兩層**（子分類不會再有自己的子分類），`db.js` 的 `archiveCategory`/`deleteCategory` 都是直接找 `parentId===id` 做一層 cascade，沒有寫成遞迴。舊資料（改動前就存在的 IndexedDB 紀錄）沒有 `parentId` 欄位，`listCategories({parentId})` 用 `(c.parentId ?? null)` 相容處理，等同自動把既有分類全部視為大分類——不需要額外的資料庫升版/遷移腳本。

- `DB.listCategories({type, includeArchived, parentId})`：`parentId` 不傳＝不篩層級（回傳大分類＋子分類混在一起，`catById` 這類需要查全部分類的地方用這個）；傳 `null`＝只回傳大分類；傳某筆分類 id＝只回傳它底下的子分類。
- **封存/刪除大分類會連同底下子分類 cascade**：封存是遞迴標記 `archived=true`（避免「大分類被封存看不到，子分類卻還留在新增選單」的孤兒狀態）；刪除是先刪子分類再刪自己。UI 端（`renderCategories()` 的刪除按鈕）會把父＋子的 `DB.listEntries({category})` 使用數合併算，警告文字會明確告知「會一併刪除底下 N 個子分類」。
- **`分類管理」畫面（`renderCategories()`）**：依 `type`（支出/收入）各自一個 `.card`，裡面依序是「大分類列＋它底下的子分類列（縮排＋左側層級線 `.cat-manage-row-child`）＋這個大分類專屬的『+ 新增子分類』小表單（`.cat-add-sub`）」，一個大分類接一個大分類往下排。子分類列多一個「移至…」下拉選單（`reparentOptions`，排除自己所屬的大分類），選了就直接把該子分類的 `parentId` 改掉——這是「調整大分類內部的分類」的具體實作。大分類與子分類都有「編輯」按鈕，用兩個接續的 `prompt()`（名稱、emoji）就地修改，不用刪除重建（會遺失 `sortOrder`／`archived` 歷史）。頁面最下方原本的「新增分類」表單改名為「新增大分類」，強制 `parentId: null`。
- **記帳表單（`buildForm()`/`refreshCategoryChips()`）**：分類 chip 分兩排——第一排永遠是大分類（`chipGrid`），選了大分類就直接把 `draft.category` 設成大分類 id（可直接存檔，子分類是選填的細分）；如果該大分類底下有子分類，第二排（`subChipGrid`）才會出現讓使用者選填更精確的子分類，選了就把 `draft.category` 改成子分類 id。大分類 chip 的「已選取」樣式會在「選了它本身」或「選了它任一個子分類」時都亮起，讓使用者一眼看出目前歸在哪個大分類底下。
- **列表頁分類篩選 rollup（`renderList()`）**：篩選下拉選單（`buildCategoryFilterOptions()`）大分類在前、子分類縮排（`　└`）跟在後面列出，兩者都可以單獨被選為篩選條件。**篩選大分類時要把底下所有子分類的紀錄也一起算進來**（`matchIds` 集合），不然選「餐飲」卻看不到被記到「早餐」子分類的紀錄，使用者會誤以為資料不見了；篩選子分類則是精確比對。這段 rollup 邏輯特意留在 `app.js`（不是 `db.js` 的 `listEntries()`），因為它需要先知道分類的父子關係才能算，`db.js` 保持通用不耦合這個階層概念。
- **報表甜甜圈圖 rollup（`renderReports()`）**：圖表固定依「大分類」層級彙總，不會因為使用者把某些紀錄記到子分類就把圖切得更細碎——用新增的 `topCategoryId(catId, catById)` 輔助函式（沿著 `parentId` 往上找到頂層 id）把要送進 `Charts.renderCategoryDonut()` 的 `entries` 逐筆重寫 `category` 欄位成頂層 id，`categories` 參數也只傳大分類清單（給圖表的配色 slot 分配／圖例名稱查詢用）。子分類層級的明細仍看得到——去列表頁用分類篩選挑到子分類即可。
- **emoji 選擇面板（`buildIconField()`）**：新增大分類／新增子分類／編輯（`prompt()` 版）三處共用同一組 `EMOJI_CHOICES`（約 60 個，涵蓋食衣住行育樂＋收支常見情境）；輸入框旁邊的「選圖示」按鈕點開一個可捲動的 grid（`.emoji-grid`／`.emoji-choice`），點一下 emoji 直接填進輸入框並收合，不用使用者自己打得出特殊符號；輸入框本身仍保留手動輸入能力（emoji 清單畢竟不可能窮舉，想用清單外的符號還是打得進去）。
- **驗證方式**：本機沒有裝置可用真機測試，改用 `python -m http.server 8784` 起服務＋Chrome 直接對 `window.DB`／DOM 下手（`javascript_tool` 呼叫 `DB.listCategories()`／模擬點擊按鈕），涵蓋：新增大分類／新增子分類（icon 預設繼承父層）／「移至」重新掛靠／`prompt()` 版編輯改名／cascade 封存（父子一起變 `archived:true`）／cascade 刪除（警告文字正確算出子分類數與合併後的使用中紀錄數，刪除後父子都消失、原本用該分類的紀錄正確退回「未分類」不當機）／記帳表單子分類 chip 出現與選取態同步／列表頁依大分類篩選能撈到子分類紀錄（rollup）／報表甜甜圈圖依大分類彙總（子分類紀錄的金額算進母分類那一塊，不會多切一塊）。全程 console 無錯誤。改用 `window.confirm`/`window.prompt` 的 stub 版本（直接回傳 `true`/預設值）繞過原生對話框，避免卡住自動化流程。
- 改動後已依專案既有規則把 `service-worker.js` 的 `CACHE_NAME` 升版（`v9` → `v10`），否則手機上舊的 Cache Storage 快取不會更新到含新分類管理邏輯的 `js/app.js`／`js/db.js`／`css/app.css`。

### 分類管理畫面補上「取消封存」（2026-08-18 新增）

原本 `renderCategories()` 的 `refresh()` 用 `DB.listCategories({type})`（未傳 `includeArchived`），封存後的分類會直接從管理畫面消失，沒有任何入口能再看到它或還原——等於「封存」形同「刪不掉但也管不到」的死路，這是使用者實際回報想「對原有新增分類進行管理」時發現的缺口。修法：

- `db.js` 新增 `DB.unarchiveCategory(id)`，跟 `archiveCategory` 對稱：還原大分類時一併還原底下曾被連帶封存的子分類（避免大分類復原了、子分類卻還封存看不到的孤兒狀態）；還原子分類則只影響它自己。
- `renderCategories()` 改成 `DB.listCategories({type, includeArchived:true})`，已封存的分類會繼續顯示在原本所屬大分類底下（`archived` 是逐筆欄位，不影響父子分組邏輯），列名加註「（已封存）」並用透明度區分。
- 已封存的列**只留「取消封存」＋「刪除」兩個按鈕**，隱藏 ↑↓ 排序／編輯／移至（因為封存分類已經不在 `siblings`／`reparentOptions` 這些「僅未封存」的清單裡，index 會是 -1，硬留著排序按鈕會誤觸到別的未封存分類）；「新增子分類」小表單也只在大分類未封存時才顯示。
- 用 `python -m http.server 8784` + `javascript_tool` 直接對 `window.DB` 驗證過：cascade 封存（大分類＋子分類一起 `archived:true`）→ 畫面正確顯示兩列「已封存」＋「取消封存」按鈕 → 點大分類的「取消封存」→ 大分類與子分類一起 `archived:false`、UI 立刻恢復完整控制項（↑↓／編輯／移至／封存／刪除）。全程 console 無錯誤。
- 已依規則升版 `CACHE_NAME`（`v10` → `v11`）。

### 報表頁每日收支表格常駐顯示 + 修正日期偏移 bug（2026-08-20 新增）

使用者反映「總覽/報表」的每日收支，表格數據要跟略圖（長條圖）吻合、且可查詢。追查後發現兩件事：

- `renderReports()` 組每日資料時用 `cursor.toISOString().slice(0,10)` 取得該天的 ISO 日期字串去比對 `entries`，但 `toISOString()` 是轉成 UTC，而本 App 的目標時區是 Asia/Taipei（UTC+8）——本機測試（時區 Asia/Taipei）驗證到：8/1 的紀錄實際被歸類顯示在標籤「2」底下，全月每一天都對不上（整體偏移 +1 天）。KPI 總額（收入/支出/淨額）因為是直接加總全部 entries、不經過這段逐日迴圈，所以總額本身沒錯，只有「表格分到哪一天」錯了——這也是為什麼使用者會覺得「表格數字」和「略表（KPI/圖表）」對不上。修法是改用跟 `todayISO()`／`currentMonthStr()` 一致的本地時間手動組字串（`getFullYear()`/`getMonth()`/`getDate()`），不再經過 UTC 轉換。
- `js/charts.js` 的 `renderTrendChart()` 原本把每日表格放在「顯示表格」按鈕後面預設收合（`buildTableToggle()`）。改成 `buildTableToggle(rows, headers, {alwaysVisible:true})`：新增 `alwaysVisible` 選項，`renderTrendChart` 傳 `true` 讓每日表格直接常駐顯示在長條圖下方（可以直接對照查詢，不用多點一下）；`renderCategoryDonut()` 的分類明細表格維持原本「點按鈕才展開」不變，兩者共用同一個 `buildTableToggle()` 函式。
- 驗證方式：`python -m http.server 8784` + `javascript_tool` 直接 `DB.putEntry()` 塞測試紀錄（8/1 收入500+支出120、8/3 支出80、8/5 支出300）進 IndexedDB，確認 KPI 總額（收入500/支出500）與常駐表格逐日列（標籤1/3/5，不是修法前錯位的2/4/6）完全吻合後，用 `DB.softDeleteEntry()` 清掉測試資料。測試時也踩到專案已知的 SW/HTTP 快取坑（`CACHE_NAME` 升版＋`unregister()`＋清 `caches.keys()` 都做了，畫面仍跑舊碼，最後是子資源 `js/app.js` 被瀏覽器 HTTP 快取卡住，換一個新分頁重新導覽才吃到新版）。
- 已依規則升版 `CACHE_NAME`（`v11` → `v12`）。

## 已知的範圍縮減（非遺漏，是刻意的取捨）

- 沒有做拍照 OCR 記帳（`source:'receipt-photo'` 欄位有保留但沒實作）——電子發票 QR 掃描已經涵蓋主要情境，OCR 準確度不穩定且需要額外服務。
- 沒有真正的自動/即時多裝置同步——已經試過 Google Sheet + Apps Script 版本，但對非技術使用者門檻太高而拿掉，改成手動匯出/匯入 JSON 檔（見上面「備份/還原」一節），這是有意識的取捨，不是還沒做完。
- 圖表沒有實作 dataviz skill 裡「texture fill」這個可選的無障礙管道（CVD/列印/forced-colors 情境的紋理備援）——目前只用「數字直接標籤 + 表格檢視」滿足對比度不足時的 relief 規則，texture 是進一步加強項，非必要。
