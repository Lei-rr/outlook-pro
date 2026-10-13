# Outlook Pro

基于 Node.js 的 Outlook / Hotmail 邮箱管理服务。多账号 Token 保活、邮件读取、Telegram 推送、对外 API，Docker 一键部署。

## 特性

- **Token 自动续期**：按寿命窗口滚动刷新 + 并发 + 限速，摆脱 Cloudflare 子请求限制，账号量大也能在过期前刷完
- **批量管理**：导入 / 导出 / 删除 / 移组 / 标签（多对多）
- **邮件读取**：Graph API 实时读取，收件箱 / 垃圾箱 / 已删除 / 聚合视图、搜索、分页、附件下载
- **Telegram 推送**：轮询新邮件并实时推送
- **临时邮箱**：集成 GPTMail
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
| `TOKEN_REFRESH_WINDOW_DAYS` | 超过该天数未刷新的账号才会被刷 | `60` |
| `TOKEN_REFRESH_PER_RUN` | 单次最多刷新账号数 | `200` |
| `TOKEN_REFRESH_CONCURRENCY` | 刷新并发数 | `10` |
| `TOKEN_REFRESH_RATE_PER_SEC` | 刷新全局限速（req/s） | `10` |
| `PUSH_INTERVAL_MINUTES` | 邮件推送轮询间隔 | `1` |
| `GPTMAIL_API_KEY` | 临时邮箱 API Key（可选） | 空 |

## 定时刷新模型

微软 refresh_token 是滑动过期（约 90 天，每次使用续期）。因此不需要高频全量刷新：

- 只刷新「距上次刷新超过 `TOKEN_REFRESH_WINDOW_DAYS` 天」的账号，其余跳过
- 每天实际需要刷新的账号 ≈ 总数 ÷ 窗口天数（5000 个账号、60 天窗口 ≈ 每天 83 个）
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
npm test
```

## 许可证

GPL-3.0
