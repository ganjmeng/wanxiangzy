import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getAgentKnowledgeContext } from "@/lib/agent/brain/knowledge";
import {
  getAgentUserPreferences,
  upsertAgentUserPreferences,
} from "@/lib/agent/brain/preferences";

const requestContextSchema = z.object({
  userId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
  userText: z.string().optional(),
}).passthrough();

const getUserContextInputSchema = z.object({
  query: z.string().optional().describe("Search query for relevant brand or project knowledge."),
});

const getUserContextOutputSchema = z.object({
  kind: z.literal("user_context"),
  ok: z.boolean(),
  message: z.string(),
  preferences: z.record(z.string(), z.unknown()),
  knowledge: z.array(z.object({
    id: z.string(),
    scope: z.string(),
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    priority: z.number(),
  })),
});

const rememberPreferenceInputSchema = z.object({
  brandStyle: z.string().optional(),
  styleNotes: z.array(z.string()).optional(),
  negativeRules: z.array(z.string()).optional(),
  outputDefaults: z.object({
    model: z.string().optional(),
    aspectRatio: z.string().optional(),
    imageSize: z.string().optional(),
    count: z.number().int().min(1).max(8).optional(),
    poseOutputMode: z.enum(["grid", "separate"]).optional(),
  }).optional(),
});

const rememberPreferenceOutputSchema = z.object({
  kind: z.literal("preference_memory"),
  ok: z.boolean(),
  message: z.string(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export const getUserContextTool = createTool({
  id: "getUserContext",
  description: [
    "Load persistent user preferences and relevant brand/project knowledge.",
    "Use this for visual planning, style-sensitive tasks, or when the user asks what you remember.",
  ].join(" "),
  inputSchema: getUserContextInputSchema,
  outputSchema: getUserContextOutputSchema,
  requestContextSchema,
  execute: async (input, context) => {
    const userId = context.requestContext?.get("userId") as string | undefined;
    const conversationId = context.requestContext?.get("conversationId") as string | null | undefined;
    const userText = context.requestContext?.get("userText") as string | undefined;
    if (!userId) {
      return {
        kind: "user_context" as const,
        ok: false,
        message: "Missing authenticated user context.",
        preferences: {},
        knowledge: [],
      };
    }

    const [preferences, knowledge] = await Promise.all([
      getAgentUserPreferences(userId),
      getAgentKnowledgeContext({
        userId,
        conversationId: conversationId || null,
        query: input.query || userText || "",
        limit: 8,
      }),
    ]);

    return {
      kind: "user_context" as const,
      ok: true,
      message: knowledge.length
        ? `Loaded preferences and ${knowledge.length} knowledge item(s).`
        : "Loaded preferences. No matching knowledge items found.",
      preferences: preferences as Record<string, unknown>,
      knowledge: knowledge.map((item) => ({
        id: item.id,
        scope: item.scope,
        title: item.title,
        content: item.content.slice(0, 700),
        tags: item.tags,
        priority: item.priority,
      })),
    };
  },
});

export const rememberPreferenceTool = createTool({
  id: "rememberPreference",
  description: [
    "Persist explicit user preferences for future workflows.",
    "Use only when the user clearly asks you to remember a style, rule, default output setting, or brand preference.",
  ].join(" "),
  inputSchema: rememberPreferenceInputSchema,
  outputSchema: rememberPreferenceOutputSchema,
  requestContextSchema,
  execute: async (input, context) => {
    const userId = context.requestContext?.get("userId") as string | undefined;
    if (!userId) {
      return {
        kind: "preference_memory" as const,
        ok: false,
        message: "Missing authenticated user context.",
      };
    }

    const hasPatch = Boolean(
      input.brandStyle ||
      input.styleNotes?.length ||
      input.negativeRules?.length ||
      input.outputDefaults,
    );
    if (!hasPatch) {
      return {
        kind: "preference_memory" as const,
        ok: false,
        message: "No preference patch was provided.",
      };
    }

    const preferences = await upsertAgentUserPreferences(userId, {
      brandStyle: input.brandStyle,
      styleNotes: input.styleNotes,
      negativeRules: input.negativeRules,
      outputDefaults: input.outputDefaults,
    }, "manual");

    return {
      kind: "preference_memory" as const,
      ok: true,
      message: "Preference saved for future agent workflows.",
      preferences: preferences as Record<string, unknown>,
    };
  },
});
