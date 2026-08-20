// IndexedDB layer for 隨手記帳.
// Single DB, three object stores: entries / categories / settings.
// No sync queue table: "dirty" == updatedAt > (syncedAt || 0), computed on demand.

const DB_NAME = 'expenseTrackerDB';
const DB_VERSION = 1;

// Categories intentionally carry no fixed color: charts assign the 8-slot
// categorical palette dynamically per render (see js/charts.js) so two
// categories never collide when both happen to appear in the same chart,
// and a chart with >8 active categories folds the smallest into "其他".
// parentId: null 代表這是「大分類」；非 null（指向另一筆 categories.id）代表這是
// 某個大分類底下的「子分類」。只支援兩層（子分類不會再有自己的子分類）。
const DEFAULT_CATEGORIES = [
  // expense
  { id: 'exp-food', type: 'expense', name: '餐飲', icon: '🍜', sortOrder: 1, isDefault: true, archived: false, parentId: null },
  { id: 'exp-transport', type: 'expense', name: '交通', icon: '🚗', sortOrder: 2, isDefault: true, archived: false, parentId: null },
  { id: 'exp-shopping', type: 'expense', name: '購物', icon: '🛍️', sortOrder: 3, isDefault: true, archived: false, parentId: null },
  { id: 'exp-daily', type: 'expense', name: '日用品', icon: '🧴', sortOrder: 4, isDefault: true, archived: false, parentId: null },
  { id: 'exp-medical', type: 'expense', name: '醫療', icon: '💊', sortOrder: 5, isDefault: true, archived: false, parentId: null },
  { id: 'exp-entertainment', type: 'expense', name: '娛樂', icon: '🎬', sortOrder: 6, isDefault: true, archived: false, parentId: null },
  { id: 'exp-education', type: 'expense', name: '教育', icon: '📚', sortOrder: 7, isDefault: true, archived: false, parentId: null },
  { id: 'exp-housing', type: 'expense', name: '居住(房租)', icon: '🏠', sortOrder: 8, isDefault: true, archived: false, parentId: null },
  { id: 'exp-utilities', type: 'expense', name: '水電瓦斯', icon: '💡', sortOrder: 9, isDefault: true, archived: false, parentId: null },
  { id: 'exp-comm', type: 'expense', name: '通訊', icon: '📱', sortOrder: 10, isDefault: true, archived: false, parentId: null },
  { id: 'exp-insurance', type: 'expense', name: '保險', icon: '🛡️', sortOrder: 11, isDefault: true, archived: false, parentId: null },
  { id: 'exp-other', type: 'expense', name: '其他', icon: '📦', sortOrder: 12, isDefault: true, archived: false, parentId: null },
  // income
  { id: 'inc-salary', type: 'income', name: '薪資', icon: '💰', sortOrder: 1, isDefault: true, archived: false, parentId: null },
  { id: 'inc-bonus', type: 'income', name: '獎金', icon: '🎁', sortOrder: 2, isDefault: true, archived: false, parentId: null },
  { id: 'inc-invest', type: 'income', name: '投資收益', icon: '📈', sortOrder: 3, isDefault: true, archived: false, parentId: null },
  { id: 'inc-other', type: 'income', name: '其他收入', icon: '➕', sortOrder: 4, isDefault: true, archived: false, parentId: null },
];

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;

      if (!db.objectStoreNames.contains('entries')) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('date', 'date');
        entries.createIndex('category', 'category');
        entries.createIndex('type', 'type');
        entries.createIndex('invoiceNumber', 'invoiceNumber');
        entries.createIndex('updatedAt', 'updatedAt');
      }

      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = async () => {
      const db = req.result;
      // Seed default categories on first run (empty store).
      const tx = db.transaction('categories', 'readonly');
      const countReq = tx.objectStore('categories').count();
      countReq.onsuccess = async () => {
        if (countReq.result === 0) {
          await seedDefaultCategories(db);
        }
        resolve(db);
      };
      countReq.onerror = () => reject(countReq.error);
    };

    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function seedDefaultCategories(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite');
    const store = tx.objectStore('categories');
    for (const cat of DEFAULT_CATEGORIES) store.put(cat);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- entries ----

async function putEntry(entry) {
  const db = await openDB();
  const now = Date.now();
  const record = {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    createdAt: entry.createdAt || now,
    updatedAt: now,
    deleted: !!entry.deleted,
  };
  const tx = db.transaction('entries', 'readwrite');
  tx.objectStore('entries').put(record);
  await txDone(tx);
  return record;
}

async function softDeleteEntry(id) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  const existing = await reqPromise(store.get(id));
  if (existing) {
    existing.deleted = true;
    existing.updatedAt = Date.now();
    store.put(existing);
  }
  await txDone(tx);
}

async function getEntry(id) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  return reqPromise(tx.objectStore('entries').get(id));
}

async function findEntryByInvoiceNumber(invoiceNumber) {
  if (!invoiceNumber) return null;
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  const idx = tx.objectStore('entries').index('invoiceNumber');
  const all = await reqPromise(idx.getAll(invoiceNumber));
  return all.find((e) => !e.deleted) || null;
}

async function listEntries({ from, to, category, type, includeDeleted = false } = {}) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  let all = await reqPromise(tx.objectStore('entries').getAll());
  if (!includeDeleted) all = all.filter((e) => !e.deleted);
  if (from) all = all.filter((e) => e.date >= from);
  if (to) all = all.filter((e) => e.date <= to);
  if (category) all = all.filter((e) => e.category === category);
  if (type) all = all.filter((e) => e.type === type);
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return all;
}

