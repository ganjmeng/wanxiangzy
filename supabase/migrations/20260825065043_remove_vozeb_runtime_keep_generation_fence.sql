-- Remove every VOZEB application/runtime object while retaining the generic
-- generation execution fence. The retained fence prevents duplicate billable
-- submissions after ambiguous network failures and preserves durable phase
-- checkpoints for the existing generations/BullMQ pipeline.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Remove VOZEB projections from the shared task rail before tightening the
-- source constraint. Old Agent v1 workflow rows are removed as well because
-- that module was permanently retired before the VOZEB migration.
DELETE FROM public.task_queue_items
WHERE source_type IN ('creative_run', 'workflow');

ALTER TABLE public.task_queue_items
  DROP CONSTRAINT IF EXISTS task_queue_items_source_type_check;
ALTER TABLE public.task_queue_items
  ADD CONSTRAINT task_queue_items_source_type_check
  CHECK (source_type IN ('generation', 'ai_tool'));

-- Stop every cross-module trigger before detaching the generic generation
-- ledger and its execution event history from VOZEB parent runs.
DROP TRIGGER IF EXISTS creative_runs_sync_agent_message ON public.creative_runs;
DROP TRIGGER IF EXISTS creative_runs_task_queue_projection ON public.creative_runs;
DROP TRIGGER IF EXISTS generations_sync_creative_run ON public.generations;
DROP TRIGGER IF EXISTS generations_record_execution_event ON public.generations;

DROP FUNCTION IF EXISTS public.append_creative_conversation_exchange(UUID, UUID, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.attach_generation_to_creative_run(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID[], TEXT);
DROP FUNCTION IF EXISTS public.create_creative_run(UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.creative_agent_complete_process(JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.sync_creative_run_agent_message();
DROP FUNCTION IF EXISTS private.sync_creative_run_from_generation();
DROP FUNCTION IF EXISTS private.sync_creative_run_task_queue_projection();
DROP FUNCTION IF EXISTS private.creative_payload_urls(JSONB, TEXT[], TEXT[], INTEGER);

DROP INDEX IF EXISTS public.generation_execution_events_creative_step_idx;
DROP INDEX IF EXISTS public.generation_execution_events_run_idx;
ALTER TABLE public.generation_execution_events
  DROP COLUMN IF EXISTS creative_run_id,
  DROP COLUMN IF EXISTS creative_step_id;

DROP INDEX IF EXISTS public.generations_creative_step_idx;
DROP INDEX IF EXISTS public.generations_creative_run_idx;
DROP INDEX IF EXISTS public.generations_parent_idx;
ALTER TABLE public.generations
  DROP CONSTRAINT IF EXISTS generations_surface_check,
  DROP COLUMN IF EXISTS creative_run_id,
  DROP COLUMN IF EXISTS creative_step_id,
  DROP COLUMN IF EXISTS parent_generation_id,
  DROP COLUMN IF EXISTS canvas_project_id,
  DROP COLUMN IF EXISTS canvas_node_id,
  DROP COLUMN IF EXISTS conversation_id,
  DROP COLUMN IF EXISTS surface,
  DROP COLUMN IF EXISTS step_key,
  DROP COLUMN IF EXISTS depends_on_generation_ids;

-- Recreate the generic event recorder without VOZEB foreign keys. Historical
-- execution events remain available for operations and incident diagnosis.
CREATE OR REPLACE FUNCTION private.record_generation_execution_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'generation.created';
  ELSIF NEW.execution_phase IS DISTINCT FROM OLD.execution_phase THEN
    v_event_type := 'phase.changed';
  ELSIF NEW.upstream_task_id IS DISTINCT FROM OLD.upstream_task_id THEN
    v_event_type := 'upstream.bound';
  ELSIF NEW.last_upstream_status IS DISTINCT FROM OLD.last_upstream_status THEN
    v_event_type := 'upstream.status';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.generation_execution_events (
    generation_id, user_id, delivery_version, phase_version,
    execution_phase, event_type, upstream_status, metadata
  ) VALUES (
    NEW.id, NEW.user_id, NEW.delivery_version, NEW.phase_version,
    NEW.execution_phase, v_event_type, NEW.last_upstream_status,
    jsonb_strip_nulls(jsonb_build_object(
      'upstreamTaskId', NEW.upstream_task_id,
      'upstreamRequestId', NEW.upstream_request_id,
      'provider', NEW.upstream_provider,
      'deploymentId', NEW.upstream_deployment_id,
      'reviewReason', NEW.review_reason
    ))
  );
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS generations_record_execution_event ON public.generations;
CREATE TRIGGER generations_record_execution_event
  AFTER INSERT OR UPDATE OF execution_phase, upstream_task_id, last_upstream_status
  ON public.generations
  FOR EACH ROW EXECUTE FUNCTION private.record_generation_execution_event();

REVOKE ALL ON FUNCTION private.record_generation_execution_event()
  FROM PUBLIC, anon, authenticated;

-- Drop VOZEB data in dependency order. No CASCADE is used so an unexpected
-- external dependency fails the migration instead of silently deleting it.
DROP TABLE IF EXISTS public.creative_messages;
DROP TABLE IF EXISTS public.creative_run_events;
DROP TABLE IF EXISTS public.creative_user_skills;
DROP TABLE IF EXISTS public.creative_agent_skill_versions;
DROP TABLE IF EXISTS public.creative_agent_skills;
DROP TABLE IF EXISTS public.creative_run_steps;
DROP TABLE IF EXISTS public.creative_runs;
DROP TABLE IF EXISTS public.creative_conversations;
DROP TABLE IF EXISTS public.creative_canvas_projects;

COMMENT ON FUNCTION public.checkpoint_generation_execution(UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB)
  IS 'Fenced submit/poll/persist checkpoint for the current generation execution.';

CREATE OR REPLACE FUNCTION public.get_runtime_contract_version()
RETURNS TABLE(contract_version TEXT, contract_hash TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    '2026-08-25.3'::TEXT,
    '6305f1469f89046b063d1b87857a2ed43548f0b3c8480e697ce1e7e32b178dbd'::TEXT
  WHERE COALESCE((SELECT auth.role()), '') = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.get_runtime_contract_version()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_runtime_contract_version() TO service_role;
