export const AI_TOOL_SLUGS = [
  "matting",
  "upscale",
  "outpaint",
  "erase",
  "repair-limbs",
  "repair-garment",
  "repair-footwear",
  "resize",
] as const;

export type AiToolSlug = (typeof AI_TOOL_SLUGS)[number];

export type AiToolProvider =
  | "aliyun-segmentation"
  | "aliyun-image-enhancement"
  | "generative-image-edit"
  | "sharp";

export type AiToolCapability =
  | "segment"
  | "upscale"
  | "outpaint"
  | "inpaint"
  | "resize";

export type AiToolOutputFormat = "png" | "jpeg" | "webp";
export const AI_TOOL_GENERATIVE_MODELS = [
  "nano-banana-2",
  "gpt-image-2",
  "nano-banana-pro",
  "qwen3",
  "qwen3-pro",
] as const;
export type AiToolGenerativeModel = (typeof AI_TOOL_GENERATIVE_MODELS)[number];
export function isAiToolGenerativeModel(value: string): value is AiToolGenerativeModel {
  return AI_TOOL_GENERATIVE_MODELS.includes(value as AiToolGenerativeModel);
}
export type AiToolExecutionMode = "mock" | "live";
export type AiToolTaskStatus = "queued" | "processing" | "completed" | "failed";

/** Semantic role used by the editor to decide how an output should be rendered. */
export type AiToolOutputRole = "result" | "mask" | "alpha" | "preview";

/** Pixel data carried by the output asset. */
export type AiToolOutputKind = "image" | "mask" | "alpha";

export type AiToolOutputMimeType = "image/png" | "image/jpeg" | "image/webp";

export type AiToolOutputDimensions = {
  width: number;
  height: number;
};

export type AiToolOutput = {
  url: string;
  role: AiToolOutputRole;
  kind: AiToolOutputKind;
  /** Null only for legacy result_urls responses where metadata is unavailable. */
  mime_type: AiToolOutputMimeType | null;
  /** Null only for legacy result_urls responses where metadata is unavailable. */
  dimensions: AiToolOutputDimensions | null;
};

export type AiToolTaskError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type AiToolCatalogEntry = {
  readonly slug: AiToolSlug;
  readonly label: string;
  readonly description: string;
  readonly provider: AiToolProvider;
  readonly capability: AiToolCapability;
  readonly requiresMask: boolean;
  readonly acceptsMask: boolean;
  /** Includes the source image, but excludes a mask image. */
  readonly maxImages: number;
  readonly outputFormats: readonly AiToolOutputFormat[];
};

export type MattingOptions = {
  subject: "auto" | "general" | "person" | "product" | "clothing" | "pattern";
  background: "transparent" | "white" | "custom";
  background_color?: string;
  edge_refinement: "standard" | "fine";
  output_format: Extract<AiToolOutputFormat, "png" | "webp">;
};

export type UpscaleOptions = {
  scale: 2 | 4;
  denoise: "off" | "low" | "medium";
  face_enhance: boolean;
  preserve_text: boolean;
  allow_non_ai_fallback: boolean;
  output_format: AiToolOutputFormat;
};

export type OutpaintOptions = {
  /** Defaults to nano-banana-2 for older clients. */
  model?: AiToolGenerativeModel;
  target_width: number;
  target_height: number;
  /** Legacy placement preset retained for gateways that have not adopted normalized positions. */
  anchor: "center" | "top" | "bottom" | "left" | "right";
  /** Authoritative normalized source position within the canvas' free horizontal space. */
  position_x: number;
  /** Authoritative normalized source position within the canvas' free vertical space. */
  position_y: number;
  /** Uniform scale applied to the canonical source before placing it on the target canvas. */
  source_scale?: number;
  prompt?: string;
  mask_feather: number;
  output_format: AiToolOutputFormat;
};

export type EraseOptions = {
  /** Defaults to nano-banana-2 for older clients. */
  model?: AiToolGenerativeModel;
  instruction?: string;
  mask_feather: number;
  output_format: AiToolOutputFormat;
  quality: "fast" | "standard";
};

type RepairOptions = Omit<EraseOptions, "quality">;

export type RepairLimbsOptions = RepairOptions & {
  preserve_identity: boolean;
  /** Normalized repair target. Older clients may omit it and are normalized to both. */
  target: "hands" | "feet" | "both";
};

