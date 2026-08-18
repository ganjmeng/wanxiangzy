import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { decryptProviderSecret, encryptProviderSecret } from "@/lib/api/model-provider-secrets";
import { assertRemoteImageUrlAllowed } from "@/lib/api/remote-image-fetch";
import { getAdminClient } from "@/lib/supabase/admin";

const MIRROR_TABLE = "oss_mirror_transfers";
const DEFAULT_MIRROR_TTL_SECONDS = 30 * 60;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 12_000;
const DEFAULT_TRIGGER_TIMEOUT_MS = 45_000;
const DEFAULT_WAIT_TIMEOUT_MS = 4 * 60_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_RETRY_BASE_MS = 750;
const DEFAULT_NETWORK_CONCURRENCY = 16;
const MIRROR_LEASE_MS = 8 * 60_000;
const SOURCE_PROBE_BYTES = 64;

type AdminClient = ReturnType<typeof getAdminClient>;
type MirrorStatus = "pending" | "processing" | "completed" | "failed";

type MirrorTransferRow = {
  id: string;
  object_key: string;
  source_url_ciphertext: string | null;
  source_url_sha256: string | null;
  source_host: string;
  generation_ref: string;
  status: MirrorStatus;
  attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  next_attempt_at: string;
  expires_at: string;
  expected_content_length: number | string | null;
  expected_content_type: string | null;
  content_length: number | string | null;
  content_type: string | null;
  last_error: string | null;
};

type MirrorResult = {
  contentLength: number;
  contentType: SupportedImageType;
};

type SupportedImageType =
  | "image/avif"
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

type MirrorConfig = ReturnType<typeof getMirrorConfig>;

export class OssMirrorTransferError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "OssMirrorTransferError";
  }
}

export function isAliyunOssMirrorEnabled() {
  return (process.env.IMAGE_STORAGE_PROVIDER || "").trim().toLowerCase() === "aliyun-oss"
    && /^(1|true|yes)$/i.test((process.env.ALIYUN_OSS_MIRROR_ENABLED || "").trim());
}

/**
 * Persist a provider URL through OSS mirror back-to-origin. This call only
 * returns after OSS has stored and verified the complete object. EC2 reads at
 * most a 64-byte source probe and the one-byte OSS trigger response.
 */
export async function mirrorRemoteImageToAliyunOss(
  sourceUrl: string,
  generationRef: string,
  admin: AdminClient = getAdminClient(),
) {
  const config = getMirrorConfig();
  if (sourceUrl.length > 8_000) throw terminalError("OSS mirror source URL is too long");
  const normalizedGenerationRef = generationRef.trim().slice(0, 240);
  if (!normalizedGenerationRef) throw terminalError("OSS mirror generation reference is empty");

  const source = new URL(sourceUrl);
  const expected = await inspectRemoteImage(source, config);
  const id = randomUUID();
  const leaseToken = randomUUID();
  const now = Date.now();
  const expiresAtMs = now + config.ttlSeconds * 1000;
  const objectKey = buildMirrorObjectKey(
    config.mirrorPrefix,
    id,
    expiresAtMs,
    expected.contentType,
    config.signingSecret,
  );

  const row = await registerTransfer(admin, {
    id,
    objectKey,
    sourceUrl: source.toString(),
    sourceHost: source.hostname.toLowerCase(),
    generationRef: normalizedGenerationRef,
    expected,
    expiresAt: new Date(expiresAtMs).toISOString(),
    leaseToken,
  });

  const completed = await waitForTransferCompletion(admin, row, leaseToken, config);
  return buildObjectUrl(config.publicBaseUrl, completed.object_key);
}

