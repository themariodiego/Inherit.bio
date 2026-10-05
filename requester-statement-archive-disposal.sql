-- SOURCE ONLY. Literal actual copies, not a guess from provider age/absence.
-- The actual baseline segments are plaintext in Supabase exports. There is no
-- archive encryption key table in that producer. The statement key remains in
-- V3's case envelope; runtime central-directory buffers are inventoried below.
do $stores$
declare ordering integer; name text;
begin
 select max(delete_order)+1 into ordering from public.purge_targets;
 insert into public.purge_targets(target_id,delete_order) values('correction-case-export-copies',ordering);
 insert into public.purge_manifest_class_targets(manifest_class,target_id)
 values('review-working','correction-case-export-copies'),('complete-retention','correction-case-export-copies');
 ordering:=0;
 foreach name in array array['private.new_correction_archive_provider_dispositions','private.new_correction_archive_r2_allocations','public.download_ranges','public.download_sessions','private.export_archive_downloads',
  'private.export_archive_manifest_pages','private.export_archive_segments','private.new_correction_archive_runs',
  'private.new_correction_archive_cases','private.export_archive_attempts','private.export_archive_nonce_uses',
  'private.export_archive_jobs','public.generated_exports','storage.objects'] loop
  ordering:=ordering+1;
  insert into public.purge_target_stores(target_id,store_name,store_order)
  values('correction-case-export-copies',name,ordering);
 end loop;
end $stores$;

create function private.new_correction_archive_graph_v1(p_case uuid)
returns table(target_id text,store_name text,row_key jsonb)
language sql stable security definer set search_path='' as $body$
 with exports as(select export_id from private.new_correction_archive_cases where correction_id=p_case),
 attempts as(select id from private.export_archive_attempts where export_id in(select export_id from exports))
 select 'correction-case-export-copies','private.new_correction_archive_provider_dispositions',
  jsonb_build_object('attempt_id',t.attempt_id,'ordinal',t.ordinal)
 from private.new_correction_archive_provider_dispositions t where t.attempt_id in(select id from attempts)
 union all select 'correction-case-export-copies','private.new_correction_archive_r2_allocations',jsonb_build_object('id',t.id)
 from private.new_correction_archive_r2_allocations t where t.attempt_id in(select id from attempts)
 union all select 'correction-case-export-copies','public.download_ranges',jsonb_build_object('session_id',t.session_id,'range_sequence',t.range_sequence)
 from public.download_ranges t where t.session_id in(select id from public.download_sessions where target_kind='export' and target_id in(select export_id from exports))
 union all select 'correction-case-export-copies','public.download_sessions',jsonb_build_object('id',t.id)
 from public.download_sessions t where t.target_kind='export' and t.target_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.export_archive_downloads',jsonb_build_object('id',t.id)
 from private.export_archive_downloads t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.export_archive_manifest_pages',jsonb_build_object('attempt_id',t.attempt_id,'page',t.page)
 from private.export_archive_manifest_pages t where t.attempt_id in(select id from attempts)
 union all select 'correction-case-export-copies','private.export_archive_segments',jsonb_build_object('attempt_id',t.attempt_id,'ordinal',t.ordinal)
 from private.export_archive_segments t where t.attempt_id in(select id from attempts)
 union all select 'correction-case-export-copies','private.new_correction_archive_runs',jsonb_build_object('id',t.id)
 from private.new_correction_archive_runs t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.new_correction_archive_cases',jsonb_build_object('export_id',t.export_id,'correction_id',t.correction_id)
 from private.new_correction_archive_cases t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.export_archive_attempts',jsonb_build_object('id',t.id)
 from private.export_archive_attempts t where t.id in(select id from attempts)
 union all select 'correction-case-export-copies','private.export_archive_nonce_uses',jsonb_build_object('nonce_hash',t.nonce_hash)
 from private.export_archive_nonce_uses t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','private.export_archive_jobs',jsonb_build_object('export_id',t.export_id)
 from private.export_archive_jobs t where t.export_id in(select export_id from exports)
 union all select 'correction-case-export-copies','public.generated_exports',jsonb_build_object('id',t.id)
 from public.generated_exports t where t.id in(select export_id from exports)
 union all select 'correction-case-export-copies','storage.objects',jsonb_build_object('id',t.id,'bucket_id',t.bucket_id,'name',t.name)
 from storage.objects t where t.bucket_id='exports' and t.name in(
  select object_key from private.export_archive_segments where attempt_id in(select id from attempts))
