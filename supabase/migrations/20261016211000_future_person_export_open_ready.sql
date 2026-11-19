-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Future Person claims are TEST-LOCAL only.
-- =====================================================================
--
-- The claimant export route (register api.future-person-export, POST/GET
-- /api/future-person/claim/[token]/export with the segment pinned to
-- `session`). Its capture, create and status check already exist in
-- public.future_person_export_request_v1 (20260930243000). This adds the two
-- remaining database doors of largeExportDeliveryContract:
--
--   public.future_person_export_ready_v1     the READY metadata for an exact
--     cookie-bound export of the same live rights session, read-only;
--   public.future_person_export_open_ready_v1 the explicit open-ready POST:
--     it consumes the one-time open-ready envelope and creates the revocable
--     download session in one transaction, with zero export enqueue.
--
-- Nothing here publishes an archive. READY for any segmented archive other
-- than the TEST account archive stays refused by
-- private.guard_segmented_export_publication_v1, so today both doors refuse
-- every claimant export with the one opaque 42501. They become reachable
-- only when a reviewed claimant publication path exists. No function is
-- patched, and no table, column or grant other than these two functions
-- changes.

do $predecessor$
begin
 if to_regprocedure('public.future_person_export_request_v1(text,text,jsonb,text)') is null
   or to_regprocedure('private.future_person_rights_session_v1(text,boolean)') is null
   or to_regprocedure('private.export_archive_authority_v1(jsonb,text,uuid)') is null
   or to_regprocedure('private.export_archive_current_v1(uuid,text)') is null
   or to_regprocedure('private.export_archive_nonce_v1(uuid,text,jsonb,text)') is null
   or to_regclass('private.export_archive_downloads') is null then
  raise exception using errcode='55000',message='claimant export prerequisite missing'; end if;
 if to_regprocedure('public.future_person_export_open_ready_v1(text,jsonb,text)') is not null
   or to_regprocedure('public.future_person_export_ready_v1(text,jsonb)') is not null then
  raise exception using errcode='55000',message='claimant export successor already exists'; end if;
end;
$predecessor$;

-- The exact current READY export of this rights session, locked, or 42501.
create function private.future_person_ready_export_v1(p_session_hash text,p_export uuid,p_cookie_hash text,
 out e public.generated_exports,out j private.export_archive_jobs,out a private.export_archive_attempts,out receipt text)
language plpgsql security definer set search_path='' as $$
declare rs public.rights_sessions;c jsonb;origin jsonb;
begin
 rs:=private.future_person_rights_session_v1(p_session_hash,true);
 if rs.id is null or p_export is null or coalesce(p_cookie_hash,'')!~'^[0-9a-f]{64}$'
   or not private.rights_action_permitted_v1(rs.purpose,'export','api.future-person-export') then
  raise exception using errcode='42501',message='not_found';end if;
 origin:=jsonb_build_object('kind','independent-rights','sessionHash',p_session_hash);
 c:=private.export_archive_authority_v1(origin,'subject',rs.target_id);
 select * into e from public.generated_exports where id=p_export for update;
 select * into j from private.export_archive_jobs where export_id=e.id for update;
 select * into a from private.export_archive_attempts where id=j.active_attempt and export_id=e.id;
 if e.id is null or e.origin_kind<>'independent-rights' or e.account_id is not null
   or e.requester_principal_id<>rs.principal_id or e.target_kind<>'subject' or e.target_id<>rs.target_id
   or j.origin is distinct from origin or j.export_cookie_hash is distinct from p_cookie_hash
   or j.route_id<>'api.future-person-export' or j.export_contract<>'approved-future-person-export-v1'
   or e.status<>'ready' or e.expires_at is null or e.expires_at<=clock_timestamp() or j.deadline<=clock_timestamp()
   or a.id is null or a.state<>'bytes_complete' or e.byte_count is null or e.archive_sha256 is null then
  raise exception using errcode='42501',message='not_found';end if;
 perform private.export_archive_current_v1(e.id,c->>'authorityReceipt');
 receipt:=c->>'authorityReceipt';
end $$;

-- GET with a ready cookie: metadata only, and no write of any kind.
create function public.future_person_export_ready_v1(p_session_hash text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r record;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>2
   or not(p_payload ?& array['exportId','exportCookieHash']) or coalesce(p_payload->>'exportId','')
   !~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  raise exception using errcode='22023',message='invalid_request';end if;
 select * into r from private.future_person_ready_export_v1(p_session_hash,(p_payload->>'exportId')::uuid,p_payload->>'exportCookieHash');
 return jsonb_build_object('exportId',(r.e).id,'exportRevision',(r.e).export_revision,'sizeBytes',(r.e).byte_count,
  'sha256',(r.e).archive_sha256,'expiresAt',(r.e).expires_at,'segmentCount',(r.a).segment_count,
  'pageCount',(r.a).page_count,'authorityReceipt',r.receipt);
end $$;

-- The explicit open-ready POST. Same shape as the account door's open-ready.
create function public.future_person_export_open_ready_v1(p_session_hash text,p_payload jsonb,p_csrf_binding text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $$
declare r record;expiry timestamptz;download_id uuid;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>4
   or not(p_payload ?& array['exportId','envelope','downloadCookieHash','exportCookieHash'])
   or coalesce(p_payload->>'downloadCookieHash','')!~'^[0-9a-f]{64}$'
   or coalesce(p_payload->>'exportId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  raise exception using errcode='22023',message='invalid_request';end if;
 select * into r from private.future_person_ready_export_v1(p_session_hash,(p_payload->>'exportId')::uuid,p_payload->>'exportCookieHash');
 perform private.export_archive_nonce_v1((r.e).id,'open-ready',p_payload->'envelope',p_csrf_binding);
 expiry:=least((r.e).expires_at,clock_timestamp()+interval '1 hour',(r.j).deadline);
 insert into private.export_archive_downloads(export_id,attempt_id,export_revision,cookie_hash,authority_receipt,expires_at,idle_expires_at)
 values((r.e).id,(r.j).active_attempt,(r.e).export_revision,p_payload->>'downloadCookieHash',(r.j).authority_receipt,
  expiry,least(expiry,clock_timestamp()+interval '5 minutes')) returning id into download_id;
 perform private.export_archive_current_v1((r.e).id,(r.j).authority_receipt);
 return jsonb_build_object('downloadSessionId',download_id,'expiresAt',expiry,'chunkBytes',4000000,
  'sizeBytes',(r.e).byte_count,'sha256',(r.e).archive_sha256);
end $$;

revoke all on function private.future_person_ready_export_v1(text,uuid,text)
 from public,anon,authenticated,service_role,inherit_upload_only;
revoke all on function public.future_person_export_ready_v1(text,jsonb),
 public.future_person_export_open_ready_v1(text,jsonb,text) from public,anon,authenticated,service_role,inherit_upload_only;
grant execute on function public.future_person_export_ready_v1(text,jsonb),
 public.future_person_export_open_ready_v1(text,jsonb,text) to service_role;
