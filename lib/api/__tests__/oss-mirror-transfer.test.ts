import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remoteChecks = vi.hoisted(() => ({
  assertRemoteImageUrlAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/remote-image-fetch", () => remoteChecks);

import {
  mirrorRemoteImageToAliyunOss,
  resolveOssMirrorSource,
} from "../oss-mirror-transfer";

describe("OSS mirror transfers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.IMAGE_STORAGE_PROVIDER = "aliyun-oss";
    process.env.ALIYUN_OSS_MIRROR_ENABLED = "true";
    process.env.ALIYUN_OSS_ACCESS_KEY_ID = "test-access-key";
    process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = "test-access-secret";
    process.env.ALIYUN_OSS_BUCKET = "vasthk";
    process.env.ALIYUN_OSS_REGION = "oss-cn-hongkong";
    process.env.ALIYUN_OSS_PUBLIC_BASE_URL = "https://images.example.com";
    process.env.ALIYUN_OSS_GENERATED_PREFIX = "generated-results/original";
    process.env.ALIYUN_OSS_MIRROR_SIGNING_SECRET = "s".repeat(40);
    process.env.ALIYUN_OSS_MIRROR_ALLOWED_HOSTS = "provider.example.com";
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = "a".repeat(64);
    process.env.ALIYUN_OSS_MIRROR_RETRY_BASE_MS = "100";
    remoteChecks.assertRemoteImageUrlAllowed.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it("publishes only after a bounded source probe, one-byte trigger, and verified HEAD", async () => {
    const database = createRpcAdmin();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://provider.example.com/")) return jpegProbeResponse(57_555);
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-length": "57555", "content-type": "image/jpeg" },
        });
      }
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).Range).toBe("bytes=0-0");
      return new Response(new Uint8Array([0xff]), {
        status: 206,
        headers: { "content-range": "bytes 0-0/57555", "content-type": "image/jpeg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await mirrorRemoteImageToAliyunOss(
      "https://provider.example.com/output/photo.jpg?signature=private",
      "generation-1",
      database.admin,
    );

    expect(result).toMatch(
      /^https:\/\/images\.example\.com\/generated-results\/original\/mirror\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.[0-9a-z]+\.[A-Za-z0-9_-]{43}\.jpg$/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: { Range: "bytes=0-63" },
    });
    expect(database.registerParams.p_source_url_ciphertext).toMatch(/^enc:v1:/);
    expect(database.registerParams.p_source_url_ciphertext).not.toContain("provider.example.com");
    expect(database.registerParams.p_source_url_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(database.calls.map((call) => call.name)).toEqual([
      "register_oss_mirror_transfer",
      "complete_oss_mirror_transfer",
    ]);
  });

  it("does not return a dead OSS URL or provider fallback when transfer fails", async () => {
    process.env.ALIYUN_OSS_MIRROR_MAX_ATTEMPTS = "1";
    const database = createRpcAdmin();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("https://provider.example.com/")) return jpegProbeResponse(57_555);
      return new Response("mirror failed", { status: 424 });
    }));

    await expect(mirrorRemoteImageToAliyunOss(
      "https://provider.example.com/output/photo.jpg",
      "generation-2",
      database.admin,
    )).rejects.toThrow("OSS mirror transfer failed");

    expect(database.calls.map((call) => call.name)).toEqual([
      "register_oss_mirror_transfer",
      "defer_oss_mirror_transfer",
    ]);
    expect(database.row.status).toBe("failed");
    expect(database.row.source_url_ciphertext).toBeNull();
  });

  it("rejects redirects and non-image payloads before creating a mapping", async () => {
    const redirectDatabase = createRpcAdmin();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://provider.example.com/other.jpg" },
    })));
    await expect(mirrorRemoteImageToAliyunOss(
      "https://provider.example.com/output/photo.jpg",
      "generation-redirect",
      redirectDatabase.admin,
    )).rejects.toThrow("redirects are not allowed");
    expect(redirectDatabase.calls).toHaveLength(0);

    const badMagicDatabase = createRpcAdmin();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(64), {
      status: 206,
      headers: {
        "content-range": "bytes 0-63/1000",
        "content-type": "image/jpeg",
      },
    })));
    await expect(mirrorRemoteImageToAliyunOss(
      "https://provider.example.com/output/not-really-an-image.jpg",
      "generation-bad-magic",
      badMagicDatabase.admin,
    )).rejects.toThrow("bytes do not match image/jpeg");
    expect(badMagicDatabase.calls).toHaveLength(0);
  });

  it("verifies the signed object capability before reading the database", async () => {
    const from = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveOssMirrorSource(
      "generated-results/original/mirror/2026/08/18/not-signed.jpg",
      { from } as never,
    )).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a valid capability only while source bytes and metadata are unchanged", async () => {
    const database = createRpcAdmin();
    const sourceUrl = "https://provider.example.com/output/photo.jpg?signature=private";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://provider.example.com/")) return jpegProbeResponse(57_555);
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-length": "57555", "content-type": "image/jpeg" },
        });
      }
      return new Response(new Uint8Array([0xff]), {
        status: 206,
        headers: { "content-range": "bytes 0-0/57555", "content-type": "image/jpeg" },
      });
    }));
    const publicUrl = await mirrorRemoteImageToAliyunOss(sourceUrl, "generation-resolve", database.admin);
    const objectKey = new URL(publicUrl).pathname.slice(1);
    const pendingRow = {
      ...database.registeredRow,
      status: "processing",
      source_url_ciphertext: database.registerParams.p_source_url_ciphertext,
      source_url_sha256: database.registerParams.p_source_url_sha256,
    };
    const resolverAdmin = createResolverAdmin(pendingRow);
    const resolverFetch = vi.fn(async () => jpegProbeResponse(57_555));
    vi.stubGlobal("fetch", resolverFetch);

    await expect(resolveOssMirrorSource(objectKey, resolverAdmin)).resolves.toBe(sourceUrl);
    expect(resolverFetch).toHaveBeenCalledTimes(1);
    expect(remoteChecks.assertRemoteImageUrlAllowed).toHaveBeenLastCalledWith(
      new URL(sourceUrl),
      { allowedHosts: ["provider.example.com"] },
    );
  });
});

