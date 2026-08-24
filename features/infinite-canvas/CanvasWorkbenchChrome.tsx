"use client";

import {
  ArrowUp,
  Bot,
  Check,
  CircleDot,
  Compass,
  Eraser,
  Focus,
  FolderOpen,
  Globe2,
  Hand,
  HelpCircle,
  History,
  ImageIcon,
  LibraryBig,
  Loader2,
  Menu,
  MessageSquarePlus,
  MousePointer2,
  Music2,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Settings2,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  Workflow,
} from "lucide-react";
import type { CreativeRunClient } from "@/lib/creative-runs.server";
import type { AgentSkill } from "@/lib/creative-skills";
import type { CanvasNode } from "@/lib/canvas-contract";
import styles from "./infinite-canvas.module.css";

export type CanvasTool = "pan" | "select";
export type CanvasPanelTab = "chat" | "history";
export type CanvasBackground = "dots" | "lines" | "blank";
export type CanvasSaveState = "saved" | "dirty" | "saving" | "error";

export function CanvasTopBar({
  title,
  saveState,
  assetsOpen,
  agentOpen,
  onTitleChange,
  onOpenLibrary,
  onToggleAssets,
  onToggleAgent,
  onSave,
}: {
  title: string;
  saveState: CanvasSaveState;
  assetsOpen: boolean;
  agentOpen: boolean;
  onTitleChange: (value: string) => void;
  onOpenLibrary: () => void;
  onToggleAssets: () => void;
  onToggleAgent: () => void;
  onSave: () => void;
}) {
  return (
    <header className={styles.originalTopbar}>
      <div className={styles.originalTopbarLeft}>
        <button type="button" className={styles.roundIconButton} aria-label="返回画布库" onClick={onOpenLibrary}><Menu /></button>
        <div className={styles.canvasTitleWrap}>
          <input value={title} maxLength={120} aria-label="画布名称" onChange={(event) => onTitleChange(event.target.value)} />
        </div>
        <span className={styles.topbarDivider} />
        <button type="button" className={styles.assetsTopButton} data-active={assetsOpen || undefined} onClick={onToggleAssets}><LibraryBig /><span>资产</span></button>
      </div>
      <div className={styles.originalTopbarRight}>
        <button type="button" className={styles.savePill} data-error={saveState === "error" || undefined} onClick={onSave} disabled={saveState === "saving"}>
          {saveState === "saving" ? <Loader2 className="animate-spin" /> : <Check />}
          {saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "保存"}
        </button>
        <button type="button" className={styles.agentToggle} onClick={onToggleAgent}>{agentOpen ? <PanelRightClose /> : <PanelRightOpen />}<span>Agent</span></button>
      </div>
    </header>
  );
}

const TOOL_GROUPS = [
  [
    { key: "text", label: "文本", icon: Type },
    { key: "image", label: "图片", icon: ImageIcon },
    { key: "panorama", label: "全景图", icon: Globe2 },
    { key: "video", label: "视频", icon: Video },
    { key: "audio", label: "音频", icon: Music2 },
    { key: "config", label: "生成配置", icon: Settings2 },
    { key: "upload", label: "上传素材", icon: Upload },
  ],
  [
    { key: "assets", label: "资产", icon: FolderOpen },
    { key: "layout", label: "一键整理", icon: Workflow },
    { key: "appearance", label: "画布外观", icon: Palette },
  ],
] as const;

