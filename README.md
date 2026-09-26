# 木工短料下料优化

供木工工作室使用的短料下料网页。输入**锯缝宽度**、各规格裁片的**长度和数量**，并可选录入
**余料库存**（多种余料长度及各自可用根数），系统先把同规格裁片展开成单片（总裁片数上限 12 片），
再通过精确搜索求出最优可行分配，逐根标明使用的是**余料**还是**新料**及其长度，
并汇总各规格余料的消耗与剩余数量，结果可在浏览器中直接打印。

提供两种选料模式（页面顶部切换）：

- **按根数选料**（`/api/optimize`）：输入一种**原料长度**（可购买的新料，数量不限），
  先求**新料根数最少**、其次**投入原料总长度最小**的方案。
- **按价格选料（报价）**（`/api/quote`）：录入 **1～3 种可购买新料**的长度与**单价**
  （数量不限），求**总采购价最低**的方案；同价时依次取**新料根数最少**、
  **投入原料总长度最小**。结果包含每根新料的规格与价格、采购汇总与裁切明细。

## 计算规则

### 共同规则

- 同规格按数量展开成独立裁片参与计算（编号 A1、A2…，B1、B2…）；相同长度的多行视为同一规格。
- 余料为已有库存，**每根余料最多使用一次**，相同长度的多行余料会合并统计；余料总根数上限 12 根。
- **只有同一根原料上相邻的两片之间才计一条锯缝**（余料、新料规则相同）：
  一根原料放 k 片时，占用长度 = 各片长度之和 + (k − 1) × 锯缝宽度；单片独占一根时不计锯缝。
- 每根原料显示：余料/新料标识与长度、裁片顺序、片数、锯缝条数、已用长度、余长；
  另给出新料根数、余料根数、投入总长度、锯缝总数、总余长与综合利用率，以及各规格余料的消耗/剩余数量。

### 按根数选料（`/api/optimize`）

- 优化目标（字典序，精确搜索 + 剪枝，保证全局最优）：
  1. **新料根数最少**——能用余料就不开新料；
  2. **投入原料总长度最小**——用到的余料长度与新料长度之和最小（未用到的余料不计入）。
- 未录入余料时，即原有“用料根数最少”的规则；行为与旧版完全一致。

### 按价格选料（`/api/quote`）

- 录入 1～3 种可购买新料：`长度` 与 `单价` 都必须是**正数**，**单价最多两位小数**，
  **同长度规格不得重复**；新料数量不限。
- 余料视为已有库存、**不计采购价**（优先使用）。
- 优化目标（字典序，精确搜索 + 剪枝，保证全局最优）：
  1. **总采购价最低**；
  2. 总价相同时**新料根数最少**；
  3. 前两者都相同时**投入原料总长度最小**。
- **长于所有新料的裁片只能由足够长的余料承载**；若现有余料根数/长度不足，
  返回明确原因，指出是哪些裁片超长。
- 结果额外给出：
  - **采购汇总**：每种实际购买的新料规格（长度、单价、根数、小计）与**总采购价**；
    全部裁片由余料承载时总采购价为 0；
  - **每根新料的规格（长度）与单价、单根价格**。

### 输入校验（错误时返回 HTTP 400 与明确原因）

- 长度均为正数、数量为正整数，锯缝宽度必须不小于 0；
- 至少填写一条规格且总片数 ≥ 1，总裁片数不得超过 12 片，余料总根数不得超过 12 根；
- 报价模式新料必须为 1～3 种、单价最多两位小数、长度规格不重复；
- 单片长度超过所有原料（新料 + 余料）长度时，提示“单片无法放入”并指出是哪一条规格；
- 按根数模式现有余料无法容纳超过原料长度的裁片时，提示增加余料或调整规格。

长度单位保持一致即可（如全部用毫米）；报价模式单价单位也保持一致即可（如元/根）。

## 技术栈

Node.js + Express（后端计算 API 与静态页面托管）+ 原生 JavaScript / HTML / CSS（前端，无构建步骤）。

## 单条启动命令（Docker Compose）

```bash
docker compose up --build
```

依赖会在**容器启动时自动安装**（首次启动执行 `npm install --omit=dev`，
`node_modules` 由 Docker 命名卷持久化，后续启动自动跳过安装）。

启动后在浏览器访问：

```
http://localhost:3000
```

打开页面后，在顶部选择 **“按根数选料”** 或 **“按价格选料（报价）”**，填写参数后点击
“计算下料方案 / 计算报价方案”，即可在页面查看结果并点击“打印方案”。

## 必要配置

| 配置项 | 方式 | 默认值 | 说明 |
| --- | --- | --- | --- |
| 网页访问端口 | Compose 端口映射 `${PORT:-3000}:3000` | `3000` | 宿主机端口可用环境变量 `PORT` 修改 |
| 容器监听端口 | 容器内环境变量 `PORT` | `3000` | 通常无需修改 |

如需改用 8080 端口访问：

```bash
PORT=8080 docker compose up --build
```

然后访问 http://localhost:8080 。

后台运行与停止：

```bash
docker compose up --build -d   # 后台启动
docker compose down            # 停止并删除容器
docker compose logs -f         # 查看日志
```

## 不用 Docker 的本地运行方式

需要 Node.js 18 及以上。

```bash
npm install
npm start
```

启动后访问 <http://localhost:3000> 。

运行算法自测（可选）：

```bash
npm test
```

## 打印方案

