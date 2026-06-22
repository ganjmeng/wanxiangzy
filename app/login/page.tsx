"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertCircle, ArrowLeft, CheckCircle, Eye, EyeOff, KeyRound, Lock, Mail } from "lucide-react";

type AuthView = "login" | "signup" | "check-email" | "forgot-password" | "reset-sent";

const viewCopy: Record<AuthView, { title: string; desc: string }> = {
  login: {
    title: "登录 VastWearGen",
    desc: "继续管理你的服装视觉资产和生成记录。",
  },
  signup: {
    title: "创建账号",
    desc: "注册后即可开始生成服装上身、姿势裂变和专属模特。",
  },
  "check-email": {
    title: "查收确认邮件",
    desc: "完成邮箱验证后即可进入创作流程。",
  },
  "forgot-password": {
    title: "重置密码",
    desc: "输入注册邮箱，我们会发送密码重置链接。",
  },
  "reset-sent": {
    title: "邮件已发送",
    desc: "请在邮箱中完成密码重置。",
  },
};

const showcaseImages = [
  "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/references/reference-striped-top-white-skirt.png",
  "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/references/reference-grey-tank-denim-culottes.jpg",
  "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/models/model-natural-smile.jpg",
  "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/references/reference-soft-blue-cardigan.jpg",
];

function getSafeAuthRedirectTarget() {
  if (typeof window === "undefined") return "/create";
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/api/")) return "/create";
  return next;
}

