"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, CircleDollarSign, Crown, Loader2, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type PricingMode = "credits" | "subscription";

type CreditPlan = {
  key: string;
  title: string;
  price: number;
  baseCredits: number;
  bonusCredits: number;
  savings?: number;
  featured?: boolean;
  enterpriseNote?: string;
};

const CREDIT_PLANS: CreditPlan[] = [
  { key: "starter", title: "入门版", price: 35, baseCredits: 250, bonusCredits: 0 },
  { key: "pro", title: "专业版", price: 140, baseCredits: 1000, bonusCredits: 200, savings: 17 },
  {
    key: "business",
    title: "企业版",
    price: 700,
    baseCredits: 5000,
    bonusCredits: 2000,
    savings: 29,
    featured: true,
  },
  {
    key: "premium",
    title: "豪华版",
    price: 3500,
    baseCredits: 25000,
    bonusCredits: 13000,
    savings: 34,
    enterpriseNote: "支持开通转灵点给子账号功能，提供专属产品支持群",
  },
];

type BillingCatalogProduct = {
  id?: string;
  tierKey?: string;
  prices?: BillingCatalogPrice[];
};

type BillingCatalogPrice = {
  id?: string;
  mode?: "payment" | "subscription";
  unitAmount?: number;
  credits?: number;
  currency?: string;
};

type BillingCatalogResponse = {
  products?: BillingCatalogProduct[];
  activeSubscription?: {
    id?: string;
    status?: string;
    current_period_end?: string;
    currentPeriodEnd?: string;
  } | null;
};

type CheckoutNotice = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  message: string;
};

const CREDIT_COSTS = {
  nanoBanana: 3,
  nanoBanana2: 4,
  nanoBananaPro: 5,
  gptImage2: 4,
  detailSet: 30,
};

const usageRules = [
  { value: "3 灵点/张", label: "Nano Banana 图片" },
  { value: "4 灵点/张", label: "Nano Banana 2 / GPT Image 2 图片" },
  { value: "5 灵点/张", label: "Nano Banana Pro 图片" },
  { value: "30 灵点/套", label: "详情页生成" },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.floor(value));
}

function getTotalCredits(plan: CreditPlan, mode: PricingMode) {
  const total = plan.baseCredits + plan.bonusCredits;
  return mode === "subscription" ? Math.floor(total * 1.05) : total;
}

function getCreditLine(plan: CreditPlan, mode: PricingMode) {
  if (mode === "subscription") {
    return <>{formatNumber(getTotalCredits(plan, mode))} 灵点</>;
  }

  if (plan.bonusCredits <= 0) {
    return <>{formatNumber(plan.baseCredits)} 灵点</>;
  }

  return (
    <>
      {formatNumber(plan.baseCredits)} 灵点
      <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600">
        + <Sparkles className="h-3 w-3" aria-hidden="true" /> 赠送{formatNumber(plan.bonusCredits)}灵点
      </span>
    </>
  );
}

function buildFeatures(plan: CreditPlan, mode: PricingMode) {
  const credits = getTotalCredits(plan, mode);

  return [
    { primary: true, content: getCreditLine(plan, mode) },
    { content: `${formatNumber(credits / CREDIT_COSTS.nanoBanana2)} 张 Nano Banana 2 图片` },
    { content: `${formatNumber(credits / CREDIT_COSTS.nanoBananaPro)} 张 Nano Banana Pro 图片` },
    { content: `${formatNumber(credits / CREDIT_COSTS.gptImage2)} 张 GPT Image 2 图片` },
    { content: `${formatNumber(credits / CREDIT_COSTS.nanoBanana)} 张 Nano Banana 图片` },
    { content: `${formatNumber(credits / CREDIT_COSTS.detailSet)} 套详情页` },
    { content: mode === "subscription" ? "每月自动到账，随时使用" : "不过期，随时使用" },
    { content: mode === "subscription" ? "支持随时取消订阅" : "一次购买，长期有效" },
  ];
}

