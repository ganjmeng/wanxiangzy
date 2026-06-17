import type { CanvasProject } from "../stores/use-canvas-store";
import { CanvasNodeType } from "../types";

export function buildExampleProject(): Omit<CanvasProject, "id"> {
    const now = new Date().toISOString();
    return {
        title: "服装生成工作流示例",
        createdAt: now,
        updatedAt: now,
        nodes: [
            {
                id: "ex-model",
                type: CanvasNodeType.Image,
                title: "模特参考",
                position: { x: 80, y: 120 },
                width: 260,
                height: 180,
                metadata: { prompt: "亚洲面孔模特，干净背景，自然光线" },
            },
            {
                id: "ex-garment",
                type: CanvasNodeType.Image,
                title: "服装参考",
                position: { x: 420, y: 120 },
                width: 260,
                height: 180,
                metadata: { prompt: "春夏连衣裙，浅色印花，飘逸面料" },
            },
            {
                id: "ex-config",
                type: CanvasNodeType.Config,
                title: "生成配置",
                position: { x: 760, y: 100 },
                width: 280,
                height: 220,
                metadata: {
                    prompt: "将模特与服装自然合成，保留服饰细节与面料质感，输出电商详情页主图",
                    model: "gpt-image-2",
                },
            },
            {
                id: "ex-output",
                type: CanvasNodeType.Image,
                title: "生成结果",
                position: { x: 1120, y: 120 },
                width: 260,
                height: 180,
                metadata: {},
            },
        ],
        connections: [
            { id: "ex-c1", fromNodeId: "ex-model", toNodeId: "ex-config" },
            { id: "ex-c2", fromNodeId: "ex-garment", toNodeId: "ex-config" },
            { id: "ex-c3", fromNodeId: "ex-config", toNodeId: "ex-output" },
        ],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: -40, y: -60, k: 1 },
    };
}
