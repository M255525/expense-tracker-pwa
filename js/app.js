// App shell: hash routing + view rendering. No framework/build step —
// views are built with plain DOM calls; textContent is used for any
// user-entered string (merchant/note/category name) to avoid XSS.

const $main = document.getElementById('main');
const $topbarTitle = document.getElementById('topbar-title');
const $topbarAction = document.getElementById('topbar-action');

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
});

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children || []) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const from = `${monthStr}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function fmtTWD(n) {
  const sign = n < 0 ? '-' : '';
  return sign + 'NT$' + Math.abs(Math.round(n)).toLocaleString('zh-TW');
}

function toast(msg) {
  const t = el('div', { class: 'toast' }, [msg]);
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function weekdayLabel(dateStr) {
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  const d = new Date(dateStr + 'T00:00:00');
  return `週${days[d.getDay()]}`;
}

// 兩層分類：子分類的 parentId 指向大分類；大分類自己 parentId 是 null。
// 把任一分類 id 一路往上解析到最頂層大分類 id（用於報表圖表要依大分類彙總時）。
function topCategoryId(catId, catById) {
  const c = catById.get(catId);
  if (!c) return catId;
  return c.parentId ? topCategoryId(c.parentId, catById) : c.id;
}

// 分類圖示挑選面板用的常見 emoji（涵蓋食衣住行育樂＋收支常見情境），
// 比純文字輸入框更好選、也不需要使用者自己打得出特殊符號。
const EMOJI_CHOICES = [
  '🍜', '🍔', '🍱', '🍣', '🍕', '🍰', '☕', '🍺', '🥤', '🍎',
  '🚗', '🚌', '🚕', '🚲', '🛵', '🚄', '✈️', '⛽', '🅿️', '🚿',
  '🛍️', '👗', '👟', '💄', '🧴', '🧻', '🛒', '🎁', '🧧', '📦',
  '🏠', '🛋️', '💡', '🔧', '🧹', '🔑', '🛏️',
  '💊', '🏥', '🦷', '🏋️', '⚽', '🐾',
  '🎬', '🎮', '🎵', '🎨', '📷', '🎂', '🏖️', '👶', '👴',
  '📚', '✏️', '🎓',
  '📱', '💻', '📶', '🛡️',
  '💰', '📈', '💵', '➕', '🏷️',
];

// 新增/編輯分類共用的「emoji 輸入框＋選圖示按鈕（點開常見 emoji 網格）」欄位。
function buildIconField(initialValue) {
  const iconInput = el('input', { type: 'text', placeholder: 'emoji', value: initialValue || '', style: 'width:56px;text-align:center' });
  const toggleBtn = el('button', { type: 'button', class: 'icon-picker-toggle' }, ['選圖示']);
  const grid = el('div', { class: 'emoji-grid' });
  grid.style.display = 'none';
  for (const em of EMOJI_CHOICES) {
    grid.appendChild(el('button', {
      type: 'button',
      class: 'emoji-choice',
      onclick: () => { iconInput.value = em; grid.style.display = 'none'; },
    }, [em]));
  }
  toggleBtn.addEventListener('click', () => {
    grid.style.display = grid.style.display === 'none' ? 'grid' : 'none';
  });
  const wrapper = el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
    el('div', { style: 'display:flex;gap:6px' }, [iconInput, toggleBtn]),
    grid,
  ]);
  return { wrapper, iconInput };
}

// ---------------- Router ----------------

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, param] = hash.split('/');
  return { route: route || 'list', param };
}

async function render() {
  const { route, param } = parseHash();
  document.querySelectorAll('nav.bottom-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  $topbarAction.style.display = 'none';
  $main.innerHTML = '';

  try {
    if (route === 'list') { $topbarTitle.textContent = '隨手記帳'; await renderList(); }
    else if (route === 'entry') { $topbarTitle.textContent = param ? '編輯紀錄' : '新增紀錄'; await renderEntryForm(param); }
    else if (route === 'categories') { $topbarTitle.textContent = '分類管理'; await renderCategories(); }
    else if (route === 'reports') { $topbarTitle.textContent = '總覽/報表'; await renderReports(); }
    else if (route === 'settings') { $topbarTitle.textContent = '設定'; await renderSettings(); }
    else { location.hash = '#/list'; }
  } catch (err) {
    console.error(err);
    $main.appendChild(el('div', { class: 'empty-state' }, [`發生錯誤：${err.message}`]));
  }
}

window.addEventListener('hashchange', render);

// ---------------- List view ----------------

// 分類篩選下拉選單：大分類在前，底下的子分類縮排列在後面（不用 <optgroup>
// 是因為子分類本身也要能被單獨選取，optgroup label 不能當可選值）。
function buildCategoryFilterOptions(categories) {
  const parents = categories.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenOf = new Map();
  for (const c of categories) {
    if (c.parentId) {
      if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
      childrenOf.get(c.parentId).push(c);
    }
  }
  const opts = [];
  for (const p of parents) {
    opts.push(el('option', { value: p.id }, [`${p.icon} ${p.name}`]));
    const kids = (childrenOf.get(p.id) || []).sort((a, b) => a.sortOrder - b.sortOrder);
    for (const k of kids) opts.push(el('option', { value: k.id }, [`　└ ${k.icon} ${k.name}`]));
  }
  return opts;
}

async function renderList() {
  const categories = await DB.listCategories({ includeArchived: true });
  const catById = new Map(categories.map((c) => [c.id, c]));

  const state = { type: '', category: '', q: '' };
  const selection = { active: false, ids: new Set() };

  const filterRow = el('div', { class: 'filter-row' });
  const typeSel = el('select', { onchange: (e) => { state.type = e.target.value; refresh(); } }, [
    el('option', { value: '' }, ['全部類型']),
    el('option', { value: 'expense' }, ['支出']),
    el('option', { value: 'income' }, ['收入']),
  ]);
  const catSel = el('select', { onchange: (e) => { state.category = e.target.value; refresh(); } }, [
    el('option', { value: '' }, ['全部分類']),
    ...buildCategoryFilterOptions(categories),
  ]);
  const searchInput = el('input', { type: 'text', placeholder: '搜尋商家/備註', oninput: (e) => { state.q = e.target.value.trim(); refresh(); } });
  filterRow.append(typeSel, catSel, searchInput);
  $main.appendChild(filterRow);

  const selectToggleBtn = el('button', {
    class: 'btn-select-toggle',
    onclick: () => {
      selection.active = !selection.active;
      selection.ids.clear();
      refresh();
    },
  }, ['選取']);
  $main.appendChild(el('div', { style: 'text-align:right;margin-bottom:8px' }, [selectToggleBtn]));

  const selectionBar = el('div', { class: 'selection-bar', style: 'display:none' });
  $main.appendChild(selectionBar);

  const listContainer = el('div', {});
  $main.appendChild(listContainer);

  function renderSelectionBar() {
    selectToggleBtn.textContent = selection.active ? '取消選取' : '選取';
    if (!selection.active) { selectionBar.style.display = 'none'; return; }
    selectionBar.style.display = 'flex';
    selectionBar.innerHTML = '';
    selectionBar.appendChild(el('span', {}, [`已選 ${selection.ids.size} 筆`]));
    selectionBar.appendChild(el('button', {
      class: 'btn-selection-delete',
      onclick: async () => {
        if (selection.ids.size === 0) { toast('請先點選要刪除的紀錄'); return; }
        if (!confirm(`確定要刪除選取的 ${selection.ids.size} 筆紀錄嗎？`)) return;
        for (const id of selection.ids) await DB.softDeleteEntry(id);
        toast(`已刪除 ${selection.ids.size} 筆`);
        selection.active = false;
        selection.ids.clear();
        refresh();
      },
    }, ['刪除選取']));
  }

  async function refresh() {
    renderSelectionBar();
    listContainer.innerHTML = '';
    let entries = await DB.listEntries({ type: state.type || undefined });
    if (state.category) {
      // 篩選大分類時要連同底下所有子分類的紀錄一起算進來，不然選「餐飲」
      // 卻看不到被歸類到「早餐」子分類的紀錄，會讓使用者以為資料不見了。
      const matchIds = new Set([state.category, ...categories.filter((c) => c.parentId === state.category).map((c) => c.id)]);
      entries = entries.filter((e) => matchIds.has(e.category));
    }
    if (state.q) {
      const q = state.q.toLowerCase();
      entries = entries.filter((e) => (e.merchant || '').toLowerCase().includes(q) || (e.note || '').toLowerCase().includes(q));
    }
    if (entries.length === 0) {
      listContainer.appendChild(el('div', { class: 'empty-state' }, ['還沒有任何記帳紀錄']));
      return;
    }
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    }
    for (const [date, dayEntries] of groups) {
      const net = dayEntries.reduce((s, e) => s + (e.type === 'income' ? e.amount : -e.amount), 0);
      const group = el('div', { class: 'day-group' });
      group.appendChild(el('div', { class: 'day-group-header' }, [
        el('span', {}, [`${date}（${weekdayLabel(date)}）`]),
        el('span', {}, [fmtTWD(net)]),
      ]));
      for (const entry of dayEntries) {
        const cat = catById.get(entry.category);
        const checked = selection.ids.has(entry.id);
        const leadingIcon = selection.active
          ? el('input', { type: 'checkbox', class: 'entry-select-checkbox' })
          : el('div', { class: 'entry-icon' }, [cat ? cat.icon : '❓']);
        if (selection.active) leadingIcon.checked = checked;
        const row = el('div', {
          class: 'entry-row',
          onclick: () => {
            if (selection.active) {
              if (checked) selection.ids.delete(entry.id); else selection.ids.add(entry.id);
              refresh();
            } else {
              location.hash = `#/entry/${entry.id}`;
            }
          },
        }, [
          leadingIcon,
          el('div', { class: 'entry-main' }, [
            el('div', { class: 'entry-title' }, [entry.merchant || (cat ? cat.name : '未分類')]),
            el('div', { class: 'entry-sub' }, [[cat ? cat.name : '', entry.note].filter(Boolean).join(' · ') || ' ']),
          ]),
          el('div', { class: `entry-amount ${entry.type}` }, [(entry.type === 'income' ? '+' : '-') + fmtTWD(entry.amount).replace('-', '')]),
        ]);
        group.appendChild(row);
      }
      listContainer.appendChild(group);
    }
  }

  await refresh();
}

