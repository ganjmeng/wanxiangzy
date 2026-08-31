export const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const AUTH_SESSION_REFRESH_SKEW_SECONDS = 5 * 60;

export function getSupabaseSessionCookieOptions() {
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  };
}
