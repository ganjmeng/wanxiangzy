import type { TaskQueueItem, TaskQueueSummary, TaskStatusGroup } from "@/lib/task-queue";
import { safeTaskQueueUrls } from "@/lib/task-queue";
import { normalizeGenerationState } from "@/lib/api/generation-state";
import { getTryOnInputReferenceUrls, TRYON_INPUT_REFERENCE_LIMIT } from "@/lib/tryon-input-references";
import { getGeneralImageHistoryMode, getHistoryModulePath } from "@/lib/history-apply";
import {
  AI_TOOL_CATALOG,
  getAiToolPath,
  isAiToolSlug,
  type AiToolSlug,
} from "@/lib/ai-tools/catalog";

export const TASK_QUEUE_ITEM_TTL_SECONDS = 60 * 60 * 24 * 30;
export const TASK_QUEUE_SUMMARY_TTL_SECONDS = 60 * 5;
export const TASK_QUEUE_MODULE_CACHE_LIMIT = 100;
export const TASK_QUEUE_RUNNING_STALE_MS = 60 * 60 * 1000;
export const TASK_RESULT_THUMBNAIL_LIMIT = 4;

export type TaskQueueSourceType = "generation" | "creative_run" | "ai_tool";

export type TaskQueueGenerationSourceRow = {
  id: string;
  user_id: string;
  status: string | null;
  error_message: string | null;
  result_urls: string[] | null;
  created_at: string | null;
  completed_at: string | null;
  processing_started_at?: string | null;
  updated_at?: string | null;
  job_payload?: Record<string, unknown> | null;
  clothing_urls?: string[] | null;
  model_face_url?: string | null;
  reference_url?: string | null;
};

export type TaskQueueCreativeRunSourceRow = {
  id: string;
  user_id: string;
  status: string | null;
  generation_type?: string | null;
  intent?: string | null;
  summary?: string | null;
  input_images?: unknown;
  error_message?: string | null;
  created_at: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  workflow_payload?: Record<string, unknown> | null;
  final_outputs?: unknown;
};

export type TaskQueueAiToolSourceRow = {
  id: string;
  user_id: string;
  provider_task_id?: string | null;
  operation: AiToolSlug;
  status: string | null;
  source_url: string;
  request_payload?: Record<string, unknown> | null;
  provider_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  output_persistence_status?: "pending" | "processing" | "completed" | "failed" | null;
  result_urls?: string[] | null;
  last_error?: Record<string, unknown> | null;
  created_at: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  generation_id?: string | null;
};

export type TaskQueueIndexRow = {
  id?: string;
  user_id: string;
  source_type: TaskQueueSourceType;
  source_id: string;
  module: string;
  title: string;
  status: string;
  status_group: TaskStatusGroup;
  progress: number;
  expected_count: number;
  result_count: number;
  input_thumbnails: string[] | null;
  result_thumbnails: string[] | null;
  error_message: string | null;
  apply_url: string;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
};

export type TaskQueueIndexWrite = Omit<TaskQueueIndexRow, "id">;

const MODULE_LABELS: Record<string, string> = {
  tryon: "服装上身",
  model: "专属模特",
  face: "换脸",
  seeding: "种草图",
  productSet: "商品套图",
  productRetouch: "商品精修",
  faceSwap: "换脸",
  grass: "种草图",
  modelBackground: "换背景",
  garment3d: "服装 3D",
  generalImage: "创意生图",
  outfitFusion: "搭配融图",
  background: "换背景",
  pose: "姿势裂变",
  "3d": "服装 3D",
  image: "图生图",
  videoImageToVideo: "图生视频",
  videoMotion: "动作模仿",
  videoFirstLastFrame: "首尾帧",
  workflow: "工作流",
  creativeRun: "创意任务",
  toolbox: "AI工具箱",
};

