import { NextResponse } from "next/server";
import { AI_TOOL_CATALOG } from "@/lib/ai-tools/catalog";
import {
  isAiToolTaskId,
  parseAiToolCreateRequest,
  type AiToolCreateRequest,
  type AiToolValidationIssue,
} from "@/lib/ai-tools/types";
import { requireApiUser } from "@/lib/api/auth";
import {
  AiToolProviderError,
  getAiToolTask,
  getAiToolProviderStatus,
  submitAiToolTask,
} from "@/lib/api/ai-tools/provider.server";
import {
  AiToolOutputStorageError,
  persistCompletedAiToolOutputs,
} from "@/lib/api/ai-tools/output-storage.server";
import {
  AiToolInputOwnershipError,
  extractAiToolInputProofs,
  resolveOwnedAiToolSubmission,
} from "@/lib/api/ai-tools/input-ownership.server";
import {
  AiToolTaskRepositoryError,
  beginAiToolTaskSubmission,
  bindAiToolTaskProviderResult,
  findOwnedAiToolTaskByProviderTaskId,
  getReusableAiToolTaskResult,
  markAiToolTaskSubmissionFailed,
  recordAiToolTaskProviderResult,
  type AiToolTaskRecord,
} from "@/lib/api/ai-tools/task-repository.server";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { syncAiToolTaskQueueById } from "@/lib/task-queue-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AI_TOOLS_RATE_LIMIT = 20;
const AI_TOOLS_RATE_WINDOW_MS = 60_000;
const AI_TOOLS_STATUS_RATE_LIMIT = 120;

