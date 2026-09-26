'use strict';

/**
 * 木工短料下料优化核心算法。
 *
 * 两种模式：
 *
 * 一、根数模式（computeCuttingPlan，/api/optimize）
 * - 原料长度表示可购买的新料（数量不限）；可额外录入余料库存（多种长度、各自根数），
 *   每根余料最多使用一次；
 * - 优化目标（字典序）：先使新料根数最少，再使投入原料总长度
 *   （用到的余料长度 + 新料长度之和）最小；精确搜索，保证最优。
 *
 * 二、按价格选料模式（computeQuotePlan，/api/quote）
 * - 录入 1～3 种可购买新料的长度与单价（数量不限），余料规则同上；
 * - 优化目标（字典序）：先使总采购价（新料长度 × 单价之和）最低，
 *   同价时新料根数最少，再相同时投入原料总长度最小；精确搜索，保证最优；
 * - 长于所有新料的裁片可由足够长的余料承载，否则给出明确原因。
 *
 * 共同规则：
 * - 同规格的裁片先展开成单片（每片带 A1、A2… 编号），再参与计算；
 * - 锯缝只发生在同一根原料上相邻的两片之间：
 *   一根原料放 k 片，占用长度 = 各片长度之和 + (k - 1) × 锯缝宽度；
 * - 总裁片数上限 MAX_TOTAL_PIECES = 12；余料总根数上限 MAX_REMNANT_COUNT = 12。
 */

const MAX_TOTAL_PIECES = 12;
const MAX_REMNANT_COUNT = 12;
const MAX_QTY_PER_SPEC = 99;
const MAX_MATERIAL_KINDS = 3;
const EPS = 1e-9; // 浮点比较容差

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.isValidation = true;
  }
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isPositiveInteger(n) {
  return Number.isInteger(n) && n >= 1;
}

/** 单价最多两位小数（允许 3、3.5、3.55，不允许 3.555） */
function hasAtMostTwoDecimals(n) {
  return Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

/**
 * 解析并校验余料库存（可选）：[{ length, qty }]，相同长度合并为一组。
 * 返回按长度从小到大排序的分组 [{ key, length, qty }]。
 */
function parseRemnants(input) {
  const remnantGroups = [];
  const remnantByKey = new Map(); // 长度 key -> 组
  if (input.remnants === undefined || input.remnants === null) {
    return remnantGroups;
  }
  if (!Array.isArray(input.remnants)) {
    throw new ValidationError('余料库存格式不正确');
  }
  input.remnants.forEach((rem, idx) => {
    const row = idx + 1;
    const length = toNumber(rem && rem.length);
    const qty = toNumber(rem && rem.qty);

    if (!Number.isFinite(length) || length <= 0) {
      throw new ValidationError(`第 ${row} 条余料：长度必须是大于 0 的数字`);
    }
    if (!isPositiveInteger(qty)) {
      throw new ValidationError(`第 ${row} 条余料：根数必须是正整数`);
    }
    if (qty > MAX_QTY_PER_SPEC) {
      throw new ValidationError(`第 ${row} 条余料：单条根数不能超过 ${MAX_QTY_PER_SPEC}`);
    }

    const key = String(round6(length));
    if (remnantByKey.has(key)) {
      remnantByKey.get(key).qty += qty;
    } else {
      const group = { key, length, qty };
      remnantByKey.set(key, group);
      remnantGroups.push(group);
    }
  });

  const remnantTotal = remnantGroups.reduce((s, g) => s + g.qty, 0);
  if (remnantTotal > MAX_REMNANT_COUNT) {
    throw new ValidationError(
      `余料总根数为 ${remnantTotal} 根，超过上限 ${MAX_REMNANT_COUNT} 根，请减少余料数量`
    );
  }

  remnantGroups.sort((a, b) => a.length - b.length); // 从小到大，优先尝试短余料
  return remnantGroups;
}

/**
 * 解析并校验裁片规格，展开成单片（编号 A1、A2…），按长度从大到小排序。
 * maxStockLength 为单片可放入的最大原料长度；oversizeMessage 生成超长时的报错。
 */
function parseItems(input, maxStockLength, oversizeMessage) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError('请至少添加一条裁片规格');
  }

  const pieces = [];
  let totalCount = 0;
  const specNames = new Map(); // length -> 规格字母

  input.items.forEach((item, idx) => {
    const row = idx + 1;
    const length = toNumber(item && item.length);
    const qty = toNumber(item && item.qty);

    if (!Number.isFinite(length) || length <= 0) {
      throw new ValidationError(`第 ${row} 条规格：长度必须是大于 0 的数字`);
    }
    if (!isPositiveInteger(qty)) {
      throw new ValidationError(`第 ${row} 条规格：数量必须是正整数`);
    }
    if (qty > MAX_QTY_PER_SPEC) {
      throw new ValidationError(`第 ${row} 条规格：单条数量不能超过 ${MAX_QTY_PER_SPEC}`);
    }
    if (length > maxStockLength + EPS) {
      throw new ValidationError(oversizeMessage(row, length));
    }

    // 同长度归入同一规格，共享字母编号
    const key = String(round6(length));
    if (!specNames.has(key)) {
      specNames.set(key, String.fromCharCode(65 + specNames.size)); // A、B、C…
    }
    const spec = specNames.get(key);

    for (let i = 1; i <= qty; i++) {
      pieces.push({ label: `${spec}${i}`, length });
    }
    totalCount += qty;
  });

  if (totalCount === 0) {
    throw new ValidationError('请至少添加一片裁片');
  }
  if (totalCount > MAX_TOTAL_PIECES) {
    throw new ValidationError(
      `总裁片数为 ${totalCount} 片，超过上限 ${MAX_TOTAL_PIECES} 片，请减少数量或合并规格`
    );
  }

  pieces.sort((a, b) => b.length - a.length); // 从大到小，加速搜索收敛
  return pieces;
}

