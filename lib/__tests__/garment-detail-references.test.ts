import { describe, expect, it } from "vitest";
import {
  MAX_GARMENT_DETAIL_IMAGES,
  buildGarmentDetailReferencePrompt,
  normalizeGarmentDetailUrls,
} from "@/lib/garment-detail-references";

describe("garment detail references", () => {
  it("normalizes garment detail urls with dedupe and a five-image cap", () => {
    const urls = normalizeGarmentDetailUrls([
      " fabric.png ",
      "",
      "pocket.png",
      "fabric.png",
      "back.png",
      "side.png",
      "collar.png",
      "extra.png",
      42,
    ]);

    expect(urls).toEqual(["fabric.png", "pocket.png", "back.png", "side.png", "collar.png"]);
    expect(urls).toHaveLength(MAX_GARMENT_DETAIL_IMAGES);
  });

  it("describes detail references as appended non-numbering inputs", () => {
    const prompt = buildGarmentDetailReferencePrompt(2);

    expect(prompt).toContain("final 2 appended input images");
    expect(prompt).toContain("must not change the existing image-reference numbering");
    expect(prompt).toContain("main garment/source image wins");
  });
});
