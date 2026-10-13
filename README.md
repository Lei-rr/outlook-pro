# Outlook Pro

基于 Node.js 的 Outlook / Hotmail 邮箱管理服务。多账号 Token 保活、邮件读取、Telegram 推送、对外 API，Docker 一键部署。

## 特性

- **Token 自动续期**：按寿命窗口滚动刷新 + 并发 + 限速 + 失败退避，账号量大也能在过期前完成一轮
- **批量管理**：服务端分页 / 排序 / 筛选，导入（可选覆盖已存在账号）/ 导出 / 删除 / 移组 / 标签（多对多）
- **可观测**：仪表盘显示刷新节奏、上次与下次运行时间、待刷新数量、近 30 天成败；单个账号可查最近 20 次刷新记录
- **邮件读取**：Graph API 实时读取，收件箱 / 垃圾箱 / 已删除 / 聚合视图、搜索、分页、附件下载
- **Telegram 推送**：轮询新邮件并实时推送
- **对外 API**：API Key 免登录拉取邮件，适合脚本自动取验证码
- **安全**：scrypt 密码哈希、AES-256-GCM 敏感字段加密、HMAC 会话签名
- **部署**：Docker + GitHub Action 自动构建推送镜像

## 技术栈

Node 20+ · Hono · better-sqlite3 (SQLite) · 原生 HTML/CSS/JS 前端

## 快速开始

```bash
npm install
npm run dev               # http://localhost:3000（默认密码 admin）
```

生产构建：

```bash
npm run build
node dist/server.js
```

## Docker

```bash
docker compose up -d      # 无需任何配置，默认密码 admin
```

数据持久化在 `./data`（容器内 `/data`）。

## 配置

**开箱即用，无需任何配置。**

- 首次启动自动生成 `cookieSecret` 与 `encryptionKey`，写入 `<DATA_DIR>/secret.json`（权限 600）。**备份数据目录时一并备份它**，否则已加密的 token 无法解密。
- 初始密码 `admin`，登录后在「系统设置」修改；密码哈希存在数据库，之后与配置无关。

下列环境变量**全部可选**，仅用于覆盖默认值：

### 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 监听端口 | `3000` |
| `DATA_DIR` | SQLite 数据目录 | `./data` |
| `PUBLIC_BASE_URL` | 对外访问地址，反代/OAuth 重定向用 | 空（按请求推导） |
| `ADMIN_PASSWORD` | 初始管理员密码 | `admin` |
| `COOKIE_SECRET` | 会话签名密钥 | 自动生成 |
| `ENCRYPTION_KEY` | 字段加密密钥 | 自动生成 |
| `TOKEN_REFRESH_ENABLED` | 定时刷新开关 | `0` |
| `TOKEN_REFRESH_INTERVAL_HOURS` | 刷新任务最小间隔 | `6` |
| `TOKEN_REFRESH_WINDOW_DAYS` | 超过该天数未刷新的账号才会被刷（上限 `30`） | `25` |
| `TOKEN_REFRESH_PER_RUN` | 单次最多刷新账号数 | `200` |
| `TOKEN_REFRESH_CONCURRENCY` | 刷新并发数 | `10` |
| `TOKEN_REFRESH_RATE_PER_SEC` | 刷新全局限速（req/s） | `10` |
| `PUSH_INTERVAL_MINUTES` | 邮件推送轮询间隔 | `1` |

## 定时刷新模型

微软 refresh_token 是滑动过期（约 90 天，每次使用续期），但**长期不用的号仍会失效**，所以窗口必须明显小于有效期：

- 只刷新「距上次刷新超过 `TOKEN_REFRESH_WINDOW_DAYS` 天」的账号，其余跳过
- 窗口默认 `25` 天，硬上限 `30` 天（约 90 天有效期的 1/3）；超过上限会被自动收敛到 30
- 窗口是「多久没刷才算该刷」的下限，**实际周期由吞吐决定**：每批 `TOKEN_REFRESH_PER_RUN` 个 × 每 `TOKEN_REFRESH_INTERVAL_HOURS` 小时。
  窗口 ≤ 吞吐周期时队列始终饱和；窗口大于周期不会刷得更快，只会让队列空转。
  例：8000 个账号、每批 200、间隔 6 小时 → 一轮约 10 天，此时窗口设 10 天左右最贴合
- 账号变多后该调的是每批数量而不是窗口：`每批 ≥ 账号数 × 间隔小时 ÷ (窗口天 × 24)`
- 刷新失败的账号进入指数退避（6h / 12h / 24h / 48h / 96h，封顶 7 天），
  否则死号会一直占据队首、把健康账号挤出一轮的名额；失败原因与历史见账号列表
- 并发 + 全局限速 + 429 指数退避，避免触发微软风控

设置页也可在运行时调整开关、间隔、批量、窗口与并发，无需重启。

## 对外 API

在「系统设置」生成 API Key 后：

```bash
curl -H "X-API-Key: <key>" \
  "http://localhost:3000/api/external/emails?email=user@outlook.com&folder=all&top=10"
```

参数：`email`（必填）、`folder`（`inbox` / `junkemail` / `deleteditems` / `all`）、`top`、`keyword`、`includeBody=1`。

## 测试

```bash
npm run typecheck        # tsc --noEmit
npm test                 # vitest
node tools/i18n-check.mjs  # 中英词条覆盖检查
```

发布 Release 时 CI 会先跑这三项，任一失败都不会构建镜像。

## 许可证

GPL-3.0
