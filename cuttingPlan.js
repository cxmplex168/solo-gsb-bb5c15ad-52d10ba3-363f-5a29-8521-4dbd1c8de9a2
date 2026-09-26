'use strict';

/**
 * 木工短料下料优化核心算法。
 *
 * 两种模式：
 * A. 按根数选料（computeCuttingPlan，对应 /api/optimize）：
 * - 同规格的裁片先展开成单片（每片带 A1、A2… 编号），再参与计算；
 * - 原料长度表示可购买的新料（数量不限）；可额外录入余料库存（多种长度、各自根数），
 *   每根余料最多使用一次；
 * - 优化目标（字典序）：先使新料根数最少，再使投入原料总长度
 *   （用到的余料长度 + 新料长度之和）最小；精确搜索，保证最优；
 *
 * B. 按价格选料（computeQuote，对应 /api/quote）：
 * - 沿用裁片、锯缝与余料输入，另录入 1～3 种可购买新料（长度 + 单价，数量不限）；
 * - 余料视为已有库存、不计采购价，每根最多使用一次；
 * - 优化目标（字典序）：先使总采购价最低，再使新料根数最少，
 *   最后使投入原料总长度最小；精确搜索，保证最优；
 * - 长于所有新料的裁片只能由足够长的余料承载；余料不足时给出明确原因。
 *
 * 共同规则：
 * - 锯缝只发生在同一根原料上相邻的两片之间：
 *   一根原料放 k 片，占用长度 = 各片长度之和 + (k - 1) × 锯缝宽度；
 * - 总裁片数上限 MAX_TOTAL_PIECES = 12；余料总根数上限 MAX_REMNANT_COUNT = 12；
 * - 可购买新料规格上限 MAX_MATERIAL_TYPES = 3（仅报价模式）。
 */

const MAX_TOTAL_PIECES = 12;
const MAX_REMNANT_COUNT = 12;
const MAX_MATERIAL_TYPES = 3;
const MAX_QTY_PER_SPEC = 99;
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

function isPositiveInteger(n) {
  return Number.isInteger(n) && n >= 1;
}

/**
 * 解析余料库存（可选）：[{ length, qty }]，相同长度合并为一组。
 * 返回按长度分组的数组 [{ key, length, qty }]（不排序）。
 */
function parseRemnantGroups(remnants) {
  const groups = [];
  const byKey = new Map(); // 长度 key -> 组
  if (remnants === undefined || remnants === null) return groups;
  if (!Array.isArray(remnants)) {
    throw new ValidationError('余料库存格式不正确');
  }
  remnants.forEach((rem, idx) => {
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
    if (byKey.has(key)) {
      byKey.get(key).qty += qty;
    } else {
      const group = { key, length, qty };
      byKey.set(key, group);
      groups.push(group);
    }
  });

  const total = groups.reduce((s, g) => s + g.qty, 0);
  if (total > MAX_REMNANT_COUNT) {
    throw new ValidationError(
      `余料总根数为 ${total} 根，超过上限 ${MAX_REMNANT_COUNT} 根，请减少余料数量`
    );
  }
  return groups;
}

/**
 * 解析裁片规格并展开成单片。
 * inputItems：[{ length, qty }]；
 * maxStockLength：单片可放入的最大原料长度（新料与最长余料中的较大者）；
 * stockLength / hasRemnants：仅用于组织超长报错文案。
 * 返回展开后的数组 [{ label, length }]（不排序）。
 */
