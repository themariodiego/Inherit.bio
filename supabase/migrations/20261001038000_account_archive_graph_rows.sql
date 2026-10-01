-- Exact original current-capture and v1 ABI/config/ACL predecessor. This is a
-- source guard; no database execution is inferred by a static hash comparison.
do $$ begin
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.export_account_owned_capture_v1(jsonb,text,uuid)')
  and p.proowner='postgres'::regrole and p.prokind='f' and p.proargmodes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict and p.provolatile='v' and p.proparallel='u'
  and p.prorettype='jsonb'::regtype and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
  and p.proargnames=array['p_origin','p_target_kind','p_target_id']::text[] and p.pronargdefaults=0 and p.proargdefaults is null
  and md5(p.prosrc)='838abdf91899078e4ebd2108855fa477') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r
   where has_function_privilege(r,'private.export_account_owned_capture_v1(jsonb,text,uuid)','execute') is distinct from (r='service_role' and false)) then
  raise exception using errcode='55000',message='export_graph_predecessor_unavailable';end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)')
  and p.proowner='postgres'::regrole and p.prokind='f' and p.proargmodes is null
  and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql') and p.prosecdef and not p.proisstrict and p.provolatile='v' and p.proparallel='u'
  and p.prorettype='jsonb'::regtype and p.proconfig=array['search_path=""','lock_timeout=250ms']::text[]
  and p.proargnames=array['p_operation','p_export_id','p_attempt_id','p_authority_receipt','p_kind','p_after_id']::text[]
  and p.pronargdefaults=2 and pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::text, NULL::uuid'
  and md5(p.prosrc)='f507460661d38675089092548b33e590') or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r
   where has_function_privilege(r,'public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)','execute') is distinct from (r='service_role' and true)) then
  raise exception using errcode='55000',message='export_graph_predecessor_unavailable';end if;
 if pg_catalog.to_regprocedure('private.export_account_graph_cursor_v1(text,jsonb)') is not null
  or pg_catalog.to_regprocedure('private.export_account_graph_projection_v1(uuid,uuid[],text)') is not null
  or pg_catalog.to_regprocedure('public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb)') is not null then
  raise exception using errcode='55000',message='export_graph_predecessor_unavailable';end if;
end $$;

-- NEXT-RELEASE closed graph metadata pages only. This adds no store or authority.
-- Both existing014 graph refusal and029 nonempty-class refusal remain in force.
-- The API-denied projector is not a current partition/grant/source permission.
create function private.export_account_graph_cursor_v1(p_kind text,p_key jsonb)
returns text language plpgsql immutable security definer set search_path='' as $$
declare n integer;item jsonb;part text;revision numeric;
begin
 if p_kind is null or p_kind not in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs')
  or jsonb_typeof(p_key) is distinct from 'array' then raise exception using errcode='22023',message='invalid_request';end if;
 n:=case p_kind when 'embryo_participant_sets' then 4 when 'embryo_disposition_confirmations' then 2 else 1 end;
 if jsonb_array_length(p_key)<>n then raise exception using errcode='22023',message='invalid_request';end if;
 for item in select value from jsonb_array_elements(p_key) with ordinality e(value,position)
  where position=1 or (p_kind='embryo_participant_sets' and position=3) or (p_kind='embryo_disposition_confirmations' and position=2) loop
  part:=item#>>'{}';
  if jsonb_typeof(item) is distinct from 'string' or part is null or part!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception using errcode='22023',message='invalid_request';end if;
 end loop;
 if p_kind='embryo_participant_sets' then
  if jsonb_typeof(p_key->1) is distinct from 'string' or p_key->>1 not in('required_upload_principals','disposition_authorities',
   'notice_recipients','record_key_recipients','attribution_principals') or jsonb_typeof(p_key->3) is distinct from 'number' then
   raise exception using errcode='22023',message='invalid_request';end if;
  revision:=(p_key->>3)::numeric;
  if revision<>trunc(revision) or revision<1 or revision>9007199254740991 then raise exception using errcode='22023',message='invalid_request';end if;
  return format('["%s","%s","%s",%s]',p_key->>0,p_key->>1,p_key->>2,revision::bigint);
 elsif p_kind='embryo_disposition_confirmations' then return format('["%s","%s"]',p_key->>0,p_key->>1);
 else return format('["%s"]',p_key->>0);end if;
