import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260824153558_vozeb_creative_runtime_foundation.sql"),
  "utf8",
);
const conversationMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260825043413_fix_agent_conversation_runtime.sql"),
  "utf8",
);
const textProviderMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260825054554_repair_minimax_openai_base_url.sql"),
  "utf8",
);

describe("VOZEB creative runtime SQL contract", () => {
  it("replaces the old Agent tables with owner-scoped creative runs", () => {
    expect(migration).toContain("DROP TABLE IF EXISTS public.agent_workflows CASCADE");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.creative_runs");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.creative_canvas_projects");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.creative_run_steps");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.creative_run_events");
    expect(migration).toContain("ALTER TABLE public.creative_runs ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE public.creative_canvas_projects ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("USING ((SELECT auth.uid()) = user_id)");
    expect(migration).toContain("REVOKE ALL ON public.creative_runs FROM PUBLIC, anon, authenticated");
  });

  it("uses monotonic VOZEB phases behind the existing delivery token fence", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.checkpoint_generation_execution(");
    expect(migration).toContain("generation.delivery_version = p_delivery_version");
    expect(migration).toContain("generation.execution_token = p_execution_token");
    expect(migration).toContain("private.generation_execution_phase_rank");
    expect(migration).toMatch(/lower-rank checkpoint[\s\S]+RETURN TRUE;/);
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.checkpoint_generation_execution");
  });

  it("quarantines unknown submissions instead of automatically creating duplicates", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.mark_generation_needs_review(");
    expect(migration).toContain("execution_phase = 'needs_review'");
    expect(migration).toContain("candidate.execution_phase = 'submitting'");
    expect(migration).toContain("candidate.upstream_task_id IS NULL");
    expect(migration).toContain("ALTER FUNCTION public.recover_generation_outbox(INTEGER, INTEGER) SET SCHEMA private");
    expect(migration).toContain("private.recover_generation_outbox_legacy");
  });

  it("projects creative parents into the shared task rail while child billing stays in generations", () => {
    expect(migration).toContain("CHECK (source_type IN ('generation', 'creative_run', 'ai_tool'))");
    expect(migration).toContain("creative_runs_task_queue_projection");
    expect(migration).toContain("private.creative_payload_urls");
    expect(migration).toContain("UPDATE OF status, summary, intent, input_payload, output_payload");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS creative_run_id UUID");
    expect(migration).not.toContain("CREATE TABLE IF NOT EXISTS public.agent_credit_reservations");
  });

  it("publishes the exact forward runtime contract and release-gated RPCs", () => {
    expect(migration).toContain("'2026-08-25.2'::TEXT");
    expect(migration).toContain("'9f9bc9c13f693c7297cc81e9a946a8c89d9e52dfef2c890c46604ce99f02946c'::TEXT");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.create_creative_run(");
    expect(migration).toContain("private.sync_creative_run_from_generation");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.attach_generation_to_creative_run(");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.attach_generation_to_creative_run");
  });

  it("persists real Agent conversations and fixes the Postgres 17 attach ambiguity", () => {
    expect(migration).toContain("ON CONFLICT ON CONSTRAINT creative_run_steps_run_id_step_key_key DO NOTHING");
    expect(conversationMigration).toContain("CREATE TABLE IF NOT EXISTS public.creative_conversations");
    expect(conversationMigration).toContain("CREATE TABLE IF NOT EXISTS public.creative_messages");
    expect(conversationMigration).toContain("append_creative_conversation_exchange");
    expect(conversationMigration).toContain("creative_runs_conversation_id_fkey");
  });

  it("repairs the legacy MiniMax OpenAI-compatible base URL", () => {
    expect(textProviderMigration).toContain("legacy-text-minimax");
    expect(textProviderMigration).toContain("legacy-vision-minimax");
    expect(textProviderMigration).toContain("https://api.minimaxi.com/v1");
    expect(textProviderMigration).toContain("config.value IS DISTINCT FROM repaired.value");
  });
});
