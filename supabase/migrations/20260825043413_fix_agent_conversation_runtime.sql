-- Repair the Agent generation attach function. Because the function returns a
-- column named run_id, PL/pgSQL treated ON CONFLICT (run_id, step_key) as an
-- ambiguous reference on Postgres 17. Targeting the named constraint removes
-- the output-variable/column collision without changing the RPC contract.
DO $migration$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.attach_generation_to_creative_run(uuid,uuid,uuid,text,text,text,jsonb,uuid,uuid[],text)'::regprocedure
  ) INTO v_definition;

  IF strpos(v_definition, 'ON CONFLICT (run_id, step_key) DO NOTHING') > 0 THEN
    EXECUTE replace(
      v_definition,
      'ON CONFLICT (run_id, step_key) DO NOTHING',
      'ON CONFLICT ON CONSTRAINT creative_run_steps_run_id_step_key_key DO NOTHING'
    );
  ELSIF strpos(v_definition, 'ON CONFLICT ON CONSTRAINT creative_run_steps_run_id_step_key_key DO NOTHING') = 0 THEN
    RAISE EXCEPTION 'attach_generation_to_creative_run has an unexpected definition';
  END IF;
END
$migration$;

-- VOZEB conversations are durable entities, while each creative_runs row is a
-- single planner/generation turn. Keeping both levels lets one sidebar item
-- contain multiple user/assistant turns and multiple media runs.
CREATE TABLE IF NOT EXISTS public.creative_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surface TEXT NOT NULL DEFAULT 'agent' CHECK (surface IN ('agent', 'canvas')),
  title TEXT NOT NULL DEFAULT '新对话' CHECK (char_length(title) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creative_conversations_user_surface_updated_idx
  ON public.creative_conversations (user_id, surface, last_message_at DESC, id);

ALTER TABLE public.creative_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own creative conversations" ON public.creative_conversations;
CREATE POLICY "Users can view own creative conversations"
  ON public.creative_conversations FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.creative_conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.creative_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_conversations TO service_role;

CREATE TABLE IF NOT EXISTS public.creative_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.creative_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.creative_runs(id) ON DELETE SET NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('running', 'completed', 'failed')),
  content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 12000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, sequence)
);

CREATE INDEX IF NOT EXISTS creative_messages_conversation_sequence_idx
  ON public.creative_messages (conversation_id, sequence, id);
CREATE INDEX IF NOT EXISTS creative_messages_user_created_idx
  ON public.creative_messages (user_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS creative_messages_run_idx
  ON public.creative_messages (run_id)
  WHERE run_id IS NOT NULL;

ALTER TABLE public.creative_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own creative messages" ON public.creative_messages;
CREATE POLICY "Users can view own creative messages"
  ON public.creative_messages FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.creative_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.creative_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_messages TO service_role;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.creative_runs'::regclass
      AND conname = 'creative_runs_conversation_id_fkey'
  ) THEN
    ALTER TABLE public.creative_runs
      ADD CONSTRAINT creative_runs_conversation_id_fkey
      FOREIGN KEY (conversation_id)
      REFERENCES public.creative_conversations(id)
      ON DELETE SET NULL;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS creative_runs_conversation_created_idx
  ON public.creative_runs (conversation_id, created_at, id)
  WHERE conversation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.append_creative_conversation_exchange(
  p_user_id UUID,
  p_conversation_id UUID,
  p_user_content TEXT,
  p_assistant_content TEXT,
  p_assistant_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title TEXT;
  v_sequence BIGINT;
  v_user_message_id UUID;
  v_assistant_message_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_conversation_id IS NULL
    OR char_length(btrim(COALESCE(p_user_content, ''))) NOT BETWEEN 1 AND 4000
    OR char_length(btrim(COALESCE(p_assistant_content, ''))) NOT BETWEEN 1 AND 12000
    OR jsonb_typeof(COALESCE(p_assistant_metadata, '{}'::jsonb)) <> 'object'
    OR octet_length(COALESCE(p_assistant_metadata, '{}'::jsonb)::TEXT) > 65536 THEN
    RAISE EXCEPTION 'INVALID_CREATIVE_EXCHANGE' USING ERRCODE = '22023';
  END IF;

  SELECT conversation.title INTO v_title
  FROM public.creative_conversations AS conversation
  WHERE conversation.id = p_conversation_id
    AND conversation.user_id = p_user_id
    AND conversation.status = 'active'
  FOR UPDATE;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'CREATIVE_CONVERSATION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(max(message.sequence), 0) + 1 INTO v_sequence
  FROM public.creative_messages AS message
  WHERE message.conversation_id = p_conversation_id;

  INSERT INTO public.creative_messages (
    conversation_id, user_id, sequence, role, status, content
  ) VALUES (
    p_conversation_id, p_user_id, v_sequence, 'user', 'completed', btrim(p_user_content)
  ) RETURNING id INTO v_user_message_id;

  INSERT INTO public.creative_messages (
    conversation_id, user_id, sequence, role, status, content, metadata
  ) VALUES (
    p_conversation_id, p_user_id, v_sequence + 1, 'assistant', 'completed',
    btrim(p_assistant_content), COALESCE(p_assistant_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_assistant_message_id;

  UPDATE public.creative_conversations AS conversation
  SET title = CASE
        WHEN conversation.title = '新对话' THEN left(btrim(p_user_content), 120)
        ELSE conversation.title
      END,
      updated_at = clock_timestamp(),
      last_message_at = clock_timestamp()
  WHERE conversation.id = p_conversation_id;

  RETURN jsonb_build_object(
    'userMessageId', v_user_message_id,
    'assistantMessageId', v_assistant_message_id,
    'userSequence', v_sequence,
    'assistantSequence', v_sequence + 1
  );
END
$$;

REVOKE ALL ON FUNCTION public.append_creative_conversation_exchange(UUID, UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_creative_conversation_exchange(UUID, UUID, TEXT, TEXT, JSONB)
  TO service_role;

-- Old broken attempts had no child steps and could never leave draft. Marking
-- only already-stale, zero-step Agent runs terminal prevents permanent spinners
-- while keeping their audit history visible.
UPDATE public.creative_runs AS run
SET status = 'failed',
    error_message = COALESCE(run.error_message, '任务未能启动，请重新提交'),
    completed_at = COALESCE(run.completed_at, clock_timestamp()),
    updated_at = clock_timestamp()
WHERE run.surface = 'agent'
  AND run.status = 'draft'
  AND run.created_at < clock_timestamp() - interval '5 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM public.creative_run_steps AS step WHERE step.run_id = run.id
  );
