import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createDebitedGeneration, errorToResponsePayload } from "@/lib/api/credits";
import { startGenerationJob, type GenerationJobPayload } from "@/lib/api/generation-jobs";
import { handleGenerationStatusGet } from "@/lib/api/generation-status";
import { getPublicBaseUrlFromRequest } from "@/lib/api/image-inputs.server";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import {
  getAiVideoTemplate,
  normalizeAiVideoAudioMode,
  normalizeAiVideoAspectRatio,
  normalizeAiVideoDuration,
  normalizeAiVideoGenCount,
  normalizeAiVideoModelMode,
  normalizeAiVideoResolution,
} from "@/lib/ai-video";
import {
  clampVideoDuration,
  resolveUpstreamVideoModel,
  resolveVideoSelection,
} from "@/lib/api/video-catalog";
import { getEnabledVideoProviders } from "@/lib/api/video-provider";
import { normalizeVideoProviderName } from "@/lib/api/video-provider-registry";
import { getConfiguredVideoCreditCost } from "@/lib/ai-control-plane/server";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const limit = await checkRateLimit(`video-image-to-video:${user.id}`, 12, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

    let body: Record<string, unknown>;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }

    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const requestedMode = normalizeAiVideoModelMode(body.modelMode, "videoImageToVideo");
    const requestedResolution = normalizeAiVideoResolution(body.resolution, requestedMode);
    const duration = normalizeAiVideoDuration(body.duration);
    const genCount = normalizeAiVideoGenCount(body.genCount);
    const templateId = Number(body.templateId || 0) || undefined;
    const aspectRatio = normalizeAiVideoAspectRatio(body.aspectRatio);
    const audioMode = normalizeAiVideoAudioMode(body.audioMode);
    const audioUrl = typeof body.audioUrl === "string" ? body.audioUrl.trim() : "";
    const audioPrompt = typeof body.audioPrompt === "string" ? body.audioPrompt.trim() : "";
    const template = getAiVideoTemplate(templateId);

    if (!imageUrl) return NextResponse.json({ error: "请先上传图片" }, { status: 400 });
    if (!prompt) return NextResponse.json({ error: "请输入动作描述或选择动作模板" }, { status: 400 });
    if (audioMode === "custom" && !audioUrl) return NextResponse.json({ error: "请先上传音频或切换为智能音效" }, { status: 400 });

    const provider = normalizeVideoProviderName(body.provider);
    const enabledProviders = await getEnabledVideoProviders();
    if (!enabledProviders.includes(provider)) {
      return NextResponse.json({ error: "该视频模型未启用，请到后台 /admin/providers 配置" }, { status: 400 });
    }
    const selection = resolveVideoSelection(provider, requestedMode, requestedResolution);
    const modelMode = selection.mode;
    const resolution = selection.resolution;
    const effectiveDuration = clampVideoDuration(provider, duration) as typeof duration;
    const aiModel = resolveUpstreamVideoModel(provider, modelMode, resolution);
    const totalCost = await getConfiguredVideoCreditCost({
      provider,
      modelMode,
      resolution,
      duration: effectiveDuration,
      genCount,
      audioMode,
    });
    const jobPayload: GenerationJobPayload = {
      kind: "videoImageToVideo",
      publicBaseUrl: getPublicBaseUrlFromRequest(request),
      provider,
      imageUrl,
      prompt,
      templateId,
      templateTitle: template?.title,
      modelMode,
      duration: effectiveDuration,
      resolution,
      aspectRatio,
      audioMode,
      audioUrl: audioMode === "custom" ? audioUrl : undefined,
      audioPrompt,
      generateAudio: audioMode !== "off",
      aiModel,
      genCount,
    };

    const debit = await createDebitedGeneration(supabase, {
      userId: user.id,
      clothingUrls: [imageUrl],
      modelFaceUrl: null,
      referenceUrl: null,
      creditsCost: totalCost,
      aiModel,
      imageSize: `${resolution} · ${aspectRatio} · ${effectiveDuration}s`,
      reason: `图生视频 (${modelMode}, ${aiModel}, ${resolution}, ${aspectRatio}, ${effectiveDuration}s, ${getAudioReasonLabel(audioMode)} × ${genCount})`,
      jobPayload,
      idempotencyKey: request.headers.get("idempotency-key") || "",
      mediaInputs: [
        { url: imageUrl, kind: "image" as const },
        ...(audioMode === "custom" && audioUrl ? [{ url: audioUrl, kind: "audio" as const }] : []),
      ],
      publicBaseUrl: jobPayload.publicBaseUrl,
    });

    startGenerationJob(debit.generationId);

    return NextResponse.json({
      generation_id: debit.generationId,
      credits_cost: totalCost,
      credits_remaining: debit.creditsRemaining,
      status: "processing_tryon",
    });
  } catch (err: unknown) {
    console.error("[video:image-to-video] POST error:", err instanceof Error ? err.message : err);
    const payload = errorToResponsePayload(err);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

function getAudioReasonLabel(audioMode: string) {
  if (audioMode === "custom") return "custom audio";
  if (audioMode === "off") return "silent";
  return "generated audio";
}

export async function GET(request: NextRequest) {
  return handleGenerationStatusGet(request.nextUrl.searchParams.get("generation_id"));
}
