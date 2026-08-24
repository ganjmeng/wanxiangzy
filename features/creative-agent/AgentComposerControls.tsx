"use client";

import { cloneElement, useEffect, useRef, useState } from "react";
import {
  AtSign, Bot, Boxes, Check, ChevronDown, Github, ImageIcon, Loader2, Mic2, Pencil, Plus,
  SlidersHorizontal, Sparkles, Trash2, Video, WandSparkles, X,
} from "lucide-react";

import { AgentGenerationPreferencesPanel } from "./AgentGenerationPreferencesPanel";
import { BUILTIN_AGENT_SKILLS, type AgentSkill, type SkillReferenceRole } from "@/lib/creative-skills";

export { BUILTIN_AGENT_SKILLS };
export type { AgentSkill, SkillReferenceRole };

export type AgentCreationMode = "agent" | "image" | "video" | "audio";
export type AgentCapability = "image" | "video" | "audio";
export type AgentModelOption = {
  id: string;
  name: string;
  description: string;
  capability: AgentCapability;
  provider?: "minimax" | "seedance";
  videoMode?: "mini" | "fast" | "pro";
  resolutions?: string[];
  durations?: number[];
};
export type ReferenceMode = "reference" | "first_frame" | "first_last";
export type AgentGenerationPreferences = {
  image: { aspectRatio: string; imageSize: "1K" | "2K" | "4K"; quality?: "smart" | "high" | "medium" | "low"; count: number; customWidth: string; customHeight: string };
  video: { aspectRatio: string; resolution: string; count: number; seconds: number; generateAudio: boolean; watermark: boolean; referenceMode: ReferenceMode };
  audio: { voice: string; format: "mp3" | "wav"; speed: number };
};

export const DEFAULT_AGENT_PREFERENCES: AgentGenerationPreferences = {
  image: { aspectRatio: "auto", imageSize: "1K", quality: "smart", count: 1, customWidth: "", customHeight: "" },
  video: { aspectRatio: "auto", resolution: "720p", count: 1, seconds: 5, generateAudio: true, watermark: false, referenceMode: "reference" },
  audio: { voice: "智能匹配", format: "mp3", speed: 1 },
};

