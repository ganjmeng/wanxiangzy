import { clampVideoDuration, resolveUpstreamVideoModel } from "@/lib/api/video-catalog";
import { runKieMarketTask } from "@/lib/api/kie-market";
import type {
  VideoFirstLastFrameInput,
  VideoGenerationResult,
  VideoImageToVideoInput,
  VideoMotionControlInput,
} from "@/lib/api/video-types";
import type { AiResolvedDeployment } from "@/lib/ai-control-plane/types";

type KieVideoOperation = "image-to-video" | "motion-control" | "first-last-frame";
type KieVideoInput = VideoImageToVideoInput | VideoMotionControlInput | VideoFirstLastFrameInput;

export type KieVideoRequest = {
  model: string;
  input: Record<string, unknown>;
};

export function buildKieVideoRequest(
  operation: KieVideoOperation,
  input: KieVideoInput,
): KieVideoRequest {
  const provider = input.provider;
  const duration = clampVideoDuration(provider, input.duration);
  const prompt = compilePrompt(operation, input);

  if (provider === "minimax") {
    if (operation === "motion-control") {
      const motion = input as VideoMotionControlInput;
      return {
        model: "minimax-h3/reference-to-video",
        input: {
          prompt,
          reference_image_urls: [motion.modelImageUrl],
          reference_video_urls: [motion.referenceVideoUrl],
          ...(motion.audioUrl ? { reference_audio_urls: [motion.audioUrl] } : {}),
          aspect_ratio: kieAspectRatio(motion.aspectRatio),
          duration,
        },
      };
    }
    const frames = operation === "first-last-frame"
      ? { first: (input as VideoFirstLastFrameInput).firstFrameUrl, last: (input as VideoFirstLastFrameInput).lastFrameUrl }
      : { first: (input as VideoImageToVideoInput).imageUrl, last: undefined };
    return {
      model: "minimax-h3/image-to-video",
      input: {
        prompt,
        first_frame_url: frames.first,
        ...(frames.last ? { last_frame_url: frames.last } : {}),
        duration,
        resolution: minimaxResolution(input.resolution),
      },
    };
  }

  if (provider === "seedance" || provider === "seedance25") {
    return {
      model: resolveUpstreamVideoModel(provider, input.modelMode, input.resolution),
      input: {
        prompt,
        ...seedanceMedia(operation, input),
        return_last_frame: false,
        generate_audio: input.generateAudio,
        resolution: input.resolution.toLowerCase(),
        aspect_ratio: kieAspectRatio(input.aspectRatio),
        duration,
      },
    };
  }

  return {
    model: "wan/3-0-video",
    input: {
      prompt,
      ...wanMedia(operation, input),
      resolution: input.resolution.toUpperCase(),
      aspect_ratio: kieAspectRatio(input.aspectRatio),
      duration,
      audio: input.generateAudio,
      nsfw_checker: true,
    },
  };
}

export async function generateKieVideo(
  operation: KieVideoOperation,
  input: KieVideoInput,
  deployment: AiResolvedDeployment,
): Promise<VideoGenerationResult> {
  const request = buildKieVideoRequest(operation, input);
  const completed = await runKieMarketTask({
    apiBase: deployment.provider.baseUrl,
    apiKey: deployment.apiKey,
    model: request.model,
    modelInput: request.input,
    resumeTaskId: input.resumeTask?.taskId,
    signal: input.abortSignal || deployment.abortSignal,
    timeoutMs: deployment.provider.timeoutMs,
    submitPath: deployment.adapterConfig?.generationPath,
    statusPath: deployment.adapterConfig?.statusPath,
    onProgress: input.onProgress,
  });
  const prompt = String(request.input.prompt || "");
  return {
    url: completed.urls[0],
    urls: completed.urls,
    taskId: completed.taskId,
    providerStatus: completed.providerStatus,
    prompt,
    compiledPrompt: JSON.stringify({
      model: request.model,
      input: redactMediaUrls(request.input),
    }),
    providerDetails: { taskId: completed.taskId, model: request.model },
  };
}

function seedanceMedia(operation: KieVideoOperation, input: KieVideoInput) {
  if (operation === "motion-control") {
    const motion = input as VideoMotionControlInput;
    return {
      reference_image_urls: [motion.modelImageUrl],
      reference_video_urls: [motion.referenceVideoUrl],
      ...(motion.audioUrl ? { reference_audio_urls: [motion.audioUrl] } : {}),
    };
  }
  if (operation === "first-last-frame") {
    const frames = input as VideoFirstLastFrameInput;
    return { first_frame_url: frames.firstFrameUrl, last_frame_url: frames.lastFrameUrl };
  }
  return { first_frame_url: (input as VideoImageToVideoInput).imageUrl };
}

function wanMedia(operation: KieVideoOperation, input: KieVideoInput) {
  return seedanceMedia(operation, input);
}

function compilePrompt(operation: KieVideoOperation, input: KieVideoInput) {
  const sourcePrompt = "prompt" in input ? input.prompt || "" : "";
  const guidance = operation === "motion-control"
    ? "参考视频只提供动作和运镜，人物、服装与场景以参考图片为准。"
    : operation === "first-last-frame"
      ? "首帧作为视频开头，尾帧作为视频结尾，中间自然顺滑过渡。"
      : "保持输入图片中的人物、服装、颜色、材质和比例一致。";
  const audio = input.audioMode === "off"
    ? "不要生成背景音乐、人声或环境音。"
    : input.audioMode === "custom" && input.audioPrompt?.trim()
      ? `音效要求：${input.audioPrompt.trim()}`
      : "";
  return [sourcePrompt.trim(), guidance, "商业摄影风格，动作自然，镜头稳定，不添加字幕或水印。", audio]
    .filter(Boolean)
    .join("\n");
}

function kieAspectRatio(value: KieVideoInput["aspectRatio"]) {
  return value === "auto" ? "adaptive" : value;
}

function minimaxResolution(value: KieVideoInput["resolution"]) {
  return value === "2k" ? "2K" : "768P";
}

function redactMediaUrls(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (key.endsWith("_url")) return [key, "[media-url]"];
    if (key.endsWith("_urls") && Array.isArray(value)) return [key, value.map(() => "[media-url]")];
    return [key, value];
  }));
}
