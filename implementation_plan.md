# GridBNB-USDT (TS Edition) Implementation Plan (New Repo)

> 这份文档的目的：把当前仓库“已经实现/已经被测试验证”的能力提炼成规格清单，并在一个全新的仓库里用 TypeScript 重新实现。  
> 这不是“复用当前代码”的方案；当前仓库只作为行为参考与验收基线。

## 0. Linus 的三个问题（先回答再动手）
1. 这是个真问题还是臆想？——要做的是“功能对标 + 可运行闭环”，不是写架构作文。
2. 有更简单的方法吗？——把状态机/幂等/数据模型定死，特殊情况自然消失。
3. 会破坏什么吗？——配置/策略一旦发布就不能随便改语义；必须版本化迁移。

## 0.1 最佳实践护栏（不可妥协）
- **V1 只做 Spot 闭环**：先把“网格条件单”跑通（CRUD + Preview + Start/Pause/Stop + Status/Logs），Futures/AI/动态资金分配全部后置（V2 再说）。
- **上线安全底线**：`clientOrderId` 幂等、状态快照 + 重启 reconcile、精度/最小下单量校验、限流+退避重试、Kill Switch（全局一键停机/清仓）、仓位风控（buy/sell gate）。
- **架构约束**：单进程 + 两条 loop（MarketData 批量拉取 / Strategy 状态机执行）；策略计算尽量纯函数，副作用只在 exchange/order 层。
- **版本化铁律**：`GridStrategyConfigV1` 一旦发布语义冻结；升级只能 migration，禁止“字段名不变语义变”。
- **测试即规格**：把旧仓库已经覆盖的单元/集成测试场景翻译成新仓库验收用例（不抄代码，抄行为），CI 必跑。
- **可观测性 Day1**：结构化日志 + Prometheus 指标 + 关键告警（止损触发/清仓失败/重试耗尽/疑似重复下单/余额异常）。
- **发布流程**：先 Paper/Testnet 跑一周，默认保守参数 + feature flags；能回滚配置、能一键停机，才允许接真实资金。

## 1. 当前仓库已实现功能（提炼为对标清单）

> 本节用纯语言描述旧仓库已验证的行为；旧仓库证据仅用于内部对照，新仓库不复用任何旧仓库代码或路径。

### 1.1 交易核心：GridTrader（网格主循环 + 状态持久化）
- 网格上下轨：给定基准价 `base_price=P` 与网格大小 `grid_size=G%`（百分比），上轨 `upper=P*(1+G/100)`、下轨 `lower=P*(1-G/100)`。
- 价格/数量精度与限制：下单前必须先按交易所 tick/step/precision 将 `price/amount` 规范化为稳定的 decimal string，并校验 `min/max amount` 与 `min/max notional(cost)`；Preview 阶段不满足直接 `ERROR` 并阻止 start，运行阶段不满足就跳过该笔并记录阻断原因（禁止默默放大用户资金暴露）。
- 状态持久化与恢复：关键运行状态（open orders、成交游标、网格索引、maxProfit、自适应状态等）可落盘；重启后先 reconcile（以交易所为准）再继续运行，保证不重复下单。
- 波动率驱动自适应：支持混合波动率/成交量加权/平滑窗口，并把波动率映射到网格大小与执行间隔（全部可开关、失败回退保守）。

### 1.2 止损/止盈（回撤止盈）与紧急清仓
- 价格止损：当价格跌破 `base_price * (1 - stopLossPercent)` 触发止损，进入停止流程（撤单→按配置市价平仓/跳过小额→强告警）。
- 回撤止盈：当累计盈利达到 `maxProfit` 后，回撤超过 `takeProfitDrawdown` 触发止盈退出，流程同上（撤单→退出）。
- 紧急清仓：支持“撤单 → 市价卖出基础资产 → 重试 → 小额跳过 →（可选）把多余资产转入理财/分账户”的保守流程。

### 1.3 风控：仓位限制（买卖开关）
- 风控状态枚举：`ALLOW_ALL / ALLOW_SELL_ONLY / ALLOW_BUY_ONLY`（本质是 buy/sell gate）。
- 仓位比例限制：支持全局 min/max 仓位比例，并允许按 symbol 覆盖；根据账户资产与当前持仓计算仓位占比。
- 与主循环集成：每次下单前必须先过 risk gate；risk gate 不允许的方向直接阻断并记录原因（用于指标与告警）。

### 1.4 多币种并发与全局资金分配
- 多交易对并发：多个 bot 共享同一个交易所客户端/行情源，并发执行且单 bot 故障不拖死全局（错误隔离）。
- 全局资金分配：支持 equal/weighted/dynamic 三种分配策略，限制总资金使用率，避免多标的“抢钱”导致下单失败或风控失真。

### 1.5 趋势识别（用于暂停买/卖）
- 趋势识别：综合 EMA/ADX/动量/量能等指标输出趋势方向与置信度；带缓存 TTL（避免频繁计算/请求）。
- 趋势映射到 gate：强上涨时可选择暂停卖出，强下跌时可选择暂停买入（开关控制）。

### 1.6 交易所层：连接、重试、测试网、理财
**ExchangeClient（CCXT async）**
- **交易所优先级（冻结）**：V1 先做 **Binance Spot（含 Testnet）**；OKX Spot 作为 V2（或 V1.x 另起验收，不混在 V1 里返工）。
- 具备代理、超时、限流参数、时间同步（签名依赖时间的交易所必须做 drift 处理）。
- 支持测试网/模拟盘模式，确保能在无真实资金环境做 soak。
- 核心 API 具备退避重试与故障恢复（行情、市场信息、下单/撤单），并有最大重试上限与错误分类。
- 支持账户总资产估值（spot + 其他账户/理财）并做去重与阈值过滤，避免把“零钱/重复余额”算进策略。
- 理财（可选开关）：支持申购/赎回/查询，用于“多余资金处理/资金归集”类动作（默认关闭）。

