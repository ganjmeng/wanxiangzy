# Configuration

Pixel Diffusion uses environment variables for infrastructure and process-level secrets. AI model and provider credentials are normally configured in the administrator console and encrypted in PostgreSQL.

The exhaustive example is [`.env.local.example`](../.env.local.example). The runtime contract and validation rules live in [`lib/env.ts`](../lib/env.ts). This document explains the production-critical groups and their trust boundaries.

## Configuration Rules

- Never commit `.env.local`, `.env.production`, a service-role key, a provider key, a private key, or a Stripe secret.
- Use independent secrets for processor authentication, upload receipts, OSS mirror signing, and provider encryption.
- Production fails closed for unsafe queue, Redis, capacity, and storage modes.
- The browser may receive only `NEXT_PUBLIC_*` values. Everything else is server-only.
- Configure provider endpoints and keys through the admin control plane unless a documented bootstrap script requires a temporary environment value.
- Keep `.env.local.example` non-secret and use placeholders only.

## Local Baseline

```bash
cp .env.local.example .env.local
```

For a minimal UI/API development loop, set:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GENERATION_QUEUE_MODE=inline
AI_ROUTER_CAPACITY_MODE=local
```

Inline generation is development-only. It executes provider work from the API process and is rejected in production.

For a queue-backed development environment:

```env
GENERATION_QUEUE_MODE=bullmq
REDIS_URL=redis://:<password>@127.0.0.1:6379/15
AI_ROUTER_CAPACITY_MODE=redis
```

## Production Required

These values are required before starting a production web or worker process. The source of truth is the runtime contract in `lib/env.ts`.

| Variable | Purpose | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical public origin | Must be the HTTPS public origin; do not derive it from forwarded headers |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase browser key | Public; RLS must remain enabled |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server access | Server-only; grants broad database access |
| `REDIS_URL` | Standard Redis endpoint | Use `redis://` or `rediss://`; never an Upstash REST URL |
| `GENERATION_QUEUE_MODE` | Generation delivery mode | Must be `bullmq` in production |
| `AI_ROUTER_CAPACITY_MODE` | Distributed capacity mode | Must be `redis` in production |
| `IMAGE_STORAGE_PROVIDER` | Media storage adapter | Production requires `aliyun-oss` |

## Redis and Queue

Redis is used for BullMQ, distributed provider capacity, upload admission, and task-cache hot data. The application expects a standard Redis endpoint and a dedicated database index where practical.

```env
REDIS_URL=redis://:<password>@127.0.0.1:6379/15
GENERATION_QUEUE_MODE=bullmq
BULLMQ_PREFIX={wanxiangzy:generation}
BULLMQ_QUEUE_NAME=generation-jobs
BULLMQ_WORKER_CONCURRENCY=64
BULLMQ_RELAY_BATCH_SIZE=100
BULLMQ_RELAY_CONCURRENCY=8
BULLMQ_LOCK_DURATION_MS=60000
BULLMQ_LOCK_RENEW_TIME_MS=20000
BULLMQ_STALLED_INTERVAL_MS=30000
BULLMQ_MAX_STALLED_COUNT=2
WORKER_SHUTDOWN_TIMEOUT_MS=30000
```

Redis must not use an eviction policy that can silently remove queue state. Configure `maxmemory-policy=noeviction` and monitor memory independently from PostgreSQL.

Production worker count and concurrency should be based on host memory, provider quota, and measured throughput. Do not copy a high concurrency value onto a memory-constrained host without load testing.

## Aliyun OSS

Production uploads and generated-result persistence require Aliyun OSS:

```env
IMAGE_STORAGE_PROVIDER=aliyun-oss
ALIYUN_OSS_REGION=oss-cn-hongkong
ALIYUN_OSS_BUCKET=your-bucket
ALIYUN_OSS_PUBLIC_BASE_URL=https://your-bucket.oss-cn-hongkong.aliyuncs.com
ALIYUN_OSS_ACCESS_KEY_ID=your-ram-access-key-id
ALIYUN_OSS_ACCESS_KEY_SECRET=your-ram-access-key-secret
NEXT_PUBLIC_ALIYUN_OSS_IMAGE_HOSTS=your-bucket.oss-cn-hongkong.aliyuncs.com
```

Use a dedicated RAM user with the narrowest required bucket permissions. The browser receives signed upload policies, not long-lived OSS credentials.

Relevant prefixes:

```env
ALIYUN_OSS_SITE_ASSET_PREFIX=site-assets/original
ALIYUN_OSS_UPLOAD_PREFIX=user-uploads/original
ALIYUN_OSS_GENERATED_PREFIX=generated-results/original
ALIYUN_OSS_FAVORITE_PREFIX=user-favorites/original
ALIYUN_OSS_TEMP_PREFIX=temp/original
```

Configure CORS on the bucket for browser uploads. Do not enable public write access or expose the AccessKey secret in client code.

## Upload Security

