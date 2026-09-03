import { createClient } from "@supabase/supabase-js";
import { validateAiControlPlaneConfig } from "../lib/ai-control-plane/config";
import type {
  AiControlPlaneConfig,
  AiLogicalModel,
  AiModelDeployment,
  AiProviderEndpoint,
} from "../lib/ai-control-plane/types";
import { encryptProviderSecret } from "../lib/api/model-provider-secrets";

const CONFIG_KEY = "ai.control-plane.v1";
const LEGACY_KEYS = ["model.providers", "video.providers"];
const KIE_API_BASE = "https://api.kie.ai";
const MODEL_ASSET_BASE = "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-covers";

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const keys = {
  banana: required("KIE_BANANA_API_KEY"),
  gpt: required("KIE_GPT_IMAGE_API_KEY"),
  qwen: required("KIE_QWEN_API_KEY"),
  video: required("KIE_VIDEO_API_KEY"),
};

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const previous = await getPublishedConfig();
  const preservedModels = previous.models.filter((model) => model.modality !== "image" && model.modality !== "video");
  const preservedModelIds = new Set(preservedModels.map((model) => model.id));
  const preservedDeployments = previous.deployments.filter((deployment) => preservedModelIds.has(deployment.modelId));
  const preservedProviderIds = new Set(preservedDeployments.map((deployment) => deployment.providerId));
  const preservedProviders = previous.providers.filter((provider) => preservedProviderIds.has(provider.id));

  const config: AiControlPlaneConfig = {
    schemaVersion: 1,
    models: [...preservedModels, ...imageModels(), ...videoModels()],
    providers: [...preservedProviders, ...kieProviders()],
    deployments: [...preservedDeployments, ...kieDeployments()],
    policy: previous.policy,
    updatedAt: new Date().toISOString(),
    updatedFrom: "scripts.reconfigure-kie-models",
  };

  const validated = validateAiControlPlaneConfig(config);
  const errors = validated.issues.filter((issue) => issue.severity === "error");
  if (errors.length) {
    throw new Error(`配置校验失败：${errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }

  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({
      valid: true,
      imageModels: imageModels().length,
      videoModels: videoModels().length,
      preservedModels: preservedModels.length,
      providerCount: config.providers.length,
      deploymentCount: config.deployments.length,
    }, null, 2));
    return;
  }

  const { data: published, error: publishError } = await admin.rpc("publish_ai_control_plane_config", {
    p_value: validated.config,
    p_created_by: null,
  });
  if (publishError) throw publishError;
  const publishedRow = Array.isArray(published) ? published[0] : published;
  const publishedId = publishedRow && typeof publishedRow === "object" && "id" in publishedRow
    ? String(publishedRow.id || "")
    : "";
  if (!publishedId) throw new Error("发布未返回版本 ID");

  const { error: legacyDeleteError } = await admin
    .from("admin_config_versions")
    .delete()
    .in("config_key", LEGACY_KEYS);
  if (legacyDeleteError) throw legacyDeleteError;

  const { error: historyDeleteError } = await admin
    .from("admin_config_versions")
    .delete()
    .eq("config_key", CONFIG_KEY)
    .neq("id", publishedId);
  if (historyDeleteError) throw historyDeleteError;

  console.log(JSON.stringify({
    published: true,
    versionId: publishedId,
    imageModels: imageModels().length,
    videoModels: videoModels().length,
    preservedModels: preservedModels.length,
    deletedLegacyConfigKeys: LEGACY_KEYS,
  }, null, 2));
}

async function getPublishedConfig(): Promise<AiControlPlaneConfig> {
  const { data, error } = await admin
    .from("admin_config_versions")
    .select("value")
    .eq("config_key", CONFIG_KEY)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.value) throw new Error("未找到已发布的统一模型控制面，拒绝覆盖文本/视觉模型");
  const validated = validateAiControlPlaneConfig(data.value);
  const errors = validated.issues.filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error("现有统一模型控制面无效，拒绝继续");
  return validated.config;
}

function imageModels(): AiLogicalModel[] {
  return [
    imageModel("nano-banana-2", "Nano Banana 2", ["generation", "edit"], { "1K": 4, "2K": 6, "4K": 8 }, "香蕉2", "推荐", "banana-2.png", 10, true),
    imageModel("nano-banana-2-lite", "Nano Banana 2 Lite", ["generation", "edit"], { "1K": 3 }, "香蕉2 Lite", "快速", "banana-2-lite-v2.png", 15),
    imageModel("gpt-image-2", "GPT Image 2", ["generation", "edit"], { "1K": 3, "2K": 4, "4K": 5 }, "GPT Image 2", "NEW", "gpt-image-2-gptstyle.png", 20),
    imageModel("nano-banana-pro", "Nano Banana Pro", ["generation", "edit"], { "1K": 8, "2K": 10, "4K": 12 }, "香蕉Pro", "PRO", "banana-pro.png", 30),
    imageModel("qwen3", "Qwen3 Image", ["generation", "edit"], { "1K": 3, "2K": 5 }, "千问3", "NEW", "qwen3-gptstyle.png", 40),
    imageModel("qwen3-pro", "Qwen3 Image Pro", ["generation", "edit"], { "1K": 5, "2K": 7 }, "千问3 Pro", "PRO", "qwen3-pro-gptstyle.png", 50),
    imageModel("z-image", "Z-Image", ["generation"], { "1K": 3 }, "Z-Image", "NEW", "z-image-gptstyle.png", 60),
  ];
}

function videoModels(): AiLogicalModel[] {
  const capabilities = ["image-to-video", "motion-control", "first-last-frame"];
  return [
    videoModel("video-minimax", "MiniMax H3", capabilities, { "pro:768p:minimum": 15, "pro:768p:perSecond": 3, "pro:2k:minimum": 20, "pro:2k:perSecond": 4 }),
    videoModel("video-seedance", "Seedance 2.0", capabilities, { "mini:720p:minimum": 20, "mini:720p:perSecond": 5, "fast:480p:minimum": 16, "fast:480p:perSecond": 4, "fast:720p:minimum": 24, "fast:720p:perSecond": 6, "pro:720p:minimum": 28, "pro:720p:perSecond": 7, "pro:1080p:minimum": 80, "pro:1080p:perSecond": 20 }),
    videoModel("video-seedance25", "Seedance 2.5", capabilities, { "pro:480p:minimum": 20, "pro:480p:perSecond": 5, "pro:720p:minimum": 28, "pro:720p:perSecond": 7, "pro:1080p:minimum": 80, "pro:1080p:perSecond": 20 }),
    videoModel("video-wan", "Wan 3.0", capabilities, { "pro:480p:minimum": 20, "pro:480p:perSecond": 5, "pro:720p:minimum": 28, "pro:720p:perSecond": 7, "pro:1080p:minimum": 80, "pro:1080p:perSecond": 20 }),
  ];
}

function kieProviders(): AiProviderEndpoint[] {
  return [
    provider("kie-banana", "Kie · Nano Banana", keys.banana, 20 * 60_000),
    provider("kie-gpt-image", "Kie · GPT Image", keys.gpt, 20 * 60_000),
    provider("kie-qwen", "Kie · Qwen / Z-Image", keys.qwen, 20 * 60_000),
    provider("kie-video", "Kie · Video", keys.video, 30 * 60_000),
  ];
}

function kieDeployments(): AiModelDeployment[] {
  const image = [
    deployment("kie-nano-banana-2", "nano-banana-2", "kie-banana", "nano-banana-2", ["generation", "edit"], 16, 60),
    deployment("kie-nano-banana-2-lite", "nano-banana-2-lite", "kie-banana", "nano-banana-2-lite", ["generation", "edit"], 16, 60),
    deployment("kie-gpt-image-2", "gpt-image-2", "kie-gpt-image", "gpt-image-2-text-to-image", ["generation", "edit"], 16, 60),
    deployment("kie-nano-banana-pro", "nano-banana-pro", "kie-banana", "nano-banana-pro", ["generation", "edit"], 12, 45),
    deployment("kie-qwen3", "qwen3", "kie-qwen", "qwen3/text-to-image", ["generation", "edit"], 16, 60),
    deployment("kie-qwen3-pro", "qwen3-pro", "kie-qwen", "qwen3/pro-text-to-image", ["generation", "edit"], 12, 45),
    deployment("kie-z-image", "z-image", "kie-qwen", "z-image", ["generation"], 16, 60),
  ];
  const videoCapabilities = ["image-to-video", "motion-control", "first-last-frame"];
  const video = [
    deployment("kie-minimax-h3", "video-minimax", "kie-video", "minimax-h3/image-to-video", videoCapabilities, 4, 24),
    deployment("kie-seedance-2", "video-seedance", "kie-video", "bytedance/seedance-2", videoCapabilities, 4, 24),
    deployment("kie-seedance-2-5", "video-seedance25", "kie-video", "bytedance/seedance-2-5", videoCapabilities, 4, 24),
    deployment("kie-wan-3", "video-wan", "kie-video", "wan/3-0-video", videoCapabilities, 4, 24),
  ];
  return [...image, ...video];
}

function imageModel(id: string, displayName: string, capabilities: string[], creditPrices: Record<string, number>, shortTitle: string, badge: string, icon: string, sortOrder: number, featured = false): AiLogicalModel {
  return {
    id, displayName, modality: "image", enabled: true, userVisible: true, capabilities,
    defaultRoutingMode: "stable", creditPrices,
    presentation: { shortTitle, badge, iconUrl: `${MODEL_ASSET_BASE}/${icon}`, sortOrder, featured },
  };
}

function videoModel(id: string, displayName: string, capabilities: string[], creditPrices: Record<string, number>): AiLogicalModel {
  return { id, displayName, modality: "video", enabled: true, userVisible: true, capabilities, defaultRoutingMode: "smart", creditPrices };
}

function provider(id: string, name: string, apiKey: string, timeoutMs: number): AiProviderEndpoint {
  return {
    id, name, baseUrl: KIE_API_BASE, apiKey: encryptProviderSecret(apiKey), enabled: true, timeoutMs,
    capacityGroup: id, capacityMaxConcurrency: 24, capacityRequestsPerMinute: 120, capacityBurst: 24,
    notes: "Kie Market unified asynchronous jobs API",
  };
}

function deployment(id: string, modelId: string, providerId: string, upstreamModel: string, capabilities: string[], maxConcurrency: number, requestsPerMinute: number): AiModelDeployment {
  return {
    id, modelId, providerId, upstreamModel, protocol: "kie-market", enabled: true,
    priority: 10, weight: 100, maxConcurrency, requestsPerMinute, burst: maxConcurrency,
    asyncMode: true, capabilities, qualityScore: 0.9,
    adapterConfig: { generationPath: "/api/v1/jobs/createTask", statusPath: "/api/v1/jobs/recordInfo", authMode: "bearer" },
  };
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Kie model reconfiguration failed");
  process.exitCode = 1;
});
