begin;
set local search_path = public, extensions;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

create temporary table fin as select * from public.finalize_embryo_cohort_v1(
  '7a000000-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft), (select insurance from acks), (select charter from acks),
  'nonce-final-cards-controls-aaaaaaaaaaaa');
create temporary table before_controls as select
  (select coalesce(jsonb_agg(to_jsonb(r) order by id), '[]'::jsonb)
    from public.future_person_record_key_print_rights r) rights,
  (select coalesce(jsonb_agg(to_jsonb(h) order by embryo_id, recipient_principal_id, key_revision), '[]'::jsonb)
    from public.future_person_record_key_hashes h) hashes,
  (select coalesce(jsonb_agg(to_jsonb(n) order by nonce_hash), '[]'::jsonb)
    from public.embryo_operation_nonces n) nonces,
  (select coalesce(jsonb_agg(to_jsonb(s) order by id), '[]'::jsonb) from auth.sessions s) sessions,
  (select count(*) from public.legal_audit_log) audit;

select is(public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000002', '7a000000-0000-4000-8000-0000000000b1'),
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
    'cohortId', (select cohort_id from fin), 'cardCount', 3)), 'nextCursor', null),
  'the other parent sees exactly their own three unconsumed rights, with no keys');
select is(public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000a1'),
  '{"items":[],"nextCursor":null}'::jsonb,
  'the independent parent who received inline cards has no remaining control');
select is(public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000003', '7a000000-0000-4000-8000-0000000000c1'),
  '{"items":[],"nextCursor":null}'::jsonb, 'a non-parent account gains no controls');
select is(public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000002', '7a000000-0000-4000-8000-0000000000b1',
  (select cohort_id from fin)), '{"items":[],"nextCursor":null}'::jsonb,
  'the cursor is exclusive and cannot replay the same cohort');
select ok((select rights = (select coalesce(jsonb_agg(to_jsonb(r) order by id), '[]'::jsonb)
    from public.future_person_record_key_print_rights r)
  and hashes = (select coalesce(jsonb_agg(to_jsonb(h) order by embryo_id, recipient_principal_id, key_revision), '[]'::jsonb)
    from public.future_person_record_key_hashes h)
  and nonces = (select coalesce(jsonb_agg(to_jsonb(n) order by nonce_hash), '[]'::jsonb)
    from public.embryo_operation_nonces n)
  and sessions = (select coalesce(jsonb_agg(to_jsonb(s) order by id), '[]'::jsonb) from auth.sessions s)
  and audit = (select count(*) from public.legal_audit_log) from before_controls),
  'all control reads preserve complete rights, hashes, nonces, session rows and audit');
select throws_ok($$select public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b2')$$,
  '42501', 'recent_reauthentication_required', 'an old session is refused');
select throws_ok($$select public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'recent_reauthentication_required', 'a foreign session is refused');
select throws_ok($$select public.embryo_record_key_card_controls_v1(null,null)$$,
  '42501', 'recent_reauthentication_required', 'missing account/session cannot become an empty authorized read');
select ok(has_function_privilege('service_role', 'public.embryo_record_key_card_controls_v1(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.embryo_record_key_card_controls_v1(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.embryo_record_key_card_controls_v1(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('inherit_upload_only', 'public.embryo_record_key_card_controls_v1(uuid,uuid,uuid)', 'execute'),
  'only the server may supply the independently verified account/session');
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role_name
  where has_function_privilege(role_name, 'private.embryo_record_key_card_count_v1(uuid,uuid)', 'execute')),
  0::bigint, 'API roles cannot bypass the native account/session door through the shared count validator');

create function pg_temp.card_controls_probe(p_mutation text) returns text
language plpgsql as $$
declare result text;
begin
  begin
    execute p_mutation;
    result := public.embryo_record_key_card_controls_v1(
      '7a000000-0000-0000-0000-000000000002', '7a000000-0000-4000-8000-0000000000b1')::text;
    raise exception using errcode = 'P0001', message = 'rollback synthetic probe';
  exception when sqlstate 'P0001' then return result;
    when others then return sqlstate || ':' || sqlerrm;
  end;
