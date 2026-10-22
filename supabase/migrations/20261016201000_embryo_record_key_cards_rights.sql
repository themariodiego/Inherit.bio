-- =====================================================================
-- PRODUCTION RELEASE: GUARDED. This migration is applied to local and CI
-- databases only. It must reach a hosted database through the guarded
-- production release (preflight, postflight, receipt), never as a side
-- effect of a merge. Embryo ingest is TEST-LOCAL only and
-- EMBRYO_INGEST_AVAILABLE stays false.
-- =====================================================================
--
-- api.embryo-record-key-cards-rights (register; G2.1 "Build all 24"): the
-- no-account twin of api.embryo-record-key-cards. One exact current
-- no-account member of embryo-basis-authority-v1.recordKeyRecipients
-- collects their own Record Key Cards once, through a rights session of the
-- purpose embryo-record-key-card-delivery
-- (tokenSecurityContract.futurePersonRecordKeyNoAccountDelivery), instead of
-- an account session.
--
-- CLOSED UNTIL AN ISSUER EXISTS. private.rights_session_purposes has no row
-- for embryo-record-key-card-delivery, so the purpose-matrix trigger refuses
-- every such session and private.rights_action_permitted_v1 answers false
-- for it. This migration registers no purpose and issues no credential: the
-- issuer (the non-authorizing mail candidate at finalization or transfer
-- rotation, and its activation) is an open owner question. Until then this
-- function refuses every caller with 42501 and writes nothing.
--
-- What it does once a session of that purpose exists, in one transaction:
--   1. lock the active, unexpired session of exactly that purpose and target
--      kind, and consume the session-bound one-time print nonce;
--   2. recheck the purpose matrix for this action and route;
--   3. lock the cohort and require the session to be bound to its current
--      recipient_set_revision, and its principal to be an active
--      genetic_parent with NO account and a current record_key_recipients
--      member (a donor-subject-only, uploader, custody, owner, provider or
--      reviewer principal is never a member);
--   4. recheck the whole authority exactly as the account door does
--      (private.embryo_record_key_card_count_v1's checks, keyed by that
--      principal), generate one key per covered embryo, store only each
--      hash, consume the print rights, consume the session and append the
--      audit event. The raw keys exist only in the returned rows.
--
-- No existing function, table, grant or constraint is changed.

do $predecessor$
begin
 if to_regprocedure('private.rights_action_permitted_v1(text,text,text)') is null
  or to_regprocedure('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)') is null
  or to_regprocedure('private.resolve_embryo_basis_authority_v1(uuid)') is null
  or to_regprocedure('private.embryo_cohort_set_v1(uuid,text)') is null
  or to_regprocedure('private.embryo_record_key_v1()') is null
  or to_regprocedure('private.append_legal_audit_event(text,uuid,text,text,jsonb)') is null
  or not exists(select 1 from private.rights_purpose_matrix where purpose='embryo-record-key-card-delivery'
   and action='deliver-record-key-cards' and route_id='api.embryo-record-key-cards-rights') then
  raise exception using errcode='55000',message='record key rights delivery prerequisite missing'; end if;
 if to_regprocedure('public.deliver_embryo_record_key_cards_rights_v1(text,text)') is not null
  or to_regprocedure('private.embryo_record_key_card_principal_count_v1(uuid,uuid)') is not null then
  raise exception using errcode='55000',message='record key rights delivery successor already exists'; end if;
end;
$predecessor$;

-- The account door's authority check (20261010000000), keyed by one exact
-- no-account principal instead of an account. Shared locks only.
create function private.embryo_record_key_card_principal_count_v1(p_cohort uuid, p_principal uuid)
returns integer language plpgsql security definer set search_path = '' as $card_authority$
declare
  v_cohort public.embryo_cohorts%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_binding public.embryo_basis_bindings%rowtype;
  v_authority record;
  v_count integer;
  v_right_count integer;
  v_owned_count integer;
