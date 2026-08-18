# OSS 云侧直拉生成结果

普通生图的远程结果使用 OSS 镜像回源持久化。EC2 不下载完整图片、不写临时磁盘，
也不创建整图 `Buffer`：应用只读取最多 64 字节做格式校验，并读取 OSS Range
触发响应的 1 字节。完整图片由 OSS 直接从上游 URL 拉取并保存。

## 数据与发布路径

```text
Provider URL
  -> EC2 读取 64-byte Range（HTTPS/allowlist/DNS/大小/MIME/魔数校验）
  -> AES-256-GCM 加密 URL，按 generation_ref 幂等登记
  -> EC2 对目标 OSS Object 发起签名 Range: bytes=0-0
  -> OSS 404 镜像规则请求 /api/oss-mirror-source/<HMAC-capability-object-key>
  -> 解析接口验证 HMAC、TTL、密文完整性并重新做 64-byte 校验，返回 302
  -> OSS 跟随 302，直接从 Provider 完整拉取并保存
  -> EC2 只接收 1 byte，并用签名 HEAD 校验完整长度和类型
  -> 数据库按租约原子提交 completed，清除 URL 密文
  -> generation 才获得并发布最终 OSS URL
```

任一步失败都不会返回未落盘的 OSS 地址，也不会降级持久化短期 Provider URL；生成
任务沿用现有失败/退款路径。`generation_ref` 唯一约束保证任务重试不会重复发布。

浏览器完全不参与触发。用户关页后，generation worker 仍会处理任务；独立镜像恢复
循环约 1 秒轮询，使用短租约和 `FOR UPDATE SKIP LOCKED`。单进程有全局网络并发上限，
多台 EC2/多个 PM2 worker 可直接横向扩容，不会重复认领同一条记录。

## 生产启用顺序

必须分阶段启用。部署门禁在开关为 `true` 时会在切流前、切流后各校验一次解析接口
和 Bucket Website 规则，所以首次部署不要直接打开开关。

1. 依次应用数据库迁移：

   ```text
   supabase/migrations/20260818025519_oss_mirror_transfers.sql
   supabase/migrations/20260818032422_harden_oss_mirror_transfers.sql
   ```

2. 在 GitHub Actions 配置生产参数；发布工作流会以 `0600` 权限同步到 EC2 的
   `~/apps/wanxiangzy/shared/.env.production`，不要直接手改服务器：

   - Actions secret：`ALIYUN_OSS_MIRROR_SIGNING_SECRET=<openssl rand -hex 32>`；
   - Actions variable：`ALIYUN_OSS_MIRROR_ALLOWED_HOSTS=<实际返图域名，逗号分隔>`；
   - Actions variable：`ALIYUN_OSS_MIRROR_ENABLED=false`。

   其余可选运行参数保留在共享环境文件中，未配置时使用下列生产默认值：

   ```dotenv
   IMAGE_STORAGE_PROVIDER=aliyun-oss
   ALIYUN_OSS_MIRROR_ENABLED=false
   ADMIN_SECRETS_ENCRYPTION_KEY=<既有的 64 位十六进制 AES key>
   ALIYUN_OSS_MIRROR_PREFIX=generated-results/original/mirror
   ALIYUN_OSS_MIRROR_TTL_SECONDS=1800
   ALIYUN_OSS_MIRROR_PREFLIGHT_TIMEOUT_MS=12000
   ALIYUN_OSS_MIRROR_TRIGGER_TIMEOUT_MS=45000
   ALIYUN_OSS_MIRROR_WAIT_TIMEOUT_MS=240000
   ALIYUN_OSS_MIRROR_MAX_BYTES=67108864
   ALIYUN_OSS_MIRROR_MAX_ATTEMPTS=8
   ALIYUN_OSS_MIRROR_CONCURRENCY=16
   ALIYUN_OSS_MIRROR_WORKER_BATCH_SIZE=50
   ```

   allowlist 填上游“最终返图 URL”的域名，不一定等于提交 API 的域名。支持
   `*.trusted.example.com`，禁止全局 `*`、IP、端口和路径。先在测试任务日志中确认
   所有供应商实际返图域名，再逐项加入。

   `NEXT_PUBLIC_APP_URL` 必须是公网 HTTPS 地址。也可用
   `ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL` 指定完整解析接口前缀。

