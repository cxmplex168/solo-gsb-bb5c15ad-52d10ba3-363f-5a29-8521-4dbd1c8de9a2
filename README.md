# 木工短料下料优化

供木工工作室使用的短料下料网页，提供两种计算模式：

- **根数模式（默认）**：输入**原料长度**（可购买的新料，数量不限）、**锯缝宽度**、
  各规格裁片的**长度和数量**，并可选录入**余料库存**（多种余料长度及各自可用根数），
  系统先把同规格裁片展开成单片（总裁片数上限 12 片），再通过精确搜索求出**新料根数最少**、
  其次**投入原料总长度最小**的可行分配。
- **按价格选料模式**：裁片、锯缝与余料录入方式相同，另录入 **1～3 种可购买新料**的
  **长度与单价**（长度、单价须为正数，单价最多两位小数，同长度规格不得重复），
  系统求出**总采购价最低**的可行裁切方案；同价时依次选择**新料根数最少**、
  **投入原料总长度最小**的方案，并给出每种新料的采购汇总。

两种模式均逐根标明使用的是**余料**还是**新料**及其长度（报价模式另附单价），
汇总各规格余料的消耗与剩余数量，结果可在浏览器中直接打印。

## 计算规则

### 通用规则（两种模式相同）

- 同规格按数量展开成独立裁片参与计算（编号 A1、A2…，B1、B2…）；相同长度的多行视为同一规格。
- 余料为已有库存，**每根余料最多使用一次**，相同长度的多行余料会合并统计。
- **只有同一根原料上相邻的两片之间才计一条锯缝**（余料、新料规则相同）：
  一根原料放 k 片时，占用长度 = 各片长度之和 + (k − 1) × 锯缝宽度；单片独占一根时不计锯缝。
- 每根原料显示：余料/新料标识与长度、裁片顺序、片数、锯缝条数、已用长度、余长；
  另给出新料根数、余料根数、投入总长度、锯缝总数、总余长与综合利用率，以及各规格余料的消耗/剩余数量。
- 输入校验（错误时返回明确原因）：
  - 长度均为正数、数量为正整数，锯缝宽度必须不小于 0；
  - 至少填写一条规格且总片数 ≥ 1；
  - 总裁片数不得超过 12 片，余料总根数不得超过 12 根；
  - 单片长度超过所有可用原料长度时，提示“单片无法放入”并指出是哪一条规格。

### 根数模式（/api/optimize）

- 原料长度表示可购买的新料（数量不限）；优化目标（字典序，精确搜索 + 剪枝，保证全局最优）：
  1. **新料根数最少**——能用余料就不开新料；
  2. **投入原料总长度最小**——用到的余料长度与新料长度之和最小（未用到的余料不计入）。
- 未录入余料时，计算结果与原有“用料根数最少”的规则一致；
  现有余料无法容纳超过原料长度的裁片时，提示增加余料或调整规格。

### 按价格选料模式（/api/quote）

- 录入 1～3 种可购买新料的长度与单价（数量不限），优化目标（字典序，精确搜索，保证全局最优）：
  1. **总采购价最低**——各根新料长度 × 对应单价之和最小（余料不计价）；
  2. 同价时**新料根数最少**；
  3. 再相同时**投入原料总长度最小**。
- **长于所有新料的裁片可由足够长的余料承载**；余料也不足时给出明确原因
  （指出超长的裁片长度，并提示增加余料或调整规格）。
- 结果包含每根新料的规格与单价、按规格的**采购汇总**（长度、单价、购买根数、小计与合计）、
  余料消耗表和逐根裁切明细，均可打印。

长度单位保持一致即可（如全部用毫米）；单价单位自定（如元/根），全程按两位小数结算。

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

然后访问 http://localhost:3000 。

运行算法自测（可选，覆盖两种模式）：

```bash
npm test
```

## 打印方案

计算出方案后点击结果区右上角的 **“打印方案”** 按钮（或浏览器 Ctrl/⌘ + P），
打印样式会自动隐藏输入区与按钮，只输出方案标题、汇总信息、采购汇总（报价模式）、
余料消耗表和每根原料的裁片示意与顺序。

## 目录结构

```
.
├── Dockerfile              # 容器镜像定义（依赖在容器启动时安装）
├── docker-compose.yml      # Compose 编排（端口、卷、健康检查）
├── docker-entrypoint.sh    # 入口脚本：启动时安装依赖
├── package.json            # 依赖清单（Express）
├── server.js               # Express 服务：静态页面 + /api/optimize + /api/quote
├── cuttingPlan.js          # 输入校验与下料优化核心算法（根数模式 + 按价格选料模式）
├── test-cuttingPlan.js     # 核心算法自测（npm test）
└── public/                 # 前端原生页面
    ├── index.html
    ├── style.css
    └── app.js
```

## API 说明

### `POST /api/optimize`（根数模式）

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

### `POST /api/quote`（按价格选料模式）

请求体（`materials` 必填，1～3 种可购买新料；`remnants` 可选）：

```json
{
  "kerf": 3,
  "items": [
    { "length": 1200, "qty": 2 },
    { "length": 800, "qty": 2 }
  ],
  "materials": [
    { "length": 2440, "price": 99.5 },
    { "length": 1300, "price": 55 }
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
    "binCount": 4,
    "newBinCount": 1,
    "remnantBinCount": 3,
    "totalPrice": 55,
    "totalStockLength": 4800,
    "purchase": [
      { "length": 1300, "price": 55, "count": 1, "subtotal": 55 },
      { "length": 2440, "price": 99.5, "count": 0, "subtotal": 0 }
    ],
    "remnants": [
      { "length": 1300, "available": 2, "used": 2, "remaining": 0 },
      { "length": 900, "available": 1, "used": 1, "remaining": 0 }
    ],
    "bins": [
      { "index": 1, "source": "remnant", "stockLength": 1300, "pieces": [ { "label": "A1", "length": 1200 } ], "count": 1, "cuts": 0, "usedLength": 1200, "leftover": 100 },
      { "index": 4, "source": "new", "stockLength": 1300, "price": 55, "pieces": [ { "label": "B2", "length": 800 } ], "count": 1, "cuts": 0, "usedLength": 800, "leftover": 500 }
    ]
  }
}
```

- `totalPrice`：总采购价（各根新料长度对应单价之和，余料不计价）。
- `purchase[]`：采购汇总——每种新料的长度、单价、本次购买根数与小计（按长度从小到大）。
- `bins[].price`：该根新料的单价（仅 `source` 为 `"new"` 时返回）。
- 其余字段含义与 `/api/optimize` 一致。

两个接口在输入非法、单片无法放入任何原料或无可行方案时，
均返回 HTTP 400 与 `{ "ok": false, "error": "明确原因" }`。
