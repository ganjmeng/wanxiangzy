-- Restore the helper required by generations_task_queue_items_sync.
-- A partial AI-tool queue deployment replaced task_queue_upsert_generation
-- without installing this dependency, causing every generations INSERT to fail.
CREATE OR REPLACE FUNCTION public.task_queue_generation_expected_count(
  p_payload JSONB,
  p_reference_url TEXT,
  p_result_count INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_kind TEXT := coalesce(p_payload ->> 'kind', p_payload ->> 'module', '');
  v_gen_count INTEGER := public.task_queue_json_int(p_payload, ARRAY['genCount', 'count', 'n'], 1);
  v_reference_count INTEGER := 1;
BEGIN
  IF v_kind = 'tryon' THEN
    IF coalesce(p_payload ->> 'sceneMode', '') = 'auto_design' THEN
      v_reference_count := 1;
    ELSIF jsonb_typeof(p_payload -> 'referenceUrls') = 'array' THEN
      v_reference_count := greatest(1, jsonb_array_length(p_payload -> 'referenceUrls'));
    ELSIF coalesce(p_payload ->> 'referenceUrl', p_reference_url, '') <> '' THEN
      v_reference_count := 1;
    END IF;

    RETURN greatest(1, v_gen_count * v_reference_count, p_result_count);
  END IF;

  RETURN greatest(
    1,
    public.task_queue_json_int(
      p_payload,
      ARRAY['imageCount', 'count', 'genCount', 'n'],
      greatest(1, p_result_count)
    ),
    p_result_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.task_queue_generation_expected_count(JSONB, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_queue_generation_expected_count(JSONB, TEXT, INTEGER)
  TO service_role;
