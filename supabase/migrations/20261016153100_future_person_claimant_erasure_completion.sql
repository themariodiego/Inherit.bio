-- Claimant erasure completion (TEST-LOCAL only; production stays closed).
--
-- The sealed claimed-subject plan (20260930245000) already refuses its final
-- transaction while (a) an identity-document object sealed in the plan has no
-- disposal acknowledgement, or (b) the plan's original ingest session still
-- has its planned published cleanup outstanding (finish_future_person_
-- deletion_v1). Nothing in the registered request continuation or its
-- retention maintenance could produce (b) at all, and (a) only through the
-- generic retention queue after the request had already answered. A genuine
-- approved claimant therefore could never be deleted.
--
-- This adds one closed service door bound to the live source-disposal lease
-- of one sealed plan, after every source part already carries its permanent
-- empty marker. It selects nothing outside that plan, accepts no relation,
-- predicate or object key outside its own sealed inventory, never infers a
-- provider deletion, and never changes a clock, deadline, retention row or the
-- immutable plan envelope. The original published cleanup doors and the
-- existing document-disposal callback do the actual work; sibling canonical
-- sources, embryos and results are never selected.

do $predecessor$
declare target regprocedure:='private.confirm_claim_document_objects_deleted_v1(text[],text)'::regprocedure;
begin
 if not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=target
   and md5(p.prosrc)='997f8d07edb464cf2999af1b408cb5ca' and p.prosecdef and l.lanname='plpgsql'
   and p.proowner=(select oid from pg_roles where rolname='postgres')
   and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text[]=array['postgres=X/postgres','service_role=X/postgres']) then
  raise exception using errcode='55000',message='claimant erasure completion predecessor differs';end if;
 if to_regprocedure('public.future_person_deletion_objects_v1(text,uuid,text,text[])') is not null
  or to_regprocedure('private.future_person_deletion_lease_v1(uuid,text)') is not null
  or to_regprocedure('private.future_person_deletion_document_keys_v1(uuid)') is not null then
  raise exception using errcode='55000',message='claimant erasure completion successor already exists';end if;
 if not exists(select 1 from public.retention_phase_registry where retention_id='future-person.claimant-reverification-until-request'
   and phase_id='future-person-claimed-source-disposal' and phase_kind='purge')
  or to_regprocedure('private.finish_future_person_deletion_v1(uuid,text)') is null
  or to_regprocedure('public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb)') is null
  or to_regprocedure('public.claim_embryo_ingest_object_disposals_v1(uuid,text)') is null
  or to_regprocedure('public.complete_embryo_ingest_unwind_v1(uuid)') is null then
  raise exception using errcode='55000',message='claimant erasure completion prerequisite missing';end if;
end $predecessor$;

