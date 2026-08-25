import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260825074913_generation_execution_fence.sql",
  ),
  "utf8",
);

describe("generation execution fence migration", () => {
  it("adds durable phases and an append-only execution ledger", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS execution_phase");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.generation_execution_events");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION private.record_generation_execution_event()");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.checkpoint_generation_execution(");
  });

  it("keeps the shared task rail limited to supported task sources", () => {
    expect(migration).toContain("CHECK (source_type IN ('generation', 'ai_tool'))");
  });

  it("fences ambiguous upstream submissions instead of redelivering them", () => {
    expect(migration).toContain("execution_phase = 'submitting'");
    expect(migration).toContain("status = 'needs_review'");
    expect(migration).toContain("upstream_task_id IS NULL");
  });

  it("publishes the required runtime contract", () => {
    expect(migration).toContain("'2026-08-25.3'::TEXT");
    expect(migration).toContain(
      "'6305f1469f89046b063d1b87857a2ed43548f0b3c8480e697ce1e7e32b178dbd'::TEXT",
    );
  });
});
