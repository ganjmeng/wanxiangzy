"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertOutlined,
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ControlOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DollarOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  FileProtectOutlined,
  KeyOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  PictureOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
} from "@/components/ui/ant-icons-compat";
import { Avatar, Breadcrumb, Button, Drawer, Layout, Menu, Space, Spin, Tag, Typography, type MenuProps } from "@/components/ui/shadcn-compat";
import type { AdminRole } from "@/lib/admin/permissions";

type AdminShellProps = {
  admin: {
    email: string | null;
    role: AdminRole;
    source: "table" | "bootstrap-env";
  };
  children: React.ReactNode;
};

type AdminNavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const navGroups: Array<{ key: string; label: string; children: AdminNavItem[] }> = [
  {
    key: "overview",
    label: "总览",
    children: [
      { href: "/admin", label: "运营总览", icon: <DashboardOutlined aria-hidden="true" /> },
      { href: "/admin/diagnostics", label: "异常诊断", icon: <AlertOutlined aria-hidden="true" /> },
    ],
  },
  {
    key: "operations",
    label: "运营",
    children: [
      { href: "/admin/features", label: "功能管理", icon: <AppstoreOutlined aria-hidden="true" /> },
      { href: "/admin/users", label: "用户账户", icon: <TeamOutlined aria-hidden="true" /> },
      { href: "/admin/invite-codes", label: "邀请码", icon: <KeyOutlined aria-hidden="true" /> },
      { href: "/admin/generations", label: "任务中心", icon: <ControlOutlined aria-hidden="true" /> },
      { href: "/admin/support", label: "客服工单", icon: <FileProtectOutlined aria-hidden="true" /> },
      { href: "/admin/requests", label: "审批中心", icon: <CheckCircleOutlined aria-hidden="true" /> },
    ],
  },
  {
    key: "content",
    label: "内容",
    children: [
      { href: "/admin/assets", label: "资产作品", icon: <PictureOutlined aria-hidden="true" /> },
      { href: "/admin/assets/lifecycle", label: "生命周期", icon: <DatabaseOutlined aria-hidden="true" /> },
      { href: "/admin/moderation", label: "内容审核", icon: <SafetyCertificateOutlined aria-hidden="true" /> },
      { href: "/admin/tryon", label: "试衣配置", icon: <AppstoreOutlined aria-hidden="true" /> },
      { href: "/admin/prompts", label: "Prompt 实验", icon: <ExperimentOutlined aria-hidden="true" /> },
    ],
  },
  {
    key: "finance",
    label: "财务",
    children: [
      { href: "/admin/credits", label: "灵点流水", icon: <DollarOutlined aria-hidden="true" /> },
      { href: "/admin/billing", label: "支付账单", icon: <CreditCardOutlined aria-hidden="true" /> },
      { href: "/admin/reports", label: "成本报表", icon: <BarChartOutlined aria-hidden="true" /> },
      { href: "/admin/exports", label: "导出视图", icon: <DownloadOutlined aria-hidden="true" /> },
      { href: "/admin/risk", label: "智能风控", icon: <AlertOutlined aria-hidden="true" /> },
    ],
  },
  {
    key: "system",
    label: "系统",
    children: [
      { href: "/admin/evals", label: "回归评测", icon: <ExperimentOutlined aria-hidden="true" /> },
      { href: "/admin/providers", label: "模型通道", icon: <ApiOutlined aria-hidden="true" /> },
      { href: "/admin/workers", label: "任务队列", icon: <ToolOutlined aria-hidden="true" /> },
      { href: "/admin/members", label: "成员权限", icon: <UserOutlined aria-hidden="true" /> },
      { href: "/admin/settings", label: "系统配置", icon: <SettingOutlined aria-hidden="true" /> },
      { href: "/admin/audit", label: "审计日志", icon: <AuditOutlined aria-hidden="true" /> },
    ],
  },
];

