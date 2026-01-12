# 条件系统规格

> 冻结版本：V1  
> 来源：implementation_plan.md §2.7

## 1. basePriceType 支持状态

| 类型 | V1 状态 | 说明 |
|------|---------|------|
| `current` | ✅ 支持 | 使用当前市场价 |
| `manual` | ✅ 支持 | 用户手动填写 |
| `cost` | ❌ V2 预留 | 需要持仓成本数据，口径复杂 |
| `avg_24h` | ❌ V2 预留 | 需要 24h 均价计算 |

> [!WARNING]
> `basePriceType=cost` 和 `basePriceType=avg_24h` 在 V1 会返回 `ERROR: UNSUPPORTED_BASE_PRICE_TYPE`，Preview 和 Start/Resume 均会被阻断。

---

## 2. amountMode 计算口径

| 类型 | V1 状态 | 计算方式 |
|------|---------|----------|
| `amount` | ✅ 支持 | 直接使用配置的 quote 金额 |
| `percent` | ✅ 支持 | `freeQuoteBalance * (orderQuantity / 100)` |

> [!NOTE]
> `amountMode=percent` 依赖余额数据。如果余额不可用，Preview 返回 `WARN: BALANCE_UNAVAILABLE`。

---

## 3. 条件分类

| 类型 | 作用 | 示例 |
|------|------|------|
| **Trigger** | 触发下单 | 价格达到触发线 |
| **Gate** | 阻断下单 | 仓位超限、时段外 |
| **Risk** | 触发停机/清算 | AutoClose、Kill Switch |
| **Adaptive** | 调整参数 | 波动率 → 网格大小 |

---

## 4. 执行顺序（固定）

```
1. LifecycleGate   → 检查过期/时段
2. BoundsGate      → 检查价格区间/仓位范围
3. MarketTrigger   → 检查触发条件
4. RiskGates       → 检查风控（买卖开关）
5. AdaptiveUpdate  → 更新自适应参数
6. OrderExecution  → 执行下单
```

> [!NOTE]
> 上述是**运行时执行管线**的规格草案；V1 当前只冻结“口径 + 可测试模块”（Preview/Gates/Risk），不包含完整的触发循环与下单执行。

---

## 5. V1 条件白名单

### Trigger
| 名称 | 描述 | V1 状态 |
|------|------|---------|
| `PriceTrigger` | 价格达到触发线 | ✅ 支持 |
| `PullbackSell` | 回落卖出 | ❌ V1 未实现（字段预留，V2） |
| `ReboundBuy` | 拐点买入 | ❌ V1 未实现（字段预留，V2） |

### Gate
| 名称 | 描述 | V1 状态 |
|------|------|---------|
| `LifecycleGate` | 过期/时段检查 | ❌ V1 未实现 |
| `BoundsGate` | 价格/仓位范围 | ✅ 支持 |
| `RiskGate` | 买卖开关 | ✅ 支持 |
| `FloorPriceGate` | 保底价检查 | ✅ 支持 |
| `TrendGate` | 趋势阻断 | ❌ V2 预留 |

### Adaptive
| 名称 | 描述 | V1 状态 |
|------|------|---------|
| `VolatilityAdjust` | 波动率→网格 | ❌ V1 未实现（V2） |
| `DynamicInterval` | 波动率→间隔 | ❌ V1 未实现（V2） |
| `VolumeWeighting` | 成交量加权 | ❌ V1 未实现（V2） |

### Risk
| 名称 | 描述 | V1 状态 |
|------|------|---------|
| `AutoClose` | 价格回撤触发 `RISK_TRIGGERED(reason=AUTO_CLOSE)` → STOPPING | ✅ V1 支持（可选开关） |
| `KillSwitch` | 用户级停机：阻断 start/resume（423）+ 运行中 bots → STOPPING | ✅ 支持 |

---

## 6. 失败回退（V2）

| 条件 | 失败行为 |
|------|----------|
| OHLCV 获取失败 | 回退 volatility=0.2 |
| 趋势计算失败 | 跳过趋势 Gate |
| Gate 检查失败 | 阻断并记录原因 |

---

## 7. 可观测性（V2）

| 指标 | 说明 |
|------|------|
| `condition_block_total{type,reason}` | 条件阻断计数 |
| `volatility_hybrid{symbol}` | 混合波动率 |
| `gate_check_duration_seconds{gate}` | Gate 检查耗时 |
