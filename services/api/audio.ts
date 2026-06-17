import { audioMimeType } from "@/lib/audio-generation";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

export async function requestAudioGeneration(_config: AiConfig, _prompt: string, _options?: RequestOptions): Promise<Blob> {
    throw new Error("平台音频生成待启用");
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}
