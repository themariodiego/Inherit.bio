-- SOURCE ONLY. Exact current 039 class body plus one guarded TEST branch.
create or replace function private.export_account_class_inventory_v1(p_account uuid,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' as $body$
declare subjects uuid[];cohorts uuid[];kind text;handling text;item record;n bigint;digest bytea;counts jsonb;out jsonb:='[]';
 scientific_frame jsonb;ordinary uuid[];
begin
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(p_capture#>'{authority,subjectPartitions}')x;
 select array_agg((x->>'subjectId')::uuid order by x->>'subjectId') into ordinary from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='ordinary';
 select array_agg(id order by id) into cohorts from(select c.id from public.embryo_cohorts c where c.owner_account_id=p_account
  union select s.cohort_id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.account_id=p_account)x;
 scientific_frame:=(select coalesce(jsonb_agg(x->'capture' order by x->>'subjectId'),'[]') from jsonb_array_elements(p_capture->'partitions')x
  where x->>'class'='claimed-bound');
 foreach kind in array array['ancestry_regions','appeal_intakes','attestation_contradictions','correction_requests','directional_grants',
  'embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals','embryo_donor_attributions',
  'embryo_figures','embryo_participant_sets','embryo_qc','embryo_scores','embryo_variants','embryos','family_pairs','family_sharing_pauses',
  'family_sharing_stops','future_person_claim_objections','future_person_claimant_principals','future_person_claims','portrait_results',
  'report_artifacts','subject_control_refusal_authorities','subject_relationships','suppressions','other_adult_held_uploads','path_b_report_bindings'] loop
  n:=0;counts:='[]';digest:=extensions.digest(convert_to('account-class-members-v1|'||kind,'UTF8'),'sha256');
  if kind in('attestation_contradictions','directional_grants','family_sharing_pauses','family_sharing_stops','future_person_claim_objections',
   'future_person_claimant_principals','future_person_claims','subject_control_refusal_authorities','subject_relationships','suppressions') then
   handling:='metadata';
   for item in select * from private.export_account_class_projection_v1(p_account,subjects,kind) loop
    if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.projected_id::text||':'||coalesce(item.projected_subject::text,'')||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x.subject,'rows',x.n) order by x.subject),'[]') into counts from(
    select projected_subject subject,count(*) n from private.export_account_class_projection_v1(p_account,subjects,kind)
    where projected_subject is not null group by projected_subject)x;
  elsif kind in('embryo_figures','embryo_qc','embryo_scores','embryo_variants','embryos','report_artifacts') then
   handling:='claimed-bound';
   -- Original bound capture already independently validates full source,
   -- immutable calls and exact complete QC/finding/figure/report membership.
   -- Parent-cohort files and ordinary arbitrary artifact payloads are refused.
   if exists(select 1 from public.embryos e where e.subject_id=any(ordinary))
    or (kind='report_artifacts' and exists(select 1 from public.report_artifacts r where r.subject_id=any(ordinary) or r.cohort_id=any(cohorts))) then
    raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
   for item in select x->>'subjectId' subject,x->'capture' snapshot from jsonb_array_elements(p_capture->'partitions')x where x->>'class'='claimed-bound' loop
    n:=case kind when 'embryos' then 1 when 'embryo_qc' then (item.snapshot#>>'{membership,qualityReports}')::bigint
     when 'embryo_scores' then (item.snapshot#>>'{membership,scores}')::bigint when 'embryo_figures' then (item.snapshot#>>'{membership,figures}')::bigint
     when 'embryo_variants' then (item.snapshot#>>'{membership,variants}')::bigint when 'report_artifacts' then (item.snapshot#>>'{membership,reports}')::bigint end;
    if n>0 then counts:=counts||jsonb_build_array(jsonb_build_object('subjectId',item.subject,'rows',n));end if;
   end loop;
   select coalesce(sum((x->>'rows')::bigint),0) into n from jsonb_array_elements(counts)x;
   digest:=extensions.digest(convert_to('account-class-members-v1|'||kind||'|'||scientific_frame::text,'UTF8'),'sha256');
  elsif kind in('embryo_basis_bindings','embryo_cohorts','embryo_disposition_confirmations','embryo_disposition_proposals',
   'embryo_donor_attributions','embryo_participant_sets','family_pairs') then
   handling:='graph';
   select (x->>'rows')::bigint,decode(x->>'membershipSha256','hex'),x->'partitions' into n,digest,counts
    from jsonb_array_elements(p_capture#>'{readableGraph,inventory}')x where x->>'kind'=kind;
   if n is null or digest is null or counts is null then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  elsif kind='path_b_report_bindings' then
   handling:='path-b-results';
   for item in select x->>'id' id,x->>'subjectId' subject,x->>'rowText' row_text
    from jsonb_array_elements(p_capture->'pathBResults')s cross join lateral jsonb_array_elements(s->'records')x
    order by (x->>'id') collate "C" loop
    n:=n+1;digest:=extensions.digest(digest||convert_to(item.id||':'||item.subject||':'||item.row_text||E'\n','UTF8'),'sha256');
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('subjectId',x->'subjectId','rows',x->'rows') order by x->>'subjectId'),'[]') into counts
    from jsonb_array_elements(p_capture->'pathBResults')x where (x->>'rows')::bigint>0;
   -- Exact recipient-scoped internal bindings have a registered result-only
   -- subject projection. Other recipients' grants/results are not borrowed.
   if n<>(select count(*) from private.path_b_report_bindings b where b.recipient_account_id=p_account) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
  elsif kind='correction_requests' and private.requester_statement_test_enabled_v1() then
   handling:='requester-statements';
   if p_capture#>>'{ownStatements,version}' is distinct from 'test-account-own-statements-v1' then
    raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
   n:=(p_capture#>>'{ownStatements,corrections}')::bigint;
   digest:=decode(p_capture#>>'{ownStatements,membershipSha256}','hex');
   counts:=p_capture#>'{ownStatements,partitions}';
  elsif kind='other_adult_held_uploads' then
   handling:='excluded';
   select count(*) into n from public.other_adult_held_uploads h where h.uploader_account_id=p_account or h.subject_id=any(subjects);
   if n<>coalesce((select sum((x->>'excludedHeldUploads')::bigint) from jsonb_array_elements(p_capture->'pathBResults')x),0) then
    raise exception using errcode='0A000',message='export_result_projection_unavailable';end if;
   digest:=extensions.digest(convert_to('account-excluded-held-objects-v1|'||coalesce((select jsonb_agg(to_jsonb(h) order by h.id)
    from public.other_adult_held_uploads h where h.subject_id=any(subjects)),'[]')::text,'UTF8'),'sha256');
  else
   handling:='unsupported';
   case kind
    when 'ancestry_regions' then select count(*) into n from public.ancestry_regions where subject_id=any(subjects);
    when 'appeal_intakes' then select count(*) into n from public.appeal_intakes where appellant_account_id=p_account or appellant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'correction_requests' then select count(*) into n from public.correction_requests where subject_id=any(subjects) or claimant_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_basis_bindings' then select count(*) into n from public.embryo_basis_bindings where cohort_id=any(cohorts);
    when 'embryo_cohorts' then n:=coalesce(cardinality(cohorts),0);
    when 'embryo_disposition_confirmations' then select count(*) into n from public.embryo_disposition_confirmations c join public.embryo_disposition_proposals p on p.id=c.proposal_id join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or c.confirmer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_disposition_proposals' then select count(*) into n from public.embryo_disposition_proposals p join public.embryos e on e.id=p.embryo_id where e.cohort_id=any(cohorts) or p.proposer_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_donor_attributions' then select count(*) into n from public.embryo_donor_attributions where cohort_id=any(cohorts) or donor_principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'embryo_participant_sets' then select count(*) into n from public.embryo_participant_sets where cohort_id=any(cohorts) or principal_id in(select id from public.subject_principals where account_id=p_account);
    when 'family_pairs' then select count(*) into n from public.family_pairs where subject_a_id=any(subjects) or subject_b_id=any(subjects);
    when 'portrait_results' then select count(*) into n from public.portrait_results where owner_account_id=p_account or parent_a_subject_id=any(subjects) or parent_b_subject_id=any(subjects);
    when 'other_adult_held_uploads' then select count(*) into n from public.other_adult_held_uploads where uploader_account_id=p_account or subject_id=any(subjects);
    when 'path_b_report_bindings' then select count(*) into n from private.path_b_report_bindings where recipient_account_id=p_account or subject_id=any(subjects);
    else raise exception using errcode='22023',message='invalid_request';
   end case;
   if n<>0 then raise exception using errcode='0A000',message='export_class_projection_unavailable';end if;
  end if;
  if n is null or n<0 or n>9007199254740991 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  out:=out||jsonb_build_array(jsonb_build_object('kind',kind,'mode',handling,'rows',n,'membershipSha256',encode(digest,'hex'),'partitions',counts));
 end loop;
 return out;
end
$body$;
revoke all on function private.export_account_class_inventory_v1(uuid,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
