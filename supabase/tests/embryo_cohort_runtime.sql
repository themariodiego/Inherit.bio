begin;
select plan(141);
\ir fixtures/embryo_cohort_pre_finalize.inc

create temporary table fin as
select * from public.finalize_embryo_cohort_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),
  (select insurance from acks), (select charter from acks),
  'nonce-final-0002-aaaaaaaaaaaa'
);

select is((select count(*) from fin), 1::bigint, 'the complete draft finalizes');
select is((select caller_state from fin), 'delivered_inline',
  'the acting parent is a Record Key recipient and receives cards inline');
select is((select embryo_count from fin), 3, 'the cohort carries the declared count');
select is((select jsonb_array_length(cards) from fin), 3, 'one card per embryo');
select ok(
  (select bool_and(c ->> 'record_key' ~ '^[0-9A-HJKMNP-TV-Z]{20}$')
   from fin, jsonb_array_elements(fin.cards) c)
  and (select count(distinct c ->> 'record_key')
       from fin, jsonb_array_elements(fin.cards) c) = 3,
  'every Record Key is 20 Crockford base32 characters and distinct');
select is(
  (select array_agg(e.display_label order by e.sample_ordinal)
   from public.embryos e where e.cohort_id = (select cohort_id from fin)),
  array['Embryo 1', 'Embryo 2', 'Embryo 3'],
  'embryo labels are neutral ordinals');
select is(
  (select count(*) from public.embryo_participant_sets
   where cohort_id = (select cohort_id from fin)),
  8::bigint, 'both parents sit in the four persisted authority sets');
select is(
  (select count(*) from public.future_person_record_key_print_rights pr
   join public.embryos e on e.id = pr.embryo_id
   where e.cohort_id = (select cohort_id from fin) and pr.status = 'unconsumed'),
  3::bigint, 'the other parent holds three unconsumed print rights');
select is(
  (select count(*) from public.future_person_record_key_hashes h
   join public.embryos e on e.id = h.embryo_id
   where e.cohort_id = (select cohort_id from fin) and h.status = 'current'),
  3::bigint, 'only the delivered keys have hashes');
select is(
  (select state from public.embryo_cohort_drafts where id = (select draft_id from draft)),
  'finalized', 'the draft is consumed');
select is(
  (select status from public.retention_due_phases
   where retention_id = 'embryo.cohort-draft-30d'
     and target_id = (select draft_id from draft)),
  'cancelled', 'finalization cancels the draft-expiry phase');
select is(
  (select count(*) from public.subjects
   where cohort_id = (select cohort_id from fin) and lifecycle = 'quarantined'),
  3::bigint, 'embryo subjects start quarantined');
select throws_ok(
  $$select * from public.finalize_embryo_cohort_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select draft_id from draft), (select insurance from acks),
      (select charter from acks), 'nonce-final-0003-aaaaaaaaaaaa')$$,
  '42501', 'draft unavailable',
  'a consumed draft cannot finalize twice');

-- ---------------------------------------------------------------------------
-- Disposition, then Record Key Card delivery after a transfer
-- ---------------------------------------------------------------------------
create temporary table emb as
select e.id, e.subject_id, e.sample_ordinal
from public.embryos e where e.cohort_id = (select cohort_id from fin);

create temporary table prop1 as
select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  (select id from emb where sample_ordinal = 0), 'propose', 'stored', null,
  'nonce-disp-0001-aaaaaaaaaaaa'
) as result;

select is((select result ->> 'status' from prop1), 'awaiting_other_parent',
  'a two-parent cohort proposes first');
select throws_ok(
  $$select public.record_embryo_disposition_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b1',
      (select id from emb where sample_ordinal = 0), 'propose', 'donated', null,
      'nonce-disp-0010-aaaaaaaaaaaa')$$,
  '55000', 'proposal pending',
  'a live proposal blocks a second proposal for the same embryo');
select throws_ok(
  $$select public.record_embryo_disposition_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select id from emb where sample_ordinal = 0), 'confirm', 'stored',
      (select (result ->> 'proposalId')::uuid from prop1),
      'nonce-disp-0002-aaaaaaaaaaaa')$$,
  '42501', 'proposal unavailable',
  'the proposer cannot confirm their own proposal');