**ExchangeFactory（适配器工厂模式）**
- 交易所配置校验：例如 OKX 必须 passphrase；缺失则直接拒绝启动（别拖到运行时再炸）。
- 适配器工厂：注册/创建/单例管理；通过 capabilities + feature flags 控制不同交易所的可用功能。

### 1.7 “网格条件单（华宝风格）”相关模块（配置/触发/下单）
这部分在当前仓库里“模块已实现且有单测”，但与 `GridTrader` 的运行闭环是分离的；新仓库要把它们真正接到状态机里。

- 网格形态（冻结）：**单层触发式闭环**（触发后执行一次买/卖，循环往复），不是“同时挂 N 档买单 + N 档卖单”的传统多档网格；多档挂单网格属于 V2/另起规格。
- 网格条件单 UI：前端提供专业网格条件单配置页（约 39 字段），覆盖触发、下单、数量、仓位、自适应、风控、生命周期与时段。
- 配置模型：配置结构支持强校验、模板预设、跨字段依赖检查，以及稳定的序列化/反序列化（用于存储与回放）。
- 触发引擎：支持 percent/price 两种网格类型；支持基准价来源（当前价/成本价/24h 均价/手动）；支持回落卖出、拐点买入、价格区间 gating。
- 下单引擎：支持 amount_mode（percent/amount）、对称/不对称、盘口档位（bid/ask 1-5）与偏移、限价/市价，以及精度与最小名义价值约束。
- 高级风控：支持保底价（触发 stop 或仅告警）与自动清仓（多条件 OR）；触发后走“撤单→市价平仓→强告警”的一次性流程。
- 策略 CRUD：支持策略创建/更新/查询/删除与持久化；旧仓库的 start/stop 是占位，新仓库必须通过 bot 状态机实现 start/pause/resume/stop。

### 1.8 配置中心 / Web 面板 / 事件推送 / 监控告警
- 配置中心：配置项/历史/模板/API key 引用/用户等数据模型齐全，支持 CRUD、历史回滚、模板应用、批量更新与重载。
- Web 面板：覆盖登录、配置、模板、策略、交易记录、日志与运行状态展示（新仓库以用户路径闭环为准）。
- 事件推送：SSE 推送配置变更与运行状态，支持连接健康与重连；用于前端实时刷新。
- 监控：Prometheus 指标覆盖系统资源、订单、收益、风控、波动率、API 调用等关键面。
- 告警：支持多渠道（PushPlus/Telegram/Webhook），并具备分级/去重/节流（避免刷屏）。

### 1.9 密钥安全
- 凭证加密存储：用派生密钥（PBKDF2 等）+ 对称加密实现本地密钥加密存储，支持轮换。
- 权限校验：对交易所 API key 做权限检查与风险提示（禁提现、建议 IP 白名单等）。

### 1.10 自定义条件/自适应逻辑（你们自己加的“特殊情况”，现在要把它变成规格）
这部分是当前仓库已经跑起来的“自适应/条件”能力；新仓库要把它们变成**可配置、可观测、可测试**的模块，而不是散落在 `if/else` 里。

- **混合波动率（传统 + EWMA）**：用 7 天 4 小时 K 线（42 根）计算传统波动率，同时维护 EWMA（RiskMetrics λ，按配置）；按权重混合为最终波动率；数据不足或异常时回退到保守默认值（例如 0.2）。
- **成交量加权（可开关）**：可选把对数收益率按成交量因子加权后再计算波动率；成交量缺失/为 0 时自动退回未加权计算。
- **波动率平滑（移动平均）**：维护最近 N 次波动率值（例如 N=3）做移动平均，样本不足时不调整，避免“抖动式调参”。
- **连续网格自适应（线性函数）**：`newGrid = baseGrid + k*(vol-center)`，并 clamp 到 `[min,max]`；只有变化超过阈值才更新并落盘。
- **动态调整间隔（vol → interval）**：根据波动率落入的区间映射到执行间隔（小时/秒）；带最小间隔下限与失败回退默认值。
- **“翻转阈值”信号（偏离基准价）**：定义 `FLIP_THRESHOLD = (grid_size/5)/100`；当 `abs(price-base_price) >= base_price*FLIP_THRESHOLD(grid_size)` 触发方向翻转相关动作（例如预划转）。
- **预划转资金（副作用动作）**：根据预期方向估算所需资金 + 缓冲，按单次上限分批划转并等待到账；必须可失败、有重试上限、有告警。
- **生命周期/时段/边界 gate**：支持 expiry、交易日/交易时段、价格区间、仓位范围、保底价等 gating；不满足就不触发、不下单，并记录阻断原因用于观测。
- **趋势/仓位/全局资金**：本质都是 gate 条件，应该统一归入 Condition 系统（见 §2.7），避免散落 if/else。

## 2. 新仓库实现目标（对标规格）

### 2.1 版本范围（别一口吃成胖子）
**V1（MVP：华宝风格“单层触发式网格条件单”闭环）**
- **交易所**：Binance Spot（含 Testnet）。
- **核心闭环**：Config CRUD → Preview（无副作用）→ Start/Pause/Resume/Stop → Status/Logs/SSE。
- **Bot 运行底座**：状态机（见 §2.8.1）+ 幂等下单（见 §2.8.2）+ 快照与重启 reconcile（见 §2.8.3）。
- **策略能力**：TriggerEngine（percent/price + pullback/rebound + 区间 gating）+ OrderEngine（amount_mode/对称/不对称/盘口档位/offset/精度与限制）+ AdvancedRisk（floor price/auto close）。
- **风控硬件**：止损/止盈/紧急清仓、仓位 buy/sell gate、Kill Switch（全局一键停机）。
- **可观测性 Day1**：结构化日志字段与 Prometheus 指标（见 §2.6.1），关键告警可用。
- **多 bot 并发**：共享行情/账户客户端，单 bot 故障隔离，不拖死全局。

