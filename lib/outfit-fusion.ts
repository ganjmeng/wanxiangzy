import type { AspectRatio, ImageSize, LingyaModel } from "@/lib/api/lingya";
import type { ImagePreviewReference, ImagePreviewReferenceRole } from "@/lib/studio-image-preview";

export type OutfitFusionAssetRole = "outfit" | "reference" | "model";

export type OutfitFusionAsset = {
  id: string;
  role: OutfitFusionAssetRole;
  url: string;
  name?: string;
};

export type OutfitFusionTemplate = {
  id: string;
  title: string;
  prompt: string;
  coverUrl: string;
  assets: OutfitFusionAsset[];
  resultUrls: string[];
  outputCount: number;
};

export type OutfitFusionQuality = "standard" | "hd" | "ultra";

export type OutfitFusionConfig = {
  aspectRatio: Extract<AspectRatio, "auto" | "1:1" | "3:4">;
  genCount: number;
  imageSize: ImageSize;
  aiModel: LingyaModel;
  quality: OutfitFusionQuality;
};

export const OUTFIT_FUSION_MODELS: Array<{ value: LingyaModel; label: string; desc: string }> = [
  { value: "nano-banana-2", label: "Nano-Banana-2", desc: "高性价比，适合批量出图" },
  { value: "gpt-image-2", label: "GPT-Image-2", desc: "细节稳定，适合复杂多物件" },
  { value: "nano-banana-pro", label: "Nano-Banana-Pro", desc: "质感更强，适合品牌大片" },
];

export const OUTFIT_FUSION_QUALITY_OPTIONS: Array<{ value: OutfitFusionQuality; label: string; desc: string }> = [
  { value: "standard", label: "标准", desc: "快速预览" },
  { value: "hd", label: "高清", desc: "细节增强" },
  { value: "ultra", label: "超清", desc: "高质感精修" },
];

export const DEFAULT_OUTFIT_FUSION_CONFIG: OutfitFusionConfig = {
  aspectRatio: "auto",
  genCount: 4,
  imageSize: "1K",
  aiModel: "nano-banana-2",
  quality: "hd",
};