select is(
  (public.record_embryo_disposition_v1(
    '7a000000-0000-0000-0000-000000000002',
    '7a000000-0000-4000-8000-0000000000b1',
    (select id from emb where sample_ordinal = 0), 'confirm', 'stored',
    (select (result ->> 'proposalId')::uuid from prop1),
    'nonce-disp-0003-aaaaaaaaaaaa')) ->> 'disposition',
  'stored', 'the other parent confirms and the disposition commits');
select is(
  (select status from public.embryos where id = (select id from emb where sample_ordinal = 0)),
  'stored', 'the embryo is stored');
select is(
  (select state from public.retention_rows
   where retention_id = 'embryo.disposition-proposal-7d'
     and target_id = (select subject_id from emb where sample_ordinal = 0)
     and retention_revision = 1),
  'cancelled', 'a confirmed proposal cancels its own retention row');
select throws_ok(
  $$select public.record_embryo_disposition_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select id from emb where sample_ordinal = 1), 'commit-single-authority',
      'stored', null, 'nonce-disp-0004-aaaaaaaaaaaa')$$,
  '22023', 'action does not match the disposition mode',
  'a two-parent cohort refuses a single-authority commit');
select throws_ok(
  $$select public.record_embryo_disposition_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select id from emb where sample_ordinal = 0), 'propose', 'stored', null,
      'nonce-disp-0005-aaaaaaaaaaaa')$$,
  '55000', 'disposition final',
  'stored cannot be proposed again for a stored embryo');

create temporary table prop2 as
select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000002',
  '7a000000-0000-4000-8000-0000000000b1',
  (select id from emb where sample_ordinal = 1), 'propose', 'transferred', null,
  'nonce-disp-0006-aaaaaaaaaaaa'
) as result;
create temporary table transfer as
select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  (select id from emb where sample_ordinal = 1), 'confirm', 'transferred',
  (select (result ->> 'proposalId')::uuid from prop2),
  'nonce-disp-0007-aaaaaaaaaaaa'
) as result;

select is((select result ->> 'callerState' from transfer), 'delivered_inline',
  'the confirming recipient receives the replacement card inline');
select matches((select result -> 'card' ->> 'record_key' from transfer),
  '^[0-9A-HJKMNP-TV-Z]{20}$', 'the replacement key has the Record Key format');
select is(
  (select closing_date_state from public.embryos
   where id = (select id from emb where sample_ordinal = 1)),
  'definitive_transferred_claim_window',
  'a transfer fixes the closing date');
select is(
  (select count(*) from public.retention_rows
   where retention_id = 'embryo.transferred-claim-window'
     and target_id = (select subject_id from emb where sample_ordinal = 1)),
  1::bigint, 'a transfer opens the claim window retention row');
select is(
  (select count(*) from public.retention_due_phases
   where retention_id = 'embryo.transferred-claim-window'
     and target_id = (select subject_id from emb where sample_ordinal = 1)
     and phase_id = 'transferred-final-deletion-notice'
     and phase_deadline <= (select retention_expires_at from public.embryos
                            where id = (select id from emb where sample_ordinal = 1))
                           - interval '31 days'),
  1::bigint, 'the final deletion notice is due at least 31 days before the purge');
select is(
  (select count(*) from public.future_person_record_key_print_rights pr
   where pr.embryo_id = (select id from emb where sample_ordinal = 1)
     and pr.delivery_kind = 'transfer_replacement'),
  2::bigint, 'each recipient receives one replacement print right');

-- The other parent prints after the transfer: two initial cards and one
-- replacement card, nothing lost to the cohort-wide revision bump.
create temporary table del as
select * from public.deliver_embryo_record_key_cards_v1(
  '7a000000-0000-0000-0000-000000000002',
  '7a000000-0000-4000-8000-0000000000b1',
  (select cohort_id from fin), 'nonce-print-0001-aaaaaaaaaaaa'
);

select is((select jsonb_array_length(cards) from del), 3,
  'the other parent receives their own three cards once');
select is(
  (select array_agg(c ->> 'delivery_kind' order by c ->> 'display_label')
   from del, jsonb_array_elements(del.cards) c),
  array['initial', 'transfer_replacement', 'initial'],
  'a transfer replaces only the transferred embryo''s card');
select throws_ok(
  $$select * from public.deliver_embryo_record_key_cards_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b1',
      (select cohort_id from fin), 'nonce-print-0002-aaaaaaaaaaaa')$$,
  '42501', 'no unconsumed print right',
  'a second delivery finds no print right');
