'use strict';

const MAX_TOTAL_PIECES = 12;
const MAX_REMNANT_COUNT = 12;
const MAX_MATERIAL_KINDS = 3;

const rowsBody = document.getElementById('spec-rows');
const counterEl = document.getElementById('piece-counter');
const remnantRowsBody = document.getElementById('remnant-rows');
const remnantTable = document.getElementById('remnant-table');
const remnantCounterEl = document.getElementById('remnant-counter');
const materialRowsBody = document.getElementById('material-rows');
const materialsSection = document.getElementById('materials-section');
const materialCounterEl = document.getElementById('material-counter');
const stockLengthField = document.getElementById('stock-length-field');
const errorEl = document.getElementById('form-error');
const resultEl = document.getElementById('result');
const calcBtn = document.getElementById('calc-btn');

const MODE_TEXT = {
  optimize: {
    subtitle: '输入原料、裁片规格与余料库存，自动计算新料根数最少的裁切方案（总裁片数上限 12 片）',
    button: '计算下料方案',
    resultTitle: '计算结果',
    printTitle: '木工短料下料方案',
    hint: '说明：同规格会展开成单片（A1、A2…）参与计算；仅同一根原料上相邻的两片之间计一条锯缝；每根原料上的裁片按长度从大到小排列，即建议裁切顺序。录入余料后，每根余料最多使用一次，优先保证新料根数最少，再使投入原料总长度最小。',
  },
  quote: {
    subtitle: '录入 1～3 种可购买新料的长度与单价，自动计算总采购价最低的裁切方案（总裁片数上限 12 片）',
    button: '计算报价方案',
    resultTitle: '报价结果',
    printTitle: '木工短料报价方案',
    hint: '说明：按价格选料模式以总采购价最低为目标，同价时依次选择新料根数最少、投入原料总长度最小的方案；长于所有新料的裁片可由足够长的余料承载；每根余料最多使用一次，锯缝只计同根相邻裁片。',
  },
};

function currentMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : 'optimize';
}

function specLetter(index) {
  return String.fromCharCode(65 + index); // A、B、C…
}

function addRow(length = '', qty = 1) {
  const tr = document.createElement('tr');
  tr.className = 'spec-row';
  tr.innerHTML = `
    <td><span class="spec-letter"></span></td>
    <td><input type="number" class="len-input" min="0" step="any" /></td>
    <td><input type="number" class="qty-input" min="1" step="1" /></td>
    <td><button type="button" class="btn-remove" title="删除该行">✕</button></td>
  `;
  tr.querySelector('.len-input').value = length;
  tr.querySelector('.qty-input').value = qty;
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    if (rowsBody.children.length > 1) {
      tr.remove();
      refreshLetters();
      updateCounter();
    }
  });
  tr.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateCounter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') calcBtn.click();
    });
  });
  rowsBody.appendChild(tr);
  refreshLetters();
  updateCounter();
}

function refreshLetters() {
  Array.from(rowsBody.children).forEach((tr, i) => {
    tr.querySelector('.spec-letter').textContent = specLetter(i);
  });
}

function updateCounter() {
  let total = 0;
  rowsBody.querySelectorAll('.qty-input').forEach((input) => {
    const q = Number(input.value);
    if (Number.isInteger(q) && q > 0) total += q;
  });
  counterEl.textContent = `总片数：${total} / ${MAX_TOTAL_PIECES}`;
  counterEl.classList.toggle('over', total > MAX_TOTAL_PIECES);
}

function addRemnantRow(length = '', qty = 1) {
  const tr = document.createElement('tr');
  tr.className = 'remnant-row';
  tr.innerHTML = `
    <td><span class="remnant-tag">余料</span></td>
    <td><input type="number" class="rem-len-input" min="0" step="any" /></td>
    <td><input type="number" class="rem-qty-input" min="1" step="1" /></td>
    <td><button type="button" class="btn-remove" title="删除该行">✕</button></td>
  `;
  tr.querySelector('.rem-len-input').value = length;
  tr.querySelector('.rem-qty-input').value = qty;
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    updateRemnantView();
  });
  tr.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateRemnantView);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') calcBtn.click();
    });
  });
  remnantRowsBody.appendChild(tr);
  updateRemnantView();
}

