-- TEST-LOCAL account archive audit producer. Owner A remains actor-only:
-- ordinary ledger rows never recorded a subject target. Do not infer one.
-- No new store, public route, JWT, analysis grant, READY or provider delivery.
create function private.export_ordinary_audit_unrecorded_v1(p_subject uuid,p_account uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_subject is null or p_account is null or not exists(select 1 from public.subjects s
   where s.id=p_subject and s.subject_account_id=p_account and s.subject_class in('self','other_adult')
     and s.lifecycle in('active','restricted'))
  or exists(select 1 from private.future_person_custody_slices where subject_id=p_subject)
  or exists(select 1 from private.future_person_account_bindings where subject_id=p_subject) then
  raise exception using errcode='42501',message='export_audit_unavailable';end if;
 -- The known issued subject selectors are explicitly refused above. Adding a
 -- new assigned selector requires a reviewed producer; it must never inherit
 -- this truthful historical absence representation.
 return jsonb_build_object('schema_version','legal-audit-v1','attribution','unrecorded',
  'attribution_started_at',null,'note','These audit records do not identify the subject of each action. Your recorded account actions are in legal-audit.json. This does not mean that nothing happened to this record.',
  'events','[]'::jsonb);
end $$;
revoke all on function private.export_ordinary_audit_unrecorded_v1(uuid,uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

create function public.export_archive_account_audit_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,
 p_authority_receipt text,p_subject_id uuid default null,p_after_seq bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare permit jsonb;capture jsonb;result jsonb;part jsonb;actors uuid[]:='{}';a uuid;bound uuid;custody uuid;
 started timestamptz;total bigint;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_operation is null or p_operation not in('context','events','ordinary-subject')
  or (p_operation='ordinary-subject') is distinct from (p_subject_id is not null)
  or (p_operation<>'events' and p_after_seq is not null) or p_after_seq<0 or p_after_seq>9007199254740991 then
  raise exception using errcode='22023',message='invalid_request';end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 capture:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if capture#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then
  raise exception using errcode='42501',message='not_found';end if;
 a:=(permit#>>'{origin,accountId}')::uuid;
 select coalesce(array_agg(audit_principal_id),'{}') into actors from private.legal_audit_account_principals where account_id=a;
 for part in select x from jsonb_array_elements(capture->'partitions') x loop
  if part->>'class'='ordinary' then
   perform private.export_ordinary_audit_unrecorded_v1((part->>'subjectId')::uuid,a);
  elsif part->>'class'='claimed-bound' then
   -- These are genuine immutable subject selectors, independently validated
   -- under their exact issued event triples, never inferred account targets.
   perform private.future_person_bound_export_audit_v1((part->>'subjectId')::uuid);
   select b.audit_principal_id,c.audit_principal_id into bound,custody
    from private.future_person_account_bindings b join private.future_person_custody_slices c
     on c.subject_id=b.subject_id and c.claimant_principal_id=b.claimant_principal_id
    where b.subject_id=(part->>'subjectId')::uuid and b.account_id=a;
   if bound is null then raise exception using errcode='42501',message='export_audit_unavailable';end if;
   actors:=array_append(actors,bound);if custody is not null then actors:=array_append(actors,custody);end if;
  else raise exception using errcode='0A000',message='export_partition_projection_unavailable';end if;
 end loop;
 -- ANY selects each canonical row once even if the same issued selector is
 -- represented twice in a graph. It never exports a foreign/null actor.
 if exists(select 1 from public.legal_audit_log where audit_principal_id=any(actors) and seq>9007199254740991) then
  raise exception using errcode='55000',message='export_audit_unavailable';end if;
 select started_at into strict started from private.legal_audit_attribution_config where singleton;
 if p_operation='context' then
  select count(*) into total from public.legal_audit_log where audit_principal_id=any(actors);
  result:=jsonb_build_object('version','account-archive-audit-v1','authorityReceipt',p_authority_receipt,
   'attributionStartedAt',started,'eventCount',total);
 elsif p_operation='ordinary-subject' then
  if not exists(select 1 from jsonb_array_elements(capture->'partitions') x
   where x->>'subjectId'=p_subject_id::text and x->>'class'='ordinary') then
   raise exception using errcode='42501',message='export_audit_unavailable';end if;
  result:=private.export_ordinary_audit_unrecorded_v1(p_subject_id,a);
 else
  select jsonb_build_object('events',coalesce(jsonb_agg(x.row order by x.seq),'[]'),
   'nextAfterSeq',case when count(*)=500 then to_jsonb(max(x.seq)) else 'null'::jsonb end) into result
   from (select seq,jsonb_build_object('seq',seq,'occurred_at',occurred_at,'event_code',event_code,
    'route_id',route_id,'outcome_code',outcome_code,'coded_context',coded_context) row from public.legal_audit_log
    where audit_principal_id=any(actors) and seq>coalesce(p_after_seq,0) order by seq limit 500)x;
 end if;
 if octet_length(result::text)>4000000 then raise exception using errcode='55000',message='export_audit_unavailable';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from capture then
  raise exception using errcode='42501',message='export_audit_unavailable';end if;
 return result;
end $$;
revoke all on function public.export_archive_account_audit_v1(text,uuid,uuid,text,uuid,bigint)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_audit_v1(text,uuid,uuid,text,uuid,bigint) to service_role;