$body$;
revoke all on function private.new_correction_archive_graph_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Called while V3 holds the real subject/case locks BEFORE its immutable
-- inventory. Revoke the entire shared archive: a ZIP cannot retain one closed
-- statement while removing its bytes without creating a new separate archive.
create function private.close_new_correction_archives_v1(p_case uuid)
returns void language plpgsql security definer set search_path='' set lock_timeout='250ms' as $body$
declare e public.generated_exports; c public.correction_requests; b record;
begin
 select * into c from public.correction_requests where id=p_case for update;
 for b in select export_id from private.new_correction_archive_cases where correction_id=c.id order by export_id loop
  select * into e from public.generated_exports where id=b.export_id for update;
  perform 1 from private.export_archive_jobs where export_id=e.id for update;
  perform 1 from private.export_archive_attempts where export_id=e.id order by id for update;
  perform 1 from private.export_archive_segments where attempt_id in(
   select id from private.export_archive_attempts where export_id=e.id) order by attempt_id,ordinal for update;
  perform 1 from private.new_correction_archive_cases where export_id=e.id order by correction_id for update;
  if e.id is null or not(
   (e.origin_kind='independent-rights' and e.account_id is null and e.target_kind='subject' and e.target_id=c.subject_id
    and not exists(select 1 from private.new_correction_archive_cases link join public.correction_requests other on other.id=link.correction_id
     where link.export_id=e.id and(other.subject_id is distinct from c.subject_id or link.original_author_principal_id is distinct from e.requester_principal_id or link.origin_account_id is not null)))
   or(e.origin_kind='account' and e.account_id is not null and e.target_kind='account' and e.target_id=e.account_id
    and not exists(select 1 from private.new_correction_archive_cases link join public.correction_requests other on other.id=link.correction_id
     where link.export_id=e.id and(link.origin_account_id is distinct from e.account_id
      or not(e.subject_partitions ? other.subject_id::text)
      or(other.terminal_shredded_at is null and other.claimant_principal_id is distinct from link.original_author_principal_id))))) then
   raise exception using errcode='42501',message='correction_archive_disposal_unavailable';end if;
  update private.new_correction_archive_cases set state='closing' where export_id=e.id;
  update private.new_correction_archive_runs set state='cancellation-requested'
   where export_id=e.id and state='active';
  update public.generated_exports set status='revoked' where id=e.id;
  update private.export_archive_downloads set revoked_at=coalesce(revoked_at,clock_timestamp()) where export_id=e.id;
  update public.download_sessions set status='revoked',ended_at=coalesce(ended_at,clock_timestamp()),session_revision=session_revision+1
   where target_kind='export' and target_id=e.id and status='active';
  update private.export_archive_attempts set state='cleanup_pending',stopped_at=coalesce(stopped_at,clock_timestamp()),
   cleanup_not_before=greatest(coalesce(cleanup_not_before,'-infinity'),lease_expires_at+interval '30 seconds')
   where export_id=e.id and state<>'cleaned';
 end loop;
end $body$;
revoke all on function private.close_new_correction_archives_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;

-- Generic metadata ACK is not a provider-disposal proof. Marked copies cannot
-- use the old two-field acknowledge-delete door, even with a service JWT.
alter function public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)
 rename to export_archive_cleanup_before_requester_statement_v1;
