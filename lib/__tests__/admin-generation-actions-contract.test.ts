import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(resolve(process.cwd(), "app/api/admin/generations/[id]/route.ts"), "utf8");
const actions = readFileSync(resolve(process.cwd(), "components/admin/AdminTaskActions.tsx"), "utf8");

describe("admin generation action contract", () => {
  it("deduplicates retry through recovery instead of rewriting queued state", () => {
    expect(route).toContain('admin.rpc("admin_retry_generation"');
    expect(route).toContain("deduplicated: alreadyRunning");
    expect(route).not.toContain('job_attempts: 0');
  });

  it("uses atomic terminal settlement for refund and no-refund actions", () => {
    expect(route).toContain('admin.rpc("admin_settle_generation"');
    expect(route).toContain("p_refund: shouldRefund");
  });

  it("shows accepted outcomes and disables duplicate clicks while pending", () => {
    expect(actions).toContain("setLoadingAction(action)");
    expect(actions).toContain("disabled={Boolean(loadingAction)}");
    expect(actions).toContain("setLastOutcome(outcome)");
  });

  it("keeps manual-review resolution visible and never refunds at the creative parent", () => {
    expect(actions).toContain('status.toLowerCase() === "needs_review"');
    expect(actions).toContain('sourceType === "generation" ? ["mark_failed_refund", "mark_failed_no_refund"]');
    expect(route).toContain("创意父任务不直接结算积分");
    expect(route).not.toContain("release_agent_workflow_credits");
  });
});
