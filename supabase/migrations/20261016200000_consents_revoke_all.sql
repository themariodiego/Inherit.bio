-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It opens no restricted capability and touches no
-- jurisdiction gate: revoking is a right (policy.jurisdictionBypass).
-- =====================================================================
--
-- api.consents-revoke-all (register; G2.1 "Build all 24"): one request turns
-- off every current purpose grant whose immutable signature principal is the
-- acting account, resolved entirely here, never from the request.
--
-- What it reuses, unchanged, so each grant ends exactly as the single-grant
-- route api.consent-revoke ends it:
--
--   * public.revoke_directional_purpose_v1 for every ordinary analytic,
--     raw-export, family pair or Portrait grant and for the acting parent's
--     own embryo.analysis grant. That function terminalizes the base and
--     direction rows together, returns a Portrait pair to pending, deletes
--     the recipient's exact subject-or-cohort-and-purpose derived rows,
--     enqueues the purpose.derived-60s purge and, for the canonical own
--     reports, runs the own-report purge. Revoking an embryo.analysis grant
--     sets revoked_at, which fires the cohort Copilot prune trigger
--     (20260929143000); no source byte is deleted.
--   * public.revoke_own_copilot_v1 for the own Copilot grant whose authority
--     is current (it also ends the paired cloud provider grant). An own
--     Copilot grant that is no longer the current authority already
--     authorizes nothing; its base and direction rows are terminalized the
--     same way that function does.
--   * public.revoke_cloud_model_consent for every current cloud-model
--     provider grant (consent_grants), plus any current cloud_model
--     subject_consents row of the account (cloud-consent-revocation-v1).
--
-- Excluded, as the register says: class-upload consents (they are artifact
-- signatures, not purpose grants) and every grant another principal signed.
--
-- For each embryo.analysis grant the cohort is locked and the signer must be
-- one exact current required_upload_principals member
-- (embryo-basis-authority-v1). A grant this function cannot dispatch, or an
-- embryo signer that is no longer a current member, fails the whole request
-- (42501) and writes nothing: the route answers resource-not-found-v1.
--
-- The one-time operation nonce the page rendered is recorded in
-- public.account_operation_nonces in the same transaction. A replay is
-- refused (22023) and writes nothing. One audit batch event closes it.

do $predecessor$
begin
 if to_regprocedure('public.revoke_directional_purpose_v1(uuid,uuid)') is null
  or to_regprocedure('public.revoke_own_copilot_v1(uuid,uuid,uuid,jsonb)') is null
  or to_regprocedure('private.own_copilot_authority_v1(uuid,uuid,uuid,jsonb)') is null
  or to_regprocedure('public.revoke_cloud_model_consent(uuid,uuid)') is null
  or to_regprocedure('private.embryo_cohort_set_v1(uuid,text)') is null
  or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null
  or to_regclass('public.account_operation_nonces') is null
  or not exists(select 1 from pg_constraint where conrelid='public.account_operation_nonces'::regclass
   and conname='account_operation_nonces_operation_check') then
  raise exception using errcode='55000',message='consents revoke-all prerequisite missing'; end if;
 if to_regprocedure('public.revoke_all_own_consents_v1(uuid,uuid,text,timestamptz)') is not null then
  raise exception using errcode='55000',message='consents revoke-all successor already exists'; end if;
end;
$predecessor$;

-- The operation check gains one value and keeps every value it holds now,
-- however many other migrations have widened it before this one runs.
do $widen$
declare v_values text[];
begin
 select array_agg(m[1] order by m[1]) into v_values
 from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
 where c.conrelid='public.account_operation_nonces'::regclass and c.conname='account_operation_nonces_operation_check';
 if v_values is null or not ('account_delete'=any(v_values)) then
  raise exception using errcode='55000',message='account operation check unreadable'; end if;
 if not ('consents_revoke_all'=any(v_values)) then v_values:=v_values||'consents_revoke_all'::text; end if;
 alter table public.account_operation_nonces drop constraint account_operation_nonces_operation_check;
 execute format('alter table public.account_operation_nonces add constraint account_operation_nonces_operation_check'
  ' check (operation = any (%L::text[]))', v_values);
end;
$widen$;

create function public.revoke_all_own_consents_v1(p_account_id uuid,p_session_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); g record; a jsonb; v_cloud uuid;
 v_purposes integer:=0; v_providers integer:=0; v_embryo integer:=0;
