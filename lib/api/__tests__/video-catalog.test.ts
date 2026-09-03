import { describe, expect, it } from "vitest";

import {
  calculateVideoCreditCost,
  clampVideoDuration,
  getVideoCreditCost,
  getVideoDurationOptions,
  getVideoModes,
  getVideoResolutions,
  resolveUpstreamVideoModel,
  supportsVideoMotionControl,
} from "@/lib/api/video-catalog";

describe("video catalog", () => {
  it("maps minimax resolutions to the documented Kie operation id", () => {
    expect(resolveUpstreamVideoModel("minimax", "pro", "768p")).toBe("minimax-h3/image-to-video");
    expect(resolveUpstreamVideoModel("minimax", "pro", "2k")).toBe("minimax-h3/image-to-video");
  });

  it("maps seedance tiers and resolutions to dedicated model ids", () => {
    expect(resolveUpstreamVideoModel("seedance", "mini", "720p")).toBe("bytedance/seedance-2-mini");
    expect(resolveUpstreamVideoModel("seedance", "fast", "480p")).toBe("bytedance/seedance-2-fast");
    expect(resolveUpstreamVideoModel("seedance", "fast", "720p")).toBe("bytedance/seedance-2-fast");
    expect(resolveUpstreamVideoModel("seedance", "pro", "720p")).toBe("bytedance/seedance-2");
    expect(resolveUpstreamVideoModel("seedance", "pro", "1080p")).toBe("bytedance/seedance-2");
  });

  it("exposes the seedance tiers and minimax resolution options", () => {
    expect(getVideoModes("seedance").map((item) => item.value)).toEqual(["mini", "fast", "pro"]);
    expect(getVideoModes("minimax").map((item) => item.value)).toEqual(["pro"]);
    expect(getVideoResolutions("minimax", "pro").map((item) => item.value)).toEqual(["768p", "2k"]);
    expect(getVideoResolutions("seedance", "pro").map((item) => item.value)).toEqual(["720p", "1080p"]);
  });

  it("clamps provider durations and prices by provider", () => {
    expect(clampVideoDuration("minimax", 3)).toBe(5);
    expect(clampVideoDuration("seedance", 3)).toBe(4);
    expect(getVideoDurationOptions("minimax")).toEqual([5, 10, 15]);
    expect(getVideoCreditCost({ provider: "minimax", modelMode: "pro", resolution: "768p", duration: 3 })).toBe(15);
    expect(getVideoCreditCost({ provider: "seedance", modelMode: "pro", resolution: "1080p", duration: 5 })).toBe(100);
  });

  it("enables reference-video operations exposed by each configured Kie family", () => {
    expect(supportsVideoMotionControl("minimax")).toBe(true);
    expect(supportsVideoMotionControl("seedance")).toBe(true);
    expect(supportsVideoMotionControl("seedance25")).toBe(true);
    expect(supportsVideoMotionControl("wan")).toBe(true);
  });

  it("calculates configurable rates with the same duration and batch rules", () => {
    expect(calculateVideoCreditCost({
      provider: "seedance",
      price: { minimum: 28, perSecond: 7 },
      duration: 5,
      genCount: 2,
    })).toBe(70);
  });
});