export const TASK_QUEUE_MODULE_LABEL_KEYS: Record<string, string> = {
  tryon: "LibShared.taskQueue.module.tryon",
  model: "LibShared.taskQueue.module.model",
  face: "LibShared.taskQueue.module.faceSwap",
  seeding: "LibShared.taskQueue.module.grass",
  productSet: "LibShared.taskQueue.module.productSet",
  productRetouch: "LibShared.taskQueue.module.productRetouch",
  faceSwap: "LibShared.taskQueue.module.faceSwap",
  grass: "LibShared.taskQueue.module.grass",
  modelBackground: "LibShared.taskQueue.module.modelBackground",
  garment3d: "LibShared.taskQueue.module.garment3d",
  generalImage: "LibShared.taskQueue.module.generalImage",
  outfitFusion: "LibShared.taskQueue.module.outfitFusion",
  background: "LibShared.taskQueue.module.modelBackground",
  pose: "LibShared.taskQueue.module.pose",
  "3d": "LibShared.taskQueue.module.garment3d",
  image: "LibShared.taskQueue.module.imageToImage",
  videoImageToVideo: "LibShared.taskQueue.module.videoImageToVideo",
  videoMotion: "LibShared.taskQueue.module.videoMotion",
  videoFirstLastFrame: "LibShared.taskQueue.module.videoFirstLastFrame",
  workflow: "LibShared.taskQueue.module.workflow",
  creativeRun: "LibShared.taskQueue.module.workflow",
};

export const TASK_QUEUE_FALLBACK_TITLE = "任务";
export const TASK_QUEUE_FALLBACK_TITLE_KEY = "LibShared.taskQueue.fallbackTitle";
export const TASK_QUEUE_ELAPSED_JUST_NOW = "刚刚";
export const TASK_QUEUE_ELAPSED_JUST_NOW_KEY = "LibShared.taskQueue.justNow";

const MODULE_PATHS: Record<string, string> = {
  tryon: "/create",
  model: "/model",
  face: "/face-swap",
  seeding: "/seeding",
  productSet: "/product-set",
  productRetouch: "/product-retouch",
  faceSwap: "/face-swap",
  grass: "/grass",
  modelBackground: "/model-background",
  garment3d: "/garment-3d",
  generalImage: "/general-image",
  outfitFusion: "/outfit-fusion",
  background: "/background",
  pose: "/pose",
  "3d": "/garment-3d",
  image: "/image-to-image",
  videoImageToVideo: "/video",
  videoMotion: "/video/motion-control",
  videoFirstLastFrame: "/video/first-last-frame",
  workflow: "/workflow",
  creativeRun: "/agent",
  toolbox: "/ai-tools",
};

export function emptyTaskQueueSummary(): TaskQueueSummary {
  return {
    totalTaskNum: 0,
    finishedTaskNum: 0,
    finishedNeedReadTaskNum: 0,
    runningTaskNum: 0,
    failedTaskNum: 0,
  };
}

export function taskQueueStatusGroup(status: string | null | undefined, resultCount = 0): TaskStatusGroup {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "failed" || normalized === "timeout" || normalized === "canceled" || normalized === "cancelled" || normalized === "needs_review") {
    return "failed";
  }
  if (normalized === "completed" || normalized === "succeeded" || normalized === "success") {
    return "completed";
  }
  if (
    normalized.startsWith("processing") ||
    normalized === "running" ||
    normalized === "generating" ||
    normalized === "in_progress"
  ) {
    return "running";
  }
  if (resultCount > 0) {
    return "completed";
  }
  return "queued";
}

export function isRunningTaskStale(item: Pick<TaskQueueItem, "statusGroup" | "createdAt" | "updatedAt" | "resultCount">) {
  if (item.statusGroup !== "queued" && item.statusGroup !== "running") {
    return false;
  }
  if (item.resultCount > 0) {
    return false;
  }
  const baseTime = item.updatedAt || item.createdAt;
  const time = baseTime ? Date.parse(baseTime) : 0;
  return Number.isFinite(time) && time > 0 && Date.now() - time > TASK_QUEUE_RUNNING_STALE_MS;
}

