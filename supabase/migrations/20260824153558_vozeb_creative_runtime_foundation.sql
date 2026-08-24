BEGIN;

-- Retire the extracted Agent v1 schema before installing the new creative
-- runtime.  The replacement deliberately reuses generations, the existing
-- credit ledger, and the BullMQ transactional outbox instead of carrying a
-- second billing/queue implementation.
DO $$
BEGIN
  IF to_regclass('public.agent_workflows') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS agent_workflows_task_queue_items_sync ON public.agent_workflows';
  END IF;
  IF to_regclass('public.task_queue_items') IS NOT NULL THEN
    DELETE FROM public.task_queue_items WHERE source_type = 'workflow';
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.task_queue_sync_workflow_trigger() CASCADE;
DROP FUNCTION IF EXISTS public.reserve_agent_workflow_credits(UUID, UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.release_agent_workflow_credits(UUID, UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.settle_agent_workflow_credits(UUID, UUID, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS public.claim_next_agent_workflows(INTEGER, INTERVAL) CASCADE;

DROP TABLE IF EXISTS public.agent_eval_results CASCADE;
DROP TABLE IF EXISTS public.agent_eval_runs CASCADE;
DROP TABLE IF EXISTS public.agent_credit_reservations CASCADE;
DROP TABLE IF EXISTS public.agent_workflow_events CASCADE;
DROP TABLE IF EXISTS public.agent_workflow_steps CASCADE;
DROP TABLE IF EXISTS public.agent_plan_versions CASCADE;
DROP TABLE IF EXISTS public.agent_assets CASCADE;
DROP TABLE IF EXISTS public.agent_user_preferences CASCADE;
DROP TABLE IF EXISTS public.agent_workflows CASCADE;
DROP TABLE IF EXISTS public.agent_tool_runs CASCADE;
DROP TABLE IF EXISTS public.agent_knowledge_items CASCADE;
DROP TABLE IF EXISTS public.agent_observability_events CASCADE;
DROP TABLE IF EXISTS public.agent_feedback CASCADE;
DROP TABLE IF EXISTS public.agent_brain_traces CASCADE;
DROP TABLE IF EXISTS public.agent_messages CASCADE;
DROP TABLE IF EXISTS public.agent_conversations CASCADE;

-- A creative run is the new durable parent for Agent and infinite-canvas work.
-- Child media execution remains in public.generations so account ownership,
-- credits, provider routing, outbox delivery, and OSS persistence stay shared.
CREATE TABLE IF NOT EXISTS public.creative_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('draft', 'queued', 'running', 'paused', 'needs_review', 'completed', 'failed', 'cancelled')),
  intent TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  surface TEXT NOT NULL DEFAULT 'agent'
    CHECK (surface IN ('agent', 'canvas', 'api', 'system')),
  project_id UUID,
  conversation_id UUID,
  client_request_id TEXT,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(input_payload) = 'object'),
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(output_payload) = 'object'),
  review_reason TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS creative_runs_user_status_created_idx
  ON public.creative_runs (user_id, status, created_at DESC, id);
CREATE INDEX IF NOT EXISTS creative_runs_project_created_idx
  ON public.creative_runs (user_id, project_id, created_at DESC, id)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.creative_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own creative runs" ON public.creative_runs;
CREATE POLICY "Users can view own creative runs"
  ON public.creative_runs FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.creative_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.creative_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_runs TO service_role;

