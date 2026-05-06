import { NextRequest, NextResponse } from "next/server";
import { runNextAgentWorkflows } from "@/lib/agent/workflow/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return handleProcessRequest(request);
}

export async function POST(request: NextRequest) {
  return handleProcessRequest(request);
}

async function handleProcessRequest(request: NextRequest) {
  const authError = validateProcessorAuth(request);
  if (authError) return authError;

  try {
    const result = await runNextAgentWorkflows(getBatchLimit(request), {
      staleAfterMinutes: getStaleAfterMinutes(request),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[jobs] process-agent-workflows failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Agent workflow processing failed" },
      { status: 500 }
    );
  }
}

function validateProcessorAuth(request: NextRequest) {
  const expectedSecret = process.env.AGENT_WORKFLOW_PROCESSOR_SECRET || process.env.JOB_PROCESSOR_SECRET || process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "AGENT_WORKFLOW_PROCESSOR_SECRET/JOB_PROCESSOR_SECRET/CRON_SECRET 未配置" }, { status: 500 });
  }
  const authorization = request.headers.get("authorization") || "";
  if (authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function getBatchLimit(request: NextRequest) {
  const rawLimit = request.nextUrl.searchParams.get("limit") || process.env.AGENT_WORKFLOW_BATCH_SIZE;
  const parsed = Number(rawLimit || 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(Math.max(Math.floor(parsed), 1), 10);
}

function getStaleAfterMinutes(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("staleAfterMinutes") || process.env.AGENT_WORKFLOW_STALE_AFTER_MINUTES;
  const parsed = Number(raw || 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(Math.floor(parsed), 1), 120);
}
