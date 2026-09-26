'use strict';
const { computeCuttingPlan, computeQuote, ValidationError } = require('./cuttingPlan');

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

// ===== 按价格选料（computeQuote / /api/quote）=====

// Q1) 首选目标：总采购价最低（2 根 1220@40 = 80 优于 1 根 2440@100）
check('报价：总采购价最低优先于新料根数', () => {
  const r = computeQuote({
    kerf: 0,
    items: [{ length: 500, qty: 4 }],
    materials: [{ length: 2440, price: 100 }, { length: 1220, price: 40 }],
  });
  assert(r.totalPrice === 80, `总价应为 80，实际 ${r.totalPrice}`);
  assert(r.newBinCount === 2, `应购 2 根短料，实际 ${r.newBinCount}`);
  assert(r.purchase.length === 1 && r.purchase[0].length === 1220, '应只采购 1220 规格');
  assert(r.purchase[0].subtotal === 80 && r.purchase[0].qty === 2, '小计应为 40×2=80');
});

// Q2) 同价：新料根数最少（1×2440@100 与 2×1220@50 同价，取 1 根）
check('报价：同价时新料根数最少', () => {
  const r = computeQuote({
    kerf: 0,
    items: [{ length: 500, qty: 4 }],
    materials: [{ length: 2440, price: 100 }, { length: 1220, price: 50 }],
  });
  assert(r.totalPrice === 100, `总价应为 100，实际 ${r.totalPrice}`);
  assert(r.newBinCount === 1, `应购 1 根，实际 ${r.newBinCount}`);
  assert(r.purchase[0].length === 2440, '应选 2440 规格');
});

// Q3) 同价同根数：投入原料总长度最小（2000 与 2440 同价，取 2000）
check('报价：同价同根数时投入总长度最小', () => {
  const r = computeQuote({
    kerf: 0,
    items: [{ length: 500, qty: 4 }],
    materials: [{ length: 2440, price: 100 }, { length: 2000, price: 100 }],
  });
  assert(r.totalPrice === 100 && r.newBinCount === 1, '应 1 根共 100');
  assert(r.totalStockLength === 2000, `投入总长应为 2000，实际 ${r.totalStockLength}`);
});

// Q4) 余料免费优先：余料可容纳全部裁片时不采购
check('报价：余料可容纳全部裁片时总价为 0', () => {
  const r = computeQuote({
    kerf: 0,
    items: [{ length: 500, qty: 3 }],
    remnants: [{ length: 1600, qty: 1 }],
    materials: [{ length: 2440, price: 100 }, { length: 1220, price: 40 }],
  });
  assert(r.totalPrice === 0, `总价应为 0，实际 ${r.totalPrice}`);
  assert(r.newBinCount === 0 && r.remnantBinCount === 1, '应只用 1 根余料');
  assert(Array.isArray(r.purchase) && r.purchase.length === 0, 'purchase 应为空数组');
});

// Q5) 每根余料最多用一次（报价模式同样生效）
check('报价：每根余料最多使用一次', () => {
  const r = computeQuote({
    kerf: 0,
    items: [{ length: 1500, qty: 2 }],
    remnants: [{ length: 1600, qty: 1 }],
    materials: [{ length: 2440, price: 100 }],
  });
  assert(r.remnantBinCount === 1, `应用 1 根余料，实际 ${r.remnantBinCount}`);
  assert(r.newBinCount === 1, `应购 1 根新料，实际 ${r.newBinCount}`);
  assert(r.totalPrice === 100, `总价应为 100，实际 ${r.totalPrice}`);
});

// Q6) 锯缝仍只计同根相邻裁片
check('报价：锯缝按同根相邻裁片计算', () => {
  const r = computeQuote({
    kerf: 10,
    items: [{ length: 1200, qty: 2 }],
    materials: [{ length: 2440, price: 100 }],
  });
  assert(r.newBinCount === 1, '两片应同放一根新料');
  const b = r.bins[0];
  assert(b.cuts === 1 && b.usedLength === 2410 && b.leftover === 30, '应计 1 条锯缝 2410/余30');
});

// Q7) 长于所有新料的裁片可由足够长的余料承载
check('报价：超长裁片由足够长的余料承载', () => {
  const r = computeQuote({
    kerf: 3,
    items: [{ length: 3000, qty: 1 }, { length: 500, qty: 2 }],
    remnants: [{ length: 3100, qty: 1 }, { length: 600, qty: 1 }],
    materials: [{ length: 2440, price: 100 }, { length: 1200, price: 60 }],
  });
  assert(r.remnantBinCount === 1 && r.newBinCount === 1, '应 1 根超长余料 + 1 根新料');
  assert(r.totalPrice === 60, `超长件用余料，两片 500 合走 1200 新料，总价应为 60，实际 ${r.totalPrice}`);
  const overBin = r.bins.find((b) => b.source === 'remnant');
  assert(overBin.pieces.some((p) => p.length === 3000), '3000 裁片应由余料承载');
});