export function applyStaleRunningFallback(item: TaskQueueItem): TaskQueueItem {
  const presentationSafeItem = item.statusGroup === "failed" || !item.error
    ? item
    : { ...item, error: "" };
  if (!isRunningTaskStale(item)) {
    return presentationSafeItem;
  }
  return {
    ...presentationSafeItem,
    status: "processing_delayed",
    statusGroup: "running",
    error: "",
    progress: Math.max(item.progress, 99),
  };
}

export function inferGenerationModule(row: TaskQueueGenerationSourceRow): string {
  const payload = row.job_payload || {};
  if (isAiToolPayload(payload)) return "toolbox";
  const explicit = stringValue(payload.module) || stringValue(payload.kind) || stringValue(payload.generationType);
  if (explicit) {
    return normalizeModule(explicit);
  }

  if (payload.faceMode || payload.targetFaceUrl || row.model_face_url) {
    return "faceSwap";
  }
  if (payload.poseMode || payload.poseReferenceUrl || payload.poseReferenceUrls) {
    return "pose";
  }
  if (payload.backgroundMode || payload.backgroundReferenceUrl || payload.backgroundReferenceUrls) {
    return "modelBackground";
  }
  if (payload.productSetMode || payload.productSetTemplate || payload.sceneImages) {
    return "productSet";
  }
  if (payload.seedingMode || payload.marketingMode || payload.copywritingMode) {
    return "grass";
  }
  if (payload.modelPresetId || payload.modelStyle || payload.modelSeed) {
    return "model";
  }
  if (payload.imageToImageMode || payload.imageMode) {
    return "image";
  }
  return "tryon";
}

export function inferCreativeRunModule(row: TaskQueueCreativeRunSourceRow): string {
  const payload = row.workflow_payload || {};
  const explicit = row.generation_type || stringValue(payload.module) || stringValue(payload.kind) || "";
  if (explicit) {
    return normalizeModule(explicit);
  }
  return "creativeRun";
}

export function normalizeModule(module: string): string {
  const value = module.trim();
  const lower = value.toLowerCase();
  if (lower === "productset" || lower === "product-set" || lower === "product_set") {
    return "productSet";
  }
  if (lower === "productretouch" || lower === "product-retouch" || lower === "product_retouch") {
    return "productRetouch";
  }
  if (lower === "face-swap" || lower === "faceswap") {
    return "faceSwap";
  }
  if (lower === "try-on" || lower === "try_on" || lower === "garment-tryon") {
    return "tryon";
  }
  if (lower === "image-to-image" || lower === "image_to_image" || lower === "i2i") {
    return "image";
  }
  if (lower === "garment-3d" || lower === "clothing3d" || lower === "garment3d") {
    return "garment3d";
  }
  if (lower === "model-background" || lower === "model_background" || lower === "modelbackground") {
    return "modelBackground";
  }
  if (lower === "general-image" || lower === "general_image" || lower === "generalimage") {
    return "generalImage";
  }
  if (lower === "outfit-fusion" || lower === "outfit_fusion" || lower === "outfitfusion" || lower === "image-fusion" || lower === "image_fusion") {
    return "outfitFusion";
  }
  if (lower === "video-image-to-video" || lower === "video_image_to_video" || lower === "videoimagetovideo" || lower === "image-to-video-video") {
    return "videoImageToVideo";
  }
  if (lower === "video-motion" || lower === "video_motion" || lower === "videomotion" || lower === "motion-control" || lower === "motion_control") {
    return "videoMotion";
  }
  if (lower === "video-first-last-frame" || lower === "video_first_last_frame" || lower === "videofirstlastframe" || lower === "first-last-frame" || lower === "first_last_frame") {
    return "videoFirstLastFrame";
  }
  if (lower.includes("tryon") || lower.includes("try-on")) {
    return "tryon";
  }
  if (lower.includes("face")) {
    return "faceSwap";
  }
  if (lower.includes("pose")) {
    return "pose";
  }
  return value;
}

