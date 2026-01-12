# 重启 Reconcile 算法规格

> 冻结版本：V1  
> 来源：implementation_plan.md §2.8.3

## 1. 铁律

**交易所是事实来源**，本地快照只是加速器。

> [!NOTE]
> V1 只要求“最小可验证”的 reconcile：同步 openOrders/trades、幂等落库、写 snapshot/stateHash。
> 锁/余额同步/策略期望（cancel+create）属于 V2（配合真实交易所 Provider + Worker Loop）再做。

## 2. Reconcile 9 步算法

```
reconcile(botId: string): Promise<void>
```

### Step 1: 加锁（V2）
- 获取 bot 级别锁（DB 行锁 / 分布式锁）
- 写入新的 `runId`（UUID）
- 目的：避免并发 reconcile

### Step 2: 读取本地
- 加载 `GridStrategyConfigV1`
- 加载最近 `BotSnapshot`
- 读取 `Order/Trade` 游标（lastTradeId / lastSyncAt）

### Step 3: 拉取远端
- `fetchOpenOrders(symbol)` → Exchange open orders
- `fetchBalance()` → Account balances（V2）
- `fetchMyTrades(symbol, since=lastSyncAt)` → Recent trades（必要时分页）

### Step 4: 识别"我方订单"
- 过滤规则：`clientOrderId.startsWith('gb1')`
- 可选：botId 白名单进一步过滤
- 默认：不碰其他订单（避免误伤用户手动单）

### Step 5: 对齐订单
- 远端 openOrders → upsert 到本地
- 匹配键：`(exchange, clientOrderId)` 或 `(exchange, exchangeOrderId)`
- 冲突处理：以远端为准更新本地状态

### Step 6: 对齐成交
- 远端 trades → 按 `(exchange, tradeId)` 幂等落库
- 回写订单：更新 `filledAmount` / `avgFillPrice`
- 状态单调：只能前进（NEW→PARTIALLY_FILLED→FILLED），不能倒退

### Step 7: 计算派生状态（V2）
基于订单/成交/余额重建 `BotRuntimeStateV1`：
- `position`：当前持仓
- `openOrders`：活跃订单列表
- `gridIndex`：网格索引
- `maxProfit`：历史最大盈利
- `ewmaState`：EWMA 方差（从 snapshot 恢复）
- `triggerState`：触发监控状态

### Step 8: 对齐策略期望（V2）
- 计算"此刻应该有哪些挂单"
- 计算"应该撤哪些单"
- 执行顺序：**先 cancel 再 create**（降低资金占用冲突）
- 所有操作必须幂等

### Step 9: 落盘 & 解锁
- 写 `BotSnapshot`：reconciledAt, runId, stateJson, stateHash
- 更新 bot status（只有 reconcile 成功才允许进入 RUNNING）
- 释放锁
- 失败按重试策略处理，超过上限 → ERROR + 告警

## 3. 锁机制（V2）

### 3.1 DB 行锁（推荐 V1）

```sql
-- Prisma transaction with SELECT FOR UPDATE
BEGIN;
SELECT * FROM "Bot" WHERE id = $1 FOR UPDATE;
-- ... reconcile logic ...
COMMIT;
```

### 3.2 超时处理
- 锁超时：30 秒（可配置）
- 超时后：释放锁 + 告警 + 下次重试

## 4. 错误处理

| 错误类型 | 处理 |
|----------|------|
| 网络超时 | 重试（exponential backoff） |
| 限流 | 退避 + 读 Retry-After |
| 数据不一致 | FATAL_ERROR → ERROR + 告警 |
| 锁冲突 | 等待 + 重试 |

## 5. "我方订单"识别规则

```typescript
function isOurOrder(clientOrderId: string | undefined): boolean {
  if (!clientOrderId) return false;
  return clientOrderId.startsWith('gb1');
}
```

## 6. StateHash 计算

```typescript
import { createHash } from 'crypto';

function computeStateHash(state: BotRuntimeStateV1): string {
  const normalized = JSON.stringify(state, Object.keys(state).sort());
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
```

目的：检测状态是否发生变化，无新事件时 hash 应稳定。