/**
 * 解析并校验根数模式输入，返回 { stockLength, kerf, pieces, remnantGroups }。
 */
function parseAndValidate(input) {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('请求格式不正确');
  }

  const stockLength = toNumber(input.stockLength);
  if (!Number.isFinite(stockLength) || stockLength <= 0) {
    throw new ValidationError('原料长度必须是大于 0 的数字');
  }

  const kerf = toNumber(input.kerf);
  if (!Number.isFinite(kerf) || kerf < 0) {
    throw new ValidationError('锯缝宽度必须是不小于 0 的数字');
  }

  const remnantGroups = parseRemnants(input);

  // 单片可放入的最大原料长度：新料与最长余料中的较大者
  const maxRemnantLength = remnantGroups.reduce((m, g) => Math.max(m, g.length), 0);
  const maxStockLength = Math.max(stockLength, maxRemnantLength);

  const pieces = parseItems(input, maxStockLength, (row, length) =>
    remnantGroups.length === 0
      ? `第 ${row} 条规格：长度 ${length} 超过原料长度 ${stockLength}，单片无法放入原料`
      : `第 ${row} 条规格：长度 ${length} 超过原料长度 ${stockLength} 及所有余料长度，单片无法放入任何原料`
  );

  return { stockLength, kerf, pieces, remnantGroups };
}

/**
 * 解析并校验按价格选料模式输入，返回 { kerf, pieces, remnantGroups, materials }。
 * materials 为按单价从低到高（同价按长度从短到长）排序的新料：
 * [{ key, length, price, priceCents }]，priceCents 为整数分，避免浮点误差。
 */
