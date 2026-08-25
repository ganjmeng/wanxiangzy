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
});