revoke all on function public.export_archive_cleanup_before_requester_statement_v1(text,uuid,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
create function public.export_archive_cleanup_v1(p_operation text,p_export_id uuid,p_attempt_id uuid,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $body$
begin
 if p_operation='acknowledge-delete' and exists(select 1 from private.new_correction_archive_cases where export_id=p_export_id) then
  raise exception using errcode='42501',message='correction_archive_provider_proof_required';end if;
 return public.export_archive_cleanup_before_requester_statement_v1(p_operation,p_export_id,p_attempt_id,p_payload);
end $body$;
revoke all on function public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.export_archive_cleanup_v1(text,uuid,uuid,jsonb) to service_role;

-- A durable runtime reservation exists BEFORE decrypting/serializing any own
-- statement. The bounded memory central directory contains no statement body.
-- Actual buffer disposal is acknowledged only by the holder of the fresh run
-- nonce. Expiry/cancellation/process absence does not manufacture that ACK.
create function public.begin_requester_statement_archive_run_v1(p_export uuid,p_attempt uuid,p_receipt text,p_nonce text)
returns uuid language plpgsql security definer set search_path='' as $body$
declare j private.export_archive_jobs; a private.export_archive_attempts; result uuid;
begin
 perform private.export_archive_current_v1(p_export,p_receipt);
 select * into j from private.export_archive_jobs where export_id=p_export for share;
 select * into a from private.export_archive_attempts where id=p_attempt and export_id=p_export for share;
 if not private.requester_statement_test_enabled_v1() or coalesce(p_nonce,'')!~'^[0-9a-f]{64}$'
  or j.active_attempt is distinct from a.id or a.state<>'writing' or a.lease_expires_at<=clock_timestamp()
  or not exists(select 1 from private.new_correction_archive_cases where export_id=p_export and state='active')
  or exists(select 1 from private.new_correction_archive_cases where export_id=p_export and state<>'active')
  or exists(select 1 from private.new_correction_archive_runs where attempt_id=a.id and state<>'buffers-zeroed') then
  raise exception using errcode='42501',message='not_found';end if;
 insert into private.new_correction_archive_runs(export_id,attempt_id,nonce_hash,original_deadline)
 values(p_export,p_attempt,encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex'),j.deadline) returning id into result;
 return result;
end $body$;
create function public.finish_requester_statement_archive_run_v1(p_run uuid,p_nonce text)
returns boolean language plpgsql security definer set search_path='' as $body$
declare run private.new_correction_archive_runs;
begin
 select * into run from private.new_correction_archive_runs where id=p_run for update;
 if run.id is null or coalesce(p_nonce,'')!~'^[0-9a-f]{64}$' or not private.claim_hash_matches_v1(run.nonce_hash,
  encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex')) then
  raise exception using errcode='42501',message='not_found';end if;
 -- Worker invokes this only after its actual finally/zeroization completed.
 -- Crash recovery needs actual process/buffer disposition evidence separately.
 update private.new_correction_archive_runs set state='buffers-zeroed',buffers_zeroed_at=coalesce(buffers_zeroed_at,clock_timestamp()) where id=run.id;
 return true;
end $body$;
revoke all on function public.begin_requester_statement_archive_run_v1(uuid,uuid,text,text),
 public.finish_requester_statement_archive_run_v1(uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.begin_requester_statement_archive_run_v1(uuid,uuid,text,text),
 public.finish_requester_statement_archive_run_v1(uuid,text) to service_role;

-- Native provider evidence now enters through the separate NEW R2 issuer and
-- private.ack_new_correction_archive_r2_disposal_v1. Existing Supabase objects
-- have no such allocation and cannot be adopted by this branch. The generic
-- metadata-only acknowledge-delete refusal above remains deliberate.

-- Actual zero-provider-reservation branch has complete physical cleanup now.
-- Any reserved segment, active run, uncertain write or provider copy holds it.
create function private.drain_requester_statement_archive_zero_v1(p_case uuid)
returns boolean language plpgsql security definer set search_path='' as $body$
declare task_export_id uuid; e public.generated_exports; item record;
begin
 for task_export_id in select export_id from private.new_correction_archive_cases where correction_id=p_case order by export_id loop
  select * into e from public.generated_exports where generated_exports.id=task_export_id for update;
  perform 1 from private.export_archive_jobs where export_id=task_export_id for update;
  perform 1 from private.export_archive_attempts where export_id=task_export_id order by export_archive_attempts.id for update;
  perform 1 from private.new_correction_archive_runs where export_id=task_export_id order by new_correction_archive_runs.id for update;
  if exists(select 1 from private.new_correction_archive_cases where export_id=task_export_id and state<>'closing')
   or exists(select 1 from private.new_correction_archive_runs where export_id=task_export_id and state<>'buffers-zeroed')
   or exists(select 1 from private.export_archive_segments s join private.export_archive_attempts a on a.id=s.attempt_id
    left join private.new_correction_archive_r2_allocations r on r.attempt_id=s.attempt_id and r.ordinal=s.ordinal
    left join private.new_correction_archive_provider_dispositions d on d.attempt_id=s.attempt_id and d.ordinal=s.ordinal
    where a.export_id=task_export_id and(r.id is null or r.state<>'disposed' or d.reservation_hash is distinct from r.reservation_sha256
     or d.backend is distinct from 'archive-r2-current-object-v1' or d.immutable_evidence is distinct from r.provider_evidence
     or s.delete_acknowledged_at is null))
   or exists(select 1 from storage.objects o where o.bucket_id='exports' and o.name in(
    select s.object_key from private.export_archive_segments s join private.export_archive_attempts a on a.id=s.attempt_id where a.export_id=task_export_id)) then
   return false;end if;
  -- Only durable, exact, native R2 dispositions reach these physical deletes.
  delete from private.new_correction_archive_provider_dispositions where attempt_id in(select a.id from private.export_archive_attempts a where a.export_id=task_export_id);
  delete from private.new_correction_archive_r2_allocations where attempt_id in(select a.id from private.export_archive_attempts a where a.export_id=task_export_id);
  delete from private.export_archive_segments where attempt_id in(select a.id from private.export_archive_attempts a where a.export_id=task_export_id);
  -- Delete only its exact durable child rows, retaining no orphan cookie/nonce.
  delete from private.new_correction_archive_runs where export_id=task_export_id;
  delete from private.export_archive_downloads where export_id=task_export_id;
  delete from public.download_ranges where session_id in(select d.id from public.download_sessions d where d.target_kind='export' and d.target_id=task_export_id);
  delete from public.download_sessions where target_kind='export' and target_id=task_export_id;
  delete from private.export_archive_manifest_pages where attempt_id in(select export_archive_attempts.id from private.export_archive_attempts where export_id=task_export_id);
  delete from private.export_archive_nonce_uses where export_id=task_export_id;
  delete from private.new_correction_archive_cases where export_id=task_export_id;
  -- The actual guard removes empty attempts/jobs and checks no segment remains.
  delete from public.generated_exports where generated_exports.id=task_export_id;
 end loop;
 return not exists(select 1 from private.new_correction_archive_cases where correction_id=p_case);
end $body$;
revoke all on function private.drain_requester_statement_archive_zero_v1(uuid)
 from public,anon,authenticated,service_role,inherit_upload_only;