function jpegProbeResponse(totalLength: number) {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff], 0);
  return new Response(bytes, {
    status: 206,
    headers: {
      "content-range": `bytes 0-63/${totalLength}`,
      "content-type": "image/jpeg",
    },
  });
}

function createRpcAdmin() {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  let registeredRow: Record<string, unknown> = {};
  const state = { row: {} as Record<string, unknown>, registerParams: {} as Record<string, unknown> };
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params });
    if (name === "register_oss_mirror_transfer") {
      state.registerParams = params;
      registeredRow = {
        id: params.p_id,
        object_key: params.p_object_key,
        source_url_ciphertext: params.p_source_url_ciphertext,
        source_url_sha256: params.p_source_url_sha256,
        source_host: params.p_source_host,
        generation_ref: params.p_generation_ref,
        status: "processing",
        attempts: 1,
        lease_token: params.p_lease_token,
        lease_expires_at: params.p_lease_expires_at,
        next_attempt_at: new Date().toISOString(),
        expires_at: params.p_expires_at,
        expected_content_length: params.p_expected_content_length,
        expected_content_type: params.p_expected_content_type,
        content_length: null,
        content_type: null,
        last_error: null,
      };
      state.row = { ...registeredRow };
      return { data: [{ ...state.row }], error: null };
    }
    if (name === "complete_oss_mirror_transfer") {
      state.row = {
        ...state.row,
        status: "completed",
        source_url_ciphertext: null,
        source_url_sha256: null,
        lease_token: null,
        lease_expires_at: null,
        content_length: params.p_content_length,
        content_type: params.p_content_type,
      };
      return { data: [{ ...state.row }], error: null };
    }
    if (name === "defer_oss_mirror_transfer") {
      const terminal = Number(params.p_max_attempts) <= Number(state.row.attempts);
      state.row = {
        ...state.row,
        status: terminal ? "failed" : "pending",
        source_url_ciphertext: terminal ? null : state.row.source_url_ciphertext,
        source_url_sha256: terminal ? null : state.row.source_url_sha256,
        lease_token: null,
        lease_expires_at: null,
        next_attempt_at: params.p_next_attempt_at,
        last_error: params.p_last_error,
      };
      return { data: [{ ...state.row }], error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  });
  return {
    admin: { rpc } as never,
    calls,
    get row() { return state.row; },
    get registerParams() { return state.registerParams; },
    get registeredRow() { return registeredRow; },
  };
}

function createResolverAdmin(row: Record<string, unknown>) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  return { from: vi.fn(() => chain) } as never;
}
