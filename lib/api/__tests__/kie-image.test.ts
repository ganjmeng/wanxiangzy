import { describe, expect, it } from "vitest";
import { buildKieImageRequest } from "@/lib/api/kie-image";

describe("Kie image request contracts", () => {
  it("uses the documented Nano Banana field names", () => {
    expect(buildKieImageRequest({
      model: "nano-banana-2",
      prompt: "product photo",
      imageUrls: ["https://cdn.example.com/a.png"],
      aspectRatio: "1:1",
      imageSize: "2K",
    })).toEqual({
      model: "nano-banana-2",
      input: {
        prompt: "product photo",
        image_input: ["https://cdn.example.com/a.png"],
        aspect_ratio: "1:1",
        resolution: "2K",
        output_format: "png",
      },
    });
  });

  it("switches GPT Image 2 and Qwen3 between text and image endpoints", () => {
    expect(buildKieImageRequest({ model: "gpt-image-2", prompt: "studio shoe" }).model)
      .toBe("gpt-image-2-text-to-image");
    expect(buildKieImageRequest({ model: "gpt-image-2", prompt: "edit", imageUrls: ["https://cdn.example.com/a.png"] }).model)
      .toBe("gpt-image-2-image-to-image");
    expect(buildKieImageRequest({ model: "qwen3", prompt: "studio shoe" }).model)
      .toBe("qwen3/text-to-image");
    expect(buildKieImageRequest({ model: "qwen3-pro", prompt: "edit", imageUrls: ["https://cdn.example.com/a.png"] }).model)
      .toBe("qwen3/pro-image-to-image");
  });

  it("keeps Z-Image text-only", () => {
    expect(() => buildKieImageRequest({
      model: "z-image",
      prompt: "studio shoe",
      imageUrls: ["https://cdn.example.com/a.png"],
    })).toThrow(/仅支持文生图/);
  });

  it("normalizes ratios that Qwen3 does not document", () => {
    expect(buildKieImageRequest({ model: "qwen3", prompt: "shoe", aspectRatio: "4:5" }).input.image_size).toBe("3:4");
    expect(buildKieImageRequest({ model: "qwen3-pro", prompt: "shoe", aspectRatio: "auto" }).input.image_size).toBe("1:1");
  });
});
