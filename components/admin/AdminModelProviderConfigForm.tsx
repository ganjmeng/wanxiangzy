"use client";

import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plug, Save } from "lucide-react";
import { AdminStatusBadge } from "@/components/admin/AdminPrimitives";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { PricedImageModel } from "@/lib/model-pricing";

type ResponseType = "openai-image" | "gemini-native" | "kie-market";

type SnapshotEntry = {
  model: PricedImageModel;
  enabled: boolean;
  baseUrl: string;
  upstreamModel: string;
  responseType: ResponseType;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  source: "admin" | "env";
};

type Snapshot = {
  configKey: string;
  versionId?: string;
  publishedAt?: string | null;
  models: SnapshotEntry[];
};

const MODEL_LABELS: Record<PricedImageModel, string> = {
  "nano-banana-2": "Nano Banana 2",
  "nano-banana-2-lite": "Nano Banana 2 Lite",
  "nano-banana-pro": "Nano Banana Pro",
  "gpt-image-2": "GPT-Image-2",
  qwen3: "Qwen3 Image",
  "qwen3-pro": "Qwen3 Image Pro",
  "z-image": "Z-Image",
};

const RESPONSE_TYPE_OPTIONS: ReadonlyArray<{ value: ResponseType; label: string }> = [
  { value: "gemini-native", label: "Gemini native (generateContent)" },
  { value: "openai-image", label: "OpenAI image (/images/generations)" },
  { value: "kie-market", label: "Kie Market (异步任务)" },
];

export function AdminModelProviderConfigForm() {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/model-providers", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `加载失败 (${res.status})`);
      setSnapshot(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const models = useMemo(() => snapshot?.models || [], [snapshot]);
  const [testingModel, setTestingModel] = useState<string | null>(null);

  async function testConnection(model: PricedImageModel) {
    const entry = models.find((item) => item.model === model);
    if (!entry) return;
    const key = apiKeys[model]?.trim() || (entry.apiKeyConfigured ? "" : "");
    if (!key && !entry.apiKeyConfigured) {
      toast.error("请先填写该模型的 API Key");
      return;
    }
    setTestingModel(model);
    try {
      const res = await fetch("/api/admin/model-providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, baseUrl: entry.baseUrl, apiKey: key || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `测试失败 (${res.status})`);
      toast.success(payload.message || "连接成功：密钥有效，可正常访问模型接口");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "连接测试失败");
    } finally {
      setTestingModel(null);
    }
  }

  function updateModel(model: PricedImageModel, patch: Partial<SnapshotEntry>) {
    setSnapshot((current) => current ? {
      ...current,
      models: current.models.map((entry) => entry.model === model ? { ...entry, ...patch } : entry),
    } : current);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    void confirm({
      title: "确认发布生图供应商配置？",
      content: "发布后新生成任务会立即使用新的供应商连接，请确认配置无误。",
      okText: "确认发布",
      onOk: doSubmit,
    });
  }

  async function doSubmit() {
    if (!snapshot) return;
    setSaving(true);
    setMessage("");

    const modelsPayload = Object.fromEntries(
      snapshot.models.map((entry) => [
        entry.model,
        {
          enabled: entry.enabled,
          baseUrl: entry.baseUrl,
          upstreamModel: entry.upstreamModel,
          responseType: entry.responseType,
          apiKey: apiKeys[entry.model]?.trim() || "",
        },
      ]),
    );

    try {
      const res = await fetch("/api/admin/model-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: modelsPayload }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || `保存失败 (${res.status})`);
      setMessage("已发布，新生成任务会立即使用新的供应商配置。");
      setApiKeys({});
      await load();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="p-4 text-sm font-bold text-[var(--admin-muted)]">正在加载供应商配置…</p>;
  }

  if (error || !snapshot) {
    return <p className="p-4 text-sm font-bold text-[var(--admin-danger)]">{error || "暂无配置"}</p>;
  }

  return (
    <>
    {confirmDialog}
    <form onSubmit={submit} className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] px-3 py-2 text-xs text-[var(--admin-muted)]">
        <span>配置键 <code className="font-black text-[var(--admin-fg)]">{snapshot.configKey}</code>；API Key 使用 AES-256-GCM 加密后落库，页面只显示脱敏值。</span>
        <AdminStatusBadge status={snapshot.versionId ? "published" : "draft"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {models.map((entry) => (
          <section key={entry.model} className="space-y-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black text-[var(--admin-fg)]">{MODEL_LABELS[entry.model]}</p>
                <p className="font-mono text-[11px] font-bold text-[var(--admin-muted)]">{entry.model}</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-[var(--admin-fg)]">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={(event) => updateModel(entry.model, { enabled: event.target.checked })}
                  className="h-4 w-4"
                />
                启用
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-black text-[var(--admin-muted)]">响应类型</span>
              <select
                value={entry.responseType}
                onChange={(event) => updateModel(entry.model, { responseType: event.target.value as ResponseType })}
                className="h-9 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 text-xs font-bold text-[var(--admin-fg)]"
              >
                {RESPONSE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-black text-[var(--admin-muted)]">Base URL</span>
              <input
                value={entry.baseUrl}
                onChange={(event) => updateModel(entry.model, { baseUrl: event.target.value })}
                placeholder="https://api.new.bi 或 https://api.new.bi/v1"
                className="h-9 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 font-mono text-xs font-semibold text-[var(--admin-fg)]"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-black text-[var(--admin-muted)]">Upstream Model</span>
              <input
                value={entry.upstreamModel}
                onChange={(event) => updateModel(entry.model, { upstreamModel: event.target.value })}
                placeholder="gpt-image-2 / gemini-3.1-flash-image / gemini-3-pro-image"
                className="h-9 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 font-mono text-xs font-semibold text-[var(--admin-fg)]"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-black text-[var(--admin-muted)]">API Key</span>
              <input
                type="password"
                value={apiKeys[entry.model] || ""}
                onChange={(event) => setApiKeys((current) => ({ ...current, [entry.model]: event.target.value }))}
                placeholder={entry.apiKeyConfigured ? `${entry.apiKeyMasked}（留空则不修改）` : "输入新 Key"}
                className="h-9 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 font-mono text-xs font-semibold text-[var(--admin-fg)]"
              />
              <span className="text-[11px] text-[var(--admin-muted)]">
                来源：{entry.source}；{entry.apiKeyConfigured ? `已配置 ${entry.apiKeyMasked}` : "未配置"}
              </span>
            </label>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={Boolean(testingModel)}
          onClick={() => void testConnection(models[0]?.model)}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 text-sm font-black text-[var(--admin-fg)] disabled:opacity-60"
        >
          {testingModel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          测试连接
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--admin-fg)] px-4 text-sm font-black text-white disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存并发布
        </button>
        {message && (
          <p className={`text-sm font-bold ${message.includes("已发布") ? "text-[var(--admin-success)]" : "text-[var(--admin-danger)]"}`}>
            {message}
          </p>
        )}
      </div>
    </form>
    </>
  );
}