function updateRemnantView() {
  remnantTable.hidden = remnantRowsBody.children.length === 0;
  let total = 0;
  remnantRowsBody.querySelectorAll('.rem-qty-input').forEach((input) => {
    const q = Number(input.value);
    if (Number.isInteger(q) && q > 0) total += q;
  });
  remnantCounterEl.textContent =
    remnantRowsBody.children.length === 0 ? '' : `余料总根数：${total} / ${MAX_REMNANT_COUNT}`;
  remnantCounterEl.classList.toggle('over', total > MAX_REMNANT_COUNT);
}

function addMaterialRow(length = '', price = '') {
  if (materialRowsBody.children.length >= MAX_MATERIAL_KINDS) return;
  const tr = document.createElement('tr');
  tr.className = 'material-row';
  tr.innerHTML = `
    <td><span class="material-tag">新料</span></td>
    <td><input type="number" class="mat-len-input" min="0" step="any" /></td>
    <td><input type="number" class="mat-price-input" min="0" step="0.01" /></td>
    <td><button type="button" class="btn-remove" title="删除该行">✕</button></td>
  `;
  tr.querySelector('.mat-len-input').value = length;
  tr.querySelector('.mat-price-input').value = price;
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    if (materialRowsBody.children.length > 1) {
      tr.remove();
      updateMaterialView();
    }
  });
  tr.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updateMaterialView);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') calcBtn.click();
    });
  });
  materialRowsBody.appendChild(tr);
  updateMaterialView();
}

function updateMaterialView() {
  const count = materialRowsBody.children.length;
  document.getElementById('add-material').disabled = count >= MAX_MATERIAL_KINDS;
  materialCounterEl.textContent = `新料种类：${count} / ${MAX_MATERIAL_KINDS}`;
}

