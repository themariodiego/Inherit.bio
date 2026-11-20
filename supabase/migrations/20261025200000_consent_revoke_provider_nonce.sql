-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. It follows 20261023120000, whose consumer it calls
-- unchanged, and 20260907081757, whose two revocation writers it wraps
-- unchanged.
-- =====================================================================
--
-- G8.5, api.consent-revoke (owner decision of 23 October 2026, "G8.5: forms,
-- CSRF, the server action and the Resend webhook", item 1: the code moves to
-- the register). The register's api.consent-revoke requires
-- X-Inherit-Operation-Nonce-from-the-consent-page on every request. Since
-- 20261023120000 the directional purpose revocation records it; the other two
-- kinds the route serves did not read one:
--
--   - a cloud-model provider grant (/settings/consents), revoked by
--     public.revoke_cloud_model_consent;
--   - the own-Copilot permission (/settings/copilot), revoked by
--     public.revoke_own_copilot_v1.
--
-- Each gains one service-only door that records the hash of the nonce its
-- page rendered for this account, session and grant (operation
-- consent_revoke, which the consumer already accepts), through
-- private.consume_account_operation_nonce_v1, in the same transaction and
-- before the unchanged writer runs. A replayed, foreign, expired or malformed
-- nonce writes nothing.
--
-- No table, column, constraint, audit event, writer body or wording changes,
-- and nothing is patched in place: the consumer is called as it stands, and
-- the predecessor guard holds both writers to their reviewed bodies and ACLs
-- (55000 otherwise).

do $predecessor$
begin
 if to_regprocedure('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)') is null
  or not exists(select 1 from pg_proc p where p.oid='private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)'::regprocedure
   and pg_get_functiondef(p.oid) like '%''consent_revoke''%' and p.proacl::text='{postgres=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.revoke_cloud_model_consent(uuid,uuid)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='40b1b49d088437b24878601795a2a2e0'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or not exists(select 1 from pg_proc p where p.oid='public.revoke_own_copilot_v1(uuid,uuid,uuid,jsonb)'::regprocedure
   and md5(pg_get_functiondef(p.oid))='931fc94abdcb0840ff7a202404c9c4fc'
   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  or to_regprocedure('public.revoke_cloud_model_consent_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)') is not null
  or to_regprocedure('public.revoke_own_copilot_with_nonce_v1(uuid,uuid,uuid,jsonb,text,timestamptz)') is not null then
  raise exception using errcode='55000',message='consent revoke provider nonce prerequisite differs'; end if;
end;
$predecessor$;

-- The cloud-model provider grant: the nonce first, then the unchanged writer.
-- It answers what the writer answers: false when the account holds no live
-- grant of that id, and the nonce is spent either way, as the directional
-- door spends it.
create function public.revoke_cloud_model_consent_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_grant_id uuid,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'consent_revoke',p_nonce_hash,p_nonce_expires_at);
 return public.revoke_cloud_model_consent(p_grant_id,p_account_id);
end $$;
revoke all on function public.revoke_cloud_model_consent_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.revoke_cloud_model_consent_with_nonce_v1(uuid,uuid,uuid,text,timestamptz) to service_role;

-- The own-Copilot permission: the nonce first, then the unchanged writer with
-- the authority the route read, which the writer re-checks under its own lock.
create function public.revoke_own_copilot_with_nonce_v1(p_account_id uuid,p_session_id uuid,p_subject_id uuid,p_expected jsonb,
 p_nonce_hash text,p_nonce_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform private.consume_account_operation_nonce_v1(p_account_id,p_session_id,'consent_revoke',p_nonce_hash,p_nonce_expires_at);
 return public.revoke_own_copilot_v1(p_account_id,p_session_id,p_subject_id,p_expected);
end $$;
revoke all on function public.revoke_own_copilot_with_nonce_v1(uuid,uuid,uuid,jsonb,text,timestamptz)
 from public,anon,authenticated,inherit_upload_only;
grant execute on function public.revoke_own_copilot_with_nonce_v1(uuid,uuid,uuid,jsonb,text,timestamptz) to service_role;

-- Postflight: both doors exist with exactly the owner's and the service
-- role's execute, and both writers are still their reviewed bodies.
do $postflight$
begin
 if (select proacl::text from pg_proc where oid='public.revoke_cloud_model_consent_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure)
   is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  or (select proacl::text from pg_proc where oid='public.revoke_own_copilot_with_nonce_v1(uuid,uuid,uuid,jsonb,text,timestamptz)'::regprocedure)
   is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  or (select md5(pg_get_functiondef(oid)) from pg_proc where oid='public.revoke_cloud_model_consent(uuid,uuid)'::regprocedure)
   is distinct from '40b1b49d088437b24878601795a2a2e0'
  or (select md5(pg_get_functiondef(oid)) from pg_proc where oid='public.revoke_own_copilot_v1(uuid,uuid,uuid,jsonb)'::regprocedure)
   is distinct from '931fc94abdcb0840ff7a202404c9c4fc' then
  raise exception using errcode='55000',message='consent revoke provider nonce successor differs'; end if;
end;
$postflight$;

notify pgrst, 'reload schema';
