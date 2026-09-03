import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

const DEFAULT_REMOTE_IMAGE_TIMEOUT_MS = 45_000;
const DEFAULT_REMOTE_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_REMOTE_IMAGE_MAX_REDIRECTS = 3;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type LookupHost = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
type ResolvedAddress = { address: string; family: number };
type RemoteAssetContentKind = "audio" | "image" | "video";

export type RemoteImageFetchErrorCode =
  | "bad-status"
  | "blocked-address"
  | "blocked-host"
  | "empty-body"
  | "invalid-url"
  | "non-image"
  | "redirect-limit"
  | "too-large"
  | "timeout"
  | "unsupported-protocol";

export class RemoteImageFetchError extends Error {
  constructor(
    message: string,
    public readonly code: RemoteImageFetchErrorCode,
    public readonly status?: number
  ) {
    super(message);
    this.name = "RemoteImageFetchError";
  }
}

export interface RemoteImageFetchOptions {
  allowHttp?: boolean;
  allowedContentTypes?: RemoteAssetContentKind[];
  allowedHosts?: string[];
  contentTypeFallback?: string;
  fetchImpl?: FetchLike;
  lookupHost?: LookupHost;
  maxBytes?: number;
  maxRedirects?: number;
  requestHeaders?: HeadersInit;
  timeoutMs?: number;
}

export interface RemoteImageResponse {
  response: Response;
  url: string;
  contentType: string;
  contentLength: number;
}

export interface RemoteImageBuffer {
  bytes: Buffer;
  url: string;
  contentType: string;
}

export async function fetchRemoteMediaBuffer(
  mediaUrl: string,
  options: RemoteImageFetchOptions = {}
) {
  return fetchRemoteImageBuffer(mediaUrl, {
    ...options,
    allowedContentTypes: options.allowedContentTypes || ["audio", "image", "video"],
    contentTypeFallback: options.contentTypeFallback || "application/octet-stream",
  });
}

export async function fetchRemoteImageBuffer(
  imageUrl: string,
  options: RemoteImageFetchOptions = {}
): Promise<RemoteImageBuffer> {
  const remote = await fetchRemoteImageResponse(imageUrl, options);
  const bytes = await readRemoteImageResponseBody(
    remote.response,
    options.maxBytes || DEFAULT_REMOTE_IMAGE_MAX_BYTES
  );

  return {
    bytes,
    url: remote.url,
    contentType: remote.contentType,
  };
}

export async function fetchRemoteImageResponse(
  imageUrl: string,
  options: RemoteImageFetchOptions = {}
): Promise<RemoteImageResponse> {
  const fetchImpl = options.fetchImpl || fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_REMOTE_IMAGE_MAX_REDIRECTS;
  const maxBytes = options.maxBytes || DEFAULT_REMOTE_IMAGE_MAX_BYTES;
  let currentUrl = parseRemoteUrl(imageUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const addresses = await resolveAllowedRemoteAddresses(currentUrl, options);

    let response: Response;
    try {
      const init: RequestInit = {
        cache: "no-store",
        redirect: "manual",
        headers: options.requestHeaders,
        signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_REMOTE_IMAGE_TIMEOUT_MS),
      };
      const useTestTransport = process.env.NODE_ENV !== "production" && process.env.VITEST === "true";
      response = options.fetchImpl || useTestTransport
        ? await fetchImpl(currentUrl.toString(), init)
        : await fetchWithPinnedAddress(currentUrl, init, addresses);
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
        throw new RemoteImageFetchError("remote image fetch timed out", "timeout");
      }
      throw error;
    }

    if (isRedirectStatus(response.status)) {
      if (redirectCount === maxRedirects) {
        throw new RemoteImageFetchError("remote image redirect limit exceeded", "redirect-limit", response.status);
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new RemoteImageFetchError("remote image redirect is missing a location", "invalid-url", response.status);
      }
      currentUrl = parseRemoteUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new RemoteImageFetchError(`remote image HTTP ${response.status}`, "bad-status", response.status);
    }

    const contentType = normalizeContentType(response.headers.get("content-type"))
      || options.contentTypeFallback
      || "image/jpeg";
    if (!isAllowedRemoteContentType(contentType, options.allowedContentTypes || ["image"])) {
      throw new RemoteImageFetchError("remote resource is not an image", "non-image", response.status);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new RemoteImageFetchError("remote image is too large", "too-large", response.status);
    }

    if (!response.body) {
      throw new RemoteImageFetchError("remote image response body is empty", "empty-body", response.status);
    }

    return {
      response,
      url: currentUrl.toString(),
      contentType,
      contentLength: Number.isFinite(contentLength) ? contentLength : 0,
    };
  }

  throw new RemoteImageFetchError("remote image redirect limit exceeded", "redirect-limit");
}

export async function assertRemoteImageUrlAllowed(
  imageUrl: URL,
  options: RemoteImageFetchOptions = {}
) {
  await resolveAllowedRemoteAddresses(imageUrl, options);
}

