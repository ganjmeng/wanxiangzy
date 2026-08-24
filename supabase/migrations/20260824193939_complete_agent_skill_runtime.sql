begin;

create extension if not exists pgcrypto;

create table if not exists public.creative_agent_skills (
  id text primary key,
  owner_user_id uuid references auth.users(id) on delete cascade,
  scope text not null default 'user' check (scope in ('system', 'user')),
  name text not null,
  description text not null default '',
  planner_summary text not null default '',
  instructions text not null,
  enabled boolean not null default true,
  keywords text[] not null default '{}',
  workspaces text[] not null default '{image}',
  action text not null default 'generate' check (action in ('generate', 'edit')),
  requires_reference boolean not null default false,
  default_config jsonb not null default '{}'::jsonb check (jsonb_typeof(default_config) = 'object'),
  reference_roles jsonb not null default '[]'::jsonb check (jsonb_typeof(reference_roles) = 'array'),
  source_type text not null default 'local' check (source_type in ('builtin', 'local', 'github')),
  source_url text,
  source_repository text,
  source_path text,
  source_version text,
  source_commit text,
  source_content_hash text,
  license text,
  current_version integer not null default 1 check (current_version > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'system' and owner_user_id is null) or (scope = 'user' and owner_user_id is not null)),
  check (char_length(id) between 1 and 180),
  check (char_length(name) between 1 and 120),
  check (char_length(description) <= 1000),
  check (char_length(planner_summary) <= 2000),
  check (char_length(instructions) between 1 and 24000),
  check (source_content_hash is null or source_content_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists creative_agent_skills_owner_updated_idx
  on public.creative_agent_skills (owner_user_id, updated_at desc)
  where owner_user_id is not null;
create index if not exists creative_agent_skills_scope_enabled_idx
  on public.creative_agent_skills (scope, enabled, updated_at desc);

alter table public.creative_agent_skills enable row level security;

drop policy if exists "creative_agent_skills_read_available" on public.creative_agent_skills;
create policy "creative_agent_skills_read_available" on public.creative_agent_skills
  for select to authenticated
  using ((scope = 'system' and enabled) or (select auth.uid()) = owner_user_id);

drop policy if exists "creative_agent_skills_insert_own" on public.creative_agent_skills;
create policy "creative_agent_skills_insert_own" on public.creative_agent_skills
  for insert to authenticated
  with check (scope = 'user' and (select auth.uid()) = owner_user_id and created_by = (select auth.uid()));

drop policy if exists "creative_agent_skills_update_own" on public.creative_agent_skills;
create policy "creative_agent_skills_update_own" on public.creative_agent_skills
  for update to authenticated
  using (scope = 'user' and (select auth.uid()) = owner_user_id)
  with check (scope = 'user' and (select auth.uid()) = owner_user_id);

drop policy if exists "creative_agent_skills_delete_own" on public.creative_agent_skills;
create policy "creative_agent_skills_delete_own" on public.creative_agent_skills
  for delete to authenticated
  using (scope = 'user' and (select auth.uid()) = owner_user_id);

revoke all on public.creative_agent_skills from public, anon;
grant select, insert, update, delete on public.creative_agent_skills to authenticated;
grant all on public.creative_agent_skills to service_role;

create table if not exists public.creative_agent_skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id text not null references public.creative_agent_skills(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'published' check (status in ('draft', 'published', 'disabled', 'archived')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (skill_id, version)
);

create index if not exists creative_agent_skill_versions_skill_created_idx
  on public.creative_agent_skill_versions (skill_id, version desc);

alter table public.creative_agent_skill_versions enable row level security;
drop policy if exists "creative_agent_skill_versions_read_available" on public.creative_agent_skill_versions;
create policy "creative_agent_skill_versions_read_available" on public.creative_agent_skill_versions
  for select to authenticated
  using (exists (
    select 1 from public.creative_agent_skills skill
    where skill.id = skill_id
      and ((skill.scope = 'system' and skill.enabled) or skill.owner_user_id = (select auth.uid()))
  ));

revoke all on public.creative_agent_skill_versions from public, anon, authenticated;
grant select on public.creative_agent_skill_versions to authenticated;
grant all on public.creative_agent_skill_versions to service_role;

alter table public.creative_runs
  add column if not exists selected_skill_ids text[] not null default '{}',
  add column if not exists skill_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists skill_schema_version integer not null default 1;

alter table public.creative_runs
  drop constraint if exists creative_runs_skill_snapshot_is_array;
alter table public.creative_runs
  add constraint creative_runs_skill_snapshot_is_array check (jsonb_typeof(skill_snapshot) = 'array');

insert into public.creative_agent_skills (
  id, owner_user_id, scope, name, description, planner_summary, instructions,
  enabled, keywords, workspaces, action, requires_reference, default_config,
  reference_roles, source_type, source_version, source_content_hash, current_version
)
values
  (
    'ecommerce-image', null, 'system', '电商视觉导演（官方）',
    '理解商品卖点，为主图、辅图和详情页逐张完成整套电商视觉。',
    '为电商商品规划统一商业视觉、主图、卖点辅图和详情页素材。',
    '先识别商品类别、材质、结构与核心卖点，再规划统一的商业视觉语言。输出应包含可信的主视觉、卖点辅图与适合电商展示的构图，保持商品外观准确，不臆造标识或功能。',
    true, array['电商','商品','主图','详情页'], array['image','canvas'], 'generate', true,
    '{"imageCount":4,"aspectRatio":"auto","imageQuality":"smart"}'::jsonb,
    '[{"id":"product","label":"商品图","required":true,"maxCount":4,"description":"锁定商品外形、结构、颜色、材质、Logo、包装和销售内容","mediaTypes":["image"]},{"id":"model","label":"模特图","required":false,"maxCount":4,"mediaTypes":["image"]},{"id":"garment","label":"服装图","required":false,"maxCount":4,"mediaTypes":["image"]},{"id":"scene","label":"场景图","required":false,"maxCount":4,"mediaTypes":["image"]}]'::jsonb,
    'builtin', '1.0.0', encode(digest('ecommerce-image:1.0.0', 'sha256'), 'hex'), 1
  ),
  (
    'natural-beauty', null, 'system', '自然美颜精修',
    '保留本人身份和真实肤质的自然人像精修。',
    '在保持身份和真实皮肤纹理的前提下完成自然人像精修。',
    '保持人物身份、五官比例和真实皮肤纹理，只优化肤色、瑕疵、光影与画面质感。禁止塑料皮、过度磨皮或改变人物年龄和身份特征。',
    true, array['美颜','精修','人像'], array['image','canvas'], 'edit', true,
    '{"imageCount":1,"imageQuality":"high"}'::jsonb,
    '[{"id":"portrait","label":"人像原图","required":true,"maxCount":1,"description":"需要精修的本人照片","mediaTypes":["image"]}]'::jsonb,
    'builtin', '1.0.0', encode(digest('natural-beauty:1.0.0', 'sha256'), 'hex'), 1
  ),
  (
    'character-design', null, 'system', '角色设定',
    '建立可持续复用的角色外观、服装、表情和多视图设定。',
    '建立稳定一致、可持续复用的角色身份与多视图设定。',
    '根据描述建立稳定一致的角色设计，明确脸部、发型、体型、服装、配色和道具；输出应保持角色身份一致，并覆盖正面、侧面、背面与关键表情。',
    true, array['角色','设定','人物'], array['image','canvas'], 'generate', false,
    '{"imageCount":4,"aspectRatio":"3:4"}'::jsonb,
    '[{"id":"character","label":"角色参考","required":false,"maxCount":4,"description":"锁定身份、五官、发型和体型","mediaTypes":["image"]},{"id":"outfit","label":"服装参考","required":false,"maxCount":4,"mediaTypes":["image"]},{"id":"style","label":"风格参考","required":false,"maxCount":3,"mediaTypes":["image"]}]'::jsonb,
    'builtin', '1.0.0', encode(digest('character-design:1.0.0', 'sha256'), 'hex'), 1
  ),
  (
    'ecommerce-video', null, 'system', '电商商品展示短片',
    '把商品素材编排为聚焦卖点的商业展示视频。',
    '基于商品和品牌素材规划聚焦卖点的连续商业展示视频。',
    '保持商品外观和品牌信息准确，用克制的镜头运动、合理景别和清晰节奏突出卖点。避免产品形变、错误文字与无关元素。',
    true, array['电商','商品','短片','视频'], array['video','canvas'], 'generate', true,
    '{"videoCount":1,"videoSeconds":5,"videoResolution":"720p","generateAudio":true}'::jsonb,
    '[{"id":"product_image","label":"商品图片","required":true,"maxCount":6,"description":"锁定商品外观、材质、Logo、包装与销售单元","mediaTypes":["image"]},{"id":"product_video","label":"商品视频","required":false,"maxCount":3,"description":"补充商品动作、使用方式与已有镜头","mediaTypes":["video"]},{"id":"scene","label":"场景参考","required":false,"maxCount":3,"mediaTypes":["image"]},{"id":"camera","label":"运镜参考","required":false,"maxCount":3,"mediaTypes":["video"]},{"id":"brand","label":"品牌素材","required":false,"maxCount":5,"mediaTypes":["image"]},{"id":"sound","label":"声音参考","required":false,"maxCount":1,"mediaTypes":["video"]},{"id":"music","label":"音乐参考","required":false,"maxCount":3,"mediaTypes":["video"]}]'::jsonb,
    'builtin', '1.0.0', encode(digest('ecommerce-video:1.0.0', 'sha256'), 'hex'), 1
  ),
  (
    'image-motion', null, 'system', '图片动效',
    '为静态图片添加自然、可控且保持主体一致的镜头动效。',
    '把静态画面转为主体稳定、动作自然的短视频。',
    '分析主体和空间层次，添加自然的运镜与局部动作。保持主体身份、画面结构和关键文字稳定，避免形变、闪烁和不合理运动。',
    true, array['动效','图生视频','运镜'], array['video','canvas'], 'edit', true,
    '{"videoCount":1,"videoSeconds":5,"videoResolution":"720p"}'::jsonb,
    '[{"id":"source_image","label":"原始图片","required":true,"maxCount":1,"description":"需要添加动效的静态画面","mediaTypes":["image"]},{"id":"motion","label":"动作参考","required":false,"maxCount":3,"mediaTypes":["image","video"]}]'::jsonb,
    'builtin', '1.0.0', encode(digest('image-motion:1.0.0', 'sha256'), 'hex'), 1
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  planner_summary = excluded.planner_summary,
  instructions = excluded.instructions,
  keywords = excluded.keywords,
  workspaces = excluded.workspaces,
  action = excluded.action,
  requires_reference = excluded.requires_reference,
  default_config = excluded.default_config,
  reference_roles = excluded.reference_roles,
  source_type = excluded.source_type,
  source_version = excluded.source_version,
  source_content_hash = excluded.source_content_hash,
  updated_at = now()
where public.creative_agent_skills.scope = 'system';

insert into public.creative_agent_skill_versions (skill_id, version, status, snapshot, content_hash, published_at)
select
  skill.id,
  skill.current_version,
  'published',
  to_jsonb(skill) - 'created_at' - 'updated_at',
  coalesce(skill.source_content_hash, encode(digest(skill.instructions, 'sha256'), 'hex')),
  now()
from public.creative_agent_skills skill
where skill.scope = 'system'
on conflict (skill_id, version) do nothing;

commit;