-- The exact live source-disposal lease, in the registered subject-first lock
-- order. Only a plan whose every source part already has its verified empty
-- marker qualifies; no graph row, clock or envelope is read for writing.
create function private.future_person_deletion_lease_v1(p_manifest uuid,p_claim_token_hash text)
returns public.retention_due_phases language plpgsql security definer set search_path='' as $$
declare m public.purge_manifests;r public.retention_rows;p public.retention_due_phases;v_now timestamptz;
begin
 if p_manifest is null or p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select * into m from public.purge_manifests where id=p_manifest;
 select * into r from public.retention_rows where id=m.retention_row_id;
 perform 1 from public.subjects where id=r.target_id for update;
 select * into r from public.retention_rows where id=m.retention_row_id for update;
 select * into m from public.purge_manifests where id=p_manifest for update;
 select * into p from public.retention_due_phases where retention_row_id=r.id
  and phase_id=m.phase_id and phase_revision=m.phase_revision for update;
 v_now:=clock_timestamp();
 if m.id is null or m.manifest_class<>'complete-retention' or m.state<>'executing'
  or m.phase_id<>'future-person-claimed-source-disposal' or m.physical_purge_started_at is null
  or m.frozen_manifest_hash is null or r.id is null
  or r.retention_id<>'future-person.claimant-reverification-until-request' or r.target_kind<>'subject' or r.state<>'active'
  or r.fixed_deadline is distinct from r.created_at+interval '7 days'
  or p.retention_row_id is null or p.phase_id<>'future-person-claimed-source-disposal' or p.phase_kind<>'purge'
  or p.status<>'claimed' or p.claim_expires_at is null or p.claim_expires_at<=v_now
  or not private.claim_hash_matches_v1(p.claim_token_hash,p_claim_token_hash)
  or p.phase_deadline is distinct from r.created_at or p.target_id is distinct from r.target_id
  or p.immutable_envelope->>'version' is distinct from 'future-person-deletion-plan-v1'
  or p.immutable_envelope->>'subjectId' is distinct from r.target_id::text
  or m.source_binding_fingerprint is distinct from encode(extensions.digest(convert_to(p.immutable_envelope::text,'UTF8'),'sha256'),'hex')
  or not exists(select 1 from public.subjects s where s.id=r.target_id and s.lifecycle='claimed_unbound'
   and s.owner_account_id is null and s.subject_account_id is null and s.cohort_id is null and s.analysis_stopped_at is not null)
  or not exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.entry_revision<=50)
  or exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.entry_revision<=50 and e.status<>'deleted')
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 return p;
end $$;

-- Exactly the identity objects this plan sealed that the existing retention
-- rules no longer retain: ended-claim documents (never a document an open
-- review still holds), their fragments and their Storage metadata. Keys only;
-- no body, hash, kind or claimant field leaves this helper.
create function private.future_person_deletion_document_keys_v1(p_manifest uuid)
returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(k.object_key order by k.object_key),'{}'::text[]) from (
  select distinct z.object_key from (
   select d.object_key from public.purge_manifest_entries e
    join private.claim_documents d on e.row_key=jsonb_build_object('id',d.id)
    where e.manifest_id=p_manifest and e.entry_revision>50 and e.store_name='private.claim_documents'
     and e.status='pending' and not private.claim_document_retained_v1(d)
   union all
   select f.object_key from public.purge_manifest_entries e
    join private.claim_document_fragments f on e.row_key=jsonb_build_object('session_id',f.session_id,'sequence',f.sequence)
    join private.claim_document_sessions s on s.id=f.session_id
    join private.future_person_claim_intakes i on i.id=s.intake_id
    where e.manifest_id=p_manifest and e.entry_revision>50 and e.store_name='private.claim_document_fragments'
     and e.status='pending'
     and (f.state='delete_pending' or not private.claim_intake_live_v1(i) or s.expires_at<=clock_timestamp())
   union all
   select e.row_key->>'name' from public.purge_manifest_entries e
    where e.manifest_id=p_manifest and e.entry_revision>50 and e.store_name='storage.objects' and e.status='pending'
     and e.row_key->>'bucket_id'='future-person-identity'
     and exists(select 1 from private.claim_documents d join public.purge_manifest_entries q on q.manifest_id=e.manifest_id
      and q.entry_revision>50 and q.store_name='private.claim_documents' and q.row_key=jsonb_build_object('id',d.id)
      where d.object_key=e.row_key->>'name' and not private.claim_document_retained_v1(d))
  ) z where z.object_key is not null order by z.object_key limit 100) k;
$$;

