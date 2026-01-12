# 幂等下单规格

> 冻结版本：V1.1 (2026-01-12)  
> 唯一事实来源：`@crypto-strategy-hub/shared/idempotency.ts`

## 1. 核心概念

| 概念 | 用途 | 范围 |
|------|------|------|
| `clientOrderId` | 对交易所的幂等键 | 重试/重启不重复下单、reconcile 识别 |
| `ORDER_PREFIX` | 识别"我方订单"的前缀 | 固定值 `gb1` |

## 2. 生成规则（唯一实现）

**规则**：`${ORDER_PREFIX}-${botId.slice(0,8)}-${intentSeq}`

**示例**：`gb1-a1b2c3d4-1`

**约束**：
- `botId` 长度必须 ≥ 8 字符
- `intentSeq` 必须是正整数（从 1 开始递增）

**代码调用**：
```typescript
import { generateClientOrderId } from '@crypto-strategy-hub/shared';

const clientOrderId = generateClientOrderId(botId, intentSeq);
```

⚠️ **禁止**：任何业务代码/测试中**手写拼接** `gb1-${...}` 格式均视为 bug。

## 3. 识别规则

识别"我方订单"使用前缀匹配：

```typescript
import { ORDER_PREFIX, isOurOrder } from '@crypto-strategy-hub/shared';

// 方式 1：使用工具函数
if (isOurOrder(clientOrderId)) { ... }

// 方式 2：直接前缀匹配
if (clientOrderId.startsWith(ORDER_PREFIX)) { ... }
```

## 4. 冲突与回退策略

### 4.1 交易所返回 duplicate clientOrderId

```
1. 不重试盲下（禁止换 clientOrderId 再发）
2. 调用 fetchOrderByClientOrderId（若交易所支持）
   - 否则 fetchOpenOrders + 过滤
3. 将已存在的订单写入本地并继续
```

### 4.2 本地检测到相同 intentSeq 已存在

```
1. 直接复用同一个 clientOrderId
2. 严禁生成新的 clientOrderId
3. 检查本地订单状态，按需同步
```

## 5. DB 约束

```sql
-- Order 表
CREATE UNIQUE INDEX idx_order_client_id ON "Order" (exchange, clientOrderId);
CREATE UNIQUE INDEX idx_order_exchange_id ON "Order" (exchange, exchangeOrderId);

-- Trade 表
CREATE UNIQUE INDEX idx_trade_id ON "Trade" (exchange, tradeId);
```

## 6. 已弃用方案

> ⚠️ 以下为历史设计，**已弃用**，仅供参考。

### 6.1 SHA256 Hash 方案（V1 草案，未落地）

曾计划使用 SHA256 hash 生成 32 字符的 clientOrderId：

```typescript
// ❌ 已弃用，勿使用
function generateClientOrderId(intentKey: string): string {
    const hash = createHash('sha256').update(intentKey).digest('hex');
    return 'gb1' + hash.slice(0, 29);  // 固定 32 字符
}
```

**弃用原因**：
1. 现有格式 `gb1-{botId前8位}-{seq}` 更简洁、人眼可读
2. 调试时可直接看出 bot 和序号
3. 单 bot 单线程，seq 递增，无需 hash 防碰撞
