import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCreditCost, normalizeAspectRatio, normalizeImageSize, normalizeLingyaModel, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import {
  createDebitedGeneration,
  errorToResponsePayload,
} from "@/lib/api/credits";
import { startGenerationJob, type GenerationJobPayload } from "@/lib/api/generation-jobs";
import { handleGenerationStatusGet } from "@/lib/api/generation-status";
import { getPublicBaseUrlFromRequest } from "@/lib/api/image-inputs.server";
import { type PoseOutputMode } from "@/lib/pose-prompt";
import { normalizePoseVisualAnalysis } from "@/lib/pose-analysis";
import { normalizePosePlan } from "@/lib/pose-plan";
import { normalizePoseSeriesStyle } from "@/lib/module-style-presets";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { MAX_GARMENT_DETAIL_IMAGES, normalizeGarmentDetailUrls } from "@/lib/garment-detail-references";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const limit = await checkRateLimit(`pose:${user.id}`, 20, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime-validated below
    let body: any;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
    const { main_image_url, ai_model, image_size, prompt, pose_style } = body;
    const garmentDetailInput = body.garment_detail_urls ?? body.garmentDetailUrls;
    const requestedOutputMode = body.output_mode ?? body.outputMode;
    const outputMode: PoseOutputMode = requestedOutputMode === "grid" ? "grid" : "separate";
    const genCount = outputMode === "separate" ? normalizePoseCount(body.gen_count ?? body.count ?? 4) : 1;
    if (!main_image_url || typeof main_image_url !== "string") return NextResponse.json({ error: "缺少主图" }, { status: 400 });
    if (!prompt?.trim()) return NextResponse.json({ error: "缺少提示词" }, { status: 400 });
    if (
      garmentDetailInput !== undefined &&
      (
        !Array.isArray(garmentDetailInput) ||
        garmentDetailInput.length > MAX_GARMENT_DETAIL_IMAGES ||
        garmentDetailInput.some((url) => typeof url !== "string")
      )
    ) {
      return NextResponse.json({ error: `服装细节图最多 ${MAX_GARMENT_DETAIL_IMAGES} 张` }, { status: 400 });
    }
    const garmentDetailUrls = normalizeGarmentDetailUrls(garmentDetailInput);

    const model: LingyaModel = normalizeLingyaModel(ai_model);
    const aspectRatio: AspectRatio = normalizeAspectRatio(body.aspect_ratio || body.aspectRatio || "auto", "auto");
    const size: ImageSize = normalizeImageSize(model, image_size || "1K", aspectRatio);
    const unitCost = getCreditCost(model, size, aspectRatio);
    const totalCost = unitCost * genCount;
    const poseStyle = normalizePoseSeriesStyle(pose_style);
    const posePlanMode = body.pose_plan_mode === "ai" || body.posePlanMode === "ai" ? "ai" : "preset";
    const poseAnalysis = normalizePoseVisualAnalysis(body.pose_analysis ?? body.poseAnalysis);
    const posePlan = body.pose_plan || body.posePlan
      ? normalizePosePlan(body.pose_plan ?? body.posePlan, {
          poseAnalysis,
          poseStyle,
          outputMode,
          prompt: String(prompt).trim(),
        })
      : null;
    const jobPayload: GenerationJobPayload = {
      kind: "pose",
      publicBaseUrl: getPublicBaseUrlFromRequest(request),
      mainImageUrl: main_image_url,
      aiModel: model,
      aspectRatio,
      imageSize: size,
      prompt: String(prompt).trim(),
      poseStyle,
      posePlanMode,
      outputMode,
      genCount,
      poseAnalysis,
      posePlan,
      garmentDetailUrls,
    };

    const debit = await createDebitedGeneration(supabase, {
      userId: user.id,
      clothingUrls: [main_image_url, ...garmentDetailUrls],
      modelFaceUrl: null,
      referenceUrl: null,
      creditsCost: totalCost,
      aiModel: model,
      imageSize: size,
      reason: `姿势裂变${outputMode === "separate" ? " · 每姿势一张" : ""}${garmentDetailUrls.length ? ` · ${garmentDetailUrls.length} 张服装细节` : ""} (${model}, ${size})`,
      jobPayload,
    });

    startGenerationJob(debit.generationId);

    return NextResponse.json({
      generation_id: debit.generationId,
      credits_cost: totalCost,
      credits_remaining: debit.creditsRemaining,
      status: "processing_tryon",
    });
  } catch (err: unknown) {
    console.error("[pose] POST error:", err instanceof Error ? err.message : err);
    const payload = errorToResponsePayload(err);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

function normalizePoseCount(value: unknown) {
  const num = Number(value || 4);
  if (!Number.isFinite(num)) return 4;
  return Math.min(Math.max(Math.floor(num), 1), 4);
}

export async function GET(request: NextRequest) {
  return handleGenerationStatusGet(request.nextUrl.searchParams.get("generation_id"));
}