export type RepairGarmentOptions = RepairOptions & {
  reference_type: "flat" | "model";
  preserve_logo: boolean;
  repair_mode: "style" | "detail";
};

export type RepairFootwearOptions = RepairOptions & {
  preserve_logo: boolean;
};

export type ResizeOptions = {
  width: number;
  height: number;
  fit: "contain" | "cover" | "fill";
  /** Normalized focal point used by cover cropping. */
  position_x?: number;
  position_y?: number;
  /** Optional explicit source-space crop chosen in the canvas editor. */
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  background_color?: string;
  output_format: AiToolOutputFormat;
  quality: number;
  without_enlargement: boolean;
};

export type AiToolOptionsBySlug = {
  matting: MattingOptions;
  upscale: UpscaleOptions;
  outpaint: OutpaintOptions;
  erase: EraseOptions;
  "repair-limbs": RepairLimbsOptions;
  "repair-garment": RepairGarmentOptions;
  "repair-footwear": RepairFootwearOptions;
  resize: ResizeOptions;
};

export type AiToolCreateRequestFor<TSlug extends AiToolSlug> = {
  request_id: string;
  operation: TSlug;
  source_url: string;
  mask_url?: string;
  reference_urls: string[];
  /** Optional signed mask for the single reference image used by repair tools. */
  reference_mask_url?: string;
  options: AiToolOptionsBySlug[TSlug];
};

export type AiToolCreateRequest = {
  [TSlug in AiToolSlug]: AiToolCreateRequestFor<TSlug>;
}[AiToolSlug];

export type AiToolValidationIssue = {
  path: string;
  code:
    | "invalid_type"
    | "invalid_value"
    | "missing_field"
    | "unknown_field"
    | "limit_exceeded";
  message: string;
};

export type AiToolParseResult =
  | { ok: true; data: AiToolCreateRequest }
  | { ok: false; issues: AiToolValidationIssue[] };

export type AiToolProviderStatus = {
  provider: AiToolProvider;
  capability: AiToolCapability;
  requested_mode: string;
  execution_mode: AiToolExecutionMode;
  available: boolean;
  configured: boolean;
  mock: boolean;
  reason:
    | "READY"
    | "MOCK_READY"
    | "NOT_CONFIGURED"
    | "INVALID_CONFIGURATION"
    | "INVALID_EXECUTION_MODE"
    | "MOCK_DISABLED_IN_PRODUCTION";
  message: string;
};

export type AiToolSubmitResult = {
  task_id: string;
  request_id: string;
  operation: AiToolSlug;
  status: AiToolTaskStatus;
  stage: string;
  progress: number;
  expected_count: 1;
  result_urls: string[];
  outputs: AiToolOutput[];
  warnings: string[];
  error: AiToolTaskError | null;
  execution_mode: AiToolExecutionMode;
  provider: AiToolProvider;
  capability: AiToolCapability;
  provider_status?: string;
  external_request_id?: string;
  credits_cost?: number;
  credits_remaining?: number;
  billing_status?: "debited" | "not_debited";
};

const REQUEST_KEYS = new Set([
  "request_id",
  "operation",
  "source_url",
  "mask_url",
  "reference_urls",
  "reference_mask_url",
  "options",
]);
const MAX_IMAGE_PIXELS = 32_000_000;
const MAX_URL_LENGTH = 2_048;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isAiToolSlug(value: unknown): value is AiToolSlug {
  return typeof value === "string" && (AI_TOOL_SLUGS as readonly string[]).includes(value);
}

export function isAiToolTaskId(value: unknown): value is string {
  return typeof value === "string" && TASK_ID_PATTERN.test(value);
}