// ---------------- Entry form ----------------

async function renderEntryForm(id) {
  const existing = id ? await DB.getEntry(id) : null;
  const draft = existing ? { ...existing } : {
    type: 'expense', amount: '', date: todayISO(), category: '', merchant: '', note: '',
    source: 'manual', invoiceNumber: '', invoiceRandomCode: '', sellerTaxId: '', items: [],
  };

  if (!id) {
    $main.appendChild(el('button', {
      class: 'btn btn-secondary', style: 'margin-bottom:14px',
      onclick: () => startScanFlow(draft, rerenderForm),
    }, ['📷 掃描電子發票 QR Code']));
  }

  const formHost = el('div', {});
  $main.appendChild(formHost);

  function rerenderForm() {
    formHost.innerHTML = '';
    buildForm(formHost, draft, existing);
  }
  rerenderForm();
}

function buildForm(host, draft, existing) {
  const typeToggle = el('div', { class: 'type-toggle' }, [
    el('button', {
      class: `expense ${draft.type === 'expense' ? 'active' : ''}`,
      onclick: () => { draft.type = 'expense'; draft.category = ''; refreshCategoryChips(); markActive(); },
    }, ['支出']),
    el('button', {
      class: `income ${draft.type === 'income' ? 'active' : ''}`,
      onclick: () => { draft.type = 'income'; draft.category = ''; refreshCategoryChips(); markActive(); },
    }, ['收入']),
  ]);
  function markActive() {
    typeToggle.children[0].classList.toggle('active', draft.type === 'expense');
    typeToggle.children[1].classList.toggle('active', draft.type === 'income');
  }
  host.appendChild(typeToggle);

  const amountField = el('div', { class: 'form-field' }, [
    el('label', {}, ['金額']),
    el('input', { type: 'number', min: '0', step: '1', value: draft.amount || '', oninput: (e) => { draft.amount = e.target.value; } }),
  ]);
  host.appendChild(amountField);

  const dateField = el('div', { class: 'form-field' }, [
    el('label', {}, ['日期']),
    el('input', { type: 'date', value: draft.date, oninput: (e) => { draft.date = e.target.value; } }),
  ]);
  host.appendChild(dateField);

  const catField = el('div', { class: 'form-field' }, [el('label', {}, ['分類'])]);
  const chipGrid = el('div', { class: 'chip-grid' });
  const subChipGrid = el('div', { class: 'chip-grid', style: 'margin-top:8px' });
  catField.append(chipGrid, subChipGrid);
  host.appendChild(catField);

  // 兩層分類：先選大分類（會直接把 draft.category 設成大分類 id，可直接儲存）；
  // 若該大分類底下有子分類，下方會多一排子分類 chip 供選填，選了子分類就把
  // draft.category 改成更精確的子分類 id。
  async function refreshCategoryChips() {
    chipGrid.innerHTML = '';
    subChipGrid.innerHTML = '';
    const cats = await DB.listCategories({ type: draft.type });
    const catById = new Map(cats.map((c) => [c.id, c]));
    const parents = cats.filter((c) => !c.parentId);
    const childrenOf = new Map();
    for (const c of cats) {
      if (c.parentId) {
        if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
        childrenOf.get(c.parentId).push(c);
      }
    }

    for (const c of parents) {
      const kids = childrenOf.get(c.id) || [];
      const selected = draft.category === c.id || kids.some((k) => k.id === draft.category);
      chipGrid.appendChild(el('div', {
        class: `chip ${selected ? 'selected' : ''}`,
        onclick: () => { draft.category = c.id; refreshCategoryChips(); },
      }, [`${c.icon} ${c.name}`]));
    }

    const cur = catById.get(draft.category);
    const activeParentId = cur ? (cur.parentId || cur.id) : null;
    const kids = activeParentId ? (childrenOf.get(activeParentId) || []) : [];
    subChipGrid.style.display = kids.length ? 'flex' : 'none';
    for (const k of kids) {
      subChipGrid.appendChild(el('div', {
        class: `chip ${draft.category === k.id ? 'selected' : ''}`,
        onclick: () => { draft.category = k.id; refreshCategoryChips(); },
      }, [`${k.icon} ${k.name}`]));
    }
  }
  refreshCategoryChips();

  const merchantField = el('div', { class: 'form-field' }, [
    el('label', {}, ['商家 / 項目']),
    el('input', { type: 'text', value: draft.merchant || '', oninput: (e) => { draft.merchant = e.target.value; } }),
  ]);
  host.appendChild(merchantField);

  const noteField = el('div', { class: 'form-field' }, [
    el('label', {}, ['備註']),
    el('textarea', { rows: '2', oninput: (e) => { draft.note = e.target.value; } }, [draft.note || '']),
  ]);
  host.appendChild(noteField);

  if (draft.source === 'invoice-qr' && draft.invoiceNumber) {
    const invoiceCard = el('div', { class: 'card' }, [
      el('div', { class: 'muted-note' }, [`發票號碼：${draft.invoiceNumber}　賣方統編：${draft.sellerTaxId || '—'}`]),
    ]);
    if (draft.items && draft.items.length) {
      const table = el('table', { class: 'item-table' });
      table.appendChild(el('thead', {}, [
        el('tr', {}, [el('th', {}, ['品名']), el('th', {}, ['數量']), el('th', {}, ['單價']), el('th', {}, ['小計'])]),
      ]));
      const tbody = el('tbody', {});
      let itemsTotal = 0;
      for (const it of draft.items) {
        const subtotal = (it.qty || 0) * (it.unitPrice || 0);
        itemsTotal += subtotal;
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [it.name || '—']),
          el('td', {}, [String(it.qty ?? '—')]),
          el('td', {}, [fmtTWD(it.unitPrice || 0)]),
          el('td', {}, [fmtTWD(subtotal)]),
        ]));
      }
      table.appendChild(tbody);
      invoiceCard.appendChild(el('div', { class: 'section-title', style: 'margin-top:12px' }, ['發票品項']));
      invoiceCard.appendChild(table);
      if (Math.round(itemsTotal) !== Math.round(Number(draft.amount) || 0)) {
        invoiceCard.appendChild(el('div', { class: 'muted-note' }, [`品項小計合計 ${fmtTWD(itemsTotal)}，與發票總金額不同——可能是這張發票的品項在掃描時沒有完全掃進來（例如還有右側品項明細 QR 沒掃），儲存時仍會用發票總金額為準。`]));
      }
    } else {
      invoiceCard.appendChild(el('div', { class: 'muted-note' }, ['這張發票沒有品項明細（可能是簡易版QR或掃描時未包含品項資訊）。']));
    }
    host.appendChild(invoiceCard);
  }

  const saveBtn = el('button', { class: 'btn btn-primary', onclick: () => saveEntry(draft, existing) }, ['儲存']);
  host.appendChild(saveBtn);

  if (existing) {
    host.appendChild(el('button', {
      class: 'btn btn-danger',
      onclick: async () => {
        if (confirm('確定要刪除這筆紀錄嗎？')) {
          await DB.softDeleteEntry(existing.id);
          toast('已刪除');
          location.hash = '#/list';
        }
      },
    }, ['刪除這筆紀錄']));
  }
}

