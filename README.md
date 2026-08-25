# 万象衣造 AI｜VastWearGen — 智能虚拟换装

业内最佳实践的 AI 虚拟换装网站。上传服装，选择模特和参考图，AI 自动将衣服穿在参考图风格上，并替换为模特的面部。

## 技术栈

| 层 | 方案 | 说明 |
|---|---|---|
| 前端框架 | Next.js 15 + React 19 + TypeScript | App Router，全栈一体 |
| UI | Tailwind CSS + Radix Primitives + Lucide Icons | 现代组件化 |
| 状态管理 | Zustand | 轻量，支持 localStorage 缓存 |
| 认证 | Supabase Auth | 邮箱密码注册/登录，自动创建 profile |
| 数据库 | Supabase PostgreSQL | generations / models / profiles |
| 存储 | ImgBB 图床 + 存储适配器 | 用户上传图和生成结果图；Supabase Storage 保留为可替换方向 |
| **换装 AI** | **FASHN tryon-max** | 业内画质最强的虚拟换装 API |
| **人脸替换** | **Replicate InsightFaceSwap** | 人脸精确替换，自然融合 |
| 提示组件 | sonner | Toast 通知 |

## AI Pipeline

```
用户上传
  ├─ 服装图 (1-5 张)
  ├─ 模特脸部
  └─ 参考图 (姿势/场景/风格)
         │
         ▼
  ┌─────────────────────────────┐
  │ Step 1: FASHN tryon-max    │
  │ 衣服 + 参考图身体 → 换装图   │
  │ (保留参考图的姿势和背景)      │
  └──────────────┬──────────────┘
                 │
                 ▼
  ┌─────────────────────────────┐
  │ Step 2: Replicate 人脸替换   │
  │ 换装图 + 模特脸部 → 最终成片  │
  │ (面部换成指定模特)            │
  └─────────────────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
cd ai-tryon
npm install
```

### 2. 配置环境变量

```bash
cp .env.local.example .env.local
```

填写以下内容：

```env
# Production required
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# AI providers (image / vision / text / video) are managed in the admin portal
# and stored in Supabase. Image providers use ai.control-plane.v1 exclusively;
# llm.providers / video.providers remain read-only migration inputs.
# Bootstrap them via /admin/providers, or one-time seed scripts:
#   npx tsx --env-file-if-exists=.env.local scripts/seed-provider-configs.ts
#   npx tsx --env-file-if-exists=.env.local scripts/seed-video-provider-config.ts

# Feature required: uploads and background processors
IMAGE_STORAGE_PROVIDER=aliyun-oss
JOB_PROCESSOR_SECRET=replace-with-at-least-32-random-characters
GENERATION_JOB_BATCH_SIZE=2
GENERATION_JOB_STALE_MINUTES=8

# Optional legacy providers
FASHN_API_KEY=
REPLICATE_API_TOKEN=
```

环境变量按三类处理：

