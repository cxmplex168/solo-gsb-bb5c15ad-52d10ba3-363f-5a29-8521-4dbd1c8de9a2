'use strict';

const MAX_TOTAL_PIECES = 12;
const MAX_REMNANT_COUNT = 12;
const MAX_MATERIAL_TYPES = 3;

let mode = 'optimize';

const rowsBody = document.getElementById('spec-rows');
const counterEl = document.getElementById('piece-counter');
const remnantRowsBody = document.getElementById('remnant-rows');
const remnantTable = document.getElementById('remnant-table');
const remnantCounterEl = document.getElementById('remnant-counter');
const materialRowsBody = document.getElementById('material-rows');
const materialBlock = document.getElementById('material-block');
const materialCounterEl = document.getElementById('material-counter');
const stockField = document.getElementById('stock-length-field');
const hintOptimize = document.getElementById('hint-optimize');
const hintQuote = document.getElementById('hint-quote');
const calcBtn = document.getElementById('calc-btn');
const errorEl = document.getElementById('form-error');
const resultEl = document.getElementById('result');

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
  const tr = document.createElement('tr');
  tr.className = 'material-row';
  tr.innerHTML = `
    <td><span class="material-tag">新料</span></td>
    <td><input type="number" class="mat-len-input" min="0" step="any" placeholder="长度" /></td>
    <td><input type="number" class="mat-price-input" min="0" step="any" placeholder="单价" /></td>
    <td><button type="button" class="btn-remove" title="删除该行">✕</button></td>
  `;
  tr.querySelector('.mat-len-input').value = length;
  tr.querySelector('.mat-price-input').value = price;
  tr.querySelector('.btn-remove').addEventListener('click', () => {
    tr.remove();
    updateMaterialView();
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
  materialCounterEl.textContent = `已添加 ${count} / ${MAX_MATERIAL_TYPES} 种`;
  document.getElementById('add-material').disabled = count >= MAX_MATERIAL_TYPES;
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

function fmtMoney(n) {
  // 金额固定两位小数（如 80.00 / 10.10）
  return (Math.round(n * 100) / 100).toFixed(2);
}

function collectRemnants() {
  // 长度留空的行视为未录入，直接忽略
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

function collectPayload() {
  const kerf = Number(document.getElementById('kerf').value);
  const payload = { kerf, items: collectItems(), remnants: collectRemnants() };
  if (mode === 'optimize') {
    payload.stockLength = Number(document.getElementById('stock-length').value);
  } else {
    // 新料：长度或单价留空的行忽略（至少一种由后端校验）
    payload.materials = [];
    Array.from(materialRowsBody.children).forEach((tr) => {
      const length = tr.querySelector('.mat-len-input').value;
      const price = tr.querySelector('.mat-price-input').value;
      if (String(length).trim() === '' && String(price).trim() === '') return;
      payload.materials.push({ length, price });
    });
  }
  return payload;
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

function renderPurchaseSummary(purchase, totalPrice) {
  const el = document.getElementById('purchase-summary');
  const head = `
    <h3 class="remnant-summary-title">采购汇总</h3>
    <table class="remnant-summary-table">
      <thead>
        <tr><th>新料长度</th><th>单价</th><th>采购根数</th><th>小计</th></tr>
      </thead>`;
  if (!purchase || purchase.length === 0) {
    el.innerHTML = `
      ${head}
      <tbody>
        <tr><td colspan="4" class="purchase-empty">全部裁片由余料承载，无需采购新料</td></tr>
      </tbody>
      <tfoot>
        <tr class="purchase-total"><td colspan="3">总采购价</td><td>${fmtMoney(totalPrice || 0)}</td></tr>
      </tfoot>
    </table>`;
    return;
  }
  const rows = purchase
    .map(
      (p) => `
      <tr>
        <td>${fmt(p.length)}</td>
        <td>${fmtMoney(p.unitPrice)}</td>
        <td>${p.qty}</td>
        <td>${fmtMoney(p.subtotal)}</td>
      </tr>`
    )
    .join('');
  el.innerHTML = `
    ${head}
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="purchase-total"><td colspan="3">总采购价</td><td>${fmtMoney(totalPrice)}</td></tr>
    </tfoot>
  `;
}

function renderBins(result, isQuote) {
  const priceSummary = isQuote
    ? `<span>总采购价：<strong>${fmtMoney(result.totalPrice)}</strong></span>`
    : '';
  const stockSummary = isQuote
    ? ''
    : `<span>原料长度：<strong>${fmt(result.stockLength)}</strong></span>`;
  const summary = `
    ${priceSummary}
    ${stockSummary}
    <span>锯缝宽度：<strong>${fmt(result.kerf)}</strong></span>
    <span>新料根数：<strong>${result.newBinCount}</strong></span>
    <span>余料根数：<strong>${result.remnantBinCount}</strong></span>
    <span>总片数：<strong>${result.totalPieces}</strong></span>
    <span>锯缝总数：<strong>${result.totalCuts}</strong></span>
    <span>投入总长度：<strong>${fmt(result.totalStockLength)}</strong></span>
    <span>总余长：<strong>${fmt(result.totalLeftover)}</strong></span>
    <span>综合利用率：<strong>${(result.utilization * 100).toFixed(1)}%</strong></span>
  `;
  document.getElementById('summary').innerHTML = summary;
  if (isQuote) {
    renderPurchaseSummary(result.purchase, result.totalPrice);
  } else {
    document.getElementById('purchase-summary').innerHTML = '';
  }
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
        isQuote && !isRemnant
          ? `<span class="bin-price-tag">单价 ${fmtMoney(bin.unitPrice)} 元</span>`
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

function setMode(next) {
  mode = next;
  const isQuote = mode === 'quote';
  stockField.hidden = isQuote;
  materialBlock.hidden = !isQuote;
  hintOptimize.hidden = isQuote;
  hintQuote.hidden = !isQuote;
  calcBtn.textContent = isQuote ? '计算报价方案' : '计算下料方案';
  document.getElementById('result-title').textContent = isQuote ? '报价方案' : '计算结果';
  clearError();
  resultEl.hidden = true;

  // 报价模式默认准备一行新料
  if (isQuote && materialRowsBody.children.length === 0) {
    addMaterialRow(2440, 120);
  }
}

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    document.querySelectorAll('.mode-option').forEach((opt) => opt.classList.remove('selected'));
    e.target.closest('.mode-option').classList.add('selected');
    setMode(e.target.value);
  });
});
document.getElementById('add-row').addEventListener('click', () => addRow());
document.getElementById('add-remnant').addEventListener('click', () => addRemnantRow());
document.getElementById('add-material').addEventListener('click', () => {
  if (materialRowsBody.children.length < MAX_MATERIAL_TYPES) addMaterialRow();
});

calcBtn.addEventListener('click', async () => {
  clearError();
  resultEl.hidden = true;

  const endpoint = mode === 'quote' ? '/api/quote' : '/api/optimize';
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload()),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      showError(data.error || '计算失败，请检查输入');
      return;
    }
    renderBins(data.result, mode === 'quote');
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError('无法连接服务器，请确认服务已启动');
  }
});

document.getElementById('print-btn').addEventListener('click', () => {
  document.getElementById('print-title').textContent =
    mode === 'quote' ? '木工短料报价裁切方案' : '木工短料下料方案';
  document.getElementById('print-time').textContent =
    '打印时间：' + new Date().toLocaleString('zh-CN');
  window.print();
});

// 默认示例
addRow(800, 2);
addRow(600, 2);
addRow(400, 1);
