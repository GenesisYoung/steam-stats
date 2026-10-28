# API 文档

Base URL：`/api`（同源）。除特别说明外，所有接口需要请求头：

```
Authorization: Bearer <Firebase ID Token>
```

## 响应格式

```jsonc
// 成功
{ "data": <payload>, "meta": { "source": "cache" | "live", "dataAsOf": "ISO", "page": 1, "pageSize": 48, "total": 123 } }
// 失败
{ "error": { "code": "VALIDATION_FAILED", "message": "Invalid request", "details": [{ "path": "amount", "message": "..." }] } }
```

`meta.dataAsOf` 表示数据最近一次从 Steam 获取的时间。缓存数据一律标记为 `source: "cache"`，不会被描述为实时数据。
类型定义见 `shared/src/api.ts`；请求校验 schema 见 `shared/src/schemas.ts`。

| HTTP | 错误码 | 含义 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 参数 / 请求体校验失败 |
| 401 | `UNAUTHENTICATED` | Token 缺失、无效、过期或已吊销 |
| 401 | `RECENT_LOGIN_REQUIRED` | 敏感操作需 5 分钟内重新登录 |
| 403 | `EMAIL_NOT_VERIFIED` / `FORBIDDEN` / `STEAM_PROFILE_PRIVATE` | |
| 404 | `NOT_FOUND` | |
| 409 | `STEAM_NOT_LINKED` / `STEAM_ALREADY_LINKED` / `SYNC_IN_PROGRESS` | |
| 429 | `RATE_LIMITED` | 带 `Retry-After` 头 |
| 502 | `STEAM_UNAVAILABLE` | Steam 上游失败（已重试） |
| 500 | `INTERNAL` | 不暴露内部细节 |

限流：全局每 IP 1000 次 / 15 分钟；每用户 120 次 / 分钟；`POST /steam/auth` 10 次 / 15 分钟；`POST /steam/sync` 20 次 / 15 分钟；成就接口 30 次 / 分钟。

---

## 账户

### `GET /me`
首次调用时创建 `users/{uid}`。返回 `MeDto`。

### `PATCH /me`
```json
{ "displayName": "Gordon", "preferences": { "currency": "CNY", "language": "zh-CN", "storeRegion": "cn", "theme": "dark", "autoSync": true } }
```
两个字段均可选、`preferences` 可部分更新；未知字段会被拒绝（`strict`）。

### `DELETE /me` → `204`
需要 Token 的 `auth_time` 在 5 分钟内（前端先用密码 `reauthenticateWithCredential`）。删除全部子集合、SteamID 映射与 Firebase Auth 用户。同步进行中时返回 `409 SYNC_IN_PROGRESS`。

---

## Steam

### `POST /steam/auth`
> 相对需求中的 `GET /api/steam/auth` 做了调整：浏览器整页跳转无法携带 Bearer Token，因此改为 POST 建立关联会话。

- 要求邮箱已验证（可配置）。
- 响应设置 `steam_link`（HTTPS 下为 `__Host-steam_link`）HttpOnly Cookie，返回：
```json
{ "data": { "redirectUrl": "https://steamcommunity.com/openid/login?openid.mode=checkid_setup&..." } }
```
前端执行 `window.location.assign(redirectUrl)`。

### `GET /steam/callback`（无需 Bearer）
Steam 回调。校验后 `303` 跳转到：
- 成功：`{PUBLIC_APP_URL}/link-steam?status=success`（同时启动首次完整同步）
- 失败：`{PUBLIC_APP_URL}/link-steam?status=error&reason=<reason>`

`reason`：`cancelled`、`invalid_state`、`session_expired`、`replay`、`invalid_response`、`return_to_mismatch`、`stale_nonce`、`verification_failed`、`steam_unavailable`、`already_linked`、`account_has_other_steam`。

### `DELETE /steam/link` → `204`
解除关联：事务删除 `steamLinks/{steamId}`，清除游戏库、快照、同步记录和资料缓存；**保留**用户自填购买记录。

### `GET /steam/profile`
返回 `SteamProfileDto`。在线状态 60 秒内使用缓存，过期则实时请求 Steam（`meta.source = "live"`）；Steam 失败时回退缓存。`library.*` 为 `null` 表示不可用（如资料私密），而非 0。

### `GET /steam/games`
查询参数：

| 参数 | 取值 | 默认 |
|---|---|---|
| `q` | 名称或 AppID | |
| `sort` | `playtime` `name` `achievements` `price` `costPerHour` `lastPlayed` `recent` | `playtime` |
| `order` | `asc` `desc` | 视排序字段而定 |
| `played` | `all` `yes` `no` | `all` |
| `achievements` | `all` `yes` `no` | `all` |
| `page` / `pageSize` | ≥1 / 1–200 | 1 / 48 |

未知值（无价格、无成就数据）始终排在最后。返回 `GameListItemDto[]`，`meta.total` 为过滤后总数。

### `GET /steam/games/:appid`
`GameDetailDto`：列表字段 + 商店类型、购买记录、商店链接。

### `GET /steam/games/:appid/achievements`
`GameAchievementsDto`。若数据缺失或游戏时长自上次同步后有变化，会按需同步一次。成就定义与全球解锁率缓存在共享集合 `steamApps/{appid}/schemas/{lang}`（7 天）。

