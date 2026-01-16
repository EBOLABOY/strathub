# 订单生命周期与事件模型规格

> 冻结版本：V1  
> 来源：implementation_plan.md §2.8.4

## 1. 统一订单状态枚举

```typescript
export enum OrderStatus {
  NEW = 'NEW',                       // 已提交，未成交
  PARTIALLY_FILLED = 'PARTIALLY_FILLED', // 部分成交
  FILLED = 'FILLED',                 // 完全成交
  CANCELED = 'CANCELED',             // 已撤销
  REJECTED = 'REJECTED',             // 被拒绝
  EXPIRED = 'EXPIRED',               // 已过期
}
```

## 2. 状态转移图

```
                 ┌─────────────────────────────────────┐
                 │                                     │
NEW ────────► PARTIALLY_FILLED ────────► FILLED
 │                 │
 │                 │
 ▼                 ▼
CANCELED ◄─────────┘
 │
 ▼
REJECTED / EXPIRED
```

规则：
- 状态只允许前进，不允许倒退
- NEW → PARTIALLY_FILLED → FILLED：正常成交路径
- NEW / PARTIALLY_FILLED → CANCELED：撤单
- NEW → REJECTED：下单被拒
- NEW → EXPIRED：订单过期（GTC 以外）

## 3. 统一订单字段（最小集合）

```typescript
export interface Order {
  id: string;                    // 内部 ID (UUID)
  botId: string;                 // 关联 Bot
  exchange: string;              // 'binance' | 'okx' | 'bybit' | 'coinbase' | 'kraken'
  symbol: string;                // 'BNB/USDT'

  // 幂等关键字段
  clientOrderId: string;         // 必填，gb1 前缀
  exchangeOrderId?: string;      // 创建成功后回填

  // 订单属性
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  status: OrderStatus;

  // 价格与数量（decimal string）
  price?: string;                // limit 必填
  amount: string;                // 委托数量
  filledAmount: string;          // 已成交数量
  avgFillPrice?: string;         // 平均成交价

  // 时间戳
  createdAt: Date;
  updatedAt: Date;
}
```

## 4. 事件处理原则

### 4.1 幂等
- 同一事件可能重复到达，处理后结果必须相同
- 以 `(exchange, tradeId)` 作为唯一键

### 4.2 单调
- 状态只允许前进，不允许倒退
- `filledAmount` 只允许增加，不允许减少

### 4.3 汇总优先
- 订单的 `filledAmount` / `avgFillPrice` 以 trades 汇总为准
- 不要相信单次回包里的 filled 值

```typescript
function updateOrderFromTrades(order: Order, trades: Trade[]): void {
  const myTrades = trades.filter(t => t.clientOrderId === order.clientOrderId);

  let totalFilled = 0;
  let totalCost = 0;

  for (const trade of myTrades) {
    totalFilled += parseFloat(trade.amount);
    totalCost += parseFloat(trade.amount) * parseFloat(trade.price);
  }

  order.filledAmount = totalFilled.toFixed(order.amountPrecision);
  order.avgFillPrice = totalFilled > 0
    ? (totalCost / totalFilled).toFixed(order.pricePrecision)
    : undefined;

  if (totalFilled >= parseFloat(order.amount)) {
    order.status = OrderStatus.FILLED;
  } else if (totalFilled > 0) {
    order.status = OrderStatus.PARTIALLY_FILLED;
  }
}
```

## 5. 交易所状态映射（ccxt 统一状态）

V1 以 ccxt 的统一字段为准（避免每个交易所写一套 mapping 表）：

| ccxt order.status | 内部 OrderStatus |
|---|---|
| `open`（filled=0） | NEW |
| `open`（filled>0） | PARTIALLY_FILLED |
| `closed` | FILLED |
| `canceled` / `cancelled` | CANCELED |
| `expired` | EXPIRED |
| `rejected` | REJECTED |

## 6. Trade 记录

```typescript
export interface Trade {
  id: string;                   // 内部 ID
  botId: string;                // 关联 Bot
  exchange: string;             // 'binance' | 'okx' | 'bybit' | 'coinbase' | 'kraken'
  symbol: string;               // 'BNB/USDT'

  // 唯一键
  tradeId: string;              // 交易所返回的 trade ID

  // 关联订单
  orderIdRef?: string;          // 内部 order.id
  clientOrderId?: string;       // 用于匹配

  // 成交信息（decimal string）
  price: string;
  amount: string;
  fee: string;
  feeCurrency: string;

  // 时间戳
  timestamp: Date;
}
```

唯一约束：`(exchange, tradeId)`
