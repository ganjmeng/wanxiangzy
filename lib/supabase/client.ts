"use client";

import { createBrowserClient } from "@supabase/ssr";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_SESSION_REFRESH_SKEW_SECONDS,
  getSupabaseSessionCookieOptions,
} from "@/lib/supabase/session-config";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;
let authSessionRequest: Promise<BrowserAuthState> | null = null;
const creditsRequests = new Map<string, { promise: Promise<number>; timestamp: number }>();
const creditsChangedEvent = "profile-credits-changed";
const CREDITS_CACHE_TTL_MS = 30_000; // 30 秒 TTL
const PROFILE_CACHE_TTL_MS = 60_000;
const PROFILE_FETCH_TIMEOUT_MS = 8_000;

type CachedProfilePayload = {
  user?: { id?: string | null; email?: string | null } | null;
  credits?: number | null;
};

export type BrowserAuthState =
  | { status: "authenticated"; user: { id: string; email?: string | null } }
  | { status: "anonymous" }
  | { status: "unavailable" };

let profileRequest:
  | { promise: Promise<CachedProfilePayload | null>; timestamp: number }
  | null = null;
let profileValue: { payload: CachedProfilePayload; timestamp: number } | null = null;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: getSupabaseSessionCookieOptions(),
        cookies: {
          getAll: readBrowserCookies,
          setAll: writeBrowserSessionCookies,
        },
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      },
    );
  }

  return browserClient;
}

function readBrowserCookies() {
  if (typeof document === "undefined" || !document.cookie) return [];
  return document.cookie.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [];
    try {
      return [{
        name: decodeURIComponent(part.slice(0, separator).trim()),
        value: decodeURIComponent(part.slice(separator + 1).trim()),
      }];
    } catch {
      return [];
    }
  });
}

function writeBrowserSessionCookies(cookies: Array<{
  name: string;
  value: string;
  options: { maxAge?: number; path?: string; sameSite?: boolean | "lax" | "strict" | "none"; secure?: boolean };
}>) {
  if (typeof document === "undefined") return;
  for (const cookie of cookies) {
    const deleting = cookie.options.maxAge === 0 || cookie.value === "";
    const sameSite = cookie.options.sameSite === "strict"
      ? "Strict"
      : cookie.options.sameSite === "none"
        ? "None"
        : "Lax";
    document.cookie = [
      `${encodeURIComponent(cookie.name)}=${encodeURIComponent(cookie.value)}`,
      `Path=${cookie.options.path || "/"}`,
      `Max-Age=${deleting ? 0 : AUTH_SESSION_MAX_AGE_SECONDS}`,
      `SameSite=${sameSite}`,
      cookie.options.secure ? "Secure" : "",
    ].filter(Boolean).join("; ");
  }
}

/**
 * Read and, when necessary, refresh the browser session once for all callers.
 * A temporary refresh/network failure is deliberately different from a
 * confirmed anonymous session so UI code does not turn an outage into a
 * surprise logout.
 */
export async function getBrowserAuthState(): Promise<BrowserAuthState> {
  if (authSessionRequest) return authSessionRequest;

  authSessionRequest = (async (): Promise<BrowserAuthState> => {
    const client = createClient();
    try {
      const current = await client.auth.getSession();
      const session = current.data.session;
      if (!session?.user) return current.error ? { status: "unavailable" } : { status: "anonymous" };

      const expiresAt = Number(session.expires_at || 0);
      const shouldRefresh = expiresAt > 0
        && expiresAt - Math.floor(Date.now() / 1000) <= AUTH_SESSION_REFRESH_SKEW_SECONDS;
      if (!shouldRefresh) {
        return { status: "authenticated", user: session.user };
      }

      const refreshed = await client.auth.refreshSession();
      if (refreshed.data.session?.user) {
        return { status: "authenticated", user: refreshed.data.session.user };
      }
      return { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  })().finally(() => {
    authSessionRequest = null;
  });

  return authSessionRequest;
}

export async function getCachedProfile(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (!options.force && profileValue && now - profileValue.timestamp < PROFILE_CACHE_TTL_MS) {
    return profileValue.payload;
  }
  if (!options.force && profileRequest && now - profileRequest.timestamp < PROFILE_FETCH_TIMEOUT_MS) {
    return profileRequest.promise;
  }

  const request = fetchProfileFromApi();
  profileRequest = { promise: request, timestamp: now };
  return request;
}

export function clearCachedProfile() {
  profileRequest = null;
  profileValue = null;
  authSessionRequest = null;
}

async function fetchProfileFromApi(): Promise<CachedProfilePayload | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PROFILE_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch("/api/profile", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const payload = await res.json().catch(() => ({})) as CachedProfilePayload;
    if (!payload.user?.id) return null;

    profileValue = { payload, timestamp: Date.now() };
    setCachedProfileCredits(payload.user.id, payload.credits ?? 0);
    return payload;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
    profileRequest = null;
  }
}

export function getCachedProfileCredits(userId: string): Promise<number> {
  const cached = creditsRequests.get(userId);
  const now = Date.now();

  // TTL 检查：缓存过期则清除并重新请求
  if (cached && now - cached.timestamp < CREDITS_CACHE_TTL_MS) {
    return cached.promise;
  }

  if (cached) {
    creditsRequests.delete(userId);
  }

  const request = Promise.resolve(
    createClient()
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single()
  )
    .then(({ data }) => data?.credits ?? 0)
    .catch(() => {
      creditsRequests.delete(userId);
      return 0;
    });

  creditsRequests.set(userId, { promise: request, timestamp: now });
  return request;
}

export function setCachedProfileCredits(userId: string, credits: number) {
  creditsRequests.set(userId, { promise: Promise.resolve(credits), timestamp: Date.now() });
  if (profileValue?.payload.user?.id === userId) {
    profileValue = {
      payload: { ...profileValue.payload, credits },
      timestamp: Date.now(),
    };
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(creditsChangedEvent, { detail: { userId, credits } })
    );
  }
}

export function clearCachedProfileCredits(userId?: string) {
  if (userId) {
    creditsRequests.delete(userId);
    return;
  }
  creditsRequests.clear();
}

export function subscribeToProfileCredits(
  handler: (payload: { userId: string; credits: number }) => void
) {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (
      detail &&
      typeof detail.userId === "string" &&
      typeof detail.credits === "number"
    ) {
      handler(detail);
    }
  };

  window.addEventListener(creditsChangedEvent, listener);
  return () => window.removeEventListener(creditsChangedEvent, listener);
}
