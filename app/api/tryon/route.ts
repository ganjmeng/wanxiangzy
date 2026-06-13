/**
 * POST /api/tryon — 创建生成任务，立即返回 generation_id
 * GET  /api/tryon?generation_id=xxx — 查询真实进度
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { getCreditCost, isNanoBananaModel, normalizeAspectRatio, normalizeImageSize, normalizeLingyaModel, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import {
  createDebitedGeneration,
  errorToResponsePayload,
} from "@/lib/api/credits";
import { startGenerationJob, type GenerationJobPayload } from "@/lib/api/generation-jobs";
import { handleGenerationStatusGet } from "@/lib/api/generation-status";
import { getPublicBaseUrlFromRequest } from "@/lib/api/image-inputs.server";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import { normalizeAutoDesignSettings, normalizeSceneMode } from "@/lib/tryon-scene";
import { normalizeTryOnClothingAnalysis } from "@/lib/tryon-reference-config";
import { alignTryOnReferenceAnalyses } from "@/lib/tryon-reference-analysis";
import { normalizeTryOnClothingMode, normalizeTryOnClothingRole } from "@/lib/tryon-upload-rules";
import { MAX_GARMENT_DETAIL_IMAGES, normalizeGarmentDetailUrls } from "@/lib/garment-detail-references";
import {
  TRYON_GARMENT_CATEGORY_LABELS,
  normalizeTryOnAgeGroup,
  normalizeTryOnGarmentCategory,
  normalizeTryOnGarmentAudience,
} from "@/lib/tryon-prompt";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const rateLimit = await enforceApiRateLimit(user.id, API_RATE_LIMITS.tryonGenerate);
    if (rateLimit) return rateLimit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime-validated below
    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
    const {
      clothing_urls, model_face_url, reference_url, reference_urls,
      garment_detail_urls,
      ai_model, aspect_ratio, image_size, style, gen_count, raw_prompt, scene_mode, auto_design,
      clothing_mode, clothing_roles, clothing_analysis, reference_analyses, garment_audience, age_group, garment_category, is_intimate_garment,
    } = body;

    const genCount = Math.min(Math.max(Number(gen_count) || 1, 1), 4);

    if (!Array.isArray(clothing_urls) || !clothing_urls.length) {
      return NextResponse.json({ error: "缺少 clothing_urls" }, { status: 400 });
    }
    if (clothing_urls.length > 5 || clothing_urls.some((url) => typeof url !== "string")) {
      return NextResponse.json({ error: "clothing_urls 无效" }, { status: 400 });
    }
    if (
      (model_face_url && typeof model_face_url !== "string") ||
      (reference_url && typeof reference_url !== "string") ||
      (reference_urls !== undefined && !Array.isArray(reference_urls))
    ) {
      return NextResponse.json({ error: "图片参数无效" }, { status: 400 });
    }
    const requestedReferenceUrls = normalizeReferenceUrls(reference_urls, reference_url);
    if (requestedReferenceUrls.some((url) => typeof url !== "string")) {
      return NextResponse.json({ error: "图片参数无效" }, { status: 400 });
    }
    if (
      garment_detail_urls !== undefined &&
      (
        !Array.isArray(garment_detail_urls) ||
        garment_detail_urls.length > MAX_GARMENT_DETAIL_IMAGES ||
        garment_detail_urls.some((url) => typeof url !== "string")
      )
    ) {
      return NextResponse.json({ error: `服装细节图最多 ${MAX_GARMENT_DETAIL_IMAGES} 张` }, { status: 400 });
    }
    const garmentDetailUrls = normalizeGarmentDetailUrls(garment_detail_urls);

    const hasExplicitAiModel = typeof ai_model === "string" && ai_model.trim().length > 0;
    const model: LingyaModel = model_face_url && !hasExplicitAiModel
      ? "gpt-image-2"
      : normalizeLingyaModel(ai_model);
    if (model_face_url && isNanoBananaModel(model)) {
      return NextResponse.json({
        error: "已选择模特脸时，服装上身暂不支持 Banana 模型。请改用 GPT-Image-2；如果想用 Banana 的换装效果，建议先不选模特图完成换装，再到换脸模块处理脸部。",
      }, { status: 400 });
    }
    const aspectRatio = normalizeAspectRatio(aspect_ratio, "auto");
    const size: ImageSize = normalizeImageSize(model, image_size || "1K", aspectRatio);
    const costPerImage = getCreditCost(model, size, aspectRatio);
    const sceneMode = scene_mode === undefined && requestedReferenceUrls.length
      ? "upload_reference"
      : normalizeSceneMode(scene_mode);
    const autoDesign = sceneMode === "auto_design" ? normalizeAutoDesignSettings(auto_design) : undefined;
    const effectiveReferenceUrls = sceneMode === "auto_design" ? [] : requestedReferenceUrls;
    if (sceneMode !== "auto_design" && !effectiveReferenceUrls.length) {
      return NextResponse.json({ error: "请选择至少 1 张参考图" }, { status: 400 });
    }
    const expectedCount = genCount * (effectiveReferenceUrls.length || 1);
    const totalCost = costPerImage * expectedCount;
    const clothingMode = normalizeTryOnClothingMode(clothing_mode || (clothing_urls.length > 1 ? "multi" : "single"));
    const clothingRoles = Array.isArray(clothing_roles)
      ? clothing_urls.map((_: string, index: number) => normalizeTryOnClothingRole(
        clothing_roles[index],
        clothingMode === "multi" ? index === 0 ? "upper" : index === 1 ? "lower" : "extra" : "single"
      ))
      : clothing_urls.map((_: string, index: number) => clothingMode === "multi" ? index === 0 ? "upper" : index === 1 ? "lower" : "extra" : "single");
    const garmentAudience = normalizeTryOnGarmentAudience(garment_audience);
    const ageGroup = normalizeTryOnAgeGroup(age_group);
    const garmentCategory = normalizeTryOnGarmentCategory(is_intimate_garment ? "intimate" : garment_category);
    const clothingAnalysis = clothing_analysis && typeof clothing_analysis === "object"
      ? normalizeTryOnClothingAnalysis(clothing_analysis)
      : null;
    const referenceAnalyses = alignTryOnReferenceAnalyses(reference_analyses, effectiveReferenceUrls.length);
    if (garmentCategory === "intimate" && ageGroup !== "adult") {
      return NextResponse.json({ error: "内衣/泳衣类服装仅支持成人模特生成，请将年龄段改为成人后再提交" }, { status: 400 });
    }
    const jobPayload: GenerationJobPayload = {
      kind: "tryon",
      publicBaseUrl: getPublicBaseUrlFromRequest(request),
      clothingUrls: clothing_urls,
      clothingMode,
      clothingRoles,
      clothingAnalysis,
      garmentDetailUrls,
      garmentAudience,
      ageGroup,
      garmentCategory,
      modelFaceUrl: model_face_url || null,
      referenceUrl: effectiveReferenceUrls[0] || null,
      referenceUrls: effectiveReferenceUrls,
      referenceAnalyses,
      aiModel: model,
      aspectRatio,
      imageSize: size,
      style,
      genCount,
      rawPrompt: raw_prompt,
      sceneMode,
      autoDesign,
    };

    const debit = await createDebitedGeneration(supabase, {
      userId: user.id,
      clothingUrls: clothing_urls,
      modelFaceUrl: model_face_url || null,
      referenceUrl: jobPayload.referenceUrl,
      creditsCost: totalCost,
      aiModel: model,
      imageSize: size,
      reason: `生成 ${expectedCount} 张，输入 ${clothing_urls.length} 件服装、${effectiveReferenceUrls.length || 1} 组参考${garmentDetailUrls.length ? `、${garmentDetailUrls.length} 张细节` : ""} (${model}, ${size}, ${TRYON_GARMENT_CATEGORY_LABELS[garmentCategory]})`,
      jobPayload,
    });

    startGenerationJob(debit.generationId);

    // 立即返回
    return NextResponse.json({
      generation_id: debit.generationId,
      credits_cost: totalCost,
      expected_count: expectedCount,
      credits_remaining: debit.creditsRemaining,
      status: "processing_tryon",
    });

  } catch (err: unknown) {
    logger.error("[tryon] POST error:", err);
    const payload = errorToResponsePayload(err);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

export async function GET(request: NextRequest) {
  return handleGenerationStatusGet(request.nextUrl.searchParams.get("generation_id"));
}

function normalizeReferenceUrls(referenceUrls: unknown, fallbackReferenceUrl: unknown) {
  const values = Array.isArray(referenceUrls) ? referenceUrls : [];
  if (!values.length && typeof fallbackReferenceUrl === "string") values.push(fallbackReferenceUrl);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const url = value.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
    if (normalized.length >= 8) break;
  }
  return normalized;
}