select throws_ok(
  $$select * from public.deliver_embryo_record_key_cards_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select cohort_id from fin), 'nonce-print-0003-aaaaaaaaaaaa')$$,
  '42501', 'no unconsumed print right',
  'the parent who received cards at finalization has no right left');
select throws_ok(
  $$select * from public.deliver_embryo_record_key_cards_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b2',
      (select cohort_id from fin), 'nonce-print-0004-aaaaaaaaaaaa')$$,
  '42501', 'recent_reauthentication_required',
  'a session older than fifteen minutes cannot print cards');

create temporary table prop3 as
select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  (select id from emb where sample_ordinal = 2), 'propose', 'donated', null,
  'nonce-disp-0008-aaaaaaaaaaaa'
) as result;
select lives_ok(
  $$select public.record_embryo_disposition_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b1',
      (select id from emb where sample_ordinal = 2), 'confirm', 'donated',
      (select (result ->> 'proposalId')::uuid from prop3),
      'nonce-disp-0009-aaaaaaaaaaaa')$$,
  'the other parent confirms a donation');
select is(
  (select count(*) from public.retention_rows
   where retention_id = 'embryo.donated-or-discarded-90d'
     and target_id = (select subject_id from emb where sample_ordinal = 2)),
  1::bigint, 'a donation starts the 90-day retention row');
select is(
  (select count(*) from public.future_person_record_key_hashes
   where embryo_id = (select id from emb where sample_ordinal = 2) and status = 'current'),
  0::bigint, 'a donation revokes every Record Key for that embryo');

-- A lapsed proposal is closed by the retention executor and a new one can
-- follow; the embryo is never locked.
create temporary table prop4 as
select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  (select id from emb where sample_ordinal = 0), 'propose', 'discarded', null,
  'nonce-disp-0011-aaaaaaaaaaaa'
) as result;
update public.embryo_disposition_proposals
set expires_at = created_at + interval '1 millisecond'
where id = (select (result ->> 'proposalId')::uuid from prop4);
update public.retention_due_phases
set phase_deadline = clock_timestamp() - interval '1 second'
where retention_id = 'embryo.disposition-proposal-7d'
  and immutable_envelope ->> 'proposalId' = (select result ->> 'proposalId' from prop4);
select is(
  (select count(*) from public.run_due_embryo_retention_phases_v1()),
  0::bigint, 'the executor closes a lapsed proposal without expiring any draft');
select is(
  (select status from public.embryo_disposition_proposals
   where id = (select (result ->> 'proposalId')::uuid from prop4)),
  'expired', 'the lapsed proposal is expired');
select is(
  (select status from public.embryos where id = (select id from emb where sample_ordinal = 0)),
  'stored', 'a lapsed proposal changes no disposition');
create temporary table prop5 as
select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000002',
  '7a000000-0000-4000-8000-0000000000b1',
  (select id from emb where sample_ordinal = 0), 'propose', 'discarded', null,
  'nonce-disp-0012-aaaaaaaaaaaa'
) as result;
select is((select result ->> 'status' from prop5), 'awaiting_other_parent',
  'a new proposal follows a lapsed one');
select is(
  (select count(*) from public.retention_rows
   where retention_id = 'embryo.disposition-proposal-7d'
     and target_id = (select subject_id from emb where sample_ordinal = 0)),
  3::bigint, 'each proposal has its own retention row');
select is(
  (public.record_embryo_disposition_v1(
    '7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',
    (select id from emb where sample_ordinal = 0), 'confirm', 'discarded',
    (select (result ->> 'proposalId')::uuid from prop5),
    'nonce-disp-0013-aaaaaaaaaaaa')) ->> 'disposition',
  'discarded', 'a stored embryo can still be discarded');
select is(
  (select count(*) from public.mail_outbox
   where template_id = 'embryo-disposition-notice'),
  8::bigint, 'every commit notifies both notice recipients');

