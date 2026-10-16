do $predecessors$
declare expected record;target regprocedure;
begin
 for expected in select * from (values
 ('private.capture_claimed_embryo_provenance_v1(uuid,uuid)','3970b934f3165fd1e8cf2f26ce913d34','9d2ad554c7193b23e64714db6166e9f3',array['p_deletion','p_cohort']::text[],'void',array['search_path=""']::text[]),
 ('private.purge_account_owned_cohorts_v1(uuid)','cec89910d9191838a890db56e14cb18c','3fe1b53e74675885cb9f825917dc3c70',array['p_deletion']::text[],'void',array['search_path=""']::text[]),
 ('private.prepare_future_person_deletion_v1(text,text)','825d2bb042623900b71bfc516f9e8b42','d059d03088936f868ce748772073f5db',array['p_session_hash','p_nonce']::text[],'uuid',array['search_path=""','lock_timeout=250ms']::text[]),
 ('private.assert_future_person_deletion_plan_v1(uuid)','e3d743b8f35d8f655712ec0d8f996b8f','c009f02ee0e43a661d7b70d23b5c6ba3',array['p_manifest']::text[],'public.retention_due_phases',array['search_path=""']::text[]),
 ('private.finish_future_person_deletion_v1(uuid,text)','0ac6a4d7e63942e35d4303464d2aac89','644965a2ad8adff622d7121725f40922',array['p_manifest','p_claim_token_hash']::text[],'jsonb',array['search_path=""','lock_timeout=250ms']::text[]),
 ('private.freeze_future_person_deletion_plan_v1()','815d32207dd7ab2da6218102863eed8b','79e16acea2f613885ad4d461cef1ecdf',array[]::text[],'trigger',array['search_path=""']::text[])
 ) v(signature,before_md5,after_md5,arg_names,result_type,configuration) loop
  target:=to_regprocedure(expected.signature);
  if target is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
   and md5(p.prosrc)=expected.before_md5 and p.prosecdef and l.lanname='plpgsql' and p.provolatile='v' and p.proparallel='u'
   and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=expected.configuration
   and p.proargdefaults is null and coalesce(p.proargnames,'{}'::text[])=expected.arg_names
   and p.pronargs=cardinality(expected.arg_names) and not p.proretset and p.prorettype=to_regtype(expected.result_type)
   and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
   and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee<>p.proowner or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role
    where has_function_privilege(role,target,'execute')) then
   raise exception using errcode='55000',message='claimed provenance predecessor differs';end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname=any(array['assert_claimed_provenance_candidate_v1','lock_claimed_provenance_pairs_v1',
   'claimed_provenance_pair_state_v1','claimed_provenance_candidate_v1','account_claimed_provenance_candidates_v1',
   'collect_claimed_provenance_pair_v1'])) then
  raise exception using errcode='55000',message='claimed provenance successor already exists';end if;
 if exists(select 1 from unnest(array['private.claimed_embryo_ingest_receipts','private.claimed_embryo_job_receipts']) relation
  cross join unnest(array['anon','authenticated','inherit_upload_only','service_role']) role
  where to_regclass(relation) is null or has_table_privilege(role,to_regclass(relation),'select,insert,update,delete,truncate,references,trigger')
   or has_any_column_privilege(role,to_regclass(relation),'select,insert,update,references')) then
  raise exception using errcode='55000',message='claimed provenance table boundary differs';end if;
 if (select array_agg(attname::text order by attnum) from pg_attribute where attrelid='private.claimed_embryo_ingest_receipts'::regclass
  and attnum>0 and not attisdropped)<>array['id','historical_cohort_id','worker_job_id','ingest_revision','publication_revision',
   'manifest_sha256','manifest_chunk_count','source_binding_fingerprint','reference_build']::text[]
  or (select array_agg(attname::text order by attnum) from pg_attribute where attrelid='private.claimed_embryo_job_receipts'::regclass
   and attnum>0 and not attisdropped)<>array['id','session_id','historical_cohort_id','attempt','source_binding_revision',
    'file_sha256','computation_revision','idempotency_key']::text[] then
  raise exception using errcode='55000',message='claimed provenance columns differ';end if;

 for expected in select * from (values
 ('private.assert_embryo_part_provenance_v1(uuid)','188aa76e203cdc8893512708ae23e8f7',array['p_part']::text[],'void',array['search_path=""']::text[]),
 ('private.guard_embryo_part_provenance_v1()','5aba93a1f656f095c2033ceb1f9ff3f6',array[]::text[],'trigger',array['search_path=""']::text[]),
 ('private.freeze_claimed_embryo_receipt_v1()','677231f065ed392bd33c92320290905b',array[]::text[],'trigger',array['search_path=""']::text[])
 ) v(signature,body_md5,arg_names,result_type,configuration) loop
  target:=to_regprocedure(expected.signature);
  if target is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
   and md5(p.prosrc)=expected.body_md5 and p.prosecdef and l.lanname='plpgsql' and p.provolatile='v' and p.proparallel='u'
   and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=expected.configuration
   and p.proargdefaults is null and coalesce(p.proargnames,'{}'::text[])=expected.arg_names
   and p.pronargs=cardinality(expected.arg_names) and not p.proretset and p.prorettype=to_regtype(expected.result_type)
   and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
   and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee<>p.proowner or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable))
   or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role
    where has_function_privilege(role,target,'execute')) then
   raise exception using errcode='55000',message='claimed provenance original guard differs';end if;
 end loop;
 if exists(select 1 from unnest(array['private.claimed_embryo_ingest_receipts','private.claimed_embryo_job_receipts']) relation
  join pg_class c on c.oid=to_regclass(relation) where c.relkind<>'r' or not c.relrowsecurity or c.relforcerowsecurity
   or c.relowner<>(select oid from pg_roles where rolname='postgres')) then
  raise exception using errcode='55000',message='claimed provenance relation differs';end if;
 if (select array_agg(format_type(atttypid,atttypmod)||'|'||attnotnull::text order by attnum) from pg_attribute
  where attrelid='private.claimed_embryo_ingest_receipts'::regclass and attnum>0 and not attisdropped)
   is distinct from array['uuid|true','uuid|true','uuid|true','bigint|true','bigint|true','text|true','integer|true','text|true','text|true']::text[]
  or (select array_agg(format_type(atttypid,atttypmod)||'|'||attnotnull::text order by attnum) from pg_attribute
   where attrelid='private.claimed_embryo_job_receipts'::regclass and attnum>0 and not attisdropped)
   is distinct from array['uuid|true','uuid|true','uuid|true','smallint|true','bigint|true','text|true','text|true','text|true']::text[]
  or exists(select 1 from pg_attrdef where adrelid in('private.claimed_embryo_ingest_receipts'::regclass,'private.claimed_embryo_job_receipts'::regclass))
  or not exists(select 1 from pg_constraint where conrelid='private.claimed_embryo_job_receipts'::regclass
   and conname='claimed_embryo_job_receipts_session_id_fkey' and contype='f'
   and confrelid='private.claimed_embryo_ingest_receipts'::regclass and conkey=array[2]::smallint[] and confkey=array[1]::smallint[]
   and confdeltype='r' and confupdtype='a' and confmatchtype='s' and convalidated and not condeferrable)
  or (select count(*) from pg_constraint where contype='f' and conrelid in('private.claimed_embryo_ingest_receipts'::regclass,
    'private.claimed_embryo_job_receipts'::regclass))<>1 then
  raise exception using errcode='55000',message='claimed provenance type or dependency differs';end if;
 if exists(select 1 from (values
  ('private.claimed_embryo_ingest_receipts','claimed_embryo_session_immutable'),
  ('private.claimed_embryo_job_receipts','claimed_embryo_job_immutable')
 ) pair(relation,trigger_name) where not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass(pair.relation)
  and t.tgname=pair.trigger_name and t.tgfoid='private.freeze_claimed_embryo_receipt_v1()'::regprocedure
  and t.tgtype=19 and t.tgenabled='O' and not t.tgdeferrable and not t.tginitdeferred))
  or exists(select 1 from unnest(array['private.embryo_canonical_parts','public.worker_jobs','public.embryo_ingest_sessions',
   'private.claimed_embryo_ingest_receipts','private.claimed_embryo_job_receipts','private.embryo_canonical_source_parts',
   'private.embryo_canonical_sources','private.future_person_custody_slices','public.subjects']) relation
   where not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass(relation) and t.tgname='embryo_part_provenance'
    and t.tgfoid='private.guard_embryo_part_provenance_v1()'::regprocedure and t.tgtype=29 and t.tgenabled='O'
    and t.tgdeferrable and t.tginitdeferred and t.tgqual is null and t.tgnargs=0 and t.tgattr=''::int2vector)) then
  raise exception using errcode='55000',message='claimed provenance trigger differs';end if;

 -- Exact existing constraints/indexes/triggers are independently captured from
 -- the root-owned full215 catalog. There is no local/prod normalization waiver.
 for expected in select value from jsonb_array_elements($receipt_catalog$[{"relation":"private.claimed_embryo_ingest_receipts","constraints":[{"deferrable":false,"deferred":false,"definition":"CHECK ((ingest_revision > 0))","name":"claimed_embryo_ingest_receipts_ingest_revision_check","validated":true},{"deferrable":false,"deferred":false,"definition":"CHECK (((manifest_chunk_count >= 1) AND (manifest_chunk_count <= 50)))","name":"claimed_embryo_ingest_receipts_manifest_chunk_count_check","validated":true},{"deferrable":false,"deferred":false,"definition":"CHECK ((manifest_sha256 ~ '^[0-9a-f]{64}$'::text))","name":"claimed_embryo_ingest_receipts_manifest_sha256_check","validated":true},{"deferrable":false,"deferred":false,"definition":"PRIMARY KEY (id)","name":"claimed_embryo_ingest_receipts_pkey","validated":true},{"deferrable":false,"deferred":false,"definition":"CHECK ((publication_revision > 0))","name":"claimed_embryo_ingest_receipts_publication_revision_check","validated":true},{"deferrable":false,"deferred":false,"definition":"CHECK ((reference_build = ANY (ARRAY['GRCh37'::text, 'GRCh38'::text])))","name":"claimed_embryo_ingest_receipts_reference_build_check","validated":true},{"deferrable":false,"deferred":false,"definition":"CHECK ((source_binding_fingerprint ~ '^[0-9a-f]{64}$'::text))","name":"claimed_embryo_ingest_receipts_source_binding_fingerprint_check","validated":true},{"deferrable":false,"deferred":false,"definition":"UNIQUE (worker_job_id)","name":"claimed_embryo_ingest_receipts_worker_job_id_key","validated":true},{"deferrable":true,"deferred":true,"definition":"TRIGGER DEFERRABLE INITIALLY DEFERRED","name":"embryo_part_provenance","validated":true}],"indexes":[{"definition":"CREATE UNIQUE INDEX claimed_embryo_ingest_receipts_pkey ON private.claimed_embryo_ingest_receipts USING btree (id)","ready":true,"unique":true,"valid":true},{"definition":"CREATE UNIQUE INDEX claimed_embryo_ingest_receipts_worker_job_id_key ON private.claimed_embryo_ingest_receipts USING btree (worker_job_id)","ready":true,"unique":true,"valid":true}],"triggers":[{"definition":"CREATE TRIGGER claimed_embryo_session_immutable BEFORE UPDATE ON private.claimed_embryo_ingest_receipts FOR EACH ROW EXECUTE FUNCTION private.freeze_claimed_embryo_receipt_v1()","enabled":"O","name":"claimed_embryo_session_immutable"},{"definition":"CREATE CONSTRAINT TRIGGER embryo_part_provenance AFTER INSERT OR DELETE OR UPDATE ON private.claimed_embryo_ingest_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.guard_embryo_part_provenance_v1()","enabled":"O","name":"embryo_part_provenance"}]},{"relation":"private.claimed_embryo_job_receipts","constraints":[{"deferrable":false,"deferred":false,"definition":"CHECK (((attempt >= 1) AND (attempt <= 20)))","name":"claimed_embryo_job_receipts_attempt_check","validated":true},{"deferrable":false,"deferred":false,"definition":"CHECK ((file_sha256 ~ '^[0-9a-f]{64}$'::text))","name":"claimed_embryo_job_receipts_file_sha256_check","validated":true},{"deferrable":false,"deferred":false,"definition":"CHECK ((idempotency_key ~ '^[0-9a-f]{64}$'::text))","name":"claimed_embryo_job_receipts_idempotency_key_check","validated":true},{"deferrable":false,"deferred":false,"definition":"PRIMARY KEY (id)","name":"claimed_embryo_job_receipts_pkey","validated":true},{"deferrable":false,"deferred":false,"definition":"FOREIGN KEY (session_id) REFERENCES private.claimed_embryo_ingest_receipts(id) ON DELETE RESTRICT","name":"claimed_embryo_job_receipts_session_id_fkey","validated":true},{"deferrable":false,"deferred":false,"definition":"UNIQUE (session_id)","name":"claimed_embryo_job_receipts_session_id_key","validated":true},{"deferrable":false,"deferred":false,"definition":"CHECK ((source_binding_revision > 0))","name":"claimed_embryo_job_receipts_source_binding_revision_check","validated":true},{"deferrable":true,"deferred":true,"definition":"TRIGGER DEFERRABLE INITIALLY DEFERRED","name":"embryo_part_provenance","validated":true}],"indexes":[{"definition":"CREATE UNIQUE INDEX claimed_embryo_job_receipts_pkey ON private.claimed_embryo_job_receipts USING btree (id)","ready":true,"unique":true,"valid":true},{"definition":"CREATE UNIQUE INDEX claimed_embryo_job_receipts_session_id_key ON private.claimed_embryo_job_receipts USING btree (session_id)","ready":true,"unique":true,"valid":true}],"triggers":[{"definition":"CREATE TRIGGER claimed_embryo_job_immutable BEFORE UPDATE ON private.claimed_embryo_job_receipts FOR EACH ROW EXECUTE FUNCTION private.freeze_claimed_embryo_receipt_v1()","enabled":"O","name":"claimed_embryo_job_immutable"},{"definition":"CREATE CONSTRAINT TRIGGER embryo_part_provenance AFTER INSERT OR DELETE OR UPDATE ON private.claimed_embryo_job_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.guard_embryo_part_provenance_v1()","enabled":"O","name":"embryo_part_provenance"}]}]$receipt_catalog$::jsonb) loop
  if (select coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),
    'deferrable',c.condeferrable,'deferred',c.condeferred,'validated',c.convalidated) order by c.conname),'[]'::jsonb)
    from pg_constraint c where c.conrelid=to_regclass(expected.value->>'relation')) is distinct from expected.value->'constraints'
   or (select coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'ready',i.indisready,
     'valid',i.indisvalid,'unique',i.indisunique) order by pg_get_indexdef(i.indexrelid)),'[]'::jsonb)
     from pg_index i where i.indrelid=to_regclass(expected.value->>'relation')) is distinct from expected.value->'indexes'
   or (select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
     order by t.tgname),'[]'::jsonb) from pg_trigger t where t.tgrelid=to_regclass(expected.value->>'relation') and not t.tgisinternal)
     is distinct from expected.value->'triggers'
   or exists(select 1 from pg_policy where polrelid=to_regclass(expected.value->>'relation'))
   or exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))acl
    where c.oid=to_regclass(expected.value->>'relation') and (acl.grantee<>c.relowner or acl.grantor<>c.relowner or acl.is_grantable)) then
   raise exception using errcode='55000',message='claimed provenance exact table guard differs';end if;
 end loop;