end $$;
select is(pg_temp.card_controls_probe($p$insert into auth.mfa_factors
  (id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
  values('7a100000-0000-4000-8000-000000000021','7a000000-0000-0000-0000-000000000002',
    'Synthetic card factor','totp','verified','synthetic-card-factor',clock_timestamp(),clock_timestamp())$p$),
  '42501:mfa_required', 'a configured verified factor requires the exact session to have MFA');
select is(pg_temp.card_controls_probe($p$insert into auth.mfa_factors
  (id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
  values('7a100000-0000-4000-8000-000000000021','7a000000-0000-0000-0000-000000000002',
    'Synthetic card factor','totp','verified','synthetic-card-factor',clock_timestamp(),clock_timestamp());
  update auth.sessions set aal='aal2' where id='7a000000-0000-4000-8000-0000000000b1'$p$)::jsonb,
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
    'cohortId', (select cohort_id from fin), 'cardCount', 3)), 'nextCursor', null),
  'the same independently bound recent MFA session can read its exact controls');
select is(pg_temp.card_controls_probe($p$update auth.sessions set not_after=clock_timestamp()-interval '1 second'
  where id='7a000000-0000-4000-8000-0000000000b1'$p$),
  '42501:recent_reauthentication_required', 'an expired live Auth row is refused');
select is(pg_temp.card_controls_probe($p$update auth.users set banned_until=clock_timestamp()+interval '1 day'
  where id='7a000000-0000-0000-000000000002'$p$),
  '42501:card controls unavailable', 'an otherwise recent session cannot restore a banned account');
select is(pg_temp.card_controls_probe($p$update public.embryo_basis_bindings set basis_revision=basis_revision+1
  where cohort_id=(select cohort_id from fin)$p$)::jsonb, '{"items":[],"nextCursor":null}'::jsonb,
  'a stale basis binding reveals no control');
select is(pg_temp.card_controls_probe($p$update public.embryo_participant_sets set revoked_at=clock_timestamp()
  where cohort_id=(select cohort_id from fin) and set_kind='record_key_recipients'
    and principal_id in (select id from public.subject_principals
      where account_id='7a000000-0000-0000-0000-000000000002')$p$)::jsonb,
  '{"items":[],"nextCursor":null}'::jsonb, 'a revoked recipient cannot be inferred from account ownership');
select is(pg_temp.card_controls_probe($p$update public.subject_principals set principal_kind='identified_donor'
  where account_id='7a000000-0000-0000-0000-000000000002' and principal_kind='genetic_parent'$p$)::jsonb,
  '{"items":[],"nextCursor":null}'::jsonb, 'a donor is not a parent card recipient');

-- The settings read precedes the mutation, as it does when a previously
-- minted form is submitted after current authority changes.
create function pg_temp.card_delivery_after_read_probe(p_mutation text) returns text
language plpgsql as $$
declare before_rights jsonb; before_hashes jsonb; before_nonces jsonb; outcome text;
begin
  begin
    if jsonb_array_length(public.embryo_record_key_card_controls_v1(
      '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1')->'items')<>1 then
      raise exception 'synthetic control precondition missing';
    end if;
    execute p_mutation;
    select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') into before_rights
      from public.future_person_record_key_print_rights r;
    select coalesce(jsonb_agg(to_jsonb(h) order by embryo_id,recipient_principal_id,key_revision),'[]') into before_hashes
      from public.future_person_record_key_hashes h;
    select coalesce(jsonb_agg(to_jsonb(n) order by nonce_hash),'[]') into before_nonces
      from public.embryo_operation_nonces n;
    begin
      perform * from public.deliver_embryo_record_key_cards_v1(
        '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
        (select cohort_id from fin),'nonce-stale-control-delivery-aaaaaaaaaaaa');
      outcome := 'unexpected delivery';
    exception when sqlstate '42501' then
      outcome := '42501:' || ((before_rights=(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]')
        from public.future_person_record_key_print_rights r))
        and (before_hashes=(select coalesce(jsonb_agg(to_jsonb(h) order by embryo_id,recipient_principal_id,key_revision),'[]')
        from public.future_person_record_key_hashes h))
        and (before_nonces=(select coalesce(jsonb_agg(to_jsonb(n) order by nonce_hash),'[]')
        from public.embryo_operation_nonces n)))::text;
    end;
    raise exception using errcode='P0001',message='rollback synthetic stale form';
  exception when sqlstate 'P0001' then return outcome;
  end;