**V1 默认开关（冻结，别在实现里“想当然”）**
- **强制开启（不可关闭）**：幂等下单、reconcile、精度/最小下单量/最小名义价值校验、限流退避+最大重试上限、Kill Switch、buy/sell gate、关键告警。
- **可选开启（feature flag，默认关闭或保守参数）**：波动率自适应、动态执行间隔、成交量加权。
- **默认关闭（不进 V1 验收范围）**：趋势识别、全局资金 dynamic rebalance、预划转资金、理财（Earn/Savings）、AI 辅助、传统多档挂单网格（N 档）。

**V2（Pro）**
- OKX Spot（独立验收：签名/时间漂移/状态映射）。
- 传统多档位挂单网格（同时挂 N 档买单 + N 档卖单）。
- 全局资金分配 dynamic rebalance（避免多标的抢钱与资金低效）。
- 趋势识别接入（映射到 buy/sell gate）。
- 预划转资金与资金归集（高风险副作用动作，带幂等/重试/告警/审计）。
- AI 辅助（多数据源 + provider 可切换 + 指标/成本/置信度可观测）。

### 2.2 核心数据模型（必须版本化）
- `GridStrategyConfigV1`：用户配置（对齐 UI 语义，禁止“字段名不变语义变”）
- `BotRuntimeStateV1`：运行时状态快照（openOrders、position、gridIndex、maxProfit、stopLossTriggered…）
- `ConfigItem/ConfigHistory/ConfigTemplate`：配置中心（带版本与回滚）
- `User/ExchangeAccount`：账号与加密凭证

#### 2.2.1 `GridStrategyConfigV1`（华宝风格“网格条件单”配置规格）
这不是“随便存个 JSON”。这是你未来的 userspace。发布后语义冻结。

来源与对标（旧仓库，仅行为参考）：
- 前端配置表单（约 39 字段）
- 配置校验与模板（跨字段依赖）
- 触发引擎（percent/price、回落卖出/拐点买入、价格区间）
- 下单引擎（盘口档位/offset、对称/不对称、percent/amount、精度与限制）
- 高级风控（保底价/自动清仓）

**数值与精度约束（V1 就按这个来，别给自己挖坑）**
- 所有价格/数量/金额在 API 与 DB 里建议用 **decimal string** 表示（避免 JS float 漂移）。
- 任何进入 `clientOrderId`/`intentKey` 的数值必须先按交易所精度规范化（见 §2.8.2）。

**配置结构（建议按“分组对象”存，不要 50 个平铺字段）**
```ts
export type GridType = 'percent' | 'price';
export type TriggerBasePriceType = 'current' | 'cost' | 'avg_24h' | 'manual';
export type OrderType = 'limit' | 'market';
export type PriceMode = 'bid1'|'bid2'|'bid3'|'bid4'|'bid5'|'ask1'|'ask2'|'ask3'|'ask4'|'ask5'|'trigger';
export type AmountMode = 'percent' | 'amount';
export type FloorPriceAction = 'stop' | 'alert';

export interface AutoCloseConditionsV1 {
  // 达到目标盈利（quote currency 计价，例如 USDT）则触发清仓
  profitTargetQuote?: string;
  // 达到最大可接受亏损（quote currency 计价）则触发清仓
  lossLimitQuote?: string;
  // 从“基准价”（见下文）下跌达到百分比则触发清仓
  priceDropPercent?: string;
  // 策略运行时长达到小时数则触发清仓
  holdingHours?: number;
}

export interface GridStrategyConfigV1 {
  schemaVersion: 1;
  strategyName: string;
  symbol: string; // 'BNB/USDT'

  trigger: {
    gridType: GridType;
    basePriceType: TriggerBasePriceType;
    basePrice?: string; // basePriceType='manual' 时必填
    priceMin?: string;  // 可选，绝对价格
    priceMax?: string;  // 可选，绝对价格

    riseSell: string; // gridType='percent' -> 百分点；gridType='price' -> 绝对价差
    fallBuy: string;  // 同上

    enablePullbackSell: boolean;
    pullbackSellPercent: string; // 百分点（从最高点回落）
    enableReboundBuy: boolean;
    reboundBuyPercent: string;   // 百分点（从最低点反弹）
  };

  order: {
    orderType: OrderType;
    limit?: {
      buyPriceMode: PriceMode;
      sellPriceMode: PriceMode;
      buyPriceOffset?: string;  // 绝对价格偏移（quote 计价），由 OrderEngine 定义计算规则
      sellPriceOffset?: string; // 同上
    };
  };

  sizing: {
    amountMode: AmountMode;
    gridSymmetric: boolean;
    symmetric?: { orderQuantity: string };            // amountMode='percent' -> 百分点；'amount' -> 固定金额(quote)
    asymmetric?: { buyQuantity: string; sellQuantity: string }; // 同上
  };

  position: {
    maxPositionPercent: string; // 0-100
    minPositionPercent?: string; // 0-100，且 < max
  };

  adaptive: {
    enableVolatilityAdjustment: boolean;
    baseGridPercent: string;
    centerVolatility: string;
    sensitivityK: string;

    enableDynamicInterval: boolean;
    defaultIntervalHours: string;

    enableVolumeWeighting: boolean;
  };

  lifecycle: {
    expiryDays: number; // -1 永久
    enableMonitorPeriod: boolean;
    tradingHours?: Array<[number, number]>; // 0-23，start < end
    tradingDays?: number[]; // 1-7 (Mon..Sun)
    timezone: string; // 'Asia/Shanghai'
  };

  risk: {
    enableFloorPrice: boolean;
    floorPrice?: string;
    floorPriceAction: FloorPriceAction;

    enableAutoClose: boolean;
    autoCloseConditions?: AutoCloseConditionsV1;
  };

  // 预留字段：当前仓库只有字段没有实现，别在 V1 承诺它有效
  experimental?: {
    enableDeviationControl?: boolean;
    enablePriceOptimization?: boolean;
    enableDelayConfirm?: boolean;
  };
}
```