export function parseAiToolCreateRequest(value: unknown): AiToolParseResult {
  const issues: AiToolValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "$", code: "invalid_type", message: "请求体必须是 JSON 对象" }],
    };
  }

  rejectUnknownKeys(value, REQUEST_KEYS, "$", issues);
  const requestId = readRequiredString(value, "request_id", "$", issues);
  if (requestId && !REQUEST_ID_PATTERN.test(requestId)) {
    issues.push({
      path: "$.request_id",
      code: "invalid_value",
      message: "request_id 需为 8-120 位字母、数字、点、下划线、冒号或连字符",
    });
  }

  const operationValue = value.operation;
  const operation = isAiToolSlug(operationValue) ? operationValue : null;
  if (!operation) {
    issues.push({
      path: "$.operation",
      code: operationValue === undefined ? "missing_field" : "invalid_value",
      message: "operation 不是受支持的 AI 工具",
    });
  }

  const sourceUrl = readImageUrl(value.source_url, "$.source_url", true, issues);
  const maskUrl = readImageUrl(value.mask_url, "$.mask_url", false, issues);
  const referenceUrls = readReferenceUrls(value.reference_urls, issues);
  const referenceMaskUrl = readImageUrl(value.reference_mask_url, "$.reference_mask_url", false, issues);
  if (sourceUrl && referenceUrls.includes(sourceUrl)) {
    issues.push({
      path: "$.reference_urls",
      code: "invalid_value",
      message: "参考图不能与原图重复",
    });
  }

  const rawOptions = value.options === undefined ? {} : value.options;
  if (!isRecord(rawOptions)) {
    issues.push({ path: "$.options", code: "invalid_type", message: "options 必须是 JSON 对象" });
  }
  const options = operation && isRecord(rawOptions)
    ? parseOptions(operation, rawOptions, issues)
    : null;

  if (operation && options) {
    validateReferenceMaskRules(operation, referenceUrls, referenceMaskUrl, options, issues);
  }

  if (issues.length || !requestId || !operation || !sourceUrl || !options) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    data: {
      request_id: requestId,
      operation,
      source_url: sourceUrl,
      ...(maskUrl ? { mask_url: maskUrl } : {}),
      reference_urls: referenceUrls,
      ...(referenceMaskUrl ? { reference_mask_url: referenceMaskUrl } : {}),
      options,
    } as AiToolCreateRequest,
  };
}

