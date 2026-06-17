"use client";

import localforage from "localforage";
import { nanoid } from "nanoid";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const storageKey = `${prefix}:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    const platformUrl = await uploadMediaToPlatform(blob, prefix).catch(() => "");
    return { url: platformUrl || url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (isPublicOrDataUrl(fallback)) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const usedKeys = collectMediaStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await Promise.all(unused.map((key) => store.removeItem(key)));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}

async function uploadMediaToPlatform(blob: Blob, prefix: string) {
    const kind = blob.type.startsWith("audio/") || prefix === "audio" ? "audio" : blob.type.startsWith("video/") || prefix === "video" ? "video" : "";
    if (!kind) return "";
    const formData = new FormData();
    const file = blob instanceof File ? blob : new File([blob], `canvas-${kind}.${mediaExtension(kind, blob.type)}`, { type: blob.type || (kind === "audio" ? "audio/mpeg" : "video/mp4") });
    formData.set(kind, file);
    formData.set("name", file.name.replace(/\.[^.]+$/, "") || `canvas-${kind}`);
    const response = await fetch(kind === "audio" ? "/api/upload-audio" : "/api/upload-video", { method: "POST", body: formData });
    if (!response.ok) throw new Error("平台媒体上传失败");
    const payload = (await response.json()) as { display_url?: string; url?: string };
    return payload.display_url || payload.url || "";
}

function mediaExtension(kind: "audio" | "video", type?: string) {
    if (kind === "audio") {
        if (type?.includes("wav")) return "wav";
        if (type?.includes("aac")) return "aac";
        if (type?.includes("mp4")) return "m4a";
        return "mp3";
    }
    if (type?.includes("quicktime")) return "mov";
    return "mp4";
}

function isPublicOrDataUrl(value: string) {
    return /^https?:\/\//i.test(value) || /^data:(audio|video)\//i.test(value);
}