/** Claim and process retryable rows. Safe to run in multiple worker processes. */
export async function processPendingOssMirrorTransfers(
  limit = 50,
  admin: AdminClient = getAdminClient(),
) {
  if (!isAliyunOssMirrorEnabled()) {
    return { claimed: 0, completed: 0, deferred: 0, failed: 0 };
  }

  const config = getMirrorConfig();
  const leaseToken = randomUUID();
  const { data, error } = await admin.rpc("claim_oss_mirror_transfers", {
    p_limit: clampInt(limit, 1, 100, 50),
    p_lease_token: leaseToken,
    p_lease_expires_at: new Date(Date.now() + MIRROR_LEASE_MS).toISOString(),
  });
  if (error) throw retryableError(`claim OSS mirror mappings failed: ${error.message}`);

  const rows = asRows(data);
  const outcomes = await Promise.all(rows.map(async (row) => {
    try {
      await processOwnedTransfer(admin, row, config);
      return "completed" as const;
    } catch (error) {
      const updated = await deferOwnedTransfer(admin, row, config, error);
      if (updated.status === "completed") return "completed" as const;
      return updated.status === "failed" ? "failed" as const : "deferred" as const;
    }
  }));

  return {
    claimed: rows.length,
    completed: outcomes.filter((value) => value === "completed").length,
    deferred: outcomes.filter((value) => value === "deferred").length,
    failed: outcomes.filter((value) => value === "failed").length,
  };
}

/** Fail expired source capabilities so signed provider URLs are erased. */
export async function expireOssMirrorTransfers(
  limit = 500,
  admin: AdminClient = getAdminClient(),
) {
  if (!isAliyunOssMirrorEnabled()) return 0;
  const { data, error } = await admin.rpc("expire_oss_mirror_transfers", {
    p_limit: clampInt(limit, 1, 1_000, 500),
  });
  if (error) throw retryableError(`expire OSS mirror mappings failed: ${error.message}`);
  return asRows(data).length;
}

/** Retain short operational history without deleting successfully stored OSS objects. */
export async function cleanupOssMirrorTransfers(
  admin: AdminClient = getAdminClient(),
) {
  if (!isAliyunOssMirrorEnabled()) return { metadataDeleted: 0, failedObjectsDeleted: 0 };
  const config = getMirrorConfig();
  const now = Date.now();
  const completedBefore = new Date(now - config.completedRetentionDays * 86_400_000).toISOString();
  const failedBefore = new Date(now - config.failedRetentionDays * 86_400_000).toISOString();

  // Failed object names were never published. Delete any possible partial OSS
  // object before deleting its control-plane record. Concurrent DELETEs are safe.
  const { data: failedRows, error: failedReadError } = await admin
    .from(MIRROR_TABLE)
    .select("id,object_key")
    .eq("status", "failed")
    .lt("updated_at", failedBefore)
    .limit(500);
  if (failedReadError) throw retryableError(`read failed OSS mirror cleanup rows failed: ${failedReadError.message}`);

  let failedObjectsDeleted = 0;
  await Promise.all((failedRows || []).map(async (row) => {
    const deleted = await deleteOssObject(config, String(row.object_key));
    if (!deleted) return;
    const { error } = await admin.from(MIRROR_TABLE).delete().eq("id", row.id).eq("status", "failed");
    if (!error) failedObjectsDeleted += 1;
  }));

  const { data, error } = await admin.rpc("cleanup_oss_mirror_transfers", {
    p_completed_before: completedBefore,
    // Failed rows are removed only after their unpublished object is deleted above.
    p_failed_before: "1970-01-01T00:00:00.000Z",
    p_limit: 1_000,
  });
  if (error) throw retryableError(`cleanup OSS mirror metadata failed: ${error.message}`);

  return { metadataDeleted: asRows(data).length, failedObjectsDeleted };
}

/**
 * Resolve a capability-signed object key for OSS Website back-to-origin.
 * No shared secret header is required, so no credential can be forwarded to
 * the upstream image provider by OSS.
 */
