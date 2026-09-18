# Production Readiness Audit - 2026-06-16

> **Historical snapshot:** This audit records the repository state on 2026-06-16. It contains dated findings and proposed paths that may no longer exist. Use [docs/README.md](README.md) and the current architecture, configuration, and release documents for production decisions.

## A. 当前项目总体评分

| 维度 | 评分 |
| --- | ---: |
| 总体评分 | 62/100 |
| 前端 UI/UX | 56/100 |
| 组件拆分 | 42/100 |
| 后端 API | 68/100 |
| 数据库设计 | 70/100 |
| 安全 | 64/100 |
| 可交付性 | 66/100 |
| 可维护性 | 45/100 |

## B. 是否达到生产级可交付标准

否。当前项目已经超过纯 demo，有登录、积分扣减、生成任务、历史记录、后台管理、Supabase RLS、速率限制和 AWS EC2 tag 部署 workflow，但还不能按真实客户生产级 SaaS 交付。

当前状态更接近“功能型 MVP / 半成品”。主要差距是：核心前端页面过长且职责混杂，基础 Design System 不完整，部分管理端交互仍使用浏览器原生 prompt/confirm/alert，生产日志仍可能输出请求上下文，释放流程缺少稳定的 lint 门禁，README/运维文档没有覆盖完整初始化、备份、恢复和 release checklist。

## C. 当前最严重的 10 个问题

1. **核心前端页面严重超长**
   - 描述：`app/create/page.tsx` 4233 行、`app/product-set/page.tsx` 4054 行、`app/pose/page.tsx` 1993 行，页面内同时承载状态、API 调用、轮询、上传、表单、弹窗和大量 JSX。
   - 影响范围：换装、商品套图、姿势裂变等主业务入口。
   - 交付影响：任何修改都容易引入回归，无法按模块测试和复用。
   - 严重程度：Critical
   - 涉及文件：`app/create/page.tsx`、`app/product-set/page.tsx`、`app/pose/page.tsx`
   - 修复方案：按业务拆成 `features/tryon`、`features/product-set`、`features/pose`，页面只保留编排；上传、配置面板、参考图选择、结果区、任务轮询分别抽成组件和 hooks。

2. **基础 Design System 缺口仍明显**
   - 描述：已有 `button/input/select/dialog/table` 等基础组件，但缺少 `tabs`、`form-field`、`empty-state`、`loading-state`、`error-state`、`modal` 这类页面重构必需组件。
   - 影响范围：所有页面的非 happy path、表单和分组导航。
   - 交付影响：页面继续各写各的空态、错误态和表单样式，体验不一致。
   - 严重程度：High
   - 涉及文件：`components/ui`
   - 修复方案：先补齐基础组件，再逐步替换页面内重复 UI。

3. **管理端仍有临时浏览器交互**
   - 描述：`components/admin/AdminConfigActions.tsx` 使用 `window.prompt/window.alert`，`components/admin/AdminBillingActions.tsx` 使用 `window.confirm/window.alert`，`components/admin/AdminSupportTicketActions.tsx` 使用 `window.prompt/window.alert`。
   - 影响范围：配置发布/归档、退款/取消订阅、客服工单处理。
   - 交付影响：无法统一校验、loading、错误反馈和审计理由输入体验。
   - 严重程度：High
   - 修复方案：改为受控 Dialog/AlertDialog + Textarea + toast，所有危险操作带明确二次确认。

4. **生产日志仍可能泄漏请求上下文**
   - 描述：`lib/api/lingya.ts` 在生成请求和响应路径中直接 `console.log`，虽然没有完整 base64 和 prompt，但仍会输出 provider、模型、尺寸、图片数量等业务上下文。
   - 影响范围：所有图片生成 API。
   - 交付影响：生产日志不可控，增加敏感上下文泄露和日志噪声。
   - 严重程度：High
   - 修复方案：统一走 `logger.info/debug`，生产默认关闭请求细节日志，只保留错误日志。

