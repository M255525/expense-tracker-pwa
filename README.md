# 隨手記帳

台灣電子發票 QR Code 掃描記帳 ＋ 手動記帳的離線優先 PWA（Progressive Web App）。

🔗 **線上使用**：<https://m255525.github.io/expense-tracker-pwa/>

## 這是什麼

手機記帳工具，不需要下載安裝 APK——用手機瀏覽器開啟網址、加入主畫面即可像一般 App 一樣使用。除了一般手動輸入外，也可以直接用相機掃描台灣電子發票上的 QR Code，自動把金額、日期、發票號碼等資訊帶入記帳表單。

所有記帳資料只存在使用者自己的手機瀏覽器（IndexedDB），不連任何雲端服務、不需要註冊帳號。

## 功能

- **手動記帳**：支出/收入、自訂分類（emoji 圖示、可新增/排序/封存/刪除）、商家、備註
- **電子發票 QR 掃描記帳**：對準發票左側 QR Code，自動解析金額、日期、發票號碼、賣方統編、品項明細
- **列表**：依日期分組、篩選（類型/分類）、文字搜尋、多選批次刪除
- **報表**：月份選擇、收入/支出/淨額 KPI、分類佔比圖、每日收支趨勢圖（皆可切換顯示表格）
- **備份/還原**：匯出/匯入 JSON 備份檔，自行保管於 Google Drive/Dropbox 等雲端硬碟或傳給自己，不需要任何後端或帳號設定
- **離線優先**：安裝後除了相機掃描，其餘功能（記帳、查詢、報表、備份）完全不需要網路連線
- **PWA**：可加入手機主畫面，獨立視窗模式（無瀏覽器網址列）

## 怎麼用

1. 用手機 Chrome 開啟 <https://m255525.github.io/expense-tracker-pwa/>
2. 瀏覽器選單裡的「加入主畫面」，或 App 內「設定」頁籤的「加入主畫面」按鈕
3. 底部「新增」記帳，或用「📷 掃描電子發票 QR Code」掃發票
4. 「設定」頁籤可以匯出備份檔、或匯入備份檔還原資料

詳細操作說明（含常見問題）見 [manual.html](https://m255525.github.io/expense-tracker-pwa/manual.html)。

## 技術架構

純前端 PWA，**沒有任何建置流程、框架、npm 依賴**（`lib/jsqr.min.js` 是唯一的第三方函式庫，直接內嵌檔案而非透過 CDN 載入，以確保離線可用）：

| 項目 | 做法 |
|---|---|
| 資料儲存 | IndexedDB（本機） |
| 離線快取 | Service Worker，版本化 `CACHE_NAME` |
| QR 解碼 | `BarcodeDetector` API（Android Chrome/ChromeOS）優先，[jsQR](https://github.com/cozmo/jsQR) 備援 |
| 發票格式解析 | 財政部電子發票證明聯 QR Code 規格（見 `js/invoice-parser.js` 內註解） |
| 圖表 | 手刻 SVG（無 CDN 圖表庫），色版通過色盲安全性驗證 |
| 備份 | `Blob` + `<a download>` 匯出 JSON，匯入採合併（以更新時間較新者為準） |

## 本機開發

不需要任何建置工具或安裝依賴，純靜態檔案：

```bash
git clone https://github.com/M255525/expense-tracker-pwa.git
cd expense-tracker-pwa
python -m http.server 8000
```

開啟 `http://localhost:8000`。

> ⚠️ 相機掃描與 PWA 安裝功能都需要安全連線環境（`https://` 或 `localhost`）。用 `localhost` 本機測試相機功能沒問題；但如果改用區網 IP（例如手機連到電腦的 `http://192.168.x.x:8000`）存取，相機會無法使用。

`js/invoice-parser.js` 是唯一不依賴瀏覽器 DOM 的模組，可以直接用 Node 測試：

```bash
node -e "const {parseInvoiceQR}=require('./js/invoice-parser.js'); console.log(parseInvoiceQR('...'))"
```

## 檔案結構

```
index.html            App 殼層（hash routing 的單頁應用）
manifest.json          PWA manifest
service-worker.js       離線快取（cache-first，版本化）
css/app.css
js/
  db.js                  IndexedDB CRUD（entries / categories / settings）
  invoice-parser.js       電子發票 QR 字串解析
  scanner.js              相機擷取 + QR 解碼（BarcodeDetector / jsQR）
  charts.js               手刻 SVG 圖表
  backup.js                備份匯出/匯入
  app.js                   路由 + 畫面渲染
lib/jsqr.min.js            內嵌的 jsQR 備援解碼器
icons/                     PWA 圖示
manual.html                使用手冊
CLAUDE.md                  開發筆記／架構決策紀錄
```

## 隱私與資料

本 repo 公開的只有程式碼，**不含任何使用者的個人記帳資料**。記帳資料只存在使用者自己的手機瀏覽器裡，這個 App 不會把資料傳到任何伺服器；備份檔（匯出的 JSON）要存去哪裡完全由使用者自己決定與保管。

## 已知限制

- 電子發票 QR 解析的表頭欄位已用真實範例驗證，但多品項發票的品項欄位分組尚未拿真實多品項發票測試過
- `BarcodeDetector` 原生解碼只有 Android Chrome/ChromeOS 支援，其他瀏覽器（含桌面版 Chrome）一律走 jsQR 備援路徑
- 沒有拍照 OCR 記帳功能（只支援電子發票 QR Code 掃描 + 手動輸入）
- 備份/還原是手動觸發的匯出/匯入，不是即時多裝置自動同步

## 授權/用途

個人記帳與課程教學使用。
