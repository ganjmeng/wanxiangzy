import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 生成最佳实践下载文件名
 * 格式: {prefix}-{YYYYMMDD}-{HHmmss}-{序号}.{ext}
 * 示例: vastweargen-tryon-20260502-143022-01.png
 */
export function generateDownloadFilename(prefix: string, index: number, ext = "png"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const seq = String(index + 1).padStart(2, "0");
  return `vastweargen-${prefix}-${date}-${time}-${seq}.${ext}`;
}

/**
 * 从 URL 推断文件扩展名
 */
function inferExt(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "jpg";
  if (lower.includes(".webp")) return "webp";
  if (lower.includes(".png")) return "png";
  return "png";
}

export async function downloadImage(url: string, filename: string) {
  try {
    const downloadUrl = url.startsWith("http")
      ? `/api/download-image?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
      : url;
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank");
  }
}

/**
 * 批量下载图片（逐个触发，避免浏览器拦截）
 */
export async function downloadImages(urls: string[], prefix: string) {
  for (let i = 0; i < urls.length; i++) {
    const ext = inferExt(urls[i]);
    const filename = generateDownloadFilename(prefix, i, ext);
    await downloadImage(urls[i], filename);
    if (i < urls.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export const ACCEPTED_IMAGE_TYPES = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

export const MAX_FILE_SIZE_MB = 15;
export const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
export const MAX_CLOTHING_FILES = 5;

export interface UploadResult {
  url: string;
  display_url: string;
  delete_url: string;
  width: number;
  height: number;
}

/**
 * 压缩图片（超过 maxSizeMB 时自动压缩）
 */
async function compressImage(file: File, maxSizeMB: number = MAX_FILE_SIZE_MB): Promise<File> {
  if (file.size <= maxSizeMB * 1024 * 1024) return file;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;

      // 按比例缩小（最大边 2048px）
      const maxDim = 2048;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      // 逐步降低质量直到小于限制
      let quality = 0.85;
      const tryCompress = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            if (blob.size > maxSizeMB * 1024 * 1024 && quality > 0.3) {
              quality -= 0.1;
              tryCompress();
            } else {
              resolve(new File([blob], file.name, { type: "image/jpeg" }));
            }
          },
          "image/jpeg",
          quality,
        );
      };
      tryCompress();
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Agent 专用图片压缩（更激进：最大 2MB，最大边 1600px）
 */
export async function compressImageForAgent(file: File): Promise<File> {
  const maxAgentSize = 2 * 1024 * 1024;
  if (file.size <= maxAgentSize) return file;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      const maxEdge = 1600;

      if (width > maxEdge || height > maxEdge) {
        const scale = maxEdge / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(new File([blob], file.name, { type: "image/jpeg" }));
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        0.82,
      );
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

/**
 * 上传图片到 imgbb（通过服务端 API 代理）
 */
export async function uploadImage(file: File): Promise<UploadResult> {
  const compressed = await compressImage(file, MAX_FILE_SIZE_MB);

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(compressed);
  });

  const res = await fetch("/api/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: base64,
      name: file.name.replace(/\.[^.]+$/, ""),
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `上传失败 (${res.status})`);
  }

  return res.json();
}