end $predecessors$;

-- Minimum frozen split provenance is shared by independently held sources.
-- Its existence is never account, claimant or provider-deletion authority.
-- This adds no store, clock, public execution door or historical backfill.

create function private.assert_claimed_provenance_candidate_v1(p_candidate jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare s private.claimed_embryo_ingest_receipts;j private.claimed_embryo_job_receipts;
begin
 if jsonb_typeof(p_candidate) is distinct from 'object'
  or p_candidate-array['version','ingest','job']<>'{}'::jsonb
  or not(p_candidate?&array['version','ingest','job'])
  or p_candidate->>'version' is distinct from 'claimed-provenance-pair-v1'
  or jsonb_typeof(p_candidate->'ingest') is distinct from 'object'
  or jsonb_typeof(p_candidate->'job') is distinct from 'object' then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 begin
  s:=jsonb_populate_record(null::private.claimed_embryo_ingest_receipts,p_candidate->'ingest');
  j:=jsonb_populate_record(null::private.claimed_embryo_job_receipts,p_candidate->'job');
 exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='42501',message='claimed provenance unavailable';end;
 if to_jsonb(s) is distinct from p_candidate->'ingest' or to_jsonb(j) is distinct from p_candidate->'job'
  or s.id is null or s.historical_cohort_id is null or s.worker_job_id is null
  or s.ingest_revision is null or s.ingest_revision<=0 or s.publication_revision is null or s.publication_revision<=0
  or s.manifest_sha256 is null or s.manifest_sha256!~'^[0-9a-f]{64}$'
  or s.manifest_chunk_count is null or s.manifest_chunk_count not between 1 and 50
  or s.source_binding_fingerprint is null or s.source_binding_fingerprint!~'^[0-9a-f]{64}$'
  or s.reference_build is null or s.reference_build not in('GRCh37','GRCh38')
  or j.id is distinct from s.worker_job_id or j.session_id is distinct from s.id
  or j.historical_cohort_id is distinct from s.historical_cohort_id
  or j.attempt is null or j.attempt not between 1 and 20
  or j.source_binding_revision is distinct from s.ingest_revision or j.file_sha256 is distinct from s.manifest_sha256
  or j.computation_revision is null or length(j.computation_revision) not between 1 and 200
  or j.idempotency_key is null or j.idempotency_key!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
end $$;

create function private.lock_claimed_provenance_pairs_v1(p_candidates jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare candidate jsonb;
begin
 if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates)>50 then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 for candidate in select value from jsonb_array_elements(p_candidates) loop
  perform private.assert_claimed_provenance_candidate_v1(candidate);
 end loop;
 if (select count(distinct value#>>'{ingest,id}') from jsonb_array_elements(p_candidates))<>jsonb_array_length(p_candidates)
  or (select count(distinct value#>>'{job,id}') from jsonb_array_elements(p_candidates))<>jsonb_array_length(p_candidates) then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 for candidate in select value from jsonb_array_elements(p_candidates)
  order by value#>>'{ingest,id}',value#>>'{job,id}' loop
  perform pg_advisory_xact_lock(hashtextextended('inherit.claimed-provenance-pair-v1|'
   ||(candidate#>>'{ingest,id}')||'|'||(candidate#>>'{job,id}'),0));
 end loop;
end $$;

-- Revalidate every survivor, including a current parent's exact typed source
-- disposal interval. An unknown orphan is never equivalent to no consumer.
create function private.claimed_provenance_pair_state_v1(p_candidate jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.claimed_embryo_ingest_receipts;j private.claimed_embryo_job_receipts;
 live_s public.embryo_ingest_sessions;live_j public.worker_jobs;
 receipt_s private.claimed_embryo_ingest_receipts;receipt_j private.claimed_embryo_job_receipts;
 x private.embryo_canonical_sources;p private.embryo_canonical_parts;
 u public.subjects;ids uuid[];n bigint:=0;live boolean;archived boolean;
begin
 perform private.assert_claimed_provenance_candidate_v1(p_candidate);
 s:=jsonb_populate_record(null::private.claimed_embryo_ingest_receipts,p_candidate->'ingest');
 j:=jsonb_populate_record(null::private.claimed_embryo_job_receipts,p_candidate->'job');
 if (select count(*) from private.claimed_embryo_ingest_receipts where id=s.id or worker_job_id=j.id)>1
  or (select count(*) from private.claimed_embryo_job_receipts where id=j.id or session_id=s.id)>1 then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 select * into receipt_s from private.claimed_embryo_ingest_receipts where id=s.id or worker_job_id=j.id;
 select * into receipt_j from private.claimed_embryo_job_receipts where id=j.id or session_id=s.id;
 archived:=receipt_s.id is not null;
 if archived is distinct from (receipt_j.id is not null)
  or (archived and (to_jsonb(receipt_s) is distinct from to_jsonb(s) or to_jsonb(receipt_j) is distinct from to_jsonb(j))) then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 select * into live_s from public.embryo_ingest_sessions where id=s.id;
 select * into live_j from public.worker_jobs where id=j.id;
 live:=live_s.id is not null;
 if live is distinct from (live_j.id is not null) or (live and (
  live_s.worker_job_id is distinct from j.id or live_s.cohort_id is distinct from s.historical_cohort_id
  or live_s.ingest_revision is distinct from s.ingest_revision or live_s.manifest_sha256 is distinct from s.manifest_sha256
  or live_s.manifest_chunk_count is distinct from s.manifest_chunk_count
  or live_s.source_binding_fingerprint is distinct from s.source_binding_fingerprint
  or live_s.reference_build is distinct from s.reference_build or live_s.status<>'published'
  or live_j.status<>'done' or live_j.finished_at is null or live_j.kind<>'split_cohort_vcf'
  or live_j.output_kind<>'ingest.normalize' or live_j.source_binding_kind<>'embryo-ingest-fragment-set'
  or live_j.source_binding_id is distinct from s.id or live_j.cohort_id is distinct from s.historical_cohort_id
  or live_j.attempts is distinct from j.attempt or live_j.source_binding_revision is distinct from j.source_binding_revision
  or live_j.file_sha256 is distinct from j.file_sha256 or live_j.computation_revision is distinct from j.computation_revision
  or live_j.idempotency_key is distinct from j.idempotency_key)) then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 for x in select * from private.embryo_canonical_sources where session_id=s.id or worker_job_id=j.id order by file_id loop
  if (x.session_id,x.worker_job_id,x.attempt,x.cohort_id,x.publication_revision,x.reference_build)
   is distinct from (s.id,j.id,j.attempt,s.historical_cohort_id,s.publication_revision,s.reference_build) then
   raise exception using errcode='42501',message='claimed provenance unavailable';end if;
  ids:=array(select m.part_id from private.embryo_canonical_source_parts m where m.file_id=x.file_id order by m.sequence);
  if cardinality(ids) is distinct from x.part_count or cardinality(ids) not between 1 and 50
   or x.source_sha256 is distinct from private.embryo_canonical_source_sha256_v1(x.file_id)
   or x.membership_sha256 is distinct from private.embryo_canonical_membership_sha256_v1(ids)
   or x.byte_count is distinct from (select sum(a.byte_count) from private.embryo_canonical_parts a where a.id=any(ids))
   or exists(select 1 from private.embryo_canonical_source_parts m left join private.embryo_canonical_parts a on a.id=m.part_id
     where m.file_id=x.file_id and (a.id is null or a.session_id is distinct from s.id or a.worker_job_id is distinct from j.id
      or a.attempt is distinct from j.attempt or a.sample_ordinal is distinct from x.sample_ordinal
      or a.sequence is distinct from m.sequence or a.state<>'landed' or a.observed_sha256 is distinct from a.sha256)) then
   raise exception using errcode='42501',message='claimed provenance unavailable';end if;
  select * into u from public.subjects where id=x.subject_id;
  if u.id is null or not exists(select 1 from public.embryos e join public.genome_files f on f.id=x.file_id
    where e.id=x.embryo_id and e.subject_id=u.id and e.sample_ordinal=x.sample_ordinal and f.subject_id=u.id) then
   raise exception using errcode='42501',message='claimed provenance unavailable';end if;
  if u.lifecycle in('claimed_unbound','claimed_bound') then
   perform private.assert_future_person_subject_custody_v1(u.id);
   if not exists(select 1 from private.future_person_custody_slices c where c.subject_id=u.id
    and c.claimant_principal_id=u.claimant_principal_id and c.source_file_id=x.file_id
    and (c.historical_cohort_id,c.publication_revision,c.source_sha256,c.source_membership_sha256)
     is not distinct from (x.cohort_id,x.publication_revision,x.source_sha256,x.membership_sha256)) then
    raise exception using errcode='42501',message='claimed provenance unavailable';end if;
  elsif not live or not exists(select 1 from public.embryo_cohorts c join public.embryos e on e.id=x.embryo_id
    join public.genome_files f on f.id=x.file_id where c.id=s.historical_cohort_id
    and c.publication_revision=s.publication_revision and u.cohort_id=c.id and e.cohort_id=c.id
    and u.owner_account_id=c.owner_account_id and f.user_id=c.owner_account_id
    and not exists(select 1 from private.future_person_custody_slices custody where custody.subject_id=u.id)) then
   raise exception using errcode='42501',message='claimed provenance unavailable';end if;
  n:=n+1;
 end loop;
 for p in select * from private.embryo_canonical_parts where session_id=s.id or worker_job_id=j.id order by id loop
  if (p.session_id,p.worker_job_id,p.attempt,p.state) is distinct from (s.id,j.id,j.attempt,'landed'::text) then
   raise exception using errcode='42501',message='claimed provenance unavailable';end if;
  if not exists(select 1 from private.embryo_canonical_source_parts m join private.embryo_canonical_sources stored_source on stored_source.file_id=m.file_id
    where m.part_id=p.id and m.sequence=p.sequence and stored_source.session_id=s.id and stored_source.worker_job_id=j.id
     and stored_source.attempt=j.attempt and stored_source.sample_ordinal=p.sample_ordinal) then
   if not live or not exists(select 1 from private.account_owned_cohort_purges t
    join public.account_deletion_requests d on d.id=t.deletion_id join public.embryo_cohorts c on c.id=t.cohort_id
    join public.embryo_ingest_unwinds unwind on unwind.id=t.source_unwind_id
    join public.embryo_ingest_delete_objects o on o.unwind_id=unwind.id
    where t.cohort_id=s.historical_cohort_id and c.owner_account_id=d.account_id and c.status='purge_queued'
     and t.lifecycle_revision=c.lifecycle_revision and t.fixed_deadline=d.notice_ends_at and d.state='delete_started'
     and d.notice_ends_at<=clock_timestamp() and unwind.purpose='source' and unwind.session_id=s.id
     and unwind.state in('storage_pending','storage_confirmed') and o.source_kind='canonical-part'
     and o.source_id=p.id and o.bucket_id=p.provider_bucket and o.object_name=p.provider_key) then
    raise exception using errcode='42501',message='claimed provenance unavailable';end if;
  end if;
  n:=n+1;
 end loop;
 if n>0 and not live and not archived then raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 return jsonb_build_object('consumers',n,'liveRuntime',live,'archived',archived);
end $$;

-- A minimum candidate is produced from the exact current source, never from
-- a caller-supplied historical account/cohort selector or a copied job body.
create function private.claimed_provenance_candidate_v1(p_file uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare x private.embryo_canonical_sources;s private.claimed_embryo_ingest_receipts;
 j private.claimed_embryo_job_receipts;candidate jsonb;
begin
 select * into x from private.embryo_canonical_sources where file_id=p_file;
 if x.file_id is null then raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 select * into s from private.claimed_embryo_ingest_receipts where id=x.session_id;
 select * into j from private.claimed_embryo_job_receipts where id=x.worker_job_id;
 if s.id is null and j.id is null then
  select live.id,live.cohort_id,live.worker_job_id,live.ingest_revision,x.publication_revision,live.manifest_sha256,
   live.manifest_chunk_count,live.source_binding_fingerprint,live.reference_build into s
   from public.embryo_ingest_sessions live where live.id=x.session_id;
  select w.id,w.source_binding_id,w.cohort_id,w.attempts,w.source_binding_revision,w.file_sha256,
   w.computation_revision,w.idempotency_key into j from public.worker_jobs w where w.id=x.worker_job_id;
 end if;
 candidate:=jsonb_build_object('version','claimed-provenance-pair-v1','ingest',to_jsonb(s),'job',to_jsonb(j));
 perform private.lock_claimed_provenance_pairs_v1(jsonb_build_array(candidate));
 perform private.claimed_provenance_pair_state_v1(candidate);
 return candidate;
end $$;

create function private.account_claimed_provenance_candidates_v1(p_deletion uuid,p_cohort uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.account_deletion_requests;t private.account_owned_cohort_purges;candidate jsonb;
 result jsonb:='[]';s private.claimed_embryo_ingest_receipts;j private.claimed_embryo_job_receipts;
begin
 select * into d from public.account_deletion_requests where id=p_deletion for update;
 select * into t from private.account_owned_cohort_purges where deletion_id=p_deletion and cohort_id=p_cohort;
 if d.id is null or t.deletion_id is null or d.state<>'delete_started' or d.notice_ends_at>clock_timestamp()
  or d.claim_expires_at is null or d.claim_expires_at<=clock_timestamp() or t.fixed_deadline is distinct from d.notice_ends_at
  or not exists(select 1 from public.embryo_cohorts c where c.id=p_cohort and c.owner_account_id=d.account_id
   and c.status='purge_queued' and c.lifecycle_revision=t.lifecycle_revision) then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 for s in select * from private.claimed_embryo_ingest_receipts where historical_cohort_id=p_cohort order by id loop
  select * into j from private.claimed_embryo_job_receipts where id=s.worker_job_id;
  candidate:=jsonb_build_object('version','claimed-provenance-pair-v1','ingest',to_jsonb(s),'job',to_jsonb(j));
  result:=result||jsonb_build_array(candidate);
 end loop;
 if exists(select 1 from private.claimed_embryo_job_receipts q where q.historical_cohort_id=p_cohort
  and not exists(select 1 from private.claimed_embryo_ingest_receipts a where a.id=q.session_id and a.worker_job_id=q.id)) then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 perform private.lock_claimed_provenance_pairs_v1(result);
 for candidate in select value from jsonb_array_elements(result) loop perform private.claimed_provenance_pair_state_v1(candidate);end loop;
 return result;
end $$;

-- Only the two actual native finalization authorities can collect a sealed
-- pair. An immutable source/read receipt is never a deletion capability.
create function private.collect_claimed_provenance_pair_v1(p_origin text,p_authority uuid,p_candidate jsonb,p_claim_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare d public.account_deletion_requests;m public.purge_manifests;phase public.retention_due_phases;
 s private.claimed_embryo_ingest_receipts;j private.claimed_embryo_job_receipts;state jsonb;
begin
 perform private.assert_claimed_provenance_candidate_v1(p_candidate);
 s:=jsonb_populate_record(null::private.claimed_embryo_ingest_receipts,p_candidate->'ingest');
 j:=jsonb_populate_record(null::private.claimed_embryo_job_receipts,p_candidate->'job');
 if p_origin='claimant' then
  select * into m from public.purge_manifests where id=p_authority;
  select * into phase from public.retention_due_phases where retention_row_id=m.retention_row_id
   and phase_id=m.phase_id and phase_revision=m.phase_revision;
  if m.id is null or m.phase_id<>'future-person-claimed-source-disposal' or m.state<>'executing'
   or m.manifest_class<>'complete-retention' or m.physical_purge_started_at is null or m.frozen_manifest_hash is null
   or phase.status<>'claimed' or phase.claim_expires_at is null or phase.claim_expires_at<=clock_timestamp()
   or p_claim_hash is null or p_claim_hash!~'^[0-9a-f]{64}$'
   or not private.claim_hash_matches_v1(phase.claim_token_hash,p_claim_hash)
   or phase.immutable_envelope->'sharedProvenance' is distinct from p_candidate
   or exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.status<>'deleted')
   or exists(select 1 from private.embryo_canonical_sources x where x.file_id=(phase.immutable_envelope->>'sourceFileId')::uuid)
   or exists(select 1 from public.subjects u where u.id=phase.target_id)
   or exists(select 1 from private.future_person_custody_slices c where c.subject_id=phase.target_id) then
   raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 elsif p_origin='account' then
  select * into d from public.account_deletion_requests where id=p_authority for update;
  if p_claim_hash is not null or d.id is null or d.state<>'delete_started' or d.notice_ends_at>clock_timestamp()
   or d.storage_completed_at is null or d.claim_expires_at is null or d.claim_expires_at<=clock_timestamp()
   or not exists(select 1 from private.account_owned_cohort_purges t where t.deletion_id=d.id
    and t.cohort_id=s.historical_cohort_id and t.fixed_deadline=d.notice_ends_at)
   or exists(select 1 from public.embryo_cohorts c where c.id=s.historical_cohort_id)
   or exists(select 1 from public.subjects u where u.cohort_id=s.historical_cohort_id) then
   raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 else raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 perform private.lock_claimed_provenance_pairs_v1(jsonb_build_array(p_candidate));
 state:=private.claimed_provenance_pair_state_v1(p_candidate);
 if (state->>'consumers')::bigint>0 then return 'retained-for-surviving-provenance';end if;
 if (state->>'liveRuntime')::boolean then return 'retained-for-live-runtime';end if;
 if not(state->>'archived')::boolean then return 'absent';end if;
 if exists(select 1 from public.embryo_ingest_fragments f where f.session_id=s.id)
  or exists(select 1 from private.embryo_ingest_write_intents w where w.session_id=s.id)
  or exists(select 1 from public.embryo_fragment_handle_maps h where h.session_id=s.id)
  or exists(select 1 from private.embryo_split_variants v where v.session_id=s.id)
  or exists(select 1 from private.embryo_split_ordinals o where o.session_id=s.id)
  or exists(select 1 from public.embryo_ingest_unwinds u where u.session_id=s.id and u.state<>'complete') then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 delete from private.claimed_embryo_job_receipts where id=j.id and to_jsonb(claimed_embryo_job_receipts)=p_candidate->'job';
 if not found then raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 delete from private.claimed_embryo_ingest_receipts where id=s.id and to_jsonb(claimed_embryo_ingest_receipts)=p_candidate->'ingest';
 if not found or exists(select 1 from private.claimed_embryo_job_receipts q where q.session_id=s.id)
  or exists(select 1 from private.embryo_canonical_parts a where a.session_id=s.id or a.worker_job_id=j.id)
  or exists(select 1 from private.embryo_canonical_sources x where x.session_id=s.id or x.worker_job_id=j.id) then
  raise exception using errcode='42501',message='claimed provenance unavailable';end if;
 return 'collected';
end $$;

revoke all on function private.assert_claimed_provenance_candidate_v1(jsonb),private.lock_claimed_provenance_pairs_v1(jsonb),
 private.claimed_provenance_pair_state_v1(jsonb),private.claimed_provenance_candidate_v1(uuid),
 private.account_claimed_provenance_candidates_v1(uuid,uuid),private.collect_claimed_provenance_pair_v1(text,uuid,jsonb,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- Exact guarded successor patches; every unrelated predecessor byte remains.
do $patch_0$
declare target regprocedure:='private.capture_claimed_embryo_provenance_v1(uuid,uuid)'::regprocedure;definition text;before_acl aclitem[];
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc where oid=target and md5(prosrc)='3970b934f3165fd1e8cf2f26ce913d34';
 if definition is null then raise exception using errcode='55000',message='claimed provenance patch predecessor differs';end if;
 if (length(definition)-length(replace(definition,$anchor_0_0$declare d public.account_deletion_requests; r record;$anchor_0_0$,'')))/length($anchor_0_0$declare d public.account_deletion_requests; r record;$anchor_0_0$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_0_0$declare d public.account_deletion_requests; r record;$anchor_0_0$,$successor_0_0$declare d public.account_deletion_requests; r record; candidates jsonb;$successor_0_0$);
 if (length(definition)-length(replace(definition,$anchor_0_1$  for r in select distinct x.session_id,x.worker_job_id$anchor_0_1$,'')))/length($anchor_0_1$  for r in select distinct x.session_id,x.worker_job_id$anchor_0_1$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_0_1$  for r in select distinct x.session_id,x.worker_job_id$anchor_0_1$,$successor_0_1$  candidates:='[]'::jsonb;
  for r in select distinct on(x.session_id,x.worker_job_id) x.file_id,x.session_id,x.worker_job_id from private.future_person_custody_slices c
    join private.embryo_canonical_sources x on x.file_id=c.source_file_id and x.subject_id=c.subject_id
      and x.cohort_id=c.historical_cohort_id and x.source_sha256=c.source_sha256
      and x.membership_sha256=c.source_membership_sha256 and x.publication_revision=c.publication_revision
    join public.subjects u on u.id=c.subject_id and u.cohort_id is null
      and u.claimant_principal_id=c.claimant_principal_id and u.lifecycle in('claimed_unbound','claimed_bound')
    where c.historical_cohort_id=p_cohort order by x.session_id,x.worker_job_id,x.file_id loop
    candidates:=candidates||jsonb_build_array(private.claimed_provenance_candidate_v1(r.file_id));
  end loop;
  perform private.lock_claimed_provenance_pairs_v1(candidates);
  for r in select distinct x.session_id,x.worker_job_id$successor_0_1$);
 execute definition;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='9d2ad554c7193b23e64714db6166e9f3' and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='claimed provenance successor differs';end if;
end $patch_0$;
do $patch_1$
declare target regprocedure:='private.purge_account_owned_cohorts_v1(uuid)'::regprocedure;definition text;before_acl aclitem[];
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc where oid=target and md5(prosrc)='cec89910d9191838a890db56e14cb18c';
 if definition is null then raise exception using errcode='55000',message='claimed provenance patch predecessor differs';end if;
 if (length(definition)-length(replace(definition,$anchor_1_0$v_outbox_ids uuid[]; v_invitation_ids uuid[]; deleted_ids uuid[]; r record; n bigint;$anchor_1_0$,'')))/length($anchor_1_0$v_outbox_ids uuid[]; v_invitation_ids uuid[]; deleted_ids uuid[]; r record; n bigint;$anchor_1_0$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_1_0$v_outbox_ids uuid[]; v_invitation_ids uuid[]; deleted_ids uuid[]; r record; n bigint;$anchor_1_0$,$successor_1_0$v_outbox_ids uuid[]; v_invitation_ids uuid[]; deleted_ids uuid[]; r record; n bigint; candidates jsonb; candidate jsonb;$successor_1_0$);
 if (length(definition)-length(replace(definition,$anchor_1_1$    if c.id is null then
$anchor_1_1$,'')))/length($anchor_1_1$    if c.id is null then
$anchor_1_1$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_1_1$    if c.id is null then
$anchor_1_1$,$successor_1_1$    if c.id is null then
      if exists(select 1 from private.claimed_embryo_ingest_receipts where historical_cohort_id=t.cohort_id)
        or exists(select 1 from private.claimed_embryo_job_receipts where historical_cohort_id=t.cohort_id) then
        raise exception using errcode='42501',message='claimed provenance unavailable';end if;
$successor_1_1$);
 if (length(definition)-length(replace(definition,$anchor_1_2$    perform private.assert_account_owned_cohorts_v1(d.account_id);$anchor_1_2$,'')))/length($anchor_1_2$    perform private.assert_account_owned_cohorts_v1(d.account_id);$anchor_1_2$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_1_2$    perform private.assert_account_owned_cohorts_v1(d.account_id);$anchor_1_2$,$successor_1_2$    perform private.assert_account_owned_cohorts_v1(d.account_id);
    candidates:=private.account_claimed_provenance_candidates_v1(d.id,c.id);$successor_1_2$);
 if (length(definition)-length(replace(definition,$anchor_1_3$    delete from public.embryo_cohort_drafts where id=c.draft_id;$anchor_1_3$,'')))/length($anchor_1_3$    delete from public.embryo_cohort_drafts where id=c.draft_id;$anchor_1_3$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_1_3$    delete from public.embryo_cohort_drafts where id=c.draft_id;$anchor_1_3$,$successor_1_3$    delete from public.embryo_cohort_drafts where id=c.draft_id;
    for candidate in select value from jsonb_array_elements(candidates) loop
      perform private.collect_claimed_provenance_pair_v1('account',d.id,candidate,null);
    end loop;$successor_1_3$);
 execute definition;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='3fe1b53e74675885cb9f825917dc3c70' and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='claimed provenance successor differs';end if;
end $patch_1$;
do $patch_2$
declare target regprocedure:='private.prepare_future_person_deletion_v1(text,text)'::regprocedure;definition text;before_acl aclitem[];
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc where oid=target and md5(prosrc)='825d2bb042623900b71bfc516f9e8b42';
 if definition is null then raise exception using errcode='55000',message='claimed provenance patch predecessor differs';end if;
 if (length(definition)-length(replace(definition,$anchor_2_0$'completionDeadline',v_now+interval '30 days');$anchor_2_0$,'')))/length($anchor_2_0$'completionDeadline',v_now+interval '30 days');$anchor_2_0$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_2_0$'completionDeadline',v_now+interval '30 days');$anchor_2_0$,$successor_2_0$'completionDeadline',v_now+interval '30 days',
   'sharedProvenance',private.claimed_provenance_candidate_v1(x.file_id));
 exception when sqlstate '42501' then
  if sqlerrm is distinct from 'claimed provenance unavailable' then raise;end if;
  raise exception using errcode='42501',message='claimant deletion unavailable';
 end;$successor_2_0$);
 if (length(definition)-length(replace(definition,$anchor_2_1$ env:=jsonb_build_object('version','future-person-deletion-plan-v1','subjectId',s.id,$anchor_2_1$,'')))/length($anchor_2_1$ env:=jsonb_build_object('version','future-person-deletion-plan-v1','subjectId',s.id,$anchor_2_1$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_2_1$ env:=jsonb_build_object('version','future-person-deletion-plan-v1','subjectId',s.id,$anchor_2_1$,$successor_2_1$ begin
 env:=jsonb_build_object('version','future-person-deletion-plan-v1','subjectId',s.id,$successor_2_1$);
 execute definition;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='d059d03088936f868ce748772073f5db' and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='claimed provenance successor differs';end if;
end $patch_2$;
do $patch_3$
declare target regprocedure:='private.assert_future_person_deletion_plan_v1(uuid)'::regprocedure;definition text;before_acl aclitem[];
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc where oid=target and md5(prosrc)='e3d743b8f35d8f655712ec0d8f996b8f';
 if definition is null then raise exception using errcode='55000',message='claimed provenance patch predecessor differs';end if;
 if (length(definition)-length(replace(definition,$anchor_3_0$'sourceDeadline',r.created_at+interval '7 days','completionDeadline',r.created_at+interval '30 days')$anchor_3_0$,'')))/length($anchor_3_0$'sourceDeadline',r.created_at+interval '7 days','completionDeadline',r.created_at+interval '30 days')$anchor_3_0$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_3_0$'sourceDeadline',r.created_at+interval '7 days','completionDeadline',r.created_at+interval '30 days')$anchor_3_0$,$successor_3_0$'sourceDeadline',r.created_at+interval '7 days','completionDeadline',r.created_at+interval '30 days',
     'sharedProvenance',private.claimed_provenance_candidate_v1(x.file_id))$successor_3_0$);
 execute definition;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='c009f02ee0e43a661d7b70d23b5c6ba3' and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='claimed provenance successor differs';end if;
end $patch_3$;
do $patch_4$
declare target regprocedure:='private.finish_future_person_deletion_v1(uuid,text)'::regprocedure;definition text;before_acl aclitem[];
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc where oid=target and md5(prosrc)='0ac6a4d7e63942e35d4303464d2aac89';
 if definition is null then raise exception using errcode='55000',message='claimed provenance patch predecessor differs';end if;
 if (length(definition)-length(replace(definition,$anchor_4_0$v_controls uuid[];v_control uuid;old_entry public.purge_manifest_entries;$anchor_4_0$,'')))/length($anchor_4_0$v_controls uuid[];v_control uuid;old_entry public.purge_manifest_entries;$anchor_4_0$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_4_0$v_controls uuid[];v_control uuid;old_entry public.purge_manifest_entries;$anchor_4_0$,$successor_4_0$v_controls uuid[];v_control uuid;old_entry public.purge_manifest_entries;v_shared_disposition text;$successor_4_0$);
 if (length(definition)-length(replace(definition,$anchor_4_1$ perform private.assert_future_person_deletion_fk_closure_v1(p_manifest);$anchor_4_1$,'')))/length($anchor_4_1$ perform private.assert_future_person_deletion_fk_closure_v1(p_manifest);$anchor_4_1$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_4_1$ perform private.assert_future_person_deletion_fk_closure_v1(p_manifest);$anchor_4_1$,$successor_4_1$ perform private.lock_claimed_provenance_pairs_v1(jsonb_build_array(p.immutable_envelope->'sharedProvenance'));
 perform private.assert_future_person_deletion_fk_closure_v1(p_manifest);$successor_4_1$);
 if (length(definition)-length(replace(definition,$anchor_4_2$ perform private.append_legal_audit_event('claimant.deleted'$anchor_4_2$,'')))/length($anchor_4_2$ perform private.append_legal_audit_event('claimant.deleted'$anchor_4_2$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_4_2$ perform private.append_legal_audit_event('claimant.deleted'$anchor_4_2$,$successor_4_2$ v_shared_disposition:=private.collect_claimed_provenance_pair_v1('claimant',p_manifest,p.immutable_envelope->'sharedProvenance',p_claim_token_hash);
 perform private.append_legal_audit_event('claimant.deleted'$successor_4_2$);
 if (length(definition)-length(replace(definition,$anchor_4_3$'sourceDeadline',p.immutable_envelope->'sourceDeadline','completionDeadline',p.immutable_envelope->'completionDeadline')$anchor_4_3$,'')))/length($anchor_4_3$'sourceDeadline',p.immutable_envelope->'sourceDeadline','completionDeadline',p.immutable_envelope->'completionDeadline')$anchor_4_3$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_4_3$'sourceDeadline',p.immutable_envelope->'sourceDeadline','completionDeadline',p.immutable_envelope->'completionDeadline')$anchor_4_3$,$successor_4_3$'sourceDeadline',p.immutable_envelope->'sourceDeadline','completionDeadline',p.immutable_envelope->'completionDeadline',
   'sharedProvenanceDisposition',v_shared_disposition)$successor_4_3$);
 execute definition;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='644965a2ad8adff622d7121725f40922' and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='claimed provenance successor differs';end if;
end $patch_4$;
do $patch_5$
declare target regprocedure:='private.freeze_future_person_deletion_plan_v1()'::regprocedure;definition text;before_acl aclitem[];
begin
 select pg_get_functiondef(target),proacl into definition,before_acl from pg_proc where oid=target and md5(prosrc)='815d32207dd7ab2da6218102863eed8b';
 if definition is null then raise exception using errcode='55000',message='claimed provenance patch predecessor differs';end if;
 if (length(definition)-length(replace(definition,$anchor_5_0$'sourceDeadline',old.immutable_envelope->'sourceDeadline','completionDeadline',old.immutable_envelope->'completionDeadline')$anchor_5_0$,'')))/length($anchor_5_0$'sourceDeadline',old.immutable_envelope->'sourceDeadline','completionDeadline',old.immutable_envelope->'completionDeadline')$anchor_5_0$)<>1 then
  raise exception using errcode='55000',message='claimed provenance insertion anchor differs';end if;
 definition:=replace(definition,$anchor_5_0$'sourceDeadline',old.immutable_envelope->'sourceDeadline','completionDeadline',old.immutable_envelope->'completionDeadline')$anchor_5_0$,$successor_5_0$'sourceDeadline',old.immutable_envelope->'sourceDeadline','completionDeadline',old.immutable_envelope->'completionDeadline',
    'sharedProvenanceDisposition',new.immutable_envelope->'sharedProvenanceDisposition')
   or new.immutable_envelope->>'sharedProvenanceDisposition' is null
   or new.immutable_envelope->>'sharedProvenanceDisposition' not in('absent','collected','retained-for-surviving-provenance','retained-for-live-runtime')$successor_5_0$);
 execute definition;
 if not exists(select 1 from pg_proc where oid=target and md5(prosrc)='79e16acea2f613885ad4d461cef1ecdf' and proacl is not distinct from before_acl) then
  raise exception using errcode='55000',message='claimed provenance successor differs';end if;
end $patch_5$;

do $postconditions$
declare expected record;target regprocedure;
begin
 for expected in select * from (values
 ('private.capture_claimed_embryo_provenance_v1(uuid,uuid)','3970b934f3165fd1e8cf2f26ce913d34','9d2ad554c7193b23e64714db6166e9f3',array['p_deletion','p_cohort']::text[],'void',array['search_path=""']::text[]),
 ('private.purge_account_owned_cohorts_v1(uuid)','cec89910d9191838a890db56e14cb18c','3fe1b53e74675885cb9f825917dc3c70',array['p_deletion']::text[],'void',array['search_path=""']::text[]),
 ('private.prepare_future_person_deletion_v1(text,text)','825d2bb042623900b71bfc516f9e8b42','d059d03088936f868ce748772073f5db',array['p_session_hash','p_nonce']::text[],'uuid',array['search_path=""','lock_timeout=250ms']::text[]),
 ('private.assert_future_person_deletion_plan_v1(uuid)','e3d743b8f35d8f655712ec0d8f996b8f','c009f02ee0e43a661d7b70d23b5c6ba3',array['p_manifest']::text[],'public.retention_due_phases',array['search_path=""']::text[]),
 ('private.finish_future_person_deletion_v1(uuid,text)','0ac6a4d7e63942e35d4303464d2aac89','644965a2ad8adff622d7121725f40922',array['p_manifest','p_claim_token_hash']::text[],'jsonb',array['search_path=""','lock_timeout=250ms']::text[]),
 ('private.freeze_future_person_deletion_plan_v1()','815d32207dd7ab2da6218102863eed8b','79e16acea2f613885ad4d461cef1ecdf',array[]::text[],'trigger',array['search_path=""']::text[])
 ) v(signature,before_md5,after_md5,arg_names,result_type,configuration) loop
  target:=to_regprocedure(expected.signature);
  if not exists(select 1 from pg_proc p where p.oid=target and md5(p.prosrc)=expected.after_md5
   and p.prosecdef and p.proowner=(select oid from pg_roles where rolname='postgres')
   and p.proconfig=expected.configuration and coalesce(p.proargnames,'{}'::text[])=expected.arg_names
   and p.pronargs=cardinality(expected.arg_names) and p.proargdefaults is null and not p.proretset
   and p.prorettype=to_regtype(expected.result_type) and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1)
   or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role where has_function_privilege(role,target,'execute')) then
   raise exception using errcode='55000',message='claimed provenance final boundary differs';end if;
 end loop;
 target:='private.assert_claimed_provenance_candidate_v1(jsonb)'::regprocedure;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target and md5(p.prosrc)='16d31d0fc60b68849291c5777f342efc'
  and l.lanname='plpgsql' and p.prosecdef and p.provolatile='v' and p.proparallel='u'
  and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=array['search_path=""']::text[]
  and p.proargdefaults is null and p.proargnames=array['p_candidate']::text[] and p.pronargs=1 and not p.proretset
  and p.prorettype='void'::regtype and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner or a.grantor<>p.proowner or a.is_grantable or a.privilege_type<>'EXECUTE'))
  or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role where has_function_privilege(role,target,'execute')) then
  raise exception using errcode='55000',message='claimed provenance helper boundary differs';end if;
 target:='private.lock_claimed_provenance_pairs_v1(jsonb)'::regprocedure;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target and md5(p.prosrc)='d7d81532b00699557d8ab457b3bffc71'
  and l.lanname='plpgsql' and p.prosecdef and p.provolatile='v' and p.proparallel='u'
  and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=array['search_path=""']::text[]
  and p.proargdefaults is null and p.proargnames=array['p_candidates']::text[] and p.pronargs=1 and not p.proretset
  and p.prorettype='void'::regtype and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner or a.grantor<>p.proowner or a.is_grantable or a.privilege_type<>'EXECUTE'))
  or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role where has_function_privilege(role,target,'execute')) then
  raise exception using errcode='55000',message='claimed provenance helper boundary differs';end if;
 target:='private.claimed_provenance_pair_state_v1(jsonb)'::regprocedure;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target and md5(p.prosrc)='e07c75378ae8d1c14839e604fc2dd58a'
  and l.lanname='plpgsql' and p.prosecdef and p.provolatile='v' and p.proparallel='u'
  and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=array['search_path=""']::text[]
  and p.proargdefaults is null and p.proargnames=array['p_candidate']::text[] and p.pronargs=1 and not p.proretset
  and p.prorettype='jsonb'::regtype and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner or a.grantor<>p.proowner or a.is_grantable or a.privilege_type<>'EXECUTE'))
  or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role where has_function_privilege(role,target,'execute')) then
  raise exception using errcode='55000',message='claimed provenance helper boundary differs';end if;
 target:='private.claimed_provenance_candidate_v1(uuid)'::regprocedure;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target and md5(p.prosrc)='ebcefdc066f98a2d53eed69d4b986ce7'
  and l.lanname='plpgsql' and p.prosecdef and p.provolatile='v' and p.proparallel='u'
  and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=array['search_path=""']::text[]
  and p.proargdefaults is null and p.proargnames=array['p_file']::text[] and p.pronargs=1 and not p.proretset
  and p.prorettype='jsonb'::regtype and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner or a.grantor<>p.proowner or a.is_grantable or a.privilege_type<>'EXECUTE'))
  or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role where has_function_privilege(role,target,'execute')) then
  raise exception using errcode='55000',message='claimed provenance helper boundary differs';end if;
 target:='private.account_claimed_provenance_candidates_v1(uuid,uuid)'::regprocedure;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target and md5(p.prosrc)='953bacdc28d89aba93433112b5fea2b2'
  and l.lanname='plpgsql' and p.prosecdef and p.provolatile='v' and p.proparallel='u'
  and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=array['search_path=""']::text[]
  and p.proargdefaults is null and p.proargnames=array['p_deletion','p_cohort']::text[] and p.pronargs=2 and not p.proretset
  and p.prorettype='jsonb'::regtype and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner or a.grantor<>p.proowner or a.is_grantable or a.privilege_type<>'EXECUTE'))
  or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role where has_function_privilege(role,target,'execute')) then
  raise exception using errcode='55000',message='claimed provenance helper boundary differs';end if;
 target:='private.collect_claimed_provenance_pair_v1(text,uuid,jsonb,text)'::regprocedure;
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target and md5(p.prosrc)='6c07ce2353fb8ffb0bcf2dfd9e8e7256'
  and l.lanname='plpgsql' and p.prosecdef and p.provolatile='v' and p.proparallel='u'
  and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=array['search_path=""']::text[]
  and p.proargdefaults is null and p.proargnames=array['p_origin','p_authority','p_candidate','p_claim_hash']::text[] and p.pronargs=4 and not p.proretset
  and p.prorettype='text'::regtype and cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))=1
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner or a.grantor<>p.proowner or a.is_grantable or a.privilege_type<>'EXECUTE'))
  or exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role where has_function_privilege(role,target,'execute')) then
  raise exception using errcode='55000',message='claimed provenance helper boundary differs';end if;
end $postconditions$;
