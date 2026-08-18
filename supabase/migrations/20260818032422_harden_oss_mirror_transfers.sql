-- Harden OSS mirror transfers for durable, horizontally scalable production use.
-- Provider-signed URLs are encrypted by the application before they enter Postgres.
-- All state transitions are lease guarded and safe for multiple workers.

ALTER TABLE public.oss_mirror_transfers
  DROP CONSTRAINT IF EXISTS oss_mirror_transfer_source_lifecycle_chk,
  DROP CONSTRAINT IF EXISTS oss_mirror_transfer_lease_chk;

UPDATE public.oss_mirror_transfers
SET status = 'failed',
    source_url = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    last_error = 'invalidated by encrypted OSS mirror migration'
WHERE status IN ('pending', 'processing');

ALTER TABLE public.oss_mirror_transfers
  ADD COLUMN IF NOT EXISTS source_url_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS source_url_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS expected_content_length BIGINT,
  ADD COLUMN IF NOT EXISTS expected_content_type TEXT;

ALTER TABLE public.oss_mirror_transfers
  DROP CONSTRAINT IF EXISTS oss_mirror_transfers_source_url_check,
  DROP CONSTRAINT IF EXISTS oss_mirror_transfers_attempts_check,
  ADD CONSTRAINT oss_mirror_transfers_plaintext_source_forbidden_chk
    CHECK (source_url IS NULL),
  ADD CONSTRAINT oss_mirror_transfers_attempts_check
    CHECK (attempts BETWEEN 0 AND 16),
  ADD CONSTRAINT oss_mirror_transfers_source_ciphertext_chk
    CHECK (
      source_url_ciphertext IS NULL
      OR length(source_url_ciphertext) BETWEEN 16 AND 12000
    ),
  ADD CONSTRAINT oss_mirror_transfers_source_hash_chk
    CHECK (source_url_sha256 IS NULL OR source_url_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT oss_mirror_transfers_expected_length_chk
    CHECK (expected_content_length IS NULL OR expected_content_length > 0),
  ADD CONSTRAINT oss_mirror_transfers_expected_type_chk
    CHECK (
      expected_content_type IS NULL
      OR expected_content_type IN ('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp')
    ),
  ADD CONSTRAINT oss_mirror_transfer_source_lifecycle_chk CHECK (
    (
      status IN ('pending', 'processing')
      AND source_url_ciphertext IS NOT NULL
      AND source_url_sha256 IS NOT NULL
      AND expected_content_length IS NOT NULL
      AND expected_content_type IS NOT NULL
    )
    OR (
      status IN ('completed', 'failed')
      AND source_url_ciphertext IS NULL
      AND source_url_sha256 IS NULL
    )
  ),
  ADD CONSTRAINT oss_mirror_transfer_lease_chk CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS oss_mirror_transfers_generation_ref_uidx
  ON public.oss_mirror_transfers (generation_ref);

DROP INDEX IF EXISTS public.oss_mirror_transfers_retry_idx;
CREATE INDEX oss_mirror_transfers_retry_idx
  ON public.oss_mirror_transfers (next_attempt_at, created_at)
  WHERE status = 'pending';

DROP INDEX IF EXISTS public.oss_mirror_transfers_stale_lease_idx;
CREATE INDEX oss_mirror_transfers_stale_lease_idx
  ON public.oss_mirror_transfers (lease_expires_at, created_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS oss_mirror_transfers_terminal_retention_idx
  ON public.oss_mirror_transfers (status, completed_at, updated_at)
  WHERE status IN ('completed', 'failed');

ALTER TABLE public.oss_mirror_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oss_mirror_transfers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.oss_mirror_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oss_mirror_transfers TO service_role;

CREATE OR REPLACE FUNCTION public.touch_oss_mirror_transfers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_oss_mirror_transfers_updated_at()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_oss_mirror_transfer(
  p_id UUID,
  p_object_key TEXT,
  p_source_url_ciphertext TEXT,
  p_source_url_sha256 TEXT,
  p_source_host TEXT,
  p_generation_ref TEXT,
  p_expected_content_length BIGINT,
  p_expected_content_type TEXT,
  p_expires_at TIMESTAMPTZ,
  p_lease_token UUID,
  p_lease_expires_at TIMESTAMPTZ
)
RETURNS SETOF public.oss_mirror_transfers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  existing public.oss_mirror_transfers%ROWTYPE;
BEGIN
  IF p_source_url_ciphertext IS NULL OR length(p_source_url_ciphertext) NOT BETWEEN 16 AND 12000
    OR p_source_url_sha256 !~ '^[0-9a-f]{64}$'
    OR p_source_host IS NULL OR p_source_host <> lower(p_source_host)
    OR p_expected_content_length <= 0
    OR p_expected_content_type NOT IN ('image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp')
    OR p_expires_at <= now() OR p_expires_at > now() + interval '24 hours'
    OR p_lease_expires_at <= now() OR p_lease_expires_at > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'invalid OSS mirror transfer registration';
  END IF;

  INSERT INTO public.oss_mirror_transfers (
    id, object_key, source_url, source_url_ciphertext, source_url_sha256,
    source_host, generation_ref, status, attempts, lease_token,
    lease_expires_at, next_attempt_at, expires_at,
    expected_content_length, expected_content_type
  ) VALUES (
    p_id, p_object_key, NULL, p_source_url_ciphertext, p_source_url_sha256,
    p_source_host, p_generation_ref, 'processing', 1, p_lease_token,
    p_lease_expires_at, now(), p_expires_at,
    p_expected_content_length, p_expected_content_type
  )
  ON CONFLICT (generation_ref) DO NOTHING;

  SELECT transfer.* INTO existing
  FROM public.oss_mirror_transfers AS transfer
  WHERE transfer.generation_ref = p_generation_ref
  FOR UPDATE;

  IF existing.id IS NULL THEN
    RAISE EXCEPTION 'OSS mirror registration disappeared';
  END IF;

  IF existing.id <> p_id
    AND existing.status <> 'completed'
    AND (
      existing.status = 'failed'
      OR existing.expires_at <= now()
    ) THEN
    UPDATE public.oss_mirror_transfers AS transfer
    SET object_key = p_object_key,
        source_url = NULL,
        source_url_ciphertext = p_source_url_ciphertext,
        source_url_sha256 = p_source_url_sha256,
        source_host = p_source_host,
        status = 'processing',
        attempts = 1,
        lease_token = p_lease_token,
        lease_expires_at = p_lease_expires_at,
        next_attempt_at = now(),
        expires_at = p_expires_at,
        expected_content_length = p_expected_content_length,
        expected_content_type = p_expected_content_type,
        content_length = NULL,
        content_type = NULL,
        last_error = NULL,
        completed_at = NULL
    WHERE transfer.id = existing.id
    RETURNING transfer.* INTO existing;
  END IF;

  RETURN NEXT existing;
END;
$$;

REVOKE ALL ON FUNCTION public.register_oss_mirror_transfer(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TIMESTAMPTZ, UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_oss_mirror_transfer(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TIMESTAMPTZ, UUID, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_oss_mirror_transfer(
  p_id UUID,
  p_lease_token UUID,
  p_lease_expires_at TIMESTAMPTZ
)
RETURNS SETOF public.oss_mirror_transfers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_lease_expires_at <= now() OR p_lease_expires_at > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'invalid OSS mirror transfer lease';
  END IF;

  RETURN QUERY
  UPDATE public.oss_mirror_transfers AS transfer
  SET status = 'processing',
      attempts = transfer.attempts + 1,
      lease_token = p_lease_token,
      lease_expires_at = p_lease_expires_at,
      last_error = NULL
  WHERE transfer.id = p_id
    AND transfer.source_url_ciphertext IS NOT NULL
    AND transfer.expires_at > now()
    AND transfer.attempts < 16
    AND (
      (transfer.status = 'pending' AND transfer.next_attempt_at <= now())
      OR (transfer.status = 'processing' AND transfer.lease_expires_at <= now())
    )
  RETURNING transfer.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_oss_mirror_transfer(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_oss_mirror_transfer(UUID, UUID, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_oss_mirror_transfers(
  p_limit INTEGER,
  p_lease_token UUID,
  p_lease_expires_at TIMESTAMPTZ
)
RETURNS SETOF public.oss_mirror_transfers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100
    OR p_lease_expires_at <= now()
    OR p_lease_expires_at > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'invalid OSS mirror transfer claim';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT transfer.id
    FROM public.oss_mirror_transfers AS transfer
    WHERE transfer.source_url_ciphertext IS NOT NULL
      AND transfer.expires_at > now()
      AND transfer.attempts < 16
      AND (
        (transfer.status = 'pending' AND transfer.next_attempt_at <= now())
        OR (transfer.status = 'processing' AND transfer.lease_expires_at <= now())
      )
    ORDER BY transfer.next_attempt_at, transfer.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.oss_mirror_transfers AS transfer
  SET status = 'processing',
      attempts = transfer.attempts + 1,
      lease_token = p_lease_token,
      lease_expires_at = p_lease_expires_at,
      last_error = NULL
  FROM candidates
  WHERE transfer.id = candidates.id
  RETURNING transfer.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_oss_mirror_transfers(INTEGER, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_oss_mirror_transfers(INTEGER, UUID, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_oss_mirror_transfer(
  p_id UUID,
  p_lease_token UUID,
  p_content_length BIGINT,
  p_content_type TEXT
)
RETURNS SETOF public.oss_mirror_transfers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.oss_mirror_transfers AS transfer
  SET status = 'completed',
      source_url_ciphertext = NULL,
      source_url_sha256 = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      content_length = p_content_length,
      content_type = p_content_type,
      last_error = NULL,
      completed_at = now()
  WHERE transfer.id = p_id
    AND transfer.status = 'processing'
    AND transfer.lease_token = p_lease_token
    AND transfer.lease_expires_at > now()
    AND transfer.expected_content_length = p_content_length
    AND transfer.expected_content_type = p_content_type
  RETURNING transfer.*;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_oss_mirror_transfer(UUID, UUID, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_oss_mirror_transfer(UUID, UUID, BIGINT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.defer_oss_mirror_transfer(
  p_id UUID,
  p_lease_token UUID,
  p_last_error TEXT,
  p_next_attempt_at TIMESTAMPTZ,
  p_max_attempts INTEGER
)
RETURNS SETOF public.oss_mirror_transfers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_max_attempts < 1 OR p_max_attempts > 16
    OR p_next_attempt_at > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'invalid OSS mirror transfer deferral';
  END IF;

  RETURN QUERY
  UPDATE public.oss_mirror_transfers AS transfer
  SET status = CASE
        WHEN transfer.attempts >= p_max_attempts OR transfer.expires_at <= now()
          THEN 'failed'
        ELSE 'pending'
      END,
      source_url_ciphertext = CASE
        WHEN transfer.attempts >= p_max_attempts OR transfer.expires_at <= now()
          THEN NULL
        ELSE transfer.source_url_ciphertext
      END,
      source_url_sha256 = CASE
        WHEN transfer.attempts >= p_max_attempts OR transfer.expires_at <= now()
          THEN NULL
        ELSE transfer.source_url_sha256
      END,
      lease_token = NULL,
      lease_expires_at = NULL,
      next_attempt_at = greatest(p_next_attempt_at, now()),
      last_error = left(coalesce(p_last_error, 'unknown mirror failure'), 1000)
  WHERE transfer.id = p_id
    AND transfer.status = 'processing'
    AND transfer.lease_token = p_lease_token
  RETURNING transfer.*;
END;
$$;

REVOKE ALL ON FUNCTION public.defer_oss_mirror_transfer(UUID, UUID, TEXT, TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_oss_mirror_transfer(UUID, UUID, TEXT, TIMESTAMPTZ, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.expire_oss_mirror_transfers(p_limit INTEGER)
RETURNS SETOF public.oss_mirror_transfers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'invalid OSS mirror expiry limit';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT transfer.id
    FROM public.oss_mirror_transfers AS transfer
    WHERE transfer.status IN ('pending', 'processing')
      AND (
        transfer.expires_at <= now()
        OR (
          transfer.attempts >= 16
          AND (
            transfer.status = 'pending'
            OR transfer.lease_expires_at <= now()
          )
        )
      )
    ORDER BY transfer.expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.oss_mirror_transfers AS transfer
  SET status = 'failed',
      source_url_ciphertext = NULL,
      source_url_sha256 = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = CASE
        WHEN transfer.expires_at <= now() THEN 'mirror mapping expired before completion'
        ELSE 'mirror mapping exhausted the maximum recovery attempts'
      END
  FROM candidates
  WHERE transfer.id = candidates.id
  RETURNING transfer.*;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_oss_mirror_transfers(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_oss_mirror_transfers(INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_oss_mirror_transfers(
  p_completed_before TIMESTAMPTZ,
  p_failed_before TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS SETOF public.oss_mirror_transfers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'invalid OSS mirror cleanup limit';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT transfer.id
    FROM public.oss_mirror_transfers AS transfer
    WHERE (transfer.status = 'completed' AND transfer.completed_at < p_completed_before)
       OR (transfer.status = 'failed' AND transfer.updated_at < p_failed_before)
    ORDER BY transfer.updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  DELETE FROM public.oss_mirror_transfers AS transfer
  USING candidates
  WHERE transfer.id = candidates.id
  RETURNING transfer.*;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_oss_mirror_transfers(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_oss_mirror_transfers(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER)
  TO service_role;
