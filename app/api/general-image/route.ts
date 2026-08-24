import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  normalizeAspectRatio,
  normalizeImageSize,
  normalizeLingyaModel,
  type ImageSize,
  type LingyaModel,
} from "@/lib/api/lingya";
import { getConfiguredImageCreditCost } from "@/lib/ai-control-plane/server";
import { createDebitedGeneration, errorToResponsePayload } from "@/lib/api/credits";
import { startGenerationJob, type GenerationJobPayload } from "@/lib/api/generation-jobs";
import { handleGenerationStatusGet } from "@/lib/api/generation-status";
import { getPublicBaseUrlFromRequest } from "@/lib/api/image-inputs.server";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import {
  MAX_GENERAL_IMAGE_OUTPUT_COUNT,
  MAX_GENERAL_IMAGE_SPLIT_REFERENCES,
} from "@/lib/general-image-config";
import { buildOutfitFusionRuntimePlan, type OutfitFusionAsset, type OutfitFusionConfig } from "@/lib/outfit-fusion";
import {
  containsInlineImageUrl,
  findDisallowedProductionImageInputs,
  isGeneralImageReferenceUrl,
  normalizeGeneralImageReferenceUrls,
} from "@/lib/api/general-image-inputs";
import { resolveGeneralImageReferences } from "@/lib/api/general-image-inputs.server";
import { attachGenerationToCreativeRun } from "@/lib/api/creative-runtime";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCreativeRunExecutionContext } from "@/lib/creative-skills.server";

export const maxDuration = 60;