-- ---------------------------------------------------------------------------
-- The cohort embryo.analysis grant
-- ---------------------------------------------------------------------------
create temporary table grant_a as
select public.grant_cohort_purpose_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  (select cohort_id from fin), 'consent.upload-embryo', 1,
  private.embryo_statement_keys_v1('consent.upload-embryo', 'grant'),
  decode('deadbeef', 'hex'), 'GB', 'nonce-grant-0001-aaaaaaaaaaaa'
) as id;
select lives_ok(
  $$select public.grant_cohort_purpose_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b1',
      (select cohort_id from fin), 'consent.upload-embryo', 1,
      private.embryo_statement_keys_v1('consent.upload-embryo', 'grant'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-grant-0002-aaaaaaaaaaaa')$$,
  'the other parent grants the same purpose in their own account');
select is(
  (select count(*) from public.purpose_grants
   where target_kind = 'cohort' and target_id = (select cohort_id from fin)
     and purpose = 'embryo.analysis' and revoked_at is null),
  2::bigint, 'each parent holds one live embryo.analysis grant');
select is(
  (select count(*) from public.directional_grants dg
   join public.purpose_grants pg on pg.grant_id = dg.grant_id
   where pg.target_id = (select cohort_id from fin) and dg.status = 'current'),
  2::bigint, 'each grant carries its direction row');
select is(
  public.grant_cohort_purpose_v1(
    '7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',
    (select cohort_id from fin), 'consent.upload-embryo', 1,
    private.embryo_statement_keys_v1('consent.upload-embryo', 'grant'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-grant-0003-aaaaaaaaaaaa'),
  (select id from grant_a),
  'granting again returns the live grant');
select throws_ok(
  $$select public.grant_cohort_purpose_v1(
      '7a000000-0000-0000-0000-000000000003',
      '7a000000-0000-4000-8000-0000000000c1',
      (select cohort_id from fin), 'consent.upload-embryo', 1,
      private.embryo_statement_keys_v1('consent.upload-embryo', 'grant'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-grant-0004-aaaaaaaaaaaa')$$,
  '42501', 'not a required principal',
  'a stranger cannot grant analysis over someone else''s cohort');

-- ---------------------------------------------------------------------------
-- Restriction
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.restrict_embryo_cohort_v1(
      '7a000000-0000-0000-0000-000000000003',
      '7a000000-0000-4000-8000-0000000000c1',
      (select cohort_id from fin), 'nonce-restrict-0001-aaaaaaaaa')$$,
  '42501', 'not a disposition authority',
  'a stranger cannot restrict a cohort');
select lives_ok(
  $$select public.restrict_embryo_cohort_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select cohort_id from fin), 'nonce-restrict-0002-aaaaaaaaa')$$,
  'one disposition authority restricts the cohort');
select is(
  (select status from public.embryo_cohorts where id = (select cohort_id from fin)),
  'restricted', 'the cohort is restricted');
select is(
  (select count(*) from public.purpose_grants
   where target_id = (select cohort_id from fin) and revoked_at is not null),
  2::bigint, 'restriction revokes every cohort grant');
select is(
  (select count(*) from public.directional_grants dg
   join public.purpose_grants pg on pg.grant_id = dg.grant_id
   where pg.target_id = (select cohort_id from fin) and dg.status = 'current'),
  0::bigint, 'restriction revokes every direction row');
select is(
  (select count(*) from public.mail_outbox where template_id = 'cohort-restriction-notice'),
  2::bigint, 'both notice recipients are told');
select is(
  (select count(*) from public.future_person_record_key_hashes h
   join public.embryos e on e.id = h.embryo_id
   where e.cohort_id = (select cohort_id from fin) and h.status = 'current'),
  0::bigint, 'restriction revokes every Record Key');
select throws_ok(
  $$select public.restrict_embryo_cohort_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select cohort_id from fin), 'nonce-restrict-0003-aaaaaaaaa')$$,
  '55000', 'already restricted',
  'a restricted cohort cannot be restricted again');
create temporary table nonces_before as
select count(*) as n from public.embryo_operation_nonces;
select throws_ok(
  $$select public.record_embryo_disposition_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b1',
      (select id from emb where sample_ordinal = 1), 'propose', 'stored', null,
      'nonce-disp-0014-aaaaaaaaaaaa')$$,
  '42501', 'cohort unavailable',
  'no disposition on a restricted cohort');
select throws_ok(
  $$select * from public.deliver_embryo_record_key_cards_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b1',
      (select cohort_id from fin), 'nonce-print-0005-aaaaaaaaaaaa')$$,
  '42501', 'cohort unavailable',
  'no card delivery on a restricted cohort');
