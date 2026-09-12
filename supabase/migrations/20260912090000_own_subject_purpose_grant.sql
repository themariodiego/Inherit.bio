-- D-097, resolved by the operator on 2026-09-12: the legacy half of
-- `ancestry.json` must behave like the canonical half after the `ancestry`
-- purpose is revoked. Until now it did not, and the gap was wider than the
-- defect recorded.
--
-- WHAT WAS ACTUALLY MEASURED, 2026-09-12, because the defect and the G5.3a
-- matrix row both described this wrongly:
--
--   * G5.3a says "revoking `ancestry` makes those rows immediately unreadable
--     through `filterOwnAnalysisFiles`". It does not.
--     `src/lib/genome/own-analysis-access.ts` returns every legacy file
--     unconditionally - `if (!modern.length || !purpose) return legacy`, and
--     the final filter re-admits `legacyIds` - so no purpose gate has ever
--     applied to a legacy file. The leak was on the ancestry PAGE as well as
--     in the export, which is the more visible of the two.
--   * `private.current_own_report_grant_v1` cannot be reused for this. Its
--     third statement raises `not_found` whenever
--     `single_logical_sample_verified_at is null`, so routing legacy files
--     through it would refuse them always. That is not a gate, it is a
--     silent removal of the feature.
--
-- WHY A SUBJECT-LEVEL FUNCTION IS THE RIGHT SHAPE, rather than a per-file one.
-- The grant this asks about is already subject-scoped: every row selected
-- below is `target_kind='subject'` with `target_id` the subject. The file
-- preconditions in `current_own_report_grant_v1` - tier, structural validator
-- version, normalization completion, build - are integrity checks on the
-- CANONICAL pipeline, and a legacy file satisfies none of them by definition.
-- Asking "does this account hold a live ancestry grant for this subject?" is
-- the question the legacy read actually needs, and it is the same question the
-- canonical path asks before it adds its own file checks on top.
--
-- HOW THIS BODY WAS PRODUCED, so it can be audited rather than trusted: the
-- grant select is the one installed in `private.current_own_report_grant_v1`,
-- copied verbatim from `pg_get_functiondef`, with exactly ONE substitution -
-- `pg.target_id=f.subject_id` becomes `pg.target_id=p_subject_id` - asserted
-- to apply exactly once, and asserted afterwards to leave no reference to the
-- file row. Every join, every revocation and expiry condition and every
-- artifact/signature check is therefore byte-identical to the canonical
-- resolver's. If that resolver is ever tightened, this one must be tightened
-- with it, and the pgTAP file beside this migration compares them.

create or replace function private.own_subject_purpose_grant_v1(
  p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_purpose text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'private'
as $fn$
declare c jsonb; g public.purpose_grants%rowtype; v_key text;
begin
 if p_purpose is null or p_purpose not in ('reports.monogenic','reports.polygenic','ancestry') then
  raise exception using errcode='42501',message='not_found'; end if;
 if p_subject_id is null then raise exception using errcode='42501',message='not_found'; end if;
 -- The same session/subject context the canonical resolver builds. It raises
 -- on a subject this account may not act for, so an unrelated subject id
 -- cannot be probed through this function.
 c:=public.own_report_context_v1(p_account_id,p_session_id,p_subject_id);
 v_key:=case p_purpose when 'reports.monogenic' then 'consent.own-monogenic'
  when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-ancestry' end;
 select pg.* into g from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
 join public.consent_artifacts ca on ca.artifact_key=pg.artifact_key and ca.version=pg.artifact_version
  and ca.body_sha256=pg.artifact_body_sha256
 join public.consent_signatures cs on cs.id=pg.signature_id and cs.artifact_key=ca.artifact_key
  and cs.artifact_version=ca.version and cs.artifact_body_sha256=ca.body_sha256
  and cs.signer_principal_id=pg.signer_principal_id and cs.signer_account_id=p_account_id
  and cs.target_kind=pg.target_kind and cs.target_id=pg.target_id and cs.purpose=pg.purpose
 where pg.target_kind='subject' and pg.target_id=p_subject_id and pg.purpose=p_purpose
  and pg.signer_principal_id=(c->>'principalId')::uuid and pg.data_subject_principal_id=pg.signer_principal_id
  and pg.subject_binding_revision=(c->>'subjectBindingRevision')::bigint
  and pg.jurisdiction_revision=(c->>'jurisdictionRevision')::bigint
  and cs.subject_binding_revision=pg.subject_binding_revision and cs.jurisdiction_revision=pg.jurisdiction_revision
  and pg.revoked_at is null and (pg.expires_at is null or pg.expires_at>clock_timestamp())
  and dg.status='current' and dg.direction='self' and dg.recipient_principal_id=pg.signer_principal_id
  and dg.recipient_account_id=p_account_id and dg.relationship_id is null and dg.pair_id is null
  and dg.relationship_or_pair_revision=(c->>'accountBindingRevision')::bigint
  and dg.self_principal_revision=(c->>'principalRevision')::bigint
  and ca.artifact_key=v_key and ca.superseded_at is null and ca.published_at<=clock_timestamp()
  and ca.effective_on<=timezone('UTC',clock_timestamp())::date
  and ca.body_sha256=encode(extensions.digest(convert_to(ca.body_markdown,'UTF8'),'sha256'),'hex')
 for share of pg,dg,ca,cs;
 if g.grant_id is null then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('context',c,'grantId',g.grant_id,'grantRevision',g.grant_revision,
  'subjectId',p_subject_id);
end;
$fn$;

revoke all on function private.own_subject_purpose_grant_v1(uuid,uuid,uuid,text) from public;

-- The boolean the reader calls. It never returns the grant itself: a page or
-- an export needs to know whether it may read, and nothing downstream has any
-- use for the grant id, so it is not handed out.
create or replace function public.own_subject_purpose_granted_v1(
  p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_purpose text)
returns boolean
language plpgsql
set search_path to 'pg_catalog'
as $fn$
begin
 perform private.own_subject_purpose_grant_v1(p_account_id,p_session_id,p_subject_id,p_purpose);
 return true;
exception when insufficient_privilege or object_not_in_prerequisite_state then return false;
end;
$fn$;

revoke all on function public.own_subject_purpose_granted_v1(uuid,uuid,uuid,text) from public;
grant execute on function public.own_subject_purpose_granted_v1(uuid,uuid,uuid,text) to service_role;
