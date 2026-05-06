import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedPaths = [
  "/dashboard",
  "/create",
  "/history",
  "/tryon",
  "/pose",
  "/model",
  "/model-background",
  "/grass",
  "/garment-3d",
];

const LARGE_INCOMING_COOKIE_BYTES = 8 * 1024;
const LARGE_SET_COOKIE_BYTES = 4 * 1024;

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;
  const isProtected = protectedPaths.some((path) =>
    pathname.startsWith(path)
  );

  // Avoid refreshing Supabase auth on public pages and API routes. Large
  // chunked auth cookies can make middleware response headers exceed Nginx's
  // upstream header buffer, which shows up as a 502 for only some users.
  if (!isProtected) {
    logLargeIncomingAuthCookies(request);
    return supabaseResponse;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const authCookieName = getSupabaseAuthCookieName(supabaseUrl);
  logLargeIncomingAuthCookies(request, authCookieName);

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[]
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        logLargeSetCookieBatch(request, cookiesToSet, authCookieName);
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

function getSupabaseAuthCookieName(supabaseUrl: string) {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : undefined;
  } catch {
    return undefined;
  }
}

function isAuthCookieName(name: string, authCookieName?: string) {
  if (authCookieName) {
    return name === authCookieName || name.startsWith(`${authCookieName}.`);
  }

  return name.startsWith("sb-") || name.includes("supabase");
}

function logLargeIncomingAuthCookies(
  request: NextRequest,
  authCookieName?: string
) {
  const cookieHeaderBytes = request.headers.get("cookie")?.length ?? 0;
  if (cookieHeaderBytes < LARGE_INCOMING_COOKIE_BYTES) return;

  const authCookies = request.cookies
    .getAll()
    .filter((cookie) => isAuthCookieName(cookie.name, authCookieName));

  if (!authCookies.length) return;

  console.warn(
    "[supabase-auth] large incoming cookies",
    JSON.stringify({
      path: request.nextUrl.pathname,
      cookieHeaderBytes,
      authCookieValueBytes: authCookies.reduce(
        (sum, cookie) => sum + cookie.value.length,
        0
      ),
      authCookies: authCookies.map((cookie) => ({
        name: cookie.name,
        valueBytes: cookie.value.length,
      })),
    })
  );
}

function logLargeSetCookieBatch(
  request: NextRequest,
  cookiesToSet: { name: string; value: string; options: CookieOptions }[],
  authCookieName?: string
) {
  const authCookies = cookiesToSet.filter((cookie) =>
    isAuthCookieName(cookie.name, authCookieName)
  );
  const authCookieValueBytes = authCookies.reduce(
    (sum, cookie) => sum + cookie.name.length + cookie.value.length,
    0
  );

  if (authCookieValueBytes < LARGE_SET_COOKIE_BYTES) return;

  console.warn(
    "[supabase-auth] large set-cookie batch",
    JSON.stringify({
      path: request.nextUrl.pathname,
      count: authCookies.length,
      authCookieValueBytes,
      authCookies: authCookies.map((cookie) => ({
        name: cookie.name,
        valueBytes: cookie.value.length,
      })),
    })
  );
}
