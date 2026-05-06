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
| 存储 | Supabase Storage | 服装/模特/参考图/结果图 |
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

## 下一代 Agent 架构

当前生产版已经包含自研 Agent Brain、视觉 workflow、积分预占、worker、trace 和 eval 闭环。下一阶段不再继续在旧聊天 UI 上小修小补，而是按生产迁移路线接入：

```text
assistant-ui  -> GPT-like 前端体验
AI SDK v6     -> 流式消息、工具调用、审批协议
Mastra        -> Agent runtime、workflow、memory、eval、trace
现有服务       -> 换装、姿势裂变、3D、详情页、生图、积分和任务队列
```

完整迁移蓝图见：

- `docs/next-gen-agent-mastra-ai-sdk-architecture.md`

当前 `/agent` 已直接切换到新 assistant-ui 界面，默认配置：

```env
AGENT_CHAT_V2_ENABLED=true
AGENT_RUNTIME_PROVIDER=mastra
AGENT_UI_PROVIDER=assistant_ui
AGENT_MASTRA_MODEL=mimo-v2.5-pro
AGENT_MASTRA_MEMORY_ENABLED=true
AGENT_ALLOW_LEGACY_FALLBACK=0
```

访问 `/agent` 即可看到新 UI。Mastra Agent 会优先使用小米 OpenAI-compatible 配置：

```env
XIAOMI_MIMO_API_KEY=your-xiaomi-mimo-api-key
XIAOMI_MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
AGENT_MASTRA_MODEL=mimo-v2.5-pro
```

如果没有配置小米 key，则回退到 `AGENT_MASTRA_MODEL` 指向的 AI SDK gateway 模型。为了避免误配，`AGENT_MASTRA_MODEL=openai/gpt-*` 这类 gateway slug 不会被发送到小米 endpoint；小米场景会自动使用 `XIAOMI_MIMO_TEXT_MODEL` / `XIAOMI_MIMO_MODEL` / `mimo-v2.5-pro`。

生产默认关闭旧关键词链路：`AGENT_ALLOW_LEGACY_FALLBACK=0`。Mastra 调用失败时只返回安全聊天兜底，不再自动进入老 Brain v2 adapter；只有紧急回滚时才临时设为 `1`。

当前确认卡规划也已切到 Mastra/AI SDK 结构化 planner：`createWorkflowApproval` 会先读取偏好和项目知识，再生成 `WorkflowPlan`，然后复用现有 validator、cost、workflow repository。旧 `planWorkflow` 只保留给显式回滚和历史测试，不再是 `/agent` 的生产主路径。

确认卡生成前还有独立 verifier：先跑确定性安全规则，再跑 Mastra/AI SDK critic，专门拦截详情页误判、图片编号错、姿势输出模式错、负面约束冲突等问题。规划成功、validator 阻断、critic 阻断和异常失败都会写入 `agent_observability_events`，方便线上排查。

确认生成后默认会立即唤醒当前 Node 进程里的 workflow worker（`AGENT_WORKFLOW_INLINE_WAKE=1`），让任务尽快从 `queued` 进入 `running`；生产环境仍然必须保留 `/api/jobs/process-agent-workflows` 的定时任务作为崩溃恢复和漏单兜底。

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
# Supabase — https://supabase.com 免费创建项目
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Lingya 图像生成 API
LINGYA_BASE_URL=https://api.lingyaai.cn
LINGYA_API_KEY=your-lingya-api-key

# 图片分析 / 提示词优化 LLM，一键切换 xiaomi 或 lingya
ANALYZE_LLM_PROVIDER=xiaomi
XIAOMI_MIMO_API_KEY=your-xiaomi-mimo-api-key
XIAOMI_MIMO_BASE_URL=https://api.xiaomimimo.com
# tp- 开头的 Token Plan key 通常使用对应区域网关：
# XIAOMI_MIMO_BASE_URL=https://token-plan-sgp.xiaomimimo.com
XIAOMI_MIMO_MODEL=mimo-v2.5-pro
XIAOMI_MIMO_TEXT_MODEL=mimo-v2.5-pro
XIAOMI_MIMO_VISION_MODEL=mimo-v2.5

# 后台生成任务处理器
JOB_PROCESSOR_SECRET=change-me
GENERATION_JOB_BATCH_SIZE=2
GENERATION_JOB_STALE_MINUTES=8

# FASHN AI — https://fashn.ai 注册获取 API Key
FASHN_API_KEY=fashn_xxxxx

