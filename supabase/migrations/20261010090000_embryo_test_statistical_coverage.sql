-- Refuse a changed predecessor rather than overwriting an unknown guard.
do $predecessor$
declare p pg_catalog.pg_proc;
begin
 select * into p from pg_catalog.pg_proc where oid=to_regprocedure('private.guard_embryo_carrier_score_v1()');
 if p.oid is null or md5(p.prosrc) is distinct from '33cc6af54f74fd12a5267f667c10d0b5'
  or p.proowner is distinct from 'postgres'::regrole or p.prokind<>'f' or not p.prosecdef
  or p.prorettype is distinct from 'pg_catalog.trigger'::regtype or p.pronargs<>0
  or p.proconfig is distinct from array['search_path=""','lock_timeout=250ms'] then
  raise exception using errcode='55000',message='embryo_test_statistical_predecessor_changed';end if;
end $predecessor$;

-- Entirely synthetic score coverage. No clinical registry/model activation.
-- Empty by default; only the authenticated disposable-runtime owner installs
-- the fixed panel. API/worker roles cannot create or change admission.
create table private.embryo_test_statistical_admission (
 singleton boolean primary key default true check(singleton),
 version integer not null check(version=1),
 panel_sha256 text not null check(panel_sha256='c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f'),
 panel jsonb not null,
 system_identifier text not null check(system_identifier~'^[1-9][0-9]*$'),
 database_name text not null check(database_name='postgres'), database_oid oid not null,
 server_version integer not null, runtime_binding jsonb not null,
 installed_at timestamptz not null default clock_timestamp()
);
alter table private.embryo_test_statistical_admission enable row level security;
revoke all on private.embryo_test_statistical_admission from public,anon,authenticated,inherit_upload_only,service_role;

create function private.freeze_embryo_test_statistical_admission_v1() returns trigger
language plpgsql set search_path='' as $freeze$
begin raise exception using errcode='55000',message='embryo_test_statistical_admission_immutable';end $freeze$;
revoke all on function private.freeze_embryo_test_statistical_admission_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger embryo_test_statistical_admission_immutable before update or delete
 on private.embryo_test_statistical_admission for each row
 execute function private.freeze_embryo_test_statistical_admission_v1();

-- Source-generated complete panel; no caller can select a subset/reference.
create function private.embryo_test_statistical_panel_v1() returns jsonb
language sql immutable set search_path='' as $panel$
 select $fixed_panel${
  "version": "embryo-statistical-test-panel-v1",
  "panelId": "synthetic-score-coverage-v1",
  "conditionId": "SYNTHETIC:9001",
  "conditionName": "Synthetic score coverage",
  "referenceBuild": "GRCh38",
  "jurisdiction": "TEST-LOCAL",
  "purpose": "coverage-failure-only",
  "nVariants": 10,
  "variants": [
    { "id": "synthetic-row-01", "chrom": 1, "pos": 1000, "effectAllele": "G", "otherAllele": "A" },
    { "id": "synthetic-row-02", "chrom": 1, "pos": 1001, "effectAllele": "T", "otherAllele": "C" },
    { "id": "synthetic-row-03", "chrom": 1, "pos": 1002, "effectAllele": "A", "otherAllele": "G" },
    { "id": "synthetic-row-04", "chrom": 1, "pos": 1003, "effectAllele": "C", "otherAllele": "T" },
    { "id": "synthetic-row-05", "chrom": 1, "pos": 1004, "effectAllele": "C", "otherAllele": "A" },
    { "id": "synthetic-row-06", "chrom": 1, "pos": 1005, "effectAllele": "G", "otherAllele": "T" },
    { "id": "synthetic-row-07", "chrom": 1, "pos": 1006, "effectAllele": "A", "otherAllele": "C" },
    { "id": "synthetic-row-08", "chrom": 1, "pos": 1007, "effectAllele": "T", "otherAllele": "G" },
    { "id": "synthetic-row-09", "chrom": 7, "pos": 3000, "effectAllele": "C", "otherAllele": "T" },
    { "id": "synthetic-row-10", "chrom": 13, "pos": 4000, "effectAllele": "G", "otherAllele": "A" }
  ]
}
$fixed_panel$::jsonb;
$panel$;
revoke all on function private.embryo_test_statistical_panel_v1() from public,anon,authenticated,inherit_upload_only,service_role;

create function private.current_embryo_test_statistical_admission_v1() returns jsonb
language plpgsql security definer set search_path='' as $admission$
declare a private.embryo_test_statistical_admission; system_id text;
begin
 select * into a from private.embryo_test_statistical_admission where singleton for share;
 -- Default absence refuses before cohort/genomic lookup, including prod/preview.
 if a.singleton is null then return null;end if;
 select system_identifier::text into system_id from pg_catalog.pg_control_system();
 if (a.version<>1 or a.panel_sha256<>'c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f'
  or a.panel is distinct from private.embryo_test_statistical_panel_v1()
  or a.system_identifier is distinct from system_id or a.database_name is distinct from current_database()
  or a.database_oid is distinct from (select oid from pg_catalog.pg_database where datname=current_database())
  or a.server_version is distinct from current_setting('server_version_num')::integer
  or jsonb_typeof(a.runtime_binding) is distinct from 'object'
  or (select array_agg(k order by k) from jsonb_object_keys(a.runtime_binding) k) is distinct from
    array['configSha256','daemonId','dbContainerId','head','kind','migrationSha256','networkId','owner','project','runtimeIdentity']
  or a.runtime_binding->>'kind' not in('owned-linux','github-browser')
  or a.runtime_binding->>'project' is distinct from 'sequence'
  or a.runtime_binding->>'head'!~'^[0-9a-f]{40}$'
  or a.runtime_binding->>'migrationSha256'!~'^[0-9a-f]{64}$'
  or a.runtime_binding->>'configSha256'!~'^[0-9a-f]{64}$'
  or a.runtime_binding->>'dbContainerId'!~'^[0-9a-f]{64}$'
  or a.runtime_binding->>'networkId'!~'^[0-9a-f]{64}$'
  or a.runtime_binding->>'owner'!~'^[0-9a-f-]{36}$'
  or jsonb_typeof(a.runtime_binding->'runtimeIdentity') is distinct from 'object'
  or nullif(a.runtime_binding->>'daemonId','') is null) is not false then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 return to_jsonb(a);