export default function LoginPage() {
  const supabase = useMemo(() => createClient(), []);

  const [view, setView] = useState<AuthView>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (mounted && data.user) window.location.replace(getSafeAuthRedirectTarget());
      })
      .catch(() => undefined);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session && window.location.pathname === "/login") {
        window.location.replace(getSafeAuthRedirectTarget());
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ email, password }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = typeof payload.error === "string" ? payload.error : "登录失败，请稍后重试";
        if (message.includes("Invalid login credentials")) {
          setError("邮箱或密码错误");
        } else if (message.includes("Email not confirmed")) {
          setError("请先点击确认邮件中的链接完成验证");
          setView("check-email");
        } else {
          setError(message);
        }
        return;
      }

      window.location.href = getSafeAuthRedirectTarget();
    } catch {
      setError("网络连接失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (password.length < 6) {
      setError("密码至少需要 6 位");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          email,
          password,
          inviteCode,
          next: getSafeAuthRedirectTarget(),
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = typeof payload.error === "string" ? payload.error : "注册失败，请稍后重试";
        if (message.includes("已注册")) {
          setError("该邮箱已注册，请直接登录");
          setView("login");
        } else {
          setError(message);
        }
        return;
      }

      if (payload.session) {
        window.location.href = getSafeAuthRedirectTarget();
        return;
      }

      setView("check-email");
    } catch {
      setError("网络连接失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });

    if (error) {
      setError(error.message);
    } else {
      setView("reset-sent");
    }
    setLoading(false);
  };

  const copy = viewCopy[view];

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-[var(--codex-gradient-page)] px-4 py-8 text-codex-ink sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100dvh-128px)] max-w-6xl items-start gap-8 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:pt-0">
        <section className="hidden lg:block" aria-hidden="true">
          <div className="studio-surface studio-surface-elevated relative overflow-hidden rounded-[34px] p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(5,5,5,0.06),transparent_34%),radial-gradient(circle_at_86%_8%,rgba(5,5,5,0.04),transparent_38%)]" />
            <div className="relative z-10">
              <Link href="/" className="studio-button studio-button-compact">
                <CheckCircle aria-hidden="true" className="h-4 w-4 text-[var(--codex-accent)]" />
                VastWearGen
              </Link>
              <h1 className="mt-10 max-w-xl text-5xl font-black leading-[0.95] tracking-[-0.04em] text-codex-ink">
                把每一次上新，做成统一的品牌视觉。
              </h1>
              <p className="mt-5 max-w-lg text-base leading-8 text-codex-muted">
                从服装上身到姿势裂变，从专属模特到商品质感图，VastWearGen 帮你把分散的素材变成可持续复用的视觉资产。
              </p>

              <div className="mt-10 grid grid-cols-4 gap-3" aria-hidden="true">
                {showcaseImages.map((src, index) => (
                  <div
                    key={src}
                    className={`relative aspect-[3/4] overflow-hidden rounded-[24px] bg-[var(--codex-ice)] shadow-[0_18px_48px_rgba(14,18,38,0.14)] ${index % 2 === 1 ? "translate-y-8" : ""}`}
                  >
                    <Image src={src} alt="" fill sizes="180px" className="object-cover" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="studio-surface studio-surface-elevated mx-0 w-full max-w-[350px] rounded-[28px] p-6 sm:mx-auto sm:max-w-[440px] sm:p-8">
          <div className="mb-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-codex-dark shadow-lg shadow-slate-300/70">
              <CheckCircle aria-hidden="true" className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-2xl font-black tracking-[-0.02em] text-codex-ink">{copy.title}</h2>
            <p className="mt-2 text-sm leading-6 text-codex-muted">
              {view === "check-email" && email ? `确认邮件已发送至 ${email}` : copy.desc}
            </p>
          </div>

          {view === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700">邮箱</label>
                <div className="relative">
                  <Mail aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    className="w-full rounded-2xl border border-[var(--codex-border)] bg-white px-4 py-3 pl-10 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/15"
                    placeholder="you@example.com…"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700">密码</label>
                <div className="relative">
                  <Lock aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-2xl border border-[var(--codex-border)] bg-white px-4 py-3 pl-10 pr-10 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/15"
                    placeholder="输入密码…"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div aria-live="polite" className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                  <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="gradient-brand flex h-12 w-full items-center justify-center rounded-2xl text-sm font-black text-white shadow-xl shadow-slate-300/40 transition-opacity hover:opacity-95 disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    登录中…
                  </span>
                ) : (
                  "登录"
                )}
              </button>

              <div className="flex flex-col gap-2 text-sm sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setView("forgot-password");
                    setError("");
                  }}
                  className="font-bold text-[var(--codex-accent)] hover:underline"
                >
                  忘记密码？
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setView("signup");
                    setError("");
                  }}
                  className="font-bold text-[var(--codex-accent)] hover:underline"
                >
                  创建账号
                </button>
              </div>
            </form>
          )}

          {view === "signup" && (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700">邮箱</label>
                <div className="relative">
                  <Mail aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    className="w-full rounded-2xl border border-[var(--codex-border)] bg-white px-4 py-3 pl-10 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/15"
                    placeholder="you@example.com…"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700">邀请码</label>
                <div className="relative">
                  <KeyRound aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    required
                    autoComplete="one-time-code"
                    className="w-full rounded-2xl border border-[var(--codex-border)] bg-white px-4 py-3 pl-10 font-mono text-sm font-black uppercase tracking-[0.08em] outline-none transition-all focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/15"
                    placeholder="输入邀请码…"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700">密码</label>
                <div className="relative">
                  <Lock aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-[var(--codex-border)] bg-white px-4 py-3 pl-10 pr-10 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/15"
                    placeholder="至少 6 位…"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">至少 6 位字符</p>
              </div>

              {error && (
                <div aria-live="polite" className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                  <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="gradient-brand flex h-12 w-full items-center justify-center rounded-2xl text-sm font-black text-white shadow-xl shadow-slate-300/40 transition-opacity hover:opacity-95 disabled:opacity-50"
              >
                {loading ? "创建中…" : "创建账号"}
              </button>

              <p className="text-center text-sm text-slate-500">
                已有账号？
                <button
                  type="button"
                  onClick={() => {
                    setView("login");
                    setError("");
                  }}
                  className="ml-1 font-bold text-[var(--codex-accent)] hover:underline"
                >
                  去登录
                </button>
              </p>
            </form>
          )}

          {view === "check-email" && (
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-zinc-100">
                <Mail aria-hidden="true" className="h-10 w-10 text-[var(--codex-accent)]" />
              </div>

              <div className="space-y-2">
                <p className="text-sm leading-6 text-slate-600">
                  我们已向 <span className="font-bold text-slate-900">{email}</span> 发送确认邮件。
                </p>
                <p className="text-sm leading-6 text-slate-500">
                  请点击邮件中的链接完成验证，然后返回页面登录。
                </p>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
                <p className="mb-2 text-sm font-black text-amber-800">没有收到邮件？</p>
                <ul className="space-y-1 text-sm text-amber-700">
                  <li>检查垃圾邮件或广告邮件文件夹</li>
                  <li>确认邮箱地址拼写正确</li>
                  <li>等待 1-2 分钟后再试</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setView("signup")}
                  className="h-11 flex-1 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  换个邮箱
                </button>
                <button
                  type="button"
                  onClick={() => setView("login")}
                  className="gradient-brand h-11 flex-1 rounded-2xl text-sm font-black text-white"
                >
                  去登录
                </button>
              </div>
            </div>
          )}

          {view === "forgot-password" && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-700">注册邮箱</label>
                <div className="relative">
                  <Mail aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    inputMode="email"
                    spellCheck={false}
                    className="w-full rounded-2xl border border-[var(--codex-border)] bg-white px-4 py-3 pl-10 text-sm outline-none transition-all focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/15"
                    placeholder="you@example.com…"
                  />
                </div>
              </div>

              {error && (
                <div aria-live="polite" className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                  <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="gradient-brand flex h-12 w-full items-center justify-center rounded-2xl text-sm font-black text-white shadow-xl shadow-slate-300/40 transition-opacity hover:opacity-95 disabled:opacity-50"
              >
                {loading ? "发送中…" : "发送重置链接"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setView("login");
                  setError("");
                }}
                className="flex w-full items-center justify-center gap-1 text-sm font-bold text-slate-500 transition-colors hover:text-slate-800"
              >
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
                返回登录
              </button>
            </form>
          )}

          {view === "reset-sent" && (
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle aria-hidden="true" className="h-10 w-10 text-emerald-500" />
              </div>

              <div className="space-y-2">
                <p className="text-sm leading-6 text-slate-600">
                  密码重置链接已发送至 <span className="font-bold text-slate-900">{email}</span>
                </p>
                <p className="text-sm leading-6 text-slate-500">
                  请点击邮件中的链接设置新密码。
                </p>
              </div>

              <button
                type="button"
                onClick={() => setView("login")}
                className="gradient-brand h-12 w-full rounded-2xl text-sm font-black text-white transition-opacity hover:opacity-95"
              >
                返回登录
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