export function moduleTitle(module: string): string {
  return MODULE_LABELS[module] || module || TASK_QUEUE_FALLBACK_TITLE;
}

export function modulePath(module: string): string {
  return MODULE_PATHS[module] || "/create";
}

export function normalizeGenerationTaskQueueItem(row: TaskQueueGenerationSourceRow): TaskQueueItem {
  const resultUrls = arrayOfStrings(row.result_urls);
  const state = normalizeGenerationState({
    status: row.status,
    resultUrls,
    payload: row.job_payload || null,
    completedAt: row.completed_at,
  });
  const module = inferGenerationModule(row);
  const statusGroup = taskQueueStatusGroup(state.status, resultUrls.length);
  const createdAt = row.created_at || new Date().toISOString();
  const updatedAt = row.updated_at || row.completed_at || row.processing_started_at || row.created_at || createdAt;
  const inputThumbnails = extractGenerationInputThumbnails(row);
  const resultThumbnails = resultUrls.slice(0, TASK_RESULT_THUMBNAIL_LIMIT);
  const item: TaskQueueItem = {
    id: row.id,
    module,
    scope: taskScope(module, row.job_payload),
    title: moduleTitle(module),
    status: state.status,
    statusGroup,
    time: formatElapsed(createdAt, row.completed_at),
    createdAt,
    updatedAt,
    completedAt: row.completed_at || (statusGroup === "completed" || statusGroup === "failed" ? row.updated_at || null : null),
    error: statusGroup === "failed" ? row.error_message || "" : "",
    progress: statusGroup === "completed" ? 100 : statusGroup === "failed" ? 0 : inferProgress(row.status, row.job_payload),
    expectedCount: inferExpectedCount(row.job_payload, resultUrls.length),
    resultCount: resultUrls.length,
    inputThumbnails,
    resultThumbnails,
    thumbnails: resultThumbnails.length > 0 ? resultThumbnails : inputThumbnails,
    applyUrl: generationApplyUrl(module, row.id, row.job_payload),
  };
  return applyStaleRunningFallback(item);
}

function taskScope(module: string, payload?: Record<string, unknown> | null) {
  if (module === "toolbox") {
    const operation = aiToolOperation(payload);
    return operation || undefined;
  }
  if (module !== "generalImage") return undefined;
  return getGeneralImageHistoryMode(payload || undefined);
}

export function normalizeAiToolTaskQueueItem(row: TaskQueueAiToolSourceRow): TaskQueueItem {
  const resultUrls = arrayOfStrings(row.result_urls);
  const isPersistingOutput = row.status === "completed" && row.output_persistence_status !== "completed";
  const effectiveStatus = isPersistingOutput
    ? row.output_persistence_status === "failed" ? "failed" : "processing"
    : row.status;
  const statusGroup = taskQueueStatusGroup(effectiveStatus, resultUrls.length);
  const createdAt = row.created_at || new Date().toISOString();
  const completedAt = row.completed_at || (statusGroup === "completed" || statusGroup === "failed" ? row.updated_at || null : null);
  const providerPayload = row.provider_payload || row.response_payload || {};
  const expectedCount = Math.max(1, Math.floor(numberValue(providerPayload.expected_count) || resultUrls.length || 1));
  const progress = statusGroup === "completed"
    ? 100
    : statusGroup === "failed"
      ? 0
      : isPersistingOutput
        ? 99
        : clampProgress(providerPayload.progress || (statusGroup === "running" ? 34 : 8));
  const taskId = row.provider_task_id || row.id;
  const item: TaskQueueItem = {
    id: row.id,
    module: "toolbox",
    scope: row.operation,
    title: AI_TOOL_CATALOG[row.operation].label,
    status: effectiveStatus || "queued",
    statusGroup,
    time: formatElapsed(createdAt, completedAt),
    createdAt,
    updatedAt: row.updated_at || completedAt || createdAt,
    completedAt,
    error: stringValue(row.last_error?.message),
    progress,
    expectedCount,
    resultCount: resultUrls.length,
    inputThumbnails: uniqueStrings([row.source_url]),
    resultThumbnails: resultUrls.slice(0, TASK_RESULT_THUMBNAIL_LIMIT),
    thumbnails: resultUrls.length ? resultUrls.slice(0, TASK_RESULT_THUMBNAIL_LIMIT) : uniqueStrings([row.source_url]),
    applyUrl: `${getAiToolPath(row.operation)}?task=${encodeURIComponent(taskId)}`,
  };
  return isPersistingOutput ? item : applyStaleRunningFallback(item);
}

