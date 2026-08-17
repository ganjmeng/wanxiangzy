import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { AiToolCreateRequestFor } from "@/lib/ai-tools/types";
import {
  buildGenerativeAiToolPrompt,
  AiToolGenerativeInputError,
  createNativeInpaintMaskBuffer,
  createOutpaintGuidanceBuffers,
  getGenerativeAiToolTask,
  submitGenerativeAiToolTask,
} from "@/lib/api/ai-tools/generative-provider.server";

describe("AI tool internal generative provider", () => {
  it("queues a selected published model through the existing debited generation pipeline", async () => {
    const request: AiToolCreateRequestFor<"repair-garment"> = {
      request_id: "request-garment-1234",
      operation: "repair-garment",
      source_url: "https://oss.example.com/source.png",
      mask_url: "https://oss.example.com/source-mask.png",
      reference_urls: ["https://oss.example.com/reference.png"],
      reference_mask_url: "https://oss.example.com/reference-mask.png",
      options: {
        model: "gpt-image-2",
        reference_type: "model",
        preserve_logo: true,
        repair_mode: "detail",
        mask_feather: 8,
        output_format: "png",
      },
    };
    const createGeneration = vi.fn().mockResolvedValue({
      generationId: "00000000-0000-4000-8000-000000000111",
      creditsRemaining: 96,
    });
    const startGeneration = vi.fn();
    const client = {} as Pick<SupabaseClient, "from" | "rpc">;
    const nativeMaskUrl = "https://oss.example.com/native-source-mask.png";

    const result = await submitGenerativeAiToolTask(request, { userId: "user-1", client }, {
      createGeneration,
      startGeneration,
      getCreditCost: vi.fn().mockResolvedValue(4),
      prepareInputs: vi.fn().mockResolvedValue({
        imageInputs: [
          request.source_url,
          request.mask_url!,
          request.reference_urls[0],
          request.reference_mask_url!,
        ],
        nativeMaskUrl,
      }),
    });

    expect(createGeneration).toHaveBeenCalledWith(client, expect.objectContaining({
      userId: "user-1",
      aiModel: "gpt-image-2",
      imageSize: "2K",
      creditsCost: 4,
      clothingUrls: [
        request.source_url,
        request.mask_url,
        request.reference_urls[0],
        request.reference_mask_url,
      ],
      jobPayload: expect.objectContaining({
        kind: "generalImage",
        mode: "image-to-image",
        aiModel: "gpt-image-2",
        imageSize: "2K",
        genCount: 1,
        aiTool: expect.objectContaining({
          requestId: request.request_id,
          operation: request.operation,
          nativeMaskUrl,
        }),
      }),
    }));
    expect(startGeneration).toHaveBeenCalledWith(result.task_id);
    expect(result).toMatchObject({
      status: "queued",
      provider: "generative-image-edit",
      capability: "inpaint",
      credits_cost: 4,
      credits_remaining: 96,
      billing_status: "debited",
    });
  });

  it("builds explicit source, target-mask, reference, and reference-mask roles", () => {
    const request: AiToolCreateRequestFor<"repair-footwear"> = {
      request_id: "request-footwear-1234",
      operation: "repair-footwear",
      source_url: "https://oss.example.com/source.png",
      mask_url: "https://oss.example.com/source-mask.png",
      reference_urls: ["https://oss.example.com/reference.png"],
      reference_mask_url: "https://oss.example.com/reference-mask.png",
      options: {
        model: "nano-banana-2",
        preserve_logo: true,
        mask_feather: 8,
        output_format: "png",
      },
    };

    const prompt = buildGenerativeAiToolPrompt(request);

    expect(prompt).toContain("图1");
    expect(prompt).toContain("图2是黑底白色编辑蒙版");
    expect(prompt).toContain("图3是鞋靴商品参考图");
    expect(prompt).toContain("图4是图3的黑底白色参考选区");
    expect(prompt).toContain("黑色区域严禁变化");
  });

  it("builds pixel-aligned outpaint canvas and semantic/native masks", async () => {
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    }).png().toBuffer();
    const guidance = await createOutpaintGuidanceBuffers(source, {
      model: "nano-banana-2",
      target_width: 4,
      target_height: 4,
      position_x: 1,
      position_y: 0.5,
      source_scale: 1,
      anchor: "center",
      mask_feather: 0,
      prompt: "",
      output_format: "png",
    });

    expect(guidance).toMatchObject({ left: 2, top: 1, placedWidth: 2, placedHeight: 2 });
    const [canvas, semanticMask, nativeMask] = await Promise.all([
      sharp(guidance.canvas).ensureAlpha().raw().toBuffer(),
      sharp(guidance.semanticMask).removeAlpha().raw().toBuffer(),
      sharp(guidance.nativeMask).ensureAlpha().raw().toBuffer(),
    ]);
    expect(rgbaAt(canvas, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(rgbaAt(canvas, 4, 2, 1)).toEqual([255, 0, 0, 255]);
    expect(rgbAt(semanticMask, 4, 0, 0)).toEqual([255, 255, 255]);
    expect(rgbAt(semanticMask, 4, 2, 1)).toEqual([0, 0, 0]);
    expect(rgbaAt(nativeMask, 4, 0, 0)[3]).toBe(0);
    expect(rgbaAt(nativeMask, 4, 2, 1)[3]).toBe(255);
  });

  it("rejects an outpaint placement that cannot fit before credit debit", async () => {
    const source = await sharp({
      create: {
        width: 4,
        height: 6,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    }).png().toBuffer();

    await expect(createOutpaintGuidanceBuffers(source, {
      model: "nano-banana-2",
      target_width: 3,
      target_height: 3,
      position_x: 0.5,
      position_y: 0.5,
      source_scale: 1,
      anchor: "center",
      mask_feather: 0,
      prompt: "",
      output_format: "png",
    })).rejects.toEqual(expect.objectContaining<Partial<AiToolGenerativeInputError>>({
      code: "AI_TOOL_OUTPAINT_SOURCE_OUT_OF_BOUNDS",
      status: 400,
      retryable: false,
    }));
  });

  it("converts semantic white edit pixels into transparent native mask pixels", async () => {
    const semanticMask = await sharp(Buffer.from([
      0, 0, 0,
      255, 255, 255,
    ]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
    const nativeMask = await createNativeInpaintMaskBuffer(semanticMask);
    const pixels = await sharp(nativeMask).ensureAlpha().raw().toBuffer();

    expect(rgbaAt(pixels, 2, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(rgbaAt(pixels, 2, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it("reads only the owned generation and adapts a completed result for AI tool persistence", async () => {
    const query = createGenerationQuery({
      status: "completed",
      result_urls: ["https://oss.example.com/generated/result.png"],
      error_message: null,
      job_payload: { kind: "generalImage", genCount: 1 },
      completed_at: "2026-08-18T00:00:00.000Z",
      credits_cost: 6,
    });

    const result = await getGenerativeAiToolTask(
      "00000000-0000-4000-8000-000000000111",
      {
        userId: "user-1",
        client: { from: vi.fn(() => query) } as unknown as Pick<SupabaseClient, "from" | "rpc">,
        operation: "erase",
        requestId: "request-erase-1234",
      },
    );

    expect(query.eq).toHaveBeenNthCalledWith(1, "id", "00000000-0000-4000-8000-000000000111");
    expect(query.eq).toHaveBeenNthCalledWith(2, "user_id", "user-1");
    expect(result).toMatchObject({
      request_id: "request-erase-1234",
      operation: "erase",
      status: "completed",
      progress: 100,
      result_urls: ["https://oss.example.com/generated/result.png"],
      outputs: [{ role: "result", kind: "image", mime_type: null, dimensions: null }],
      credits_cost: 6,
      billing_status: "debited",
    });
  });
});

function rgbaAt(buffer: Buffer, width: number, x: number, y: number) {
  const offset = (y * width + x) * 4;
  return Array.from(buffer.subarray(offset, offset + 4));
}

function rgbAt(buffer: Buffer, width: number, x: number, y: number) {
  const offset = (y * width + x) * 3;
  return Array.from(buffer.subarray(offset, offset + 3));
}

function createGenerationQuery(data: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}