### `POST /steam/sync` → `202`
```json
{ "scope": "full" }   // 或 "profile"
```
- 同一用户同时只能有一个任务（`409 SYNC_IN_PROGRESS`，`details.jobId`）。
- 两次手动完整同步至少间隔 2 分钟（`429`）。
- 返回 `SyncJobDto`，通过下一个接口轮询进度。

### `GET /steam/sync/status`
```json
{ "data": { "active": SyncJobDto | null, "latest": SyncJobDto | null, "lastSuccessfulSyncAt": "ISO" | null } }
```
任务状态：`running` / `succeeded` / `partial`（成就或价格超出本次批量上限，下次继续）/ `failed`（`error.code` 如 `STEAM_PROFILE_PRIVATE`、`STEAM_UNAVAILABLE`）。

---

## 分析

| 接口 | 返回 | 说明 |
|---|---|---|
| `GET /analytics/overview` | `OverviewDto` | 总览：游戏数、时长、成就、估值、自填花费、平均每小时成本、最贵、最超值 |
| `GET /analytics/playtime` | `PlaytimeAnalyticsDto` | 总时长 = Σ分钟 / 60；Top10（含占比）；分布；快照差值趋势（`daily` 为相邻快照之间新增时长，归入后一快照日期） |
| `GET /analytics/achievements` | `AchievementAnalyticsDto` | 完成率仅基于成就数据已知的游戏 |
| `GET /analytics/library-value` | `LibraryValueDto` | 模型 A（按货币分组）+ 模型 B（自填，`disclaimer: user_entered_unverified`） |
| `GET /analytics/cost-efficiency?basis=estimated\|actual` | `CostEfficiencyDto` | 每小时成本排名；`notPlayedCount`、`noPriceCount` 单独计数 |

---

## 购买记录（模型 B）

### `GET /purchases` → `PurchaseDto[]`

### `PUT /purchases/:appid`
```json
{ "amount": 29.99, "currency": "USD", "purchaseDate": "2024-05-01", "source": "steam", "notes": "Summer sale" }
```
- `amount` 0–100000，最多两位小数；`purchaseDate` 不晚于今天，可为 `null`；`source` 见 `PURCHASE_SOURCES`。
- 游戏必须在用户已同步的游戏库中，否则 `404`。

### `DELETE /purchases/:appid` → `204`
属于捆绑包的游戏不能单独修改或删除（`409 PURCHASE_CONFLICT`），请通过捆绑包接口操作。

### 捆绑包（多款游戏一起购买）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/purchases/bundles` | 创建，返回 `201 BundleDto` |
| GET | `/purchases/bundles/:id` | 详情（含每款游戏的分摊金额） |
| PUT | `/purchases/bundles/:id` | 整体替换（可增删游戏、修改总价与分摊方式） |
| DELETE | `/purchases/bundles/:id` | 删除捆绑包及其所有游戏记录 |

```json
{ "appIds": [620, 413150], "total": 15, "currency": "USD", "purchaseDate": "2024-11-28",
  "source": "bundle", "notes": "", "allocation": "store_price", "replaceExisting": false }
```

- `allocation`：`store_price`（按当前商店价格比例；任一游戏价格未知时自动改为平均）、`even`（平均）、`manual`（需提供 `shares: [{ appId, amount }]`，合计必须等于 `total`）。
- 分摊精确到分，余数分给小数部分最大的游戏，保证合计等于总价。
- 每款游戏的 `gamePurchases/{appid}` 文档保存其分摊金额，并带 `bundle: { id, total, itemCount, allocation }`；统计"已记录花费"时捆绑包只计一次交易。
- 已有单独记录的游戏默认冲突（`409`，`details.appIds`），设 `replaceExisting: true` 可覆盖。

### 表格导入（CSV / Excel）

文件在浏览器中解析（CSV：papaparse；.xlsx：read-excel-file），服务器只接收解析后的交易数据，不接收文件本身。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/purchases/import/preview` | 发送解析后的交易（≤2000 笔，请求体 ≤1 MB），返回匹配结果 `ImportPreviewDto`，**不保存任何数据** |
| POST | `/purchases/import/commit` | 保存用户核对后的交易：一款游戏 = 单独记录；多款 = 捆绑包 |

预览请求：

```json
{ "transactions": [
  { "date": "2024-11-28", "type": "purchase", "total": 15, "currency": "USD", "source": "bundle", "notes": "",
    "items": [{ "name": "Portal 2", "amount": 6 }, { "name": "Half-Life 2", "amount": 9 }] }
] }
```

- 每个条目带 `kind`：`game`（匹配到游戏库）、`non_game`（DLC、原声、软件、钱包充值、市场、游戏内购买、退款；`reason` 说明原因）、`unmatched`（不在游戏库中）。
- 捆绑包：文件中订单号相同的行合并为一笔交易；一个单元格中用 `;` 或换行分隔的多款游戏也视为一笔交易。
- 提交时若捆绑包中每款游戏都有各自价格，前端发送 `shares`（合计必须等于 `total`），保存为手动分摊；否则按商店价格分摊。
- 导入的记录 `origin` 为 `file_import`。

---

## 内部

### `POST /internal/cron/sync`
请求头 `X-Cron-Secret: <CRON_SECRET>`（常量时间比较）。同步最多 25 名过期用户，返回 `{ attempted, skipped }`。

### `GET /api/health`
无需鉴权，返回 `{ "data": { "status": "ok" } }`。
