import { describe, expect, it } from "vitest";
import { normalizeCanvasDocument, normalizeCanvasTitle } from "@/lib/canvas-contract";

describe("canvas contract", () => {
  it("normalizes a persistent text and image document", () => {
    const document = normalizeCanvasDocument({
      version: 1,
      viewport: { x: 12, y: -8, scale: 1.25 },
      nodes: [
        { id: "text-1", type: "text", x: 10, y: 20, width: 280, height: 180, title: "Brief", content: "Keep the product exact" },
        { id: "image-1", type: "image", x: 360, y: 20, width: 320, height: 240, title: "Reference", content: "https://assets.example.com/reference.webp", assetId: "asset-1" },
      ],
      edges: [{ id: "edge-1", from: "text-1", to: "image-1" }],
    });

    expect(document.nodes).toHaveLength(2);
    expect(document.edges).toEqual([{ id: "edge-1", from: "text-1", to: "image-1" }]);
    expect(document.viewport.scale).toBe(1.25);
  });

  it("drops dangling edges and rejects unsafe image sources", () => {
    const document = normalizeCanvasDocument({
      nodes: [{ id: "text-1", type: "text", content: "Brief" }],
      edges: [{ id: "edge-1", from: "text-1", to: "missing" }],
    });
    expect(document.edges).toEqual([]);
    expect(() => normalizeCanvasDocument({
      nodes: [{ id: "image-1", type: "image", content: "data:image/png;base64,abc" }],
      edges: [],
    })).toThrow("HTTPS");
  });

  it("bounds titles", () => {
    expect(normalizeCanvasTitle("  Campaign board ")).toBe("Campaign board");
    expect(() => normalizeCanvasTitle(" ")).toThrow("1-120");
  });

  it("preserves the original canvas media and config node types", () => {
    const document = normalizeCanvasDocument({
      nodes: [
        { id: "panorama-1", type: "panorama", content: "https://assets.example.com/panorama.jpg" },
        { id: "video-1", type: "video", content: "https://assets.example.com/video.mp4" },
        { id: "audio-1", type: "audio", content: "https://assets.example.com/audio.mp3" },
        { id: "config-1", type: "config", content: "{\"model\":\"smart\"}" },
        { id: "brief-1", type: "brief", content: "Campaign brief" },
        { id: "task-1", type: "task", content: "Generate variants" },
        { id: "brand-kit-1", type: "brand-kit", content: "Brand rules" },
      ],
      edges: [],
    });
    expect(document.nodes.map((node) => node.type)).toEqual(["panorama", "video", "audio", "config", "brief", "task", "brand-kit"]);
  });

  it("persists resumable generation and node editing metadata", () => {
    const document = normalizeCanvasDocument({
      nodes: [{
        id: "image-loading",
        type: "image",
        content: "",
        metadata: {
          status: "loading",
          prompt: "Campaign key visual",
          generationId: "generation-123",
          creativeRunId: "run-123",
          operation: "mask",
          model: "nano-banana-2",
          aspectRatio: "16:9",
          imageSize: "2K",
          fontSize: 20,
          freeResize: true,
        },
      }],
      edges: [],
    });
    expect(document.nodes[0].metadata).toMatchObject({
      status: "loading",
      generationId: "generation-123",
      operation: "mask",
      aspectRatio: "16:9",
      imageSize: "2K",
      freeResize: true,
    });
  });
});