function parseOptions<TSlug extends AiToolSlug>(
  operation: TSlug,
  value: Record<string, unknown>,
  issues: AiToolValidationIssue[],
): AiToolOptionsBySlug[TSlug] | null {
  switch (operation) {
    case "matting": {
      rejectUnknownKeys(value, new Set([
        "subject", "background", "background_color", "edge_refinement", "output_format",
      ]), "$.options", issues);
      const background = readEnum(value, "background", ["transparent", "white", "custom"] as const, "transparent", issues);
      const backgroundColor = readOptionalColor(value, "background_color", issues);
      if (background === "custom" && !backgroundColor) {
        issues.push({
          path: "$.options.background_color",
          code: "missing_field",
          message: "自定义背景需要 background_color",
        });
      }
      return {
        subject: readEnum(value, "subject", ["auto", "general", "person", "product", "clothing", "pattern"] as const, "auto", issues),
        background,
        ...(backgroundColor ? { background_color: backgroundColor } : {}),
        edge_refinement: readEnum(value, "edge_refinement", ["standard", "fine"] as const, "standard", issues),
        output_format: readEnum(value, "output_format", ["png", "webp"] as const, "png", issues),
      } as AiToolOptionsBySlug[TSlug];
    }
    case "upscale":
      rejectUnknownKeys(value, new Set([
        "scale", "denoise", "face_enhance", "preserve_text", "allow_non_ai_fallback", "output_format",
      ]), "$.options", issues);
      return {
        scale: readEnum(value, "scale", [2, 4] as const, 2, issues),
        denoise: readEnum(value, "denoise", ["off", "low", "medium"] as const, "low", issues),
        face_enhance: readBoolean(value, "face_enhance", false, issues),
        preserve_text: readBoolean(value, "preserve_text", true, issues),
        allow_non_ai_fallback: readBoolean(value, "allow_non_ai_fallback", false, issues),
        output_format: readOutputFormat(value, "png", issues),
      } as AiToolOptionsBySlug[TSlug];
    case "outpaint": {
      rejectUnknownKeys(value, new Set([
        "model", "target_width", "target_height", "anchor", "position_x", "position_y", "source_scale", "prompt", "mask_feather", "output_format",
      ]), "$.options", issues);
      const targetWidth = readInteger(value, "target_width", 64, 8_192, undefined, issues);
      const targetHeight = readInteger(value, "target_height", 64, 8_192, undefined, issues);
      validatePixelLimit(targetWidth, targetHeight, issues);
      const anchor = readEnum(
        value,
        "anchor",
        ["center", "top", "bottom", "left", "right"] as const,
        "center",
        issues,
      );
      const legacyPosition = outpaintAnchorPosition(anchor);
      return {
        model: readEnum(value, "model", AI_TOOL_GENERATIVE_MODELS, "nano-banana-2", issues),
        target_width: targetWidth,
        target_height: targetHeight,
        anchor,
        position_x: readNumber(value, "position_x", 0, 1, legacyPosition.x, issues),
        position_y: readNumber(value, "position_y", 0, 1, legacyPosition.y, issues),
        source_scale: readNumber(value, "source_scale", 0.05, 16, 1, issues),
        ...readOptionalTextProperty(value, "prompt", 1_200, issues),
        mask_feather: readInteger(value, "mask_feather", 0, 128, 8, issues),
        output_format: readOutputFormat(value, "png", issues),
      } as AiToolOptionsBySlug[TSlug];
    }
    case "erase":
      rejectUnknownKeys(value, new Set(["model", "instruction", "mask_feather", "output_format", "quality"]), "$.options", issues);
      return {
        model: readEnum(value, "model", AI_TOOL_GENERATIVE_MODELS, "nano-banana-2", issues),
        ...readOptionalTextProperty(value, "instruction", 1_200, issues),
        mask_feather: readInteger(value, "mask_feather", 0, 128, 8, issues),
        output_format: readOutputFormat(value, "png", issues),
        quality: readEnum(value, "quality", ["fast", "standard"] as const, "standard", issues),
      } as AiToolOptionsBySlug[TSlug];
    case "repair-limbs":
      rejectUnknownKeys(value, new Set([
        "model", "instruction", "mask_feather", "output_format", "preserve_identity", "target",
      ]), "$.options", issues);
      return {
        model: readEnum(value, "model", AI_TOOL_GENERATIVE_MODELS, "nano-banana-2", issues),
        ...readOptionalTextProperty(value, "instruction", 1_200, issues),
        mask_feather: readInteger(value, "mask_feather", 0, 128, 8, issues),
        output_format: readOutputFormat(value, "png", issues),
        preserve_identity: readBoolean(value, "preserve_identity", true, issues),
        target: readEnum(value, "target", ["hands", "feet", "both"] as const, "both", issues),
      } as AiToolOptionsBySlug[TSlug];
    case "repair-garment":
      rejectUnknownKeys(value, new Set([
        "model", "instruction", "mask_feather", "output_format", "reference_type", "preserve_logo", "repair_mode",
      ]), "$.options", issues);
      return {
        model: readEnum(value, "model", AI_TOOL_GENERATIVE_MODELS, "nano-banana-2", issues),
        ...readOptionalTextProperty(value, "instruction", 1_200, issues),
        mask_feather: readInteger(value, "mask_feather", 0, 128, 8, issues),
        output_format: readOutputFormat(value, "png", issues),
        reference_type: readRequiredEnum(value, "reference_type", ["flat", "model"] as const, "flat", issues),
        preserve_logo: readBoolean(value, "preserve_logo", true, issues),
        repair_mode: readEnum(value, "repair_mode", ["style", "detail"] as const, "style", issues),
      } as AiToolOptionsBySlug[TSlug];
    case "repair-footwear":
      rejectUnknownKeys(value, new Set([
        "model", "instruction", "mask_feather", "output_format", "preserve_logo",
      ]), "$.options", issues);
      return {
        model: readEnum(value, "model", AI_TOOL_GENERATIVE_MODELS, "nano-banana-2", issues),
        ...readOptionalTextProperty(value, "instruction", 1_200, issues),
        mask_feather: readInteger(value, "mask_feather", 0, 128, 8, issues),
        output_format: readOutputFormat(value, "png", issues),
        preserve_logo: readBoolean(value, "preserve_logo", true, issues),
      } as AiToolOptionsBySlug[TSlug];
    case "resize": {
      rejectUnknownKeys(value, new Set([
        "width", "height", "fit", "position_x", "position_y", "crop_x", "crop_y", "crop_width", "crop_height", "background_color", "output_format", "quality", "without_enlargement",
      ]), "$.options", issues);
      const width = readInteger(value, "width", 1, 8_192, undefined, issues);
      const height = readInteger(value, "height", 1, 8_192, undefined, issues);
      validatePixelLimit(width, height, issues);
      const backgroundColor = readOptionalColor(value, "background_color", issues);
      const cropKeys = ["crop_x", "crop_y", "crop_width", "crop_height"] as const;
      const hasCrop = cropKeys.some((key) => value[key] !== undefined);
      if (hasCrop && cropKeys.some((key) => value[key] === undefined)) {
        issues.push({
          path: "$.options",
          code: "missing_field",
          message: "crop_x、crop_y、crop_width、crop_height 必须同时提供",
        });
      }
      return {
        width,
        height,
        fit: readEnum(value, "fit", ["contain", "cover", "fill"] as const, "contain", issues),
        position_x: readNumber(value, "position_x", 0, 1, 0.5, issues),
        position_y: readNumber(value, "position_y", 0, 1, 0.5, issues),
        ...(hasCrop ? {
          crop_x: readNumber(value, "crop_x", 0, 8_192, 0, issues),
          crop_y: readNumber(value, "crop_y", 0, 8_192, 0, issues),
          crop_width: readNumber(value, "crop_width", 1, 8_192, 1, issues),
          crop_height: readNumber(value, "crop_height", 1, 8_192, 1, issues),
        } : {}),
        ...(backgroundColor ? { background_color: backgroundColor } : {}),
        output_format: readOutputFormat(value, "png", issues),
        quality: readInteger(value, "quality", 1, 100, 92, issues),
        without_enlargement: readBoolean(value, "without_enlargement", false, issues),
      } as AiToolOptionsBySlug[TSlug];
    }
  }
}