- Production required: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`。生产环境必须设置 `NEXT_PUBLIC_APP_URL`，服务端生成公开图片 URL 时不会信任 forwarded host/proto 作为替代。
- Feature required: 对应功能实际被调用时必须设置，例如阿里云 OSS 环境变量用于上传，`JOB_PROCESSOR_SECRET` 或 `CRON_SECRET` 用于后台任务处理器。生图 / 视觉识别 / 文本 / 视频供应商不再依赖环境变量，统一在 `/admin/providers` 配置并加密入库。
- Optional: base URL、模型名、批处理大小、allowlist、legacy provider token 等可按部署需要覆盖。`GPT_TRYON_PROMPT_TEMPLATE=legacy` 可将服装上身的 GPT 提示词回滚到旧模板；默认 `banana`。模块导入只会提示缺失项；具体运行路径需要某个值时才会报错。

生产环境的任务处理器密钥必须使用至少 32 个随机字符，不能使用 `change-me`、`secret`、`password` 等默认或弱值。

### 3. 初始化 Supabase

在 Supabase Dashboard → SQL Editor 中依次运行：
- `supabase/schema.sql`
- `supabase/credits-update.sql`
- `supabase/set-signup-credits-50.sql`
- `supabase/atomic-credit-rpc.sql`
- 其余功能脚本按 [Supabase SQL 执行顺序](docs/supabase-migration-order.md) 继续执行

旧 Agent 与 VOZEB 运行时已永久移除。生成任务继续复用 `generations`、现有账户积分和 BullMQ 队列，并保留执行阶段检查点与重复提交防护。

当前上传和生成结果通过存储适配器保存。本地开发可使用 ImgBB；生产用户上传必须使用阿里云 OSS 客户端直传，服务端只签发短时、用户/用途/大小/MIME/Key 绑定的 PostObject policy，不向浏览器下发长期 AccessKey Secret：

```env
IMAGE_STORAGE_PROVIDER=aliyun-oss
ALIYUN_OSS_REGION=oss-cn-hongkong
ALIYUN_OSS_BUCKET=vasthk
ALIYUN_OSS_PUBLIC_BASE_URL=https://vasthk.oss-cn-hongkong.aliyuncs.com
NEXT_PUBLIC_ALIYUN_OSS_IMAGE_HOSTS=vasthk.oss-cn-hongkong.aliyuncs.com
ALIYUN_OSS_ACCESS_KEY_ID=your-ram-access-key-id
ALIYUN_OSS_ACCESS_KEY_SECRET=your-ram-access-key-secret
ALIYUN_OSS_SITE_ASSET_PREFIX=site-assets/original
ALIYUN_OSS_UPLOAD_PREFIX=user-uploads/original
ALIYUN_OSS_GENERATED_PREFIX=generated-results/original
ALIYUN_OSS_FAVORITE_PREFIX=user-favorites/original
ALIYUN_OSS_TEMP_PREFIX=temp/original
UPLOAD_DELIVERY_MODE=direct
UPLOAD_INTENT_SECRET=replace-with-independent-random-secret-at-least-32-bytes
UPLOAD_INTENT_TTL_SECONDS=300
UPLOAD_READ_URL_TTL_SECONDS=600
UPLOAD_DAILY_QUOTA_MB=2048
UPLOAD_INTENT_RATE_PER_MINUTE=120
UPLOAD_MAX_ACTIVE_INTENTS=20
REDIS_URL=rediss://private-redis-endpoint/0
```

OSS Bucket 建议使用“公共读，私有写”，RAM 用户只授予当前 bucket/prefix 的 `oss:PutObject`、`oss:GetObject`、`oss:HeadObject` 和 `oss:DeleteObject`。对象按用途分前缀保存：`site-assets/original` 永久保留网站资源，`user-uploads/original` 适合短期清理，`generated-results/original` 适合中期保留，`user-favorites/original` 永久保留收藏图，`temp/original` 可设置短生命周期。列表和小卡片通过 OSS `x-oss-process` 动态生成缩略图，不额外保存小图文件。直传 CORS、不可变内容键、完成回执、文件魔数/像素限制、Redis 配额和故障演练见 [生产用户上传数据面](docs/production-upload-data-plane.md)。

上传项目网站静态资源到 OSS：

```bash
npm run oss:upload-site-assets -- --dry-run
npm run oss:upload-site-assets -- --access-file "F:/Users/Jimmy/Documents/Downloads/1778318171758.txt"
```

脚本会把 `public/` 下的本地图片和代码里硬编码的远程图片 URL 上传到 `site-assets/original`，并生成 `.oss-site-assets-manifest.json`。默认不会改源码；确认 manifest 后可加 `--rewrite` 将已匹配的引用替换为 OSS URL。

### 4. 启动

```bash
npm run dev
```

打开 http://localhost:3000

### 5. 后台任务处理

生成接口通过 PostgreSQL 原子事务完成幂等请求、积分扣减、generation 与 Transactional Outbox；Relay 再把轻量 delivery 投递到 BullMQ。Redis 可重建，PostgreSQL 始终是业务真源。

**生产环境**：PM2 拉起常驻 Node worker（`${APP_NAME}-worker`，`npm run worker`），统一运行 BullMQ consumer、Outbox relay、OSS mirror、持久媒体验证和资产清理。Worker 生产启动强制 `NODE_ENV=production`、标准 `REDIS_URL` 与精确数据库 runtime contract。`/api/jobs/process-generations` 固定返回 410，不能绕过队列直接执行业务。

本地开发时可直接运行 worker:

```bash
npm run worker          # 单进程
npm run worker:dev      # 监听文件变更自动重启
```

Worker 通过 `BULLMQ_*`、`GENERATION_*`、`OSS_MIRROR_*`、`MEDIA_VALIDATION_*` 与 `MEDIA_CLEANUP_*` 配置。默认并发、锁时长、relay batch、retention 都由严格解析器校验；执行互斥由数据库 `delivery_version + execution_token` fence 保证。

**运维命令**:

```bash
pm2 status                                   # 查看 ${APP_NAME} 与 ${APP_NAME}-worker
pm2 logs ${APP_NAME}-worker --lines 100      # 查看 worker 日志 (心跳每 60s)
pm2 restart ${APP_NAME}-worker               # 触发热重启 (SIGTERM 优雅退出)
pm2 stop ${APP_NAME}-worker                  # 临时停止消费；Outbox/BullMQ 保留工作
pm2 start npm --name ${APP_NAME}-worker-2 -- run worker  # 启动第二个 worker 进程扩容
```

生成 worker 的自动视觉修复默认关闭；需要时可用 `GENERATION_AUTO_REGENERATE_ENABLED=true` 启用。

### 6. AWS 本地部署与手动回退

生产发布从本地 Mac 执行 `scripts/deploy-from-local.sh <tag> [worker_instances]`，并在本地构建 `.next`。GitHub Actions 的 AWS workflow 只接受 `workflow_dispatch`，用于人工回退，不会在推送 tag 时自动部署。

先在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 添加：

```env
AWS_HOST=你的 EC2 公网 IP 或域名
AWS_USER=ec2-user
AWS_SSH_PRIVATE_KEY=你的 EC2 私钥内容
AWS_SSH_KNOWN_HOSTS=固定并审核过的 EC2 host key 记录
AWS_PORT=22
AWS_APP_DIR=/home/ec2-user/apps/wanxiangzy
AWS_APP_NAME=wanxiangzy
```

在 EC2 上只需手动创建一次生产环境文件：

```bash
mkdir -p ~/apps/wanxiangzy/shared
nano ~/apps/wanxiangzy/shared/.env.production
```

之后如果想用本地 `.env.local` 快速覆盖 EC2 的生产环境文件（保证两者一致），在本机执行：

```bash
SYNC_ENV_HOST=你的EC2公网IP SYNC_ENV_KEY=~/.ssh/你的私钥.pem ./scripts/sync-production-env.sh
```

脚本会先备份远程旧文件，再原子替换并做 sha256 校验，确保最终 `.env.production` 与本地 `.env.local` 完全一致。

`.env.production` 至少需要包含 Production required 变量和部署启用功能对应的 Feature required 变量。特别注意：`NEXT_PUBLIC_APP_URL` 必须是线上公开域名，例如 `https://example.com`；后台处理器密钥必须是强随机值，不能沿用 `.env.local.example` 的占位值。

