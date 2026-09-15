-- Fenced finalization attempts, including interruption before validation ends.
-- No upload ceiling, admission, source identity, consent or retention change.
-- There is no session-independent finalization: retry requires the same
-- currently authorized originating session within the original upload expiry.
-- V1 remains readable/callable for its existing sessions. The application uses
-- V2; a V1 caller cannot enter a V2 attempt or bypass its ownership fence.
create table private.own_upload_finalization_attempts (
 upload_id uuid primary key references public.upload_sessions(id) on delete cascade,
 claim uuid not null,
 lease_expires_at timestamptz not null
);
alter table private.own_upload_finalization_attempts enable row level security;
revoke all on private.own_upload_finalization_attempts from public,anon,authenticated,inherit_upload_only,service_role;
-- An operational child of the already registered upload session. Parent purge
-- and account deletion cascade to it, but promotion retains the parent and
-- cancels its staging purge, so successful publication must retire this child.
create function private.retire_promoted_own_upload_finalization_attempt_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $function$
begin
 delete from private.own_upload_finalization_attempts
  where upload_id=new.id and claim=old.finalization_claim;
 return new;
end;
$function$;
revoke all on function private.retire_promoted_own_upload_finalization_attempt_v1()
 from public,anon,authenticated,inherit_upload_only,service_role;
-- Completion checks the live claim, storage identity and staging absence under
-- the upload row lock before promotion. Deletion is part of that transaction:
-- a failed completion restores ownership. A lost success response can retry
-- the retained promoted parent, which returns the existing file without a lease.
create trigger retire_promoted_own_upload_finalization_attempt
 after update of status on public.upload_sessions
 for each row when (old.status='validating' and new.status='promoted'
  and new.finalized_file_id is not null
  and new.finalization_claim is not distinct from old.finalization_claim)
 execute function private.retire_promoted_own_upload_finalization_attempt_v1();
-- Keep rejected attempts until parent cleanup: abort still needs their lease
-- fence before handing out provider deletion keys, including repeated aborts.

create or replace function private.own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid,p_start boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype; c jsonb;
begin
 select * into u from public.upload_sessions where id=p_upload_id;
 if u.id is null or u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or u.token_jti is null or u.maximum_decoded_bytes is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(u) is distinct from to_jsonb(locked_u) or u.expires_at<=clock_timestamp()
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
   'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
   'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
   'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 -- V2 owns an independent attempt lease even before the first checkpoint.
 -- Legacy callers cannot enter it; every existing read/write/complete RPC
 -- still passes here, so rotating the claim fences all previous holders.
 if exists(select 1 from private.own_upload_finalization_attempts where upload_id=u.id) then
  if p_start and u.status<>'promoted' then
   raise exception using errcode='55000',message='upload_unavailable';
  elsif not p_start and not exists(select 1 from private.own_upload_finalization_attempts a
   where a.upload_id=u.id and a.claim=p_claim and a.lease_expires_at>clock_timestamp()) then
   raise exception using errcode='42501',message='not_found';
  end if;
 end if;
 if p_start then
  if u.status='promoted' and u.finalized_file_id is not null then
   return jsonb_build_object('status','complete','fileId',u.finalized_file_id); end if;
  if u.status='validating' then
   -- Resume this session's own finalization, or refuse. The lapsed lease is
   -- the only evidence that the previous holder is gone; a live one means it
   -- is still working and a second request must not join it.
   if not exists(select 1 from private.own_upload_finalization_checkpoints k
    where k.upload_id=u.id and k.finalization_claim=u.finalization_claim
     and k.lease_expires_at<=clock_timestamp()) then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  elsif u.status<>'uploaded' then
   raise exception using errcode='55000',message='upload_unavailable';
  else
   update public.upload_sessions set status='validating',finalization_claim=gen_random_uuid(),
    final_object_name=gen_random_uuid(),finalization_started_at=clock_timestamp()
    where id=u.id returning * into u;
  end if;
 elsif u.status<>'validating' or p_claim is null or u.finalization_claim is distinct from p_claim then
  raise exception using errcode='42501',message='not_found';
 end if;
 return jsonb_build_object('status','authorized','uploadId',u.id,'claim',u.finalization_claim,
  'bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name,
  'expectedSize',u.expected_size,'expectedSha256',u.expected_sha256,'declaredFormat',u.declared_format,
  'maximumDecodedBytes',u.maximum_decoded_bytes);
