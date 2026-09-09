-- Durable progress for ONE in-flight original finalization. Additive and
-- currently unused: no route writes a checkpoint yet, no resumption path is
-- enabled, no limit moves and no admission opens here.
--
-- Why this shape. Measurement (docs/hosted-own-upload-readiness.md) shows the
-- finalize request is bounded by input/output, not by validation: it transfers
-- the object twice in 4,000,000-byte ranges, re-authorising before each range.
-- Today a failure at any point discards every completed byte and the person has
-- to upload the whole file again. The phases below let the same session resume
-- what it already finished.
--
-- What can and cannot resume, from the same measurement: rehashing the promoted
-- copy is plain bytes, so an offset plus a saved digest state resumes it
-- exactly. Validation decompresses, and gzip decoder state cannot be
-- serialised, so `validated` is all-or-nothing and simply is not re-run once
-- recorded. A checkpoint therefore never asserts that a source is readable; it
-- records only what this exact claim already proved.
create table private.own_upload_finalization_checkpoints (
 upload_id uuid primary key references public.upload_sessions(id) on delete cascade,
 finalization_claim uuid not null,
 revision bigint not null check(revision between 1 and 100000),
 checkpoint jsonb not null check(jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text)<=65536),
 lease_expires_at timestamptz not null,
 updated_at timestamptz not null default clock_timestamp()
);
alter table private.own_upload_finalization_checkpoints enable row level security;
revoke all on private.own_upload_finalization_checkpoints
 from public,anon,authenticated,inherit_upload_only,service_role;
-- Deletion needs no new manifest entry: the row cascades with its upload
-- session, which both the two-hour staging purge and account deletion remove.
-- `supabase/tests/own_upload_finalization_checkpoints.sql` asserts that.

create function private.own_upload_finalization_phase_rank_v1(p_phase text) returns integer
language sql immutable set search_path=pg_catalog as $function$
 select array_position(array['validated','copied','verifying','verified','staging-removed'],p_phase);
$function$;
revoke all on function private.own_upload_finalization_phase_rank_v1(text)
 from public,anon,authenticated,inherit_upload_only;

create function private.own_upload_finalization_checkpoint_receipt_v1(
 p_upload_id uuid,c private.own_upload_finalization_checkpoints)
returns jsonb language sql immutable set search_path=pg_catalog as $function$
 select jsonb_build_object('version','own-upload-finalization-checkpoint-receipt-v1',
  'uploadId',p_upload_id,'revision',coalesce(c.revision,0),
  'leaseExpiresAt',c.lease_expires_at,'checkpoint',c.checkpoint);
$function$;
revoke all on function private.own_upload_finalization_checkpoint_receipt_v1(
 uuid,private.own_upload_finalization_checkpoints) from public,anon,authenticated,inherit_upload_only;

create function private.read_own_upload_finalization_checkpoint_v1(p_account_id uuid,p_session_id uuid,
 p_upload_id uuid,p_claim uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare c private.own_upload_finalization_checkpoints%rowtype;
begin
 -- Full current authority first: account, session, consent revisions, exact
 -- claim, `validating` status and an unexpired session. A checkpoint is never
 -- readable on weaker grounds than the finalization it belongs to.
 perform private.own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,p_claim,false);
 select * into c from private.own_upload_finalization_checkpoints where upload_id=p_upload_id for share;
 -- A checkpoint from a superseded claim is never adopted.
 if c.upload_id is not null and c.finalization_claim is distinct from p_claim then
  raise exception using errcode='42501',message='not_found'; end if;
 return private.own_upload_finalization_checkpoint_receipt_v1(p_upload_id,c);
end;
$function$;
revoke all on function private.read_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.read_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid) to service_role;
create function public.read_own_upload_finalization_checkpoint_v1(p_account_id uuid,p_session_id uuid,
 p_upload_id uuid,p_claim uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.read_own_upload_finalization_checkpoint_v1(p_account_id,p_session_id,p_upload_id,p_claim);
$function$;
revoke all on function public.read_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.read_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid) to service_role;

