-- SOURCE ONLY. Existing real archive download grant, live origin, exact ready
-- attempt and original deadline; an allocation UUID is not a read capability.
create function private.current_requester_statement_r2_read_v1(p_download_hash text,p_attempt uuid,p_ordinal bigint,p_receipt text)
returns jsonb language plpgsql security invoker set search_path='' as $body$
declare d private.export_archive_downloads;e public.generated_exports;j private.export_archive_jobs;
 a private.export_archive_attempts;s private.export_archive_segments;r private.new_correction_archive_r2_allocations;
begin
 if current_user<>'postgres' or session_user<>'postgres' or coalesce(p_download_hash,'')!~'^[0-9a-f]{64}$' then raise exception using errcode='42501',message='not_found';end if;
 select * into d from private.export_archive_downloads where cookie_hash=p_download_hash;
 select * into j from private.export_archive_jobs where export_id=d.export_id;
 -- Existing origin door takes the subject/session authority lock before grants
 -- and attempt locks. It recomputes exact case-bound receipt via V4 capture.
 perform private.export_archive_current_v1(d.export_id,p_receipt);
 select * into d from private.export_archive_downloads where cookie_hash=p_download_hash for share;
 select * into e from public.generated_exports where id=d.export_id for share;
 select * into j from private.export_archive_jobs where export_id=e.id for share;
 select * into a from private.export_archive_attempts where id=p_attempt and export_id=e.id for share;
 select * into s from private.export_archive_segments where attempt_id=a.id and ordinal=p_ordinal for share;
 select * into r from private.new_correction_archive_r2_allocations where attempt_id=a.id and ordinal=s.ordinal for share;
 if not private.requester_statement_test_enabled_v1() or d.id is null or d.revoked_at is not null
  or d.expires_at<=clock_timestamp() or d.idle_expires_at<=clock_timestamp()
  or d.attempt_id is distinct from a.id or d.export_revision is distinct from e.export_revision
  or d.authority_receipt is distinct from p_receipt or e.status<>'ready' or e.expires_at<=clock_timestamp()
  or j.deadline<=clock_timestamp() or j.active_attempt is distinct from a.id or a.state<>'bytes_complete'
  or r.id is null or r.state<>'written' or s.object_id is distinct from r.id or s.acknowledged_at is null
  or s.delete_acknowledged_at is not null or r.original_deadline<=clock_timestamp()
  or not exists(select 1 from private.new_correction_archive_cases where export_id=e.id and state='active')
  or exists(select 1 from private.new_correction_archive_cases where export_id=e.id and state<>'active') then raise exception using errcode='42501',message='not_found';end if;
 return jsonb_build_object('objectId',r.id,'writeIdentity',r.write_identity,'writeBindingSha256',r.write_binding_sha256,
  'allocationSha256',r.allocation_sha256,'configurationSha256',r.configuration_sha256,'originalDeadline',r.original_deadline);
end $body$;
revoke all on function private.current_requester_statement_r2_read_v1(text,uuid,bigint,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
