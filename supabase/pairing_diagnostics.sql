-- H&E pairing diagnostics (READ ONLY)
-- Run this in the Supabase SQL Editor when project access is restored.
-- It does not insert, update, or delete any records.

-- 1) Confirm the tables and columns used by the app.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('couples', 'couple_members', 'profiles', 'messages')
order by table_name, ordinal_position;

-- 2) Show membership counts and member IDs for each existing shared space.
-- Review this output before considering any repair. Do not delete rows blindly.
select couple_id, count(*) as member_count,
       array_agg(user_id::text order by user_id::text) as member_user_ids
from public.couple_members
group by couple_id
order by member_count desc, couple_id;

-- 3) Inspect policies that control access to pairing and chat data.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('couples', 'couple_members', 'profiles', 'messages')
order by tablename, policyname;

-- 4) Inspect the server-side pairing functions that return "already paired".
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_pair_invite', 'accept_pair_invite')
order by p.proname;

-- No repair is performed by this script. The exact database structure,
-- function logic, and affected membership rows must be reviewed first.
