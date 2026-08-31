import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  getSupabaseSessionCookieOptions,
} from "@/lib/supabase/session-config";

type CreateServerSupabaseOptions = {
  readonlyCookies?: boolean;
  fetch?: typeof fetch;
};

export async function createServerSupabase(options: CreateServerSupabaseOptions = {}) {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: options.fetch ? { fetch: options.fetch } : undefined,
      cookieOptions: getSupabaseSessionCookieOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          if (options.readonlyCookies) return;
          cookiesToSet.forEach(({ name, value, options: cookieOptions }) =>
            cookieStore.set(name, value, {
              ...cookieOptions,
              maxAge: cookieOptions.maxAge === 0 ? 0 : AUTH_SESSION_MAX_AGE_SECONDS,
            })
          );
        },
      },
    }
  );
}

export function createServerSupabaseAdmin() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll() { return []; }, setAll() {} } }
  );
}
