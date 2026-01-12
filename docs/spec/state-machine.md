# Bot 生命周期状态机规格

> 冻结版本：V1  
> 来源：implementation_plan.md §2.8.1

> [!NOTE]
> 本文档描述的是**语义**（状态/事件/幂等/并发），不强制规定由谁来执行 side effects。
> 当前实现里：API 负责状态变更与校验；reconcile/撤单等 side effects 由执行器/worker（或测试 harness）触发。

## 1. 状态枚举

```typescript
export enum BotStatus {
  DRAFT = 'DRAFT',                     // 草稿，未启动
  WAITING_TRIGGER = 'WAITING_TRIGGER', // 等待触发条件
  RUNNING = 'RUNNING',                 // 运行中
  PAUSED = 'PAUSED',                   // 暂停
  STOPPING = 'STOPPING',               // 停止中（撤单/清算）
  STOPPED = 'STOPPED',                 // 已停止
  ERROR = 'ERROR',                     // 错误（需人工介入）
}
```

## 2. 事件枚举

```typescript
export enum BotEvent {
  START = 'START',
  TRIGGER_HIT = 'TRIGGER_HIT',
  PAUSE = 'PAUSE',
  RESUME = 'RESUME',
  STOP = 'STOP',
  RISK_TRIGGERED = 'RISK_TRIGGERED',   // 保底价/自动清仓触发
  KILL_SWITCH = 'KILL_SWITCH',         // 用户级一键停机（user-scoped）
  FATAL_ERROR = 'FATAL_ERROR',         // 超过重试上限/数据不一致
  STOPPED_COMPLETE = 'STOPPED_COMPLETE', // 撤单/清算完成
}
```

## 3. 状态转移表

| From | Event | To | Preconditions | Side Effects | Failure Fallback |
|------|-------|-----|---------------|--------------|------------------|
| DRAFT | START | WAITING_TRIGGER / RUNNING | config 校验通过；exchange account 可用 | `reconcile()`；写 runId；（有触发条件→WAITING_TRIGGER，否则 RUNNING） | reconcile 失败→ERROR |
| WAITING_TRIGGER | TRIGGER_HIT | RUNNING | trigger 条件满足；不在 trading window 外；风险 gate 允许 | 生成/更新 grid；place 初始订单 | 下单失败→留在 WAITING_TRIGGER 并告警（可重试） |
| WAITING_TRIGGER | PAUSE | PAUSED | - | 停止触发检查；不下新单 | - |
| WAITING_TRIGGER | STOP | STOPPING | - | cancel open orders；落盘；告警可选 | cancel 失败→继续 STOPPING 重试，超限→ERROR |
| RUNNING | PAUSE | PAUSED | - | 不再 place 新单；（V1：保留挂单不动） | - |
| RUNNING | STOP | STOPPING | - | cancel open orders；（如启用 auto-close→市价平仓） | 同上 |
| PAUSED | RESUME | WAITING_TRIGGER / RUNNING | - | `reconcile()`；恢复 loop | reconcile 失败→ERROR |
| STOPPING | STOPPED_COMPLETE | STOPPED | 已完成撤单/清算/落盘 | 写 stopAt；清 runId | - |
| * | RISK_TRIGGERED | STOPPING | 保底价 stop / 自动清仓触发 | cancel open orders；（按策略）市价平仓；强告警 | 失败→ERROR + 强告警 |
| * | KILL_SWITCH | STOPPING | user.killSwitchEnabled=true（user-scoped） | 立刻停止下单；尽快撤单（执行器实现）；可选清仓 | 失败→ERROR + 强告警 |
| * | FATAL_ERROR | ERROR | 超过重试上限/数据不一致/幂等冲突 | 停止下单；告警；保留现场 | - |

## 4. 并发与幂等约束

### 4.1 乐观锁（statusVersion）
- 每次状态变更必须带 `statusVersion` 做 CAS
- 旧版本请求直接拒绝（409 Conflict）
- 同一 bot 同时只能有一个 transition 在飞

### 4.2 配置修改约束
- **允许修改**：DRAFT / PAUSED / STOPPED / ERROR
- **禁止修改**：RUNNING / WAITING_TRIGGER / STOPPING（必须先 PAUSE 或 STOP）

### 4.3 幂等事件
- START：已在 RUNNING/WAITING_TRIGGER → 返回当前状态（不报错）
- PAUSE：已在 PAUSED → 返回当前状态
- STOP：已在 STOPPING/STOPPED → 返回当前状态
- RESUME：已在 RUNNING/WAITING_TRIGGER → 返回当前状态（不 bump statusVersion）

## 5. Runtime Phase（UI 展示用）

```typescript
// 存在 BotRuntimeStateV1.phase，不影响主状态机
export type RuntimePhase = 'RECONCILING' | 'IDLE' | 'ACTIVE';
```

- `RECONCILING`：正在与交易所同步状态
- `IDLE`：等待下一个检查周期
- `ACTIVE`：正在执行下单/撤单
