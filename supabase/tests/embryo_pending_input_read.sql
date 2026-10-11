begin;
select no_plan();
-- Preserve the ACTUAL platform ACL before the included fixture/read.
-- A fresh stock service grant is not a new permission of this metadata door.
create function pg_temp.pending_genome_acl_vector() returns jsonb
language sql stable security invoker set search_path=pg_catalog as $acl$
 select jsonb_build_object('relationOid',c.oid::bigint,'ownerOid',c.relowner::bigint,
  'rawTableAcl',to_jsonb(c.relacl),
  'expandedTableAcl',(select coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::bigint,
   'grantee',a.grantee::bigint,'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]'::jsonb)
   from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a),
  'columnAcls',(select coalesce(jsonb_agg(jsonb_build_object('ordinal',col.attnum,'name',col.attname,
   'rawAcl',to_jsonb(col.attacl),'expandedAcl',(select coalesce(jsonb_agg(jsonb_build_object(
    'grantor',a.grantor::bigint,'grantee',a.grantee::bigint,'privilege',a.privilege_type,'grantable',a.is_grantable)
    order by a.grantee,a.grantor,a.privilege_type,a.is_grantable),'[]'::jsonb)
    from aclexplode(coalesce(col.attacl,'{}'::aclitem[])) a)) order by col.attnum),'[]'::jsonb)
   from pg_attribute col where col.attrelid=c.oid and col.attnum>0),
  'effectiveRoleAccess',(select jsonb_agg(jsonb_build_object('role',roles.name,
   'tablePrivileges',(select jsonb_object_agg(a.privilege_type,has_table_privilege(roles.name,c.oid,a.privilege_type))
    from aclexplode(acldefault('r',c.relowner)) a),
   'anyColumnSelect',has_any_column_privilege(roles.name,c.oid,'SELECT')) order by roles.name collate "C")
   from (values('anon'::text),('authenticated'),('inherit_upload_only'),('service_role')) roles(name)))
 from pg_class c where c.oid='public.genome_files'::regclass;
$acl$;
create temporary table pending_genome_acl_before as select pg_temp.pending_genome_acl_vector() as body;

\ir fixtures/embryo_cohort_pre_finalize.inc

-- Genuine original native finalization. No embryo/QC/file/result is seeded
-- to make pending look empty; the writer creates its own reservations.
create temporary table pending_minted as select private.finalize_embryo_cohort_ingest_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select draft_id from draft),(select insurance from acks),(select charter from acks),
 'nonce-pending-input-finalize','http://localhost:3000',true) as body;
create temporary table pending_scope as select s.id as session_id,s.cohort_id,s.cookie_hash,s.ingest_revision,
 e.id as embryo_id,e.subject_id from public.embryo_ingest_sessions s join public.embryos e on e.cohort_id=s.cohort_id
 where s.id=(select (body->'ingest'->>'session')::uuid from pending_minted) and e.sample_ordinal=0;
grant select on pending_scope to service_role;
select ok(has_function_privilege('service_role','public.read_pending_embryo_input_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.read_pending_embryo_input_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.read_pending_embryo_input_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','public.read_pending_embryo_input_v1(uuid,uuid,uuid)','execute'),
 'metadata reader is service-only; prefixes/IDs cannot grant a client read');
select ok((select not prosecdef and provolatile='s' from pg_catalog.pg_proc
 where oid='public.read_pending_embryo_input_v1(uuid,uuid,uuid)'::regprocedure),
 'stable invoker adds neither table authority nor a writer');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope))->>'embryoStatus','pending',
 'actual native reservation remains pending, without a fabricated passing QC');
select is(public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope))
  -array['snapshotAt','accountId','cohortId','embryoId','subjectId','sessions'],
 jsonb_build_object('version',1,'cohortStatus','upload_pending','embryoStatus','pending','subjectLifecycle','quarantined',
  'ingestRevision',1,'lifecycleRevision',1,'publicationRevision',null,'fileCount',0,'qcCount',0,
  'chunkCount',0,'fragmentCount',0,'workCount',0,'activeWorkCount',0),
 'complete snapshot establishes no file/QC/chunk/fragment or bound work in the whole cohort');
select is(jsonb_array_length(public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope))->'sessions'),1,
 'finalization minted one actual ingest session');
select is(public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000003',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope)),null::jsonb,
 'a real foreign account cannot obtain pending facts');
select is(public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),'ffffffff-ffff-4fff-8fff-ffffffffffff'),null::jsonb,
 'an unknown embryo does not produce a no-file proof');