5. **通用 API 响应结构不统一**
   - 描述：例如 `app/api/tryon/route.ts`、`app/api/product-set/route.ts`、`app/api/history/route.ts` 都返回 `{ error }`，但成功响应和错误 code 不统一。
   - 影响范围：前端错误处理、客户端重试、监控归因。
   - 交付影响：前端无法稳定按 code 分支处理，客户侧问题难定位。
   - 严重程度：High
   - 修复方案：建立 `lib/api/response.ts`，统一 `ok/code/message/details/requestId`。

6. **数据库迁移不是单一有序迁移链**
   - 描述：`supabase/` 下有多个 SQL 文件，如 `schema.sql`、`admin-console.sql`、`stripe-billing.sql`、`rls-and-ratelimit-update.sql`，但没有按时间戳组织的 migration runner。
   - 影响范围：新环境初始化、生产升级、回滚。
   - 交付影响：客户环境难以复现，升级顺序容易出错。
   - 严重程度：High
   - 修复方案：整理为 `supabase/migrations/YYYYMMDDHHMM_name.sql`，提供一键初始化和升级说明。

7. **上传和远程图片处理边界需要继续收紧**
   - 描述：`app/api/upload-image/route.ts` 可传 base64/multipart，`lib/api/image-storage.ts` 也支持远程 URL 转存路径；格式和大小有校验，但远程抓取仍需要更严格的 host/IP/redirect 策略。
   - 影响范围：用户上传、AI 参考图转存。
   - 交付影响：存在 SSRF/资源消耗风险。
   - 严重程度：High
   - 修复方案：远程 URL 只允许白名单 host，禁止私网地址和多跳重定向，所有下载限制 content-length 和实际流大小。

8. **部署门禁与 lint 脚本不稳定**
   - 描述：`package.json` 的 `lint` 是 `next lint`，当前 Next 15 线对该命令支持并不可靠；`scripts/release-check.js` 没有运行 lint。
   - 影响范围：CI、tag 部署前质量门禁。
   - 交付影响：样式、无障碍、React hooks 等问题可能绕过发布。
   - 严重程度：Medium
   - 修复方案：切到显式 ESLint 命令并纳入 release check。

9. **后台数据层文件过大**
   - 描述：`lib/admin/data.ts` 4992 行，聚合用户、账单、配置、报表、资产、审计等多个领域的数据访问。
   - 影响范围：所有后台查询和操作。
   - 交付影响：权限边界和查询性能难审计，后续扩展成本高。
   - 严重程度：Medium
   - 修复方案：按领域拆为 `lib/admin/users.ts`、`billing.ts`、`assets.ts`、`reports.ts`、`settings.ts` 等。

10. **交付文档仍缺少生产运维闭环**
    - 描述：`README.md` 有基础说明，但缺少完整备份/恢复、管理员创建、Supabase migration 顺序、发布回滚和事故处理 checklist。
    - 影响范围：客户交付、运维交接。
    - 交付影响：上线后依赖口头知识，交接风险高。
    - 严重程度：Medium
    - 修复方案：补 `docs/release-checklist.md`、`docs/backup-restore.md`、`docs/admin-bootstrap.md`。

## D. 前端 UI/UX 专项问题

