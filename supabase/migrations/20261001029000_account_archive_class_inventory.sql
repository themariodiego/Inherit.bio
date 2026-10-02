-- TEST-LOCAL complete-class presence and named metadata projection. Current
-- consumed actor/source/attempt authority remains. No new store, human JWT,
-- analytical grant, public/READY or provider delivery. Unproved nonempty
-- producers and all original unsupported graphs remain whole refusals.
create function private.export_account_class_projection_v1(p_account uuid,p_subjects uuid[],p_kind text)
returns table(projected_id uuid,projected_subject uuid,projected_row jsonb)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
begin
 if p_kind='attestation_contradictions' then
  return query select c.id,case when c.subject_id=any(p_subjects) then c.subject_id end,
   jsonb_build_object('id',c.id,'contradiction_code',c.contradiction_code,'lifecycle_revision',c.lifecycle_revision,
    'recorded_at',c.recorded_at,'resolved_at',c.resolved_at)
   from public.attestation_contradictions c where c.subject_id=any(p_subjects)
    or c.principal_id in(select id from public.subject_principals where account_id=p_account) order by c.id;
 elsif p_kind='directional_grants' then
  return query select d.grant_id,case when g.target_kind='subject' and g.target_id=any(p_subjects) then g.target_id end,
   jsonb_build_object('grant_id',d.grant_id,'grant_revision',d.grant_revision,'relationship_or_pair_revision',d.relationship_or_pair_revision,
    'direction',d.direction,'status',d.status,'created_at',d.created_at,'ended_at',d.ended_at)
   from public.directional_grants d join public.purpose_grants g on g.grant_id=d.grant_id
   where d.recipient_account_id=p_account or d.recipient_principal_id in(select id from public.subject_principals where account_id=p_account)
   order by d.grant_id;
 elsif p_kind='family_sharing_pauses' then
  return query select p.id,null::uuid,jsonb_build_object('id',p.id,'paused_by_requester',p.paused_by_account_id=p_account,
    'ended_by_requester',p.ended_by_account_id=p_account,'paused_at',p.paused_at,'ended_at',p.ended_at,'end_reason',p.end_reason)
   from public.family_sharing_pauses p where p_account in(p.account_low_id,p.account_high_id) order by p.id;
 elsif p_kind='family_sharing_stops' then
  return query select s.id,null::uuid,jsonb_build_object('id',s.id,'stopped_by_requester',s.stopped_by_account_id=p_account,'ended_at',s.ended_at)
   from public.family_sharing_stops s where p_account in(s.account_low_id,s.account_high_id) order by s.id;
 elsif p_kind='future_person_claims' then
  return query select c.id,case when e.subject_id=any(p_subjects) then e.subject_id end,
   jsonb_build_object('id',c.id,'claim_method',c.claim_method,'claim_revision',c.claim_revision,'claimant_revision',c.claimant_revision,
    'status',c.status,'submitted_at',c.submitted_at,'decided_at',c.decided_at)
   from public.future_person_claims c join public.embryos e on e.id=c.embryo_id
   where c.claimant_account_id=p_account or c.claimant_principal_id in(select id from public.subject_principals where account_id=p_account)
    or exists(select 1 from private.future_person_account_bindings b where b.claim_id=c.id and b.account_id=p_account) order by c.id;
 elsif p_kind='future_person_claimant_principals' then
  return query select c.id,case when e.subject_id=any(p_subjects) then e.subject_id end,
   jsonb_build_object('id',c.id,'claim_id',c.claim_id,'claimant_revision',c.claimant_revision,'status',c.status,'created_at',c.created_at)
   from public.future_person_claimant_principals c join public.future_person_claims claim on claim.id=c.claim_id
    join public.embryos e on e.id=claim.embryo_id
   where c.principal_id in(select id from public.subject_principals where account_id=p_account)
    or exists(select 1 from private.future_person_account_bindings b where b.claim_id=c.claim_id and b.account_id=p_account
     and b.claimant_principal_id=c.id) order by c.id;
 elsif p_kind='future_person_claim_objections' then
  return query select o.id,case when e.subject_id=any(p_subjects) then e.subject_id end,
   jsonb_build_object('id',o.id,'claim_id',o.claim_id,'objection_revision',o.objection_revision,'reason_code',o.reason_code,
    'status',o.status,'submitted_at',o.submitted_at,'decided_at',o.decided_at)
   from public.future_person_claim_objections o join public.future_person_claims c on c.id=o.claim_id
    join public.embryos e on e.id=c.embryo_id
   where o.objector_principal_id in(select id from public.subject_principals where account_id=p_account)
    or c.claimant_account_id=p_account or c.claimant_principal_id in(select id from public.subject_principals where account_id=p_account)
    or exists(select 1 from private.future_person_account_bindings b where b.claim_id=c.id and b.account_id=p_account) order by o.id;
 elsif p_kind='subject_control_refusal_authorities' then
  return query select r.id,case when r.subject_id=any(p_subjects) then r.subject_id end,
   jsonb_build_object('id',r.id,'authority_revision',r.authority_revision,'status',r.status,'created_at',r.created_at)
   from public.subject_control_refusal_authorities r where r.subject_id=any(p_subjects)
    or r.principal_id in(select id from public.subject_principals where account_id=p_account) order by r.id;
 elsif p_kind='subject_relationships' then
  return query select r.id,case when r.subject_id=any(p_subjects) then r.subject_id end,
   jsonb_build_object('id',r.id,'relationship_kind',r.relationship_kind,'relationship_revision',r.relationship_revision,
    'status',r.status,'created_at',r.created_at,'ended_at',r.ended_at)
   from public.subject_relationships r where r.subject_id=any(p_subjects) or r.recipient_account_id=p_account
    or r.recipient_principal_id in(select id from public.subject_principals where account_id=p_account) order by r.id;
 elsif p_kind='suppressions' then
  return query select s.id,s.subject_id,jsonb_build_object('id',s.id,'condition_id',s.condition_id,'reason_code',s.reason_code,
    'suppression_revision',s.suppression_revision,'active_from',s.active_from,'ended_at',s.ended_at)
   from public.suppressions s where s.subject_id=any(p_subjects) order by s.id;
 else raise exception using errcode='22023',message='invalid_request';end if;
