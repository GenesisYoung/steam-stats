# 安装、配置与部署指南

本文覆盖从零搭建到生产部署的全部步骤。命令均在仓库根目录执行。

## 0. 前置条件

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 22（已在 24 验证） | 前后端运行与构建 |
| npm | ≥ 10 | workspaces |
| Java | ≥ 11 | Firebase 本地模拟器（测试需要） |
| Google Cloud CLI (`gcloud`) | 最新 | 部署 Cloud Run / Cloud Scheduler |

`firebase-tools` 已作为根目录 devDependency 安装，使用 `npx firebase ...` 即可。

```bash
npm install
```

---

## 1. 创建并配置 Firebase 项目

1. 打开 [Firebase 控制台](https://console.firebase.google.com/) → **添加项目**。
2. 生产环境需要 **Blaze（按量付费）方案**，因为 Cloud Run 与 Hosting 重写到 Cloud Run 需要计费账号。
3. 项目设置 → 常规 → **添加 Web 应用**，记下 `apiKey`、`authDomain`、`projectId`、`appId`（填入前端 `.env`）。
4. 复制 `firebase/.firebaserc.example` 为 `firebase/.firebaserc` 并填写项目 ID。

## 2. 启用 Firebase Authentication

1. Authentication → 登录方法 → 启用 **电子邮件/密码**。
2. Authentication → 设置 → **用户操作**：建议开启"电子邮件枚举保护"。
3. Authentication → 设置 → **已获授权的网域**：添加生产域名（如 `your-project.web.app` 与自定义域名）。
4. （可选）在"模板"中自定义验证邮件与重置密码邮件，支持中文模板。

## 3. 配置 Cloud Firestore

1. Firestore Database → **创建数据库** → 生产模式 → 选择区域（建议与 Cloud Run 同区域，如 `us-central1` / `asia-east1`）。
2. 部署规则与索引：

   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes --config firebase/firebase.json --project <projectId>
   ```

3. `firestore.indexes.json` 已声明 `linkSessions.expiresAt`、`openidNonces.expiresAt` 的 **TTL 策略**，部署后 Firestore 会自动清理过期的关联会话与 nonce（TTL 删除通常在过期后 24 小时内完成，代码不依赖其及时性）。
4. 后端使用 Admin SDK，不受规则约束；规则用于阻止任何客户端直接读写他人数据或篡改 Steam 可信数据。

## 4. 申请 Steam Web API Key

1. 使用 Steam 账号登录 <https://steamcommunity.com/dev/apikey>。
   - Valve 要求账号非受限账户（通常需要在 Steam 消费过至少 5 美元、启用 Steam 令牌）。
2. 域名填写你的生产域名，同意 [Steam Web API 使用条款](https://steamcommunity.com/dev/apiterms)。
3. 得到 32 位十六进制 Key，填入后端 `STEAM_API_KEY`。**Key 只存在于后端环境变量 / Secret Manager，绝不下发到前端。**
4. 默认限额为每 Key 每天 100,000 次调用；后端已内置令牌桶限流（Web API 5 次/秒，商店接口约 0.6 次/秒）。

## 5. 配置 Steam OpenID 回调地址

Steam OpenID **无需在 Steam 侧预先注册**回调地址。后端根据 `PUBLIC_API_URL` 自动生成：

- `openid.realm` = `PUBLIC_API_URL`
- `openid.return_to` = `PUBLIC_API_URL/api/steam/callback?state=<随机值>`

要求：

- 生产环境 `PUBLIC_API_URL` 必须是 **https**，且与前端同源（Firebase Hosting 通过 `/api/**` 重写到 Cloud Run），这样关联用的 `__Host-steam_link` Cookie（HttpOnly、Secure、SameSite=Lax）才能正常工作。
- 本地开发：`PUBLIC_APP_URL` 与 `PUBLIC_API_URL` 都设为 `http://localhost:5173`（Vite 代理 `/api` 到后端 8080 端口）。

## 6. 环境变量

### 后端 `backend/.env`（参考 `backend/.env.example`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `PUBLIC_APP_URL` | ✓ | 前端源，用于关联完成后的跳转与 CORS |
| `PUBLIC_API_URL` | ✓ | 浏览器访问 `/api` 的源（同源部署时与上面相同） |
| `FIREBASE_PROJECT_ID` | ✓ | Firebase 项目 ID |
| `STEAM_API_KEY` | ✓ | Steam Web API Key |
| `GOOGLE_APPLICATION_CREDENTIALS` | 本地 | 服务账号 JSON 路径（Cloud Run 上留空，使用默认凭据） |
| `REQUIRE_EMAIL_VERIFIED` | | 关联 Steam 是否要求已验证邮箱，默认 `true` |
| `CRON_SECRET` | | ≥32 字符；为空则禁用 `/internal/cron/sync` |
| `TRUST_PROXY` | | 反向代理层数，Hosting+Cloud Run 设为 `1`~`2` |
| `SYNC_ACHIEVEMENT_BATCH` | | 单次同步最多处理的成就游戏数，默认 200 |
| `SYNC_METADATA_BATCH` | | 单次同步最多获取的商店元数据数，默认 150 |
| `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` | 开发 | 使用本地模拟器 |

生成 `CRON_SECRET`：

```bash
openssl rand -hex 32
```

### 前端 `frontend/.env`（参考 `frontend/.env.example`）

| 变量 | 说明 |
|---|---|
| `VITE_FIREBASE_API_KEY` 等 | Firebase Web 配置（公开标识符，不是机密） |
| `VITE_USE_EMULATORS` | `true` 时连接本地 Auth 模拟器 |
| `VITE_API_BASE` | 默认 `/api` |

## 7. 本地运行前端

```bash
cp frontend/.env.example frontend/.env   # 填写 Firebase Web 配置
npm run dev:frontend                      # http://localhost:5173
```

## 8. 本地运行后端

```bash
cp backend/.env.example backend/.env     # 填写变量
npm run dev:backend                       # http://127.0.0.1:8080，tsx watch 热重载
```

**完全离线的开发方式（推荐先这样体验）**：

```bash
npm run emulators     # 终端 1：Auth(9099) + Firestore(8180) + UI(4000)
```

`backend/.env` 中设置：

```
FIREBASE_PROJECT_ID=demo-steam-analytics
FIRESTORE_EMULATOR_HOST=127.0.0.1:8180
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```

`frontend/.env` 中设置 `VITE_USE_EMULATORS=true`、`VITE_FIREBASE_PROJECT_ID=demo-steam-analytics`、`VITE_FIREBASE_API_KEY=demo-key`。模拟器中的验证邮件链接会打印在模拟器 UI（http://127.0.0.1:4000/auth）里。
Steam 部分仍需要真实的 `STEAM_API_KEY`（OpenID 登录本身不需要 Key）。

## 9. 运行测试

```bash
npm test                 # shared 单元测试 + 后端单元测试 + 前端组件/i18n 测试（无需模拟器）
npm run test:emulated    # 自动启动 Auth + Firestore 模拟器，运行后端集成测试与 Firestore 规则测试
npm run typecheck        # 全部 TypeScript 类型检查（含 vue-tsc）
```

测试覆盖：统计计算、零时长与缺失价格、OpenID 校验（签名字段、nonce 过期、return_to 篡改、取消）、链接劫持（缺少绑定 Cookie）、重放、SteamID 重复绑定冲突、私密资料、Steam API 失败与锁释放、并发同步、购买记录校验、账户删除、Firestore 安全规则。所有 Steam 请求都由 `backend/test/helpers/fakeSteam.ts` 模拟，**自动化测试从不访问真实 Steam**。

## 10. 生产构建

```bash
npm run build            # backend/dist（tsup 打包）+ frontend/dist（vue-tsc + vite build）
```

## 11. 部署

有两种部署方式，任选其一：

- **方式 A：Firebase App Hosting（推荐，推送 GitHub 即自动部署）**：一个 Node 服务器同时提供 `/api` 与前端页面，见 11.0。
- **方式 B：Cloud Run + Firebase Hosting（手动部署）**：见 11.1–11.2。

### 11.0 Firebase App Hosting（GitHub 自动部署）

仓库根目录的 `apphosting.yaml` 已配置好构建与启动：

- 构建：`npm run build`（后端 tsup + 前端 vite）
- 启动：`node backend/dist/server.js`，并通过 `FRONTEND_DIST=frontend/dist` 让同一个服务器提供前端页面
- Firebase Web 配置（`FIREBASE_WEBAPP_CONFIG`）与项目 ID（`FIREBASE_CONFIG`）由 App Hosting 自动注入，无需手动填写 `VITE_FIREBASE_*`

首次配置步骤：

1. **创建机密**（只需一次，会提示输入值并自动授权给 App Hosting 后端）：

   ```bash
   npx firebase apphosting:secrets:set steam-api-key --project <projectId>
   npx firebase apphosting:secrets:set cron-secret --project <projectId>
   ```

   `cron-secret` 至少 32 个字符，可用 `openssl rand -hex 32` 生成。

2. **核对域名**：`apphosting.yaml` 中 `PUBLIC_APP_URL` / `PUBLIC_API_URL` 必须与 App Hosting 后端的域名完全一致（控制台 App Hosting → Backend → Domains）。绑定自定义域名后同步修改。
3. **授权域名**：Authentication → 设置 → 已获授权的网域，添加 `*.hosted.app` 中你的后端域名。
4. **部署规则与索引**：同第 3 步（App Hosting 不会自动部署 Firestore 规则）。
5. 提交并推送到 `main`，App Hosting 会自动开始新的 rollout。

注意：App Hosting 的实例在没有请求时会限制 CPU。手动同步在返回 202 后于后台运行，前端每 3 秒轮询同步状态，这通常能让任务继续推进；如遇大型游戏库同步长时间停滞，可改用 11.3 的定时同步（定时调用会在请求内同步完成）或方式 B 的 `--no-cpu-throttling`。

### 11.1 后端 → Cloud Run

```bash
PROJECT=<projectId>
REGION=us-central1

# 1) 存放机密
printf '%s' "<STEAM_API_KEY>" | gcloud secrets create steam-api-key --data-file=- --project $PROJECT
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create cron-secret --data-file=- --project $PROJECT

# 2) 构建并部署（在仓库根目录执行）
IMAGE=$REGION-docker.pkg.dev/$PROJECT/containers/steam-analytics-api
gcloud artifacts repositories create containers --repository-format=docker --location=$REGION --project $PROJECT
gcloud auth configure-docker $REGION-docker.pkg.dev
docker build --platform linux/amd64 -f backend/Dockerfile -t $IMAGE .
docker push $IMAGE

gcloud run deploy steam-analytics-api \
  --project $PROJECT --region $REGION \
  --image $REGION-docker.pkg.dev/$PROJECT/containers/steam-analytics-api \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --min-instances 0 --max-instances 5 --timeout 900 \
  --set-env-vars NODE_ENV=production,FIREBASE_PROJECT_ID=$PROJECT,PUBLIC_APP_URL=https://$PROJECT.web.app,PUBLIC_API_URL=https://$PROJECT.web.app,TRUST_PROXY=2 \
  --set-secrets STEAM_API_KEY=steam-api-key:latest,CRON_SECRET=cron-secret:latest
```

说明：

- `--allow-unauthenticated`：接口本身用 Firebase ID Token 鉴权；Hosting 重写需要可公开调用。
- `--no-cpu-throttling`（实例级计费，CPU 始终分配）：手动同步在响应 202 后于后台继续执行，**必须**开启，否则后台任务会被限流。若不希望常驻 CPU，可改用 11.3 的 Cloud Run Job 方案。
- Cloud Run 默认服务账号需要 `Cloud Datastore User` 与 `Firebase Authentication Admin` 角色（`roles/datastore.user`、`roles/firebaseauth.admin`）。

### 11.2 前端 → Firebase Hosting

```bash
npm run build -w frontend
npx firebase deploy --only hosting --config firebase/firebase.json --project <projectId>
```

`firebase/firebase.json` 中 `/api/**` 重写到 Cloud Run 服务 `steam-analytics-api`（如区域不同请修改 `region`），并配置了 CSP、HSTS、X-Frame-Options 等安全响应头。

### 11.3 后台定时同步

两种方式任选其一：

**A. Cloud Scheduler → HTTP 端点**（简单）

```bash
gcloud scheduler jobs create http steam-sync \
  --project $PROJECT --location $REGION \
  --schedule "0 */6 * * *" \
  --uri "https://<cloud-run-url>/internal/cron/sync" \
  --http-method POST \
  --headers "X-Cron-Secret=<CRON_SECRET>" \
  --attempt-deadline 30m
```

每次调用最多同步 25 个"开启自动同步且 12 小时内未成功同步"的用户（逐个执行，复用同一把用户锁，不会与手动同步冲突）。`/internal/*` 不经过 Hosting，直接调用 Cloud Run URL。

**B. Cloud Run Job**（适合较大规模，API 服务可保持 CPU 节流）

```bash
gcloud run jobs create steam-sync-job --project $PROJECT --region $REGION \
  --image $REGION-docker.pkg.dev/$PROJECT/containers/steam-analytics-api \
  --command node --args backend/dist/scheduledSync.js,100,12 \
  --set-env-vars ...（同上） --set-secrets STEAM_API_KEY=steam-api-key:latest \
  --task-timeout 3600
gcloud scheduler jobs create http steam-sync-job-trigger ... # 通过 Cloud Run Jobs API 触发
```

### 11.4 上线检查清单

- [ ] Firestore 规则与索引（含 TTL）已部署
- [ ] Auth 已授权域名包含生产域名
- [ ] `PUBLIC_APP_URL` / `PUBLIC_API_URL` 为 https 且同源
- [ ] `STEAM_API_KEY`、`CRON_SECRET` 存于 Secret Manager
- [ ] Cloud Run 已开启 `--no-cpu-throttling`（或采用 Job 方案）
- [ ] 用真实 Steam 账号完成一次关联与同步，确认 `/link-steam?status=success`
- [ ] 日志中无 Key、Token、邮箱（logger 会自动脱敏）
