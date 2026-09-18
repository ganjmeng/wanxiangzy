# 生产可用性整改说明 - 2026-06-16

> **历史快照：** 本文记录 2026-06-16 的整改状态和当时验证结果，部分路径、测试数量和结论可能已经变化。当前生产判断请以 [文档索引](README.md)、架构、配置和发布检查表为准。

本文档补充说明本轮生产级整改已经完成的事项、每类修改的原因、影响范围、验证结果和仍未完成的交付债务。它对应 `docs/production-readiness-audit-2026-06-16.md` 中列出的 Phase 1 / Phase 2 优先项。

## 当前结论

本轮整改后，项目已经具备更稳定的发布门禁、基础运维文档、后台危险操作确认、远程媒体安全边界、主要生成页面的 lint/typecheck 清理，以及一部分超长页面拆分。

当前仍不应直接宣称“完全生产级可交付”。主要原因是：Supabase SQL 还没有整理为标准 timestamp migration runner，API 响应结构尚未统一，`app/create/page.tsx`、`app/product-set/page.tsx`、`app/pose/page.tsx` 等核心页面仍有继续拆分空间，仓库仍存在较多非阻断 lint warnings。

## 已完成整改说明

### 1. 基础 Design System 补齐

涉及文件：

- `components/ui/modal.tsx`
- `components/ui/tabs.tsx`
- `components/ui/form-field.tsx`
- `components/ui/empty-state.tsx`
- `components/ui/loading-state.tsx`
- `components/ui/error-state.tsx`

修改原因：

审计发现多个页面重复实现空态、错误态、表单字段、模态框和 tabs，导致 UI 行为、间距、禁用态、错误文案和可访问性不一致。

影响范围：

为后台操作、生成页重构和后续页面拆分提供统一组件入口。本次新增的是基础组件，不强制替换所有旧页面，因此对现有业务流程影响较低。

### 2. 后台危险操作从浏览器原生交互迁移到可控弹窗

涉及文件：

- `components/admin/AdminBillingActions.tsx`
- `components/admin/AdminConfigActions.tsx`
- `components/admin/AdminSupportTicketActions.tsx`
- `components/admin/AdminTryOnReferenceConsole.tsx`

修改原因：

原来的 `window.prompt`、`window.confirm`、`window.alert` 不适合生产后台：无法统一 loading、校验、错误提示、原因输入和审计上下文。

影响范围：

退款、取消订阅、配置发布/归档、客服工单处理、参考图导入等后台危险操作改为受控 modal/toast 流程。业务 API 不变，主要影响操作体验和可审计性。

### 3. 生产日志收敛

涉及文件：

- `lib/api/lingya.ts`

修改原因：

生成请求路径中的调试日志可能在生产环境输出 provider、模型、图片数量和请求上下文，增加敏感信息暴露和日志噪声。

影响范围：

保留必要错误信息，收敛普通请求日志。生成 API 行为不变，主要降低生产日志风险。

### 4. 远程图片抓取安全边界加强

涉及文件：

- `lib/api/remote-image-fetch.ts`
- `lib/api/image-storage.ts`
- `lib/api/media-storage.ts`
- `app/api/download-image/route.ts`
- `app/api/upload-image/route.ts`
- `lib/api/__tests__/remote-image-fetch.test.ts`
- `lib/api/__tests__/media-storage.test.ts`

修改原因：

远程 URL 下载和转存如果不限制协议、host、IP、redirect、content-type 和大小，存在 SSRF、资源消耗和非图片内容写入风险。

影响范围：

上传、下载、远程图片转存、AI 结果落库相关路径都会走更严格的远程媒体校验。对合法公网图片流程保持兼容，对私网地址、非法协议、异常 redirect 和超限资源会拒绝。

### 5. 发布门禁补齐

涉及文件：

- `package.json`
- `eslint.config.mjs`
- `scripts/release-check.js`

修改原因：

原 release gate 没有稳定覆盖 lint/typecheck/build/SSR size 的完整链路，无法在 tag 部署前稳定阻断代码质量和构建风险。

影响范围：

`npm run check:release` 现在依次运行测试、prompt regression、ESLint、TypeScript、生产构建和 SSR size guard。GitHub Actions tag 部署前可以复用同一门禁。

### 6. 生产运维文档补齐

涉及文件：

- `docs/release-checklist.md`
- `docs/backup-restore.md`
- `docs/admin-bootstrap.md`
- `docs/supabase-migration-order.md`
- `README.md`

修改原因：

审计发现交付材料缺少发布、回滚、管理员引导、备份恢复、Supabase SQL 执行顺序等运维闭环说明。

影响范围：

补齐客户交接和上线前检查所需的基础 runbook。文档不改变运行时行为。

### 7. `/create` 入口拆分

涉及文件：

- `app/create/page.tsx`
- `features/tryon/create/*`

修改原因：

`app/create/page.tsx` 原本承载过多状态、业务规则、上传逻辑、UI 面板和工具函数，是主要可维护性风险之一。

