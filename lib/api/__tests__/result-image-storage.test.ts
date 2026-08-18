import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { storeImage } from "../image-storage";
import { persistGeneratedImageUrls } from "../result-image-storage";

describe("result image storage", () => {
  const originalKey = process.env.IMGBB_API_KEY;
  const originalStorageProvider = process.env.IMAGE_STORAGE_PROVIDER;
  const originalOssAccessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID;
  const originalOssAccessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
  const originalOssBucket = process.env.ALIYUN_OSS_BUCKET;
  const originalOssRegion = process.env.ALIYUN_OSS_REGION;
  const originalOssPublicBaseUrl = process.env.ALIYUN_OSS_PUBLIC_BASE_URL;
  const originalOssPrefix = process.env.ALIYUN_OSS_PREFIX;
  const originalOssUploadPrefix = process.env.ALIYUN_OSS_UPLOAD_PREFIX;
  const originalOssGeneratedPrefix = process.env.ALIYUN_OSS_GENERATED_PREFIX;
  const originalOssFavoritePrefix = process.env.ALIYUN_OSS_FAVORITE_PREFIX;
  const originalOssSiteAssetPrefix = process.env.ALIYUN_OSS_SITE_ASSET_PREFIX;
  const originalOssTempPrefix = process.env.ALIYUN_OSS_TEMP_PREFIX;
  const originalOssMirrorEnabled = process.env.ALIYUN_OSS_MIRROR_ENABLED;
  const tinyAvifBase64 = "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAAHgAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAmbWRhdBIACgc4ADYQENBpMhEWQAYYYYQAAHlM2KcgXkzU8A==";

  beforeEach(() => {
    delete process.env.IMAGE_STORAGE_PROVIDER;
    delete process.env.ALIYUN_OSS_MIRROR_ENABLED;
    process.env.IMGBB_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) {
      delete process.env.IMGBB_API_KEY;
    } else {
      process.env.IMGBB_API_KEY = originalKey;
    }
    restoreEnv("IMAGE_STORAGE_PROVIDER", originalStorageProvider);
    restoreEnv("ALIYUN_OSS_ACCESS_KEY_ID", originalOssAccessKeyId);
    restoreEnv("ALIYUN_OSS_ACCESS_KEY_SECRET", originalOssAccessKeySecret);
    restoreEnv("ALIYUN_OSS_BUCKET", originalOssBucket);
    restoreEnv("ALIYUN_OSS_REGION", originalOssRegion);
    restoreEnv("ALIYUN_OSS_PUBLIC_BASE_URL", originalOssPublicBaseUrl);
    restoreEnv("ALIYUN_OSS_PREFIX", originalOssPrefix);
    restoreEnv("ALIYUN_OSS_UPLOAD_PREFIX", originalOssUploadPrefix);
    restoreEnv("ALIYUN_OSS_GENERATED_PREFIX", originalOssGeneratedPrefix);
    restoreEnv("ALIYUN_OSS_FAVORITE_PREFIX", originalOssFavoritePrefix);
    restoreEnv("ALIYUN_OSS_SITE_ASSET_PREFIX", originalOssSiteAssetPrefix);
    restoreEnv("ALIYUN_OSS_TEMP_PREFIX", originalOssTempPrefix);
    restoreEnv("ALIYUN_OSS_MIRROR_ENABLED", originalOssMirrorEnabled);
  });

  it("returns already-persisted ImgBB URLs without reuploading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const url = "https://i.ibb.co/example/result.png";

    await expect(persistGeneratedImageUrls([url], "gen-1")).resolves.toEqual([url]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads remote result URLs directly instead of converting to base64", async () => {
    const uploadedImages: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.imgbb.com/1/upload");
      const body = init?.body as FormData;
      uploadedImages.push(body.get("image"));

      return Response.json({
        success: true,
        data: { url: "https://i.ibb.co/persisted/result.png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistGeneratedImageUrls(["https://provider.example/result.png"], "gen-2")).resolves.toEqual([
      "https://i.ibb.co/persisted/result.png",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadedImages).toEqual(["https://provider.example/result.png"]);
  });

  it("falls back to the provider URL when ImgBB upload fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const providerUrl = "https://provider.example/result.png";

    await expect(persistGeneratedImageUrls([providerUrl], "gen-3")).resolves.toEqual([providerUrl]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[result-image-storage] generated image storage failed; falling back to provider URL:",
      "图片上传失败: ImgBB HTTP 400"
    );
  });

  it("never persists a temporary provider URL when strict OSS mirror mode fails", async () => {
    process.env.IMAGE_STORAGE_PROVIDER = "aliyun-oss";
    process.env.ALIYUN_OSS_MIRROR_ENABLED = "true";
    delete process.env.ALIYUN_OSS_ACCESS_KEY_ID;
    delete process.env.ALIYUN_OSS_ACCESS_KEY_SECRET;
    delete process.env.ALIYUN_OSS_BUCKET;
    delete process.env.ALIYUN_OSS_REGION;
    delete process.env.ALIYUN_OSS_PUBLIC_BASE_URL;

    await expect(persistGeneratedImageUrls(
      ["https://provider.example/result.png"],
      "gen-strict-mirror",
    )).rejects.toThrow();
  });

  it("preserves generated result naming with start indexes", async () => {
    const uploadedNames: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body as FormData;
      uploadedNames.push(body.get("name"));

      return Response.json({
        success: true,
        data: { url: `https://i.ibb.co/persisted/${uploadedNames.length}.png` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      persistGeneratedImageUrls(["data:image/png;base64,aaa", "data:image/png;base64,bbb"], "gen-4", {
        startIndex: 2,
      })
    ).resolves.toEqual(["https://i.ibb.co/persisted/1.png", "https://i.ibb.co/persisted/2.png"]);

    expect(uploadedNames).toEqual(["generated-gen-4-3", "generated-gen-4-4"]);
  });

  it("uploads generated data URLs to Aliyun OSS when configured", async () => {
    process.env.IMAGE_STORAGE_PROVIDER = "aliyun-oss";
    process.env.ALIYUN_OSS_ACCESS_KEY_ID = "test-access-key-id";
    process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = "test-access-key-secret";
    process.env.ALIYUN_OSS_BUCKET = "vasthk";
    process.env.ALIYUN_OSS_REGION = "oss-cn-hongkong";
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://vasthk.oss-cn-hongkong.aliyuncs.com";
    process.env.ALIYUN_OSS_PREFIX = "ai-tryon";
    process.env.ALIYUN_OSS_GENERATED_PREFIX = "generated-results/original";

    const pngBase64 = (await sharp({
      create: { width: 3, height: 2, channels: 4, background: "white" },
    }).png().toBuffer()).toString("base64");
    const putCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      putCalls.push({ url, init });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [url] = await persistGeneratedImageUrls([`data:image/png;base64,${pngBase64}`], "gen-oss");

    expect(url).toMatch(/^https:\/\/vasthk\.oss-cn-hongkong\.aliyuncs\.com\/generated-results\/original\/\d{4}\/\d{2}\/\d{2}\//);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].url).toContain("https://vasthk.oss-cn-hongkong.aliyuncs.com/generated-results/original/");
    expect((putCalls[0].init?.headers as Record<string, string>).Authorization).toMatch(/^OSS test-access-key-id:/);
    expect((putCalls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
  });

  it("normalizes AVIF uploads to JPEG before storing in Aliyun OSS", async () => {
    process.env.IMAGE_STORAGE_PROVIDER = "aliyun-oss";
    process.env.ALIYUN_OSS_ACCESS_KEY_ID = "test-access-key-id";
    process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = "test-access-key-secret";
    process.env.ALIYUN_OSS_BUCKET = "vasthk";
    process.env.ALIYUN_OSS_REGION = "oss-cn-hongkong";
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://vasthk.oss-cn-hongkong.aliyuncs.com";
    process.env.ALIYUN_OSS_PREFIX = "ai-tryon";

    const putCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      putCalls.push({ url, init });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stored = await storeImage({
      image: `data:image/avif;base64,${tinyAvifBase64}`,
      name: "source-avif",
      storageClass: "upload",
    });

    expect(stored.url).toMatch(/source-avif\.jpg$/);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].url).toMatch(/source-avif\.jpg$/);
    expect((putCalls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect(Buffer.from(putCalls[0].init?.body as ArrayBuffer).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  }, 15_000);

  it("uploads multipart-style JPEG bytes to Aliyun OSS without base64 wrapping", async () => {
    process.env.IMAGE_STORAGE_PROVIDER = "aliyun-oss";
    process.env.ALIYUN_OSS_ACCESS_KEY_ID = "test-access-key-id";
    process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = "test-access-key-secret";
    process.env.ALIYUN_OSS_BUCKET = "vasthk";
    process.env.ALIYUN_OSS_REGION = "oss-cn-hongkong";
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://vasthk.oss-cn-hongkong.aliyuncs.com";
    process.env.ALIYUN_OSS_PREFIX = "ai-tryon";

    const jpegBytes = await sharp({
      create: { width: 7, height: 5, channels: 3, background: "white" },
    }).jpeg().toBuffer();
    const putCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      putCalls.push({ url, init });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stored = await storeImage({
      bytes: jpegBytes,
      contentType: "",
      name: "reference-photo.jpg",
      storageClass: "upload",
    });

    expect(stored.url).toMatch(/reference-photo\.jpg$/);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].url).toMatch(/reference-photo\.jpg$/);
    expect((putCalls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect(Buffer.from(putCalls[0].init?.body as ArrayBuffer)).toEqual(jpegBytes);
    expect(stored).toMatchObject({
      width: 7,
      height: 5,
      content_type: "image/jpeg",
      byte_size: jpegBytes.length,
    });
  });

  it("returns decoded metadata for a small PNG without rewriting its bytes", async () => {
    configureAliyunOss();
    const pngBytes = await sharp({
      create: { width: 13, height: 9, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
    }).png().toBuffer();
    const puts: Array<{ init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      puts.push({ init });
      return new Response("", { status: 200 });
    }));

    const stored = await storeImage({
      bytes: pngBytes,
      contentType: "image/png",
      name: "small-mask.png",
      storageClass: "upload",
    });

    expect(stored).toMatchObject({
      width: 13,
      height: 9,
      content_type: "image/png",
      byte_size: pngBytes.length,
    });
    expect(Buffer.from(puts[0].init?.body as ArrayBuffer)).toEqual(pngBytes);
  });

  it("autorotates EXIF-oriented JPEGs and returns normalized dimensions", async () => {
    configureAliyunOss();
    const orientedJpeg = await sharp({
      create: { width: 8, height: 5, channels: 3, background: "white" },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const puts: Array<{ init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      puts.push({ init });
      return new Response("", { status: 200 });
    }));

    const stored = await storeImage({
      bytes: orientedJpeg,
      contentType: "image/jpeg",
      name: "phone-photo.jpg",
      storageClass: "upload",
    });

    expect(stored).toMatchObject({ width: 5, height: 8, content_type: "image/jpeg" });
    const uploaded = Buffer.from(puts[0].init?.body as ArrayBuffer);
    const metadata = await sharp(uploaded).metadata();
    expect(metadata).toMatchObject({ width: 5, height: 8 });
    expect(metadata.orientation).toBeUndefined();
  });

  it("rejects animated PNG and decoded images above the pixel limit", async () => {
    configureAliyunOss();
    vi.stubGlobal("fetch", vi.fn());

    await expect(storeImage({
      bytes: createTwoFrameApng(),
      contentType: "image/png",
      name: "animated.png",
      storageClass: "upload",
    })).rejects.toThrow("仅支持单帧图片");

    const tinyPng = await sharp({
      create: { width: 1, height: 1, channels: 4, background: "black" },
    }).png().toBuffer();
    const pixelBombHeader = rewritePngDimensions(tinyPng, 6000, 6000);
    await expect(storeImage({
      bytes: pixelBombHeader,
      contentType: "image/png",
      name: "pixel-bomb.png",
      storageClass: "upload",
    })).rejects.toThrow("图片像素不能超过 3200 万");
  });

  it("uses image magic bytes over incorrect declared content types", async () => {
    process.env.IMAGE_STORAGE_PROVIDER = "aliyun-oss";
    process.env.ALIYUN_OSS_ACCESS_KEY_ID = "test-access-key-id";
    process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = "test-access-key-secret";
    process.env.ALIYUN_OSS_BUCKET = "vasthk";
    process.env.ALIYUN_OSS_REGION = "oss-cn-hongkong";
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://vasthk.oss-cn-hongkong.aliyuncs.com";
    process.env.ALIYUN_OSS_PREFIX = "ai-tryon";

    const putCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      putCalls.push({ url, init });
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const stored = await storeImage({
      bytes: Buffer.from(tinyAvifBase64, "base64"),
      contentType: "image/jpeg",
      name: "mislabeled-reference.jpg",
      storageClass: "upload",
    });

    expect(stored.url).toMatch(/mislabeled-reference\.jpg$/);
    expect(putCalls).toHaveLength(1);
    expect((putCalls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect(Buffer.from(putCalls[0].init?.body as ArrayBuffer).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  }, 15_000);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function configureAliyunOss() {
  process.env.IMAGE_STORAGE_PROVIDER = "aliyun-oss";
  process.env.ALIYUN_OSS_ACCESS_KEY_ID = "test-access-key-id";
  process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = "test-access-key-secret";
  process.env.ALIYUN_OSS_BUCKET = "vasthk";
  process.env.ALIYUN_OSS_REGION = "oss-cn-hongkong";
  process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://vasthk.oss-cn-hongkong.aliyuncs.com";
  process.env.ALIYUN_OSS_PREFIX = "ai-tryon";
}

function rewritePngDimensions(source: Buffer, width: number, height: number) {
  const result = Buffer.from(source);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  result.writeUInt32BE(crc32(result.subarray(12, 29)) >>> 0, 29);
  return result;
}

function createTwoFrameApng() {
  const source = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAACAAAAAP/7/7sAAAAaZmNUTAAAAAAAAAABAAAAAQAAAAAAAAAAAQAKAAAAP5RmFQAAAA1JREFUeJz7////fwAJ+wP9KobjigAAABpmY1RMAAAAAQAAAAEAAAABAAAAAAAAAAABAAoAAAC1w2TAAAAAEGZkQVQAAAACeJxjYGBg+M8AAAaJAYhUCgkrAAAAAElFTkSuQmCC",
    "base64",
  );
  return source;
}

function crc32(input: Buffer) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