async function listDirtyEntries() {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  const all = await reqPromise(tx.objectStore('entries').getAll());
  return all.filter((e) => e.updatedAt > (e.syncedAt || 0));
}

async function markSynced(ids, syncedAt) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  for (const id of ids) {
    const rec = await reqPromise(store.get(id));
    if (rec) {
      rec.syncedAt = syncedAt;
      store.put(rec);
    }
  }
  await txDone(tx);
}

// Upsert a batch pulled from the server, last-write-wins by updatedAt.
async function applyPulledEntries(records) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readwrite');
  const store = tx.objectStore('entries');
  for (const remote of records) {
    const local = await reqPromise(store.get(remote.id));
    if (!local || remote.updatedAt > local.updatedAt) {
      store.put({ ...remote, syncedAt: remote.updatedAt });
    }
  }
  await txDone(tx);
}

// ---- categories ----

// parentId：不傳（undefined）＝不依層級篩選（回傳大分類＋子分類混在一起，供
// catById 這類需要查全部分類的地方使用）；傳 null＝只回傳大分類；傳某筆分類
// id＝只回傳該大分類底下的子分類。
async function listCategories({ type, includeArchived = false, parentId } = {}) {
  const db = await openDB();
  const tx = db.transaction('categories', 'readonly');
  let all = await reqPromise(tx.objectStore('categories').getAll());
  if (!includeArchived) all = all.filter((c) => !c.archived);
  if (type) all = all.filter((c) => c.type === type);
  if (parentId !== undefined) all = all.filter((c) => (c.parentId ?? null) === parentId);
  all.sort((a, b) => a.sortOrder - b.sortOrder);
  return all;
}

async function putCategory(category) {
  const db = await openDB();
  const record = { id: category.id || crypto.randomUUID(), archived: false, sortOrder: 999, parentId: null, ...category };
  const tx = db.transaction('categories', 'readwrite');
  tx.objectStore('categories').put(record);
  await txDone(tx);
  return record;
}

// 封存大分類時一併封存底下所有子分類（避免「大分類被封存看不到、子分類卻
// 還留在新增分類的選單裡」這種孤兒狀態）；封存子分類則只影響它自己。
async function archiveCategory(id) {
  const db = await openDB();
  const tx = db.transaction('categories', 'readwrite');
  const store = tx.objectStore('categories');
  const existing = await reqPromise(store.get(id));
  if (existing) {
    existing.archived = true;
    store.put(existing);
    const all = await reqPromise(store.getAll());
    for (const c of all) {
      if ((c.parentId ?? null) === id && !c.archived) {
        c.archived = true;
        store.put(c);
      }
    }
  }
  await txDone(tx);
}

// 取消封存：跟 archiveCategory 對稱，還原大分類時一併還原底下曾被連帶封存
// 的子分類（避免「大分類復原了、子分類卻還是封存看不到」的孤兒狀態）；
// 還原子分類則只影響它自己。
async function unarchiveCategory(id) {
  const db = await openDB();
  const tx = db.transaction('categories', 'readwrite');
  const store = tx.objectStore('categories');
  const existing = await reqPromise(store.get(id));
  if (existing) {
    existing.archived = false;
    store.put(existing);
    if (!existing.parentId) {
      const all = await reqPromise(store.getAll());
      for (const c of all) {
        if ((c.parentId ?? null) === id && c.archived) {
          c.archived = false;
          store.put(c);
        }
      }
    }
  }
  await txDone(tx);
}

// 真的從 categories store 移除（跟 archiveCategory 的隱藏不同）。呼叫前應該
// 先用 listEntries({category:id}) 檢查還有沒有紀錄在用這個分類——刪除本身
// 不會動那些紀錄，UI 端（entry-icon/entry-title）已經有「分類不存在時顯示
// 未分類」的容錯，所以就算刪掉還在用的分類也不會壞掉，只是歷史紀錄會變成
// 未分類，這個取捨要在呼叫端用確認對話框讓使用者知情。
// 刪除大分類會連同底下的子分類一併刪除（兩層而已，不用遞迴）。
async function deleteCategory(id) {
  const db = await openDB();
  const tx = db.transaction('categories', 'readwrite');
  const store = tx.objectStore('categories');
  const all = await reqPromise(store.getAll());
  for (const c of all) {
    if ((c.parentId ?? null) === id) store.delete(c.id);
  }
  store.delete(id);
  await txDone(tx);
}

// ---- settings ----

async function getSetting(key) {
  const db = await openDB();
  const tx = db.transaction('settings', 'readonly');
  const rec = await reqPromise(tx.objectStore('settings').get(key));
  return rec ? rec.value : undefined;
}

async function setSetting(key, value) {
  const db = await openDB();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await txDone(tx);
}

window.DB = {
  openDB,
  putEntry,
  softDeleteEntry,
  getEntry,
  findEntryByInvoiceNumber,
  listEntries,
  listDirtyEntries,
  markSynced,
  applyPulledEntries,
  listCategories,
  putCategory,
  archiveCategory,
  unarchiveCategory,
  deleteCategory,
  getSetting,
  setSetting,
  DEFAULT_CATEGORIES,
};