export function AdminShell({ admin, children }: AdminShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [formPending, setFormPending] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const activeHref = mounted ? getActiveHref(pathname) : "";
  const selectedKeys = activeHref ? [activeHref] : [];
  const breadcrumbTitle = mounted ? currentTitle(pathname) : "Console";
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const lastRouteKeyRef = useRef(routeKey);
  const openKeys = useMemo(() => navGroups.filter((group) => group.children.some((item) => item.href === activeHref)).map((group) => group.key), [activeHref]);
  const menuItems = useMemo<MenuProps["items"]>(
    () =>
      navGroups.map((group) => ({
        key: group.key,
        label: group.label,
        type: "group" as const,
        children: group.children.map((item) => ({
          key: item.href,
          icon: item.icon,
          label: (
            <Link
              href={item.href}
              onClick={(event) => {
                // 普通 Link 走 RSC 软导航,无需切换 formPending;
                // 但若用户用 modifier 键想新开页签,保持默认行为。
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                setDrawerOpen(false);
              }}
            >
              {item.label}
            </Link>
          ),
        })),
      })),
    [],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (lastRouteKeyRef.current !== routeKey) {
      lastRouteKeyRef.current = routeKey;
      setDrawerOpen(false);
      setFormPending(false);
    }
  }, [routeKey]);

  function handleSubmit(event: React.FormEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const method = (form.method || "get").toLowerCase();
    if (method !== "get") return;
    const url = new URL(form.action || window.location.href, window.location.href);
    if (url.origin === window.location.origin && url.pathname.startsWith("/admin")) {
      startTransition(() => {
        setFormPending(true);
      });
    }
  }

  const routeLoading = isPending || formPending;
  const loadingId = useId();

  return (
    <Layout className="admin-app-shell flex" onSubmit={handleSubmit}>
      <AdminRouteLoading active={routeLoading} id={loadingId} />
      <Layout.Sider
        width={252}
        collapsedWidth={76}
        collapsible
        collapsed={collapsed}
        trigger={null}
        className={`admin-sider shrink-0 motion-safe:transition-[width] motion-safe:duration-200 ${collapsed ? "w-[76px]" : "w-[252px]"}`}
      >
        <AdminBrand collapsed={collapsed} />
        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          openKeys={mounted ? openKeys : []}
          items={menuItems}
          className="admin-side-menu"
        />
        <AdminAccount admin={admin} collapsed={collapsed} />
      </Layout.Sider>

      <Drawer
        title={<AdminBrand collapsed={false} compact />}
        placement="left"
        size={292}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        className="admin-mobile-drawer"
        ariaLabel="后台导航菜单"
      >
        <Menu mode="inline" selectedKeys={selectedKeys} openKeys={mounted ? openKeys : []} items={menuItems} />
        <div className="mt-4">
          <AdminAccount admin={admin} collapsed={false} />
        </div>
      </Drawer>

      <Layout className="min-w-0 flex-1 flex-col">
        <Layout.Header className="admin-topbar">
          <Space className="min-w-0" size={12}>
            <Button
              className="admin-desktop-trigger"
              type="text"
              aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
              icon={collapsed ? <MenuUnfoldOutlined aria-hidden="true" /> : <MenuFoldOutlined aria-hidden="true" />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <Button
              className="admin-mobile-trigger"
              type="text"
              aria-label="打开导航菜单"
              icon={<MenuOutlined aria-hidden="true" />}
              onClick={() => setDrawerOpen(true)}
            />
            <Breadcrumb
              items={[
                { title: "产品管理后台" },
                { title: breadcrumbTitle },
              ]}
            />
          </Space>
          <Space size={8}>
            {admin.source === "bootstrap-env" && <Tag color="gold">Bootstrap</Tag>}
            <Tag color="default">{admin.role}</Tag>
          </Space>
        </Layout.Header>
        <Layout.Content className="admin-content">
          <div role="main" className="contents">
            {children}
          </div>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function AdminRouteLoading({ active, id }: { active: boolean; id?: string }) {
  if (!active) {
    // 始终在 DOM 中保留 polite region,屏幕阅读器才能感知到后续状态变化
    return <span id={id} className="sr-only" role="status" aria-live="polite" />;
  }
  return (
    <>
      <div
        className="admin-route-loading"
        aria-hidden="true"
      >
        <div className="admin-route-loading-bar motion-safe:animate-pulse" />
        <div className="admin-route-loading-card">
          <Spin size="small" />
          <Typography.Text className="!text-xs !font-bold !text-slate-700">页面加载中…</Typography.Text>
        </div>
      </div>
      <span id={id} className="sr-only" role="status" aria-live="polite">页面加载中</span>
    </>
  );
}

function AdminBrand({ collapsed, compact = false }: { collapsed: boolean; compact?: boolean }) {
  return (
    <Link href="/admin" className={`admin-brand ${compact ? "admin-brand-compact" : ""}`}>
      <span className="admin-brand-mark">
        <SafetyCertificateOutlined aria-hidden="true" />
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <Typography.Text strong className="block !text-slate-950">
            产品管理后台
          </Typography.Text>
          <Typography.Text type="secondary" className="block truncate !text-xs">
            VastWearGen Console
          </Typography.Text>
        </span>
      )}
    </Link>
  );
}

function AdminAccount({ admin, collapsed }: { admin: AdminShellProps["admin"]; collapsed: boolean }) {
  return (
    <div className="admin-account">
      <Avatar size={collapsed ? 32 : 36} icon={<UserOutlined aria-hidden="true" />} />
      {!collapsed && (
        <div className="min-w-0">
          <Typography.Text strong className="block truncate">
            {admin.role}
          </Typography.Text>
          <Typography.Text type="secondary" className="block truncate !text-xs">
            {admin.email || "no email"}
          </Typography.Text>
        </div>
      )}
    </div>
  );
}

function getActiveHref(pathname: string) {
  const allItems = navGroups.flatMap((group) => group.children);
  return (
    allItems
      .filter((item) => item.href !== "/admin")
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.href || "/admin"
  );
}

function currentTitle(pathname: string) {
  return navGroups.flatMap((group) => group.children).find((item) => item.href === getActiveHref(pathname))?.label || "总览";
}
