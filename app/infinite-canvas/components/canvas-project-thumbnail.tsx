"use client";

import { useMemo } from "react";
import { ImageIcon, Music2, Settings2, Type, Video } from "lucide-react";

import type { CanvasConnection, CanvasNodeData } from "../types";
import { cn } from "@/lib/utils";

const WIDTH = 480;
const HEIGHT = 270;
const NODE_PADDING = 24;
const PADDING = 12;

type CanvasProjectThumbnailProps = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    className?: string;
};

type BoundingBox = { x: number; y: number; w: number; h: number };

function computeBoundingBox(nodes: CanvasNodeData[]): BoundingBox {
    if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const node of nodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + node.width);
        maxY = Math.max(maxY, node.position.y + node.height);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function nodeFill(type: CanvasNodeData["type"]): string {
    switch (type) {
        case "image":
            return "#dbeafe";
        case "video":
            return "#fef3c7";
        case "text":
            return "#f3f4f6";
        case "config":
            return "#ede9fe";
        case "audio":
            return "#fce7f3";
        default:
            return "#f1f5f9";
    }
}

function nodeStroke(type: CanvasNodeData["type"]): string {
    switch (type) {
        case "image":
            return "#93c5fd";
        case "video":
            return "#fcd34d";
        case "text":
            return "#cbd5e1";
        case "config":
            return "#c4b5fd";
        case "audio":
            return "#f9a8d4";
        default:
            return "#cbd5e1";
    }
}

export function CanvasProjectThumbnail({ nodes, connections, className }: CanvasProjectThumbnailProps) {
    const projected = useMemo(() => {
        if (!nodes.length) return null;
        const bbox = computeBoundingBox(nodes);
        const sourceW = Math.max(bbox.w, 1);
        const sourceH = Math.max(bbox.h, 1);
        const innerW = WIDTH - 2 * PADDING;
        const innerH = HEIGHT - 2 * PADDING;
        const scale = Math.min(innerW / (sourceW + NODE_PADDING * 2), innerH / (sourceH + NODE_PADDING * 2));
        const offsetX = PADDING + (innerW - sourceW * scale) / 2 - bbox.x * scale;
        const offsetY = PADDING + (innerH - sourceH * scale) / 2 - bbox.y * scale;
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const pathData = connections
            .map((connection) => {
                const from = nodeById.get(connection.fromNodeId);
                const to = nodeById.get(connection.toNodeId);
                if (!from || !to) return null;
                const startX = offsetX + (from.position.x + from.width) * scale;
                const startY = offsetY + (from.position.y + from.height / 2) * scale;
                const endX = offsetX + to.position.x * scale;
                const endY = offsetY + (to.position.y + to.height / 2) * scale;
                const dx = Math.abs(endX - startX);
                const curvature = Math.max(dx * 0.5, 18);
                return `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${(startX + curvature).toFixed(1)} ${startY.toFixed(1)}, ${(endX - curvature).toFixed(1)} ${endY.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
            })
            .filter((value): value is string => Boolean(value));
        return {
            scale,
            offsetX,
            offsetY,
            pathData,
            nodeEntries: nodes
                .map((node) => ({
                    id: node.id,
                    x: offsetX + node.position.x * scale,
                    y: offsetY + node.position.y * scale,
                    w: node.width * scale,
                    h: node.height * scale,
                    type: node.type,
                    title: node.title,
                }))
                .sort((a, b) => a.x - b.x),
        };
    }, [nodes, connections]);

    if (!projected) {
        return (
            <div className={cn("flex aspect-[16/9] w-full items-center justify-center bg-slate-50 text-slate-300", className)}>
                <ImageIcon className="size-10" />
            </div>
        );
    }

    return (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={cn("block aspect-[16/9] w-full bg-slate-50", className)} preserveAspectRatio="xMidYMid meet" aria-hidden>
            <g>
                {projected.pathData.map((d, index) => (
                    <path key={`path-${index}`} d={d} stroke="#94a3b8" strokeWidth={1.4} fill="none" strokeLinecap="round" />
                ))}
            </g>
            <g>
                {projected.nodeEntries.map((node) => (
                    <g key={node.id}>
                        <rect
                            x={node.x}
                            y={node.y}
                            width={node.w}
                            height={node.h}
                            rx={Math.min(8, node.w / 6)}
                            fill={nodeFill(node.type)}
                            stroke={nodeStroke(node.type)}
                            strokeWidth={1}
                        />
                        <foreignObject x={node.x + 4} y={node.y + 4} width={Math.max(node.w - 8, 0)} height={Math.max(node.h - 8, 0)}>
                            <div
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "#475569",
                                    fontSize: Math.max(8, Math.min(node.w, node.h) / 6),
                                    fontWeight: 500,
                                    overflow: "hidden",
                                }}
                            >
                                <NodeTypeGlyph type={node.type} />
                            </div>
                        </foreignObject>
                    </g>
                ))}
            </g>
        </svg>
    );
}

function NodeTypeGlyph({ type }: { type: CanvasNodeData["type"] }) {
    switch (type) {
        case "image":
            return <ImageIcon className="size-3.5" />;
        case "video":
            return <Video className="size-3.5" />;
        case "text":
            return <Type className="size-3.5" />;
        case "config":
            return <Settings2 className="size-3.5" />;
        case "audio":
            return <Music2 className="size-3.5" />;
        default:
            return null;
    }
}
