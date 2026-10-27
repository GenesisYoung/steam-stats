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

---

## 内部

### `POST /internal/cron/sync`
请求头 `X-Cron-Secret: <CRON_SECRET>`（常量时间比较）。同步最多 25 名过期用户，返回 `{ attempted, skipped }`。

### `GET /api/health`
无需鉴权，返回 `{ "data": { "status": "ok" } }`。
