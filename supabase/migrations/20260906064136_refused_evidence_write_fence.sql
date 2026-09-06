-- Refusal may erase only its own evidence package. Legal references outside
-- that package are independent authority, even without another ingest session.
create or replace function private.assert_refused_evidence_exclusive_v1(p_kind text,p_draft uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare objects uuid[]; reviewed uuid[];
begin
 select coalesce(array_agg(object_id),'{}'::uuid[]) into objects
 from private.refused_draft_evidence_objects_v1(p_kind,p_draft);
 select coalesce(array_agg(d.reviewed_evidence_id) filter(where d.reviewed_evidence_id is not null),'{}'::uuid[])
 into reviewed from public.legal_evidence_documents d
 join public.legal_evidence_ingest_sessions s on s.id=d.session_id
 where s.target_kind=p_kind and s.target_id=p_draft;
 if exists(
  select 1 from public.legal_evidence_ingest_sessions s
  cross join lateral private.refused_draft_evidence_objects_v1(s.target_kind,s.target_id) o
  where (s.target_kind<>p_kind or s.target_id<>p_draft) and o.object_id=any(objects)
 ) or exists(
  select 1 from public.reviewed_evidence r join public.legal_reviews lr on lr.id=r.review_id
  where (r.id=any(reviewed) or r.storage_object_id=any(objects)) and
   (not(r.id=any(reviewed)) or lr.target_id<>p_draft
    or lr.target_kind<>case p_kind when 'cohort_draft' then 'single_parent_basis' else 'adult_control' end)
 ) or exists(select 1 from public.embryo_basis_bindings where reviewed_evidence_id=any(reviewed)
   or legal_review_id in(select review_id from public.reviewed_evidence where id=any(reviewed)))
 or exists(select 1 from public.future_person_claim_documents where reviewed_evidence_id=any(reviewed))
 or exists(select 1 from public.future_person_claim_objections where reviewed_evidence_id=any(reviewed))
 or exists(select 1 from public.correction_assignments where reviewed_evidence_id=any(reviewed))
 or exists(select 1 from public.appeal_evidence where reviewed_evidence_id=any(reviewed))
 then raise exception using errcode='55000',message='refusal_purge_evidence_shared'; end if;
end;
$$;
revoke all on function private.assert_refused_evidence_exclusive_v1(text,uuid) from public,anon,authenticated;
grant execute on function private.assert_refused_evidence_exclusive_v1(text,uuid) to service_role;

-- A statement trigger takes the same lock before row locks. A row-only lock
-- trigger would invert the refusal/worker lock order on concurrent updates.
create or replace function private.lock_evidence_transition_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin perform private.lock_invitation_transitions_v1(); return null; end;
$$;
revoke all on function private.lock_evidence_transition_v1() from public,anon,authenticated;
grant execute on function private.lock_evidence_transition_v1() to service_role;

create or replace function private.assert_evidence_session_writable_v1(p_session uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.legal_evidence_ingest_sessions%rowtype;
begin
 select * into s from public.legal_evidence_ingest_sessions where id=p_session;
 if s.id is null or s.state in('cancelled','expired') or s.expires_at<=clock_timestamp()
  or (s.target_kind='cohort_draft' and not exists(select 1 from public.embryo_cohort_drafts
    where id=s.target_id and state in('draft','evidence_pending','ready') and fixed_expires_at>clock_timestamp()))
  or (s.target_kind='adult_draft' and not exists(select 1 from public.adult_subject_drafts
    where id=s.target_id and state in('draft','invited') and fixed_expires_at>clock_timestamp()))
 then raise exception using errcode='55000',message='evidence_session_closed'; end if;
end;
$$;
revoke all on function private.assert_evidence_session_writable_v1(uuid) from public,anon,authenticated;
grant execute on function private.assert_evidence_session_writable_v1(uuid) to service_role;

create or replace function private.assert_evidence_attachment_current_v1(p_object uuid,p_reviewed uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare s uuid; original uuid;
begin
 if p_reviewed is not null then
  if exists(select 1 from public.reviewed_evidence where id=p_reviewed and purged_at is not null) then
   raise exception using errcode='55000',message='evidence_attachment_closed';
  end if;
  select storage_object_id into original from public.reviewed_evidence where id=p_reviewed;
  for s in select session_id from public.legal_evidence_documents where reviewed_evidence_id=p_reviewed loop
   perform private.assert_evidence_session_writable_v1(s);
  end loop;
 end if;
 -- Frozen IDs stay unusable after relational cleanup; an old reviewed row
 -- cannot resurrect a Storage object or be attached to a new authority graph.
 if exists(select 1 from public.purge_manifest_entries e
  join public.purge_manifests m on m.id=e.manifest_id
  join public.retention_due_phases p on p.retention_row_id=m.retention_row_id
    and p.phase_id=m.phase_id and p.phase_revision=m.phase_revision
  where p.immutable_envelope->>'reason'='invitation-refused'
   and e.target_id='storage-objects' and e.store_name='storage.objects'
   and coalesce(e.object_id,(e.row_key->>'objectId')::uuid) in(p_object,original))
 then raise exception using errcode='55000',message='evidence_attachment_closed'; end if;
 if p_object is not null then
  for s in
   select f.session_id from public.legal_evidence_fragments f where f.object_id=p_object
   union select d.session_id from public.legal_evidence_documents d where d.object_id=p_object
   union select d.session_id from public.legal_evidence_review_copies c
    join public.legal_evidence_documents d on d.id=c.document_id where c.object_id=p_object
   union select d.session_id from public.reviewed_evidence r
    join public.legal_evidence_documents d on d.reviewed_evidence_id=r.id where r.storage_object_id=p_object
  loop perform private.assert_evidence_session_writable_v1(s); end loop;
 end if;
end;
$$;
revoke all on function private.assert_evidence_attachment_current_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function private.assert_evidence_attachment_current_v1(uuid,uuid) to service_role;

create or replace function private.fence_evidence_write_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare n jsonb:=to_jsonb(new); o jsonb; session uuid; reviewed uuid;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old); end if;
 if tg_table_name='legal_evidence_ingest_sessions' then
  if tg_op='UPDATE' then
   if (n-'state'-'expires_at') is distinct from (o-'state'-'expires_at')
    or (old.state in('cancelled','expired') and new.state not in('cancelled','expired'))
   then raise exception using errcode='55000',message='evidence_session_closed'; end if;
  end if;
  if new.state not in('cancelled','expired') and (
   (new.target_kind='cohort_draft' and not exists(select 1 from public.embryo_cohort_drafts
     where id=new.target_id and state in('draft','evidence_pending','ready') and fixed_expires_at>clock_timestamp()))
   or (new.target_kind='adult_draft' and not exists(select 1 from public.adult_subject_drafts
     where id=new.target_id and state in('draft','invited') and fixed_expires_at>clock_timestamp())))
  then raise exception using errcode='55000',message='evidence_session_closed'; end if;
 elsif tg_table_name in('legal_evidence_fragments','legal_evidence_documents',
   'legal_evidence_review_copies','legal_evidence_working_data','legal_evidence_assignments') then
  if n ? 'session_id' then session:=(n->>'session_id')::uuid;
  else select session_id into session from public.legal_evidence_documents where id=(n->>'document_id')::uuid; end if;
  perform private.assert_evidence_session_writable_v1(session);
  if tg_op='UPDATE' then
   if (n->>'session_id') is distinct from (o->>'session_id')
    or (n->>'document_id') is distinct from (o->>'document_id')
   then raise exception using errcode='55000',message='evidence_attachment_closed'; end if;
  end if;
  perform private.assert_evidence_attachment_current_v1((n->>'object_id')::uuid,(n->>'reviewed_evidence_id')::uuid);
 elsif tg_table_name='reviewed_evidence' then
  -- The cleanup executor may release the original, keeping only its minimal
  -- review receipt. No storage mutation or authority substitution is allowed.
  if tg_op='UPDATE' and new.storage_object_id is null and new.purged_at is not null
   and (n-'storage_object_id'-'purged_at')=(o-'storage_object_id'-'purged_at') then return new; end if;
  if tg_op='UPDATE' then perform private.assert_evidence_attachment_current_v1(old.storage_object_id,old.id); end if;
  perform private.assert_evidence_attachment_current_v1(new.storage_object_id,new.id);
 elsif tg_table_name='legal_reviews' then
  if tg_op='UPDATE' and (new.target_kind,new.target_id) is distinct from (old.target_kind,old.target_id) then
   for reviewed in select id from public.reviewed_evidence where review_id=old.id loop
    perform private.assert_evidence_attachment_current_v1(null,reviewed);
   end loop;
  end if;
 elsif tg_table_name='embryo_basis_bindings' then
  if tg_op='INSERT' or new.reviewed_evidence_id is distinct from old.reviewed_evidence_id then
   perform private.assert_evidence_attachment_current_v1(null,new.reviewed_evidence_id);
  end if;
  if tg_op='INSERT' or new.legal_review_id is distinct from old.legal_review_id then
   for reviewed in select id from public.reviewed_evidence where review_id=new.legal_review_id loop
    perform private.assert_evidence_attachment_current_v1(null,reviewed);
   end loop;
  end if;
 elsif tg_op='INSERT' or (n->>'reviewed_evidence_id') is distinct from (o->>'reviewed_evidence_id') then
  perform private.assert_evidence_attachment_current_v1(null,(n->>'reviewed_evidence_id')::uuid);
 end if;
 return new;
end;
$$;
revoke all on function private.fence_evidence_write_v1() from public,anon,authenticated;
grant execute on function private.fence_evidence_write_v1() to service_role;

do $$
declare t text;
begin
 foreach t in array array['legal_evidence_ingest_sessions','legal_evidence_fragments',
  'legal_evidence_documents','legal_evidence_review_copies','legal_evidence_working_data',
  'legal_evidence_assignments','reviewed_evidence','legal_reviews','embryo_basis_bindings',
  'future_person_claim_documents','future_person_claim_objections','correction_assignments','appeal_evidence']
 loop
  execute format('create trigger evidence_transition_lock before insert or update or delete on public.%I
   for each statement execute function private.lock_evidence_transition_v1()',t);
  execute format('create trigger evidence_write_fence before insert or update on public.%I
   for each row execute function private.fence_evidence_write_v1()',t);
 end loop;
end;
$$;

create or replace function public.authorize_refused_invitation_storage_v1(
 p_manifest_id uuid,p_claim_token_hash text,p_ordinals bigint[]
)
returns boolean language plpgsql security invoker set search_path='' as $$
declare p public.retention_due_phases%rowtype;
begin
 p:=private.lock_refused_draft_purge_v1(p_manifest_id,p_claim_token_hash);
 perform private.assert_refused_evidence_exclusive_v1(
  case when p.target_kind='cohort' then 'cohort_draft' else 'adult_draft' end,p.target_id);
 if p_ordinals is null or cardinality(p_ordinals) not between 1 and 1000
  or cardinality(p_ordinals)<>(select count(distinct x) from unnest(p_ordinals) x)
  or exists(select 1 from unnest(p_ordinals) n where not exists(
   select 1 from public.purge_manifest_entries e where e.manifest_id=p_manifest_id
    and e.entry_revision=n and e.target_id='storage-objects' and e.store_name='storage.objects'
    and e.row_key is not null and e.status='pending'
  )) then raise exception using errcode='22023',message='refusal_purge_batch_invalid'; end if;
 return true;
end;
$$;
revoke all on function public.authorize_refused_invitation_storage_v1(uuid,text,bigint[]) from public,anon,authenticated;
grant execute on function public.authorize_refused_invitation_storage_v1(uuid,text,bigint[]) to service_role;

create or replace function public.claim_refused_invitation_draft_purge_v1(p_claim_token_hash text)
returns table(manifest_id uuid,storage_objects jsonb)
language plpgsql security invoker set search_path='' as $$
declare p public.retention_due_phases%rowtype; m public.purge_manifests%rowtype;
 k text; v_objects uuid[]; v_max bigint;
begin
 if p_claim_token_hash is null or p_claim_token_hash !~ '^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_retention_claim';
 end if;
 perform private.lock_invitation_transitions_v1();
 select r.* into p from public.retention_due_phases r
 where r.immutable_envelope->>'reason'='invitation-refused'
  and r.retention_id in('embryo.cohort-draft-30d','adult.subject-draft-30d')
  and r.phase_deadline<=clock_timestamp()
  and (r.status in('pending','retry') or (r.status='claimed' and r.claim_expires_at<=clock_timestamp()))
 order by r.phase_deadline,r.retention_row_id for update skip locked limit 1;
 if p.retention_row_id is null then return; end if;
 k:=private.assert_refused_draft_v1(p);
 perform private.assert_refused_evidence_exclusive_v1(k,p.target_id);
 select x.* into strict m from public.purge_manifests x
 where x.retention_row_id=p.retention_row_id and x.phase_id=p.phase_id and x.phase_revision=p.phase_revision
  and x.manifest_class=case when k='cohort_draft' then 'cohort-draft-complete' else 'adult-draft-complete' end
  and x.state in('frozen','executing') for update;
 select coalesce(array_agg(o.object_id),'{}'::uuid[]) into v_objects
 from private.refused_draft_evidence_objects_v1(k,p.target_id) o;
 if exists(select 1 from public.purge_manifest_entries e where e.manifest_id=m.id
  and (e.target_id<>'storage-objects' or e.store_name<>'storage.objects'
   or not(coalesce(e.object_id,(e.row_key->>'objectId')::uuid)=any(v_objects)))) then
  raise exception using errcode='55000',message='refusal_purge_manifest_scope_invalid';
 end if;
 -- Reject an object claimed by an unrelated evidence package before any
 -- storage call. Shared reviewed evidence cannot be silently destroyed.
 if exists(
  select 1 from public.legal_evidence_ingest_sessions s
  cross join lateral private.refused_draft_evidence_objects_v1(s.target_kind,s.target_id) o
  where (s.target_kind<>k or s.target_id<>p.target_id) and o.object_id=any(v_objects)
 ) then raise exception using errcode='55000',message='refusal_purge_evidence_shared'; end if;
 if exists(select 1 from storage.objects o where o.id=any(v_objects) and o.bucket_id<>'legal-evidence') then
  raise exception using errcode='55000',message='refusal_purge_storage_binding_invalid';
 end if;
 -- Include reviewed-evidence object copies as well as fragments/documents.
 -- Resume never overwrites an already-frozen address or receipt.
 select coalesce(max(e.entry_revision),0) into v_max from public.purge_manifest_entries e
 where e.manifest_id=m.id;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,object_id,entry_revision,status)
 select m.id,'storage-objects','storage.objects',o.object_id,v_max+row_number() over(order by o.object_id),'pending'
 from unnest(v_objects) o(object_id) where not exists(
  select 1 from public.purge_manifest_entries e where e.manifest_id=m.id
   and (e.object_id=o.object_id or e.row_key->>'objectId'=o.object_id::text)
 );
 -- A UUID reference is converted to an immutable address only by resolving
 -- that exact Storage row. SQL never deletes Storage metadata.
 update public.purge_manifest_entries e set object_id=null,
  row_key=jsonb_build_object('objectId',o.id,'bucketId',o.bucket_id,'objectName',o.name)
 from storage.objects o where e.manifest_id=m.id and e.object_id=o.id
  and e.target_id='storage-objects' and e.store_name='storage.objects' and e.status='pending';
 update public.purge_manifest_entries e set status='missing'
 where e.manifest_id=m.id and e.object_id is not null and e.status='pending'
  and not exists(select 1 from storage.objects o where o.id=e.object_id);
 update public.retention_due_phases set status='claimed',claim_token_hash=p_claim_token_hash,
  claim_expires_at=clock_timestamp()+interval '5 minutes',attempts=least(attempts+1,20)
 where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision;
 update public.purge_manifests set state='executing' where id=m.id;
 return query select m.id,coalesce(jsonb_agg(e.row_key||jsonb_build_object('ordinal',e.entry_revision)
  order by e.entry_revision) filter(where e.status='pending'),'[]'::jsonb)
 from public.purge_manifest_entries e where e.manifest_id=m.id;
end;
$$;

create or replace function private.lock_refused_draft_purge_v1(p_manifest uuid,p_claim text)
returns public.retention_due_phases language plpgsql security invoker set search_path='' as $$
declare p public.retention_due_phases%rowtype; m public.purge_manifests%rowtype;
begin
 perform private.lock_invitation_transitions_v1();
 select r.* into p from public.retention_due_phases r join public.purge_manifests x
  on x.retention_row_id=r.retention_row_id and x.phase_id=r.phase_id and x.phase_revision=r.phase_revision
 where x.id=p_manifest for update of r;
 select * into m from public.purge_manifests where id=p_manifest for update;
 if p.retention_row_id is null or p.status<>'claimed' or p_claim is null
  or p.claim_token_hash is distinct from p_claim or p.claim_expires_at<=clock_timestamp()
  or m.state<>'executing' then
  raise exception using errcode='55000',message='refusal_purge_claim_stale';
 end if;
 perform private.assert_refused_draft_v1(p);
 perform private.assert_refused_evidence_exclusive_v1(
  case when p.target_kind='cohort' then 'cohort_draft' else 'adult_draft' end,p.target_id);
 return p;
end;
$$;
