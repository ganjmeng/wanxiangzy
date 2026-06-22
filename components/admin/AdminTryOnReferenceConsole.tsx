"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  DatabaseZap,
  Eye,
  Loader2,
  RefreshCw,
  RotateCcw,
  Rocket,
  Save,
  Search,
} from "lucide-react";
import {
  AdminStatusBadge,
  ThumbnailStrip,
  formatDateTime,
} from "@/components/admin/AdminPrimitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type TryOnAdminCategoryRow = {
  id?: string;
  code: string;
  parent_code: string | null;
  level: number;
  name_zh: string;
  name_en: string;
  slot: string;
  is_intimate: boolean;
  aliases: unknown[];
  recognition_labels: unknown[];
  default_view_tags: string[];
  default_crop_tags: string[];
  enabled: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TryOnAdminSceneRow = {
  id?: string;
  scene_key: string;
  external_scene_id: string | null;
  name: string;
  image_url: string;
  status: "draft" | "active" | "archived";
  priority: number;
  sort_order: number;
  cloth_categories: string[];
  gender: string;
  age_ranges: string[];
  view_tags: string[];
  crop_tags: string[];
  scene_tags: string[];
  style_tags: string[];
  lens: string | null;
  posture: string | null;
  prompt_tags: string[];
  raw_config: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TryOnAdminConfigVersionRow = {
  id: string;
  config_key: string;
  status: string;
  value: Record<string, unknown>;
  created_by?: string | null;
  published_at?: string | null;
  created_at?: string | null;
};

type PreviewScene = {
  id: string;
  sceneKey: string;
  name: string;
  imageUrl: string;
  status: string;
  score: number;
  matchReasons: string[];
  clothCategories: string[];
  viewTags: string[];
  cropTags: string[];
};

type ValidationIssue = {
  sceneKey: string;
  field: string;
  message: string;
};

type ImportError = {
  index: number;
  error: string;
};

type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  action: () => Promise<void>;
};

type Props = {
  initialCategories: TryOnAdminCategoryRow[];
  initialScenes: TryOnAdminSceneRow[];
  initialVersions: TryOnAdminConfigVersionRow[];
  warnings: string[];
};

const categoryBlank = {
  code: "",
  parent_code: "",
  level: "2",
  name_zh: "",
  name_en: "",
  slot: "upper",
  is_intimate: false,
  aliases: "",
  recognition_labels: "",
  default_view_tags: "front_view,whole_body",
  default_crop_tags: "full_body",
  enabled: true,
  sort_order: "0",
  metadata: "{}",
};

const sceneBlank = {
  scene_key: "",
  external_scene_id: "",
  name: "",
  image_url: "",
  status: "draft",
  priority: "0",
  sort_order: "0",
  cloth_categories: "",
  gender: "women",
  age_ranges: "adult",
  view_tags: "front_view,whole_body",
  crop_tags: "full_body",
  scene_tags: "",
  style_tags: "",
  lens: "",
  posture: "",
  prompt_tags: "",
  raw_config: "{}",
};