select throws_ok(
  $$select public.grant_cohort_purpose_v1(
      '7a000000-0000-0000-0000-000000000002',
      '7a000000-0000-4000-8000-0000000000b1',
      (select cohort_id from fin), 'consent.upload-embryo', 1,
      private.embryo_statement_keys_v1('consent.upload-embryo', 'grant'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-grant-0005-aaaaaaaaaaaa')$$,
  '42501', 'cohort unavailable',
  'no grant on a restricted cohort');
select is(
  (select count(*) from public.embryo_operation_nonces),
  (select n from nonces_before),
  'a refused operation on a restricted cohort records no nonce');

-- ---------------------------------------------------------------------------
-- A third-party upload draft: the uploader is never a parent
-- ---------------------------------------------------------------------------
create temporary table draft3 as
select * from public.create_embryo_cohort_draft_v1(
  '7a000000-0000-0000-0000-000000000003',
  '7a000000-0000-4000-8000-0000000000c1',
  'with_genetic_parents_permission', 'true_two_parent', 2,
  decode('00112233445566778899aabbccddeeff', 'hex'), repeat('c', 64),
  array['ffeeddccbbaa99887766554433221100', '00ff00ff00ff00ff00ff00ff00ff00ff'],
  array[repeat('d', 64), repeat('e', 64)],
  'nonce-draft-0004-aaaaaaaaaaaa', true
);
select is((select required_principal_slots from draft3),
  array['genetic-parent', 'genetic-parent'],
  'a third-party two-parent draft names two genetic parent slots');
select is(
  (select array_agg(s.state order by s.slot_kind)
   from public.draft_participant_slots s
   where s.embryo_draft_id = (select draft_id from draft3)),
  array['pending', 'pending'],
  'neither parent slot is the uploader');
select throws_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000003',
      '7a000000-0000-4000-8000-0000000000c1',
      'cohort_draft', (select draft_id from draft3),
      'consent.upload-embryo', 1,
      private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0020-aaaaaaaaaaaa')$$,
  '22023', 'statement keys differ from the published set',
  'a non-parent uploader cannot sign the parent form');
create temporary table sig_uploader as
select public.sign_embryo_artifact_v1(
  '7a000000-0000-0000-0000-000000000003',
  '7a000000-0000-4000-8000-0000000000c1',
  'cohort_draft', (select draft_id from draft3),
  'consent.upload-embryo', 1,
  private.embryo_statement_keys_v1('consent.upload-embryo', 'uploader'),
  decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0021-aaaaaaaaaaaa'
) as id;
select is(
  (select cs.purpose from public.consent_signatures cs
   where cs.id = (select id from sig_uploader)),
  'embryo-upload-uploader-class',
  'the uploader signs the right-to-files class artifact only');
select throws_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000003',
      '7a000000-0000-4000-8000-0000000000c1',
      'cohort_draft', (select draft_id from draft3),
      'attestation.embryo-parentage', 1,
      private.embryo_statement_keys_v1('attestation.embryo-parentage'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0022-aaaaaaaaaaaa')$$,
  '42501', 'not a current parent',
  'a non-parent uploader cannot attest parentage');

-- ---------------------------------------------------------------------------
-- A single-authority basis: anonymous donor, direct disposition
-- ---------------------------------------------------------------------------
create temporary table draft4 as
select * from public.create_embryo_cohort_draft_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  'own_embryos', 'anonymous_donor', 2,
  decode('00112233445566778899aabbccddeeff', 'hex'), repeat('a', 64),
  '{}'::text[], '{}'::text[],
  'nonce-draft-0005-aaaaaaaaaaaa', true
);
select is((select required_principal_slots from draft4), '{}'::text[],
  'an anonymous-donor draft names no other parent slot');
