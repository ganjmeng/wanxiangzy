import { describe, expect, it } from "vitest";
import { buildTryOnInputReferences, getTryOnInputReferenceUrls } from "@/lib/tryon-input-references";

describe("tryon input reference snapshots", () => {
  it("keeps try-on references in the same semantic order as generation image inputs", () => {
    const references = buildTryOnInputReferences({
      clothingUrls: ["upper.png"],
      clothingMode: "multi",
      clothingRoles: ["upper"],
      referenceUrl: "scene.png",
      modelFaceUrl: "model.png",
    });

    expect(references).toEqual([
      { url: "upper.png", label: "上装" },
      { url: "scene.png", label: "参考图" },
      { url: "model.png", label: "模特" },
    ]);
  });

  it("labels upper and lower clothing slots before the scene and model references", () => {
    expect(getTryOnInputReferenceUrls({
      clothingUrls: ["upper.png", "lower.png"],
      clothingMode: "multi",
      clothingRoles: ["upper", "lower"],
      referenceUrl: "scene.png",
      modelFaceUrl: "model.png",
    })).toEqual(["upper.png", "lower.png", "scene.png", "model.png"]);
  });

  it("supports multiple scene references while preserving generation input order", () => {
    const references = buildTryOnInputReferences({
      clothingUrls: ["upper.png", "lower.png"],
      clothingMode: "multi",
      clothingRoles: ["upper", "lower"],
      referenceUrls: ["scene-1.png", "scene-2.png"],
      modelFaceUrl: "model.png",
    });

    expect(references).toEqual([
      { url: "upper.png", label: "上装" },
      { url: "lower.png", label: "下装" },
      { url: "scene-1.png", label: "参考图1" },
      { url: "scene-2.png", label: "参考图2" },
      { url: "model.png", label: "模特" },
    ]);
  });

  it("keeps up to eight scene references plus the optional model thumbnail", () => {
    const referenceUrls = Array.from({ length: 8 }, (_, index) => `scene-${index + 1}.png`);
    const references = buildTryOnInputReferences({
      clothingUrls: ["upper.png"],
      clothingMode: "multi",
      clothingRoles: ["upper"],
      referenceUrls,
      modelFaceUrl: "model.png",
    });

    expect(references).toHaveLength(10);
    expect(references.at(-1)).toEqual({ url: "model.png", label: "模特" });
  });

  it("appends garment detail references after existing try-on inputs", () => {
    const references = buildTryOnInputReferences({
      clothingUrls: ["upper.png", "lower.png"],
      clothingMode: "multi",
      clothingRoles: ["upper", "lower"],
      referenceUrl: "scene.png",
      modelFaceUrl: "model.png",
      garmentDetailUrls: ["fabric.png", "pocket.png"],
    });

    expect(references).toEqual([
      { url: "upper.png", label: "上装" },
      { url: "lower.png", label: "下装" },
      { url: "scene.png", label: "参考图" },
      { url: "model.png", label: "模特" },
      { url: "fabric.png", label: "服装细节1" },
      { url: "pocket.png", label: "服装细节2" },
    ]);
  });
});
