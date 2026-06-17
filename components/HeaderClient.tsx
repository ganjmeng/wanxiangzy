"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  ChevronDown,
  CircleHelp,
  Coins,
  CreditCard,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  UserRound,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  clearCachedProfile,
  clearCachedProfileCredits,
  createClient,
  getCachedProfile,
  getCachedProfileCredits,
  setCachedProfileCredits,
  subscribeToProfileCredits,
} from "@/lib/supabase/client";
import { VISIBLE_TOP_MODULES, getActiveTopModule } from "@/lib/navigation";
import { codexTheme } from "@/lib/design/codex-theme";

type HeaderAccountState = {
  authReady: boolean;
  creditsReady: boolean;
  credits: number | null;
  email: string | null;
  isLoggingOut: boolean;
  onLogout: () => Promise<void>;
};

const marketingNav = [
  { label: "产品", href: "/#features" },
  { label: "模特库", href: "/model" },
  { label: "价格", href: "/pricing" },
  { label: "案例", href: "/#testimonials" },
  { label: "资源", href: "/general-image" },
];

export function HeaderClient() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) {
    return null;
  }

  if (pathname.startsWith("/infinite-canvas/")) {
    return null;
  }

  if (pathname === "/") {
    return <MarketingHeaderWithAccount overlay />;
  }

  if (pathname.startsWith("/pricing")) {
    return <MarketingHeaderWithAccount />;
  }

  return <AppHeader pathname={pathname} />;
}

function useHeaderAccount(): HeaderAccountState {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [creditsReady, setCreditsReady] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const loadedCreditsForUserRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfileFromApi() {
      const payload = await getCachedProfile();
      if (cancelled || !payload?.user?.id) return false;

      loadedCreditsForUserRef.current = payload.user.id;
      setEmail(payload.user.email ?? null);
      setCredits(payload.credits ?? 0);
      setCachedProfileCredits(payload.user.id, payload.credits ?? 0);
      setAuthReady(true);
      setCreditsReady(true);
      return true;
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
        if (loaded || cancelled) return undefined;
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
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        await loadUserCredits(session.user);
      } else {
        clearCachedProfile();
        clearCachedProfileCredits();
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

  const onLogout = async () => {
    setIsLoggingOut(true);
    clearCachedProfile();
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

  return { authReady, creditsReady, credits, email, isLoggingOut, onLogout };
}

function MarketingHeaderWithAccount({ overlay = false }: { overlay?: boolean }) {
  const account = useHeaderAccount();

  return <MarketingHeader account={account} overlay={overlay} />;
}

function MarketingHeader({ account, overlay }: { account: HeaderAccountState; overlay: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const threshold = overlay ? 12 : 96;
    const updateScrolled = () => {
      const nextScrolled = window.scrollY > threshold;
      if (scrolledRef.current === nextScrolled) return;
      scrolledRef.current = nextScrolled;
      setScrolled(nextScrolled);
    };
    const requestUpdate = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateScrolled();
      });
    };

    updateScrolled();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [overlay]);

  return (
    <header
      className={`home-marketing-header z-50 ${overlay ? "home-marketing-header-overlay" : "sticky top-0"} ${
        scrolled ? "home-marketing-header-scrolled" : ""
      }`}
    >
      <div className="flex h-16 w-full items-center justify-between gap-6 px-5 sm:px-8 lg:px-10">
        <Link
          href="/"
          className="home-marketing-logo shrink-0 text-[18px] font-semibold leading-none"
          aria-label="VastWearGen 首页"
        >
          VastWearGen
        </Link>

        <nav className="home-marketing-nav hidden flex-1 items-center gap-8 pl-4 text-[14px] font-semibold leading-none lg:flex" aria-label="主导航">
          {marketingNav.map((item) => (
            <Link key={item.label} href={item.href} prefetch={false} className="transition">
              {item.label}
            </Link>
          ))}
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center" aria-label="搜索">
            <Search className="h-4 w-4" />
          </button>
        </nav>

        <div className="home-marketing-actions flex shrink-0 items-center gap-3 text-[14px] font-semibold leading-none">
          <MarketingAccountActions {...account} />
          <Link href="/create" className="home-trial-pill inline-flex h-10 items-center gap-1.5 rounded-full px-5 transition">
            进入工作台
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <MarketingMobileMenu />
        </div>
      </div>
    </header>
  );
}

