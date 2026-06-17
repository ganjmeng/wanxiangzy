import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "platform"; model: string; path: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

type PlatformCreateResponse = {
    generation_id?: string;
    error?: string;
};

type PlatformStatusResponse = {
    status?: string;
    status_group?: string;
    result_urls?: string[];
    error?: string;
};

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    for (let attempt = 0; attempt < 180; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await delay(attempt < 2 ? 1000 : 2500, options?.signal);
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
    }
    throw new Error("视频生成超时，请稍后在作品历史中查看结果");
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const request = await buildPlatformVideoRequest(config, prompt, references, videoReferences, audioReferences);
    const response = await fetch(request.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readPlatformFetchError(response, "视频生成任务创建失败"));

    const payload = (await response.json()) as PlatformCreateResponse;
    if (!payload.generation_id) throw new Error(payload.error || "视频接口没有返回任务 ID");
    return { id: payload.generation_id, provider: "platform", model: modelOptionName(config.model || config.videoModel), path: request.path };
}

export async function pollVideoGenerationTask(_config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const response = await fetch(`${task.path}?generation_id=${encodeURIComponent(task.id)}`, { signal: options?.signal });
    if (!response.ok) throw new Error(await readPlatformFetchError(response, "视频任务查询失败"));

    const payload = (await response.json()) as PlatformStatusResponse;
    const status = normalizeStatus(payload.status_group || payload.status);
    if (status === "completed") {
        const url = (payload.result_urls || []).find(Boolean);
        return url ? { status: "completed", result: { url, mimeType: "video/mp4" } } : { status: "failed", error: "视频接口没有返回可播放结果" };
    }
    if (status === "failed") return { status: "failed", error: payload.error || "视频生成失败" };
    return { status: "pending" };
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
    throw new Error("视频接口没有返回可播放的视频");
}

async function buildPlatformVideoRequest(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const common = {
        prompt: prompt.trim(),
        modelMode: normalizeModelMode(config.videoModel || config.model),
        resolution: normalizeResolution(config.vquality),
        duration: normalizeDuration(config.videoSeconds),
        aspectRatio: normalizeAspectRatio(config.size),
        genCount: normalizeCount(config.count),
        audioMode: normalizeAudioMode(config.videoGenerateAudio, audioReferences),
        audioUrl: audioReferences[0]?.url || "",
        audioPrompt: config.audioInstructions || "",
    };

    if (videoReferences.length && references.length) {
        return {
            path: "/api/video/motion-control",
            body: {
                ...common,
                modelImageUrl: await imageReferenceUrl(references[0]),
                referenceVideoUrl: videoReferences[0].url,
            },
        };
    }

    if (references.length >= 2) {
        return {
            path: "/api/video/first-last-frame",
            body: {
                ...common,
                firstFrameUrl: await imageReferenceUrl(references[0]),
                lastFrameUrl: await imageReferenceUrl(references[1]),
            },
        };
    }

    if (references.length >= 1) {
        return {
            path: "/api/video/image-to-video",
            body: {
                ...common,
                imageUrl: await imageReferenceUrl(references[0]),
            },
        };
    }

    throw new Error("请连接图片节点后生成视频");
}

async function imageReferenceUrl(image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (/^https?:\/\//i.test(directUrl || "") || /^data:image\//i.test(directUrl || "")) return directUrl;
    return imageToDataUrl(image);
}

function normalizeModelMode(value: string) {
    const model = modelOptionName(value).toLowerCase();
    return model.includes("fast") ? "fast" : "pro";
}

function normalizeResolution(value: string) {
    return value === "1080p" || value === "1080" || value === "high" ? "1080p" : "720p";
}

function normalizeDuration(value: string) {
    const duration = Math.round(Number(value) || 5);
    return Math.max(3, Math.min(15, duration));
}

function normalizeAspectRatio(value: string) {
    const supported = new Set(["auto", "3:4", "9:16", "1:1", "4:3", "16:9"]);
    return supported.has(value) ? value : "auto";
}

function normalizeCount(value: string) {
    const count = Math.floor(Math.abs(Number(value)) || 1);
    return Math.max(1, Math.min(4, count));
}

function normalizeAudioMode(generateAudio: string, audioReferences: ReferenceAudio[]) {
    if (audioReferences[0]?.url) return "custom";
    return generateAudio === "true" ? "generated" : "off";
}

async function readPlatformFetchError(response: Response, fallback: string) {
    let payload: unknown = null;
    try {
        payload = await response.json();
    } catch {
        // Ignore non-JSON platform errors.
    }
    const error = payload && typeof payload === "object" ? (payload as Record<string, unknown>).error : undefined;
    if (typeof error === "string" && error.trim()) return error;
    if (response.status === 401 || response.status === 403) return "请先登录后使用画布视频生成";
    if (response.status === 402) return "灵点不足，请充值后重试";
    if (response.status === 429) return "请求过于频繁，请稍后重试";
    return fallback;
}

function normalizeStatus(value: string | undefined) {
    const status = (value || "").toLowerCase();
    if (["completed", "complete", "success", "succeeded", "done", "finished"].includes(status)) return "completed";
    if (["failed", "error", "cancelled", "canceled"].includes(status)) return "failed";
    return "processing";
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
