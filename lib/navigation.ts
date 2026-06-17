import {
  Bot,
  Box,
  Camera,
  Clapperboard,
  GalleryHorizontalEnd,
  Heart,
  History,
  Home,
  Images,
  ImagePlus,
  Infinity as InfinityIcon,
  PackageSearch,
  PersonStanding,
  PlaySquare,
  ScanFace,
  ServerCog,
  Shirt,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type AppModuleKey = "home" | "aiShoots" | "assistant" | "tools" | "canvas" | "aiVideo" | "works";

export type FeatureKey =
  | "home"
  | "agent"
  | "tryon"
  | "outfitFusion"
  | "faceSwap"
  | "grass"
  | "productSet"
  | "allCategoryProductImage"
  | "modelBackground"
  | "materialEnhancement"
  | "pose"
  | "model"
  | "garment3d"
  | "videoImageToVideo"
  | "videoMotion"
  | "videoFirstLastFrame"
  | "generalImage"
  | "textToImage"
  | "imageToImage"
  | "infiniteCanvas"
  | "apiTest"
  | "history";

export type TopModuleNavItem = {
  key: AppModuleKey;
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "NEW";
  comingSoon?: boolean;
};

export type FeatureNavItem = {
  key: FeatureKey;
  module: AppModuleKey;
  href: string;
  label: string;
  shortLabel?: string;
  description: string;
  icon: LucideIcon;
  comingSoon?: boolean;
  hiddenFromNav?: boolean;
};

const SHOW_INTERNAL_NAV =
  process.env.NEXT_PUBLIC_SHOW_INTERNAL_NAV === "true" || process.env.NODE_ENV !== "production";

export const TOP_MODULES: TopModuleNavItem[] = [
  { key: "home", href: "/", label: "首页", icon: Home },
  { key: "aiShoots", href: "/create", label: "模特图", icon: Camera },
  { key: "assistant", href: "/agent", label: "工作流助手", icon: Bot },
  { key: "tools", href: "/general-image", label: "素材生成", icon: Images },
  { key: "canvas", href: "/infinite-canvas", label: "无限画布", icon: InfinityIcon },
  { key: "aiVideo", href: "/video", label: "AI视频", icon: Clapperboard, badge: "NEW" },
  { key: "works", href: "/history", label: "作品库", icon: GalleryHorizontalEnd },
];

export const VISIBLE_TOP_MODULES: TopModuleNavItem[] = TOP_MODULES.filter((item) => item.key !== "assistant");

export const FEATURE_ITEMS: FeatureNavItem[] = [
  {
    key: "home",
    module: "home",
    href: "/",
    label: "首页",
    description: "工作台入口",
    icon: Home,
  },
  {
    key: "tryon",
    module: "aiShoots",
    href: "/create",
    label: "服装上身",
    shortLabel: "上身",
    description: "服装上身与模特试穿",
    icon: Shirt,
  },
  {
    key: "outfitFusion",
    module: "aiShoots",
    href: "/outfit-fusion",
    label: "搭配融图",
    shortLabel: "搭配",
    description: "多张服饰、配件和模特参考融合成套搭配图",
    icon: Sparkles,
  },
  {
    key: "model",
    module: "aiShoots",
    href: "/model",
    label: "专属模特",
    shortLabel: "模特",
    description: "生成专属模特素材",
    icon: PersonStanding,
  },
  {
    key: "faceSwap",
    module: "aiShoots",
    href: "/face-swap",
    label: "换脸",
    shortLabel: "换脸",
    description: "替换面部特征并保留主体风格",
    icon: ScanFace,
  },
  {
    key: "grass",
    module: "aiShoots",
    href: "/grass",
    label: "种草图",
    shortLabel: "种草",
    description: "小红书、电商和内容种草图",
    icon: Heart,
  },
  {
    key: "productSet",
    module: "aiShoots",
    href: "/product-set",
    label: "商品套图",
    shortLabel: "套图",
    description: "生成主图、辅图和详情页商品视觉",
    icon: GalleryHorizontalEnd,
  },
  {
    key: "allCategoryProductImage",
    module: "aiShoots",
    href: "/all-category-product-image",
    label: "全品类商品图",
    shortLabel: "全品类",
    description: "上传 SKU 图，生成主图与详情图规划和成图",
    icon: PackageSearch,
    hiddenFromNav: true,
  },
  {
    key: "modelBackground",
    module: "aiShoots",
    href: "/model-background",
    label: "换背景",
    shortLabel: "背景",
    description: "保留主体并替换拍摄场景",
    icon: Images,
  },
  {
    key: "materialEnhancement",
    module: "aiShoots",
    href: "/material-enhancement",
    label: "材质增强",
    shortLabel: "材质",
    description: "用高清服装图增强上身图材质细节",
    icon: Sparkles,
  },
  {
    key: "pose",
    module: "aiShoots",
    href: "/pose",
    label: "姿势裂变",
    shortLabel: "姿势",
    description: "生成多姿势、单图或宫格输出",
    icon: PersonStanding,
  },
  {
    key: "garment3d",
    module: "aiShoots",
    href: "/garment-3d",
    label: "服装 3D",
    shortLabel: "3D",
    description: "服装立体展示素材",
    icon: Box,
  },
  {
    key: "videoImageToVideo",
    module: "aiVideo",
    href: "/video",
    label: "图生视频",
    shortLabel: "图生视频",
    description: "上传图片并生成模特展示视频",
    icon: Clapperboard,
  },
  {
    key: "videoMotion",
    module: "aiVideo",
    href: "/video/motion-control",
    label: "动作模仿",
    shortLabel: "动作",
    description: "用参考视频驱动模特动作",
    icon: PlaySquare,
  },
  {
    key: "videoFirstLastFrame",
    module: "aiVideo",
    href: "/video/first-last-frame",
    label: "首尾帧",
    shortLabel: "首尾帧",
    description: "指定首帧和尾帧生成过渡视频",
    icon: ImagePlus,
  },
  {
    key: "agent",
    module: "assistant",
    href: "/agent",
    label: "工作流助手",
    shortLabel: "助手",
    description: "聊天、分析与工作流执行",
    icon: Bot,
    hiddenFromNav: true,
  },
  {
    key: "textToImage",
    module: "tools",
    href: "/general-image",
    label: "文生图",
    shortLabel: "文生图",
    description: "用文字描述直接生成图片",
    icon: ImagePlus,
  },
  {
    key: "imageToImage",
    module: "tools",
    href: "/general-image/image-to-image",
    label: "图生图",
    shortLabel: "图生图",
    description: "多张参考图结合提示词生成图片",
    icon: Images,
  },
  {
    key: "infiniteCanvas",
    module: "canvas",
    href: "/infinite-canvas",
    label: "无限画布",
    shortLabel: "画布",
    description: "基于开源 infinite-canvas 的图片创作编排工作台",
    icon: InfinityIcon,
  },
  {
    key: "apiTest",
    module: "tools",
    href: "/api-platform-test",
    label: "API 测试",
    shortLabel: "API",
    description: "模型与接口测试页面",
    icon: ServerCog,
  },
  {
    key: "history",
    module: "works",
    href: "/history",
    label: "作品库",
    shortLabel: "作品",
    description: "历史作品与参数复用",
    icon: History,
  },
];

function isInternalFeatureItem(item: FeatureNavItem) {
  return item.key === "apiTest";
}

function isHiddenFeatureItem(item: FeatureNavItem) {
  return item.hiddenFromNav === true;
}

export function getFeatureItem(key: FeatureKey) {
  return FEATURE_ITEMS.find((item) => item.key === key);
}

export function getActiveTopModule(pathname: string | null | undefined): AppModuleKey {
  const path = pathname || "/";
  const feature = FEATURE_ITEMS
    .filter((item) => item.href !== "/")
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => path === item.href || path.startsWith(`${item.href}/`));

  if (feature) return feature.module;
  if (path === "/" || path.startsWith("/login") || path.startsWith("/auth")) return "home";
  return "aiShoots";
}

export function getFeatureItemsForModule(module: AppModuleKey) {
  const items =
    module === "home"
      ? FEATURE_ITEMS.filter((item) => item.module === "aiShoots")
      : FEATURE_ITEMS.filter((item) => item.module === module);

  const visibleItems = items.filter((item) => !isHiddenFeatureItem(item));
  return SHOW_INTERNAL_NAV ? visibleItems : visibleItems.filter((item) => !isInternalFeatureItem(item));
}