export async function resolveOssMirrorSource(
  objectKey: string,
  admin: AdminClient = getAdminClient(),
) {
  const config = getMirrorConfig();
  if (!verifyMirrorObjectKey(objectKey, config)) return null;

  const { data, error } = await admin
    .from(MIRROR_TABLE)
    .select(
      "object_key,source_url_ciphertext,source_url_sha256,source_host,status,expires_at,expected_content_length,expected_content_type",
    )
    .eq("object_key", objectKey)
    .in("status", ["pending", "processing"])
    .maybeSingle();
  if (error) throw retryableError(`resolve OSS mirror mapping failed: ${error.message}`);
  if (!data?.source_url_ciphertext || !data.source_url_sha256) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  const plaintext = decryptProviderSecret(String(data.source_url_ciphertext));
  if (!plaintext || sha256(plaintext) !== data.source_url_sha256) {
    throw terminalError("OSS mirror source capability could not be decrypted or authenticated");
  }

  const source = new URL(plaintext);
  if (source.hostname.toLowerCase() !== data.source_host) {
    throw terminalError("OSS mirror source host changed unexpectedly");
  }
  const inspected = await inspectRemoteImage(source, config);
  if (
    inspected.contentLength !== Number(data.expected_content_length)
    || inspected.contentType !== data.expected_content_type
  ) {
    throw terminalError("OSS mirror source changed after registration");
  }
  return source.toString();
}

/** Used by deployment health checks without exposing secrets or touching OSS. */
export function validateOssMirrorRuntimeConfig() {
  const config = getMirrorConfig();
  return {
    endpoint: config.endpoint,
    mirrorPrefix: config.mirrorPrefix,
    allowedHostCount: config.allowedHosts.length,
  };
}

async function registerTransfer(
  admin: AdminClient,
  input: {
    id: string;
    objectKey: string;
    sourceUrl: string;
    sourceHost: string;
    generationRef: string;
    expected: MirrorResult;
    expiresAt: string;
    leaseToken: string;
  },
) {
  const { data, error } = await admin.rpc("register_oss_mirror_transfer", {
    p_id: input.id,
    p_object_key: input.objectKey,
    p_source_url_ciphertext: encryptProviderSecret(input.sourceUrl),
    p_source_url_sha256: sha256(input.sourceUrl),
    p_source_host: input.sourceHost,
    p_generation_ref: input.generationRef,
    p_expected_content_length: input.expected.contentLength,
    p_expected_content_type: input.expected.contentType,
    p_expires_at: input.expiresAt,
    p_lease_token: input.leaseToken,
    p_lease_expires_at: new Date(Date.now() + MIRROR_LEASE_MS).toISOString(),
  });
  if (error) throw retryableError(`register OSS mirror mapping failed: ${error.message}`);
  const row = asRows(data)[0];
  if (!row) throw retryableError("register OSS mirror mapping returned no row");
  return row;
}

async function waitForTransferCompletion(
  admin: AdminClient,
  initialRow: MirrorTransferRow,
  initialLeaseToken: string,
  config: MirrorConfig,
) {
  const deadline = Date.now() + config.waitTimeoutMs;
  let row = initialRow;
  let leaseToken = initialLeaseToken;

  while (Date.now() < deadline) {
    if (row.status === "completed") return row;
    if (row.status === "failed") {
      throw terminalError(`OSS mirror transfer failed: ${row.last_error || "unknown failure"}`);
    }

    if (row.status === "processing" && row.lease_token === leaseToken) {
      try {
        row = await processOwnedTransfer(admin, row, config);
        continue;
      } catch (error) {
        row = await deferOwnedTransfer(admin, row, config, error);
        continue;
      }
    }

    const nextAttemptAt = new Date(row.next_attempt_at).getTime();
    const waitMs = Math.max(100, Math.min(2_000, nextAttemptAt - Date.now()));
    await delay(waitMs);
    leaseToken = randomUUID();
    const claimed = await claimSpecificTransfer(admin, row.id, leaseToken);
    row = claimed || await readTransfer(admin, row.id);
  }

  throw retryableError("OSS mirror transfer did not complete within the publish timeout");
}