async function saveEntry(draft, existing) {
  const amount = Number(draft.amount);
  if (!amount || amount <= 0) { toast('請輸入正確金額'); return; }
  if (!draft.category) { toast('請選擇分類'); return; }
  if (!draft.date) { toast('請選擇日期'); return; }

  if (draft.invoiceNumber) {
    const dup = await DB.findEntryByInvoiceNumber(draft.invoiceNumber);
    if (dup && (!existing || dup.id !== existing.id)) {
      if (!confirm(`發票號碼 ${draft.invoiceNumber} 已經記過帳了，仍要儲存這一筆嗎？（部分退款等情況可忽略此提示）`)) return;
    }
  }

  await DB.putEntry({
    ...draft,
    id: existing ? existing.id : undefined,
    amount,
  });
  toast('已儲存');
  location.hash = '#/list';
}

// ---------------- Scan flow ----------------

function startScanFlow(draft, onFilled) {
  const overlay = document.getElementById('scan-overlay');
  const video = document.getElementById('scan-video');
  const hint = document.getElementById('scan-hint');
  const closeBtn = document.getElementById('scan-close');
  const statusEl = document.getElementById('scan-status');
  const statusText = document.getElementById('scan-status-text');
  const retryBtn = document.getElementById('scan-retry');
  const manualBtn = document.getElementById('scan-manual');

  overlay.style.display = 'flex';
  hint.textContent = '正在啟動相機…若瀏覽器跳出相機權限詢問，請點「允許」';
  statusEl.style.display = 'none';

  const fullyClose = () => {
    Scanner.stop();
    overlay.style.display = 'none';
    statusEl.style.display = 'none';
    closeBtn.onclick = null;
    retryBtn.onclick = null;
    manualBtn.onclick = null;
  };
  closeBtn.onclick = fullyClose;
  manualBtn.onclick = fullyClose;

  // 錯誤/掃到非發票格式時，訊息直接顯示在這個黑底疊層裡（不用 toast——
  // toast 疊在純黑背景上很容易看不清楚，之前手機上「一閃就消失」多半是這個原因）
  // 且不會自動關閉鏡頭畫面，讓使用者看得到原因、自己選要重試還是改手動輸入。
  const showStatus = (message) => {
    Scanner.stop();
    statusText.textContent = message;
    statusEl.style.display = 'flex';
    retryBtn.onclick = () => { retryBtn.onclick = null; startScanFlow(draft, onFilled); };
  };

  Scanner.start(video, async (result) => {
    if (!result.ok) { showStatus('掃描失敗，請改用手動輸入'); return; }
    const parsed = InvoiceParser.parseInvoiceQR(result.raw);
    if (!parsed.ok) {
      showStatus('這不是可辨識的電子發票 QR Code，請確認掃的是發票左側的條碼，或改用手動輸入');
      return;
    }
    fullyClose();
    const d = parsed.data;
    draft.amount = String(d.totalAmount);
    draft.date = d.date;
    draft.invoiceNumber = d.invoiceNumber;
    draft.invoiceRandomCode = d.invoiceRandomCode;
    draft.sellerTaxId = d.sellerTaxId;
    draft.items = d.items;
    draft.source = 'invoice-qr';
    if (d.items && d.items.length && !draft.merchant) draft.merchant = d.items[0].name;
    toast('發票資料已帶入，請確認分類後儲存');
    onFilled();
  }).then(() => {
    hint.textContent = '將電子發票左側 QR Code 對準框內';
  }).catch((err) => {
    showStatus(err.message || '無法開啟相機，請改用手動輸入');
  });
}

