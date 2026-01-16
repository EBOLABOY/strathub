# V1 冻结规格

> **冻结时间**：2026-01-07
> **状态**：✅ 已冻结
> **测试覆盖**：100+ tests 全绿

---

## 0. 冻结口径（别自欺欺人）

- **V1 冻结的是“对外契约 + 可靠性骨架”**：API 行为、错误码、状态机、幂等与并发语义、Top11 验收场景。
- **V1 不是“可实盘跑起来的网格机器人”**：真实交易所能力已接入但默认禁止 mainnet；是否可靠只看 testnet soak 结果。

## 1. V1 范围（已完成）

### 1.1 核心功能

| 功能 | 验收场景 | 状态 |
|------|----------|------|
| 幂等下单 | ACC-EX-001 | ✅ V1 done |
| 限流退避 | ACC-EX-002 | ✅ V1 done |
| Reconcile | ACC-CORE-001 | ✅ V1 done |
| 多 symbol 隔离 | ACC-CORE-002 | ✅ V1 done |
| 部分成交 | ACC-CORE-003 | ✅ V1 done |
| PAUSE/RESUME | ACC-LIFE-001 | ✅ V1 done |
| STOP | ACC-LIFE-002 | ✅ V1 done |
| Preview | ACC-API-001 | ✅ V1 done |
| BoundsGate | ACC-GATE-001 | ✅ V1 done |
| Kill Switch | ACC-RISK-001 | ✅ V1 done |
| AutoClose | ACC-RISK-002 | ✅ V1 done |

### 1.2 状态机

| 状态 | 描述 |
|------|------|
| DRAFT | 草稿 |
| RUNNING | 运行中 |
| WAITING_TRIGGER | 等待触发 |
| PAUSED | 已暂停 |
| STOPPING | 停止中 |
| STOPPED | 已停止 |
| ERROR | 错误 |

### 1.3 错误码

| Code | HTTP | 描述 |
|------|------|------|
| UNAUTHORIZED | 401 | 未认证 |
| INVALID_TOKEN | 401 | Token 无效 |
| BOT_NOT_FOUND | 404 | Bot 不存在 |
| INVALID_STATE_TRANSITION | 409 | 状态转移无效 |
| CONCURRENT_MODIFICATION | 409 | 并发修改 |
| BOT_ALREADY_EXISTS | 409 | 同账户同币对 Bot 已存在 |
| CONFIG_VALIDATION_ERROR | 422 | 配置校验失败 |
| KILL_SWITCH_LOCKED | 423 | Kill Switch 已启用 |
| EXCHANGE_UNAVAILABLE | 503 | 交易所不可用 |

### 1.4 幂等规则

| 操作 | 幂等状态 | 行为 |
|------|----------|------|
| START | RUNNING, WAITING_TRIGGER | 返回 200，不 bump |
| PAUSE | PAUSED | 返回 200，不 bump |
| STOP | STOPPING, STOPPED | 返回 200，不 bump |
| RESUME | RUNNING, WAITING_TRIGGER | 返回 200，不 bump |

---

## 2. V1 Non-Goals（明确不做）

> [!IMPORTANT]
> 以下功能明确排除在 V1 **生产级承诺**范围外，不接受范围蔓延。
> 说明：仓库里可能存在某些条目的“最小实现”（V1.x），但不等于已完成 soak/验收。

| 功能 | 理由 | 目标版本 |
|------|------|----------|
| 多档挂单网格 | 复杂度高，先跑单档 | V2 |
| basePriceType=cost | 需要持仓成本计算 | V2 |
| basePriceType=avg_24h | 需要 OHLCV 聚合 | V2 |
| 权益回撤 AutoClose | 需要实时 PnL | V2 |
| TrendGate | 需要趋势指标 | V2 |
| 全局 Kill Switch | 先做 user-scoped | V2 |
| WebSocket 推送 | V1 仅做最小 SSE，WebSocket 不做 | V2 |
| 多交易所（放开白名单） | V1 仅支持 5 个交易所，其它一律拒绝 | V2 |
| Mainnet 实盘 | V1 默认禁止 mainnet；仅允许 testnet/模拟；mainnet 需显式 opt-in 且必须加密 | V2 |
| 可观测性面板 | V1 只承诺指标/告警埋点，面板/运行手册后置 | V2 |

---

## 3. V2 Backlog

| 优先级 | 功能 | 描述 |
|--------|------|------|
| P1 | 真实交易所 Provider | 接 ccxt/binance |
| P1 | Worker Loop | 定时 reconcile + risk-check |
| P2 | basePriceType=cost | 持仓成本作为基准价 |
| P2 | 权益回撤 AutoClose | 基于 PnL 触发 |
| P3 | 多档挂单网格 | 同时挂多个价位 |
| P3 | TrendGate | 趋势阻断 |

---

## 4. 规格文件清单

| 文件 | 内容 | V1 对齐 |
|------|------|---------|
| [api-contract.md](./api-contract.md) | API 端点、错误码 | ✅ |
| [state-machine.md](./state-machine.md) | 状态机转移表 | ✅ |
| [conditions.md](./conditions.md) | 条件系统（Trigger/Gate/Risk） | ✅ |
| [idempotency.md](./idempotency.md) | 幂等规则 | ✅ |
| [reconcile.md](./reconcile.md) | Reconcile 逻辑 | ✅ |
| [order-events.md](./order-events.md) | 订单事件处理 | ✅ |
| [top12-scenarios.md](../acceptance/top12-scenarios.md) | 验收场景 | ✅ |
