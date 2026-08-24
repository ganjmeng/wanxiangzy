export type AgentSkillWorkspace = "image" | "video" | "canvas";
export type AgentSkillAction = "generate" | "edit";
export type AgentSkillScope = "system" | "user";
export type AgentSkillSourceType = "builtin" | "local" | "github";

export type SkillReferenceRole = {
  id: string;
  label: string;
  required: boolean;
  maxCount: number;
  description?: string;
  modes?: Array<"quick" | "professional">;
  mediaTypes?: Array<"image" | "video">;
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  plannerSummary?: string;
  instructions: string;
  enabled?: boolean;
  keywords: string[];
  capabilities: AgentSkillWorkspace[];
  action: AgentSkillAction;
  requiresReference: boolean;
  defaultConfig?: Record<string, string | number | boolean>;
  referenceRoles?: SkillReferenceRole[];
  scope?: AgentSkillScope;
  sourceType?: AgentSkillSourceType;
  sourceUrl?: string;
  sourceRepository?: string;
  sourcePath?: string;
  sourceVersion?: string;
  sourceCommit?: string;
  sourceContentHash?: string;
  license?: string;
  currentVersion?: number;
  userCreated?: boolean;
};

export const BUILTIN_AGENT_SKILLS: AgentSkill[] = [
  {
    id: "ecommerce-image", name: "电商视觉导演（官方）",
    description: "理解商品卖点，为主图、辅图和详情页逐张完成整套电商视觉。",
    plannerSummary: "为电商商品规划统一商业视觉、主图、卖点辅图和详情页素材。",
    instructions: "先识别商品类别、材质、结构与核心卖点，再规划统一的商业视觉语言。输出应包含可信的主视觉、卖点辅图与适合电商展示的构图，保持商品外观准确，不臆造标识或功能。",
    enabled: true, keywords: ["电商", "商品", "主图", "详情页"], capabilities: ["image", "canvas"], action: "generate", requiresReference: true,
    defaultConfig: { imageCount: 4, aspectRatio: "auto", imageQuality: "smart" }, scope: "system", sourceType: "builtin", sourceVersion: "1.0.0", currentVersion: 1,
    referenceRoles: [
      { id: "product", label: "商品图", required: true, maxCount: 4, description: "锁定商品外形、结构、颜色、材质、Logo、包装和销售内容", mediaTypes: ["image"] },
      { id: "model", label: "模特图", required: false, maxCount: 4, mediaTypes: ["image"] },
      { id: "garment", label: "服装图", required: false, maxCount: 4, mediaTypes: ["image"] },
      { id: "scene", label: "场景图", required: false, maxCount: 4, mediaTypes: ["image"] },
    ],
  },
  {
    id: "natural-beauty", name: "自然美颜精修", description: "保留本人身份和真实肤质的自然人像精修。",
    plannerSummary: "在保持身份和真实皮肤纹理的前提下完成自然人像精修。",
    instructions: "保持人物身份、五官比例和真实皮肤纹理，只优化肤色、瑕疵、光影与画面质感。禁止塑料皮、过度磨皮或改变人物年龄和身份特征。",
    enabled: true, keywords: ["美颜", "精修", "人像"], capabilities: ["image", "canvas"], action: "edit", requiresReference: true,
    defaultConfig: { imageCount: 1, imageQuality: "high" }, scope: "system", sourceType: "builtin", sourceVersion: "1.0.0", currentVersion: 1,
    referenceRoles: [{ id: "portrait", label: "人像原图", required: true, maxCount: 1, description: "需要精修的本人照片", mediaTypes: ["image"] }],
  },
  {
    id: "character-design", name: "角色设定", description: "建立可持续复用的角色外观、服装、表情和多视图设定。",
    plannerSummary: "建立稳定一致、可持续复用的角色身份与多视图设定。",
    instructions: "根据描述建立稳定一致的角色设计，明确脸部、发型、体型、服装、配色和道具；输出应保持角色身份一致，并覆盖正面、侧面、背面与关键表情。",
    enabled: true, keywords: ["角色", "设定", "人物"], capabilities: ["image", "canvas"], action: "generate", requiresReference: false,
    defaultConfig: { imageCount: 4, aspectRatio: "3:4" }, scope: "system", sourceType: "builtin", sourceVersion: "1.0.0", currentVersion: 1,
    referenceRoles: [
      { id: "character", label: "角色参考", required: false, maxCount: 4, description: "锁定身份、五官、发型和体型", mediaTypes: ["image"] },
      { id: "outfit", label: "服装参考", required: false, maxCount: 4, mediaTypes: ["image"] },
      { id: "style", label: "风格参考", required: false, maxCount: 3, mediaTypes: ["image"] },
    ],
  },
  {
    id: "ecommerce-video", name: "电商商品展示短片", description: "把商品素材编排为聚焦卖点的商业展示视频。",
    plannerSummary: "基于商品和品牌素材规划聚焦卖点的连续商业展示视频。",
    instructions: "保持商品外观和品牌信息准确，用克制的镜头运动、合理景别和清晰节奏突出卖点。避免产品形变、错误文字与无关元素。",
    enabled: true, keywords: ["电商", "商品", "短片", "视频"], capabilities: ["video", "canvas"], action: "generate", requiresReference: true,
    defaultConfig: { videoCount: 1, videoSeconds: 5, videoResolution: "720p", generateAudio: true }, scope: "system", sourceType: "builtin", sourceVersion: "1.0.0", currentVersion: 1,
    referenceRoles: [
      { id: "product_image", label: "商品图片", required: true, maxCount: 6, description: "锁定商品外观、材质、Logo、包装与销售单元", mediaTypes: ["image"] },
      { id: "product_video", label: "商品视频", required: false, maxCount: 3, description: "补充商品动作、使用方式与已有镜头", mediaTypes: ["video"] },
      { id: "scene", label: "场景参考", required: false, maxCount: 3, mediaTypes: ["image"] },
      { id: "camera", label: "运镜参考", required: false, maxCount: 3, mediaTypes: ["video"] },
      { id: "brand", label: "品牌素材", required: false, maxCount: 5, mediaTypes: ["image"] },
      { id: "sound", label: "声音参考", required: false, maxCount: 1, mediaTypes: ["video"] },
      { id: "music", label: "音乐参考", required: false, maxCount: 3, mediaTypes: ["video"] },
    ],
  },
  {
    id: "image-motion", name: "图片动效", description: "为静态图片添加自然、可控且保持主体一致的镜头动效。",
    plannerSummary: "把静态画面转为主体稳定、动作自然的短视频。",
    instructions: "分析主体和空间层次，添加自然的运镜与局部动作。保持主体身份、画面结构和关键文字稳定，避免形变、闪烁和不合理运动。",
    enabled: true, keywords: ["动效", "图生视频", "运镜"], capabilities: ["video", "canvas"], action: "edit", requiresReference: true,
    defaultConfig: { videoCount: 1, videoSeconds: 5, videoResolution: "720p" }, scope: "system", sourceType: "builtin", sourceVersion: "1.0.0", currentVersion: 1,
    referenceRoles: [
      { id: "source_image", label: "原始图片", required: true, maxCount: 1, description: "需要添加动效的静态画面", mediaTypes: ["image"] },
      { id: "motion", label: "动作参考", required: false, maxCount: 3, mediaTypes: ["image", "video"] },
    ],
  },
];
