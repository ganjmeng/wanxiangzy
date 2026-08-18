-- task_queue_items is a derived read model. Keep its projection fail-open so
-- schema drift or an index outage cannot roll back the core generations row.
CREATE OR REPLACE FUNCTION public.task_queue_sync_generation_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.task_queue_upsert_generation(NEW);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[task-queue] generation % projection skipped: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.task_queue_sync_generation_trigger()
  FROM PUBLIC, anon, authenticated;