// ---------------- Categories view ----------------

async function renderCategories() {
  const wrap = el('div', {});
  $main.appendChild(wrap);

  async function refresh() {
    wrap.innerHTML = '';
    for (const type of ['expense', 'income']) {
      wrap.appendChild(el('div', { class: 'section-title' }, [type === 'expense' ? '支出分類' : '收入分類']));
      const cats = await DB.listCategories({ type });
      const parents = cats.filter((c) => !c.parentId);
      const childrenOf = new Map();
      for (const c of cats) {
        if (c.parentId) {
          if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
          childrenOf.get(c.parentId).push(c);
        }
      }

      const listEl = el('div', { class: 'card' });
      parents.forEach((p, i) => {
        const kids = childrenOf.get(p.id) || [];
        listEl.appendChild(buildCategoryRow(p, {
          siblings: parents, index: i, children: kids, onChanged: refresh,
        }));
        kids.forEach((k, ki) => {
          listEl.appendChild(buildCategoryRow(k, {
            siblings: kids, index: ki, indent: true, onChanged: refresh,
            reparentOptions: parents.filter((other) => other.id !== p.id),
          }));
        });
        listEl.appendChild(buildAddSubForm(p, refresh));
      });
      wrap.appendChild(listEl);
    }

    const newForm = el('div', { class: 'card' });
    const { wrapper: iconWrap, iconInput } = buildIconField('');
    const nameInput = el('input', { type: 'text', placeholder: '大分類名稱', style: 'flex:1' });
    const typeSel = el('select', {}, [el('option', { value: 'expense' }, ['支出']), el('option', { value: 'income' }, ['收入'])]);
    newForm.appendChild(el('div', { class: 'section-title' }, ['新增大分類']));
    newForm.appendChild(el('div', { style: 'display:flex;gap:8px;margin-bottom:10px;align-items:flex-start' }, [iconWrap, nameInput, typeSel]));
    newForm.appendChild(el('button', {
      class: 'btn btn-primary',
      onclick: async () => {
        if (!nameInput.value.trim()) { toast('請輸入分類名稱'); return; }
        const all = await DB.listCategories({ type: typeSel.value, parentId: null });
        await DB.putCategory({ name: nameInput.value.trim(), icon: iconInput.value.trim() || '🏷️', type: typeSel.value, parentId: null, sortOrder: all.length + 1 });
        toast('已新增大分類');
        nameInput.value = '';
        iconInput.value = '';
        refresh();
      },
    }, ['新增大分類']));
    wrap.appendChild(newForm);
  }

  // c：這一列代表的分類（大分類或子分類）。
  // siblings/index：同一層（同一個大分類底下，或所有大分類）用來排序 ↑↓。
  // children：只有大分類列會傳，用來讓封存/刪除連同子分類一起處理並顯示正確提示文字。
  // reparentOptions：只有子分類列會傳，是「移至其他大分類」下拉選單的選項。
  function buildCategoryRow(c, { siblings, index, children, indent, reparentOptions, onChanged }) {
    const controls = [
      el('span', {}, [c.icon]),
      el('span', { class: 'cat-name' }, [c.name]),
      el('button', { onclick: async () => { if (index > 0) { await swapOrder(siblings[index - 1], c); onChanged(); } } }, ['↑']),
      el('button', { onclick: async () => { if (index < siblings.length - 1) { await swapOrder(siblings[index + 1], c); onChanged(); } } }, ['↓']),
      el('button', {
        onclick: async () => {
          const name = prompt('分類名稱', c.name);
          if (name === null) return;
          const icon = prompt('emoji 圖示', c.icon);
          if (icon === null) return;
          await DB.putCategory({ ...c, name: name.trim() || c.name, icon: icon.trim() || c.icon });
          toast('已更新');
          onChanged();
        },
      }, ['編輯']),
    ];
    if (reparentOptions && reparentOptions.length) {
      controls.push(el('select', {
        onchange: async (e) => {
          if (!e.target.value) return;
          const target = reparentOptions.find((p) => p.id === e.target.value);
          await DB.putCategory({ ...c, parentId: e.target.value });
          toast(`已移到「${target ? target.name : ''}」`);
          onChanged();
        },
      }, [
        el('option', { value: '' }, ['移至…']),
        ...reparentOptions.map((p) => el('option', { value: p.id }, [`${p.icon} ${p.name}`])),
      ]));
    }
    controls.push(
      el('button', {
        onclick: async () => {
          const kids = children || [];
          const hint = kids.length ? `刪除大分類「${c.name}」會一併刪除底下 ${kids.length} 個子分類。` : '';
          const idsToCheck = [c.id, ...kids.map((k) => k.id)];
          let inUseCount = 0;
          for (const cid of idsToCheck) inUseCount += (await DB.listEntries({ category: cid })).length;
          const warn = hint + (inUseCount > 0
            ? `目前共有 ${inUseCount} 筆紀錄在用，封存後這些分類不會再出現在新增選單裡，但紀錄仍會保留。確定要封存嗎？`
            : `確定要封存「${c.name}」嗎？（歷史紀錄仍會保留此分類，只是新增時不會再出現在選單裡）`);
          if (confirm(warn)) { await DB.archiveCategory(c.id); onChanged(); }
        },
      }, ['封存']),
      el('button', {
        onclick: async () => {
          const kids = children || [];
          const idsToCheck = [c.id, ...kids.map((k) => k.id)];
          let inUseCount = 0;
          for (const cid of idsToCheck) inUseCount += (await DB.listEntries({ category: cid })).length;
          let warn;
          if (kids.length) {
            warn = `刪除大分類「${c.name}」會一併刪除底下 ${kids.length} 個子分類。` +
              (inUseCount > 0 ? `目前共有 ${inUseCount} 筆紀錄在用，刪除後會變成「未分類」。` : '') +
              '此動作無法復原，確定要刪除嗎？';
          } else {
            warn = inUseCount > 0
              ? `這個分類還有 ${inUseCount} 筆紀錄在用。刪除後這些紀錄會變成「未分類」，分類本身無法復原，確定要刪除嗎？`
              : `確定要刪除分類「${c.name}」嗎？此動作無法復原。`;
          }
          if (confirm(warn)) { await DB.deleteCategory(c.id); toast('已刪除分類'); onChanged(); }
        },
      }, ['刪除']),
    );
    return el('div', { class: `cat-manage-row${indent ? ' cat-manage-row-child' : ''}` }, controls);
  }

  function buildAddSubForm(parent, onChanged) {
    const { wrapper: iconWrap, iconInput } = buildIconField(parent.icon);
    const nameInput = el('input', { type: 'text', placeholder: '子分類名稱', style: 'flex:1' });
    const addBtn = el('button', {
      onclick: async () => {
        if (!nameInput.value.trim()) { toast('請輸入子分類名稱'); return; }
        const siblingCount = (await DB.listCategories({ type: parent.type, parentId: parent.id })).length;
        await DB.putCategory({
          name: nameInput.value.trim(), icon: iconInput.value.trim() || parent.icon,
          type: parent.type, parentId: parent.id, sortOrder: siblingCount + 1,
        });
        toast('已新增子分類');
        onChanged();
      },
    }, ['+ 新增子分類']);
    return el('div', { class: 'cat-manage-row cat-manage-row-child cat-add-sub' }, [iconWrap, nameInput, addBtn]);
  }

  async function swapOrder(a, b) {
    const tmp = a.sortOrder;
    await DB.putCategory({ ...a, sortOrder: b.sortOrder });
    await DB.putCategory({ ...b, sortOrder: tmp });
  }

  await refresh();
}

