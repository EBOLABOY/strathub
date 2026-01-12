# GridBNB-USDT (TS Full Stack) — New Repo Refactor Task List

> 目标：在一个新的仓库里用 TypeScript 全量重写（Full Stack）。  
> 当前仓库不复用代码，只作为“行为参考 + 验收基线”（参考：`ts-gridbnb/implementation_plan.md` 的功能清单与证据文件/测试）。

## 最佳实践护栏（先写在任务清单前面，免得你后面装瞎）
- V1 默认只做 Spot：先把“网格条件单”闭环跑通；Futures/AI/动态资金分配全部后置。
- 不可妥协的上线底线：幂等下单（`clientOrderId`）、快照 + 重启 reconcile、精度/最小下单量校验、限流+退避重试、Kill Switch、仓位风控 buy/sell gate。
- 任务拆分原则：状态机吃掉分支；策略逻辑纯函数化；副作用集中在 exchange/order；所有可观测性从 Day1 做。
- 交付原则：先 Paper/Testnet soak（至少 7 天），能回滚配置、能一键停机，才允许接真实资金。

## Phase 0: Parity Spec Freeze（把需求钉死）<!-- id: 12 -->
- [ ] **确定版本范围**：V1 / V2（对应 `implementation_plan.md` §2.1）
- [ ] **冻结数据结构**：`GridStrategyConfigV1`（见 `implementation_plan.md` §2.2.1）、`BotRuntimeStateV1`（见 `implementation_plan.md` §2.2.2）、配置中心模型（全部 versioned）
- [ ] **冻结状态机**：bot lifecycle（DRAFT/WAITING_TRIGGER/RUNNING/PAUSED/STOPPING/STOPPED/ERROR）
- [ ] **冻结 API 契约**：Auth/Config/Template/History/SSE/Trades/Logs/Metrics/GridStrategy/Bot
- [ ] **冻结“条件系统”**：把 Trigger/Gate/Adaptive 三类条件列成白名单（含优先级与失败回退），写进 `implementation_plan.md` §2.7
- [ ] **硬规格：状态机转移表**（见 `implementation_plan.md` §2.8.1）
- [ ] **硬规格：`intentKey`/`clientOrderId` 规则**（见 `implementation_plan.md` §2.8.2）
- [ ] **硬规格：重启 reconcile 步骤**（见 `implementation_plan.md` §2.8.3）
- [ ] **硬规格：订单生命周期/事件模型**（见 `implementation_plan.md` §2.8.4）
- [ ] **硬规格：验收用例模板 + Top12 场景**（见 `implementation_plan.md` §2.8.5）
- [ ] **把现有测试变成验收用例**：按旧仓库单元/集成测试覆盖过的“场景”写出新仓库验收清单（不抄代码，抄行为）

## Phase 1: Infrastructure & Shared Core（Monorepo 起手式）<!-- id: 0 -->
- [ ] `pnpm-workspace.yaml` + `turbo.json` + `tsconfig.base.json`（strict）
- [ ] `eslint` + `prettier` + `lint/build/test` pipeline
- [ ] **Verify**：新仓库 `pnpm -r lint` / `pnpm -r build` 可跑通

## Phase 1.5: Shared Libs（把“数据结构”做成共享包）<!-- id: 1 -->
- [ ] `libs/shared`：Enums（`StrategyType`, `BotStatus`）、DTO、`GridStrategyConfigV1`（含 schema version）
- [ ] `libs/common`：logger（JSON/rotation）、config loader、crypto（AES-256）、retry/backoff、idempotency key 生成

## Phase 2: Domain Layer（Database & Auth）<!-- id: 2 -->
- [ ] Prisma schema（至少）：`User`, `ExchangeAccount`, `Bot`, `Order`, `BotLog`, `BotSnapshot`
- [ ] 配置中心 schema（对标当前仓库）：`ConfigItem`, `ConfigHistory`, `ConfigTemplate`, `ApiKeyReference`
- [ ] SQLite WAL + migrations + seed templates
- [ ] **Verify**：Config CRUD + Template apply + History rollback 跑通

## Phase 2.5: Auth Module（Backend）<!-- id: 3 -->
- [ ] Register/Login/Logout/Me/Verify
- [ ] 密码哈希 + JWT guard + RBAC（至少 admin/user 两档）
- [ ] **Verify**：Curl/Postman 完整跑通（登录后访问受保护接口）

## Phase 3: Exchange Layer（稳定性第一，不然你会被交易所 API 反杀）<!-- id: 4 -->
- [ ] 交易所选择（冻结）：V1 先做 Binance Spot（含 Testnet）；OKX Spot 放 V2（或 V1.x 另起验收）
- [ ] 代理/超时/限流/时间同步（含 periodic sync）
- [ ] MarketData：loadMarkets/ticker/orderbook/ohlcv（缓存 + 批量）
- [ ] Order API：create/cancel/fetch（必须支持幂等 `clientOrderId`）
- [ ] Account：总资产估值（spot + funding/理财去重 + 阈值过滤）
- [ ] （V2，默认关闭）Savings/Earn：申购/赎回/查询（对标当前 Simple Earn 流程）
- [ ] ExchangeSimulator + FakeClock：用于集成测试的可控交易所（支持错误注入、clientOrderId 幂等、部分成交）见 `implementation_plan.md` §2.5.1
- [ ] **Verify**：覆盖“网络故障/限流/超时 → 退避重试 + 最大重试上限 + 错误隔离”与“多交易对并发 → 共享客户端 + 单标的失败不拖死全局 + 总资产估值一致性”的验收场景（来源：旧仓库 integration tests）

