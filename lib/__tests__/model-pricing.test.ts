import { describe, expect, it } from "vitest";

import {
  AUDIO_CREDIT_COST,
  getImageCreditCost,
  getImageCreditCostRange,
  IMAGE_MODEL_DISPLAY_ORDER,
  VIDEO_CREDIT_RATES,
} from "@/lib/model-pricing";

describe("model pricing", () => {
  it("uses premium pricing for the Nano Banana family", () => {
    const sizes = ["1K", "2K", "4K"] as const;
    expect(sizes.map((size) => getImageCreditCost("nano-banana-2", size))).toEqual([4, 6, 8]);
    expect(sizes.map((size) => getImageCreditCost("nano-banana-pro", size))).toEqual([8, 10, 12]);
    expect(IMAGE_MODEL_DISPLAY_ORDER.at(-1)).toBe("z-image");
  });

  it("keeps the non-Nano image and audio increases modest", () => {
    expect(getImageCreditCostRange("gpt-image-2")).toEqual({ minimum: 3, maximum: 5 });
    expect(AUDIO_CREDIT_COST).toBe(2);
  });

  it("keeps explicit video floors and per-second rates", () => {
    expect(VIDEO_CREDIT_RATES).toEqual({
      fast: { "720p": { minimum: 15, perSecond: 3 } },
      pro: {
        "720p": { minimum: 25, perSecond: 4 },
        "1080p": { minimum: 40, perSecond: 6 },
      },
    });
  });
});
