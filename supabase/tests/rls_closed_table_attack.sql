-- Every table closed by having no policy, attacked rather than inferred.
--
-- G1.6 asks for coverage of "every new table". `rls_deny_all_tables.sql` covers
-- twelve of them, by name, and asserts a property of the catalogue: row-level
-- security is on and no policy exists. That is a real guard and it stays. But
-- it is a hand-kept list of twelve against a schema that currently holds 131
-- such tables, and it reasons about denial rather than performing it. A list
-- cannot honour "every new table" -- the 132nd arrives uncovered -- and a
-- catalogue assertion cannot see a grant, a trigger or a view that makes the
-- table reachable anyway.
--
-- So this file takes the list from `pg_class` and `pg_policy` at run time and
-- actually issues the statements, as each browser role, against every table it
-- finds. A table added tomorrow is attacked tomorrow with no edit here. The
-- assertions are over the set, not over any table's name, so the file does not
-- need to know what the schema contains -- only what must be true of all of it.
--
-- Two shapes of pass are accepted for a read, and both are denials: zero rows
-- back through the policy-free table, or 42501 because the role holds no
-- privilege on it at all. Anything else -- a row, or an unexpected error --
-- names the table in the failure.
--
-- Everything runs in one transaction and rolls back. The write attacks are
-- deletes, which take only row locks and match nothing.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- The set, measured at run time -----------------------------------------------
create temporary table closed as
 select c.relname::text as name
 from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
 where c.relkind='r' and c.relrowsecurity
  and not exists(select 1 from pg_policy p where p.polrelid=c.oid);

-- A run over an empty or tiny set would pass everything below while proving
-- nothing, which is the failure mode this file exists to avoid in the first
-- place. 100 is well under the 131 present today and well over any plausible
-- accident.
select cmp_ok((select count(*)::integer from closed),'>=',100,
 'the closed-table set was actually discovered, so the attacks below are not running over nothing');

-- Row-level security is on everywhere, not just where someone remembered ------
-- A table created without `enable row level security` is not "closed by having
-- no policy" -- it is open to every role holding a grant. Supabase grants the
-- browser roles broadly by default, so this is the single assertion that keeps
-- the whole no-policy posture standing.
select is(
 (select coalesce(string_agg(c.relname,', ' order by c.relname),'')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
  where c.relkind='r' and not c.relrowsecurity),
 '',
 'every table in public has row-level security enabled');

-- No browser role bypasses it -------------------------------------------------
select is(
 (select coalesce(string_agg(rolname,', ' order by rolname),'') from pg_roles
  where rolname in('anon','authenticated','inherit_upload_only') and rolbypassrls),
 '',
 'no browser or upload role bypasses row-level security');

-- The attack ------------------------------------------------------------------
-- `set_config('role', ..., true)` is `set local role` by another name, so the
-- dynamic statement runs as that role and the setting dies with the
-- transaction. Each iteration re-establishes it because the exception block is
-- a subtransaction: when a privilege error rolls it back, the role setting made
-- inside it rolls back too.
create function pg_temp.read_attack(p_role text) returns text language plpgsql as $$
declare
  v_name text;
  v_names text[] := array(select name from closed order by name);
  v_count bigint;
  v_leaked text[] := '{}';
  v_odd text[] := '{}';
begin
  foreach v_name in array v_names loop
    begin
      perform set_config('role',p_role,true);
      execute format('select count(*) from public.%I',v_name) into v_count;
      if v_count <> 0 then v_leaked := v_leaked||v_name; end if;
    exception
      when insufficient_privilege then null;
      when others then v_odd := v_odd||(v_name||' ('||sqlstate||')');
    end;
    perform set_config('role','none',true);
  end loop;
  perform set_config('role','none',true);
  return array_to_string(v_leaked||v_odd,', ');
end $$;

create function pg_temp.delete_attack(p_role text) returns text language plpgsql as $$
declare
  v_name text;
  v_names text[] := array(select name from closed order by name);
  v_deleted integer;
  v_hit text[] := '{}';
  v_odd text[] := '{}';
begin
  foreach v_name in array v_names loop
    begin
      perform set_config('role',p_role,true);
      execute format('delete from public.%I',v_name);
      get diagnostics v_deleted = row_count;
      if v_deleted <> 0 then v_hit := v_hit||(v_name||' ('||v_deleted||' rows)'); end if;
    exception
      when insufficient_privilege then null;
      when others then v_odd := v_odd||(v_name||' ('||sqlstate||')');
    end;
    perform set_config('role','none',true);
  end loop;
  perform set_config('role','none',true);
  return array_to_string(v_hit||v_odd,', ');
