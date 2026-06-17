"use client";

import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    if (typeof input === "string") {
        try {
            const blob = await (await fetch(input)).blob();
            return await finalizeUploadedImage(blob);
        } catch {
            // Direct fetch failed (likely CORS or remote network issue).
            // Fall back to the server-side proxy which can fetch the URL on our behalf.
            const response = await fetch("/api/upload-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: input, name: "canvas-image" }),
            });
            if (!response.ok) throw new Error(`平台图片上传失败: HTTP ${response.status}`);
            const payload = (await response.json()) as { url?: string; display_url?: string; width?: number; height?: number };
            const url = payload.display_url || payload.url || input;
            if (!url) throw new Error("平台图片上传未返回 URL");
            const dimensions = await readRemoteImageDimensions(url);
            return { url, storageKey: "", width: dimensions.width, height: dimensions.height, bytes: 0, mimeType: "" };
        }
    }
    return finalizeUploadedImage(input);
}

async function finalizeUploadedImage(blob: Blob): Promise<UploadedImage> {
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    const platformUrl = await uploadImageToPlatform(blob).catch(() => "");
    return { url: platformUrl || url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

async function readRemoteImageDimensions(url: string): Promise<{ width: number; height: number }> {
    // Try to read natural dimensions via a probe <img> (works for CORS-friendly hosts).
    // On CORS-blocked hosts, dimensions will be 0 and the node will fall back to its default size.
    return new Promise((resolve) => {
        if (typeof Image === "undefined") return resolve({ width: 0, height: 0 });
        const probe = new Image();
        let settled = false;
        const finish = (value: { width: number; height: number }) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        probe.onload = () => finish({ width: probe.naturalWidth || 0, height: probe.naturalHeight || 0 });
        probe.onerror = () => finish({ width: 0, height: 0 });
        probe.src = url;
        // Safety net for cases where neither load nor error fires (rare).
        setTimeout(() => finish({ width: 0, height: 0 }), 8000);
    });
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
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

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function uploadImageToPlatform(blob: Blob) {
    const formData = new FormData();
    const ext = imageExtension(blob.type);
    const file = blob instanceof File ? blob : new File([blob], `canvas-image.${ext}`, { type: blob.type || "image/png" });
    formData.set("image", file);
    formData.set("name", file.name.replace(/\.[^.]+$/, "") || "canvas-image");
    const response = await fetch("/api/upload-image", { method: "POST", body: formData });
    if (!response.ok) throw new Error("平台图片上传失败");
    const payload = (await response.json()) as { display_url?: string; url?: string };
    return payload.display_url || payload.url || "";
}

function imageExtension(type?: string) {
    if (type?.includes("jpeg")) return "jpg";
    if (type?.includes("webp")) return "webp";
    if (type?.includes("gif")) return "gif";
    return "png";
}

function isPublicOrDataUrl(value: string) {
    return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}