function parseQuoteInput(input) {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('请求格式不正确');
  }

  const kerf = toNumber(input.kerf);
  if (!Number.isFinite(kerf) || kerf < 0) {
    throw new ValidationError('锯缝宽度必须是不小于 0 的数字');
  }

  // 可购买新料：1～3 种，长度与单价均为正数，单价最多两位小数，长度不得重复
  if (!Array.isArray(input.materials) || input.materials.length === 0) {
    throw new ValidationError('请至少添加一种可购买新料');
  }
  if (input.materials.length > MAX_MATERIAL_KINDS) {
    throw new ValidationError(`可购买新料最多 ${MAX_MATERIAL_KINDS} 种，当前 ${input.materials.length} 种`);
  }

  const materials = [];
  const materialKeys = new Set();
  input.materials.forEach((mat, idx) => {
    const row = idx + 1;
    const length = toNumber(mat && mat.length);
    const price = toNumber(mat && mat.price);

    if (!Number.isFinite(length) || length <= 0) {
      throw new ValidationError(`第 ${row} 种新料：长度必须是大于 0 的数字`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new ValidationError(`第 ${row} 种新料：单价必须是大于 0 的数字`);
    }
    if (!hasAtMostTwoDecimals(price)) {
      throw new ValidationError(`第 ${row} 种新料：单价最多两位小数`);
    }

    const key = String(round6(length));
    if (materialKeys.has(key)) {
      throw new ValidationError(`第 ${row} 种新料：长度 ${length} 与前面的新料重复，同一长度只能录入一次`);
    }
    materialKeys.add(key);

    materials.push({ key, length, price, priceCents: Math.round(price * 100) });
  });

  // 单价从低到高（同价按长度从短到长），优先尝试便宜的新料
  materials.sort((a, b) => a.priceCents - b.priceCents || a.length - b.length);

  const remnantGroups = parseRemnants(input);

  // 单片可放入的最大原料长度：最长新料与最长余料中的较大者
  const maxMaterialLength = materials.reduce((m, g) => Math.max(m, g.length), 0);
  const maxRemnantLength = remnantGroups.reduce((m, g) => Math.max(m, g.length), 0);
  const maxStockLength = Math.max(maxMaterialLength, maxRemnantLength);

  const pieces = parseItems(input, maxStockLength, (row, length) =>
    remnantGroups.length === 0
      ? `第 ${row} 条规格：长度 ${length} 超过所有新料长度（最长 ${maxMaterialLength}），单片无法放入任何新料，请录入足够长的余料或新料`
      : `第 ${row} 条规格：长度 ${length} 超过所有新料及余料长度，单片无法放入任何原料`
  );

  return { kerf, pieces, remnantGroups, materials };
}

/**
 * 精确搜索（DFS + 剪枝）。
 *
 * 在固定新料根数 newCount 下，把裁片分配到余料（每组有限根数）与新料（newCount 根）上：
 * - minimize = false：找到第一个可行分配即返回（用于确定最少新料根数）；
 * - minimize = true ：遍历全部可行分配，返回投入原料总长度最小的方案
 *   （upperBound 为已知可行解的投入总长，用于剪枝）。
 *
 * 返回 { bins, usedStockLength } 或 null（无可行方案）。
 * bins 为已开启原料的数组：{ capacity, source, groupKey, load, count, items }。
 */
