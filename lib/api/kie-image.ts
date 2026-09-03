import type { AiResolvedDeployment } from "@/lib/ai-control-plane/types";
import { runKieMarketTask } from "@/lib/api/kie-market";
import { NonRetryableGenerationError } from "@/lib/api/generation-errors";
import type { PricedImageModel, PricedImageSize } from "@/lib/model-pricing";

type KieAspectRatio = "auto" | "1:1" | "9:16" | "16:9" | "4:3" | "3:4" | "2:3" | "3:2" | "4:5" | "5:4" | "21:9";

export type KieImageRequest = {
  model: string;
  input: Record<string, unknown>;
};

export function buildKieImageRequest(input: {
  model: PricedImageModel;
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: KieAspectRatio;
  imageSize?: PricedImageSize;
}): KieImageRequest {
  const images = (input.imageUrls || []).filter(Boolean);
  const aspectRatio = input.aspectRatio || "auto";
  const resolution = input.imageSize || "1K";

  if (input.model === "nano-banana-2" || input.model === "nano-banana-pro") {
    assertMaxImages(input.model, images, 14);
    return {
      model: input.model,
      input: {
        prompt: input.prompt,
        image_input: images,
        aspect_ratio: aspectRatio,
        resolution,
        output_format: "png",
      },
    };
  }

  if (input.model === "nano-banana-2-lite") {
    assertMaxImages(input.model, images, 10);
    return {
      model: "nano-banana-2-lite",
      input: {
        ...(images.length ? { image_urls: images } : {}),
        prompt: input.prompt,
        aspect_ratio: aspectRatio,
      },
    };
  }

  if (input.model === "gpt-image-2") {
    assertMaxImages(input.model, images, 16);
    return {
      model: images.length ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image",
      input: {
        prompt: input.prompt,
        ...(images.length ? { input_urls: images } : {}),
        aspect_ratio: aspectRatio,
        resolution,
        background: "auto",
      },
    };
  }

  if (input.model === "qwen3" || input.model === "qwen3-pro") {
    assertMaxImages(input.model, images, 3);
    if (resolution === "4K") {
      throw new NonRetryableGenerationError("Qwen3 图片模型仅支持 1K / 2K", "KIE_QWEN_RESOLUTION_UNSUPPORTED");
    }
    return {
      model: input.model === "qwen3-pro"
        ? `qwen3/pro-${images.length ? "image-to-image" : "text-to-image"}`
        : `qwen3/${images.length ? "image-to-image" : "text-to-image"}`,
      input: {
        ...(images.length ? { image_urls: images } : {}),
        prompt: input.prompt,
        resolution,
        image_size: qwenImageSize(aspectRatio),
        output_format: "png",
        prompt_extend: true,
        nsfw_checker: true,
      },
    };
  }

  if (input.model === "z-image") {
    if (images.length) {
      throw new NonRetryableGenerationError("Z-Image 当前仅支持文生图，不能传入参考图片", "KIE_Z_IMAGE_EDIT_UNSUPPORTED");
    }
    return {
      model: "z-image",
      input: {
        prompt: input.prompt,
        aspect_ratio: aspectRatio,
        nsfw_checker: true,
      },
    };
  }

  throw new NonRetryableGenerationError(`Kie 图片模型 ${input.model} 未配置`, "KIE_IMAGE_MODEL_UNSUPPORTED");
}

export async function generateKieImage(input: {
  deployment: AiResolvedDeployment;
  model: PricedImageModel;
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: KieAspectRatio;
  imageSize?: PricedImageSize;
  onProgress?: (progress: {
    taskId?: string;
    status: "queued" | "running" | "completed" | "failed";
    providerStatus?: string;
    progress: number;
    urls?: string[];
    error?: string;
  }) => Promise<void> | void;
}) {
  const request = buildKieImageRequest(input);
  const result = await runKieMarketTask({
    apiBase: input.deployment.provider.baseUrl,
    apiKey: input.deployment.apiKey,
    model: request.model,
    modelInput: request.input,
    signal: input.deployment.abortSignal,
    submitPath: input.deployment.adapterConfig?.generationPath,
    statusPath: input.deployment.adapterConfig?.statusPath,
    onProgress: input.onProgress
      ? (progress) => input.onProgress?.({ ...progress })
      : undefined,
  });
  return {
    url: result.urls[0],
    urls: result.urls,
    taskId: result.taskId,
    providerStatus: result.providerStatus,
    request,
  };
}

function assertMaxImages(model: string, images: string[], max: number) {
  if (images.length > max) {
    throw new NonRetryableGenerationError(`${model} 最多支持 ${max} 张参考图片，当前为 ${images.length} 张`, "KIE_TOO_MANY_REFERENCE_IMAGES");
  }
}

function qwenImageSize(value: KieAspectRatio) {
  if (value === "auto") return "1:1";
  if (value === "4:5") return "3:4";
  if (value === "5:4") return "4:3";
  return value;
}
