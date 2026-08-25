# AWS EC2 发布检查表

本项目生产部署从本地 Mac 执行 `scripts/deploy-from-local.sh <tag> [worker_instances]`，目标是 AWS EC2，`.next` 必须在本地构建。`.github/workflows/deploy-aws-on-tag.yml` 只用于 `workflow_dispatch` 人工回退，不会因推送 tag 自动部署。

## 发布前

1. 确认本地改动范围只包含本次发布内容：

   ```bash
   git status --short
   git diff --stat
   ```

2. 在本地运行完整发布门禁：

   ```bash
   npm run check:release
   ```

   该命令会依次执行测试、提示词回归、lint、TypeScript、生产构建和 SSR 包体积检查。任何一步失败都先修复后再打 tag。

3. 确认 Supabase SQL 已按顺序应用。完整顺序见 `docs/supabase-migration-order.md`。基础生产环境至少需要：

   ```text
   supabase/schema.sql
   supabase/credits-update.sql
   supabase/set-signup-credits-50.sql
   supabase/atomic-credit-rpc.sql
   supabase/task-queue-items.sql
   supabase/admin-console.sql
   supabase/migrations/20260818072132_bullmq_generation_outbox.sql
   supabase/migrations/20260818083000_oss_mirror_transfers.sql
   supabase/migrations/20260818090000_oss_mirror_queue_health.sql
   supabase/migrations/20260818093405_commercial_media_asset_registry.sql
   supabase/migrations/20260818103000_ai_control_plane_runtime.sql
   supabase/migrations/20260818110000_worker_runtime_control.sql
   supabase/migrations/20260819101500_admin_dashboard_period_aggregate.sql
   supabase/migrations/20260819112000_admin_billing_summary.sql
   supabase/migrations/20260821123000_generation_capacity_backpressure.sql
   supabase/migrations/20260822100000_generation_service_entitlements.sql
   supabase/migrations/20260822190000_generation_parent_state_consistency.sql
   supabase/migrations/20260824153558_vozeb_creative_runtime_foundation.sql
   supabase/migrations/20260824193939_complete_agent_skill_runtime.sql
   supabase/migrations/20260824203735_creative_runtime_fk_indexes.sql
   supabase/migrations/20260825030000_creative_user_skills.sql
   supabase/migrations/20260825043413_fix_agent_conversation_runtime.sql
   supabase/migrations/20260825054554_repair_minimax_openai_base_url.sql
   supabase/migrations/20260825061720_complete_vozeb_agent_message_runtime.sql
   supabase/migrations/20260825065043_remove_vozeb_runtime_keep_generation_fence.sql
   ```

   前四个时间戳迁移会清理旧 generation 队列数据；后续历史迁移曾引入 VOZEB，最终 cleanup 迁移会永久删除其数据和数据库对象，仅保留通用生成执行栅栏。必须先备份并严格按文件名顺序执行。部署会精确校验 runtime contract 和所需 RPC，缺少任一项都不能切流。

