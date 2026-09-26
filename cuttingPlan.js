'use strict';

/**
 * 木工短料下料优化核心算法。
 *
 * 规则说明：
 * - 同规格的裁片先展开成单片（每片带 A1、A2… 编号），再参与计算；
 * - 原料长度表示可购买的新料（数量不限）；可额外录入余料库存（多种长度、各自根数），
 *   每根余料最多使用一次；
 * - 优化目标（字典序）：先使新料根数最少，再使投入原料总长度
 *   （用到的余料长度 + 新料长度之和）最小；精确搜索，保证最优；
 * - 锯缝只发生在同一根原料上相邻的两片之间：
 *   一根原料放 k 片，占用长度 = 各片长度之和 + (k - 1) × 锯缝宽度；
 * - 总裁片数上限 MAX_TOTAL_PIECES = 12；余料总根数上限 MAX_REMNANT_COUNT = 12。
 */

const MAX_TOTAL_PIECES = 12;
const MAX_REMNANT_COUNT = 12;
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

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ValidationError('请至少添加一条裁片规格');
  }

  // 余料库存（可选）：[{ length, qty }]，相同长度合并为一组
  const remnantGroups = [];
  const remnantByKey = new Map(); // 长度 key -> 组
  if (input.remnants !== undefined && input.remnants !== null) {
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
  }

  // 单片可放入的最大原料长度：新料与最长余料中的较大者
  const maxRemnantLength = remnantGroups.reduce((m, g) => Math.max(m, g.length), 0);
  const maxStockLength = Math.max(stockLength, maxRemnantLength);

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
      throw new ValidationError(
        remnantGroups.length === 0
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
 * 计算下料方案。
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

  // 输出顺序：余料在前（长度从大到小），新料在后
  const ordered = optimal.bins
    .slice()
    .sort((a, b) => {
      if ((a.source === 'remnant') !== (b.source === 'remnant')) {
        return a.source === 'remnant' ? -1 : 1;
      }
      return b.capacity - a.capacity;
    });

  const bins = ordered.map((bin, i) => {
    const binPieces = bin.items
      .map((idx) => ({ label: pieces[idx].label, length: round6(pieces[idx].length) }))
      .sort((a, b) => b.length - a.length); // 裁片顺序：同根内按长度从大到小
    const count = binPieces.length;
    const cuts = count - 1; // 相邻切口数
    const pieceSum = binPieces.reduce((s, p) => s + p.length, 0);
    const used = pieceSum + cuts * kerf;
    return {
      index: i + 1,
      source: bin.source, // 'remnant' 余料 / 'new' 新料
      stockLength: round6(bin.capacity),
      pieces: binPieces,
      count,
      cuts,
      usedLength: round6(used),
      leftover: round6(bin.capacity - used),
    };
  });

  // 各规格余料的消耗与剩余（按长度从大到小输出）
  const usedByKey = new Map();
  ordered.forEach((bin) => {
    if (bin.source === 'remnant') {
      usedByKey.set(bin.groupKey, (usedByKey.get(bin.groupKey) || 0) + 1);
    }
  });
  const remnants = remnantGroups
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

module.exports = {
  computeCuttingPlan,
  ValidationError,
  MAX_TOTAL_PIECES,
  MAX_REMNANT_COUNT,
};
