import { describe, expect, it } from "vitest";
import { getActiveTopModule, getFeatureItem, getFeatureItemsForModule, VISIBLE_TOP_MODULES } from "@/lib/navigation";

describe("top module navigation contract", () => {
  it("matches the reference workspace module order", () => {
    expect(VISIBLE_TOP_MODULES.map((item) => item.key)).toEqual([
      "home",
      "assistant",
      "canvas",
      "aiShoots",
      "productImages",
      "aiVideo",
      "tools",
      "toolbox",
      "enterprise",
    ]);
  });

  it("opens Agent and infinite canvas as adjacent top-level workspaces", () => {
    expect(getActiveTopModule("/agent")).toBe("assistant");
    expect(getActiveTopModule("/canvas")).toBe("canvas");
    expect(getActiveTopModule("/canvas/project-id")).toBe("canvas");
  });

  it("resolves general-image routes to the tools module", () => {
    expect(getActiveTopModule("/general-image")).toBe("tools");
    expect(getActiveTopModule("/general-image/image-to-image")).toBe("tools");
  });

  it("shows 文生图 before 图生图 in the tools feature rail", () => {
    const keys = getFeatureItemsForModule("tools").map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining(["textToImage", "imageToImage"]));
    expect(keys.indexOf("textToImage")).toBeLessThan(keys.indexOf("imageToImage"));
    expect(getFeatureItem("imageToImage")?.badge).toBe("NEW");
  });

  it("opens the production AI toolbox from matting and keeps API testing internal", () => {
    expect(VISIBLE_TOP_MODULES.find((item) => item.key === "toolbox")?.href).toBe("/ai-tools/matting");
    expect(getActiveTopModule("/ai-tools/matting")).toBe("toolbox");
    expect(getActiveTopModule("/ai-tools/shoe-repair")).toBe("toolbox");
    expect(getActiveTopModule("/api-platform-test")).toBe("toolbox");
    expect(getFeatureItemsForModule("toolbox").map((item) => item.key)).toEqual([
      "aiMatting",
      "imageUpscale",
      "aiOutpaint",
      "aiErase",
      "handFootRepair",
      "clothingRepair",
      "shoeRepair",
      "losslessResize",
      "apiTest",
    ]);
    expect(VISIBLE_TOP_MODULES.some((item) => item.key === "works")).toBe(false);
  });
});