const toolButtonClass = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[#66717e] transition hover:bg-[#f2f4f6] hover:text-[#20242a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6965e8]/30 disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#a3acb7] dark:hover:bg-[#292f37] dark:hover:text-white";
const panelClass = "absolute bottom-full left-0 z-[70] mb-2 max-h-[300px] overflow-y-auto rounded-[18px] border border-[#e1e5e9] bg-white p-4 text-[#20242a] shadow-[0_18px_50px_rgba(22,28,36,0.18)] dark:border-[#363c45] dark:bg-[#20242a] dark:text-[#f4f5f7]";

export function AgentComposerControls(props: {
  mode: AgentCreationMode;
  preferredCapability: AgentCapability;
  models: AgentModelOption[];
  selectedModelIds: string[];
  smartPlanning: boolean;
  preferences: AgentGenerationPreferences;
  skills: AgentSkill[];
  selectedSkillId: string;
  optimizing: boolean;
  canOptimize: boolean;
  onModeChange: (mode: AgentCreationMode) => void;
  onPreferredCapabilityChange: (capability: AgentCapability) => void;
  onToggleModel: (id: string) => void;
  onSmartPlanningChange: (value: boolean) => void;
  onPreferencesChange: (value: AgentGenerationPreferences) => void;
  onReference: () => void;
  onSkillChange: (id: string) => void;
  onCreateSkill: (skill: AgentSkill) => Promise<void>;
  onUpdateSkill: (skill: AgentSkill) => Promise<void>;
  onDeleteSkill: (skillId: string) => Promise<void>;
  onImportSkill: (url: string, path?: string) => Promise<{ skill?: AgentSkill; candidates: Array<{ path: string; name: string }> }>;
  onOptimize: () => void;
}) {
  const [open, setOpen] = useState<"mode" | "models" | "preferences" | "skills" | "">("");
  const [createSkillOpen, setCreateSkillOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<AgentSkill | null>(null);
  const [importSkillOpen, setImportSkillOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedModels = props.models.filter((model) => props.selectedModelIds.includes(model.id));

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(""); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(""); };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); };
  }, [open]);

  const capability = props.mode === "agent" ? props.preferredCapability : props.mode === "audio" ? "audio" : props.mode;
  const label = props.mode === "agent" ? "Agent 模式" : props.mode === "image" ? "图片生成" : props.mode === "video" ? "视频生成" : "音频生成";

  return (
    <div ref={rootRef} className="flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:gap-1.5">
      <ControlButton icon={<Bot className="size-4" />} label={label} active={open === "mode"} onClick={() => setOpen(open === "mode" ? "" : "mode")}>
        {open === "mode" ? <ModePanel value={props.mode} onChange={(value) => { props.onModeChange(value); setOpen(""); }} /> : null}
      </ControlButton>
      <ControlButton icon={<Sparkles className="size-4" />} label={selectedModels.length ? `${selectedModels.length} 个模型` : "智能模型"} active={open === "models"} onClick={() => setOpen(open === "models" ? "" : "models")}>
        {open === "models" ? <ModelPanel {...props} capability={capability} /> : null}
      </ControlButton>
      <ControlButton icon={<SlidersHorizontal className="size-4" />} label="生成参数" active={open === "preferences"} onClick={() => setOpen(open === "preferences" ? "" : "preferences")}>
        {open === "preferences" ? (
          <AgentGenerationPreferencesPanel
            capability={capability}
            preferences={props.preferences}
            onCapability={(value) => {
              props.onPreferredCapabilityChange(value);
              if (props.mode !== "agent") props.onModeChange(value);
            }}
            onChange={props.onPreferencesChange}
          />
        ) : null}
      </ControlButton>
      <button type="button" className={toolButtonClass} onClick={props.onReference}><AtSign className="size-4" /><span>引用</span></button>
      <ControlButton icon={<Boxes className="size-4" />} label="使用 Skill" active={open === "skills"} onClick={() => setOpen(open === "skills" ? "" : "skills")}>
        {open === "skills" ? <SkillPanel skills={props.skills} selectedId={props.selectedSkillId} onSelect={(id) => { props.onSkillChange(id); setOpen(""); }} onCreate={() => { setEditingSkill(null); setOpen(""); setCreateSkillOpen(true); }} onImport={() => { setOpen(""); setImportSkillOpen(true); }} onEdit={(skill) => { setEditingSkill(skill); setOpen(""); setCreateSkillOpen(true); }} onDelete={props.onDeleteSkill} onToggle={(skill) => props.onUpdateSkill({ ...skill, enabled: skill.enabled === false })} /> : null}
      </ControlButton>
      <button type="button" className={toolButtonClass} disabled={!props.canOptimize || props.optimizing} onClick={props.onOptimize}>{props.optimizing ? <Loader2 className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}<span>优化</span></button>
      <CreateSkillDialog open={createSkillOpen} initialSkill={editingSkill} onClose={() => { setCreateSkillOpen(false); setEditingSkill(null); }} onSubmit={async (skill) => { if (editingSkill) await props.onUpdateSkill(skill); else await props.onCreateSkill(skill); props.onSkillChange(skill.enabled === false ? "" : skill.id); setCreateSkillOpen(false); setEditingSkill(null); }} />
      <ImportSkillDialog open={importSkillOpen} onClose={() => setImportSkillOpen(false)} onImport={props.onImportSkill} />
    </div>
  );
}