// ---------------- Reports view ----------------

async function renderReports() {
  const monthInput = el('input', { type: 'month', value: currentMonthStr() });
  $main.appendChild(el('div', { class: 'form-field' }, [el('label', {}, ['選擇月份']), monthInput]));

  const kpiRow = el('div', { class: 'kpi-row' });
  $main.appendChild(kpiRow);

  $main.appendChild(el('div', { class: 'section-title' }, ['支出分類佔比']));
  const donutHost = el('div', { class: 'card' });
  $main.appendChild(donutHost);

  $main.appendChild(el('div', { class: 'section-title' }, ['每日收支']));
  const trendHost = el('div', { class: 'card' });
  $main.appendChild(trendHost);

  async function refresh() {
    const { from, to } = monthRange(monthInput.value);
    const entries = await DB.listEntries({ from, to });
    const income = entries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
    const expense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);

    kpiRow.innerHTML = '';
    kpiRow.appendChild(el('div', { class: 'kpi-tile' }, [el('div', { class: 'label' }, ['收入']), el('div', { class: 'value', style: 'color:var(--good)' }, [fmtTWD(income)])]));
    kpiRow.appendChild(el('div', { class: 'kpi-tile' }, [el('div', { class: 'label' }, ['支出']), el('div', { class: 'value', style: 'color:var(--critical)' }, [fmtTWD(expense)])]));
    kpiRow.appendChild(el('div', { class: 'kpi-tile' }, [el('div', { class: 'label' }, ['淨額']), el('div', { class: 'value' }, [fmtTWD(income - expense)])]));

    // 甜甜圈圖依「大分類」彙總，不會因為某些紀錄記到子分類就把圖切得更細碎——
    // 子分類本身仍看得到（列表頁的分類篩選/紀錄明細都能篩到子分類層級）。
    const expenseCats = await DB.listCategories({ type: 'expense', includeArchived: true });
    const expenseCatById = new Map(expenseCats.map((c) => [c.id, c]));
    const topExpenseCats = expenseCats.filter((c) => !c.parentId);
    const expenseEntries = entries
      .filter((e) => e.type === 'expense')
      .map((e) => ({ ...e, category: topCategoryId(e.category, expenseCatById) }));
    Charts.renderCategoryDonut(donutHost, { entries: expenseEntries, categories: topExpenseCats });

    const { from: f, to: t } = monthRange(monthInput.value);
    const days = [];
    let cursor = new Date(f + 'T00:00:00');
    const end = new Date(t + 'T00:00:00');
    while (cursor <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      const dayEntries = entries.filter((e) => e.date === iso);
      days.push({
        label: String(cursor.getDate()),
        income: dayEntries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0),
        expense: dayEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    Charts.renderTrendChart(trendHost, { points: days });
  }

  monthInput.addEventListener('change', refresh);
  await refresh();
}

// ---------------- Settings view ----------------

async function renderSettings() {
  const lastExportAt = await DB.getSetting('lastExportAt');
  const lastImportAt = await DB.getSetting('lastImportAt');

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!confirm('匯入備份會把檔案裡的紀錄合併進目前的資料（同一筆以較新的為準，不會整個覆蓋），確定要匯入嗎？')) return;
    try {
      const r = await Backup.importBackup(file);
      await DB.setSetting('lastImportAt', Date.now());
      toast(`已匯入 ${r.entryCount} 筆紀錄、${r.categoryCount} 個分類`);
      render();
    } catch (err) {
      toast('匯入失敗：' + err.message);
    }
  });

  $main.appendChild(el('div', { class: 'section-title' }, ['備份 / 還原']));
  $main.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'muted-note' }, ['資料預設只存在這個裝置。按「匯出備份」會存成一個檔案，你可以自己存到 Google Drive、Dropbox 等雲端硬碟資料夾，或傳給自己保存。換手機時，用「匯入備份」把檔案讀回來即可。']),
    el('button', {
      class: 'btn btn-primary',
      style: 'margin-top:10px',
      onclick: async () => {
        try {
          const r = await Backup.exportBackup();
          await DB.setSetting('lastExportAt', Date.now());
          toast(`已匯出 ${r.count} 筆紀錄`);
          render();
        } catch (err) {
          toast('匯出失敗：' + err.message);
        }
      },
    }, ['匯出備份']),
    el('button', {
      class: 'btn btn-secondary',
      onclick: () => fileInput.click(),
    }, ['匯入備份']),
    fileInput,
    el('div', { class: 'muted-note' }, [lastExportAt ? `上次匯出：${new Date(lastExportAt).toLocaleString('zh-TW')}` : '尚未匯出過']),
    el('div', { class: 'muted-note' }, [lastImportAt ? `上次匯入：${new Date(lastImportAt).toLocaleString('zh-TW')}` : '尚未匯入過']),
  ]));

  $main.appendChild(el('div', { class: 'section-title' }, ['其他']));
  $main.appendChild(el('div', { class: 'card' }, [
    el('button', { class: 'btn btn-secondary', onclick: () => { location.hash = '#/categories'; } }, ['管理分類']),
    el('button', {
      class: 'btn btn-secondary',
      onclick: async () => {
        if (!deferredInstallPrompt) { toast('目前瀏覽器不支援安裝，或已安裝過'); return; }
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
      },
    }, ['加入主畫面']),
    el('a', { class: 'install-link', href: 'manual.html', target: '_blank' }, ['查看使用手冊']),
  ]));

  $main.appendChild(el('div', { class: 'section-title' }, ['關於']));
  $main.appendChild(el('div', { class: 'card about-card' }, [
    el('div', { class: 'muted-note' }, ['⚠ 本工具僅供個人記帳與教學示範使用，禁止未經授權公開發布、販售或商業化使用。']),
    el('div', { class: 'muted-note' }, ['⚠ 記帳資料僅存於本機瀏覽器（IndexedDB），不會上傳到任何伺服器；若在公用或共用裝置上使用，離開前請留意保護個人財務資訊。']),
    el('div', { class: 'about-credit' }, ['創作者：蔡豐全（Mark Tsai）']),
  ]));
}

// ---------------- boot ----------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => console.error('SW register failed', err));
  });
}

render();