create temporary table sigs4 as
select
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft4),
    'consent.upload-embryo', 1, private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0030-aaaaaaaaaaaa') as upload,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft4),
    'attestation.embryo-parentage', 1, private.embryo_statement_keys_v1('attestation.embryo-parentage'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0031-aaaaaaaaaaaa') as parentage,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft4),
    'attestation.embryo-disposition-rights', 1, private.embryo_statement_keys_v1('attestation.embryo-disposition-rights'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0032-aaaaaaaaaaaa') as rights,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft4),
    'attestation.embryo-single-parent-basis', 1, private.embryo_statement_keys_v1('attestation.embryo-single-parent-basis'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0033-aaaaaaaaaaaa') as single_basis,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft4),
    'disclosure.insurance-and-discrimination', 1, private.embryo_statement_keys_v1('disclosure.insurance-and-discrimination'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0034-aaaaaaaaaaaa') as insurance,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft4),
    'charter.future-person', 1, private.embryo_statement_keys_v1('charter.future-person'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0035-aaaaaaaaaaaa') as charter;
create temporary table fin4 as
select * from public.finalize_embryo_cohort_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft4),
  (select insurance from sigs4), (select charter from sigs4),
  'nonce-final-0004-aaaaaaaaaaaa'
);
select is((select caller_state from fin4), 'delivered_inline',
  'the one parent of an anonymous-donor cohort receives the cards');
select is(
  (select count(*) from public.embryo_participant_sets where cohort_id = (select cohort_id from fin4)),
  4::bigint, 'the one parent sits alone in the four persisted sets');
select is(
  (select classification || ':' || donor_slot from public.embryo_donor_attributions
   where cohort_id = (select cohort_id from fin4)),
  'anonymous:parent_b', 'the donor slot is recorded as anonymous');
select is(
  (select case_artifact_signature_id from public.embryo_basis_bindings
   where cohort_id = (select cohort_id from fin4)),
  (select single_basis from sigs4),
  'the binding names the single-parent basis attestation');
select is(
  (public.record_embryo_disposition_v1(
    '7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1',
    (select e.id from public.embryos e where e.cohort_id = (select cohort_id from fin4) and e.sample_ordinal = 0),
    'commit-single-authority', 'stored', null, 'nonce-disp-0020-aaaaaaaaaaaa')) ->> 'disposition',
  'stored', 'a single authority commits a disposition directly');
select throws_ok(
  $$select public.record_embryo_disposition_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select e.id from public.embryos e where e.cohort_id = (select cohort_id from fin4) and e.sample_ordinal = 1),
      'propose', 'stored', null, 'nonce-disp-0021-aaaaaaaaaaaa')$$,
  '22023', 'action does not match the disposition mode',
  'a single-authority cohort takes no proposal');

-- ---------------------------------------------------------------------------
-- A parent-deceased basis needs a named human review of the evidence
-- ---------------------------------------------------------------------------
create temporary table draft5 as
select * from public.create_embryo_cohort_draft_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  'own_embryos', 'parent_deceased', 1,
  decode('00112233445566778899aabbccddeeff', 'hex'), repeat('a', 64),
  '{}'::text[], '{}'::text[],
  'nonce-draft-0006-aaaaaaaaaaaa', true
);
select is(
  (select state from public.embryo_cohort_drafts where id = (select draft_id from draft5)),
  'evidence_pending', 'a parent-deceased draft waits for evidence');
