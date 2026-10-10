-- Coverage of the complete current reviewed library is a separate disclosure.
-- It is not a carrier finding, score coverage, a negative result or permission
-- to publish an interpretation. No registry/review/source/worker door changes.
create function private.embryo_carrier_library_coverage_v1(p_condition jsonb,p_measurements jsonb)
returns jsonb language plpgsql immutable set search_path='' as $coverage$
declare v_required integer; v_checked integer; v_unresolved jsonb;
begin
 if jsonb_typeof(p_condition->'assertions') is distinct from 'array'
  or jsonb_typeof(p_measurements) is distinct from 'array' then
  raise exception using errcode='22023',message='invalid_carrier_position_coverage';end if;
 if exists(select 1 from jsonb_array_elements(p_measurements) row where jsonb_typeof(row) is distinct from 'object') then
  raise exception using errcode='22023',message='invalid_carrier_position_coverage';end if;
 if jsonb_array_length(p_condition->'assertions') not between 1 and 20000
  or jsonb_array_length(p_measurements)<>jsonb_array_length(p_condition->'assertions')
  or (select count(distinct rule->'assertion_id') from jsonb_array_elements(p_condition->'assertions') rule)
    <>jsonb_array_length(p_condition->'assertions')
  or (select count(distinct rule->>'release_id') from jsonb_array_elements(p_condition->'assertions') rule)<>1
  or exists(select 1 from jsonb_array_elements(p_condition->'assertions') rule
   where rule->>'condition_id' is distinct from p_condition->>'condition_id'
    or rule->>'condition_name' is distinct from p_condition#>>'{condition_registry,0,condition_name}'
    or rule->>'inheritance_mode' is distinct from 'autosomal_recessive')
  or (select count(distinct row->'assertion_id') from jsonb_array_elements(p_measurements) row)
    <>jsonb_array_length(p_measurements)
  or exists(select 1 from jsonb_array_elements(p_measurements) row
   where (select array_agg(k order by k) from jsonb_object_keys(row) k)
     is distinct from array['assertion_id','observed_copies','reason']
    or row->>'assertion_id'!~'^[1-9][0-9]*$'
    or ((row->'observed_copies' in('0'::jsonb,'1'::jsonb,'2'::jsonb) and row->'reason'='null'::jsonb)
     or (row->'observed_copies'='null'::jsonb and row->>'reason' in('not_covered','source_call_disputed','invalid_calls'))) is not true)
  or exists(select 1 from jsonb_array_elements(p_condition->'assertions') rule
   where not exists(select 1 from jsonb_array_elements(p_measurements) row
    where row->'assertion_id'=rule->'assertion_id')) then
  raise exception using errcode='22023',message='invalid_carrier_position_coverage';end if;

 -- Alternate indel spellings are ways to read the same reviewed locus, not
 -- additional positions. Every reviewed allele at a locus must be readable.
 with loci as (
  select (rule->>'chrom')::integer chrom,(rule->>'pos')::integer pos,
   bool_and(row->'observed_copies'<>'null'::jsonb) checked,
   array_remove(array[
    case when bool_or(row->>'reason'='not_covered') then 'not_covered' end,
    case when bool_or(row->>'reason'='source_call_disputed') then 'source_call_disputed' end,
    case when bool_or(row->>'reason'='invalid_calls') then 'invalid_calls' end],null) reasons
  from jsonb_array_elements(p_condition->'assertions') rule
  join jsonb_array_elements(p_measurements) row on row->'assertion_id'=rule->'assertion_id'
  group by (rule->>'chrom')::integer,(rule->>'pos')::integer
 ), groups as (
  select reasons,count(*) positions from loci where not checked group by reasons
 )
 select (select count(*) from loci),(select count(*) from loci where checked),
  coalesce((select jsonb_agg(jsonb_build_object('reasons',reasons,'positions',positions)
   order by reasons) from groups),'[]'::jsonb)
 into v_required,v_checked,v_unresolved;
 return jsonb_build_object('version','embryo-carrier-library-coverage-v1',
  'basis','distinct-grch38-reviewed-loci-v1','conditionId',p_condition->'condition_id',
  'conditionName',p_condition#>'{condition_registry,0,condition_name}',
  'referenceReleaseId',p_condition#>'{assertions,0,release_id}',
  'checkedPositions',v_checked,'requiredPositions',v_required,
  'coverageState',case when v_checked=0 then 'not_covered' when v_checked=v_required then 'covered' else 'partial' end,
  'unresolved',v_unresolved,'interpretationStatus','held','holdReason','scientific_disclosures_pending');
end $coverage$;
revoke all on function private.embryo_carrier_library_coverage_v1(jsonb,jsonb)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The unchanged current hold proves the complete real cohort, grants, signed
-- review/reference, saved job, source calls and every receipt first, locking
-- them for this transaction. Only its exact saved rows can feed this summary.
create function public.current_embryo_carrier_library_coverage_v1(p_account uuid,p_session uuid,p_cohort uuid,p_test boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
set extra_float_digits=3 as $current$
declare a jsonb; j public.worker_jobs; score public.embryo_scores; e jsonb; c jsonb;
 v_hash text; v_measurements jsonb; v_coverage jsonb; v_quality text; v_rows jsonb:='[]';
begin
 if public.current_embryo_carrier_hold_v1(p_account,p_session,p_cohort,p_test)
  is distinct from '{"status":"held","reason":"scientific_disclosures_pending"}'::jsonb then return null;end if;
 a:=private.capture_embryo_carrier_v1(p_cohort,p_test);
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
   if score.id is null or score.condition_name is distinct from c#>>'{condition_registry,0,condition_name}'
    or score.computation_receipt->>'capture_sha256' is distinct from v_hash
    or score.computation_receipt->'source' is distinct from e->'source'
    or score.computation_receipt->'reference_receipt' is distinct from c->'reference_receipt' then return null;end if;
   if jsonb_array_length(c->'assertions')=1 then
    v_measurements:=jsonb_build_array(jsonb_build_object('assertion_id',c#>'{assertions,0,assertion_id}',
     'observed_copies',coalesce(score.finding->'observed_copies','null'::jsonb),'reason',score.not_covered_reason));
   else v_measurements:=score.computation_receipt->'assertion_measurements';end if;
   v_quality:=null;v_coverage:=null;
   if exists(select 1 from jsonb_array_elements(v_measurements) row
    where row->>'reason' in('embryo_call_rate','embryo_parent_discordant','contamination','dropout_too_high','qc_review_required')) then
    -- Failed QC is not absence at reviewed positions. Withhold the count.
    if (select count(distinct row->>'reason') from jsonb_array_elements(v_measurements) row)<>1 then return null;end if;
    v_quality:=v_measurements->0->>'reason';
   else v_coverage:=private.embryo_carrier_library_coverage_v1(c,v_measurements);end if;
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('embryoId',e->'embryoId',
    'conditionId',c->'condition_id','coverage',v_coverage,'qualityReason',v_quality));
  end loop;
 end loop;
 perform private.validate_sensitive_account_session_read_v1(p_account,p_session);
 if (a#>>'{authority,expiresAt}')::timestamptz<=clock_timestamp()
  or private.cohort_copilot_authority_v1(p_account,p_cohort) is null then return null;end if;
 return jsonb_build_object('version','embryo-carrier-library-read-v1','cohortId',p_cohort,
  'publicationRevision',a->'publicationRevision','rows',v_rows);
end $current$;
revoke all on function public.current_embryo_carrier_library_coverage_v1(uuid,uuid,uuid,boolean)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.current_embryo_carrier_library_coverage_v1(uuid,uuid,uuid,boolean) to service_role;
