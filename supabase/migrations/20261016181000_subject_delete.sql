-- api.subject-delete: DELETE /api/subjects/[id] (owner decisions 2026-10-16,
-- "The subjects endpoints (G2.1)" and the answers to Q1, Q5 and Q6,
-- docs/protocol/decisions.md).
--
-- FLAGGED: needs a later guarded release before it reaches a hosted
-- database. No restricted capability, jurisdiction gate or rate limit is
-- opened: the route is a right (jurisdictionBypass), and every case below
-- runs only after the route subject's own authority is rechecked here.
--
-- One door, public.delete_subject_v1, resolves the case from server state:
--
--   * self: the owning account empties its own self record. Every file,
--     result, chat, permission and consent on it is revoked and purged; the
--     record stays as the account's one self record. Files go through the
--     existing per-file deletion pipeline: this transaction prepares each
--     file (now unreadable, with its Storage target recorded), the route
--     then removes the bytes and finishes, and the existing seven-day
--     backstop retries anything left.
--   * adult: the owning account (a Path B uploader) or the verified subject
--     account deletes an other_adult record (revocation-and-purge-v1). When
--     the person themselves deletes a Path B record, the subject-controlled
--     global contact refusal bar is written first, from the record's own
--     contact HMACs (global-contact-refusal-bar-v1.adult-path-b-subject-
--     revocation).
--   * embryo: the parents' authority is locked and rechecked first, through
--     the same current-matrix helper the disposition route uses, before the
--     case is chosen. A transferred, unclaimed embryo is purged alone, never
--     its siblings; any other unclaimed embryo restricts its whole cohort
--     through the same core as api.cohort-restrict. A claimed record answers
--     resource-not-found while claimant binding is closed (Q1).
--
-- Q6 also narrows the shared per-file deletion guard: a family pair blocks
-- a file deletion only while it is pending or current or still has joint
-- results. That changes api.file-delete too, as the decision states.
--
-- The one-time X-Inherit-Operation-Nonce is recorded by hash in
-- public.account_operation_nonces in the same transaction; a replay refuses
-- and writes nothing.

do $predecessor$
declare target regprocedure:='private.prepare_genome_file_deletion_body_v1(uuid,uuid)'::regprocedure;
begin
 if not exists(select 1 from pg_proc p where p.oid=target and md5(p.prosrc)='687df80d56b38d2aabeacd4bc1350154'
   and p.prosecdef and p.proconfig=array['search_path=""']::text[]) then
  raise exception using errcode='55000',message='subject delete file guard predecessor differs'; end if;
 if to_regprocedure('private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)') is null
  or to_regprocedure('private.delete_path_b_subject_v1(uuid,text)') is null
  or to_regprocedure('private.end_other_adult_held_upload_v1(uuid,text)') is null
  or to_regprocedure('private.restrict_embryo_cohort_core_v1(uuid,uuid,text)') is null
  or to_regprocedure('private.embryo_disposition_authority_v1(uuid,uuid,uuid,boolean)') is null
  or to_regprocedure('private.plan_embryo_source_deletion_v1(uuid[],text)') is null
  or to_regprocedure('private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)') is null
  or to_regprocedure('private.prepare_own_prepared_cleanup_v1(uuid,text,uuid)') is null
  or to_regprocedure('private.lock_invitation_transitions_v1()') is null
  or to_regclass('private.future_person_binding_config') is null then
  raise exception using errcode='55000',message='subject delete prerequisite missing'; end if;
 if to_regprocedure('public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)') is not null
  or to_regprocedure('private.empty_self_subject_v1(uuid,uuid)') is not null then
  raise exception using errcode='55000',message='subject delete successor already exists'; end if;
end;
$predecessor$;

-- 1. The one-time code --------------------------------------------------------
alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check
 check (operation in ('account_delete','account_delete_cancel','own_upload_artifact_sign',
  'own_account_completion','other_adult_upload_artifact_sign','subject_sharing_stop','subject_delete'));

