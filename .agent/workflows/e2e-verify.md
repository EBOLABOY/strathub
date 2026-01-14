---
description: End-to-end user journey verification workflow
---

# E2E 用户流程验证

## 前置条件

确保以下服务正在运行：
- 数据库已初始化 (`npm run db:push -w packages/database`)
- API 服务启动 (`npm run dev -w packages/api`)
- Worker 服务启动 (`npm run dev -w packages/worker`)
- Web 服务启动 (`npm run dev -w packages/web`)

## 验证步骤

### 1. 用户认证流程

1. 打开浏览器访问 `http://localhost:3000/login`
2. 点击 "Create Account" 创建新账号
3. 输入测试邮箱和密码
4. 确认注册成功并自动登录
5. 验证跳转到仪表板页面

### 2. 交易所账户管理

1. 导航到 "Settings" -> "Accounts"
2. 点击 "Add Account" 创建测试网账户
3. 填写：
   - Name: Test Binance
   - Exchange: Binance
   - API Key: any-test-key
   - Secret: any-test-secret
   - 勾选 "Testnet"
4. 确认账户创建成功

### 3. Bot 创建与预览

1. 导航到 "Bots" 页面
2. 点击 "Create Bot"
3. 选择刚创建的交易所账户
4. 输入交易对：`BNB/USDT`
5. 保持默认配置或修改
6. 点击 "Create Draft Bot"
7. 确认跳转到 Bot 详情页
8. 点击 "Preview" 预览策略
9. 验证显示：
   - 风险分析结果
   - 网格预览图表
   - 预估收益

### 4. Bot 生命周期管理

1. 在 Bot 详情页点击 "Start"
2. 验证状态变为 "Waiting Trigger" 或 "Running"
3. 验证 SSE 连接状态显示 "实时连接"
4. 点击 "Pause"
5. 验证状态变为 "Paused"
6. 点击 "Resume"
7. 验证状态恢复
8. 点击 "Stop"
9. 等待状态变为 "Stopped"
10. 点击 "Delete"
11. 确认删除，验证跳转回列表

### 5. 配置中心验证

1. 导航到 "Config" 页面
2. 查看配置列表
3. 搜索过滤功能测试
4. 点击某配置项的编辑按钮
5. 修改值并保存
6. 点击历史按钮查看版本记录
7. 测试导出功能
8. 测试导入功能

### 6. 模板管理验证

1. 导航到 "Templates" 页面
2. 点击 "创建模板"
3. 填写模板信息
4. 保存模板
5. 选择模板查看详情
6. 复制配置
7. 编辑模板
8. 测试应用到 Bot
9. 删除模板

### 7. 可观测性验证

1. 访问 `http://localhost:3000/metrics`
2. 验证返回 Prometheus 格式指标
3. 检查关键指标：
   - `csh_active_bots_total`
   - `csh_orders_placed_total`
   - `csh_worker_tick_duration_seconds`

## 自动化测试

// turbo-all
```bash
# 运行 API E2E 测试
npm run test -w packages/api
```

## 验证清单

| 功能 | 状态 | 备注 |
|------|------|------|
| 用户注册 | ⬜ | |
| 用户登录 | ⬜ | |
| 账户创建 | ⬜ | |
| Bot 创建 | ⬜ | |
| 策略预览 | ⬜ | |
| Bot 启动 | ⬜ | |
| SSE 实时更新 | ⬜ | |
| Bot 暂停/恢复 | ⬜ | |
| Bot 停止 | ⬜ | |
| Bot 删除 | ⬜ | |
| 配置查看 | ⬜ | |
| 配置编辑 | ⬜ | |
| 配置历史 | ⬜ | |
| 配置导入/导出 | ⬜ | |
| 模板创建 | ⬜ | |
| 模板详情 | ⬜ | |
| 模板应用 | ⬜ | |
| Prometheus 指标 | ⬜ | |
