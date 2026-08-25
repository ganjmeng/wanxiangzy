-- The imported legacy MiniMax OpenAI-compatible providers were published with
-- the host root as baseUrl. The openai-chat adapter appends
-- /chat/completions, while MiniMax exposes that route below /v1. Repair only
-- the known legacy entries and only when they still use the unversioned host,
-- preserving any later admin override.
WITH latest_published AS (
  SELECT id
  FROM public.admin_config_versions
  WHERE config_key = 'ai.control-plane.v1'
    AND status = 'published'
  ORDER BY published_at DESC NULLS LAST, created_at DESC
  LIMIT 1
), repaired AS (
  SELECT config.id,
    jsonb_set(
      config.value,
      '{providers}',
      COALESCE((
        SELECT jsonb_agg(
          CASE
            WHEN provider->>'id' IN ('legacy-text-minimax', 'legacy-vision-minimax')
              AND rtrim(COALESCE(provider->>'baseUrl', ''), '/') = 'https://api.minimaxi.com'
            THEN jsonb_set(provider, '{baseUrl}', to_jsonb('https://api.minimaxi.com/v1'::TEXT))
            ELSE provider
          END
          ORDER BY ordinal
        )
        FROM jsonb_array_elements(COALESCE(config.value->'providers', '[]'::jsonb))
          WITH ORDINALITY AS providers(provider, ordinal)
      ), '[]'::jsonb),
      false
    ) AS value
  FROM public.admin_config_versions AS config
  JOIN latest_published ON latest_published.id = config.id
)
UPDATE public.admin_config_versions AS config
SET value = repaired.value
FROM repaired
WHERE config.id = repaired.id
  AND config.value IS DISTINCT FROM repaired.value;
