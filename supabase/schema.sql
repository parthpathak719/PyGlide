-- Run once in your Supabase Free project's SQL Editor.
-- Only the backend service_role may access these shared deletion records.
create table if not exists public.pyglide_example_deletions (
    name text primary key,
    deleted_at timestamptz not null default now()
);
alter table public.pyglide_example_deletions enable row level security;
revoke all on public.pyglide_example_deletions from anon, authenticated;
grant select, insert on public.pyglide_example_deletions to service_role;
