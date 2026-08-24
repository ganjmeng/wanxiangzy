export const GENERATION_PENDING_STATUS_FILTERS = ["pending", "queued"] as const;
export const GENERATION_PROCESSING_STATUS_FILTERS = ["processing", "processing_tryon", "processing_face_swap", "processing_batch", "running", "generating"] as const;
export const GENERATION_RUNNING_STATUS_FILTERS = [
  ...GENERATION_PENDING_STATUS_FILTERS,
  ...GENERATION_PROCESSING_STATUS_FILTERS,
] as const;
export const GENERATION_COMPLETED_STATUS_FILTERS = ["completed", "succeeded", "success"] as const;
export const GENERATION_FAILED_STATUS_FILTERS = ["failed", "error", "cancelled", "canceled", "needs_review"] as const;

export function normalizeGenerationStatus(status?: string | null) {
  const normalized = normalizeStatusText(status);
  if (GENERATION_COMPLETED_STATUS_FILTERS.includes(normalized as typeof GENERATION_COMPLETED_STATUS_FILTERS[number])) return "completed";
  if (GENERATION_FAILED_STATUS_FILTERS.includes(normalized as typeof GENERATION_FAILED_STATUS_FILTERS[number])) return "failed";
  if (GENERATION_PENDING_STATUS_FILTERS.includes(normalized as typeof GENERATION_PENDING_STATUS_FILTERS[number])) return "pending";
  if (isProcessingStatus(normalized)) return "processing";
  return normalized;
}

export function isRunningStatus(status: string) {
  const normalized = normalizeStatusText(status);
  return isProcessingStatus(normalized) ||
    GENERATION_PENDING_STATUS_FILTERS.includes(normalized as typeof GENERATION_PENDING_STATUS_FILTERS[number]);
}

function isProcessingStatus(status: string) {
  return GENERATION_PROCESSING_STATUS_FILTERS.includes(status as typeof GENERATION_PROCESSING_STATUS_FILTERS[number]) ||
    status.startsWith("processing_");
}

function normalizeStatusText(status?: string | null) {
  return typeof status === "string" && status.trim().length > 0 ? status.trim().toLowerCase() : "pending";
}
