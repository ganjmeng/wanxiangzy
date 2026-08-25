import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260825065043_remove_vozeb_runtime_keep_generation_fence.sql",
  ),
  "utf8",
);

describe("VOZEB runtime removal migration", () => {
  it("removes all VOZEB tables without cascade", () => {
    for (const table of [
      "creative_messages",
      "creative_run_events",
      "creative_user_skills",
      "creative_agent_skill_versions",
      "creative_agent_skills",
      "creative_run_steps",
      "creative_runs",
      "creative_conversations",
      "creative_canvas_projects",
    ]) {
      expect(migration).toContain(`DROP TABLE IF EXISTS public.${table};`);
    }

    expect(migration).not.toMatch(/DROP TABLE[^;]+CASCADE/i);
  });

  it("removes VOZEB queue projections and accepts only host task sources", () => {
    expect(migration).toContain("source_type IN ('creative_run', 'workflow')");
    expect(migration).toContain("CHECK (source_type IN ('generation', 'ai_tool'))");
  });

  it("retains the generic generation execution fence", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION private.record_generation_execution_event()");
    expect(migration).toContain("COMMENT ON FUNCTION public.checkpoint_generation_execution");
    expect(migration).not.toContain("DROP TABLE IF EXISTS public.generation_execution_events");
    expect(migration).toContain("'2026-08-25.3'::TEXT");
    expect(migration).toContain(
      "'6305f1469f89046b063d1b87857a2ed43548f0b3c8480e697ce1e7e32b178dbd'::TEXT",
    );
  });
});
