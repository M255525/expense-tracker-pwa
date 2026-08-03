// Client for the Code.gs Apps Script backend (push dirty entries, pull
// remote changes). Network-only, never touches the service worker cache —
// see the fetch-handler exclusion in service-worker.js.

const Sync = (() => {
  async function getEndpoint() {
    return DB.getSetting('syncEndpoint');
  }

  // No custom headers / no non-simple content-type, so this stays a CORS
  // "simple request" and never triggers an OPTIONS preflight against
  // Apps Script (which does not handle OPTIONS).
  async function callEndpoint(action, payload) {
    const url = await getEndpoint();
    if (!url) throw new Error('尚未設定同步網址');
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) throw new Error(`同步失敗 (HTTP ${res.status})`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '同步失敗');
    return json;
  }

  async function push() {
    const dirty = await DB.listDirtyEntries();
    if (dirty.length === 0) return { pushed: 0 };
    const records = dirty.map(({ syncedAt, ...rest }) => rest);
    const res = await callEndpoint('push', { records });
    const now = Date.now();
    await DB.markSynced(dirty.map((e) => e.id), now);
    return { pushed: dirty.length, serverResult: res };
  }

  async function pull() {
    const since = (await DB.getSetting('lastPullAt')) || 0;
    const res = await callEndpoint('pull', { since });
    if (res.records && res.records.length) {
      await DB.applyPulledEntries(res.records);
    }
    await DB.setSetting('lastPullAt', Date.now());
    return { pulled: (res.records || []).length };
  }

  // Full restore for a new device: ignores local lastPullAt, requests everything.
  async function restoreAll() {
    const res = await callEndpoint('pull', {});
    if (res.records && res.records.length) {
      await DB.applyPulledEntries(res.records);
    }
    await DB.setSetting('lastPullAt', Date.now());
    return { pulled: (res.records || []).length };
  }

  async function syncNow() {
    const pushResult = await push();
    const pullResult = await pull();
    await DB.setSetting('lastSyncAt', Date.now());
    return { ...pushResult, ...pullResult };
  }

  return { push, pull, restoreAll, syncNow };
})();

window.Sync = Sync;