export const OUTFIT_FUSION_TEMPLATES: OutfitFusionTemplate[] = [
  {
    id: "7839001",
    title: "轻熟通勤多件套",
    prompt: "让【参考图1】的模特戴着【搭配图2】的一顶棕色的平顶帽，穿着【搭配图3】的一件蓝色的无袖上衣，穿着【搭配图4】的一条白色的半身裙，拿着【搭配图5】的棕色的手提包，把模特换成【模特图6】的模特。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN019Cu8zE1EcsrHtNUWm_-6000000000373-2-tps-3520-4693-acc7264244.png",
    assets: [
      { id: "7839001-1", role: "reference", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01yslKdz1CnIdSzUGA3_-6000000000125-0-tps-1104-1472-59c00277f7.jpg" },
      { id: "7839001-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01RYn4xW1yVzDjJD7HN_-6000000006585-0-tps-1024-1032-5131d7ff2f.jpg" },
      { id: "7839001-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01v16hIZ1Jx6QIkgS4N_-6000000001094-0-tps-1024-1016-9c5561c21c.jpg" },
      { id: "7839001-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01BbZtq51kHsOimn9ya_-6000000004659-0-tps-1024-1032-b7494a9cb4.jpg" },
      { id: "7839001-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN014PHmy51LeRWCiDuV5_-6000000001324-0-tps-1024-1016-ef74e16b9e.jpg" },
      { id: "7839001-6", role: "model", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01k7OCfB1qCje8IISOI_-6000000005460-0-tps-1440-1891-fa9cbb847b.jpg" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN019Cu8zE1EcsrHtNUWm_-6000000000373-2-tps-3520-4693-acc7264244.png"],
  },
  {
    id: "7839002",
    title: "图书馆秋冬层次",
    prompt: "让【参考图6】的模特穿着【搭配图1】的一条灰色的长裙，拿着【搭配图2】的一个黑色的菱格纹手提包，穿着【搭配图3】的黑色漆皮尖头高跟鞋，穿着【搭配图4】的一件深棕色的毛呢外套，戴着【搭配图4】的一条带有绿色图案的丝巾，穿着【搭配图5】的一件浅蓝色的长袖衬衫，把模特换成【模特图7】的模特。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01ge3fYu1tqWuIDP9O1_-6000000005953-0-tps-3520-4693-a38b93a75e.jpg",
    assets: [
      { id: "7839002-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01NaOW3X20b8uXpb3Wk_-6000000006867-0-tps-1024-1019-4ef8af4e52.jpg" },
      { id: "7839002-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01jJtIAX1EeiRaa6et4_-6000000000377-0-tps-1024-1024-eeb5433ee9.jpg" },
      { id: "7839002-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01vAvtR71lD7uEdbGlI_-6000000004784-0-tps-1024-1038-30799d52e9.jpg" },
      { id: "7839002-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01jmhKa61fcsTpkmVzE_-6000000004028-0-tps-1024-1024-2bcadad7a4.jpg" },
      { id: "7839002-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01Qt0DZY29RN0AiTaAk_-6000000008064-0-tps-1024-1029-cecb901c58.jpg" },
      { id: "7839002-6", role: "reference", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01pG0cpk1mjvtLMY9Gj_-6000000004991-0-tps-1104-1472-3378a5a817.jpg" },
      { id: "7839002-7", role: "model", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01zug3D91jAial3v3lp_-6000000004508-0-tps-864-1184-eef13cd1b5.jpg" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01ge3fYu1tqWuIDP9O1_-6000000005953-0-tps-3520-4693-a38b93a75e.jpg"],
  },
  {
    id: "7839004",
    title: "度假浅灰套装",
    prompt: "让【参考图8】的模特穿着【搭配图1】的一双银色的高跟凉鞋，穿着【搭配图2】的一件浅灰色的吊带连衣裙，穿着【搭配图3】的一件浅灰色的花卉图案马甲，戴着【搭配图4】的米色的编织帽子，拿着【搭配图5】的一条浅蓝色带有菠萝图案的围巾，拿着【搭配图6】的绿色的菱格纹手提包，把模特换成【模特图7】的模特。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01EFPiFR23sUlSb0vwj_-6000000007311-2-tps-3072-4096-c981504ed0.png",
    assets: [
      { id: "7839004-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01vIOISc1TKlQVtySR6_-6000000002364-0-tps-1016-1024-fae3a733f3.jpg" },
      { id: "7839004-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01RW9Y8v1OyXkRU2izV_-6000000001774-0-tps-1024-1032-7165a45081.jpg" },
      { id: "7839004-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01nF3mv22A4IfRGLCAs_-6000000008149-0-tps-1424-1424-3832b71892.jpg" },
      { id: "7839004-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01VemS1x1VnjiFwsCyo_-6000000002698-0-tps-1024-1025-dc3d71af42.jpg" },
      { id: "7839004-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN014VG9pO1dbNxTD9shd_-6000000003754-0-tps-1360-1360-bab3d944f5.jpg" },
      { id: "7839004-6", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01l5rKUo27tBpOiWRHV_-6000000007854-0-tps-1024-1024-c8a65c83d5.jpg" },
      { id: "7839004-7", role: "model", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01U7Mt0t1PkAwH4k4IK_-6000000001878-2-tps-467-640-64ba5a703b.png" },
      { id: "7839004-8", role: "reference", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01qyGOO01Qj5cDwUINL_-6000000002011-0-tps-1104-1472-f1f0eb8444.jpg" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01EFPiFR23sUlSb0vwj_-6000000007311-2-tps-3072-4096-c981504ed0.png"],
  },
  {
    id: "7840002",
    title: "机能风深色套装",
    prompt: "让【参考图6】的模特穿着【搭配图1】的黑色的皮质鞋子，拿着【搭配图2】的一个黑色的手提包，穿着【搭配图3】的一条米色的工装裤，穿着【搭配图4】的一件黑色的长袖衬衫，穿着【搭配图5】的一件灰色的羊羔绒领夹克，把模特换成【模特图7】的模特。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01tAg6li1tP38uu9UPk_-6000000005893-2-tps-3520-4693-e77c4f1266.png",
    assets: [
      { id: "7840002-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01EtNGX01Sg0B1zMKSw_-6000000002275-0-tps-1024-1032-0b3c87c8ea.jpg" },
      { id: "7840002-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN012sAVDc1eOqjWj6exm_-6000000003862-0-tps-1016-1032-73affc7213.jpg" },
      { id: "7840002-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01Vvcisb24avBNpsGCo_-6000000007408-0-tps-1360-1360-0c9276868c.jpg" },
      { id: "7840002-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01SGgkeU1ZXU7dHbODf_-6000000003204-0-tps-1024-1029-d79b0e965c.jpg" },
      { id: "7840002-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01bkPWk01JsyrIAA2hJ_-6000000001085-0-tps-1024-1024-b01df5ab5c.jpg" },
      { id: "7840002-6", role: "reference", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01D4lHEU1PNH8Sokz44_-6000000001828-0-tps-1104-1472-92f99eeab1.jpg" },
      { id: "7840002-7", role: "model", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01gyyKNQ1y0NtMi5kGN_-6000000006516-0-tps-467-640-4cdfab1e6a.jpg" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01tAg6li1tP38uu9UPk_-6000000005893-2-tps-3520-4693-e77c4f1266.png"],
  },
  {
    id: "7840003",
    title: "海岛运动混搭",
    prompt: "让【参考图8】的模特戴着【搭配图1】的白色运动帽，穿着【搭配图2】的一件浅蓝色的短袖T恤，戴着【搭配图3】的一副棕色框的方形太阳镜，穿着【搭配图4】的一条紫色的宽松裤子，穿着【搭配图5】的一双蓝色的PUMA运动鞋，拿着【搭配图6】的一个浅灰色的布质腰包，把模特换成【模特图7】的模特。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01TzHP7m1eY0eeHY97a_-6000000003882-0-tps-3520-4693-d6f57c42d8.jpg",
    assets: [
      { id: "7840003-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01AUuZy51kzqQ6D2YuB_-6000000004755-0-tps-1016-1024-afb112e920.jpg" },
      { id: "7840003-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01A8RTWn1dVtCnqCQNx_-6000000003742-0-tps-1016-1024-f1f1985fe6.jpg" },
      { id: "7840003-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01Pi9nh51WTs9PGA9PZ_-6000000002790-2-tps-864-857-0e3ec0a331.png" },
      { id: "7840003-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN018n5WEU1Mhw9iynkJX_-6000000001467-0-tps-1360-1360-c750e7fecf.jpg" },
      { id: "7840003-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01sYqXOv1WdUT5RvROH_-6000000002811-0-tps-1024-1019-9fb189fd4c.jpg" },
      { id: "7840003-6", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01VpYZ5g1Qcg4QvVXYj_-6000000001997-0-tps-1024-1032-86b1f9ce13.jpg" },
      { id: "7840003-7", role: "model", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01mV6tFe1aGpKfgp1Xr_-6000000003303-2-tps-467-640-2d267e33da.png" },
      { id: "7840003-8", role: "reference", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01yc6PPM1nrY5raA73L_-6000000005143-0-tps-1104-1472-5ad9773340.jpg" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01TzHP7m1eY0eeHY97a_-6000000003882-0-tps-3520-4693-d6f57c42d8.jpg"],
  },
  {
    id: "7840004",
    title: "法式街景黑白红",
    prompt: "让【模特图6】的模特穿着【搭配图1】的一件带有花卉图案的白色衬衫，穿着【搭配图2】的一条黑色的短裤，穿着【搭配图3】的一双黑色的蝴蝶结高跟靴子，穿着【搭配图4】的一件黑色的风衣外套，拿着【搭配图5】的红色的皮质手提包，拿着【搭配图5】的一条带有花纹的丝巾。 姿势: 模特站立，身体微微侧转，头部自然抬起看向镜头，双手自然垂放于身体两侧，肩部放松，姿态优雅自信。 背景: 具有岁月感的米色石灰岩建筑立面，远处虚化的欧式铸铁栏杆或咖啡馆遮阳篷，营造出沉稳的异域度假氛围。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN012G0jg41aiJ62eo9t4_-4611686018427383075-0-aigc_biz_alg-a7760ffd5c.jpg",
    assets: [
      { id: "7840004-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01vp2TwC1QlNb0WgFo6_-6000000002016-0-tps-1360-1360-411122ab9f.jpg" },
      { id: "7840004-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01ZM4bXc1pA9njp08v7_-6000000005319-0-tps-1360-1360-e0f95e2d39.jpg" },
      { id: "7840004-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01NOG1Gc1imtzpWQshG_-6000000004456-0-tps-1024-1024-1d697c9d34.jpg" },
      { id: "7840004-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01m5Uvkg1bKmMlA9abu_-6000000003447-2-tps-1024-1024-9b2c9c0171.png" },
      { id: "7840004-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01LnWUaw1p3kFxAIKgg_-6000000005305-0-tps-1360-1360-bd30c81d0e.jpg" },
      { id: "7840004-6", role: "model", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN014C5mKw1pfl6dvGtea_-4611686018427385100-0-aigc_biz_alg-df6d322d04.jpg" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN012G0jg41aiJ62eo9t4_-4611686018427383075-0-aigc_biz_alg-a7760ffd5c.jpg"],
  },
  {
    id: "7842001",
    title: "雪线户外多层叠穿",
    prompt: "让【参考图8】的模特穿着【搭配图1】的一件黑色牛仔夹克，拿着【搭配图2】的一个黑色的手提包，戴着【搭配图3】的一条黑色的针织围巾，穿着【搭配图4】的一双棕色的系带靴子，穿着【搭配图5】的灰色的夹克，戴着【搭配图6】的一条米色带有蓝色和红色雪花图案的针织帽，穿着【搭配图7】的一条黑色的宽腿牛仔裤，把模特换成【模特图9】的模特。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN019gcRJS1DwI1Zg3Mxz_-6000000000280-2-tps-3520-4693-17a8a3d423.png",
    assets: [
      { id: "7842001-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01MwQQla1U5TpFJ8OHb_-6000000002466-0-tps-1024-1019-b8fff2d85d.jpg" },
      { id: "7842001-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01cE89Q91kA5fGvdiNt_-6000000004642-0-tps-1024-1024-9aa99d942c.jpg" },
      { id: "7842001-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01rjWoab1PV3ruqvuAL_-6000000001845-0-tps-1024-1016-014dbae157.jpg" },
      { id: "7842001-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01p6hd2N23G1Ujevv94_-6000000007227-0-tps-1024-1024-69a3272bf2.jpg" },
      { id: "7842001-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN019alDDb1IuWZtpzxWX_-6000000000953-0-tps-1024-1016-63bbf5c5e2.jpg" },
      { id: "7842001-6", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01FDLFcn1aoidpWn91y_-6000000003377-0-tps-1024-1020-72277fe68d.jpg" },
      { id: "7842001-7", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01LU4YbR1ksW5CJOTHb_-6000000004739-0-tps-1024-1032-7d3ff6ea42.jpg" },
      { id: "7842001-8", role: "reference", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01KwFovd1FkxSSRiITl_-6000000000526-0-tps-1104-1472-aa70fb5c47.jpg" },
      { id: "7842001-9", role: "model", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN013tRneq1aVwOwvJOno_-6000000003336-2-tps-467-640-751d1556b6.png" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN019gcRJS1DwI1Zg3Mxz_-6000000000280-2-tps-3520-4693-17a8a3d423.png"],
  },
  {
    id: "7842002",
    title: "庭院男装轻机能",
    prompt: "让【参考图5】的模特穿着【搭配图1】的白色运动鞋，拿着【搭配图2】的一个黑色的手提包，穿着【搭配图3】的一件黑色的夹克，穿着【搭配图4】的一条灰色的工装短裤，戴着【搭配图4】的一条棕色的皮质腰带，把模特换成【模特图6】的模特。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01E50D3s1GlhidLhC4L_-6000000000663-0-tps-2792-3720-5c402516f7.jpg",
    assets: [
      { id: "7842002-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01OvOmnC1TtZWn1npiX_-6000000002440-0-tps-1024-1032-527035c581.jpg" },
      { id: "7842002-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01cE89Q91kA5fGvdiNt_-6000000004642-0-tps-1024-1024-9aa99d942c.jpg" },
      { id: "7842002-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN019pFjtt1UkF4eVjUOS_-6000000002555-0-tps-1024-1016-ceca40957e.jpg" },
      { id: "7842002-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01b1FH5n1FuZm7jcB4u_-6000000000547-0-tps-1024-1032-8d82f8dafa.jpg" },
      { id: "7842002-5", role: "reference", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01DWBdbK27WI1aA493R_-6000000007804-0-tps-908-1210-b42d8c2de1.jpg" },
      { id: "7842002-6", role: "model", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01te0mUE1u71AE0Qcng_-6000000005989-0-tps-2314-3086-effca89d7b.jpg" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01E50D3s1GlhidLhC4L_-6000000000663-0-tps-2792-3720-5c402516f7.jpg"],
  },
  {
    id: "5348001",
    title: "雪山儿童户外",
    prompt: "让模特穿上【搭配图1】的黄色的格纹羽绒服，穿上【搭配图2】的棕色宽松裤子，穿上【搭配图3】的红色和黄色的运动鞋，戴上【搭配图4】的彩色图案针织帽，背着【搭配图5】的绿色的单肩包，带有棕色的肩带和扣件。 模特：8岁欧美男童模特，都市户外风；动作：正面站立，一手插兜；场景：雪山脚下或高原草甸，自然光，突出防风保暖与版型。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01KjRuPD1UV7yhMNs2R_-6000000002522-2-tps-1417-1889-b7398944f6.png",
    assets: [
      { id: "5348001-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01QRMlcl1ZQ9l2wlVYd_-6000000003188-2-tps-1000-1000-51374740d6.png" },
      { id: "5348001-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01eCkC4x1pVgOBVYXNW_-6000000005366-2-tps-1000-1000-5f051eed65.png" },
      { id: "5348001-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01S6qSgq1tBld13Of5q_-6000000005864-2-tps-1024-1024-f0a4d772cf.png" },
      { id: "5348001-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01Taz9vJ1yRrd2UegbZ_-6000000006576-2-tps-992-992-b91b624f26.png" },
      { id: "5348001-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01grcKDv1KRKXJVidp5_-6000000001160-2-tps-1024-1024-08b2bc305d.png" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01KjRuPD1UV7yhMNs2R_-6000000002522-2-tps-1417-1889-b7398944f6.png"],
  },
  {
    id: "5328002",
    title: "童趣暖光居家",
    prompt: "让模特穿上【搭配图1】的黄色长袖连体衣，带有热气球和云朵图案，戴上【搭配图2】的橙色带太阳和月亮图案的帽子，穿上【搭配图3】的带有草莓图案的浅色长袜，抱着【搭配图4】的棕色小熊玩偶。 模特：3-9个月婴儿，萌系可爱；动作：躺着抱玩偶或与玩偶互动；场景：儿童房，自然光+暖色道具，温馨商拍。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01Z7SIPS26ehepqGkW7_-6000000007687-2-tps-2304-3072-3d104a0da3.png",
    assets: [
      { id: "5328002-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN019KRRk31ZG52ntGD5D_-6000000003166-2-tps-3072-2886-b89a25aecd.png" },
      { id: "5328002-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01cItZTL1SRns6kQsa4_-6000000002244-2-tps-1024-1024-465da9445a.png" },
      { id: "5328002-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01yBUyIl1YgoXtkQLd1_-6000000003089-2-tps-1024-1024-168c2a09f5.png" },
      { id: "5328002-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01TOX3UE1fw75UELDec_-6000000004070-2-tps-1056-992-9797652ad8.png" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01Z7SIPS26ehepqGkW7_-6000000007687-2-tps-2304-3072-3d104a0da3.png"],
  },
  {
    id: "5328001",
    title: "圣诞针织日常",
    prompt: "让模特穿上【搭配图1】的红色毛衣带有白色几何图案，穿上【搭配图2】的棕色高腰短裙，穿上【搭配图3】的棕色毛绒靴子，穿上【搭配图4】的白色条纹针织长袜，拿着【搭配图5】的毛绒材质的手提包。 模特: 女性。 姿势: 站立，双手自然垂于身体两侧，微微侧头看向镜头。 背景: 简约风格的室内背景，有木质地板和柔和的灯光。",
    outputCount: 4,
    coverUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01SQBId01qLR90YQwVB_-6000000005479-2-tps-864-1184-b2ab0d081b.png",
    assets: [
      { id: "5328001-1", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i4/O1CN01ZKKGEJ1KAqHIEZO2K_-6000000001124-2-tps-1000-1000-eea05d66ca.png" },
      { id: "5328001-2", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01O33MoS1nXOdgvHKDI_-6000000005099-2-tps-864-864-4290f08e14.png" },
      { id: "5328001-3", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i3/O1CN01zjx9my1tQQIuduPLf_-6000000005896-2-tps-864-864-c4140d33ca.png" },
      { id: "5328001-4", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN013GWPBV1spKDqsGQoJ_-6000000005815-2-tps-1024-1024-67f2934d74.png" },
      { id: "5328001-5", role: "outfit", url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i2/O1CN01URoV9V1yl6GOMimAt_-6000000006618-2-tps-864-864-fc6894b6bd.png" },
    ],
    resultUrls: ["https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/img.alicdn.com/imgextra/i1/O1CN01SQBId01qLR90YQwVB_-6000000005479-2-tps-864-1184-b2ab0d081b.png"],
  },
];

export function getOutfitFusionAssetLabel(asset: Pick<OutfitFusionAsset, "role">, index: number) {
  if (asset.role === "reference") return `参考图${index + 1}`;
  if (asset.role === "model") return `模特图${index + 1}`;
  return `搭配图${index + 1}`;
}

export function getOutfitFusionRoleLabel(role: OutfitFusionAssetRole) {
  if (role === "reference") return "参考图";
  if (role === "model") return "模特";
  return "搭配图";
}

export function getOutfitFusionPreviewRole(role: OutfitFusionAssetRole): ImagePreviewReferenceRole {
  if (role === "reference") return "reference";
  if (role === "model") return "model";
  return "clothing";
}

export function outfitFusionReferencesFromAssets(assets: OutfitFusionAsset[]): ImagePreviewReference[] {
  return assets.map((asset, index) => ({
    url: asset.url,
    label: asset.name || getOutfitFusionAssetLabel(asset, index),
    role: getOutfitFusionPreviewRole(asset.role),
  }));
}

export function clampOutfitFusionCount(value: unknown) {
  const numeric = Number(value);
  const count = Number.isFinite(numeric) ? Math.round(numeric) : DEFAULT_OUTFIT_FUSION_CONFIG.genCount;
  return Math.min(Math.max(count, 1), 4);
}

// Hard-rule marker + leading segment. Single-branch.
// Pattern mirrors tryon's (lib/tryon-prompt.ts) which has been the
// highest-quality module:
//   - CLOTHING_IMAGE_ROLE_RULE: 服装图角色隔离
//   - FACE_RULE: 模特脸规则
//   - REFERENCE_RULE: 参考图规则
// Here we apply the same discipline to outfit-fusion (4 image kinds:
// outfit / reference / model).
export const OUTFIT_FUSION_HARD_RULE_MARK = "【HARD 硬规则 · 套装融合模式】";

// 图角色隔离规则：搭配图即使有真人/模特/脸/身体/姿势/背景，也不得作为身份来源。
// (Mirrors tryon's TRYON_CLOTHING_IMAGE_ROLE_RULE — the rule that made
//  tryon look natural instead of blending the model on the clothes.)
const OUTFIT_FUSION_ITEM_ISOLATION_RULE =
  "搭配图角色隔离规则：所有标记为搭配图的输入图只提供服装、鞋包、配饰本身的信息；即使图里有真人、模特、人台、脸、身体、姿势、背景、房间、户外环境、光线或构图，也一律不得作为最终人物身份、姿势、背景、场景、镜头距离或构图参考；只提取目标衣服的品类、版型、颜色、图案/logo、面料、纹理、长短、领口、袖口、下摆、口袋、纽扣/拉链、缝线和穿戴层次。最终人物、姿势、背景和构图来自模特图/参考图，不得复制搭配图里的穿衣人和拍摄环境。";

// 模特身份规则：模特图 = 唯一脸部身份锚点。
const OUTFIT_FUSION_MODEL_FACE_RULE =
  "模特图规则：模特图是最终脸部身份锚点，提供可识别的五官结构、脸型轮廓和五官相对位置；不提供肤色、妆容、表情、身体比例、年龄身高、头部大小、肩宽、四肢长度、衣服、姿势、背景、构图或场景光线。最终脸必须仍然一眼像模特图本人，禁止合成新脸、禁止与参考图融合脸、禁止与搭配图拼凑脸。";

// 参考图规则：参考图 = 画面骨架。
const OUTFIT_FUSION_REFERENCE_RULE =
  "参考图规则：参考图是最终画面的主参考图和画面骨架，必须保持参考图中的可见身体范围、人物姿势、身体角度、可见四肢位置、背景、构图、镜头角度、光影方向、人物位置和镜头距离；但允许为了服装真实贴合人体产生自然褶皱、遮挡关系和边缘轮廓调整。参考图不提供脸部身份——脸部身份由模特图提供。";

// 服装还原规则。
const OUTFIT_FUSION_GARMENT_FIDELITY_RULE =
  "服装还原规则：必须忠实还原搭配图中的品类、版型、肩线、领口、袖长、腰线、下摆、开合位置、颜色、面料、纹理、图案、印花、刺绣、纽扣、拉链、口袋、缝线和所有可见细节；不要凭空新增配饰、图案、logo 或改变服装长度和结构。";

const OUTFIT_FUSION_OUTPUT_RULE =
  "单张输出规则：最终只生成一张完整单人商业摄影穿搭照片，禁止拼图、四宫格、2x2 网格、分屏、边框、编号文字、contact sheet、before/after 对比、商品陈列页或多张照片合集。";

const OUTFIT_FUSION_HARD_RULE_BASE = `${OUTFIT_FUSION_HARD_RULE_MARK}
1) ${OUTFIT_FUSION_ITEM_ISOLATION_RULE}
2) ${OUTFIT_FUSION_MODEL_FACE_RULE}
3) ${OUTFIT_FUSION_REFERENCE_RULE}
4) ${OUTFIT_FUSION_GARMENT_FIDELITY_RULE}
5) ${OUTFIT_FUSION_OUTPUT_RULE}`;

export type OutfitFusionMode = "items_only" | "with_model" | "with_reference" | "full";

export function decideOutfitFusionMode(assets: OutfitFusionAsset[]): OutfitFusionMode {
  const hasModel = assets.some((a) => a.role === "model");
  const hasReference = assets.some((a) => a.role === "reference");
  const hasItems = assets.some((a) => a.role === "outfit");
  if (hasModel && hasReference && hasItems) return "full";
  if (hasModel && hasItems) return "with_model";
  if (hasReference && hasItems) return "with_reference";
  return "items_only";
}

// Find the index (1-based, matching 【搭配图N】/【模特图N】 labels) of
// the asset that owns the face identity. Returns undefined if no model
// asset is present.
export function decideOutfitFusionFaceOwner(assets: OutfitFusionAsset[]): number | undefined {
  const modelIdx = assets.findIndex((a) => a.role === "model");
  if (modelIdx < 0) return undefined;
  return modelIdx + 1; // 1-based to match the template label "【模特图N】"
}

function buildOutfitFusionHardRule(faceOwnerIndex?: number): string {
  // Inject an explicit face-owner line at the top so the image model
  // sees "脸 = 模特图N" up front, not buried in role lines.
  if (faceOwnerIndex === undefined) return OUTFIT_FUSION_HARD_RULE_BASE;
  return [
    OUTFIT_FUSION_HARD_RULE_MARK,
    `0) 脸主锁定：图${faceOwnerIndex}（模特图）是最终人物的唯一脸部身份来源；其它任何图（包括参考图、搭配图）都不得参与脸、肤色、发型、年龄感、身材、表情的融合。`,
    OUTFIT_FUSION_HARD_RULE_BASE.split("\n").slice(1).join("\n"),
  ].join("\n");
}

export function buildOutfitFusionPrompt(input: {
  templatePrompt?: string;
  assets: OutfitFusionAsset[];
  customPrompt?: string;
  config: OutfitFusionConfig;
}) {
  const faceOwnerIndex = decideOutfitFusionFaceOwner(input.assets);
  const roleLines = input.assets.map((asset, index) => {
    const label = asset.name || getOutfitFusionAssetLabel(asset, index);
    if (asset.role === "reference") return `【${label}】只作为人物姿态、构图、背景光影和穿搭关系参考`;
    if (asset.role === "model") return `【${label}】是最终人物身份、脸型、发型和气质的唯一来源，其它图都不得参与脸部融合`;
    return `【${label}】只提取服装、鞋包、配饰、颜色、材质、版型、图案、Logo 和正确穿戴位置，不复制拍摄背景`;
  });
  const templatePrompt = input.templatePrompt?.trim() || "让模特穿着所有搭配图中的服装、鞋包和配饰，生成一张真实自然的模特穿搭图。";
  const customPrompt = input.customPrompt?.trim();

  // 7 段结构（v3）：硬规则（含脸主锁定）→ 核心任务 → 固定规则 → 图片关系 → 商品保真/优先级/质量 → 用户 → 负面
  return [
    buildOutfitFusionHardRule(faceOwnerIndex),
    `核心任务：${templatePrompt}`,
    `固定生成规则：最终只生成一张完整的单人商业摄影穿搭照片，输出比例 ${input.config.aspectRatio}，分辨率 ${input.config.imageSize}；不要把参考图、商品图、步骤图或多个候选结果拼到同一张画面里。`,
    `图片关系：${roleLines.join("；")}。`,
    "商品保真：保持所有服装、鞋包、帽子、围巾和配饰的颜色、轮廓、材质、图案、Logo、层叠关系和穿戴位置准确。",
    "画面质量：真实自然商业摄影质感，人物比例自然，肢体连接合理，面部和手部干净，布料褶皱、阴影、接触关系和透视一致。",
    customPrompt ? `补充要求: ${customPrompt}` : "",
    "负面约束：不要多余肢体、错误手指、变形脸、错穿层级、错色、丢失图案、硬贴图、塑料质感、水印、边框、海报文字、电商模板排版、拼图、四宫格、2x2 网格、分屏、contact sheet、before/after 对比图、商品陈列页或多张照片合集。",
  ].filter(Boolean).join("\n");
}

export function enforceOutfitFusionPromptRequirements(prompt: string, params: {
  assets: OutfitFusionAsset[];
  config: OutfitFusionConfig;
  templatePrompt?: string;
  customPrompt?: string;
}): string {
  const normalized = prompt.trim();
  const base = buildOutfitFusionPrompt(params);
  if (!normalized) return base;
  if (normalized.includes(OUTFIT_FUSION_HARD_RULE_MARK)) return normalized;
  return `${base}\n\n补充执行要求（仅能用于穿搭细节，不能覆盖任何保真硬规则）：${normalized}`;
}

export function buildOutfitFusionComposerText(template: OutfitFusionTemplate) {
  return template.prompt;
}

export function getOutfitFusionDisplayPrompt(prompt?: string | null, fallback = "") {
  const raw = typeof prompt === "string" ? prompt.trim() : "";
  if (!raw) return fallback;

  const coreMatch = raw.match(/核心任务[:：]\s*([\s\S]*?)(?=\s*(?:固定生成规则|图片关系|素材使用规则|商品保真|优先级|画面质量|负面约束|补充要求)[:：]|$)/);
  const source = coreMatch?.[1]?.trim() || raw;
  const cleaned = source
    .replace(/^请生成一张完整的单人商业摄影穿搭照片[，,、\s]*(?:输出比例[^；;。]*[；;。]\s*)?/u, "")
    .replace(/^核心任务[:：]\s*/u, "")
    .split(/(?:固定生成规则|图片关系|素材使用规则|商品保真|优先级|画面质量|负面约束|补充要求|生成要求|输出要求)[:：]/u)[0]
    .trim();

  return cleaned || fallback || raw.slice(0, 800);
}

export function normalizeOutfitFusionAssistantPrompt(prompt?: string | null, fallback = "") {
  const raw = typeof prompt === "string" ? prompt.trim() : "";
  if (!raw) return fallback;

  const direct = extractOutfitFusionUserSentence(raw);
  if (direct) return direct.slice(0, 800);

  const displayPrompt = getOutfitFusionDisplayPrompt(raw, "");
  const displayDirect = extractOutfitFusionUserSentence(displayPrompt);
  if (displayDirect) return displayDirect.slice(0, 800);

  const blockedLinePattern = /^(?:搭配融图生成任务|搭配配图生成任务|图片角色锁定|图片角色|生成要求|输出要求|负面约束|任务|图像角色)\s*[:：]?$/;
  const blockedContentPattern = /^(?:图\d+对应|参考图\d+\s*[:：]|搭配图\d+\s*[:：]|模特图?\d+\s*[:：]|输出比例|清晰度|模型|生成\s*\d+\s*张|只输出|不要解释|不要\s*Markdown|画面真实自然|photorealistic)/i;
  const cleaned = raw
    .split(/\r?\n+/)
    .map((line) => line.trim().replace(/^[-*•\d.、\s]+/, ""))
    .filter((line) => line && !blockedLinePattern.test(line) && !blockedContentPattern.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/(?:固定生成规则|图片关系|素材使用规则|商品保真|优先级|画面质量|负面约束|生成要求|输出要求)[:：][\s\S]*$/u, "")
    .replace(/(?:拼图|四宫格|2x2\s*网格|分屏|contact sheet|候选图|多张图|合集)[，,。；;\s]*/gi, "")
    .trim();

  return (extractOutfitFusionUserSentence(cleaned) || cleaned || fallback).slice(0, 800);
}

function extractOutfitFusionUserSentence(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const candidates: Array<{ text: string; index: number; score: number }> = [];
  const pattern = /让(?:【参考图\d+】的模特|模特)[^。！？]*[。！？]?/g;

  for (const match of normalized.matchAll(pattern)) {
    const index = match.index ?? 0;
    const text = (match[0] || "").trim();
    if (!isOutfitFusionUserSentence(text)) continue;

    const prefix = normalized.slice(Math.max(0, index - 28), index);
    const isFormatExample = /(?:句式|示例|例如|输出必须采用)/.test(prefix);
    const isExistingUserPrompt = /用户已有要求[:：]\s*$/.test(prefix);
    candidates.push({
      text,
      index,
      score: (isExistingUserPrompt ? 20 : 0) - (isFormatExample ? 12 : 0),
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.text || "";
}

function isOutfitFusionUserSentence(value: string) {
  if (!value) return false;
  if (!/【(?:搭配图|模特图)\d+】/.test(value)) return false;
  if (/【(?:参考图|搭配图|模特图)X】|【(?:参考图|搭配图|模特图)Y】|【(?:参考图|搭配图|模特图)Z】/.test(value)) return false;
  if (/(?:固定生成规则|素材使用规则|负面约束|生成张数|模型名|清晰度|分辨率|输出比例|Markdown|photorealistic|commercial photography|真实自然商业摄影质感)/i.test(value)) return false;
  return true;
}

export function buildOutfitFusionDemoResults(template: OutfitFusionTemplate | null, count: number) {
  const fallback = OUTFIT_FUSION_TEMPLATES[0];
  const source = template || fallback;
  const urls = source.resultUrls.length ? source.resultUrls : [source.coverUrl];
  return Array.from({ length: clampOutfitFusionCount(count) }, (_, index) => urls[index % urls.length]);
}