CREATE TABLE IF NOT EXISTS public.creative_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.creative_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'queued', 'running', 'needs_review', 'completed', 'failed', 'cancelled', 'skipped')),
  parent_step_id UUID REFERENCES public.creative_run_steps(id) ON DELETE SET NULL,
  depends_on_step_ids UUID[] NOT NULL DEFAULT '{}',
  generation_id UUID REFERENCES public.generations(id) ON DELETE SET NULL,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(input_payload) = 'object'),
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(output_payload) = 'object'),
  error_message TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 0 CHECK (attempt_no BETWEEN 0 AND 1000),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS creative_run_steps_run_status_idx
  ON public.creative_run_steps (run_id, status, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS creative_run_steps_generation_uidx
  ON public.creative_run_steps (generation_id)
  WHERE generation_id IS NOT NULL;

ALTER TABLE public.creative_run_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own creative run steps" ON public.creative_run_steps;
CREATE POLICY "Users can view own creative run steps"
  ON public.creative_run_steps FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.creative_run_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.creative_run_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_run_steps TO service_role;

CREATE TABLE IF NOT EXISTS public.creative_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.creative_runs(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.creative_run_steps(id) ON DELETE SET NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creative_run_events_run_created_idx
  ON public.creative_run_events (run_id, created_at, id);
CREATE INDEX IF NOT EXISTS creative_run_events_generation_created_idx
  ON public.creative_run_events (generation_id, created_at, id)
  WHERE generation_id IS NOT NULL;

ALTER TABLE public.creative_run_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own creative run events" ON public.creative_run_events;
CREATE POLICY "Users can view own creative run events"
  ON public.creative_run_events FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.creative_run_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.creative_run_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_run_events TO service_role;

-- Infinite-canvas projects share the same account boundary as creative runs.
-- The document stays intentionally compact and versioned so the editor can
-- evolve without creating a table per node type while optimistic revision
-- checks prevent two browser tabs from silently overwriting one another.
CREATE TABLE IF NOT EXISTS public.creative_canvas_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '未命名画布'
    CHECK (char_length(title) BETWEEN 1 AND 120),
  document JSONB NOT NULL DEFAULT '{"version":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"scale":1}}'::jsonb
    CHECK (jsonb_typeof(document) = 'object')
    CHECK (octet_length(document::TEXT) <= 2097152),
  cover_url TEXT,
  node_count INTEGER NOT NULL DEFAULT 0 CHECK (node_count BETWEEN 0 AND 5000),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creative_canvas_projects_user_updated_idx
  ON public.creative_canvas_projects (user_id, updated_at DESC, id);

ALTER TABLE public.creative_canvas_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own creative canvas projects" ON public.creative_canvas_projects;
CREATE POLICY "Users can view own creative canvas projects"
  ON public.creative_canvas_projects FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can create own creative canvas projects" ON public.creative_canvas_projects;
CREATE POLICY "Users can create own creative canvas projects"
  ON public.creative_canvas_projects FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can update own creative canvas projects" ON public.creative_canvas_projects;
CREATE POLICY "Users can update own creative canvas projects"
  ON public.creative_canvas_projects FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can delete own creative canvas projects" ON public.creative_canvas_projects;
CREATE POLICY "Users can delete own creative canvas projects"
  ON public.creative_canvas_projects FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.creative_canvas_projects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_canvas_projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_canvas_projects TO service_role;

ALTER TABLE public.creative_runs
  ADD CONSTRAINT creative_runs_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.creative_canvas_projects(id) ON DELETE SET NULL;

-- VOZEB-style recoverable execution phases, protected by the existing
-- delivery_version + execution_token fence.  Status remains the user-facing
-- business state; execution_phase describes the durable infrastructure step.
ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS execution_phase TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS phase_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phase_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS upstream_task_id TEXT,
  ADD COLUMN IF NOT EXISTS upstream_request_id TEXT,
  ADD COLUMN IF NOT EXISTS upstream_provider TEXT,
  ADD COLUMN IF NOT EXISTS upstream_deployment_id TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_poll_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_upstream_status TEXT,
  ADD COLUMN IF NOT EXISTS execution_result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creative_run_id UUID REFERENCES public.creative_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creative_step_id UUID REFERENCES public.creative_run_steps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_generation_id UUID REFERENCES public.generations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canvas_project_id UUID,
  ADD COLUMN IF NOT EXISTS canvas_node_id TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id UUID,
  ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT 'module',
  ADD COLUMN IF NOT EXISTS step_key TEXT,
  ADD COLUMN IF NOT EXISTS depends_on_generation_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_status_check;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_status_check CHECK (
    status IN (
      'uploading', 'queued', 'processing_tryon', 'processing_face_swap',
      'processing_batch', 'needs_review', 'completed', 'partially_completed',
      'failed', 'cancelled'
    )
  );
ALTER TABLE public.generations
  DROP CONSTRAINT IF EXISTS generations_execution_phase_check;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_execution_phase_check CHECK (
    execution_phase IN (
      'queued', 'claimed', 'submitting', 'submitted', 'polling',
      'result_ready', 'persisting', 'settling', 'needs_review',
      'cancel_requested', 'cancel_polling', 'completed'
    )
  );
ALTER TABLE public.generations
  DROP CONSTRAINT IF EXISTS generations_execution_result_payload_object_check;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_execution_result_payload_object_check
  CHECK (jsonb_typeof(execution_result_payload) = 'object');
ALTER TABLE public.generations
  DROP CONSTRAINT IF EXISTS generations_surface_check;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_surface_check
  CHECK (surface IN ('module', 'agent', 'canvas', 'api', 'system'));
ALTER TABLE public.generations
  DROP CONSTRAINT IF EXISTS generations_phase_version_check;
ALTER TABLE public.generations
  ADD CONSTRAINT generations_phase_version_check CHECK (phase_version >= 0);

UPDATE public.generations
SET execution_phase = CASE
      WHEN status = 'queued' THEN 'queued'
      WHEN status IN ('completed', 'partially_completed', 'failed', 'cancelled') THEN 'completed'
      WHEN status = 'needs_review' THEN 'needs_review'
      WHEN COALESCE(job_payload -> 'asyncTask' ->> 'taskId', '') <> '' THEN 'polling'
      WHEN status LIKE 'processing_%' THEN 'claimed'
      ELSE 'queued'
    END,
    upstream_task_id = COALESCE(upstream_task_id, NULLIF(job_payload -> 'asyncTask' ->> 'taskId', '')),
    upstream_request_id = COALESCE(upstream_request_id, NULLIF(job_payload -> 'asyncTask' ->> 'requestId', '')),
    last_upstream_status = COALESCE(last_upstream_status, NULLIF(job_payload -> 'asyncTask' ->> 'status', '')),
    phase_updated_at = COALESCE(updated_at, created_at, now());

CREATE INDEX IF NOT EXISTS generations_phase_due_idx
  ON public.generations (execution_phase, next_poll_at, available_at, id)
  WHERE status IN ('queued', 'processing_tryon', 'processing_face_swap');
CREATE INDEX IF NOT EXISTS generations_needs_review_idx
  ON public.generations (phase_updated_at, created_at, id)
  WHERE status = 'needs_review' OR execution_phase = 'needs_review';
CREATE INDEX IF NOT EXISTS generations_creative_run_idx
  ON public.generations (creative_run_id, created_at, id)
  WHERE creative_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS generations_parent_idx
  ON public.generations (parent_generation_id, created_at, id)
  WHERE parent_generation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS generations_provider_upstream_uidx
  ON public.generations (
    upstream_provider,
    COALESCE(upstream_deployment_id, ''),
    upstream_task_id
  )
  WHERE upstream_provider IS NOT NULL AND upstream_task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_creative_run(
  p_user_id UUID,
  p_surface TEXT DEFAULT 'agent',
  p_intent TEXT DEFAULT '',
  p_summary TEXT DEFAULT '',
  p_input_payload JSONB DEFAULT '{}'::jsonb,
  p_project_id UUID DEFAULT NULL,
  p_conversation_id UUID DEFAULT NULL,
  p_client_request_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run_id UUID;
  v_client_request_id TEXT := NULLIF(btrim(p_client_request_id), '');
BEGIN
  IF p_user_id IS NULL OR p_surface NOT IN ('agent', 'canvas', 'api', 'system')
    OR jsonb_typeof(COALESCE(p_input_payload, '{}'::jsonb)) <> 'object'
    OR octet_length(COALESCE(p_input_payload, '{}'::jsonb)::TEXT) > 262144
    OR char_length(COALESCE(p_intent, '')) > 4000
    OR char_length(COALESCE(p_summary, '')) > 500
    OR char_length(COALESCE(v_client_request_id, '')) > 160 THEN
    RAISE EXCEPTION 'INVALID_CREATIVE_RUN' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.creative_runs (
    user_id, status, intent, summary, surface, project_id, conversation_id,
    client_request_id, input_payload
  ) VALUES (
    p_user_id, 'draft', COALESCE(p_intent, ''), COALESCE(p_summary, ''),
    p_surface, p_project_id, p_conversation_id, v_client_request_id,
    COALESCE(p_input_payload, '{}'::jsonb)
  )
  ON CONFLICT (user_id, client_request_id) DO NOTHING
  RETURNING id INTO v_run_id;

  IF v_run_id IS NULL AND v_client_request_id IS NOT NULL THEN
    SELECT run.id INTO v_run_id
    FROM public.creative_runs AS run
    WHERE run.user_id = p_user_id
      AND run.client_request_id = v_client_request_id;
  END IF;

  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'CREATIVE_RUN_CREATE_FAILED';
  END IF;
  RETURN v_run_id;
END
$$;

CREATE OR REPLACE FUNCTION public.attach_generation_to_creative_run(
  p_user_id UUID,
  p_run_id UUID,
  p_generation_id UUID,
  p_step_key TEXT,
  p_step_type TEXT,
  p_title TEXT DEFAULT '',
  p_input_payload JSONB DEFAULT '{}'::jsonb,
  p_parent_step_id UUID DEFAULT NULL,
  p_depends_on_step_ids UUID[] DEFAULT '{}',
  p_canvas_node_id TEXT DEFAULT NULL
)
RETURNS TABLE(run_id UUID, step_id UUID, generation_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run_status TEXT;
  v_step_id UUID;
  v_existing_generation_id UUID;
  v_generation_status TEXT;
BEGIN
  IF p_user_id IS NULL OR p_run_id IS NULL OR p_generation_id IS NULL
    OR COALESCE(p_step_key, '') !~ '^[A-Za-z0-9._:-]{1,120}$'
    OR COALESCE(p_step_type, '') !~ '^[A-Za-z0-9._:-]{1,120}$'
    OR char_length(COALESCE(p_title, '')) > 300
    OR char_length(COALESCE(p_canvas_node_id, '')) > 160
    OR jsonb_typeof(COALESCE(p_input_payload, '{}'::jsonb)) <> 'object'
    OR octet_length(COALESCE(p_input_payload, '{}'::jsonb)::TEXT) > 262144
    OR cardinality(COALESCE(p_depends_on_step_ids, '{}')) > 100 THEN
    RAISE EXCEPTION 'INVALID_CREATIVE_RUN_STEP' USING ERRCODE = '22023';
  END IF;

  SELECT run.status INTO v_run_status
  FROM public.creative_runs AS run
  WHERE run.id = p_run_id AND run.user_id = p_user_id
  FOR UPDATE;
  IF v_run_status IS NULL THEN RAISE EXCEPTION 'CREATIVE_RUN_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_run_status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'CREATIVE_RUN_TERMINAL' USING ERRCODE = '55000';
  END IF;

  SELECT generation.status INTO v_generation_status
  FROM public.generations AS generation
  WHERE generation.id = p_generation_id AND generation.user_id = p_user_id
  FOR UPDATE;
  IF v_generation_status IS NULL THEN RAISE EXCEPTION 'GENERATION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF p_parent_step_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.creative_run_steps AS parent
    WHERE parent.id = p_parent_step_id AND parent.run_id = p_run_id AND parent.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'INVALID_CREATIVE_PARENT_STEP' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_depends_on_step_ids, '{}')) AS dependency(step_id)
    LEFT JOIN public.creative_run_steps AS step
      ON step.id = dependency.step_id AND step.run_id = p_run_id AND step.user_id = p_user_id
    WHERE step.id IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_CREATIVE_DEPENDENCY' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.creative_run_steps (
    run_id, user_id, step_key, step_type, title, status, parent_step_id,
    depends_on_step_ids, generation_id, input_payload
  ) VALUES (
    p_run_id, p_user_id, p_step_key, p_step_type, COALESCE(p_title, ''),
    CASE
      WHEN v_generation_status IN ('completed', 'partially_completed') THEN 'completed'
      WHEN v_generation_status IN ('failed', 'cancelled') THEN 'failed'
      WHEN v_generation_status = 'needs_review' THEN 'needs_review'
      ELSE 'queued'
    END,
    p_parent_step_id, COALESCE(p_depends_on_step_ids, '{}'), p_generation_id,
    COALESCE(p_input_payload, '{}'::jsonb)
  )
  ON CONFLICT (run_id, step_key) DO NOTHING
  RETURNING id INTO v_step_id;

  IF v_step_id IS NULL THEN
    SELECT step.id, step.generation_id INTO v_step_id, v_existing_generation_id
    FROM public.creative_run_steps AS step
    WHERE step.run_id = p_run_id AND step.step_key = p_step_key
    FOR UPDATE;
    IF v_existing_generation_id IS DISTINCT FROM p_generation_id THEN
      RAISE EXCEPTION 'CREATIVE_STEP_KEY_CONFLICT' USING ERRCODE = '23505';
    END IF;
  END IF;

  UPDATE public.generations AS generation
  SET creative_run_id = p_run_id,
      creative_step_id = v_step_id,
      surface = CASE WHEN p_canvas_node_id IS NULL THEN 'agent' ELSE 'canvas' END,
      canvas_project_id = COALESCE(generation.canvas_project_id, (
        SELECT run.project_id FROM public.creative_runs AS run WHERE run.id = p_run_id
      )),
      canvas_node_id = COALESCE(NULLIF(btrim(p_canvas_node_id), ''), generation.canvas_node_id),
      conversation_id = COALESCE(generation.conversation_id, (
        SELECT run.conversation_id FROM public.creative_runs AS run WHERE run.id = p_run_id
      )),
      step_key = p_step_key,
      depends_on_generation_ids = COALESCE((
        SELECT array_agg(step.generation_id ORDER BY dependency.ordinality)
        FROM unnest(COALESCE(p_depends_on_step_ids, '{}')) WITH ORDINALITY AS dependency(step_id, ordinality)
        JOIN public.creative_run_steps AS step ON step.id = dependency.step_id
        WHERE step.generation_id IS NOT NULL
      ), '{}')
  WHERE generation.id = p_generation_id
    AND generation.user_id = p_user_id
    AND (generation.creative_run_id IS NULL OR generation.creative_run_id = p_run_id)
    AND (generation.creative_step_id IS NULL OR generation.creative_step_id = v_step_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'GENERATION_ALREADY_ATTACHED' USING ERRCODE = '23505'; END IF;

  UPDATE public.creative_runs AS run
  SET status = CASE
        WHEN v_generation_status IN ('completed', 'partially_completed') THEN 'completed'
        WHEN v_generation_status IN ('failed', 'cancelled') THEN 'failed'
        WHEN v_generation_status = 'needs_review' THEN 'needs_review'
        WHEN run.status IN ('draft', 'paused') THEN 'queued'
        ELSE run.status
      END,
      completed_at = CASE
        WHEN v_generation_status IN ('completed', 'partially_completed', 'failed', 'cancelled')
          THEN clock_timestamp()
        ELSE run.completed_at
      END,
      updated_at = clock_timestamp()
  WHERE run.id = p_run_id;

  INSERT INTO public.creative_run_events (
    run_id, step_id, generation_id, user_id, event_type, message, metadata
  ) VALUES (
    p_run_id, v_step_id, p_generation_id, p_user_id, 'generation.attached', '',
    jsonb_build_object('stepKey', p_step_key, 'stepType', p_step_type)
  );

  RETURN QUERY SELECT p_run_id, v_step_id, p_generation_id;
END
$$;

CREATE TABLE IF NOT EXISTS public.generation_execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES public.generations(id) ON DELETE CASCADE,
  creative_run_id UUID REFERENCES public.creative_runs(id) ON DELETE SET NULL,
  creative_step_id UUID REFERENCES public.creative_run_steps(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delivery_version INTEGER NOT NULL,
  phase_version BIGINT NOT NULL,
  execution_phase TEXT NOT NULL,
  event_type TEXT NOT NULL,
  upstream_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generation_execution_events_generation_idx
  ON public.generation_execution_events (generation_id, phase_version, created_at, id);
CREATE INDEX IF NOT EXISTS generation_execution_events_run_idx
  ON public.generation_execution_events (creative_run_id, created_at, id)
  WHERE creative_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS generation_execution_events_created_brin
  ON public.generation_execution_events USING brin (created_at);

ALTER TABLE public.generation_execution_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own generation execution events" ON public.generation_execution_events;
CREATE POLICY "Users can view own generation execution events"
  ON public.generation_execution_events FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.generation_execution_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.generation_execution_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generation_execution_events TO service_role;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    FOREACH v_table IN ARRAY ARRAY[
      'creative_runs', 'creative_run_steps', 'creative_run_events',
      'generation_execution_events', 'creative_canvas_projects'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION private.normalize_generation_execution_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phase TEXT := NEW.execution_phase;
BEGIN
  IF NEW.status = 'queued' THEN
    v_phase := 'queued';
  ELSIF NEW.status = 'needs_review' THEN
    v_phase := 'needs_review';
    NEW.execution_token := NULL;
    NEW.execution_lease_expires_at := NULL;
  ELSIF NEW.status IN ('completed', 'partially_completed', 'failed') THEN
    v_phase := 'completed';
  ELSIF NEW.status = 'cancelled'
    AND v_phase NOT IN ('cancel_requested', 'cancel_polling') THEN
    v_phase := 'completed';
  END IF;

  NEW.execution_phase := v_phase;
  IF TG_OP = 'INSERT' THEN
    NEW.phase_version := GREATEST(COALESCE(NEW.phase_version, 0), 0);
    NEW.phase_updated_at := COALESCE(NEW.phase_updated_at, clock_timestamp());
  ELSIF NEW.execution_phase IS DISTINCT FROM OLD.execution_phase THEN
    NEW.phase_version := OLD.phase_version + 1;
    NEW.phase_updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS generations_normalize_execution_state ON public.generations;
CREATE TRIGGER generations_normalize_execution_state
  BEFORE INSERT OR UPDATE OF status, execution_phase ON public.generations
  FOR EACH ROW EXECUTE FUNCTION private.normalize_generation_execution_state();

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
    generation_id, creative_run_id, creative_step_id, user_id,
    delivery_version, phase_version, execution_phase, event_type,
    upstream_status, metadata
  ) VALUES (
    NEW.id, NEW.creative_run_id, NEW.creative_step_id, NEW.user_id,
    NEW.delivery_version, NEW.phase_version, NEW.execution_phase, v_event_type,
    NEW.last_upstream_status,
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

CREATE OR REPLACE FUNCTION private.sync_creative_run_from_generation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_step_status TEXT;
  v_run_status TEXT;
BEGIN
  IF NEW.creative_run_id IS NULL OR NEW.creative_step_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_step_status := CASE
    WHEN NEW.status IN ('completed', 'partially_completed') THEN 'completed'
    WHEN NEW.status = 'failed' THEN 'failed'
    WHEN NEW.status = 'cancelled' THEN 'cancelled'
    WHEN NEW.status = 'needs_review' THEN 'needs_review'
    WHEN NEW.status = 'queued' THEN 'queued'
    ELSE 'running'
  END;

  UPDATE public.creative_run_steps AS step
  SET status = v_step_status,
      error_message = CASE WHEN v_step_status = 'failed' THEN NEW.error_message ELSE NULL END,
      started_at = CASE
        WHEN v_step_status = 'running' THEN COALESCE(step.started_at, NEW.processing_started_at, clock_timestamp())
        ELSE step.started_at
      END,
      completed_at = CASE
        WHEN v_step_status IN ('completed', 'failed', 'cancelled')
          THEN COALESCE(NEW.completed_at, clock_timestamp())
        ELSE NULL
      END,
      output_payload = CASE
        WHEN v_step_status = 'completed'
          THEN jsonb_build_object('resultUrls', COALESCE(NEW.result_urls, '{}'))
        ELSE step.output_payload
      END,
      updated_at = clock_timestamp()
  WHERE step.id = NEW.creative_step_id
    AND step.run_id = NEW.creative_run_id;

  SELECT CASE
    WHEN bool_or(step.status = 'needs_review') THEN 'needs_review'
    WHEN bool_or(step.status IN ('pending', 'ready', 'queued', 'running')) THEN
      CASE WHEN bool_or(step.status = 'running') THEN 'running' ELSE 'queued' END
    WHEN bool_and(step.status IN ('completed', 'skipped')) THEN 'completed'
    WHEN bool_or(step.status = 'failed') THEN 'failed'
    WHEN bool_or(step.status = 'cancelled') THEN 'cancelled'
    ELSE 'queued'
  END
  INTO v_run_status
  FROM public.creative_run_steps AS step
  WHERE step.run_id = NEW.creative_run_id;

  UPDATE public.creative_runs AS run
  SET status = COALESCE(v_run_status, run.status),
      error_message = CASE WHEN v_run_status = 'failed' THEN NEW.error_message ELSE NULL END,
      started_at = CASE
        WHEN v_run_status = 'running' THEN COALESCE(run.started_at, NEW.processing_started_at, clock_timestamp())
        ELSE run.started_at
      END,
      completed_at = CASE
        WHEN v_run_status IN ('completed', 'failed', 'cancelled')
          THEN COALESCE(NEW.completed_at, clock_timestamp())
        ELSE NULL
      END,
      updated_at = clock_timestamp()
  WHERE run.id = NEW.creative_run_id;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS generations_sync_creative_run ON public.generations;
CREATE TRIGGER generations_sync_creative_run
  AFTER UPDATE OF status, result_urls, error_message ON public.generations
  FOR EACH ROW EXECUTE FUNCTION private.sync_creative_run_from_generation();

CREATE OR REPLACE FUNCTION private.generation_execution_phase_rank(p_phase TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_phase
    WHEN 'queued' THEN 0
    WHEN 'claimed' THEN 10
    WHEN 'submitting' THEN 20
    WHEN 'submitted' THEN 30
    WHEN 'polling' THEN 40
    WHEN 'result_ready' THEN 50
    WHEN 'persisting' THEN 60
    WHEN 'settling' THEN 70
    WHEN 'completed' THEN 80
    WHEN 'cancel_requested' THEN 90
    WHEN 'cancel_polling' THEN 91
    WHEN 'needs_review' THEN 100
    ELSE -1
  END
$$;

CREATE OR REPLACE FUNCTION public.checkpoint_generation_execution(
  p_generation_id UUID,
  p_delivery_version INTEGER,
  p_execution_token UUID,
  p_execution_phase TEXT,
  p_upstream_task_id TEXT DEFAULT NULL,
  p_upstream_request_id TEXT DEFAULT NULL,
  p_upstream_provider TEXT DEFAULT NULL,
  p_upstream_deployment_id TEXT DEFAULT NULL,
  p_upstream_status TEXT DEFAULT NULL,
  p_next_poll_at TIMESTAMPTZ DEFAULT NULL,
  p_result_payload JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_phase TEXT;
  v_updated UUID;
BEGIN
  IF p_generation_id IS NULL OR p_delivery_version < 1 OR p_execution_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_GENERATION_CHECKPOINT' USING ERRCODE = '22023';
  END IF;
  IF private.generation_execution_phase_rank(p_execution_phase) < 0
    OR p_execution_phase IN ('queued', 'claimed', 'completed') THEN
    RAISE EXCEPTION 'INVALID_GENERATION_PHASE:%', p_execution_phase USING ERRCODE = '22023';
  END IF;
  IF p_result_payload IS NOT NULL AND jsonb_typeof(p_result_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_GENERATION_RESULT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  SELECT generation.execution_phase
  INTO v_current_phase
  FROM public.generations AS generation
  WHERE generation.id = p_generation_id
    AND generation.delivery_version = p_delivery_version
    AND generation.execution_token = p_execution_token
    AND generation.status IN ('processing_tryon', 'processing_face_swap')
  FOR UPDATE;

  IF v_current_phase IS NULL THEN
    RETURN FALSE;
  END IF;
  IF v_current_phase IN ('needs_review', 'completed', 'cancel_requested', 'cancel_polling')
  THEN
    RETURN FALSE;
  END IF;
  -- Concurrent progress callbacks may finish persistence out of order. A late
  -- lower-rank checkpoint is an idempotent no-op while the execution fence is
  -- still valid; it must not make a healthy worker look stale.
  IF private.generation_execution_phase_rank(p_execution_phase)
     < private.generation_execution_phase_rank(v_current_phase) THEN
    RETURN TRUE;
  END IF;

  UPDATE public.generations AS generation
  SET execution_phase = p_execution_phase,
      upstream_task_id = COALESCE(NULLIF(btrim(p_upstream_task_id), ''), generation.upstream_task_id),
      upstream_request_id = COALESCE(NULLIF(btrim(p_upstream_request_id), ''), generation.upstream_request_id),
      upstream_provider = COALESCE(NULLIF(btrim(p_upstream_provider), ''), generation.upstream_provider),
      upstream_deployment_id = COALESCE(NULLIF(btrim(p_upstream_deployment_id), ''), generation.upstream_deployment_id),
      submitted_at = CASE
        WHEN p_execution_phase IN ('submitted', 'polling', 'result_ready', 'persisting', 'settling')
          THEN COALESCE(generation.submitted_at, clock_timestamp())
        ELSE generation.submitted_at
      END,
      next_poll_at = p_next_poll_at,
      last_polled_at = CASE WHEN p_execution_phase = 'polling' THEN clock_timestamp() ELSE generation.last_polled_at END,
      last_upstream_status = COALESCE(NULLIF(btrim(p_upstream_status), ''), generation.last_upstream_status),
      execution_result_payload = CASE
        WHEN p_result_payload IS NULL THEN generation.execution_result_payload
        ELSE generation.execution_result_payload || p_result_payload
      END
  WHERE generation.id = p_generation_id
    AND generation.delivery_version = p_delivery_version
    AND generation.execution_token = p_execution_token
  RETURNING generation.id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.mark_generation_needs_review(
  p_generation_id UUID,
  p_delivery_version INTEGER,
  p_execution_token UUID,
  p_reason TEXT,
  p_upstream_status TEXT DEFAULT 'submission_outcome_unknown'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF p_generation_id IS NULL OR p_delivery_version < 1 OR p_execution_token IS NULL
    OR char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 4 AND 500 THEN
    RAISE EXCEPTION 'INVALID_GENERATION_REVIEW_REQUEST' USING ERRCODE = '22023';
  END IF;

  UPDATE public.generations AS generation
  SET status = 'needs_review',
      execution_phase = 'needs_review',
      review_reason = left(btrim(p_reason), 500),
      last_upstream_status = left(COALESCE(NULLIF(btrim(p_upstream_status), ''), 'needs_review'), 160),
      error_message = left(btrim(p_reason), 500),
      next_poll_at = NULL,
      execution_token = NULL,
      execution_lease_expires_at = NULL
  WHERE generation.id = p_generation_id
    AND generation.delivery_version = p_delivery_version
    AND generation.execution_token = p_execution_token
    AND generation.status IN ('processing_tryon', 'processing_face_swap')
  RETURNING generation.id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END
$$;

-- Preserve the current claim signature for rolling compatibility while adding
-- a durable claimed phase. New workers write later checkpoints through the RPC
-- above; old workers continue to receive the same row shape.
CREATE OR REPLACE FUNCTION public.claim_generation_job(
  p_generation_id UUID,
  p_delivery_version INTEGER,
  p_execution_token UUID,
  p_lease_seconds INTEGER DEFAULT 45
)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  job_payload JSONB,
  credits_cost INTEGER,
  job_attempts INTEGER,
  service_tier TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_delivery_version < 1 OR p_execution_token IS NULL
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 15 AND 300 THEN
    RAISE EXCEPTION 'INVALID_GENERATION_CLAIM' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.generations AS generation
  SET status = 'processing_tryon',
      processing_started_at = v_now,
      execution_token = p_execution_token,
      execution_lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      execution_phase = 'claimed',
      next_poll_at = NULL,
      review_reason = NULL,
      reviewed_at = NULL,
      reviewed_by = NULL,
      job_attempts = COALESCE(generation.job_attempts, 0) + 1,
      error_message = NULL
  WHERE generation.id = p_generation_id
    AND generation.delivery_version = p_delivery_version
    AND generation.available_at <= v_now
    AND (
      generation.status = 'queued'
      OR (
        generation.status = 'processing_tryon'
        AND generation.execution_lease_expires_at <= v_now
        AND generation.execution_phase <> 'needs_review'
      )
    )
  RETURNING
    generation.id,
    generation.user_id,
    generation.job_payload,
    generation.credits_cost,
    generation.job_attempts,
    generation.service_tier;
END
$$;

-- Never redeliver a stale submission whose outcome is unknown. The existing
-- recovery implementation is retained for every other expired execution.
DO $$
BEGIN
  -- Some environments received the hardened legacy implementation before the
  -- VOZEB runtime migration was recorded. Preserve that copy and make this
  -- migration safely repeatable instead of attempting to rename over it.
  IF to_regprocedure('private.recover_generation_outbox_legacy(integer,integer)') IS NULL THEN
    ALTER FUNCTION public.recover_generation_outbox(INTEGER, INTEGER) SET SCHEMA private;
    ALTER FUNCTION private.recover_generation_outbox(INTEGER, INTEGER)
      RENAME TO recover_generation_outbox_legacy;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.recover_generation_outbox(
  p_limit INTEGER DEFAULT 500,
  p_max_execution_attempts INTEGER DEFAULT 2
)
RETURNS TABLE(
  recovered_leases INTEGER,
  repaired_missing INTEGER,
  dead_lettered INTEGER,
  redriven_published INTEGER,
  cleaned_retention INTEGER,
  recovered_executions INTEGER,
  failed_executions INTEGER,
  refunded_credits BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_max_execution_attempts IS NULL OR p_max_execution_attempts NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'INVALID_MAX_EXECUTION_ATTEMPTS' USING ERRCODE = '22023';
  END IF;

  UPDATE public.generations AS generation
  SET status = 'needs_review',
      execution_phase = 'needs_review',
      review_reason = '任务在上游提交阶段中断，未能确认是否已经创建供应商任务',
      error_message = '任务在上游提交阶段中断，未能确认是否已经创建供应商任务',
      last_upstream_status = 'submission_outcome_unknown',
      next_poll_at = NULL,
      execution_token = NULL,
      execution_lease_expires_at = NULL
  WHERE generation.id IN (
    SELECT candidate.id
    FROM public.generations AS candidate
    WHERE candidate.status IN ('processing_tryon', 'processing_face_swap')
      AND candidate.execution_phase = 'submitting'
      AND candidate.upstream_task_id IS NULL
      AND candidate.execution_lease_expires_at <= clock_timestamp()
    ORDER BY candidate.execution_lease_expires_at, candidate.created_at, candidate.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  );

  RETURN QUERY
  SELECT *
  FROM private.recover_generation_outbox_legacy(p_limit, p_max_execution_attempts);
END
$$;

-- New parent runs participate in the existing task rail without reviving the
-- old agent_workflows source type.
DO $$
BEGIN
  IF to_regclass('public.task_queue_items') IS NOT NULL THEN
    ALTER TABLE public.task_queue_items
      DROP CONSTRAINT IF EXISTS task_queue_items_source_type_check;
    ALTER TABLE public.task_queue_items
      ADD CONSTRAINT task_queue_items_source_type_check
      CHECK (source_type IN ('generation', 'creative_run', 'ai_tool'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.task_queue_status_group(p_status TEXT, p_result_count INTEGER DEFAULT 0)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_status TEXT := lower(COALESCE(p_status, ''));
BEGIN
  IF v_status IN ('failed', 'timeout', 'canceled', 'cancelled', 'needs_review') THEN RETURN 'failed'; END IF;
  IF v_status IN ('completed', 'succeeded', 'success', 'partially_completed') THEN RETURN 'completed'; END IF;
  IF v_status IN ('queued', 'planned', 'needs_confirmation', 'confirmed', 'waiting_user', 'draft', 'paused') THEN RETURN 'queued'; END IF;
  IF v_status = 'running' OR v_status = 'generating' OR v_status LIKE 'processing%' THEN RETURN 'running'; END IF;
  IF COALESCE(p_result_count, 0) > 0 THEN RETURN 'completed'; END IF;
  RETURN 'queued';
END
$$;

CREATE OR REPLACE FUNCTION private.creative_payload_urls(
  p_payload JSONB,
  p_array_keys TEXT[],
  p_scalar_keys TEXT[],
  p_limit INTEGER DEFAULT 8
)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(array_agg(candidate.url ORDER BY candidate.ordinality), '{}')
  FROM (
    SELECT url, min(ordinality) AS ordinality
    FROM (
      SELECT value AS url, key_name.key_ordinality * 1000 + item.item_ordinality AS ordinality
      FROM unnest(COALESCE(p_array_keys, '{}')) WITH ORDINALITY AS key_name(name, key_ordinality)
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_payload, '{}'::jsonb) -> key_name.name) = 'array'
            THEN COALESCE(p_payload, '{}'::jsonb) -> key_name.name
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS item(value, item_ordinality)
      WHERE value ~ '^https?://'
      UNION ALL
      SELECT COALESCE(p_payload, '{}'::jsonb) ->> scalar_key.name AS url,
             100000 + scalar_key.ordinality
      FROM unnest(COALESCE(p_scalar_keys, '{}')) WITH ORDINALITY AS scalar_key(name, ordinality)
      WHERE COALESCE(p_payload, '{}'::jsonb) ->> scalar_key.name ~ '^https?://'
    ) AS raw_urls
    GROUP BY url
    ORDER BY min(ordinality)
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 32))
  ) AS candidate
$$;

CREATE OR REPLACE FUNCTION private.sync_creative_run_task_queue_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_input_urls TEXT[];
  v_result_urls TEXT[];
  v_result_count INTEGER;
BEGIN
  IF to_regclass('public.task_queue_items') IS NULL THEN RETURN NEW; END IF;
  v_input_urls := private.creative_payload_urls(
    NEW.input_payload,
    ARRAY['inputUrls', 'referenceUrls', 'imageUrls'],
    ARRAY['inputUrl', 'referenceUrl', 'imageUrl'],
    8
  );
  v_result_urls := private.creative_payload_urls(
    NEW.output_payload,
    ARRAY['resultUrls', 'imageUrls', 'urls'],
    ARRAY['selectedImageUrl', 'imageUrl', 'resultUrl'],
    4
  );
  v_result_count := COALESCE(cardinality(v_result_urls), 0);
  INSERT INTO public.task_queue_items (
    user_id, source_type, source_id, module, title, status, status_group,
    progress, expected_count, result_count, input_thumbnails, result_thumbnails,
    error_message, apply_url, created_at, updated_at, completed_at
  ) VALUES (
    NEW.user_id, 'creative_run', NEW.id, 'creativeRun',
    COALESCE(NULLIF(NEW.summary, ''), NULLIF(NEW.intent, ''), '创意任务'),
    NEW.status, public.task_queue_status_group(NEW.status, v_result_count),
    CASE WHEN NEW.status = 'completed' THEN 100 WHEN NEW.status IN ('failed', 'cancelled', 'needs_review') THEN 0 WHEN NEW.status = 'running' THEN 30 ELSE 5 END,
    GREATEST(1, v_result_count), v_result_count, v_input_urls, v_result_urls,
    COALESCE(NEW.error_message, NEW.review_reason),
    '/agent?run=' || NEW.id::TEXT,
    NEW.created_at, NEW.updated_at, NEW.completed_at
  )
  ON CONFLICT (source_type, source_id) DO UPDATE SET
    title = EXCLUDED.title,
    status = EXCLUDED.status,
    status_group = EXCLUDED.status_group,
    progress = EXCLUDED.progress,
    expected_count = EXCLUDED.expected_count,
    result_count = EXCLUDED.result_count,
    input_thumbnails = EXCLUDED.input_thumbnails,
    result_thumbnails = EXCLUDED.result_thumbnails,
    error_message = EXCLUDED.error_message,
    apply_url = EXCLUDED.apply_url,
    updated_at = EXCLUDED.updated_at,
    completed_at = EXCLUDED.completed_at;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[task-queue] creative run % projection skipped: %', NEW.id, SQLERRM;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS creative_runs_task_queue_projection ON public.creative_runs;
CREATE TRIGGER creative_runs_task_queue_projection
  AFTER INSERT OR UPDATE OF status, summary, intent, input_payload, output_payload, review_reason, error_message, completed_at, updated_at
  ON public.creative_runs
  FOR EACH ROW EXECUTE FUNCTION private.sync_creative_run_task_queue_projection();

REVOKE ALL ON FUNCTION private.normalize_generation_execution_state() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.record_generation_execution_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.generation_execution_phase_rank(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_creative_run_task_queue_projection() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.creative_payload_urls(JSONB, TEXT[], TEXT[], INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.recover_generation_outbox_legacy(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_creative_run(UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_generation_to_creative_run(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID[], TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_generation_execution(UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_generation_needs_review(UUID, INTEGER, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_generation_job(UUID, INTEGER, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_generation_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_generation_execution(UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_generation_needs_review(UUID, INTEGER, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_generation_job(UUID, INTEGER, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_generation_outbox(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_creative_run(UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_generation_to_creative_run(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID[], TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_runtime_contract_version()
RETURNS TABLE(contract_version TEXT, contract_hash TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    '2026-08-25.2'::TEXT,
    '9f9bc9c13f693c7297cc81e9a946a8c89d9e52dfef2c890c46604ce99f02946c'::TEXT
  WHERE COALESCE((SELECT auth.role()), '') = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.get_runtime_contract_version()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_runtime_contract_version() TO service_role;

COMMENT ON TABLE public.creative_runs IS 'Durable Agent/canvas parent runtime; media execution stays in generations.';
COMMENT ON FUNCTION public.attach_generation_to_creative_run(UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID[], TEXT)
  IS 'Idempotently binds a generation charged through the existing ledger to an Agent/canvas run step.';
COMMENT ON COLUMN public.generations.execution_phase IS 'Recoverable infrastructure phase, independent from user-facing business status.';
COMMENT ON COLUMN public.generations.phase_version IS 'Monotonic phase fence advanced by the execution-state trigger.';
COMMENT ON FUNCTION public.checkpoint_generation_execution(UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB)
  IS 'Fenced VOZEB-style submit/poll/persist checkpoint for the current generation execution.';
COMMENT ON FUNCTION public.mark_generation_needs_review(UUID, INTEGER, UUID, TEXT, TEXT)
  IS 'Stops automatic retries when an upstream submission or persistence outcome is ambiguous.';

COMMIT;