async function claimSpecificTransfer(admin: AdminClient, id: string, leaseToken: string) {
  const { data, error } = await admin.rpc("claim_oss_mirror_transfer", {
    p_id: id,
    p_lease_token: leaseToken,
    p_lease_expires_at: new Date(Date.now() + MIRROR_LEASE_MS).toISOString(),
  });
  if (error) throw retryableError(`claim OSS mirror mapping failed: ${error.message}`);
  return asRows(data)[0] || null;
}

async function readTransfer(admin: AdminClient, id: string) {
  const { data, error } = await admin.from(MIRROR_TABLE).select("*").eq("id", id).maybeSingle();
  if (error) throw retryableError(`read OSS mirror mapping failed: ${error.message}`);
  if (!data) throw terminalError("OSS mirror mapping no longer exists");
  return data as MirrorTransferRow;
}

async function processOwnedTransfer(
  admin: AdminClient,
  row: MirrorTransferRow,
  config: MirrorConfig,
) {
  const mirrored = await triggerMirrorTransfer(row, config);
  const { data, error } = await admin.rpc("complete_oss_mirror_transfer", {
    p_id: row.id,
    p_lease_token: row.lease_token,
    p_content_length: mirrored.contentLength,
    p_content_type: mirrored.contentType,
  });
  if (error) throw retryableError(`complete OSS mirror mapping failed: ${error.message}`);
  const completed = asRows(data)[0];
  if (!completed) {
    const current = await readTransfer(admin, row.id);
    if (current.status === "completed") return current;
    throw retryableError("OSS mirror completion lease was lost");
  }
  return completed;
}

async function deferOwnedTransfer(
  admin: AdminClient,
  row: MirrorTransferRow,
  config: MirrorConfig,
  error: unknown,
) {
  const retryable = !(error instanceof OssMirrorTransferError) || error.retryable;
  const maxAttempts = retryable ? config.maxAttempts : Math.max(1, row.attempts);
  const retryDelayMs = Math.min(
    60_000,
    config.retryBaseMs * Math.pow(2, Math.max(0, row.attempts - 1)),
  );
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
  const { data, error: updateError } = await admin.rpc("defer_oss_mirror_transfer", {
    p_id: row.id,
    p_lease_token: row.lease_token,
    p_last_error: message,
    p_next_attempt_at: new Date(Date.now() + retryDelayMs).toISOString(),
    p_max_attempts: maxAttempts,
  });
  if (updateError) throw retryableError(`defer OSS mirror mapping failed: ${updateError.message}`);
  const updated = asRows(data)[0];
  if (updated) return updated;
  return readTransfer(admin, row.id);
}

