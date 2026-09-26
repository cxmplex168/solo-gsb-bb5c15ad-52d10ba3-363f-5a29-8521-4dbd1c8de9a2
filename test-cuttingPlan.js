'use strict';
const { computeCuttingPlan, ValidationError } = require('./cuttingPlan');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

// 1) 无余料：保持原有结果（2440 / 锯缝 3：800×2 + 600×2 + 400×1 → 2 根）
check('无余料时结果与原来一致', () => {
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 3,
    items: [
      { length: 800, qty: 2 },
      { length: 600, qty: 2 },
      { length: 400, qty: 1 },
    ],
  });
  assert(r.binCount === 2, `期望 2 根，实际 ${r.binCount}`);
  assert(r.newBinCount === 2 && r.remnantBinCount === 0, '应全部为新料');
  assert(r.totalCuts === 3, `锯缝总数应为 3，实际 ${r.totalCuts}`);
  assert(r.bins.every((b) => b.source === 'new' && b.stockLength === 2440), '每根应为 2440 新料');
  assert(Array.isArray(r.remnants) && r.remnants.length === 0, '无余料时 remnants 应为空数组');
});

// 2) 余料参与：优先用余料，新料根数最少（0 根新料）
check('余料可容纳全部裁片时新料根数为 0', () => {
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 0,
    items: [{ length: 500, qty: 3 }],
    remnants: [{ length: 1600, qty: 1 }, { length: 1100, qty: 1 }],
  });
  assert(r.newBinCount === 0, `期望 0 根新料，实际 ${r.newBinCount}`);
  assert(r.binCount === 1 && r.bins[0].source === 'remnant', '应只用 1 根余料');
  assert(r.bins[0].stockLength === 1600, `应选 1600 余料，实际 ${r.bins[0].stockLength}`);
  assert(r.totalStockLength === 1600, `投入总长应为 1600，实际 ${r.totalStockLength}`);
});

// 3) 第二目标：新料根数相同，选投入总长度最小（1000×1 优于 600×2）
check('新料根数相同时投入总长度最小', () => {
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 0,
    items: [{ length: 500, qty: 2 }],
    remnants: [{ length: 1000, qty: 1 }, { length: 600, qty: 2 }],
  });
  assert(r.newBinCount === 0, `期望 0 根新料，实际 ${r.newBinCount}`);
  assert(r.totalStockLength === 1000, `投入总长应为 1000，实际 ${r.totalStockLength}`);
  const rem1000 = r.remnants.find((x) => x.length === 1000);
  const rem600 = r.remnants.find((x) => x.length === 600);
  assert(rem1000.used === 1 && rem1000.remaining === 0, '1000 余料应消耗 1 根');
  assert(rem600.used === 0 && rem600.remaining === 2, '600 余料应全部剩余');
});

// 4) 每根余料最多使用一次
check('每根余料最多使用一次', () => {
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 0,
    items: [{ length: 1500, qty: 2 }],
    remnants: [{ length: 1600, qty: 1 }],
  });
  // 两片无法同放一根新料（1500+1500 > 2440），余料只有 1 根：
  // 最优为 1 根余料 + 1 根新料；余料若能用两次则会出现 2 根余料
  assert(r.newBinCount === 1, `期望 1 根新料，实际 ${r.newBinCount}`);
  assert(r.remnantBinCount === 1, `应使用 1 根余料，实际 ${r.remnantBinCount}`);
  const rem = r.remnants.find((x) => x.length === 1600);
  assert(rem.used === 1 && rem.remaining === 0, '余料应消耗 1 根剩 0 根');
});

// 5) 锯缝规则在余料上同样生效（同根相邻两片间一条锯缝）
check('余料上的锯缝按相邻裁片计算', () => {
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 10,
    items: [{ length: 1200, qty: 2 }],
    remnants: [{ length: 2500, qty: 1 }],
  });
  // 1200+10+1200 = 2410 ≤ 2500，两片同放一根余料，计 1 条锯缝
  assert(r.newBinCount === 0 && r.remnantBinCount === 1, '应只用 1 根余料');
  const remBin = r.bins.find((b) => b.source === 'remnant');
  assert(remBin.count === 2 && remBin.cuts === 1, '两片同根应计 1 条锯缝');
  assert(remBin.usedLength === 2410, `已用应为 2410，实际 ${remBin.usedLength}`);
  assert(remBin.leftover === 90, `余长应为 90，实际 ${remBin.leftover}`);
});

// 6) 单片超过原料长度但余料可容纳
check('单片超过新料长度时可由余料容纳', () => {
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 3,
    items: [{ length: 3000, qty: 1 }],
    remnants: [{ length: 3100, qty: 1 }],
  });
  assert(r.newBinCount === 0 && r.remnantBinCount === 1, '应只用余料');
});