end $$;
revoke all on function private.export_account_class_projection_v1(uuid,uuid[],text)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function private.export_account_class_inventory_v1(p_account uuid,p_capture jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
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
end $$;
revoke all on function private.export_account_class_inventory_v1(uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;

alter function private.export_account_owned_capture_v1(jsonb,text,uuid) rename to export_account_owned_capture_pre_classes_v1;
create function private.export_account_owned_capture_v1(p_origin jsonb,p_target_kind text,p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare captured jsonb;classes jsonb;receipt text;
begin
 captured:=private.export_account_owned_capture_pre_classes_v1(p_origin,p_target_kind,p_target_id);
 if p_target_kind<>'account' then return captured;end if;
 classes:=private.export_account_class_inventory_v1((p_origin->>'accountId')::uuid,captured);
 receipt:=encode(extensions.digest(jsonb_build_object('version','account-class-inventory-v1','capture',captured,'classes',classes)::text,'sha256'),'hex');
 return jsonb_set(captured,'{authority,authorityReceipt}',to_jsonb(receipt))||jsonb_build_object('classInventory',classes);
end $$;
revoke all on function private.export_account_owned_capture_v1(jsonb,text,uuid),private.export_account_owned_capture_pre_classes_v1(jsonb,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.export_archive_account_classes_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_kind text default null,p_after_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare permit jsonb;captured jsonb;subjects uuid[];result jsonb;rows jsonb;n integer;last_id uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','metadata')
  or (p_operation='context' and (p_kind is not null or p_after_id is not null))
  or (p_operation='metadata' and (p_kind is null or p_kind not in('attestation_contradictions','directional_grants','family_sharing_pauses',
   'family_sharing_stops','future_person_claim_objections','future_person_claimant_principals','future_person_claims',
   'subject_control_refusal_authorities','subject_relationships','suppressions'))) then raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then raise exception using errcode='42501',message='not_found';end if;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;
 if p_operation='context' then result:=jsonb_build_object('version','account-class-inventory-v1','authorityReceipt',p_authority_receipt,'classes',captured->'classInventory',
   'boundSnapshots',(select coalesce(jsonb_agg(jsonb_set(x->'capture','{authority,authorityReceipt}',to_jsonb(p_authority_receipt))
     order by x->>'subjectId'),'[]') from jsonb_array_elements(captured->'partitions')x where x->>'class'='claimed-bound'));
 else
  select coalesce(jsonb_agg(x.row order by x.id),'[]'),count(*),max(x.id::text)::uuid into rows,n,last_id from(
   select projected_id id,jsonb_build_object('id',projected_id,'subjectId',projected_subject,'rowText',projected_row::text)row
    from private.export_account_class_projection_v1((permit#>>'{origin,accountId}')::uuid,subjects,p_kind)
    where p_after_id is null or projected_id>p_after_id order by projected_id limit 500)x;
  result:=jsonb_build_object('version','account-class-page-v1','kind',p_kind,'rows',rows,'nextAfterId',case when n=500 then to_jsonb(last_id) else 'null'::jsonb end);
 end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from captured then
  raise exception using errcode='42501',message='not_found';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid) to service_role;