-- One closed service door for the live lease holder:
--   documents          the exact sealed identity keys still to remove;
--   confirm-documents  after the actual Storage removal, those exact keys go
--                      through the existing document-disposal callback;
--   unwind             the plan's own source session's planned published
--                      cleanup, if any is outstanding, for the existing doors.
create function public.future_person_deletion_objects_v1(p_operation text,p_manifest uuid,p_claim_token_hash text,
 p_object_keys text[] default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare p public.retention_due_phases;v_keys text[];v_session uuid;u public.embryo_ingest_unwinds;v_count bigint;
begin
 if p_operation is null or p_operation not in('documents','confirm-documents','unwind')
  or (p_operation<>'confirm-documents' and p_object_keys is not null) then
  raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 p:=private.future_person_deletion_lease_v1(p_manifest,p_claim_token_hash);
 if p_operation='documents' then
  return jsonb_build_object('status','documents','manifestId',p_manifest,
   'objectKeys',to_jsonb(private.future_person_deletion_document_keys_v1(p_manifest)));
 end if;
 if p_operation='confirm-documents' then
  v_keys:=private.future_person_deletion_document_keys_v1(p_manifest);
  if p_object_keys is null or cardinality(p_object_keys) not between 1 and 100
   or array_position(p_object_keys,null) is not null
   or (select count(distinct k) from unnest(p_object_keys) k)<>cardinality(p_object_keys)
   or not (p_object_keys<@v_keys)
   -- The actual provider removal must already have removed its metadata.
   or exists(select 1 from storage.objects o where o.bucket_id='future-person-identity' and o.name=any(p_object_keys)) then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  perform private.confirm_claim_document_objects_deleted_v1(p_object_keys,'api.future-person-delete');
  return jsonb_build_object('status','documents_confirmed','manifestId',p_manifest,
   'remaining',cardinality(private.future_person_deletion_document_keys_v1(p_manifest)));
 end if;
 select x.session_id into v_session from private.embryo_canonical_sources x
  where x.file_id=(p.immutable_envelope->>'sourceFileId')::uuid and x.subject_id=p.target_id;
 if not found then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select count(*) into v_count from public.embryo_ingest_unwinds w
  where w.session_id=v_session and w.purpose='published' and w.state<>'complete';
 if v_count>1 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select * into u from public.embryo_ingest_unwinds w
  where w.session_id=v_session and w.purpose='published' and w.state<>'complete';
 return jsonb_build_object('status','unwind','manifestId',p_manifest,'unwindId',u.id,'state',u.state);
end $$;

create or replace function private.confirm_claim_document_objects_deleted_v1(p_object_keys text[], p_route_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_rows integer;
  v_document record;
begin
  if p_route_id is null or p_route_id not in ('jobs.retention', 'jobs.claim-document-scan', 'api.evidence-complete',
      'api.future-person-delete') then
    raise exception using errcode = '22023', message = 'claim document deletion invalid';
  end if;
  -- The claimant request attributes only identity objects still pending in
  -- an executing sealed claimant plan. It is never a general deletion route.
  if p_route_id = 'api.future-person-delete' and (p_object_keys is null or cardinality(p_object_keys) = 0
    or exists(select 1 from unnest(p_object_keys) k where k is null or not exists(
      select 1 from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
        and m.phase_id='future-person-claimed-source-disposal' and m.state='executing'
      where e.entry_revision>50 and e.status='pending' and (
        (e.store_name='private.claim_documents' and exists(select 1 from private.claim_documents d
          where e.row_key=jsonb_build_object('id',d.id) and d.object_key=k))
        or (e.store_name='private.claim_document_fragments' and exists(select 1 from private.claim_document_fragments f
          where e.row_key=jsonb_build_object('session_id',f.session_id,'sequence',f.sequence) and f.object_key=k)))))) then
    raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  -- A sealed claimant plan never treats an unACKed or uncertain write as
  -- disposable. The actual provider caller must already have removed metadata.
  if exists(select 1 from private.claim_document_sessions ds join private.claim_documents d on d.session_id=ds.id
    join public.purge_manifest_entries e on e.store_name='private.claim_documents' and e.row_key=jsonb_build_object('id',d.id)
    join public.purge_manifests m on m.id=e.manifest_id and m.phase_id='future-person-claimed-source-disposal' and m.state in('frozen','executing')
    where d.object_key=any(p_object_keys) and (ds.state<>'finalized' or ds.complete_nonce_hash is null
      or exists(select 1 from storage.objects o where o.bucket_id='future-person-identity' and o.name=d.object_key))) then
    raise exception using errcode='42501',message='claimant deletion unavailable';end if;
  update public.purge_manifest_entries e set status='deleted'
  from public.purge_manifests m where m.id=e.manifest_id and m.phase_id='future-person-claimed-source-disposal'
   and m.state in('frozen','executing') and e.entry_revision>50 and (
    (e.store_name='private.claim_documents' and exists(select 1 from private.claim_documents d
      where e.row_key=jsonb_build_object('id',d.id) and d.object_key=any(p_object_keys)
       and not private.claim_document_retained_v1(d)))
    or (e.store_name='private.claim_document_fragments' and exists(select 1 from private.claim_document_fragments f
      where e.row_key=jsonb_build_object('session_id',f.session_id,'sequence',f.sequence) and f.object_key=any(p_object_keys)))
    or (e.store_name='storage.objects' and e.row_key->>'bucket_id'='future-person-identity'
      and e.row_key->>'name'=any(p_object_keys)
      and not exists(select 1 from storage.objects o where to_jsonb(o) @> e.row_key)
      and exists(select 1 from private.claim_documents d join public.purge_manifest_entries q on q.manifest_id=m.id
       and q.store_name='private.claim_documents' and q.row_key=jsonb_build_object('id',d.id)
       where d.object_key=e.row_key->>'name' and not private.claim_document_retained_v1(d)))
   );
  delete from private.claim_document_fragments where object_key = any (p_object_keys);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  update private.claim_document_sessions s set planned_object_key = null
  where s.planned_object_key = any (p_object_keys)
    and not exists (select 1 from private.claim_documents d where d.object_key = s.planned_object_key);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;
  for v_document in
    select d.id, d.state, d.refusal_code, d.object_key from private.claim_documents d
    where d.object_key = any (p_object_keys) and d.object_deleted_at is null for update
  loop
    if v_document.state = 'refused' then
      update private.claim_documents set object_deleted_at = clock_timestamp(), lease_hash = null,
        lease_expires_at = null where id = v_document.id;
      perform private.append_legal_audit_event('claim.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', v_document.refusal_code));
    elsif not private.claim_document_retained_v1(
      (select d from private.claim_documents d where d.id = v_document.id)) then
      update private.claim_document_sessions set planned_object_key = null
      where planned_object_key = v_document.object_key;
      delete from private.claim_documents where id = v_document.id;
      perform private.append_legal_audit_event('claim.document.deleted', null, p_route_id, 'purged',
        jsonb_build_object('reason', 'claim-ended'));
    else
      -- A retained document is never deleted by a confirmation.
      continue;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;



revoke all on function private.future_person_deletion_lease_v1(uuid,text),
 private.future_person_deletion_document_keys_v1(uuid),
 public.future_person_deletion_objects_v1(text,uuid,text,text[])
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_deletion_objects_v1(text,uuid,text,text[]) to service_role;

do $successor$
declare target regprocedure:='private.confirm_claim_document_objects_deleted_v1(text[],text)'::regprocedure;
begin
 if not exists(select 1 from pg_proc p where p.oid=target and md5(p.prosrc)='8d6cab2cfbc1f24a89602a4a05ca82f0' and p.prosecdef
   and p.proowner=(select oid from pg_roles where rolname='postgres') and p.proconfig=array['search_path=""']::text[]
   and p.proacl::text[]=array['postgres=X/postgres','service_role=X/postgres']) then
  raise exception using errcode='55000',message='claimant erasure completion successor differs';end if;
 if exists(select 1 from unnest(array['anon','authenticated','inherit_upload_only']) role
   where has_function_privilege(role,'public.future_person_deletion_objects_v1(text,uuid,text,text[])','execute'))
  or not has_function_privilege('service_role','public.future_person_deletion_objects_v1(text,uuid,text,text[])','execute')
  or exists(select 1 from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role
   where has_function_privilege(role,'private.future_person_deletion_lease_v1(uuid,text)','execute')
    or has_function_privilege(role,'private.future_person_deletion_document_keys_v1(uuid)','execute')) then
  raise exception using errcode='55000',message='claimant erasure completion privileges differ';end if;
end $successor$;