function searchBins({ lengths, stockLength, kerf, remnantGroups, newCount, minimize, upperBound }) {
  const n = lengths.length;
  const bins = []; // 已开启的原料
  const remnantLeft = remnantGroups.map((g) => g.qty); // 每组剩余可开根数
  let newLeft = newCount;
  let usedStockLength = 0; // 已开启原料的长度之和

  let best = null;
  let bestUsed = Infinity;
  let found = false;

  function dfs(idx) {
    if (found) return; // 可行性模式：找到即停
    if (usedStockLength >= bestUsed - EPS) return; // 不可能更优
    if (upperBound !== undefined && usedStockLength > upperBound + EPS) return;
    if (idx === n) {
      if (!minimize) {
        found = true;
        best = bins.map((b) => ({ ...b, items: b.items.slice() }));
        bestUsed = usedStockLength;
      } else if (usedStockLength < bestUsed - EPS) {
        bestUsed = usedStockLength;
        best = bins.map((b) => ({ ...b, items: b.items.slice() }));
      }
      return;
    }

    const len = lengths[idx];
    const seen = new Set(); // 跳过状态相同的原料（等价分支去重）

    // 1) 尝试放入已开的原料
    for (let b = 0; b < bins.length; b++) {
      const bin = bins[b];
      const key = `${bin.capacity}#${bin.load.toFixed(6)}#${bin.count}`;
      if (seen.has(key)) continue;
      // 相邻切口才计锯缝：放入第 k 片时新增一条锯缝
      const added = bin.count > 0 ? len + kerf : len;
      if (bin.load + added > bin.capacity + EPS) continue;

      seen.add(key);
      bin.load += added;
      bin.count += 1;
      bin.items.push(idx);
      dfs(idx + 1);
      bin.items.pop();
      bin.count -= 1;
      bin.load -= added;
    }

    // 2) 新开一根余料（同长度组的余料等价，每组只试一次；组已按长度升序，短料优先）
    for (let g = 0; g < remnantGroups.length; g++) {
      if (remnantLeft[g] === 0) continue;
      const group = remnantGroups[g];
      if (len > group.length + EPS) continue; // 单片放不进该余料

      remnantLeft[g] -= 1;
      usedStockLength += group.length;
      bins.push({
        capacity: group.length,
        source: 'remnant',
        groupKey: group.key,
        load: len,
        count: 1,
        items: [idx],
      });
      dfs(idx + 1);
      bins.pop();
      usedStockLength -= group.length;
      remnantLeft[g] += 1;
    }

    // 3) 新开一根新料（单片独占一根时不计锯缝）
    if (newLeft > 0 && len <= stockLength + EPS) {
      newLeft -= 1;
      usedStockLength += stockLength;
      bins.push({
        capacity: stockLength,
        source: 'new',
        groupKey: null,
        load: len,
        count: 1,
        items: [idx],
      });
      dfs(idx + 1);
      bins.pop();
      usedStockLength -= stockLength;
      newLeft += 1;
    }
  }

  dfs(0);
  return best ? { bins: best, usedStockLength: bestUsed } : null;
}

/**
 * 按价格选料的精确搜索（DFS + 字典序剪枝）。
 *
 * 目标（字典序）：(总采购价, 新料根数, 投入原料总长度) 最小。
 * 余料每组根数有限、每根最多用一次；新料每种数量不限，单价以整数分参与比较。
 * 先用贪心构造一个可行解作为上界，再精确搜索保证全局最优。
 *
 * 返回 { bins, totalCostCents, newBinCount, usedStockLength } 或 null（无可行方案）。
 */