影响范围：

已把一部分创建页业务类型、常量、数据转换和面板逻辑迁移到 `features/tryon/create`。页面仍需继续拆分，但本轮已降低主入口复杂度，且没有改变用户生成流程。

### 8. `product-set` 与 `pose` 局部模块化

涉及文件：

- `app/product-set/page.tsx`
- `features/product-set/create/*`
- `app/pose/page.tsx`

修改原因：

商品套图和姿势裂变页面同样属于超长客户端页面，混合了分析、上传、生成、历史恢复、结果展示和大量 UI。

影响范围：

商品信息解析、状态类型、默认数量等部分从页面迁移到 feature 文件；姿势页的缓存和历史恢复副作用做了收敛。业务流程不变，主要降低回归风险。

### 9. 预览图片渲染路径统一

涉及文件：

- `components/studio/RawPreviewImage.tsx`
- `components/studio/StudioImagePreviewWorkspace.tsx`
- `app/video/AiVideoExperience.tsx`
- `components/outfit-fusion/OutfitFusionPageClient.tsx`
- `components/outfit-fusion/OutfitFusionComposer.tsx`
- `components/outfit-fusion/OutfitFusionExampleGallery.tsx`
- `components/account/AccountCenterClient.tsx`
- 以及多处生成页中的预览图替换

修改原因：

上传预览、blob/data URL、AI provider URL 和用户生成结果不适合强制走 Next Image 优化；散落的 raw `<img>` 又会产生大量 lint warnings。

影响范围：

新增 `RawPreviewImage` 作为受控例外点，集中说明为什么这些预览图继续使用原生 image。主要影响 lint 可维护性，不改变图片展示逻辑。

### 10. 主要生成页 lint/typecheck 清理

涉及文件：

- `app/garment-3d/page.tsx`
- `app/grass/page.tsx`
- `app/material-enhancement/page.tsx`
- `app/model/page.tsx`
- `app/model-background/page.tsx`
- `app/face-swap/page.tsx`
- `app/general-image/GeneralImageExperience.tsx`
- `app/all-category-product-image/page.tsx`
- `app/api-platform-test/page.tsx`
- `app/history/page.tsx`

修改原因：

这些页面存在未使用变量、hook dependency、raw image、无效 alt、重复局部状态等问题，会让 release gate 噪声过大，也会掩盖真正的回归。

影响范围：

修复范围集中在 lint/typecheck 和预览渲染，不改变生成 API、扣费、轮询和结果保存流程。

## 验证记录

本轮代码整改后的验证结果：

- `npm run typecheck`：通过
- `git diff --check`：通过，仅有 Windows CRLF 提示
- `npm run check:release`：通过
  - `npm run test`：55 个测试文件通过，345 个测试通过
  - `npm run check:prompts`：通过
  - `npm run lint`：通过，有非阻断 warnings
  - `npm run typecheck`：通过
  - `npm run build`：通过，109 个 app routes 生成完成
  - `SSR_SIZE_FAIL_ON_RISK=1 npm run check:ssr-size`：通过

本地页面冒烟验证：

- 新 dev server：`http://localhost:3102`
- HTTP 200 抽查：`/video`、`/outfit-fusion`、`/model-background`、`/account`
- Headless Chrome 截图抽查：以上页面均非白屏；`/outfit-fusion` 工作台渲染正常，未登录保护页正常展示登录界面。

## 仍未完成的交付债务

### High

- Supabase SQL 仍是一组脚本，不是标准时间戳 migration runner。下一步应整理为 `supabase/migrations/YYYYMMDDHHMM_name.sql` 并建立可重复升级策略。
- API 响应结构还没有统一到 `ok/code/message/details/requestId`，前端仍需要按不同接口做错误解析。
- `app/create/page.tsx`、`app/product-set/page.tsx`、`app/pose/page.tsx` 仍偏长，需要继续拆为 feature hooks、services、components。

### Medium

- `lib/admin/data.ts` 仍承担过多后台数据访问职责，建议按 users、billing、assets、reports、settings 等领域拆分。
- `npm run lint` 仍有大量 warnings，主要集中在 `any`、`module` 变量命名、共享组件 raw image 和 unused code。
- 缺少真正的 E2E 覆盖，核心链路如登录、上传、生成、历史恢复、后台审批、支付回调仍依赖单元测试和人工冒烟。

### Low

- Design System 已有基础组件，但还缺少组件示例页和设计规范文档。
- 移动端与小屏表格/弹窗体验需要系统性回归。

## 建议下一轮顺序

1. 继续拆 `app/create/page.tsx`，优先迁移生成提交、轮询和历史恢复为 hook/service。
2. 统一 API 响应封装，并从 2 到 3 个核心接口开始迁移。
3. 整理 Supabase migration runner 和一次新环境初始化脚本。
4. 清理 lint warnings 中的 `module` 命名和高频 `any`。
5. 添加 Playwright 或等价 E2E，覆盖登录保护页、上传入口、生成提交前校验和历史恢复。
