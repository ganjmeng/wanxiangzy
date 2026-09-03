import { describe, expect, it } from "vitest";

import { STUDIO_IMAGE_MODEL_META } from "@/lib/studio-models";

describe("studio image model catalog", () => {
  it("exposes the user-facing models in display order", () => {
    expect(Object.entries(STUDIO_IMAGE_MODEL_META).map(([value, model]) => ({
      value,
      label: model.label,
    }))).toEqual([
      { value: "gpt-image-2", label: "GPT Image 2" },
      { value: "nano-banana-2", label: "香蕉2" },
      { value: "nano-banana-2-lite", label: "香蕉2 Lite" },
      { value: "nano-banana-pro", label: "香蕉Pro" },
      { value: "qwen3", label: "千问3" },
      { value: "qwen3-pro", label: "千问3 Pro" },
      { value: "z-image", label: "Z-Image" },
    ]);
    expect(Object.values(STUDIO_IMAGE_MODEL_META).map((model) => model.englishLabel)).toEqual([
      "GPT Image 2",
      "Nano Banana 2",
      "Nano Banana 2 Lite",
      "Nano Banana Pro",
      "Qwen3 Image",
      "Qwen3 Image Pro",
      "Z-Image",
    ]);
  });

  it("provides a description, badge, and visual for every model", () => {
    for (const model of Object.values(STUDIO_IMAGE_MODEL_META)) {
      expect(model.descKey).toMatch(/^Shared\.modelDesc\./);
      expect(model.badgeKey).toMatch(/^Shared\.modelBadge\./);
      expect(model.icon).toMatch(
        /^https:\/\/vasthk\.oss-cn-hongkong\.aliyuncs\.com\/site-assets\/original\/model-covers\/.+\.png$/,
      );
    }
  });
});