**跨字段校验（必须写成 schema，不要散在业务里）**
- `basePriceType='manual'` → `basePrice` 必填
- `priceMin/priceMax` 同时存在 → `priceMax > priceMin`
- `gridSymmetric=true` → `symmetric.orderQuantity` 必填；否则 `asymmetric.buyQuantity/sellQuantity` 必填
- `enableFloorPrice=true` → `floorPrice` 必填
- `minPositionPercent < maxPositionPercent`
- `enableMonitorPeriod=true` → 校验 `tradingHours/tradingDays/timezone`
- `enableAutoClose=true` → `autoCloseConditions` 至少有一个字段（否则 422，别在运行时才发现你没配条件）

**AutoCloseConditionsV1（V1 可校验 schema，语义冻结）**
- 触发逻辑：只要任意条件满足就触发（OR），触发后进入 `STOPPING`（见 §2.8.1 的 `RISK_TRIGGERED`）并执行清仓流程。
- “基准价”定义：`priceDropPercent` 以 bot 启动时确定的 `startBasePrice` 为准（通常等于 trigger base price；必须写进 `BotRuntimeStateV1`，重启后不能变）。
- 盈亏计算：以启动时记录的 `startEquityQuote` 为基线，`profit = currentEquityQuote - startEquityQuote`（别再用“配置创建时间/INITIAL_PRINCIPAL”那种拍脑袋口径）。
- 旧仓库映射：`profit_target/loss_limit/price_drop_percent/holding_hours` → `profitTargetQuote/lossLimitQuote/priceDropPercent/holdingHours`（只做溯源，不要把旧 JSON 直接当新 schema）。

#### 2.2.2 `BotRuntimeStateV1`（运行时状态快照：可恢复、可审计）
原则：能从订单/成交/余额重建的，不要重复存；必须存的只有“不可逆状态”（EWMA、触发监控高低点、maxProfit 等）。

建议最小结构（示意）：
```ts
export interface BotRuntimeStateV1 {
  schemaVersion: 1;
  runId: string;
  statusVersion: number;

  phase?: 'RECONCILING' | 'IDLE' | 'ACTIVE';
  startedAt?: string;
  startBasePrice?: string;
  startEquityQuote?: string;
  lastHeartbeatAt: string;
  lastReconciledAt?: string;

  // TriggerEngine 状态（回落/反弹监控需要记忆）
  triggerState?: {
    basePrice?: string;
    sellTriggerPrice?: string;
    buyTriggerPrice?: string;
    highestPrice?: string;
    lowestPrice?: string;
    isMonitoringSell?: boolean;
    isMonitoringBuy?: boolean;
  };

  // 自适应状态（必须可恢复，否则重启后“性格突变”）
  adaptiveState?: {
    lastVolatility?: string;
    ewmaVariance?: string;
    lastPrice?: string;
    volatilityHistory?: string[];
    lastGridAdjustAt?: string;
  };

  // 风控/收益（用于止盈回撤等逻辑）
  riskState?: {
    maxProfit?: string;
    stopLossTriggered?: boolean;
    lastRiskGate?: 'ALLOW_ALL' | 'ALLOW_SELL_ONLY' | 'ALLOW_BUY_ONLY';
  };
}
```

#### 2.2.3 数据库实体（Prisma）最小模型与约束（别等写到一半才发现没法幂等）
下面不是“建议”，是为了保证 §2.8 的幂等与 reconcile 能落地。

- `User`：`id`（uuid/ulid）, `email`（unique）, `passwordHash`, `role`, `createdAt`
- `ExchangeAccount`：`id`, `userId`(fk), `exchange`, `name`, `isTestnet`, `encryptedCredentials`, `createdAt`
- `Bot`（策略实例）：
  - `id`, `userId`(fk), `exchangeAccountId`(fk), `strategyType`（grid）
  - `status`, `statusVersion`（乐观锁）, `runId`（当前运行）, `lastError`
  - `configRevision`（递增）, `configJson`（`GridStrategyConfigV1`）, `createdAt/updatedAt`
- `BotSnapshot`（运行快照）：`id`, `botId`(fk), `runId`, `reconciledAt`, `stateJson`（`BotRuntimeStateV1`）, `stateHash`, `lastTradeCursor`
- `Order`（订单记录，幂等核心）：
  - `id`, `botId`(fk), `exchange`, `symbol`, `side`, `type`, `status`
  - `clientOrderId`（nullable? 建议必填）, `exchangeOrderId`（nullable）
  - `price`, `amount`, `filledAmount`, `avgFillPrice`, `createdAt/updatedAt`
  - **unique**：(`exchange`,`clientOrderId`), (`exchange`,`exchangeOrderId`)
- `Trade`（成交记录）：`id`, `botId`(fk), `exchange`, `symbol`, `tradeId`, `orderIdRef`, `clientOrderId`, `price`, `amount`, `fee`, `timestamp`
  - **unique**：(`exchange`,`tradeId`)
- `BotLog`：`id`, `botId`(fk), `runId`, `level`, `message`, `fieldsJson`, `timestamp`
- 配置中心：`ConfigItem`, `ConfigHistory`, `ConfigTemplate`（按你现有的功能对标做）

### 2.3 运行时架构（单进程、可恢复、可幂等）
- Scheduler 两条 loop：MarketData（批量 ticker/orderbook）+ Strategy（按状态机跑 bot）
- 幂等：每次下单必须有稳定的 `clientOrderId`（重试/重启不重复下单）
- 重启恢复：以交易所实际 open orders/余额/成交为准 reconcile 本地快照
- 故障策略：退避重试 + 最大重试上限 + 错误隔离（单 symbol 失败不拖死全局）

#### 2.3.1 Exchange 错误分类 + 重试/退避（不写清楚你会被交易所 API 教做人）
**错误分类（建议）**
- `Transient`：超时/网络抖动/5xx/临时网关错误/部分 429 → 允许重试
- `RateLimit`：明确的限流（429/RateLimit）→ 退避 + 读 `Retry-After`（若有）
- `Auth`：签名错误/权限不足/Key 失效 → 立即 ERROR（别重试）
- `BadRequest`：参数错误/精度错误/最小下单量不满足 → 不重试，回退到“调整精度/跳过/告警”
- `InsufficientFunds`：余额不足 → 不重试盲撞；进入 PAUSED 或 WAITING_TRIGGER（取决于策略），并告警