async function triggerMirrorTransfer(row: MirrorTransferRow, config: MirrorConfig): Promise<MirrorResult> {
  if (!row.source_url_ciphertext || !row.source_url_sha256) {
    throw terminalError("OSS mirror mapping has no encrypted source URL");
  }
  if (!row.lease_token || new Date(row.expires_at).getTime() <= Date.now()) {
    throw terminalError("OSS mirror mapping is not actively leased");
  }

  const sourceUrl = decryptProviderSecret(row.source_url_ciphertext);
  if (!sourceUrl || sha256(sourceUrl) !== row.source_url_sha256) {
    throw terminalError("OSS mirror source capability could not be decrypted or authenticated");
  }
  const source = new URL(sourceUrl);
  if (source.hostname.toLowerCase() !== row.source_host) {
    throw terminalError("OSS mirror source host changed unexpectedly");
  }

  const expectedLength = Number(row.expected_content_length);
  const expectedType = normalizeSupportedImageType(row.expected_content_type);
  if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0 || !expectedType) {
    throw terminalError("OSS mirror mapping has invalid expected metadata");
  }

  const objectUrl = buildObjectUrl(`https://${config.endpoint}`, row.object_key);
  const response = await withNetworkPermit(config.networkConcurrency, () => fetch(objectUrl, {
    method: "GET",
    cache: "no-store",
    redirect: "manual",
    headers: signOssRequest(config, "GET", row.object_key, { Range: "bytes=0-0" }),
    signal: AbortSignal.timeout(config.triggerTimeoutMs),
  }));

  if (response.status !== 206) {
    const snippet = await readResponseSnippet(response, 2_048);
    throw httpError("OSS mirror Range trigger", response.status, snippet);
  }

  const match = /^bytes 0-0\/(\d+)$/.exec(response.headers.get("content-range") || "");
  if (!match) {
    await response.body?.cancel().catch(() => undefined);
    throw terminalError("OSS mirror did not honor the one-byte Range request");
  }

  const triggerBody = await readResponsePrefix(response, 2);
  if (triggerBody.byteLength !== 1) {
    await deleteOssObject(config, row.object_key);
    throw terminalError("OSS mirror trigger returned an invalid body length");
  }

  const contentLength = Number(match[1]);
  const contentType = normalizeSupportedImageType(response.headers.get("content-type"));
  if (contentLength !== expectedLength || contentType !== expectedType) {
    await deleteOssObject(config, row.object_key);
    throw terminalError("OSS mirror response metadata differs from the validated source");
  }

  const head = await withNetworkPermit(config.networkConcurrency, () => fetch(objectUrl, {
    method: "HEAD",
    cache: "no-store",
    redirect: "manual",
    headers: signOssRequest(config, "HEAD", row.object_key),
    signal: AbortSignal.timeout(config.triggerTimeoutMs),
  }));
  const storedLength = Number(head.headers.get("content-length") || 0);
  const storedType = normalizeSupportedImageType(head.headers.get("content-type"));
  if (!head.ok || storedLength !== expectedLength || storedType !== expectedType) {
    await deleteOssObject(config, row.object_key);
    throw retryableError(
      `OSS mirror verification failed: HEAD ${head.status}, size ${storedLength}/${expectedLength}`,
    );
  }

  return { contentLength: expectedLength, contentType: expectedType };
}

async function inspectRemoteImage(source: URL, config: MirrorConfig): Promise<MirrorResult> {
  if (source.username || source.password || source.hash || (source.port && source.port !== "443")) {
    throw terminalError("remote image URL credentials, fragments, and non-HTTPS ports are not allowed");
  }
  try {
    await assertRemoteImageUrlAllowed(source, { allowedHosts: config.allowedHosts });
  } catch (error) {
    throw terminalError(error instanceof Error ? error.message : "remote image URL is not allowed");
  }

  let response: Response;
  try {
    response = await withNetworkPermit(config.networkConcurrency, () => fetch(source, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: { Range: `bytes=0-${SOURCE_PROBE_BYTES - 1}` },
      signal: AbortSignal.timeout(config.preflightTimeoutMs),
    }));
  } catch (error) {
    throw retryableError(`remote image preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw terminalError("remote image redirects are not allowed for OSS mirror sources");
  }
  if (response.status !== 200 && response.status !== 206) {
    const snippet = await readResponseSnippet(response, 512);
    throw httpError("remote image preflight", response.status, snippet);
  }

  const contentType = normalizeSupportedImageType(response.headers.get("content-type"));
  if (!contentType) {
    await response.body?.cancel().catch(() => undefined);
    throw terminalError("remote image has a missing or unsupported content type");
  }

  const contentLength = getRemoteTotalLength(response);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    await response.body?.cancel().catch(() => undefined);
    throw terminalError("remote image size is missing or invalid");
  }
  if (contentLength > config.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw terminalError(`remote image exceeds ${config.maxBytes} bytes`);
  }

  const prefix = await readResponsePrefix(response, SOURCE_PROBE_BYTES);
  if (!matchesImageMagic(prefix, contentType)) {
    throw terminalError(`remote image bytes do not match ${contentType}`);
  }
  return { contentLength, contentType };
}

function getRemoteTotalLength(response: Response) {
  if (response.status === 206) {
    const match = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
    if (!match || Number(match[1]) >= SOURCE_PROBE_BYTES) return 0;
    return Number(match[2]);
  }
  return Number(response.headers.get("content-length") || 0);
}

async function deleteOssObject(config: MirrorConfig, objectKey: string) {
  try {
    const response = await withNetworkPermit(config.networkConcurrency, () => fetch(
      buildObjectUrl(`https://${config.endpoint}`, objectKey),
      {
        method: "DELETE",
        redirect: "manual",
        headers: signOssRequest(config, "DELETE", objectKey),
        signal: AbortSignal.timeout(config.triggerTimeoutMs),
      },
    ));
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