## Phase 4: Trading Core（网格主循环 + 风控闭环）<!-- id: 5 -->
- [ ] GridTrader：上下轨/精度处理/交易执行/交易记录
- [ ] VolatilityEngine：混合波动率（传统 + EWMA）+（可选）成交量加权 + 平滑窗口（对标 `implementation_plan.md` §1.10）
- [ ] AdaptiveGridSizer：连续网格计算（clamp + 最小变更阈值）+ 状态落盘/恢复（对标 `adjust_grid_size()`）
- [ ] DynamicIntervalController：波动率映射到执行间隔（min interval 兜底 + fallback）
- [ ] （V2，默认关闭）FlipSignal + PreTransfer：偏离阈值触发的预划转（高风险副作用动作，必须有重试上限/告警/幂等/审计）
- [ ] StopLoss：价格止损 + 回撤止盈 + 紧急清仓（撤单→市价卖出→重试→小额跳过）
- [ ] RiskManager：仓位比例限制（全局 + per-symbol override），输出 buy/sell gate
- [ ] GlobalFundAllocator：equal/weighted（V1，防资金冲突与超配）
- [ ] （V2）DynamicRebalanceAllocator：dynamic rebalance（跨 bot 资金再平衡）
- [ ] （V2，默认关闭）TrendDetector：趋势识别 + 与 RiskState 集成（映射到 buy/sell gate）
- [ ] State：快照存储 + 重启恢复 reconcile（以交易所实际为准）
- [ ] **Verify**：完整买卖周期（挂单/成交/补网格）+ 状态快照落盘 + 重启 reconcile 后继续运行（来源：旧仓库 full trading cycle 场景）

## Phase 5: Huabao-style Grid Conditional Order（把“网格条件单”做成真闭环）<!-- id: 6 -->
- [ ] `GridStrategyConfigV1`：对齐当前 UI 语义（触发/下单/数量/自适应/风控/生命周期）
- [ ] TriggerEngine：base price 选择 + percent/price + pullback sell + rebound buy + 价格区间
- [ ] OrderEngine：amount_mode + 对称/不对称 + 盘口档位 + offset + 精度/最小量
- [ ] AdvancedRiskController：floor price / auto close（对标当前实现）
- [ ] AutoCloseConditionsV1：把 auto_close_conditions 从“随便一个 JSON”变成可校验 schema（profit/loss/drop/holding），并定义 startEquity/startBasePrice 基线口径（见 `implementation_plan.md` §2.2.1）
- [ ] BoundsGate：price_min/price_max + min_position/max_position + floor_price 的运行时 gating（不满足就不触发/不下单）
- [ ] LifecycleGate：expiry_days + trading_hours/trading_days（monitor period）真正接入状态机（过期/非时段要 PAUSE/不触发）
- [ ] AdaptiveFlags：把 `enable_volatility_adjustment/enable_dynamic_interval/enable_volume_weighting` 从“字段摆设”变成真逻辑
- [ ] PreviewEngine：`POST /api/bots/:botId/preview`（纯函数无副作用），输出 base/触发线/预计首单 + 手续费/收益估算（带假设）+ ERROR/WARN（见 `implementation_plan.md` §2.4.2）
- [ ] Bot 状态机接入：WAITING_TRIGGER/RUNNING/STOPPING（别再留 start/stop 占位）
- [ ] **Verify**：配置校验（边界条件/字段互斥/默认值）+ 触发引擎（percent/price/pullback/rebound/区间）行为一致（来源：旧仓库 unit tests 场景）

## Phase 6: Frontend（做 UI 但别让它决定后端怎么写）<!-- id: 9 -->
- [ ] 登录/用户信息
- [ ] 配置中心：列表/详情/历史/回滚/导入导出/批量更新/重载
- [ ] 模板：列表/详情/应用
- [ ] 网格条件单：创建/预览/运行状态/停止/日志
- [ ] Trades：历史/统计；Logs：文件/实时流；SSE/WS：实时刷新
- [ ] **Verify**：关键用户路径闭环（登录→创建策略→预览→启动→查看状态/日志→停止→历史回溯），UI 只负责展示（来源：旧仓库页面流程）

## Phase 7: Observability & Alerts（没有可观测性就等着爆仓）<!-- id: 10 -->
- [ ] Prometheus 指标：system/order/profit/risk/volatility/api/ai（指标集合来源：旧仓库；新仓库要固定命名与 label）
- [ ] 多渠道告警：PushPlus/Telegram/Webhook（通道来源：旧仓库；新仓库要做分级/去重/节流）
- [ ] 关键路径告警：止损触发、清仓失败、重试耗尽、余额异常、订单重复风险

## Phase 8: Deployment（能跑起来才算项目）<!-- id: 11 -->
- [ ] `docker-compose.yml`（App + Data Volume）
- [ ] `README.md`：测试网/模拟盘、环境变量、运行与回滚手册
