"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { AspectRatio, ImageSize, LingyaModel } from "@/lib/api/lingya";

export type AgentV2GenerationSettings = {
  model: LingyaModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  count: number;
};

export type AgentV2Mode = "agent" | "chat";
export type AgentV2Speed = "Instant" | "Balanced" | "Deep";
export type AgentV2AppModule =
  | "auto"
  | "image_analysis"
  | "image_create"
  | "tryon"
  | "pose_variation"
  | "ecommerce_detail"
  | "garment_3d"
  | "free_create";

export type AgentV2UiContext = {
  mode: AgentV2Mode;
  speed: AgentV2Speed;
  appModule: AgentV2AppModule;
};

export const AGENT_V2_DEFAULT_GENERATION_SETTINGS: AgentV2GenerationSettings = {
  model: "gpt-image-2",
  aspectRatio: "3:4",
  imageSize: "1K",
  count: 1,
};

export const AGENT_V2_DEFAULT_UI_CONTEXT: AgentV2UiContext = {
  mode: "agent",
  speed: "Instant",
  appModule: "auto",
};

export const AGENT_V2_MODEL_OPTIONS = [
  { value: "gpt-image-2", label: "GPT Image" },
  { value: "nano-banana-2", label: "Nano Banana 2" },
  { value: "nano-banana-pro", label: "Nano Banana Pro" },
  { value: "doubao-seedream-4-5-251128", label: "Seedream" },
] as const satisfies ReadonlyArray<{ value: LingyaModel; label: string }>;

export const AGENT_V2_ASPECT_RATIO_OPTIONS = [
  "auto",
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "4:5",
  "5:4",
  "21:9",
] as const satisfies readonly AspectRatio[];

export const AGENT_V2_COUNT_OPTIONS = [1, 2, 3, 4] as const;

const ALL_IMAGE_SIZES = ["1K", "2K", "4K"] as const satisfies readonly ImageSize[];
const SETTINGS_STORAGE_KEY = "wanxiang.agent.v2.generation-settings";
const UI_CONTEXT_STORAGE_KEY = "wanxiang.agent.v2.ui-context";

type AgentV2GenerationSettingsContextValue = {
  settings: AgentV2GenerationSettings;
  uiContext: AgentV2UiContext;
  setSettings: Dispatch<SetStateAction<AgentV2GenerationSettings>>;
  setUiContext: Dispatch<SetStateAction<AgentV2UiContext>>;
  updateSettings: (patch: Partial<AgentV2GenerationSettings>) => void;
  updateUiContext: (patch: Partial<AgentV2UiContext>) => void;
};

const AgentV2GenerationSettingsContext = createContext<AgentV2GenerationSettingsContextValue | null>(null);

export function AgentV2GenerationSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AgentV2GenerationSettings>(() =>
    normalizeAgentV2GenerationSettings(readStoredSettings()),
  );
  const [uiContext, setUiContext] = useState<AgentV2UiContext>(() =>
    normalizeAgentV2UiContext(readStoredUiContext()),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(UI_CONTEXT_STORAGE_KEY, JSON.stringify(uiContext));
  }, [uiContext]);

  const updateSettings = useCallback((patch: Partial<AgentV2GenerationSettings>) => {
    setSettings((current) => normalizeAgentV2GenerationSettings({ ...current, ...patch }));
  }, []);

  const updateUiContext = useCallback((patch: Partial<AgentV2UiContext>) => {
    setUiContext((current) => normalizeAgentV2UiContext({ ...current, ...patch }));
  }, []);

  const value = useMemo(
    () => ({
      settings,
      uiContext,
      setSettings,
      setUiContext,
      updateSettings,
      updateUiContext,
    }),
    [settings, uiContext, updateSettings, updateUiContext],
  );

  return (
    <AgentV2GenerationSettingsContext.Provider value={value}>
      {children}
    </AgentV2GenerationSettingsContext.Provider>
  );
}

export function useAgentV2GenerationSettings() {
  const context = useContext(AgentV2GenerationSettingsContext);
  if (!context) {
    throw new Error("useAgentV2GenerationSettings must be used inside AgentV2GenerationSettingsProvider");
  }
  return context;
}

export function getAgentV2SupportedImageSizes(model: LingyaModel, aspectRatio: AspectRatio): ImageSize[] {
  if (model === "doubao-seedream-4-5-251128") return ["2K", "4K"];
  if (model === "gpt-image-2" && (aspectRatio === "auto" || aspectRatio === "1:1")) return ["1K"];
  return [...ALL_IMAGE_SIZES];
}

export function normalizeAgentV2GenerationSettings(value: unknown): AgentV2GenerationSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const model = normalizeOption(record.model, AGENT_V2_MODEL_OPTIONS.map((item) => item.value), AGENT_V2_DEFAULT_GENERATION_SETTINGS.model);
  const aspectRatio = normalizeOption(record.aspectRatio, AGENT_V2_ASPECT_RATIO_OPTIONS, AGENT_V2_DEFAULT_GENERATION_SETTINGS.aspectRatio);
  const supportedSizes = getAgentV2SupportedImageSizes(model, aspectRatio);
  const imageSize = normalizeOption(record.imageSize, supportedSizes, supportedSizes[0] || AGENT_V2_DEFAULT_GENERATION_SETTINGS.imageSize);
  const rawCount = Number(record.count);
  const count = Number.isFinite(rawCount)
    ? Math.min(Math.max(Math.floor(rawCount), 1), 4)
    : AGENT_V2_DEFAULT_GENERATION_SETTINGS.count;

  return { model, aspectRatio, imageSize, count };
}

export function normalizeAgentV2UiContext(value: unknown): AgentV2UiContext {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    mode: normalizeOption(record.mode, ["agent", "chat"] as const, AGENT_V2_DEFAULT_UI_CONTEXT.mode),
    speed: normalizeOption(record.speed, ["Instant", "Balanced", "Deep"] as const, AGENT_V2_DEFAULT_UI_CONTEXT.speed),
    appModule: normalizeOption(
      record.appModule,
      [
        "auto",
        "image_analysis",
        "image_create",
        "tryon",
        "pose_variation",
        "ecommerce_detail",
        "garment_3d",
        "free_create",
      ] as const,
      AGENT_V2_DEFAULT_UI_CONTEXT.appModule,
    ),
  };
}

function readStoredSettings() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function readStoredUiContext() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(UI_CONTEXT_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function normalizeOption<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && options.includes(value as T) ? value as T : fallback;
}