function applyMode() {
  const mode = currentMode();
  const text = MODE_TEXT[mode];
  const isQuote = mode === 'quote';

  stockLengthField.hidden = isQuote; // 报价模式以新料清单取代单一原料长度
  materialsSection.hidden = !isQuote;
  document.getElementById('header-subtitle').textContent = text.subtitle;
  document.getElementById('mode-hint').textContent = text.hint;
  calcBtn.textContent = text.button;
  document.getElementById('result-title').textContent = text.resultTitle;
  document.querySelector('.print-header h1').textContent = text.printTitle;

  if (isQuote && materialRowsBody.children.length === 0) {
    addMaterialRow(2440, '');
  }
  clearError();
  resultEl.hidden = true;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function fmt(n) {
  // 最多保留 3 位小数并去掉多余的 0
  return (Math.round(n * 1000) / 1000).toString();
}

function fmtPrice(n) {
  // 金额固定两位小数
  return (Math.round(n * 100) / 100).toFixed(2);
}

function collectItems() {
  const items = [];
  Array.from(rowsBody.children).forEach((tr) => {
    items.push({
      length: tr.querySelector('.len-input').value,
      qty: tr.querySelector('.qty-input').value,
    });
  });
  return items;
}

function collectRemnants() {
  // 余料：长度留空的行视为未录入，直接忽略
  const remnants = [];
  Array.from(remnantRowsBody.children).forEach((tr) => {
    const length = tr.querySelector('.rem-len-input').value;
    if (String(length).trim() === '') return;
    remnants.push({
      length,
      qty: tr.querySelector('.rem-qty-input').value,
    });
  });
  return remnants;
}

function collectMaterials() {
  const materials = [];
  Array.from(materialRowsBody.children).forEach((tr) => {
    materials.push({
      length: tr.querySelector('.mat-len-input').value,
      price: tr.querySelector('.mat-price-input').value,
    });
  });
  return materials;
}

function isPositiveNumberString(v) {
  const n = Number(v);
  return String(v).trim() !== '' && Number.isFinite(n) && n > 0;
}

/** 报价模式的前端预校验，返回错误信息或 null（服务端仍会完整校验） */
function validateQuoteForm(materials) {
  if (materials.length === 0) return '请至少添加一种可购买新料';
  if (materials.length > MAX_MATERIAL_KINDS) return `可购买新料最多 ${MAX_MATERIAL_KINDS} 种`;
  const seen = new Set();
  for (let i = 0; i < materials.length; i++) {
    const row = i + 1;
    const { length, price } = materials[i];
    if (!isPositiveNumberString(length)) return `第 ${row} 种新料：长度必须是大于 0 的数字`;
    if (!isPositiveNumberString(price)) return `第 ${row} 种新料：单价必须是大于 0 的数字`;
    const priceText = String(price).trim();
    const dot = priceText.indexOf('.');
    if (dot >= 0 && priceText.length - dot - 1 > 2) {
      return `第 ${row} 种新料：单价最多两位小数`;
    }
    const key = String(Number(length));
    if (seen.has(key)) return `第 ${row} 种新料：长度 ${length} 与前面的新料重复，同一长度只能录入一次`;
    seen.add(key);
  }
  return null;
}

function renderRemnantSummary(remnants) {
  const el = document.getElementById('remnant-summary');
  if (!remnants || remnants.length === 0) {
    el.innerHTML = '';
    return;
  }
  const rows = remnants
    .map(
      (r) => `
      <tr>
        <td>${fmt(r.length)}</td>
        <td>${r.available}</td>
        <td>${r.used}</td>
        <td>${r.remaining}</td>
      </tr>`
    )
    .join('');
  el.innerHTML = `
    <h3 class="remnant-summary-title">余料消耗</h3>
    <table class="remnant-summary-table">
      <thead>
        <tr><th>余料长度</th><th>可用根数</th><th>本次消耗</th><th>剩余根数</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPurchaseSummary(result) {
  const el = document.getElementById('purchase-summary');
  if (!result.purchase) {
    el.innerHTML = '';
    return;
  }
  const rows = result.purchase
    .map(
      (p) => `
      <tr>
        <td>${fmt(p.length)}</td>
        <td>${fmtPrice(p.price)}</td>
        <td>${p.count}</td>
        <td>${fmtPrice(p.subtotal)}</td>
      </tr>`
    )
    .join('');
  el.innerHTML = `
    <h3 class="remnant-summary-title">采购汇总</h3>
    <table class="remnant-summary-table purchase-table">
      <thead>
        <tr><th>新料长度</th><th>单价</th><th>购买根数</th><th>小计</th></tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="2">合计</td><td>${result.newBinCount}</td><td><strong>${fmtPrice(result.totalPrice)}</strong></td></tr>
      </tfoot>
    </table>
  `;
}

function renderBins(result, mode) {
  const isQuote = mode === 'quote';
  const summaryItems = [];
  if (!isQuote) {
    summaryItems.push(`<span>原料长度：<strong>${fmt(result.stockLength)}</strong></span>`);
  }
  summaryItems.push(`<span>锯缝宽度：<strong>${fmt(result.kerf)}</strong></span>`);
  if (isQuote) {
    summaryItems.push(`<span>总采购价：<strong>${fmtPrice(result.totalPrice)}</strong></span>`);
  }
  summaryItems.push(
    `<span>新料根数：<strong>${result.newBinCount}</strong></span>`,
    `<span>余料根数：<strong>${result.remnantBinCount}</strong></span>`,
    `<span>总片数：<strong>${result.totalPieces}</strong></span>`,
    `<span>锯缝总数：<strong>${result.totalCuts}</strong></span>`,
    `<span>投入总长度：<strong>${fmt(result.totalStockLength)}</strong></span>`,
    `<span>总余长：<strong>${fmt(result.totalLeftover)}</strong></span>`,
    `<span>综合利用率：<strong>${(result.utilization * 100).toFixed(1)}%</strong></span>`
  );
  document.getElementById('summary').innerHTML = summaryItems.join('');
  renderPurchaseSummary(isQuote ? result : {});
  renderRemnantSummary(result.remnants);

  // 各根原料长度可能不同，示意图宽度按最长一根为 100% 等比缩放
  const maxStock = Math.max(...result.bins.map((b) => b.stockLength));

  const binsHtml = result.bins
    .map((bin) => {
      const seq = bin.pieces
        .map((p) => `${p.label}(${fmt(p.length)})`)
        .join('<span class="arrow">→</span>');

      const isRemnant = bin.source === 'remnant';
      const sourceTag = isRemnant
        ? '<span class="source-tag remnant">余料</span>'
        : '<span class="source-tag new">新料</span>';
      const priceTag =
        isQuote && !isRemnant && bin.price !== undefined
          ? `<span class="bin-price">单价 ${fmtPrice(bin.price)}</span>`
          : '';

      // 示意图：裁片 + 片间锯缝（红色）+ 余长（灰色）
      let barInner = '';
      bin.pieces.forEach((p, i) => {
        barInner += `<div class="seg" style="flex-grow:${p.length}" title="${p.label} ${fmt(p.length)}">${p.label}</div>`;
        if (i < bin.cuts && result.kerf > 0) {
          // 按真实比例显示；过小的锯缝适当加宽以便辨认（示意图，精确数值见下方文字）
          const kerfWidth = Math.max(result.kerf, bin.stockLength * 0.008);
          barInner += `<div class="seg kerf" style="flex-grow:${kerfWidth}" title="锯缝 ${fmt(result.kerf)}"></div>`;
        }
      });
      if (bin.leftover > 1e-9) {
        barInner += `<div class="seg leftover" style="flex-grow:${bin.leftover}" title="余长 ${fmt(bin.leftover)}">余 ${fmt(bin.leftover)}</div>`;
      }

      const barWidth = Math.max((bin.stockLength / maxStock) * 100, 8);

      return `
        <div class="bin">
          <div class="bin-title">第 ${bin.index} 根 ${sourceTag}<span class="bin-stock-len">${fmt(bin.stockLength)}</span>${priceTag}</div>
          <div class="bar" style="width:${barWidth}%">${barInner}</div>
          <div class="bin-seq">裁切顺序：${seq}<span class="arrow">→</span><span class="leftover-tag">余长 ${fmt(bin.leftover)}</span></div>
          <div class="bin-meta">共 ${bin.count} 片，锯缝 ${bin.cuts} 条，已用 ${fmt(bin.usedLength)}，余长 ${fmt(bin.leftover)}</div>
        </div>
      `;
    })
    .join('');
  document.getElementById('bins').innerHTML = binsHtml;
}

document.getElementById('add-row').addEventListener('click', () => addRow());
document.getElementById('add-remnant').addEventListener('click', () => addRemnantRow());
document.getElementById('add-material').addEventListener('click', () => addMaterialRow());
document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', applyMode);
});

calcBtn.addEventListener('click', async () => {
  clearError();
  resultEl.hidden = true;

  const mode = currentMode();
  let url;
  let payload;
  if (mode === 'quote') {
    const materials = collectMaterials();
    const err = validateQuoteForm(materials);
    if (err) {
      showError(err);
      return;
    }
    url = '/api/quote';
    payload = {
      kerf: Number(document.getElementById('kerf').value),
      items: collectItems(),
      materials,
      remnants: collectRemnants(),
    };
  } else {
    url = '/api/optimize';
    payload = {
      stockLength: Number(document.getElementById('stock-length').value),
      kerf: Number(document.getElementById('kerf').value),
      items: collectItems(),
      remnants: collectRemnants(),
    };
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      showError(data.error || '计算失败，请检查输入');
      return;
    }
    renderBins(data.result, mode);
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('无法连接服务器，请确认服务已启动');
  }
});

document.getElementById('print-btn').addEventListener('click', () => {
  document.getElementById('print-time').textContent =
    '打印时间：' + new Date().toLocaleString('zh-CN');
  window.print();
});

// 默认示例
addRow(800, 2);
addRow(600, 2);
addRow(400, 1);
