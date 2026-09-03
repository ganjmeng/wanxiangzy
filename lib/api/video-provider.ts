import { supportsVideoMotionControl, type VideoProviderName } from "@/lib/api/video-catalog";
import { generateNewApiFirstLastFrame, generateNewApiImageToVideo, generateNewApiMotionControl } from "@/lib/api/newapi-video";
import { generateKieVideo } from "@/lib/api/kie-video";
import { executeAiRouted } from "@/lib/ai-control-plane/router.server";
import { getAiControlPlaneConfig } from "@/lib/ai-control-plane/server";
import type { AiResolvedDeployment } from "@/lib/ai-control-plane/types";
import type {
  NewApiVideoProviderConfig,
  VideoFirstLastFrameInput,
  VideoGenerationResult,
  VideoImageToVideoInput,
  VideoMotionControlInput,
  VideoTaskProgress,
} from "@/lib/api/video-types";

type VideoOperation = "image-to-video" | "motion-control" | "first-last-frame";
type RoutedVideoInput = VideoImageToVideoInput | VideoMotionControlInput | VideoFirstLastFrameInput;

export async function getEnabledVideoProviders(): Promise<VideoProviderName[]> {
  const config = await getAiControlPlaneConfig({ decryptSecrets: false, allowLegacy: true });
  if (!config) return [];
  const enabledProviders = new Set(config.providers.filter((item) => item.enabled && item.apiKey).map((item) => item.id));
  return (["minimax", "seedance", "seedance25", "wan"] as const).filter((provider) => {
    const modelId = videoModelId(provider);
    return config.models.some((model) => model.id === modelId && model.enabled && model.modality === "video")
      && config.deployments.some((deployment) => deployment.modelId === modelId
        && deployment.enabled
        && (deployment.protocol === "kie-market" || deployment.protocol === "newapi-video")
        && enabledProviders.has(deployment.providerId));
  });
}

export async function generateVideoImageToVideo(input: VideoImageToVideoInput): Promise<VideoGenerationResult> {
  return executeRoutedVideo(input, "image-to-video", (deployment, routedInput) =>
    deployment.protocol === "kie-market"
      ? generateKieVideo("image-to-video", routedInput as VideoImageToVideoInput, deployment)
      : generateNewApiImageToVideo(routedInput as VideoImageToVideoInput, toNewApiProvider(deployment, input.provider)));
}

export async function generateVideoMotionControl(input: VideoMotionControlInput): Promise<VideoGenerationResult> {
  if (!supportsVideoMotionControl(input.provider)) {
    throw new Error("当前视频模型暂不支持参考视频动作模仿，请使用图生视频或首尾帧功能。");
  }
  return executeRoutedVideo(input, "motion-control", (deployment, routedInput) =>
    deployment.protocol === "kie-market"
      ? generateKieVideo("motion-control", routedInput as VideoMotionControlInput, deployment)
      : generateNewApiMotionControl(routedInput as VideoMotionControlInput, toNewApiProvider(deployment, input.provider)));
}

export async function generateVideoFirstLastFrame(input: VideoFirstLastFrameInput): Promise<VideoGenerationResult> {
  return executeRoutedVideo(input, "first-last-frame", (deployment, routedInput) =>
    deployment.protocol === "kie-market"
      ? generateKieVideo("first-last-frame", routedInput as VideoFirstLastFrameInput, deployment)
      : generateNewApiFirstLastFrame(routedInput as VideoFirstLastFrameInput, toNewApiProvider(deployment, input.provider)));
}

async function executeRoutedVideo<T extends RoutedVideoInput>(
  input: T,
  operation: VideoOperation,
  execute: (deployment: AiResolvedDeployment, input: T) => Promise<VideoGenerationResult>,
) {
  let upstreamSubmitted = Boolean(input.resumeTask?.taskId);
  return executeAiRouted({
    modelId: videoModelId(input.provider),
    modality: "video",
    context: {
      generationId: input.generationId,
      userId: input.userId,
      requiredCapabilities: [operation],
      requiredDeploymentId: input.resumeTask?.deploymentId,
    },
    canFailover: () => !upstreamSubmitted,
    execute: async (deployment) => {
      if (deployment.protocol !== "newapi-video" && deployment.protocol !== "kie-market") {
        throw new Error(`视频部署 ${deployment.id} 的协议不受支持`);
      }
      const onProgress = input.onProgress;
      const routedInput = {
        ...input,
        abortSignal: deployment.abortSignal,
        onProgress: async (progress: VideoTaskProgress) => {
          if (progress.taskId) upstreamSubmitted = true;
          await onProgress?.({
            ...progress,
            providerDetails: {
              ...(progress.providerDetails || {}),
              deploymentId: deployment.id,
              providerId: deployment.providerId,
              upstreamModel: deployment.upstreamModel,
            },
          });
        },
      } as T;
      return execute(deployment, routedInput);
    },
    describeResult: (result) => ({
      outputUnits: result.urls.length,
      metadata: { operation, taskId: result.taskId },
    }),
  });
}

function toNewApiProvider(deployment: AiResolvedDeployment, provider: VideoProviderName): NewApiVideoProviderConfig {
  if (provider !== "minimax" && provider !== "seedance") {
    throw new Error(`旧版 newapi-video 协议不支持 ${provider}`);
  }
  const apiBase = deployment.provider.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
  return { provider, apiBase, apiKey: deployment.apiKey };
}

function videoModelId(provider: VideoProviderName) {
  return `video-${provider}`;
}
