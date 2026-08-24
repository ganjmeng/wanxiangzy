"use client";

import { useMemo, useState } from "react";
import { FileCode2, Loader2, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";

import {
  AdminNotice,
  AdminSection,
  AdminStatusBadge,
  AdminTable,
} from "@/components/admin/AdminPrimitives";
import type { AgentSkill } from "@/lib/creative-skills";

type Props = {
  initialSkills: AgentSkill[];
  canManage: boolean;
  warnings: string[];
};

const NEW_SKILL: AgentSkill = {
  id: "system:new-skill",
  name: "新官方 Skill",
  description: "说明这个 Skill 适用于什么创作任务。",
  plannerSummary: "给规划器的简短能力摘要。",
  instructions: "写清楚执行顺序、输出要求、素材约束，以及不能猜测的事实。",
  enabled: false,
  keywords: [],
  capabilities: ["image", "canvas"],
  action: "generate",
  requiresReference: false,
  defaultConfig: {},
  referenceRoles: [],
  scope: "system",
  sourceType: "local",
};

export function AdminAgentSkillsClient({ initialSkills, canManage, warnings }: Props) {
  const [skills, setSkills] = useState(initialSkills);
  const [editing, setEditing] = useState<AgentSkill | null>(null);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const metrics = useMemo(() => ({
    enabled: skills.filter((skill) => skill.enabled !== false).length,
    image: skills.filter((skill) => skill.capabilities.includes("image")).length,
    video: skills.filter((skill) => skill.capabilities.includes("video")).length,
    canvas: skills.filter((skill) => skill.capabilities.includes("canvas")).length,
  }), [skills]);

  const openEditor = (skill: AgentSkill) => {
    setEditing(skill);
    setDraft(JSON.stringify(skill, null, 2));
    setReason("");
  };

  const save = async (override?: AgentSkill, automaticReason?: string) => {
    if (saving) return;
    let value = override;
    try {
      value ||= JSON.parse(draft) as AgentSkill;
    } catch {
      toast.error("Skill 配置不是有效 JSON");
      return;
    }
    const operationReason = (automaticReason || reason).trim();
    if (operationReason.length < 4) {
      toast.error("请填写至少 4 个字的操作原因");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/admin/creative-skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill: value, reason: operationReason }),
      });
      const payload = await response.json().catch(() => ({})) as { skill?: AgentSkill; error?: string };
      if (!response.ok || !payload.skill) throw new Error(payload.error || "系统 Skill 保存失败");
      setSkills((current) => [payload.skill!, ...current.filter((item) => item.id !== payload.skill!.id)]);
      setEditing(null);
      toast.success(`已发布 ${payload.skill.name} v${payload.skill.currentVersion || 1}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "系统 Skill 保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {warnings.length ? <AdminNotice tone="info">{warnings.join("；")}</AdminNotice> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="已启用" value={`${metrics.enabled} / ${skills.length}`} />
        <Metric label="图片 Agent" value={String(metrics.image)} />
        <Metric label="视频 Agent" value={String(metrics.video)} />
        <Metric label="无限画布" value={String(metrics.canvas)} />
      </div>
      <AdminSection
        title="官方 Skill 注册表"
        description="发布会生成不可变版本快照；停用只影响新任务，历史任务继续使用提交时版本。"
        actions={canManage ? <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--admin-fg)] px-3 text-xs font-black text-[var(--admin-surface)]" onClick={() => openEditor({ ...NEW_SKILL, id: `system:${crypto.randomUUID()}` })}><Plus className="size-3.5" />新建官方 Skill</button> : null}
      >
        <AdminTable<AgentSkill>
          rows={skills}
          rowKey={(skill) => skill.id}
          empty="暂无系统 Skill"
          columns={[
            { key: "skill", label: "Skill", render: (skill) => <div className="min-w-[260px]"><div className="flex items-center gap-2"><AdminStatusBadge status={skill.enabled === false ? "disabled" : "published"} /><span className="font-mono text-[10px] text-[var(--admin-faint)]">v{skill.currentVersion || 1}</span></div><p className="mt-1 text-sm font-black text-[var(--admin-fg)]">{skill.name}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--admin-muted)]">{skill.description}</p></div> },
            { key: "workspace", label: "入口", render: (skill) => <div className="flex max-w-[220px] flex-wrap gap-1">{skill.capabilities.map((item) => <span key={item} className="rounded-md bg-[var(--admin-surface-soft)] px-2 py-1 text-[11px] font-black text-[var(--admin-fg)]">{item === "image" ? "图片" : item === "video" ? "视频" : "画布"}</span>)}</div> },
            { key: "source", label: "来源", render: (skill) => <div className="max-w-[220px]"><p className="flex items-center gap-1 text-xs font-black text-[var(--admin-fg)]"><FileCode2 className="size-3.5" />{skill.sourceType || "local"}</p><p className="mt-1 truncate font-mono text-[10px] text-[var(--admin-faint)]">{skill.sourceCommit || skill.sourceVersion || skill.sourcePath || "站内配置"}</p></div> },
            { key: "action", label: "行为", render: (skill) => <span className="text-xs font-black text-[var(--admin-fg)]">{skill.action === "edit" ? "编辑素材" : "生成内容"}{skill.requiresReference ? " · 需素材" : ""}</span> },
            { key: "actions", label: "操作", render: (skill) => canManage ? <div className="flex items-center gap-2"><button type="button" className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2 text-xs font-black" onClick={() => openEditor(skill)}><Pencil className="size-3.5" />编辑</button><button type="button" disabled={saving} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2 text-xs font-black" onClick={() => void save({ ...skill, enabled: skill.enabled === false }, skill.enabled === false ? "后台启用官方 Skill" : "后台停用官方 Skill")}><Power className="size-3.5" />{skill.enabled === false ? "启用" : "停用"}</button></div> : <span className="text-xs text-[var(--admin-muted)]">只读</span> },
          ]}
        />
      </AdminSection>
      {editing ? <div className="fixed inset-0 z-[180] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="编辑官方 Skill"><div className="max-h-[92vh] w-full max-w-[980px] overflow-y-auto rounded-xl bg-[var(--admin-surface)] p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-black text-[var(--admin-fg)]">编辑官方 Skill</h2><p className="mt-1 text-xs leading-5 text-[var(--admin-muted)]">完整配置会经过服务端 Schema 归一化，并发布为 v{(editing.currentVersion || 0) + 1}。</p></div><button type="button" className="text-sm font-black text-[var(--admin-muted)]" onClick={() => setEditing(null)}>关闭</button></div><textarea className="mt-4 min-h-[480px] w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-soft)] p-3 font-mono text-xs leading-5 text-[var(--admin-fg)] outline-none focus:border-[var(--admin-info)]" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /><label className="mt-4 block"><span className="mb-2 block text-xs font-black text-[var(--admin-muted)]">发布原因</span><input className="h-10 w-full rounded-lg border border-[var(--admin-border)] bg-transparent px-3 text-sm text-[var(--admin-fg)] outline-none" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：补充商品视频的声音参考角色" /></label><div className="mt-4 flex justify-end gap-2"><button type="button" className="h-9 rounded-lg border border-[var(--admin-border)] px-4 text-xs font-black" onClick={() => setEditing(null)} disabled={saving}>取消</button><button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--admin-fg)] px-4 text-xs font-black text-[var(--admin-surface)] disabled:opacity-50" onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="size-3.5 animate-spin" /> : null}发布新版本</button></div></div></div> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"><p className="text-xs font-black text-[var(--admin-muted)]">{label}</p><p className="mt-2 text-2xl font-black text-[var(--admin-fg)]">{value}</p></div>;
}