end $$;

-- Anonymous: never signed in.
select is(pg_temp.read_attack('anon'),'',
 'anon reads no row of any policy-free table in public');
select is(pg_temp.delete_attack('anon'),'',
 'anon deletes no row of any policy-free table in public');

-- Signed in. `auth.uid()` is set to an account that exists, so this is a real
-- session rather than a null identity that would be denied by accident.
insert into auth.users(id,email) values
 ('aa300000-0000-4000-8000-000000000001','closed-table-attacker@example.invalid');
do $$ begin perform set_config('request.jwt.claims',
 '{"sub":"aa300000-0000-4000-8000-000000000001","role":"authenticated"}',true); end $$;
select is(pg_temp.read_attack('authenticated'),'',
 'a signed-in account reads no row of any policy-free table in public');
select is(pg_temp.delete_attack('authenticated'),'',
 'a signed-in account deletes no row of any policy-free table in public');

-- The upload-only token is a third browser identity and gets the same treatment.
select is(pg_temp.read_attack('inherit_upload_only'),'',
 'the upload-only role reads no row of any policy-free table in public');
select is(pg_temp.delete_attack('inherit_upload_only'),'',
 'the upload-only role deletes no row of any policy-free table in public');

-- The attack can fail, which is what makes the zeroes above mean something ----
-- Same harness, pointed at a table that is deliberately readable: if
-- `read_attack` could not detect a reachable row it would return '' for
-- everything and this file would be decorative.
create table public.pgtap_open_probe(id integer primary key);
insert into public.pgtap_open_probe values(1);
alter table public.pgtap_open_probe enable row level security;
create policy pgtap_open_probe_read on public.pgtap_open_probe for select using(true);
grant select on table public.pgtap_open_probe to authenticated;
-- It carries a policy, so it is not in `closed`; put it there by hand for the
-- one call, which is the only way to aim the harness at a known-reachable row.
insert into closed(name) values('pgtap_open_probe');
select is(pg_temp.read_attack('authenticated'),'pgtap_open_probe',
 'the harness reports a table it can read, so an empty result is evidence and not silence');
delete from closed where name='pgtap_open_probe';
drop table public.pgtap_open_probe;

-- Where row-level security is actually the thing doing the work ---------------
-- Measured while writing this: of the 131 closed tables, a signed-in account is
-- turned away from 130 by holding no privilege at all, and reaches exactly one
-- far enough for the policy-free table to return zero rows. So for closed
-- tables the first line of defence is the absence of a grant, and row-level
-- security is the second. Both are asserted above, and it is worth knowing
-- which is load-bearing where: a migration that grants a browser role SELECT on
-- a closed table has not opened it, but it has moved that table from two
-- defences to one.
--
-- `research_releases` is the one table in that position today, and it holds the
-- full set -- select, insert, update and delete for both `anon` and
-- `authenticated` -- with nothing but row-level security between those grants
-- and the rows. It is also on the list `rls_deny_all_tables.sql` pins as
-- closed. If this assertion fails because another table joined it, that is not
-- necessarily a bug, but it is a review: either revoke the grant, or accept
-- that the table now rests on the policy alone and say so here.
select is(
 (select coalesce(string_agg(distinct g.table_name,', ' order by g.table_name),'')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
  join information_schema.role_table_grants g
    on g.table_schema='public' and g.table_name=c.relname
  where c.relkind='r' and c.relrowsecurity
   and not exists(select 1 from pg_policy p where p.polrelid=c.oid)
   and g.grantee in('anon','authenticated','inherit_upload_only')
   and g.privilege_type in('SELECT','INSERT','UPDATE','DELETE')),
 'research_releases',
 'exactly one closed table rests on row-level security alone rather than on the absence of a grant');

-- Views do not read past it either ---------------------------------------------
-- A view runs with its owner's rights unless it is `security_invoker`, so one
-- over a closed table would hand a caller rows the table refuses. `public` holds
-- no view today, which makes this cheap; it is here because the first view added
-- is exactly when nobody is thinking about it.
select is(
 (select coalesce(string_agg(c.relname,', ' order by c.relname),'')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
  where c.relkind in('v','m')
   and coalesce((select option_value from pg_options_to_table(c.reloptions)
    where option_name='security_invoker'),'off') not in('on','true')),
 '',
 'every public view reads with the caller''s rights, so none reads past row-level security');

select * from finish();
rollback;
