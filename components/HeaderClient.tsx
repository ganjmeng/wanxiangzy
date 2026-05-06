"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearCachedProfileCredits,
  createClient,
  getCachedProfileCredits,
  setCachedProfileCredits,
  subscribeToProfileCredits,
} from "@/lib/supabase/client";
import { Coins, History, Home, LogOut, Menu, ServerCog, Shirt, UserRound } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/create", label: "创作", icon: Shirt },
  { href: "/history", label: "作品", icon: History },
  { href: "/api-platform-test", label: "API", icon: ServerCog },
];

export function HeaderClient() {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [email, setEmail] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [creditsReady, setCreditsReady] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const loadedCreditsForUserRef = useRef<string | null>(null);
  const isAgentV2Page = pathname === "/agent-v2" || pathname.startsWith("/agent-v2/");

  useEffect(() => {
    let cancelled = false;

    async function loadProfileFromApi() {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch("/api/profile", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (cancelled) return false;
        if (res.status === 401) {
          loadedCreditsForUserRef.current = null;
          setEmail(null);
          setCredits(null);
          setAuthReady(true);
          setCreditsReady(true);
          return true;
        }

        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.user) return false;

        loadedCreditsForUserRef.current = payload.user.id;
        setEmail(payload.user.email ?? null);
        setCredits(payload.credits ?? 0);
        setCachedProfileCredits(payload.user.id, payload.credits ?? 0);
        setAuthReady(true);
        setCreditsReady(true);
        return true;
      } catch {
        return false;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    async function loadUserCredits(user: { id: string; email?: string | null }) {
      setEmail(user.email ?? null);
      setAuthReady(true);
      setCreditsReady(false);
      loadedCreditsForUserRef.current = user.id;
      const apiLoaded = await loadProfileFromApi();
      if (apiLoaded) return;

      const profileCredits = await getCachedProfileCredits(user.id);

      if (!cancelled && loadedCreditsForUserRef.current === user.id) {
        setCredits(profileCredits);
        setCreditsReady(true);
      }
    }

    loadProfileFromApi()
      .then((loaded) => {
        if (loaded || cancelled) return;
        return supabase.auth.getUser();
      })
      .then((result) => {
        if (!result || cancelled) return;
        const { data } = result;
        if (data.user) {
          loadUserCredits(data.user);
        } else {
          setAuthReady(true);
          setCreditsReady(true);
        }
      })
      .catch(() => {
        setAuthReady(true);
        setCreditsReady(true);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (session?.user) {
        await loadUserCredits(session.user);
      } else {
        loadedCreditsForUserRef.current = null;
        setEmail(null);
        setCredits(null);
        setAuthReady(true);
        setCreditsReady(true);
      }
    });

    const unsubscribeCredits = subscribeToProfileCredits(({ userId, credits: nextCredits }) => {
      if (loadedCreditsForUserRef.current === userId) {
        setCredits(nextCredits);
        setCreditsReady(true);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeCredits();
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    clearCachedProfileCredits();
    setEmail(null);
    setCredits(null);
    setCreditsReady(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2000);
    await fetch("/api/logout", { method: "POST", cache: "no-store", signal: controller.signal }).catch(() => {});
    window.clearTimeout(timeout);
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    clearSupabaseLocalStorage();
    window.location.replace("/login");
  };

  if (isAgentV2Page) return null;

  return (
    <header className="studio-app-header sticky top-0 z-50">
      <div className="relative mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <Image
                src="/gemini-icon.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 object-contain"
                priority
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-slate-950 sm:text-[15px]">
                VastWear
              </span>
              <span className="hidden truncate text-[11px] font-medium text-slate-500 sm:block">
                服装视觉生成平台
              </span>
            </span>
          </Link>

        </div>

        <div className="flex items-center gap-2 shrink-0 sm:hidden">
          {isLoginPage ? (
            <Link href="/" className="gradient-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/50 text-white shadow-lg shadow-purple-200/70" aria-label="返回首页">
              <Home className="h-4 w-4" />
            </Link>
          ) : !authReady ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/82 text-slate-400 shadow-sm" aria-label="正在读取登录状态">
              <UserRound className="h-4 w-4" />
            </span>
          ) : email ? (
            <>
              <Link
                href="/create"
                className="flex h-9 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-700 shadow-sm"
              >
                <Coins className="h-3.5 w-3.5 text-amber-500" />
                {creditsReady ? <span>{credits ?? "--"}</span> : <span className="h-3 w-5 animate-pulse rounded bg-amber-100" />}
              </Link>
              <Link
                href="/history"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition-colors hover:bg-white hover:text-slate-950"
                aria-label="历史记录"
              >
                <History className="h-4 w-4" />
              </Link>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition-colors hover:bg-white hover:text-slate-950"
                    aria-label="菜单"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={8}
                    className="z-[70] min-w-[160px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-200/50"
                  >
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href);
                      return (
                        <DropdownMenu.Item
                          key={item.href}
                          asChild
                        >
                          <Link
                            href={item.href}
                            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold outline-none transition-colors ${
                              active
                                ? "bg-violet-50 text-violet-700"
                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {item.label}
                          </Link>
                        </DropdownMenu.Item>
                      );
                    })}
                    <DropdownMenu.Separator className="my-1.5 h-px bg-slate-100" />
                    <DropdownMenu.Item asChild>
                      <button
                        type="button"
                        onClick={handleLogout}
                        disabled={isLoggingOut}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-red-500 outline-none transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        <LogOut className="h-4 w-4" />
                        {isLoggingOut ? "退出中..." : "退出登录"}
                      </button>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </>
          ) : (
            <Link href="/login" className="gradient-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-lg shadow-purple-200/70" aria-label="登录">
              <UserRound className="h-4 w-4" />
            </Link>
          )}
        </div>

        <nav className="hidden items-center gap-1 rounded-full border border-slate-200/80 bg-white/76 p-1 shadow-sm backdrop-blur md:flex">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                  active
                    ? "gradient-brand text-white shadow-sm shadow-purple-200/60"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden min-w-0 items-center justify-end gap-2 sm:flex">
          <Link
            href="/create"
            className="hidden h-9 items-center rounded-full border border-slate-200 bg-white/82 px-3 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-white sm:flex md:hidden"
          >
            创作
          </Link>
          {isLoginPage ? (
            <Link href="/" className="flex h-9 shrink-0 items-center rounded-full border border-slate-200 bg-white/82 px-4 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-white md:hidden">
              首页
            </Link>
          ) : !authReady ? (
            <span className="flex h-9 shrink-0 items-center rounded-full border border-slate-200 bg-white/80 px-4 text-xs font-bold text-slate-400 shadow-sm">
              登录
            </span>
          ) : email ? (
            <>
              <Link
                href="/create"
                className="flex h-9 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-700 shadow-sm transition-colors hover:bg-amber-100"
              >
                <Coins className="h-3.5 w-3.5 text-amber-500" />
                {creditsReady ? (
                  <span>{credits ?? "--"}</span>
                ) : (
                  <span className="h-3 w-5 animate-pulse rounded bg-amber-100" />
                )}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="hidden h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 text-xs font-semibold text-slate-500 shadow-sm transition-colors hover:text-slate-950 disabled:opacity-50 sm:flex"
                title={`退出 ${email}`}
              >
                <LogOut className="h-3.5 w-3.5" />
                {isLoggingOut ? "退出中" : "退出"}
              </button>
            </>
          ) : (
            <Link href="/login" className="gradient-brand flex h-9 shrink-0 items-center rounded-full px-4 text-xs font-bold text-white shadow-lg shadow-purple-200/70 transition-opacity hover:opacity-95">
              登录
            </Link>
          )}
        </div>

      </div>
    </header>
  );
}

function clearSupabaseLocalStorage() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("sb-") || key.includes("supabase"))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage access failures.
  }
}