function parsePieces(inputItems, maxStockLength, stockLength, hasRemnants) {
  if (!Array.isArray(inputItems) || inputItems.length === 0) {
    throw new ValidationError('请至少添加一条裁片规格');
  }

  const pieces = [];
  let totalCount = 0;
  const specNames = new Map(); // length -> 规格字母

  inputItems.forEach((item, idx) => {
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
      throw new ValidationError(
        !hasRemnants
          ? `第 ${row} 条规格：长度 ${length} 超过原料长度 ${stockLength}，单片无法放入原料`
          : `第 ${row} 条规格：长度 ${length} 超过原料长度 ${stockLength} 及所有余料长度，单片无法放入任何原料`
      );
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

  return pieces;
}

/**
 * 解析并校验输入，返回 { stockLength, kerf, pieces, remnantGroups }。
 * pieces 为展开后的数组：[{ label, length }]，按长度从大到小排序；
 * remnantGroups 为按长度分组的余料：[{ key, length, qty }]，按长度从小到大排序。
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

  const remnantGroups = parseRemnantGroups(input.remnants);
  const maxRemnantLength = remnantGroups.reduce((m, g) => Math.max(m, g.length), 0);
  const maxStockLength = Math.max(stockLength, maxRemnantLength);

  const pieces = parsePieces(input.items, maxStockLength, stockLength, remnantGroups.length > 0);

  // 裁片从大到小排序，加速搜索收敛；余料组从小到大排序，优先尝试短余料
  pieces.sort((a, b) => b.length - a.length);
  remnantGroups.sort((a, b) => a.length - b.length);

  return { stockLength, kerf, pieces, remnantGroups };
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
 * 对搜索得到的 bins 排序：余料在前、新料在后；同类按长度从大到小。
 */
function orderBins(bins) {
  return bins.slice().sort((a, b) => {
    if ((a.source === 'remnant') !== (b.source === 'remnant')) {
      return a.source === 'remnant' ? -1 : 1;
    }
    return b.capacity - a.capacity;
  });
}

/**
 * 把已开启的搜索 bin 转成对外的明细对象。
 * withPrice=true 时（报价模式）新料附带 unitPrice 与 binPrice。
 */
function describeBin(bin, index, pieces, kerf, withPrice) {
  const binPieces = bin.items
    .map((idx) => ({ label: pieces[idx].label, length: round6(pieces[idx].length) }))
    .sort((a, b) => b.length - a.length); // 裁片顺序：同根内按长度从大到小
  const count = binPieces.length;
  const cuts = count - 1; // 相邻切口数
  const pieceSum = binPieces.reduce((s, p) => s + p.length, 0);
  const used = pieceSum + cuts * kerf;
  const out = {
    index,
    source: bin.source, // 'remnant' 余料 / 'new' 新料
    stockLength: round6(bin.capacity),
    pieces: binPieces,
    count,
    cuts,
    usedLength: round6(used),
    leftover: round6(bin.capacity - used),
  };
  if (withPrice && bin.source === 'new') {
    const spec = bin.spec;
    out.unitPrice = roundPrice(spec.price);
    out.binPrice = roundPrice(spec.price); // 每根一根的采购价即单价
  }
  return out;
}

/**
 * 汇总各规格余料的消耗与剩余（按长度从大到小输出）。
 */
function summarizeRemnants(orderedBins, remnantGroups) {
  const usedByKey = new Map();
  orderedBins.forEach((bin) => {
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
 * 计算下料方案（按根数选料）。
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

  const ordered = orderBins(optimal.bins);
  const bins = ordered.map((bin, i) => describeBin(bin, i + 1, pieces, kerf, false));
  const remnants = summarizeRemnants(ordered, remnantGroups);

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
 * 报价模式：单价以“分”（整数）参与搜索与比较，避免浮点误差。
 */
function toCents(price) {
  return Math.round(price * 100);
}

function roundPrice(n) {
  return Math.round(n * 100) / 100;
}

/**
 * 解析可购买新料规格（1～3 种）：[{ length, price }]。
 * 长度、单价必须为正数；单价最多两位小数；同长度规格不得重复。
 * 返回 [{ key, length, price, cents }]，保持录入顺序。
 */
function parseMaterials(inputMaterials) {
  if (!Array.isArray(inputMaterials)) {
    throw new ValidationError('可购买新料格式不正确');
  }
  const materials = [];
  const keys = new Set();

  inputMaterials.forEach((m, idx) => {
    const row = idx + 1;
    const length = toNumber(m && m.length);
    const price = toNumber(m && m.price);

    if (!Number.isFinite(length) || length <= 0) {
      throw new ValidationError(`第 ${row} 种新料：长度必须是大于 0 的数字`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new ValidationError(`第 ${row} 种新料：单价必须是大于 0 的数字`);
    }
    // 单价最多两位小数（用四舍五入容差判断，规避 10.1*100 之类浮点误差）
    const rounded2 = Math.round(price * 100) / 100;
    if (Math.abs(rounded2 - price) > 1e-7 + 1e-10 * Math.abs(price)) {
      throw new ValidationError(`第 ${row} 种新料：单价最多保留两位小数`);
    }

    const key = String(round6(length));
    if (keys.has(key)) {
      throw new ValidationError(`第 ${row} 种新料：长度 ${round6(length)} 的规格重复，请修改长度`);
    }
    keys.add(key);
    materials.push({ key, length, price, cents: toCents(price) });
  });

  if (materials.length === 0) {
    throw new ValidationError('请至少添加一种可购买新料');
  }
  if (materials.length > MAX_MATERIAL_TYPES) {
    throw new ValidationError(`可购买新料最多 ${MAX_MATERIAL_TYPES} 种`);
  }
  return materials;
}

/**
 * 报价模式的精确搜索（DFS + 字典序剪枝）。
 *
 * 目标（字典序最小）：总采购价（分）→ 新料根数 → 投入原料总长度。
 * 余料为已有库存，不计采购价，每组根数有限（每根最多用一次）；
 * 新料规格有 materials.length 种，数量不限，按单价从低到高尝试。
 *
 * 剪枝：
 * - 当前 (priceCents, newCount, usedLength) 已不可能严格优于已知最优；
 * - 剩余裁片中若存在“既放不进任何已开余料、也放不进任何未用余料”的裁片，
 *   至少还需开一根新料：按该最长裁片可选的最便宜新料单价估计价格下界、
 *   并按“两两互不相容”的最大裁片数估计新料根数下界。
 */
function searchQuoteBins({ lengths, kerf, remnantGroups, materials }) {
  const n = lengths.length;
  const bins = [];
  const remnantLeft = remnantGroups.map((g) => g.qty);
  const materialsAsc = materials.slice().sort((a, b) =>
    a.cents !== b.cents ? a.cents - b.cents : a.length - b.length
  );
  // 余料组按长度从大到小，便于下界计算（最长优先）
  const remDesc = remnantGroups.map((g, i) => ({ group: g, idx: i }))
    .sort((x, y) => y.group.length - x.group.length);

  let usedLength = 0;
  let priceCents = 0;
  let newCount = 0;

  let bestPrice = Infinity;
  let bestNew = Infinity;
  let bestUsed = Infinity;
  let best = null;

  function snapshot() {
    return bins.map((b) => ({ ...b, items: b.items.slice() }));
  }

  /** 当前状态（价格、新料根数）是否仍可能严格优于已知最优 */
  function worseThanBest() {
    if (priceCents !== bestPrice) return priceCents > bestPrice;
    if (newCount !== bestNew) return newCount > bestNew;
    return usedLength >= bestUsed - EPS;
  }

  /**
   * 基于剩余裁片的乐观下界剪枝。
   * 返回 true 表示当前状态不可能优于已知最优，应直接剪枝。
   */
  function lowerBoundPrune(idx) {
    if (!isFinite(bestPrice)) return false;

    // 收集“必须由新料承载”的剩余裁片：
    // 放不进任何已开原料（余料或新料的剩余容量），也放不进任何未用余料。
    const mustNew = [];
    for (let i = idx; i < n; i++) {
      const len = lengths[i];
      let fitsExisting = false;
      for (const bin of bins) {
        const added = bin.count > 0 ? len + kerf : len;
        if (bin.load + added <= bin.capacity + EPS) {
          fitsExisting = true;
          break;
        }
      }
      if (!fitsExisting) {
        for (const r of remDesc) {
          if (remnantLeft[r.idx] > 0 && len <= r.group.length + EPS) {
            fitsExisting = true;
            break;
          }
        }
      }
      if (!fitsExisting) mustNew.push(len);
    }
    if (mustNew.length === 0) return false;

    // 价格下界：最长的“必须新料”裁片至少要开一根能容纳它的最便宜新料
    const maxLen = mustNew.reduce((m, x) => Math.max(m, x), 0);
    let cheapest = Infinity;
    for (const spec of materials) {
      if (maxLen <= spec.length + EPS && spec.cents < cheapest) cheapest = spec.cents;
    }
    if (cheapest === Infinity) return true; // 没有任何新料能容纳（理论上已被预检查拦截）
    if (priceCents + cheapest > bestPrice) return true;
    if (priceCents + cheapest === bestPrice && newCount + 1 > bestNew) return true;

    // 新料根数下界：剩余“必须新料”裁片中，最大的“两两不能同放一根（即便用最长新料）”
    // 集合大小。一组裁片两两互不相容，当且仅当其最短的两片之和仍超过最长新料；
    // 故在从大到小排序中取最大的 t，使第 t-1、t 大片之和超限（t 大片即构成团）。
    const longestNew = materials.reduce((m, s) => Math.max(m, s.length), 0);
    const desc = mustNew.slice().sort((a, b) => b - a);
    let clique = 1;
    for (let t = desc.length; t >= 2; t--) {
      if (desc[t - 2] + kerf + desc[t - 1] > longestNew + EPS) {
        clique = t;
        break;
      }
    }
    if (priceCents + cheapest === bestPrice && newCount + clique > bestNew) return true;

    // 价格长度下界：逐片取“能容纳该片的新料中最低单位长度单价”，
    // Σ 片长 × 该比率不超过任何整数方案的采购价（同根共担只会更省），故为安全下界；
    // 长于所有新料的裁片只能用免费余料，不计入。
    let rateBound = 0;
    for (const ml of mustNew) {
      let rate = Infinity;
      for (const spec of materials) {
        if (ml <= spec.length + EPS) rate = Math.min(rate, spec.cents / spec.length);
      }
      if (rate !== Infinity) rateBound += ml * rate;
    }
    const fracBound = Math.max(cheapest, rateBound);
    if (priceCents + fracBound > bestPrice + EPS) return true;

    return false;
  }

  function dfs(idx) {
    if (worseThanBest()) return;
    if (lowerBoundPrune(idx)) return;

    if (idx === n) {
      if (
        priceCents < bestPrice ||
        (priceCents === bestPrice &&
          (newCount < bestNew || (newCount === bestNew && usedLength < bestUsed - EPS)))
      ) {
        bestPrice = priceCents;
        bestNew = newCount;
        bestUsed = usedLength;
        best = snapshot();
      }
      return;
    }

    const len = lengths[idx];
    const seen = new Set(); // 跳过容量、负载、片数均相同的等价原料

    // 1) 尝试放入已开的原料
    for (let b = 0; b < bins.length; b++) {
      const bin = bins[b];
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

    // 2) 新开一根余料（组按长度升序，优先短料；同组等价只试一次）
    for (let g = 0; g < remnantGroups.length; g++) {
      if (remnantLeft[g] === 0) continue;
      const group = remnantGroups[g];
      if (len > group.length + EPS) continue;

      remnantLeft[g] -= 1;
      usedLength += group.length;
      bins.push({
        capacity: group.length,
        source: 'remnant',
        groupKey: group.key,
        spec: null,
        load: len,
        count: 1,
        items: [idx],
      });
      dfs(idx + 1);
      bins.pop();
      usedLength -= group.length;
      remnantLeft[g] += 1;
    }

    // 3) 新开一根可购买新料（单价从低到高；单片独占不计锯缝）
    for (const spec of materialsAsc) {
      if (len > spec.length + EPS) continue;

      newCount += 1;
      priceCents += spec.cents;
      usedLength += spec.length;
      bins.push({
        capacity: spec.length,
        source: 'new',
        groupKey: null,
        spec,
        load: len,
        count: 1,
        items: [idx],
      });
      dfs(idx + 1);
      bins.pop();
      usedLength -= spec.length;
      priceCents -= spec.cents;
      newCount -= 1;
    }
  }

  /**
   * 贪心构造一个可行解，作为精确搜索的初始上界（只影响速度，不影响最优性）。
   * 依次处理每片（已按长度从大到小）：能塞进已开原料就选最紧的；
   * 否则优先开一根余料（免费，取能容纳的最短余料）；
   * 再否则开一根“按长度折算单位价最便宜”的新料。
   * 返回 { bins, priceCents, newCount, usedLength } 或 null。
   */
  function greedy() {
    const gBins = [];
    const gRemLeft = remnantLeft.slice();
    let gPrice = 0;
    let gNew = 0;
    let gUsed = 0;

    for (let idx = 0; idx < n; idx++) {
      const len = lengths[idx];

      // 1) 已开原料中选剩余容量最小、且放得下的（最紧适配）
      let target = null;
      let targetLeft = Infinity;
      for (const bin of gBins) {
        const added = bin.count > 0 ? len + kerf : len;
        const remain = bin.capacity - (bin.load + added);
        if (remain >= -EPS && remain < targetLeft) {
          target = bin;
          targetLeft = remain;
        }
      }
      if (target !== null) {
        const added = target.count > 0 ? len + kerf : len;
        target.load += added;
        target.count += 1;
        target.items.push(idx);
        continue;
      }

      // 2) 新开余料：组按长度升序，第一根放得下的即最短
      let openedRem = false;
      for (let g = 0; g < remnantGroups.length; g++) {
        if (gRemLeft[g] > 0 && len <= remnantGroups[g].length + EPS) {
          gRemLeft[g] -= 1;
          gUsed += remnantGroups[g].length;
          gBins.push({
            capacity: remnantGroups[g].length,
            source: 'remnant',
            groupKey: remnantGroups[g].key,
            spec: null,
            load: len,
            count: 1,
            items: [idx],
          });
          openedRem = true;
          break;
        }
      }
      if (openedRem) continue;

      // 3) 开新料：能容纳本片的规格中，单位长度单价最低（同率取总价低）
      let pick = null;
      let pickRate = Infinity;
      for (const spec of materialsAsc) {
        if (len <= spec.length + EPS) {
          const rate = spec.cents / spec.length;
          if (rate < pickRate - EPS || (Math.abs(rate - pickRate) <= EPS && pick !== null && spec.cents < pick.cents)) {
            pick = spec;
            pickRate = rate;
          }
        }
      }
      if (pick === null) return null; // 理论上已被预检查拦截
      gNew += 1;
      gPrice += pick.cents;
      gUsed += pick.length;
      gBins.push({
        capacity: pick.length,
        source: 'new',
        groupKey: null,
        spec: pick,
        load: len,
        count: 1,
        items: [idx],
      });
    }

    return { bins: gBins.map((b) => ({ ...b, items: b.items.slice() })), priceCents: gPrice, newCount: gNew, usedLength: gUsed };
  }

  const greedySol = greedy();
  if (greedySol) {
    bestPrice = greedySol.priceCents;
    bestNew = greedySol.newCount;
    bestUsed = greedySol.usedLength;
    best = greedySol.bins;
  }

  dfs(0);
  return best ? { bins: best, priceCents: bestPrice, newCount: bestNew, usedLength: bestUsed } : null;
}

/**
 * 仅检查“长于所有新料”的裁片能否全部由余料承载（DFS 可行性搜索）。
 */
function oversizedFeasible({ lengths, kerf, remnantGroups }) {
  const maxNew = 0; // 不允许开任何新料
  const sol = searchBins({
    lengths,
    stockLength: maxNew,
    kerf,
    remnantGroups,
    newCount: 0,
    minimize: false,
  });
  return !!sol;
}

/**
 * 计算按价格选料的报价方案。
 * 输入：{ kerf, items: [{ length, qty }], remnants?: [{ length, qty }],
 *         materials: [{ length, price }] }
 * 返回：可直接渲染 JSON；输入非法或无可行方案时抛出 ValidationError。
 */
function computeQuote(input) {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('请求格式不正确');
  }

  const kerf = toNumber(input.kerf);
  if (!Number.isFinite(kerf) || kerf < 0) {
    throw new ValidationError('锯缝宽度必须是不小于 0 的数字');
  }

  const materials = parseMaterials(input.materials);
  const remnantGroups = parseRemnantGroups(input.remnants);
  const maxRemnantLength = remnantGroups.reduce((m, g) => Math.max(m, g.length), 0);
  const maxMaterialLength = materials.reduce((m, s) => Math.max(m, s.length), 0);
  const maxStockLength = Math.max(maxMaterialLength, maxRemnantLength);

  // 单片超长校验：报错文案中的“原料长度”取最长可购买新料
  const pieces = parsePieces(input.items, maxStockLength, round6(maxMaterialLength), remnantGroups.length > 0);
  pieces.sort((a, b) => b.length - a.length);
  remnantGroups.sort((a, b) => a.length - b.length);
  const lengths = pieces.map((p) => p.length);

  // 长于所有新料的裁片只能由余料承载：单独验证其可行性，给出明确原因
  const oversized = pieces.filter((p) => p.length > maxMaterialLength + EPS);
  if (oversized.length > 0) {
    const feasible = oversizedFeasible({
      lengths: oversized.map((p) => p.length),
      kerf,
      remnantGroups,
    });
    if (!feasible) {
      const labels = oversized.map((p) => `${p.label}(${round6(p.length)})`).join('、');
      throw new ValidationError(
        `无可行方案：裁片 ${labels} 长于所有可购买新料，现有余料（最多 ${round6(maxRemnantLength)}）` +
          '根数或长度不足以全部承载，请增加足够长的余料或新料规格'
      );
    }
  }

  const sol = searchQuoteBins({ lengths, kerf, remnantGroups, materials });
  if (!sol) {
    throw new ValidationError('无可行方案：现有余料与可购买新料无法容纳全部裁片，请调整输入');
  }

  const ordered = orderBins(sol.bins);
  const bins = ordered.map((bin, i) => describeBin(bin, i + 1, pieces, kerf, true));
  const remnants = summarizeRemnants(ordered, remnantGroups);

  // 采购汇总：按新料长度归并根数（仅列出实际购买的规格，长度从大到小）
  const purchaseByKey = new Map();
  ordered.forEach((bin) => {
    if (bin.source === 'new') {
      const key = String(round6(bin.capacity));
      const cur = purchaseByKey.get(key) || { length: bin.capacity, unitPrice: bin.spec.price, qty: 0 };
      cur.qty += 1;
      purchaseByKey.set(key, cur);
    }
  });
  const purchase = Array.from(purchaseByKey.values())
    .sort((a, b) => b.length - a.length)
    .map((p) => ({
      length: round6(p.length),
      unitPrice: roundPrice(p.unitPrice),
      qty: p.qty,
      subtotal: roundPrice(p.unitPrice * p.qty),
    }));

  const totalPieces = pieces.length;
  const newBinCount = sol.newCount;
  const remnantBinCount = bins.length - newBinCount;
  const totalStockLength = bins.reduce((s, b) => s + b.stockLength, 0);
  const totalUsed = bins.reduce((s, b) => s + b.usedLength, 0);
  const totalLeftover = bins.reduce((s, b) => s + b.leftover, 0);

  return {
    mode: 'quote',
    kerf: round6(kerf),
    totalPieces,
    binCount: bins.length,
    newBinCount,
    remnantBinCount,
    totalCuts: totalPieces - bins.length,
    totalPrice: roundPrice(sol.priceCents / 100),
    totalStockLength: round6(totalStockLength),
    totalUsedLength: round6(totalUsed),
    totalLeftover: round6(totalLeftover),
    utilization: round6(totalUsed / totalStockLength),
    materials: materials.map((s) => ({ length: round6(s.length), unitPrice: roundPrice(s.price) })),
    purchase,
    remnants,
    bins,
  };
}

module.exports = {
  computeCuttingPlan,
  computeQuote,
  ValidationError,
  MAX_TOTAL_PIECES,
  MAX_REMNANT_COUNT,
  MAX_MATERIAL_TYPES,
};
