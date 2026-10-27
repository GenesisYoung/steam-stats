# Steam Analytics Dashboard

一个可用于生产的全栈 Steam 游戏统计平台：用户注册独立账号，通过 **Steam 官方 OpenID** 安全关联 Steam，分析游戏时长、成就、游戏库估值与每小时成本。

- 前端：Vue 3（Composition API）+ TypeScript + Vite + Pinia + Vue Router + Tailwind CSS v4 + Apache ECharts + Vue I18n（English / 简体中文）
- 后端：Node.js + Express 5 + TypeScript + Zod + Firebase Admin SDK
- 数据：Cloud Firestore（安全规则 + 索引 + TTL）、Firebase Authentication
- 集成：Steam Web API（官方文档接口）、Steam OpenID 2.0、Steam 商店公开价格数据

## 文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 可行性评估、字段可得性分类、架构图、OpenID 时序图、Firestore 数据模型、API 设计、开发计划 |
| [docs/api.md](docs/api.md) | 完整 API 文档（参数、响应、错误码、限流） |
| [docs/deployment.md](docs/deployment.md) | Firebase / Steam Key / 环境变量 / 本地运行 / 测试 / 构建 / Cloud Run + Hosting 部署 / 定时同步 |

## 目录结构

```
shared/     共享 TypeScript 模型、API 契约、Zod schema、统计计算纯函数（含单测）
backend/    Express API：config / routes / controllers / services / repositories / middleware / jobs
frontend/   Vue SPA：views / components / composables / stores / services / router / locales
firebase/   firebase.json（Hosting 重写、安全头、模拟器）、firestore.rules、firestore.indexes.json
docs/       中文文档
```

## 快速开始（本地模拟器）

```bash
npm install
cp backend/.env.example backend/.env      # 设置 STEAM_API_KEY 与模拟器变量，见 docs/deployment.md §8
cp frontend/.env.example frontend/.env
npm run emulators                         # 终端 1
npm run dev:backend                       # 终端 2
npm run dev:frontend                      # 终端 3 → http://localhost:5173
```

## 测试

```bash
npm test               # 单元 + 组件 + i18n（无需模拟器）
npm run test:emulated  # 集成测试 + Firestore 规则测试（自动启动模拟器）
npm run typecheck
```

## 关键设计与数据诚信原则

- **绝不收集 Steam 密码**；关联只走 Steam OpenID，并通过：绑定浏览器的 HttpOnly Cookie（防链接劫持 / CSRF）、`return_to` 精确匹配、`check_authentication` 签名校验、nonce 时效 + 单次使用（防重放）、Firestore 事务保证一个 SteamID 只关联一个账户。
- **不可用 ≠ 0**：私密资料、未获取的价格、无成就的游戏都以明确的"不可用 / 未同步"状态呈现；估值中未知价格单独计数，不按 0 计入。
- **不混合货币**：所有金额按货币分组展示，项目不引入未声明来源的汇率。
- **不捏造历史**：Steam 只提供累计时长，趋势图仅基于开始追踪后的每日快照差值。
- **缓存透明**：所有缓存数据都带"最后更新时间"，在线状态最多缓存 60 秒。
- **可信数据只由后端写入**：Firestore 规则禁止客户端写入 Steam 同步结果，用户只能修改自己的偏好与自填购买记录。

## 已知限制

- Steam 商店价格来自 `store.steampowered.com/api/appdetails`，这是商店使用的公开接口而非 Steamworks 正式文档接口，可能变更；系统对其做了严格校验、限流与缓存，并在界面上标注为"估算"。
- `has_community_visible_stats` 不为 true 的游戏视为无成就（Steam 对其不返回玩家成就）。
- 大型游戏库的成就与商店元数据按批次同步（默认每次 200 / 150 款），剩余部分在后续同步中继续，任务状态显示为"部分同步"。
- 历史购买价格无法从官方 API 获取，只能由用户手动录入且明确标注"未经验证"。