begin
 if p_account_id is null or p_session_id is null
  or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'
  or p_nonce_expires_at is null or p_nonce_expires_at<=v_now
  or p_nonce_expires_at>v_now+interval '10 minutes' then
  raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
 -- The canonical lock order: the acting account first.
 perform 1 from auth.users u where u.id=p_account_id and u.deleted_at is null for share;
 if not found then raise exception using errcode='42501',message='revoke-all unavailable'; end if;
 perform 1 from public.profiles where id=p_account_id for update;
 if not found then raise exception using errcode='42501',message='revoke-all unavailable'; end if;
 perform 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id
  and (s.not_after is null or s.not_after>v_now);
 if not found then raise exception using errcode='42501',message='revoke-all unavailable'; end if;

 delete from public.account_operation_nonces where operation='consents_revoke_all' and expires_at<=v_now;
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(p_nonce_hash,p_account_id,p_session_id,'consents_revoke_all',p_nonce_expires_at)
 on conflict(nonce_hash) do nothing;
 if not found then raise exception using errcode='22023',message='invalid_operation_nonce'; end if;
 update public.account_operation_nonces set consumed_at=v_now where nonce_hash=p_nonce_hash;

 for g in
  select pg.grant_id,pg.purpose,pg.target_kind,pg.target_id,pg.signer_principal_id,
   pg.copilot_recipient_revision,dsp.account_id as data_subject_account_id
  from public.purpose_grants pg
  join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  join public.subject_principals ssp on ssp.id=pg.signer_principal_id
  join public.consent_signatures cs on cs.id=pg.signature_id and cs.signer_principal_id=pg.signer_principal_id
  left join public.subject_principals dsp on dsp.id=pg.data_subject_principal_id
  where pg.revoked_at is null and dg.status='current' and ssp.account_id=p_account_id
  order by pg.grant_id
  for update of pg,dg
 loop
  -- Revocation only ever acts on the signer's own data subject here; any
  -- other shape is not this route's to end.
  if g.data_subject_account_id is distinct from p_account_id then
   raise exception using errcode='42501',message='revoke-all grant undispatchable'; end if;
  if g.purpose='embryo.analysis' then
   if g.target_kind<>'cohort' then
    raise exception using errcode='42501',message='revoke-all grant undispatchable'; end if;
   perform 1 from public.embryo_cohorts c where c.id=g.target_id for share;
   if not found or not (g.signer_principal_id=any(
     private.embryo_cohort_set_v1(g.target_id,'required_upload_principals'))) then
    raise exception using errcode='42501',message='revoke-all embryo authority unavailable'; end if;
   perform public.revoke_directional_purpose_v1(p_account_id,g.grant_id);
   v_embryo:=v_embryo+1;
  elsif g.copilot_recipient_revision is not null then
   if g.target_kind<>'subject' then
    raise exception using errcode='42501',message='revoke-all grant undispatchable'; end if;
   a:=private.own_copilot_authority_v1(p_account_id,p_session_id,g.target_id,null);
   if a is not null and a->>'copilotGrantId'=g.grant_id::text then
    perform public.revoke_own_copilot_v1(p_account_id,p_session_id,g.target_id,a);
   else
    update public.purpose_grants set revoked_at=v_now,revocation_reason='withdrawn' where grant_id=g.grant_id;
    update public.directional_grants set status='revoked',ended_at=v_now where grant_id=g.grant_id;
   end if;
  else
   perform public.revoke_directional_purpose_v1(p_account_id,g.grant_id);
  end if;
  v_purposes:=v_purposes+1;
 end loop;

 for v_cloud in
  select id from public.consent_grants where user_id=p_account_id and revoked_at is null order by id for update
 loop
  if not public.revoke_cloud_model_consent(v_cloud,p_account_id) then
   raise exception using errcode='42501',message='revoke-all provider grant unavailable'; end if;
  v_providers:=v_providers+1;
 end loop;
 with ended as (
  update public.subject_consents set revoked_at=v_now,revocation_reason='withdrawn'
  where account_id=p_account_id and consent_type='cloud_model' and revoked_at is null returning 1)
 select v_providers+count(*) into v_providers from ended;

 perform private.append_legal_audit_event('consents.revoked-all',null,'api.consents-revoke-all','accepted',
  jsonb_build_object('purposes',v_purposes,'embryo',v_embryo,'providers',v_providers));
 return v_purposes+v_providers;
end $$;
revoke all on function public.revoke_all_own_consents_v1(uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.revoke_all_own_consents_v1(uuid,uuid,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
