-- TRUNCATE is not filtered by row-level security, and the browser roles hold it.
--
-- THIS FILE IS EXPECTED TO FAIL TODAY. It is a finding written as an assertion,
-- not a regression guard, and the two assertions it fails on are a real gap in
-- the guarantee the rest of the suite rests on. The fix is a migration, not an
-- edit here; do not soften the assertions to make the suite green.
--
-- What the rest of the suite assumes. `supabase/tests/rls_deny_all_tables.sql`
-- pins that a set of tables carry row-level security with no policy, and argues
-- they are therefore closed, on the grounds that "no browser or upload role
-- bypasses row-level security". `docs/acceptance-matrix.md` G1.6 repeats it:
-- `anon`, `authenticated` and `inherit_upload_only` do not bypass RLS, so the
-- strictest posture is a table with RLS on and no policy.
--
-- That is true for SELECT, INSERT, UPDATE and DELETE. It is not true for
-- TRUNCATE. PostgreSQL row-level security governs those four commands only;
-- TRUNCATE is authorised by the table privilege alone and no policy is ever
-- consulted. So a role that cannot read one row of a table, and cannot delete
-- one row of it, can still remove every row of it in one statement -- and
-- `research_releases`, which `rls_deny_all_tables.sql` names as closed, is one
-- of the tables this reaches.
--
-- Measured against the live database, `anon` and `authenticated` each hold
-- TRUNCATE on fifteen `public` tables and can actually empty ten of them; the
-- other five are saved incidentally by a foreign key pointing at them from a
-- table the role lacks TRUNCATE on, which is not a decision anyone made. The
-- ten reachable today include `user_variants`, `user_prs`, `consent_grants`,
-- `profiles`, `llm_settings`, `ref_variants` and `research_releases`. Verified
-- by running the statement as each role in a rolled-back transaction: the row
-- counts went to zero.
--
-- How exposed this is, stated honestly rather than dramatically. `anon`,
-- `authenticated` and `service_role` are all NOLOGIN, so nobody connects as
-- them directly; they are reached by `authenticator` doing SET ROLE for a
-- PostgREST request, and PostgREST never emits TRUNCATE. So this is not a
-- one-request exploit against the deployed surface. It is the blast radius: any
-- SQL injection into a statement running as `anon` or `authenticated`, any
-- security-invoker function that interpolates input, or anyone with SQL-editor
-- access under those roles turns a bounded read bug into the irreversible loss
-- of every user's variant calls and consent records. The grant buys nothing --
-- no code path in this repository issues TRUNCATE as a browser role -- so the
-- cost of removing it is zero and the cost of keeping it is unbounded.
--
-- The likely origin is `grant all on all tables in schema public to anon,
-- authenticated`, whose ALL includes TRUNCATE, REFERENCES and TRIGGER. Later
-- migrations revoked SELECT/INSERT/UPDATE/DELETE where they were not wanted and
-- left the other three, which is why the pattern is spread across unrelated
-- tables rather than concentrated in one migration.
--
-- The remedy is one statement per table, or a blanket
-- `revoke truncate on all tables in schema public from anon, authenticated`
-- plus the same on `alter default privileges`. That belongs in a migration.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- The mechanism, proved on a table of this file's own making ------------------
-- Done on a scratch table rather than a real one so the demonstration takes no
-- lock on anything another session is using. It establishes the general claim:
-- RLS enabled, no policy, SELECT and DELETE denied to `authenticated`, TRUNCATE
-- granted -- and TRUNCATE still empties it.
create table public.pgtap_truncate_probe(id integer primary key, secret text);
insert into public.pgtap_truncate_probe values(1,'synthetic'),(2,'synthetic');
alter table public.pgtap_truncate_probe enable row level security;
revoke all on table public.pgtap_truncate_probe from anon, authenticated;
grant truncate on table public.pgtap_truncate_probe to authenticated;

select is((select count(*) from public.pgtap_truncate_probe),2::bigint,'the probe table starts with two rows');
set local role authenticated;
select throws_ok($$select count(*) from public.pgtap_truncate_probe$$,'42501',null,
 'the probe table cannot be read by a browser role');
select throws_ok($$delete from public.pgtap_truncate_probe$$,'42501',null,
 'nor can one row of it be deleted');
select lives_ok($$truncate table public.pgtap_truncate_probe$$,
 'yet TRUNCATE succeeds: row-level security never sees the command');
reset role;
select is((select count(*) from public.pgtap_truncate_probe),0::bigint,
 'and the table a browser role could not read one row of is now empty');
drop table public.pgtap_truncate_probe;

-- The finding, on the real tables ---------------------------------------------
-- These two assertions fail today. Each names the tables it found, so the
-- failure output is the remediation list.
select is(
 (select coalesce(string_agg(distinct table_name,', ' order by table_name),'')
  from information_schema.role_table_grants
  where table_schema='public' and privilege_type='TRUNCATE'
    and grantee in('anon','authenticated','inherit_upload_only')
    and table_name in('genome_files','user_variants','user_prs','ancestry_results',
     'consent_grants','profiles','llm_settings','report_observed_calls','upload_sessions',
     'chats','chat_messages')),
 '',
 'no browser role holds TRUNCATE on a table of account-scoped, subject-scoped or genetic data');

select is(
 (select coalesce(string_agg(distinct table_name,', ' order by table_name),'')
  from information_schema.role_table_grants
  where table_schema='public' and privilege_type='TRUNCATE'
    and grantee in('anon','authenticated','inherit_upload_only')),
 '',
 'no browser role holds TRUNCATE on any public table, so the deny-all posture means what it says');

-- The part that already holds, kept so the fix is not over-applied ------------
-- `service_role` is meant to have it; the worker and the deletion executor run
-- as roles that bypass RLS by design. A revocation that swept those up would be
-- a different bug, so the boundary is asserted rather than assumed.
select ok(has_table_privilege('service_role','public.user_variants','truncate'),
 'service_role keeps TRUNCATE, which is the role the purge executor runs as');
select is(has_table_privilege('inherit_upload_only','public.user_variants','truncate'),false,
 'the upload-only token never had TRUNCATE on variant calls');

select * from finish();
rollback;
