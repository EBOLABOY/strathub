# crypto-strategy-hub

> 注意：本项目仍在开发中（WIP），当前不可用于实际交易/生产环境。接口、数据结构与行为可能随时变更。

这是一个 **TypeScript monorepo**，目标是先把“网格策略机器人”的对外契约 + 可可靠演进的骨架钉死（V1 冻结），再逐步接入更复杂策略（V2）。
你现在拿到的不是“能直接实盘赚钱的机器人”，而是一套可测试、可回滚、可扩展的骨架：API、状态机、幂等、reconcile、模拟交易所、worker loop。

## 包结构

- `packages/api`：Express API（Auth / Bots / Accounts / Kill Switch）
- `packages/worker`：Worker loop（reconcile + 风控 + trigger/order + STOPPING 撤单闭环）
- `packages/database`：Prisma + SQLite（默认开发库配置在 `packages/database/.env`）
- `packages/shared`：纯函数与契约（幂等键、preview、风控等）
- `packages/exchange-simulator`：可控交易所模拟器（验收测试用）
- `packages/exchange`：ccxt trading executor（真实下单 seam，默认禁止 mainnet）
- `packages/market-data`：MarketData provider seam（mock/sim/real）
- `packages/web`：Next.js 前端（通过 `/api/*` rewrite 到 API）

## 本地跑起来（不靠 Docker）

1) 安装依赖：`npm ci`
2) 一键启动（会自动 `db:push`）：`npm run dev`
3) 入口：Web `http://localhost:3000`，API `http://localhost:3001/health`

说明：
- `npm run dev` 默认使用模拟/仿真交易所（`WORKER_USE_REAL_EXCHANGE=false`，`EXCHANGE_PROVIDER=sim` 或 `mock`）
- 覆盖本地参数：创建 `.env.local`（不会影响 Docker 用的 `.env`）

手工启动（可选）：
- API：`npm run dev:api`
- Worker：`npm run dev:worker`
- Web：`npm run dev:web`

## Docker 一键启动（推荐）

1) 把 `.env.example` 复制为 `.env`，按需改变量
2) 启动：`docker compose up --build`
3) 入口：
- Web：`http://localhost:3000`
- API 健康检查：`http://localhost:3001/health`

## 关键安全开关（别装傻）

- 默认不会实盘：`WORKER_USE_REAL_EXCHANGE=false` 且 `EXCHANGE_PROVIDER=sim|mock`
- Mainnet 需要双重显式 opt-in：
  - `ALLOW_MAINNET_TRADING=true`
  - 创建 mainnet 账户（`isTestnet=false`）时必须设置 `CREDENTIALS_ENCRYPTION_KEY`
- 生产环境必须设置 `JWT_SECRET`（否则 API 启动直接报错）

## 交易所支持（V1）

- 后端/前端仅支持 5 个交易所：Binance / OKX / Bybit / Coinbase / Kraken
- OKX 需要额外的 `passphrase`（创建/更新账户时填写）
- 其他交易所 ID 会直接返回 `EXCHANGE_NOT_SUPPORTED`

## 规格（V1 冻结）

- `docs/spec/v1-freeze.md`
- `docs/spec/idempotency.md`（幂等键唯一事实来源：`packages/shared/src/idempotency.ts`）
- `docs/spec/order-events.md`

## Testnet Soak（下一步）

- `docs/runbook/testnet-soak.md`

## 可观测性（Observability）

### Prometheus 指标

API 暴露 `/metrics` 端点，返回 Prometheus 格式指标：

```bash
curl http://localhost:3001/metrics
```

关键指标包括：
- `csh_orders_placed_total` - 下单总数
- `csh_orders_canceled_total` - 撤单总数
- `csh_exchange_requests_total` - 交易所 API 请求数
- `csh_reconcile_duration_seconds` - Reconcile 耗时
- `csh_risk_triggered_total` - 风控触发次数
- `csh_worker_tick_duration_seconds` - Worker 循环耗时

### 告警配置

支持多渠道告警推送，在 `.env` 中配置：

```bash
# Telegram（推荐）
TELEGRAM_BOT_TOKEN="your-bot-token"
TELEGRAM_CHAT_ID="your-chat-id"

# Webhook（通用 HTTP POST）
ALERT_WEBHOOK_URL="https://your-endpoint.com/alerts"

# PushPlus（微信推送）
PUSHPLUS_TOKEN="your-pushplus-token"

# 节流（同一告警 60 秒内只发一次）
ALERT_THROTTLE_MS="60000"

# 全局开关
ALERTS_ENABLED="true"
```

告警类型：
- 严重（Critical）：清仓失败、订单提交失败（达到重试上限）
- 警告（Warning）：自动止损触发、余额异常
- 信息（Info）：状态变更通知

