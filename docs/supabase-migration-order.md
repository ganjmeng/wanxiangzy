# Supabase SQL 执行顺序

当前仓库的 `supabase/` 目录还不是时间戳 migration runner，而是一组可重复执行的 SQL 脚本。新环境初始化或生产升级时，请按本文件顺序逐个执行，执行失败时停止，先修复再继续。

## 推荐基础顺序

```text
1. supabase/schema.sql
2. supabase/credits-update.sql
3. supabase/set-signup-credits-50.sql
4. supabase/atomic-credit-rpc.sql
5. supabase/rls-and-ratelimit-update.sql
6. supabase/fix-rate-limit-rls.sql
7. supabase/agent-workflows.sql
8. supabase/task-queue-items.sql
9. supabase/task-queue-performance-indexes.sql
10. supabase/admin-console.sql
11. supabase/stripe-billing.sql
12. supabase/invite-codes.sql
13. supabase/tryon-reference-config.sql
14. supabase/tryon-reference-favorites.sql
15. supabase/tryon-reference-templates.sql
16. supabase/product-set-favorite-plans.sql
```

关键依赖：

```text
schema.sql 是所有业务表的基础。
credits-update.sql 创建 credit_logs 并更新注册发放积分逻辑。
set-signup-credits-50.sql 会覆盖 handle_new_user 的默认注册积分，必须在 credits-update.sql 后执行。
atomic-credit-rpc.sql 依赖 profiles、generations、credit_logs。
rls-and-ratelimit-update.sql 创建 rate_limit_buckets，fix-rate-limit-rls.sql 依赖它。
task-queue-items.sql 依赖 generations 和 agent_workflows。
stripe-billing.sql 文件头已标明需要在 schema、credits-update、admin-console 后执行。
admin-console.sql 的积分调整函数依赖 profiles 和 credit_logs。
```

注意：Agent 模块的 API 当前是 no-op，但 `task-queue-items.sql` 里的 workflow read model 会引用 `public.agent_workflows`。因此如果要启用任务轨道和后台队列视图，仍需先运行 `agent-workflows.sql` 建表。不要跳过第 7 步后直接运行第 8 步。

## 可选 Agent 恢复脚本

只有恢复智能 Agent 模块时再运行：

```text
supabase/agent-conversations.sql
supabase/agent-brain-traces.sql
```

恢复时建议顺序：

```text
agent-workflows.sql
agent-conversations.sql
agent-brain-traces.sql
task-queue-items.sql
task-queue-performance-indexes.sql
```

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
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/agent-workflows.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/task-queue-items.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/task-queue-performance-indexes.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/admin-console.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/stripe-billing.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/invite-codes.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tryon-reference-config.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tryon-reference-favorites.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tryon-reference-templates.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/product-set-favorite-plans.sql
```

## 执行后验证

```sql
SELECT
  to_regclass('public.profiles') AS profiles,
  to_regclass('public.generations') AS generations,
  to_regclass('public.credit_logs') AS credit_logs,
  to_regclass('public.task_queue_items') AS task_queue_items,
  to_regclass('public.agent_workflows') AS agent_workflows,
  to_regclass('public.admin_members') AS admin_members,
  to_regclass('public.billing_products') AS billing_products,
  to_regclass('public.tryon_reference_scenes') AS tryon_reference_scenes;
```

```sql
SELECT
  proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'create_generation_with_credit_debit',
    'claim_next_generation_jobs',
    'task_queue_upsert_generation',
    'admin_adjust_user_credits',
    'grant_billing_order_credits'
  )
ORDER BY proname;
```

生产升级后还需要验证：

```text
/create 能创建任务并写入 generations。
/api/jobs/process-generations 能认领任务。
/api/task-queue 能返回 task_queue_items。
/admin 能加载成员、账单、任务、资产页面。
/pricing 能读取 billing_products 和 billing_prices。
```