end $$;
select is(pg_temp.card_delivery_after_read_probe($p$update public.embryo_basis_bindings
  set basis_revision=basis_revision+1 where cohort_id=(select cohort_id from fin)$p$),
  '42501:true', 'delivery rechecks stale basis after the read and restores all rights/hashes/nonces on refusal');
select is(pg_temp.card_delivery_after_read_probe($p$update public.future_person_record_key_print_rights
  set key_revision=999 where recipient_principal_id in(select id from public.subject_principals
    where account_id='7a000000-0000-0000-0000-000000000002') and status='unconsumed'$p$),
  '42501:true', 'delivery rechecks stale rights after the read and restores all rights/hashes/nonces on refusal');
select is(pg_temp.card_delivery_after_read_probe($p$update public.embryo_participant_sets
  set revoked_at=clock_timestamp() where cohort_id=(select cohort_id from fin) and set_kind='record_key_recipients'
    and principal_id in(select id from public.subject_principals where account_id='7a000000-0000-0000-0000-000000000002')$p$),
  '42501:true', 'a revoked recipient cannot use a formerly current form or consume its nonce');

-- Confirming parent B receives only the replacement inline. Parent A gains
-- exactly one replacement right; B still owns two valid initial rights.
create temporary table controls_transfer_proposal as select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000a1',
  (select id from public.embryos where cohort_id=(select cohort_id from fin) and sample_ordinal=1),
  'propose', 'transferred', null, 'nonce-controls-transfer-propose-aaaaaaaaaaaa') result;
select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000002', '7a000000-0000-4000-8000-0000000000b1',
  (select id from public.embryos where cohort_id=(select cohort_id from fin) and sample_ordinal=1),
  'confirm', 'transferred', (select (result->>'proposalId')::uuid from controls_transfer_proposal),
  'nonce-controls-transfer-confirm-aaaaaaaaaaaa');
select is((public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000a1')#>>'{items,0,cardCount}')::integer,
  1, 'a one-embryo replacement subset is a real card control');
select is((public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000002', '7a000000-0000-4000-8000-0000000000b1')#>>'{items,0,cardCount}')::integer,
  2, 'the other parent retains both initial rights despite the cohort-wide revision bump');
select is(pg_temp.card_controls_probe($p$update public.future_person_record_key_print_rights set key_revision=999
  where embryo_id=(select id from public.embryos where cohort_id=(select cohort_id from fin) and sample_ordinal=0)
    and status='unconsumed'$p$)::jsonb, '{"items":[],"nextCursor":null}'::jsonb,
  'a stale/impossible right refuses the complete control rather than returning a partial delivery count');
create temporary table controls_delivered as select * from public.deliver_embryo_record_key_cards_v1(
  '7a000000-0000-0000-0000-000000000002', '7a000000-0000-4000-8000-0000000000b1',
  (select cohort_id from fin), 'nonce-controls-delivery-aaaaaaaaaaaa');
select is((select jsonb_array_length(cards) from controls_delivered), 2,
  'actual unchanged delivery consumes exactly the advertised two initial rights');
select throws_ok($$select * from public.deliver_embryo_record_key_cards_v1(
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
  (select cohort_id from fin),'nonce-controls-delivery-aaaaaaaaaaaa')$$,
  '23505', 'operation nonce already used', 'the exact consumed nonce retains the original replay refusal');
select throws_ok($$select * from public.deliver_embryo_record_key_cards_v1(
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
  (select cohort_id from fin),'nonce-controls-delivery-next-aaaaaaaaaaaa')$$,
  '42501', 'no unconsumed print right', 'a fresh nonce after complete consumption retains the original no-right refusal');
select is(public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000002', '7a000000-0000-4000-8000-0000000000b1'),
  '{"items":[],"nextCursor":null}'::jsonb, 'consumed rights disappear without being recreated');
select is((public.embryo_record_key_card_controls_v1(
  '7a000000-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000a1')#>>'{items,0,cardCount}')::integer,
  1, 'printing never consumes the independent parent''s remaining replacement right');
select * from finish();
rollback;
