// Vanilla SVG charts — no chart library, no CDN, so the app stays fully
// offline-capable. Palette + rules follow this workspace's dataviz skill:
// fixed categorical hue order (never cycled, never reassigned by rank),
// one axis, legend for >=2 series, selective direct labels, a table-view
// fallback for the accessibility "relief" requirement, and a validated
// light/dark palette (see references/palette.md — validated via
// scripts/validate_palette.js, both modes PASS).

(function () {
  const PALETTE_CSS = `
.viz-root {
  color-scheme: light;
  --surface-1: #fcfcfb;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #898781;
  --grid: #e1e0d9;
  --baseline: #c3c2b7;
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; --series-4: #eda100;
  --series-5: #e87ba4; --series-6: #008300; --series-7: #4a3aa7; --series-8: #e34948;
}
@media (prefers-color-scheme: dark) {
  .viz-root {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --grid: #2c2c2a;
    --baseline: #383835;
    --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500;
    --series-5: #d55181; --series-6: #008300; --series-7: #9085e9; --series-8: #e66767;
  }
}
.viz-root { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.viz-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 13px; color: var(--text-secondary); }
.viz-legend-item { display: flex; align-items: center; gap: 6px; }
.viz-swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
.viz-empty { color: var(--text-muted); font-size: 13px; padding: 16px 0; text-align: center; }
.viz-table-toggle { background: none; border: none; color: var(--text-secondary); font-size: 12px; text-decoration: underline; cursor: pointer; padding: 4px 0; }
.viz-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
.viz-table th, .viz-table td { text-align: right; padding: 4px 6px; border-bottom: 1px solid var(--grid); color: var(--text-primary); }
.viz-table th:first-child, .viz-table td:first-child { text-align: left; }
`;

  function ensurePaletteCSS() {
    if (document.getElementById('chart-palette-css')) return;
    const style = document.createElement('style');
    style.id = 'chart-palette-css';
    style.textContent = PALETTE_CSS;
    document.head.appendChild(style);
  }

  const OTHER_LABEL = '其他';
  const MAX_OWN_SLOTS = 7; // slot 8 reserved for the "其他" fold

  // Stable identity -> slot mapping so a category's color never changes when
  // filters change which categories are present or how they rank.
  function slotMapFor(categories) {
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
    const map = new Map();
    sorted.slice(0, MAX_OWN_SLOTS).forEach((c, i) => map.set(c.id, i + 1));
    return map;
  }

  function fmtTWD(n) {
    return 'NT$' + Math.round(n).toLocaleString('zh-TW');
  }

  function el(tag, attrs, children) {
    const ns = 'http://www.w3.org/2000/svg';
    const isSvg = ['svg', 'g', 'path', 'circle', 'text', 'title', 'rect', 'line'].includes(tag);
    const node = isSvg ? document.createElementNS(ns, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    for (const child of children || []) node.appendChild(child);
    return node;
  }

  function polarToXY(cx, cy, r, angle) {
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  function donutSlicePath(cx, cy, rOuter, rInner, startAngle, endAngle) {
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const [x1, y1] = polarToXY(cx, cy, rOuter, startAngle);
    const [x2, y2] = polarToXY(cx, cy, rOuter, endAngle);
    const [x3, y3] = polarToXY(cx, cy, rInner, endAngle);
    const [x4, y4] = polarToXY(cx, cy, rInner, startAngle);
    return [
      `M ${x1} ${y1}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
      'Z',
    ].join(' ');
  }

  // entries: [{category, amount}] already filtered to one type (expense|income)
  function renderCategoryDonut(container, { entries, categories }) {
    ensurePaletteCSS();
    container.innerHTML = '';
    container.classList.add('viz-root');

    if (!entries.length) {
      container.appendChild(el('div', { class: 'viz-empty' }, [document.createTextNode('這段期間沒有資料')]));
      return;
    }

    const slotMap = slotMapFor(categories);
    const catById = new Map(categories.map((c) => [c.id, c]));
    const totals = new Map();
    for (const e of entries) {
      const key = slotMap.has(e.category) ? e.category : '__other__';
      totals.set(key, (totals.get(key) || 0) + e.amount);
    }

    const grandTotal = [...totals.values()].reduce((a, b) => a + b, 0);
    const slices = [...totals.entries()]
      .map(([catId, amount]) => ({
        catId,
        label: catId === '__other__' ? OTHER_LABEL : catById.get(catId)?.name || catId,
        icon: catId === '__other__' ? '' : catById.get(catId)?.icon || '',
        amount,
        slot: catId === '__other__' ? 8 : slotMap.get(catId),
      }))
      .sort((a, b) => b.amount - a.amount);

    const size = 220;
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size / 2 - 4;
    const rInner = rOuter * 0.6;
    const gap = 0.02; // radians, ~2px visual gap between slices

    const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: '100%', height: size, role: 'img', 'aria-label': '分類佔比圖' });
    let angle = -Math.PI / 2;
    for (const s of slices) {
      const sweep = (s.amount / grandTotal) * Math.PI * 2;
      const start = angle + gap / 2;
      const end = angle + sweep - gap / 2;
      if (end > start) {
        const path = el('path', {
          d: donutSlicePath(cx, cy, rOuter, rInner, start, end),
          fill: `var(--series-${s.slot})`,
        }, [el('title', {}, [document.createTextNode(`${s.icon} ${s.label}：${fmtTWD(s.amount)}（${((s.amount / grandTotal) * 100).toFixed(1)}%）`)])]);
        svg.appendChild(path);

        const pct = (s.amount / grandTotal) * 100;
        if (pct >= 8) {
          const mid = (start + end) / 2;
          const [lx, ly] = polarToXY(cx, cy, (rOuter + rInner) / 2, mid);
          svg.appendChild(el('text', {
            x: lx, y: ly, fill: '#fff', 'font-size': '11', 'text-anchor': 'middle', 'dominant-baseline': 'middle',
          }, [document.createTextNode(`${pct.toFixed(0)}%`)]));
        }
      }
      angle += sweep;
    }
    svg.appendChild(el('text', {
      x: cx, y: cy - 6, fill: 'var(--text-secondary)', 'font-size': '11', 'text-anchor': 'middle',
    }, [document.createTextNode('總計')]));
    svg.appendChild(el('text', {
      x: cx, y: cy + 12, fill: 'var(--text-primary)', 'font-size': '15', 'font-weight': '600', 'text-anchor': 'middle',
    }, [document.createTextNode(fmtTWD(grandTotal))]));
    container.appendChild(svg);

    const legend = el('div', { class: 'viz-legend' });
    for (const s of slices) {
      const item = el('div', { class: 'viz-legend-item' }, [
        el('span', { class: 'viz-swatch', style: `background:var(--series-${s.slot})` }),
      ]);
      item.appendChild(document.createTextNode(`${s.icon} ${s.label} ${fmtTWD(s.amount)}`));
      legend.appendChild(item);
    }
    container.appendChild(legend);

    container.appendChild(buildTableToggle(slices.map((s) => [`${s.icon} ${s.label}`, fmtTWD(s.amount), `${((s.amount / grandTotal) * 100).toFixed(1)}%`]), ['分類', '金額', '佔比']));
  }

  // points: [{label, income, expense}]
  function renderTrendChart(container, { points }) {
    ensurePaletteCSS();
    container.innerHTML = '';
    container.classList.add('viz-root');

    if (!points.length || points.every((p) => !p.income && !p.expense)) {
      container.appendChild(el('div', { class: 'viz-empty' }, [document.createTextNode('這段期間沒有資料')]));
      return;
    }

    const width = 320;
    const height = 160;
    const padL = 4, padR = 4, padT = 8, padB = 20;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxVal = Math.max(1, ...points.map((p) => Math.max(p.income, p.expense)));
    const n = points.length;
    const groupW = plotW / n;
    const barW = Math.max(2, Math.min(14, groupW * 0.32));

    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': '收支趨勢圖' });
    svg.appendChild(el('line', { x1: padL, y1: height - padB, x2: width - padR, y2: height - padB, stroke: 'var(--baseline)', 'stroke-width': '1' }));

    points.forEach((p, i) => {
      const groupCx = padL + groupW * i + groupW / 2;
      const bars = [
        { val: p.income, slot: 1, dx: -barW * 0.6, label: '收入' },
        { val: p.expense, slot: 2, dx: barW * 0.6, label: '支出' },
      ];
      for (const b of bars) {
        if (b.val <= 0) continue;
        const h = (b.val / maxVal) * plotH;
        const x = groupCx + b.dx - barW / 2;
        const y = height - padB - h;
        svg.appendChild(el('rect', {
          x, y, width: barW, height: h, rx: 2, fill: `var(--series-${b.slot})`,
        }, [el('title', {}, [document.createTextNode(`${p.label} ${b.label}：${fmtTWD(b.val)}`)])]));
      }
      if (n <= 10 || i % Math.ceil(n / 10) === 0) {
        svg.appendChild(el('text', {
          x: groupCx, y: height - 6, fill: 'var(--text-muted)', 'font-size': '9', 'text-anchor': 'middle',
        }, [document.createTextNode(p.label)]));
      }
    });
    container.appendChild(svg);

    const legend = el('div', { class: 'viz-legend' }, [
      el('div', { class: 'viz-legend-item' }, [el('span', { class: 'viz-swatch', style: 'background:var(--series-1)' })]),
      el('div', { class: 'viz-legend-item' }, [el('span', { class: 'viz-swatch', style: 'background:var(--series-2)' })]),
    ]);
    legend.children[0].appendChild(document.createTextNode('收入'));
    legend.children[1].appendChild(document.createTextNode('支出'));
    container.appendChild(legend);

    container.appendChild(buildTableToggle(points.map((p) => [p.label, fmtTWD(p.income), fmtTWD(p.expense)]), ['期間', '收入', '支出']));
  }

  function buildTableToggle(rows, headers) {
    const wrap = document.createElement('div');
    const btn = el('button', { class: 'viz-table-toggle', type: 'button' }, [document.createTextNode('顯示表格')]);
    const table = el('table', { class: 'viz-table', style: 'display:none' });
    const thead = el('thead', {}, [el('tr', {}, headers.map((h) => el('th', {}, [document.createTextNode(h)])))]);
    const tbody = el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, [document.createTextNode(String(c))])))));
    table.appendChild(thead);
    table.appendChild(tbody);
    btn.addEventListener('click', () => {
      const showing = table.style.display !== 'none';
      table.style.display = showing ? 'none' : 'table';
      btn.textContent = showing ? '顯示表格' : '隱藏表格';
    });
    wrap.appendChild(btn);
    wrap.appendChild(table);
    return wrap;
  }

  window.Charts = { renderCategoryDonut, renderTrendChart };
})();