create function private.write_own_upload_finalization_checkpoint_v1(p_account_id uuid,p_session_id uuid,
 p_upload_id uuid,p_claim uuid,p_expected_revision bigint,p_checkpoint jsonb,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private
as $function$
declare u public.upload_sessions%rowtype; old private.own_upload_finalization_checkpoints%rowtype;
 fresh private.own_upload_finalization_checkpoints%rowtype; phase_rank integer; old_rank integer;
 verified numeric; keys text[]:=array['version','phase','rawSha256','decodedSha256','verifiedBytes','digestState'];
begin
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=100000
  or p_lease_seconds is null or p_lease_seconds<1 or p_lease_seconds>300
  or jsonb_typeof(p_checkpoint) is distinct from 'object' or octet_length(p_checkpoint::text)>65536
  or not(p_checkpoint ?& keys) or p_checkpoint-keys<>'{}'::jsonb
  or p_checkpoint->>'version' is distinct from 'own-upload-finalization-checkpoint-v1'
  or coalesce(p_checkpoint->>'rawSha256','')!~'^[0-9a-f]{64}$'
  or coalesce(p_checkpoint->>'decodedSha256','')!~'^[0-9a-f]{64}$'
  or jsonb_typeof(p_checkpoint->'verifiedBytes') is distinct from 'number'
  or (p_checkpoint->>'verifiedBytes')!~'^(0|[1-9][0-9]{0,18})$'
  or jsonb_typeof(p_checkpoint->'digestState') not in('string','null')
  or (jsonb_typeof(p_checkpoint->'digestState')='string'
   and coalesce(p_checkpoint->>'digestState','')!~'^[A-Za-z0-9+/]{1,4096}={0,2}$') then
  raise exception using errcode='22023',message='invalid_checkpoint'; end if;
 phase_rank:=private.own_upload_finalization_phase_rank_v1(p_checkpoint->>'phase');
 verified:=(p_checkpoint->>'verifiedBytes')::numeric;
 if phase_rank is null then raise exception using errcode='22023',message='invalid_checkpoint'; end if;
 -- Partial copy verification is the only phase that carries resumable digest
 -- state, and the only one allowed a byte offset short of the whole object.
 if (jsonb_typeof(p_checkpoint->'digestState')='string') <> (phase_rank=3)
  or (phase_rank<>3 and verified<>0 and phase_rank<4) then
  raise exception using errcode='22023',message='invalid_checkpoint'; end if;

 perform private.own_upload_finalization_v1(p_account_id,p_session_id,p_upload_id,p_claim,false);
 select * into u from public.upload_sessions where id=p_upload_id;
 if verified>u.expected_size or (phase_rank>=4 and verified<>u.expected_size)
  or (u.expected_sha256 is not null and p_checkpoint->>'rawSha256' is distinct from u.expected_sha256) then
  raise exception using errcode='22023',message='invalid_checkpoint'; end if;

 select * into old from private.own_upload_finalization_checkpoints where upload_id=p_upload_id for update;
 if old.upload_id is not null then
  if old.finalization_claim is distinct from p_claim then
   raise exception using errcode='42501',message='not_found'; end if;
  old_rank:=private.own_upload_finalization_phase_rank_v1(old.checkpoint->>'phase');
  -- Progress only moves forward, and what one pass proved is never restated
  -- differently: a changed hash means a different source, not a resumption.
  if phase_rank<old_rank or (phase_rank=old_rank and verified<(old.checkpoint->>'verifiedBytes')::numeric)
   or p_checkpoint->>'rawSha256' is distinct from old.checkpoint->>'rawSha256'
   or p_checkpoint->>'decodedSha256' is distinct from old.checkpoint->>'decodedSha256' then
   raise exception using errcode='22023',message='checkpoint_regression'; end if;
 end if;
 if coalesce(old.revision,0)<>p_expected_revision then
  raise exception using errcode='40001',message='checkpoint_revision_conflict'; end if;

 insert into private.own_upload_finalization_checkpoints(upload_id,finalization_claim,revision,checkpoint,lease_expires_at)
 values(p_upload_id,p_claim,p_expected_revision+1,p_checkpoint,
  least(clock_timestamp()+make_interval(secs=>p_lease_seconds),u.expires_at))
 on conflict(upload_id) do update set finalization_claim=excluded.finalization_claim,
  revision=excluded.revision,checkpoint=excluded.checkpoint,
  lease_expires_at=excluded.lease_expires_at,updated_at=clock_timestamp()
 returning * into fresh;
 return private.own_upload_finalization_checkpoint_receipt_v1(p_upload_id,fresh);
end;
$function$;
revoke all on function private.write_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid,bigint,jsonb,integer)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function private.write_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid,bigint,jsonb,integer) to service_role;
create function public.write_own_upload_finalization_checkpoint_v1(p_account_id uuid,p_session_id uuid,
 p_upload_id uuid,p_claim uuid,p_expected_revision bigint,p_checkpoint jsonb,p_lease_seconds integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $function$
 select private.write_own_upload_finalization_checkpoint_v1(p_account_id,p_session_id,p_upload_id,
  p_claim,p_expected_revision,p_checkpoint,p_lease_seconds);
$function$;
revoke all on function public.write_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid,bigint,jsonb,integer)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.write_own_upload_finalization_checkpoint_v1(uuid,uuid,uuid,uuid,bigint,jsonb,integer) to service_role;

-- A checkpoint exists only for the duration of one in-flight finalization. The
-- moment the session leaves `validating` — promoted, rejected or otherwise — its
-- recorded hashes have served their purpose and must not linger: the committed
-- file already carries them, and a deleted file must not leave a copy behind in
-- a private table. Retiring them here keeps that true without editing the
-- existing completion and cleanup functions.
create function private.retire_own_upload_finalization_checkpoint_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $function$
begin
 delete from private.own_upload_finalization_checkpoints where upload_id=new.id;
 return new;
end;
$function$;
-- Security definer, so it must be unreachable from the upload role: the
-- storage-authorization test counts exactly which definer functions that role
-- may execute, and an unrevoked one is a privilege leak, not a detail.
revoke all on function private.retire_own_upload_finalization_checkpoint_v1()
 from public,anon,authenticated,inherit_upload_only;
create trigger retire_own_upload_finalization_checkpoint
 after update of status on public.upload_sessions
 for each row when (old.status='validating' and new.status is distinct from 'validating')
 execute function private.retire_own_upload_finalization_checkpoint_v1();