之后本地打 tag 并推送即可部署：

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 7. EdgeOne SSR 包体积检查

Tencent EdgeOne Cloud SSR Node functions 有 128 MiB 运行包限制。每次 `npm run build` 后可本地检查 `.next/server/server-reference-manifest`、`.next/standalone` 和 server chunks 的体积风险：

发布前运行完整检查；它会按顺序执行测试、提示词回归、干净生产构建和严格 SSR 包体积检查，失败时会停在首个失败步骤并给出下一步定位命令：

```bash
npm run check:release
```

```bash
npm run check:ssr-size
```

默认阈值为 128 MiB，超过 90% 会标记风险；风险输出会列出最大的 `.next/server` 文件、目录和可识别的 vendor chunk / route / trace 信息。单文件超过 8 MiB 会单独列出。可用环境变量调整：

```bash
SSR_SIZE_WARN_MIB=100 SSR_SIZE_LARGE_FILE_MIB=6 npm run check:ssr-size
```

如需在 CI 中让风险直接失败：

```bash
SSR_SIZE_FAIL_ON_RISK=1 npm run check:ssr-size
```

### 8. 添加预设模特和参考图

将模特头像放入 `public/models/`，参考图放入 `public/references/`：
- `public/models/female-1.jpg` ~ `female-3.jpg`
- `public/models/male-1.jpg` ~ `male-2.jpg`
- `public/references/pose-1.jpg`, `pose-2.jpg`
- `public/references/scene-1.jpg`, `scene-2.jpg`
- `public/references/style-1.jpg`, `style-2.jpg`

## 项目结构

```
ai-tryon/
├── app/
│   ├── api/tryon/route.ts    ← 核心 AI Pipeline API
│   ├── create/page.tsx        ← 换装工作流 (4 步)
│   ├── history/page.tsx       ← 历史记录
│   ├── login/page.tsx         ← 登录注册
│   └── layout.tsx             ← 全局布局
├── lib/
│   ├── api/
│   │   ├── fashn.ts           ← FASHN API 封装
│   │   └── face-swap.ts       ← Replicate 人脸替换封装
│   ├── store/tryon-store.ts   ← Zustand 状态管理
│   ├── supabase/              ← Supabase 客户端
│   └── utils.ts               ← 工具函数
├── types/index.ts             ← TypeScript 类型
├── supabase/schema.sql        ← 数据库初始化 SQL
└── middleware.ts               ← Auth 路由保护
```

## 成本估算

| API | 单价 | 每次生成 (1 件衣服) |
|---|---|---|
| FASHN tryon-max | ~4 credits/次 | ~$0.04 |
| Replicate face swap | ~$0.005/次 | ~$0.005 |
| **合计** | | **~$0.045** |

生成 5 件衣服的一次完整流程约 $0.05。

## 后续扩展方向

- 支付系统 (Stripe / 微信支付) 购买 credits
- OAuth 登录 (Google / GitHub / 微信)
- 批量队列和异步通知
- 用户自定义上传模特/参考图
- 视频换装 (FASHN Video Try-On)
- 社交分享功能