function signOssRequest(
  config: MirrorConfig,
  method: "DELETE" | "GET" | "HEAD",
  objectKey: string,
  extraHeaders: Record<string, string> = {},
) {
  const date = new Date().toUTCString();
  const canonicalizedOssHeaders = config.securityToken
    ? `x-oss-security-token:${config.securityToken}\n`
    : "";
  const canonicalizedResource = `/${config.bucket}/${objectKey}`;
  const signature = createHmac("sha1", config.accessKeySecret)
    .update([method, "", "", date, `${canonicalizedOssHeaders}${canonicalizedResource}`].join("\n"))
    .digest("base64");
  return {
    ...extraHeaders,
    Authorization: `OSS ${config.accessKeyId}:${signature}`,
    Date: date,
    ...(config.securityToken ? { "x-oss-security-token": config.securityToken } : {}),
  };
}

function getMirrorConfig() {
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET?.trim();
  const bucket = process.env.ALIYUN_OSS_BUCKET?.trim();
  const region = process.env.ALIYUN_OSS_REGION?.trim();
  const publicBaseUrl = validatePublicBaseUrl(process.env.ALIYUN_OSS_PUBLIC_BASE_URL);
  const endpoint = (process.env.ALIYUN_OSS_ENDPOINT?.trim() || (bucket && region
    ? `${bucket}.${region}.aliyuncs.com`
    : "")).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const signingSecret = process.env.ALIYUN_OSS_MIRROR_SIGNING_SECRET?.trim() || "";
  const allowedHosts = parseAllowedHosts(process.env.ALIYUN_OSS_MIRROR_ALLOWED_HOSTS);
  const generatedPrefix = normalizeObjectPrefix(
    process.env.ALIYUN_OSS_GENERATED_PREFIX || process.env.ALIYUN_OSS_PREFIX || "generated-results/original",
  );
  const mirrorPrefix = normalizeObjectPrefix(
    process.env.ALIYUN_OSS_MIRROR_PREFIX || `${generatedPrefix}/mirror`,
  );

  if (!accessKeyId || !accessKeySecret || !bucket || !region || !publicBaseUrl || !endpoint) {
    throw new Error("OSS mirror requires the standard ALIYUN_OSS_* storage configuration");
  }
  if (endpoint !== `${bucket}.${region}.aliyuncs.com`) {
    throw new Error("ALIYUN_OSS_ENDPOINT must be the bucket HTTPS endpoint for its configured region");
  }
  if (signingSecret.length < 32) {
    throw new Error("ALIYUN_OSS_MIRROR_SIGNING_SECRET must contain at least 32 characters");
  }
  if (!allowedHosts.length) {
    throw new Error("ALIYUN_OSS_MIRROR_ALLOWED_HOSTS must explicitly allow provider image hosts");
  }
  if (!/^(?:hex:)?[a-f0-9]{64}$/i.test(process.env.ADMIN_SECRETS_ENCRYPTION_KEY?.trim() || "")) {
    throw new Error("ADMIN_SECRETS_ENCRYPTION_KEY must be a 32-byte hex key for encrypted mirror sources");
  }

  return {
    accessKeyId,
    accessKeySecret,
    bucket,
    publicBaseUrl,
    endpoint,
    signingSecret,
    allowedHosts,
    mirrorPrefix,
    securityToken: process.env.ALIYUN_OSS_SECURITY_TOKEN?.trim(),
    ttlSeconds: clampInt(
      process.env.ALIYUN_OSS_MIRROR_TTL_SECONDS,
      5 * 60,
      24 * 60 * 60,
      DEFAULT_MIRROR_TTL_SECONDS,
    ),
    preflightTimeoutMs: clampInt(
      process.env.ALIYUN_OSS_MIRROR_PREFLIGHT_TIMEOUT_MS,
      1_000,
      30_000,
      DEFAULT_PREFLIGHT_TIMEOUT_MS,
    ),
    triggerTimeoutMs: clampInt(
      process.env.ALIYUN_OSS_MIRROR_TRIGGER_TIMEOUT_MS,
      1_000,
      60_000,
      DEFAULT_TRIGGER_TIMEOUT_MS,
    ),
    waitTimeoutMs: clampInt(
      process.env.ALIYUN_OSS_MIRROR_WAIT_TIMEOUT_MS,
      10_000,
      15 * 60_000,
      DEFAULT_WAIT_TIMEOUT_MS,
    ),
    maxBytes: clampInt(
      process.env.ALIYUN_OSS_MIRROR_MAX_BYTES,
      1 * 1024 * 1024,
      512 * 1024 * 1024,
      DEFAULT_MAX_BYTES,
    ),
    maxAttempts: clampInt(
      process.env.ALIYUN_OSS_MIRROR_MAX_ATTEMPTS,
      1,
      16,
      DEFAULT_MAX_ATTEMPTS,
    ),
    retryBaseMs: clampInt(
      process.env.ALIYUN_OSS_MIRROR_RETRY_BASE_MS,
      100,
      10_000,
      DEFAULT_RETRY_BASE_MS,
    ),
    networkConcurrency: clampInt(
      process.env.ALIYUN_OSS_MIRROR_CONCURRENCY,
      1,
      64,
      DEFAULT_NETWORK_CONCURRENCY,
    ),
    completedRetentionDays: clampInt(
      process.env.ALIYUN_OSS_MIRROR_COMPLETED_RETENTION_DAYS,
      1,
      90,
      7,
    ),
    failedRetentionDays: clampInt(
      process.env.ALIYUN_OSS_MIRROR_FAILED_RETENTION_DAYS,
      1,
      30,
      3,
    ),
  };
}