function ControlButton({ icon, label, active, onClick, children }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <div className="relative"><button type="button" className={`${toolButtonClass} ${active ? "bg-[#edf1f4] text-[#20242a] dark:bg-[#30363e] dark:text-white" : ""}`} onClick={onClick} aria-expanded={active}>{icon}<span className="max-w-[130px] truncate">{label}</span><ChevronDown className="size-3.5" /></button>{children}</div>;
}

function ModePanel({ value, onChange }: { value: AgentCreationMode; onChange: (value: AgentCreationMode) => void }) {
  const options: Array<{ value: AgentCreationMode; label: string; description: string; icon: React.ReactNode }> = [
    { value: "agent", label: "Agent 模式", description: "自动理解需求并匹配能力", icon: <Bot className="size-4" /> },
    { value: "image", label: "图片生成", description: "生成或编辑图片", icon: <ImageIcon className="size-4" /> },
    { value: "video", label: "视频生成", description: "使用参考图生成视频", icon: <Video className="size-4" /> },
    { value: "audio", label: "音频生成", description: "配音、旁白和音频（待配置）", icon: <Mic2 className="size-4" /> },
  ];
  return <div className={`${panelClass} w-[330px]`}><h3 className="mb-3 text-sm font-semibold">创作类型</h3>{options.map((item) => <button key={item.value} type="button" className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[#f4f6f8] dark:hover:bg-[#2b3037]" onClick={() => onChange(item.value)}><span className="grid size-9 place-items-center rounded-xl bg-[#f2f4f6] text-[#66717e] dark:bg-[#2b3037] dark:text-[#b4bdc8]">{item.icon}</span><span className="min-w-0 flex-1"><strong className="block text-sm font-medium">{item.label}</strong><small className="mt-0.5 block text-xs text-[#929ba7]">{item.description}</small></span>{value === item.value ? <Check className="size-4" /> : null}</button>)}</div>;
}

function ModelPanel(props: Parameters<typeof AgentComposerControls>[0] & { capability: AgentCapability }) {
  const [tab, setTab] = useState<AgentCapability>(props.capability);
  const filtered = props.models.filter((model) => model.capability === tab);
  return <div className={`${panelClass} w-[390px] max-w-[calc(100vw-32px)]`}><div className="flex items-start justify-between"><div><h3 className="text-sm font-semibold">选择模型</h3><p className="mt-2 text-xs text-[#929ba7]">默认由智能规划自动匹配</p></div><button type="button" className={`flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${props.smartPlanning ? "bg-[#e9f2f7] text-[#294a5d]" : "bg-[#f0f2f4] text-[#68727e]"}`} onClick={() => props.onSmartPlanningChange(!props.smartPlanning)}>智能<span className={`relative h-6 w-11 rounded-full transition ${props.smartPlanning ? "bg-[#4f89a8]" : "bg-[#c6cbd1]"}`}><span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition ${props.smartPlanning ? "left-[22px]" : "left-0.5"}`} /></span></button></div><div className="mt-5 grid grid-cols-3 rounded-2xl bg-[#eef0f3] p-1 dark:bg-[#17191d]">{(["image", "video", "audio"] as const).map((value) => <button key={value} type="button" className={`h-10 rounded-xl text-sm font-semibold ${tab === value ? "bg-white shadow-sm dark:bg-[#30363e]" : "text-[#697381]"}`} onClick={() => setTab(value)}>{value === "image" ? "图片" : value === "video" ? "视频" : "音频"} · {props.models.filter((item) => item.capability === value).length}</button>)}</div><div className="mt-3 max-h-[260px] overflow-y-auto">{filtered.length ? filtered.map((model) => { const selected = props.selectedModelIds.includes(model.id); return <button key={model.id} type="button" className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[#f5f6f8] dark:hover:bg-[#2b3037]" onClick={() => props.onToggleModel(model.id)}><span className="grid size-9 place-items-center rounded-xl bg-white shadow-sm dark:bg-[#30363e]">{model.capability === "video" ? <Video className="size-4" /> : <Sparkles className="size-4" />}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{model.name}</strong><small className="mt-0.5 block truncate text-xs text-[#929ba7]">{model.description}</small></span><span className={`grid size-5 place-items-center rounded-md border ${selected ? "border-[#20242a] bg-[#20242a] text-white dark:border-white dark:bg-white dark:text-[#20242a]" : "border-[#ccd2d9]"}`}>{selected ? <Check className="size-3.5" /> : null}</span></button>; }) : <div className="py-8 text-center text-xs text-[#929ba7]">当前站点尚未配置可用的{tab === "audio" ? "音频" : tab === "video" ? "视频" : "图片"}模型</div>}</div><p className="mt-2 text-[11px] text-[#9aa2ad]">可同时选择最多 6 个模型，并行生成并分别进入任务队列。</p></div>;
}

function SkillPanel({
  skills, selectedId, onSelect, onCreate, onImport, onEdit, onDelete, onToggle,
}: {
  skills: AgentSkill[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onEdit: (skill: AgentSkill) => void;
  onDelete: (skillId: string) => Promise<void>;
  onToggle: (skill: AgentSkill) => Promise<void>;
}) {
  const tabs = ["all", "image", "video", "canvas", "edit"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>("all");
  const [busyId, setBusyId] = useState("");
  const filtered = tab === "all" ? skills : tab === "edit" ? skills.filter((skill) => skill.action === "edit") : skills.filter((skill) => skill.capabilities.includes(tab));
  const moveTab = (offset: number) => setTab(tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length]);
  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try { await action(); } finally { setBusyId(""); }
  };
  return (
    <div className={panelClass + " !bottom-auto top-full !mb-0 mt-2 w-[440px] max-w-[calc(100vw-32px)]"}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">选择创作 Skill</h3>
        {selectedId ? <button type="button" className="text-xs text-[#7b8490] hover:text-[#20242a]" onClick={() => onSelect("")}>清除</button> : null}
      </div>
      <div className="mt-4 flex items-center gap-1">
        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-[#f2f4f6]" onClick={() => moveTab(-1)} aria-label="向左查看更多 Skill 分类">‹</button>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map((value) => {
            const count = value === "all" ? skills.length : value === "edit" ? skills.filter((skill) => skill.action === "edit").length : skills.filter((skill) => skill.capabilities.includes(value)).length;
            return <button key={value} type="button" className={"h-9 shrink-0 rounded-xl border px-3 text-sm font-semibold " + (tab === value ? "border-[#bdd1dd] bg-[#eef5f8]" : "border-[#e1e5e9]")} onClick={() => setTab(value)}>{value === "all" ? "全部" : value === "image" ? "图片" : value === "video" ? "视频" : value === "canvas" ? "画布" : "编辑"} · {count}</button>;
          })}
        </div>
        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-[#f2f4f6]" onClick={() => moveTab(1)} aria-label="向右查看更多 Skill 分类">›</button>
      </div>
      <div className="mt-3 max-h-[280px] overflow-y-auto">
        {filtered.map((skill) => {
          const own = skill.userCreated || skill.scope === "user";
          const disabled = skill.enabled === false;
          return (
            <div key={skill.id} className={"group flex items-start gap-2 rounded-xl px-2 py-2 " + (disabled ? "opacity-65" : "hover:bg-[#f5f6f8] dark:hover:bg-[#2b3037]")}>
              <button type="button" className="flex min-w-0 flex-1 gap-3 text-left" disabled={disabled} onClick={() => onSelect(skill.id)}>
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef7fb] text-sky-500"><ImageIcon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <strong className="flex items-center gap-2 text-sm font-medium">{skill.name}{own ? <small className="rounded bg-[#eef0f3] px-1.5 py-0.5 text-[9px] text-[#697381]">我的</small> : null}{disabled ? <small className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-700">未启用</small> : null}</strong>
                  <small className="mt-1 line-clamp-2 block text-xs leading-5 text-[#929ba7]">{skill.description}</small>
                </span>
                {selectedId === skill.id ? <Check className="mt-2 size-4 shrink-0" /> : null}
              </button>
              {own ? (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" className="grid size-8 place-items-center rounded-lg text-[#7d8793] hover:bg-white hover:text-[#20242a]" onClick={() => void runAction(skill.id + ":toggle", () => onToggle(skill))} aria-label={disabled ? "启用 Skill" : "停用 Skill"} disabled={Boolean(busyId)}>{busyId === skill.id + ":toggle" ? <Loader2 className="size-3.5 animate-spin" /> : <span className="text-[10px] font-semibold">{disabled ? "启用" : "停用"}</span>}</button>
                  <button type="button" className="grid size-8 place-items-center rounded-lg text-[#7d8793] hover:bg-white hover:text-[#20242a]" onClick={() => onEdit(skill)} aria-label="编辑 Skill"><Pencil className="size-3.5" /></button>
                  <button type="button" className="grid size-8 place-items-center rounded-lg text-[#7d8793] hover:bg-red-50 hover:text-red-600" onClick={() => { if (window.confirm("确定永久删除这个 Skill 及其版本记录吗？")) void runAction(skill.id + ":delete", () => onDelete(skill.id)); }} aria-label="删除 Skill">{busyId === skill.id + ":delete" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-[#cbd2da] text-sm font-semibold hover:bg-[#f5f6f8]" onClick={onCreate}><Plus className="size-4" />创建 Skill</button>
        <button type="button" className="flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-[#cbd2da] text-sm font-semibold hover:bg-[#f5f6f8]" onClick={onImport}><Github className="size-4" />导入 SKILL.md</button>
      </div>
    </div>
  );
}

function CreateSkillDialog({ open, initialSkill, onClose, onSubmit }: { open: boolean; initialSkill: AgentSkill | null; onClose: () => void; onSubmit: (skill: AgentSkill) => Promise<void> }) {
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [description, setDescription] = useState("");
  const [plannerSummary, setPlannerSummary] = useState("");
  const [instructions, setInstructions] = useState("");
  const [action, setAction] = useState<"generate" | "edit">("generate");
  const [needsReference, setNeedsReference] = useState(false);
  const [capabilities, setCapabilities] = useState<Array<"image" | "video" | "canvas">>(["image", "canvas"]);
  const [defaultConfig, setDefaultConfig] = useState("{}");
  const [referenceRoles, setReferenceRoles] = useState("[]");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initialSkill?.name || "");
    setKeywords(initialSkill?.keywords.join("，") || "");
    setDescription(initialSkill?.description || "");
    setPlannerSummary(initialSkill?.plannerSummary || "");
    setInstructions(initialSkill?.instructions || "");
    setAction(initialSkill?.action || "generate");
    setNeedsReference(Boolean(initialSkill?.requiresReference));
    setCapabilities(initialSkill?.capabilities || ["image", "canvas"]);
    setDefaultConfig(JSON.stringify(initialSkill?.defaultConfig || {}, null, 2));
    setReferenceRoles(JSON.stringify(initialSkill?.referenceRoles || [], null, 2));
    setEnabled(initialSkill?.enabled !== false);
    setError("");
  }, [initialSkill, open]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose, saving]);

  if (!open) return null;
  const valid = Boolean(name.trim() && description.trim() && instructions.trim() && capabilities.length);
  const submit = async () => {
    if (!valid || saving) return;
    setError("");
    let parsedDefaults: Record<string, string | number | boolean>;
    let parsedRoles: SkillReferenceRole[];
    try {
      const defaultsValue = JSON.parse(defaultConfig || "{}") as unknown;
      const rolesValue = JSON.parse(referenceRoles || "[]") as unknown;
      if (!defaultsValue || typeof defaultsValue !== "object" || Array.isArray(defaultsValue)) throw new Error("默认参数必须是 JSON 对象");
      if (!Array.isArray(rolesValue)) throw new Error("素材角色必须是 JSON 数组");
      parsedDefaults = defaultsValue as Record<string, string | number | boolean>;
      parsedRoles = rolesValue as SkillReferenceRole[];
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "JSON 配置无效");
      return;
    }
    const skill: AgentSkill = {
      ...(initialSkill || {}),
      id: initialSkill?.id || "custom:" + crypto.randomUUID(),
      name: name.trim(),
      keywords: keywords.split(/[，,\s]+/).filter(Boolean).slice(0, 30),
      description: description.trim(),
      plannerSummary: plannerSummary.trim() || description.trim(),
      instructions: instructions.trim(),
      capabilities,
      action,
      requiresReference: needsReference || parsedRoles.some((role) => role.required),
      defaultConfig: parsedDefaults,
      referenceRoles: parsedRoles,
      enabled,
      scope: "user",
      sourceType: initialSkill?.sourceType || "local",
      userCreated: true,
    };
    setSaving(true);
    try { await onSubmit(skill); } catch (reason) { setError(reason instanceof Error ? reason.message : "Skill 保存失败"); } finally { setSaving(false); }
  };
  const toggleCapability = (value: "image" | "video" | "canvas") => setCapabilities((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={initialSkill ? "编辑 Skill" : "创建我的 Skill"} onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-[900px] overflow-y-auto rounded-[22px] bg-white p-6 shadow-2xl dark:bg-[#20242a] sm:p-8">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{initialSkill ? "编辑 Skill" : "创建我的 Skill"}</h2><p className="mt-2 text-sm leading-6 text-[#817b77]">规则由服务端保存、校验、版本化，并在 Agent 与无限画布共用。</p></div><button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-[#f2f4f6]" onClick={onClose} aria-label="关闭 Skill 弹窗"><X className="size-5" /></button></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2"><Field label="Skill 名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：我的家具电商套图" /></Field><Field label="触发关键词"><input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="家具，主图，详情页" /></Field></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="用途说明"><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="说明适用商品、平台和交付物" /></Field><Field label="Planner 摘要"><textarea value={plannerSummary} onChange={(event) => setPlannerSummary(event.target.value)} rows={3} placeholder="给规划器的简短能力摘要" /></Field></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="执行方式"><select value={action} onChange={(event) => setAction(event.target.value as "generate" | "edit")}><option value="generate">生成新内容</option><option value="edit">编辑参考素材</option></select></Field><div><span className="mb-2 block text-sm font-medium">状态与引用</span><div className="flex gap-2"><Toggle label="需要素材" checked={needsReference} onChange={setNeedsReference} /><Toggle label="启用" checked={enabled} onChange={setEnabled} /></div></div></div>
        <div className="mt-4"><span className="mb-2 block text-sm font-medium">可用位置</span><div className="flex gap-2">{(["image", "video", "canvas"] as const).map((value) => <button key={value} type="button" aria-pressed={capabilities.includes(value)} className={"h-9 rounded-xl border px-4 text-xs font-semibold " + (capabilities.includes(value) ? "border-[#8fa9b8] bg-[#eef5f8]" : "border-[#dfe3e8]")} onClick={() => toggleCapability(value)}>{value === "image" ? "图片 Agent" : value === "video" ? "视频 Agent" : "画布 Agent"}</button>)}</div></div>
        <div className="mt-4"><Field label="执行规则"><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={7} placeholder="写清 Agent 应先理解什么、确认什么、每个结果怎样分工，以及哪些事实不能猜测。" /></Field></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="默认参数 JSON"><textarea value={defaultConfig} onChange={(event) => setDefaultConfig(event.target.value)} rows={7} spellCheck={false} /></Field><Field label="参考素材角色 JSON"><textarea value={referenceRoles} onChange={(event) => setReferenceRoles(event.target.value)} rows={7} spellCheck={false} placeholder={'[{"id":"product","label":"商品图","required":true,"maxCount":4}]'} /></Field></div>
        {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2"><button type="button" className="h-10 rounded-xl border border-[#dfe3e8] px-5 text-sm font-medium" onClick={onClose} disabled={saving}>取消</button><button type="button" className="flex h-10 items-center gap-2 rounded-xl bg-[#20242a] px-5 text-sm font-medium text-white disabled:opacity-40" disabled={!valid || saving} onClick={() => void submit()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{initialSkill ? "保存新版本" : "创建并使用"}</button></div>
      </div>
    </div>
  );
}

function ImportSkillDialog({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (url: string, path?: string) => Promise<{ skill?: AgentSkill; candidates: Array<{ path: string; name: string }> }> }) {
  const [url, setUrl] = useState("");
  const [candidates, setCandidates] = useState<Array<{ path: string; name: string }>>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setCandidates([]); setSelectedPath(""); setError(""); } }, [open]);
  if (!open) return null;
  const submit = async () => {
    if (!url.trim() || loading) return;
    setLoading(true); setError("");
    try {
      const result = await onImport(url.trim(), selectedPath || undefined);
      if (result.skill) { onClose(); return; }
      setCandidates(result.candidates);
      setSelectedPath(result.candidates[0]?.path || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "GitHub Skill 导入失败"); } finally { setLoading(false); }
  };
  return (
    <div className="fixed inset-0 z-[125] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="从 GitHub 导入 SKILL.md" onMouseDown={(event) => { if (event.currentTarget === event.target && !loading) onClose(); }}>
      <div className="w-full max-w-[640px] rounded-[22px] bg-white p-6 shadow-2xl dark:bg-[#20242a] sm:p-8">
        <div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold">导入 GitHub SKILL.md</h2><p className="mt-2 text-sm leading-6 text-[#817b77]">仅读取公开 SKILL.md，固定到不可变 commit 并校验内容哈希；仓库代码不会执行。</p></div><button type="button" className="grid size-9 place-items-center rounded-lg hover:bg-[#f2f4f6]" onClick={onClose} aria-label="关闭导入弹窗"><X className="size-5" /></button></div>
        <div className="mt-6"><Field label="GitHub 仓库、目录或 SKILL.md 地址"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo/tree/main/skills/example" /></Field></div>
        {candidates.length ? <div className="mt-4"><Field label="选择 SKILL.md"><select value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)}>{candidates.map((candidate) => <option key={candidate.path} value={candidate.path}>{candidate.name} · {candidate.path}</option>)}</select></Field></div> : null}
        {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2"><button type="button" className="h-10 rounded-xl border border-[#dfe3e8] px-5 text-sm" onClick={onClose} disabled={loading}>取消</button><button type="button" className="flex h-10 items-center gap-2 rounded-xl bg-[#20242a] px-5 text-sm font-medium text-white disabled:opacity-40" disabled={!url.trim() || loading} onClick={() => void submit()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <Github className="size-4" />}{candidates.length ? "导入所选 Skill" : "检查并导入"}</button></div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactElement<{ className?: string }> }) { return <label className="block"><span className="mb-2 block text-sm font-medium">{label}</span>{cloneElement(children, { className: `w-full rounded-xl border border-[#dfe3e8] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[#8e9ba8] ${children.props.className || ""}` })}</label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <button type="button" className={`flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-medium ${checked ? "bg-[#e9f2f7] text-[#294a5d]" : "bg-[#f2f3f5] text-[#68727e] dark:bg-[#2b3037]"}`} onClick={() => onChange(!checked)}><span className={`relative h-5 w-9 rounded-full ${checked ? "bg-[#4f89a8]" : "bg-[#c6cbd1]"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${checked ? "left-[18px]" : "left-0.5"}`} /></span>{label}</button>; }
