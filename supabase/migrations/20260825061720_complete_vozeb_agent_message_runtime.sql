-- Complete the VOZEB message lifecycle: the public transcript supports all
-- original roles/statuses and follows the durable creative run automatically.

ALTER TABLE public.creative_messages
  DROP CONSTRAINT IF EXISTS creative_messages_role_check;
ALTER TABLE public.creative_messages
  DROP CONSTRAINT IF EXISTS creative_messages_role;
ALTER TABLE public.creative_messages
  ADD CONSTRAINT creative_messages_role_check
  CHECK (role IN ('user', 'assistant', 'system', 'tool'));

ALTER TABLE public.creative_messages
  DROP CONSTRAINT IF EXISTS creative_messages_status_check;
ALTER TABLE public.creative_messages
  DROP CONSTRAINT IF EXISTS creative_messages_status;
ALTER TABLE public.creative_messages
  ADD CONSTRAINT creative_messages_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'cancelled'));

CREATE OR REPLACE FUNCTION public.creative_agent_complete_process(
  p_metadata JSONB,
  p_terminal_status TEXT,
  p_detail TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_set(
    jsonb_set(
      COALESCE(p_metadata, '{}'::jsonb),
      '{process,status}',
      to_jsonb(CASE WHEN p_terminal_status = 'completed' THEN 'completed' ELSE 'failed' END),
      true
    ),
    '{process,steps}',
    COALESCE((
      SELECT jsonb_agg(
        CASE
          WHEN step->>'status' = 'running' THEN
            jsonb_set(
              jsonb_set(step, '{status}', to_jsonb(CASE WHEN p_terminal_status = 'completed' THEN 'completed' ELSE 'failed' END), true),
              '{detail}',
              to_jsonb(COALESCE(NULLIF(p_detail, ''), CASE WHEN p_terminal_status = 'completed' THEN '任务已完成，结果已整理' ELSE '任务执行失败' END)),
              true
            )
          ELSE step
        END
      )
      FROM jsonb_array_elements(COALESCE(p_metadata->'process'->'steps', '[]'::jsonb)) AS step
    ), '[]'::jsonb),
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.sync_creative_run_agent_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_status TEXT;
  v_content TEXT;
BEGIN
  IF NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' THEN
    v_message_status := 'completed';
    v_content := '创作任务已完成。';
  ELSIF NEW.status = 'failed' THEN
    v_message_status := 'failed';
    v_content := COALESCE(NULLIF(NEW.error_message, ''), '创作任务执行失败，请调整需求后重试。');
  ELSIF NEW.status = 'cancelled' THEN
    v_message_status := 'cancelled';
    v_content := '创作任务已取消。';
  ELSE
    RETURN NEW;
  END IF;

  UPDATE public.creative_messages AS message
  SET status = v_message_status,
      content = v_content,
      metadata = public.creative_agent_complete_process(message.metadata, v_message_status, v_content),
      updated_at = clock_timestamp()
  WHERE message.run_id = NEW.id
    AND message.user_id = NEW.user_id
    AND message.role = 'assistant'
    AND message.status = 'running';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creative_runs_sync_agent_message ON public.creative_runs;
CREATE TRIGGER creative_runs_sync_agent_message
AFTER UPDATE OF status, error_message ON public.creative_runs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.error_message IS DISTINCT FROM NEW.error_message)
EXECUTE FUNCTION public.sync_creative_run_agent_message();

REVOKE ALL ON FUNCTION public.creative_agent_complete_process(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creative_agent_complete_process(JSONB, TEXT, TEXT) TO service_role;
