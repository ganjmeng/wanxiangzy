import { getAdminClient } from "@/lib/supabase/admin";

const WORKFLOW_STATUSES = [
  "needs_confirmation",
  "confirmed",
  "queued",
  "running",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
] as const;

type WorkflowStatusKey = (typeof WORKFLOW_STATUSES)[number];

export type AgentWorkflowOpsSnapshot = {
  checkedAt: string;
  staleAfterMinutes: number;
  counts: Record<WorkflowStatusKey, number>;
  active: {
    queued: number;
    running: number;
    staleRunning: number;
    oldestQueuedAt: string | null;
    oldestRunningAt: string | null;
    oldestActive: Array<{
      id: string;
      status: string;
      summary: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  };
};

export async function readAgentWorkflowOpsSnapshot(
  staleAfterMinutes = 10,
): Promise<AgentWorkflowOpsSnapshot> {
  const supabase = getAdminClient();
  const staleSince = new Date(Date.now() - staleAfterMinutes * 60 * 1000).toISOString();

  const [counts, staleRunning, oldestQueued, oldestRunning, oldestActive] = await Promise.all([
    countWorkflowStatuses(),
    supabase
      .from("agent_workflows")
      .select("id", { head: true, count: "exact" })
      .eq("status", "running")
      .lt("updated_at", staleSince),
    supabase
      .from("agent_workflows")
      .select("updated_at")
      .eq("status", "queued")
      .order("updated_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agent_workflows")
      .select("updated_at")
      .eq("status", "running")
      .order("updated_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agent_workflows")
      .select("id,status,summary,created_at,updated_at")
      .in("status", ["queued", "running"])
      .order("updated_at", { ascending: true })
      .limit(10),
  ]);

  if (staleRunning.error) throw new Error(`read stale workflow count failed: ${staleRunning.error.message}`);
  if (oldestQueued.error) throw new Error(`read oldest queued workflow failed: ${oldestQueued.error.message}`);
  if (oldestRunning.error) throw new Error(`read oldest running workflow failed: ${oldestRunning.error.message}`);
  if (oldestActive.error) throw new Error(`read active workflows failed: ${oldestActive.error.message}`);

  return {
    checkedAt: new Date().toISOString(),
    staleAfterMinutes,
    counts,
    active: {
      queued: Math.max(0, counts.queued || 0),
      running: Math.max(0, counts.running || 0),
      staleRunning: staleRunning.count || 0,
      oldestQueuedAt: (oldestQueued.data as { updated_at?: string } | null)?.updated_at || null,
      oldestRunningAt: (oldestRunning.data as { updated_at?: string } | null)?.updated_at || null,
      oldestActive: (oldestActive.data || []).map((row) => {
        const item = row as {
          id: string;
          status: string;
          summary?: string | null;
          created_at: string;
          updated_at: string;
        };
        return {
          id: item.id,
          status: item.status,
          summary: item.summary || null,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        };
      }),
    },
  };
}

export function buildWorkflowOpsRecommendations(snapshot: AgentWorkflowOpsSnapshot) {
  const recommendations: string[] = [];

  if (snapshot.active.queued > 0) {
    recommendations.push(
      `There are ${snapshot.active.queued} queued workflows. Ensure /api/jobs/process-agent-workflows runs every minute.`,
    );
  }
  if (snapshot.active.staleRunning > 0) {
    recommendations.push(
      `${snapshot.active.staleRunning} running workflows are stale. Call /api/jobs/repair-agent-workflows or wait for the processor stale-claim pass.`,
    );
  }
  if (snapshot.active.running >= 10) {
    recommendations.push("Running workflow count is high. Check provider latency, image upload timeout, and PM2 memory pressure.");
  }
  if (!recommendations.length) {
    recommendations.push("Workflow queue looks healthy.");
  }

  return recommendations;
}

async function countWorkflowStatuses(): Promise<Record<WorkflowStatusKey, number>> {
  const supabase = getAdminClient();
  const entries = await Promise.all(
    WORKFLOW_STATUSES.map(async (status) => {
      const { count, error } = await supabase
        .from("agent_workflows")
        .select("id", { head: true, count: "exact" })
        .eq("status", status);
      if (error) return [status, -1] as const;
      return [status, count || 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<WorkflowStatusKey, number>;
}