export function CanvasBottomToolbar({
  interactionMode,
  canUndo,
  canRedo,
  hasSelection,
  background,
  onInteractionModeChange,
  onUndo,
  onRedo,
  onTool,
  onDelete,
  onClear,
  onBackgroundChange,
}: {
  interactionMode: CanvasTool;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  background: CanvasBackground;
  onInteractionModeChange: (value: CanvasTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onTool: (tool: string) => void;
  onDelete: () => void;
  onClear: () => void;
  onBackgroundChange: (value: CanvasBackground) => void;
}) {
  return (
    <div className={styles.toolbarDockWrap}>
      <div className={styles.toolbarDock}>
        <ToolButton label={interactionMode === "pan" ? "切换到框选模式" : "切换到小手模式"} active onClick={() => onInteractionModeChange(interactionMode === "pan" ? "select" : "pan")}>
          {interactionMode === "pan" ? <Hand /> : <MousePointer2 />}
        </ToolButton>
        <ToolButton label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 /></ToolButton>
        <ToolButton label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 /></ToolButton>
        <DockDivider />
        {TOOL_GROUPS[0].map((tool) => <ToolButton key={tool.key} label={tool.label} onClick={() => onTool(tool.key)}><tool.icon /></ToolButton>)}
        <DockDivider />
        {TOOL_GROUPS[1].map((tool) => tool.key === "appearance" ? (
          <div key={tool.key} className={styles.appearanceControl}>
            <ToolButton label={tool.label} onClick={() => onTool(tool.key)}><tool.icon /></ToolButton>
            <div className={styles.appearanceMenu}>
              {(["dots", "lines", "blank"] as const).map((value) => <button key={value} type="button" data-active={background === value || undefined} onClick={() => onBackgroundChange(value)}>{value === "dots" ? <CircleDot /> : value === "lines" ? <Workflow /> : <span className={styles.blankSwatch} />}{value === "dots" ? "点" : value === "lines" ? "线" : "空白"}</button>)}
            </div>
          </div>
        ) : <ToolButton key={tool.key} label={tool.label} onClick={() => onTool(tool.key)}><tool.icon /></ToolButton>)}
        {hasSelection ? <><DockDivider /><ToolButton label="删除选中" danger onClick={onDelete}><Trash2 /></ToolButton></> : null}
        <DockDivider />
        <ToolButton label="清空画布" danger onClick={onClear}><Eraser /></ToolButton>
      </div>
    </div>
  );
}

function ToolButton({ label, active, disabled, danger, onClick, children }: { label: string; active?: boolean; disabled?: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={styles.dockTool} data-active={active || undefined} data-danger={danger || undefined} disabled={disabled} aria-label={label} data-tooltip={label} onClick={onClick}>{children}</button>;
}

function DockDivider() { return <span className={styles.dockDivider} />; }

export function CanvasZoomControls({ scale, minimapOpen, onScaleChange, onReset, onToggleMinimap }: { scale: number; minimapOpen: boolean; onScaleChange: (scale: number) => void; onReset: () => void; onToggleMinimap: () => void }) {
  return (
    <div className={styles.zoomControls}>
      <button type="button" data-active={minimapOpen || undefined} aria-label="小地图" onClick={onToggleMinimap}><Compass /></button>
      <button type="button" aria-label="重置视图" onClick={onReset}><Focus /></button>
      <input type="range" min="25" max="240" value={Math.round(scale * 100)} onChange={(event) => onScaleChange(Number(event.target.value) / 100)} aria-label="画布缩放" />
      <span>{Math.round(scale * 100)}%</span>
      <button type="button" aria-label="快捷键" title="拖动画布；滚轮缩放；Shift 点击多选；⌘Z 撤销；Delete 删除"><HelpCircle /></button>
    </div>
  );
}

const QUICK_ACTIONS = [
  { title: "生成一套新品发布海报", subtitle: "营造促销氛围，突出产品亮点", icon: ImageIcon },
  { title: "优化当前画布布局", subtitle: "提升对齐与信息效率", icon: Workflow },
  { title: "撰写一段产品宣传文案", subtitle: "突出卖点，吸引用户", icon: Type },
  { title: "增强画面质感", subtitle: "提升细节与光影表现", icon: Sparkles },
  { title: "批量替换文案与图片", subtitle: "复用版式快速生成", icon: MessageSquarePlus },
  { title: "生成多套设计方案", subtitle: "并行探索不同创意方向", icon: LibraryBig },
] as const;

export function CanvasAgentPanel({
  open,
  tab,
  prompt,
  generating,
  runs,
  skills,
  selectedSkillId,
  selectedNodeTitle,
  nodes,
  nodeCount,
  generationPreferences,
  skillWorkspace,
  onClose,
  onTabChange,
  onPromptChange,
  onSubmit,
  onNewConversation,
  onQuickAction,
  onAddReference,
  onSelectSkill,
  onGenerationPreferencesChange,
}: {
  open: boolean;
  tab: CanvasPanelTab;
  prompt: string;
  generating: boolean;
  runs: CreativeRunClient[];
  skills: AgentSkill[];
  selectedSkillId: string;
  selectedNodeTitle?: string;
  nodes: CanvasNode[];
  nodeCount: number;
  generationPreferences: { aspectRatio: string; imageSize: string; count: number };
  skillWorkspace?: React.ReactNode;
  onClose: () => void;
  onTabChange: (tab: CanvasPanelTab) => void;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onNewConversation: () => void;
  onQuickAction: (value: string) => void;
  onAddReference: () => void;
  onSelectSkill: (id: string) => void;
  onGenerationPreferencesChange: (value: { aspectRatio: string; imageSize: string; count: number }) => void;
}) {
  if (!open) return null;
  return (
    <aside className={styles.originalAgentPanel}>
      <header className={styles.agentHeader}>
        <span className={styles.agentAvatar}><Bot /></span>
        <div><strong>Agent</strong><p>画布助手 · 让创意落地更简单</p></div>
        <button type="button" aria-label="关闭 Agent" onClick={onClose}><PanelRightClose /></button>
      </header>
      <div className={styles.agentTabs}>
        <button type="button" data-active={tab === "chat" || undefined} onClick={() => onTabChange("chat")}>对话</button>
        <button type="button" data-active={tab === "history" || undefined} onClick={() => onTabChange("history")}><History />历史</button>
        <button type="button" className={styles.newConversation} onClick={onNewConversation}><Plus />新建对话</button>
      </div>
      <div className={styles.agentScroll}>
        {tab === "history" ? <CanvasRunHistory runs={runs} onUse={(value) => { onPromptChange(value); onTabChange("chat"); }} /> : (
          <>
            {!runs.length ? (
              <>
                <section className={styles.agentWelcome}>
                  <div><h3>你好，我是你的画布助手</h3><p>我可以帮你生成图像、优化布局、撰写文案、梳理思路、提取关键信息，让创意更高效实现。</p><button type="button" onClick={() => onQuickAction("介绍你能在当前画布中完成的任务")}>了解 Agent 能做什么 <ArrowUp /></button></div>
                  <Sparkles />
                </section>
                <div className={styles.tryHeading}><strong>你可以试试</strong><Sparkles /></div>
                <div className={styles.quickGrid}>{QUICK_ACTIONS.map((item) => <button key={item.title} type="button" onClick={() => onQuickAction(item.title)}><item.icon /><strong>{item.title}</strong><span>{item.subtitle}</span></button>)}</div>
              </>
            ) : <CanvasRunHistory runs={runs} compact onUse={onPromptChange} />}
            {selectedNodeTitle ? <div className={styles.selectedContext}><Focus /><span>已引用画布节点</span><strong>{selectedNodeTitle}</strong></div> : <div className={styles.canvasContext}><Bot /><span>已读取当前画布</span><strong>{nodeCount} 个节点</strong></div>}
            {skillWorkspace}
          </>
        )}
      </div>
      <div className={styles.agentComposerOriginal}>
        <div className={styles.composerTopline}>
          <button type="button" aria-label="添加素材" onClick={onAddReference}><Plus /></button>
          <textarea value={prompt} maxLength={4000} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSubmit(); } }} placeholder="描述你想让 Agent 如何操作画布" />
        </div>
        <div className={styles.composerBottomline}>
          <span><Sparkles /></span><span className={styles.smartMode}>智能</span>
          <select value={selectedSkillId} onChange={(event) => onSelectSkill(event.target.value)} aria-label="选择画布 Skill"><option value="">智能 · 1张</option>{skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select>
          <select value="" aria-label="引用画布节点" onChange={(event) => { const node = nodes.find((item) => item.id === event.target.value); if (node) onPromptChange(`${prompt}${prompt && !prompt.endsWith(" ") ? " " : ""}@${node.title} `); }}><option value="">@ 引用</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select>
          <a className={styles.promptLibraryLink} href="/prompts">提示词</a>
          <details className={styles.generationSettings}>
            <summary><Settings2 />{generationPreferences.aspectRatio === "auto" ? "智能" : generationPreferences.aspectRatio} · {generationPreferences.count}张</summary>
            <div>
              <label>画面比例<select value={generationPreferences.aspectRatio} aria-label="输出比例" onChange={(event) => onGenerationPreferencesChange({ ...generationPreferences, aspectRatio: event.target.value })}><option value="auto">智能比例</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="21:9">21:9</option></select></label>
              <label>清晰度<select value={generationPreferences.imageSize} aria-label="图片尺寸" onChange={(event) => onGenerationPreferencesChange({ ...generationPreferences, imageSize: event.target.value })}><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></select></label>
              <label>生成数量<select value={generationPreferences.count} aria-label="生成张数" onChange={(event) => onGenerationPreferencesChange({ ...generationPreferences, count: Number(event.target.value) })}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}张</option>)}</select></label>
            </div>
          </details>
          <button type="button" className={styles.sendButton} disabled={!prompt.trim() || generating} onClick={onSubmit}>{generating ? <Loader2 className="animate-spin" /> : <ArrowUp />}</button>
        </div>
      </div>
    </aside>
  );
}

function CanvasRunHistory({ runs, compact, onUse }: { runs: CreativeRunClient[]; compact?: boolean; onUse: (value: string) => void }) {
  if (!runs.length) return <div className={styles.emptyHistory}><History /><strong>暂无画布对话</strong><span>发送第一条消息后，记录会保存在这里。</span></div>;
  return <div className={compact ? styles.compactRuns : styles.runHistory}>{runs.map((run) => <button type="button" key={run.id} onClick={() => onUse(run.intent)}><span data-status={run.status}>{["queued", "running", "draft"].includes(run.status) ? <Loader2 className="animate-spin" /> : <Check />}</span><div><strong>{run.summary || run.intent}</strong><p>{run.steps.length ? `${run.steps.length} 个执行步骤` : "等待执行"}</p></div></button>)}</div>;
}
