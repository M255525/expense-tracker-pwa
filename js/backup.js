// 備份/還原：純本機檔案匯出/匯入，不需要任何後端或帳號設定。
// 換手機、或想要一份雲端備份時，使用者自己把匯出的 JSON 檔存到
// Google Drive/Dropbox 等自己已經在用的雲端硬碟資料夾即可——
// 這個 App 本身不連任何雲端服務。

const Backup = (() => {
  async function exportBackup() {
    const entries = await DB.listEntries({ includeDeleted: true });
    const categories = await DB.listCategories({ includeArchived: true });
    const payload = {
      app: 'expense-tracker-pwa',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
      categories,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `隨手記帳備份_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { count: entries.length };
  }

  // 匯入採合併（upsert，以 updatedAt 較新者為準），不是整個覆蓋——
  // 換裝置時目標裝置通常是空的，合併等同完整還原；同裝置重複匯入
  // 舊備份也不會不小心蓋掉之後新增的紀錄。
  async function importBackup(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('這不是有效的備份檔（JSON 格式錯誤）');
    }
    if (!data || !Array.isArray(data.entries)) {
      throw new Error('這不是隨手記帳的備份檔格式');
    }
    if (Array.isArray(data.categories)) {
      for (const cat of data.categories) await DB.putCategory(cat);
    }
    await DB.applyPulledEntries(data.entries);
    return { entryCount: data.entries.length, categoryCount: (data.categories || []).length };
  }

  return { exportBackup, importBackup };
})();

window.Backup = Backup;
