-- A claimed source can outlive its parent's live cohort/session. Freeze its
-- exact immutable part inventory under the existing retention stores; no
-- parent selector, ownership rewrite, replacement source or new store.
-- This is a private prerequisite. The public deletion-accepted door remains
-- closed until complete subject/body/export graph cleanup is proved.
insert into public.retention_phase_registry(retention_id,phase_id,phase_kind)
values('source.revocation-7d','future-person-claimed-source-disposal','purge');

create function private.assert_future_person_deletion_plan_v1(p_manifest uuid)
returns public.retention_due_phases language plpgsql security definer set search_path='' as $$
declare m public.purge_manifests; p public.retention_due_phases; r public.retention_rows;
 s public.subjects; c private.future_person_custody_slices; x private.embryo_canonical_sources; n bigint;
begin
 select * into m from public.purge_manifests where id=p_manifest for update;
 select * into r from public.retention_rows where id=m.retention_row_id;
 select * into p from public.retention_due_phases where retention_row_id=r.id
   and phase_id=m.phase_id and phase_revision=m.phase_revision for update;
 select * into s from public.subjects where id=r.target_id for update;
 select * into c from private.future_person_custody_slices where subject_id=s.id;
 select * into x from private.embryo_canonical_sources where file_id=c.source_file_id;
 if m.id is null or m.manifest_class<>'complete-retention' or m.state not in('frozen','executing')
   or r.retention_id<>'source.revocation-7d' or r.target_kind<>'subject' or r.state<>'active'
   or p.phase_id<>'future-person-claimed-source-disposal' or p.status not in('pending','retry','claimed')
   or s.id is null or s.lifecycle<>'claimed_unbound' or s.owner_account_id is not null
   or s.subject_account_id is not null or s.cohort_id is not null or s.analysis_stopped_at is null
   or c.subject_id is null or c.claimant_principal_id is distinct from s.claimant_principal_id
   or x.file_id is null or x.subject_id is distinct from s.id
   or (c.source_sha256,c.source_membership_sha256,c.publication_revision,c.historical_cohort_id)
     is distinct from (x.source_sha256,x.membership_sha256,x.publication_revision,x.cohort_id)
   or p.immutable_envelope is distinct from jsonb_build_object('version','future-person-deletion-plan-v1',
     'subjectId',s.id,'claimantPrincipalId',c.claimant_principal_id,'sourceFileId',x.file_id,
     'sourceSha256',x.source_sha256,'membershipSha256',x.membership_sha256,
     'publicationRevision',x.publication_revision,'subjectBindingRevision',s.subject_binding_revision,
     'subjectLifecycleRevision',s.lifecycle_revision,'requestedAt',r.created_at,
     'sourceDeadline',r.created_at+interval '7 days','completionDeadline',r.created_at+interval '30 days')
   or r.fixed_deadline is distinct from r.created_at+interval '7 days'
   or p.phase_deadline is distinct from r.created_at
   or m.source_binding_fingerprint is distinct from encode(extensions.digest(convert_to(p.immutable_envelope::text,'UTF8'),'sha256'),'hex')
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.assert_future_person_subject_custody_v1(s.id);
 select count(*) into n from public.purge_manifest_entries where manifest_id=m.id;
 if n<>x.part_count or n not between 1 and 50 or exists(
   select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and
     (e.target_id<>'variant-rows' or e.store_name<>'private.embryo_canonical_parts' or e.object_id is not null
       or e.status not in('pending','deleted') or not exists(
         select 1 from private.embryo_canonical_source_parts b join private.embryo_canonical_parts a on a.id=b.part_id
         where b.file_id=x.file_id and b.sequence=e.entry_revision-1 and a.sequence=b.sequence
           and a.state='landed' and a.write_expires_at<=r.created_at
           and a.session_id=x.session_id and a.worker_job_id=x.worker_job_id and a.attempt=x.attempt
           and a.sample_ordinal=x.sample_ordinal and e.row_key=to_jsonb(a))))
   or exists(select 1 from private.embryo_canonical_source_parts b where b.file_id=x.file_id and not exists(
     select 1 from public.purge_manifest_entries e where e.manifest_id=m.id and e.entry_revision=b.sequence+1
       and e.row_key->>'id'=b.part_id::text))
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 return p;
end $$;

