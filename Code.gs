/**
 * 隨手記帳 —— 雲端同步/備份後端。貼到 Google Sheet 的「擴充功能 > Apps Script」，
 * 部署為 Web App 後，把取得的網址填進 App 內「設定 > Apps Script 部署網址」。
 * 完整部署步驟見 SETUP-GUIDE.md。
 *
 * 設計原則沿用本工作區 member-license-gate skill 已驗證過的骨架：
 *   - 用表頭文字比對欄位，不寫死欄位順序（使用者可以自由調整 Sheet 欄位順序）
 *   - LockService 避免多裝置同時寫入互相覆蓋
 *   - doPost 前端呼叫不可加自訂 headers，否則會觸發 CORS 預檢；Apps Script 不回應 OPTIONS
 *   - 測試 doPost 用 Node fetch()，不要用 curl -L（會把 POST 降級成 GET）
 *
 * 這是「推送備份／拉取還原」，不是即時多裝置同步：資料以 updatedAt 較新者為準
 * （last-write-wins），刪除採軟刪除（deleted 欄位 + 更新 updatedAt），
 * 讓 pull 還原時其他裝置也能正確反映刪除。
 */

// 若記帳資料不在第一個工作表，把分頁名稱填在這裡；留空則自動用第一個工作表
const SHEET_NAME = "";

const FIELDS = [
  "id", "type", "amount", "currency", "date", "category", "merchant",
  "sellerTaxId", "invoiceNumber", "note", "source", "itemsJson",
  "createdAt", "updatedAt", "deleted",
];

function doPost(e) {
  let result;
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (payload.action === "push") {
      result = handlePush_(payload.records || []);
    } else if (payload.action === "pull") {
      result = handlePull_(Number(payload.since) || 0);
    } else {
      result = { ok: false, error: "unknown_action" };
    }
  } catch (err) {
    result = { ok: false, error: "server_error", message: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    message: "隨手記帳同步伺服器運作中。請用 POST 傳送 JSON body，例如 {\"action\":\"pull\",\"since\":0}",
  })).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = (SHEET_NAME && ss.getSheetByName(SHEET_NAME)) || ss.getSheets()[0];
  ensureHeader_(sheet);
  return sheet;
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS]);
  }
}

function headerMap_(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  header.forEach((name, i) => { if (name) map[name] = i; });
  return map;
}

function handlePush_(records) {
  if (!records.length) return { ok: true, upserted: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const colMap = headerMap_(sheet);
    const idCol = colMap["id"];
    if (idCol === undefined) return { ok: false, error: "server_error", message: "表頭找不到 id 欄位" };

    const lastRow = sheet.getLastRow();
    const numCols = sheet.getLastColumn();
    const dataRange = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, numCols) : null;
    const data = dataRange ? dataRange.getValues() : [];
    const idToRow = new Map();
    data.forEach((row, i) => idToRow.set(String(row[idCol]), i + 2)); // 1-indexed sheet row

    let upserted = 0;
    for (const record of records) {
      const id = String(record.id || "");
      if (!id) continue;

      const rowValues = new Array(numCols).fill("");
      for (const field of FIELDS) {
        if (colMap[field] === undefined) continue;
        let v = record[field];
        if (field === "itemsJson") v = JSON.stringify(record.items || []);
        else if (field === "deleted") v = !!record.deleted;
        else if (v === undefined || v === null) v = "";
        rowValues[colMap[field]] = v;
      }

      const existingRow = idToRow.get(id);
      if (existingRow) {
        const existingUpdatedAt = Number(sheet.getRange(existingRow, colMap["updatedAt"] + 1).getValue()) || 0;
        if (Number(record.updatedAt) < existingUpdatedAt) continue; // server已較新，跳過
        sheet.getRange(existingRow, 1, 1, numCols).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
        idToRow.set(id, sheet.getLastRow());
      }
      upserted++;
    }
    return { ok: true, upserted };
  } finally {
    lock.releaseLock();
  }
}

function handlePull_(since) {
  const sheet = getSheet_();
  const colMap = headerMap_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, records: [] };

  const numCols = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const records = [];
  for (const row of data) {
    const updatedAt = Number(row[colMap["updatedAt"]]) || 0;
    if (updatedAt <= since) continue;
    const record = {};
    for (const field of FIELDS) {
      if (colMap[field] === undefined) continue;
      record[field] = row[colMap[field]];
    }
    record.amount = Number(record.amount) || 0;
    record.createdAt = Number(record.createdAt) || 0;
    record.updatedAt = updatedAt;
    record.deleted = record.deleted === true || record.deleted === "TRUE" || record.deleted === "true";
    try { record.items = JSON.parse(record.itemsJson || "[]"); } catch (e) { record.items = []; }
    delete record.itemsJson;
    records.push(record);
  }
  return { ok: true, records };
}
