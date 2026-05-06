import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { understandImages } from "@/lib/agent/brain/image-understanding";
import { createBrainTrace } from "@/lib/agent/brain/trace";
import type { WorkflowInputImage } from "@/lib/agent/workflow/types";
import type { ChatImageRole } from "@/lib/agent/types";

const workflowImageSchema = z.object({
  index: z.number().int().positive().optional(),
  url: z.string().min(1),
  role: z.string().optional(),
  fileName: z.string().optional(),
});

const requestContextSchema = z.object({
  userText: z.string().optional(),
  images: z.array(workflowImageSchema).optional(),
}).passthrough();

const describeAttachedImagesInputSchema = z.object({
  userText: z.string().optional().describe("The user's latest question or task."),
});

const describeAttachedImagesOutputSchema = z.object({
  kind: z.literal("image_context"),
  found: z.boolean(),
  message: z.string(),
  summary: z.string().optional(),
  confidence: z.number().optional(),
  source: z.string().optional(),
  images: z.array(z.object({
    index: z.number(),
    role: z.string(),
    roleConfidence: z.number(),
    fileName: z.string().optional(),
    subject: z.string().optional(),
    garment: z.string().optional(),
    background: z.string().optional(),
    styleTags: z.array(z.string()),
    risks: z.array(z.string()),
  })).optional(),
});

export const describeAttachedImagesTool = createTool({
  id: "describeAttachedImages",
  description: [
    "Understand the images attached to the current user message.",
    "Use this when the user refers to image numbers, asks what an image is, or a visual workflow needs role disambiguation.",
    "Do not call this for plain chat with no image reference.",
  ].join(" "),
  inputSchema: describeAttachedImagesInputSchema,
  outputSchema: describeAttachedImagesOutputSchema,
  requestContextSchema,
  execute: async (input, context) => {
    const contextText = context.requestContext?.get("userText") as string | undefined;
    const contextImages = context.requestContext?.get("images") as WorkflowInputImage[] | undefined;
    const images = normalizeWorkflowImages(contextImages);
    if (!images.length) {
      return {
        kind: "image_context" as const,
        found: false,
        message: "No attached images are available in the current turn.",
      };
    }

    try {
      const trace = createBrainTrace();
      const result = await understandImages({
        userText: (input.userText || contextText || "").trim(),
        images: images.map((image) => ({
          index: image.index,
          url: image.url,
          role: toChatImageRole(image.role),
          fileName: image.fileName,
        })),
        trace,
      });

      if (!result) {
        return {
          kind: "image_context" as const,
          found: true,
          message: `Found ${images.length} attached image(s), but vision understanding did not return details.`,
          images: images.map((image) => ({
            index: image.index,
            role: String(image.role || "auto"),
            roleConfidence: image.role && image.role !== "auto" ? 0.9 : 0.35,
            fileName: image.fileName,
            styleTags: [],
            risks: ["Vision understanding unavailable."],
          })),
        };
      }

      return {
        kind: "image_context" as const,
        found: true,
        message: `Understood ${result.images.length} attached image(s).`,
        summary: result.summary,
        confidence: result.confidence,
        source: result.source,
        images: result.images.map((item) => {
          const original = images.find((image) => image.index === item.index);
          return {
            index: item.index,
            role: item.role,
            roleConfidence: item.roleConfidence,
            fileName: original?.fileName,
            subject: item.subject,
            garment: item.garment,
            background: item.background,
            styleTags: item.styleTags,
            risks: item.risks,
          };
        }),
      };
    } catch (error) {
      console.error("[mastra:describeAttachedImages] failed:", error);
      return {
        kind: "image_context" as const,
        found: true,
        message: error instanceof Error ? error.message : "Image understanding failed.",
        images: images.map((image) => ({
          index: image.index,
          role: String(image.role || "auto"),
          roleConfidence: image.role && image.role !== "auto" ? 0.9 : 0.35,
          fileName: image.fileName,
          styleTags: [],
          risks: ["Used attachment metadata fallback."],
        })),
      };
    }
  },
});

function normalizeWorkflowImages(images: unknown): WorkflowInputImage[] {
  if (!Array.isArray(images)) return [];

  const normalized: WorkflowInputImage[] = [];
  const seen = new Set<string>();
  for (const [index, image] of images.entries()) {
    if (!image || typeof image !== "object") continue;
    const record = image as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push({
      index: typeof record.index === "number" ? record.index : index + 1,
      url,
      role: typeof record.role === "string" ? record.role as WorkflowInputImage["role"] : "auto",
      fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    });
  }

  return normalized.slice(0, 8).map((image, index) => ({ ...image, index: index + 1 }));
}

function toChatImageRole(role: WorkflowInputImage["role"]): ChatImageRole | undefined {
  if (!role) return undefined;
  if (["auto", "clothing", "reference", "face", "background", "source"].includes(role)) {
    return role as ChatImageRole;
  }
  return "auto";
}