**退避策略（建议默认）**
- Exponential backoff + jitter（例如 base=250ms, factor=2, max=30s），总重试次数上限（例如 8 次）
- 每个 bot+endpoint 做独立计数器（避免一个 symbol 把全局拖死）
- 一旦达到上限：转入 `FATAL_ERROR → ERROR`（见 §2.8.1）并触发告警

**时间同步（别忽略）**
- 周期性对齐交易所 serverTime；请求签名依赖时间的交易所（OKX）必须在 drift 超阈值时暂停下单并重试同步

### 2.4 API 契约（以当前仓库为基线，但在新仓库统一实现）
- Auth：login/logout/me/verify
- Config：CRUD + batch update + reload + export/import
- Template：list/get/apply
- History：list/rollback
- SSE：events/status
- Trades：list/symbols/statistics
- Logs：list/files/stream
- Metrics：Prometheus /metrics
- GridStrategy：CRUD + preview + start/pause/stop（当前仓库 start/stop 仍是占位，新仓库要做真）

#### 2.4.1 V1 必须实现的 Bot/Strategy API（够用就行，别整花活）
建议统一用 `/api/bots`（strategyType 放在 payload 里），别搞一堆散路由。

**Bot（策略实例）**
- `POST /api/bots`：创建（默认 `DRAFT`）
- `GET /api/bots`：列表
- `GET /api/bots/:botId`：详情（含 configRevision、status）
- `PUT /api/bots/:botId/config`：更新配置（仅允许 `DRAFT/PAUSED/STOPPED/ERROR`）
- `POST /api/bots/:botId/preview`：预览（不产生副作用）
- `POST /api/bots/:botId/start`：启动（幂等）
- `POST /api/bots/:botId/pause`：暂停（幂等）
- `POST /api/bots/:botId/resume`：继续（幂等）
- `POST /api/bots/:botId/stop`：停止（幂等，进入 STOPPING→STOPPED）
- `GET /api/bots/:botId/runtime`：运行状态（`BotRuntimeStateV1`）
- `GET /api/bots/:botId/orders`：订单列表（分页）
- `GET /api/bots/:botId/trades`：成交列表（分页）

**SSE**
- `GET /api/sse?topics=botStatus,botLog,config`：服务端推送
  - 必须包含：`botId/runId/status/statusVersion`；日志必须带 `clientOrderId/intentSeq`（否则排障=瞎）

**错误与冲突（别用 200 装没事）**
- `409`：状态冲突（例如 RUNNING 时改配置）
- `422`：schema 校验失败（zod/jsonschema）
- `503`：交易所不可用/限流耗尽（并触发告警）

#### 2.4.2 Preview API（纯函数、无副作用；Preview 结果必须可复现）
Preview 的目的：**把用户填的参数“算一遍”并明确告诉他会发生什么**，而不是“点了启动才发现下不了单”。

**请求**
- `POST /api/bots/:botId/preview`
  - 默认用 bot 当前保存的 config
  - 可选支持 `configOverride`（用于前端“未保存配置”的即时预览）

建议 DTO（示意）：
```ts
export interface GridPreviewRequestV1 {
  configOverride?: GridStrategyConfigV1;
}

export type PreviewLineKind = 'reference' | 'trigger' | 'bound' | 'risk';
export interface PreviewLineV1 {
  kind: PreviewLineKind;
  label: string;
  price: string; // decimal string
}

export type ValidationSeverity = 'ERROR' | 'WARN';
export interface PreviewIssueV1 {
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface PreviewOrderV1 {
  side: 'buy' | 'sell';
  type: OrderType;
  price?: string;       // limit 才有
  quoteAmount: string;  // amount_mode='amount' 或 percent 计算后的 quote 金额
  baseAmount?: string;  // 可选：按 price 推导出来，便于展示
}

export interface GridPreviewResponseV1 {
  basePrice: string;
  buyTriggerPrice: string;
  sellTriggerPrice: string;
  lines: PreviewLineV1[];     // base/触发/区间/保底价等“线”
  orders: PreviewOrderV1[];   // 预期第一笔 buy/sell（不代表一定会下）
  issues: PreviewIssueV1[];   // ERROR 必须阻止 start；WARN 只提示
  estimates?: {
    // 估算值必须明确假设（例如：按 taker 费率、按触发价立即成交），否则就是误导用户
    assumedFeeRate?: string;
    spreadQuote?: string;
    spreadPercent?: string;
    estimatedFeeQuoteRoundTrip?: string;
    estimatedNetProfitQuoteRoundTrip?: string;
    notes?: string[];
  };
}
```

**Preview 必须覆盖的校验（至少）**
- schema 校验（§2.2.1 跨字段约束）
- 交易所精度/最小下单量/最小名义价值校验（不通过直接 `ERROR`）
- BoundsGate/LifecycleGate 结果：是否在交易时段、是否过期、是否在 price_min/max 范围
- Risk gate 结果：当前是否允许买/卖（如果 preview 依赖账户/仓位，拿不到就给 WARN + “以运行时为准”）

**Estimates（手续费/收益估算）口径（必须写出来，不然就是诈骗）**
- `spreadQuote = sellTriggerPrice - buyTriggerPrice`
- `spreadPercent = spreadQuote / basePrice`
- 默认用 taker 费率估算（更保守）；若拿不到费率则 `WARN` 并不返回 estimates。
- `estimatedFeeQuoteRoundTrip = (buyNotionalQuote + sellNotionalQuote) * feeRate`
- `estimatedNetProfitQuoteRoundTrip = baseAmount * spreadQuote - estimatedFeeQuoteRoundTrip`
- Notes 必须写清楚假设：按触发价立即成交、忽略滑点/撮合延迟/部分成交、忽略资金占用与撤单成本。