# Replicate — https://replicate.com 注册获取 Token
REPLICATE_API_TOKEN=r8_xxxxx
```

### 3. 初始化 Supabase

在 Supabase Dashboard → SQL Editor 中依次运行：
- `supabase/schema.sql`
- `supabase/credits-update.sql`
- `supabase/atomic-credit-rpc.sql`
- `supabase/agent-workflows.sql`
- `supabase/agent-brain-traces.sql`

然后在 Supabase Dashboard → Storage 中手动创建 4 个 Bucket（均设为 public）：
- `clothing`
- `models`
- `references`
- `results`

### 4. 启动

```bash
npm run dev
```

打开 http://localhost:3000

### 5. 后台任务处理

生成接口会先写入 `generations.job_payload`，再由后台处理器认领执行。接口返回后即使运行环境中断，任务也能通过处理器继续恢复：

```bash
curl -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  http://localhost:3000/api/jobs/process-generations
```

生产环境建议配置定时任务每 1 分钟请求一次 `/api/jobs/process-generations`，使用 `JOB_PROCESSOR_SECRET` 或 `CRON_SECRET` 作为 Bearer Token。

智能 Agent 的多步骤视觉工作流使用独立处理器：

```bash
curl -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  http://localhost:3000/api/jobs/process-agent-workflows
```

生产环境建议同样每 1 分钟请求一次 `/api/jobs/process-agent-workflows`。这个处理器负责执行文生图、图生图、换装、姿势裂变、3D 展示、电商详情页等 workflow step，并处理积分预占后的结算或释放。可用 `?limit=4&staleAfterMinutes=10` 调整单批数量和 stale running 恢复阈值。

如果线上发现任务卡住，可以调用受保护的修复处理器。它会先读取 workflow ops 快照，再认领 queued/stale running 工作流并执行，最后返回修复后的队列状态和建议：

```bash
curl -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  "http://localhost:3000/api/jobs/repair-agent-workflows?limit=4&staleAfterMinutes=10"
```

修复接口可单独配置 `AGENT_WORKFLOW_REPAIR_SECRET`；默认复用 `AGENT_WORKFLOW_PROCESSOR_SECRET`、`JOB_PROCESSOR_SECRET` 或 `CRON_SECRET`。

Agent 质量闭环还提供两个生产处理器：

```bash
curl -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  http://localhost:3000/api/jobs/run-agent-evals
```

建议每天或每小时请求一次 `/api/jobs/run-agent-evals`。它会对近期使用过 Agent 的用户运行内置 eval + 用户差评沉淀 case，写入 `agent_eval_runs` 和 `agent_eval_results`，用于上线后回归评分。

生成 worker 内置视觉质量评估与一次自动修复重生策略：结果完成后会用视觉评估器检查数量、可访问性、任务一致性、人物/服装/版式风险；低于阈值时会自动追加修复提示词重生一次。可用 `AGENT_WORKFLOW_QUALITY_REPAIR_ENABLED=false` 关闭，用 `AGENT_WORKFLOW_QUALITY_REPAIR_MAX_ATTEMPTS=1` 控制最多自动质量重试次数。`/api/agent/observability` 和 `/api/jobs/agent-health` 会汇总质量分、自动重试率和高频问题，方便上线后排查模型或提示词退化。

生产运维健康检查：

```bash
curl -H "Authorization: Bearer $JOB_PROCESSOR_SECRET" \
  http://localhost:3000/api/jobs/agent-health
```

该接口会检查 Agent v2 / assistant-ui / Mastra 配置、模型路由、关键 provider 环境变量、Supabase workflow/trace/eval 表、workflow 队列堆积、stale running 任务和最近 1 小时观测失败率，并返回 `recommendations`。可以单独设置 `AGENT_HEALTH_PROCESSOR_SECRET`，否则复用 `JOB_PROCESSOR_SECRET` 或 `CRON_SECRET`。

### 6. AWS Tag 自动部署

仓库内置 GitHub Actions：推送任意 Git tag 后自动部署到 EC2。

先在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 添加：

```env
AWS_HOST=你的 EC2 公网 IP 或域名
AWS_USER=ec2-user
AWS_SSH_PRIVATE_KEY=你的 EC2 私钥内容
AWS_PORT=22
AWS_APP_DIR=/home/ec2-user/apps/wanxiangzy
AWS_APP_NAME=wanxiangzy
```

在 EC2 上只需手动创建一次生产环境文件：

```bash
mkdir -p ~/apps/wanxiangzy/shared
nano ~/apps/wanxiangzy/shared/.env.production
```

之后本地打 tag 并推送即可部署：

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 7. 添加预设模特和参考图

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
