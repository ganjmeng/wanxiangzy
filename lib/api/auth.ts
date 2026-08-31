import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

type RequireApiUserResult =
  | { supabase: ServerSupabase; user: User; response: null }
  | { supabase: ServerSupabase; user: null; response: NextResponse };

export async function requireApiUser(): Promise<RequireApiUserResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return {
      supabase,
      user: null,
      response: NextResponse.json(
        { error: "登录状态暂时无法验证，请稍后重试", code: "AUTH_TEMPORARILY_UNAVAILABLE", retryable: true },
        { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "2" } },
      ),
    };
  }

  if (!user) {
    return {
      supabase,
      user: null,
      response: NextResponse.json({ error: "请先登录" }, { status: 401 }),
    };
  }

  return { supabase, user, response: null };
}
