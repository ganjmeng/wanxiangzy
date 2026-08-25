import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  // Keep page middleware header-light. Calling supabase.auth.getUser() here can
  // refresh large chunked auth cookies and trigger Nginx "upstream sent too big header".
  // API routes still perform authoritative auth checks with createServerSupabase().
  const protectedPaths = [
    "/admin",
    "/dashboard",
    "/create",
    "/face-swap",
    "/history",
    "/resource-library",
    "/tryon",
    "/pose",
    "/model",
    "/model-background",
    "/grass",
    "/product-set",
    "/garment-3d",
    "/video",
  ];

  const isProtected = protectedPaths.some((path) =>
    request.nextUrl.pathname === path ||
    request.nextUrl.pathname.startsWith(`${path}/`),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  const hasSupabaseSession = request.cookies.getAll().some((cookie) =>
    cookie.name.startsWith("sb-") &&
    cookie.name.includes("auth-token") &&
    cookie.value.length > 0,
  );

  if (!hasSupabaseSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
