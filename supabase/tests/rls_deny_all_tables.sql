-- The tables that are closed by having no policy at all.
--
-- Row-level security with zero policies denies every role that does not bypass
-- it. That is how most of this schema is secured: reads and writes go through
-- security-definer functions, and the table itself is unreachable. It is the
-- strictest posture available, and until now it was only inferred — nothing
-- asserted that these tables still have no policy, or that the browser roles
-- still cannot bypass one.
--
-- So this pins both halves. Adding any policy to a table listed here fails,
-- which is the point: a policy on `generated_exports` or
-- `audit_principal_link_keys` should be a deliberate act with its own attack
-- test, not a quiet edit. `scripts/rls-policy-coverage.test.ts` covers the
-- other direction, requiring a test for any policy that reads the caller's
-- identity.
--
-- The list is the public tables that `docs/acceptance-matrix.md` G1.6 found
-- named in no test, minus those carrying a `*_public_read` policy over
-- reference data, which are readable by design and are not this file's
-- subject. Two of them — `ref_regions` and `ref_region_releases` — were in an
-- earlier draft of this list because the static scan that produced it required
-- a quoted policy name and theirs are unquoted. The database said otherwise
-- the first time this file ran, which is the argument for asserting against it
-- rather than against a reading of the migrations.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table closed_tables(name text primary key);
insert into closed_tables(name) values
 ('abuse_events'),('account_security_states'),('ancestry_regions'),
 ('audit_principal_link_keys'),('audit_principal_links'),('audit_principals'),
 ('download_ranges'),('download_sessions'),('generated_exports'),
 ('legal_audit_retention_checkpoints'),('rate_limit_hmac_buckets'),
 ('research_releases');

-- A list that names nothing, or names something absent, proves nothing.
select is((select count(*)::integer from closed_tables),12,'the closed list is the measured set');
select is((select count(*)::integer from closed_tables t
 join pg_class c on c.relname=t.name
 join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'),12,
 'every listed table exists in public');

select is((select coalesce(string_agg(t.name,', ' order by t.name),'') from closed_tables t
 join pg_class c on c.relname=t.name
 join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
 where not c.relrowsecurity),'',
 'every listed table still has row-level security enabled');

select is((select coalesce(string_agg(t.name,', ' order by t.name),'') from closed_tables t
 join pg_class c on c.relname=t.name
 join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
 where exists(select 1 from pg_policy p where p.polrelid=c.oid)),'',
 'no listed table has gained a policy, so each stays closed to every non-bypass role');

-- Denial only means something while the browser roles cannot step over it.
select is((select coalesce(string_agg(rolname,', ' order by rolname),'') from pg_roles
 where rolname in('anon','authenticated','inherit_upload_only') and rolbypassrls),'',
 'no browser or upload role bypasses row-level security');
select ok((select rolbypassrls from pg_roles where rolname='service_role'),
 'service_role does bypass it, which is why a route using the admin client reaches these tables by design');
select * from finish();
rollback;