exception when insufficient_privilege or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$function$;

create or replace function private.abort_own_upload_finalization_v1(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype;
begin
 select * into u from public.upload_sessions where id=p_upload_id for update;
 if u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or p_claim is null or u.finalization_claim is distinct from p_claim
  or u.status not in ('validating','rejected') or u.finalized_file_id is not null then
  raise exception using errcode='42501',message='not_found'; end if;
 -- Cleanup can survive consent withdrawal, but it cannot outlive ownership.
 -- The upload row lock makes rejection exclusive with a new begin/publication.
 if exists(select 1 from private.own_upload_finalization_attempts where upload_id=u.id)
  and not exists(select 1 from private.own_upload_finalization_attempts
   where upload_id=u.id and claim=p_claim and lease_expires_at>clock_timestamp()) then
  raise exception using errcode='42501',message='not_found'; end if;
 update public.upload_sessions set status='rejected',consumed_at=coalesce(consumed_at,clock_timestamp()),
  finalization_cleanup_pending=true where id=u.id;
 return jsonb_build_object('bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name);
end;
$function$;

create function private.begin_own_upload_finalization_v2(p_account_id uuid,p_session_id uuid,p_upload_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; locked_u public.upload_sessions%rowtype; c jsonb; a private.own_upload_finalization_attempts%rowtype;
 k private.own_upload_finalization_checkpoints%rowtype; previous_claim uuid; stamp timestamptz;
begin
 select * into u from public.upload_sessions where id=p_upload_id;
 if u.id is null or u.account_id is distinct from p_account_id or u.auth_session_id is distinct from p_session_id
  or u.token_jti is null or u.maximum_decoded_bytes is null then
  raise exception using errcode='42501',message='not_found'; end if;
 c:=private.own_upload_store_authority_v1(p_account_id,p_session_id,u.subject_id);
 select * into locked_u from public.upload_sessions where id=u.id for update;
 if to_jsonb(u) is distinct from to_jsonb(locked_u) or u.expires_at<=clock_timestamp()
  or c is distinct from jsonb_build_object('accountRevision',u.account_revision,'authSessionRevision',u.account_auth_session_revision,
   'jurisdictionRevision',u.jurisdiction_revision,'subjectBindingRevision',u.subject_binding_revision,
   'accountBindingRevision',u.account_binding_revision,'subjectLifecycleRevision',u.subject_lifecycle_revision,
   'originatingSessionRevision',u.originating_session_revision,'uploadConsentId',u.upload_consent_id) then
  raise exception using errcode='42501',message='not_found'; end if;
 if u.status='promoted' and u.finalized_file_id is not null then
  return jsonb_build_object('status','complete','fileId',u.finalized_file_id); end if;
 select * into a from private.own_upload_finalization_attempts where upload_id=u.id for update;
 select * into k from private.own_upload_finalization_checkpoints where upload_id=u.id for update;
 stamp:=clock_timestamp();
 if u.status='validating' then
  if a.upload_id is not null then
   if a.claim is distinct from u.finalization_claim or a.lease_expires_at>stamp then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  else
   -- A request started by the old deployment has no attempt lease. Drain its
   -- existing 300-second invocation window after its latest known activity.
   -- Missing validation progress may restart only once that window has passed.
   if u.finalization_started_at is null or
    greatest(u.finalization_started_at,coalesce(k.updated_at,u.finalization_started_at))+interval '300 seconds'>stamp then
    raise exception using errcode='55000',message='upload_unavailable'; end if;
  end if;
  if k.upload_id is not null and k.finalization_claim is distinct from u.finalization_claim then
   raise exception using errcode='42501',message='not_found'; end if;
 elsif u.status<>'uploaded' or a.upload_id is not null or k.upload_id is not null then
  raise exception using errcode='55000',message='upload_unavailable';
 end if;
 previous_claim:=u.finalization_claim;
 update public.upload_sessions set status='validating',finalization_claim=gen_random_uuid(),
  final_object_name=coalesce(final_object_name,gen_random_uuid()),finalization_started_at=stamp
  where id=u.id returning * into u;
 insert into private.own_upload_finalization_attempts(upload_id,claim,lease_expires_at)
  values(u.id,u.finalization_claim,least(stamp+interval '60 seconds',u.expires_at))
  on conflict(upload_id) do update set claim=excluded.claim,lease_expires_at=excluded.lease_expires_at;
 -- Transfer only the exact prior claim's immutable evidence. Revision and byte
 -- offset do not reset, so any stale writer fails both ownership and CAS.
 update private.own_upload_finalization_checkpoints set finalization_claim=u.finalization_claim,
  lease_expires_at=least(stamp+interval '60 seconds',u.expires_at)
  where upload_id=u.id and finalization_claim=previous_claim;
 return jsonb_build_object('status','authorized','uploadId',u.id,'claim',u.finalization_claim,
  'bucket','genomes','stagingKey',u.staging_object_name,'finalKey',u.final_object_name,
  'expectedSize',u.expected_size,'expectedSha256',u.expected_sha256,'declaredFormat',u.declared_format,
  'maximumDecodedBytes',u.maximum_decoded_bytes);
exception when insufficient_privilege or object_not_in_prerequisite_state then
 raise exception using errcode='42501',message='not_found';
end;
$function$;

create function private.authorize_own_upload_finalization_v2(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare m jsonb;
begin
 -- Takes the same account/source/upload locks and refuses an expired lease.
 -- Renewal never revives an expired or superseded holder.
 m:=private.own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,p_claim,false);
 update private.own_upload_finalization_attempts a set
  lease_expires_at=least(clock_timestamp()+interval '60 seconds',u.expires_at)
  from public.upload_sessions u where a.upload_id=p_upload_id and u.id=a.upload_id
   and a.claim=p_claim and a.lease_expires_at>clock_timestamp();
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 return m;
end;
$function$;

create function public.begin_own_upload_finalization_v2(p_account_id uuid,p_session_id uuid,p_upload_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.begin_own_upload_finalization_v2(p_account_id,p_session_id,p_upload_id);
$function$;
create function public.authorize_own_upload_finalization_v2(p_account_id uuid,p_session_id uuid,p_upload_id uuid,p_claim uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.authorize_own_upload_finalization_v2(p_account_id,p_session_id,p_upload_id,p_claim);
$function$;

revoke all on function private.own_upload_finalization_v1(uuid,uuid,uuid,uuid,boolean),
 private.abort_own_upload_finalization_v1(uuid,uuid,uuid,uuid),
 private.begin_own_upload_finalization_v2(uuid,uuid,uuid),public.begin_own_upload_finalization_v2(uuid,uuid,uuid),
 private.authorize_own_upload_finalization_v2(uuid,uuid,uuid,uuid),public.authorize_own_upload_finalization_v2(uuid,uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.own_upload_finalization_v1(uuid,uuid,uuid,uuid,boolean),
 private.abort_own_upload_finalization_v1(uuid,uuid,uuid,uuid),
 private.begin_own_upload_finalization_v2(uuid,uuid,uuid),public.begin_own_upload_finalization_v2(uuid,uuid,uuid),
 private.authorize_own_upload_finalization_v2(uuid,uuid,uuid,uuid),public.authorize_own_upload_finalization_v2(uuid,uuid,uuid,uuid)
 to service_role;
