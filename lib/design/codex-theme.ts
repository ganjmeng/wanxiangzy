export const codexTheme = {
  brand: {
    name: "VastWearGen",
    subtitle: "AI 服装视觉生产工作台",
    tagline: "面向服装品牌和电商团队的 AI 服装视觉生产工作台。",
    description: "上传服装、模特和参考图，生成上身图、商品套图、种草封面和场景版本。",
    logo: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/gemini-icon.png",
  },
  colors: {
    ink: "#050505",
    muted: "#4b5263",
    faint: "#7b8498",
    page: "#ffffff",
    surface: "#ffffff",
    surfaceSoft: "rgba(255,255,255,0.74)",
    surfaceStrong: "rgba(255,255,255,0.92)",
    border: "rgba(17,24,39,0.12)",
    borderStrong: "rgba(17,24,39,0.2)",
    accent: "#5b7cff",
    accentSoft: "rgba(91,124,255,0.10)",
    ice: "rgba(5,5,5,0.04)",
    dark: "#07080d",
  },
  status: {
    success: "#22885f",
    warning: "#a66a00",
    danger: "#d13b35",
    running: "#5b7cff",
  },
  gradients: {
    page: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    hero: "radial-gradient(circle at 50% 0%, rgba(5,5,5,0.04), transparent 38%), linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    loader: "linear-gradient(90deg, #06101d 0%, #4b5263 50%, #06101d 100%)",
    primary: "linear-gradient(180deg, rgba(255,255,255,0.12), transparent 38%), linear-gradient(180deg, #111318 0%, #050505 100%)",
  },
  fontStack: {
    sans: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", sans-serif',
    mono: '"SF Mono", "Cascadia Code", "JetBrains Mono", ui-monospace, monospace',
  },
  radius: {
    sm: "10px",
    md: "16px",
    lg: "24px",
    xl: "32px",
    pill: "999px",
  },
  shadow: {
    sm: "0 1px 2px rgba(5,5,5,0.08)",
    md: "0 18px 50px rgba(14,18,38,0.14)",
    lg: "0 40px 120px rgba(7,8,13,0.34)",
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