// Q8) 超长裁片余料不足：明确原因
check('报价：超长裁片余料不足时给出明确原因', () => {
  let msg = '';
  try {
    computeQuote({
      kerf: 3,
      items: [{ length: 3000, qty: 2 }],
      remnants: [{ length: 3100, qty: 1 }],
      materials: [{ length: 2440, price: 100 }],
    });
  } catch (e) {
    msg = e.message;
    assert(e instanceof ValidationError, '应为 ValidationError');
  }
  assert(msg.includes('无可行方案'), `应提示无可行方案：${msg}`);
  assert(msg.includes('3000'), '应指出超长裁片长度');
});

// Q9) 新料录入校验：1～3 种、正数、单价两位小数、长度不重复
check('报价：新料录入校验', () => {
  const base = { kerf: 0, items: [{ length: 500, qty: 1 }] };
  const bad = [
    { materials: [] }, // 0 种
    {
      materials: [
        { length: 2440, price: 10 },
        { length: 2000, price: 9 },
        { length: 1500, price: 8 },
        { length: 1000, price: 7 },
      ],
    }, // 4 种
    { materials: [{ length: 0, price: 10 }] }, // 长度非正
    { materials: [{ length: 2440, price: 0 }] }, // 单价非正
    { materials: [{ length: 2440, price: 10.123 }] }, // 单价 3 位小数
    { materials: [{ length: 2440, price: 10 }, { length: 2440, price: 9 }] }, // 长度重复
  ];
  for (const extra of bad) {
    let ok = false;
    try {
      computeQuote(Object.assign(base, extra));
    } catch (e) {
      ok = e instanceof ValidationError;
    }
    assert(ok, `应拒绝非法新料输入 ${JSON.stringify(extra)}`);
  }
  // 两位小数应通过（含浮点安全：10.1）
  const r = computeQuote({
    kerf: 0,
    items: [{ length: 500, qty: 1 }],
    materials: [{ length: 2440, price: 10.1 }, { length: 1200, price: 9.99 }],
  });
  assert(r.totalPrice > 0, '两位小数单价应正常计算');
});

// Q10) 采购汇总：多规格小计与总价、余料消耗表正确
check('报价：采购汇总与余料消耗正确', () => {
  const r = computeQuote({
    kerf: 3,
    items: [{ length: 2300, qty: 1 }, { length: 1000, qty: 2 }],
    remnants: [{ length: 2400, qty: 1 }],
    materials: [{ length: 2440, price: 120 }, { length: 1200, price: 70 }],
  });
  // 2300 放 2400 余料（免费）；1000+3+1000=2003 只能放 2440 新料
  const sum = r.purchase.reduce((s, p) => s + p.subtotal, 0);
  assert(Math.abs(sum - r.totalPrice) < 1e-9, '各规格小计之和应等于总采购价');
  assert(r.totalPrice === 120, `总价应为 120，实际 ${r.totalPrice}`);
  const rem = r.remnants.find((x) => x.length === 2400);
  assert(rem.used === 1 && rem.remaining === 0, '2400 余料应用 1 根');
  const usedSum = r.bins.reduce((s, b) => s + b.usedLength, 0);
  assert(Math.abs(usedSum - r.totalUsedLength) < 1e-6, 'totalUsedLength 应等于各根之和');
});

// Q11) 报价模式返回每根新料的规格与价格
check('报价：每根新料带规格与价格', () => {
  const r = computeQuote({
    kerf: 0,
    items: [{ length: 2000, qty: 1 }, { length: 500, qty: 1 }],
    materials: [{ length: 2440, price: 120 }, { length: 600, price: 40 }],
  });
  // 2000 只能 2440（120）；500 走 600（40），总价 160
  const newBins = r.bins.filter((b) => b.source === 'new');
  assert(newBins.every((b) => typeof b.unitPrice === 'number' && typeof b.binPrice === 'number'), '新料应带单价与单根价');
  assert(r.bins.filter((b) => b.source === 'remnant').every((b) => b.unitPrice === undefined), '余料不应带价格');
  assert(r.totalPrice === 160, `应分别采购两种料共 160，实际 ${r.totalPrice}`);
});

// Q12) 报价模式性能：12 片 + 12 余料 + 3 料应在 10 秒内完成
check('报价：12 片 + 12 余料 + 3 料在 10 秒内完成', () => {
  const t0 = Date.now();
  const r = computeQuote({
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
    materials: [
      { length: 2440, price: 120 },
      { length: 1800, price: 95 },
      { length: 1200, price: 70 },
    ],
  });
  const ms = Date.now() - t0;
  assert(ms < 10000, `耗时 ${ms}ms 超过 10 秒`);
  assert(r.binCount >= 1, '应有结果');
  console.log(`  （耗时 ${ms}ms，总价 ${r.totalPrice}，新料 ${r.newBinCount} 根，余料 ${r.remnantBinCount} 根）`);
});

console.log(`\n${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
