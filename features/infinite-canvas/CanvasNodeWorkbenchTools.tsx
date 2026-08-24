"use client";

import Image from "next/image";
import {
  Brush,
  Camera,
  Copy,
  Download,
  Eraser,
  FileText,
  FolderPlus,
  Grid2x2,
  ImageIcon,
  Info,
  Layers3,
  Lock,
  LockOpen,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  ScanFace,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import type { CanvasNode } from "@/lib/canvas-contract";
import styles from "./infinite-canvas.module.css";

export type CanvasImageTool = "mask" | "crop" | "split" | "layers" | "remove-bg" | "emotion" | "upscale" | "super-resolve" | "angle" | "reverse-prompt";
export type CanvasNodeTool = CanvasImageTool | "info" | "download" | "save-asset" | "replace" | "view" | "edit" | "generate-image" | "font-down" | "font-up" | "retry" | "toggle-resize" | "copy-prompt";

export function CanvasNodeHoverTools({ node, onTool }: { node: CanvasNode; onTool: (tool: CanvasNodeTool) => void }) {
  const isImage = node.type === "image";
  const hasMedia = ["image", "panorama", "video", "audio"].includes(node.type) && Boolean(node.content);
  const tools: Array<{ id: CanvasNodeTool; label: string; icon: React.ReactNode; danger?: boolean }> = [
    { id: "info", label: "信息", icon: <Info /> },
    ...(node.metadata?.status === "error" ? [{ id: "retry" as const, label: "重试", icon: <RefreshCw /> }] : []),
    ...(hasMedia || node.type === "text" ? [{ id: "save-asset" as const, label: "存素材", icon: <FolderPlus /> }] : []),
    ...(hasMedia ? [{ id: "download" as const, label: "下载", icon: <Download /> }] : []),
    ...(["text", "image", "video", "audio", "config"].includes(node.type) ? [{ id: "edit" as const, label: "编辑", icon: <Pencil /> }] : []),
    ...(node.type === "text" ? [
      { id: "generate-image" as const, label: "生图", icon: <ImageIcon /> },
      { id: "font-down" as const, label: "缩小", icon: <Minus /> },
      { id: "font-up" as const, label: "放大", icon: <Plus /> },
    ] : []),
    ...(["image", "video", "audio"].includes(node.type) ? [{ id: "replace" as const, label: "替换", icon: <Upload /> }] : []),
    ...(isImage && node.content ? [
      { id: "copy-prompt" as const, label: "复制词", icon: <Copy /> },
      { id: "reverse-prompt" as const, label: "反推词", icon: <FileText /> },
      { id: "toggle-resize" as const, label: node.metadata?.freeResize ? "自由比例" : "锁比例", icon: node.metadata?.freeResize ? <LockOpen /> : <Lock /> },
      { id: "mask" as const, label: "局部编辑", icon: <Brush /> },
      { id: "crop" as const, label: "裁剪", icon: <Scissors /> },
      { id: "split" as const, label: "切图", icon: <Grid2x2 /> },
      { id: "layers" as const, label: "智能分层", icon: <Layers3 /> },
      { id: "remove-bg" as const, label: "消除背景", icon: <Eraser /> },
      { id: "emotion" as const, label: "表情参考", icon: <ScanFace /> },
      { id: "upscale" as const, label: "放大", icon: <ZoomIn /> },
      { id: "super-resolve" as const, label: "超分", icon: <Sparkles /> },
      { id: "angle" as const, label: "多角度", icon: <Camera /> },
      { id: "view" as const, label: "大图", icon: <Maximize2 /> },
    ] : []),
  ];
  return <div className={styles.nodeHoverTools} data-canvas-chrome onPointerDown={(event) => event.stopPropagation()}>{tools.map((tool) => <button key={tool.id} type="button" data-danger={tool.danger || undefined} aria-label={tool.label} title={tool.label} onClick={() => onTool(tool.id)}>{tool.icon}<span>{tool.label}</span></button>)}</div>;
}

export function CanvasNodeContextMenu({ x, y, kind, onDuplicate, onDelete, onClose }: { x: number; y: number; kind: "node" | "edge"; onDuplicate?: () => void; onDelete: () => void; onClose: () => void }) {
  const viewportWidth = typeof window === "undefined" ? 1920 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 1080 : window.innerHeight;
  return <div className={styles.nodeContextMenu} style={{ left: Math.max(8, Math.min(x, viewportWidth - 190)), top: Math.max(8, Math.min(y, viewportHeight - 112)) }} role="menu" data-canvas-chrome onPointerDown={(event) => event.stopPropagation()}>
    {kind === "node" ? <button type="button" role="menuitem" onClick={() => { onDuplicate?.(); onClose(); }}><Plus />复制</button> : null}
    <button type="button" role="menuitem" data-danger onClick={() => { onDelete(); onClose(); }}><Trash2 />删除</button>
  </div>;
}

export function CanvasNodeToolDialog({ node, tool, prompt, busy, onPromptChange, onClose, onConfirm }: { node: CanvasNode | null; tool: CanvasNodeTool | null; prompt: string; busy: boolean; onPromptChange: (value: string) => void; onClose: () => void; onConfirm: () => void }) {
  if (!node || !tool) return null;
  const info = tool === "info";
  const view = tool === "view";
  const editing = tool === "edit";
  const title = TOOL_TITLES[tool] || "节点工具";
  return <div className={styles.nodeToolBackdrop} data-canvas-chrome onPointerDown={onClose}>
    <section className={styles.nodeToolDialog} onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
      <header><div><strong>{title}</strong><span>{node.title}</span></div><button type="button" aria-label="关闭" onClick={onClose}><X /></button></header>
      {view && node.content ? <div className={styles.nodeToolPreview}><Image src={node.content} alt={node.title} fill unoptimized className="object-contain" /></div> : null}
      {info ? <div className={styles.nodeInfoGrid}><span>ID</span><code>{node.id}</code><span>类型</span><strong>{node.type}</strong><span>尺寸</span><strong>{Math.round(node.width)} × {Math.round(node.height)}</strong><span>位置</span><strong>{Math.round(node.x)}, {Math.round(node.y)}</strong><span>状态</span><strong>{node.metadata?.status || "idle"}</strong><span>提示词</span><p>{node.metadata?.prompt || "暂无"}</p><span>JSON</span><pre>{JSON.stringify(node, null, 2)}</pre></div> : null}
      {!view && !info ? <div className={styles.nodeToolForm}>
        <p>{toolHelp(tool)}</p>
        {tool === "split" ? <div className={styles.splitPreset}><button type="button" onClick={() => onPromptChange("2x2")}>2 × 2</button><button type="button" onClick={() => onPromptChange("3x3")}>3 × 3</button><button type="button" onClick={() => onPromptChange("1x3")}>1 × 3</button></div> : null}
        <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder={editing ? "编辑节点内容或生成要求" : "补充处理要求（可选）"} autoFocus />
      </div> : null}
      <footer><button type="button" onClick={onClose}>取消</button>{!view && !info ? <button type="button" className={styles.primaryToolAction} disabled={busy} onClick={onConfirm}>{busy ? "处理中…" : editing ? "保存" : "创建新节点"}</button> : null}</footer>
    </section>
  </div>;
}

const TOOL_TITLES: Record<CanvasNodeTool, string> = {
  info: "节点信息", download: "下载", "save-asset": "加入我的素材", replace: "替换素材", view: "查看大图", edit: "编辑节点", "generate-image": "文本生图", "font-down": "减小字号", "font-up": "增大字号", retry: "重新生成", "toggle-resize": "缩放方式", "copy-prompt": "复制提示词",
  mask: "局部编辑", crop: "裁剪图片", split: "切分图片", layers: "智能分层", "remove-bg": "消除背景", emotion: "表情参考", upscale: "放大图片", "super-resolve": "超分放大", angle: "生成多角度", "reverse-prompt": "反推提示词",
};

function toolHelp(tool: CanvasNodeTool) {
  if (tool === "mask") return "描述需要局部修改的区域与目标，未指定区域保持不变。";
  if (tool === "crop") return "描述目标构图或比例，系统会生成裁剪后的新节点。";
  if (tool === "split") return "选择行列切分方式；结果将作为一组新节点加入画布。";
  if (tool === "layers") return "识别主体、前景与背景，生成可继续编辑的分层节点。";
  if (tool === "remove-bg") return "移除背景并输出透明或纯净背景图片。";
  if (tool === "emotion") return "描述目标表情，保持人物身份、姿态和其他画面内容。";
  if (tool === "upscale" || tool === "super-resolve") return "提升分辨率和可见细节，保持主体内容稳定。";
  if (tool === "angle") return "描述需要的观察角度，保持商品或人物身份一致。";
  if (tool === "reverse-prompt") return "分析画面并创建可复用的反推提示词文本节点。";
  if (tool === "generate-image") return "使用文本节点内容生成图片。";
  if (tool === "retry") return "使用原始提示词重新提交失败任务。";
  return "修改节点内容或补充处理要求。";
}