## 生产运维文档

- [生产可用性审计](docs/production-readiness-audit-2026-06-16.md)
- [生产可用性整改说明](docs/production-readiness-remediation-notes-2026-06-16.md)
- [AWS EC2 发布检查表](docs/release-checklist.md)
- [备份与恢复 Runbook](docs/backup-restore.md)
- [后台管理员引导](docs/admin-bootstrap.md)
- [Supabase SQL 执行顺序](docs/supabase-migration-order.md)

## 运行时要求与 EC2 升级说明

### 当前要求

- **Node.js 22 LTS**（`>= 22, < 23`），由 `.nvmrc` 与 `package.json` 的 `engines.node` 锁死
- Node 22 内置原生 `WebSocket`，Supabase Realtime 和 Next.js 都不再需要 `ws` polyfill
- Node 20 LTS 已于 **2026-04-30** 终止支持，CI 已升级到 Node 22，EC2 必须跟进

### ⚠️ 升级 EC2 时的 pm2 systemd 单元陷阱

`pm2 startup` 第一次生成 systemd unit 时，会把**当时激活的 Node 版本路径硬编码**到 unit 的 `Environment=PATH=...` 和 `ExecStart=...` 里。所以即便你在 EC2 上 `nvm install 22 && nvm alias default 22 && node --version` 都正常，只要：

```bash
sudo systemctl cat pm2-ec2-user | grep -E "ExecStart|Environment|PATH"
```

里面仍然写着 `v20.20.2`，那么 `pm2 kill` 之后 systemd 用旧 unit 重启 pm2 daemon，**worker 就会继续在 Node 20 上 crash loop 并报**：

```
[worker] fatal error=Node.js 20 detected without native WebSocket support.
```

nvm 的 `use` / `alias default` 只影响 shell 自己的 PATH，**改不了 systemd unit**——这就是升级脚本第一版没考虑到 systemd 时踩到的坑。

### 仓库自带的一键升级 / 回滚脚本

`scripts/upgrade-node.sh`（配套 `scripts/rollback-node.sh`）已经把上面这套都做了，包括：

1. 安装 / 激活 Node 22
2. `rm -rf node_modules && npm ci`（让 sharp 等 native 模块重新编译到 Node 22 ABI）
3. sharp load test（失败会 abort）
4. 检测 `/etc/systemd/system/pm2-*.service`，把里面的 `/node/vX.Y.Z` sed 替换成当前 Node 22 安装路径 + `systemctl daemon-reload`
5. `sudo systemctl restart pm2-*` + `pm2 resurrect` 让 worker 用新 Node 起来
6. 30 秒内探测 worker 是否 `loop.started`，失败时打印 `pm2 logs` 调试指引

升级用法（脚本是幂等的，跑两遍不会出事）：

```bash
ssh ec2-user@<host>
cd ~/apps/wanxiangzy/current
bash scripts/upgrade-node.sh
```

回滚用法：

```bash
bash scripts/rollback-node.sh   # Node 22 → Node 20，对称处理 systemd unit
```

> 注意：回滚到 Node 20 后，**当前部署的代码因为已经移除 `ws` polyfill 是不能跑的**，worker 会立刻报 `Node.js 20 detected without native WebSocket support`。回滚脚本最后一段会提示你需要同时回滚代码 tag：`git checkout <previous-working-tag> && bash scripts/deploy-aws-release.sh`。

### 验证升级到位

```bash
node --version                                     # 期待 v22.x.x
pm2 status                                         # 期待 restart count 不再上涨
pm2 logs wanxiangzy-worker --lines 30 --nostream --raw
# 期待：loop.started + heartbeat（rssMB / heapUsedMB）
# 不能出现：Node.js 20 detected without native WebSocket support
sudo systemctl cat pm2-ec2-user | grep -E "ExecStart|Environment|PATH"
# 期待：所有路径指向 v22，没有 v20
```

### BullMQ / Outbox 调度

生成 Worker 不再轮询 `claim_next_generation_jobs`。PostgreSQL Outbox relay 使用有界、租户公平的 `SKIP LOCKED` claim，把 delivery 发布到 BullMQ；Worker 通过 `delivery_version + execution_token` 认领业务执行。Redis 故障时任务留在 Outbox，恢复后重投；Worker 崩溃由 Bull stalled recovery 与数据库 execution lease 共同恢复。

主要参数见 `.env.local.example`：`BULLMQ_WORKER_CONCURRENCY`、`GENERATION_IMAGE_BATCH_CONCURRENCY`、`BULLMQ_RELAY_BATCH_SIZE`、`BULLMQ_RELAY_CONCURRENCY`、`GENERATION_MAX_ACTIVE_PER_USER`。完整架构、压测与故障恢复手册见 `docs/production-generation-queue.md`。
