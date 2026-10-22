-- One current read/write authority check. This API-denied helper takes only
-- shared locks; it neither generates keys nor consumes a print right/nonce.
create function private.embryo_record_key_card_count_v1(p_cohort uuid, p_account uuid)
returns integer language plpgsql security definer set search_path = '' as $card_authority$
declare
  v_cohort public.embryo_cohorts%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_binding public.embryo_basis_bindings%rowtype;
  v_authority record;
  v_principals uuid[];
  v_actor uuid;
  v_count integer;
  v_right_count integer;
  v_owned_count integer;
begin
  select * into v_cohort from public.embryo_cohorts where id = p_cohort for share;
  if v_cohort.id is null or v_cohort.status not in ('upload_pending', 'ingesting', 'active')
    or v_cohort.retention_expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'card authority unavailable';
  end if;
  perform 1 from auth.users u join public.profiles profile on profile.id = u.id
  where u.id = p_account and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
    and profile.deletion_requested_at is null for share of u, profile;
  if not found then raise exception using errcode = '42501', message = 'card authority unavailable'; end if;
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
    select array_agg(sp.id order by sp.id) into v_principals
    from public.subject_principals sp
    where sp.id = any(private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients'))
      and sp.account_id = p_account and sp.status = 'active' and sp.principal_kind = 'genetic_parent';
    if cardinality(v_principals) is distinct from 1 then raise exception using errcode = '42501', message = 'card authority unavailable'; end if;
    v_actor := v_principals[1];
    perform 1 from public.embryos where cohort_id = v_cohort.id order by id for share;
    perform 1 from public.future_person_record_key_print_rights pr
      join public.embryos e on e.id = pr.embryo_id
      where e.cohort_id = v_cohort.id order by pr.id for share of pr;
    -- A transfer advances the cohort revision but replaces only that embryo's
    -- rights. Older initial rights for other embryos remain valid.
    select count(*) into v_owned_count from public.future_person_record_key_print_rights pr
    join public.embryos e on e.id = pr.embryo_id
    where e.cohort_id = v_cohort.id and pr.recipient_principal_id = v_actor
      and pr.status = 'unconsumed';
    select count(*), count(distinct pr.embryo_id) into v_right_count, v_count
    from public.future_person_record_key_print_rights pr
    join public.embryos e on e.id = pr.embryo_id
    where e.cohort_id = v_cohort.id and pr.recipient_principal_id = v_actor
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
revoke all on function private.embryo_record_key_card_count_v1(uuid, uuid)
  from public, anon, authenticated, inherit_upload_only, service_role;

-- Settings reads reveal only the acting parent's remaining card count. The
-- existing delivery RPC remains the sole nonce-consuming key writer.
create function public.embryo_record_key_card_controls_v1(
  p_account uuid, p_session uuid, p_after uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $controls$
declare
  v_cohort public.embryo_cohorts%rowtype;
  v_count integer;
  v_items jsonb := '[]'::jsonb;
  v_cursor uuid;
begin
  perform private.future_person_profile_read_locks_v1(p_account, p_session);
  perform private.validate_sensitive_account_session_read_v1(p_account, p_session);
  if p_account is null or p_session is null or not exists (
    select 1 from auth.users u join public.profiles profile on profile.id = u.id
    where u.id = p_account and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
      and profile.deletion_requested_at is null
  ) then
    raise exception using errcode = '42501', message = 'card controls unavailable';
  end if;

  for v_cohort in
    select c.* from public.embryo_cohorts c
    where c.status in ('upload_pending', 'ingesting', 'active')
      and c.retention_expires_at > clock_timestamp()
      and (p_after is null or c.id > p_after)
      and exists (
        select 1 from public.embryos e
        join public.future_person_record_key_print_rights pr on pr.embryo_id = e.id
        join public.subject_principals sp on sp.id = pr.recipient_principal_id
        where e.cohort_id = c.id and pr.status = 'unconsumed'
          and sp.account_id = p_account and sp.status = 'active'
          and sp.principal_kind = 'genetic_parent'
      )
    order by c.id for share of c
  loop
    begin
      v_count := private.embryo_record_key_card_count_v1(v_cohort.id, p_account);
    exception when sqlstate '42501' then continue;
    end;
    if v_count = 0 then continue; end if;
    if jsonb_array_length(v_items) = 64 then
      return jsonb_build_object('items', v_items, 'nextCursor', v_cursor);
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'cohortId', v_cohort.id, 'cardCount', v_count));
    v_cursor := v_cohort.id;
  end loop;
  return jsonb_build_object('items', v_items, 'nextCursor', null);
end
$controls$;

revoke all on function public.embryo_record_key_card_controls_v1(uuid, uuid, uuid)
  from public, anon, authenticated, inherit_upload_only;
grant execute on function public.embryo_record_key_card_controls_v1(uuid, uuid, uuid) to service_role;
create or replace function public.deliver_embryo_record_key_cards_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_cohort_id uuid,
  p_token_nonce text
)
returns table (
  cohort_id uuid,
  recipient_set_revision bigint,
  key_revision bigint,
  cards jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cohort public.embryo_cohorts%rowtype;
  v_recipient uuid;
  v_right record;
  v_record_key text;
  v_cards jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_expected_count integer;
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);

  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = p_cohort_id
  for update;
  if v_cohort.id is null
    or v_cohort.status not in ('upload_pending', 'ingesting', 'active')
  then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'record_key_print',
    'cohort', v_cohort.id
  );

  -- A form minted by an earlier settings read is not authority to write.
  -- Revalidate and lock the complete current set in this transaction.
  v_expected_count := private.embryo_record_key_card_count_v1(v_cohort.id, p_account_id);
  if v_expected_count = 0 then
    raise exception using errcode = '42501', message = 'no unconsumed print right';
  end if;

  v_recipient := private.acting_embryo_principal_v1(
    p_account_id, private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients')
  );
  if v_recipient is null then
    raise exception using errcode = '42501', message = 'not a card recipient';
  end if;

  for v_right in
    select pr.id, pr.embryo_id, pr.key_revision, pr.recipient_set_revision,
           pr.delivery_kind,
           e.sample_ordinal, e.display_label, e.closing_date,
           e.closing_date_state, e.date_revision
    from public.future_person_record_key_print_rights pr
    join public.embryos e on e.id = pr.embryo_id
    where e.cohort_id = v_cohort.id
      and pr.recipient_principal_id = v_recipient
      and pr.status = 'unconsumed'
    order by e.sample_ordinal
    for update of pr
  loop
    v_record_key := private.embryo_record_key_v1();
    update public.future_person_record_key_hashes
    set status = 'revoked', ended_at = v_now
    where embryo_id = v_right.embryo_id
      and recipient_principal_id = v_recipient
      and status = 'current';
    insert into public.future_person_record_key_hashes (
      embryo_id, recipient_principal_id, recipient_set_revision,
      key_revision, key_hash, status
    ) values (
      v_right.embryo_id, v_recipient, v_right.recipient_set_revision,
      v_right.key_revision,
      encode(extensions.digest(convert_to(v_record_key, 'UTF8'), 'sha256'), 'hex'),
      'current'
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

  perform private.append_legal_audit_event(
    'embryo.record-key.delivered', null, 'api.embryo-record-key-cards',
    'accepted', jsonb_build_object('count', v_count)
  );

  return query select
    v_cohort.id, v_cohort.recipient_set_revision, v_cohort.key_revision, v_cards;
end;
$$;

revoke all on function public.deliver_embryo_record_key_cards_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.deliver_embryo_record_key_cards_v1(uuid, uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
