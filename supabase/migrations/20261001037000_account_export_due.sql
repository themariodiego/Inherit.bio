-- NEXT-RELEASE account-only discovery. This selects metadata, never current
-- authority, a source, an attempt, bytes, a provider or a READY transition.
do $predecessor$
declare p pg_catalog.pg_proc;
begin
 select * into p from pg_catalog.pg_proc where oid=to_regprocedure('public.export_archive_due_v1(text,uuid)');
 if p.oid is null or md5(p.prosrc) is distinct from 'de5c138161172f8b1d49a93c4b66db13'
  or pg_get_userbyid(p.proowner) is distinct from 'postgres' or not p.prosecdef
  or p.prolang is distinct from (select oid from pg_catalog.pg_language where lanname='plpgsql')
  or p.prokind is distinct from 'f' or p.provolatile is distinct from 'v' or p.proparallel is distinct from 'u'
  or p.proleakproof or p.proisstrict or p.proretset or p.prorettype is distinct from 'jsonb'::regtype
  or p.pronargs<>2 or oidvectortypes(p.proargtypes) is distinct from 'text, uuid'
  or p.proargnames is distinct from array['p_kind','p_after']::text[] or p.pronargdefaults<>1
  or pg_get_expr(p.proargdefaults,0) is distinct from 'NULL::uuid'
  or p.proconfig is distinct from array['search_path=pg_catalog, private']::text[]
  or cardinality(p.proacl) is distinct from 2 or not has_function_privilege('service_role',p.oid,'execute')
  or exists(select 1 from aclexplode(p.proacl)a where a.privilege_type<>'EXECUTE'
   or a.grantee not in((select oid from pg_roles where rolname='postgres'),(select oid from pg_roles where rolname='service_role'))
   or a.grantor is distinct from p.proowner or a.is_grantable)
  or exists(select 1 from(values('anon'),('authenticated'),('inherit_upload_only'))r(role)
   where has_function_privilege(r.role,p.oid,'execute'))
  or to_regprocedure('public.export_archive_account_due_v1(uuid)') is not null then
  raise exception using errcode='55000',message='account export discovery predecessor mismatch';
 end if;
end $predecessor$;

-- Definer is needed solely for the API-denied private job join; it grants no
-- table access. Both the actual invoking role and its JWT must be service_role.
create function public.export_archive_account_due_v1(p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='250ms' as $reader$
declare result jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role'
  or auth.jwt()->>'role' is distinct from 'service_role' then
  raise exception using errcode='42501',message='not_found';
 end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by "exportId"),'[]'::jsonb) into result from(
  select j.export_id as "exportId",j.authority_receipt as "authorityReceipt",j.principal_hash as "principalHash",
   j.deadline-interval '30 seconds' as "deadline"
  from private.export_archive_jobs j join public.generated_exports e on e.id=j.export_id
  where e.status='queued' and e.origin_kind='account' and e.target_kind='account'
   and e.export_kind='account_portable' and e.purpose='raw.export' and e.archive_version='archive-segments-v1'
   and j.route_id='api.export' and j.export_contract='account-export-v1'
   and jsonb_typeof(j.origin)='object' and (select count(*) from jsonb_object_keys(j.origin))=3
   and j.origin ?& array['kind','accountId','sessionId'] and j.origin->>'kind'='account'
   and j.origin->>'accountId'=e.account_id::text and e.target_id=e.account_id
   and coalesce(j.origin->>'sessionId','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   and j.active_attempt is null and j.deadline>clock_timestamp()+interval '1 minute'
   and (p_after is null or j.export_id>p_after)
  order by j.export_id limit 16
 )page;
 return result;
end $reader$;
revoke all on function public.export_archive_account_due_v1(uuid) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_due_v1(uuid) to service_role;