function buildMirrorObjectKey(
  prefix: string,
  id: string,
  expiresAtMs: number,
  contentType: SupportedImageType,
  signingSecret: string,
) {
  const date = new Date();
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const expiry = Math.floor(expiresAtMs / 1_000).toString(36);
  const extension = extensionForType(contentType);
  const unsigned = `${prefix}/${yyyy}/${mm}/${dd}/${id}.${expiry}.${extension}`;
  const signature = createHmac("sha256", signingSecret).update(unsigned).digest("base64url");
  return `${prefix}/${yyyy}/${mm}/${dd}/${id}.${expiry}.${signature}.${extension}`;
}

function verifyMirrorObjectKey(objectKey: string, config: MirrorConfig) {
  if (objectKey.length > 1_023 || !objectKey.startsWith(`${config.mirrorPrefix}/`)) return false;
  const match = /^(.*\/([0-9a-f-]{36})\.([0-9a-z]+))\.([A-Za-z0-9_-]{43})\.(avif|gif|jpg|png|webp)$/.exec(objectKey);
  if (!match) return false;
  const expirySeconds = Number.parseInt(match[3], 36);
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds * 1_000 <= Date.now()) return false;
  if (expirySeconds * 1_000 > Date.now() + 24 * 60 * 60_000 + 60_000) return false;
  const unsigned = `${match[1]}.${match[5]}`;
  const expected = createHmac("sha256", config.signingSecret).update(unsigned).digest("base64url");
  return safeEqual(match[4], expected);
}