function searchQuoteBins({ lengths, kerf, remnantGroups, materials }) {
  const n = lengths.length;
  const bins = []; // 已开启的原料：{ capacity, source, groupKey, costCents, load, count, items }
  const remnantLeft = remnantGroups.map((g) => g.qty);
  let costCents = 0; // 已开启新料的采购价（分）
  let newCount = 0; // 已开启新料根数
  let usedStockLength = 0; // 已开启原料的长度之和

  let best = null;
  let bestCost = Infinity;
  let bestNewCount = Infinity;
  let bestUsed = Infinity;

  function snapshot() {
    return bins.map((b) => ({ ...b, items: b.items.slice() }));
  }

  // 先用贪心构造一个可行解作为上界；构造失败则不设置上界，由 DFS 完整搜索。
  function greedySolution() {
    const saved = snapshot();
    const savedRemnantLeft = remnantLeft.slice();
    const savedCost = costCents;
    const savedNew = newCount;
    const savedUsed = usedStockLength;

    const restore = () => {
      bins.length = 0;
      saved.forEach((b) => bins.push(b));
      for (let g = 0; g < remnantGroups.length; g++) remnantLeft[g] = savedRemnantLeft[g];
      costCents = savedCost;
      newCount = savedNew;
      usedStockLength = savedUsed;
    };

    for (let idx = 0; idx < n; idx++) {
      const len = lengths[idx];
      const added = (bin) => (bin.count > 0 ? len + kerf : len);

      let target = -1;
      let targetSlack = Infinity;
      for (let b = 0; b < bins.length; b++) {
        const slack = bins[b].capacity - (bins[b].load + added(bins[b]));
        if (slack >= -EPS && slack < targetSlack) {
          targetSlack = slack;
          target = b;
        }
      }
      if (target >= 0) {
        const bin = bins[target];
        bin.load += added(bin);
        bin.count += 1;
        bin.items.push(idx);
        continue;
      }

      let opened = false;
      for (let g = 0; g < remnantGroups.length; g++) {
        if (remnantLeft[g] === 0) continue;
        const group = remnantGroups[g];
        if (len > group.length + EPS) continue;
        remnantLeft[g] -= 1;
        usedStockLength += group.length;
        bins.push({
          capacity: group.length,
          source: 'remnant',
          groupKey: group.key,
          costCents: 0,
          load: len,
          count: 1,
          items: [idx],
        });
        opened = true;
        break;
      }
      if (opened) continue;

      for (const mat of materials) {
        if (len > mat.length + EPS) continue;
        costCents += mat.priceCents;
        newCount += 1;
        usedStockLength += mat.length;
        bins.push({
          capacity: mat.length,
          source: 'new',
          groupKey: mat.key,
          costCents: mat.priceCents,
          load: len,
          count: 1,
          items: [idx],
        });
        opened = true;
        break;
      }
      if (!opened) {
        restore(); // 单片放不进任何原料（理论上已被前置校验拦截）
        return;
      }
    }

    best = snapshot();
    bestCost = costCents;
    bestNewCount = newCount;
    bestUsed = usedStockLength;
    restore();
  }

  function dfs(idx) {
    // 字典序剪枝：任一目标分量已不可能更优时停止
    if (costCents > bestCost) return;
    if (costCents === bestCost) {
      if (newCount > bestNewCount) return;
      if (newCount === bestNewCount && usedStockLength >= bestUsed - EPS) return;
    }
    if (idx === n) {
      best = snapshot();
      bestCost = costCents;
      bestNewCount = newCount;
      bestUsed = usedStockLength;
      return;
    }

    const len = lengths[idx];
    const seen = new Set(); // 跳过状态相同的原料（等价分支去重）

    // 1) 尝试放入已开的原料（剩余空间小者优先，利于收敛）
    const order = bins
      .map((bin, i) => ({ bin, i }))
      .sort((a, b2) => a.bin.capacity - a.bin.load - (b2.bin.capacity - b2.bin.load));
    for (const { bin } of order) {
      const key = `${bin.capacity}#${bin.load.toFixed(6)}#${bin.count}`;
      if (seen.has(key)) continue;
      const added = bin.count > 0 ? len + kerf : len;
      if (bin.load + added > bin.capacity + EPS) continue;

      seen.add(key);
      bin.load += added;
      bin.count += 1;
      bin.items.push(idx);
      dfs(idx + 1);
      bin.items.pop();
      bin.count -= 1;
      bin.load -= added;
    }

    // 2) 新开一根余料（不计采购价；同长度组等价只试一次，短料优先）
    for (let g = 0; g < remnantGroups.length; g++) {
      if (remnantLeft[g] === 0) continue;
      const group = remnantGroups[g];
      if (len > group.length + EPS) continue;

      remnantLeft[g] -= 1;
      usedStockLength += group.length;
      bins.push({
        capacity: group.length,
        source: 'remnant',
        groupKey: group.key,
        costCents: 0,
        load: len,
        count: 1,
        items: [idx],
      });
      dfs(idx + 1);
      bins.pop();
      usedStockLength -= group.length;
      remnantLeft[g] += 1;
    }

    // 3) 新开一根新料（按单价从低到高尝试）
    for (const mat of materials) {
      if (len > mat.length + EPS) continue;
      costCents += mat.priceCents;
      newCount += 1;
      usedStockLength += mat.length;
      bins.push({
        capacity: mat.length,
        source: 'new',
        groupKey: mat.key,
        costCents: mat.priceCents,
        load: len,
        count: 1,
        items: [idx],
      });
      dfs(idx + 1);
      bins.pop();
      usedStockLength -= mat.length;
      newCount -= 1;
      costCents -= mat.priceCents;
    }
  }

  greedySolution();
  dfs(0);
  return best
    ? { bins: best, totalCostCents: bestCost, newBinCount: bestNewCount, usedStockLength: bestUsed }
    : null;
}