async function resolveAllowedRemoteAddresses(
  imageUrl: URL,
  options: RemoteImageFetchOptions,
): Promise<ResolvedAddress[]> {
  if (imageUrl.protocol !== "https:" && !(options.allowHttp && imageUrl.protocol === "http:")) {
    throw new RemoteImageFetchError("remote image URL protocol is not allowed", "unsupported-protocol");
  }

  const hostname = normalizeHostname(imageUrl.hostname);
  if (!hostname) {
    throw new RemoteImageFetchError("remote image URL host is invalid", "invalid-url");
  }

  const allowedHosts = normalizeHostPatterns(options.allowedHosts ?? getConfiguredRemoteImageAllowedHosts());
  if (allowedHosts.length > 0 && !allowedHosts.some((pattern) => matchesHostPattern(hostname, pattern))) {
    throw new RemoteImageFetchError("remote image URL host is not allowed", "blocked-host");
  }

  return resolvePublicHostAddresses(hostname, options.lookupHost || defaultLookupHost);
}

export async function readRemoteImageResponseBody(response: Response, maxBytes: number) {
  if (!response.body) {
    throw new RemoteImageFetchError("remote image response body is empty", "empty-body", response.status);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // The response may already be closed; the size error is the important signal.
      }
      throw new RemoteImageFetchError("remote image is too large", "too-large", response.status);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}

export function isPrivateOrReservedIpAddress(address: string) {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const version = isIP(normalized);

  if (version === 4) return isPrivateOrReservedIPv4(normalized);
  if (version === 6) return isPrivateOrReservedIPv6(normalized);
  return true;
}

async function resolvePublicHostAddresses(hostname: string, lookupHost: LookupHost): Promise<ResolvedAddress[]> {
  const directIpVersion = isIP(stripIpv6Brackets(hostname));
  if (directIpVersion) {
    if (isPrivateOrReservedIpAddress(hostname)) {
      throw new RemoteImageFetchError("remote image URL resolves to a private or reserved address", "blocked-address");
    }
    return [{ address: stripIpv6Brackets(hostname), family: directIpVersion }];
  }

  const addresses = await lookupHost(hostname);
  if (!addresses.length) {
    throw new RemoteImageFetchError("remote image URL host has no DNS records", "blocked-address");
  }

  for (const item of addresses) {
    if (isPrivateOrReservedIpAddress(item.address)) {
      throw new RemoteImageFetchError("remote image URL resolves to a private or reserved address", "blocked-address");
    }
  }
  return addresses;
}

async function fetchWithPinnedAddress(url: URL, init: RequestInit, addresses: ResolvedAddress[]) {
  let lastError: unknown;
  for (const resolved of addresses) {
    try {
      return await requestPinnedAddress(url, init, resolved);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("remote connection failed");
}

function requestPinnedAddress(url: URL, init: RequestInit, resolved: ResolvedAddress): Promise<Response> {
  return new Promise((resolve, reject) => {
    const tlsServerName = url.protocol === "https:" && !isIP(stripIpv6Brackets(url.hostname))
      ? { servername: url.hostname }
      : {};
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      signal: init.signal ?? undefined,
      ...tlsServerName,
      lookup: (_hostname, lookupOptions, callback) => {
        // Node 22+ may enable autoSelectFamily and invoke custom lookup with
        // `all: true`. In that mode the callback contract is an address array;
        // returning the scalar form makes Node later connect to `undefined`
        // and surface ERR_INVALID_IP_ADDRESS.
        if (lookupOptions?.all) {
          callback(null, [{ address: resolved.address, family: resolved.family }]);
          return;
        }
        callback(null, resolved.address, resolved.family);
      },
    }, (incoming) => {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index];
        const value = incoming.rawHeaders[index + 1];
        if (name && value !== undefined) headers.append(name, value);
      }
      const status = incoming.statusCode || 500;
      const body = status === 204 || status === 304
        ? null
        : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      resolve(new Response(body, {
        status,
        statusText: incoming.statusMessage || "",
        headers,
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function defaultLookupHost(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

function parseRemoteUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    throw new RemoteImageFetchError("remote image URL is invalid", "invalid-url");
  }
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function normalizeContentType(value?: string | null) {
  return (value || "").split(";")[0].trim().toLowerCase();
}

function isAllowedRemoteContentType(contentType: string, allowedContentTypes: RemoteAssetContentKind[]) {
  if (contentType === "application/octet-stream") return true;
  return allowedContentTypes.some((kind) => contentType.startsWith(`${kind}/`));
}

function getConfiguredRemoteImageAllowedHosts() {
  return [
    ...parseHostList(process.env.IMAGE_STORAGE_REMOTE_ALLOWED_HOSTS),
    ...parseHostList(process.env.REMOTE_IMAGE_ALLOWED_HOSTS),
  ];
}

function parseHostList(value?: string) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHostPatterns(patterns: string[]) {
  return patterns
    .map((pattern) => normalizeHostname(pattern))
    .filter(Boolean);
}

function normalizeHostname(value: string) {
  return stripIpv6Brackets(value.trim().toLowerCase()).replace(/\.$/, "");
}

function matchesHostPattern(host: string, pattern: string) {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }

  return host === pattern;
}

function stripIpv6Brackets(value: string) {
  return value.replace(/^\[/, "").replace(/\]$/, "");
}

function isPrivateOrReservedIPv4(address: string) {
  const octets = address.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIPv6(address: string) {
  const lower = address.toLowerCase();
  const mappedIpv4 = lower.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) return isPrivateOrReservedIPv4(mappedIpv4);
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("2001:db8:")) return true;

  const firstHextet = Number.parseInt(lower.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstHextet)) return true;
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  if ((firstHextet & 0xff00) === 0xff00) return true;
  return false;
}