select is(public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000002',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope))->>'accountId',
 '7a000000-0000-0000-0000-000000000002','the actual current signed co-parent receives only its own scoped metadata');
reset role;

-- Exact existing TEST-only backend fixture. No provider PUT/ACK or landed
-- object is claimed; the original native reserve still issues its own intents.
create temporary table pending_object_config_before as
 select coalesce(jsonb_agg(to_jsonb(c) order by c.singleton),'[]'::jsonb) as body
 from private.embryo_ingest_object_config c;
update private.embryo_ingest_object_config set provider='r2',r2_bucket='inherit-embryo-test' where singleton;

-- A real reservation marks work before Storage landing/publication. Use the
-- unchanged writer, not direct counter/status/metadata updates.
select private.configure_embryo_vcf_ingest_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select session_id from pending_scope),(select cookie_hash from pending_scope),'http://localhost:3000',
 (select cohort_id from pending_scope),(select ingest_revision from pending_scope),'GRCh38',3,
 'nonce-pending-configure',repeat('Q',43),'nonce-pending-complete','nonce-pending-csrf-01',true);
select is(private.reserve_embryo_ingest_chunk_v1((select session_id from pending_scope),0,
 encode(extensions.digest('synthetic-pending-chunk','sha256'),'hex'),400,12,120,
 (select jsonb_agg(jsonb_build_object('ordinal',ordinal,'sha256',
  encode(extensions.digest('synthetic-pending-fragment:'||ordinal,'sha256'),'hex'),
  'bytes',80+ordinal,'lines',4) order by ordinal) from generate_series(0,2) ordinal))->>'status',
 'reserved','actual reservation creates transport facts before any file or QC publication');
set local role service_role;
select is(public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope))->>'chunkCount','1',
 'reserved unstored chunk is visible; it must not become empty');
select is(public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope))->>'fragmentCount','3',
 'all three actual ordinal fragments remain visible');
select is((public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope))->'sessions'->0->>'acceptedBytes')::bigint,
 400::bigint,'the real reserved-byte counter is visible before Storage landing');
reset role;

-- Native privilege regression: preserve the complete ACTUAL starting table
-- ACL and effective role access, then separately prove the metadata door with
-- genuine direct SELECT removal inside a rolled-back savepoint.
select ok(has_function_privilege('service_role','private.read_pending_embryo_input_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','private.read_pending_embryo_input_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.read_pending_embryo_input_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','private.read_pending_embryo_input_v1(uuid,uuid,uuid)','execute')
 and not exists(select 1 from pg_catalog.pg_proc p,
  lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  where p.oid='private.read_pending_embryo_input_v1(uuid,uuid,uuid)'::regprocedure
   and a.grantee=0 and a.privilege_type='EXECUTE'),
 'private metadata helper excludes PUBLIC and all client roles');
select ok((select prosecdef and provolatile='s' and proconfig=array['search_path=""']
 from pg_catalog.pg_proc where oid='private.read_pending_embryo_input_v1(uuid,uuid,uuid)'::regprocedure),
 'private metadata helper is stable with a fixed empty search path');
select is(pg_temp.pending_genome_acl_vector(),(select body from pending_genome_acl_before),
 'service metadata invocation preserves the complete original genome ACL and effective role access');

-- Expected complete metadata comes from the genuine current service door.
create temporary table pending_genome_metadata_before(account_id uuid primary key,body jsonb not null);
grant select,insert on pending_genome_metadata_before to service_role;
create function pg_temp.pending_direct_genome_select_refused() returns boolean
language plpgsql security invoker set search_path='' as $probe$
begin
 if current_user is distinct from 'service_role' then return false;end if;
 perform id from public.genome_files limit 1;
 return false;
exception when insufficient_privilege then return true;
end $probe$;
revoke all on function pg_temp.pending_direct_genome_select_refused() from public;
grant execute on function pg_temp.pending_direct_genome_select_refused() to service_role;
set local role service_role;
insert into pending_genome_metadata_before(account_id,body)
 select account_id,public.read_pending_embryo_input_v1(account_id,
  (select cohort_id from pending_scope),(select embryo_id from pending_scope))
 from (values('7a000000-0000-0000-0000-000000000001'::uuid),
  ('7a000000-0000-0000-0000-000000000002'::uuid)) actors(account_id);
reset role;

savepoint pending_without_genome_select;
revoke select on table public.genome_files from service_role;
do $public_select$
begin
 if exists(select 1 from pg_catalog.pg_class c,
  lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  where c.oid='public.genome_files'::regclass and a.grantee=0 and a.privilege_type='SELECT') then
  revoke select on table public.genome_files from public;
 end if;