begin
  select * into v_cohort from public.embryo_cohorts where id = p_cohort for share;
  if v_cohort.id is null or v_cohort.status not in ('upload_pending', 'ingesting', 'active')
    or v_cohort.retention_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'card authority unavailable';
  end if;
  perform 1 from public.embryo_cohort_drafts where id = v_cohort.draft_id for share;
  perform 1 from public.embryo_basis_bindings where cohort_id = v_cohort.id for share;
  perform 1 from public.draft_participant_slots where embryo_draft_id = v_cohort.draft_id
    order by id for share;
  perform 1 from public.embryo_participant_sets where cohort_id = v_cohort.id
    order by principal_id, set_kind, membership_revision for share;
  perform 1 from public.subject_principals sp where sp.id in (
    select principal_id from public.embryo_participant_sets where cohort_id = v_cohort.id
    union select principal_id from public.draft_participant_slots where embryo_draft_id = v_cohort.draft_id
  ) order by sp.id for share;
  select * into v_draft from public.embryo_cohort_drafts where id = v_cohort.draft_id;
  select * into v_binding from public.embryo_basis_bindings where cohort_id = v_cohort.id;
  if v_draft.state is distinct from 'finalized' or v_binding.cohort_id is null
    or (v_draft.basis_case, v_draft.basis_revision, v_binding.basis_case,
        v_binding.basis_revision, v_binding.participant_set_revision)
      is distinct from (v_cohort.basis_case, v_cohort.basis_revision, v_cohort.basis_case,
        v_cohort.basis_revision, v_cohort.participant_set_revision)
    or exists (select 1 from public.attestation_contradictions
      where cohort_id = v_cohort.id and resolved_at is null)
  then raise exception using errcode = '42501', message = 'card authority unavailable'; end if;
  begin
    select * into v_authority from private.resolve_embryo_basis_authority_v1(v_cohort.draft_id);
  exception when sqlstate '42501' or sqlstate '55000' then
    raise exception using errcode = '42501', message = 'card authority unavailable';
  end;
  if (select array_agg(x order by x) from unnest(v_authority.record_key_recipients) x)
    is distinct from (select array_agg(x order by x)
      from unnest(private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients')) x)
  then raise exception using errcode = '42501', message = 'card authority unavailable'; end if;
  if v_cohort.basis_case in ('parent_deceased', 'sole_legal_authority') then
    perform 1 from public.legal_reviews lr join public.reviewed_evidence re on re.review_id = lr.id
    where lr.id = v_binding.legal_review_id and re.id = v_binding.reviewed_evidence_id
      and lr.decision = 'approved' and lr.target_kind = 'single_parent_basis'
      and lr.target_id = v_draft.id and re.purged_at is null
      and re.evidence_kind = case v_cohort.basis_case when 'parent_deceased'
        then 'parent-death-certificate' else 'sole-disposition-authority' end
      and not exists (select 1 from public.legal_reviews newer
        where newer.target_kind = lr.target_kind and newer.target_id = lr.target_id
          and newer.review_revision > lr.review_revision)
    for share of lr, re;
    if not found then raise exception using errcode = '42501', message = 'card authority unavailable'; end if;
  end if;
  -- The one difference from the account door: the recipient is the exact
  -- session principal, a current member with no account.
  perform 1 from public.subject_principals sp
  where sp.id = p_principal
    and sp.id = any(private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients'))
    and sp.account_id is null and sp.status = 'active' and sp.principal_kind = 'genetic_parent';
  if not found then raise exception using errcode = '42501', message = 'card authority unavailable'; end if;
  perform 1 from public.embryos where cohort_id = v_cohort.id order by id for share;
  perform 1 from public.future_person_record_key_print_rights pr
    join public.embryos e on e.id = pr.embryo_id
    where e.cohort_id = v_cohort.id order by pr.id for share of pr;
  select count(*) into v_owned_count from public.future_person_record_key_print_rights pr
  join public.embryos e on e.id = pr.embryo_id
  where e.cohort_id = v_cohort.id and pr.recipient_principal_id = p_principal
    and pr.status = 'unconsumed';
  select count(*), count(distinct pr.embryo_id) into v_right_count, v_count
  from public.future_person_record_key_print_rights pr
  join public.embryos e on e.id = pr.embryo_id
  where e.cohort_id = v_cohort.id and pr.recipient_principal_id = p_principal
    and pr.status = 'unconsumed' and e.retention_expires_at > clock_timestamp()
    and e.status not in ('donated', 'discarded', 'claimed_bound')
    and pr.key_revision <= v_cohort.key_revision
    and pr.recipient_set_revision <= v_cohort.recipient_set_revision
    and not exists (select 1 from public.future_person_record_key_print_rights newer
      where newer.embryo_id = pr.embryo_id
        and (newer.key_revision > pr.key_revision
          or newer.recipient_set_revision > pr.recipient_set_revision));
  if v_count not between 0 and 64 or v_right_count <> v_count
    or v_owned_count <> v_right_count then raise exception using errcode = '42501', message = 'card authority unavailable'; end if;
  return v_count;
end $card_authority$;
revoke all on function private.embryo_record_key_card_principal_count_v1(uuid, uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;

create function public.deliver_embryo_record_key_cards_rights_v1(p_session_hash text, p_nonce text)
returns table (cohort_id uuid, recipient_set_revision bigint, key_revision bigint, cards jsonb)
language plpgsql security definer set search_path = '' set lock_timeout = '250ms' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.rights_sessions%rowtype;
  v_cohort public.embryo_cohorts%rowtype;
  v_right record;
  v_record_key text;
  v_cards jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_expected_count integer;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'card delivery unavailable';
  end if;
  select rs.* into v_session from public.rights_sessions rs
  where rs.session_hash = p_session_hash and rs.purpose = 'embryo-record-key-card-delivery'
    and rs.target_kind = 'cohort-record-key-recipient-set'
    and rs.status = 'active' and rs.expires_at > v_now
  for update;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'card delivery unavailable';
  end if;
  perform private.consume_embryo_operation_nonce_v1(p_nonce, null, null, 'record_key_print',
    'rights_session', v_session.id);
  if not private.rights_action_permitted_v1(v_session.purpose, 'deliver-record-key-cards',
    'api.embryo-record-key-cards-rights') then
    raise exception using errcode = '42501', message = 'card delivery unavailable';
  end if;

  select c.* into v_cohort from public.embryo_cohorts c where c.id = v_session.target_id for update;
  if v_cohort.id is null or v_cohort.status not in ('upload_pending', 'ingesting', 'active')
    or v_cohort.recipient_set_revision <> v_session.authority_revision then
    raise exception using errcode = '42501', message = 'card delivery unavailable';
  end if;

  v_expected_count := private.embryo_record_key_card_principal_count_v1(v_cohort.id, v_session.principal_id);
  if v_expected_count = 0 then
    raise exception using errcode = '42501', message = 'no unconsumed print right';
  end if;

  for v_right in
    select pr.id, pr.embryo_id, pr.key_revision, pr.recipient_set_revision, pr.delivery_kind,
           e.sample_ordinal, e.display_label, e.closing_date, e.closing_date_state, e.date_revision
    from public.future_person_record_key_print_rights pr
    join public.embryos e on e.id = pr.embryo_id
    where e.cohort_id = v_cohort.id
      and pr.recipient_principal_id = v_session.principal_id
      and pr.status = 'unconsumed'
    order by e.sample_ordinal
    for update of pr
  loop
    v_record_key := private.embryo_record_key_v1();
    update public.future_person_record_key_hashes
    set status = 'revoked', ended_at = v_now
    where embryo_id = v_right.embryo_id
      and recipient_principal_id = v_session.principal_id
      and status = 'current';
    insert into public.future_person_record_key_hashes (
      embryo_id, recipient_principal_id, recipient_set_revision, key_revision, key_hash, status
    ) values (
      v_right.embryo_id, v_session.principal_id, v_right.recipient_set_revision, v_right.key_revision,
      encode(extensions.digest(convert_to(v_record_key, 'UTF8'), 'sha256'), 'hex'), 'current'
    );
    update public.future_person_record_key_print_rights
    set status = 'consumed', consumed_at = v_now
    where id = v_right.id;
    v_cards := v_cards || jsonb_build_object(
      'embryo_id', v_right.embryo_id,
      'display_label', v_right.display_label,
      'record_key', v_record_key,
      'closing_date_iso', to_char(v_right.closing_date, 'YYYY-MM-DD'),
      'closing_date_state', v_right.closing_date_state,
      'date_revision', v_right.date_revision,
      'delivery_kind', v_right.delivery_kind
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 or v_count <> v_expected_count then
    raise exception using errcode = '42501', message = 'no unconsumed print right';
  end if;

  -- One delivery per session: its only action is spent.
  update public.rights_sessions set status = 'consumed', ended_at = v_now where id = v_session.id;
  perform private.append_legal_audit_event(
    'embryo.record-key.delivered', null, 'api.embryo-record-key-cards-rights',
    'accepted', jsonb_build_object('count', v_count)
  );

  return query select v_cohort.id, v_cohort.recipient_set_revision, v_cohort.key_revision, v_cards;
end;
$$;
revoke all on function public.deliver_embryo_record_key_cards_rights_v1(text, text)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.deliver_embryo_record_key_cards_rights_v1(text, text) to service_role;

notify pgrst, 'reload schema';
