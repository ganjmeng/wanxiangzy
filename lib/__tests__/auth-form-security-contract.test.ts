import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("auth form transport security", () => {
  it.each([
    "features/login/LoginFormView.tsx",
    "features/login/SignUpFormView.tsx",
    "features/login/ForgotPasswordView.tsx",
  ])("never falls back to a GET form before hydration: %s", (path) => {
    const source = read(path);

    expect(source).toContain('<form method="post" onSubmit={onSubmit}');
    expect(source).not.toMatch(/<form(?![^>]*method="post")[^>]*onSubmit=/);
  });

  it("removes sensitive fields from legacy or prematurely submitted login URLs", () => {
    const page = read("app/(home)/login/page.tsx");

    expect(page).toContain('["email", "password", "newPassword"]');
    expect(page).toContain("url.searchParams.delete(key)");
    expect(page).toContain("window.history.replaceState");
  });

  it("performs a document navigation after server-side login writes the session cookies", () => {
    const page = read("app/(home)/login/page.tsx");

    expect(page).toContain("window.location.replace(getSafeAuthRedirectTarget())");
    expect(page).not.toContain("router.push(getSafeAuthRedirectTarget())");
  });

  it("uses an explicit sliding session cookie lifetime", () => {
    const config = read("lib/supabase/session-config.ts");
    const browser = read("lib/supabase/client.ts");
    const server = read("lib/supabase/server.ts");

    expect(config).toContain("30 * 24 * 60 * 60");
    expect(browser).toContain("getSupabaseSessionCookieOptions()");
    expect(browser).toContain("Max-Age=${deleting ? 0 : AUTH_SESSION_MAX_AGE_SECONDS}");
    expect(server).toContain("getSupabaseSessionCookieOptions()");
    expect(server).toContain("maxAge: cookieOptions.maxAge === 0 ? 0 : AUTH_SESSION_MAX_AGE_SECONDS");
  });
});
