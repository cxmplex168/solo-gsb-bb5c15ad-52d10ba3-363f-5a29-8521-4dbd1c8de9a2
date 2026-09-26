'use strict';

const path = require('path');
const express = require('express');
const { computeCuttingPlan } = require('./cuttingPlan');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查（供 Docker healthcheck 使用）
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// 下料优化计算
app.post('/api/optimize', (req, res) => {
  try {
    const result = computeCuttingPlan(req.body || {});
    res.json({ ok: true, result });
  } catch (err) {
    if (err && err.isValidation) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('计算失败：', err);
    res.status(500).json({ ok: false, error: '服务器内部错误，请稍后重试' });
  }
});

app.listen(PORT, () => {
  console.log(`木工短料下料优化已启动：http://localhost:${PORT}`);
});
