import { FEATURE_ITEMS, type AppModuleKey } from "@/lib/navigation";
import { getAdminClient } from "@/lib/supabase/admin";

export const ADMIN_FEATURES_CONFIG_KEY = "features.registry";

export type AdminFeatureStatus = "active" | "disabled" | "archived";

export type AdminFeatureConfig = {
  key: string;
  label: string;
  module: AppModuleKey;
  href: string;
  description: string;
  enabled: boolean;
  navVisible: boolean;
  defaultModel: string;
  creditPolicy: string;
  adminHref: string;
  status: AdminFeatureStatus;
  notes: string;
  updatedAt: string | null;
};

export type AdminFeatureRegistry = {
  configKey: typeof ADMIN_FEATURES_CONFIG_KEY;
  activeVersionId: string | null;
  activeVersionStatus: string | null;
  features: AdminFeatureConfig[];
  warnings: string[];
};

type StoredFeatureRegistry = {
  features?: unknown;
};

const moduleAdminHref: Record<AppModuleKey, string> = {
  home: "/admin",
  aiShoots: "/admin/generations",
  productImages: "/admin/product-retouch-skill",
  assistant: "/admin",
  canvas: "/admin/generations",
  tools: "/admin/generations",
  toolbox: "/admin/generations",
  enterprise: "/admin/billing",
  aiVideo: "/admin/generations",
  works: "/admin/assets",
};

export function buildDefaultAdminFeatureConfigs(): AdminFeatureConfig[] {
  return FEATURE_ITEMS
    .filter((item) => item.key !== "home")
    .map((item) => ({
      key: item.key,
      label: item.label,
      module: item.module,
      href: item.href,
      description: item.description,
      enabled: item.comingSoon !== true,
      navVisible: item.hiddenFromNav !== true && item.comingSoon !== true,
      defaultModel: "",
      creditPolicy: "",
      adminHref: moduleAdminHref[item.module] || "/admin/generations",
      status: item.comingSoon === true ? "disabled" : "active",
      notes: "",
      updatedAt: null,
    }));
}

export function parseAdminFeatureConfig(input: unknown): AdminFeatureConfig | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const key = normalizeText(record.key, 64);
  const label = normalizeText(record.label, 80);
  const href = normalizeText(record.href, 160);
  const module = normalizeModule(record.module);
  if (!key || !label || !href || !module) return null;
  const status = normalizeStatus(record.status);
  const enabled = typeof record.enabled === "boolean" ? record.enabled : status === "active";

  return {
    key,
    label,
    module,
    href,
    description: normalizeText(record.description, 240),
    enabled,
    navVisible: typeof record.navVisible === "boolean" ? record.navVisible : enabled,
    defaultModel: normalizeText(record.defaultModel, 80),
    creditPolicy: normalizeText(record.creditPolicy, 120),
    adminHref: normalizeText(record.adminHref, 160) || moduleAdminHref[module],
    status,
    notes: normalizeText(record.notes, 1000),
    updatedAt: normalizeText(record.updatedAt, 40) || null,
  };
}

export function mergeAdminFeatureConfigs(defaults: AdminFeatureConfig[], stored: unknown): AdminFeatureConfig[] {
  const storedRows = Array.isArray((stored as StoredFeatureRegistry | null)?.features)
    ? ((stored as StoredFeatureRegistry).features as unknown[])
    : Array.isArray(stored)
      ? stored
      : [];
  const parsed = storedRows.map(parseAdminFeatureConfig).filter((item): item is AdminFeatureConfig => Boolean(item));
  const byKey = new Map(defaults.map((item) => [item.key, item]));
  for (const item of parsed) {
    byKey.set(item.key, {
      ...(byKey.get(item.key) || item),
      ...item,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.module.localeCompare(b.module) || a.label.localeCompare(b.label, "zh-CN"));
}

export function upsertAdminFeatureConfig(rows: AdminFeatureConfig[], next: AdminFeatureConfig) {
  const parsed = parseAdminFeatureConfig({ ...next, updatedAt: new Date().toISOString() });
  if (!parsed) throw new Error("功能配置字段不完整");
  const existing = rows.filter((item) => item.key !== parsed.key);
  return [...existing, parsed].sort((a, b) => a.module.localeCompare(b.module) || a.label.localeCompare(b.label, "zh-CN"));
}

export function archiveAdminFeatureConfig(rows: AdminFeatureConfig[], key: string) {
  const found = rows.find((item) => item.key === key);
  if (!found) throw new Error("未找到功能配置");
  return upsertAdminFeatureConfig(rows, {
    ...found,
    enabled: false,
    navVisible: false,
    status: "archived",
  });
}

export async function getAdminFeatureRegistry(): Promise<AdminFeatureRegistry> {
  const defaults = buildDefaultAdminFeatureConfigs();
  const warnings: string[] = [];
  try {
    const { data, error } = await getAdminClient()
      .from("admin_config_versions")
      .select("id,status,value,created_at,published_at")
      .eq("config_key", ADMIN_FEATURES_CONFIG_KEY)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) throw error;
    const active = data?.find((item) => item.status === "published") || data?.[0] || null;
    return {
      configKey: ADMIN_FEATURES_CONFIG_KEY,
      activeVersionId: active?.id || null,
      activeVersionStatus: active?.status || null,
      features: mergeAdminFeatureConfigs(defaults, active?.value),
      warnings,
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "功能配置版本读取失败");
    return {
      configKey: ADMIN_FEATURES_CONFIG_KEY,
      activeVersionId: null,
      activeVersionStatus: null,
      features: defaults,
      warnings,
    };
  }
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeModule(value: unknown): AppModuleKey | null {
  const module = normalizeText(value, 40);
  return ["home", "aiShoots", "productImages", "assistant", "tools", "toolbox", "enterprise", "aiVideo", "works"].includes(module)
    ? (module as AppModuleKey)
    : null;
}

function normalizeStatus(value: unknown): AdminFeatureStatus {
  const status = normalizeText(value, 40);
  if (status === "disabled" || status === "archived") return status;
  return "active";
}
