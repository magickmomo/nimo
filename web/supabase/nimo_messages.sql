-- Run in the Supabase SQL editor before using the poem queue.
create extension if not exists pgcrypto;
create table if not exists public.nimo_messages (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'poem' check (type in ('poem')),
  content text not null check (char_length(content) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'delivered')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists nimo_messages_pending_idx
  on public.nimo_messages (created_at) where status = 'pending';
alter table public.nimo_messages enable row level security;
-- No public RLS policies: only the server-side service-role key accesses this queue.
