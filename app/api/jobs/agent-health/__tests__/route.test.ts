import { describe, expect, it } from "vitest";
import { buildMastraRouteEvalCheck } from "@/lib/mastra/planning/route-health";

describe("agent health Mastra route eval check", () => {
  it("warns when Mastra route eval has not run", () => {
    const check = buildMastraRouteEvalCheck({
      ok: true,
      error: null,
      run: null,
    });

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("warning");
    expect(check.message).toContain("No Mastra route eval run");
  });

  it("passes when latest Mastra route eval has no failures", () => {
    const check = buildMastraRouteEvalCheck({
      ok: true,
      error: null,
      run: {
        id: "run-1",
        total: 5,
        passed: 5,
        failed: 0,
        score: 100,
        created_at: new Date().toISOString(),
        summary: { kind: "mastra_route" },
      },
    });

    expect(check.ok).toBe(true);
    expect(check.metadata).toMatchObject({ runId: "run-1", failed: 0, score: 100 });
  });

  it("warns when latest Mastra route eval failed", () => {
    const check = buildMastraRouteEvalCheck({
      ok: true,
      error: null,
      run: {
        id: "run-2",
        total: 5,
        passed: 4,
        failed: 1,
        score: 80,
        created_at: new Date().toISOString(),
        summary: { kind: "mastra_route" },
      },
    });

    expect(check.ok).toBe(false);
    expect(check.message).toContain("needs attention");
  });
});