end $admission$;
revoke all on function private.current_embryo_test_statistical_admission_v1() from public,anon,authenticated,inherit_upload_only,service_role;

create function private.embryo_test_statistical_calls_v1(p_embryo jsonb) returns jsonb
language plpgsql security definer set search_path='' as $calls$
declare calls jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('fileId',v.source_file_id,'chrom',v.chromosome,
  'pos',v.position,'ref',v.reference_allele,'alt',v.alternate_allele,'genotype',v.genotype)
  order by v.chromosome,v.position,v.id),'[]'::jsonb) into calls
 from (select row.* from public.embryo_variants row
  where row.embryo_id=(p_embryo->>'embryoId')::uuid
   and row.source_file_id=(p_embryo#>>'{source,file_id}')::uuid
   and row.source_binding_fingerprint=p_embryo#>>'{source,source_sha256}'
   and exists(select 1 from jsonb_array_elements(private.embryo_test_statistical_panel_v1()->'variants') variant
    where row.chromosome=(variant->>'chrom')::integer and row.position=(variant->>'pos')::integer)
  order by row.chromosome,row.position,row.id limit 257) v;
 if jsonb_array_length(calls)>256 then raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 return calls;
end $calls$;
revoke all on function private.embryo_test_statistical_calls_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

-- Pure fixed-reference matcher. Calling it grants no native source, reference,
-- publication or read authority. The guarded save supplies actual own calls.
create function private.measure_embryo_test_statistical_v1(p_source jsonb,p_calls jsonb) returns jsonb
language plpgsql immutable set search_path='' as $measure$
declare panel jsonb:=private.embryo_test_statistical_panel_v1(); variant jsonb; call jsonb;
 own jsonb; rows jsonb:='[]'; state text; readings integer[]; dose integer;
 matched integer:=0; coverage double precision; finding jsonb; measurement jsonb;
begin
 if (jsonb_typeof(p_source) is distinct from 'object'
  or (select array_agg(k order by k) from jsonb_object_keys(p_source) k) is distinct from
   array['call_immutability_proof','canonical_build','cohort_id','embryo_id','file_id','normalization_source_revision',
    'source_binding_fingerprint','source_publication_revision','source_sha256','subject_id','upload_revision']
  or p_source->>'canonical_build' is distinct from 'GRCh38'
  or p_source->>'call_immutability_proof' is distinct from 'exact-staged-calls-v1'
  or exists(select 1 from unnest(array['cohort_id','embryo_id','subject_id','file_id','canonical_build',
    'source_sha256','source_binding_fingerprint','call_immutability_proof']) k
   where jsonb_typeof(p_source->k) is distinct from 'string')
  or p_source->>'source_sha256'!~'^[0-9a-f]{64}$'
  or p_source->>'source_binding_fingerprint' is distinct from p_source->>'source_sha256'
  or p_source->'normalization_source_revision' is distinct from p_source->'upload_revision'
  or exists(select 1 from unnest(array['cohort_id','embryo_id','subject_id','file_id']) k
   where (p_source->>k ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true)
  or exists(select 1 from unnest(array['source_publication_revision','upload_revision','normalization_source_revision']) k
   where (jsonb_typeof(p_source->k)='number' and p_source->>k~'^[1-9][0-9]*$'
    and case when p_source->>k~'^[1-9][0-9]*$' then (p_source->>k)::numeric<=9007199254740991 else false end) is not true)) is not false then
  return '{"ok":false,"reason":"invalid_source"}'::jsonb;end if;
 if jsonb_typeof(p_calls) is distinct from 'array' or jsonb_array_length(p_calls)>256 then
  return '{"ok":false,"reason":"invalid_calls"}'::jsonb;end if;
 for call in select value from jsonb_array_elements(p_calls) loop
  if jsonb_typeof(call) is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(call) k) not in
    (array['alt','chrom','fileId','genotype','pos','ref'],array['alt','chrom','fileId','genotype','pos','ref','usable'])
   or (call->>'fileId'=p_source->>'file_id' and call->>'ref'~'^[ACGT]$'
    and (call->'alt'='null'::jsonb or call->>'alt'~'^[ACGT]$')
    and call->>'ref' is distinct from call->>'alt'
    and call->>'genotype'~'^(?:[ACGT]/[ACGT]|--)$'
    and (not(call ? 'usable') or jsonb_typeof(call->'usable')='boolean')
    and exists(select 1 from jsonb_array_elements(panel->'variants') row
     where call->'chrom'=row->'chrom' and call->'pos'=row->'pos')
    and (call->>'genotype'='--' or not exists(select 1 from unnest(string_to_array(call->>'genotype','/')) letter
     where letter<>call->>'ref' and letter is distinct from call->>'alt'))) is not true then
   return '{"ok":false,"reason":"invalid_calls"}'::jsonb;end if;
 end loop;
 for variant in select value from jsonb_array_elements(panel->'variants') loop
  select coalesce(jsonb_agg(value),'[]'::jsonb) into own from jsonb_array_elements(p_calls)
   where value->'chrom'=variant->'chrom' and value->'pos'=variant->'pos';
  readings:='{}';
  if jsonb_array_length(own)=0 or exists(select 1 from jsonb_array_elements(own) row
   where row->>'genotype'='--' or row->'usable'='false'::jsonb) then state:='not_covered';
  elsif exists(select 1 from jsonb_array_elements(own) row where row->>'ref' not in(variant->>'effectAllele',variant->>'otherAllele')
   or (row->'alt'<>'null'::jsonb and row->>'alt' not in(variant->>'effectAllele',variant->>'otherAllele'))
   or exists(select 1 from unnest(string_to_array(row->>'genotype','/')) letter
    where letter not in(variant->>'effectAllele',variant->>'otherAllele'))) then state:='invalid_call';
  else
   for call in select value from jsonb_array_elements(own) loop
    select count(*) into dose from unnest(string_to_array(call->>'genotype','/')) letter where letter=variant->>'effectAllele';
    readings:=array_append(readings,dose);
   end loop;
   if (select count(distinct value) from unnest(readings) value)=1 then state:='matched';matched:=matched+1;
   else state:='source_call_disputed';end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('variantId',variant->'id','state',state));
 end loop;
 coverage:=matched::double precision/10;
 measurement:=jsonb_build_object('version',1,'producer','embryo-test-score-coverage-v1','panelId',panel->'panelId',
  'source',p_source,'matchedVariants',matched,'requiredVariants',10,'scoreCoverage',coverage,'rows',rows);
 if coverage<(private.embryo_carrier_qc_policy_v1()->>'scoreCoverageFloor')::double precision then
  finding:=jsonb_build_object('schema_version',2,'figure_basis','{"version":1,"basis":"observed"}'::jsonb,
   'kind','coverage_failure','metric','score_coverage','measured_value',coverage,
   'required_minimum',(private.embryo_carrier_qc_policy_v1()->>'scoreCoverageFloor')::double precision,
   'display_copy_id','embryo.result.insufficient-coverage');end if;
 return jsonb_build_object('ok',true,'measurement',measurement,'finding',finding);
