-- v.ridge参加記録: Supabase database setup
-- Run this once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'editor' check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  university text not null default '',
  gender text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  location text not null,
  expense integer not null default 0 check (expense >= 0),
  collector_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (activity_date, location)
);

create table if not exists public.attendance (
  activity_id uuid not null references public.activities(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  attended boolean not null default false,
  paid boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (activity_id, member_id),
  check (not paid or attended)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  changed_at timestamptz not null default now()
);

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.app_users where user_id = auth.uid()
$$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

alter table public.app_users enable row level security;
alter table public.members enable row level security;
alter table public.activities enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "users can view own profile" on public.app_users;
create policy "users can view own profile"
on public.app_users for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins can view all users" on public.app_users;
create policy "admins can view all users"
on public.app_users for select
to authenticated
using (public.current_app_role() = 'admin');

drop policy if exists "admins can manage users" on public.app_users;
create policy "admins can manage users"
on public.app_users for all
to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists "approved users can view members" on public.members;
create policy "approved users can view members"
on public.members for select
to authenticated
using (public.current_app_role() in ('admin', 'editor', 'viewer'));

drop policy if exists "editors can manage members" on public.members;
create policy "editors can manage members"
on public.members for all
to authenticated
using (public.current_app_role() in ('admin', 'editor'))
with check (public.current_app_role() in ('admin', 'editor'));

drop policy if exists "approved users can view activities" on public.activities;
create policy "approved users can view activities"
on public.activities for select
to authenticated
using (public.current_app_role() in ('admin', 'editor', 'viewer'));

drop policy if exists "editors can manage activities" on public.activities;
create policy "editors can manage activities"
on public.activities for all
to authenticated
using (public.current_app_role() in ('admin', 'editor'))
with check (public.current_app_role() in ('admin', 'editor'));

drop policy if exists "approved users can view attendance" on public.attendance;
create policy "approved users can view attendance"
on public.attendance for select
to authenticated
using (public.current_app_role() in ('admin', 'editor', 'viewer'));

drop policy if exists "editors can manage attendance" on public.attendance;
create policy "editors can manage attendance"
on public.attendance for all
to authenticated
using (public.current_app_role() in ('admin', 'editor'))
with check (public.current_app_role() in ('admin', 'editor'));

drop policy if exists "admins can view audit logs" on public.audit_logs;
create policy "admins can view audit logs"
on public.audit_logs for select
to authenticated
using (public.current_app_role() = 'admin');

drop policy if exists "approved users can add audit logs" on public.audit_logs;
create policy "approved users can add audit logs"
on public.audit_logs for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.current_app_role() in ('admin', 'editor', 'viewer')
);

create or replace function public.set_updated_fields()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists members_set_updated_fields on public.members;
create trigger members_set_updated_fields
before insert or update on public.members
for each row execute function public.set_updated_fields();

drop trigger if exists activities_set_updated_fields on public.activities;
create trigger activities_set_updated_fields
before insert or update on public.activities
for each row execute function public.set_updated_fields();

drop trigger if exists attendance_set_updated_fields on public.attendance;
create trigger attendance_set_updated_fields
before insert or update on public.attendance
for each row execute function public.set_updated_fields();

do $$
begin
  alter publication supabase_realtime add table public.members;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.activities;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.attendance;
exception when duplicate_object then null;
end $$;

-- After inviting yourself in Authentication > Users, replace the email below,
-- remove the leading "--", and run the statement separately to become admin.
-- insert into public.app_users (user_id, display_name, role)
-- select id, '管理者', 'admin' from auth.users where email = 'YOUR_EMAIL@example.com'
-- on conflict (user_id) do update set role = 'admin';