1. `app/create/page.tsx` 是主阻塞项：单文件 4233 行，30+ 个 state，多个 fetch/轮询和大量按钮/输入 JSX 混在一起。
2. `app/product-set/page.tsx` 同时包含页面、模态框、表单字段、模板库、结果列表、分析卡片和工具函数，虽然局部拆了内部函数组件，但仍不可维护。
3. `app/pose/page.tsx` 把姿势分析、规划、上传、生成和结果展示合在一个客户端组件里。
4. `app/model/page.tsx`、`app/face-swap/page.tsx`、`app/model-background/page.tsx` 都超过 1000 行，属于后续高优先级拆分对象。
5. `app/all-category-product-image/page.tsx` 自己定义 `EmptyState`、`SelectField`、`IconButton`，说明通用 UI 没有被沉淀。
6. 多处 raw `button/input/select/textarea` 直接写 Tailwind，未优先复用 `components/ui`。
7. 管理端危险操作缺少统一确认弹窗和理由输入组件。
8. 表格/列表在小屏幕上的横向滚动、操作菜单密度需要统一策略。
9. 空态/错误态虽然在部分 studio 组件存在，但没有全局设计系统标准。
10. 页面视觉密度和命名体系不统一，例如 studio、admin、product-set 三套按钮/卡片语义并存。

## E. 推荐组件拆分方案

### 通用 UI 组件

- `components/ui/button`：所有命令按钮、图标按钮、提交按钮。
- `components/ui/form-field`：统一 label、说明、错误文案和必填状态。
- `components/ui/tabs`：页面分组、设置页、模板选择。
- `components/ui/modal`：普通编辑弹窗包装。
- `components/ui/empty-state`：无数据、无搜索结果、未上传状态。
- `components/ui/loading-state`：页面/面板加载、骨架屏。
- `components/ui/error-state`：API 失败、重试入口。
- `components/ui/alert-dialog`：删除、退款、取消订阅、发布等危险操作确认。

### 业务组件

- `features/tryon/components/UploadPanel`：服装、模特脸、参考图上传。
- `features/tryon/components/ReferencePanel`：系统推荐、收藏、模板、筛选。
- `features/tryon/components/TryOnSettingsPanel`：模型、尺寸、数量、风格设置。
- `features/tryon/components/TryOnResultPanel`：生成状态、结果、失败重试。
- `features/product-set/components/ProductBriefPanel`：商品信息和图片输入。
- `features/product-set/components/ProductSetPlanPanel`：模板和自定义模块。
- `features/admin/components/AdminActionReasonDialog`：后台带理由的操作确认。

### hooks / services / types / constants / utils

- `features/tryon/hooks/useTryOnGeneration`：生成提交、扣费结果、轮询。
- `features/tryon/hooks/useTryOnReferences`：收藏、模板、推荐参考图加载。
- `features/product-set/hooks/useProductSetGeneration`：商品套图生成和重生。
- `features/admin/services/adminActions.ts`：后台 PATCH/POST 封装。
- `features/*/types.ts`：页面专属类型从 page 文件移出。
- `features/*/constants.ts`：选项、限制、默认值。
- `features/*/utils.ts`：纯数据转换函数，配套单测。

## F. 分阶段整改计划

### Phase 1：必须立刻修复，否则不能交付

- 补齐基础 Design System 缺口：`tabs/form-field/modal/empty-state/loading-state/error-state`。
- 把生产请求日志从 `console.log` 收敛到 `logger`。
- 管理端危险操作从 `window.prompt/confirm/alert` 迁移到可控弹窗和 toast。
- 对上传远程 URL 路径增加 host/IP/redirect 限制。
- 开始拆 `app/create/page.tsx`，先抽数据服务和主要面板，不做业务大改。
- 修复 release gate 中 lint 缺口。

### Phase 2：交付前必须优化

- 将 `app/product-set/page.tsx` 和 `app/pose/page.tsx` 拆为 feature 模块。
- API 响应统一化，前端按 code 处理错误。
- Supabase SQL 整理成有序 migration。
- 完善 README、部署说明、管理员初始化、备份恢复和 release checklist。
- 补齐移动端表格/弹窗体验。

### Phase 3：上线后持续优化

- 增加端到端测试覆盖核心生成、历史、支付、后台审批。
- 接入错误追踪和业务指标监控。
- 拆分 `lib/admin/data.ts`。
- 完善更细粒度 RBAC 和审计查询。
- 建立长期设计系统文档和组件示例页。