export function AdminTryOnReferenceConsole({
  initialCategories,
  initialScenes,
  initialVersions,
  warnings,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [categories, setCategories] = useState(initialCategories);
  const [scenes, setScenes] = useState(initialScenes);
  const [versions, setVersions] = useState(initialVersions);
  const [tab, setTab] = useState<"overview" | "categories" | "scenes" | "import" | "preview">("overview");
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [categoryForm, setCategoryForm] = useState(categoryBlank);
  const [sceneForm, setSceneForm] = useState(sceneBlank);
  const [sceneStatusFilter, setSceneStatusFilter] = useState("active");
  const [sceneSearch, setSceneSearch] = useState("");
  const [importRawText, setImportRawText] = useState("");
  const [importChildRawText, setImportChildRawText] = useState("");
  const [importPublish, setImportPublish] = useState(true);
  const [previewSubcategory, setPreviewSubcategory] = useState("single_fitted_top");
  const [previewAudience, setPreviewAudience] = useState("women");
  const [previewAge, setPreviewAge] = useState("adult");
  const [previewIncludeDraft, setPreviewIncludeDraft] = useState(false);
  const [previewScenes, setPreviewScenes] = useState<PreviewScene[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [confirmRunning, setConfirmRunning] = useState(false);

  const categoryByCode = useMemo(() => new Map(categories.map((category) => [category.code, category])), [categories]);
  const enabledCategories = categories.filter((category) => category.enabled);
  const activeScenes = scenes.filter((scene) => scene.status === "active");
  const draftScenes = scenes.filter((scene) => scene.status === "draft");
  const publishedVersion = versions.find((version) => version.status === "published");
  const categoryOptions = enabledCategories.filter((category) => category.level === 2);
  const filteredScenes = scenes.filter((scene) => {
    if (sceneStatusFilter !== "all" && scene.status !== sceneStatusFilter) return false;
    const q = sceneSearch.trim().toLowerCase();
    if (!q) return true;
    return [
      scene.scene_key,
      scene.name,
      scene.external_scene_id,
      ...scene.cloth_categories,
      ...scene.scene_tags,
      ...scene.style_tags,
    ].filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  async function refresh() {
    setMessage({ tone: "info", text: "正在刷新配置..." });
    try {
      const [categoryPayload, scenePayload, versionPayload] = await Promise.all([
        readJson("/api/admin/tryon/categories"),
        readJson("/api/admin/tryon/reference-scenes"),
        readJson("/api/admin/tryon/config-versions"),
      ]);
      setCategories(categoryPayload.categories || []);
      setScenes(scenePayload.scenes || []);
      setVersions(versionPayload.versions || []);
      setMessage({ tone: "success", text: "已刷新后台配置。" });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: toMessage(error) });
    }
  }

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
    });
  }

  function requestConfirm(request: ConfirmRequest) {
    setConfirmRequest(request);
  }

  async function runConfirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const request = confirmRequest;
    if (!request) return;
    setConfirmRunning(true);
    try {
      await request.action();
      setConfirmRequest(null);
    } finally {
      setConfirmRunning(false);
    }
  }

  async function seedCategories() {
    try {
      const payload = await writeJson("/api/admin/tryon/categories", { seedDefaults: true });
      setCategories(payload.categories || categories);
      setMessage({ tone: "success", text: "默认服装分类已写入，可继续调整启停和标签。" });
    } catch (error) {
      setMessage({ tone: "error", text: toMessage(error) });
    }
  }

  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(categoryForm.metadata || "{}");
    } catch {
      setMessage({ tone: "error", text: "类目 metadata 不是合法 JSON。" });
      return;
    }

    try {
      const payload = await writeJson("/api/admin/tryon/categories", {
        category: {
          code: categoryForm.code,
          parent_code: categoryForm.level === "2" ? categoryForm.parent_code : null,
          level: Number(categoryForm.level),
          name_zh: categoryForm.name_zh,
          name_en: categoryForm.name_en,
          slot: categoryForm.slot,
          is_intimate: categoryForm.is_intimate,
          aliases: splitCsv(categoryForm.aliases),
          recognition_labels: splitCsv(categoryForm.recognition_labels),
          default_view_tags: splitCsv(categoryForm.default_view_tags),
          default_crop_tags: splitCsv(categoryForm.default_crop_tags),
          enabled: categoryForm.enabled,
          sort_order: Number(categoryForm.sort_order) || 0,
          metadata,
        },
      });
      setCategories(upsertBy(categories, payload.category, "code"));
      setCategoryForm(categoryBlank);
      setMessage({ tone: "success", text: "类目已保存，发布配置后前台推荐生效。" });
    } catch (error) {
      setMessage({ tone: "error", text: toMessage(error) });
    }
  }

  async function disableCategory(code: string) {
    requestConfirm({
      title: `停用类目 ${code}`,
      description: "停用后关联场景发布前会被校验，请确认没有线上推荐依赖该类目。",
      confirmLabel: "停用",
      destructive: true,
      action: async () => {
        try {
          const payload = await fetch(`/api/admin/tryon/categories?code=${encodeURIComponent(code)}`, { method: "DELETE" }).then(parseResponse);
          setCategories(upsertBy(categories, payload.category, "code"));
          setMessage({ tone: "success", text: `已停用 ${code}。` });
        } catch (error) {
          setMessage({ tone: "error", text: toMessage(error) });
        }
      },
    });
  }

  async function saveScene(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let rawConfig: Record<string, unknown> = {};
    try {
      rawConfig = JSON.parse(sceneForm.raw_config || "{}");
    } catch {
      setMessage({ tone: "error", text: "场景 raw_config 不是合法 JSON。" });
      return;
    }

    try {
      const payload = await writeJson("/api/admin/tryon/reference-scenes", {
        scene: {
          scene_key: sceneForm.scene_key,
          external_scene_id: sceneForm.external_scene_id || null,
          name: sceneForm.name,
          image_url: sceneForm.image_url,
          status: sceneForm.status,
          priority: Number(sceneForm.priority) || 0,
          sort_order: Number(sceneForm.sort_order) || 0,
          cloth_categories: splitCsv(sceneForm.cloth_categories),
          gender: sceneForm.gender,
          age_ranges: splitCsv(sceneForm.age_ranges),
          view_tags: splitCsv(sceneForm.view_tags),
          crop_tags: splitCsv(sceneForm.crop_tags),
          scene_tags: splitCsv(sceneForm.scene_tags),
          style_tags: splitCsv(sceneForm.style_tags),
          lens: sceneForm.lens || null,
          posture: sceneForm.posture || null,
          prompt_tags: splitCsv(sceneForm.prompt_tags),
          raw_config: rawConfig,
        },
      });
      setScenes(upsertBy(scenes, payload.scene, "scene_key"));
      setSceneForm(sceneBlank);
      setMessage({ tone: "success", text: "系统参考图已保存。先预览，再发布配置。" });
    } catch (error) {
      setMessage({ tone: "error", text: toMessage(error) });
    }
  }

  async function archiveScene(sceneKey: string) {
    requestConfirm({
      title: `归档场景 ${sceneKey}`,
      description: "归档后该场景不会再作为 active 推荐候选，发布配置后前台才会读取最新版本。",
      confirmLabel: "归档",
      destructive: true,
      action: async () => {
        try {
          const payload = await fetch(`/api/admin/tryon/reference-scenes?scene_key=${encodeURIComponent(sceneKey)}`, { method: "DELETE" }).then(parseResponse);
          setScenes(upsertBy(scenes, payload.scene, "scene_key"));
          setMessage({ tone: "success", text: `已归档 ${sceneKey}。` });
        } catch (error) {
          setMessage({ tone: "error", text: toMessage(error) });
        }
      },
    });
  }

  async function updateSceneStatus(sceneKey: string, status: "draft" | "active" | "archived") {
    try {
      const payload = await patchJson("/api/admin/tryon/reference-scenes", { scene_key: sceneKey, status });
      setScenes(upsertBy(scenes, payload.scene, "scene_key"));
      setMessage({ tone: "success", text: `场景已更新为 ${status}。发布配置后前台生效。` });
    } catch (error) {
      setMessage({ tone: "error", text: toMessage(error) });
      setValidationIssues(extractIssues(error));
    }
  }

  async function importScenes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const payload = await writeJson("/api/admin/tryon/reference-scenes/import", {
        rawText: importRawText,
        childRawText: importChildRawText,
        publish: importPublish,
      });
      setImportErrors(payload.errors || []);
      setMessage({
        tone: payload.errorCount ? "info" : "success",
        text: `导入完成：成功 ${payload.successCount}，失败 ${payload.errorCount}，子图集父级 ${payload.childParentCount || 0}。`,
      });
      await refresh();
    } catch (error) {
      setMessage({ tone: "error", text: toMessage(error) });
    }
  }

  async function publishConfig() {
    requestConfirm({
      title: "发布试衣参考图配置",
      description: "发布后前台推荐将读取新的 active 场景配置，请先确认校验和预览结果符合预期。",
      confirmLabel: "发布",
      action: async () => {
        try {
          const payload = await writeJson("/api/admin/tryon/config-versions", { action: "publish" });
          setValidationIssues([]);
          setVersions(upsertBy(versions.map((item) => item.status === "published" ? { ...item, status: "archived" } : item), payload.config, "id"));
          setMessage({ tone: "success", text: "试衣参考图配置已发布，前台推荐接口会使用最新版本标记。" });
          router.refresh();
        } catch (error) {
          setMessage({ tone: "error", text: toMessage(error) });
          setValidationIssues(extractIssues(error));
        }
      },
    });
  }

  async function validateConfig() {
    try {
      const payload = await writeJson("/api/admin/tryon/config-versions", { action: "validate" });
      setValidationIssues([]);
      setMessage({
        tone: "success",
        text: `校验通过：${payload.summary?.activeSceneCount || 0} 个 active 场景，${payload.summary?.enabledCategoryCount || 0} 个启用类目。`,
      });
    } catch (error) {
      const issues = extractIssues(error);
      setValidationIssues(issues);
      setMessage({ tone: "error", text: issues.length ? `校验未通过：${issues.length} 个问题需要处理。` : toMessage(error) });
    }
  }

  async function rollbackVersion(versionId: string) {
    requestConfirm({
      title: "回滚配置快照",
      description: "回滚后请重新校验、预览并发布，避免前台推荐读取到未确认配置。",
      confirmLabel: "回滚",
      destructive: true,
      action: async () => {
        try {
          await writeJson("/api/admin/tryon/config-versions", { action: "rollback", versionId });
          setMessage({ tone: "success", text: "已回滚快照，请检查预览后重新发布。" });
          await refresh();
        } catch (error) {
          setMessage({ tone: "error", text: toMessage(error) });
        }
      },
    });
  }

  async function previewRecommendations(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    try {
      const payload = await writeJson("/api/admin/tryon/reference-scenes/preview", {
        subcategories: [previewSubcategory].filter(Boolean),
        garmentAudience: previewAudience,
        ageGroup: previewAge,
        includeDraft: previewIncludeDraft,
      });
      setPreviewScenes(payload.recommended || []);
      setMessage({ tone: "success", text: `预览完成：推荐 ${payload.recommended?.length || 0} 个场景。` });
    } catch (error) {
      setMessage({ tone: "error", text: toMessage(error) });
    }
  }

  return (
    <>
    <div className="space-y-5">
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
          数据源提示：{warnings.slice(0, 3).join("；")}
        </div>
      )}

      {message && (
        <div className={`rounded-lg border px-3 py-2 text-sm font-bold ${messageClass(message.tone)}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="启用类目" value={enabledCategories.length} hint={`${categories.length} 个总类目`} />
        <Metric label="Active 场景" value={activeScenes.length} hint={`${draftScenes.length} 个草稿`} />
        <Metric label="已发布版本" value={versions.filter((item) => item.status === "published").length} hint={publishedVersion ? formatDateTime(publishedVersion.published_at) : "未发布"} />
        <Metric label="前台链路" value="已接入" hint="上传识别 -> 推荐排序 -> 多选生成" />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-black text-slate-950">生产配置流程</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">推荐按“草稿导入 → 预览命中 → 发布版本 → 前台生效”走，避免直接改线上配置。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => run(refresh)} disabled={isPending} className="admin-tryon-btn admin-tryon-btn-secondary">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新
            </button>
            <button type="button" onClick={() => run(validateConfig)} disabled={isPending || !activeScenes.length} className="admin-tryon-btn admin-tryon-btn-secondary">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              校验配置
            </button>
            <button type="button" onClick={() => run(publishConfig)} disabled={isPending || !activeScenes.length} className="admin-tryon-btn admin-tryon-btn-primary">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              发布配置
            </button>
          </div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-4">
          {[
            ["1", "维护分类", "服装识别结果统一映射到后台类目 code。"],
            ["2", "导入场景", "主场景控制入口，子图集写入 raw_config.children。"],
            ["3", "预览推荐", "按类目、人群、年龄测试排序和命中原因。"],
            ["4", "发布版本", "写入 admin_config_versions，审计可追溯。"],
          ].map(([step, title, text]) => (
            <div key={step} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-950 text-xs font-black text-white">{step}</span>
              <p className="mt-3 text-sm font-black text-slate-950">{title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {validationIssues.length > 0 && (
        <ValidationIssuePanel issues={validationIssues} onClear={() => setValidationIssues([])} />
      )}

      <div className="flex flex-wrap gap-2">
        {[
          ["overview", "总览"],
          ["categories", "服装分类"],
          ["scenes", "系统场景"],
          ["import", "批量导入"],
          ["preview", "推荐预览"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value as typeof tab)}
            className={`h-9 rounded-lg px-3 text-xs font-black ${tab === value ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.8fr)]">
          <SceneOverview scenes={activeScenes.slice(0, 12)} />
          <VersionPanel versions={versions} onRollback={(id) => run(() => rollbackVersion(id))} />
        </div>
      )}

      {tab === "categories" && (
        <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <CategoryForm
            form={categoryForm}
            categories={categories}
            onChange={setCategoryForm}
            onSubmit={saveCategory}
            onSeed={() => run(seedCategories)}
            loading={isPending}
          />
          <CategoryTable
            categories={categories}
            onEdit={(category) => setCategoryForm(categoryToForm(category))}
            onDisable={(code) => run(() => disableCategory(code))}
          />
        </div>
      )}

      {tab === "scenes" && (
        <div className="grid gap-5 xl:grid-cols-[440px_minmax(0,1fr)]">
          <SceneForm
            form={sceneForm}
            categoryOptions={categoryOptions}
            onChange={setSceneForm}
            onSubmit={saveScene}
            loading={isPending}
          />
          <SceneList
            scenes={filteredScenes}
            categoryByCode={categoryByCode}
            search={sceneSearch}
            status={sceneStatusFilter}
            onSearch={setSceneSearch}
            onFilterStatus={setSceneStatusFilter}
            onEdit={(scene) => setSceneForm(sceneToForm(scene))}
            onStatus={(sceneKey, status) => run(() => updateSceneStatus(sceneKey, status))}
            onArchive={(sceneKey) => run(() => archiveScene(sceneKey))}
          />
        </div>
      )}

      {tab === "import" && (
        <ImportPanel
          rawText={importRawText}
          childRawText={importChildRawText}
          publish={importPublish}
          loading={isPending}
          onRawText={setImportRawText}
          onChildRawText={setImportChildRawText}
          onPublish={setImportPublish}
          errors={importErrors}
          onClearErrors={() => setImportErrors([])}
          onSubmit={importScenes}
        />
      )}

      {tab === "preview" && (
        <PreviewPanel
          subcategory={previewSubcategory}
          audience={previewAudience}
          age={previewAge}
          includeDraft={previewIncludeDraft}
          categories={categoryOptions}
          scenes={previewScenes}
          loading={isPending}
          onSubcategory={setPreviewSubcategory}
          onAudience={setPreviewAudience}
          onAge={setPreviewAge}
          onIncludeDraft={setPreviewIncludeDraft}
          onSubmit={previewRecommendations}
        />
      )}
    </div>
    <AlertDialog open={Boolean(confirmRequest)} onOpenChange={(open) => !open && setConfirmRequest(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmRequest?.title || "确认操作"}</AlertDialogTitle>
          <AlertDialogDescription>{confirmRequest?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirmRunning}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={confirmRequest?.destructive ? "destructive" : "default"}
            disabled={confirmRunning}
            onClick={runConfirm}
          >
            {confirmRequest?.confirmLabel || "确认"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-3 text-2xl font-black text-slate-950">{value}</p>
      <p className="mt-2 text-xs font-semibold text-slate-500">{hint}</p>
    </div>
  );
}