计算出方案后点击结果区右上角的 **“打印方案”** 按钮（或浏览器 Ctrl/⌘ + P），
打印样式会自动隐藏输入区与按钮，只输出方案标题、汇总信息、采购汇总（报价模式）、
余料消耗表和每根原料的裁片示意与顺序。报价模式打印标题为“木工短料报价裁切方案”。

## 目录结构

```
.
├── Dockerfile              # 容器镜像定义（依赖在容器启动时安装）
├── docker-compose.yml      # Compose 编排（端口、卷、健康检查）
├── docker-entrypoint.sh    # 入口脚本：启动时安装依赖
├── package.json            # 依赖清单（Express）
├── server.js               # Express 服务：静态页面 + /api/optimize + /api/quote
├── cuttingPlan.js          # 输入校验与核心算法（按根数选料 + 按价格报价）
├── test-cuttingPlan.js     # 核心算法自测（npm test）
└── public/                 # 前端原生页面
    ├── index.html
    ├── style.css
    └── app.js
```

## API 说明

服务提供两个 POST 接口，均接收 JSON、返回 `{ "ok": true, "result": ... }`；
输入非法或无可行方案时返回 HTTP 400 与 `{ "ok": false, "error": "明确原因" }`。

### `POST /api/optimize` —— 按根数选料

请求体（`remnants` 为可选的余料库存，不录入时结果与原有规则一致）：

```json
{
  "stockLength": 2440,
  "kerf": 3,
  "items": [
    { "length": 1200, "qty": 2 },
    { "length": 800, "qty": 2 }
  ],
  "remnants": [
    { "length": 1300, "qty": 2 },
    { "length": 900, "qty": 1 }
  ]
}
```

响应（节选）：

```json
{
  "ok": true,
  "result": {
    "binCount": 3,
    "newBinCount": 1,
    "remnantBinCount": 2,
    "totalStockLength": 4640,
    "remnants": [
      { "length": 1300, "available": 2, "used": 1, "remaining": 1 },
      { "length": 900, "available": 1, "used": 1, "remaining": 0 }
    ],
    "bins": [
      { "index": 1, "source": "remnant", "stockLength": 1300, "pieces": [ { "label": "A1", "length": 1200 } ], "count": 1, "cuts": 0, "usedLength": 1200, "leftover": 100 },
      { "index": 3, "source": "new", "stockLength": 2440, "pieces": [ { "label": "A2", "length": 1200 }, { "label": "B1", "length": 800 } ], "count": 2, "cuts": 1, "usedLength": 2003, "leftover": 437 }
    ]
  }
}
```

- `bins[].source`：`"remnant"` 表示该根为余料，`"new"` 表示新料；`stockLength` 为该根实际长度。
- `remnants[]`：各规格余料的可用根数、本次消耗与剩余数量；未录入余料时为空数组。
- `totalStockLength`：投入原料总长度（用到的余料 + 新料长度之和），`utilization` 以其为分母。

### `POST /api/quote` —— 按价格选料（报价）

沿用 `kerf`、`items`、`remnants`，以 `materials`（1～3 种可购买新料）取代 `stockLength`。
每种新料含长度 `length` 与单价 `price`（正数、单价最多两位小数、长度不重复）：

```json
{
  "kerf": 3,
  "items": [
    { "length": 2300, "qty": 1 },
    { "length": 1000, "qty": 2 }
  ],
  "remnants": [
    { "length": 2400, "qty": 1 }
  ],
  "materials": [
    { "length": 2440, "price": 120 },
    { "length": 1200, "price": 70 }
  ]
}
```

响应（节选）：

```json
{
  "ok": true,
  "result": {
    "mode": "quote",
    "totalPrice": 120,
    "newBinCount": 1,
    "remnantBinCount": 1,
    "totalStockLength": 4840,
    "purchase": [
      { "length": 2440, "unitPrice": 120, "qty": 1, "subtotal": 120 }
    ],
    "materials": [
      { "length": 2440, "unitPrice": 120 },
      { "length": 1200, "unitPrice": 70 }
    ],
    "remnants": [
      { "length": 2400, "available": 1, "used": 1, "remaining": 0 }
    ],
    "bins": [
      { "index": 1, "source": "remnant", "stockLength": 2400, "pieces": [ { "label": "A1", "length": 2300 } ], "count": 1, "cuts": 0, "usedLength": 2300, "leftover": 100 },
      { "index": 2, "source": "new", "stockLength": 2440, "unitPrice": 120, "binPrice": 120, "pieces": [ { "label": "B1", "length": 1000 }, { "label": "B2", "length": 1000 } ], "count": 2, "cuts": 1, "usedLength": 2003, "leftover": 437 }
    ]
  }
}
```

- `totalPrice`：最低总采购价；全部裁片由余料承载时为 `0` 且 `purchase` 为空数组。
- `purchase[]`：**采购汇总**，仅列出实际购买的规格，含长度、单价、根数与小计，
  各小计之和等于 `totalPrice`。
- `bins[]` 中 `source === "new"` 的每根额外带 `unitPrice`（单价）与 `binPrice`（该根价格）；
  余料不带价格字段。
- 长于所有新料的裁片只能由余料承载；若余料不足，返回的 `error` 会指出具体超长裁片，例如：

```text
无可行方案：裁片 A1(3000)、A2(3000) 长于所有可购买新料，现有余料（最多 3100）根数或长度不足以全部承载，请增加足够长的余料或新料规格
```

### 健康检查

`GET /api/health` 返回 `{ "ok": true }`，供 Docker 健康检查使用。
