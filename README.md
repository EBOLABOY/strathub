# strathub / crypto-strategy-hub

这是一个 **TypeScript monorepo**，目标是把“网格策略机器人”的 **对外契约 + 可靠性骨架** 先钉死（V1 冻结），再逐步接入真实交易所与更复杂的策略（V2）。

你现在拿到的不是“能直接实盘赚钱的机器人”，而是一个**可测试、可回滚、可扩展**的骨架：API、状态机、幂等、reconcile、模拟交易所、worker loop。

## 包结构

- `packages/api`：Express API（Auth / Bots / Accounts / Kill Switch）
- `packages/worker`：Worker loop（reconcile + 风控 + trigger/order + STOPPING 撤单闭环）
- `packages/database`：Prisma + SQLite（默认开发库配置在 `packages/database/.env`）
- `packages/shared`：纯函数与契约（幂等键、preview、风控等）
- `packages/exchange-simulator`：可控交易所模拟器（验收测试用）
- `packages/exchange`：ccxt executor（真实下单 seam，默认禁止 mainnet）
- `packages/market-data`：MarketData provider seam（mock/real）
- `packages/web`：Next.js 前端（通过 `/api/*` rewrite 到 API）

## 本地跑起来（不靠 Docker）

1) 安装依赖：`npm ci`  
2) 初始化 DB：`npm -w packages/database run db:push`  
3) 启动 API：`PORT=3001 npm -w packages/api run dev`  
4) 启动 Worker（默认模拟盘）：  
   - `WORKER_ENABLED=true WORKER_ENABLE_TRADING=true WORKER_USE_REAL_EXCHANGE=false EXCHANGE_PROVIDER=mock npm -w packages/worker run dev`
5) 启动 Web：`API_URL=http://localhost:3001 npm -w packages/web run dev`

## Docker 一键启动（推荐）

1) 复制配置：把 `.env.example` 复制为 `.env`，按需改变量  
2) 启动：`docker compose up --build`  
3) 入口：
   - Web：`http://localhost:3000`
   - API 健康检查：`http://localhost:3001/health`

## 关键安全开关（别装傻）

- 默认 **不会** 实盘：`WORKER_USE_REAL_EXCHANGE=false` 且 `EXCHANGE_PROVIDER=mock`
- Mainnet 需要双重显式 opt-in：
  - `ALLOW_MAINNET_TRADING=true`
  - Accounts 创建 mainnet（`isTestnet=false`）时必须设置 `CREDENTIALS_ENCRYPTION_KEY`

## 规格（V1 冻结）

- `docs/spec/v1-freeze.md`
- `docs/spec/idempotency.md`（幂等键唯一事实来源：`packages/shared/src/idempotency.ts`）