### 2.5 验收与测试策略（直接用现有测试当“需求”）
- 把旧仓库已覆盖的单元/集成测试场景转成新仓库的验收用例（不抄代码，抄行为）
- 纯函数单测：网格计算、触发引擎、订单价格/数量计算、风控阈值
- 集成测试：模拟交易所（ticker/balance/orderbook/order），覆盖重试、并发、多币种隔离、状态恢复

> 关键点：**新仓库里不会有旧仓库的路径**。文档里引用旧仓库文件只是为了溯源；新仓库的任务/测试必须用“场景名称 + 可验收标准”来写。

#### 2.5.1 ExchangeSimulator（测试交易所）合同：让测试可重复，不要靠“运气”
没有一个可控的交易所模拟器，你的集成测试就会变成“打 Testnet 看脸”。V1 先做最小合同，够覆盖 §2.8.5 的场景。

**最小接口（示意）**
```ts
export type DecimalString = string;

export interface CreateOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price?: DecimalString;
  amount: DecimalString;
  clientOrderId: string;
}

export interface ExchangeOrder {
  exchange: string;
  symbol: string;
  clientOrderId: string;
  exchangeOrderId: string;
  status: 'NEW'|'PARTIALLY_FILLED'|'FILLED'|'CANCELED'|'REJECTED'|'EXPIRED';
  price?: DecimalString;
  amount: DecimalString;
  filledAmount: DecimalString;
  avgFillPrice?: DecimalString;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeSimulator {
  // market
  setTicker(symbol: string, last: DecimalString): void;
  setOrderBook(symbol: string, bids: DecimalString[], asks: DecimalString[]): void; // 只要价格就够 preview/order engine 用
  setOHLCV(symbol: string, timeframe: string, closes: DecimalString[], volumes?: DecimalString[]): void;

  // account
  setBalance(asset: string, free: DecimalString): void;
  fetchBalance(): Promise<Record<string, { free: DecimalString }>>;

  // order/trade
  createOrder(req: CreateOrderRequest): Promise<ExchangeOrder>;
  cancelOrder(exchangeOrderId: string, symbol: string): Promise<void>;
  fetchOpenOrders(symbol: string): Promise<ExchangeOrder[]>;
  fetchOrderByClientOrderId?(symbol: string, clientOrderId: string): Promise<ExchangeOrder | null>;
  fetchMyTrades(symbol: string, since?: string): Promise<Array<{ tradeId: string; clientOrderId?: string; price: DecimalString; amount: DecimalString; fee: DecimalString; timestamp: string }>>;

  // fault injection
  injectError(endpoint: 'createOrder'|'cancelOrder'|'fetchOpenOrders'|'fetchBalance'|'fetchMyTrades'|'fetchOHLCV', mode: 'timeout'|'rateLimit'|'auth'|'badRequest', count: number): void;
}
```

**必须支持的幂等行为（否则你测不出线上会炸的东西）**
- 同一个 `clientOrderId` 重复 `createOrder`：
  - 要么返回同一个订单（推荐）
  - 要么抛“duplicate id”错误（然后你的实现按 §2.8.2 走 fetch-by-clientOrderId 流程）

**时间控制**
- 测试里不要用真实时间：提供 `FakeClock`（或把 `Date.now()` 注入），否则退避重试/holdingHours 全是随机。

### 2.6 安全与运维
- 密钥：服务端加密存储（AES-256 等），最小权限；可选做“权限校验向导”
- 监控：Prometheus 指标对标 + 告警渠道对标（PushPlus/Telegram/Webhook）
- 资源约束：1C/1G 基线（缓存/并发/日志 IO 必须可控）

#### 2.6.1 Day1 可观测性规格（指标命名 + 日志字段先定死）
**结构化日志（每条必带）**
- `botId`, `runId`, `symbol`, `status`, `event`
- 订单相关：`intentSeq`, `clientOrderId`, `exchangeOrderId`, `side`, `type`, `price`, `amount`
- 错误相关：`errorClass`, `errorCode`, `retryAttempt`

**Prometheus 指标（最小集合，先把钱保住）**
- `exchange_requests_total{exchange,endpoint,result}`
- `exchange_request_duration_seconds{exchange,endpoint}`
- `orders_placed_total{exchange,symbol,side,type}` / `orders_canceled_total{...}`
- `orders_duplicate_total{exchange}`（duplicate clientOrderId）
- `reconcile_duration_seconds{exchange,symbol}` / `reconcile_fail_total{exchange,symbol}`
- `bot_status{strategyType,status}`（值 0/1）
- `condition_block_total{type,reason}`（Trigger/Gate/Adaptive 的阻断原因）
- `volatility_hybrid{symbol}`（以及 gridSize current/target）

### 2.7 条件系统与自适应（新仓库必须这么做，否则你会被 if/else 反噬）
- **把条件变成数据结构**：Trigger / Gate / Adaptive 三类，统一用 `ConditionContext -> Decision`，别把业务写成“散落在 20 个函数里的 if”。
- **执行顺序固定**（消除边界条件）：Lifecycle/TradingWindow -> Market Trigger -> Risk Gates -> Adaptive Update -> Order Execution。
- **自适应必须可恢复**：EWMA 状态、最近波动率窗口、上次调整时间都要进 `BotRuntimeStateV1`；重启时先 reconcile 再继续更新，禁止“重启后策略性格突变”。
- **失败默认保守**：OHLCV/指标拿不到就禁用自适应或回退默认值（比如 volatility=0.2），但不能返回 0 把后续算式搞崩。
- **可观测性不是装饰**：至少打 `volatility_traditional/ewma/hybrid`、`grid_size_current/target`、`dynamic_interval_seconds`、`condition_block_total{type,reason}`，否则你上线就是瞎子。

### 2.8 开工前必须补齐的“硬规格”（不补你就会返工）
这份文档现在能让你开工（Infra/DB/UI 骨架），但要写到 Trading Core/Exchange 这类“会亏钱的代码”之前，下面几项必须冻结成**可验收**的规格。