create function private.prepare_future_person_deletion_v1(p_session_hash text,p_nonce text)
returns uuid language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare rs public.rights_sessions;s public.subjects;c private.future_person_custody_slices;
 x private.embryo_canonical_sources;v_now timestamptz;r uuid;m uuid;env jsonb;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 select * into s from public.subjects where id=rs.target_id for update;
 select * into c from private.future_person_custody_slices where subject_id=s.id for update;
 select * into x from private.embryo_canonical_sources where file_id=c.source_file_id for update;
 perform private.assert_future_person_subject_custody_v1(s.id);
 v_now:=clock_timestamp();
 -- Until the real archive cleanup door can prove every reservation absent,
 -- any archive attempt is a refusal, including unACKed/uncertain writes.
 if x.file_id is null or (select count(*) from public.genome_files where subject_id=s.id)<>1
   or exists(select 1 from private.export_archive_attempts a join public.generated_exports e on e.id=a.export_id
      where e.target_kind='subject' and e.target_id=s.id)
   or exists(select 1 from public.retention_rows q where q.retention_id='source.revocation-7d'
      and q.target_kind='subject' and q.target_id=s.id and q.state in('scheduled','active'))
   or (select count(*) from private.embryo_canonical_source_parts where file_id=x.file_id)<>x.part_count
   or exists(select 1 from private.embryo_canonical_source_parts b join private.embryo_canonical_parts a on a.id=b.part_id
      where b.file_id=x.file_id and (a.state<>'landed' or a.write_expires_at>v_now))
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 perform private.consume_future_person_rights_nonce_v1(rs,p_nonce);
 insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,
   disposition_revision,fixed_deadline,state,created_at)
 values('source.revocation-7d','subject',s.id,1,s.lifecycle_revision,s.disposition_revision,v_now+interval '7 days','active',v_now)
 returning id into r;
 env:=jsonb_build_object('version','future-person-deletion-plan-v1','subjectId',s.id,
   'claimantPrincipalId',c.claimant_principal_id,'sourceFileId',x.file_id,'sourceSha256',x.source_sha256,
   'membershipSha256',x.membership_sha256,'publicationRevision',x.publication_revision,
   'subjectBindingRevision',s.subject_binding_revision,'subjectLifecycleRevision',s.lifecycle_revision,
   'requestedAt',v_now,'sourceDeadline',v_now+interval '7 days','completionDeadline',v_now+interval '30 days');
 insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,
   target_kind,target_id,target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision,immutable_envelope)
 values(r,'source.revocation-7d','future-person-claimed-source-disposal','purge',1,v_now,'subject',s.id,
   s.lifecycle_revision,s.disposition_revision,'approved-claimant',rs.authority_revision,env);
 insert into public.purge_manifests(retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint)
 values(r,'future-person-claimed-source-disposal',1,'complete-retention',1,
   encode(extensions.digest(convert_to(env::text,'UTF8'),'sha256'),'hex')) returning id into m;
 insert into public.purge_manifest_entries(manifest_id,target_id,store_name,row_key,entry_revision)
 select m,'variant-rows','private.embryo_canonical_parts',to_jsonb(a),b.sequence+1
   from private.embryo_canonical_source_parts b join private.embryo_canonical_parts a on a.id=b.part_id where b.file_id=x.file_id;
 update public.subjects set analysis_stopped_at=coalesce(analysis_stopped_at,v_now) where id=s.id;
 update public.worker_jobs w set status='cancelled',claimed_by=null,claim_token=null,claimed_at=null,
   claim_expires_at=null,finished_at=v_now where w.status in('queued','running') and w.kind not in('revoke_purge','retention_purge')
     and (w.subject_id=s.id or w.file_id=x.file_id);
 update public.rights_sessions q set status='revoked',ended_at=v_now,session_revision=session_revision+1
   where q.target_kind='claimed-subject' and q.target_id=s.id and q.status='active';
 delete from public.future_person_recovery_key_hashes where claimant_principal_id=c.claimant_principal_id;
 delete from public.future_person_claimant_identity_hmacs where claimant_principal_id=c.claimant_principal_id;
 perform private.assert_future_person_deletion_plan_v1(m);
 return m;