end $$;
revoke all on function private.export_account_graph_cursor_v1(text,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;

create function private.export_account_graph_projection_v1(p_account uuid,p_subjects uuid[],p_kind text)
returns table(projected_key jsonb,projected_row jsonb)
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare cohorts uuid[];
begin
 if p_account is null or p_subjects is null or array_position(p_subjects,null) is not null then raise exception using errcode='22023',message='invalid_request';end if;
 -- Presence selection follows the original029 physical actor/FK inventory.
 -- Current whole-account authorization is exclusively the caller's real capture.
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into cohorts from(
  select c.id from public.embryo_cohorts c where c.owner_account_id=p_account
  union select s.cohort_id from public.embryo_participant_sets s join public.subject_principals p on p.id=s.principal_id where p.account_id=p_account)x;
 if p_kind='embryo_cohorts' then
  return query select jsonb_build_array(c.id),jsonb_build_object('id',c.id,'owner_is_requester',c.owner_account_id=p_account,
   'upload_class',c.upload_class,'basis_case',c.basis_case,'basis_revision',c.basis_revision,'participant_set_revision',c.participant_set_revision,
   'donor_attribution_revision',c.donor_attribution_revision,'recipient_set_revision',c.recipient_set_revision,'key_revision',c.key_revision,
   'lifecycle_revision',c.lifecycle_revision,'ingest_revision',c.ingest_revision,'publication_revision',c.publication_revision,'status',c.status,
   'embryo_count',c.embryo_count,'retention_expires_at',c.retention_expires_at,'created_at',c.created_at,'uploaded_at',c.uploaded_at,'qc_failed_at',c.qc_failed_at)
   from public.embryo_cohorts c where c.id=any(cohorts);
 elsif p_kind='embryo_basis_bindings' then
  return query select jsonb_build_array(b.cohort_id),jsonb_build_object('cohort_id',b.cohort_id,'basis_case',b.basis_case,'basis_revision',b.basis_revision,
   'participant_set_revision',b.participant_set_revision,'case_artifact_signature_recorded',b.case_artifact_signature_id is not null,
   'reviewed_evidence_recorded',b.reviewed_evidence_id is not null,'legal_review_recorded',b.legal_review_id is not null,
   'artifact_matrix_fingerprint',b.artifact_matrix_fingerprint,'created_at',b.created_at) from public.embryo_basis_bindings b where b.cohort_id=any(cohorts);
 elsif p_kind='embryo_participant_sets' then
  return query select jsonb_build_array(s.cohort_id,s.set_kind,s.principal_id,s.membership_revision),jsonb_build_object('cohort_id',s.cohort_id,
   'set_kind',s.set_kind,'participant_is_requester',exists(select 1 from public.subject_principals p where p.id=s.principal_id and p.account_id=p_account),
   'set_revision',s.set_revision,'membership_revision',s.membership_revision,'created_at',s.created_at,'revoked_at',s.revoked_at)
   from public.embryo_participant_sets s where s.cohort_id=any(cohorts) or s.principal_id in(select id from public.subject_principals where account_id=p_account);
 elsif p_kind='embryo_donor_attributions' then
  return query select jsonb_build_array(d.id),jsonb_build_object('id',d.id,'cohort_id',d.cohort_id,'donor_slot',d.donor_slot,
   'donor_is_requester',exists(select 1 from public.subject_principals p where p.id=d.donor_principal_id and p.account_id=p_account),
   'signature_recorded',d.signature_id is not null,'classification',d.classification,'attribution_revision',d.attribution_revision,
   'created_at',d.created_at,'revoked_at',d.revoked_at) from public.embryo_donor_attributions d
   where d.cohort_id=any(cohorts) or d.donor_principal_id in(select id from public.subject_principals where account_id=p_account);
 elsif p_kind='embryo_disposition_proposals' then
  return query select jsonb_build_array(p.id),jsonb_build_object('id',p.id,'embryo_id',p.embryo_id,'proposer_is_requester',exists(
   select 1 from public.subject_principals s where s.id=p.proposer_principal_id and s.account_id=p_account),'disposition',p.disposition,
   'basis_revision',p.basis_revision,'authority_set_revision',p.authority_set_revision,'status',p.status,'expires_at',p.expires_at,
   'created_at',p.created_at,'confirmed_at',p.confirmed_at) from public.embryo_disposition_proposals p join public.embryos e on e.id=p.embryo_id
   where e.cohort_id=any(cohorts) or p.proposer_principal_id in(select id from public.subject_principals where account_id=p_account);
 elsif p_kind='embryo_disposition_confirmations' then
  return query select jsonb_build_array(c.proposal_id,c.confirmer_principal_id),jsonb_build_object('proposal_id',c.proposal_id,
   'confirmer_is_requester',exists(select 1 from public.subject_principals s where s.id=c.confirmer_principal_id and s.account_id=p_account),
   'authority_revision',c.authority_revision,'confirmed_at',c.confirmed_at) from public.embryo_disposition_confirmations c
   join public.embryo_disposition_proposals p on p.id=c.proposal_id join public.embryos e on e.id=p.embryo_id
   where e.cohort_id=any(cohorts) or c.confirmer_principal_id in(select id from public.subject_principals where account_id=p_account);
 elsif p_kind='family_pairs' then
  return query select jsonb_build_array(p.id),jsonb_build_object('id',p.id,'pair_revision',p.pair_revision,'status',p.status,'created_at',p.created_at)
   from public.family_pairs p where p.subject_a_id=any(p_subjects) or p.subject_b_id=any(p_subjects);
 else raise exception using errcode='22023',message='invalid_request';end if;
end $$;
revoke all on function private.export_account_graph_projection_v1(uuid,uuid[],text) from public,anon,authenticated,service_role,inherit_upload_only;

create function public.export_archive_account_graph_rows_v1(p_export_id uuid,p_attempt_id uuid,p_authority_receipt text,p_kind text,p_after_key jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare permit jsonb;captured jsonb;subjects uuid[];item record;rows jsonb:='[]';total bigint:=0;page_count integer:=0;last_key jsonb;
 digest bytea;identity text;exists_after boolean:=p_after_key is null;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception using errcode='42501',message='not_found';end if;
 if p_kind is null or p_kind not in('embryo_cohorts','embryo_basis_bindings','embryo_participant_sets','embryo_donor_attributions',
  'embryo_disposition_proposals','embryo_disposition_confirmations','family_pairs') then raise exception using errcode='22023',message='invalid_request';end if;
 if p_after_key is not null then perform private.export_account_graph_cursor_v1(p_kind,p_after_key);end if;
 permit:=private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt);
 if permit->>'targetKind' is distinct from 'account' then raise exception using errcode='42501',message='not_found';end if;
 -- DO NOT replace with a projected/presence-derived permission. In this release
 -- the unchanged014/029 guards still refuse every nonempty unproved graph.
 captured:=private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid);
 if captured#>'{authority,subjectPartitions}' is distinct from permit->'partitions' then raise exception using errcode='42501',message='not_found';end if;
 select array_agg(x::uuid order by x) into subjects from jsonb_array_elements_text(permit->'partitions')x;
 digest:=extensions.digest(convert_to('account-graph-source-v1|'||p_kind,'UTF8'),'sha256');
 for item in select * from private.export_account_graph_projection_v1((permit#>>'{origin,accountId}')::uuid,subjects,p_kind)
  order by projected_key->>0 collate "C",coalesce(projected_key->>1,'') collate "C",coalesce(projected_key->>2,'') collate "C",coalesce((projected_key->>3)::bigint,0) loop
  identity:=private.export_account_graph_cursor_v1(p_kind,item.projected_key);
  if octet_length(item.projected_row::text)>8192 then raise exception using errcode='55000',message='export_class_projection_unavailable';end if;
  total:=total+1;
  digest:=extensions.digest(digest||convert_to(identity||':'||item.projected_row::text||E'\n','UTF8'),'sha256');
  if item.projected_key=p_after_key then exists_after:=true;end if;
  if page_count<500 and (p_after_key is null or
   (item.projected_key->>0 collate "C",coalesce(item.projected_key->>1,'') collate "C",coalesce(item.projected_key->>2,'') collate "C",coalesce((item.projected_key->>3)::bigint,0))>
   (p_after_key->>0 collate "C",coalesce(p_after_key->>1,'') collate "C",coalesce(p_after_key->>2,'') collate "C",coalesce((p_after_key->>3)::bigint,0))) then
   rows:=rows||jsonb_build_array(jsonb_build_object('identity',identity,'rowText',item.projected_row::text));page_count:=page_count+1;last_key:=item.projected_key;
  end if;
 end loop;
 if total>9007199254740991 or not exists_after then raise exception using errcode='22023',message='invalid_request';end if;
 if private.export_account_archive_attempt_v1(p_export_id,p_attempt_id,p_authority_receipt) is distinct from permit
  or private.export_account_owned_capture_v1(permit->'origin','account',(permit->>'targetId')::uuid) is distinct from captured then
  raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('version','account-graph-page-v1','kind',p_kind,'authorityReceipt',p_authority_receipt,
  'membership',jsonb_build_object('rows',total,'sha256',encode(digest,'hex')),'rows',rows,'nextAfterKey',case when page_count=500 then last_key else null end);
end $$;
revoke all on function public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_account_graph_rows_v1(uuid,uuid,text,text,jsonb) to service_role;