function matchesImageMagic(bytes: Uint8Array, contentType: SupportedImageType) {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  if (contentType === "image/gif") {
    const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (contentType === "image/webp") {
    return Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
      && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP";
  }
  if (contentType === "image/avif") {
    const box = Buffer.from(bytes.subarray(4, 32)).toString("ascii");
    return box.startsWith("ftyp") && (box.includes("avif") || box.includes("avis"));
  }
  return false;
}

function normalizeSupportedImageType(value: unknown): SupportedImageType | null {
  const normalized = String(value || "").split(";")[0].trim().toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  if (
    normalized === "image/avif"
    || normalized === "image/gif"
    || normalized === "image/jpeg"
    || normalized === "image/png"
    || normalized === "image/webp"
  ) return normalized;
  return null;
}

function extensionForType(contentType: SupportedImageType) {
  if (contentType === "image/jpeg") return "jpg";
  return contentType.slice("image/".length);
}

function parseAllowedHosts(value?: string) {
  const hosts = (value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const host of hosts) {
    if (
      host === "*"
      || host.includes(":")
      || host.includes("/")
      || host.includes("?")
      || host.includes("#")
      || !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)
    ) throw new Error(`invalid OSS mirror allowed host: ${host}`);
  }
  return [...new Set(hosts)];
}

function validatePublicBaseUrl(value?: string) {
  const normalized = (value || "").trim().replace(/\/+$/, "");
  if (!normalized) return "";
  const url = new URL(normalized);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
  ) throw new Error("ALIYUN_OSS_PUBLIC_BASE_URL must be an HTTPS origin without a path");
  return normalized;
}

function buildObjectUrl(baseUrl: string, objectKey: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeObjectPrefix(value: string) {
  const prefix = value.trim().replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.includes("..") || /[\\?#]/.test(prefix)) {
    throw new Error("ALIYUN_OSS_MIRROR_PREFIX is invalid");
  }
  return prefix;
}

async function readResponsePrefix(response: Response, maxBytes: number) {
  if (!response.body) throw terminalError("remote response body is empty");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const kept = value.subarray(0, Math.min(value.byteLength, maxBytes - total));
    chunks.push(Buffer.from(kept));
    total += kept.byteLength;
    if (kept.byteLength < value.byteLength || total >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return Buffer.concat(chunks, total);
}

async function readResponseSnippet(response: Response, maxBytes: number) {
  try {
    return (await readResponsePrefix(response, maxBytes)).toString("utf8").trim();
  } catch {
    return "";
  }
}

function asRows(value: unknown) {
  return (Array.isArray(value) ? value : []) as MirrorTransferRow[];
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function httpError(context: string, status: number, snippet = "") {
  const retryable = status === 408 || status === 429 || status >= 500;
  return new OssMirrorTransferError(
    `${context} HTTP ${status}${snippet ? `: ${snippet}` : ""}`,
    retryable,
  );
}

function terminalError(message: string) {
  return new OssMirrorTransferError(message, false);
}

function retryableError(message: string) {
  return new OssMirrorTransferError(message, true);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let activeNetworkRequests = 0;
const networkWaiters: Array<() => void> = [];

async function withNetworkPermit<T>(limit: number, work: () => Promise<T>) {
  if (activeNetworkRequests >= limit) {
    await new Promise<void>((resolve) => networkWaiters.push(resolve));
  }
  activeNetworkRequests += 1;
  try {
    return await work();
  } finally {
    activeNetworkRequests -= 1;
    networkWaiters.shift()?.();
  }
}

function clampInt(
  value: string | number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}