create temporary table sigs5 as
select
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft5),
    'consent.upload-embryo', 1, private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0040-aaaaaaaaaaaa') as upload,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft5),
    'attestation.embryo-parentage', 1, private.embryo_statement_keys_v1('attestation.embryo-parentage'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0041-aaaaaaaaaaaa') as parentage,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft5),
    'attestation.embryo-disposition-rights', 1, private.embryo_statement_keys_v1('attestation.embryo-disposition-rights'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0042-aaaaaaaaaaaa') as rights,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft5),
    'attestation.embryo-single-parent-basis', 1, private.embryo_statement_keys_v1('attestation.embryo-single-parent-basis'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0043-aaaaaaaaaaaa') as single_basis,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft5),
    'disclosure.insurance-and-discrimination', 1, private.embryo_statement_keys_v1('disclosure.insurance-and-discrimination'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0044-aaaaaaaaaaaa') as insurance,
  public.sign_embryo_artifact_v1('7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', 'cohort_draft', (select draft_id from draft5),
    'charter.future-person', 1, private.embryo_statement_keys_v1('charter.future-person'),
    decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0045-aaaaaaaaaaaa') as charter;
select throws_ok(
  $$select * from public.finalize_embryo_cohort_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      (select draft_id from draft5), (select insurance from sigs5),
      (select charter from sigs5), 'nonce-final-0005-aaaaaaaaaaaa')$$,
  '55000', 'consent_required',
  'no reviewed evidence, no finalization');
insert into public.legal_reviews (
  id, target_kind, target_id, reviewer_principal_id, decision, decision_code,
  review_revision
)
select '7a000000-0000-0000-0000-00000000c001', 'single_parent_basis',
       (select draft_id from draft5), sp.id, 'approved', 'evidence-genuine', 1
from public.subject_principals sp
where sp.account_id = '7a000000-0000-0000-0000-000000000003'
  and sp.principal_kind = 'account_subject'
limit 1;
insert into public.reviewed_evidence (
  review_id, evidence_kind, evidence_sha256, evidence_revision
) values (
  '7a000000-0000-0000-0000-00000000c001', 'parent-death-certificate',
  repeat('9', 64), 1
);
create temporary table fin5 as
select * from public.finalize_embryo_cohort_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft5), (select insurance from sigs5),
  (select charter from sigs5), 'nonce-final-0006-aaaaaaaaaaaa'
);
select is(
  (select legal_review_id from public.embryo_basis_bindings
   where cohort_id = (select cohort_id from fin5)),
  '7a000000-0000-0000-0000-00000000c001'::uuid,
  'the binding names the approved review');
select ok(
  (select reviewed_evidence_id from public.embryo_basis_bindings
   where cohort_id = (select cohort_id from fin5)) is not null,
  'the binding names the reviewed evidence');

-- ---------------------------------------------------------------------------
-- Draft expiry
-- ---------------------------------------------------------------------------
create temporary table draft2 as
select * from public.create_embryo_cohort_draft_v1(
  '7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',
  'own_embryos', 'true_two_parent', 2,
  decode('00112233445566778899aabbccddeeff', 'hex'), repeat('a', 64),
  array['ffeeddccbbaa99887766554433221100'], array[repeat('f', 64)],
  'nonce-draft-0003-aaaaaaaaaaaa', true
);
create temporary table draft2_parents as
select s.principal_id from public.draft_participant_slots s
where s.embryo_draft_id = (select draft_id from draft2);
select lives_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'cohort_draft', (select draft_id from draft2),
      'consent.upload-embryo', 1,
      private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0050-aaaaaaaaaaaa')$$,
  'the owner signs before inviting');
select ok(
  (select invitation_id from public.create_embryo_draft_invitation_v1(
    '7a000000-0000-0000-0000-000000000001',
    '7a000000-0000-4000-8000-0000000000a1', (select draft_id from draft2),
    repeat('f', 64), repeat('3', 64), 'nonce-invite-0003-aaaaaaaaaaa', true)) is not null,
  'the second draft invites its co-parent');

update public.embryo_cohort_drafts
set fixed_expires_at = created_at + interval '1 millisecond'
where id = (select draft_id from draft2);
select throws_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'cohort_draft', (select draft_id from draft2),
      'attestation.embryo-parentage', 1,
      private.embryo_statement_keys_v1('attestation.embryo-parentage'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-sign-0051-aaaaaaaaaaaa')$$,
  '42501', 'draft unavailable', 'an expired draft takes no signature');
select throws_ok(
  $$select * from public.create_embryo_draft_invitation_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1', (select draft_id from draft2),
      repeat('f', 64), repeat('4', 64), 'nonce-invite-0004-aaaaaaaaaaa', true)$$,
  '42501', 'draft unavailable', 'an expired draft takes no invitation');
update public.retention_due_phases
set phase_deadline = clock_timestamp() - interval '1 second'
where retention_id = 'embryo.cohort-draft-30d'
  and target_id = (select draft_id from draft2);

create temporary table expired as select * from public.run_due_embryo_retention_phases_v1();

select is((select count(*) from expired), 1::bigint,
  'the executor expires exactly the due draft');
select is((select owner_account_id from expired),
  '7a000000-0000-0000-0000-000000000001'::uuid,
  'the executor names the owner for the terminal notice');
select is(
  (select count(*) from public.embryo_cohort_drafts where id = (select draft_id from draft2)),
  0::bigint, 'the expired draft row is deleted');
select is(
  (select status from public.retention_due_phases
   where retention_id = 'embryo.cohort-draft-30d'
     and target_id = (select draft_id from draft2)),
  'succeeded', 'the expiry phase succeeded');
select is(
  (select count(*) from public.subject_principals
   where id in (select principal_id from draft2_parents)),
  0::bigint, 'the draft''s parent principals are deleted');
