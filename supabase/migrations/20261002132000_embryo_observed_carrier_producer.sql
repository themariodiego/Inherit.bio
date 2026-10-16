-- A private OBSERVED carrier producer, under the existing score_embryo queue.
-- The compiled registry remains empty. No clinical DTO or public publication
-- is admitted: every saved receipt is held until the disclosure contract ships.
-- No historical result or source is inferred, classified, changed or backfilled.
-- The only replaced function must still be the literal reviewed claimant.
-- A changed source, owner, security attribute, argument default or grant refuses
-- before the new column or any successor can be installed.
do $predecessor$
declare p pg_proc;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.claim_worker_job_v2(text,text,integer)');
 if p.oid is null or md5(p.prosrc) is distinct from 'a23d7320907f9f80433ee60d6d43c692'
  or p.proowner is distinct from 'postgres'::regrole or p.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.provolatile<>'v' or p.proparallel<>'u' or p.proisstrict or not p.prosecdef or p.proleakproof
  or p.prorettype is distinct from 'public.worker_jobs'::regtype or p.proretset or p.pronargs<>3 or p.pronargdefaults<>1
  or p.proargnames is distinct from array['p_worker_id','p_claim_token_hash','p_lease_seconds']
  or pg_get_expr(p.proargdefaults,0) is distinct from '60'
  or p.proconfig is distinct from array['search_path=""']
  or (select array_agg(pg_get_userbyid(a.grantee)::text order by pg_get_userbyid(a.grantee))
    from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.privilege_type='EXECUTE' and not a.is_grantable and a.grantor='postgres'::regrole)
      is distinct from array['postgres','service_role']
  or (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))<>2 then
  raise exception using errcode='55000',message='embryo_carrier_predecessor_changed';end if;
end $predecessor$;

alter table public.embryo_scores add column computation_receipt jsonb;

-- This body is generated from the exact committed allow-list, not request data.
-- A future reviewed registry change must replace this source in a migration.
create function private.embryo_carrier_registry_v1() returns jsonb
language sql immutable set search_path='' as $registry$
 select $compiled_registry${
  "schema_version": 1,
  "status": "withheld_until_calibrated_models_are_registered",
  "model_constraints": {
    "sex": "combined",
    "age_band": "lifetime",
    "prevalence_basis": "lifetime_risk",
    "birth_cohort": "required_nonempty",
    "calibration_cohort": "required_nonempty",
    "calibration_n": "positive_integer",
    "baseline_interval": "required_strict_low_point_high",
    "within_family_status": [
      "measured",
      "measured_inconclusive",
      "not_measured"
    ],
    "within_family_measurement": "when_measured_or_measured_inconclusive_require_published_sibling_validation_citation_family_count_point_estimate_and_strict_95_percent_interval",
    "within_family_default": "not_measured_rows_are_disabled_by_default_and_return_no_numeric_finding"
  },
  "allowed_categories": [
    "Heart and circulation",
    "Food, drink and metabolism",
    "Immune system and allergies",
    "Cancer",
    "Having children"
  ],
  "forbidden_phenotype_classes": [
    "cognitive",
    "educational",
    "personality",
    "behavioural",
    "mental_health",
    "height",
    "weight",
    "bmi",
    "appearance",
    "athleticism",
    "longevity",
    "lifespan",
    "biological_age",
    "sex",
    "gender",
    "sexual_orientation",
    "non_disease_trait",
    "composite"
  ],
  "conditions": []
}
$compiled_registry$::jsonb;
$registry$;
revoke all on function private.embryo_carrier_registry_v1() from public,anon,authenticated,inherit_upload_only,service_role;

