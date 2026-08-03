// IndexedDB layer for 隨手記帳.
// Single DB, three object stores: entries / categories / settings.
// No sync queue table: "dirty" == updatedAt > (syncedAt || 0), computed on demand.

const DB_NAME = 'expenseTrackerDB';
const DB_VERSION = 1;

// Categories intentionally carry no fixed color: charts assign the 8-slot
// categorical palette dynamically per render (see js/charts.js) so two
// categories never collide when both happen to appear in the same chart,
// and a chart with >8 active categories folds the smallest into "其他".
const DEFAULT_CATEGORIES = [
  // expense
  { id: 'exp-food', type: 'expense', name: '餐飲', icon: '🍜', sortOrder: 1, isDefault: true, archived: false },
  { id: 'exp-transport', type: 'expense', name: '交通', icon: '🚗', sortOrder: 2, isDefault: true, archived: false },
  { id: 'exp-shopping', type: 'expense', name: '購物', icon: '🛍️', sortOrder: 3, isDefault: true, archived: false },
  { id: 'exp-daily', type: 'expense', name: '日用品', icon: '🧴', sortOrder: 4, isDefault: true, archived: false },
  { id: 'exp-medical', type: 'expense', name: '醫療', icon: '💊', sortOrder: 5, isDefault: true, archived: false },
  { id: 'exp-entertainment', type: 'expense', name: '娛樂', icon: '🎬', sortOrder: 6, isDefault: true, archived: false },
  { id: 'exp-education', type: 'expense', name: '教育', icon: '📚', sortOrder: 7, isDefault: true, archived: false },
  { id: 'exp-housing', type: 'expense', name: '居住(房租)', icon: '🏠', sortOrder: 8, isDefault: true, archived: false },
  { id: 'exp-utilities', type: 'expense', name: '水電瓦斯', icon: '💡', sortOrder: 9, isDefault: true, archived: false },
  { id: 'exp-comm', type: 'expense', name: '通訊', icon: '📱', sortOrder: 10, isDefault: true, archived: false },
  { id: 'exp-insurance', type: 'expense', name: '保險', icon: '🛡️', sortOrder: 11, isDefault: true, archived: false },
  { id: 'exp-other', type: 'expense', name: '其他', icon: '📦', sortOrder: 12, isDefault: true, archived: false },
  // income
  { id: 'inc-salary', type: 'income', name: '薪資', icon: '💰', sortOrder: 1, isDefault: true, archived: false },
  { id: 'inc-bonus', type: 'income', name: '獎金', icon: '🎁', sortOrder: 2, isDefault: true, archived: false },
  { id: 'inc-invest', type: 'income', name: '投資收益', icon: '📈', sortOrder: 3, isDefault: true, archived: false },
  { id: 'inc-other', type: 'income', name: '其他收入', icon: '➕', sortOrder: 4, isDefault: true, archived: false },
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

async function listCategories({ type, includeArchived = false } = {}) {
  const db = await openDB();
  const tx = db.transaction('categories', 'readonly');
  let all = await reqPromise(tx.objectStore('categories').getAll());
  if (!includeArchived) all = all.filter((c) => !c.archived);
  if (type) all = all.filter((c) => c.type === type);
  all.sort((a, b) => a.sortOrder - b.sortOrder);
  return all;
}

async function putCategory(category) {
  const db = await openDB();
  const record = { id: category.id || crypto.randomUUID(), archived: false, sortOrder: 999, ...category };
  const tx = db.transaction('categories', 'readwrite');
  tx.objectStore('categories').put(record);
  await txDone(tx);
  return record;
}

async function archiveCategory(id) {
  const db = await openDB();
  const tx = db.transaction('categories', 'readwrite');
  const store = tx.objectStore('categories');
  const existing = await reqPromise(store.get(id));
  if (existing) {
    existing.archived = true;
    store.put(existing);
  }
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
  getSetting,
  setSetting,
  DEFAULT_CATEGORIES,
};