end $$;

create function public.future_person_deletion_parts_v1(p_operation text,p_manifest uuid,p_claim_token_hash text,
 p_expected jsonb default null,p_evidence jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.retention_due_phases;e public.purge_manifest_entries;receipt jsonb;v_now timestamptz;objects jsonb;
begin
 if p_operation is null or p_operation not in('claim','acknowledge','proof') or p_claim_token_hash is null
   or p_claim_token_hash!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 p:=private.assert_future_person_deletion_plan_v1(p_manifest);v_now:=clock_timestamp();
 if p_operation='claim' then
   if p_expected is not null or p_evidence is not null or (p.status='claimed' and p.claim_expires_at>v_now) then
     raise exception using errcode='42501',message='claimant deletion unavailable';end if;
   update public.retention_due_phases set status='claimed',claim_token_hash=p_claim_token_hash,
     claim_expires_at=v_now+interval '60 seconds',attempts=least(attempts+1,20)
     where retention_row_id=p.retention_row_id and phase_id=p.phase_id and phase_revision=p.phase_revision returning * into p;
   update public.purge_manifests set state='executing' where id=p_manifest;
   select coalesce(jsonb_agg(jsonb_build_object('version','future-person-source-disposal-v1','manifestId',p_manifest,
     'ordinal',q.entry_revision,'bucket',q.row_key->>'provider_bucket','objectKey',q.row_key->>'provider_key',
     'byteCount',(q.row_key->>'byte_count')::integer,'sha256',q.row_key->>'sha256','claimExpiresAt',p.claim_expires_at)
     order by q.entry_revision),'[]') into objects from (
       select * from public.purge_manifest_entries where manifest_id=p_manifest and status='pending' order by entry_revision limit 25) q;
   return jsonb_build_object('status','claimed','manifestId',p_manifest,'objects',objects);
 end if;
 if p.status<>'claimed' or p.claim_expires_at<=v_now or not private.claim_hash_matches_v1(p.claim_token_hash,p_claim_token_hash) then
   raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 if p_operation='proof' then
   if p_expected is not null or p_evidence is not null then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
   return jsonb_build_object('status',case when exists(select 1 from public.purge_manifest_entries where manifest_id=p_manifest
     and status<>'deleted') then 'source_pending' else 'source_tombstoned' end);
 end if;
 select * into e from public.purge_manifest_entries where manifest_id=p_manifest
   and entry_revision=(p_expected->>'ordinal')::bigint and status='pending' for update;
 receipt:=jsonb_build_object('version','future-person-source-disposal-v1','manifestId',p_manifest,
   'ordinal',e.entry_revision,'bucket',e.row_key->>'provider_bucket','objectKey',e.row_key->>'provider_key',
   'byteCount',(e.row_key->>'byte_count')::integer,'sha256',e.row_key->>'sha256','claimExpiresAt',p.claim_expires_at);
 if e.manifest_id is null or p_expected is distinct from receipt or p_evidence is null
   or jsonb_typeof(p_evidence) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_evidence))<>7
   or p_evidence->>'disposition' is distinct from 'payload-tombstoned' or p_evidence->>'bucket' is distinct from receipt->>'bucket'
   or p_evidence->>'objectKey' is distinct from receipt->>'objectKey'
   or p_evidence->>'providerVersion' is null or p_evidence->>'providerVersion'!~'^[0-9a-f]{32}$'
   or p_evidence->>'etag' is distinct from 'd41d8cd98f00b204e9800998ecf8427e'
   or p_evidence->'byteCount' is distinct from '0'::jsonb
   or p_evidence->>'sha256' is distinct from 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
 then raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 update public.purge_manifest_entries set status='deleted' where manifest_id=e.manifest_id
   and target_id=e.target_id and store_name=e.store_name and entry_revision=e.entry_revision;
 return jsonb_build_object('status','tombstone_acknowledged','manifestId',p_manifest,'ordinal',e.entry_revision);