4. 检查生产环境变量。EC2 上的文件位于 `AWS_APP_DIR`（未配置时默认 `~/apps/wanxiangzy`）下：

   ```bash
   $AWS_APP_DIR/shared/.env.production
   ```

   必需项包括 `NEXT_PUBLIC_APP_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、阿里云 OSS 凭据和自托管/云托管标准 Redis 的 `REDIS_URL`。生图 / 视觉识别 / 文本 / 视频供应商在 `/admin/providers` 配置并加密入库，不写入 `.env.production`。商品精修无开关，发布后直接可用。

5. 确认后台处理器密钥是强随机值，长度不少于 32 个字符。不要使用 `change-me`、`secret`、`password` 或示例值。

6. 确认上传和远程下载域名策略符合本次发布目标：

   ```env
   IMAGE_STORAGE_PROVIDER=aliyun-oss
   NEXT_PUBLIC_ALIYUN_OSS_IMAGE_HOSTS=...
   DOWNLOAD_IMAGE_ALLOWED_HOSTS=...
   REMOTE_IMAGE_ALLOWED_HOSTS=...
   ```

7. 做一次人工冒烟测试。至少覆盖：

   ```text
   /create
   /product-retouch
   /history
   /pricing
   /admin
   管理端 BullMQ / Outbox / OSS mirror / media validation 健康卡片
   ```

## GitHub Secrets

GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 至少需要：

```env
AWS_HOST=
AWS_USER=ec2-user
AWS_SSH_PRIVATE_KEY=
AWS_SSH_KNOWN_HOSTS=EC2固定主机公钥记录
AWS_PORT=22
AWS_APP_DIR=/home/ec2-user/apps/wanxiangzy
AWS_APP_NAME=wanxiangzy
PRODUCT_RETOUCH_RUNTIME_SKILL_ENABLED=true
```

生图 / 视觉识别 / 文本 / 视频供应商统一在后台 `/admin/providers` 配置并加密存储到 Supabase，不再通过环境变量兜底。EC2 的 `.env.production` 以本地 `.env.local` 为准，可用 `scripts/sync-production-env.sh` 快速覆盖并校验一致。

## 发布

1. 从准备发布的 commit 创建 tag：

   ```bash
   git tag v1.0.0
   ```

2. 推送 tag，并从本地 Mac 执行部署：

   ```bash
   git push origin v1.0.0
   scripts/deploy-from-local.sh v1.0.0
   ```

3. 观察本地部署输出。GitHub Actions 的 `Deploy AWS on tag` 仅在需要人工回退时手动触发。正常流程应该依次通过：

   ```text
   Run release checks
   Create deployment archive
   Upload deployment archive
   Update production rollout flags
   Deploy on EC2
   ```

4. 部署成功后，EC2 上的当前版本链接应指向本次 tag release：

   ```bash
   readlink -f ~/apps/wanxiangzy/current
   pm2 status
   ```

## 发布后验证

1. 打开线上域名，确认首页和 `/create` 可访问。
2. 登录普通用户，发起一次低风险生成或测试任务。
3. 登录后台，确认用户、任务、资产、账单、运营配置页面可加载。
4. 确认 PM2 同时拉起了 Next.js Web cluster 与 Admin 期望数量的 Worker（默认 Web 至少 2 个实例、Worker 至少 1 个）：

   ```bash
   pm2 status
   # Worker 数量必须与 /admin/workers 的期望实例一致
   ```

5. 查看 worker 主管进程日志（新实例必须出现 `"event":"supervisor.ready"`）：

   ```bash
   pm2 logs wanxiangzy-worker --lines 60 --nostream
   ```

6. `/api/jobs/process-generations` 已固定返回 410，禁止绕过 BullMQ 直接执行业务。需要恢复时使用后台 Outbox recovery/redrive 控制面。

7. 查看 PM2 日志，确认没有启动循环或持续 5xx：

   ```bash
   pm2 logs wanxiangzy --lines 120 --nostream
   ```

## 回滚

部署使用受版本控制的 `ecosystem.production.cjs` 和 `pm2 startOrReload`：Web cluster 等每个新实例发出 readiness 后才逐个替换，Worker 在交接时保留 30 秒应用 drain、PM2 预留 45 秒。进程契约或 HTTP 健康检查失败时，脚本会把 `current` 重新指向上一版，并恢复旧 ecosystem；首次切换自旧版 PM2 配置时则使用发布前生成的权限为 `0600` 的临时进程快照，成功或失败后都会删除快照。

自动回滚还必须通过 `runtime-contract.json` 精确兼容门禁。上一版只有在数据库契约版本和哈希与当前发布完全一致时才会被重新启动；clean-slate 迁移后的首次发布或任何跨契约发布失败时，脚本会拒绝启动旧代码并停止 Web/Worker，保持不可写的 fail-closed 维护状态，要求向前修复，或将数据库与应用一起从备份恢复。

如果发布已经成功但后续需要人工回滚，优先重新部署上一个稳定 tag：

```bash
git push origin v0.9.9
```

如果必须在 EC2 上快速切回上一版，先列出保留的 release，再手动切换 `current`：

```bash
ls -lt ~/apps/wanxiangzy/releases
ln -sfn ~/apps/wanxiangzy/releases/v0.9.9 ~/apps/wanxiangzy/current
cd ~/apps/wanxiangzy/current
NODE_BIN="$(command -v node)"
PM2_APP_NAME=wanxiangzy \
PM2_RELEASE_DIR="$PWD" \
PM2_NODE_BIN="$NODE_BIN" \
NODE_ENV=production \
pm2 startOrReload ecosystem.production.cjs --update-env
curl -fsS http://127.0.0.1:3000/ >/dev/null
pm2 save
```

回滚后仍需执行发布后验证，尤其是数据库迁移已经应用但代码回退的场景。
