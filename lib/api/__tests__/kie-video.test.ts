import { describe, expect, it } from "vitest";
import { buildKieVideoRequest } from "@/lib/api/kie-video";

const common = {
  prompt: "model walks naturally",
  modelMode: "pro" as const,
  duration: 5 as const,
  aspectRatio: "9:16" as const,
  audioMode: "off" as const,
  generateAudio: false,
};

describe("Kie video request contracts (no live generation)", () => {
  it("maps MiniMax H3 image and reference operations to distinct models", () => {
    const image = buildKieVideoRequest("image-to-video", {
      ...common, provider: "minimax", imageUrl: "https://cdn.example.com/model.png", resolution: "2k",
    });
    expect(image.model).toBe("minimax-h3/image-to-video");
    expect(image.input).toMatchObject({ first_frame_url: "https://cdn.example.com/model.png", resolution: "2K" });

    const reference = buildKieVideoRequest("motion-control", {
      ...common, provider: "minimax", modelImageUrl: "https://cdn.example.com/model.png",
      referenceVideoUrl: "https://cdn.example.com/motion.mp4", resolution: "768p",
    });
    expect(reference.model).toBe("minimax-h3/reference-to-video");
    expect(reference.input).toMatchObject({ aspect_ratio: "9:16" });
    expect(reference.input).not.toHaveProperty("resolution");
  });

  it("uses documented Seedance 2.5 and Wan 3.0 names and casing", () => {
    const seedance = buildKieVideoRequest("first-last-frame", {
      ...common, provider: "seedance25", firstFrameUrl: "https://cdn.example.com/first.png",
      lastFrameUrl: "https://cdn.example.com/last.png", resolution: "1080p",
    });
    expect(seedance).toMatchObject({ model: "bytedance/seedance-2-5", input: { resolution: "1080p", generate_audio: false } });

    const wan = buildKieVideoRequest("image-to-video", {
      ...common, provider: "wan", imageUrl: "https://cdn.example.com/model.png", resolution: "720p",
    });
    expect(wan).toMatchObject({ model: "wan/3-0-video", input: { resolution: "720P", audio: false, nsfw_checker: true } });
  });
});