end $measure$;
revoke all on function private.measure_embryo_test_statistical_v1(jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

-- Authority/source predicates below retain the original complete carrier capture,
-- replacing only the clinical reference block with disposable admission.
create function private.capture_embryo_test_statistical_v1(p_cohort uuid,p_test boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
set extra_float_digits=3 as $capture$
declare c public.embryo_cohorts; e public.embryos; s public.subjects;
 x private.embryo_canonical_sources; f public.genome_files; q public.embryo_qc;
 v_admission jsonb:=private.current_embryo_test_statistical_admission_v1();
 v_conditions jsonb:='[]'; v_embryos jsonb:='[]'; v_source jsonb;
 v_basis text; v_principal uuid; v_principals uuid[]; v_grants jsonb:='[]';
 v_grant public.purpose_grants; v_direction public.directional_grants;
 v_signature public.consent_signatures; v_profile public.profiles;
 v_count integer:=0; v_assertion_count integer:=0; v_lease_deadline timestamptz;
begin
 if p_test is distinct from true or not exists(select 1 from private.embryo_split_config where enabled) then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
 -- Empty admission precedes every cohort, source and genomic lookup.
 if v_admission is null then return null;end if;
 perform private.lock_invitation_transitions_v1();
 perform 1 from public.subjects where cohort_id=p_cohort order by id for update;
 select * into c from public.embryo_cohorts where id=p_cohort for share;
 if c.id is null or c.status<>'active' or c.publication_revision is null or c.retention_expires_at<=clock_timestamp()
  or c.uploaded_at is null or c.owner_account_id is null then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
 v_basis:=private.embryo_ingest_authority_fingerprint_v1(c.id);
 v_principals:=private.embryo_cohort_set_v1(c.id,'required_upload_principals');
 if cardinality(v_principals)=0 then raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
 v_lease_deadline:=c.retention_expires_at;
 foreach v_principal in array v_principals loop
  select pr.* into v_profile from public.subject_principals pp join public.profiles pr on pr.id=pp.account_id
   join auth.users u on u.id=pr.id where pp.id=v_principal and pp.status='active'
    and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
    and pr.deletion_requested_at is null for share of pp,pr,u;
  if v_profile.id is null or v_profile.jurisdiction_code is null or v_profile.jurisdiction_code='XX'
   or v_profile.jurisdiction_declared_at is null or not exists(select 1 from public.consent_artifacts ca
     where ca.artifact_key='attestation.jurisdiction' and ca.superseded_at is null
      and ca.version=v_profile.jurisdiction_attestation_version
      and ca.body_sha256=v_profile.jurisdiction_attestation_sha256) then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
  perform 1 from public.purpose_grants where target_kind='cohort' and target_id=c.id
   and purpose='embryo.analysis' and signer_principal_id=v_principal order by grant_id for share;
  select * into v_grant from public.purpose_grants where target_kind='cohort' and target_id=c.id
   and purpose='embryo.analysis' and signer_principal_id=v_principal and revoked_at is null
   and (expires_at is null or expires_at>clock_timestamp()) order by grant_id;
  if v_grant.grant_id is null or (select count(*) from public.purpose_grants where target_kind='cohort'
   and target_id=c.id and purpose='embryo.analysis' and signer_principal_id=v_principal
   and revoked_at is null and (expires_at is null or expires_at>clock_timestamp()))<>1 then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
  select * into v_direction from public.directional_grants where grant_id=v_grant.grant_id for share;
  select * into v_signature from public.consent_signatures where id=v_grant.signature_id for share;
  if v_direction.status is distinct from 'current' or v_direction.direction is distinct from 'self'
   or v_direction.grant_revision is distinct from v_grant.grant_revision
   or v_direction.recipient_principal_id is distinct from v_principal
   or v_direction.recipient_account_id is distinct from v_profile.id
   or v_grant.data_subject_principal_id is distinct from v_principal
   or v_grant.subject_binding_revision is distinct from c.participant_set_revision
   or v_grant.jurisdiction_code is distinct from v_profile.jurisdiction_code
   or v_grant.jurisdiction_revision is distinct from v_profile.jurisdiction_revision
   or v_grant.artifact_key is distinct from 'consent.upload-embryo'
   or v_signature.signer_principal_id is distinct from v_principal
   or v_signature.signer_account_id is distinct from v_profile.id
   or v_signature.target_kind is distinct from 'cohort' or v_signature.target_id is distinct from c.id
   or v_signature.purpose is distinct from 'embryo.analysis'
   or v_signature.subject_binding_revision is distinct from c.participant_set_revision
   or v_signature.jurisdiction_code is distinct from v_grant.jurisdiction_code
   or v_signature.jurisdiction_revision is distinct from v_grant.jurisdiction_revision
   or v_signature.statement_keys is distinct from private.embryo_statement_keys_v1('consent.upload-embryo','grant')
   or (v_signature.artifact_key,v_signature.artifact_version,v_signature.artifact_body_sha256)
      is distinct from (v_grant.artifact_key,v_grant.artifact_version,v_grant.artifact_body_sha256)
   or not exists(select 1 from public.consent_artifacts ca where ca.artifact_key=v_grant.artifact_key
     and ca.version=v_grant.artifact_version and ca.body_sha256=v_grant.artifact_body_sha256
     and ca.superseded_at is null and ca.published_at<=clock_timestamp()) then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
  v_grants:=v_grants||jsonb_build_array(jsonb_build_object('grant',to_jsonb(v_grant),
   'direction',to_jsonb(v_direction),'signature',to_jsonb(v_signature),
   'principal',v_principal,'accountRevision',v_profile.account_revision,
   'jurisdictionRevision',v_profile.jurisdiction_revision));
  v_lease_deadline:=least(v_lease_deadline,v_grant.expires_at);
 end loop;
 v_conditions:=jsonb_build_array(jsonb_build_object('condition_id','SYNTHETIC:9001',
  'condition_name','Synthetic score coverage',
  'reference_receipt',v_admission));
 for e in select * from public.embryos where cohort_id=c.id order by sample_ordinal for share loop
  select * into s from public.subjects where id=e.subject_id;
  select * into q from public.embryo_qc where embryo_id=e.id for share;
  if e.sample_ordinal<>v_count or s.cohort_id is distinct from c.id or s.subject_class is distinct from 'embryo'
   or s.lifecycle is distinct from 'active' or s.analysis_stopped_at is not null
   or s.claimant_principal_id is not null or s.owner_account_id is distinct from c.owner_account_id
   or e.retention_expires_at<=clock_timestamp() or q.embryo_id is null
   or q.figure_basis is null or q.imputation_performed or q.imputation_panel is not null then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
  v_source:=null;
  select * into x from private.embryo_canonical_sources where embryo_id=e.id for share;
  if e.status='qc_fail' then
   if e.status is distinct from 'qc_fail' or x.file_id is not null
    or exists(select 1 from public.genome_files where subject_id=s.id)
    or exists(select 1 from public.embryo_variants where embryo_id=e.id) then
    raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
  else
   select * into f from public.genome_files where id=x.file_id for share;
   if e.status not in('qc_pass','qc_marginal','stored') or x.file_id is null
    or x.subject_id is distinct from s.id or x.cohort_id is distinct from c.id
    or x.publication_revision is distinct from c.publication_revision
    or x.reference_build is distinct from 'GRCh38' or x.call_immutability_proof is distinct from 'exact-staged-calls-v1'
    or x.source_sha256 is distinct from private.embryo_canonical_source_sha256_v1(x.file_id)
    or x.membership_sha256 is distinct from private.embryo_canonical_membership_sha256_v1(
      array(select part_id from private.embryo_canonical_source_parts where file_id=x.file_id order by sequence))
    or f.subject_id is distinct from s.id or f.cohort_id is not null or f.is_cohort_file
    or f.source_publication_state is distinct from 'published' or f.source_publication_revision is distinct from x.publication_revision
    or f.source_sha256 is distinct from x.source_sha256 or f.canonical_build is distinct from 'GRCh38'
    or f.normalization_completed_at is null
    or f.normalization_source_revision is distinct from f.upload_revision
    or (select count(*) from public.genome_files where subject_id=s.id)<>1
    or (select count(*) from public.embryo_variants where embryo_id=e.id and source_file_id=x.file_id
      and source_binding_fingerprint=x.source_sha256)<>x.variant_count then
    raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
   v_source:=jsonb_build_object('cohort_id',c.id,'embryo_id',e.id,'subject_id',s.id,'file_id',f.id,
    'canonical_build','GRCh38','source_sha256',x.source_sha256,'source_binding_fingerprint',x.source_sha256,
    'source_publication_revision',x.publication_revision,'upload_revision',f.upload_revision,
    'normalization_source_revision',f.normalization_source_revision,'call_immutability_proof',x.call_immutability_proof);
  end if;
  v_embryos:=v_embryos||jsonb_build_array(jsonb_build_object('embryoId',e.id,'sampleOrdinal',e.sample_ordinal,
   'source',v_source,'qc',to_jsonb(q)-'id'));
  v_count:=v_count+1;
  v_lease_deadline:=least(v_lease_deadline,e.retention_expires_at);
 end loop;
 if v_count<>c.embryo_count or (select count(*) from public.subjects where cohort_id=c.id)<>c.embryo_count then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable'; end if;
 return jsonb_build_object('version','embryo-test-statistical-capture-v1','cohortId',c.id,
  'publicationRevision',c.publication_revision,'panel',private.embryo_test_statistical_panel_v1(),'conditions',v_conditions,'embryos',v_embryos,
  'authority',jsonb_build_object('basisFingerprint',v_basis,'cohort',to_jsonb(c),'grants',v_grants,
   'donorClassification','neutral-no-donor-input-or-output','testPolicy','TEST-LOCAL',
   'capabilities',jsonb_build_array('embryo_analysis','synthetic_statistical_coverage_only'),
   'jurisdictionsSha256','a73eb6033dc7a375d7e0c1dc5a22c64e02332682a66a9bf9a83b178c252562f6','expiresAt',v_lease_deadline));
end $capture$;
revoke all on function private.capture_embryo_test_statistical_v1(uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;

create function public.enqueue_embryo_test_statistical_v1(p_cohort_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $enqueue$
declare a jsonb; j public.worker_jobs; v_hash text;
begin
 a:=private.capture_embryo_test_statistical_v1(p_cohort_id,p_test_jurisdiction);
 if a is null then return '{"status":"held","reason":"synthetic_reference_unavailable"}'::jsonb; end if;
 v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
 j:=private.enqueue_worker_job_v2((a#>>'{authority,cohort,owner_account_id}')::uuid,
  'score_embryo','embryo.statistical-estimate',null,p_cohort_id,'cohort-source-set',p_cohort_id,
  (a->>'publicationRevision')::bigint,v_hash,'embryo-test-score-coverage-v1',null,
  jsonb_build_object('capture',a));
 if j.payload is distinct from jsonb_build_object('capture',a) then
  raise exception using errcode='23505',message='embryo_test_statistical_binding_collision'; end if;
 return jsonb_build_object('status','queued','jobId',j.id);
end $enqueue$;
revoke all on function public.enqueue_embryo_test_statistical_v1(uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.enqueue_embryo_test_statistical_v1(uuid,boolean) to service_role;

create function private.expected_embryo_test_statistical_measurement_v1(p_embryo jsonb,p_condition jsonb)
returns jsonb language plpgsql security definer set search_path='' as $expected$
declare qc jsonb:=p_embryo->'qc'; policy jsonb:=private.embryo_carrier_qc_policy_v1();
 result jsonb; measurement jsonb; finding jsonb; reason text;
begin
 if p_condition->>'condition_id' is distinct from 'SYNTHETIC:9001'
  or p_condition#>'{reference_receipt,panel}' is distinct from private.embryo_test_statistical_panel_v1() then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 if p_embryo->'source'='null'::jsonb
  or (qc->>'call_rate')::double precision<(policy->>'callRateNoFigure')::double precision
  or (qc->>'parent_a_concordance')::double precision<(policy->>'concordanceFail')::double precision
  or (qc->>'parent_b_concordance')::double precision<(policy->>'concordanceFail')::double precision
  or (qc->>'contamination_estimate')::double precision>(policy->>'contaminationCeiling')::double precision
  or (qc->>'allelic_dropout_estimate')::double precision>(policy->>'dropoutCeiling')::double precision then
  if (qc->>'call_rate')::double precision<(policy->>'callRateNoFigure')::double precision then reason:='embryo_call_rate';
  elsif (qc->>'parent_a_concordance')::double precision<(policy->>'concordanceMarginal')::double precision
   or (qc->>'parent_b_concordance')::double precision<(policy->>'concordanceMarginal')::double precision then reason:='embryo_parent_discordant';
  elsif (qc->>'contamination_estimate')::double precision>(policy->>'contaminationCeiling')::double precision then reason:='contamination';
  elsif (qc->>'allelic_dropout_estimate')::double precision>(policy->>'dropoutCeiling')::double precision then reason:='dropout_too_high';
  else reason:='qc_review_required';end if;
 else
  result:=private.measure_embryo_test_statistical_v1(p_embryo->'source',private.embryo_test_statistical_calls_v1(p_embryo));
  if result->'ok' is distinct from 'true'::jsonb then reason:='qc_review_required';
  else
   measurement:=result->'measurement';finding:=nullif(result->'finding','null'::jsonb);
   if finding is not null then reason:='insufficient_coverage';else reason:='sex_combined_model_unavailable';end if;
  end if;
 end if;
 return jsonb_build_object('embryoId',p_embryo->'embryoId','conditionId','SYNTHETIC:9001',
  'measurement',measurement,'finding',finding,'reason',reason);
end $expected$;
revoke all on function private.expected_embryo_test_statistical_measurement_v1(jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.embryo_test_statistical_coverage_v1(p_measurement jsonb) returns text
language sql immutable set search_path='' as $coverage$
 select case when p_measurement->>'reason' in('embryo_call_rate','embryo_parent_discordant','contamination',
  'dropout_too_high','qc_review_required') then 'quality_not_measurable' else 'not_covered' end;
$coverage$;
revoke all on function private.embryo_test_statistical_coverage_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.embryo_test_statistical_receipt_v1(p_job public.worker_jobs,p_embryo jsonb,
 p_condition jsonb,p_measurement jsonb) returns jsonb language sql immutable set search_path='' as $saved_receipt$
 select jsonb_build_object('version',1,'producer','embryo-test-score-coverage-v1',
  'job_id',(p_job).id,'attempt',(p_job).attempts,'capture_sha256',(p_job).file_sha256,
  'condition_id','SYNTHETIC:9001','source',p_embryo->'source','reference_receipt',p_condition->'reference_receipt',
  'measurement',p_measurement,'publication','coverage-only','interpretation','held');
$saved_receipt$;
revoke all on function private.embryo_test_statistical_receipt_v1(public.worker_jobs,jsonb,jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.valid_embryo_test_statistical_receipt_v1(p_receipt jsonb) returns boolean
language sql immutable set search_path='' as $receipt$
 select coalesce(jsonb_typeof(p_receipt)='object'
  and (select array_agg(k order by k) from jsonb_object_keys(p_receipt) k)=
   array['attempt','capture_sha256','condition_id','interpretation','job_id','measurement','producer','publication','reference_receipt','source','version']
  and p_receipt->'version'='1'::jsonb and p_receipt->>'producer'='embryo-test-score-coverage-v1'
  and p_receipt->>'condition_id'='SYNTHETIC:9001' and p_receipt->>'publication'='coverage-only'
  and p_receipt->>'interpretation'='held' and p_receipt->>'capture_sha256'~'^[0-9a-f]{64}$'
  and p_receipt->>'job_id'~'^[0-9a-f-]{36}$' and p_receipt->>'attempt'~'^([1-9]|1[0-9]|20)$'
  and jsonb_typeof(p_receipt->'source') in('object','null')
  and jsonb_typeof(p_receipt->'reference_receipt')='object'
  and jsonb_typeof(p_receipt->'measurement')='object',false);
$receipt$;
revoke all on function private.valid_embryo_test_statistical_receipt_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.valid_embryo_test_statistical_receipt_v1(jsonb) to service_role;

create function private.guard_embryo_test_statistical_score_v1(p_score public.embryo_scores) returns void
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $score_guard$
declare j public.worker_jobs; a jsonb; e jsonb; c jsonb; expected jsonb;
begin
 if not private.valid_embryo_test_statistical_receipt_v1(p_score.computation_receipt) then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 select * into j from public.worker_jobs where id=(p_score.computation_receipt->>'job_id')::uuid;
 if j.id is null or j.kind<>'score_embryo' or j.output_kind<>'embryo.statistical-estimate'
  or j.computation_revision<>'embryo-test-score-coverage-v1' or j.status<>'running'
  or j.claim_expires_at<=clock_timestamp() or j.attempts<>(p_score.computation_receipt->>'attempt')::integer then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 a:=private.capture_embryo_test_statistical_v1(j.cohort_id,true);
 if a is null or j.payload is distinct from jsonb_build_object('capture',a)
  or j.file_sha256 is distinct from encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex')
  or j.file_sha256 is distinct from p_score.computation_receipt->>'capture_sha256'
  or j.source_binding_kind is distinct from 'cohort-source-set' or j.source_binding_id is distinct from j.cohort_id
  or j.source_binding_revision is distinct from (a->>'publicationRevision')::bigint
  or j.user_id is distinct from (a#>>'{authority,cohort,owner_account_id}')::uuid
  or j.subject_id is not null or j.file_id is not null then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 select value into e from jsonb_array_elements(a->'embryos') where (value->>'embryoId')::uuid=p_score.embryo_id;
 select value into c from jsonb_array_elements(a->'conditions') where value->>'condition_id'=p_score.condition_id;
 if e is null or c is null then raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 expected:=private.expected_embryo_test_statistical_measurement_v1(e,c);
 if p_score.computation_receipt is distinct from private.embryo_test_statistical_receipt_v1(j,e,c,expected)
  or p_score.finding is distinct from nullif(expected->'finding','null'::jsonb)
  or p_score.condition_name is distinct from 'Synthetic score coverage'
  or p_score.not_covered_reason is distinct from expected->>'reason'
  or p_score.coverage_state is distinct from private.embryo_test_statistical_coverage_v1(expected)
  or p_score.source_binding_fingerprint is distinct from j.file_sha256
  or p_score.model_id is not null or p_score.model_version is not null
  or p_score.evidence_label is distinct from 'preliminary' or p_score.citation_ids is distinct from '{}'::text[] then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
end $score_guard$;
revoke all on function private.guard_embryo_test_statistical_score_v1(public.embryo_scores) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.freeze_embryo_test_statistical_job_v1() returns trigger
language plpgsql set search_path='' as $freeze_job$
begin
 if old.computation_revision='embryo-test-score-coverage-v1'
  and row(new.payload,new.user_id,new.file_id) is distinct from row(old.payload,old.user_id,old.file_id) then
  raise exception using errcode='23514',message='embryo_test_statistical_capture_immutable';end if;
 return new;
end $freeze_job$;
revoke all on function private.freeze_embryo_test_statistical_job_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger embryo_test_statistical_capture_immutable before update on public.worker_jobs
 for each row execute function private.freeze_embryo_test_statistical_job_v1();

-- Keep the complete original carrier guard and immutability branch.
create or replace function private.guard_embryo_carrier_score_v1() returns trigger
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $score_guard$
declare j public.worker_jobs; a jsonb; e jsonb; c jsonb; expected jsonb; v_receipt jsonb;
begin
 if tg_op='UPDATE' then
  if old.computation_receipt is not null and to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception using errcode='55000',message='embryo_carrier_score_immutable';end if;
  if new.computation_receipt is distinct from old.computation_receipt then
   raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
  return new;
 end if;
 if new.computation_receipt is null then return new;end if;
 if new.computation_receipt->>'producer'='embryo-test-score-coverage-v1' then
  perform private.guard_embryo_test_statistical_score_v1(new);return new;end if;
 if not private.valid_embryo_carrier_receipt_v1(new.computation_receipt) then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 select * into j from public.worker_jobs where id=(new.computation_receipt->>'job_id')::uuid;
 if j.id is null or j.kind<>'score_embryo' or j.output_kind<>'embryo.carrier-match'
  or j.computation_revision<>'embryo-reviewed-allele-observation-v1' or j.status<>'running'
  or j.claim_expires_at<=clock_timestamp() or j.attempts<>(new.computation_receipt->>'attempt')::integer then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 a:=private.capture_embryo_carrier_v1(j.cohort_id,true);
 if a is null or j.payload is distinct from jsonb_build_object('capture',a)
  or j.file_sha256 is distinct from encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex')
  or j.file_sha256 is distinct from new.computation_receipt->>'capture_sha256' then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 select value into e from jsonb_array_elements(a->'embryos') where (value->>'embryoId')::uuid=new.embryo_id;
 select value into c from jsonb_array_elements(a->'conditions') where value->>'condition_id'=new.condition_id;
 if e is null or c is null then raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 expected:=private.expected_embryo_carrier_measurement_v1(e,c);
 v_receipt:=private.embryo_carrier_receipt_v1(j,e,c,expected);
 if new.computation_receipt is distinct from v_receipt
  or new.finding is distinct from nullif(expected->'observation','null'::jsonb)
  or new.condition_name is distinct from c#>>'{condition_registry,0,condition_name}'
  or new.not_covered_reason is distinct from expected->>'reason'
  or new.coverage_state is distinct from private.embryo_carrier_coverage_v1(expected)
  or new.source_binding_fingerprint is distinct from j.file_sha256
  or new.model_id is not null or new.model_version is not null
  or new.evidence_label is distinct from 'preliminary' or new.citation_ids is distinct from '{}'::text[] then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 return new;
end $score_guard$;
revoke all on function private.guard_embryo_carrier_score_v1() from public,anon,authenticated,inherit_upload_only,service_role;
alter table public.embryo_scores drop constraint embryo_scores_carrier_receipt_closed;
alter table public.embryo_scores add constraint embryo_scores_carrier_receipt_closed
 check(computation_receipt is null or private.valid_embryo_carrier_receipt_v1(computation_receipt)
  or private.valid_embryo_test_statistical_receipt_v1(computation_receipt));

-- The complete current-capture, job, attempt, lease, save and cancellation
-- boundaries remain those of the original native producer.
create function public.embryo_test_statistical_worker_v1(p_operation text,p_job_id uuid,p_attempt integer,
 p_claim_token_hash text,p_payload jsonb,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
set extra_float_digits=3 as $worker$
declare j public.worker_jobs; a jsonb; v_hash text; e jsonb; c jsonb; m jsonb; expected jsonb;
 v_deadline timestamptz; v_revision bigint; v_saved integer:=0; v_measurements jsonb:='[]';
 v_after uuid; v_next uuid; v_cohort uuid; v_checked integer:=0; v_queued integer:=0;
 v_assertion jsonb; v_pages jsonb:='[]'; v_assertion_id jsonb;
begin
 if p_test_jurisdiction is distinct from true or p_claim_token_hash is null
  or p_claim_token_hash!~'^[0-9a-f]{64}$' or p_operation is null
  or p_operation not in('reconcile','claim','check','read','save','fail')
  or not exists(select 1 from private.embryo_split_config where enabled) then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 if private.current_embryo_test_statistical_admission_v1() is null then
  return '{"status":"held","reason":"synthetic_reference_unavailable"}'::jsonb;end if;
 if p_operation='reconcile' then
  if p_job_id is not null or p_attempt is not null or jsonb_typeof(p_payload) is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(p_payload) k) is distinct from array['afterCohortId']
   or (p_payload->'afterCohortId'<>'null'::jsonb and (jsonb_typeof(p_payload->'afterCohortId')<>'string'
    or p_payload->>'afterCohortId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
   raise exception using errcode='22023',message='invalid_request';end if;
  -- Recover a lost postcommit enqueue from durable current source/consent
  -- records. Empty admission never enumerates cohorts. Every candidate goes
  -- through the same current full capture and idempotent enqueue; the cursor
  -- selects only a bounded inventory page, never authority or source bytes.
  if private.current_embryo_test_statistical_admission_v1() is null then
   return '{"status":"held","reason":"synthetic_reference_unavailable"}'::jsonb;end if;
  v_after:=(p_payload->>'afterCohortId')::uuid;
  for v_cohort in select id from public.embryo_cohorts where status='active'
   and publication_revision is not null and owner_account_id is not null and uploaded_at is not null
   and retention_expires_at>clock_timestamp() and (v_after is null or id>v_after) order by id limit 4 loop
   v_checked:=v_checked+1;v_next:=v_cohort;
   begin
    a:=public.enqueue_embryo_test_statistical_v1(v_cohort,true);
    if a->>'status'='queued' then v_queued:=v_queued+1;end if;
   exception when insufficient_privilege then
    -- Missing/revoked current authority admits no job; a later complete pass
    -- resolves current state again. Other failures abort the bounded page.
    null;
   end;
  end loop;
  return jsonb_build_object('version','embryo-test-statistical-reconcile-v1','checked',v_checked,'queued',v_queued,
   'nextCursor',case when v_checked=4 then v_next else null end);
 end if;
 if p_operation='claim' then
  if p_job_id is not null or p_attempt is not null or p_payload is not null then
   raise exception using errcode='22023',message='invalid_request';end if;
  select * into j from public.worker_jobs where kind='score_embryo' and output_kind='embryo.statistical-estimate'
   and computation_revision='embryo-test-score-coverage-v1'
   and (status='queued' or (status='running' and claim_expires_at<=clock_timestamp()))
   and not_before<=clock_timestamp() order by created_at,id limit 1;
  if j.id is null then return null;end if;
 else
  select * into j from public.worker_jobs where id=p_job_id;
  if j.id is null or j.status<>'running' or j.kind<>'score_embryo' or j.output_kind<>'embryo.statistical-estimate'
   or j.computation_revision<>'embryo-test-score-coverage-v1'
   or j.attempts is distinct from p_attempt or j.claim_token_hash is distinct from p_claim_token_hash
   or j.claim_expires_at<=clock_timestamp() then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 end if;
 begin
  a:=private.capture_embryo_test_statistical_v1(j.cohort_id,true);
 exception when insufficient_privilege then a:=null;
 end;
 -- The capture acquired all subject/authority locks before this job lock.
 select * into j from public.worker_jobs where id=j.id for update skip locked;
 if j.id is null then return null;end if;
 v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
 if a is null or j.payload is distinct from jsonb_build_object('capture',a)
  or j.file_sha256 is distinct from v_hash or j.source_binding_kind is distinct from 'cohort-source-set'
  or j.source_binding_id is distinct from j.cohort_id or j.source_binding_revision is distinct from (a->>'publicationRevision')::bigint
  or j.subject_id is not null or j.file_id is not null or j.user_id is distinct from (a#>>'{authority,cohort,owner_account_id}')::uuid then
  update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where id=j.id and status in('queued','running');
  return '{"status":"cancelled"}'::jsonb;
 end if;
 v_deadline:=least((a#>>'{authority,expiresAt}')::timestamptz,j.created_at+interval '24 hours');
 if v_deadline<=clock_timestamp() then
  update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where id=j.id;
  return '{"status":"cancelled"}'::jsonb;end if;
 if p_operation='claim' then
  if j.status<>'queued' and not(j.status='running' and j.claim_expires_at<=clock_timestamp()) then return null;end if;
  if j.attempts>=j.max_attempts then
   update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
    claim_expires_at=null,claimed_by=null where id=j.id;
   return '{"status":"cancelled"}'::jsonb;end if;
  update public.worker_jobs set status='running',attempts=attempts+1,claim_token_hash=p_claim_token_hash,
   claim_expires_at=least(clock_timestamp()+interval '5 minutes',v_deadline),claimed_by='embryo-test-statistical-worker',
   started_at=coalesce(started_at,clock_timestamp()),progress_note='scoring'
   where id=j.id returning * into j;
 else
  if j.status<>'running' or j.attempts is distinct from p_attempt
   or j.claim_token_hash is distinct from p_claim_token_hash or j.claim_expires_at<=clock_timestamp() then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 end if;
 if p_operation in('claim','check') then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request';end if;
  if p_operation='check' then
   update public.worker_jobs set claim_expires_at=least(clock_timestamp()+interval '5 minutes',v_deadline)
    where id=j.id returning * into j;
   -- Full current capture/payload equality was proved above. Avoid repeating
   -- the entire reviewed library in every bounded source checkpoint response.
   return jsonb_build_object('version','embryo-test-statistical-check-v2','jobId',j.id,'attempt',j.attempts,
    'claimExpiresAt',j.claim_expires_at,'deadline',v_deadline,'captureSha256',v_hash);
  end if;
  return jsonb_build_object('version','embryo-test-statistical-claim-v1',
   'jobId',j.id,'attempt',j.attempts,'claimExpiresAt',j.claim_expires_at,'deadline',v_deadline,
   'captureSha256',v_hash,'capture',a);
 elsif p_operation in('read') then
  if jsonb_typeof(p_payload) is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(p_payload) k) is distinct from
    array['conditionId','embryoId'] then
   raise exception using errcode='22023',message='invalid_request';end if;
  select value into e from jsonb_array_elements(a->'embryos') where value->>'embryoId'=p_payload->>'embryoId';
  select value into c from jsonb_array_elements(a->'conditions') where value->>'condition_id'=p_payload->>'conditionId';
  if e is null or c is null or e->'source'='null'::jsonb then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
  return jsonb_build_object('version','embryo-test-statistical-calls-v1','jobId',j.id,'attempt',j.attempts,
   'captureSha256',v_hash,'embryoId',e->'embryoId','conditionId',c->'condition_id',
   'calls',private.embryo_test_statistical_calls_v1(e));
 elsif p_operation='fail' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request';end if;
  update public.worker_jobs set status='failed',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where id=j.id;
  return '{"status":"failed"}'::jsonb;
 else
  if jsonb_typeof(p_payload) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_payload) k)
    is distinct from array['measurements'] or jsonb_typeof(p_payload->'measurements') is distinct from 'array'
    or jsonb_array_length(p_payload->'measurements')<>jsonb_array_length(a->'embryos')*jsonb_array_length(a->'conditions') then
   raise exception using errcode='22023',message='invalid_request';end if;
  for e in select value from jsonb_array_elements(a->'embryos') loop
   for c in select value from jsonb_array_elements(a->'conditions') loop
    expected:=private.expected_embryo_test_statistical_measurement_v1(e,c);
    v_measurements:=v_measurements||jsonb_build_array(expected);
   end loop;
  end loop;
  if p_payload->'measurements' is distinct from v_measurements then
   raise exception using errcode='42501',message='embryo_test_statistical_measurement_mismatch';end if;
  select coalesce(max(sc.computation_revision),0)+1 into v_revision from public.embryo_scores sc
   join public.embryos embryo on embryo.id=sc.embryo_id where embryo.cohort_id=j.cohort_id;
  for e in select value from jsonb_array_elements(a->'embryos') loop
   for c in select value from jsonb_array_elements(a->'conditions') loop
    expected:=v_measurements->v_saved;
    insert into public.embryo_scores(embryo_id,condition_id,condition_name,finding,evidence_label,
     coverage_state,citation_ids,not_covered_reason,source_binding_fingerprint,computation_revision,computation_receipt)
    values((e->>'embryoId')::uuid,c->>'condition_id','Synthetic score coverage',
     nullif(expected->'finding','null'::jsonb),'preliminary',
     private.embryo_test_statistical_coverage_v1(expected),
     '{}',expected->>'reason',v_hash,v_revision,
     private.embryo_test_statistical_receipt_v1(j,e,c,expected));
    v_saved:=v_saved+1;
   end loop;
  end loop;
  update public.worker_jobs set status='done',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null,progress=100,progress_note='complete',
   partial=exists(select 1 from jsonb_array_elements(v_measurements) row where private.embryo_test_statistical_coverage_v1(row)<>'covered')
   where id=j.id;
  return jsonb_build_object('status','saved_held','jobId',j.id,'attempt',j.attempts,
   'captureSha256',v_hash,'saved',v_saved,'publication','coverage-only');
 end if;
end $worker$;
revoke all on function public.embryo_test_statistical_worker_v1(text,uuid,integer,text,jsonb,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.embryo_test_statistical_worker_v1(text,uuid,integer,text,jsonb,boolean) to service_role;


-- Current live account/session/Tier-2 and complete current publication read.
create function public.current_embryo_test_statistical_v1(p_account uuid,p_session uuid,p_cohort uuid,p_test boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
set extra_float_digits=3 as $current_hold$
declare a jsonb; j public.worker_jobs; score public.embryo_scores; e jsonb; c jsonb;
 v_hash text; expected jsonb; v_count integer:=0; v_rows jsonb:='[]';
begin
 if p_test is distinct from true then raise exception using errcode='42501',message='not_found';end if;
 if private.current_embryo_test_statistical_admission_v1() is null then return null;end if;
 perform private.lock_invitation_transitions_v1();
 perform 1 from public.subjects where cohort_id=p_cohort order by id for update;
 perform private.validate_sensitive_account_session_read_v1(p_account,p_session);
 if private.cohort_copilot_authority_v1(p_account,p_cohort) is null then return null;end if;
 begin a:=private.capture_embryo_test_statistical_v1(p_cohort,true);
 exception when insufficient_privilege then return null;end;
 if a is null then return null;end if;
 v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
 select * into j from public.worker_jobs where cohort_id=p_cohort and status='done'
  and kind='score_embryo' and output_kind='embryo.statistical-estimate'
  and computation_revision='embryo-test-score-coverage-v1'
  and payload=jsonb_build_object('capture',a) and file_sha256=v_hash
  and source_binding_kind='cohort-source-set' and source_binding_id=p_cohort
  and source_binding_revision=(a->>'publicationRevision')::bigint
  and user_id=(a#>>'{authority,cohort,owner_account_id}')::uuid
  and subject_id is null and file_id is null and claim_token_hash is null and claim_expires_at is null
  and claimed_by is null order by finished_at desc,id limit 1 for share;
 if j.id is null then return null;end if;
 for e in select value from jsonb_array_elements(a->'embryos') loop
  for c in select value from jsonb_array_elements(a->'conditions') loop
   select * into score from public.embryo_scores where embryo_id=(e->>'embryoId')::uuid
    and condition_id=c->>'condition_id' and computation_receipt->>'job_id'=j.id::text
    and source_binding_fingerprint=v_hash order by computation_revision desc limit 1 for share;
   if score.id is null or not private.valid_embryo_test_statistical_receipt_v1(score.computation_receipt)
    or score.computation_receipt->>'capture_sha256' is distinct from v_hash
    or (score.computation_receipt->>'attempt')::integer is distinct from j.attempts
    or score.computation_receipt->'source' is distinct from e->'source'
    or score.computation_receipt->'reference_receipt' is distinct from c->'reference_receipt' then return null;end if;
   expected:=private.expected_embryo_test_statistical_measurement_v1(e,c);
   if score.finding is distinct from nullif(expected->'finding','null'::jsonb)
    or score.not_covered_reason is distinct from expected->>'reason'
    or score.coverage_state is distinct from private.embryo_test_statistical_coverage_v1(expected)
    or score.computation_receipt is distinct from private.embryo_test_statistical_receipt_v1(j,e,c,expected) then return null;end if;
   if score.condition_name is distinct from 'Synthetic score coverage'
    or score.model_id is not null or score.model_version is not null
    or score.evidence_label is distinct from 'preliminary' or score.citation_ids is distinct from '{}'::text[] then return null;end if;
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('embryoId',e->'embryoId','sampleOrdinal',e->'sampleOrdinal',
    'conditionId','SYNTHETIC:9001','conditionName','Synthetic score coverage','coverageState',score.coverage_state,
    'reason',score.not_covered_reason,'matchedVariants',expected#>'{measurement,matchedVariants}',
    'requiredVariants',expected#>'{measurement,requiredVariants}','scoreCoverage',expected#>'{measurement,scoreCoverage}',
    'finding',score.finding));
   v_count:=v_count+1;
  end loop;
 end loop;
 if (select count(*) from public.embryo_scores where computation_receipt->>'job_id'=j.id::text)<>v_count then return null;end if;
 return jsonb_build_object('version',1,'producer','embryo-test-score-coverage-v1','jurisdiction','TEST-LOCAL',
  'cohortId',p_cohort,'publicationRevision',a->'publicationRevision','jobId',j.id,'attempt',j.attempts,
  'captureSha256',v_hash,'interpretation','held','rows',v_rows);
end $current_hold$;
revoke all on function public.current_embryo_test_statistical_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.current_embryo_test_statistical_v1(uuid,uuid,uuid,boolean) to service_role;
