# Outlook Pro

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/Lei-rr/outlook-pro)](https://github.com/Lei-rr/outlook-pro/releases)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/GHCR-outlook--pro-2496ED?logo=docker&logoColor=white)](https://github.com/Lei-rr/outlook-pro/pkgs/container/outlook-pro)

基于 Node.js 的 Outlook / Hotmail 邮箱管理服务：多账号 Token 保活、邮件读取、Telegram 推送、对外 API，单个 Docker 容器即可运行。

> 移植自 [roseforyou/cf-outlook-email](https://github.com/roseforyou/cf-outlook-email)（Cloudflare Workers + D1 版本），
> 改写成 Node.js + SQLite 单容器部署，摆脱 Workers 的子请求数量与执行时长限制，账号规模可以更大。

## 特性

- **Token 自动续期** — 按寿命窗口滚动刷新 + 并发 + 全局限速 + 失败退避，账号量大也能在过期前完成一轮
- **批量管理** — 服务端分页 / 排序 / 筛选，导入（可选覆盖已存在账号）/ 导出 / 删除 / 移组 / 标签（多对多）
- **可观测** — 仪表盘显示刷新节奏、上次与下次运行时间、待刷新数量、近 30 天成败；单个账号可查最近 20 次刷新记录
- **邮件读取** — Graph API 实时读取，收件箱 / 垃圾箱 / 已删除 / 聚合视图、搜索、分页、附件下载
- **Telegram 推送** — 轮询新邮件并推送，带水位线去重
- **对外 API** — API Key 免登录拉取邮件，适合脚本自动取验证码
- **安全** — scrypt 密码哈希、AES-256-GCM 敏感字段加密、HMAC 会话签名、登录失败限速
- **轻部署** — 单容器 + SQLite，无外部依赖、无构建步骤；GitHub Release 自动构建多架构镜像

## 快速开始

### Docker Compose（推荐）

新建一个目录，写入 `docker-compose.yml`：

```yaml
services:
  outlook-pro:
    image: ghcr.io/lei-rr/outlook-pro:latest
    pull_policy: always
    container_name: outlook-pro
    restart: unless-stopped
    ports:
      - "3020:3000"
    volumes:
      - ./data:/data
```

```bash
docker compose up -d
```

### Docker

```bash
docker run -d \
  --name outlook-pro \
  --restart unless-stopped \
  -p 3020:3000 \
  -v "$(pwd)/data:/data" \
  ghcr.io/lei-rr/outlook-pro:latest
```

两种方式等价，镜像支持 `linux/amd64` 与 `linux/arm64`。

启动后访问 `http://localhost:3020`，默认密码 `admin` —— **登录后请立即在「系统设置」修改**。

### 更新

```bash
docker compose pull && docker compose up -d
```

数据全部在挂载的 `./data` 目录里，升级不会丢失。

### 从源码运行

```bash
git clone https://github.com/Lei-rr/outlook-pro.git
cd outlook-pro
npm install
npm run dev            # http://localhost:3000
```

生产构建：

```bash
npm run build
node dist/server.js
```

## 配置

**开箱即用，无需任何配置。** 下列环境变量全部可选，仅用于覆盖默认值。

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 监听端口 | `3000` |
| `DATA_DIR` | SQLite 数据目录 | `./data` |
| `PUBLIC_BASE_URL` | 对外访问地址，反向代理 / OAuth 重定向使用 | 空（按请求推导） |
| `ADMIN_PASSWORD` | 初始管理员密码，仅用于首次登录 | `admin` |
| `COOKIE_SECRET` | 会话签名密钥 | 自动生成 |
| `ENCRYPTION_KEY` | 字段加密密钥 | 自动生成 |
| `TOKEN_REFRESH_ENABLED` | 定时刷新开关 | `0` |
| `TOKEN_REFRESH_INTERVAL_HOURS` | 刷新任务最小间隔 | `6` |
| `TOKEN_REFRESH_WINDOW_DAYS` | 超过该天数未刷新的账号才会被刷（上限 `30`） | `25` |
| `TOKEN_REFRESH_PER_RUN` | 单次最多刷新账号数 | `200` |
| `TOKEN_REFRESH_CONCURRENCY` | 刷新并发数 | `10` |
| `TOKEN_REFRESH_RATE_PER_SEC` | 刷新全局限速（req/s） | `10` |
| `PUSH_INTERVAL_MINUTES` | 邮件推送轮询间隔（分钟） | `1` |

完整示例见 [`.env.example`](./.env.example)。定时刷新的开关、间隔、批量、窗口与并发也可以在「系统设置」里运行时调整，无需重启。

### 数据与备份

- 首次启动会在 `<DATA_DIR>/secret.json`（权限 `600`）生成 `cookieSecret` 与 `encryptionKey`
- **备份数据目录时务必一并备份 `secret.json`**，否则已加密的 refresh_token 无法解密
- 数据库使用 SQLite WAL 模式，结构变更通过 `PRAGMA user_version` 版本化迁移在启动时自动执行

## 定时刷新模型

微软 refresh_token 是滑动过期（约 90 天，每次使用续期），但**长期不用的号仍会失效**，所以窗口必须明显小于有效期：

- 只刷新「距上次刷新超过 `TOKEN_REFRESH_WINDOW_DAYS` 天」的账号，其余跳过
- 窗口默认 `25` 天，硬上限 `30` 天（约 90 天有效期的 1/3）；超过上限会被自动收敛到 30
- 窗口是「多久没刷才算该刷」的下限，**实际周期由吞吐决定**：每批 `TOKEN_REFRESH_PER_RUN` 个 × 每 `TOKEN_REFRESH_INTERVAL_HOURS` 小时。
  窗口 ≤ 吞吐周期时队列始终饱和；窗口大于周期不会刷得更快，只会让队列空转。
  例：8000 个账号、每批 200、间隔 6 小时 → 一轮约 10 天，此时窗口设 10 天左右最贴合
- 账号变多后该调的是每批数量而不是窗口：`每批 ≥ 账号数 × 间隔小时 ÷ (窗口天 × 24)`
- 刷新失败的账号进入指数退避（6h / 12h / 24h / 48h / 96h，封顶 7 天），
  否则死号会一直占据队首，把健康账号挤出一轮的名额；失败原因与历史见账号列表
- 并发 + 全局限速 + 429 指数退避，避免触发微软风控

## 对外 API

在「系统设置」生成 API Key 后即可免登录调用：

```bash
curl -H "X-API-Key: <key>" \
  "http://localhost:3000/api/external/emails?email=user@outlook.com&folder=all&top=10"
```

| 参数 | 说明 |
|---|---|
| `email` | 必填，账号邮箱 |
| `folder` | `inbox` / `junkemail` / `deleteditems` / `all` |
| `top` | 返回条数 |
| `keyword` | 主题 / 正文关键字过滤 |
| `includeBody` | `1` 时返回正文 |

## 开发

### 技术栈

Node 20+ · [Hono](https://hono.dev/) · better-sqlite3 (SQLite) · 原生 HTML/CSS/JS（无构建步骤）

运行时依赖只有三个：`hono`、`@hono/node-server`、`better-sqlite3`。

### 目录结构

```
src/
  routes/      HTTP 路由：账号、邮件、分组、标签、设置、OAuth、对外 API
  services/    Graph API、OAuth、Telegram、access token 缓存
  db/          SQLite 连接、版本化迁移、各表仓储
  jobs/        定时刷新与推送调度
  core/        加密、会话、HTTP 助手、并发工具
public/        前端单页（原生 HTML/CSS/JS，无构建步骤）
test/          vitest：单元 + API 集成
tools/         i18n 词条覆盖检查
```

### 测试

```bash
npm run typecheck          # tsc --noEmit
npm test                   # vitest
node tools/i18n-check.mjs  # 中英词条覆盖检查
```

发布 Release 时 CI 会先跑这三项，任一失败都不会构建镜像。镜像通过 `.github/workflows/docker.yml` 在 Release 发布时自动构建并推送到 GHCR。

## 来源与致谢

- 上游项目：[**roseforyou/cf-outlook-email**](https://github.com/roseforyou/cf-outlook-email) —— Cloudflare Workers + D1 实现，本项目的界面与业务流程源自它
- 本项目：[**Lei-rr/outlook-pro**](https://github.com/Lei-rr/outlook-pro) —— Node.js + SQLite 重写，数据库、调度、加密与部署方式均为独立实现
- 容器镜像：[`ghcr.io/lei-rr/outlook-pro`](https://github.com/Lei-rr/outlook-pro/pkgs/container/outlook-pro)

## 许可证

[GPL-3.0-or-later](./LICENSE)