function MarketingAccountActions({
  authReady,
  creditsReady,
  credits,
  email,
  isLoggingOut,
  onLogout,
}: HeaderAccountState) {
  if (!authReady) {
    return (
      <span className="home-login-pill hidden h-10 w-[92px] items-center justify-center rounded-full px-5 transition sm:inline-flex">
        <span className="h-3 w-10 animate-pulse rounded-full bg-current opacity-20" />
      </span>
    );
  }

  if (!email) {
    return (
      <Link href="/login" className="home-login-pill hidden h-10 items-center gap-1 rounded-full px-5 transition sm:inline-flex">
        登录
        <ChevronDown className="h-3.5 w-3.5" />
      </Link>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="home-login-pill hidden h-10 items-center gap-1.5 rounded-full px-4 transition sm:inline-flex">
          <Coins className="h-3.5 w-3.5" />
          {creditsReady ? <span>{credits ?? "--"}</span> : <span className="h-3 w-5 animate-pulse rounded bg-current opacity-20" />}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="mac-surface z-[80] min-w-[180px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-200/50"
      >
        <AccountMenuHeader email={email} credits={credits} creditsReady={creditsReady} />
        <AccountMenuLink href="/account" icon={UserRound} label="个人中心" />
        <AccountMenuLink href="/account?tab=credits" icon={Coins} label="灵点明细" />
        <AccountMenuLink href="/account?tab=orders" icon={CreditCard} label="充值记录" />
        <AccountMenuLink href="/account?tab=help" icon={CircleHelp} label="帮助中心" />
        <AccountMenuLink href="/account?tab=messages" icon={Bell} label="消息中心" />
        <AccountMenuLink href="/account?tab=feedback" icon={MessageSquare} label="客服反馈" />
        <DropdownMenuSeparator className="my-1 h-px bg-slate-100" />
        <AccountMenuLink href="/history" icon={ArrowUpRight} label="我的作品" />
        <AccountMenuLink href="/create" icon={Home} label="进入工作台" />
        <DropdownMenuItem
          disabled={isLoggingOut}
          onSelect={(event) => {
            event.preventDefault();
            onLogout();
          }}
          className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition hover:bg-slate-50 hover:text-slate-950 focus:bg-slate-50 focus:text-slate-950 data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {isLoggingOut ? "退出中" : "退出登录"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MarketingMobileMenu() {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="home-menu-pill inline-flex h-10 w-10 items-center justify-center rounded-full outline-none transition focus-visible:ring-4 focus-visible:ring-[rgba(91,124,255,0.18)] lg:hidden"
          aria-label="打开导航"
        >
          <Menu className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="z-[80] min-w-[220px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-300/45"
      >
        {marketingNav.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link
              href={item.href}
              prefetch={false}
              className="flex items-center rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none transition hover:bg-slate-50 hover:text-slate-950 focus:bg-slate-50 focus:text-slate-950 data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-950"
            >
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppHeader({ pathname }: { pathname: string }) {
  const [locationSearch, setLocationSearch] = useState("");
  const activeModule =
    pathname === "/agent" && new URLSearchParams(locationSearch).get("intent") === "video"
      ? "aiVideo"
      : getActiveTopModule(pathname);
  const isLoginPage = pathname === "/login";
  const { authReady, creditsReady, credits, email, isLoggingOut, onLogout } = useHeaderAccount();

  useEffect(() => {
    setLocationSearch(window.location.search);
  }, [pathname]);

  return (
    <header className="studio-app-header mac-toolbar sticky top-0 z-50">
      <div className="flex min-h-16 w-full items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-5">
          <BrandMark />
          <DesktopTopNav activeModule={activeModule} />
        </div>

        <div className="studio-header-actions flex shrink-0 items-center gap-1.5">
          <div className="lg:hidden">
            <MobileModuleMenu activeModule={activeModule} />
          </div>
          <UserCreditActions
            authReady={authReady}
            creditsReady={creditsReady}
            credits={credits}
            email={email}
            isLoginPage={isLoginPage}
            isLoggingOut={isLoggingOut}
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="VastWearGen 首页">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/70 bg-white/88 shadow-sm">
        <Image
          src={codexTheme.brand.logo}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
          priority
          aria-hidden="true"
        />
      </span>
      <span className="hidden min-w-0 sm:block">
        <span className="block truncate text-sm font-black text-codex-ink sm:text-[15px]">
          {codexTheme.brand.name}
        </span>
        <span className="block truncate text-[11px] font-semibold text-codex-muted">
          {codexTheme.brand.subtitle}
        </span>
      </span>
    </Link>
  );
}

function DesktopTopNav({ activeModule }: { activeModule: string }) {
  return (
    <nav className="studio-surface-toolbar hidden items-center gap-1 p-1 lg:flex" aria-label="主导航">
      {VISIBLE_TOP_MODULES.map((item) => {
        const active = activeModule === item.key;
        const Icon = item.icon;
        const className = `relative inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-black transition ${
          active
            ? "bg-white text-codex-ink shadow-sm ring-1 ring-[rgba(91,124,255,0.22)]"
            : "text-codex-muted hover:bg-white/72 hover:text-codex-ink"
        }`;

        if (item.comingSoon) {
          return (
            <button
              key={item.key}
              type="button"
              disabled
              title="视频功能即将上线"
              className={`${className} cursor-not-allowed opacity-55`}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
              <span className="ml-0.5 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-codex-faint">
                即将上线
              </span>
            </button>
          );
        }

        return (
          <Link key={item.key} href={item.href} className={className} aria-current={active ? "page" : undefined}>
            <Icon className="h-3.5 w-3.5" />
            {item.label}
            {item.badge && (
              <span className="ml-0.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-black leading-none text-white shadow-sm shadow-red-500/25">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function UserCreditActions({
  authReady,
  creditsReady,
  credits,
  email,
  isLoginPage,
  isLoggingOut,
  onLogout,
}: {
  authReady: boolean;
  creditsReady: boolean;
  credits: number | null;
  email: string | null;
  isLoginPage: boolean;
  isLoggingOut: boolean;
  onLogout: () => void;
}) {
  if (isLoginPage) {
    return (
      <Link href="/" className="studio-button studio-button-compact">
        <Home className="h-3.5 w-3.5" />
        首页
      </Link>
    );
  }

  if (!authReady) {
    return <span className="studio-status-badge">登录</span>;
  }

  if (!email) {
    return (
      <Link href="/login" className="codex-primary-action flex h-9 shrink-0 items-center rounded-full px-4 text-xs font-bold text-white">
        登录
      </Link>
    );
  }

  return (
    <>
      <Link
        href="/pricing"
        className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#3b2415] px-3 text-xs font-black text-[#ffe5b4] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2c1a0f] sm:inline-flex"
        title="充值中心"
      >
        <CreditCard className="h-3.5 w-3.5" />
        充值中心
      </Link>
      <Link
        href="/account?tab=credits"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#ffd59c] bg-[#fff0dc] px-3 text-xs font-black text-[#9a5a00] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#ffe7c2]"
        title="灵点明细"
      >
        <Coins className="h-3.5 w-3.5 text-[#f59e0b]" />
        {creditsReady ? <span>{credits ?? "--"}</span> : <span className="h-3 w-5 animate-pulse rounded bg-slate-200" />}
      </Link>
      <HeaderHelpDropdown />
      <AccountAvatarDropdown
        email={email}
        credits={credits}
        creditsReady={creditsReady}
        isLoggingOut={isLoggingOut}
        onLogout={onLogout}
      />
    </>
  );
}

function AccountAvatarDropdown({
  email,
  credits,
  creditsReady,
  isLoggingOut,
  onLogout,
}: {
  email: string;
  credits: number | null;
  creditsReady: boolean;
  isLoggingOut: boolean;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dbe6ff] text-[#6d8fe8] shadow-sm ring-1 ring-[#c8d7ff] transition hover:bg-[#cfddff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(91,124,255,0.18)]"
          title="打开个人中心"
          aria-label="打开个人中心菜单"
          aria-expanded={open}
        >
          <Avatar className="size-8 bg-[#dbe6ff] text-[#6d8fe8]">
            <AvatarFallback className="bg-[#dbe6ff] text-xs font-black text-[#6d8fe8]">
              {getAvatarFallback(email)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={12}
        className="z-[80] w-[272px] overflow-hidden rounded-md border border-slate-100 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.16)]"
      >
        <AccountMenuHeader email={email} credits={credits} creditsReady={creditsReady} />
        <AccountMenuBanner />
        <AccountMenuLink href="/account" icon={UserRound} label="个人中心" />
        <AccountMenuLink href="/pricing" icon={CreditCard} label="充值中心" />
        <AccountMenuLink href="/account?tab=credits" icon={Coins} label="灵点明细" />
        <AccountMenuLink href="/account?tab=orders" icon={CreditCard} label="充值记录" />
        <AccountMenuLink href="/account?tab=help" icon={CircleHelp} label="帮助中心" />
        <AccountMenuLink href="/account?tab=messages" icon={Bell} label="消息中心" />
        <AccountMenuLink href="/account?tab=feedback" icon={MessageSquare} label="客服反馈" />
        <DropdownMenuSeparator className="h-px bg-slate-100" />
        <DropdownMenuItem
          disabled={isLoggingOut}
          onSelect={(event) => {
            event.preventDefault();
            onLogout();
          }}
          className="flex cursor-pointer items-center gap-2.5 px-4 py-3 text-sm font-medium text-slate-700 outline-none transition hover:bg-slate-50 hover:text-slate-950 focus:bg-slate-50 focus:text-slate-950 data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {isLoggingOut ? "退出中" : "退出登录"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountMenuHeader({
  email,
  credits,
  creditsReady,
}: {
  email: string | null;
  credits: number | null;
  creditsReady: boolean;
}) {
  const masked = email ? maskAccountLabel(email) : "个人账户";
  return (
    <div className="bg-[#f8fafc] px-3 py-3">
      <div className="flex items-center gap-3">
        <Avatar size="lg" className="bg-[#c8d7ff] text-white">
          <AvatarFallback className="bg-[#c8d7ff] text-sm font-black text-white">
            {getAvatarFallback(email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-950">{masked}</p>
          <p className="mt-0.5 text-xs text-slate-500">个人账户</p>
        </div>
        <Link
          href="/login"
          className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          切换账号
        </Link>
      </div>
      <p className="mt-2 text-xs font-medium text-slate-500">
        可用灵点 {creditsReady ? credits ?? "--" : "--"}
      </p>
    </div>
  );
}

function AccountMenuBanner() {
  return (
    <Link
      href="/pricing"
      className="mx-3 mb-1 mt-2 flex h-9 items-center justify-between rounded-md bg-gradient-to-r from-[#fff2ff] to-[#edf4ff] px-3 text-xs font-medium text-[#8b4bd8] transition hover:brightness-[0.98]"
    >
      <span>升级团队版会员，畅享团队协同</span>
      <span className="rounded bg-[#ff8ba7] px-1.5 py-0.5 text-[10px] font-bold text-white">会员</span>
    </Link>
  );
}

function AccountMenuLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof UserRound;
  label: string;
}) {
  return (
    <DropdownMenuItem asChild>
      <Link href={href} className="flex h-10 items-center gap-2.5 border-t border-slate-100 px-4 text-sm font-medium text-slate-800 outline-none transition hover:bg-slate-50 hover:text-slate-950 focus:bg-slate-50 focus:text-slate-950 data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-950">
        <Icon className="h-4 w-4" />
        {label}
      </Link>
    </DropdownMenuItem>
  );
}

function HeaderHelpDropdown() {
  const items = [
    { href: "/account?tab=help", label: "生图指南" },
    { href: "/account?tab=feedback", label: "联系我们" },
  ];

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="studio-button studio-button-compact hidden sm:inline-flex"
          title="帮助中心"
          aria-label="打开帮助菜单"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="z-[80] min-w-[112px] overflow-hidden rounded-md border border-slate-100 bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.14)]"
      >
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link
              href={item.href}
              className="flex h-9 items-center rounded-sm px-3 text-sm font-medium text-slate-800 outline-none transition hover:bg-slate-50 hover:text-slate-950 focus:bg-slate-50 focus:text-slate-950 data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-950"
            >
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getAvatarFallback(email: string | null) {
  const name = email?.split("@")[0]?.trim();
  return (name?.slice(0, 1) || "V").toUpperCase();
}

function maskAccountLabel(value: string) {
  const [name, domain] = value.split("@");
  if (!domain) return value.length > 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : value;
  return `${name.slice(0, 3)}****@${domain}`;
}

function MobileModuleMenu({ activeModule }: { activeModule: string }) {
  const active = VISIBLE_TOP_MODULES.find((item) => item.key === activeModule) || VISIBLE_TOP_MODULES[0];
  const ActiveIcon = active.icon;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mac-button inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 shadow-sm"
          aria-label="切换模块"
        >
          <ActiveIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{active.label}</span>
          <Menu className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="mac-surface z-[80] min-w-[190px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-200/50"
      >
        {VISIBLE_TOP_MODULES.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === activeModule;

          if (item.comingSoon) {
            return (
              <DropdownMenuItem
                key={item.key}
                disabled
                className="flex cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-400 outline-none"
              >
                <Icon className="h-4 w-4" />
                <span className="flex flex-1 items-center justify-between gap-3">
                  {item.label}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                    即将上线
                  </span>
                </span>
              </DropdownMenuItem>
            );
          }

          return (
            <DropdownMenuItem key={item.key} asChild>
              <Link
                href={item.href}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold outline-none transition-colors ${
                  isActive ? "bg-white/80 text-[var(--mac-accent)]" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black leading-none text-white shadow-sm shadow-red-500/20">
                      {item.badge}
                    </span>
                  )}
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
