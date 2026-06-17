-- Infinite Canvas cloud mirror.
-- LocalForage remains the immediate local source of truth; this table mirrors
-- each user's canvas documents for account sync and cross-device recovery.

CREATE TABLE IF NOT EXISTS public.canvas_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_id text NOT NULL,
  title text NOT NULL,
  document jsonb NOT NULL,
  client_updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canvas_projects_user_local_unique UNIQUE (user_id, local_id)
);

CREATE INDEX IF NOT EXISTS canvas_projects_user_updated_idx
  ON public.canvas_projects (user_id, client_updated_at DESC);

CREATE INDEX IF NOT EXISTS canvas_projects_user_deleted_idx
  ON public.canvas_projects (user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_canvas_projects_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canvas_projects_touch_updated_at ON public.canvas_projects;
CREATE TRIGGER canvas_projects_touch_updated_at
BEFORE UPDATE ON public.canvas_projects
FOR EACH ROW
EXECUTE FUNCTION public.touch_canvas_projects_updated_at();

ALTER TABLE public.canvas_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvas_projects_select_own" ON public.canvas_projects;
CREATE POLICY "canvas_projects_select_own"
ON public.canvas_projects
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "canvas_projects_insert_own" ON public.canvas_projects;
CREATE POLICY "canvas_projects_insert_own"
ON public.canvas_projects
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "canvas_projects_update_own" ON public.canvas_projects;
CREATE POLICY "canvas_projects_update_own"
ON public.canvas_projects
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "canvas_projects_delete_own" ON public.canvas_projects;
CREATE POLICY "canvas_projects_delete_own"
ON public.canvas_projects
FOR DELETE
USING (auth.uid() = user_id);