function validateReferenceMaskRules(
  operation: AiToolSlug,
  referenceUrls: string[],
  referenceMaskUrl: string | undefined,
  options: AiToolOptionsBySlug[AiToolSlug],
  issues: AiToolValidationIssue[],
) {
  if (operation !== "repair-garment" && operation !== "repair-footwear") {
    if (referenceMaskUrl) {
      issues.push({
        path: "$.reference_mask_url",
        code: "invalid_value",
        message: "当前 AI 工具不接受参考图蒙版",
      });
    }
    return;
  }

  if (referenceUrls.length !== 1) {
    issues.push({
      path: "$.reference_urls",
      code: referenceUrls.length ? "limit_exceeded" : "missing_field",
      message: `${operation === "repair-garment" ? "服饰修复" : "鞋靴修复"}需要且仅接受 1 张参考商品图`,
    });
  }

  if (operation === "repair-footwear") {
    if (!referenceMaskUrl) {
      issues.push({
        path: "$.reference_mask_url",
        code: "missing_field",
        message: "鞋靴修复需要参考商品图选区蒙版",
      });
    }
    return;
  }

  const garment = options as RepairGarmentOptions;
  const needsReferenceMask = garment.repair_mode === "detail" || garment.reference_type === "model";
  if (needsReferenceMask && !referenceMaskUrl) {
    issues.push({
      path: "$.reference_mask_url",
      code: "missing_field",
      message: garment.repair_mode === "detail"
        ? "服饰细节修复需要参考图局部选区蒙版"
        : "人台或模特参考图需要服饰选区蒙版",
    });
  }
  if (!needsReferenceMask && referenceMaskUrl) {
    issues.push({
      path: "$.reference_mask_url",
      code: "invalid_value",
      message: "款式修复的平铺参考图不接受参考选区蒙版",
    });
  }
}

function outpaintAnchorPosition(anchor: OutpaintOptions["anchor"]) {
  if (anchor === "left") return { x: 0, y: 0.5 };
  if (anchor === "right") return { x: 1, y: 0.5 };
  if (anchor === "top") return { x: 0.5, y: 0 };
  if (anchor === "bottom") return { x: 0.5, y: 1 };
  return { x: 0.5, y: 0.5 };
}

function readReferenceUrls(value: unknown, issues: AiToolValidationIssue[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({ path: "$.reference_urls", code: "invalid_type", message: "reference_urls 必须是数组" });
    return [];
  }
  if (value.length > 7) {
    issues.push({ path: "$.reference_urls", code: "limit_exceeded", message: "参考图最多 7 张" });
  }
  const urls = value.slice(0, 7).map((item, index) =>
    readImageUrl(item, `$.reference_urls[${index}]`, true, issues),
  ).filter((item): item is string => Boolean(item));
  if (new Set(urls).size !== urls.length) {
    issues.push({ path: "$.reference_urls", code: "invalid_value", message: "参考图不能重复" });
  }
  return urls;
}

function readImageUrl(
  value: unknown,
  path: string,
  required: boolean,
  issues: AiToolValidationIssue[],
) {
  if (value === undefined || value === null || value === "") {
    if (required) issues.push({ path, code: "missing_field", message: `${path.split(".").pop()} 不能为空` });
    return undefined;
  }
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) {
    issues.push({ path, code: "invalid_type", message: "图片地址格式无效" });
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || isPrivateHost(url.hostname)) {
      throw new Error("unsafe URL");
    }
    return url.toString();
  } catch {
    issues.push({ path, code: "invalid_value", message: "图片地址必须是可公开访问的 HTTP(S) URL" });
    return undefined;
  }
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] >= 224;
}