select is(
  (select count(*) from public.encrypted_contact_references
   where principal_id in (select principal_id from draft2_parents)),
  0::bigint, 'the draft''s contacts are deleted');
select is(
  (select count(*) from public.subject_invitations
   where target_kind = 'cohort_draft' and target_id = (select draft_id from draft2)),
  0::bigint, 'the draft''s invitation is deleted');
select is(
  (select count(*) from public.consent_signatures
   where target_kind = 'cohort_draft' and target_id = (select draft_id from draft2)),
  0::bigint, 'signatures tied only to the draft are deleted');
select is(
  (select count(*) from public.embryo_cohort_drafts where id = (select draft_id from draft)),
  1::bigint, 'a finalized draft is untouched by the executor');
-- The cancellation branch: a due phase that points at a consumed draft.
update public.retention_due_phases
set status = 'pending', terminal_outcome_code = null, completed_at = null,
    phase_deadline = clock_timestamp() - interval '1 second'
where retention_id = 'embryo.cohort-draft-30d'
  and target_id = (select draft_id from draft);
select is(
  (select count(*) from public.run_due_embryo_retention_phases_v1()),
  0::bigint, 'a consumed draft is never expired');
select is(
  (select status || ':' || terminal_outcome_code from public.retention_due_phases
   where retention_id = 'embryo.cohort-draft-30d'
     and target_id = (select draft_id from draft)),
  'cancelled:draft_finalized', 'its stale phase is cancelled');
select lives_ok(
  $$select public.enqueue_account_mail(
      '7a000000-0000-0000-0000-000000000001',
      decode('00112233445566778899aabbccddeeff', 'hex'), repeat('a', 64),
      'embryo-draft-expired', 'embryo-draft-expired', 'cohort_draft',
      (select draft_id from draft2), '{}'::jsonb, repeat('5', 64),
      clock_timestamp() + interval '29 days')$$,
  'the owner''s draft-expired notice can be queued');
select is(
  (select count(*) from public.mail_outbox where template_id = 'embryo-draft-expired'),
  1::bigint, 'the draft-expired notice sits in the outbox');

-- ---------------------------------------------------------------------------
-- Privileges, nonce store, column guard, statistics
-- ---------------------------------------------------------------------------
select is(
  has_function_privilege('authenticated',
    'public.create_embryo_cohort_draft_v1(uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean)',
    'execute'),
  false, 'authenticated cannot create drafts directly');
select is(
  has_function_privilege('authenticated',
    'public.finalize_embryo_cohort_v1(uuid, uuid, uuid, uuid, uuid, text)', 'execute'),
  false, 'authenticated cannot finalize directly');
select is(
  has_function_privilege('authenticated',
    'public.deliver_embryo_record_key_cards_v1(uuid, uuid, uuid, text)', 'execute'),
  false, 'authenticated cannot print cards directly');
select is(
  has_function_privilege('authenticated', 'public.job_time_stats(text)', 'execute'),
  true, 'job_time_stats is readable by signed-in accounts');
select is(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.embryo_operation_nonces'::regclass),
  true, 'the nonce store has row level security');
select is(
  has_table_privilege('authenticated', 'public.embryo_operation_nonces', 'select'),
  false, 'authenticated cannot read the nonce store');
select throws_ok(
  $$select public.sign_embryo_artifact_v1(
      '7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',
      'cohort_draft', (select draft_id from draft),
      'consent.upload-embryo', 1,
      private.embryo_statement_keys_v1('consent.upload-embryo', 'parent'),
      decode('deadbeef', 'hex'), 'GB', 'nonce-draft-0001-aaaaaaaaaaaa')$$,
  '23505', 'operation nonce already used',
  'a nonce consumed by one operation is refused by every other');
select is(
  (select count(*) from pg_event_trigger where evtname = 'embryo_forbidden_columns_guard'),
  1::bigint, 'the forbidden-column guard exists');
select throws_ok(
  $$alter table public.embryos add column sex text$$,
  '42501', 'forbidden embryo column embryos.sex',
  'no embryo table can gain a sex column');
select is(
  (select n_bucket from public.job_time_stats('split_cohort_vcf')),
  '<20', 'empty job statistics expose the small-sample bucket, not an exact count');
select is(
  (select p50_seconds from public.job_time_stats('split_cohort_vcf')),
  null, 'percentiles are withheld under twenty jobs');

select * from finish();
rollback;