export function normalizeCreativeRunTaskQueueItem(row: TaskQueueCreativeRunSourceRow): TaskQueueItem {
  const module = inferCreativeRunModule(row);
  const resultThumbnails = extractWorkflowResultThumbnails(row.final_outputs);
  const statusGroup = taskQueueStatusGroup(row.status, resultThumbnails.length);
  const createdAt = row.created_at || new Date().toISOString();
  const updatedAt = row.updated_at || row.completed_at || row.created_at || createdAt;
  const item: TaskQueueItem = {
    id: row.id,
    module,
    title: row.summary || moduleTitle(module),
    status: row.status || "queued",
    statusGroup,
    time: formatElapsed(createdAt, row.completed_at || null),
    createdAt,
    updatedAt,
    completedAt: row.completed_at || (statusGroup === "completed" || statusGroup === "failed" ? row.updated_at || null : null),
    error: row.error_message || "",
    progress: statusGroup === "completed" ? 100 : statusGroup === "failed" ? 0 : 30,
    expectedCount: Math.max(1, resultThumbnails.length || numberValue(row.workflow_payload?.count) || 1),
    resultCount: resultThumbnails.length,
    inputThumbnails: extractWorkflowInputThumbnails(row.workflow_payload, row.input_images),
    resultThumbnails,
    thumbnails: resultThumbnails,
    applyUrl: `/agent?run=${encodeURIComponent(row.id)}`,
  };
  return applyStaleRunningFallback(item);
}

export function indexRowToTaskQueueItem(row: TaskQueueIndexRow): TaskQueueItem {
  const inputThumbnails = arrayOfStrings(row.input_thumbnails);
  const resultThumbnails = arrayOfStrings(row.result_thumbnails);
  const createdAt = row.created_at || new Date().toISOString();
  const statusGroup = row.status_group || taskQueueStatusGroup(row.status, row.result_count);
  const item: TaskQueueItem = {
    id: row.source_id,
    module: row.module,
    title: row.title || moduleTitle(row.module),
    status: row.status || row.status_group || "queued",
    statusGroup,
    time: formatElapsed(createdAt, row.completed_at),
    createdAt,
    updatedAt: row.updated_at || row.completed_at || createdAt,
    completedAt: row.completed_at || null,
    error: statusGroup === "failed" ? row.error_message || "" : "",
    progress: clampProgress(row.progress),
    expectedCount: Math.max(1, Number(row.expected_count) || 1),
    resultCount: Math.max(0, Number(row.result_count) || 0),
    inputThumbnails,
    resultThumbnails,
    thumbnails: resultThumbnails.length > 0 ? resultThumbnails : inputThumbnails,
    applyUrl: row.apply_url || `${modulePath(row.module)}?task=${encodeURIComponent(row.source_id)}`,
  };
  return applyStaleRunningFallback(item);
}

export function taskQueueItemToIndexWrite(
  item: TaskQueueItem,
  params: { userId: string; sourceType: TaskQueueSourceType; sourceId?: string },
): TaskQueueIndexWrite {
  return {
    user_id: params.userId,
    source_type: params.sourceType,
    source_id: params.sourceId || item.id,
    module: item.module,
    title: item.title || moduleTitle(item.module),
    status: item.status,
    status_group: item.statusGroup,
    progress: clampProgress(item.progress),
    expected_count: Math.max(1, Number(item.expectedCount) || 1),
    result_count: Math.max(0, Number(item.resultCount) || 0),
    input_thumbnails: safeTaskQueueUrls(item.inputThumbnails).slice(0, item.module === "tryon" ? TRYON_INPUT_REFERENCE_LIMIT : 8),
    result_thumbnails: safeTaskQueueUrls(item.resultThumbnails).slice(0, TASK_RESULT_THUMBNAIL_LIMIT),
    error_message: item.error || null,
    apply_url: item.applyUrl || `${modulePath(item.module)}?task=${encodeURIComponent(item.id)}`,
    created_at: item.createdAt,
    updated_at: item.updatedAt || item.completedAt || item.createdAt,
    completed_at: item.completedAt || null,
  };
}

