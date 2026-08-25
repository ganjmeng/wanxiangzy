import type { ReactNode } from "react";
import {
  Activity,
  BadgeDollarSign,
  Banknote,
  Boxes,
  BrainCircuit,
  ClipboardCheck,
  CreditCard,
  FileClock,
  Images,
  KeyRound,
  LayoutDashboard,
  LibraryBig,
  ListChecks,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Users,
  UsersRound,
} from "lucide-react";
import type { AdminPermission, AdminRole } from "@/lib/admin/permissions";
import { hasAdminPermission } from "@/lib/admin/permissions";

export type AdminNavigationItem = {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
  permission: AdminPermission;
  badgeKey?: "requests";
};

export type AdminNavigationGroup = {
  key: string;
  label: string;
  children: AdminNavigationItem[];
};

export const ADMIN_NAVIGATION: AdminNavigationGroup[] = [
  {
    key: "overview",
    label: "工作台",
    children: [
      { href: "/admin", label: "运营总览", description: "业务指标、风险与待办", icon: <LayoutDashboard aria-hidden="true" />, permission: "admin:read" },
    ],
  },
  {
    key: "operations",
    label: "客户与运营",
    children: [
      { href: "/admin/users", label: "用户账户", description: "账户、状态与使用记录", icon: <Users aria-hidden="true" />, permission: "users:read" },
      { href: "/admin/generations", label: "任务中心", description: "生成任务与异常恢复", icon: <ListChecks aria-hidden="true" />, permission: "tasks:read" },
      { href: "/admin/requests", label: "审批中心", description: "高风险运营动作", icon: <ClipboardCheck aria-hidden="true" />, permission: "operation_requests:read", badgeKey: "requests" },
      { href: "/admin/invite-codes", label: "增长活动", description: "邀请码与邀请奖励", icon: <KeyRound aria-hidden="true" />, permission: "settings:read" },
    ],
  },
  {
    key: "content",
    label: "内容与风控",
    children: [
      { href: "/admin/assets", label: "资产库", description: "素材、结果与存储治理", icon: <Images aria-hidden="true" />, permission: "assets:read" },
      { href: "/admin/moderation", label: "审核记录", description: "处理历史、原因与证据链", icon: <ShieldCheck aria-hidden="true" />, permission: "moderation:read" },
      { href: "/admin/showcase", label: "展示内容", description: "前台示例与运营精选", icon: <LibraryBig aria-hidden="true" />, permission: "assets:read" },
    ],
  },
  {
    key: "commercial",
    label: "商业化",
    children: [
      { href: "/admin/billing", label: "定价与账单", description: "售价、扣点与支付履约", icon: <CreditCard aria-hidden="true" />, permission: "billing:read" },
      { href: "/admin/credits", label: "灵点账户", description: "流水、补偿与人工调整", icon: <Banknote aria-hidden="true" />, permission: "credits:read" },
    ],
  },
  {
    key: "product",
    label: "产品配置",
    children: [
      { href: "/admin/features", label: "功能目录", description: "功能状态与前台可见性", icon: <Boxes aria-hidden="true" />, permission: "settings:read" },
      { href: "/admin/tryon", label: "试衣内容", description: "分类、参考图与发布版本", icon: <Sparkles aria-hidden="true" />, permission: "settings:read" },
      { href: "/admin/product-retouch-skill", label: "商品精修规则", description: "精修运行版本与质量规则", icon: <BadgeDollarSign aria-hidden="true" />, permission: "prompts:read" },
      { href: "/admin/prompts", label: "提示词实验", description: "模板、实验与版本发布", icon: <BrainCircuit aria-hidden="true" />, permission: "prompts:read" },
    ],
  },
  {
    key: "platform",
    label: "平台治理",
    children: [
      { href: "/admin/providers", label: "模型与供应商", description: "模型目录、路由与容量", icon: <Activity aria-hidden="true" />, permission: "providers:read" },
      { href: "/admin/workers", label: "队列与容量", description: "Worker、BullMQ 与 Outbox", icon: <TerminalSquare aria-hidden="true" />, permission: "workers:read" },
      { href: "/admin/members", label: "成员与权限", description: "后台角色与访问控制", icon: <UsersRound aria-hidden="true" />, permission: "settings:read" },
      { href: "/admin/settings", label: "平台设置", description: "监控、SEO 与配置版本", icon: <Settings2 aria-hidden="true" />, permission: "settings:read" },
      { href: "/admin/audit", label: "审计日志", description: "写操作追踪与责任链", icon: <FileClock aria-hidden="true" />, permission: "audit:read" },
    ],
  },
];

export function getVisibleAdminNavigation(role: AdminRole) {
  return ADMIN_NAVIGATION
    .map((group) => ({
      ...group,
      children: group.children.filter((item) => hasAdminPermission(role, item.permission)),
    }))
    .filter((group) => group.children.length > 0);
}

export function getAdminNavigationItem(pathname: string) {
  const items = ADMIN_NAVIGATION.flatMap((group) => group.children);
  return items
    .filter((item) => item.href !== "/admin")
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    || items.find((item) => item.href === "/admin")!;
}
