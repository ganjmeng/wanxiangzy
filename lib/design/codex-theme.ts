export const codexTheme = {
  brand: {
    name: "VastWearGen",
    subtitle: "AI 服装视觉生产工作台",
    tagline: "面向服装品牌和电商团队的 AI 服装视觉生产工作台。",
    description: "上传服装、模特和参考图，生成上身图、商品套图、种草封面和场景版本。",
    logo: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/gemini-icon.png",
  },
  colors: {
    ink: "#1d1d1f",                    /* Apple label */
    muted: "#6e6e73",                  /* Apple secondaryLabel */
    faint: "#86868b",                  /* Apple tertiaryLabel */
    page: "#ffffff",
    surface: "#ffffff",
    surfaceSoft: "rgba(255,255,255,0.78)",
    surfaceStrong: "rgba(255,255,255,0.92)",
    border: "rgba(0,0,0,0.08)",        /* Apple hairline separator */
    borderStrong: "rgba(0,0,0,0.14)",
    accent: "#007aff",                 /* Apple systemBlue */
    accentHover: "#006fe6",
    accentSoft: "rgba(0,122,255,0.10)",
    ice: "rgba(0,0,0,0.04)",
    dark: "#1d1d1f",
    /* Apple Liquid Glass */
    glass: "rgba(255,255,255,0.6)",
    glassStrong: "rgba(255,255,255,0.8)",
    glassSoft: "rgba(255,255,255,0.45)",
    glassBorder: "rgba(255,255,255,0.5)",
    glassFill: "rgba(120,120,128,0.12)",
  },
  status: {
    success: "#00873a",                /* Apple systemGreen */
    warning: "#ff9500",                /* Apple systemOrange */
    danger: "#ff3b30",                 /* Apple systemRed */
    running: "#007aff",                /* task progress = systemBlue */
  },
  gradients: {
    page: "#ffffff",
    hero:
      "radial-gradient(ellipse at 50% 0%, rgba(0,122,255,0.05), transparent 50%), radial-gradient(ellipse at 80% 10%, rgba(175,82,222,0.04), transparent 50%), #ffffff",
    loader: "linear-gradient(90deg, rgba(0,122,255,0) 0%, rgba(0,122,255,0.5) 50%, rgba(0,122,255,0) 100%)",
    primary: "linear-gradient(180deg, #4ca0ff 0%, #007aff 100%)",
    appleChrome:
      "linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.7) 100%)",
  },
  fontStack: {
    sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, ui-sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", sans-serif',
    mono: '"SF Mono", "Cascadia Code", "JetBrains Mono", ui-monospace, monospace',
  },
  radius: {
    sm: "12px",                        /* Apple standard input/secondary */
    md: "16px",                        /* user spec — unified rounded-2xl */
    lg: "20px",
    xl: "28px",
    pill: "9999px",
  },
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.04)",
    md: "0 4px 16px rgba(0,0,0,0.08)",
    lg: "0 16px 40px rgba(0,0,0,0.12)",
    apple: "0 0.5px 0 rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
    appleLg: "0 0.5px 0 rgba(0,0,0,0.04), 0 12px 28px rgba(0,0,0,0.10)",
  },
  ease: {
    apple: "cubic-bezier(0.16, 1, 0.3, 1)",
    spring: "cubic-bezier(0.5, 1.5, 0.5, 1)",
  },
  duration: {
    apple: "240ms",
    snappy: "150ms",
    deliberate: "360ms",
  },
  upload: {
    minHeight: 224,
    compactHeight: 190,
    aspectRatio: "4 / 3",
  },
  loader: {
    minHeight: 360,
    shimmerDuration: "2.4s",
  },
} as const;

export type CodexTheme = typeof codexTheme;
export type StudioTone = "neutral" | "accent" | "primary" | "success" | "warning" | "danger";
export type StudioDensity = "compact" | "comfortable";
export type StudioState = "idle" | "uploading" | "loading" | "selected" | "error" | "disabled";
export type StudioSurfaceVariant = "surface" | "elevated" | "floating" | "canvas" | "toolbar";