-- Resolve the complete current source and authority without reading a genotype.
-- Subjects precede cohort/authority/job locks, matching the existing stop fence.
create function private.capture_embryo_carrier_v1(p_cohort uuid,p_test boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
set extra_float_digits=3 as $capture$
declare c public.embryo_cohorts; e public.embryos; s public.subjects;
 x private.embryo_canonical_sources; f public.genome_files; q public.embryo_qc;
 v_registry jsonb:=private.embryo_carrier_registry_v1(); v_entry jsonb; v_condition public.condition_registry;
 v_carrier public.carrier_conditions; v_review public.carrier_condition_reviews;
 v_release public.clinical_assertion_releases; v_rules jsonb;
 v_conditions jsonb:='[]'; v_embryos jsonb:='[]'; v_source jsonb;
 v_basis text; v_principal uuid; v_principals uuid[]; v_grants jsonb:='[]';
 v_grant public.purpose_grants; v_direction public.directional_grants;
 v_signature public.consent_signatures; v_profile public.profiles;
 v_count integer:=0; v_assertion_count integer:=0; v_lease_deadline timestamptz;
begin
 if p_test is distinct from true or not exists(select 1 from private.embryo_split_config where enabled) then
  raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
 -- Empty admission precedes every cohort, source and genomic lookup.
 if jsonb_array_length(v_registry->'conditions')=0 then return null; end if;
 if jsonb_array_length(v_registry->'conditions')>50 then
  raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
 perform private.lock_invitation_transitions_v1();
 perform 1 from public.subjects where cohort_id=p_cohort order by id for update;
 select * into c from public.embryo_cohorts where id=p_cohort for share;
 if c.id is null or c.status<>'active' or c.publication_revision is null or c.retention_expires_at<=clock_timestamp()
  or c.uploaded_at is null or c.owner_account_id is null then
  raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
 v_basis:=private.embryo_ingest_authority_fingerprint_v1(c.id);
 v_principals:=private.embryo_cohort_set_v1(c.id,'required_upload_principals');
 if cardinality(v_principals)=0 then raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
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
   raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
  perform 1 from public.purpose_grants where target_kind='cohort' and target_id=c.id
   and purpose='embryo.analysis' and signer_principal_id=v_principal order by grant_id for share;
  select * into v_grant from public.purpose_grants where target_kind='cohort' and target_id=c.id
   and purpose='embryo.analysis' and signer_principal_id=v_principal and revoked_at is null
   and (expires_at is null or expires_at>clock_timestamp()) order by grant_id;
  if v_grant.grant_id is null or (select count(*) from public.purpose_grants where target_kind='cohort'
   and target_id=c.id and purpose='embryo.analysis' and signer_principal_id=v_principal
   and revoked_at is null and (expires_at is null or expires_at>clock_timestamp()))<>1 then
   raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
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
   raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
  v_grants:=v_grants||jsonb_build_array(jsonb_build_object('grant',to_jsonb(v_grant),
   'direction',to_jsonb(v_direction),'signature',to_jsonb(v_signature),
   'principal',v_principal,'accountRevision',v_profile.account_revision,
   'jurisdictionRevision',v_profile.jurisdiction_revision));
  v_lease_deadline:=least(v_lease_deadline,v_grant.expires_at);
 end loop;
 for v_entry in select value from jsonb_array_elements(v_registry->'conditions') order by value->>'condition_id' loop
  if v_entry->>'category' is distinct from 'Having children'
   or v_entry->'permitted_result_kinds' is distinct from '["carrier_status"]'::jsonb
   or v_entry->'risk_model_id' is distinct from 'null'::jsonb then
   raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
  select * into v_condition from public.condition_registry where condition_id=v_entry->>'condition_id' for share;
  select * into v_carrier from public.carrier_conditions where condition_id=v_entry->>'condition_id' for share;
  select * into v_review from public.carrier_condition_reviews where review_id=v_carrier.active_review_id for share;
  if v_condition.condition_id is null or not v_condition.active
   or v_condition.condition_name is distinct from v_entry->>'condition_name'
   or v_condition.category is distinct from 'Having children'
   or v_carrier.condition_name is distinct from v_condition.condition_name or not v_carrier.active
   or v_carrier.inheritance_mode is distinct from 'autosomal_recessive'
   or v_review.review_id is null or v_review.decision is distinct from 'activate'
   or v_review.condition_id is distinct from v_carrier.condition_id
   or v_review.registry_revision is distinct from v_carrier.registry_revision then
   raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
  select jsonb_agg(to_jsonb(r) order by r.assertion_id) into v_rules
   from private.carrier_assertion_rule_v1() r where r.condition_id=v_condition.condition_id;
  v_assertion_count:=v_assertion_count+coalesce(jsonb_array_length(v_rules),0);
  if coalesce(jsonb_array_length(v_rules),0)<1 or v_assertion_count>20000
   or (select count(distinct row->>'release_id') from jsonb_array_elements(v_rules) row)<>1 then
   -- No subset of the complete reviewed assertion rule may be selected.
   raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
  select * into v_release from public.clinical_assertion_releases where release_id=v_rules->0->>'release_id' for share;
  perform 1 from public.clinical_assertions where condition_id=v_carrier.condition_id
   and release_id=v_release.release_id order by assertion_id for share;
  if v_release.release_id is null or v_release.retired_at is not null then
   raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
  v_conditions:=v_conditions||jsonb_build_array(jsonb_build_object('condition_id',v_condition.condition_id,
   'condition_registry',jsonb_build_array(jsonb_build_object('condition_id',v_condition.condition_id,
    'condition_name',v_condition.condition_name,'category',v_condition.category,'active',v_condition.active)),
   'assertions',v_rules,'reference_receipt',jsonb_build_object('condition',to_jsonb(v_carrier),
    'review',to_jsonb(v_review),'release',to_jsonb(v_release),'assertions',v_rules)));
 end loop;
 for e in select * from public.embryos where cohort_id=c.id order by sample_ordinal for share loop
  select * into s from public.subjects where id=e.subject_id;
  select * into q from public.embryo_qc where embryo_id=e.id for share;
  if e.sample_ordinal<>v_count or s.cohort_id is distinct from c.id or s.subject_class is distinct from 'embryo'
   or s.lifecycle is distinct from 'active' or s.analysis_stopped_at is not null
   or s.claimant_principal_id is not null or s.owner_account_id is distinct from c.owner_account_id
   or e.retention_expires_at<=clock_timestamp() or q.embryo_id is null
   or q.figure_basis is null or q.imputation_performed or q.imputation_panel is not null then
   raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
  v_source:=null;
  select * into x from private.embryo_canonical_sources where embryo_id=e.id for share;
  if e.status='qc_fail' then
   if e.status is distinct from 'qc_fail' or x.file_id is not null
    or exists(select 1 from public.genome_files where subject_id=s.id)
    or exists(select 1 from public.embryo_variants where embryo_id=e.id) then
    raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
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
    raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
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
  raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
 return jsonb_build_object('version','embryo-carrier-capture-v1','cohortId',c.id,
  'publicationRevision',c.publication_revision,'registry',v_registry,'conditions',v_conditions,'embryos',v_embryos,
  'authority',jsonb_build_object('basisFingerprint',v_basis,'cohort',to_jsonb(c),'grants',v_grants,
   'donorClassification','neutral-no-donor-input-or-output','testPolicy','TEST-LOCAL',
   'capabilities',jsonb_build_array('embryo_analysis','embryo_single_locus','carrier_match'),
   'jurisdictionsSha256','a73eb6033dc7a375d7e0c1dc5a22c64e02332682a66a9bf9a83b178c252562f6','expiresAt',v_lease_deadline));
end $capture$;
revoke all on function private.capture_embryo_carrier_v1(uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;

create function public.enqueue_embryo_carrier_v1(p_cohort_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $enqueue$
declare a jsonb; j public.worker_jobs; v_hash text;
begin
 a:=private.capture_embryo_carrier_v1(p_cohort_id,p_test_jurisdiction);
 if a is null then return '{"status":"held","reason":"no_registered_conditions"}'::jsonb; end if;
 v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
 j:=private.enqueue_worker_job_v2((a#>>'{authority,cohort,owner_account_id}')::uuid,
  'score_embryo','embryo.carrier-match',null,p_cohort_id,'cohort-source-set',p_cohort_id,
  (a->>'publicationRevision')::bigint,v_hash,'embryo-reviewed-allele-observation-v1',null,
  jsonb_build_object('capture',a));
 if j.payload is distinct from jsonb_build_object('capture',a) then
  raise exception using errcode='23505',message='embryo_carrier_binding_collision'; end if;
 return jsonb_build_object('status','queued','jobId',j.id);
end $enqueue$;
revoke all on function public.enqueue_embryo_carrier_v1(uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.enqueue_embryo_carrier_v1(uuid,boolean) to service_role;

create function private.freeze_embryo_carrier_job_v1() returns trigger
language plpgsql set search_path='' as $freeze$
begin
 if old.computation_revision='embryo-reviewed-allele-observation-v1'
  and row(new.payload,new.user_id,new.file_id) is distinct from row(old.payload,old.user_id,old.file_id) then
  raise exception using errcode='23514',message='embryo_carrier_capture_immutable'; end if;
 return new;
end $freeze$;
revoke all on function private.freeze_embryo_carrier_job_v1() from public,anon,authenticated,inherit_upload_only,service_role;
create trigger worker_jobs_embryo_carrier_capture_immutable before update on public.worker_jobs
for each row execute function private.freeze_embryo_carrier_job_v1();

-- The generic claimant cannot return these source-bearing jobs unchecked.
create or replace function private.claim_worker_job_v2(p_worker_id text,p_claim_token_hash text,p_lease_seconds integer default 60)
returns public.worker_jobs language plpgsql security definer set search_path=''
as $generic$
declare j public.worker_jobs%rowtype;
begin
 if p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' or p_lease_seconds not between 10 and 300 then
  raise exception using errcode='22023',message='invalid worker claim parameters'; end if;
 select w.* into j from public.worker_jobs w where w.status='queued' and w.kind<>'split_cohort_vcf'
  and w.kind<>'score_embryo'
  and not exists(select 1 from public.subjects s where s.id=w.subject_id and s.subject_class='other_adult')
  and w.not_before<=clock_timestamp() and w.attempts<w.max_attempts
 order by w.created_at,w.id for update of w skip locked limit 1;
 if j.id is null then return null; end if;
 update public.worker_jobs set status='running',attempts=attempts+1,claim_token_hash=p_claim_token_hash,
  claim_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),claimed_by=p_worker_id,
  started_at=coalesce(started_at,clock_timestamp()) where id=j.id returning * into j;
 return j;
end;
$generic$;

-- A bounded read from exactly one immutable embryo file at the reviewed
-- allele's spellings. Callers first resolve and compare the whole capture.
create function private.embryo_carrier_calls_v1(p_embryo jsonb,p_condition jsonb)
returns jsonb language plpgsql security definer set search_path='' as $calls$
declare a jsonb:=p_condition->'assertions'->0; v_calls jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('fileId',v.source_file_id,'chrom',v.chromosome,
  'pos',v.position,'ref',v.reference_allele,'alt',v.alternate_allele,'genotype',v.genotype)
  order by v.position,v.id),'[]'::jsonb) into v_calls
 from (select row.* from public.embryo_variants row
  where row.embryo_id=(p_embryo->>'embryoId')::uuid
   and row.source_file_id=(p_embryo#>>'{source,file_id}')::uuid
   and row.source_binding_fingerprint=p_embryo#>>'{source,source_sha256}'
   and row.chromosome=(a->>'chrom')::integer
   and row.position in(select (a->>'pos')::integer union all
    select (spell->>0)::integer from jsonb_array_elements(a->'equivalents') spell)
  order by row.position,row.id limit 257) v;
 if jsonb_array_length(v_calls)>256 then
  raise exception using errcode='42501',message='embryo_carrier_unavailable'; end if;
 return v_calls;
end $calls$;
revoke all on function private.embryo_carrier_calls_v1(jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

-- Generated SQL adapter to the single QC policy authority; source-pin tests
-- require exact constants and policy bytes. This is not a separate policy.
-- qc-policy-source-sha256: 3886c4cab94985496c53dcca1335af238e73025cc5e8c1c122eff0fad3d9b87d
create function private.embryo_carrier_qc_policy_v1() returns jsonb
language sql immutable set search_path='' as $qc_policy$
 select '{"callRateNoFigure":0.95,"callRateFail":0.85,"concordanceMarginal":0.95,"concordanceFail":0.9,"scoreCoverageFloor":0.8,"dropoutCeiling":0.1,"dropoutUnmeasuredWidening":1.5,"contaminationCeiling":0.05}'::jsonb;
$qc_policy$;
revoke all on function private.embryo_carrier_qc_policy_v1() from public,anon,authenticated,inherit_upload_only,service_role;

-- Independent exact-letter validation at the save boundary. This reads no
-- parents, siblings, absent positions or reference panel. It verifies the
-- existing observed core's result rather than trusting a worker-supplied dose.
create function private.expected_embryo_carrier_measurement_v1(p_embryo jsonb,p_condition jsonb)
returns jsonb language plpgsql security definer set search_path='' as $measurement$
declare a jsonb:=p_condition->'assertions'->0; qc jsonb:=p_embryo->'qc';
 v_call jsonb; v_spell jsonb; v_spelling jsonb; v_readings integer[]:='{}'; v_dose integer;
 v_alleles text[]; v_reason text; v_observation jsonb; v_unreadable boolean:=false;
 policy jsonb:=private.embryo_carrier_qc_policy_v1();
 v_part jsonb; v_assertion_measurements jsonb:='[]'; v_covered integer:=0;
begin
 if jsonb_array_length(p_condition->'assertions')>1 then
  -- Complete reviewed condition evidence, with independent per-assertion
  -- counts. Never select a convenient subset or sum alleles into a phase,
  -- diagnosis or disease probability. Missing calls remain named refusals.
  for a in select value from jsonb_array_elements(p_condition->'assertions') loop
   v_part:=private.expected_embryo_carrier_measurement_v1(p_embryo,
    jsonb_set(p_condition,'{assertions}',jsonb_build_array(a)));
   v_assertion_measurements:=v_assertion_measurements||jsonb_build_array(jsonb_build_object(
    'assertion_id',a->'assertion_id','observed_copies',v_part#>'{observation,observed_copies}',
    'reason',v_part->'reason'));
   if v_part->'observation'<>'null'::jsonb then v_covered:=v_covered+1;end if;
  end loop;
  if v_covered>0 then
   v_observation:=jsonb_build_object('version',2,'producer','embryo-reviewed-allele-observation-v1',
    'figure_basis','{"version":1,"basis":"observed"}'::jsonb,'source',p_embryo->'source',
    'condition_id',p_condition->'condition_id','covered_assertions',v_covered,
    'required_assertions',jsonb_array_length(p_condition->'assertions'),
    'assertion_measurements',v_assertion_measurements,'interpretation_status','held','confirmation_required',true);
  else v_reason:=v_assertion_measurements->0->>'reason';end if;
  return jsonb_build_object('embryoId',p_embryo->'embryoId','conditionId',p_condition->'condition_id',
   'observation',v_observation,'reason',v_reason,'assertion_measurements',v_assertion_measurements);
 end if;
 if p_embryo->'source'='null'::jsonb
  or (qc->>'call_rate')::double precision<(policy->>'callRateNoFigure')::double precision
  or (qc->>'parent_a_concordance')::double precision<(policy->>'concordanceFail')::double precision
  or (qc->>'parent_b_concordance')::double precision<(policy->>'concordanceFail')::double precision
  or (qc->>'contamination_estimate')::double precision>(policy->>'contaminationCeiling')::double precision then
  if (qc->>'call_rate')::double precision<(policy->>'callRateNoFigure')::double precision then v_reason:='embryo_call_rate';
  elsif (qc->>'parent_a_concordance')::double precision<(policy->>'concordanceMarginal')::double precision
   or (qc->>'parent_b_concordance')::double precision<(policy->>'concordanceMarginal')::double precision then v_reason:='embryo_parent_discordant';
  elsif (qc->>'contamination_estimate')::double precision>(policy->>'contaminationCeiling')::double precision then v_reason:='contamination';
  elsif (qc->>'allelic_dropout_estimate')::double precision>(policy->>'dropoutCeiling')::double precision then v_reason:='dropout_too_high';
  else v_reason:='qc_review_required';end if;
 else
  for v_call in select value from jsonb_array_elements(private.embryo_carrier_calls_v1(p_embryo,p_condition)) loop
   -- The core validates the complete bounded page before matching spellings.
   -- Real immutable splitter rows may be haploid, multiallelic or contain N;
   -- these yield a truthful invalid_calls result, not a transport failure or
   -- an unrelated-allele skip. This does not broaden scientific admission.
   v_alleles:=string_to_array(v_call->>'genotype','/');
   if v_call->>'ref'!~'^[ACGT]+$'
    or (v_call->'alt'<>'null'::jsonb and v_call->>'alt'!~'^[ACGT]+$')
    or v_call->>'genotype'!~'^(?:[ACGT]+/[ACGT]+|--)$'
    or (v_call->>'genotype'<>'--' and exists(select 1 from unnest(v_alleles) letter
     where letter<>v_call->>'ref' and letter is distinct from v_call->>'alt')) then
    v_reason:='invalid_calls';exit;end if;
   v_spelling:=null;
   for v_spell in select jsonb_build_array((a->>'pos')::integer,a->>'ref',a->>'alt') union all
    select value from jsonb_array_elements(a->'equivalents') loop
    if (v_call->>'pos')::integer=(v_spell->>0)::integer and v_call->>'ref'=v_spell->>1
     and (v_call->'alt'='null'::jsonb or v_call->>'alt'=v_spell->>2) then v_spelling:=v_spell;exit;end if;
   end loop;
   if v_spelling is null and not(length(a->>'ref')=1 and length(a->>'alt')=1
    and v_call->>'pos'=a->>'pos' and v_call->>'ref'=a->>'ref' and length(v_call->>'alt')=1) then continue;end if;
   if v_call->>'genotype'='--' then v_unreadable:=true;continue;end if;
   if v_call->'alt'='null'::jsonb then v_dose:=0;
   elsif v_spelling is not null then select count(*) into v_dose from unnest(v_alleles) letter where letter=v_spelling->>2;
   else select count(*) into v_dose from unnest(v_alleles) letter where letter=a->>'alt'; end if;
   v_readings:=array_append(v_readings,v_dose);
  end loop;
  if v_reason is null then
   if v_unreadable or cardinality(v_readings)=0 then v_reason:='not_covered';
   elsif (select count(distinct dose) from unnest(v_readings) dose)<>1 then v_reason:='source_call_disputed';
   else
    v_dose:=v_readings[1];
    v_observation:=jsonb_build_object('version',1,'producer','embryo-reviewed-allele-observation-v1',
     'figure_basis','{"version":1,"basis":"observed"}'::jsonb,'source',p_embryo->'source','assertion',a,
     'covered_positions',1,'required_positions',1,'observed_copies',v_dose,
     'carrier_state',(array['not_detected','carrier','two_variants'])[v_dose+1],'confirmation_required',true);
   end if;
  end if;
 end if;
 return jsonb_build_object('embryoId',p_embryo->'embryoId','conditionId',p_condition->'condition_id',
  'observation',v_observation,'reason',v_reason);
end $measurement$;
revoke all on function private.expected_embryo_carrier_measurement_v1(jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.embryo_carrier_coverage_v1(p_measurement jsonb) returns text
language sql immutable set search_path='' as $coverage$
 select case when p_measurement->'observation'='null'::jsonb then
  case when p_measurement->>'reason' in('embryo_call_rate','embryo_parent_discordant','contamination',
   'dropout_too_high','qc_review_required') then 'quality_not_measurable' else 'not_covered' end
  when p_measurement#>>'{observation,version}'='2'
   and (p_measurement#>>'{observation,covered_assertions}')::integer
    <(p_measurement#>>'{observation,required_assertions}')::integer then 'partial'
  else 'covered' end;
$coverage$;
revoke all on function private.embryo_carrier_coverage_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.embryo_carrier_receipt_v1(p_job public.worker_jobs,p_embryo jsonb,
 p_condition jsonb,p_measurement jsonb) returns jsonb language sql immutable set search_path='' as $saved_receipt$
 select jsonb_build_object('version',1,'producer','embryo-reviewed-allele-observation-v1',
  'job_id',(p_job).id,'attempt',(p_job).attempts,'capture_sha256',(p_job).file_sha256,
  'condition_id',p_condition->'condition_id','figure_basis',case when p_measurement->'observation'='null'::jsonb
   then 'null'::jsonb else '{"version":1,"basis":"observed"}'::jsonb end,
  'source',p_embryo->'source','reference_receipt',p_condition->'reference_receipt',
  'publication','held','hold_reason','scientific_disclosures_pending')
  ||case when p_measurement ? 'assertion_measurements' then jsonb_build_object('version',2,
   'assertion_measurements',p_measurement->'assertion_measurements','assertion_coverage',jsonb_build_object(
    'covered',(select count(*) from jsonb_array_elements(p_measurement->'assertion_measurements') row
     where row->'observed_copies'<>'null'::jsonb),
    'required',jsonb_array_length(p_measurement->'assertion_measurements'))) else '{}'::jsonb end;
$saved_receipt$;
revoke all on function private.embryo_carrier_receipt_v1(public.worker_jobs,jsonb,jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

create function private.valid_embryo_carrier_receipt_v1(p_receipt jsonb) returns boolean
language sql immutable set search_path='' as $receipt$
 select coalesce(jsonb_typeof(p_receipt)='object'
  and ((p_receipt->'version'='1'::jsonb and (select array_agg(k order by k) from jsonb_object_keys(p_receipt) k)=
    array['attempt','capture_sha256','condition_id','figure_basis','hold_reason','job_id','producer','publication','reference_receipt','source','version'])
   or (p_receipt->'version'='2'::jsonb and (select array_agg(k order by k) from jsonb_object_keys(p_receipt) k)=
    array['assertion_coverage','assertion_measurements','attempt','capture_sha256','condition_id','figure_basis','hold_reason','job_id','producer','publication','reference_receipt','source','version']
    and jsonb_typeof(p_receipt->'assertion_measurements')='array'
    and jsonb_array_length(p_receipt->'assertion_measurements') between 2 and 20000
    and not exists(select 1 from jsonb_array_elements(p_receipt->'assertion_measurements') row
     where (select array_agg(k order by k) from jsonb_object_keys(row) k) is distinct from array['assertion_id','observed_copies','reason']
      or row->>'assertion_id'!~'^[1-9][0-9]*$' or row->'observed_copies' not in('null'::jsonb,'0'::jsonb,'1'::jsonb,'2'::jsonb)
      or not ((row->'observed_copies'='null'::jsonb and jsonb_typeof(row->'reason')='string')
       or (row->'observed_copies' in('0'::jsonb,'1'::jsonb,'2'::jsonb) and row->'reason'='null'::jsonb)))
    and p_receipt->'assertion_coverage'=jsonb_build_object('covered',
     (select count(*) from jsonb_array_elements(p_receipt->'assertion_measurements') row where row->'observed_copies'<>'null'::jsonb),
     'required',jsonb_array_length(p_receipt->'assertion_measurements'))))
  and p_receipt->>'producer'='embryo-reviewed-allele-observation-v1'
  and p_receipt->>'publication'='held' and p_receipt->>'hold_reason'='scientific_disclosures_pending'
  and p_receipt->>'capture_sha256'~'^[0-9a-f]{64}$'
  and p_receipt->>'job_id'~'^[0-9a-f-]{36}$' and p_receipt->>'attempt'~'^([1-9]|1[0-9]|20)$'
  and p_receipt->>'condition_id'~'^(MONDO:[0-9]{7}|SYNTHETIC:[0-9]{1,7})$'
  and p_receipt->'figure_basis' in('null'::jsonb,'{"version":1,"basis":"observed"}'::jsonb)
  and jsonb_typeof(p_receipt->'reference_receipt')='object'
  and jsonb_typeof(p_receipt->'source') in('object','null'),false);
$receipt$;
revoke all on function private.valid_embryo_carrier_receipt_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.valid_embryo_carrier_receipt_v1(jsonb) to service_role;
alter table public.embryo_scores add constraint embryo_scores_carrier_receipt_closed
 check(computation_receipt is null or private.valid_embryo_carrier_receipt_v1(computation_receipt));

-- New receipts enter only under the exact running producer and its complete
-- current capture. Existing NULL rows keep their original update behavior.
create function private.guard_embryo_carrier_score_v1() returns trigger
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
create trigger zz_embryo_carrier_producer_fence before insert or update on public.embryo_scores
for each row execute function private.guard_embryo_carrier_score_v1();

create function public.embryo_carrier_worker_v1(p_operation text,p_job_id uuid,p_attempt integer,
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
  or p_operation not in('reconcile','claim','check','read','read_batch','save','fail')
  or not exists(select 1 from private.embryo_split_config where enabled) then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
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
  if jsonb_array_length(private.embryo_carrier_registry_v1()->'conditions')=0 then
   return '{"status":"held","reason":"no_registered_conditions"}'::jsonb;end if;
  v_after:=(p_payload->>'afterCohortId')::uuid;
  for v_cohort in select id from public.embryo_cohorts where status='active'
   and publication_revision is not null and owner_account_id is not null and uploaded_at is not null
   and retention_expires_at>clock_timestamp() and (v_after is null or id>v_after) order by id limit 4 loop
   v_checked:=v_checked+1;v_next:=v_cohort;
   begin
    a:=public.enqueue_embryo_carrier_v1(v_cohort,true);
    if a->>'status'='queued' then v_queued:=v_queued+1;end if;
   exception when insufficient_privilege then
    -- Missing/revoked current authority admits no job; a later complete pass
    -- resolves current state again. Other failures abort the bounded page.
    null;
   end;
  end loop;
  return jsonb_build_object('version','embryo-carrier-reconcile-v1','checked',v_checked,'queued',v_queued,
   'nextCursor',case when v_checked=4 then v_next else null end);
 end if;
 if p_operation='claim' then
  if p_job_id is not null or p_attempt is not null or p_payload is not null then
   raise exception using errcode='22023',message='invalid_request';end if;
  select * into j from public.worker_jobs where kind='score_embryo' and output_kind='embryo.carrier-match'
   and computation_revision='embryo-reviewed-allele-observation-v1'
   and (status='queued' or (status='running' and claim_expires_at<=clock_timestamp()))
   and not_before<=clock_timestamp() order by created_at,id limit 1;
  if j.id is null then return null;end if;
 else
  select * into j from public.worker_jobs where id=p_job_id;
  if j.id is null or j.status<>'running' or j.kind<>'score_embryo' or j.output_kind<>'embryo.carrier-match'
   or j.computation_revision<>'embryo-reviewed-allele-observation-v1'
   or j.attempts is distinct from p_attempt or j.claim_token_hash is distinct from p_claim_token_hash
   or j.claim_expires_at<=clock_timestamp() then
   raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 end if;
 begin
  a:=private.capture_embryo_carrier_v1(j.cohort_id,true);
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
   claim_expires_at=least(clock_timestamp()+interval '5 minutes',v_deadline),claimed_by='embryo-carrier-worker',
   started_at=coalesce(started_at,clock_timestamp()),progress_note='scoring'
   where id=j.id returning * into j;
 else
  if j.status<>'running' or j.attempts is distinct from p_attempt
   or j.claim_token_hash is distinct from p_claim_token_hash or j.claim_expires_at<=clock_timestamp() then
   raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 end if;
 if p_operation in('claim','check') then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request';end if;
  if p_operation='check' then
   update public.worker_jobs set claim_expires_at=least(clock_timestamp()+interval '5 minutes',v_deadline)
    where id=j.id returning * into j;
   -- Full current capture/payload equality was proved above. Avoid repeating
   -- the entire reviewed library in every bounded source checkpoint response.
   return jsonb_build_object('version','embryo-carrier-check-v2','jobId',j.id,'attempt',j.attempts,
    'claimExpiresAt',j.claim_expires_at,'deadline',v_deadline,'captureSha256',v_hash);
  end if;
  return jsonb_build_object('version','embryo-carrier-claim-v1',
   'jobId',j.id,'attempt',j.attempts,'claimExpiresAt',j.claim_expires_at,'deadline',v_deadline,
   'captureSha256',v_hash,'capture',a);
 elsif p_operation in('read','read_batch') then
  if jsonb_typeof(p_payload) is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(p_payload) k) is distinct from
    (case when p_operation='read' then array['conditionId','embryoId'] else array['assertionIds','conditionId','embryoId'] end) then
   raise exception using errcode='22023',message='invalid_request';end if;
  select value into e from jsonb_array_elements(a->'embryos') where value->>'embryoId'=p_payload->>'embryoId';
  select value into c from jsonb_array_elements(a->'conditions') where value->>'condition_id'=p_payload->>'conditionId';
  if e is null or c is null or e->'source'='null'::jsonb then
   raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
  if p_operation='read_batch' then
   if jsonb_typeof(p_payload->'assertionIds') is distinct from 'array'
    or jsonb_array_length(p_payload->'assertionIds') not between 1 and 32
    or exists(select 1 from jsonb_array_elements(p_payload->'assertionIds') row
     where jsonb_typeof(row)<>'number' or row#>>'{}'!~'^[1-9][0-9]*$')
    or (select count(distinct row) from jsonb_array_elements(p_payload->'assertionIds') row)
     <>jsonb_array_length(p_payload->'assertionIds') then
    raise exception using errcode='22023',message='invalid_request';end if;
   for v_assertion_id in select value from jsonb_array_elements(p_payload->'assertionIds') loop
    select value into v_assertion from jsonb_array_elements(c->'assertions') where value->'assertion_id'=v_assertion_id;
    if v_assertion is null then raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
    v_pages:=v_pages||jsonb_build_array(jsonb_build_object('assertionId',v_assertion_id,
     'calls',private.embryo_carrier_calls_v1(e,jsonb_set(c,'{assertions}',jsonb_build_array(v_assertion)))));
   end loop;
   return jsonb_build_object('version','embryo-carrier-call-batch-v1','jobId',j.id,'attempt',j.attempts,
    'captureSha256',v_hash,'embryoId',e->'embryoId','conditionId',c->'condition_id','pages',v_pages);
  end if;
  if jsonb_array_length(c->'assertions')<>1 then
   raise exception using errcode='22023',message='invalid_request';end if;
  return jsonb_build_object('version','embryo-carrier-calls-v1','jobId',j.id,'attempt',j.attempts,
   'captureSha256',v_hash,'embryoId',e->'embryoId','conditionId',c->'condition_id',
   'calls',private.embryo_carrier_calls_v1(e,c));
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
    expected:=private.expected_embryo_carrier_measurement_v1(e,c);
    v_measurements:=v_measurements||jsonb_build_array(expected);
   end loop;
  end loop;
  if p_payload->'measurements' is distinct from v_measurements then
   raise exception using errcode='42501',message='embryo_carrier_measurement_mismatch';end if;
  select coalesce(max(sc.computation_revision),0)+1 into v_revision from public.embryo_scores sc
   join public.embryos embryo on embryo.id=sc.embryo_id where embryo.cohort_id=j.cohort_id;
  for e in select value from jsonb_array_elements(a->'embryos') loop
   for c in select value from jsonb_array_elements(a->'conditions') loop
    expected:=v_measurements->v_saved;
    insert into public.embryo_scores(embryo_id,condition_id,condition_name,finding,evidence_label,
     coverage_state,citation_ids,not_covered_reason,source_binding_fingerprint,computation_revision,computation_receipt)
    values((e->>'embryoId')::uuid,c->>'condition_id',c#>>'{condition_registry,0,condition_name}',
     nullif(expected->'observation','null'::jsonb),'preliminary',
     private.embryo_carrier_coverage_v1(expected),
     '{}',expected->>'reason',v_hash,v_revision,
     private.embryo_carrier_receipt_v1(j,e,c,expected));
    v_saved:=v_saved+1;
   end loop;
  end loop;
  update public.worker_jobs set status='done',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null,progress=100,progress_note='complete',
   partial=exists(select 1 from jsonb_array_elements(v_measurements) row where private.embryo_carrier_coverage_v1(row)<>'covered')
   where id=j.id;
  return jsonb_build_object('status','saved_held','jobId',j.id,'attempt',j.attempts,
   'captureSha256',v_hash,'saved',v_saved,'publication','held');
 end if;
end $worker$;
revoke all on function public.embryo_carrier_worker_v1(text,uuid,integer,text,jsonb,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.embryo_carrier_worker_v1(text,uuid,integer,text,jsonb,boolean) to service_role;

-- Current saved-result boundary: prove the complete receipt again, then expose
-- only a disclosure hold. Neither the full authority capture nor any clinical
-- finding can leave this door while the public scientific contract is absent.
create function public.current_embryo_carrier_hold_v1(p_account uuid,p_session uuid,p_cohort uuid,p_test boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
set extra_float_digits=3 as $current_hold$
declare a jsonb; j public.worker_jobs; score public.embryo_scores; e jsonb; c jsonb;
 v_hash text; expected jsonb; v_count integer:=0;
begin
 if p_test is distinct from true then raise exception using errcode='42501',message='not_found';end if;
 perform private.lock_invitation_transitions_v1();
 perform 1 from public.subjects where cohort_id=p_cohort order by id for update;
 perform private.validate_sensitive_account_session_read_v1(p_account,p_session);
 if private.cohort_copilot_authority_v1(p_account,p_cohort) is null then return null;end if;
 begin a:=private.capture_embryo_carrier_v1(p_cohort,true);
 exception when insufficient_privilege then return null;end;
 if a is null then return null;end if;
 v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
 select * into j from public.worker_jobs where cohort_id=p_cohort and status='done'
  and kind='score_embryo' and output_kind='embryo.carrier-match'
  and computation_revision='embryo-reviewed-allele-observation-v1'
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
   if score.id is null or not private.valid_embryo_carrier_receipt_v1(score.computation_receipt)
    or score.computation_receipt->>'capture_sha256' is distinct from v_hash
    or (score.computation_receipt->>'attempt')::integer is distinct from j.attempts
    or score.computation_receipt->'source' is distinct from e->'source'
    or score.computation_receipt->'reference_receipt' is distinct from c->'reference_receipt' then return null;end if;
   expected:=private.expected_embryo_carrier_measurement_v1(e,c);
   if score.finding is distinct from nullif(expected->'observation','null'::jsonb)
    or score.not_covered_reason is distinct from expected->>'reason'
    or score.coverage_state is distinct from private.embryo_carrier_coverage_v1(expected)
    or score.computation_receipt is distinct from private.embryo_carrier_receipt_v1(j,e,c,expected) then return null;end if;
   v_count:=v_count+1;
  end loop;
 end loop;
 if (select count(*) from public.embryo_scores where computation_receipt->>'job_id'=j.id::text)<>v_count then return null;end if;
 return '{"status":"held","reason":"scientific_disclosures_pending"}'::jsonb;
end $current_hold$;
revoke all on function public.current_embryo_carrier_hold_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.current_embryo_carrier_hold_v1(uuid,uuid,uuid,boolean) to service_role;