export function summarizeTaskQueueItems(items: TaskQueueItem[]): TaskQueueSummary {
  return items.reduce<TaskQueueSummary>((summary, rawItem) => {
    const item = applyStaleRunningFallback(rawItem);
    summary.totalTaskNum += 1;
    if (item.statusGroup === "failed") {
      summary.failedTaskNum += 1;
    } else if (item.statusGroup === "queued" || item.statusGroup === "running") {
      summary.runningTaskNum += 1;
    } else {
      summary.finishedTaskNum += 1;
    }
    return summary;
  }, emptyTaskQueueSummary());
}

export function isTaskQueueIndexMissingError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) {
    return false;
  }
  const message = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return message.includes("task_queue_items") || message.includes("42p01") || message.includes("does not exist");
}

function extractGenerationInputThumbnails(row: TaskQueueGenerationSourceRow): string[] {
  const payload = row.job_payload || {};
  if (payload.kind === "tryon") {
    return getTryOnInputReferenceUrls({
      clothingUrls: arrayOfStrings(payload.clothingUrls).length
        ? arrayOfStrings(payload.clothingUrls)
        : row.clothing_urls,
      clothingMode: stringValue(payload.clothingMode),
      clothingRoles: Array.isArray(payload.clothingRoles) ? payload.clothingRoles : undefined,
      referenceUrl: stringValue(payload.referenceUrl) || row.reference_url,
      referenceUrls: arrayOfStrings(payload.referenceUrls),
      modelFaceUrl: stringValue(payload.modelFaceUrl) || row.model_face_url,
      garmentDetailUrls: arrayOfStrings(payload.garmentDetailUrls),
    });
  }

  return uniqueStrings([
    ...arrayOfStrings(row.clothing_urls),
    row.reference_url,
    row.model_face_url,
    ...arrayOfStrings(payload.clothingUrls),
    ...arrayOfStrings(payload.productImageUrls),
    ...arrayOfStrings(payload.sourceUrls),
    ...arrayOfStrings(payload.referenceUrls),
    ...arrayOfStrings(payload.garmentDetailUrls),
    ...arrayOfStrings(payload.referenceImageUrls),
    ...arrayOfStrings(payload.poseReferenceUrls),
    ...arrayOfStrings(payload.sceneImages),
    ...arrayOfStrings(payload.inputUrls),
    stringValue(payload.clothingUrl),
    stringValue(payload.referenceUrl),
    stringValue(payload.modelFaceUrl),
    stringValue(payload.targetFaceUrl),
    stringValue(payload.backgroundReferenceUrl),
    stringValue(payload.poseReferenceUrl),
    stringValue(payload.imageUrl),
    stringValue(payload.modelImageUrl),
    stringValue(payload.firstFrameUrl),
    stringValue(payload.lastFrameUrl),
    stringValue(payload.referenceVideoUrl),
  ]).slice(0, 8);
}

function generationApplyUrl(
  module: string,
  generationId: string,
  payload?: Record<string, unknown> | null,
) {
  const operation = module === "toolbox" ? aiToolOperation(payload) : null;
  if (operation) return `${getAiToolPath(operation)}?task=${encodeURIComponent(generationId)}`;
  return `${getHistoryModulePath(module, payload || undefined) || modulePath(module)}?apply=${encodeURIComponent(generationId)}`;
}

