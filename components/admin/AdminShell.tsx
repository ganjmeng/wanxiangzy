"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
      { href: "/admin", label: "运营总览", icon: <DashboardOutlined /> },
      { href: "/admin/diagnostics", label: "异常诊断", icon: <AlertOutlined /> },
    ],
  },
  {
    key: "operations",
    label: "运营",
    children: [
      { href: "/admin/features", label: "功能管理", icon: <AppstoreOutlined /> },
      { href: "/admin/users", label: "用户账户", icon: <TeamOutlined /> },
      { href: "/admin/invite-codes", label: "邀请码", icon: <KeyOutlined /> },
      { href: "/admin/generations", label: "任务中心", icon: <ControlOutlined /> },
      { href: "/admin/support", label: "客服工单", icon: <FileProtectOutlined /> },
      { href: "/admin/requests", label: "审批中心", icon: <CheckCircleOutlined /> },
    ],
  },
  {
    key: "content",
    label: "内容",
    children: [
      { href: "/admin/assets", label: "资产作品", icon: <PictureOutlined /> },
      { href: "/admin/assets/lifecycle", label: "生命周期", icon: <DatabaseOutlined /> },
      { href: "/admin/moderation", label: "内容审核", icon: <SafetyCertificateOutlined /> },
      { href: "/admin/tryon", label: "试衣配置", icon: <AppstoreOutlined /> },
      { href: "/admin/prompts", label: "Prompt 实验", icon: <ExperimentOutlined /> },
    ],
  },
  {
    key: "finance",
    label: "财务",
    children: [
      { href: "/admin/credits", label: "灵点流水", icon: <DollarOutlined /> },
      { href: "/admin/billing", label: "支付账单", icon: <CreditCardOutlined /> },
      { href: "/admin/reports", label: "成本报表", icon: <BarChartOutlined /> },
      { href: "/admin/exports", label: "导出视图", icon: <DownloadOutlined /> },
      { href: "/admin/risk", label: "智能风控", icon: <AlertOutlined /> },
    ],
  },
  {
    key: "system",
    label: "系统",
    children: [
      { href: "/admin/evals", label: "回归评测", icon: <ExperimentOutlined /> },
      { href: "/admin/providers", label: "模型通道", icon: <ApiOutlined /> },
      { href: "/admin/workers", label: "任务队列", icon: <ToolOutlined /> },
      { href: "/admin/members", label: "成员权限", icon: <UserOutlined /> },
      { href: "/admin/settings", label: "系统配置", icon: <SettingOutlined /> },
      { href: "/admin/audit", label: "审计日志", icon: <AuditOutlined /> },
    ],
  },
];

export function AdminShell({ admin, children }: AdminShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const activeHref = mounted ? getActiveHref(pathname) : "";
  const selectedKeys = activeHref ? [activeHref] : [];
  const breadcrumbTitle = mounted ? currentTitle(pathname) : "Console";
  const routeKey = `${pathname}?${searchParams.toString()}`;
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
            <Link href={item.href} onClick={() => setDrawerOpen(false)}>
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
    setRouteLoading(false);
    setDrawerOpen(false);
  }, [routeKey]);

  useEffect(() => {
    if (!routeLoading) return;
    const timer = window.setTimeout(() => setRouteLoading(false), 12000);
    return () => window.clearTimeout(timer);
  }, [routeLoading]);

  function handleSubmit(event: React.FormEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const method = (form.method || "get").toLowerCase();
    if (method !== "get") return;
    const url = new URL(form.action || window.location.href, window.location.href);
    if (url.origin === window.location.origin && url.pathname.startsWith("/admin")) {
      setRouteLoading(true);
    }
  }

  return (
    <Layout className="admin-app-shell flex" onSubmit={handleSubmit}>
      <AdminRouteLoading active={routeLoading} />
      <Layout.Sider
        width={252}
        collapsedWidth={76}
        collapsible
        collapsed={collapsed}
        trigger={null}
        className={`admin-sider shrink-0 transition-[width] duration-200 ${collapsed ? "w-[76px]" : "w-[252px]"}`}
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
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <Button
              className="admin-mobile-trigger"
              type="text"
              icon={<MenuOutlined />}
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
            <Tag color="blue">{admin.role}</Tag>
          </Space>
        </Layout.Header>
        <Layout.Content className="admin-content">
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function AdminRouteLoading({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div className="admin-route-loading" role="status" aria-live="polite" aria-label="页面加载中">
      <div className="admin-route-loading-bar" />
      <div className="admin-route-loading-card">
        <Spin size="small" />
        <Typography.Text className="!text-xs !font-bold !text-slate-700">页面加载中</Typography.Text>
      </div>
    </div>
  );
}

function AdminBrand({ collapsed, compact = false }: { collapsed: boolean; compact?: boolean }) {
  return (
    <Link href="/admin" className={`admin-brand ${compact ? "admin-brand-compact" : ""}`}>
      <span className="admin-brand-mark">
        <SafetyCertificateOutlined />
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
      <Avatar size={collapsed ? 32 : 36} icon={<UserOutlined />} />
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