/**
 * 把搜索得到的 bins 整理成输出结构（裁片顺序、锯缝、余长等）。
 * materials 可选：提供时为新料根附加单价（price）与规格键。
 */
function buildBins(optimalBins, pieces, kerf, materials) {
  const materialByKey = new Map((materials || []).map((m) => [m.key, m]));

  // 输出顺序：余料在前（长度从大到小），新料在后
  const ordered = optimalBins
    .slice()
    .sort((a, b) => {
      if ((a.source === 'remnant') !== (b.source === 'remnant')) {
        return a.source === 'remnant' ? -1 : 1;
      }
      return b.capacity - a.capacity;
    });

  return ordered.map((bin, i) => {
    const binPieces = bin.items
      .map((idx) => ({ label: pieces[idx].label, length: round6(pieces[idx].length) }))
      .sort((a, b) => b.length - a.length); // 裁片顺序：同根内按长度从大到小
    const count = binPieces.length;
    const cuts = count - 1; // 相邻切口数
    const pieceSum = binPieces.reduce((s, p) => s + p.length, 0);
    const used = pieceSum + cuts * kerf;
    const out = {
      index: i + 1,
      source: bin.source, // 'remnant' 余料 / 'new' 新料
      stockLength: round6(bin.capacity),
      pieces: binPieces,
      count,
      cuts,
      usedLength: round6(used),
      leftover: round6(bin.capacity - used),
    };
    if (bin.source === 'new' && bin.groupKey != null && materialByKey.has(bin.groupKey)) {
      out.price = round2(materialByKey.get(bin.groupKey).price); // 该根新料的单价
    }
    return out;
  });
}

/** 各规格余料的消耗与剩余（按长度从大到小输出） */
function buildRemnantSummary(remnantGroups, optimalBins) {
  const usedByKey = new Map();
  optimalBins.forEach((bin) => {
    if (bin.source === 'remnant') {
      usedByKey.set(bin.groupKey, (usedByKey.get(bin.groupKey) || 0) + 1);
    }
  });
  return remnantGroups
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((g) => {
      const used = usedByKey.get(g.key) || 0;
      return {
        length: round6(g.length),
        available: g.qty,
        used,
        remaining: g.qty - used,
      };
    });
}

/**
 * 计算下料方案（根数模式）。
 * 输入：{ stockLength, kerf, items: [{ length, qty }], remnants?: [{ length, qty }] }
 * 返回：可直接渲染 JSON；输入非法时抛出 ValidationError（message 为明确原因）。
 */
function computeCuttingPlan(input) {
  const { stockLength, kerf, pieces, remnantGroups } = parseAndValidate(input);
  const lengths = pieces.map((p) => p.length);

  // 第一目标：新料根数最少。从 0 根开始递增，找到第一个可行的新料根数。
  // 上界为总片数（每片独占一根新料必然可行，除非单片超过原料长度只能依赖余料）。
  let feasible = null;
  let newBinCount = 0;
  for (let k = 0; k <= pieces.length; k++) {
    const sol = searchBins({
      lengths,
      stockLength,
      kerf,
      remnantGroups,
      newCount: k,
      minimize: false,
    });
    if (sol) {
      feasible = sol;
      newBinCount = k;
      break;
    }
  }
  if (!feasible) {
    throw new ValidationError(
      '现有余料不足以容纳超过原料长度的裁片，请增加余料根数或调整裁片规格'
    );
  }

  // 第二目标：在新料根数最少的前提下，投入原料总长度最小。
  // 以第一个可行解的投入总长为上界剪枝。
  const optimal =
    searchBins({
      lengths,
      stockLength,
      kerf,
      remnantGroups,
      newCount: newBinCount,
      minimize: true,
      upperBound: feasible.usedStockLength,
    }) || feasible;

  const bins = buildBins(optimal.bins, pieces, kerf);
  const remnants = buildRemnantSummary(remnantGroups, optimal.bins);

  const totalPieces = pieces.length;
  const totalStockLength = bins.reduce((s, b) => s + b.stockLength, 0); // 投入原料总长度
  const totalUsed = bins.reduce((s, b) => s + b.usedLength, 0);
  const totalLeftover = bins.reduce((s, b) => s + b.leftover, 0);
  const remnantBinCount = bins.length - newBinCount;

  return {
    stockLength: round6(stockLength),
    kerf: round6(kerf),
    totalPieces,
    binCount: bins.length,
    newBinCount,
    remnantBinCount,
    totalCuts: totalPieces - bins.length, // 锯缝总数 = 总片数 - 根数
    totalStockLength: round6(totalStockLength),
    totalUsedLength: round6(totalUsed),
    totalLeftover: round6(totalLeftover),
    utilization: round6(totalUsed / totalStockLength),
    remnants,
    bins,
  };
}

