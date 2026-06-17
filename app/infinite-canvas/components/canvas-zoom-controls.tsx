import type { ReactNode } from "react";
import { Compass, Focus, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Modal, Tooltip } from "@/components/ui/shadcn-compat";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = {
        background: colorTheme === "dark" ? "rgba(20,20,22,.92)" : "rgba(255,255,255,.95)",
        borderColor: colorTheme === "dark" ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)",
        color: theme.node.text,
    };
    const iconStyle = { color: theme.node.text, opacity: 0.7 };

    const sliderStyle: React.CSSProperties = {
        accentColor: theme.node.activeStroke,
    };

    return (
        <div className="absolute bottom-3 left-3 z-50" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex h-8 items-center gap-0.5 rounded-lg border px-1.5 shadow-sm" style={dockStyle}>
                <Tooltip title="缩小画布">
                    <Button type="text" className="!h-7 !w-7 !min-w-7 !p-0" style={iconStyle} icon={<Minus className="size-3.5" />} onClick={() => onScaleChange(Math.max(0.05, scale - 0.1))} aria-label="缩小画布" />
                </Tooltip>
                <Tooltip title="拖动调整缩放">
                    <input
                        type="range"
                        min="5"
                        max="500"
                        step="1"
                        value={Math.round(scale * 100)}
                        className="canvas-zoom-slider mx-1 h-7 w-20 cursor-pointer appearance-none bg-transparent"
                        style={sliderStyle}
                        onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
                        aria-label="缩放画布"
                    />
                </Tooltip>
                <button
                    type="button"
                    onClick={onReset}
                    className="flex h-7 min-w-[40px] items-center justify-center rounded px-1.5 text-center text-[11px] tabular-nums transition hover:bg-stone-100 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                    title="重置视图"
                >
                    {Math.round(scale * 100)}%
                </button>
                <Tooltip title="放大画布">
                    <Button type="text" className="!h-7 !w-7 !min-w-7 !p-0" style={iconStyle} icon={<Plus className="size-3.5" />} onClick={() => onScaleChange(Math.min(5, scale + 0.1))} aria-label="放大画布" />
                </Tooltip>
                <span className="mx-1 h-4 w-px" style={{ background: colorTheme === "dark" ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)" }} />
                <Tooltip title="重置视图">
                    <Button type="text" className="!h-7 !w-7 !min-w-7 !p-0" style={iconStyle} icon={<Focus className="size-3.5" />} onClick={onReset} aria-label="重置视图" />
                </Tooltip>
                <Tooltip title={isMiniMapOpen ? "关闭小地图" : "打开小地图"}>
                    <Button
                        type="text"
                        className="!h-7 !w-7 !min-w-7 !p-0"
                        style={isMiniMapOpen ? { background: theme.toolbar.activeBg, color: theme.node.text, opacity: 1 } : iconStyle}
                        icon={<Compass className="size-3.5" />}
                        onClick={onToggleMiniMap}
                        aria-label={isMiniMapOpen ? "关闭小地图" : "打开小地图"}
                    />
                </Tooltip>
            </div>
            <Modal title="快捷键" open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut label="拖动画布" value="平移视图" />
                    <Shortcut label="滚轮" value="缩放画布" />
                    <Shortcut label="Ctrl / Cmd + 拖动" value="框选多个节点" />
                    <Shortcut label="Shift / Ctrl / Cmd + 点击" value="追加选择节点" />
                    <Shortcut label="Ctrl / Cmd + C / V" value="复制 / 粘贴节点" />
                    <Shortcut label="Delete / Backspace" value="删除选中" />
                </div>
            </Modal>
            <style jsx>{`
                .canvas-zoom-slider {
                    /* 轨道：3px 高，圆角，主题色 */
                    background-image: linear-gradient(
                        to right,
                        currentColor var(--thumb-fill, 0%),
                        var(--track-bg, rgba(120, 113, 108, 0.4)) var(--thumb-fill, 0%)
                    );
                }
                .canvas-zoom-slider::-webkit-slider-runnable-track {
                    height: 3px;
                    border-radius: 9999px;
                    background: transparent;
                }
                .canvas-zoom-slider::-moz-range-track {
                    height: 3px;
                    border-radius: 9999px;
                    background: transparent;
                }
                .canvas-zoom-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 12px;
                    height: 12px;
                    border-radius: 9999px;
                    background: currentColor;
                    border: 2px solid currentColor;
                    box-shadow: 0 0 0 2px var(--track-bg, rgba(120, 113, 108, 0.4));
                    margin-top: -5px;
                    cursor: pointer;
                }
                .canvas-zoom-slider::-moz-range-thumb {
                    width: 12px;
                    height: 12px;
                    border-radius: 9999px;
                    background: currentColor;
                    border: 2px solid currentColor;
                    box-shadow: 0 0 0 2px var(--track-bg, rgba(120, 113, 108, 0.4));
                    cursor: pointer;
                }
            `}</style>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-base font-medium">{label}</span>
            <span className="opacity-60">{value}</span>
        </div>
    );
}