end $$;
revoke all on function private.assert_future_person_deletion_plan_v1(uuid),private.prepare_future_person_deletion_v1(text,text),
 public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_deletion_parts_v1(text,uuid,text,jsonb,jsonb) to service_role;

-- Claim leases and disposition ACKs may advance; the creation clock, target,
-- source binding, original deadlines and immutable part identity may not.
create function private.freeze_future_person_deletion_plan_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='retention_due_phases' then
   if old.phase_id='future-person-claimed-source-disposal' or new.phase_id='future-person-claimed-source-disposal' then
     if to_jsonb(new)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at']
       is distinct from to_jsonb(old)-array['status','claim_token_hash','claim_expires_at','attempts','terminal_outcome_code','completed_at'] then
       raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
   end if;
 elsif tg_table_name='retention_rows' then
   if exists(select 1 from public.retention_due_phases where retention_row_id=old.id
     and phase_id='future-person-claimed-source-disposal')
     and to_jsonb(new)-array['state','ended_at'] is distinct from to_jsonb(old)-array['state','ended_at'] then
     raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
 elsif tg_table_name='purge_manifests' then
   if (old.phase_id='future-person-claimed-source-disposal' or new.phase_id='future-person-claimed-source-disposal')
     and to_jsonb(new)-array['state','physical_purge_started_at','frozen_manifest_hash','batch_cursor']
       is distinct from to_jsonb(old)-array['state','physical_purge_started_at','frozen_manifest_hash','batch_cursor'] then
     raise exception using errcode='23514',message='claimant deletion plan immutable';end if;
 elsif exists(select 1 from public.purge_manifests where id in(old.manifest_id,new.manifest_id)
   and phase_id='future-person-claimed-source-disposal')
   and to_jsonb(new)-'status' is distinct from to_jsonb(old)-'status' then
   raise exception using errcode='23514',message='claimant deletion plan immutable';
 end if;
 return new;
end $$;
revoke all on function private.freeze_future_person_deletion_plan_v1() from public,anon,authenticated,service_role,inherit_upload_only;
do $$ declare t text;begin
 foreach t in array array['retention_rows','retention_due_phases','purge_manifests','purge_manifest_entries'] loop
   execute format('create trigger future_person_deletion_plan_immutable before update on public.%I
     for each row execute function private.freeze_future_person_deletion_plan_v1()',t);
 end loop;
end $$;

-- The retention stores have existing service table privileges. A worker may
-- use only the closed functions above, never create/edit/delete this plan by
-- direct table access. SECURITY INVOKER preserves that distinction: nested
-- writes by the approved security-definer executor carry its actual owner.
create function private.guard_future_person_deletion_writer_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare before_row jsonb;after_row jsonb;is_plan boolean:=false;owner_name text;
begin
 if tg_op<>'INSERT' then before_row:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new);end if;
 if tg_table_name in('retention_due_phases','purge_manifests') then
   is_plan:=coalesce(before_row->>'phase_id'='future-person-claimed-source-disposal',false)
     or coalesce(after_row->>'phase_id'='future-person-claimed-source-disposal',false);
 elsif tg_table_name='retention_rows' then
   is_plan:=exists(select 1 from public.retention_due_phases where phase_id='future-person-claimed-source-disposal'
     and retention_row_id in((before_row->>'id')::uuid,(after_row->>'id')::uuid));
 else
   is_plan:=exists(select 1 from public.purge_manifests where phase_id='future-person-claimed-source-disposal'
     and id in((before_row->>'manifest_id')::uuid,(after_row->>'manifest_id')::uuid));
 end if;
 if is_plan then
   select pg_catalog.pg_get_userbyid(p.proowner) into owner_name from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
       and p.proname='prepare_future_person_deletion_v1' and p.proargtypes='25 25'::oidvector;
   if current_user is distinct from owner_name then
     raise exception using errcode='42501',message='claimant deletion unavailable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.guard_future_person_deletion_writer_v1() from public,anon,authenticated,service_role,inherit_upload_only;
