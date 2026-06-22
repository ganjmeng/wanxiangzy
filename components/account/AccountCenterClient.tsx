"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  DatePicker,
  Empty,
  Form,
  Input,
  Select,
  Statistic,
  Table,
  Tag,
  Typography,
  theme as uiTheme,
  zhCN,
  type ColumnsType,
} from "@/components/ui/shadcn-compat";
import {
  Bell,
  ChevronDown,
  CircleHelp,
  Coins,
  CreditCard,
  KeyRound,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { codexTheme } from "@/lib/design/codex-theme";

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

type AccountTab = "account" | "api" | "rights" | "membership" | "orders" | "credits" | "apiUsage" | "help" | "distribution" | "messages" | "feedback";
type CreditDirection = "all" | "income" | "spend";
type CreditType = "all" | "recharge" | "generation" | "refund" | "manual" | "compensation" | "other";
type CreditSort = "newest" | "oldest" | "amount_desc" | "amount_asc";
type OrderStatus = "all" | "pending" | "processing" | "paid" | "failed" | "canceled" | "refunded" | "partially_refunded";
type OrderGrantStatus = "all" | "pending" | "granted" | "failed" | "skipped" | "refunded" | "reversed" | "partial";
type OrderMode = "all" | "payment" | "subscription";
type OrderSort = "newest" | "oldest" | "amount_desc" | "amount_asc" | "credits_desc" | "updated_desc";
type DateRangeValue = [{ format: (format: string) => string }, { format: (format: string) => string }];

type ProfilePayload = {
  user?: { id?: string | null; email?: string | null } | null;
  profile?: { displayName?: string | null; createdAt?: string | null; updatedAt?: string | null } | null;
  credits?: number | null;
  totalCreditsUsed?: number | null;
};

type PageInfo = {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
};

type CreditLog = {
  id: string;
  amount: number;
  balance: number;
  reason: string | null;
  generation_id: string | null;
  created_at: string;
  type?: CreditType;
};

type CreditSummary = {
  pageIncome: number;
  pageSpend: number;
  count: number;
};

type BillingOrder = {
  id: string;
  productId?: string;
  productName: string;
  priceId?: string;
  priceLabel: string;
  mode: string;
  status: string;
  currency: string;
  amountTotal: number;
  amountRefunded: number;
  amountNet?: number;
  creditsExpected: number;
  creditsGranted: number;
  creditGrantStatus: string;
  checkoutSessionId?: string;
  invoiceId?: string;
  createdAt: string;
  updatedAt: string;
};

type OrderSummary = {
  pageNetAmount: number;
  pageGrantedCredits: number;
  count: number;
};

type SupportTicket = {
  id: string;
  ticketNo: string;
  status: string;
  priority: string;
  category: string;
  categoryLabel: string;
  title: string;
  description: string;
  resolution: string;
  createdAt: string;
  updatedAt: string;
};

type CreditFilters = {
  product: string;
  feature: string;
  direction: CreditDirection;
  type: CreditType;
  consumeMode: string;
  q: string;
  from: string;
  to: string;
  sort: CreditSort;
};

type OrderFilters = {
  status: OrderStatus;
  creditGrantStatus: OrderGrantStatus;
  mode: OrderMode;
  q: string;
  from: string;
  to: string;
  sort: OrderSort;
};

type FeedbackForm = {
  category: string;
  title: string;
  description: string;
  contact: string;
};

const emptyProfile: ProfilePayload = { user: null, profile: null, credits: 0, totalCreditsUsed: 0 };
const defaultPageInfo: PageInfo = { hasMore: false, nextCursor: null, limit: 20 };
const defaultCreditFilters: CreditFilters = {
  product: "all",
  feature: "all",
  direction: "spend",
  type: "all",
  consumeMode: "all",
  q: "",
  from: "",
  to: "",
  sort: "newest",
};
const defaultOrderFilters: OrderFilters = {
  status: "all",
  creditGrantStatus: "all",
  mode: "all",
  q: "",
  from: "",
  to: "",
  sort: "newest",
};

const accountGroups: Array<{
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  children: Array<{ key: AccountTab; label: string; description?: string }>;
}> = [
  {
    key: "account",
    label: "个人账号",
    icon: UserRound,
    children: [
      { key: "account", label: "账号信息" },
      { key: "api", label: "API令牌" },
      { key: "rights", label: "权益中心" },
      { key: "membership", label: "会员中心" },
    ],
  },
  {
    key: "billing",
    label: "消费管理",
    icon: WalletCards,
    children: [
      { key: "orders", label: "订单管理" },
      { key: "credits", label: "灵点明细" },
      { key: "apiUsage", label: "API中心" },
    ],
  },
  { key: "help", label: "帮助中心", icon: CircleHelp, children: [{ key: "help", label: "帮助中心" }] },
  { key: "distribution", label: "分销中心", icon: Coins, children: [{ key: "distribution", label: "分销中心" }] },
  { key: "messages", label: "消息中心", icon: Mail, children: [{ key: "messages", label: "消息中心" }] },
  { key: "feedback", label: "客服反馈", icon: MessageSquare, children: [{ key: "feedback", label: "客服反馈" }] },
];

const creditTypeOptions: Array<{ value: CreditType; label: string }> = [
  { value: "all", label: "全部" },
  { value: "recharge", label: "充值到账" },
  { value: "generation", label: "生成扣费" },
  { value: "refund", label: "退款/退回" },
  { value: "manual", label: "人工调整" },
  { value: "compensation", label: "系统补偿" },
  { value: "other", label: "其他" },
];

const featureOptions = [
  { value: "all", label: "全部" },
  { value: "tryon", label: "服装上身" },
  { value: "pose", label: "姿势裂变" },
  { value: "model", label: "AI换模特" },
  { value: "image", label: "AI图片" },
];

const productOptions = [
  { value: "all", label: "全部" },
  { value: "vastweargen", label: "VastWearGen" },
];

const feedbackCategories = [
  { value: "billing", label: "充值支付" },
  { value: "credit_issue", label: "灵点异常" },
  { value: "generation_failure", label: "生成问题" },
  { value: "account", label: "账户问题" },
  { value: "technical", label: "功能异常" },
  { value: "other", label: "其他建议" },
];

const helpItems = [
  { title: "充值后没有到账怎么办？", body: "微信、支付宝等异步支付以 Stripe webhook 为准，通常几秒内入账。可在充值记录中查看订单和到账状态。" },
  { title: "灵点为什么会被扣除？", body: "确认生成后会扣除灵点，任务失败会自动退回。灵点明细会记录扣费、退款和人工补偿。" },
  { title: "如何联系客服？", body: "在客服反馈中提交问题，系统会生成工单，后台可按充值、灵点和生成问题优先处理。" },
];

export function AccountCenterClient() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<AccountTab>("account");
  const [profile, setProfile] = useState<ProfilePayload>(emptyProfile);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [creditLogs, setCreditLogs] = useState<CreditLog[]>([]);
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [creditFilters, setCreditFilters] = useState<CreditFilters>(defaultCreditFilters);
  const [orderFilters, setOrderFilters] = useState<OrderFilters>(defaultOrderFilters);
  const [creditPage, setCreditPage] = useState(1);
  const [creditPageSize, setCreditPageSize] = useState(20);
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [creditSummary, setCreditSummary] = useState<CreditSummary>({ pageIncome: 0, pageSpend: 0, count: 0 });
  const [orderSummary, setOrderSummary] = useState<OrderSummary>({ pageNetAmount: 0, pageGrantedCredits: 0, count: 0 });
  const [creditPageInfo, setCreditPageInfo] = useState<PageInfo>(defaultPageInfo);
  const [orderPageInfo, setOrderPageInfo] = useState<PageInfo>(defaultPageInfo);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [creditLoading, setCreditLoading] = useState(true);
  const [orderLoading, setOrderLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackForm>({ category: "billing", title: "", description: "", contact: "" });
  const [feedbackStatus, setFeedbackStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const loadCreditLogsRef = useRef(loadCreditLogs);
  const loadOrdersRef = useRef(loadOrders);

  useEffect(() => {
    loadCreditLogsRef.current = loadCreditLogs;
    loadOrdersRef.current = loadOrders;
  });

  useEffect(() => {
    const tab = searchParams.get("tab");
    setActiveTab(isAccountTab(tab) ? tab : "account");
  }, [searchParams]);

  useEffect(() => {
    void loadProfileAndTickets();
  }, []);

  useEffect(() => {
    void loadCreditLogsRef.current();
  }, [creditFilters, creditPage, creditPageSize]);

  useEffect(() => {
    void loadOrdersRef.current();
  }, [orderFilters, orderPage, orderPageSize]);

  const displayName = profile.profile?.displayName || profile.user?.email?.split("@")[0] || "VastWearGen用户";
  const maskedAccount = profile.user?.email ? maskAccountLabel(profile.user.email) : displayName;
  const userId = profile.user?.id || "--";
  const latestBalance = profile.credits ?? creditLogs[0]?.balance ?? 0;
  const totalUsed = profile.totalCreditsUsed ?? 0;
  const paidOrders = orders.filter((order) => order.status === "paid").length;
  const openTickets = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length;

  async function loadProfileAndTickets(options: { silent?: boolean } = {}) {
    if (options.silent) setRefreshing(true);
    else setLoadingProfile(true);
    setError(null);
    setTicketError(null);

    try {
      const [profileResult, ticketsResult] = await Promise.allSettled([
        fetchJson<ProfilePayload>("/api/profile"),
        fetchJson<{ tickets?: SupportTicket[] }>("/api/support/feedback"),
      ]);

      if (profileResult.status === "fulfilled") {
        setProfile(profileResult.value);
      } else if (profileResult.reason?.status === 401) {
        window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      } else {
        throw profileResult.reason;
      }

      if (ticketsResult.status === "fulfilled") {
        setTickets(Array.isArray(ticketsResult.value.tickets) ? ticketsResult.value.tickets : []);
      } else {
        setTicketError(ticketsResult.reason instanceof Error ? ticketsResult.reason.message : "客服记录加载失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "个人中心加载失败");
    } finally {
      setLoadingProfile(false);
      setRefreshing(false);
    }
  }

  async function loadCreditLogs() {
    setCreditLoading(true);
    setCreditError(null);
    try {
      const payload = await fetchJson<{ logs?: CreditLog[]; pageInfo?: PageInfo; summary?: CreditSummary }>(
        `/api/credits/logs?${buildCreditQuery(creditFilters, creditPage, creditPageSize)}`,
      );
      setCreditLogs(payload.logs || []);
      setCreditPageInfo(payload.pageInfo || defaultPageInfo);
      setCreditSummary(payload.summary || { pageIncome: 0, pageSpend: 0, count: payload.logs?.length || 0 });
    } catch (err) {
      setCreditError(err instanceof Error ? err.message : "灵点明细加载失败");
      setCreditLogs([]);
      setCreditPageInfo(defaultPageInfo);
    } finally {
      setCreditLoading(false);
    }
  }

  async function loadOrders() {
    setOrderLoading(true);
    setOrderError(null);
    try {
      const payload = await fetchJson<{ orders?: BillingOrder[]; pageInfo?: PageInfo; summary?: OrderSummary }>(
        `/api/billing/orders?${buildOrderQuery(orderFilters, orderPage, orderPageSize)}`,
      );
      setOrders(payload.orders || []);
      setOrderPageInfo(payload.pageInfo || defaultPageInfo);
      setOrderSummary(payload.summary || { pageNetAmount: 0, pageGrantedCredits: 0, count: payload.orders?.length || 0 });
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "充值记录加载失败");
      setOrders([]);
      setOrderPageInfo(defaultPageInfo);
    } finally {
      setOrderLoading(false);
    }
  }

  async function refreshAll() {
    setRefreshing(true);
    await Promise.all([loadProfileAndTickets({ silent: true }), loadCreditLogs(), loadOrders()]);
    setRefreshing(false);
  }

  function selectTab(tab: AccountTab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingFeedback(true);
    setFeedbackStatus(null);
    try {
      const response = await fetch("/api/support/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...feedback, pageUrl: window.location.href }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "反馈提交失败");
      setFeedback({ category: feedback.category, title: "", description: "", contact: "" });
      setFeedbackStatus({ type: "success", text: `已提交，工单号 ${data.ticket?.ticketNo || ""}`.trim() });
      await loadProfileAndTickets({ silent: true });
    } catch (err) {
      setFeedbackStatus({ type: "error", text: err instanceof Error ? err.message : "反馈提交失败" });
    } finally {
      setSubmittingFeedback(false);
    }
  }

  const activeTitle = getTabLabel(activeTab);

  return (
    <ConfigProvider
      locale={zhCN}
      getPopupContainer={(triggerNode) => triggerNode?.parentElement || document.body}
      theme={{
        algorithm: uiTheme.compactAlgorithm,
        token: {
          colorPrimary: codexTheme.colors.accent,
          colorInfo: "#1677ff",
          colorSuccess: "#0f8a5f",
          colorWarning: "#b56a00",
          colorError: "#e5484d",
          colorTextBase: "#111827",
          colorBgLayout: "#ffffff",
          borderRadius: 4,
          borderRadiusLG: 6,
          fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: 14,
          motion: false,
        },
        components: {
          Button: { borderRadius: 18, controlHeight: 34 },
          Card: { borderRadiusLG: 4, headerBg: "#ffffff" },
          DatePicker: { borderRadius: 4, controlHeight: 40 },
          Input: { borderRadius: 4, controlHeight: 40 },
          Select: { borderRadius: 4, controlHeight: 40 },
          Table: { headerBg: "#fafafa", rowHoverBg: "#fafafa", cellPaddingBlockSM: 13, cellPaddingInlineSM: 12 },
        },
      }}
    >
      <main className="min-h-screen bg-white px-4 py-6 text-slate-950 sm:px-6 lg:px-10">
        <div className="mx-auto grid w-full max-w-[1360px] gap-6 lg:grid-cols-[206px_minmax(0,1fr)] lg:items-start">
          <AccountSidebar activeTab={activeTab} onSelect={selectTab} />

          <section className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <Title level={3} className="!mb-0 !text-[22px] !font-semibold">
                  {activeTitle}
                </Title>
                <Text type="secondary">账户、消费、消息和服务状态集中在这里。</Text>
              </div>
              <Button icon={<RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />} onClick={() => void refreshAll()} loading={refreshing}>
                刷新
              </Button>
            </div>

            {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}

            {activeTab === "account" ? (
              <AccountInfoPanel
                displayName={displayName}
                maskedAccount={maskedAccount}
                userId={userId}
                email={profile.user?.email || ""}
                credits={latestBalance}
                totalUsed={totalUsed}
                paidOrders={paidOrders}
                openTickets={openTickets}
                loading={loadingProfile}
              />
            ) : null}

            {activeTab === "credits" ? (
              <CreditLogsPanel
                filters={creditFilters}
                logs={creditLogs}
                summary={creditSummary}
                pageInfo={creditPageInfo}
                page={creditPage}
                pageSize={creditPageSize}
                loading={creditLoading}
                error={creditError}
                onFiltersChange={(next) => {
                  setCreditPage(1);
                  setCreditFilters(next);
                }}
                onPageChange={(page, pageSize) => {
                  setCreditPage(page);
                  setCreditPageSize(pageSize);
                }}
              />
            ) : null}

            {activeTab === "orders" ? (
              <OrdersPanel
                filters={orderFilters}
                orders={orders}
                summary={orderSummary}
                pageInfo={orderPageInfo}
                page={orderPage}
                pageSize={orderPageSize}
                loading={orderLoading}
                error={orderError}
                onFiltersChange={(next) => {
                  setOrderPage(1);
                  setOrderFilters(next);
                }}
                onPageChange={(page, pageSize) => {
                  setOrderPage(page);
                  setOrderPageSize(pageSize);
                }}
              />
            ) : null}

            {activeTab === "help" ? <HelpPanel /> : null}
            {activeTab === "messages" ? <MessagesPanel orders={orders} tickets={tickets} ticketError={ticketError} /> : null}
            {activeTab === "feedback" ? (
              <FeedbackPanel
                feedback={feedback}
                status={feedbackStatus}
                submitting={submittingFeedback}
                onChange={setFeedback}
                onSubmit={submitFeedback}
              />
            ) : null}
            {["api", "rights", "membership", "apiUsage", "distribution"].includes(activeTab) ? (
              <ComingSoonPanel tab={activeTab} />
            ) : null}
          </section>
        </div>
      </main>
    </ConfigProvider>
  );
}

function AccountSidebar({ activeTab, onSelect }: { activeTab: AccountTab; onSelect: (tab: AccountTab) => void }) {
  return (
    <aside className="hidden w-[206px] shrink-0 lg:block">
      <nav className="sticky top-24 min-h-[720px] w-[206px] bg-[#f5f7ff] px-4 py-5" aria-label="个人中心模块">
        {accountGroups.map((group) => {
          const Icon = group.icon;
          const expanded = group.children.some((item) => item.key === activeTab);
          const single = group.children.length === 1 && group.children[0].key === group.key;
          return (
            <div key={group.key} className="border-b border-slate-200/80 py-2 last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(group.children[0].key)}
                className={cn(
                  "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] font-medium transition-colors",
                  expanded
                    ? "bg-white text-slate-950 shadow-sm ring-1 ring-[#d8e0ff]"
                    : "text-slate-500 hover:bg-white/70 hover:text-slate-900",
                )}
                aria-current={expanded && single ? "page" : undefined}
                aria-expanded={group.children.length > 1 ? expanded : undefined}
              >
                <Icon className={cn("h-4 w-4", expanded ? "text-[var(--codex-accent)]" : "text-slate-500")} />
                <span className="flex-1">{group.label}</span>
                {group.children.length > 1 ? <ChevronDown className={cn("h-4 w-4 text-slate-500 transition", expanded && "rotate-180 text-[var(--codex-accent)]")} /> : null}
              </button>
              {group.children.length > 1 && expanded ? (
                <div className="mt-2 space-y-1 pl-7">
                  {group.children.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onSelect(item.key)}
                      className={cn(
                        "relative flex h-8 w-full items-center rounded-md px-4 text-left text-sm transition-colors",
                        activeTab === item.key
                          ? "bg-zinc-100 font-medium text-zinc-900"
                          : "text-slate-500 hover:bg-white/70 hover:text-slate-900",
                      )}
                      aria-current={activeTab === item.key ? "page" : undefined}
                    >
                      {activeTab === item.key ? <span className="absolute left-2 h-3.5 w-0.5 rounded-full bg-[var(--codex-accent)]" /> : null}
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function AccountInfoPanel({
  displayName,
  maskedAccount,
  userId,
  email,
  credits,
  totalUsed,
  paidOrders,
  openTickets,
  loading,
}: {
  displayName: string;
  maskedAccount: string;
  userId: string;
  email: string;
  credits: number;
  totalUsed: number;
  paidOrders: number;
  openTickets: number;
  loading: boolean;
}) {
  if (loading) {
    return <Card loading className="min-h-[420px]" />;
  }

  return (
    <div>
      <AccountAssetCard displayName={displayName} maskedAccount={maskedAccount} credits={credits} />
      <div className="my-8 border-t border-slate-900" />
      <section>
        <h2 className="mb-6 border-l-4 border-[var(--codex-accent)] pl-3 text-lg font-semibold text-slate-950">账号信息</h2>
        <div className="divide-y divide-slate-200">
          <InfoLine label="用户ID" value={shortUserId(userId, 12)} />
          <InfoLine label="用户名" value={displayName} hint="用户名半年内仅支持修改一次 请谨慎修改哦" action="用户名修改" />
          <InfoLine label="手机号" value={maskedAccount.includes("@") ? "未绑定手机号" : maskedAccount} action="更改绑定" />
          <InfoLine label="邮箱" value={email || "当前未绑定，绑定后当你手机号不可用时，可通过邮箱验证更换手机号或者找回密码"} action={email ? "更改邮箱" : "绑定邮箱"} />
          <InfoLine label="密码" value="请设置密码，可通过登录账号+密码进行登录" action="设置密码" />
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <SmallMetric label="当前灵点" value={`${formatNumber(credits)} 灵点`} />
          <SmallMetric label="累计消耗" value={`${formatNumber(totalUsed)} 灵点`} />
          <SmallMetric label="已支付订单" value={`${formatNumber(paidOrders)} 笔`} />
          <SmallMetric label="客服状态" value={openTickets ? `${openTickets} 个待处理` : "暂无待处理反馈"} />
        </div>
      </section>
    </div>
  );
}

function AccountAssetCard({ displayName, maskedAccount, credits }: { displayName: string; maskedAccount: string; credits: number }) {
  return (
    <section className="rounded-xl bg-[#eef3f4] px-7 py-5">
      <div className="mb-4 flex items-center gap-3">
        <Avatar size={28} src="/logo.png" className="!bg-[#f9d66d]" />
        <span className="text-sm font-semibold">{maskedAccount || displayName}</span>
        <span className="tracking-[8px] text-white">••••••••</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_332px]">
        <div className="relative min-h-[128px] overflow-hidden rounded-xl bg-gradient-to-r from-[#edf4f4] to-[#dfe7e6] px-7 py-6">
          <div className="pointer-events-none absolute right-16 top-[-20px] h-28 w-28 rounded-full bg-white/45 blur-xl" />
          <p className="text-lg font-semibold">免费版</p>
          <div className="mt-16 flex flex-wrap gap-5 text-sm text-slate-600">
            <span>✓ 注册赠送200灵点</span>
            <span>✓ 仅体验版功能</span>
          </div>
          <Link href="/pricing" className="absolute bottom-6 right-8 rounded-md bg-[#4f5b60] px-8 py-2 text-sm font-semibold text-white">
            升级
          </Link>
        </div>
        <div className="min-h-[128px] rounded-xl bg-gradient-to-r from-[#303237] to-[#77797d] px-7 py-6 text-white">
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold">⌘ {formatNumber(credits)} 灵点</p>
            <span className="rounded-full border border-white/40 px-2 py-0.5 text-xs text-white/80">灵点规则</span>
          </div>
          <div className="mt-10 text-sm">
            <p className="font-semibold">锁定 0</p>
            <p className="mt-1 text-white/90">即将过期 0　明细 ›</p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Link href="/account?tab=credits" className="rounded-md bg-white/25 px-6 py-2 text-sm font-semibold text-white">
              兑换
            </Link>
            <Link href="/pricing" className="rounded-md bg-white/25 px-6 py-2 text-sm font-semibold text-white">
              购买
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function CreditLogsPanel({
  filters,
  logs,
  summary,
  pageInfo,
  page,
  pageSize,
  loading,
  error,
  onFiltersChange,
  onPageChange,
}: {
  filters: CreditFilters;
  logs: CreditLog[];
  summary: CreditSummary;
  pageInfo: PageInfo;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  onFiltersChange: (filters: CreditFilters) => void;
  onPageChange: (page: number, pageSize: number) => void;
}) {
  const [form] = Form.useForm<CreditFilters & { range?: DateRangeValue }>();
  const columns = useMemo<ColumnsType<CreditLog>>(
    () => [
      { title: "产品", width: 120, render: () => "VastWearGen" },
      { title: "功能", width: 170, render: (_, log) => featureLabel(log.reason) },
      { title: "消耗方式", width: 130, render: (_, log) => (log.amount < 0 ? "SAAS调用" : "充值入账") },
      { title: "时间", dataIndex: "created_at", width: 170, render: formatDateTime },
      { title: "收支", dataIndex: "amount", width: 100, align: "center", render: (value: number) => <span className={value < 0 ? "text-red-500" : "text-emerald-600"}>{value > 0 ? "+" : ""}{formatNumber(value)}</span> },
      { title: "任务ID", dataIndex: "generation_id", width: 140, render: (value: string | null, log) => shortUserId(value || log.id, 8) },
      { title: "类型", width: 120, render: (_, log) => creditTypeLabel((log.type || "other") as CreditType) },
      { title: "备注", dataIndex: "reason", ellipsis: true, render: (value: string | null) => value || "-" },
    ],
    [],
  );

  return (
    <section>
      {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ...filters, range: toRangeValue(filters) }}
        onFinish={(values) => {
          const [from, to] = dateRangeToStrings(values.range);
          onFiltersChange({
            ...filters,
            ...values,
            from,
            to,
            q: "",
          });
        }}
        className="mb-6 !block"
      >
        <div className="grid gap-x-6 gap-y-4 xl:grid-cols-3">
          <FilterItem label="产品" name="product"><Select options={productOptions} /></FilterItem>
          <FilterItem label="功能" name="feature"><Select options={featureOptions} /></FilterItem>
          <FilterItem label="收支类型" name="type"><Select options={creditTypeOptions} /></FilterItem>
          <FilterItem label="收支" name="direction">
            <Select options={[{ value: "all", label: "全部收支" }, { value: "income", label: "收入" }, { value: "spend", label: "支出" }]} />
          </FilterItem>
          <FilterItem label="时间" name="range"><RangePicker className="w-full" placeholder={["开始日期", "结束日期"]} /></FilterItem>
          <FilterItem label="消耗方式" name="consumeMode">
            <Select options={[{ value: "all", label: "全部" }, { value: "saas", label: "SAAS调用" }, { value: "stripe", label: "Stripe支付" }]} />
          </FilterItem>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button onClick={() => {
            form.resetFields();
            onFiltersChange(defaultCreditFilters);
          }}>
            重置
          </Button>
          <Button type="primary" htmlType="submit">
            查询
          </Button>
        </div>
      </Form>
      <Table<CreditLog>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={logs}
        loading={loading}
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          pageSize,
          total: summary.count,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (total, range) => `共${total}条，当前 ${range[0]}-${range[1]}`,
          onChange: onPageChange,
        }}
        locale={{ emptyText: <Empty description="暂无灵点明细" /> }}
      />
      <PageHint pageInfo={pageInfo} />
    </section>
  );
}

function OrdersPanel({
  filters,
  orders,
  summary,
  pageInfo,
  page,
  pageSize,
  loading,
  error,
  onFiltersChange,
  onPageChange,
}: {
  filters: OrderFilters;
  orders: BillingOrder[];
  summary: OrderSummary;
  pageInfo: PageInfo;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  onFiltersChange: (filters: OrderFilters) => void;
  onPageChange: (page: number, pageSize: number) => void;
}) {
  const [form] = Form.useForm<OrderFilters & { range?: DateRangeValue }>();
  const columns = useMemo<ColumnsType<BillingOrder>>(
    () => [
      { title: "订单ID", dataIndex: "id", width: 210, ellipsis: true },
      { title: "套餐类型", dataIndex: "mode", width: 120, render: (value: string) => (value === "subscription" ? "订阅套餐" : "灵点包") },
      { title: "套餐名称", dataIndex: "productName", width: 180, ellipsis: true },
      { title: "时间", dataIndex: "createdAt", width: 170, render: formatDateTime },
      { title: "状态", dataIndex: "status", width: 120, render: (value: string) => <StatusTag value={statusLabel(value)} status={value} /> },
      { title: "金额", width: 120, render: (_, order) => formatCny(order.amountNet ?? order.amountTotal - order.amountRefunded) },
      { title: "到账", width: 130, render: (_, order) => <Tag color={order.creditsExpected <= 0 ? "default" : order.creditGrantStatus === "granted" ? "blue" : "default"}>{order.creditsExpected <= 0 ? "测试不入账" : grantStatusLabel(order.creditGrantStatus)}</Tag> },
      { title: "操作", width: 110, render: (_, order) => <Link href={`/account?tab=orders&q=${encodeURIComponent(order.id)}`} className="text-[#1677ff]">详情</Link> },
    ],
    [],
  );

  return (
    <section>
      {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ...filters, range: toRangeValue(filters) }}
        onFinish={(values) => {
          const [from, to] = dateRangeToStrings(values.range);
          onFiltersChange({
            ...defaultOrderFilters,
            status: values.status || "all",
            mode: values.mode || "all",
            from,
            to,
          });
        }}
        className="mb-6 !block"
      >
        <div className="grid gap-x-6 gap-y-4 xl:grid-cols-3">
          <FilterItem label="支付时间" name="range"><RangePicker className="w-full" placeholder={["开始日期", "结束日期"]} /></FilterItem>
          <FilterItem label="状态" name="status">
            <Select options={[
              { value: "all", label: "全部" },
              { value: "pending", label: "待支付" },
              { value: "processing", label: "处理中" },
              { value: "paid", label: "已支付" },
              { value: "failed", label: "失败" },
              { value: "canceled", label: "已取消" },
              { value: "refunded", label: "已退款" },
            ]} />
          </FilterItem>
          <FilterItem label="产品" name="mode">
            <Select options={[{ value: "all", label: "全部" }, { value: "payment", label: "灵点包" }, { value: "subscription", label: "订阅" }]} />
          </FilterItem>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button onClick={() => {
            form.resetFields();
            onFiltersChange(defaultOrderFilters);
          }}>
            重置
          </Button>
          <Button type="primary" htmlType="submit">
            查询
          </Button>
        </div>
      </Form>
      <Table<BillingOrder>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={orders}
        loading={loading}
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          pageSize,
          total: summary.count,
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100],
          showTotal: (total, range) => `共${total}条，当前 ${range[0]}-${range[1]}`,
          onChange: onPageChange,
        }}
        locale={{ emptyText: <Empty description="你还没有购买过套餐" /> }}
      />
      <PageHint pageInfo={pageInfo} />
    </section>
  );
}

function HelpPanel() {
  return (
    <Panel title="帮助中心" description="常见问题与测试指引">
      <div className="space-y-3">
        {helpItems.map((item) => (
          <div key={item.title} className="rounded-md border border-slate-200 bg-white p-4">
            <p className="font-medium">{item.title}</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">{item.body}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MessagesPanel({ orders, tickets, ticketError }: { orders: BillingOrder[]; tickets: SupportTicket[]; ticketError: string | null }) {
  const messages = [
    ...orders.slice(0, 5).map((order) => ({
      id: `order-${order.id}`,
      title: `${order.productName} ${statusLabel(order.status)}`,
      text: `${formatDateTime(order.updatedAt)} · ${grantStatusLabel(order.creditGrantStatus)}`,
    })),
    ...tickets.slice(0, 5).map((ticket) => ({
      id: `ticket-${ticket.id}`,
      title: `${ticket.categoryLabel || "客服工单"}：${ticket.title}`,
      text: `${ticketStatusLabel(ticket.status)} · ${formatDateTime(ticket.updatedAt)}`,
    })),
  ];

  return (
    <Panel title="消息中心" description="订单和服务通知">
      {ticketError ? <Alert className="mb-4" type="warning" showIcon message={ticketError} /> : null}
      {messages.length ? (
        <div className="divide-y divide-slate-100">
          {messages.map((message) => (
            <div key={message.id} className="flex items-start gap-3 py-4">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-[var(--codex-accent)]">
                <Bell className="h-4 w-4" />
              </span>
              <div>
                <p className="font-medium">{message.title}</p>
                <p className="mt-1 text-sm text-slate-500">{message.text}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty description="暂无消息" />
      )}
    </Panel>
  );
}

function FeedbackPanel({
  feedback,
  status,
  submitting,
  onChange,
  onSubmit,
}: {
  feedback: FeedbackForm;
  status: { type: "success" | "error"; text: string } | null;
  submitting: boolean;
  onChange: (value: FeedbackForm) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Panel title="客服反馈" description="提交问题给运营后台">
      {status ? <Alert className="mb-4" type={status.type} showIcon message={status.text} /> : null}
      <form onSubmit={onSubmit} className="max-w-[760px] space-y-4">
        <FormLine required label="反馈类型">
          <Select value={feedback.category} options={feedbackCategories} onChange={(category) => onChange({ ...feedback, category })} />
        </FormLine>
        <FormLine required label="标题">
          <Input value={feedback.title} name="feedbackTitle" id="feedbackTitle" autoComplete="off" spellCheck={false} maxLength={80} placeholder="请输入标题…" onChange={(event) => onChange({ ...feedback, title: event.target.value })} />
        </FormLine>
        <FormLine required label="建议">
          <Input.TextArea value={feedback.description} name="feedbackDescription" id="feedbackDescription" autoComplete="off" spellCheck rows={5} maxLength={400} showCount placeholder="请输入…" onChange={(event) => onChange({ ...feedback, description: event.target.value })} />
        </FormLine>
        <FormLine label="联系方式">
          <Input value={feedback.contact} name="feedbackContact" id="feedbackContact" autoComplete="off" spellCheck={false} placeholder="微信 / 手机 / 邮箱…" onChange={(event) => onChange({ ...feedback, contact: event.target.value })} />
        </FormLine>
        <p className="text-sm text-orange-500">若您提出的建议被平台采纳，将会获得平台奖励的灵点</p>
        <Button type="primary" htmlType="submit" loading={submitting} icon={<Send className="h-3.5 w-3.5" aria-hidden="true" />}>
          提交
        </Button>
      </form>
    </Panel>
  );
}

function ComingSoonPanel({ tab }: { tab: AccountTab }) {
  const content: Record<string, { title: string; description: string; icon: React.ReactNode }> = {
    api: { title: "API令牌", description: "用于服务端调用的密钥管理会在这里开放。", icon: <KeyRound className="h-5 w-5" /> },
    rights: { title: "权益中心", description: "会员权益、团队权益和活动权益会集中展示。", icon: <ShieldCheck className="h-5 w-5" /> },
    membership: { title: "会员中心", description: "订阅套餐、会员权益和团队席位管理。", icon: <CreditCard className="h-5 w-5" /> },
    apiUsage: { title: "API中心", description: "按量计费、资源包和 API 调用统计。", icon: <WalletCards className="h-5 w-5" /> },
    distribution: { title: "分销中心", description: "邀请奖励、返佣记录和推广素材。", icon: <Coins className="h-5 w-5" /> },
  };
  const item = content[tab] || content.api;
  return (
    <Panel title={item.title} description={item.description}>
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-center">
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">{item.icon}</span>
        <p className="font-medium">模块已预留</p>
        <p className="mt-2 text-sm text-slate-500">当前版本先保留入口，后续可接入完整后台配置。</p>
      </div>
    </Panel>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card
      title={
        <div className="py-1">
          <div className="text-lg font-medium">{title}</div>
          <div className="mt-1 text-sm font-normal text-slate-500">{description}</div>
        </div>
      }
      className="border-slate-200"
    >
      {children}
    </Card>
  );
}

function FilterItem({ label, name, children }: { label: string; name: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[74px_minmax(0,1fr)] items-center gap-3">
      <label className="whitespace-nowrap text-sm font-medium text-slate-950">{label}:</label>
      <Form.Item name={name} noStyle>
        {children}
      </Form.Item>
    </div>
  );
}

function InfoLine({ label, value, hint, action }: { label: string; value: string; hint?: string; action?: string }) {
  return (
    <div className="grid gap-4 py-6 sm:grid-cols-[160px_minmax(0,1fr)_140px] sm:items-center">
      <div className="font-medium">{label}</div>
      <div className="min-w-0">
        <p className="break-words text-slate-700">{value || "-"}</p>
        {hint ? <p className="mt-1 text-sm text-slate-500">{hint}</p> : null}
      </div>
      {action ? <Button>{action}</Button> : <span />}
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
      <Statistic title={label} value={value} styles={{ content: { fontSize: 18, fontWeight: 600 } }} />
    </div>
  );
}

function FormLine({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid gap-3 sm:grid-cols-[90px_minmax(0,1fr)] sm:items-start">
      <span className="pt-2 font-medium">
        {required ? <span className="mr-1 text-red-500">*</span> : null}
        {label}：
      </span>
      <span>{children}</span>
    </label>
  );
}

function PageHint({ pageInfo }: { pageInfo: PageInfo }) {
  if (!pageInfo.hasMore) return null;
  return <p className="mt-2 text-right text-xs text-slate-400">还有更多记录，可继续翻页查看。</p>;
}

function StatusTag({ value, status }: { value: string; status: string }) {
  const color = status === "paid" || status === "granted" ? "blue" : status === "failed" || status === "canceled" ? "red" : status === "pending" || status === "processing" ? "orange" : "default";
  return <Tag color={color}>{value}</Tag>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "请求失败") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function buildCreditQuery(filters: CreditFilters, page: number, pageSize: number) {
  const q = filters.q || (filters.feature !== "all" ? filters.feature : "");
  const params = new URLSearchParams({ limit: String(pageSize), cursor: String((page - 1) * pageSize), sort: filters.sort });
  if (filters.direction !== "all") params.set("direction", filters.direction);
  if (filters.type !== "all") params.set("type", filters.type);
  if (q.trim()) params.set("q", q.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

function buildOrderQuery(filters: OrderFilters, page: number, pageSize: number) {
  const params = new URLSearchParams({ limit: String(pageSize), cursor: String((page - 1) * pageSize), sort: filters.sort });
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.creditGrantStatus !== "all") params.set("creditGrantStatus", filters.creditGrantStatus);
  if (filters.mode !== "all") params.set("mode", filters.mode);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

function isAccountTab(value: unknown): value is AccountTab {
  return typeof value === "string" && accountGroups.some((group) => group.children.some((item) => item.key === value));
}

function getTabLabel(tab: AccountTab) {
  return accountGroups.flatMap((group) => group.children).find((item) => item.key === tab)?.label || "个人中心";
}

function toRangeValue(filters: { from: string; to: string }) {
  return filters.from && filters.to ? [createDateValue(filters.from), createDateValue(filters.to)] as DateRangeValue : undefined;
}

function dateRangeToStrings(range?: DateRangeValue) {
  if (!range?.[0] || !range?.[1]) return ["", ""] as const;
  return [range[0].format("YYYY-MM-DD"), range[1].format("YYYY-MM-DD")] as const;
}

function createDateValue(value: string) {
  return {
    format: () => value,
  };
}

function featureLabel(reason?: string | null) {
  const text = reason || "";
  if (/pose|姿势/i.test(text)) return "姿势裂变";
  if (/model|模特/i.test(text)) return "AI换模特";
  if (/tryon|上身|服装/i.test(text)) return "服装上身";
  if (/gpt|image|图片/i.test(text)) return "AI图片";
  return "AI生成";
}

function creditTypeLabel(value: CreditType) {
  return creditTypeOptions.find((option) => option.value === value)?.label || "其他";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "待支付",
    processing: "处理中",
    paid: "已支付",
    failed: "失败",
    canceled: "已取消",
    refunded: "已退款",
    partially_refunded: "部分退款",
  };
  return labels[status] || status || "未知";
}

function grantStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "入账中",
    granted: "已到账",
    failed: "入账失败",
    skipped: "无需到账",
    refunded: "已退款",
    reversed: "已冲回",
    partial: "部分到账",
  };
  return labels[status] || status || "未同步";
}

function ticketStatusLabel(status: string) {
  const labels: Record<string, string> = {
    open: "待处理",
    pending: "处理中",
    in_progress: "处理中",
    resolved: "已解决",
    closed: "已关闭",
  };
  return labels[status] || status || "待处理";
}

function formatNumber(value: number) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatCny(value: number) {
  return `¥${(Number(value || 0) / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-");
}

function shortUserId(value: string, length = 8) {
  return value ? value.slice(0, length) : "-";
}

function maskAccountLabel(value: string) {
  const [name, domain] = value.split("@");
  if (!domain) return value.length > 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : value;
  return `${name.slice(0, 3)}****@${domain}`;
}
