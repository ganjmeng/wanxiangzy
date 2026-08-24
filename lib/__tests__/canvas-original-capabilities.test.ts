import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const editor = read("features/infinite-canvas/InfiniteCanvasEditor.tsx");
const tools = read("features/infinite-canvas/CanvasNodeWorkbenchTools.tsx");
const chrome = read("features/infinite-canvas/CanvasWorkbenchChrome.tsx");

describe("VOZEB canvas capability migration", () => {
  it("keeps the complete image node toolbar actions reachable", () => {
    for (const tool of ["mask", "crop", "split", "layers", "remove-bg", "emotion", "upscale", "super-resolve", "angle", "reverse-prompt"]) {
      expect(tools).toContain(`"${tool}"`);
      expect(editor).toContain(tool);
    }
    expect(editor).toContain("downloadMediaFile");
    expect(editor).toContain("registerGeneratedResources");
    expect(editor).toContain("duplicateNode");
  });

  it("persists generation tasks and restores loading nodes after refresh", () => {
    expect(editor).toContain('status: "loading"');
    expect(editor).toContain("pendingGenerationKey");
    expect(editor).toContain("generationId: payload.generation_id");
    expect(editor).toContain("creativeRunId: runId");
    expect(editor).toContain('Idempotency-Key');
  });

  it("exposes original composer references, prompt library, skill and generation settings", () => {
    expect(chrome).toContain("@ 引用");
    expect(editor).toContain("mentionedReferences");
    expect(editor).toContain("selectedReferences");
    expect(chrome).toContain('href="/prompts"');
    expect(chrome).toContain("选择画布 Skill");
    expect(chrome).toContain("画面比例");
    expect(chrome).toContain("清晰度");
    expect(chrome).toContain("生成数量");
  });
});
