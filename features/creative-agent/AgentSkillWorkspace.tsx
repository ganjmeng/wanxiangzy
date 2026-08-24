"use client";

import Image from "next/image";
import { ImageIcon, Plus, Sparkles, X } from "lucide-react";
import type { ResourceAsset } from "@/features/resource-library";
import type { AgentSkill, SkillReferenceRole } from "./AgentComposerControls";

export type SkillRunMode = "quick" | "professional";
export type SkillRoleAssignments = Record<string, ResourceAsset[]>;

export function AgentSkillWorkspace({
  skill,
  mode,
  assignments,
  unassignedAssets,
  onModeChange,
  onRemoveSkill,
  onAddToRole,
  onAssignExisting,
  onRemoveFromRole,
}: {
  skill: AgentSkill;
  mode: SkillRunMode;
  assignments: SkillRoleAssignments;
  unassignedAssets: ResourceAsset[];
  onModeChange: (mode: SkillRunMode) => void;
  onRemoveSkill: () => void;
  onAddToRole: (role: SkillReferenceRole) => void;
  onAssignExisting: (role: SkillReferenceRole, assetId: string) => void;
  onRemoveFromRole: (roleId: string, assetId: string) => void;
}) {
  const roles = getSkillRoles(skill).filter((role) => !role.modes || role.modes.includes(mode));

  return (
    <div className="mb-4 min-w-0">
      <div className="inline-flex h-11 max-w-full items-center rounded-xl border border-[#d8e0e8] bg-[#f3f6fa] px-2.5 text-[#3f4c59] shadow-[inset_0_0_0_1px_rgba(224,230,237,0.55)] dark:border-[#36404b] dark:bg-[#252b33] dark:text-[#e6eaf0]">
        <Sparkles className="mr-2 size-4 shrink-0 text-[#ad7925]" />
        <span className="max-w-[230px] truncate text-sm font-semibold">Skill · {skill.name}</span>
        <div className="ml-3 flex rounded-lg bg-[#e8edf3] p-0.5 dark:bg-[#303741]" role="group" aria-label={`${skill.name}运行模式`}>
          <button type="button" className={`h-7 rounded-md px-2.5 text-xs font-semibold transition ${mode === "quick" ? "bg-white text-[#20242a] shadow-sm dark:bg-[#454e5a] dark:text-white" : "text-[#66717e] dark:text-[#aeb7c2]"}`} onClick={() => onModeChange("quick")} aria-pressed={mode === "quick"}>快速</button>
          <button type="button" className={`h-7 rounded-md px-2.5 text-xs font-semibold transition ${mode === "professional" ? "bg-white text-[#20242a] shadow-sm dark:bg-[#454e5a] dark:text-white" : "text-[#66717e] dark:text-[#aeb7c2]"}`} onClick={() => onModeChange("professional")} aria-pressed={mode === "professional"}>专业</button>
        </div>
        <button type="button" className="ml-2 grid size-7 shrink-0 place-items-center rounded-md text-[#6f7a87] hover:bg-white hover:text-[#20242a] dark:hover:bg-[#3a424d] dark:hover:text-white" onClick={onRemoveSkill} aria-label={`移除 Skill ${skill.name}`}><X className="size-4" /></button>
      </div>

      <section className="mt-3 rounded-[18px] border border-[#dfe4e9] bg-[#fafbfd] p-3.5 dark:border-[#333b45] dark:bg-[#1d2127]" aria-label="参考素材角色">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-sm font-semibold">参考素材角色</h3><p className="mt-1 text-xs text-[#8a95a2]">把素材放到明确角色中；这里不会发起生成。</p></div>
          <span className="shrink-0 pt-0.5 text-[11px] text-[#9aa4af]">可拖入下方框</span>
        </div>

        {unassignedAssets.length ? <div className="mt-3 flex flex-wrap gap-1.5" aria-label="待分配素材">{unassignedAssets.map((asset) => <button key={asset.id} type="button" draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-agent-asset-id", asset.id); }} className="inline-flex h-8 max-w-[220px] cursor-grab items-center gap-1.5 rounded-lg border border-[#d7dfe7] bg-white px-2.5 text-xs text-[#687482] active:cursor-grabbing dark:border-[#3a434e] dark:bg-[#252b33] dark:text-[#b6bec8]" title="拖入下方角色框"><ImageIcon className="size-3.5 shrink-0" /><span className="truncate">{asset.title || asset.id}</span></button>)}</div> : null}

        <div className={`mt-3 grid gap-2.5 ${roles.length > 1 ? "lg:grid-cols-2" : ""}`}>
          {roles.map((role) => (
            <SkillRoleDropzone
              key={role.id}
              role={role}
              assets={assignments[role.id] || []}
              onAdd={() => onAddToRole(role)}
              onDropAsset={(assetId) => onAssignExisting(role, assetId)}
              onRemove={(assetId) => onRemoveFromRole(role.id, assetId)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SkillRoleDropzone({ role, assets, onAdd, onDropAsset, onRemove }: { role: SkillReferenceRole; assets: ResourceAsset[]; onAdd: () => void; onDropAsset: (assetId: string) => void; onRemove: (assetId: string) => void }) {
  const full = assets.length >= role.maxCount;
  return (
    <div
      className="min-h-[122px] rounded-xl border border-dashed border-[#cbd5df] bg-white/70 p-3 transition hover:border-[#9eb2c4] dark:border-[#414b56] dark:bg-[#20252c]"
      onDragOver={(event) => { if (!full) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(event) => { event.preventDefault(); if (!full) onDropAsset(event.dataTransfer.getData("application/x-agent-asset-id")); }}
    >
      <div className="flex items-start justify-between gap-3">
        <div><h4 className="text-[13px] font-semibold">{role.label} · {role.required ? "必填" : "可选"}</h4><p className="mt-1.5 text-[11px] leading-4 text-[#8d98a5]">最多 {role.maxCount} 项{role.description ? ` · ${role.description}` : ""}</p></div>
        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#d7dfe7] bg-white text-[#27313a] transition hover:border-[#aebbc7] hover:bg-[#f4f6f8] disabled:opacity-35 dark:border-[#414b56] dark:bg-[#292f37] dark:text-white" onClick={onAdd} disabled={full} aria-label={`添加到${role.label}`}><Plus className="size-4" /></button>
      </div>
      {assets.length ? <div className="mt-3 flex flex-wrap gap-2">{assets.map((asset) => <div key={asset.id} className="group relative size-14 overflow-hidden rounded-lg border border-[#dce2e8] bg-[#eef1f4] dark:border-[#414b56]">{asset.mediaType === "video" ? <video src={asset.url} poster={asset.previewUrl || undefined} muted playsInline className="h-full w-full object-cover" /> : <Image src={asset.previewUrl || asset.url} alt={asset.title || role.label} fill unoptimized sizes="56px" className="object-cover" />}<button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-bl-md bg-[#555f6b]/90 text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => onRemove(asset.id)} aria-label={`从${role.label}移除${asset.title || "素材"}`}><X className="size-3" /></button></div>)}</div> : <p className="mt-7 text-[11px] text-[#a1abb6]">拖入素材，或点击右上角选择</p>}
    </div>
  );
}

function getSkillRoles(skill: AgentSkill): SkillReferenceRole[] {
  if (skill.referenceRoles?.length) return skill.referenceRoles;
  if (skill.requiresReference) return [{ id: "reference", label: "参考素材", required: true, maxCount: 10, description: "执行该 Skill 所需素材" }];
  return [];
}
