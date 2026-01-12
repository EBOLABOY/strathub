# 项目走读（Walkthrough）

> 这份文档是给“接手的人”看的：告诉你仓库里现在有什么、怎么跑、关键语义在哪里被测试锁死。

---

## 1. 这仓库现在做到哪了？

- **V1 冻结规格**：对外契约（API/错误码/状态机/幂等/并发语义）已在 `docs/spec/v1-freeze.md` 锁死，并由测试覆盖。
- **可运行的“模拟闭环”**：已用 `ExchangeSimulator` 跑通执行闭环（触发 → 落意图 → 提交下单 → 成交 → reconcile → 下一腿 → 重启不重复）。
- **真实交易所（实验性）**：已新增 `packages/exchange`（`BinanceExecutor`，基于 ccxt，支持 `fetchOpenOrders/fetchMyTrades/createOrder/cancelOrder`），默认不在 CI/默认 worker 中启用；仍不含余额/仓位闭环口径（见 `docs/spec/v1-freeze.md` 的 Non-Goals）。
  - Worker 执行 `trigger/order` 时会从 `MarketDataProvider.getMarketInfo()` 获取精度与最小下单约束（用于计算与格式化下单参数）。

---

## 2. Monorepo 结构（你该先看哪些包）

| 包 | 作用 | 你应该关心的点 |
|---|---|---|
| `packages/shared` | 类型 + 纯函数（Preview/条件解析等） | 口径源头，避免散落 if/else |
| `packages/database` | Prisma + SQLite | DB 约束/幂等/乐观锁 |
| `packages/api` | Express API | 对外契约、错误码映射、状态机入口 |
| `packages/market-data` | MarketDataProvider（mock/real） | `EXCHANGE_PROVIDER=real` 走 ccxt 公开数据 |
| `packages/exchange` | TradingExecutor（mock/real） | `BinanceExecutor`：下单/撤单/订单/成交 I/O（默认不启用） |
| `packages/exchange-simulator` | 交易所模拟器 | 幂等下单、错误注入、成交模拟、余额更新 |
| `packages/worker` | Worker Loop | tick 顺序固定；默认 simulator executor；`WORKER_ENABLE_TRADING/WORKER_ENABLE_STOPPING` 显式开关副作用；`WORKER_USE_REAL_EXCHANGE` 可切真实 executor |

---

## 3. 一键验证（你只需要记一个命令）

```bash
cd e:\crypto-strategy-hub
npm test
```

---

## 4. Worker 的 tick 顺序（别在这里制造“特殊情况”）

当前顺序固定为：

1) `reconcile`（把外部状态拉回本地：orders/trades → snapshot）
2) `risk-check`（AutoClose 等风控先行）
3) `trigger/order`（触发 → outbox intent → submit）
4) `stopping`（STOPPING bots：撤单 → STOPPED）

原则：**先把状态拉齐，再做副作用**。别把 I/O 塞进事务里。
> 说明：`trigger/order`（下单）与 `stopping`（撤单）默认不启用，必须显式设置：`WORKER_ENABLE_TRADING=true` / `WORKER_ENABLE_STOPPING=true`。

---

## 5. Trigger/Order Loop 的关键语义（最容易写烂的点）

- **Intent Outbox**：先落库意图，再执行 I/O；失败重试必须复用同一 `clientOrderId`。
- **“已提交”判定**：以 `exchangeOrderId` 作为已提交标记（避免 reconcile 导入的订单被误当作 outbox 待提交）。
- **状态约束**：`STOPPING/PAUSED/STOPPED/ERROR` 不允许提交 outbox（否则就是在“停机中继续交易”）。
- **反向腿定价**：下一腿基准价用上一次成交均价 `avgFillPrice`（不是当前 ticker 的瞬时值）。

---

## 6. MarketDataProvider（公开行情）怎么切换

默认走 mock（CI 不打公网）：

```bash
EXCHANGE_PROVIDER=mock
```

手动验证走真实 Binance 行情（ccxt 公开数据）：

```bash
EXCHANGE_PROVIDER=real
npm run dev --workspace @crypto-strategy-hub/api
```

> 注意：当前 `getBalance()` 仍返回 `undefined`（V1 口径），不要在这里偷塞实盘逻辑。

---

## 6.1 TradingExecutor（下单/撤单）Testnet 手动验证

`BinanceExecutor` 默认走 Testnet；Mainnet 必须显式 `ALLOW_MAINNET_TRADING=true` 才允许启用。

```bash
cd e:\crypto-strategy-hub
# 需要先设置环境变量：BINANCE_API_KEY / BINANCE_SECRET
npx tsx packages/exchange/scripts/manual-test.ts
```

> 说明：这是手动验证脚本，不进 CI。

---

## 6.2 Worker（模拟/实盘）开关与启动方式

默认（安全）：只跑 `reconcile` + `risk-check`，不下单、不撤单：

```bash
WORKER_ENABLED=true npm run dev --workspace @crypto-strategy-hub/worker
```

启用模拟交易副作用（仍默认 simulator executor）：

```bash
WORKER_ENABLED=true WORKER_ENABLE_TRADING=true WORKER_ENABLE_STOPPING=true npm run dev --workspace @crypto-strategy-hub/worker
```

启用真实交易所 executor（危险，默认仍走 Testnet；Mainnet 必须显式 `ALLOW_MAINNET_TRADING=true`）：

```bash
WORKER_ENABLED=true WORKER_USE_REAL_EXCHANGE=true EXCHANGE_PROVIDER=real WORKER_ENABLE_TRADING=true WORKER_ENABLE_STOPPING=true npm run dev --workspace @crypto-strategy-hub/worker
```

> 注意：`ExchangeAccount.encryptedCredentials` 目前是明文 JSON 占位（V1），实盘前必须替换为真正的密钥加密/解密链路。

---

## 7. ExchangeSimulator 的一个关键点（别被它骗了）

`simulateFill()` 现在会按 side 更新余额：

- buy：`+base / -quote`
- sell：`-base / +quote`

这保证“BUY 成交后，下一腿 SELL 不会因为 base 余额为 0 而假失败”。

---

## 8. 下一步建议（按风险从高到低）

1. **执行阶段阻断规则**：当 `trigger/order` 计算出 `BELOW_MIN_AMOUNT/BELOW_MIN_NOTIONAL` 等阻断性错误时，必须停止提交并把 bot 标记为 `ERROR`（否则会出现“交易所拒单 → outbox 无限重试”的坏循环，尤其是价格上涨导致 baseAmount 过小）。
2. **补 ExchangeAccount 密钥链路**：`encryptedCredentials` 目前是明文 JSON 占位，实盘前必须做加密/解密与权限校验。
3. **补实盘前的边界验收**：撤单后再触发、部分成交推进、并发 tick/重启 mid-submit 等，把“脏现实”锁死在测试里。
