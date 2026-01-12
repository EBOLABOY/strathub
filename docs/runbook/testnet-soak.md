# Testnet Soak Runbook（7 天）

目的：用 **Binance Spot Testnet** 连续跑 7 天，验证 V1 的“可靠性骨架”在真实网络抖动/限流/超时下不崩。

这不是“赚钱测试”，这是“别把自己搞死”的测试。

## 0. 前提

- 只允许 Testnet：`ALLOW_MAINNET_TRADING=false`
- Worker 必须启用 STOPPING，否则你会卡死：`WORKER_ENABLE_STOPPING=true`
- Market data 必须 real，否则 worker 会拒绝 real trading：`EXCHANGE_PROVIDER=real`

## 1. 启动（Docker）

1) 复制 `.env.example` → `.env`  
2) 设置以下变量：

```text
WORKER_ENABLED=true
WORKER_ENABLE_TRADING=true
WORKER_ENABLE_STOPPING=true

WORKER_USE_REAL_EXCHANGE=true
EXCHANGE_PROVIDER=real

ALLOW_MAINNET_TRADING=false
```

3) 启动：`docker compose up --build`

## 2. 创建账户（Testnet）

通过 API 创建 Testnet account（`isTestnet=true`）。你可以用 Web UI 或直接调用 API。

注意：Testnet 允许不加密存储（会警告）；但如果你不想未来迁移痛苦，设置 `CREDENTIALS_ENCRYPTION_KEY`。

## 3. Soak 检查点（每天）

- Bot 状态收敛：不应该长期卡在 `STOPPING` / `ERROR` 且没人知道原因
- 幂等：同一个 intent 不应该产生多笔订单（看 DB `Order.clientOrderId` 唯一性）
- 退避：触发限流/超时后应该 **退避**，并在耗尽后 **进入 ERROR**（而不是无限重试）
- Kill Switch：启用后新单应被阻断

## 4. 失败准则（立刻停）

- 发现重复下单（同一意图产生多笔真实下单）
- STOPPING 撤单无法收敛（反复失败且未进入 ERROR）
- 任何疑似 mainnet 请求（`ALLOW_MAINNET_TRADING=false` 情况下不应发生）