function isAiToolPayload(payload: Record<string, unknown>) {
  return Boolean(aiToolOperation(payload));
}

function aiToolOperation(payload?: Record<string, unknown> | null): AiToolSlug | null {
  const aiTool = payload?.aiTool;
  if (!aiTool || typeof aiTool !== "object" || Array.isArray(aiTool)) return null;
  const operation = stringValue((aiTool as Record<string, unknown>).operation);
  return isAiToolSlug(operation) ? operation : null;
}

function extractWorkflowInputThumbnails(
  payload: Record<string, unknown> | null | undefined,
  inputImages?: unknown,
): string[] {
  const imageUrls = extractUrlsFromUnknown(inputImages);
  if (!payload) {
    return uniqueStrings(imageUrls).slice(0, 8);
  }
  return uniqueStrings([
    ...imageUrls,
    ...arrayOfStrings(payload.inputUrls),
    ...arrayOfStrings(payload.referenceUrls),
    ...arrayOfStrings(payload.imageUrls),
    stringValue(payload.inputUrl),
    stringValue(payload.referenceUrl),
    stringValue(payload.imageUrl),
  ]).slice(0, 8);
}

function extractWorkflowResultThumbnails(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((entry) => extractUrlsFromUnknown(entry))).slice(0, TASK_RESULT_THUMBNAIL_LIMIT);
  }
  return uniqueStrings(extractUrlsFromUnknown(value)).slice(0, TASK_RESULT_THUMBNAIL_LIMIT);
}

function extractUrlsFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    return isLikelyUrl(value) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractUrlsFromUnknown(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      stringValue(record.url),
      stringValue(record.imageUrl),
      stringValue(record.outputUrl),
      stringValue(record.resultUrl),
      ...arrayOfStrings(record.urls),
      ...arrayOfStrings(record.images),
      ...arrayOfStrings(record.resultUrls),
      ...arrayOfStrings(record.inputUrls),
      ...arrayOfStrings(record.referenceUrls),
      ...arrayOfStrings(record.imageUrls),
      stringValue(record.inputUrl),
      stringValue(record.referenceUrl),
    ].filter(Boolean);
  }
  return [];
}

function inferExpectedCount(payload: Record<string, unknown> | null | undefined, resultCount: number): number {
  if (!payload) {
    return Math.max(1, resultCount || 1);
  }
  if (payload.kind === "tryon") {
    const referenceCount = payload.sceneMode === "auto_design"
      ? 1
      : Math.max(1, uniqueStrings([...arrayOfStrings(payload.referenceUrls), stringValue(payload.referenceUrl)]).length);
    const perReferenceCount = Math.max(1, Math.floor(numberValue(payload.genCount) || 1));
    return Math.max(1, perReferenceCount * referenceCount, resultCount || 1);
  }
  return Math.max(
    1,
    numberValue(payload.imageCount) ||
      numberValue(payload.count) ||
      numberValue(payload.genCount) ||
      numberValue(payload.n) ||
      resultCount ||
      1,
  );
}

function inferProgress(status: string | null | undefined, payload: Record<string, unknown> | null | undefined): number {
  const direct = payload ? numberValue(payload.progress) : 0;
  if (direct > 0) {
    return clampProgress(direct);
  }
  const normalized = String(status || "").toLowerCase();
  if (normalized === "queued") {
    return 8;
  }
  if (normalized.startsWith("processing") || normalized === "running") {
    return 34;
  }
  return 12;
}

function formatElapsed(createdAt: string | null | undefined, completedAt: string | null | undefined): string {
  const start = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(start)) {
    return TASK_QUEUE_ELAPSED_JUST_NOW;
  }
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function arrayOfStrings(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  return [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || seen.has(value) || !isLikelyUrl(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function isLikelyUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/") || value.startsWith("data:video/");
}

function clampProgress(value: unknown): number {
  const progress = numberValue(value);
  if (progress <= 0) {
    return 0;
  }
  if (progress >= 100) {
    return 100;
  }
  return Math.round(progress);
}
