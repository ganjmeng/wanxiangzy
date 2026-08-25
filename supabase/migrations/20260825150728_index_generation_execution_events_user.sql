-- Keep the retained execution ledger efficient for user-scoped operations and
-- foreign-key maintenance after the VOZEB runtime has been removed.
CREATE INDEX IF NOT EXISTS generation_execution_events_user_idx
  ON public.generation_execution_events (user_id);
