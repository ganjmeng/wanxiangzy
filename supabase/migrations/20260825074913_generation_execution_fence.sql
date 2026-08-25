-- Durable execution checkpoints for the existing generations/BullMQ pipeline.
-- This fence prevents duplicate billable submissions after ambiguous network
-- failures without introducing a second task or account model.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

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
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

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
    phase_updated_at = COALESCE(updated_at, created_at, now())
WHERE phase_version = 0
  AND execution_phase = 'queued';

CREATE INDEX IF NOT EXISTS generations_phase_due_idx
  ON public.generations (execution_phase, next_poll_at, available_at, id)
  WHERE status IN ('queued', 'processing_tryon', 'processing_face_swap');
CREATE INDEX IF NOT EXISTS generations_needs_review_idx
  ON public.generations (phase_updated_at, created_at, id)
  WHERE status = 'needs_review' OR execution_phase = 'needs_review';
CREATE UNIQUE INDEX IF NOT EXISTS generations_provider_upstream_uidx
  ON public.generations (
    upstream_provider,
    COALESCE(upstream_deployment_id, ''),
    upstream_task_id
  )
  WHERE upstream_provider IS NOT NULL AND upstream_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.generation_execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES public.generations(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS generation_execution_events_created_brin
  ON public.generation_execution_events USING brin (created_at);
CREATE INDEX IF NOT EXISTS generation_execution_events_user_idx
  ON public.generation_execution_events (user_id);

ALTER TABLE public.generation_execution_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own generation execution events"
  ON public.generation_execution_events;
CREATE POLICY "Users can view own generation execution events"
  ON public.generation_execution_events FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.generation_execution_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.generation_execution_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generation_execution_events TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'generation_execution_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.generation_execution_events;
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
  IF v_current_phase IN ('needs_review', 'completed', 'cancel_requested', 'cancel_polling') THEN
    RETURN FALSE;
  END IF;
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

DO $$
BEGIN
  IF to_regclass('public.task_queue_items') IS NOT NULL THEN
    ALTER TABLE public.task_queue_items
      DROP CONSTRAINT IF EXISTS task_queue_items_source_type_check;
    ALTER TABLE public.task_queue_items
      ADD CONSTRAINT task_queue_items_source_type_check
      CHECK (source_type IN ('generation', 'ai_tool'));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.task_queue_status_group(
  p_status TEXT,
  p_result_count INTEGER DEFAULT 0
)
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

REVOKE ALL ON FUNCTION private.normalize_generation_execution_state()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.record_generation_execution_event()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.generation_execution_phase_rank(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.recover_generation_outbox_legacy(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_generation_execution(
  UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_generation_needs_review(UUID, INTEGER, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_generation_job(UUID, INTEGER, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_generation_outbox(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_generation_execution(
  UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_generation_needs_review(UUID, INTEGER, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_generation_job(UUID, INTEGER, UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_generation_outbox(INTEGER, INTEGER)
  TO service_role;

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

COMMENT ON COLUMN public.generations.execution_phase
  IS 'Recoverable infrastructure phase, independent from user-facing business status.';
COMMENT ON COLUMN public.generations.phase_version
  IS 'Monotonic phase fence advanced by the execution-state trigger.';
COMMENT ON FUNCTION public.checkpoint_generation_execution(
  UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB
) IS 'Fenced submit/poll/persist checkpoint for the current generation execution.';
COMMENT ON FUNCTION public.mark_generation_needs_review(UUID, INTEGER, UUID, TEXT, TEXT)
  IS 'Stops automatic retries when an upstream submission or persistence outcome is ambiguous.';
