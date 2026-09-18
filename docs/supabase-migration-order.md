# Supabase SQL 执行顺序

仓库同时包含基础初始化 SQL 和 `supabase/migrations/` 时间戳迁移。基础脚本只用于新环境建库；商用队列与 OSS 数据面必须由时间戳迁移按文件名顺序执行。执行失败时立即停止，不得跳过后续文件。

## 商用队列 / OSS clean-slate 迁移（强制顺序）

前四个迁移是破坏性的，不兼容旧 generation 队列数据。必须在停写维护窗口内、完成数据库备份后严格顺序应用；后续迁移是非破坏性的统一模型、Worker 控制面、后台经营指标聚合和生成容量退避，应紧随其后应用：

```text
1. supabase/migrations/20260818072132_bullmq_generation_outbox.sql
2. supabase/migrations/20260818083000_oss_mirror_transfers.sql
3. supabase/migrations/20260818090000_oss_mirror_queue_health.sql
4. supabase/migrations/20260818093405_commercial_media_asset_registry.sql
5. supabase/migrations/20260818103000_ai_control_plane_runtime.sql
6. supabase/migrations/20260818110000_worker_runtime_control.sql
7. supabase/migrations/20260819101500_admin_dashboard_period_aggregate.sql
8. supabase/migrations/20260819112000_admin_billing_summary.sql
9. supabase/migrations/20260821123000_generation_capacity_backpressure.sql
10. supabase/migrations/20260822100000_generation_service_entitlements.sql
11. supabase/migrations/20260822190000_generation_parent_state_consistency.sql
```

Worker runtime 迁移提供 `get_runtime_contract_version()`；发布脚本会精确校验 version/hash，并同时检查后台经营指标 RPC，而不只检查同名 RPC。迁移完成前不得启动新 API/Worker，完成后不得回滚到旧轮询代码；故障恢复采用数据库备份或向前修复。

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260818072132_bullmq_generation_outbox.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260818083000_oss_mirror_transfers.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260818090000_oss_mirror_queue_health.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260818093405_commercial_media_asset_registry.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260818103000_ai_control_plane_runtime.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260818110000_worker_runtime_control.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260819101500_admin_dashboard_period_aggregate.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260819112000_admin_billing_summary.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260821123000_generation_capacity_backpressure.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260822100000_generation_service_entitlements.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260822190000_generation_parent_state_consistency.sql
```

## 推荐基础顺序

```text
1. supabase/schema.sql
2. supabase/credits-update.sql
3. supabase/set-signup-credits-50.sql
4. supabase/atomic-credit-rpc.sql
5. supabase/rls-and-ratelimit-update.sql
6. supabase/fix-rate-limit-rls.sql
7. supabase/task-queue-items.sql
8. supabase/task-queue-performance-indexes.sql
9. supabase/admin-console.sql
10. supabase/stripe-billing.sql
11. supabase/invite-codes.sql
12. supabase/tryon-reference-config.sql
13. supabase/tryon-reference-favorites.sql
14. supabase/tryon-reference-templates.sql
15. supabase/product-set-favorite-plans.sql
16. supabase/product-retouch.sql
17. 上述四个 clean-slate 时间戳迁移（严格按顺序）
18. supabase/migrations/20260818103000_ai_control_plane_runtime.sql
19. supabase/migrations/20260818110000_worker_runtime_control.sql
20. supabase/migrations/20260819101500_admin_dashboard_period_aggregate.sql
21. supabase/migrations/20260819112000_admin_billing_summary.sql
22. supabase/migrations/20260821123000_generation_capacity_backpressure.sql
23. supabase/migrations/20260822100000_generation_service_entitlements.sql
24. supabase/migrations/20260822190000_generation_parent_state_consistency.sql
```

关键依赖：

```text
schema.sql 是所有业务表的基础。
credits-update.sql 创建 credit_logs 并更新注册发放积分逻辑。
set-signup-credits-50.sql 会覆盖 handle_new_user 的默认注册积分，必须在 credits-update.sql 后执行。
atomic-credit-rpc.sql 依赖 profiles、generations、credit_logs。
rls-and-ratelimit-update.sql 创建 rate_limit_buckets，fix-rate-limit-rls.sql 依赖它。
task-queue-items.sql 依赖 generations，并创建独立的 task_queue_items read model。
stripe-billing.sql 文件头已标明需要在 schema、credits-update、admin-console 后执行。
admin-console.sql 的积分调整函数依赖 profiles 和 credit_logs。
product-retouch.sql 依赖 generations、credit_logs、admin_config_versions 和 task_queue_items。
```

注意：Agent 数据库对象已从当前主线退役。新环境不要再执行历史 Agent 建表脚本；已有环境按需运行 `supabase/drop-agent-tables.sql` 清理旧表与任务轨道耦合。

## 兼容脚本说明

这些脚本与 `schema.sql` 有重叠，但使用 `IF NOT EXISTS` 或兼容 ALTER，通常可重复执行：

```text
tryon-reference-favorites.sql
product-set-favorite-plans.sql
```

它们保留给旧环境补表使用。新环境按推荐基础顺序执行即可。

## 执行方式

Supabase Dashboard：

```text
SQL Editor -> New query -> 粘贴单个 SQL 文件 -> Run
```

本地 `psql`：

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/credits-update.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/set-signup-credits-50.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/atomic-credit-rpc.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/rls-and-ratelimit-update.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/fix-rate-limit-rls.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/task-queue-items.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/task-queue-performance-indexes.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/admin-console.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/stripe-billing.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/invite-codes.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tryon-reference-config.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tryon-reference-favorites.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tryon-reference-templates.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/product-set-favorite-plans.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/product-retouch.sql
```

## 执行后验证

```sql
SELECT
  to_regclass('public.profiles') AS profiles,
  to_regclass('public.generations') AS generations,
  to_regclass('public.credit_logs') AS credit_logs,
  to_regclass('public.task_queue_items') AS task_queue_items,
  to_regclass('public.admin_members') AS admin_members,
  to_regclass('public.billing_products') AS billing_products,
  to_regclass('public.tryon_reference_scenes') AS tryon_reference_scenes,
  to_regclass('public.product_retouch_batches') AS product_retouch_batches,
  to_regclass('public.product_retouch_outputs') AS product_retouch_outputs;
```

```sql
SELECT
  proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'create_generation_with_credit_debit_v2',
    'claim_generation_outbox',
    'claim_generation_job',
    'get_generation_service_entitlement',
    'settle_generation_for_tenant_capacity',
    'recover_stale_generation_capacity_waits',
    'task_queue_upsert_generation',
    'admin_adjust_user_credits',
    'grant_billing_order_credits',
    'create_product_retouch_batch',
    'retry_product_retouch_output',
    'publish_product_retouch_skill_version'
  )
ORDER BY proname;
```

后台经营指标迁移完成后还需要验证：

```sql
SELECT * FROM public.get_admin_dashboard_period(now() - interval '7 days');
SELECT * FROM public.get_admin_billing_summary();
```

生产升级后还需要验证：

```text
/create 能创建任务并写入 generations。
BullMQ Worker 能通过 Outbox relay 认领并 fenced 执行任务。
/api/task-queue 能返回 task_queue_items。
/admin 能加载成员、账单、任务、资产页面。
/pricing 能读取 billing_products 和 billing_prices。
/product-retouch 能创建父批次，并隐藏内部子任务。
失败槽位退款、单项重试扣费和批次恢复均正常。
```
