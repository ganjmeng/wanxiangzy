create table if not exists public.creative_user_skills (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  instructions text not null,
  keywords text[] not null default '{}',
  capabilities text[] not null default '{image,canvas}',
  action text not null default 'generate' check (action in ('generate', 'edit')),
  requires_reference boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (char_length(id) between 1 and 180),
  check (char_length(name) between 1 and 120),
  check (char_length(description) <= 1000),
  check (char_length(instructions) between 1 and 12000)
);

alter table public.creative_user_skills enable row level security;

drop policy if exists "creative_user_skills_select_own" on public.creative_user_skills;
create policy "creative_user_skills_select_own" on public.creative_user_skills
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "creative_user_skills_insert_own" on public.creative_user_skills;
create policy "creative_user_skills_insert_own" on public.creative_user_skills
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "creative_user_skills_update_own" on public.creative_user_skills;
create policy "creative_user_skills_update_own" on public.creative_user_skills
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "creative_user_skills_delete_own" on public.creative_user_skills;
create policy "creative_user_skills_delete_own" on public.creative_user_skills
for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.creative_user_skills from anon;
grant select, insert, update, delete on table public.creative_user_skills to authenticated;

create index if not exists creative_user_skills_user_updated_idx
  on public.creative_user_skills (user_id, updated_at desc);
