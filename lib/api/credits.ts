import { syncGenerationTaskQueueById } from "@/lib/task-queue-store";
import { getAdminClient } from "@/lib/supabase/admin";

type SupabaseLike = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export class CreditError extends Error {
  status: number;
  required?: number;
  balance?: number;

  constructor(message: string, status = 500, details?: { required?: number; balance?: number }) {
    super(message);
    this.name = "CreditError";
    this.status = status;
    this.required = details?.required;
    this.balance = details?.balance;
  }
}

export async function createDebitedGeneration(
  supabase: SupabaseLike,
  params: {
    userId: string;
    clothingUrls: string[];
    modelFaceUrl?: string | null;
    referenceUrl?: string | null;
    creditsCost: number;
    aiModel: string;
    imageSize: string;
    reason: string;
    jobPayload?: Record<string, unknown>;
  }
): Promise<{ generationId: string; creditsRemaining: number }> {
  await assertUserCanGenerate(params.userId);

  const { data, error } = await supabase.rpc("create_generation_with_credit_debit", {
    p_user_id: params.userId,
    p_clothing_urls: params.clothingUrls,
    p_model_face_url: params.modelFaceUrl ?? null,
    p_reference_url: params.referenceUrl ?? null,
    p_credits_cost: params.creditsCost,
    p_ai_model: params.aiModel,
    p_image_size: params.imageSize,
    p_reason: params.reason,
    p_job_payload: params.jobPayload ?? {},
  });

  if (error) {
    throw normalizeCreditRpcError(error.message, params.creditsCost);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!isDebitedGenerationRow(row)) {
    throw new CreditError("灵点事务返回异常");
  }

  await syncGenerationQueueIndex(row.generation_id, "create");

  return {
    generationId: row.generation_id,
    creditsRemaining: row.credits_remaining,
  };
}

export async function failGenerationWithRefund(
  supabase: SupabaseLike,
  params: {
    userId: string;
    generationId: string;
    amount: number;
    reason: string;
    errorMessage: string;
  }
) {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { error } = await supabase.rpc("fail_generation_with_credit_refund", {
      p_user_id: params.userId,
      p_generation_id: params.generationId,
      p_amount: params.amount,
      p_reason: params.reason,
      p_error_message: params.errorMessage,
    });

    if (!error) {
      await syncGenerationQueueIndex(params.generationId, "fail");
      return;
    }

    if (process.env.NODE_ENV === "development") {
      console.error(`[credits] refund rpc failed (attempt ${attempt}/${maxRetries}):`, error.message);
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  console.error(
    `[credits] CRITICAL: refund failed after ${maxRetries} attempts for generation ${params.generationId}, user ${params.userId}, amount ${params.amount}`
  );
}

export async function assertUserCanGenerate(userId: string) {
  try {
    const { data, error } = await getAdminClient()
      .from("admin_user_controls")
      .select("status,generate_enabled,reason,expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (isMissingUserControlTable(error)) return;
      throw new CreditError(error.message || "用户运营状态检查失败", 500);
    }

    if (!data) return;
    const expiresAt = typeof data.expires_at === "string" ? Date.parse(data.expires_at) : NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return;

    const status = String(data.status || "active").toLowerCase();
    const generateEnabled = data.generate_enabled !== false;
    if (status === "suspended" || !generateEnabled) {
      const reason = typeof data.reason === "string" && data.reason.trim() ? `：${data.reason.trim()}` : "";
      throw new CreditError(`账号已被运营暂停生成${reason}`, 403);
    }
  } catch (error) {
    if (error instanceof CreditError) throw error;
    if (process.env.NODE_ENV === "development") {
      console.warn("[user-control] generation check skipped:", error);
    }
  }
}

function isMissingUserControlTable(error: { code?: string; message?: string }) {
  const message = `${error.code || ""} ${error.message || ""}`.toLowerCase();
  return (
    message.includes("42p01") ||
    message.includes("does not exist") ||
    (message.includes("could not find") && message.includes("admin_user_controls"))
  );
}

export async function completeGenerationWithCreditAdjustment(
  supabase: SupabaseLike,
  params: {
    userId: string;
    generationId: string;
    resultUrls: string[];
    jobPayload: Record<string, unknown>;
    creditsUsed: number;
    refundAmount: number;
    refundReason: string;
    errorMessage?: string | null;
  }
): Promise<boolean> {
  const maxRetries = params.refundAmount > 0 ? 3 : 1;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { error } = await supabase.rpc("complete_generation_with_credit_adjustment", {
      p_user_id: params.userId,
      p_generation_id: params.generationId,
      p_result_urls: params.resultUrls,
      p_job_payload: params.jobPayload,
      p_credits_used: params.creditsUsed,
      p_refund_amount: params.refundAmount,
      p_refund_reason: params.refundReason,
      p_error_message: params.errorMessage ?? null,
    });

    if (!error) {
      await syncGenerationQueueIndex(params.generationId, "complete");
      return true;
    }

    const message = error.message || "";
    if (message.includes("complete_generation_with_credit_adjustment") || message.includes("Could not find the function")) {
      return false;
    }

    if (process.env.NODE_ENV === "development") {
      console.error(`[credits] completion adjustment rpc failed (attempt ${attempt}/${maxRetries}):`, message);
    }

    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  console.error(
    `[credits] CRITICAL: completion credit adjustment failed for generation ${params.generationId}, user ${params.userId}, refund ${params.refundAmount}`
  );
  return false;
}

export function errorToResponsePayload(err: unknown) {
  if (err instanceof CreditError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        required: err.required,
        balance: err.balance,
      },
    };
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  return { status: 500, body: { error: message } };
}

function normalizeCreditRpcError(message = "", required: number) {
  const insufficient = message.match(/INSUFFICIENT_CREDITS:(\d+)/);
  if (insufficient) {
    const balance = Number(insufficient[1]);
    return new CreditError(`灵点不足。需要 ${required}，余额 ${balance}`, 402, {
      required,
      balance,
    });
  }

  if (
    message.includes("create_generation_with_credit_debit") ||
    message.includes("Could not find the function")
  ) {
    return new CreditError("数据库缺少灵点事务函数，请先运行 supabase/atomic-credit-rpc.sql");
  }

  if (/\bNOT_ALLOWED\b/i.test(message)) {
    return new CreditError("登录状态校验失败，请刷新页面后重新登录", 401);
  }

  return new CreditError(message || "灵点事务失败");
}

function isDebitedGenerationRow(
  value: unknown
): value is { generation_id: string; credits_remaining: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { generation_id?: unknown }).generation_id === "string" &&
    typeof (value as { credits_remaining?: unknown }).credits_remaining === "number"
  );
}

async function syncGenerationQueueIndex(generationId: string, phase: string) {
  try {
    await syncGenerationTaskQueueById(generationId);
  } catch (error) {
    console.warn(`[task-queue-index] generation ${phase} sync skipped:`, error);
  }
}