export function PricingSection() {
  const router = useRouter();
  const [mode, setMode] = useState<PricingMode>("credits");
  const [catalog, setCatalog] = useState<BillingCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [checkoutPriceId, setCheckoutPriceId] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [notice, setNotice] = useState<CheckoutNotice | null>(null);
  const plans = useMemo(() => CREDIT_PLANS, []);
  const priceMap = useMemo(() => buildPriceMap(catalog), [catalog]);
  const activeSubscription = catalog?.activeSubscription || null;

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError("");

    try {
      const response = await fetch("/api/billing/catalog", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as BillingCatalogResponse & { error?: string };
      if (response.status === 401) {
        router.replace("/login?next=/pricing");
        return;
      }
      if (!response.ok) throw new Error(payload.error || `价格目录加载失败 (${response.status})`);
      setCatalog(payload);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "价格目录加载失败");
    } finally {
      setCatalogLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = (params.get("checkout") || "").toLowerCase();
    const sessionId = params.get("session_id") || params.get("sessionId");

    if (checkout === "cancelled" || checkout === "canceled") {
      setNotice({
        tone: "warning",
        title: "支付已取消",
        message: "你可以重新选择套餐继续支付。",
      });
      return;
    }

    if (!sessionId) return;
    setNotice({
      tone: "info",
      title: "正在确认订单",
      message: "支付已返回，正在同步灵点到账状态。",
    });

    fetch(`/api/billing/orders/session/${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "订单状态查询失败");
        const order = payload.order || {};
        const paid = order.status === "paid" || order.credit_grant_status === "granted";
        const creditsExpected = Number(order.credits_expected || 0);
        const creditsGranted = Number(order.credits_granted || 0);
        const testGrantDisabled = paid && creditsExpected <= 0 && creditsGranted <= 0;
        setNotice({
          tone: paid ? "success" : "info",
          title: paid ? "支付成功" : "支付确认中",
          message: testGrantDisabled
            ? "测试支付已完成，当前 Stripe 测试订单不会自动入账灵点。"
            : paid
              ? `灵点已同步到账：${Number(order.credits_granted || order.credits_expected || 0).toLocaleString("zh-CN")} 灵点。`
            : "Stripe 已返回，灵点同步仍在处理中，稍后刷新即可查看。",
        });
        void loadCatalog();
      })
      .catch((error) => {
        setNotice({
          tone: "danger",
          title: "订单状态查询失败",
          message: error instanceof Error ? error.message : "请稍后刷新重试。",
        });
      });
  }, [loadCatalog]);

  async function startCheckout(plan: CreditPlan) {
    const billingMode = mode === "subscription" ? "subscription" : "payment";
    const price = priceMap.get(`${plan.key}:${billingMode}`);
    const priceId = price?.id || fallbackPriceId(plan.key, billingMode);

    if (!priceId) {
      setNotice({
        tone: "danger",
        title: "套餐未配置",
        message: "后台还没有为该套餐配置价格，请先在账单后台同步价格。",
      });
      return;
    }

    setCheckoutPriceId(priceId);
    setNotice(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        router.replace("/login?next=/pricing");
        return;
      }
      if (!response.ok) throw new Error(payload.error || `创建支付会话失败 (${response.status})`);
      if (typeof payload.url !== "string" || !payload.url) throw new Error("Stripe Checkout URL 创建失败");
      window.location.assign(payload.url);
    } catch (error) {
      setNotice({
        tone: "danger",
        title: "无法创建支付会话",
        message: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setCheckoutPriceId(null);
    }
  }

  async function openBillingPortal() {
    setPortalLoading(true);
    setNotice(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        router.replace("/login?next=/pricing");
        return;
      }
      if (!response.ok) throw new Error(payload.error || `无法打开订阅管理 (${response.status})`);
      if (typeof payload.url !== "string" || !payload.url) throw new Error("订阅管理缺少跳转地址");
      window.location.assign(payload.url);
    } catch (error) {
      setNotice({
        tone: "danger",
        title: "无法打开订阅管理",
        message: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <section className="min-h-screen bg-background px-4 py-16 sm:px-6" aria-labelledby="pricing-title">
      <div className="mx-auto max-w-7xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-black uppercase tracking-widest text-[#9a5a00]">AI 电商视觉灵点</p>
          <h1 id="pricing-title" className="mb-4 text-[44px] font-semibold tracking-[-0.02em] text-[var(--codex-ink)] sm:text-[56px]" style={{ textWrap: "balance" }}>
            赋能您的电商视觉
          </h1>
          <p className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-x-1 text-[17px] font-normal leading-relaxed text-[var(--codex-muted)]">
            <span>已服务</span>
            <span className="text-[22px] font-semibold leading-none text-[var(--codex-ink)]">50000+</span>
            <span>电商商家，主图点击率平均提升 25%</span>
          </p>
        </div>

        <div className="mx-auto mb-12 grid h-12 w-full max-w-sm grid-cols-2 rounded-2xl border border-[var(--codex-border)] bg-[var(--codex-glass-fill)] p-1 backdrop-blur-md">
          <button
            type="button"
            aria-pressed={mode === "credits"}
            onClick={() => setMode("credits")}
            className={cn(
              "group order-1 inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold text-[var(--codex-muted)] transition-[background-color,color,box-shadow] duration-150",
              mode === "credits" && "bg-background text-[var(--codex-ink)] shadow-[var(--codex-shadow-apple)]"
            )}
          >
            <Zap className="h-4 w-4" aria-hidden="true" />
            <span>购买灵点</span>
            <span
              className={cn(
                "ml-1 inline-flex items-center gap-1.5 border-l border-[var(--codex-border)] pl-2 transition-opacity",
                mode === "credits" ? "opacity-95" : "opacity-60"
              )}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#1677ff] text-[10px] font-black text-white">支</span>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#2aae67] text-[10px] font-black text-white">微</span>
            </span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "subscription"}
            onClick={() => setMode("subscription")}
            className={cn(
              "order-2 inline-flex items-center justify-center rounded-xl text-[13px] font-semibold text-[var(--codex-muted)] transition-[background-color,color,box-shadow] duration-150",
              mode === "subscription" && "bg-background text-[var(--codex-ink)] shadow-[var(--codex-shadow-apple)]"
            )}
          >
            <Crown className="mr-2 h-4 w-4" aria-hidden="true" />
            订阅套餐
            <span className="ml-1 text-[#9a5a00]">+5%</span>
          </button>
        </div>

        {(notice || catalogError || activeSubscription) && (
          <div className="mx-auto mb-8 max-w-3xl space-y-3">
            {notice && <NoticeCard notice={notice} />}
            {catalogError && (
              <NoticeCard
                notice={{
                  tone: "danger",
                  title: "价格目录加载失败",
                  message: catalogError,
                }}
              />
            )}
            {activeSubscription && (
              <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black text-emerald-800">当前已有活跃订阅</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    可进入 Stripe 客户门户查看发票、更新付款方式或取消续订。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openBillingPortal}
                  disabled={portalLoading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--codex-success)] px-4 text-xs font-bold text-white hover:bg-[var(--codex-success)]/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {portalLoading && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  管理订阅
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.title}
              plan={plan}
              mode={mode}
              loading={catalogLoading || checkoutPriceId === priceMap.get(`${plan.key}:${mode === "subscription" ? "subscription" : "payment"}`)?.id}
              disabled={Boolean(catalogError)}
              onSelect={() => void startCheckout(plan)}
            />
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[280px_1fr] lg:items-center">
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-amber-700">灵点消耗</p>
              <h2 className="text-xl font-black tracking-tight text-zinc-900">先按参考规则上线，后续再优化</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {usageRules.map((rule) => (
                <div key={rule.value} className="rounded-xl bg-zinc-50 p-4">
                  <p className="mb-2 text-lg font-black text-zinc-900">{rule.value}</p>
                  <p className="text-xs font-medium leading-relaxed text-zinc-500">{rule.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  mode,
  loading,
  disabled,
  onSelect,
}: {
  plan: CreditPlan;
  mode: PricingMode;
  loading: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const features = buildFeatures(plan, mode);

  return (
    <article
      className={cn(
        "relative flex min-h-[534px] flex-col rounded-2xl border p-6 transition-[box-shadow,border-color,transform] duration-200 backdrop-blur-xl backdrop-saturate-150",
        plan.featured
          ? "border-[var(--codex-accent)]/40 bg-card/95 shadow-[var(--codex-shadow-apple-lg)] ring-2 ring-[var(--codex-accent)]/30"
          : "border-[var(--codex-border)] bg-card/90 shadow-[var(--codex-shadow-apple)]"
      )}
    >
      {plan.featured ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-[var(--codex-accent)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
            最受欢迎
          </span>
        </div>
      ) : null}

      <div className="mb-4 mt-2 flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            plan.featured
              ? "bg-[var(--codex-accent)] text-white"
              : "bg-[var(--codex-glass-fill)] text-[var(--codex-muted)]"
          )}
        >
          <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
        </div>
        <h3 className="flex-1 text-xl font-semibold text-[var(--codex-ink)]">{plan.title}</h3>
        {plan.savings ? (
          <span className="ml-auto inline-flex h-14 w-14 shrink-0 rotate-[-12deg] flex-col items-center justify-center rounded-full border-2 border-dashed border-amber-300 bg-amber-50 text-amber-700">
            <span className="text-[10px] font-bold leading-none">立省</span>
            <span className="text-base font-black leading-tight">{plan.savings}%</span>
          </span>
        ) : null}
      </div>

      <div className="mb-6 flex items-baseline gap-1">
        <span className="text-[36px] font-semibold tracking-[-0.02em] text-[var(--codex-ink)]">¥{formatNumber(plan.price)}</span>
        {mode === "subscription" ? <span className="text-sm font-normal text-[var(--codex-muted)]">/连续包月</span> : null}
      </div>

      <ul className="mb-8 flex-1 space-y-3">
        {features.map((feature, index) => (
          <li key={index} className="flex items-center gap-2 text-[var(--codex-ink)]">
            <Check className={cn("h-4 w-4 shrink-0", feature.primary ? "text-[var(--codex-accent)]" : "text-[var(--codex-faint)]")} aria-hidden="true" />
            <span className={cn(feature.primary ? "text-[14px] font-semibold" : "text-[14px] font-normal text-[var(--codex-muted)]")}>{feature.content}</span>
          </li>
        ))}
      </ul>

      {plan.enterpriseNote ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#ffe5b4] bg-[#fff8eb] px-2.5 py-1.5 text-[#9a5a00]">
          <Crown className="h-3.5 w-3.5 shrink-0 text-[#f59e0b]" aria-hidden="true" />
          <span className="text-xs font-semibold">{plan.enterpriseNote}</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSelect}
        disabled={loading || disabled}
        className={cn(
          "inline-flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
          plan.featured
            ? "bg-[var(--codex-accent)] text-white shadow-[var(--codex-shadow-apple)] hover:bg-[var(--codex-accent-hover)]"
            : "border border-[var(--codex-border)] bg-[var(--codex-glass-fill)] text-[var(--codex-ink)] hover:bg-[var(--codex-glass-fill-strong)]"
        )}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {mode === "subscription" ? "开通订阅" : "立即购买"}
      </button>
    </article>
  );
}

function NoticeCard({ notice }: { notice: CheckoutNotice }) {
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border p-4", noticeToneClass(notice.tone))}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm font-black">{notice.title}</p>
        <p className="mt-1 text-xs font-semibold leading-5">{notice.message}</p>
      </div>
    </div>
  );
}

function noticeToneClass(tone: CheckoutNotice["tone"]) {
  if (tone === "success") return "border-emerald-100 bg-emerald-50 text-emerald-800";
  if (tone === "warning") return "border-amber-100 bg-amber-50 text-amber-800";
  if (tone === "danger") return "border-red-100 bg-red-50 text-red-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-800";
}

function buildPriceMap(catalog: BillingCatalogResponse | null) {
  const map = new Map<string, BillingCatalogPrice>();
  for (const product of catalog?.products || []) {
    const tierKey = product.tierKey;
    if (!tierKey) continue;
    for (const price of product.prices || []) {
      if (!price.mode) continue;
      map.set(`${tierKey}:${price.mode}`, price);
    }
  }
  return map;
}

function fallbackPriceId(planKey: string, mode: "payment" | "subscription") {
  return `price_${planKey}_${mode === "subscription" ? "monthly" : "once"}`;
}
