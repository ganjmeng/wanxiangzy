# 后台管理员引导

后台管理员由两部分组成：

1. Supabase Auth 中的登录用户（`auth.users`）。
2. PostgreSQL 中的正式授权记录（`public.admin_members`）。

推荐直接运行仓库脚本，一次完成“创建并确认邮箱的 Auth 用户 + 写管理员授权”两步，不需要先访问注册页，也不需要配置 `ADMIN_BOOTSTRAP_EMAILS`。

## Supabase 配置事实

- `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 是浏览器可用的公开配置。
- `SUPABASE_SERVICE_ROLE_KEY` 只能放在服务端环境文件中；它能绕过 RLS，不能进入浏览器 bundle。
- `public.admin_members.user_id` 必须对应 `auth.users.id`。
- 只有 `status='active'` 且 `enabled=true` 的记录会被识别为正式管理员。
- 合法角色为：`owner`、`ops`、`support`、`finance`、`reviewer`、`engineer`、`viewer`。
- 必须已经执行 `supabase/schema.sql`、认证/积分基础 SQL 和 `supabase/admin-console.sql`。
- `ADMIN_BOOTSTRAP_EMAILS` 只是紧急旁路，不是正式授权来源；创建正式管理员后必须移除。

完整 SQL 顺序见 [supabase-migration-order.md](supabase-migration-order.md)。

## 初始化管理员表结构

本地 `psql`：

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/admin-console.sql
```

Supabase Dashboard 中如果没有 `psql`，打开 `supabase/admin-console.sql`，复制全部 SQL 到 SQL Editor 执行。

## 自动创建第一个管理员

确认 `.env.local` 或 `.env.production` 至少包含：

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

运行：

```bash
npm run admin:create -- --email owner@example.com --role owner
```

脚本行为：

1. 调用 Supabase Admin API 创建 Auth 用户。
2. 自动设置 `email_confirm=true`，不需要用户点击确认邮件。
3. 把用户写入或更新到 `public.admin_members`。
4. 如果未提供密码，则生成一个强密码并只显示一次。

成功后输出示例：

```text
Admin account is ready.
  Email: owner@example.com
  User ID: 00000000-0000-0000-0000-000000000000
  Role: owner
  Status: active / enabled
  Auth user: created and email-confirmed
  Password: <generated-password>
  Admin URL: http://localhost:3000/admin
```

保存本次显示的密码，首次登录后立即修改。脚本不会把密码写入日志文件或数据库明文字段。

## 常用参数

```bash
# 自定义显示名称和角色
npm run admin:create -- \
  --email ops@example.com \
  --display-name "Operations Admin" \
  --role ops

# 复用已有 Auth 用户，不改密码
npm run admin:create -- --email owner@example.com --role owner

# 复用已有 Auth 用户并重置密码
npm run admin:create -- --email owner@example.com --role owner --update-password

# 查看全部参数
npm run admin:create -- --help
```

也可以使用环境变量作为默认值：

```env
ADMIN_BOOTSTRAP_EMAIL=owner@example.com
ADMIN_BOOTSTRAP_PASSWORD=replace-with-a-strong-password
ADMIN_BOOTSTRAP_ROLE=owner
ADMIN_BOOTSTRAP_DISPLAY_NAME=Owner
```

不要把真实密码提交到 Git。省略 `ADMIN_BOOTSTRAP_PASSWORD` 并让脚本生成密码通常更安全。

## 验证管理员记录

在 Supabase SQL Editor 或受控的 `psql` 会话中执行：

```sql
SELECT
  u.id AS auth_user_id,
  u.email AS auth_email,
  u.email_confirmed_at IS NOT NULL AS email_confirmed,
  m.user_id,
  m.email AS admin_email,
  m.role,
  m.status,
  m.enabled,
  m.display_name
FROM auth.users AS u
LEFT JOIN public.admin_members AS m ON m.user_id = u.id
WHERE LOWER(u.email) = LOWER('owner@example.com');
```

应满足：

```text
email_confirmed = true
user_id = auth_user_id
role = owner（或指定角色）
status = active
enabled = true
```

随后使用脚本输出的邮箱和密码登录 `/admin`。

## 角色建议

```text
owner：全权限，仅限核心负责人。
engineer：工程和供应商配置，可处理任务、资产、worker、设置。
ops：运营管理，可处理任务、资产、审核、报表和部分配置读取。
finance：积分、账单、运营审批和财务相关操作。
support：客服处理、用户查询、工单和基础风险排查。
reviewer：内容审核、资产检查和工单协作。
viewer：只读查看，用于审计、排查和临时观察。
```

权限矩阵定义在 `lib/admin/permissions.ts`。新增敏感后台操作前，应先分配明确 permission，再由角色授权。

## 紧急环境变量旁路

只有在 `admin_members` 表已存在、但暂时无法运行管理员创建脚本时，才使用该路径：

1. 在 EC2 的 `~/apps/wanxiangzy/shared/.env.production` 临时加入：

   ```env
   ADMIN_BOOTSTRAP_EMAILS=owner@example.com
   ```

2. 重启应用：

   ```bash
   pm2 restart wanxiangzy
   ```

3. 登录 `/admin` 并进入成员管理，写入正式管理员；或者运行 `npm run admin:create -- --email owner@example.com --role owner`。
4. 移除 `ADMIN_BOOTSTRAP_EMAILS`，再次重启应用。
5. 重新登录，确认权限来源仍是 `admin_members`。

长期保留 `ADMIN_BOOTSTRAP_EMAILS` 会让环境变量中的邮箱绕过成员表直接获得 owner 权限，不要这样做。

## 排查

访问 `/admin` 被重定向到 `/admin-forbidden` 时，按顺序检查：

1. `supabase/admin-console.sql` 是否已经执行，`public.admin_members` 是否存在。
2. `admin_members.user_id` 是否等于当前 `auth.users.id`。
3. `admin_members.email` 是否与 Auth 用户邮箱一致。
4. `admin_members.status` 是否为 `active`，`enabled` 是否为 `true`。
5. `SUPABASE_SERVICE_ROLE_KEY` 是否配置在服务端环境中，且服务端可以读取 `admin_members`。
6. 如果依赖临时旁路，确认 `ADMIN_BOOTSTRAP_EMAILS` 已生效且重启过应用。

### 脚本提示缺少环境变量

确认 `.env.local` 或 `.env.production` 中有 `NEXT_PUBLIC_SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。脚本不会使用 `NEXT_PUBLIC_*` service-role 变量，也不应把 service-role key 暴露给浏览器。

### 脚本提示 `admin_members` 不存在

先执行 `supabase/admin-console.sql`，再重跑 `npm run admin:create`。Auth 用户可能已经创建成功，重复运行会复用该用户。
