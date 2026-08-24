import {
  Bot,
  BookOpenText,
  Box,
  Building2,
  Camera,
  Clapperboard,
  Eraser,
  Expand,
  Footprints,
  GalleryHorizontalEnd,
  GalleryVerticalEnd,
  Hand,
  Heart,
  History,
  Home,
  Images,
  ImagePlus,
  LayoutTemplate,
  Languages,
  PackageOpen,
  PackageSearch,
  PersonStanding,
  PlaySquare,
  Scaling,
  ScanLine,
  ScanFace,
  Scissors,
  ServerCog,
  Shirt,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type AppModuleKey =
  | "home"
  | "aiShoots"
  | "productImages"
  | "assistant"
  | "canvas"
  | "tools"
  | "toolbox"
  | "enterprise"
  | "aiVideo"
  | "works";

export type FeatureKey =
  | "home"
  | "agent"
  | "infiniteCanvas"
  | "prompts"
  | "plaza"
  | "assets"
  | "tryon"
  | "outfitFusion"
  | "faceSwap"
  | "grass"
  | "productRetouch"
  | "productSet"
  | "allCategoryProductImage"
  | "modelBackground"
  | "materialEnhancement"
  | "pose"
  | "model"
  | "garment3d"
  | "imageTranslation"
  | "videoImageToVideo"
  | "videoMotion"
  | "videoFirstLastFrame"
  | "generalImage"
  | "textToImage"
  | "imageToImage"
  | "aiMatting"
  | "imageUpscale"
  | "aiOutpaint"
  | "aiErase"
  | "handFootRepair"
  | "clothingRepair"
  | "shoeRepair"
  | "losslessResize"
  | "apiTest"
  | "history";

export type TopModuleNavItem = {
  key: AppModuleKey;
  href: string;
  /** 中文兜底文案（未接入 i18n 的消费方继续可用） */
  label: string;
  /** i18n 消息键（Header.modules.*），渲染时优先翻译 */
  labelKey?: string;
  icon: LucideIcon;
  badge?: "NEW";
  badgeLabelKey?: string;
  comingSoon?: boolean;
};

export type FeatureNavItem = {
  key: FeatureKey;
  module: AppModuleKey;
  href: string;
  label: string;
  /** i18n 消息键，接入翻译的消费方使用 */
  labelKey?: string;
  shortLabel?: string;
  description: string;
  icon: LucideIcon;
  badge?: "NEW";
  comingSoon?: boolean;
  hiddenFromNav?: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

const SHOW_INTERNAL_NAV =
  process.env.NEXT_PUBLIC_SHOW_INTERNAL_NAV === "true" || process.env.NODE_ENV !== "production";

export const TOP_MODULES: TopModuleNavItem[] = [
  { key: "home", href: "/", label: "首页", labelKey: "Header.modules.home", icon: Home },
  {
    key: "assistant",
    href: "/agent",
    label: "创作Agent",
    labelKey: "Header.modules.assistant",
    icon: Bot,
    badgeLabelKey: "Header.featuresBadge.upgrade",
  },
  {
    key: "canvas",
    href: "/canvas",
    label: "无限画布",
    icon: LayoutTemplate,
    badge: "NEW",
  },
  { key: "aiShoots", href: "/create", label: "模特图", labelKey: "Header.modules.aiShoots", icon: Camera },
  {
    key: "productImages",
    href: "/product-retouch",
    label: "商品图",
    labelKey: "Header.modules.productImages",
    icon: PackageOpen,
  },
  { key: "aiVideo", href: "/video", label: "AI视频", labelKey: "Header.modules.aiVideo", icon: Clapperboard, badge: "NEW" },
  { key: "tools", href: "/general-image", label: "素材生成", labelKey: "Header.modules.tools", icon: Images, badge: "NEW" },
  { key: "toolbox", href: "/ai-tools/matting", label: "AI工具箱", labelKey: "Header.modules.toolbox", icon: Wrench },
  { key: "enterprise", href: "/pricing", label: "企业功能", labelKey: "Header.modules.enterprise", icon: Building2 },
  { key: "works", href: "/history", label: "作品库", labelKey: "Header.modules.works", icon: GalleryHorizontalEnd },
];

/**
 * 主导航按工作台参考结构展示；作品库下沉到左侧固定快捷区。
 */
export const VISIBLE_TOP_MODULES: TopModuleNavItem[] = TOP_MODULES.filter(
  (item) => item.key !== "works",
);

export const FEATURE_ITEMS: FeatureNavItem[] = [
  {
    key: "home",
    module: "home",
    href: "/",
    label: "首页",
    labelKey: "Header.features.home.label",
    description: "工作台入口",
    icon: Home,
  },
  {
    key: "tryon",
    module: "aiShoots",
    href: "/create",
    label: "服装上身",
    labelKey: "Header.features.tryon.label",
    shortLabel: "上身",
    description: "服装上身与模特试穿",
    icon: Shirt,
  },
  {
    key: "outfitFusion",
    module: "aiShoots",
    href: "/outfit-fusion",
    label: "搭配融图",
    labelKey: "Header.features.outfitFusion.label",
    shortLabel: "搭配",
    description: "多张服饰、配件和模特参考融合成套搭配图",
    icon: Sparkles,
  },
  {
    key: "model",
    module: "aiShoots",
    href: "/model",
    label: "专属模特",
    labelKey: "Header.features.model.label",
    shortLabel: "模特",
    description: "生成专属模特素材",
    icon: PersonStanding,
  },
  {
    key: "faceSwap",
    module: "aiShoots",
    href: "/face-swap",
    label: "换脸",
    labelKey: "Header.features.faceSwap.label",
    shortLabel: "换脸",
    description: "替换面部特征并保留主体风格",
    icon: ScanFace,
  },
  {
    key: "grass",
    module: "aiShoots",
    href: "/grass",
    label: "种草图",
    labelKey: "Header.features.grass.label",
    shortLabel: "种草",
    description: "小红书、电商和内容种草图",
    icon: Heart,
  },
  {
    key: "productRetouch",
    module: "productImages",
    href: "/product-retouch",
    label: "商品精修",
    labelKey: "Header.features.productRetouch.label",
    shortLabel: "精修",
    description: "批量完成标准精修、白底精修与影棚精修",
    icon: Sparkles,
  },
  {
    key: "imageTranslation",
    module: "productImages",
    href: "/image-translation",
    label: "图片翻译",
    labelKey: "Header.features.imageTranslation.label",
    shortLabel: "翻译",
    description: "批量翻译商品图文字，保留品牌、Logo、产品和参数原样",
    icon: Languages,
    badge: "NEW",
  },
  {
    key: "productSet",
    module: "productImages",
    href: "/product-set",
    label: "商品套图",
    labelKey: "Header.features.productSet.label",
    shortLabel: "套图",
    description: "生成主图、辅图和详情页商品视觉",
    icon: GalleryHorizontalEnd,
  },
  {
    key: "allCategoryProductImage",
    module: "productImages",
    href: "/all-category-product-image",
    label: "全品类商品图",
    labelKey: "Header.features.allCategoryProductImage.label",
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
    labelKey: "Header.features.modelBackground.label",
    shortLabel: "背景",
    description: "保留主体并替换拍摄场景",
    icon: Images,
  },
  {
    key: "materialEnhancement",
    module: "aiShoots",
    href: "/material-enhancement",
    label: "材质增强",
    labelKey: "Header.features.materialEnhancement.label",
    shortLabel: "材质",
    description: "用高清服装图增强上身图材质细节",
    icon: Sparkles,
  },
  {
    key: "pose",
    module: "aiShoots",
    href: "/pose",
    label: "姿势裂变",
    labelKey: "Header.features.pose.label",
    shortLabel: "姿势",
    description: "生成多姿势、单图或宫格输出",
    icon: PersonStanding,
  },
  {
    key: "garment3d",
    module: "aiShoots",
    href: "/garment-3d",
    label: "服装 3D",
    labelKey: "Header.features.garment3d.label",
    shortLabel: "3D",
    description: "服装立体展示素材",
    icon: Box,
  },
  {
    key: "videoImageToVideo",
    module: "aiVideo",
    href: "/video",
    label: "图生视频",
    labelKey: "Header.features.videoImageToVideo.label",
    shortLabel: "图生视频",
    description: "上传图片并生成模特展示视频",
    icon: Clapperboard,
  },
  {
    key: "videoMotion",
    module: "aiVideo",
    href: "/video/motion-control",
    label: "动作模仿",
    labelKey: "Header.features.videoMotion.label",
    shortLabel: "动作",
    description: "用参考视频驱动模特动作",
    icon: PlaySquare,
    badge: "NEW",
  },
  {
    key: "videoFirstLastFrame",
    module: "aiVideo",
    href: "/video/first-last-frame",
    label: "首尾帧",
    labelKey: "Header.features.videoFirstLastFrame.label",
    shortLabel: "首尾帧",
    description: "指定首帧和尾帧生成过渡视频",
    icon: ImagePlus,
  },
  {
    key: "agent",
    module: "assistant",
    href: "/agent",
    label: "工作流助手",
    labelKey: "Header.features.agent.label",
    shortLabel: "助手",
    description: "聊天、分析与工作流执行",
    icon: Bot,
  },
  {
    key: "prompts",
    module: "assistant",
    href: "/prompts",
    label: "提示词",
    shortLabel: "提示词",
    description: "官方灵感词库与我的提示词",
    icon: BookOpenText,
  },
  {
    key: "plaza",
    module: "assistant",
    href: "/plaza",
    label: "创作广场",
    shortLabel: "广场",
    description: "浏览案例并一键带入 Agent",
    icon: GalleryVerticalEnd,
  },
  {
    key: "assets",
    module: "assistant",
    href: "/resource-library",
    label: "素材库",
    shortLabel: "素材",
    description: "上传素材、生成结果与提示词资产",
    icon: Images,
  },
  {
    key: "infiniteCanvas",
    module: "canvas",
    href: "/canvas",
    label: "无限画布",
    shortLabel: "画布",
    description: "自由组织灵感、素材和生成结果",
    icon: LayoutTemplate,
  },
  {
    key: "textToImage",
    module: "tools",
    href: "/general-image",
    label: "文生图",
    labelKey: "Header.features.textToImage.label",
    shortLabel: "文生图",
    description: "用文字描述直接生成图片",
    icon: ImagePlus,
  },
  {
    key: "imageToImage",
    module: "tools",
    href: "/general-image/image-to-image",
    label: "图生图",
    labelKey: "Header.features.imageToImage.label",
    shortLabel: "图生图",
    description: "多张参考图结合提示词生成图片",
    icon: Images,
    badge: "NEW",
  },
  {
    key: "aiMatting",
    module: "toolbox",
    href: "/ai-tools/matting",
    label: "AI抠图",
    shortLabel: "抠图",
    description: "智能识别人像与商品主体，生成透明背景图",
    icon: Scissors,
  },
  {
    key: "imageUpscale",
    module: "toolbox",
    href: "/ai-tools/upscale",
    label: "图片超清",
    shortLabel: "超清",
    description: "提升图片分辨率与细节清晰度",
    icon: ScanLine,
  },
  {
    key: "aiOutpaint",
    module: "toolbox",
    href: "/ai-tools/outpaint",
    label: "AI扩图",
    shortLabel: "扩图",
    description: "智能延展画面边界并补全场景内容",
    icon: Expand,
  },
  {
    key: "aiErase",
    module: "toolbox",
    href: "/ai-tools/erase",
    label: "AI消除",
    shortLabel: "消除",
    description: "涂抹选中不需要的元素并自然修补画面",
    icon: Eraser,
  },
  {
    key: "handFootRepair",
    module: "toolbox",
    href: "/ai-tools/hand-foot-repair",
    label: "手脚修复",
    shortLabel: "手脚",
    description: "修复手部与脚部的结构、姿态和细节",
    icon: Hand,
  },
  {
    key: "clothingRepair",
    module: "toolbox",
    href: "/ai-tools/clothing-repair",
    label: "服饰修复",
    shortLabel: "服饰",
    description: "修复服饰的版型、纹理、边缘与细节",
    icon: Shirt,
  },
  {
    key: "shoeRepair",
    module: "toolbox",
    href: "/ai-tools/shoe-repair",
    label: "鞋靴修复",
    shortLabel: "鞋靴",
    description: "修复鞋靴轮廓、结构、材质与接地阴影",
    icon: Footprints,
  },
  {
    key: "losslessResize",
    module: "toolbox",
    href: "/ai-tools/resize",
    label: "无损改尺寸",
    shortLabel: "改尺寸",
    description: "按指定尺寸和比例输出高质量图片",
    icon: Scaling,
  },
  {
    key: "apiTest",
    module: "toolbox",
    href: "/api-platform-test",
    label: "API 测试",
    labelKey: "Header.features.apiTest.label",
    shortLabel: "API",
    description: "模型与接口测试页面",
    icon: ServerCog,
  },
  {
    key: "history",
    module: "works",
    href: "/history",
    label: "作品库",
    labelKey: "Header.features.history.label",
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
  if (path === "/pricing" || path.startsWith("/pricing/")) return "enterprise";
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
