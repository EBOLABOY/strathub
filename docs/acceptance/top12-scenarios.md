# Top12 验收场景

> **冻结版本**：V1  
> **状态**：✅ V1 11/11 done（验收） + ⏳ V2 backlog（见下）  
> **测试覆盖**：100+ tests 全绿  
> **冻结时间**：2026-01-07

---

> [!NOTE]
> 本文档的 **Observability** 章节是“建议/预留”，**不属于 V1 验收项**（当前实现未承诺 metrics/告警）。

## V1 完成状态（11/11）

| 场景 | 状态 |
|------|------|
| ACC-EX-001 | ✅ V1 done |
| ACC-EX-002 | ✅ V1 done |
| ACC-CORE-001 | ✅ V1 done |
| ACC-CORE-002 | ✅ V1 done |
| ACC-CORE-003 | ✅ V1 done |
| ACC-LIFE-001 | ✅ V1 done |
| ACC-LIFE-002 | ✅ V1 done |
| ACC-API-001 | ✅ V1 done |
| ACC-GATE-001 | ✅ V1 done |
| ACC-RISK-001 | ✅ V1 done |
| ACC-RISK-002 | ✅ V1 done |

## V2 Backlog（不属于 V1 验收）

| 场景 | 状态 |
|------|------|
| ACC-ADAPT-001 | ⏳ V2 backlog |

---

## ACC-EX-001: 网络错误 + 幂等下单

### Setup
- 固定 config：limit 单、固定金额
- ExchangeSimulator 支持按 `clientOrderId` 查询订单
- FakeClock 用于控制时间

### Fault Injection
- `createOrder()` 前 3 次超时/连接失败
- 第 4 次成功

### Steps
1. start bot → 触发一次下单意图
2. 重试直到成功
3. 模拟进程重启
4. reconcile

### Assertions
- [ ] 只存在 1 个 `clientOrderId` 对应的订单
- [ ] 本地 `Order` unique 约束不报错
- [ ] 重启后不重复下单
- [ ] `orders_duplicate_total` 指标不增长

### Observability
- 日志必须包含：`intentSeq`, `clientOrderId`, `retryAttempt`
- 指标：`exchange_requests_total{result="error"}` 增长 3 次

---

## ACC-EX-002: 限流退避与失败上限

### Setup
- 固定 config
- maxRetries = 5

### Fault Injection
- `createOrder()` 持续返回 429/RateLimit
- 可选带 `Retry-After: 2` header

### Steps
1. start bot → 触发下单意图
2. 连续限流 5 次以上

### Assertions
- [ ] 退避间隔递增（指数退避 + jitter）
- [ ] 超过 maxRetries 后进入 `ERROR` 状态
- [ ] 触发告警
- [ ] 不会无限循环

### Observability
- 日志包含：`retryAttempt`, `backoffMs`
- 指标：`exchange_requests_total{result="rate_limit"}` 增长

---

## ACC-CORE-001: 重启恢复（reconcile 不产生重复挂单）

### Setup
- ExchangeSimulator 已有 2 个 openOrders（clientOrderId 以 gb1 开头）
- 1 个订单已部分成交（有 trades）

### Steps
1. 启动 bot → reconcile
2. 进入 RUNNING
3. 模拟重启 → 再次 reconcile

### Assertions
- [ ] 本地订单状态与 Simulator 一致
- [ ] 不产生重复挂单（订单数量不增加）
- [ ] `stateHash` 在无新事件时稳定

### Observability
- 日志包含：`reconciledOrderCount`, `runId`
- 指标：`reconcile_duration_seconds`

---

## ACC-CORE-002: 多 symbol 并发隔离

### Setup
- 两个 bot 同时运行：symbol A / symbol B
- 共享 ExchangeClient

### Fault Injection
- symbol A 的 `createOrder()` 持续失败
- symbol B 正常

### Steps
1. 同时启动两个 bot
2. 各自执行多个下单周期

### Assertions
- [ ] bot B 不受影响，持续正常运行
- [ ] bot A 进入 ERROR / 退避状态
- [ ] 指标按 symbol 区分

### Observability
- 日志：每条必须包含 `botId`, `symbol`
- 指标：`orders_placed_total{symbol}` 独立统计

---

## ACC-CORE-003: 部分成交（状态单调、filled 汇总正确）

### Setup
- 1 个 limit 订单，amount = 1.0

### Fault Injection
- 产生 3 条 trade 回报（乱序/重复）：
  - trade1: amount=0.3
  - trade2: amount=0.4 (重复发送 2 次)
  - trade3: amount=0.3

### Assertions
- [ ] `Trade(exchange, tradeId)` 幂等，不重复落库
- [ ] 订单 `filledAmount` = 1.0（0.3+0.4+0.3）
- [ ] 订单状态最终为 FILLED
- [ ] 状态不倒退（不会从 PARTIALLY_FILLED 回到 NEW）

### Observability
- 日志：每次 trade 处理记录 `tradeId`, `orderId`

---

## ACC-ADAPT-001（V2 backlog）: OHLCV/指标缺失的保守回退

### Setup
- 启用 `enableVolatilityAdjustment = true`

### Fault Injection
- `fetchOHLCV()` 失败 / 返回空数组
- 趋势指标计算失败

### Assertions
- [ ] volatility 回退默认值（0.2）
- [ ] 自适应模块不崩溃
- [ ] 不返回 0（导致后续算式异常）
- [ ] 只产生 WARN，不进入 ERROR

