-- Run once in the Supabase SQL editor.
-- Keep the service-role key on the server. No anonymous table access.
create table if not exists public.nimo_world (
  id integer primary key check (id = 1),
  state jsonb not null,
  next_tick timestamptz not null default now()
);
create table if not exists public.nimo_world_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  content text not null,
  action text
);
create index if not exists nimo_world_events_latest_idx
  on public.nimo_world_events (id desc);
alter table public.nimo_world enable row level security;
alter table public.nimo_world_events enable row level security;

insert into public.nimo_world (id, state, next_tick) values
(1, '{
  "identity": "I am an autonomous character in a persistent digital environment. I do not have a physical body.",
  "beliefs": [],
  "emotions": {"energy":0.8,"happiness":0.5,"boredom":0.0},
  "currentGoal":null,
  "currentActivity":"observing",
  "tools":[],
  "tickCount":0,
  "lastTick":null
}'::jsonb, now())
on conflict (id) do nothing;
insert into public.nimo_world_events (kind, content, action)
select 'system', 'The world was initialised. No body or tools exist yet.', 'INIT'
where not exists(select 1 from public.nimo_world_events);
