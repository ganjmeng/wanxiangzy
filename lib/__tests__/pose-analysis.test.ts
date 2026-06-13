import { describe, expect, it } from "vitest";
import {
  decidePoseMode,
  getPoseVisualAnalysisDetailItems,
  getPoseVisualAnalysisSummary,
  normalizePoseVisualAnalysis,
  type PoseVisualAnalysis,
} from "@/lib/pose-analysis";

const baseAnalysis: PoseVisualAnalysis = {
  personVisible: true,
  personCount: 1,
  genderExpression: "female",
  ageRange: "adult",
  bodyCrop: "full_body",
  bodyOrientation: "front_facing",
  headDirection: "",
  poseBaseline: "",
  cameraFraming: "full_body studio framing",
  cameraAngle: "",
  outfitDescription: "A dark red, spaghetti-strap mini dress with a tiered, ruffled skirt and lace trim.",
  hairDescription: "",
  faceIdentityNotes: "",
  skinToneNotes: "",
  background: "",
  lighting: "soft studio lighting",
  handsVisible: true,
  feetVisible: false,
  occlusionNotes: "",
  generationRisks: ["gender_drift", "hand_distortion"],
  promptNotes: "",
  confidence: 0.82,
};

describe("pose visual analysis display", () => {
  it("localizes compact summary labels", () => {
    expect(getPoseVisualAnalysisSummary(baseAnalysis)).toBe("成人 / 女 / 全身 / 正面 / 手可见");
  });

  it("turns long English outfit facts into compact chips", () => {
    const items = getPoseVisualAnalysisDetailItems(baseAnalysis);
    expect(items.find((item) => item.label === "服装")?.value).toBe("深红 / 吊带 / 多层 / 荷叶边 / 蕾丝");
    expect(items.find((item) => item.label === "构图")?.value).toBe("全身棚拍");
    expect(items.find((item) => item.label === "光线")?.value).toBe("柔和棚拍光");
    expect(items.find((item) => item.label === "风险")?.value).toBe("性别漂移、手部风险");
  });

  it("normalizes confidence labels returned by vision models", () => {
    const analysis = normalizePoseVisualAnalysis({
      personVisible: true,
      bodyCrop: "full_body",
      confidence: "high",
    });

    expect(analysis?.confidence).toBeGreaterThan(0.8);
  });

  it("normalizes percentage confidence strings", () => {
    const analysis = normalizePoseVisualAnalysis({
      personVisible: true,
      bodyCrop: "full_body",
      confidence: "82%",
    });

    expect(analysis?.confidence).toBe(0.82);
  });
});

describe("decidePoseMode", () => {
  function withCrop(crop: PoseVisualAnalysis["bodyCrop"], extras: Partial<PoseVisualAnalysis> = {}): PoseVisualAnalysis {
    return { ...baseAnalysis, bodyCrop: crop, ...extras };
  }

  it("returns pose_burst_full_subject when analysis is missing (assume we have a person)", () => {
    expect(decidePoseMode({ analysis: null, outputMode: "grid" })).toBe("pose_burst_full_subject");
  });

  it("returns preserve_reference_crop for lower_body", () => {
    expect(decidePoseMode({ analysis: withCrop("lower_body"), outputMode: "separate" })).toBe("preserve_reference_crop");
  });

  it("returns preserve_reference_crop for closeup with no head/face visible", () => {
    expect(decidePoseMode({
      analysis: withCrop("closeup", { headVisible: false, faceVisible: false }),
      outputMode: "grid",
    })).toBe("preserve_reference_crop");
  });

  it("returns pose_burst_full_subject for closeup with head visible", () => {
    expect(decidePoseMode({
      analysis: withCrop("closeup", { headVisible: true }),
      outputMode: "grid",
    })).toBe("pose_burst_full_subject");
  });

  it("returns preserve_reference_crop for partial_unknown with no head/face visible", () => {
    expect(decidePoseMode({
      analysis: withCrop("partial_unknown", { headVisible: false, faceVisible: false }),
      outputMode: "grid",
    })).toBe("preserve_reference_crop");
  });

  it("returns pose_burst_full_subject for full_body", () => {
    expect(decidePoseMode({ analysis: withCrop("full_body"), outputMode: "grid" })).toBe("pose_burst_full_subject");
  });
});
