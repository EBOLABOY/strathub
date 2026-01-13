# API 契约规格

> 冻结版本：V1  
> 来源：implementation_plan.md §2.4

## 1. 认证

| 端点 | 方法 | 描述 | Auth |
|------|------|------|------|
| `/api/auth/register` | POST | 注册 | ❌ |
| `/api/auth/login` | POST | 登录 | ❌ |
| `/api/auth/me` | GET | 当前用户 | ✅ JWT |

### 认证方式
```
Authorization: Bearer <JWT>
```

### JWT Payload
```typescript
interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user';
  iat: number;
  exp: number;
}
```

---

## 2. Bot API

| 端点 | 方法 | 描述 | Auth |
|------|------|------|------|
| `/api/bots` | POST | 创建 Bot | ✅ |
| `/api/bots` | GET | 列表 | ✅ |
| `/api/bots/:botId` | GET | 详情 | ✅ |
| `/api/bots/:botId` | DELETE | 删除（只允许 DRAFT/STOPPED/ERROR） | ✅ |
| `/api/bots/:botId/config` | PUT | 更新配置 | ✅ |
| `/api/bots/:botId/preview` | POST | 预览（支持 configOverride） | ✅ |
| `/api/bots/:botId/start` | POST | 启动 | ✅ |
| `/api/bots/:botId/pause` | POST | 暂停 | ✅ |
| `/api/bots/:botId/resume` | POST | 恢复 | ✅ |
| `/api/bots/:botId/stop` | POST | 停止 | ✅ |
| `/api/bots/:botId/runtime` | GET | 运行状态 | ✅ |
| `/api/bots/:botId/risk-check` | POST | AutoClose 检查（V1 无 worker 的 seam） | ✅ |

---

## 2.2 Accounts API

| 端点 | 方法 | 描述 | Auth |
|------|------|------|------|
| `/api/accounts` | GET | 列表（仅返回脱敏 DTO，无 credentials） | ✅ |
| `/api/accounts` | POST | 创建（写入 encryptedCredentials） | ✅ |
| `/api/accounts/:accountId` | PUT | 更新（name/isTestnet/credentials） | ✅ |
| `/api/accounts/:accountId` | DELETE | 删除（若有 bots 返回 409） | ✅ |

### Response DTO (GET/POST/PUT)
```typescript
interface AccountDTO {
  id: string;
  exchange: string;
  name: string;
  isTestnet: boolean;
  createdAt: string;
}
```

> [!IMPORTANT]
> `encryptedCredentials` **绝不**通过 API 返回。POST 时接收 `apiKey`/`secret`，写入后立即脱敏。

> [!CAUTION]
> **M3B（已实现）**：`isTestnet=false`（mainnet）账户仅在配置 `CREDENTIALS_ENCRYPTION_KEY` 后允许创建。
> 当配置 `CREDENTIALS_ENCRYPTION_KEY`（32 字节 base64）时，`POST /api/accounts` 会用 AES-256-GCM 将 `{apiKey, secret}` 加密后写入 `encryptedCredentials`（格式 `iv:authTag:ciphertext`，均为 base64）。
> **向后兼容**：未配置密钥时仅允许 testnet，写入明文 JSON，并打印 `[SECURITY]` 警告；迁移脚本：`packages/api/scripts/migrate-credentials.ts`。

---

## 2.1 Kill Switch API（用户级停机）

> 作用域：**user-scoped**（只影响当前用户的 bots）

| 端点 | 方法 | 描述 | Auth |
|------|------|------|------|
| `/api/kill-switch` | GET | 查询当前用户 Kill Switch 状态 | ✅ |
| `/api/kill-switch/enable` | POST | 启用（幂等） | ✅ |
| `/api/kill-switch/disable` | POST | 禁用（幂等） | ✅ |

> [!NOTE]
> 当 `killSwitchEnabled=true` 时，`/api/bots/:botId/start` 与 `/api/bots/:botId/resume` 必须返回 `423 KILL_SWITCH_LOCKED`，并且 **不得增加** bot 的 `statusVersion`。

---

## 3. 实时推送（V2）

V1 **不实现** SSE/WebSocket 推送；需要前端实时性时先使用轮询（V1）或后续接入 SSE（V2）。

---

## 4. 错误码

| Code | HTTP | 描述 |
|------|------|------|
| `UNAUTHORIZED` | 401 | 未认证 |
| `INVALID_TOKEN` | 401 | Token 无效 |
| `INVALID_CREDENTIALS` | 401 | 凭证错误 |
| `BAD_REQUEST` | 400 | 请求参数错误 |
| `BOT_NOT_FOUND` | 404 | Bot 不存在 |
| `INVALID_STATE_TRANSITION` | 409 | 状态转移无效 |
| `INVALID_STATE_FOR_CONFIG_UPDATE` | 409 | 当前状态不允许修改配置 |
| `INVALID_STATE_FOR_DELETE` | 409 | 当前状态不允许删除 |
| `BOT_ALREADY_EXISTS` | 409 | 同账户同币对 Bot 已存在 |
| `INVALID_CONFIG` | 422 | 配置 JSON 解析失败 |
| `VALIDATION_ERROR` | 422 | Zod 请求参数校验失败 |
| `CONFIG_VALIDATION_ERROR` | 422 | 配置校验失败（Preview 有 ERROR） |
| `KILL_SWITCH_LOCKED` | 423 | Kill Switch 已启用，禁止 start/resume |
| `CONCURRENT_MODIFICATION` | 409 | 乐观锁失败 / 并发修改 |
| `EXCHANGE_UNAVAILABLE` | 503 | 交易所数据不可用（market/ticker 获取失败） |
| `EXCHANGE_ACCOUNT_NOT_FOUND` | 404 | Exchange Account 不存在或不属于当前用户 |
| `EXCHANGE_ACCOUNT_ALREADY_EXISTS` | 409 | 同用户/交易所/名称账户已存在 |
| `ACCOUNT_HAS_BOTS` | 409 | 账户下存在 bots，禁止删除 |
| `MAINNET_ACCOUNT_FORBIDDEN` | 403 | 未配置 `CREDENTIALS_ENCRYPTION_KEY`，禁止创建 mainnet 账户 |
| `INTERNAL_ERROR` | 500 | 内部错误 |

---

## 5. 分页（V2）

V1 当前所有列表接口默认返回全量数据；分页参数作为 V2 扩展再引入。

```typescript
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

Query: `?page=1&pageSize=20`
