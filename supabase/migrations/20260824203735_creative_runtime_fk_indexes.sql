begin;

create index if not exists creative_agent_skills_created_by_idx
  on public.creative_agent_skills (created_by)
  where created_by is not null;

create index if not exists creative_agent_skill_versions_created_by_idx
  on public.creative_agent_skill_versions (created_by)
  where created_by is not null;

create index if not exists creative_runs_project_fk_idx
  on public.creative_runs (project_id)
  where project_id is not null;

create index if not exists creative_run_steps_parent_step_idx
  on public.creative_run_steps (parent_step_id)
  where parent_step_id is not null;

create index if not exists creative_run_steps_user_idx
  on public.creative_run_steps (user_id);

create index if not exists creative_run_events_step_idx
  on public.creative_run_events (step_id)
  where step_id is not null;

create index if not exists creative_run_events_user_idx
  on public.creative_run_events (user_id);

create index if not exists generation_execution_events_creative_step_idx
  on public.generation_execution_events (creative_step_id)
  where creative_step_id is not null;

create index if not exists generations_creative_step_idx
  on public.generations (creative_step_id)
  where creative_step_id is not null;

commit;