do $$ declare t text;begin
 foreach t in array array['retention_rows','retention_due_phases','purge_manifests','purge_manifest_entries'] loop
   execute format('create trigger future_person_deletion_closed_writer before insert or update or delete on public.%I
     for each row execute function private.guard_future_person_deletion_writer_v1()',t);
 end loop;
end $$;

-- Existing exact unbound rights proof, with one additional closed pending-
-- deletion fence. Even a newly activated old release cannot restore access.
create or replace function private.future_person_rights_session_v1(p_hash text,p_lock boolean)
returns public.rights_sessions language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;
begin
 if p_hash is null or p_hash!~'^[0-9a-f]{64}$' then return null; end if;
 select * into rs from public.rights_sessions where session_hash=p_hash;
 if p_lock and rs.id is not null then
   perform 1 from public.subjects where id=rs.target_id for update;
   select * into rs from public.rights_sessions where id=rs.id for update;
 end if;
 if rs.id is null or rs.status<>'active' or rs.purpose<>'approved-future-person-release'
   or rs.target_kind<>'claimed-subject' or rs.expires_at<=clock_timestamp()
   or rs.expires_at>rs.created_at+interval '60 minutes' then return null; end if;
 if not exists(select 1 from public.token_hashes h
   join public.future_person_claim_release_credentials r on r.candidate_id=h.candidate_id
     and r.credential_hash=h.token_hash and r.status='consumed' and r.expires_at>clock_timestamp()
   join public.future_person_claimant_principals cp on cp.id=r.claimant_principal_id and cp.status='current'
     and cp.release_revision=rs.authority_revision and cp.release_revision=r.credential_revision
     and cp.contact_expires_at>clock_timestamp() and cp.principal_id=rs.principal_id
   join public.subject_principals sp on sp.id=cp.principal_id and sp.subject_id=rs.target_id
     and sp.status='active' and sp.principal_kind='future_person' and sp.account_id is null
   join public.subjects s on s.id=rs.target_id and s.id=r.subject_id and s.claimant_principal_id=cp.id
     and s.lifecycle='claimed_unbound' and s.owner_account_id is null and s.subject_account_id is null and s.cohort_id is null
     and s.lifecycle_revision=r.subject_lifecycle_revision and s.subject_binding_revision=r.subject_binding_revision
   join public.encrypted_contact_references e on e.id=r.contact_reference_id and e.principal_id=sp.id
     and e.status='current' and e.contact_ciphertext is not null and e.authority_revision=sp.principal_revision
   join private.future_person_custody_slices x on x.subject_id=s.id and x.claimant_principal_id=cp.id
   join private.embryo_canonical_sources cs on cs.file_id=x.source_file_id and cs.subject_id=s.id
     and cs.source_sha256=x.source_sha256 and cs.membership_sha256=x.source_membership_sha256
   where h.id=rs.token_hash_id and h.status='consumed') then return null; end if;
 if exists(select 1 from public.retention_rows r join public.retention_due_phases p on p.retention_row_id=r.id
   where r.target_kind='subject' and r.target_id=rs.target_id and r.state='active'
     and p.phase_id='future-person-claimed-source-disposal') then return null;end if;
 return rs;
end $$;