function readRequiredString(
  value: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: AiToolValidationIssue[],
) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    issues.push({
      path: `${parentPath}.${key}`,
      code: raw === undefined ? "missing_field" : "invalid_type",
      message: `${key} 必须是非空字符串`,
    });
    return undefined;
  }
  return raw.trim();
}

function readOptionalTextProperty(
  value: Record<string, unknown>,
  key: "prompt" | "instruction",
  maxLength: number,
  issues: AiToolValidationIssue[],
): { prompt?: string } | { instruction?: string } {
  const raw = value[key];
  if (raw === undefined || raw === "") return {};
  if (typeof raw !== "string" || raw.trim().length > maxLength) {
    issues.push({
      path: `$.options.${key}`,
      code: "invalid_value",
      message: `${key} 必须是不超过 ${maxLength} 字的字符串`,
    });
    return {};
  }
  return { [key]: raw.trim() };
}

function readBoolean(
  value: Record<string, unknown>,
  key: string,
  fallback: boolean,
  issues: AiToolValidationIssue[],
) {
  const raw = value[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "boolean") {
    issues.push({ path: `$.options.${key}`, code: "invalid_type", message: `${key} 必须是布尔值` });
    return fallback;
  }
  return raw;
}

function readInteger(
  value: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fallback: number | undefined,
  issues: AiToolValidationIssue[],
) {
  const raw = value[key];
  if (raw === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(raw) || Number(raw) < min || Number(raw) > max) {
    issues.push({
      path: `$.options.${key}`,
      code: raw === undefined ? "missing_field" : "invalid_value",
      message: `${key} 必须是 ${min}-${max} 的整数`,
    });
    return fallback ?? min;
  }
  return Number(raw);
}

function readNumber(
  value: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fallback: number,
  issues: AiToolValidationIssue[],
) {
  const raw = value[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min || raw > max) {
    issues.push({
      path: `$.options.${key}`,
      code: "invalid_value",
      message: `${key} 必须是 ${min}-${max} 的数字`,
    });
    return fallback;
  }
  return raw;
}

function readEnum<TValue extends string | number>(
  value: Record<string, unknown>,
  key: string,
  values: readonly TValue[],
  fallback: TValue,
  issues: AiToolValidationIssue[],
) {
  const raw = value[key];
  if (raw === undefined) return fallback;
  if (!values.includes(raw as TValue)) {
    issues.push({
      path: `$.options.${key}`,
      code: "invalid_value",
      message: `${key} 仅支持 ${values.join("、")}`,
    });
    return fallback;
  }
  return raw as TValue;
}

function readRequiredEnum<TValue extends string | number>(
  value: Record<string, unknown>,
  key: string,
  values: readonly TValue[],
  fallback: TValue,
  issues: AiToolValidationIssue[],
) {
  if (value[key] === undefined) {
    issues.push({
      path: `$.options.${key}`,
      code: "missing_field",
      message: `${key} 不能为空`,
    });
    return fallback;
  }
  return readEnum(value, key, values, fallback, issues);
}

function readOutputFormat(
  value: Record<string, unknown>,
  fallback: AiToolOutputFormat,
  issues: AiToolValidationIssue[],
) {
  return readEnum(value, "output_format", ["png", "jpeg", "webp"] as const, fallback, issues);
}

function readOptionalColor(
  value: Record<string, unknown>,
  key: string,
  issues: AiToolValidationIssue[],
) {
  const raw = value[key];
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" || !HEX_COLOR_PATTERN.test(raw)) {
    issues.push({ path: `$.options.${key}`, code: "invalid_value", message: `${key} 必须是十六进制颜色` });
    return undefined;
  }
  return raw.toLowerCase();
}

function validatePixelLimit(width: number, height: number, issues: AiToolValidationIssue[]) {
  if (width * height > MAX_IMAGE_PIXELS) {
    issues.push({
      path: "$.options",
      code: "limit_exceeded",
      message: "目标图片不能超过 3200 万像素",
    });
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  issues: AiToolValidationIssue[],
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, code: "unknown_field", message: `不支持字段 ${key}` });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