create or replace function private.record_subject_operation_nonce_v1(p_account_id uuid,p_session_id uuid,
 p_operation text,p_subject_id uuid,p_nonce_hash text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_account_id is null or p_session_id is null or p_subject_id is null
  or p_operation is null or p_operation not in ('subject_sharing_stop','subject_delete')
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
  or p_expires_at is null or p_expires_at<=clock_timestamp()
  or p_expires_at>clock_timestamp()+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
 perform 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id
  and (s.not_after is null or s.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='subject operation unavailable'; end if;
 delete from public.account_operation_nonces where operation=p_operation and expires_at<=clock_timestamp();
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at,consumed_at)
 values(p_nonce_hash,p_account_id,p_session_id,p_operation,p_expires_at,clock_timestamp())
 on conflict(nonce_hash) do nothing;
 if not found then raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
end $$;
revoke all on function private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 2. Q6: the shared per-file guard -------------------------------------------
-- The body of 20260918113000 with one predicate narrowed: a family pair
-- blocks the file shortcut only while it is pending or current, or while it
-- still holds joint results (Portrait rows or messages in its pair chats).
-- An ended pair with nothing left on it no longer strands the owner's files.
create or replace function private.prepare_genome_file_deletion_body_v1(
  p_account_id uuid, p_file_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.genome_files%rowtype;
  s public.subjects%rowtype;
  d private.genome_file_deletions%rowtype;
begin
  -- Match canonical model/read locks: account, subject, then source.
  perform 1 from public.profiles where id=p_account_id for update;
  perform 1 from public.subjects where id=(select subject_id from public.genome_files where id=p_file_id and user_id=p_account_id) for update;
  select * into f from public.genome_files where id=p_file_id and user_id=p_account_id for update;
  if f.id is null then
    raise exception using errcode='P0002', message='file_delete_not_found';
  end if;
  select * into s from public.subjects where id=f.subject_id for update;
  if s.subject_class is distinct from 'self' or s.owner_account_id is distinct from p_account_id
    or s.subject_account_id is distinct from p_account_id or s.lifecycle<>'active' or f.cohort_id is not null then
    raise exception using errcode='55000', message='file_delete_subject_unavailable';
  end if;
  -- These graph cases need their existing subject-level disposition, not a
  -- file shortcut that might remove another adult's shared working data.
  if exists (select 1 from public.family_pairs fp where (fp.subject_a_id=s.id or fp.subject_b_id=s.id)
      and (fp.status in ('pending','current')
        or exists (select 1 from public.portrait_results pr where pr.family_pair_id=fp.id)
        or exists (select 1 from public.chat_messages cm join public.chats pc on pc.id=cm.chat_id
          where pc.family_pair_id=fp.id)))
    or exists (select 1 from public.subject_relationships where subject_id=s.id
      and status='current' and recipient_account_id is distinct from p_account_id)
    or exists (select 1 from public.generated_exports where target_kind='subject' and target_id=s.id)
    or exists (select 1 from public.report_artifacts where subject_id=s.id)
    or exists (select 1 from public.embryo_variants where source_file_id=f.id)
    or exists (select 1 from public.chats c where c.user_id=p_account_id and c.subject_id=s.id
      and (c.canonical_authority is null or c.legacy_unverified is not false)
      and private.is_unattributed_legacy_file_chat_v1(c.id,p_account_id,s.id) is not true)
    or exists (select 1 from public.chat_messages cm join public.chats c on c.id=cm.chat_id
      where cm.user_id=p_account_id and c.subject_id=s.id
      and (cm.canonical_projection is null or cm.legacy_unverified is not false)
      and private.is_unattributed_legacy_file_chat_v1(c.id,p_account_id,s.id) is not true) then
    raise exception using errcode='55000', message='file_delete_shared_graph';
  end if;
  if f.status in ('uploading','parsing','parsed') or exists (
    select 1 from public.worker_jobs where file_id=f.id and status in ('queued','running')
  ) then
    raise exception using errcode='55000', message='file_delete_processing';
  end if;
  if exists (select 1 from public.genome_files where id<>f.id and bucket_path=f.bucket_path)
    or (f.storage_object_id is null and f.bucket_path not like p_account_id::text||'/%')
    or (f.storage_object_id is not null and not exists (
      select 1 from public.genome_storage_objects where object_id=f.storage_object_id
      and genome_file_id=f.id and cohort_id is null and bucket_id='genomes' and object_name=f.bucket_path
    )) or exists (select 1 from public.genome_storage_objects where genome_file_id=f.id
      and (object_id is distinct from f.storage_object_id or bucket_id<>'genomes' or object_name<>f.bucket_path)) then
    raise exception using errcode='55000', message='file_delete_identity_mismatch';
  end if;
  select * into d from private.genome_file_deletions where file_id=f.id;
  if d.file_id is null then
    -- Persist the unreadable/retryable state before freezing subsequent updates.
    update public.genome_files set status='failed', error='File deletion is pending. Try Delete again.' where id=f.id;
    insert into private.genome_file_deletions(file_id,account_id,bucket_id,object_name)
      values(f.id,p_account_id,'genomes',f.bucket_path) returning * into d;
    update public.genome_storage_objects set state='purge_queued',revoked_at=coalesce(revoked_at,clock_timestamp())
      where genome_file_id=f.id;
  end if;
  update public.mail_outbox set state='invalidated', claimed_at=null,
    last_outcome_code='file_target_unavailable'
  where template_id='report-ready' and target_kind='genome_file'
    and target_id=f.id and state in ('queued','claimed');
  return jsonb_build_object('token',d.token,'bucket',d.bucket_id,'name',d.object_name);
end;
$$;
revoke all on function private.prepare_genome_file_deletion_body_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

-- 3. Self: empty the record ----------------------------------------------------
-- The caller holds the account, its sessions and the subject. Order: refuse
-- a file still being processed (nothing written), stop work, take every
-- shared and derived output away, revoke every permission and consent, then
-- prepare each file through the narrowed guard above. The record, its
-- principal, binding and demographics stay; its lifecycle revision moves,
-- so every capture, export receipt and reader bound to the old one is stale.
create function private.empty_self_subject_v1(p_account_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; v_now timestamptz:=clock_timestamp(); v_principal uuid;
 v_files uuid[]; v_pairs uuid[]; v_counterparts uuid[]; v_readers uuid[]; v_grants uuid[];
 v_chats uuid[]; v_generations uuid[]; v_contexts uuid[]; v_calls uuid[]; v_reader uuid;
 v_file uuid; v_target jsonb; v_job uuid; v_prepared uuid[]:='{}'::uuid[]; n_grants integer; n_chats integer;
begin
 select * into s from public.subjects where id=p_subject_id for update;
 if s.id is null or s.subject_class<>'self' or s.owner_account_id is distinct from p_account_id
  or s.subject_account_id is distinct from p_account_id or s.lifecycle<>'active' then
  raise exception using errcode='42501',message='not_found'; end if;
 select sp.id into v_principal from public.subject_principals sp
  join public.subject_account_bindings b on b.subject_principal_id=sp.id and b.subject_id=s.id
   and b.account_id=p_account_id and b.status='current'
  where sp.subject_id=s.id and sp.account_id=p_account_id and sp.principal_kind='account_subject' and sp.status='active'
  for share of sp,b;
 if v_principal is null then raise exception using errcode='42501',message='not_found'; end if;
 v_files:=array(select f.id from public.genome_files f where f.subject_id=s.id order by f.id);
 perform 1 from public.genome_files where id=any(v_files) order by id for update;
 if exists(select 1 from public.genome_files f where f.id=any(v_files) and (f.user_id<>p_account_id or f.cohort_id is not null))
  or exists(select 1 from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id)
  or exists(select 1 from public.embryo_variants v where v.source_file_id=any(v_files)) then
  raise exception using errcode='55000',message='subject_delete_unsupported_graph'; end if;
 -- A file still being uploaded or processed cannot be emptied safely yet.
 if exists(select 1 from public.genome_files f where f.id=any(v_files) and f.status in ('uploading','parsing','parsed'))
  or exists(select 1 from public.upload_sessions u where u.subject_id=s.id and u.status='validating') then
  raise exception using errcode='55000',message='subject_delete_processing'; end if;

 -- Work in flight: queued or running jobs stop; open upload sessions end.
 update public.worker_jobs set status='cancelled',finished_at=v_now,claim_token_hash=null,claim_expires_at=null,claimed_by=null
  where status in ('queued','running') and kind not in ('revoke_purge','retention_purge')
   and (subject_id=s.id or file_id=any(v_files));
 update public.upload_sessions set status='cancelled',consumed_at=coalesce(consumed_at,v_now),expires_at=least(expires_at,v_now)
  where subject_id=s.id and status in ('issued','uploaded');
 delete from public.pending_source_rows where subject_id=s.id;

 -- Shared outputs. Every account this record was shared with, by grant,
 -- relationship or pair, loses the joint results and the chat turns built
 -- from it, exactly as the existing revoke/stop helper removes them.
 v_pairs:=array(select fp.id from public.family_pairs fp where fp.subject_a_id=s.id or fp.subject_b_id=s.id order by fp.id);
 perform 1 from public.family_pairs where id=any(v_pairs) order by id for update;
 v_counterparts:=array(select distinct x from (
   select dg.recipient_account_id x from public.purpose_grants g
    join public.directional_grants dg on dg.grant_id=g.grant_id
   where g.target_kind='subject' and g.target_id=s.id
   union select sr.recipient_account_id from public.subject_relationships sr where sr.subject_id=s.id
   union select o.subject_account_id from public.family_pairs fp
    join public.subjects o on o.id=case when fp.subject_a_id=s.id then fp.subject_b_id else fp.subject_a_id end
   where fp.id=any(v_pairs)) t where x is not null and x<>p_account_id order by x);
 perform private.delete_pair_derived_rows_v1(v_pairs,p_account_id,'{}'::uuid[],null);
 foreach v_reader in array v_counterparts loop
  perform private.delete_pair_derived_rows_v1('{}'::uuid[],v_reader,array[s.id],null);
 end loop;
 -- Any other chat that retrieved this record, whoever owns it.
 v_readers:=array(select distinct c.user_id from public.chats c where c.user_id<>p_account_id and (
   exists(select 1 from public.chat_messages m where m.chat_id=c.id and m.retrieved_subject_ids && array[s.id])
   or exists(select 1 from public.copilot_context_history h where h.chat_id=c.id and h.retrieved_subject_ids && array[s.id]))
  order by c.user_id);
 foreach v_reader in array v_readers loop
  perform private.delete_pair_derived_rows_v1('{}'::uuid[],v_reader,array[s.id],null);
 end loop;
 -- And the owner's own chats about anyone else that drew on this record.
 perform private.delete_pair_derived_rows_v1('{}'::uuid[],p_account_id,array[s.id],null);

 -- Every chat about this record, with its model working state.
 v_chats:=array(select c.id from public.chats c where c.subject_id=s.id order by c.id);
 perform 1 from public.chats where id=any(v_chats) order by id for update;
 v_generations:=array(select g.id from public.copilot_generation_sessions g where g.chat_id=any(v_chats));
 v_contexts:=array(select m.id from public.model_contexts m where m.generation_session_id=any(v_generations));
 v_calls:=array(select c.id from public.cloud_model_calls c where c.model_context_id=any(v_contexts));
 delete from public.cloud_provider_payloads where cloud_model_call_id=any(v_calls);
 delete from public.cloud_provider_attempts where cloud_model_call_id=any(v_calls);
 delete from public.cloud_model_calls where id=any(v_calls);
 delete from public.model_contexts where id=any(v_contexts);
 delete from public.copilot_context_tokens where chat_id=any(v_chats) or target_id=s.id;
 delete from public.copilot_context_history where chat_id=any(v_chats);
 delete from public.copilot_turn_dependencies where chat_id=any(v_chats);
 delete from public.copilot_generation_sessions where id=any(v_generations);
 delete from public.chat_messages where chat_id=any(v_chats);
 delete from public.chats where id=any(v_chats);
 n_chats:=cardinality(v_chats);
 if exists(select 1 from public.chat_messages m where m.retrieved_subject_ids && array[s.id])
  or exists(select 1 from public.copilot_context_history h where h.retrieved_subject_ids && array[s.id])
  or exists(select 1 from public.copilot_context_tokens t where t.target_id=s.id) then
  raise exception using errcode='55000',message='subject_delete_chat_residual'; end if;

 -- Every permission on the record, and every pair grant that names it.
 v_grants:=array(select distinct x from (
   select g.grant_id x from public.purpose_grants g where (g.target_kind='subject' and g.target_id=s.id)
    or g.data_subject_principal_id=v_principal
   union select dg.grant_id from public.directional_grants dg where dg.pair_id=any(v_pairs)) t order by x);
 perform 1 from public.purpose_grants where grant_id=any(v_grants) order by grant_id for update;
 perform 1 from public.directional_grants where grant_id=any(v_grants) order by grant_id for update;
 update public.purpose_grants set revoked_at=v_now,revocation_reason='subject_deleted'
  where grant_id=any(v_grants) and revoked_at is null;
 get diagnostics n_grants=row_count;
 update public.directional_grants set status='revoked',ended_at=v_now
  where grant_id=any(v_grants) and status='current';
 update public.subject_relationships set status='revoked',ended_at=v_now
  where subject_id=s.id and status in ('pending','current') and relationship_kind<>'self';
 update public.family_pairs set status='revoked',pair_revision=pair_revision+1
  where id=any(v_pairs) and status in ('pending','current');
 delete from public.portrait_results where family_pair_id=any(v_pairs)
  or parent_a_subject_id=s.id or parent_b_subject_id=s.id;

 -- Results built from the record are deleted now (derived.revocation-60s);
 -- the variant rows go with their file's finish (source.revocation-7d).
 delete from public.ancestry_regions where subject_id=s.id;
 delete from public.ancestry_results where subject_id=s.id or file_id=any(v_files);
 delete from public.user_prs where subject_id=s.id or file_id=any(v_files);
 delete from public.report_observed_calls where subject_id=s.id or file_id=any(v_files);
 delete from private.own_analysis_runs where subject_id=s.id or file_id=any(v_files);
 delete from public.report_artifacts where subject_id=s.id;

 -- Every consent on the record, and every credential that reaches it.
 update public.subject_consents set revoked_at=v_now,revocation_reason='withdrawn'
  where subject_id=s.id and revoked_at is null;
 update public.rights_sessions set status='revoked',ended_at=v_now
  where status='active' and target_id=s.id;
 update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1
  where status='active' and ((target_kind='subject' and target_id=s.id) or object_id in (
   select o.object_id from public.genome_storage_objects o where o.genome_file_id=any(v_files)));
 update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='subject_emptied'
  where state in ('queued','claimed') and target_id=s.id;
 update public.generated_exports set status='revoked'
  where status in ('queued','building') and target_kind='account' and target_id=p_account_id;

 -- The files, through the shared pipeline. Each is unreadable from here on.
 foreach v_file in array v_files loop
  v_target:=private.prepare_genome_file_deletion_body_v1(p_account_id,v_file);
  select j.id into v_job from private.own_preparation_jobs j where j.file_id=v_file and j.account_id=p_account_id;
  if v_job is not null then
   perform private.prepare_own_prepared_cleanup_v1(v_job,'file',(v_target->>'token')::uuid);
  end if;
  v_prepared:=v_prepared||v_file;
 end loop;

 update public.subjects set lifecycle_revision=lifecycle_revision+1,updated_at=v_now where id=s.id;
 perform private.append_legal_audit_event('subject.emptied',null,'api.subject-delete','accepted',
  jsonb_build_object('files',cardinality(v_prepared),'chats',n_chats,'grants',n_grants,
   'pairs',cardinality(v_pairs),'revision',1));
 return jsonb_build_object('case','self','files',to_jsonb(v_prepared));
end $$;
revoke all on function private.empty_self_subject_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 4. Adult records -----------------------------------------------------------
-- global-contact-refusal-bar-v1.adult-path-b-subject-revocation: the record's
-- own current contact HMACs, before they are shredded. Pending equivalent
-- invitations are refused by the existing bar checks at mail claim and
-- acceptance.
create function private.bar_path_b_subject_contact_v1(p_subject_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_hmacs text[]; v_hmac text; v_now timestamptz:=clock_timestamp();
begin
 v_hmacs:=array(select distinct x from (
   select e.contact_hmac x from public.encrypted_contact_references e
    join public.subject_principals sp on sp.id=e.principal_id
   where sp.subject_id=p_subject_id and e.status='current'
   union select h.contact_hmac from public.contact_hmac_indexes h
    join public.encrypted_contact_references e on e.id=h.contact_reference_id
    join public.subject_principals sp on sp.id=e.principal_id
   where sp.subject_id=p_subject_id and e.status='current' and h.status='current') t order by x);
 if cardinality(v_hmacs)=0 then
  raise exception using errcode='55000',message='subject_contact_authority_unavailable'; end if;
 foreach v_hmac in array v_hmacs loop
  insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,created_at,expires_at)
  values(v_hmac,1,v_now,v_now+interval '365 days')
  on conflict(email_hmac) do update set refusal_revision=public.invitation_refusal_hmacs.refusal_revision+1,
   created_at=excluded.created_at,expires_at=greatest(public.invitation_refusal_hmacs.expires_at,excluded.expires_at);
  insert into public.contact_refusal_bars(contact_hmac,target_kind,target_id,refusal_revision,expires_at)
  values(v_hmac,'subject',p_subject_id,1,v_now+interval '365 days')
  on conflict(contact_hmac,target_kind,target_id,refusal_revision) do nothing;
 end loop;
 return cardinality(v_hmacs);
end $$;
revoke all on function private.bar_path_b_subject_contact_v1(uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- The body of private.delete_path_b_subject_v1 (20260930210000), for this
-- route: 'deleted' when the person deletes (with the bar above), 'withdrawn'
-- when the uploader does.
create function private.delete_path_b_subject_for_route_v1(p_subject_id uuid,p_state text)
returns integer language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare h record; n integer:=0; v_bars integer:=0; v_now timestamptz:=clock_timestamp();
begin
 if p_state is null or p_state not in ('deleted','withdrawn') then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if p_state='deleted' then v_bars:=private.bar_path_b_subject_contact_v1(p_subject_id); end if;
 for h in select id from public.other_adult_held_uploads where subject_id=p_subject_id
  and state in ('pending','confirmed') order by held_at,id loop
  if private.end_other_adult_held_upload_v1(h.id,p_state) then n:=n+1; end if;
 end loop;
 update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,
  subject_binding_revision=subject_binding_revision+1,updated_at=v_now,subject_account_id=null
 where id=p_subject_id and lifecycle<>'purged';
 update public.encrypted_contact_references set contact_ciphertext=null,status='shredded',ended_at=v_now
  where principal_id in (select id from public.subject_principals where subject_id=p_subject_id) and status='current';
 update public.contact_hmac_indexes set status='revoked',expires_at=least(expires_at,v_now)
  where contact_reference_id in (select e.id from public.encrypted_contact_references e
   join public.subject_principals sp on sp.id=e.principal_id where sp.subject_id=p_subject_id) and status='current';
 update public.subject_principals set status='deleted',principal_revision=principal_revision+1
  where subject_id=p_subject_id and principal_kind in ('non_account_subject','account_subject')
   and status in ('active','pending');
 update public.subject_consents set revoked_at=v_now,revocation_reason='withdrawn'
  where subject_id=p_subject_id and consent_type='upload_class' and revoked_at is null;
 update public.rights_sessions set status='revoked',ended_at=v_now where status='active'
  and ((target_kind='subject' and target_id=p_subject_id)
   or (target_kind='adult_upload_revision' and target_id in (select id from public.other_adult_held_uploads where subject_id=p_subject_id)));
 perform private.append_legal_audit_event('subject.deleted',null,'api.subject-delete',p_state,
  jsonb_build_object('upload_class','other_adult','revisions',n,'refusal_bars',v_bars));
 return n;
end;
$function$;
revoke all on function private.delete_path_b_subject_for_route_v1(uuid,text)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- A Path A record (accepted adult invitation, owned by no account) deleted
-- by its own account. It holds no file: the record, its relationships,
-- binding, consents and grants end, and nothing else is touched.
create function private.purge_path_a_subject_v1(p_subject_id uuid,p_account_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; v_now timestamptz:=clock_timestamp(); v_grants uuid[];
begin
 select * into s from public.subjects where id=p_subject_id for update;
 if s.id is null or s.subject_class<>'other_adult' or s.owner_account_id is not null
  or s.subject_account_id is distinct from p_account_id or s.lifecycle<>'active'
  or exists(select 1 from public.other_adult_held_uploads h where h.subject_id=s.id)
  or exists(select 1 from public.genome_files f where f.subject_id=s.id) then
  raise exception using errcode='42501',message='not_found'; end if;
 v_grants:=array(select g.grant_id from public.purpose_grants g where g.target_kind='subject' and g.target_id=s.id order by g.grant_id);
 update public.purpose_grants set revoked_at=v_now,revocation_reason='subject_deleted' where grant_id=any(v_grants) and revoked_at is null;
 update public.directional_grants set status='revoked',ended_at=v_now where grant_id=any(v_grants) and status='current';
 update public.subject_relationships set status='revoked',ended_at=v_now where subject_id=s.id and status in ('pending','current');
 update public.subject_account_bindings set status='revoked',ended_at=v_now,binding_revision=binding_revision+1
  where subject_id=s.id and status in ('pending','current');
 update public.subject_consents set revoked_at=v_now,revocation_reason='withdrawn' where subject_id=s.id and revoked_at is null;
 update public.subject_principals set status='deleted',principal_revision=principal_revision+1
  where subject_id=s.id and status in ('active','pending');
 update public.rights_sessions set status='revoked',ended_at=v_now where status='active' and target_id=s.id;
 update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1
  where status='active' and target_kind='subject' and target_id=s.id;
 update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,
  subject_binding_revision=subject_binding_revision+1,updated_at=v_now where id=s.id;
 perform private.append_legal_audit_event('subject.deleted',null,'api.subject-delete','deleted',
  jsonb_build_object('upload_class','other_adult','revisions',0,'refusal_bars',0));
end $$;
revoke all on function private.purge_path_a_subject_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 5. A transferred, unclaimed embryo (Q5) -------------------------------------
-- The caller has locked and rechecked the parents' authority. Only this
-- subject is purged: its siblings, its cohort and every other subject's rows
-- are untouched. While any claim or claim review of it is open, nothing is
-- written and the route answers not found.
create function private.purge_transferred_embryo_subject_v1(p_subject_id uuid,p_embryo_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; e public.embryos%rowtype; v_now timestamptz:=clock_timestamp();
 v_files uuid[]; v_rows uuid[];
begin
 select * into s from public.subjects where id=p_subject_id for update;
 select * into e from public.embryos where id=p_embryo_id for update;
 if s.id is null or e.id is null or e.subject_id<>s.id or s.subject_class<>'embryo' or e.status<>'transferred'
  or s.claimant_principal_id is not null or s.lifecycle in ('claimed_unbound','claimed_bound','purged')
  or s.cohort_id is null or e.cohort_id is distinct from s.cohort_id then
  raise exception using errcode='42501',message='not_found'; end if;
 if exists(select 1 from public.future_person_claims f where f.embryo_id=e.id
   and f.status in ('submitted','reviewing','owner_notice','objected','approved'))
  or exists(select 1 from private.claim_reviews r where r.matched_embryo_id=e.id and private.claim_review_open_v1(r)) then
  raise exception using errcode='42501',message='not_found'; end if;

 update public.future_person_record_key_hashes set status='revoked',ended_at=v_now
  where embryo_id=e.id and status='current';
 update public.future_person_record_key_print_rights set status='revoked'
  where embryo_id=e.id and status='unconsumed';
 update public.rights_sessions set status='revoked',ended_at=v_now
  where status='active' and target_id in (s.id,e.id);
 update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1
  where status='active' and target_id in (s.id,e.id);
 update public.mail_outbox set state='invalidated',claimed_at=null,last_outcome_code='subject_deleted'
  where state in ('queued','claimed') and target_id in (s.id,e.id);
 update public.worker_jobs set status='cancelled',finished_at=v_now,claim_token_hash=null,claim_expires_at=null,claimed_by=null
  where status in ('queued','running') and kind not in ('revoke_purge','retention_purge') and subject_id=s.id;

 -- The claim window closes, so no later claim can match this record.
 v_rows:=array(select r.id from public.retention_rows r where r.retention_id='embryo.transferred-claim-window'
  and r.target_kind='subject' and r.target_id=s.id and r.state in ('scheduled','active') order by r.id);
 update public.retention_due_phases set status='cancelled',claim_token_hash=null,claim_expires_at=null,
  completed_at=v_now,terminal_outcome_code='subject_deleted'
  where retention_row_id=any(v_rows) and status in ('pending','retry','claimed');
 update public.purge_manifests set state='cancelled' where retention_row_id=any(v_rows) and state in ('frozen','executing');
 update public.retention_rows set state='cancelled',ended_at=v_now where id=any(v_rows);

 -- Derived rows, then the one canonical source (its parts stay under the
 -- planner's source unwind until each object's disposal is proved).
 delete from public.embryo_figures f using public.embryo_scores sc where f.finding_id=sc.id and sc.embryo_id=e.id;
 delete from public.embryo_scores where embryo_id=e.id;
 delete from public.embryo_qc where embryo_id=e.id;
 v_files:=array(select x.file_id from private.embryo_canonical_sources x where x.embryo_id=e.id and x.subject_id=s.id order by x.file_id);
 if cardinality(v_files)>0 then
  perform private.plan_embryo_source_deletion_v1(v_files,'withdrawal');
 end if;
 delete from public.embryo_variants where embryo_id=e.id;

 -- The subject is purged; the identity-profile trigger shreds its profile.
 update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,updated_at=v_now where id=s.id;
 perform private.append_legal_audit_event('subject.deleted',null,'api.subject-delete','accepted',
  jsonb_build_object('subject_class','embryo','case','embryo-transferred-unclaimed',
   'sources',cardinality(v_files),'revision',1));
 return jsonb_build_object('case','embryo-transferred-unclaimed','sources',cardinality(v_files));
end $$;
revoke all on function private.purge_transferred_embryo_subject_v1(uuid,uuid)
 from public,anon,authenticated,inherit_upload_only,service_role;

-- 6. The door -------------------------------------------------------------------
create function public.delete_subject_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subjects%rowtype; e public.embryos%rowtype; v_authority jsonb; v_actor uuid; v_path_b boolean;
begin
 if p_account_id is null or p_session_id is null or p_subject_id is null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- The class never changes, so it is read first to take the adult cases'
 -- invitation-transition lock before any row lock, as every other Path B
 -- writer does. Then account, sessions and profile, then the subject: the
 -- file pipeline's order.
 select * into s from public.subjects where id=p_subject_id;
 if s.id is null then raise exception using errcode='42501',message='not_found'; end if;
 if s.subject_class='other_adult' then perform private.lock_invitation_transitions_v1(); end if;
 perform 1 from auth.users u where u.id=p_account_id and u.deleted_at is null for share;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from auth.sessions where user_id=p_account_id order by id for share;
 perform 1 from auth.sessions x where x.id=p_session_id and x.user_id=p_account_id
  and (x.not_after is null or x.not_after>clock_timestamp());
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 perform 1 from public.profiles where id=p_account_id for update;
 if not found then raise exception using errcode='42501',message='not_found'; end if;

 if s.subject_class='self' then
  if s.owner_account_id is distinct from p_account_id or s.subject_account_id is distinct from p_account_id
   or s.lifecycle<>'active' then raise exception using errcode='42501',message='not_found'; end if;
  perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_delete',s.id,p_nonce_hash,p_nonce_expires_at);
  return private.empty_self_subject_v1(p_account_id,s.id);
 end if;

 if s.subject_class='other_adult' then
  select * into s from public.subjects where id=p_subject_id for update;
  if s.lifecycle<>'active' or not (s.owner_account_id is not distinct from p_account_id
    or s.subject_account_id is not distinct from p_account_id) then
   raise exception using errcode='42501',message='not_found'; end if;
  v_path_b:=exists(select 1 from public.adult_subject_drafts d where d.subject_id=s.id
   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed');
  if v_path_b then
   perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_delete',s.id,p_nonce_hash,p_nonce_expires_at);
   -- The verified subject account revokes (with the bar); otherwise the
   -- owning uploader withdraws.
   perform private.delete_path_b_subject_for_route_v1(s.id,
    case when s.subject_account_id is not distinct from p_account_id then 'deleted' else 'withdrawn' end);
   return jsonb_build_object('case','adult');
  end if;
  if s.owner_account_id is null and s.subject_account_id=p_account_id then
   perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_delete',s.id,p_nonce_hash,p_nonce_expires_at);
   perform private.purge_path_a_subject_v1(s.id,p_account_id);
   return jsonb_build_object('case','adult');
  end if;
  raise exception using errcode='42501',message='not_found';
 end if;

 if s.subject_class='embryo' then
  -- Q1: a claimed record belongs to its claimant. The token claimant uses
  -- api.future-person-delete; an account-bound claimant cannot exist while
  -- claimant binding is closed, and its erasure ships with that release.
  if s.lifecycle in ('claimed_unbound','claimed_bound') or s.claimant_principal_id is not null then
   raise exception using errcode='42501',message='not_found'; end if;
  select * into e from public.embryos where subject_id=s.id;
  if e.id is null then raise exception using errcode='42501',message='not_found'; end if;
  -- Lock and recheck the parents' current authority before choosing a case.
  v_authority:=private.embryo_disposition_authority_v1(p_account_id,p_session_id,e.id,true);
  v_actor:=(v_authority->>'actorPrincipal')::uuid;
  select * into e from public.embryos where id=e.id;
  perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_delete',s.id,p_nonce_hash,p_nonce_expires_at);
  if e.status='transferred' then
   return private.purge_transferred_embryo_subject_v1(s.id,e.id);
  end if;
  perform private.restrict_embryo_cohort_core_v1(e.cohort_id,v_actor,'api.cohort-restrict');
  return jsonb_build_object('case','embryo-other');
 end if;

 raise exception using errcode='42501',message='not_found';
end $$;
revoke all on function public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