#### 2.8.1 Bot 生命周期状态机（必须写成表，不然你会在边界条件里溺死）
约束：**V1 不新增状态**（保持 DRAFT/WAITING_TRIGGER/RUNNING/PAUSED/STOPPING/STOPPED/ERROR），但允许在 `BotRuntimeStateV1` 里记录 `phase`（比如 `RECONCILING`）用于 UI 展示。

| From | Event | To | Preconditions | Side Effects | Failure Fallback |
|---|---|---|---|---|---|
| DRAFT | START | WAITING_TRIGGER / RUNNING | config 校验通过；exchange account 可用 | `reconcile()`；写 runId；（有触发条件→WAITING_TRIGGER，否则 RUNNING） | reconcile 失败→ERROR |
| WAITING_TRIGGER | TRIGGER_HIT | RUNNING | trigger 条件满足；不在 trading window 外；风险 gate 允许 | 生成/更新 grid；place 初始订单 | 下单失败→留在 WAITING_TRIGGER 并告警（可重试） |
| WAITING_TRIGGER | PAUSE | PAUSED | - | 停止触发检查；不下新单 | - |
| WAITING_TRIGGER | STOP | STOPPING | - | cancel open orders；落盘；告警可选 | cancel 失败→继续 STOPPING 重试，超限→ERROR |
| RUNNING | PAUSE | PAUSED | - | 不再 place 新单；（V1 建议：保留挂单不动） | - |
| RUNNING | STOP | STOPPING | - | cancel open orders；（如启用 auto-close→市价平仓） | 同上 |
| PAUSED | RESUME | WAITING_TRIGGER / RUNNING | - | `reconcile()`；恢复 loop | reconcile 失败→ERROR |
| STOPPING | STOPPED | STOPPED | 已完成撤单/清算/落盘 | 写 stopAt；清 runId | - |
| * | RISK_TRIGGERED | STOPPING | 保底价 stop / 自动清仓触发 | cancel open orders；（按策略）市价平仓；强告警 | 失败→ERROR + 强告警 |
| * | KILL_SWITCH | STOPPING | - | 立刻停止下单；尽快撤单；必要时清仓 | 失败→ERROR + 强告警 |
| * | FATAL_ERROR | ERROR | 超过重试上限/数据不一致/幂等冲突 | 停止下单；告警；保留现场 | - |

补充规则（别偷懒）：
- **配置修改**：V1 强制在 `DRAFT/PAUSED/STOPPED/ERROR` 才允许修改；`RUNNING/WAITING_TRIGGER` 直接拒绝或要求先 PAUSE。
- **并发与幂等**：所有状态变更必须带 `statusVersion` 做乐观锁；同一 bot 同时只能有一个 transition 在飞。

#### 2.8.2 幂等下单：`intentKey` 与 `clientOrderId`（先定规则再写代码）
你需要两个东西：
- `intentKey`：内部“下单意图”的规范化键（用于 DB 唯一约束、去重、排查问题）。
- `clientOrderId`：对交易所的幂等键（用于重试/重启不重复下单、reconcile 识别“我方订单”）。

**规范化输入（必须使用字符串，禁止 float 直拼）**
- `botId`：UUID（或 ULID）字符串。
- `configRevision`：整数递增（每次保存配置 +1）。
- `intentSeq`：整数递增（同一个 bot 的每次“下单意图”都要有序号）。
- `symbol/side/type/timeInForce`：枚举字符串。
- `priceNormalized/amountNormalized`：按交易所 market 精度格式化后的**字符串**（例如用 decimal 库 + exchange adapter 的 precision 规则）。

**生成规则（V1 建议，够用且跨 OKX/Binance）**
- `intentKey = join('|', botId, configRevision, intentSeq, symbol, side, type, timeInForce, priceNormalized, amountNormalized)`
- `clientOrderId = 'gb1' + hex(sha256(intentKey)).slice(0, 29)`（固定 32 字符，全小写 `[0-9a-f]`，前缀 `gb1` 用于版本与识别）

**冲突与回退（写清楚，不然线上必出“重复下单”事故）**
- create order 返回“duplicate clientOrderId”：不重试盲下；必须 `fetchOrderByClientOrderId`（若交易所不支持则 `fetchOpenOrders` 过滤）→ 将其写入本地并继续。
- 本地检测到 `intentKey` 已存在：直接复用同一个 `clientOrderId`，严禁生成新的。
- 如果出现“同一 clientOrderId 对应不同 intentKey”（理论上几乎不可能）：直接 FATAL_ERROR → ERROR（这是数据腐坏）。

#### 2.8.3 重启 reconcile 算法（步骤写死，source of truth 写死）
铁律：**交易所是事实来源**，本地快照只是加速器。

`reconcile(botId)`（建议步骤，V1 先用 polling 即可）：
1. 加锁：获取 bot 级别锁（DB 行锁/分布式锁），写入 `runId`，避免并发 reconcile。
2. 读取本地：加载 `GridStrategyConfigV1` + 最近 `BotSnapshot` + `Order/Trade` 游标（lastTradeId/lastSyncAt）。
3. 拉取远端：`fetchOpenOrders(symbol)`、`fetchBalance()`、`fetchMyTrades(symbol, since=lastSyncAt)`（必要时分页）。
4. 识别“我方订单”：`clientOrderId` 前缀 `gb1`（+ 可选 botId 白名单）过滤；其他订单默认不碰（避免误伤用户手动单）。
5. 对齐订单：把远端 openOrders upsert 到本地（按 `clientOrderId`/`exchangeOrderId` 唯一）；把 trades 按 `tradeId` 幂等落库并回写订单 filled/avg。
6. 计算派生状态：基于订单/成交/余额重建 `BotRuntimeStateV1`（position、openOrders、gridIndex、maxProfit、ewmaState 等）。
7. 对齐策略期望：计算“此刻应该有哪些挂单/应该撤哪些单”，执行 create/cancel（都必须幂等）；执行顺序：先 cancel 再 create（降低资金占用冲突）。
8. 落盘：写 `BotSnapshot(reconciledAt, runId, stateHash)`；更新 bot `status`（只有 reconcile 成功才允许进入 RUNNING）。
9. 解锁：释放锁；失败按重试策略处理，超过上限 → ERROR + 告警。