// 7) 单片超过所有原料 → 明确报错
check('单片超过所有原料长度时报错', () => {
  let msg = '';
  try {
    computeCuttingPlan({
      stockLength: 2440,
      kerf: 3,
      items: [{ length: 5000, qty: 1 }],
      remnants: [{ length: 3100, qty: 1 }],
    });
  } catch (e) {
    msg = e.message;
    assert(e instanceof ValidationError, '应为 ValidationError');
  }
  assert(msg.includes('无法放入'), `报错信息不明确：${msg}`);
});

// 8) 余料数量校验
check('余料总根数超过上限时报错', () => {
  let msg = '';
  try {
    computeCuttingPlan({
      stockLength: 2440,
      kerf: 3,
      items: [{ length: 100, qty: 1 }],
      remnants: [{ length: 500, qty: 13 }],
    });
  } catch (e) {
    msg = e.message;
    assert(e instanceof ValidationError, '应为 ValidationError');
  }
  assert(msg.includes('余料'), `报错信息不明确：${msg}`);
});

// 9) 余料参数非法时报错
check('余料长度/根数非法时报错', () => {
  for (const remnants of [
    [{ length: -5, qty: 1 }],
    [{ length: 500, qty: 0 }],
    [{ length: 500, qty: 1.5 }],
  ]) {
    let ok = false;
    try {
      computeCuttingPlan({ stockLength: 2440, kerf: 3, items: [{ length: 100, qty: 1 }], remnants });
    } catch (e) {
      ok = e instanceof ValidationError;
    }
    assert(ok, `应拒绝非法余料 ${JSON.stringify(remnants)}`);
  }
});

// 10) 混合场景：余料 + 新料混用，验证汇总与利用率
check('余料新料混用时的汇总正确', () => {
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 3,
    items: [
      { length: 1200, qty: 2 },
      { length: 800, qty: 2 },
    ],
    remnants: [{ length: 1300, qty: 2 }, { length: 900, qty: 1 }],
  });
  // 最优：1 根新料装 1200+800（2003），1300 余料装 1200，900 余料装 800
  // 共 1 根新料 + 2 根余料，投入总长 2440+1300+900 = 4640
  assert(r.newBinCount === 1, `期望 1 根新料，实际 ${r.newBinCount}`);
  assert(r.remnantBinCount === 2, `期望 2 根余料，实际 ${r.remnantBinCount}`);
  assert(r.totalStockLength === 4640, `投入总长应为 4640，实际 ${r.totalStockLength}`);
  const usedSum = r.bins.reduce((s, b) => s + b.usedLength, 0);
  assert(Math.abs(usedSum - r.totalUsedLength) < 1e-6, 'totalUsedLength 应等于各根之和');
  const stockSum = r.bins.reduce((s, b) => s + b.stockLength, 0);
  assert(Math.abs(stockSum - r.totalStockLength) < 1e-6, 'totalStockLength 应等于各根之和');
  const remUsed = r.remnants.reduce((s, x) => s + x.used, 0);
  assert(remUsed === r.remnantBinCount, '余料消耗总数应等于余料根数');
  r.remnants.forEach((x) => assert(x.used + x.remaining === x.available, '消耗+剩余应等于可用'));
});

// 11) 相同长度余料多行录入会合并
check('相同长度余料合并统计', () => {
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 0,
    items: [{ length: 500, qty: 2 }],
    remnants: [{ length: 600, qty: 1 }, { length: 600, qty: 1 }],
  });
  assert(r.remnants.length === 1, '相同长度应合并为一组');
  assert(r.remnants[0].available === 2, '可用应为 2 根');
  assert(r.remnants[0].used === 2 && r.remnants[0].remaining === 0, '应消耗 2 根');
});

// 12) 性能：12 片 + 12 根余料的最坏规模应在可接受时间内完成
check('12 片 + 12 根余料在 10 秒内完成', () => {
  const t0 = Date.now();
  const r = computeCuttingPlan({
    stockLength: 2440,
    kerf: 3,
    items: [
      { length: 800, qty: 3 },
      { length: 650, qty: 3 },
      { length: 500, qty: 3 },
      { length: 320, qty: 3 },
    ],
    remnants: [
      { length: 1500, qty: 3 },
      { length: 1200, qty: 3 },
      { length: 900, qty: 3 },
      { length: 700, qty: 3 },
    ],
  });
  const ms = Date.now() - t0;
  assert(ms < 10000, `耗时 ${ms}ms 超过 10 秒`);
  assert(r.binCount >= 1, '应有结果');
  console.log(`  （耗时 ${ms}ms，新料 ${r.newBinCount} 根，余料 ${r.remnantBinCount} 根）`);
});

console.log(`\n${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
