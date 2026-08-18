-- Durable server-only control-plane records for OSS mirror back-to-origin.
-- Image bytes never enter Postgres; source_url is cleared after completion or
-- terminal failure so temporary provider signatures are not retained.
CREATE TABLE public.oss_mirror_transfers (
  id UUID PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE
    CHECK (
      length(object_key) BETWEEN 1 AND 1023
      AND object_key !~ '[\\?#]'
      AND object_key !~ '(^|/)\.\.(/|$)'
    ),
  source_url TEXT
    CHECK (source_url IS NULL OR source_url ~ '^https://'),
  source_host TEXT NOT NULL
    CHECK (source_host = lower(source_host) AND source_host !~ '[/\\?#]'),
  generation_ref TEXT NOT NULL CHECK (length(generation_ref) BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 0 AND 8),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  content_length BIGINT CHECK (content_length IS NULL OR content_length > 0),
  content_type TEXT,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 1000),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oss_mirror_transfer_source_lifecycle_chk CHECK (
    (status IN ('pending', 'processing') AND source_url IS NOT NULL)
    OR (status IN ('completed', 'failed') AND source_url IS NULL)
  ),
  CONSTRAINT oss_mirror_transfer_lease_chk CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT oss_mirror_transfer_expiry_chk CHECK (expires_at > created_at)
);

CREATE INDEX oss_mirror_transfers_retry_idx
  ON public.oss_mirror_transfers (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE INDEX oss_mirror_transfers_stale_lease_idx
  ON public.oss_mirror_transfers (lease_expires_at)
  WHERE status = 'processing';

ALTER TABLE public.oss_mirror_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oss_mirror_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oss_mirror_transfers TO service_role;

CREATE OR REPLACE FUNCTION public.touch_oss_mirror_transfers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER oss_mirror_transfers_touch_updated_at
  BEFORE UPDATE ON public.oss_mirror_transfers
  FOR EACH ROW EXECUTE FUNCTION public.touch_oss_mirror_transfers_updated_at();

REVOKE ALL ON FUNCTION public.touch_oss_mirror_transfers_updated_at()
  FROM PUBLIC, anon, authenticated;

-- Claim retryable rows with SKIP LOCKED so multiple EC2 worker processes can
-- recover transfers concurrently without duplicate control-plane work.
CREATE OR REPLACE FUNCTION public.claim_oss_mirror_transfers(
  p_limit INTEGER,
  p_lease_token UUID,
  p_lease_expires_at TIMESTAMPTZ
)
RETURNS SETOF public.oss_mirror_transfers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 20
    OR p_lease_expires_at <= now()
    OR p_lease_expires_at > now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'invalid OSS mirror transfer claim';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT transfer.id
    FROM public.oss_mirror_transfers AS transfer
    WHERE transfer.source_url IS NOT NULL
      AND transfer.expires_at > now()
      AND transfer.attempts < 8
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