#### 2.8.4 订单生命周期与事件模型（必须统一，不然你永远对不齐状态）
**统一状态（内部）**
- `NEW` / `PARTIALLY_FILLED` / `FILLED` / `CANCELED` / `REJECTED` / `EXPIRED`

**统一字段（最小集合）**
- `clientOrderId`（必填）、`exchangeOrderId`（可空，创建成功后回填）、`status`
- `price`/`amount`/`filledAmount`/`avgFillPrice`
- `createdAt`/`updatedAt`

**事件处理原则**
- 事件来源允许重复、乱序、延迟；你的处理必须幂等、单调（状态不能倒退）。
- `Trade` 以 `tradeId` 为唯一键落库；订单的 `filledAmount/avgFillPrice` 以 trades 汇总为准（不要相信单次回包）。

**交易所映射（示例，实际以 adapter 为准）**
- Binance：`NEW/PARTIALLY_FILLED/FILLED/CANCELED/REJECTED/EXPIRED` → 同名映射。
- OKX：`live`→NEW，`partially_filled`→PARTIALLY_FILLED，`filled`→FILLED，`canceled`/`mmp_canceled`→CANCELED。

#### 2.8.5 验收用例模板（新仓库只认“场景 + 标准”，别写口号）
每个验收场景写成一个条目（建议给 ID），最少包含：
- **Setup**：初始余额/市场精度/配置/feature flags。
- **Fault Injection**（可选）：超时、限流、网络错误、交易所返回重复订单等。
- **Steps**：start/pause/resume/stop/restart + 下单/撤单/成交模拟。
- **Assertions**：状态机最终状态、订单数量与 `clientOrderId` 去重、余额变化、是否触发告警。
- **Observability**：必须出现的日志字段（botId/runId/clientOrderId/intentSeq）与指标（`orders_placed_total`, `reconcile_duration_seconds` 等）。

建议你先写 12 个“必备场景”（写完再动手写 Trading Core）。下面给出**示例写法**（你可以直接搬到新仓库的 `docs/acceptance.md`）：

**ACC-EX-001 网络错误 + 幂等下单**
- Setup：固定一组 config（limit 单、固定金额/或 percent）；交易所模拟器支持按 `clientOrderId` 查询订单。
- Fault：`createOrder()` 前 N 次超时/连接失败，第 N+1 次成功。
- Steps：start bot → 触发一次下单意图 → 重试直到成功 → 重启进程 → reconcile。
- Assertions：只存在 1 个 `clientOrderId` 对应的订单；本地 `Order` unique 约束不报错；重启后不重复下单。
- Observability：日志必须包含 `intentSeq/clientOrderId/retryAttempt`；`orders_duplicate_total` 不增长。

**ACC-EX-002 限流（RateLimit）退避与失败上限**
- Fault：交易所返回 429/RateLimit +（可选）Retry-After。
- Assertions：退避间隔递增且有 jitter；超过上限进入 `ERROR` 并告警；不会无限循环。

**ACC-CORE-001 重启恢复（reconcile 不产生重复挂单）**
- Setup：模拟已有 openOrders + 部分成交 trades。
- Steps：启动 → reconcile → 进入 RUNNING → 再次重启 → reconcile。
- Assertions：本地状态与远端一致；不会创建重复挂单；`stateHash` 在无新事件时稳定。

**ACC-CORE-002 多 symbol 并发隔离**
- Setup：同时运行两个 bot（symbol A/B），共享 ExchangeClient。
- Fault：A 的订单接口持续失败；B 正常。
- Assertions：B 不受影响持续运行；A 进入 ERROR/退避；指标按 symbol 区分。

**ACC-CORE-003 部分成交（状态单调、filled 汇总正确）**
- Setup：同一个订单产生多条 trade 回报（乱序/重复）。
- Assertions：`Trade(exchange,tradeId)` 幂等；订单 `filledAmount/avgFillPrice` 由 trades 汇总且状态不倒退。

**ACC-ADAPT-001 OHLCV/指标缺失的保守回退**
- Fault：OHLCV 获取失败/返回空；趋势指标失败。
- Assertions：volatility 回退默认值（例如 0.2）；自适应模块不崩溃；不会返回 0 导致后续算式异常；只产生 WARN。

**ACC-LIFE-001 PAUSE/RESUME（无副作用恢复）**
- Steps：RUNNING → PAUSE → 等待一段时间 → RESUME。
- Assertions：PAUSE 期间不 place 新单；RESUME 先 reconcile 再恢复；状态机转移符合 §2.8.1。

**ACC-LIFE-002 STOP（撤单/清算完成后进入 STOPPED）**
- Fault：撤单部分失败，需要重试。
- Assertions：最终进入 STOPPED；失败超限进入 ERROR 并强告警；不会在 STOPPING 期间继续下新单。

**ACC-GATE-001 BoundsGate（价格区间/仓位范围）**
- Setup：配置 `priceMin/priceMax/minPosition/maxPosition`。
- Assertions：越界时不触发、不下单；在范围内恢复；阻断原因计入 `condition_block_total`。

**ACC-RISK-001 Kill Switch（全局停机）**
- Steps：触发全局 kill switch。
- Assertions：立即停止下单并开始撤单/清仓（按配置）；失败→ERROR+强告警。

**ACC-RISK-002 AutoClose（自动清仓触发 RISK_TRIGGERED）**
- Setup：配置 `AutoCloseConditionsV1`（profit/loss/drop/holding 任一）。
- Steps：满足条件 → 触发 `RISK_TRIGGERED` → STOPPING 执行撤单+市价平仓。
- Assertions：auto close 只触发一次；不会重复卖出；最终 STOPPED。

**ACC-API-001 Preview（无副作用，返回可解释结果）**
- Steps：调用 `POST /api/bots/:botId/preview`（含 `configOverride` 的情况）。
- Assertions：不产生订单/不写状态；返回 lines/orders/issues；当 minNotional/minAmount 不满足时返回 ERROR 并阻止 start。