export async function GET(request: Request) {
  const { supabase, user, response: authResponse } = await requireApiUser();
  if (!user) return authResponse;

  const limit = await checkRateLimit(
    `ai-tools-status:${user.id}`,
    AI_TOOLS_STATUS_RATE_LIMIT,
    AI_TOOLS_RATE_WINDOW_MS,
  );
  if (!limit.ok) {
    return rateLimitResponse(limit.retryAfterSeconds, {
      label: "AI 工具任务状态",
      limit: AI_TOOLS_STATUS_RATE_LIMIT,
      windowMs: AI_TOOLS_RATE_WINDOW_MS,
    });
  }

  const taskIds = new URL(request.url).searchParams.getAll("task_id");
  const taskId = taskIds.length === 1 ? taskIds[0]?.trim() : "";
  if (!isAiToolTaskId(taskId)) {
    return validationError([{
      path: "$query.task_id",
      code: taskId ? "invalid_value" : "missing_field",
      message: "task_id 格式无效",
    }], "AI_TOOL_TASK_ID_INVALID");
  }

  try {
    let durableTask: AiToolTaskRecord | undefined;
    if (!isMockExecutionEnabled()) {
      durableTask = await findOwnedAiToolTaskByProviderTaskId(user.id, taskId);
      const stored = getReusableAiToolTaskResult(durableTask);
      if (stored && (stored.status === "completed" || stored.status === "failed")) {
        await syncAiToolTaskQueueById(durableTask.id);
        return successResponse(stored, true, durableTask);
      }
    }
    const providerResult = await getAiToolTask(taskId, {
      userId: user.id,
      client: supabase,
      operation: durableTask?.operation,
      requestId: durableTask?.requestId,
    });
    if (providerResult.execution_mode === "live") {
      if (!durableTask) {
        throw new AiToolTaskRepositoryError("AI 工具任务缺少服务端归属记录", {
          code: "AI_TOOL_TASK_NOT_FOUND",
          status: 404,
        });
      }
      durableTask = await recordAiToolTaskProviderResult(durableTask, providerResult);
      await syncAiToolTaskQueueById(durableTask.id);
    }
    const result = await persistCompletedAiToolOutputs(providerResult, {
      userId: user.id,
      task: durableTask,
    });
    if (durableTask) await syncAiToolTaskQueueById(durableTask.id);
    return successResponse(result, true, durableTask);
  } catch (error) {
    if (error instanceof AiToolTaskRepositoryError) return taskRepositoryErrorResponse(error, taskId);
    if (error instanceof AiToolOutputStorageError) return outputStorageErrorResponse(error);
    if (error instanceof AiToolProviderError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
        task_id: taskId,
        status: "failed",
        stage: "status_lookup_failed",
        progress: 0,
        result_urls: [],
        outputs: [],
        task_error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
        execution_mode: error.providerStatus?.execution_mode || "live",
        provider_status: error.providerStatus ? {
          configured: error.providerStatus.configured,
          mock: error.providerStatus.mock,
          reason: error.providerStatus.reason,
        } : undefined,
        retryable: error.retryable,
      }, {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      });
    }

    console.error("[ai-tools] task lookup failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({
      error: "AI 工具任务状态查询失败",
      code: "AI_TOOL_TASK_LOOKUP_FAILED",
      task_id: taskId,
      status: "failed",
      stage: "status_lookup_failed",
      progress: 0,
      result_urls: [],
      outputs: [],
      task_error: {
        code: "AI_TOOL_TASK_LOOKUP_FAILED",
        message: "AI 工具任务状态查询失败",
        retryable: true,
      },
      retryable: true,
    }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function POST(request: Request) {
  const { supabase, user, response: authResponse } = await requireApiUser();
  if (!user) return authResponse;

  const limit = await checkRateLimit(`ai-tools:${user.id}`, AI_TOOLS_RATE_LIMIT, AI_TOOLS_RATE_WINDOW_MS);
  if (!limit.ok) {
    return rateLimitResponse(limit.retryAfterSeconds, {
      label: "AI 工具",
      limit: AI_TOOLS_RATE_LIMIT,
      windowMs: AI_TOOLS_RATE_WINDOW_MS,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError([{
      path: "$",
      code: "invalid_type",
      message: "请求体必须是有效 JSON",
    }]);
  }

  let extracted: ReturnType<typeof extractAiToolInputProofs>;
  try {
    extracted = extractAiToolInputProofs(body);
  } catch (error) {
    if (error instanceof AiToolInputOwnershipError) return inputOwnershipErrorResponse(error);
    return validationError([{
      path: "$",
      code: "invalid_value",
      message: "图片归属证明格式无效",
    }]);
  }

  const parsed = parseAiToolCreateRequest(extracted.requestBody);
  if (!parsed.ok) return validationError(parsed.issues);

  const catalogIssues = validateAgainstCatalog(parsed.data);
  if (catalogIssues.length) return validationError(catalogIssues);

  const providerStatus = getAiToolProviderStatus(parsed.data);
  if (!providerStatus.available) {
    return NextResponse.json({
      error: providerStatus.message,
      code: "AI_TOOL_PROVIDER_UNAVAILABLE",
      request_id: parsed.data.request_id,
      operation: parsed.data.operation,
      provider: providerStatus.provider,
      capability: providerStatus.capability,
      execution_mode: providerStatus.execution_mode,
      provider_status: {
        configured: providerStatus.configured,
        mock: providerStatus.mock,
        reason: providerStatus.reason,
      },
      retryable: false,
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const resolved = await resolveOwnedAiToolSubmission(parsed.data, extracted.proofs, {
      userId: user.id,
      supabase,
      executionMode: providerStatus.execution_mode,
    });
    if (providerStatus.execution_mode === "mock") {
      const providerResult = await submitAiToolTask(resolved.request, {
        userId: user.id,
        client: supabase,
      });
      const result = await persistCompletedAiToolOutputs(providerResult, { userId: user.id });
      return successResponse(result);
    }

    const submission = await beginAiToolTaskSubmission({
      userId: user.id,
      request: resolved.request,
      provider: providerStatus.provider,
      sourceOwnership: resolved.sourceOwnership,
    });
    if (submission.state === "existing") {
      await syncAiToolTaskQueueById(submission.task.id);
      return successResponse(submission.result);
    }
    if (submission.state === "in_progress") {
      if (!submission.task.providerTaskId) {
        throw new AiToolTaskRepositoryError("相同 request_id 的任务正在提交，请稍后重试", {
          code: "AI_TOOL_TASK_SUBMISSION_IN_PROGRESS",
          status: 409,
          retryable: true,
        });
      }
      const providerResult = await getAiToolTask(submission.task.providerTaskId, {
        userId: user.id,
        client: supabase,
        operation: submission.task.operation,
        requestId: submission.task.requestId,
      });
      const durableTask = await recordAiToolTaskProviderResult(submission.task, providerResult);
      await syncAiToolTaskQueueById(durableTask.id);
      const result = await persistCompletedAiToolOutputs(providerResult, {
        userId: user.id,
        task: durableTask,
      });
      await syncAiToolTaskQueueById(durableTask.id);
      return successResponse(result);
    }

    let providerResult: Awaited<ReturnType<typeof submitAiToolTask>>;
    try {
      providerResult = await submitAiToolTask(resolved.request, {
        userId: user.id,
        client: supabase,
      });
    } catch (error) {
      try {
        await markAiToolTaskSubmissionFailed(submission.task, submission.leaseToken, error);
      } catch (persistenceError) {
        console.error("[ai-tools] failed to persist submission failure:", persistenceError);
      }
      throw error;
    }
    const durableTask = await bindAiToolTaskProviderResult(
      submission.task,
      submission.leaseToken,
      providerResult,
    );
    await syncAiToolTaskQueueById(durableTask.id);
    const result = await persistCompletedAiToolOutputs(providerResult, {
      userId: user.id,
      task: durableTask,
    });
    await syncAiToolTaskQueueById(durableTask.id);
    return successResponse(result);
  } catch (error) {
    if (error instanceof AiToolInputOwnershipError) return inputOwnershipErrorResponse(error);
    if (error instanceof AiToolTaskRepositoryError) {
      return taskRepositoryErrorResponse(error, undefined, parsed.data.request_id);
    }
    if (error instanceof AiToolOutputStorageError) return outputStorageErrorResponse(error);
    if (error instanceof AiToolProviderError) {
      const status = error.providerStatus || providerStatus;
      return NextResponse.json({
        error: error.message,
        code: error.code,
        request_id: parsed.data.request_id,
        operation: parsed.data.operation,
        provider: status.provider,
        capability: status.capability,
        execution_mode: status.execution_mode,
        provider_status: {
          configured: status.configured,
          mock: status.mock,
          reason: status.reason,
        },
        retryable: error.retryable,
      }, {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      });
    }

    console.error("[ai-tools] provider submission failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({
      error: "AI 工具任务提交失败",
      code: "AI_TOOL_SUBMISSION_FAILED",
      request_id: parsed.data.request_id,
      operation: parsed.data.operation,
      retryable: true,
    }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

function successResponse(
  result: Awaited<ReturnType<typeof persistCompletedAiToolOutputs>>,
  polling = false,
  task?: AiToolTaskRecord,
) {
  return NextResponse.json({
    ...result,
    ...(task ? {
      task_context: {
        operation: task.operation,
        source_url: task.sourceUrl,
        source_asset_id: task.sourceAssetId,
        source_width: task.sourceWidth,
        source_height: task.sourceHeight,
      },
    } : {}),
    credits_cost: result.credits_cost ?? 0,
    ...(result.credits_remaining === undefined ? {} : { credits_remaining: result.credits_remaining }),
    billing_status: result.billing_status ?? "not_debited",
  }, {
    status: !polling && (result.status === "queued" || result.status === "processing") ? 202 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

function taskRepositoryErrorResponse(
  error: AiToolTaskRepositoryError,
  taskId?: string,
  requestId?: string,
) {
  return NextResponse.json({
    error: error.message,
    code: error.code,
    ...(taskId ? { task_id: taskId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    status: "failed",
    stage: "task_persistence_failed",
    progress: 0,
    result_urls: [],
    outputs: [],
    retryable: error.retryable,
  }, {
    status: error.status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isMockExecutionEnabled() {
  const mode = (process.env.AI_TOOLS_EXECUTION_MODE || "live").trim().toLowerCase();
  const environment = (process.env.NODE_ENV || "production").trim().toLowerCase();
  return mode === "mock" && (environment === "development" || environment === "test");
}

function inputOwnershipErrorResponse(error: AiToolInputOwnershipError) {
  return NextResponse.json({
    error: error.message,
    code: error.code,
    stage: "input_ownership_failed",
    retryable: error.retryable,
  }, {
    status: error.status,
    headers: { "Cache-Control": "no-store" },
  });
}

function outputStorageErrorResponse(error: AiToolOutputStorageError) {
  if (error.code === "AI_TOOL_OUTPUT_PERSISTENCE_BUSY") {
    return NextResponse.json({
      task_id: error.taskId,
      status: "processing",
      stage: "persisting_outputs",
      progress: 99,
      result_urls: [],
      outputs: [],
      warnings: [error.message],
      error: null,
      retryable: true,
      credits_cost: 0,
      billing_status: "not_debited",
    }, {
      status: 202,
      headers: { "Cache-Control": "no-store", "Retry-After": "2" },
    });
  }
  return NextResponse.json({
    error: error.message,
    code: error.code,
    task_id: error.taskId,
    status: "failed",
    stage: "postprocessing_failed",
    progress: 100,
    result_urls: [],
    outputs: [],
    task_error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
    retryable: error.retryable,
  }, {
    status: error.status,
    headers: { "Cache-Control": "no-store" },
  });
}

function validateAgainstCatalog(request: AiToolCreateRequest): AiToolValidationIssue[] {
  const tool = AI_TOOL_CATALOG[request.operation];
  const issues: AiToolValidationIssue[] = [];

  if (tool.requiresMask && !request.mask_url) {
    issues.push({ path: "$.mask_url", code: "missing_field", message: `${tool.label}需要上传编辑蒙版` });
  }
  if (!tool.acceptsMask && request.mask_url) {
    issues.push({ path: "$.mask_url", code: "invalid_value", message: `${tool.label}不接受编辑蒙版` });
  }

  const imageCount = 1 + request.reference_urls.length;
  if (imageCount > tool.maxImages) {
    issues.push({
      path: "$.reference_urls",
      code: "limit_exceeded",
      message: `${tool.label}最多接受 ${tool.maxImages} 张输入图片`,
    });
  }

  return issues;
}

function validationError(
  issues: AiToolValidationIssue[],
  code = "AI_TOOL_VALIDATION_FAILED",
) {
  return NextResponse.json({
    error: issues[0]?.message || "请求参数无效",
    code,
    details: { issues },
    retryable: false,
  }, {
    status: 400,
    headers: { "Cache-Control": "no-store" },
  });
}
