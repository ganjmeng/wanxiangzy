-- ============================================================
-- Lightweight task queue read model
-- Run after schema.sql and atomic-credit-rpc.sql.
-- ============================================================

-- Ensure generation rows have a reliable "last changed" timestamp.
-- Older installs had created_at/completed_at but no updated_at.
ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS job_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.generations
SET updated_at = coalesce(completed_at, processing_started_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE public.generations
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_generations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generations_set_updated_at ON public.generations;
CREATE TRIGGER generations_set_updated_at
  BEFORE UPDATE ON public.generations
  FOR EACH ROW EXECUTE FUNCTION public.set_generations_updated_at();

CREATE TABLE IF NOT EXISTS public.task_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('generation', 'creative_run', 'ai_tool')),
  source_id UUID NOT NULL,
  module TEXT NOT NULL DEFAULT 'tryon',
  title TEXT NOT NULL DEFAULT U&'\4EFB\52A1',
  status TEXT NOT NULL DEFAULT 'queued',
  status_group TEXT NOT NULL DEFAULT 'queued' CHECK (status_group IN ('queued', 'running', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  expected_count INTEGER NOT NULL DEFAULT 1 CHECK (expected_count >= 1),
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  input_thumbnails TEXT[] NOT NULL DEFAULT '{}',
  result_thumbnails TEXT[] NOT NULL DEFAULT '{}',
  error_message TEXT,
  apply_url TEXT NOT NULL DEFAULT '/create',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (source_type, source_id)
);

-- Existing installations may still carry the original two-value check.
ALTER TABLE public.task_queue_items
  DROP CONSTRAINT IF EXISTS task_queue_items_source_type_check;
ALTER TABLE public.task_queue_items
  ADD CONSTRAINT task_queue_items_source_type_check
  CHECK (source_type IN ('generation', 'creative_run', 'ai_tool'));

CREATE INDEX IF NOT EXISTS task_queue_items_user_module_created_idx
  ON public.task_queue_items(user_id, module, created_at DESC);

CREATE INDEX IF NOT EXISTS task_queue_items_user_status_created_idx
  ON public.task_queue_items(user_id, status_group, created_at DESC);

CREATE INDEX IF NOT EXISTS task_queue_items_user_created_idx
  ON public.task_queue_items(user_id, created_at DESC);

ALTER TABLE public.task_queue_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own task queue items" ON public.task_queue_items;
CREATE POLICY "Users can view own task queue items"
  ON public.task_queue_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.task_queue_status_group(p_status TEXT, p_result_count INTEGER DEFAULT 0)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_status TEXT := lower(coalesce(p_status, ''));
BEGIN
  IF v_status IN ('failed', 'timeout', 'canceled', 'cancelled', 'needs_review') THEN
    RETURN 'failed';
  END IF;
  IF v_status IN ('completed', 'succeeded', 'success', 'partially_completed') THEN
    RETURN 'completed';
  END IF;
  IF v_status IN ('queued', 'planned', 'needs_confirmation', 'confirmed', 'waiting_user') THEN
    RETURN 'queued';
  END IF;
  IF v_status = 'running' OR v_status = 'generating' OR v_status LIKE 'processing%' THEN
    RETURN 'running';
  END IF;
  IF coalesce(p_result_count, 0) > 0 THEN
    RETURN 'completed';
  END IF;
  RETURN 'queued';
END;
$$;

CREATE OR REPLACE FUNCTION public.task_queue_normalize_module(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT := lower(trim(coalesce(p_value, '')));
BEGIN
  IF v IN ('productretouch', 'product-retouch', 'product_retouch') THEN RETURN 'productRetouch'; END IF;
  IF v IN ('productset', 'product-set', 'product_set') THEN RETURN 'productSet'; END IF;
  IF v IN ('face-swap', 'faceswap', 'face') OR v LIKE '%face%' THEN RETURN 'faceSwap'; END IF;
  IF v IN ('try-on', 'try_on', 'tryon', 'garment-tryon') OR v LIKE '%tryon%' THEN RETURN 'tryon'; END IF;
  IF v IN ('model-background', 'model_background', 'modelbackground', 'background') THEN RETURN 'modelBackground'; END IF;
  IF v IN ('garment-3d', 'garment3d', 'clothing3d', '3d') THEN RETURN 'garment3d'; END IF;
  IF v IN ('general-image', 'general_image', 'generalimage') THEN RETURN 'generalImage'; END IF;
  IF v IN ('toolbox', 'ai-tool', 'ai_tools', 'ai-tools') THEN RETURN 'toolbox'; END IF;
  IF v IN ('grass', 'seeding') THEN RETURN 'grass'; END IF;
  IF v LIKE '%pose%' THEN RETURN 'pose'; END IF;
  IF v = '' THEN RETURN 'creativeRun'; END IF;
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_queue_module_title(p_module TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_module
    WHEN 'productRetouch' THEN RETURN U&'\5546\54C1\7CBE\4FEE';
    WHEN 'tryon' THEN RETURN U&'\670D\88C5\4E0A\8EAB';
    WHEN 'model' THEN RETURN U&'\4E13\5C5E\6A21\7279';
    WHEN 'faceSwap' THEN RETURN U&'\6362\8138';
    WHEN 'grass' THEN RETURN U&'\79CD\8349\56FE';
    WHEN 'productSet' THEN RETURN U&'\5546\54C1\5957\56FE';
    WHEN 'modelBackground' THEN RETURN U&'\6362\80CC\666F';
    WHEN 'pose' THEN RETURN U&'\59FF\52BF\88C2\53D8';
    WHEN 'garment3d' THEN RETURN U&'\670D\88C5 3D';
    WHEN 'generalImage' THEN RETURN U&'\521B\610F\751F\56FE';
    WHEN 'creativeRun' THEN RETURN U&'\521B\610F\4EFB\52A1';
    WHEN 'toolbox' THEN RETURN U&'AI \5DE5\5177\7BB1';
    ELSE RETURN U&'AI \4EFB\52A1';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_queue_module_path(p_module TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_module
    WHEN 'productRetouch' THEN RETURN '/product-retouch';
    WHEN 'tryon' THEN RETURN '/create';
    WHEN 'model' THEN RETURN '/model';
    WHEN 'faceSwap' THEN RETURN '/face-swap';
    WHEN 'grass' THEN RETURN '/grass';
    WHEN 'productSet' THEN RETURN '/product-set';
    WHEN 'modelBackground' THEN RETURN '/model-background';
    WHEN 'pose' THEN RETURN '/pose';
    WHEN 'garment3d' THEN RETURN '/garment-3d';
    WHEN 'generalImage' THEN RETURN '/general-image';
    WHEN 'toolbox' THEN RETURN '/ai-tools/matting';
    ELSE RETURN '/history';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_queue_json_int(p_payload JSONB, p_keys TEXT[], p_fallback INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_key TEXT;
  v_value TEXT;
BEGIN
  FOREACH v_key IN ARRAY p_keys LOOP
    v_value := p_payload ->> v_key;
    IF v_value ~ '^[0-9]+$' THEN
      RETURN greatest(1, v_value::INTEGER);
    END IF;
  END LOOP;
  RETURN greatest(1, coalesce(p_fallback, 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.task_queue_json_text_array(p_payload JSONB, p_key TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(array_agg(value), '{}')
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload -> p_key) = 'array' THEN p_payload -> p_key
      ELSE '[]'::jsonb
    END
  ) AS value
$$;

CREATE OR REPLACE FUNCTION public.task_queue_generation_module(
  p_payload JSONB,
  p_clothing_urls TEXT[],
  p_model_face_url TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_kind TEXT := coalesce(p_payload ->> 'kind', p_payload ->> 'module', '');
BEGIN
  IF jsonb_typeof(p_payload -> 'aiTool') = 'object' THEN RETURN 'toolbox'; END IF;
  IF v_kind <> '' THEN RETURN public.task_queue_normalize_module(v_kind); END IF;
  IF coalesce(array_length(p_clothing_urls, 1), 0) > 0 THEN RETURN 'tryon'; END IF;
  IF coalesce(p_model_face_url, '') <> '' THEN RETURN 'faceSwap'; END IF;
  IF jsonb_typeof(p_payload -> 'productImageUrls') = 'array' THEN RETURN 'productSet'; END IF;
  IF coalesce(p_payload ->> 'mainImageUrl', '') <> '' THEN RETURN 'pose'; END IF;
  IF coalesce(p_payload ->> 'garmentUrl', '') <> '' THEN RETURN 'garment3d'; END IF;
  IF jsonb_typeof(p_payload -> 'referenceUrls') = 'array' THEN RETURN 'model'; END IF;
  RETURN 'tryon';
END;
$$;

CREATE OR REPLACE FUNCTION public.task_queue_ai_tool_path(p_operation TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_operation
    WHEN 'matting' THEN '/ai-tools/matting'
    WHEN 'upscale' THEN '/ai-tools/upscale'
    WHEN 'outpaint' THEN '/ai-tools/outpaint'
    WHEN 'erase' THEN '/ai-tools/erase'
    WHEN 'repair-limbs' THEN '/ai-tools/hand-foot-repair'
    WHEN 'repair-garment' THEN '/ai-tools/clothing-repair'
    WHEN 'repair-footwear' THEN '/ai-tools/shoe-repair'
    WHEN 'resize' THEN '/ai-tools/resize'
    ELSE '/ai-tools/matting'
  END
$$;

CREATE OR REPLACE FUNCTION public.task_queue_ai_tool_title(p_operation TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_operation
    WHEN 'matting' THEN U&'AI\62A0\56FE'
    WHEN 'upscale' THEN U&'\56FE\7247\8D85\6E05'
    WHEN 'outpaint' THEN U&'AI\6269\56FE'
    WHEN 'erase' THEN U&'AI\6D88\9664'
    WHEN 'repair-limbs' THEN U&'\624B\811A\4FEE\590D'
    WHEN 'repair-garment' THEN U&'\670D\9970\4FEE\590D'
    WHEN 'repair-footwear' THEN U&'\978B\9774\4FEE\590D'
    WHEN 'resize' THEN U&'\65E0\635F\6539\5C3A\5BF8'
    ELSE U&'AI \5DE5\5177\7BB1'
  END
$$;

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
    public.task_queue_json_int(p_payload, ARRAY['imageCount', 'count', 'genCount', 'n'], greatest(1, p_result_count)),
    p_result_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.task_queue_upsert_generation(p_item public.generations)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload JSONB := coalesce(p_item.job_payload, '{}'::jsonb);
  v_result_count INTEGER := coalesce(array_length(p_item.result_urls, 1), 0);
  v_module TEXT := public.task_queue_generation_module(v_payload, p_item.clothing_urls, p_item.model_face_url);
  v_status_group TEXT := public.task_queue_status_group(p_item.status, v_result_count);
  v_input_thumbnails TEXT[];
  v_result_thumbnails TEXT[];
  v_progress INTEGER;
BEGIN
  SELECT coalesce(array_agg(DISTINCT url), '{}')
    INTO v_input_thumbnails
  FROM (
    SELECT unnest(coalesce(p_item.clothing_urls, '{}'::TEXT[])) AS url
    UNION ALL SELECT p_item.reference_url
    UNION ALL SELECT p_item.model_face_url
    UNION ALL SELECT unnest(public.task_queue_json_text_array(v_payload, 'clothingUrls'))
    UNION ALL SELECT unnest(public.task_queue_json_text_array(v_payload, 'referenceUrls'))
    UNION ALL SELECT unnest(public.task_queue_json_text_array(v_payload, 'referenceImageUrls'))
    UNION ALL SELECT unnest(public.task_queue_json_text_array(v_payload, 'sceneImages'))
    UNION ALL SELECT v_payload ->> 'clothingUrl'
    UNION ALL SELECT v_payload ->> 'referenceUrl'
    UNION ALL SELECT v_payload ->> 'modelFaceUrl'
    UNION ALL SELECT v_payload ->> 'targetFaceUrl'
  ) AS urls
  WHERE url IS NOT NULL AND btrim(url) <> ''
  LIMIT 8;

  SELECT coalesce(array_agg(url), '{}')
    INTO v_result_thumbnails
  FROM (
    SELECT unnest(coalesce(p_item.result_urls, '{}'::TEXT[])) AS url
    LIMIT 2
  ) AS urls;

  v_progress := CASE
    WHEN v_status_group = 'completed' THEN 100
    WHEN v_status_group = 'failed' THEN 0
    WHEN (v_payload -> 'asyncTask' ->> 'progress') ~ '^[0-9]+$' THEN least(99, greatest(1, (v_payload -> 'asyncTask' ->> 'progress')::INTEGER))
    WHEN v_status_group = 'running' THEN 34
    ELSE 8
  END;

  INSERT INTO public.task_queue_items (
    user_id, source_type, source_id, module, title, status, status_group, progress,
    expected_count, result_count, input_thumbnails, result_thumbnails, error_message,
    apply_url, created_at, updated_at, completed_at
  )
  VALUES (
    p_item.user_id, 'generation', p_item.id, v_module,
    CASE
      WHEN v_module = 'toolbox' THEN public.task_queue_ai_tool_title(v_payload -> 'aiTool' ->> 'operation')
      ELSE public.task_queue_module_title(v_module)
    END,
    coalesce(p_item.status, 'queued'), v_status_group, v_progress,
    public.task_queue_generation_expected_count(v_payload, p_item.reference_url, v_result_count),
    v_result_count, v_input_thumbnails, v_result_thumbnails, p_item.error_message,
    CASE
      WHEN v_module = 'toolbox'
        THEN public.task_queue_ai_tool_path(v_payload -> 'aiTool' ->> 'operation') || '?task=' || p_item.id::TEXT
      WHEN v_module = 'generalImage' AND (
        v_payload ->> 'mode' = 'image-to-image'
        OR (
          v_payload ->> 'mode' IS NULL
          AND jsonb_typeof(v_payload -> 'referenceUrls') = 'array'
          AND jsonb_array_length(v_payload -> 'referenceUrls') > 0
        )
      )
        THEN '/general-image/image-to-image?apply=' || p_item.id::TEXT
      ELSE public.task_queue_module_path(v_module) || '?apply=' || p_item.id::TEXT
    END,
    p_item.created_at, coalesce(p_item.updated_at, p_item.completed_at, p_item.processing_started_at, p_item.created_at), p_item.completed_at
  )
  ON CONFLICT (source_type, source_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    module = EXCLUDED.module,
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
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    completed_at = EXCLUDED.completed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.task_queue_sync_generation_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- task_queue_items is a derived read model. Projection drift must never
  -- abort the durable generations write that billing and workers depend on.
  BEGIN
    PERFORM public.task_queue_upsert_generation(NEW);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[task-queue] generation % projection skipped: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS generations_task_queue_items_sync ON public.generations;
CREATE TRIGGER generations_task_queue_items_sync
  AFTER INSERT OR UPDATE ON public.generations
  FOR EACH ROW EXECUTE FUNCTION public.task_queue_sync_generation_trigger();

-- Backfill is idempotent. Re-run safely after deploying this migration.
SELECT public.task_queue_upsert_generation(g)
FROM public.generations AS g;

-- These functions are internal trigger/migration helpers. Keep them out of the
-- exposed PostgREST RPC surface while retaining service-role maintenance access.
REVOKE ALL ON FUNCTION public.task_queue_generation_expected_count(JSONB, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.task_queue_upsert_generation(public.generations) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.task_queue_sync_generation_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_queue_generation_expected_count(JSONB, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.task_queue_upsert_generation(public.generations) TO service_role;