3. 通过 `.github/workflows/deploy-aws-on-tag.yml` 部署开关关闭的版本，确认：

   ```bash
   curl -I https://<app-host>/api/oss-mirror-source/__health
   # 预期 HTTP 204
   ```

4. 将 Actions variable `ALIYUN_OSS_MIRROR_ENABLED` 改为 `true` 并推送第二个发布
   tag。工作流会在切换 EC2 release 之前自动创建并精确验证 Bucket Website 镜像规则：

   ```bash
   npm run oss:configure-mirror
   npm run oss:configure-mirror -- --check
   ```

   脚本写入的规则只匹配独立 mirror 前缀、只处理 404、开启 Mirror 和跟随 302、
   关闭 query 透传与 MD5 检查，并且不设置任何自定义 Header。`--check` 会精确验证
   每个字段和解析接口健康状态，不是只检查规则是否“看起来存在”。如果 Bucket 已有
   其他 Website 配置，脚本拒绝覆盖，需在 OSS 控制台人工合并后再运行 `--check`。

5. 配置权限按最小权限拆分：

   - 一次性运维身份：`oss:GetBucketWebsite`、`oss:PutBucketWebsite`；配置完成后撤销
     `PutBucketWebsite`。
   - 部署/EC2 身份：保留只读 `oss:GetBucketWebsite` 供门禁检查；对象权限仅限目标
     Bucket/mirror 前缀的 `GetObject`、`DeleteObject`。不要授予 `PutBucketWebsite`。
   - Supabase 表和 RPC：仅 `service_role`，`anon`/`authenticated` 全部撤权并强制 RLS。

6. 第二次 tag 部署仍会在 EC2 切换前、健康检查后各验证一次规则与解析接口；任一
   门禁失败会中止或自动回滚。不要只手工重启当前进程绕过部署门禁。

7. 灰度生成一张普通图片并确认：

   - `oss_mirror_transfers.status = 'completed'`；
   - `source_url IS NULL` 且 `source_url_ciphertext IS NULL`；
   - `content_length = expected_content_length`；
   - generation/result 中只有最终 OSS URL；
   - PM2 日志出现 `oss_mirror.batch.complete` 时无持续 deferred/failed 增长；
   - 浏览器能打开最终地址，刷新和关闭页面均不影响后台任务。

## 扩容与保留

- 单 worker 默认一次认领 50 条，网络并发默认 16；先依据上游和 OSS 限流调参，
  不要用无界 `Promise.all`。
- 增加 PM2 worker 或 EC2 实例即可横向扩容；数据库租约负责全局去重。
- 活跃 URL 映射最长保留 30 分钟，完成后立即清除密文；完成元数据默认保留 7 天，
  失败记录默认 3 天。失败对象先尝试删除，完成对象只清理数据库元数据。
- 结构化日志可用 `WORKER_LOG_FORMAT=json` 接入现有日志/告警系统。应对 failed、
  连续 recovery error、处理延迟和 worker 存活设置告警。

## 回滚

将 `ALIYUN_OSS_MIRROR_ENABLED=false` 后走一次正常 tag 部署。业务恢复原存储适配器；
已完成 OSS 对象不受影响。不要删除 Bucket Website 规则，它只匹配独立 mirror 前缀，
关闭运行时后不会产生新映射。

## 安全边界

- Provider URL 仅以 AES-256-GCM 密文短期保存，完成、终态失败或 TTL 到期立即清除。
- 对象路径携带 HMAC 能力签名；随机路径、篡改路径在查询数据库前返回 404。
- 源 URL 在登记和解析时都执行 HTTPS、显式域名 allowlist、DNS 私网拦截、禁止重定向、
  文件大小、严格 MIME 与图片魔数校验；SVG 和 `application/octet-stream` 不接受。
- OSS 规则不携带静态共享 Header，因此不会把应用密钥转发给上游供应商。
- 图片正文从不写入数据库、EC2 磁盘或 Node 整图 Buffer。
