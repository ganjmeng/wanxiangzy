export type RepairKind = "tryon" | "grass" | "pose" | "model" | "garment3d" | "modelBackground" | "materialEnhancement" | "general";

export type RepairPreset = {
  value: string;
  label: string;
  desc: string;
  prompt: string;
};

const REPAIR_MARKER = "失败修复指令";

export const REPAIR_PRESETS: Record<RepairKind, RepairPreset[]> = {
  general: [
    {
      value: "intent_restore",
      label: "\u610f\u56fe\u8dd1\u504f",
      desc: "\u6ca1\u6309\u7528\u6237\u539f\u59cb\u76ee\u6807\u505a",
      prompt:
        "\u91cd\u70b9\u4fee\u590d\u7528\u6237\u610f\u56fe\uff1a\u4e25\u683c\u6309\u7528\u6237\u539f\u59cb\u8981\u6c42\u751f\u6210\uff0c\u4e0d\u8981\u628a\u4efb\u52a1\u81ea\u52a8\u6539\u6210\u5c0f\u7ea2\u4e66\u79cd\u8349\u56fe\u3001\u8857\u62cd\u56fe\u3001\u6362\u88c5\u56fe\u6216\u666e\u901a\u6444\u5f71\u56fe\uff1b\u5982\u679c\u7528\u6237\u8981\u6c42\u7535\u5546\u8be6\u60c5\u9875/\u4e3b\u56fe/banner\uff0c\u5fc5\u987b\u751f\u6210\u5bf9\u5e94\u7684\u7535\u5546\u7248\u5f0f\u8bbe\u8ba1\u3002",
    },
    {
      value: "product_restore",
      label: "\u4e3b\u4f53\u4e0d\u51c6",
      desc: "\u5546\u54c1\u3001\u670d\u88c5\u6216\u6750\u8d28\u88ab\u6539",
      prompt:
        "\u91cd\u70b9\u4fee\u590d\u4e3b\u4f53\u8fd8\u539f\uff1a\u4fdd\u7559\u53c2\u8003\u56fe\u4e2d\u7684\u6838\u5fc3\u5546\u54c1/\u670d\u88c5\u8eab\u4efd\u3001\u54c1\u7c7b\u3001\u5916\u5f62\u8f6e\u5ed3\u3001\u989c\u8272\u3001\u6750\u8d28\u3001\u7ed3\u6784\u3001logo\u3001\u56fe\u6848\u548c\u5173\u952e\u7ec6\u8282\uff1b\u53ef\u4ee5\u91cd\u65b0\u8bbe\u8ba1\u80cc\u666f\u548c\u7248\u5f0f\uff0c\u4f46\u4e0d\u8981\u6539\u6389\u4e3b\u4f53\u3002",
    },
    {
      value: "layout_hierarchy",
      label: "\u7248\u5f0f\u5c42\u7ea7",
      desc: "\u4e0d\u50cf\u8be6\u60c5\u9875\u6216\u5546\u4e1a\u8bbe\u8ba1",
      prompt:
        "\u91cd\u70b9\u4fee\u590d\u7248\u5f0f\u5c42\u7ea7\uff1a\u753b\u9762\u9700\u6709\u6e05\u6670\u4e3b\u89c6\u89c9\u3001\u6807\u9898\u533a\u3001\u5356\u70b9\u533a\u3001\u7ec6\u8282/\u53c2\u6570\u533a\u548c\u89c6\u89c9\u5206\u533a\uff1b\u50cf\u771f\u6b63\u53ef\u7528\u7684\u7535\u5546\u8bbe\u8ba1\u7a3f\uff0c\u4e0d\u8981\u53ea\u751f\u6210\u4e00\u5f20\u65e0\u7ed3\u6784\u7684\u666e\u901a\u56fe\u7247\u3002",
    },
    {
      value: "text_clean",
      label: "\u6587\u5b57\u592a\u4e71",
      desc: "\u6587\u6848\u3001\u56fe\u6807\u6216\u6807\u9898\u4e0d\u6e05\u695a",
      prompt:
        "\u91cd\u70b9\u4fee\u590d\u6587\u5b57\u548c\u56fe\u6807\uff1a\u4e2d\u6587\u6807\u9898\u548c\u5356\u70b9\u8981\u77ed\u3001\u6e05\u695a\u3001\u50cf\u771f\u5b9e\u7535\u5546\u9875\u9762\uff1b\u907f\u514d\u4e71\u7801\u3001\u4f2a\u6587\u5b57\u3001\u8fc7\u5bc6\u5c0f\u5b57\u548c\u4e0d\u53ef\u8bfb\u56fe\u6807\uff1b\u5b81\u53ef\u5c11\u6587\u5b57\u4e5f\u8981\u4fdd\u6301\u4e13\u4e1a\u5e72\u51c0\u3002",
    },
    {
      value: "composition_ratio",
      label: "\u6784\u56fe\u6bd4\u4f8b",
      desc: "\u753b\u5e45\u3001\u7559\u767d\u6216\u4e3b\u4f53\u6bd4\u4f8b\u4e0d\u597d",
      prompt:
        "\u91cd\u70b9\u4fee\u590d\u6784\u56fe\u6bd4\u4f8b\uff1a\u6839\u636e\u5f53\u524d\u753b\u5e45\u91cd\u65b0\u5b89\u6392\u4e3b\u4f53\u5c3a\u5bf8\u3001\u7559\u767d\u3001\u6587\u5b57\u533a\u548c\u89c6\u89c9\u91cd\u5fc3\uff1b\u4e3b\u4f53\u4e0d\u8981\u8fc7\u5927\u6324\u538b\u7248\u5f0f\uff0c\u4e5f\u4e0d\u8981\u8fc7\u5c0f\u5bfc\u81f4\u5546\u54c1\u4e0d\u6e05\u695a\u3002",
    },
  ],
  tryon: [
    {
      value: "garment_restore",
      label: "衣服还原",
      desc: "款式、颜色、图案被改",
      prompt:
        "重点修复服装还原：严格按服装图编号还原衣服的品类、版型、颜色、图案、logo、纽扣、拉链、口袋、袖口、下摆、面料纹理和搭配关系；允许自然贴合身体产生褶皱，但不要改款、不要换颜色、不要漏掉图案或细节。",
    },
    {
      value: "face_identity",
      label: "人脸身份",
      desc: "脸不像或被换脸",
      prompt:
        "重点修复人物身份：如果有参考人像或模特脸图，必须保持该人物的脸型骨相、五官比例、眼神、肤色、发型和真实辨识度；不要变成随机陌生脸，不要标准网红脸，不要过度美颜。",
    },
    {
      value: "skin_tone",
      label: "肤色过白",
      desc: "雪白皮、冷白皮",
      prompt:
        "重点修复肤色：保留参考人物的自然肤色、冷暖调、明暗层次、局部红润和真实皮肤纹理；不要自动美白，不要雪白皮，不要冷白皮，不要过曝粉白滤镜。",
    },
    {
      value: "body_hands",
      label: "手和肢体",
      desc: "手指、胳膊、比例崩",
      prompt:
        "重点修复身体结构：保持真实人体比例和自然站姿，手指数量正确、手腕手臂连接自然、肩颈腰胯比例稳定；不要断手、错位手指、肢体拉长、腿被过度拉长或姿势扭曲。",
    },
    {
      value: "logo_text",
      label: "Logo 图案",
      desc: "文字、印花模糊",
      prompt:
        "重点修复图案文字：服装上的 logo、印花、文字、刺绣、标签和图案位置必须尽量清晰、完整、位置正确；不要扭曲文字，不要把图案变成噪点，不要新增不存在的标识。",
    },
  ],
  grass: [
    {
      value: "garment_restore",
      label: "服装不准",
      desc: "款式颜色图案被改",
      prompt:
        "重点修复服装还原：严格保持图1服装/穿搭的品类、版型、颜色、图案、logo、纽扣、拉链、口袋、面料纹理、厚度和穿着层次；不要改款、不要换色、不要漏掉关键细节。",
    },
    {
      value: "scene_mood",
      label: "氛围不够",
      desc: "不像种草图",
      prompt:
        "重点修复种草氛围：增强真实生活方式场景、自然光影、松弛姿势和社媒分享感；画面有审美但不要假棚拍，不要 AI 渲染感。",
    },
    {
      value: "pose_body",
      label: "姿势肢体",
      desc: "动作或手脚崩",
      prompt:
        "重点修复人体姿势：模特动作自然可信，手指数量正确，肩颈、手臂、腰胯、腿部比例真实稳定；不要肢体扭曲、断手、错位手指或过度拉长身体。",
    },
    {
      value: "model_face",
      label: "模特不好",
      desc: "脸、肤色、气质不自然",
      prompt:
        "重点修复模特表现：模特应真实自然，肤色不过白，脸型和五官不模板化，表情松弛有亲和力，符合真实穿搭分享而不是网红假脸。",
    },
    {
      value: "clarity",
      label: "画质细节",
      desc: "糊、噪点、细节少",
      prompt:
        "重点修复画质：提升服装边缘、面料纹理、图案文字、肤色层次和整体清晰度；保持自然摄影质感，避免噪点、糊边、过曝和过度锐化。",
    },
  ],
  materialEnhancement: [
    {
      value: "detail_only",
      label: "只改细节",
      desc: "人物、背景、构图被改动",
      prompt:
        "重点修复材质增强边界：只允许增强图1可见服装区域的面料纹理、织纹层次、缝线、压线、纽扣、拉链、五金、刺绣、logo边缘和已有褶皱可见度；人物身份、五官、发型、肤色、身体比例、姿势、手脚、背景、构图、镜头距离、画幅、透视、光线方向、曝光、阴影和景深必须完全不变。",
    },
    {
      value: "style_shape_restore",
      label: "款式还原",
      desc: "服装版型或颜色被改",
      prompt:
        "重点修复服装保真：保持图1服装款式、版型、轮廓、长度、穿着位置、固有颜色、图案位置、logo形状和位置不变；图2只能补充材质细节，不能把图1重绘成另一件商品，也不能新增口袋、纽扣、拉链、文字、装饰或图案。",
    },
    {
      value: "natural_texture",
      label: "材质自然",
      desc: "锐化、纹理或高频细节太假",
      prompt:
        "重点修复材质自然度：材质增强要像真实相机下的局部细节恢复，避免全图锐化、HDR、强局部反差、塑料感、油画感、AI渲染感、摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维和不存在的面料纹理。",
    },
  ],
  pose: [
    {
      value: "four_panel",
      label: "四宫格",
      desc: "没出四格",
      prompt:
        "重点修复四宫格：必须生成单张图片里的 2x2 四宫格 contact sheet，四个分格分别是姿势1、姿势2、姿势3、姿势4；不要生成单张普通照片，不要拆成多张图，不要少于四个姿势。",
    },
    {
      value: "pose_variety",
      label: "姿势太像",
      desc: "像复制粘贴",
      prompt:
        "重点修复姿势差异：四个分格保持同一人同一衣服同一镜头，但动作需要明显且自然地区分：正面站立、轻微侧身、重心偏移、一格轻微迈步或转身；不要复制粘贴同一姿势。",
    },
    {
      value: "face_consistency",
      label: "脸不一致",
      desc: "四格不像同一个人",
      prompt:
        "重点修复人脸一致性：四个分格必须保持图1同一个人物身份、同一脸型骨相、同一五官比例、同一肤色范围和同一发型；只允许轻微自然表情变化，不要换脸。",
    },
    {
      value: "clothing_consistency",
      label: "衣服变了",
      desc: "四格衣服不一致",
      prompt:
        "重点修复服装一致性：四个分格必须保持同一套服装的版型、颜色、图案、材质、长度、开口位置和搭配关系；动作可造成自然褶皱，但不要改结构、不要换款。",
    },
    {
      value: "body_hands",
      label: "肢体手指",
      desc: "动作崩坏",
      prompt:
        "重点修复肢体：四个姿势必须符合真人关节运动，手指自然、四肢比例稳定、肩颈腰胯真实；不要断手、错位手指、夸张扭腰、身体拉长或头身比例漂移。",
    },
  ],
  model: [
    {
      value: "fusion_identity",
      label: "融合不够",
      desc: "只像一张或陌生脸",
      prompt:
        "重点修复多图融合：参考图可能来自同一个人也可能来自不同人物，必须综合融合脸型骨相、五官比例、眼神气质、肤色、妆感、年龄感和面部氛围，生成一个新的稳定专属模特身份；不要只复制单张图，也不要平均成无记忆点陌生脸。",
    },
    {
      value: "face_shape",
      label: "脸型跑偏",
      desc: "变鹅蛋脸、小V脸",
      prompt:
        "重点修复脸型骨相：保留参考图中的脸长宽比例、颧骨、下颌线、下巴形状、额头宽度和面部骨相倾向；不要自动变成标准鹅蛋脸、小V脸、尖下巴或网红审美。",
    },
    {
      value: "skin_tone",
      label: "肤色过白",
      desc: "默认美白",
      prompt:
        "重点修复肤色：从参考图提取自然肤色范围、冷暖调、明暗层次和局部红润；不要默认美白，不要雪白皮，不要冷白皮，不要把亚洲肤色统一变成瓷白。",
    },
    {
      value: "makeup_style",
      label: "妆感丢失",
      desc: "妆造不像参考",
      prompt:
        "重点修复妆感：参考底妆质感、眉形、眼妆轮廓、睫毛、腮红、修容高光、唇形、唇色和整体妆容浓淡；妆容自然真实，贴合商业模特摄影，不要无妆感也不要夸张网红妆。",
    },
    {
      value: "skin_texture",
      label: "皮肤太假",
      desc: "蜡像、过度磨皮",
      prompt:
        "重点修复真实质感：保留自然皮肤纹理、毛孔、细微瑕疵、真实反光和年龄感；不要过度磨皮，不要塑料皮肤，不要蜡像感，不要 AI 头像感。",
    },
  ],
  garment3d: [
    {
      value: "shape_restore",
      label: "款式还原",
      desc: "3D 改款式",
      prompt:
        "重点修复款式还原：严格保留图1服装的品类、版型、轮廓、颜色、长度、开口位置、领口、袖口、裤腰、下摆、口袋、拉链、纽扣和所有结构细节；只增加立体体积，不改变设计。",
    },
    {
      value: "material_volume",
      label: "厚度材质",
      desc: "太平、没体积",
      prompt:
        "重点修复立体材质：强化布料厚度、袖身体积、肩线支撑、自然撑起效果、褶皱、缝线纹理、面料光泽和垂坠；看起来像真实商业棚拍的 3D 服装展示。",
    },
    {
      value: "logo_text",
      label: "Logo 清晰",
      desc: "文字图案糊",
      prompt:
        "重点修复图案文字：图1服装上的 logo、文字、印花、刺绣、标签和图案必须尽量清晰完整、位置正确；不要扭曲文字，不要新增图案，不要把标识变形。",
    },
    {
      value: "no_human",
      label: "不要真人",
      desc: "出现头脸手身体",
      prompt:
        "重点修复无真人展示：只生成服装本体的立体展示，可像隐形人台撑起，但不要出现真人身体、头部、脸、手、皮肤、头发或多余人物。",
    },
    {
      value: "clean_background",
      label: "背景干净",
      desc: "场景杂乱",
      prompt:
        "重点修复背景：使用干净白色或浅灰棚拍背景，主体居中，边缘干净，柔和自然阴影；不要生成房间、街景、模特、道具或杂乱场景。",
    },
  ],
  modelBackground: [
    {
      value: "natural_blend",
      label: "自然融合",
      desc: "人和背景割裂",
      prompt:
        "重点修复自然融合：统一光线方向、色温、曝光、景深、透视、人物尺度、脚下接触阴影和边缘过渡；不要贴纸感、不要白边硬边、不要漂浮。",
    },
    {
      value: "clothing_preserve",
      label: "服装不变",
      desc: "服装被改了",
      prompt:
        "重点修复服装还原：严格保持图1原始服装的品类、版型、颜色、图案、logo、面料纹理和所有细节不变；只允许背景或模特脸变化。",
    },
    {
      value: "background_quality",
      label: "背景质量",
      desc: "背景模糊或假",
      prompt:
        "重点修复背景质量：背景参考图的场景、光线、色温、空间透视和构图氛围要真实还原，匹配商业摄影质感；不要模糊、不要拼接痕迹、不要AI渲染感。",
    },
  ],
};

export function applyRepairPrompt(prompt: string, kind: RepairKind, repairValue: string) {
  const preset = REPAIR_PRESETS[kind].find((item) => item.value === repairValue);
  if (!preset) return prompt;

  const cleaned = removeRepairPrompt(prompt);
  return `${cleaned.trim()}\n${REPAIR_MARKER}：${preset.label}。${preset.prompt}`.trim();
}

export function removeRepairPrompt(prompt: string) {
  return prompt
    .split("\n")
    .filter((line) => !line.includes(REPAIR_MARKER))
    .join("\n")
    .trim();
}