type GeneralImageMode = "text-to-image" | "image-to-image";
type GeneralImageModuleKind = "generalImage" | "outfitFusion";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const limit = await checkRateLimit(`general-image:${user.id}`, 20, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
    }

    const mode = normalizeMode(body.mode);
    let prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    let runImagePreferences: Record<string, unknown> = {};
    const creativeRunId = typeof body.creative_run_id === "string" ? body.creative_run_id.trim() : "";
    if (creativeRunId) {
      const execution = await getCreativeRunExecutionContext(getAdminClient(), { userId: user.id, runId: creativeRunId, fallbackPrompt: prompt });
      prompt = execution.prompt;
      runImagePreferences = execution.generationPreferences.image && typeof execution.generationPreferences.image === "object"
        ? execution.generationPreferences.image as Record<string, unknown>
        : {};
    }
    const userPrompt = typeof body.user_prompt === "string" && body.user_prompt.trim()
      ? body.user_prompt.trim().slice(0, 1200)
      : typeof body.input_prompt === "string" && body.input_prompt.trim()
        ? body.input_prompt.trim().slice(0, 1200)
        : undefined;
    if (!prompt) return NextResponse.json({ error: "请输入提示词" }, { status: 400 });

    const normalizedReferences = normalizeGeneralImageReferenceUrls(body.reference_urls);
    const publicBaseUrl = getPublicBaseUrlFromRequest(request);
    const resolvedReferences = await resolveGeneralImageReferences(normalizedReferences.urls, {
      userId: user.id,
      supabase,
      publicBaseUrl,
    });
    if (process.env.NODE_ENV === "production") {
      const disallowedInputs = [
        ...resolvedReferences.disallowed,
        ...findDisallowedProductionImageInputs(body.input_assets, publicBaseUrl),
      ];
      if (normalizedReferences.hasInlineImage || containsInlineImageUrl(body.input_assets) || disallowedInputs.length) {
        return NextResponse.json({ error: "生产环境参考图必须使用已验证的媒体资产或站点素材" }, { status: 400 });
      }
    }
    const referenceUrls = resolvedReferences.urls;
    if (mode === "image-to-image" && referenceUrls.length === 0) {
      return NextResponse.json({ error: "请先上传参考图" }, { status: 400 });
    }

    const model: LingyaModel = normalizeLingyaModel(body.ai_model || "nano-banana-2");
    const aspectRatio = normalizeAspectRatio(runImagePreferences.aspectRatio || body.aspect_ratio || "auto");
    const requestedImageSize = typeof runImagePreferences.imageSize === "string" ? runImagePreferences.imageSize : typeof body.image_size === "string" ? body.image_size : "1K";
    const size: ImageSize = normalizeImageSize(model, requestedImageSize as ImageSize, aspectRatio);
    const genCount = Math.min(Math.max(Math.floor(Number(runImagePreferences.count ?? body.gen_count) || 1), 1), MAX_GENERAL_IMAGE_OUTPUT_COUNT);
    const moduleKind = normalizeModuleKind(body.module_kind || body.module);
    const wantsOnePerReference = mode === "image-to-image"
      && moduleKind === "generalImage"
      && body.one_per_reference === true;
    if (wantsOnePerReference && referenceUrls.length > MAX_GENERAL_IMAGE_SPLIT_REFERENCES) {
      return NextResponse.json({
        error: `每张参考图单独生成最多支持 ${MAX_GENERAL_IMAGE_SPLIT_REFERENCES} 张输入图`,
      }, { status: 400 });
    }
    const onePerReference = wantsOnePerReference
      && referenceUrls.length > 1;
    const costPerImage = await getConfiguredImageCreditCost(model, size);
    const totalCost = costPerImage * genCount * (onePerReference ? referenceUrls.length : 1);
    const outfitFusionAssets = moduleKind === "outfitFusion" ? normalizeOutfitFusionAssets(body.input_assets, referenceUrls) : undefined;
    const outfitFusionAspectRatio: OutfitFusionConfig["aspectRatio"] = aspectRatio === "1:1" || aspectRatio === "3:4" ? aspectRatio : "auto";
    const outfitFusionRuntimePlan = moduleKind === "outfitFusion" && outfitFusionAssets
      ? buildOutfitFusionRuntimePlan({
          assets: outfitFusionAssets,
          prompt,
          userPrompt,
          config: {
            aspectRatio: outfitFusionAspectRatio,
            genCount,
            imageSize: size,
            aiModel: model,
            quality: "hd",
          },
        })
      : null;
    const outfitFusionModelFaceUrl = outfitFusionRuntimePlan?.modelFaceUrl || null;
    const outfitFusionReferenceUrl = outfitFusionRuntimePlan?.referenceUrl || referenceUrls[0] || null;
    const outfitFusionClothingUrls = outfitFusionRuntimePlan?.clothingUrls || [];
    const moduleLabel = moduleKind === "outfitFusion" ? "搭配融图" : "通用生图";
    const creativeContext = await resolveCreativeRunContext(body, user.id);

    const payloadBase = {
      publicBaseUrl,
      mode,
      referenceUrls: mode === "image-to-image"
        ? moduleKind === "outfitFusion"
          ? outfitFusionRuntimePlan?.referenceUrls || referenceUrls
          : referenceUrls
        : [],
      aiModel: model,
      aspectRatio,
      imageSize: size,
      prompt: moduleKind === "outfitFusion" ? outfitFusionRuntimePlan?.prompt || prompt : prompt,
      genCount,
    };
    const jobPayload: GenerationJobPayload = moduleKind === "outfitFusion"
      ? {
          kind: "outfitFusion",
          ...payloadBase,
          userPrompt,
          assets: outfitFusionRuntimePlan?.assets || outfitFusionAssets,
          clothingUrls: outfitFusionClothingUrls,
          modelFaceUrl: outfitFusionModelFaceUrl,
          referenceUrl: outfitFusionReferenceUrl,
        }
      : {
          kind: "generalImage",
          ...payloadBase,
          ...(userPrompt ? { userPrompt } : {}),
          ...(onePerReference ? { onePerReference: true } : {}),
        };

    const mediaInputs = Array.from(new Set([
      ...payloadBase.referenceUrls,
      ...(moduleKind === "outfitFusion" ? outfitFusionClothingUrls : []),
      ...(moduleKind === "outfitFusion" && outfitFusionModelFaceUrl ? [outfitFusionModelFaceUrl] : []),
      ...(moduleKind === "outfitFusion" && outfitFusionReferenceUrl ? [outfitFusionReferenceUrl] : []),
      ...(moduleKind === "outfitFusion" ? (outfitFusionRuntimePlan?.assets || outfitFusionAssets || []).map((asset) => asset.url) : []),
    ])).map((url) => ({ url, kind: "image" as const }));

    const debit = await createDebitedGeneration(supabase, {
      userId: user.id,
      clothingUrls: payloadBase.referenceUrls,
      modelFaceUrl: moduleKind === "outfitFusion" ? outfitFusionModelFaceUrl : null,
      referenceUrl: moduleKind === "outfitFusion" ? outfitFusionReferenceUrl : payloadBase.referenceUrls[0] || null,
      creditsCost: totalCost,
      aiModel: model,
      imageSize: size,
      reason: `${moduleLabel}${mode === "text-to-image" ? "文生图" : "图生图"} ${onePerReference ? genCount * referenceUrls.length : genCount} 张 (${model}, ${size})`,
      jobPayload,
      idempotencyKey: request.headers.get("idempotency-key") || "",
      mediaInputs,
      publicBaseUrl,
    });

    let creativeRunAttached = false;
    if (creativeContext) {
      try {
        await attachGenerationToCreativeRun(getAdminClient(), {
          userId: user.id,
          runId: creativeContext.runId,
          generationId: debit.generationId,
          stepKey: creativeContext.stepKey,
          stepType: "image.generate",
          title: creativeContext.title,
          inputPayload: { mode, model, aspectRatio, imageSize: size, genCount },
          canvasNodeId: creativeContext.canvasNodeId,
        });
        creativeRunAttached = true;
      } catch (error) {
        console.error("[general-image] creative run attach failed:", error instanceof Error ? error.message : error);
      }
    }

    startGenerationJob(debit.generationId);

    return NextResponse.json({
      generation_id: debit.generationId,
      credits_cost: totalCost,
      credits_remaining: debit.creditsRemaining,
      status: "processing_tryon",
      ...(creativeContext ? {
        creative_run_id: creativeContext.runId,
        creative_run_attached: creativeRunAttached,
      } : {}),
    });
  } catch (err: unknown) {
    console.error("[general-image] POST error:", err instanceof Error ? err.message : err);
    const payload = errorToResponsePayload(err);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

async function resolveCreativeRunContext(body: Record<string, unknown>, userId: string) {
  const runId = typeof body.creative_run_id === "string" ? body.creative_run_id.trim() : "";
  if (!runId) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error("创作任务 ID 无效");
  }
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("creative_runs")
    .select("id,status,surface,project_id")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("创作任务不存在或无权访问");
  if (["completed", "failed", "cancelled"].includes(String(data.status))) throw new Error("创作任务已结束");
  const rawStepKey = typeof body.creative_step_key === "string" ? body.creative_step_key.trim() : "";
  const stepKey = /^[A-Za-z0-9._:-]{1,120}$/.test(rawStepKey) ? rawStepKey : `image-${Date.now()}`;
  const canvasNodeId = typeof body.canvas_node_id === "string" && body.canvas_node_id.trim()
    ? body.canvas_node_id.trim().slice(0, 160)
    : undefined;
  return {
    runId,
    stepKey,
    canvasNodeId,
    title: typeof body.creative_step_title === "string" && body.creative_step_title.trim()
      ? body.creative_step_title.trim().slice(0, 300)
      : "Agent 图片生成",
  };
}

export async function GET(request: NextRequest) {
  return handleGenerationStatusGet(request.nextUrl.searchParams.get("generation_id"));
}

function normalizeMode(value: unknown): GeneralImageMode {
  return value === "image-to-image" ? "image-to-image" : "text-to-image";
}

function normalizeModuleKind(value: unknown): GeneralImageModuleKind {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "outfitfusion" || normalized === "outfit-fusion" || normalized === "outfit_fusion") {
    return "outfitFusion";
  }
  return "generalImage";
}

function normalizeOutfitFusionAssets(value: unknown, fallbackUrls: string[]): OutfitFusionAsset[] {
  const fallback = fallbackUrls.map((url, index) => ({
    id: `input-${index}`,
    role: "outfit" as const,
    url,
  }));
  if (!Array.isArray(value)) return fallback;

  const assets = value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!isGeneralImageReferenceUrl(url)) return [];
    const role: OutfitFusionAsset["role"] = record.role === "reference" || record.role === "model" || record.role === "outfit" ? record.role : "outfit";
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 32) : undefined;
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim().slice(0, 80) : `input-${index}`;
    return [{ id, role, url, name }];
  });

  return assets.length ? assets.slice(0, 10) : fallback;
}
