-- Row-level security does not govern TRUNCATE, and the browser roles held it.
--
-- `anon` and `authenticated` each held TRUNCATE on fifteen `public` tables,
-- among them `user_variants`, `user_prs`, `consent_grants`, `profiles` and
-- `genome_files`. PostgreSQL consults row-level security for SELECT, INSERT,
-- UPDATE and DELETE only; TRUNCATE is authorised by the table privilege alone
-- and no policy is ever read. So a role that could not see one row of
-- `user_variants`, and could not delete one row of it, could still empty the
-- table in a single statement. Reproduced in a rolled-back transaction: 6,545
-- rows visible as zero to `anon`, `delete` refused with 42501, `truncate`
-- accepted, count zero.
--
-- This is blast radius rather than a one-request exploit. All three browser
-- roles are NOLOGIN and are reached only by `authenticator` doing SET ROLE for
-- a PostgREST request, and PostgREST never emits TRUNCATE. But any SQL
-- injection into a statement running as one of them, any security-invoker
-- function interpolating input, or SQL-editor access under those roles turns a
-- bounded read bug into the irreversible loss of every user's variant calls and
-- consent records. Nothing in this repository issues TRUNCATE as a browser
-- role, so the privilege bought nothing and its removal costs nothing.
--
-- The origin is the schema default: `pg_default_acl` grants `arwdDxtm` on new
-- `public` tables to `anon` and `authenticated`, and `D` is TRUNCATE. Later
-- migrations revoked the four DML privileges wherever they were not wanted and
-- left TRUNCATE behind, which is why the fifteen are spread across unrelated
-- migrations rather than concentrated in one.
--
-- `service_role` keeps TRUNCATE deliberately: the purge executor and the
-- retention worker run as roles that bypass row-level security by design, and a
-- revocation that swept those up would be a different bug.
-- `supabase/tests/rls_truncate_not_bypassed.sql` asserts both directions, and
-- asserts the general case from the live catalogue rather than a fixed list, so
-- a table that acquires the privilege later fails the suite.

revoke truncate on all tables in schema public from anon, authenticated;

do $$
begin
  -- The upload-only token is created by an earlier migration in every
  -- environment that has one; a deployment predating it must not fail here.
  if exists (select 1 from pg_roles where rolname = 'inherit_upload_only') then
    execute 'revoke truncate on all tables in schema public from inherit_upload_only';
  end if;
end
$$;

-- Future tables. The default privileges are recorded per granting role, so the
-- revoke has to name each role that creates tables in this schema. Migrations
-- run as `postgres`; `supabase_admin` owns the platform-created objects and a
-- hosted project's `postgres` is not a member of it, so that half is attempted
-- and reported rather than assumed.
alter default privileges in schema public revoke truncate on tables from anon, authenticated;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public'
    || ' revoke truncate on tables from anon, authenticated';
exception when insufficient_privilege or undefined_object then
  raise notice 'supabase_admin default privileges left unchanged (%). A table created by that role will still grant TRUNCATE to the browser roles; rls_truncate_not_bypassed.sql fails when one does.', sqlerrm;
end
$$;