/**
 * 计算报价方案（按价格选料模式）。
 * 输入：{ kerf, items: [{ length, qty }], materials: [{ length, price }], remnants?: [{ length, qty }] }
 * 优化目标（字典序）：总采购价最低 → 新料根数最少 → 投入原料总长度最小。
 * 无可行方案时抛出 ValidationError（message 为明确原因）。
 */
function computeQuotePlan(input) {
  const { kerf, pieces, remnantGroups, materials } = parseQuoteInput(input);
  const lengths = pieces.map((p) => p.length);

  const optimal = searchQuoteBins({ lengths, kerf, remnantGroups, materials });
  if (!optimal) {
    // 搜索不可行只可能是：超过所有新料长度的裁片，余料也承载不下
    const maxMaterialLength = materials.reduce((m, g) => Math.max(m, g.length), 0);
    const oversize = [...new Set(lengths.filter((l) => l > maxMaterialLength + EPS))]
      .sort((a, b) => a - b)
      .map((l) => `${round6(l)}`)
      .join('、');
    throw new ValidationError(
      oversize
        ? `无可行方案：长度 ${oversize} 的裁片超过所有新料长度（最长 ${round6(maxMaterialLength)}），` +
          '且现有余料不足或长度不够，无法承载，请增加足够长的余料或调整裁片规格'
        : '无可行方案：现有余料与新料无法容纳全部裁片，请增加余料或调整裁片规格'
    );
  }

  const bins = buildBins(optimal.bins, pieces, kerf, materials);
  const remnants = buildRemnantSummary(remnantGroups, optimal.bins);

  // 采购汇总：每种新料的规格、单价、本次购买根数与小计（按长度从小到大输出）
  const purchasedByKey = new Map();
  optimal.bins.forEach((bin) => {
    if (bin.source === 'new') {
      purchasedByKey.set(bin.groupKey, (purchasedByKey.get(bin.groupKey) || 0) + 1);
    }
  });
  const purchase = materials
    .slice()
    .sort((a, b) => a.length - b.length)
    .map((m) => {
      const count = purchasedByKey.get(m.key) || 0;
      return {
        length: round6(m.length),
        price: round2(m.price),
        count,
        subtotal: round2((m.priceCents * count) / 100),
      };
    });

  const totalPieces = pieces.length;
  const totalStockLength = bins.reduce((s, b) => s + b.stockLength, 0); // 投入原料总长度
  const totalUsed = bins.reduce((s, b) => s + b.usedLength, 0);
  const totalLeftover = bins.reduce((s, b) => s + b.leftover, 0);
  const remnantBinCount = bins.length - optimal.newBinCount;

  return {
    kerf: round6(kerf),
    totalPieces,
    binCount: bins.length,
    newBinCount: optimal.newBinCount,
    remnantBinCount,
    totalCuts: totalPieces - bins.length,
    totalStockLength: round6(totalStockLength),
    totalUsedLength: round6(totalUsed),
    totalLeftover: round6(totalLeftover),
    utilization: round6(totalUsed / totalStockLength),
    totalPrice: round2(optimal.totalCostCents / 100), // 总采购价
    purchase,
    remnants,
    bins,
  };
}

module.exports = {
  computeCuttingPlan,
  computeQuotePlan,
  ValidationError,
  MAX_TOTAL_PIECES,
  MAX_REMNANT_COUNT,
  MAX_MATERIAL_KINDS,
};