```env
UPLOAD_DELIVERY_MODE=direct
UPLOAD_INTENT_SECRET=<independent random secret>
UPLOAD_INTENT_TTL_SECONDS=300
UPLOAD_READ_URL_TTL_SECONDS=600
UPLOAD_IMAGE_MAX_MB=15
UPLOAD_VIDEO_MAX_MB=100
UPLOAD_AUDIO_MAX_MB=30
UPLOAD_IMAGE_MAX_PIXELS=40000000
UPLOAD_IMAGE_MAX_EDGE=12000
UPLOAD_DAILY_QUOTA_MB=2048
UPLOAD_INTENT_RATE_PER_MINUTE=120
UPLOAD_MAX_ACTIVE_INTENTS=20
```

`UPLOAD_INTENT_SECRET` binds a short-lived receipt to user, purpose, key, size, MIME type, and hash. Use a value independent from the OSS AccessKey secret.

## AI Provider Control Plane

Image, vision, text, and video providers are normally configured in `/admin/providers` and stored encrypted in Supabase. Set an encryption key before publishing provider credentials:

```env
ADMIN_SECRETS_ENCRYPTION_KEY=<64 hexadecimal characters>
```

Generate it with:

```bash
openssl rand -hex 32
```

The key must be stable across deployments. Rotating it requires decrypting and republishing provider configuration with the new key.

Provider result persistence and mirroring use a separate signing secret:

```env
ALIYUN_OSS_REMOTE_TRANSFER_MODE=stream
ALIYUN_OSS_REMOTE_ALLOWED_HOSTS=provider-result.example.com
ALIYUN_OSS_MIRROR_SIGNING_SECRET=<independent random secret>
ALIYUN_OSS_MIRROR_MAX_BYTES=536870912
ALIYUN_OSS_REMOTE_CONCURRENCY=8
```

`ALIYUN_OSS_REMOTE_ALLOWED_HOSTS` must contain the actual provider result hostnames. Never use wildcards or disable private-address checks to work around a host error.

## Background Processor Secrets

Durable processor endpoints require a strong secret:

```env
JOB_PROCESSOR_SECRET=<at least 32 random characters>
AGENT_WORKFLOW_PROCESSOR_SECRET=
AGENT_EVAL_PROCESSOR_SECRET=
CRON_SECRET=
```

Use independent values when multiple external schedulers call different routes. Weak values such as `secret`, `password`, or `change-me` are rejected in production.

Generate secrets with:

```bash
openssl rand -hex 32
```

## Stripe Billing

```env
STRIPE_SECRET_KEY=sk_live_or_test_secret
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_or_test_publishable
STRIPE_WEBHOOK_SECRET=whsec_webhook_secret
```

Use test-mode values for development. Configure the webhook endpoint to the deployed `/api/stripe/webhook` route and verify events through the Stripe signature. Never expose the secret key or webhook secret to the browser.

## Media Validation and Cleanup

Media validation requires `ffprobe` on every worker host:

```env
MEDIA_VALIDATION_BATCH_SIZE=12
MEDIA_VALIDATION_CONCURRENCY=4
MEDIA_VALIDATION_POLL_INTERVAL_MS=1000
MEDIA_VALIDATION_LEASE_SECONDS=180
MEDIA_VALIDATION_MAX_BYTES=536870912
MEDIA_VALIDATION_FFPROBE_TIMEOUT_MS=30000
MEDIA_CLEANUP_BATCH_SIZE=20
MEDIA_CLEANUP_CONCURRENCY=4
MEDIA_CLEANUP_POLL_INTERVAL_MS=60000
MEDIA_CLEANUP_LEASE_SECONDS=300
```

Cleanup must preserve objects that are still referenced by a durable asset or active task. Validate retention settings against backup and privacy requirements.

## Remote Fetch Allowlists

Remote image and download routes use explicit allowlists:

```env
DOWNLOAD_IMAGE_ALLOWED_HOSTS=cdn.example.com
REMOTE_IMAGE_ALLOWED_HOSTS=provider-result.example.com
API_PLATFORM_TEST_ALLOWED_HOSTS=test-api.example.com
```

Allowlists are a security boundary. Add only the exact hostname required by an approved integration. Do not use `*`, schemes, paths, or private network names.

## Production Validation

Before starting production processes, verify:

1. `NEXT_PUBLIC_APP_URL` is the public HTTPS origin.
2. Supabase RLS is enabled and the service-role key is server-only.
3. Redis uses `noeviction`, has a strong password, and is reachable from every web/worker instance.
4. `GENERATION_QUEUE_MODE=bullmq` and `AI_ROUTER_CAPACITY_MODE=redis`.
5. OSS credentials are least-privilege and CORS is scoped to the application origin.
6. `ADMIN_SECRETS_ENCRYPTION_KEY`, `UPLOAD_INTENT_SECRET`, `ALIYUN_OSS_MIRROR_SIGNING_SECRET`, and processor secrets are independent and strong.
7. Provider result hosts are explicitly allowlisted.
8. The database runtime contract matches `runtime-contract.json`.
9. `npm run check:release` passes for the exact release revision.

Runtime configuration is validated by `lib/env.ts`; deployment scripts also validate the database contract and required RPCs. A successful build alone does not prove that a production runtime is correctly configured.