function ValidationIssuePanel({ issues, onClear }: { issues: ValidationIssue[]; onClear: () => void }) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50/70 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-red-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-black text-red-900">发布校验问题</h2>
          <p className="mt-1 text-xs font-semibold text-red-700">修复后再发布，避免前台读取到无效场景。</p>
        </div>
        <button type="button" onClick={onClear} className="admin-tryon-mini-btn bg-white">清空</button>
      </div>
      <div className="max-h-64 overflow-auto p-4">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-[0.08em] text-red-500">
              <th className="pb-2 pr-4">Scene</th>
              <th className="pb-2 pr-4">字段</th>
              <th className="pb-2">问题</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-red-100">
            {issues.slice(0, 60).map((issue, index) => (
              <tr key={`${issue.sceneKey}-${issue.field}-${index}`}>
                <td className="py-2 pr-4 font-mono text-xs font-bold text-red-900">{issue.sceneKey}</td>
                <td className="py-2 pr-4 font-mono text-xs text-red-700">{issue.field}</td>
                <td className="py-2 text-xs font-semibold text-red-800">{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CategoryForm({
  form,
  categories,
  onChange,
  onSubmit,
  onSeed,
  loading,
}: {
  form: typeof categoryBlank;
  categories: TryOnAdminCategoryRow[];
  onChange: (value: typeof categoryBlank) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onSeed: () => void;
  loading: boolean;
}) {
  const parents = categories.filter((category) => category.level === 1);
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-black text-slate-950">类目编辑</h2>
          <p className="mt-1 text-xs text-slate-500">识别模型输出必须最终落到这些 code。</p>
        </div>
        <button type="button" onClick={onSeed} disabled={loading} className="admin-tryon-btn admin-tryon-btn-secondary">
          <DatabaseZap className="h-3.5 w-3.5" />
          初始化
        </button>
      </div>
      <form onSubmit={onSubmit} className="grid gap-3 p-4">
        <Field label="Code" value={form.code} onChange={(value) => onChange({ ...form, code: value })} placeholder="single_fitted_top" required />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Level" value={form.level} onChange={(value) => onChange({ ...form, level: value })} options={[["1", "一级"], ["2", "二级"]]} />
          <label className="space-y-1.5">
            <span className="text-xs font-black text-slate-500">Parent</span>
            <select value={form.parent_code} onChange={(event) => onChange({ ...form, parent_code: event.target.value })} className="admin-tryon-input h-10">
              <option value="">无</option>
              {parents.map((parent) => <option key={parent.code} value={parent.code}>{parent.name_zh} · {parent.code}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="中文名" value={form.name_zh} onChange={(value) => onChange({ ...form, name_zh: value })} required />
          <Field label="英文名" value={form.name_en} onChange={(value) => onChange({ ...form, name_en: value })} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Slot" value={form.slot} onChange={(value) => onChange({ ...form, slot: value })} options={["upper", "lower", "single", "outer", "intimate", "functional"].map((item) => [item, item])} />
          <Field label="排序" value={form.sort_order} onChange={(value) => onChange({ ...form, sort_order: value })} />
        </div>
        <Textarea label="别名词（逗号分隔）" value={form.aliases} onChange={(value) => onChange({ ...form, aliases: value })} rows={2} />
        <Textarea label="识别标签（逗号分隔）" value={form.recognition_labels} onChange={(value) => onChange({ ...form, recognition_labels: value })} rows={2} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="默认镜头 tags" value={form.default_view_tags} onChange={(value) => onChange({ ...form, default_view_tags: value })} />
          <Field label="默认裁切 tags" value={form.default_crop_tags} onChange={(value) => onChange({ ...form, default_crop_tags: value })} />
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={form.is_intimate} onChange={(event) => onChange({ ...form, is_intimate: event.target.checked })} />
          成人/内衣敏感类目
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={form.enabled} onChange={(event) => onChange({ ...form, enabled: event.target.checked })} />
          启用
        </label>
        <Textarea label="Metadata JSON" value={form.metadata} onChange={(value) => onChange({ ...form, metadata: value })} rows={3} />
        <button type="submit" disabled={loading} className="admin-tryon-btn admin-tryon-btn-primary justify-center">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存类目
        </button>
      </form>
    </section>
  );
}

function CategoryTable({
  categories,
  onEdit,
  onDisable,
}: {
  categories: TryOnAdminCategoryRow[];
  onEdit: (category: TryOnAdminCategoryRow) => void;
  onDisable: (code: string) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-black text-slate-950">分类体系</h2>
        <p className="mt-1 text-xs text-slate-500">一级/二级树结构，禁用后不会参与发布校验和推荐匹配。</p>
      </div>
      <div className="max-h-[720px] overflow-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              {["类目", "Slot", "状态", "默认标签", "操作"].map((item) => (
                <th key={item} className="px-4 py-2 text-left text-xs font-black uppercase tracking-[0.08em] text-slate-400">{item}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map((category) => (
              <tr key={category.code} className={category.level === 1 ? "bg-slate-50/60" : "bg-white"}>
                <td className="px-4 py-3">
                  <p className="text-sm font-black text-slate-950">{category.level === 2 ? "└ " : ""}{category.name_zh}</p>
                  <p className="font-mono text-[11px] text-slate-400">{category.code}</p>
                </td>
                <td className="px-4 py-3 text-xs font-bold text-slate-600">{category.slot}</td>
                <td className="px-4 py-3"><AdminStatusBadge status={category.enabled ? "active" : "disabled"} /></td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {[...category.default_view_tags, ...category.default_crop_tags].slice(0, 4).join(", ") || "-"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => onEdit(category)} className="admin-tryon-mini-btn">编辑</button>
                    {category.enabled && <button type="button" onClick={() => onDisable(category.code)} className="admin-tryon-mini-btn text-red-600">停用</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SceneForm({
  form,
  categoryOptions,
  onChange,
  onSubmit,
  loading,
}: {
  form: typeof sceneBlank;
  categoryOptions: TryOnAdminCategoryRow[];
  onChange: (value: typeof sceneBlank) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  loading: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-black text-slate-950">场景编辑</h2>
        <p className="mt-1 text-xs text-slate-500">主场景展示在顶部，raw_config.children 会作为下方子图集。</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-3 p-4">
        <Field label="Scene Key" value={form.scene_key} onChange={(value) => onChange({ ...form, scene_key: value })} placeholder="scene_107237" required />
        <Field label="名称" value={form.name} onChange={(value) => onChange({ ...form, name: value })} required />
        <Field label="封面图片 URL" value={form.image_url} onChange={(value) => onChange({ ...form, image_url: value })} required />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="状态" value={form.status} onChange={(value) => onChange({ ...form, status: value })} options={[["draft", "draft"], ["active", "active"], ["archived", "archived"]]} />
          <Field label="优先级" value={form.priority} onChange={(value) => onChange({ ...form, priority: value })} />
          <Field label="排序" value={form.sort_order} onChange={(value) => onChange({ ...form, sort_order: value })} />
        </div>
        <label className="space-y-1.5">
          <span className="text-xs font-black text-slate-500">绑定类目</span>
          <select
            value=""
            onChange={(event) => {
              const code = event.target.value;
              if (!code) return;
              const current = splitCsv(form.cloth_categories);
              onChange({ ...form, cloth_categories: Array.from(new Set([...current, code])).join(",") });
            }}
            className="admin-tryon-input h-10"
          >
            <option value="">选择后追加</option>
            {categoryOptions.map((category) => <option key={category.code} value={category.code}>{category.name_zh} · {category.code}</option>)}
          </select>
        </label>
        <Textarea label="类目 code（逗号分隔）" value={form.cloth_categories} onChange={(value) => onChange({ ...form, cloth_categories: value })} rows={2} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="人群" value={form.gender} onChange={(value) => onChange({ ...form, gender: value })} options={["women", "men", "unisex", "all"].map((item) => [item, item])} />
          <Field label="年龄段" value={form.age_ranges} onChange={(value) => onChange({ ...form, age_ranges: value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="View Tags" value={form.view_tags} onChange={(value) => onChange({ ...form, view_tags: value })} />
          <Field label="Crop Tags" value={form.crop_tags} onChange={(value) => onChange({ ...form, crop_tags: value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Scene Tags" value={form.scene_tags} onChange={(value) => onChange({ ...form, scene_tags: value })} />
          <Field label="Style Tags" value={form.style_tags} onChange={(value) => onChange({ ...form, style_tags: value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Lens" value={form.lens} onChange={(value) => onChange({ ...form, lens: value })} />
          <Field label="Posture" value={form.posture} onChange={(value) => onChange({ ...form, posture: value })} />
        </div>
        <Textarea label="Raw Config JSON" value={form.raw_config} onChange={(value) => onChange({ ...form, raw_config: value })} rows={5} />
        <button type="submit" disabled={loading} className="admin-tryon-btn admin-tryon-btn-primary justify-center">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          保存场景
        </button>
      </form>
    </section>
  );
}

function SceneList({
  scenes,
  categoryByCode,
  search,
  status,
  onSearch,
  onFilterStatus,
  onEdit,
  onStatus,
  onArchive,
}: {
  scenes: TryOnAdminSceneRow[];
  categoryByCode: Map<string, TryOnAdminCategoryRow>;
  search: string;
  status: string;
  onSearch: (value: string) => void;
  onFilterStatus: (value: string) => void;
  onEdit: (scene: TryOnAdminSceneRow) => void;
  onStatus: (sceneKey: string, status: "draft" | "active" | "archived") => void;
  onArchive: (sceneKey: string) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-black text-slate-950">系统参考图</h2>
          <p className="mt-1 text-xs text-slate-500">Active 会进入前台推荐；Draft 可用于后台预览。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={status} onChange={(event) => onFilterStatus(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600">
            <option value="active">active</option>
            <option value="draft">draft</option>
            <option value="archived">archived</option>
            <option value="all">all</option>
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input value={search} onChange={(event) => onSearch(event.target.value)} className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs font-semibold outline-none focus:border-slate-400" placeholder="搜索名称 / 类目 / tag" />
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {scenes.map((scene) => {
          const children = Array.isArray(scene.raw_config?.children) ? scene.raw_config.children.length : 0;
          return (
            <article key={scene.scene_key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex gap-3 p-3">
                <ThumbnailStrip urls={[scene.image_url]} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <AdminStatusBadge status={scene.status} />
                    <span className="text-xs font-black text-slate-400">score +{scene.priority}</span>
                  </div>
                  <p className="mt-2 truncate text-sm font-black text-slate-950">{scene.name}</p>
                  <p className="truncate font-mono text-[11px] text-slate-400">{scene.scene_key}</p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {scene.cloth_categories.slice(0, 3).map((code) => categoryByCode.get(code)?.name_zh || code).join(" / ") || "未绑定类目"}
                  </p>
                  <p className="mt-1 text-[11px] font-bold text-slate-400">子图集 {children} · {scene.gender} · {scene.age_ranges.join(",")}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
                <span className="text-[11px] font-semibold text-slate-400">{formatDateTime(scene.updated_at)}</span>
	                <div className="flex gap-2">
	                  <button type="button" onClick={() => onEdit(scene)} className="admin-tryon-mini-btn">编辑</button>
	                  {scene.status !== "active" && <button type="button" onClick={() => onStatus(scene.scene_key, "active")} className="admin-tryon-mini-btn text-emerald-700"><Rocket className="h-3 w-3" />上架</button>}
	                  {scene.status === "active" && <button type="button" onClick={() => onStatus(scene.scene_key, "draft")} className="admin-tryon-mini-btn text-amber-700">转草稿</button>}
	                  {scene.status !== "archived" && <button type="button" onClick={() => onArchive(scene.scene_key)} className="admin-tryon-mini-btn text-red-600"><Archive className="h-3 w-3" />归档</button>}
	                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ImportPanel({
  rawText,
  childRawText,
  publish,
  loading,
  errors,
  onRawText,
  onChildRawText,
  onPublish,
  onClearErrors,
  onSubmit,
}: {
  rawText: string;
  childRawText: string;
  publish: boolean;
  loading: boolean;
  errors: ImportError[];
  onRawText: (value: string) => void;
  onChildRawText: (value: string) => void;
  onPublish: (value: boolean) => void;
  onClearErrors: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-black text-slate-950">批量导入主场景 / 子图集</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">主场景粘贴「场景主.txt」，子图集粘贴「场景子.txt」。导入器兼容 data.list 和 data[id].children。</p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4 p-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <Textarea label="主场景 rawText" value={rawText} onChange={onRawText} rows={14} placeholder='{"success":true,"data":{"list":[...]}}' />
          <Textarea label="子图集 childRawText" value={childRawText} onChange={onChildRawText} rows={14} placeholder='{"success":true,"data":{"107237":{"children":[...]}}}' />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={publish} onChange={(event) => onPublish(event.target.checked)} />
            导入后直接设为 active
          </label>
          <button type="submit" disabled={loading || !rawText.trim()} className="admin-tryon-btn admin-tryon-btn-primary">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseZap className="h-3.5 w-3.5" />}
            开始导入
          </button>
        </div>
      </form>
      {errors.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-black text-amber-900">导入失败明细</p>
            <button type="button" onClick={onClearErrors} className="admin-tryon-mini-btn bg-white">清空</button>
          </div>
          <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-amber-200 bg-white">
            {errors.slice(0, 80).map((item) => (
              <div key={`${item.index}-${item.error}`} className="grid grid-cols-[80px_1fr] gap-3 border-b border-amber-100 px-3 py-2 text-xs last:border-b-0">
                <span className="font-mono font-black text-amber-700">#{item.index}</span>
                <span className="font-semibold text-amber-900">{item.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PreviewPanel({
  subcategory,
  audience,
  age,
  includeDraft,
  categories,
  scenes,
  loading,
  onSubcategory,
  onAudience,
  onAge,
  onIncludeDraft,
  onSubmit,
}: {
  subcategory: string;
  audience: string;
  age: string;
  includeDraft: boolean;
  categories: TryOnAdminCategoryRow[];
  scenes: PreviewScene[];
  loading: boolean;
  onSubcategory: (value: string) => void;
  onAudience: (value: string) => void;
  onAge: (value: string) => void;
  onIncludeDraft: (value: boolean) => void;
  onSubmit: (event?: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-black text-slate-950">推荐排序预览</h2>
        <p className="mt-1 text-xs text-slate-500">上线前用真实类目预览前台“推荐场景”的排序和命中原因。</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 p-4">
        <label className="space-y-1.5">
          <span className="text-xs font-black text-slate-500">二级类目</span>
          <select value={subcategory} onChange={(event) => onSubcategory(event.target.value)} className="h-10 w-64 rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold text-slate-700">
            {categories.map((category) => <option key={category.code} value={category.code}>{category.name_zh} · {category.code}</option>)}
          </select>
        </label>
        <Select label="人群" value={audience} onChange={onAudience} options={[["women", "女装"], ["men", "男装"], ["unisex", "通用"]]} />
        <Select label="年龄" value={age} onChange={onAge} options={[["adult", "成人"], ["teen", "青少年"], ["big_child", "大童"], ["all", "全部"]]} />
        <label className="flex h-10 items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={includeDraft} onChange={(event) => onIncludeDraft(event.target.checked)} />
          包含草稿
        </label>
        <button type="submit" disabled={loading} className="admin-tryon-btn admin-tryon-btn-primary">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          预览
        </button>
      </form>
      <div className="grid gap-3 p-4 pt-0 md:grid-cols-2 xl:grid-cols-4">
        {scenes.map((scene, index) => (
          <article key={scene.id || scene.sceneKey} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="relative aspect-[3/4] bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={scene.imageUrl} alt={scene.name} className="h-full w-full object-cover" loading="lazy" />
              <span className="absolute left-2 top-2 rounded-md bg-slate-950 px-2 py-1 text-xs font-black text-white">#{index + 1}</span>
              <span className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-1 text-xs font-black text-slate-700">{scene.score}</span>
            </div>
            <div className="p-3">
              <p className="line-clamp-2 text-sm font-black text-slate-950">{scene.name}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-400">{scene.sceneKey}</p>
              <p className="mt-2 text-xs font-semibold text-slate-500">{scene.matchReasons.slice(0, 3).join(" / ") || "默认排序"}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SceneOverview({ scenes }: { scenes: TryOnAdminSceneRow[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-black text-slate-950">前台 Active 场景</h2>
        <p className="mt-1 text-xs text-slate-500">这些数据会进入用户侧“系统生成参考图”。</p>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {scenes.map((scene) => (
          <div key={scene.scene_key} className="rounded-lg border border-slate-200 p-3">
            <ThumbnailStrip urls={[scene.image_url]} />
            <p className="mt-3 truncate text-sm font-black text-slate-950">{scene.name}</p>
            <p className="truncate font-mono text-[11px] text-slate-400">{scene.scene_key}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">{scene.cloth_categories.slice(0, 3).join(", ") || "fallback tags"}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function VersionPanel({ versions, onRollback }: { versions: TryOnAdminConfigVersionRow[]; onRollback: (id: string) => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-black text-slate-950">配置版本</h2>
        <p className="mt-1 text-xs text-slate-500">发布、回滚都会写审计日志。</p>
      </div>
      <div className="divide-y divide-slate-100">
        {versions.slice(0, 8).map((version) => {
          const value = version.value || {};
          const sceneCount = Array.isArray(value.scenes) ? value.scenes.length : 0;
          const categoryCount = Array.isArray(value.categories) ? value.categories.length : 0;
          return (
            <div key={version.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <AdminStatusBadge status={version.status} />
                  <span className="font-mono text-[11px] font-bold text-slate-400">{version.id.slice(0, 8)}</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-500">{categoryCount} 类目 · {sceneCount} 场景 · {formatDateTime(version.published_at || version.created_at)}</p>
              </div>
              <button type="button" onClick={() => onRollback(version.id)} className="admin-tryon-mini-btn">
                <RotateCcw className="h-3 w-3" />
                回滚
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-black text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} className="admin-tryon-input h-10" />
    </label>
  );
}

function Textarea({ label, value, onChange, rows, placeholder }: { label: string; value: string; onChange: (value: string) => void; rows: number; placeholder?: string }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-black text-slate-500">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} className="admin-tryon-input min-h-0 py-2 font-mono text-xs" />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-black text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="admin-tryon-input h-10">
        {options.map(([optionValue, labelText]) => <option key={optionValue} value={optionValue}>{labelText}</option>)}
      </select>
    </label>
  );
}

async function readJson(url: string) {
  const res = await fetch(url);
  return parseResponse(res);
}

async function writeJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

async function patchJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

async function parseResponse(res: Response) {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminApiError(payload.error || `请求失败 (${res.status})`, payload);
  return payload;
}

class AdminApiError extends Error {
  payload: Record<string, unknown>;

  constructor(message: string, payload: Record<string, unknown>) {
    super(message);
    this.name = "AdminApiError";
    this.payload = payload;
  }
}

function splitCsv(value: string) {
  return Array.from(new Set(value.split(/[,\n|]+/).map((item) => item.trim()).filter(Boolean)));
}

function upsertBy<T extends Record<string, any>>(rows: T[], row: T, key: keyof T) {
  if (!row) return rows;
  const exists = rows.some((item) => item[key] === row[key]);
  return exists ? rows.map((item) => item[key] === row[key] ? row : item) : [row, ...rows];
}

function categoryToForm(category: TryOnAdminCategoryRow): typeof categoryBlank {
  return {
    code: category.code,
    parent_code: category.parent_code || "",
    level: String(category.level || 2),
    name_zh: category.name_zh || "",
    name_en: category.name_en || "",
    slot: category.slot || "upper",
    is_intimate: Boolean(category.is_intimate),
    aliases: stringifyList(category.aliases),
    recognition_labels: stringifyList(category.recognition_labels),
    default_view_tags: stringifyList(category.default_view_tags),
    default_crop_tags: stringifyList(category.default_crop_tags),
    enabled: category.enabled !== false,
    sort_order: String(category.sort_order || 0),
    metadata: JSON.stringify(category.metadata || {}, null, 2),
  };
}

function sceneToForm(scene: TryOnAdminSceneRow): typeof sceneBlank {
  return {
    scene_key: scene.scene_key,
    external_scene_id: scene.external_scene_id || "",
    name: scene.name || "",
    image_url: scene.image_url || "",
    status: scene.status || "draft",
    priority: String(scene.priority || 0),
    sort_order: String(scene.sort_order || 0),
    cloth_categories: stringifyList(scene.cloth_categories),
    gender: scene.gender || "women",
    age_ranges: stringifyList(scene.age_ranges),
    view_tags: stringifyList(scene.view_tags),
    crop_tags: stringifyList(scene.crop_tags),
    scene_tags: stringifyList(scene.scene_tags),
    style_tags: stringifyList(scene.style_tags),
    lens: scene.lens || "",
    posture: scene.posture || "",
    prompt_tags: stringifyList(scene.prompt_tags),
    raw_config: JSON.stringify(scene.raw_config || {}, null, 2),
  };
}

function stringifyList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).join(",") : "";
}

function messageClass(tone: "success" | "error" | "info") {
  if (tone === "success") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "error") return "border-red-200 bg-red-50 text-red-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-800";
}

function extractIssues(error: unknown): ValidationIssue[] {
  if (!(error instanceof AdminApiError)) return [];
  return Array.isArray(error.payload.issues)
    ? error.payload.issues.filter(isValidationIssue)
    : [];
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sceneKey === "string" && typeof record.field === "string" && typeof record.message === "string";
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
