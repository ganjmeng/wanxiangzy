"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { CheckCircle } from "lucide-react";
import {
  type AuthView,
  authViewCopy,
} from "@/features/login/auth-views";
import { getSafeAuthRedirectTarget, getNormalizedInviteCode } from "@/features/login/auth-redirect";
import { AuthHero } from "@/features/login/AuthHero";
import { LoginFormView } from "@/features/login/LoginFormView";
import { SignUpFormView } from "@/features/login/SignUpFormView";
import { CheckEmailView } from "@/features/login/CheckEmailView";
import { ForgotPasswordView } from "@/features/login/ForgotPasswordView";
import { ResetSentView } from "@/features/login/ResetSentView";

/**
 * 登录页（统一路由 /login）：login / signup / check-email / forgot-password / reset-sent 5 个视图。
 *
 * 所有视图都是受控组件，本页只持有状态 + 业务回调（API 调用、跳转、切换视图）。
 */
export default function LoginPage() {
  const supabase = useMemo(() => createClient(), []);
  const t = useTranslations("Login");

  const [view, setView] = useState<AuthView>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    let hadSensitiveQuery = false;
    for (const key of ["email", "password", "newPassword"]) {
      if (!url.searchParams.has(key)) continue;
      url.searchParams.delete(key);
      hadSensitiveQuery = true;
    }
    if (hadSensitiveQuery) {
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  // 邀请链接落地：/login?invite=CODE 预填邀请码并直接进入注册
  useEffect(() => {
    const code = getNormalizedInviteCode();
    if (!code) return;
    setInviteCode(code);
    setView("signup");
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (mounted && data.user) redirectAfterAuthentication();
      })
      .catch(() => undefined);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session && window.location.pathname === "/login") {
        redirectAfterAuthentication();
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
    setError(null);

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
        const message = typeof payload.error === "string" ? payload.error : t("errors.default");
        if (message.includes("Invalid login credentials")) {
          setError(t("errors.invalidCredentials"));
        } else if (message.includes("Email not confirmed")) {
          setError(t("errors.emailNotConfirmed"));
          setView("check-email");
        } else {
          setError(message);
        }
        return;
      }

      redirectAfterAuthentication();
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 6) {
      setError(t("errors.passwordMin"));
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
        const message = typeof payload.error === "string" ? payload.error : t("errors.default");
        if (message.includes("已注册")) {
          setError(t("errors.emailExists"));
          setView("login");
        } else {
          setError(message);
        }
        return;
      }

      if (payload.session) {
        redirectAfterAuthentication();
        return;
      }

      setView("check-email");
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

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

  const switchToView = (target: AuthView) => {
    setView(target);
    setError(null);
  };

  const copy = authViewCopy[view];

  return (
    <div className="min-h-[calc(100dvh-64px)] bg-[var(--codex-gradient-page)] px-4 py-8 text-codex-ink transition-colors sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100dvh-128px)] max-w-6xl items-start gap-8 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:pt-0">
        <AuthHero />

        <section className="studio-surface studio-surface-elevated mx-0 w-full max-w-[350px] rounded-3xl p-6 sm:mx-auto sm:max-w-[440px] sm:p-8">
          <div className="mb-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-codex-dark shadow-lg shadow-slate-300/70">
              <CheckCircle aria-hidden="true" className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-2xl font-black tracking-[-0.02em] text-codex-ink">{t(copy.titleKey)}</h2>
            <p className="mt-2 text-sm leading-6 text-codex-muted">
              {view === "check-email" && email ? `${t("checkEmailSent")} ${email}` : t(copy.descKey)}
            </p>
          </div>

          {view === "login" && (
            <div className="space-y-5">
              <LoginFormView
                email={email}
                password={password}
                showPassword={showPassword}
                loading={loading}
                error={error}
                onChangeEmail={setEmail}
                onChangePassword={setPassword}
                onToggleShowPassword={() => setShowPassword((value) => !value)}
                onSubmit={handleLogin}
                onForgotPassword={() => switchToView("forgot-password")}
                onCreateAccount={() => switchToView("signup")}
              />
            </div>
          )}

          {view === "signup" && (
            <div className="space-y-5">
              <SignUpFormView
                email={email}
                password={password}
                inviteCode={inviteCode}
                showPassword={showPassword}
                loading={loading}
                error={error}
                showInviteBanner={Boolean(inviteCode)}
                onChangeEmail={setEmail}
                onChangePassword={setPassword}
                onChangeInviteCode={setInviteCode}
                onToggleShowPassword={() => setShowPassword((value) => !value)}
                onSubmit={handleSignUp}
                onGoLogin={() => switchToView("login")}
              />
            </div>
          )}

          {view === "check-email" && (
            <CheckEmailView
              email={email}
              onChangeEmail={() => switchToView("signup")}
              onGoLogin={() => switchToView("login")}
            />
          )}

          {view === "forgot-password" && (
            <ForgotPasswordView
              email={email}
              loading={loading}
              error={error}
              onChangeEmail={setEmail}
              onSubmit={handleForgotPassword}
              onBackToLogin={() => switchToView("login")}
            />
          )}

          {view === "reset-sent" && (
            <ResetSentView email={email} onBackToLogin={() => switchToView("login")} />
          )}
        </section>
      </div>
    </div>
  );
}

function redirectAfterAuthentication() {
  // The session cookies were written by a Route Handler, while this page's
  // Supabase singleton was created before login. A document navigation makes
  // both Server Components and the browser client observe the new session and
  // avoids reusing an anonymous router cache entry.
  window.location.replace(getSafeAuthRedirectTarget());
}