end $public_select$;
set local role service_role;
-- Closed booleans only. No pgTAP assertion/counter is rolled back with ACLs.
select not has_table_privilege('service_role','public.genome_files','SELECT')
 and not has_any_column_privilege('service_role','public.genome_files','SELECT') as pending_no_direct_select,
 pg_temp.pending_direct_genome_select_refused() as pending_actual_select_refused,
 (select count(*)=2 and bool_and(coalesce((
  public.read_pending_embryo_input_v1(expected.account_id,(select cohort_id from pending_scope),
   (select embryo_id from pending_scope)) - 'snapshotAt' = expected.body - 'snapshotAt'
  and private.read_pending_embryo_input_v1(expected.account_id,(select cohort_id from pending_scope),
   (select embryo_id from pending_scope)) - 'snapshotAt' = expected.body - 'snapshotAt'),false))
  from pending_genome_metadata_before expected) as pending_exact_metadata_without_select,
 public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000003',
  (select cohort_id from pending_scope),(select embryo_id from pending_scope)) is null
 and private.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000003',
  (select cohort_id from pending_scope),(select embryo_id from pending_scope)) is null as pending_foreign_refused_without_select
\gset
reset role;
rollback to savepoint pending_without_genome_select;
release savepoint pending_without_genome_select;
select ok(:'pending_no_direct_select'::boolean,
 'savepoint removes effective service table and column SELECT, including any actual PUBLIC SELECT');
select ok(:'pending_actual_select_refused'::boolean,
 'an actual service SELECT against the protected genome table raises 42501');
select ok(:'pending_exact_metadata_without_select'::boolean,
 'owner and signed co-parent retain every native metadata field through both doors without direct table SELECT');
select ok(:'pending_foreign_refused_without_select'::boolean,
 'both metadata doors retain the actual foreign-account refusal without direct table SELECT');
select is(pg_temp.pending_genome_acl_vector(),(select body from pending_genome_acl_before),
 'savepoint rollback restores exact raw/expanded table and column ACLs and every effective role privilege');
set local role service_role;
select is(private.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope)),
 public.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000001',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope)),
 'real service private and public doors return the exact same current metadata');
select is(private.read_pending_embryo_input_v1('7a000000-0000-0000-0000-000000000003',
 (select cohort_id from pending_scope),(select embryo_id from pending_scope)),null::jsonb,
 'direct private service execution retains the real foreign-account refusal');
select throws_ok($$select private.read_pending_embryo_input_v1(null,null,null)$$,
 '22023','invalid_request','direct private service execution refuses missing scope');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.read_pending_embryo_input_v1(null,null,null)$$,
 '42501','not_found','public service door refuses a mismatched real JWT role before scope');
select throws_ok($$select private.read_pending_embryo_input_v1(null,null,null)$$,
 '42501','not_found','private service helper refuses a mismatched real JWT role before scope');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.read_pending_embryo_input_v1(null,null,null)$$,
 '42501','not_found','service JWT text alone cannot grant the public nonservice caller');
select throws_ok($$select private.read_pending_embryo_input_v1(null,null,null)$$,
 '42501','not_found','service JWT text alone cannot grant the private nonservice caller');
set local role anon;
select throws_ok($$select public.read_pending_embryo_input_v1(null,null,null)$$,
 '42501',null,'a real anon caller cannot execute the public metadata door');
select throws_ok($$select private.read_pending_embryo_input_v1(null,null,null)$$,
 '42501',null,'a real anon caller cannot execute the private metadata helper');
reset role;

-- Complete configuration comparisons emit only booleans; whole protected
-- table-row rollback also covers this private row after the connection closes.
select ok((select body='[{"singleton":true,"provider":null,"r2_bucket":null}]'::jsonb
 from pending_object_config_before),
 'original native object configuration is complete and default-denied');
select ok((select coalesce(jsonb_agg(to_jsonb(c) order by c.singleton),'[]'::jsonb)
 = '[{"singleton":true,"provider":"r2","r2_bucket":"inherit-embryo-test"}]'::jsonb
 from private.embryo_ingest_object_config c),
 'temporary synthetic R2 configuration remains exact after the real reservation');
-- Every original authority/refusal/reservation operation retains this baseline.
select is(pg_temp.pending_genome_acl_vector(),(select body from pending_genome_acl_before),
 'final metadata/refusal operations preserve the complete original ACL and effective service/client access');
select * from finish();
rollback;
