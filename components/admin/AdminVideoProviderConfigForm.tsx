"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { AdminStatusBadge } from "@/components/admin/AdminPrimitives";
import { useConfirm } from "@/components/ui/confirm-dialog";

type VideoProviderName = "minimax" | "seedance" | "seedance25" | "wan";

type SnapshotEntry = {
  key: VideoProviderName;
  enabled: boolean;
  provider: VideoProviderName;
  baseUrl: string;
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

const PROVIDER_LABELS: Record<VideoProviderName, string> = {
  minimax: "MiniMax H3（768p / 2K）",
  seedance: "豆包 Seedance 2.0（mini / fast / 标准）",
  seedance25: "豆包 Seedance 2.5",
  wan: "Wan 3.0",
};

const PROVIDER_BASE_URLS: Record<VideoProviderName, string> = {
  minimax: "https://api.kie.ai",
  seedance: "https://api.kie.ai",
  seedance25: "https://api.kie.ai",
  wan: "https://api.kie.ai",
};

const EMPTY_KEYS: Record<VideoProviderName, string> = { minimax: "", seedance: "", seedance25: "", wan: "" };

export function AdminVideoProviderConfigForm() {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [apiKeys, setApiKeys] = useState<Record<VideoProviderName, string>>({ ...EMPTY_KEYS });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/video-providers", { cache: "no-store" });
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

  const entries = useMemo(() => snapshot?.models ?? [], [snapshot]);

  function updateEntry(key: VideoProviderName, patch: Partial<SnapshotEntry>) {
    setSnapshot((current) => current ? {
      ...current,
      models: current.models.map((item) => item.key === key ? { ...item, ...patch } : item),
    } : current);
  }

  function setApiKey(key: VideoProviderName, value: string) {
    setApiKeys((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot) return;
    void confirm({
      title: "确认发布视频生成配置？",
      content: "发布后视频生成会立即切换供应商，请确认配置无误。",
      okText: "确认发布",
      onOk: doSubmit,
    });
  }

  async function doSubmit() {
    setSaving(true);
    setMessage("");

    const providers = Object.fromEntries(
      entries.map((entry) => [
        entry.key,
        {
          enabled: entry.enabled,
          baseUrl: entry.baseUrl,
          apiKey: (apiKeys[entry.key] || "").trim(),
        },
      ]),
    );

    try {
      const res = await fetch("/api/admin/video-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: { video: { providers } } }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `保存失败 (${res.status})`);
      setMessage("已发布，视频生成会立即使用新的供应商配置。");
      setApiKeys({ ...EMPTY_KEYS });
      await load();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-4 text-sm font-bold text-[var(--admin-muted)]">正在加载视频供应商配置…</p>;
  if (error || !snapshot) return <p className="p-4 text-sm font-bold text-[var(--admin-danger)]">{error || "暂无配置"}</p>;

  return (
    <>
    {confirmDialog}
    <form onSubmit={submit} className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] px-3 py-2 text-xs text-[var(--admin-muted)]">
        <span>配置键 <code className="font-black text-[var(--admin-fg)]">{snapshot.configKey}</code>；每个模型可独立启停并配置 API Key（AES-256-GCM 加密落库）。</span>
        <AdminStatusBadge status={snapshot.versionId ? "published" : "draft"} />
      </div>

      {entries.map((entry) => (
        <section key={entry.key} className="space-y-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black text-[var(--admin-fg)]">{PROVIDER_LABELS[entry.key]}</p>
              <p className="font-mono text-[11px] font-bold text-[var(--admin-muted)]">video.{entry.key}</p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-[var(--admin-fg)]">
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={(event) => updateEntry(entry.key, { enabled: event.target.checked })}
                className="h-4 w-4"
              />
              启用
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] font-black text-[var(--admin-muted)]">Base URL</span>
            <input
              value={entry.baseUrl}
              onChange={(event) => updateEntry(entry.key, { baseUrl: event.target.value })}
              placeholder={PROVIDER_BASE_URLS[entry.key]}
              className="h-9 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 font-mono text-xs font-semibold text-[var(--admin-fg)]"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-black text-[var(--admin-muted)]">API Key</span>
            <input
              type="password"
              value={apiKeys[entry.key] || ""}
              onChange={(event) => setApiKey(entry.key, event.target.value)}
              placeholder={entry.apiKeyConfigured ? `${entry.apiKeyMasked}（留空则不修改）` : "输入新 Key"}
              className="h-9 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 font-mono text-xs font-semibold text-[var(--admin-fg)]"
            />
            <span className="text-[11px] text-[var(--admin-muted)]">
              来源：{entry.source}；{entry.apiKeyConfigured ? `已配置 ${entry.apiKeyMasked}` : "未配置"}
            </span>
          </label>
        </section>
      ))}

      <div className="flex items-center gap-3">
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