### Observability
- 日志：`volatilityFallback: true`, `defaultVolatility: 0.2`
- 指标：`volatility_hybrid{symbol}` = 0.2

---

## ACC-LIFE-001: PAUSE/RESUME

### Setup
- bot 在 RUNNING 状态
- 有 1 个 open order

### Steps
1. 调用 PAUSE
2. 等待 30 秒（模拟时间）
3. 调用 RESUME

### Assertions
- [ ] PAUSE 期间不 place 新单
- [ ] PAUSE 期间保留现有挂单（V1 行为）
- [ ] RESUME 先 reconcile 再恢复
- [ ] 状态机转移符合规格

### Observability
- 日志：`event: PAUSE`, `event: RESUME`, `reconcileAfterResume: true`

---

## ACC-LIFE-002: STOP（撤单/清算完成后进入 STOPPED）

### Setup
- bot 在 RUNNING 状态
- 有 2 个 open orders

### Fault Injection
- 第 1 个 `cancelOrder()` 失败 1 次，第 2 次成功
- 第 2 个 `cancelOrder()` 成功

### Assertions
- [ ] 最终进入 STOPPED 状态
- [ ] 如果失败超限，进入 ERROR 并强告警
- [ ] STOPPING 期间不继续下新单

### Observability
- 日志：`event: STOP`, `cancelOrderAttempt`, `status: STOPPED`
- 指标：`orders_canceled_total`

---

## ACC-GATE-001: BoundsGate（价格区间/仓位范围）

### Setup
- `priceMin = 500`, `priceMax = 600`
- `minPositionPercent = 10`, `maxPositionPercent = 80`
- 当前价格 = 620（越界）

### Steps
1. start bot
2. 触发检查

### Assertions
- [ ] 价格越界时不触发、不下单
- [ ] 价格回到 550 后恢复触发
- [ ] 阻断原因计入 `condition_block_total{type="BoundsGate"}`

### Observability
- 日志：`gateBlocked: true`, `reason: "price_out_of_bounds"`

---

## ACC-RISK-001: Kill Switch（用户级停机）

### Setup
- 同一用户下多个 bot：覆盖 `RUNNING` / `WAITING_TRIGGER` / `PAUSED` / `DRAFT` / `STOPPED`

### Steps
1. `POST /api/kill-switch/enable`
2. 对任意 bot 调用 `POST /api/bots/:botId/start` / `POST /api/bots/:botId/resume`
3. `POST /api/kill-switch/disable`
4. 再次尝试 `start/resume`

### Assertions
- [ ] enable 后：该用户下 `RUNNING/WAITING_TRIGGER` → `STOPPING`（每个 bot 只推进一次：`statusVersion` 只 +1）
- [ ] enable 后：`PAUSED/DRAFT/STOPPED` 完全不变
- [ ] enable 后：`start/resume` 返回 `423 KILL_SWITCH_LOCKED`，且 `statusVersion` 不涨
- [ ] 重复 `enable/disable` 幂等：不会重复 bump 版本、不会反复 stop
- [ ] disable 后：`start/resume` 恢复可用（行为回到 enable 前）

### Observability
- （可选）日志：`event: KILL_SWITCH`, `affectedBots: <number>`, `reason: <string>`
- （可选）告警：通道收到 CRITICAL 级别告警

---

## ACC-RISK-002: AutoClose（价格回撤触发 RISK_TRIGGERED）

### Setup
- 配置 `risk.enableAutoClose = true`
- 配置 `risk.autoCloseDrawdownPercent = "5"`（回撤 5% 触发）
- 参考价（referencePrice）冻结规则：
  - `basePriceType=manual`：使用 `trigger.basePrice`
  - `basePriceType=current`：使用 start/resume 时的 `ticker.last`

### Steps
1. start/resume，冻结 `referencePrice`
2. 模拟价格回撤：`lastPrice <= referencePrice * 0.95`
3. 触发 `RISK_TRIGGERED(reason=AUTO_CLOSE)`
4. 继续下探/重复触发检查（验证不会重复触发）

### Assertions
- [ ] 阈值未触发前：不改变 bot 状态、不写触发标记
- [ ] 首次触发：进入 `STOPPING`，并记录 `AUTO_CLOSE` 原因（如写入 lastError / runtime state）
- [ ] 只触发一次：重复检查不会再次 bump `statusVersion`，也不会重复创建清仓 intent
- [ ] 行情不可用时：不触发（或明确返回错误），不得静默“瞎触发”

### Observability
- （可选）日志：`event: RISK_TRIGGERED`, `reason: "AUTO_CLOSE"`, `referencePrice`, `lastPrice`, `drawdownPercent`
- （可选）告警：CRITICAL 级别

---

## ACC-API-001: Preview（无副作用，返回可解释结果）

### Setup
- 有效的 `GridStrategyConfigV1`
- ExchangeSimulator 设置：ticker/precision/minNotional

### Steps
1. `POST /api/bots/:botId/preview`
2. 带 `configOverride` 再次调用（未保存配置的即时预览）

### Assertions
- [ ] 不产生订单
- [ ] 不写状态
- [ ] 返回 `lines` / `orders` / `issues`
- [ ] minNotional 不满足时返回 `issues` 包含 ERROR
- [ ] ERROR 存在时，后续 start 被阻止

### Observability
- 预览响应包含：`basePrice`, `buyTriggerPrice`, `sellTriggerPrice`
- `estimates` 明确标注假设条件
