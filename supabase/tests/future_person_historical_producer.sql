begin;
select no_plan();
-- Existing actual two-parent signing/finalization/ingest/canonical/QC producer.
-- This is synthetic SQL executor evidence, not historical signing, a native
-- document read, real provider delivery, human review or elapsed20y/30d proof.
\ir fixtures/future_person_custody_source.inc
create temporary table historical_scope as select e.id embryo,e.subject_id subject,
  clock_timestamp() recorded_at,clock_timestamp()-interval '19 years 6 months' logical_at
  from public.embryos e where e.cohort_id=(select cohort_id from live) and e.sample_ordinal=0;
create temporary table historical_original as select
  (select jsonb_agg(to_jsonb(x) order by x.file_id) from private.embryo_canonical_sources x) sources,
  (select jsonb_agg(to_jsonb(x) order by x.id) from private.embryo_canonical_parts x) parts,
  (select jsonb_agg(to_jsonb(x) order by x.file_id,x.part_id) from private.embryo_canonical_source_parts x) memberships,
  (select jsonb_agg(to_jsonb(x) order by x.id) from public.consent_signatures x) signatures,
  (select jsonb_agg(to_jsonb(x) order by x.id) from public.attestations x) attestations,
  (select jsonb_agg(to_jsonb(e) order by e.id) from public.embryos e where e.id<>(select embryo from historical_scope)) siblings;
grant select on historical_scope to anon,authenticated,inherit_upload_only,service_role;
create function pg_temp.historical_call(p_at timestamptz,p_action text default 'propose',
  p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_session uuid default '7a000000-0000-4000-8000-0000000000a1',p_proposal uuid default null,
  p_nonce text default 'historical-producer-default-0001',p_disposition text default 'transferred')
returns jsonb language sql security invoker as $$
  select private.record_embryo_disposition_at_v1(p_account,p_session,(select embryo from historical_scope),
    p_action,p_disposition,p_proposal,p_nonce,p_at);
$$;
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) api
  cross join unnest(array[
    'private.record_embryo_disposition_at_v1(uuid,uuid,uuid,text,text,uuid,text,timestamptz)',
    'private.close_embryo_disposition_proposal_at_v1(uuid,text,text,timestamptz)',
    'private.enqueue_embryo_principal_mail_at_v1(uuid,text,text,text,uuid,jsonb,text,timestamptz,text,uuid,timestamptz)',
    'private.enqueue_embryo_principal_mail_clock_core_v1(uuid,text,text,text,uuid,jsonb,text,timestamptz,text,uuid,timestamptz)',
    'private.record_embryo_disposition_clock_core_v1(uuid,uuid,uuid,text,text,uuid,text,timestamptz)']) signature
  where has_function_privilege(api,signature,'execute')),0::bigint,'all twenty API-role/core pairs are denied');
select is((select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace,
  lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
  where ns.nspname='private' and p.proname in ('record_embryo_disposition_at_v1','close_embryo_disposition_proposal_at_v1',
    'enqueue_embryo_principal_mail_at_v1','enqueue_embryo_principal_mail_clock_core_v1','record_embryo_disposition_clock_core_v1') and acl.grantee<>p.proowner),
  0::bigint,'new private cores grant nobody except their actual schema owner');
set local role service_role;
select throws_ok($$select pg_temp.historical_call(clock_timestamp())$$,'42501','permission denied for function record_embryo_disposition_at_v1',
  'service cannot invoke the owner clock core even with genuine readable fixture arguments');
reset role;
set local role authenticated;
select throws_ok($$select pg_temp.historical_call(clock_timestamp())$$,'42501','permission denied for function record_embryo_disposition_at_v1',
  'authenticated cannot invoke the owner clock core');
reset role;
select throws_ok($$select pg_temp.historical_call(null)$$,'22023','invalid disposition clock','owner seam rejects a null disposition instant');
select throws_ok($$select pg_temp.historical_call('infinity')$$,'22023','invalid disposition clock','owner seam rejects positive infinity');
select throws_ok($$select pg_temp.historical_call('-infinity')$$,'22023','invalid disposition clock','owner seam rejects negative infinity');
select throws_ok($$select private.close_embryo_disposition_proposal_at_v1(null,'confirmed','proposal_confirmed',null)$$,
  '22023','invalid proposal clock','closure rejects a null instant before any effect');
select throws_ok($$select private.close_embryo_disposition_proposal_at_v1(null,'confirmed','proposal_confirmed','infinity')$$,
  '22023','invalid proposal clock','closure rejects a nonfinite instant');
select throws_ok($$select private.enqueue_embryo_principal_mail_at_v1(null,'embryo-disposition-notice','embryo-disposition-notice',
  'subject',null,'{}',repeat('a',64),clock_timestamp(),null,null,null)$$,
  '22023','invalid mail creation clock','mail finite_at rejects a null instant even before a missing recipient');
select throws_ok($$select private.enqueue_embryo_principal_mail_at_v1(null,'embryo-disposition-notice','embryo-disposition-notice',
  'subject',null,'{}',repeat('a',64),clock_timestamp(),null,null,'infinity')$$,
  '22023','invalid mail creation clock','mail finite_at rejects infinity');
select throws_ok($$select private.enqueue_embryo_principal_mail_clock_core_v1(null,'embryo-disposition-notice','embryo-disposition-notice',
  'subject',null,'{}',repeat('a',64),clock_timestamp(),null,null,'-infinity')$$,
  '22023','invalid mail creation clock','the denied nullable shared core still rejects nonfinite explicit clocks');
select throws_ok($$select pg_temp.historical_call(clock_timestamp(),null)$$,'22023','invalid disposition request','owner core retains the public null-action refusal');
select throws_ok($$select pg_temp.historical_call(clock_timestamp(),p_disposition=>null)$$,'22023','invalid disposition request','owner core retains the public null-disposition refusal');
select throws_ok($$select pg_temp.historical_call(clock_timestamp(),p_account=>'7a000000-0000-0000-0000-000000000003',
  p_session=>'7a000000-0000-4000-8000-0000000000c1')$$,'42501',null,'stranger current Auth cannot borrow two-parent authority');
select throws_ok($$select pg_temp.historical_call(clock_timestamp(),p_session=>'7a000000-0000-4000-8000-0000000000b1')$$,
  '42501',null,'a crossed current Auth session cannot authorize a historical event');
select throws_ok($$select pg_temp.historical_call(clock_timestamp(),'commit-single-authority')$$,
  '22023','action does not match the disposition mode','historical clock never turns two-parent authority into direct commit');
create temporary table historical_proposal as select pg_temp.historical_call((select logical_at from historical_scope),
  p_nonce=>'historical-first-parent-proposal-0001') body;
select is((select body->>'status' from historical_proposal),'awaiting_other_parent','the first actual current parent creates only a pending proposal');
select ok((select p.created_at=s.logical_at and p.expires_at=s.logical_at+interval '7 days' and p.created_at<p.expires_at
  and p.confirmed_at is null and p.status='pending' from public.embryo_disposition_proposals p cross join historical_scope s
  where p.id=(select (body->>'proposalId')::uuid from historical_proposal)),
  'historical creation and fixed seven-day expiry are consistent without a later row UPDATE');
select throws_ok($$select pg_temp.historical_call((select logical_at from historical_scope),'propose',
  p_nonce=>'historical-second-proposal-0001')$$,'55000','proposal pending','the logical clock preserves the single pending proposal rule');
select throws_ok($$select pg_temp.historical_call((select logical_at+interval '1 second' from historical_scope),'confirm',
  p_proposal=>(select (body->>'proposalId')::uuid from historical_proposal),p_nonce=>'historical-own-confirmation-0001')$$,
  '42501','proposal unavailable','the original proposer cannot supply the second parent confirmation');
select throws_ok($$select pg_temp.historical_call((select logical_at+interval '7 days' from historical_scope),'confirm',
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
  (select (body->>'proposalId')::uuid from historical_proposal),'historical-expired-confirm-0001')$$,
  '42501','proposal unavailable','the other actual parent cannot confirm at the exact immutable expiry');
create temporary table historical_transfer as select pg_temp.historical_call((select logical_at+interval '1 second' from historical_scope),'confirm',
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
  (select (body->>'proposalId')::uuid from historical_proposal),'historical-other-parent-confirm-0001') body;
select is((select body->>'disposition' from historical_transfer),'transferred','the distinct current parent commits the exact original transfer algorithm');
select ok((select p.confirmed_at=s.logical_at+interval '1 second' and p.confirmed_at<p.expires_at
  and p.status='confirmed' from public.embryo_disposition_proposals p cross join historical_scope s
  where p.id=(select (body->>'proposalId')::uuid from historical_proposal)),
  'proposal closure uses the same finite logical event instant');
select ok((select count(*)=1 and bool_and(d.status='cancelled' and d.completed_at=s.logical_at+interval '1 second'
  and rr.state='cancelled' and rr.ended_at=d.completed_at and m.state='cancelled')
  from public.retention_due_phases d join public.retention_rows rr on rr.id=d.retention_row_id
  join public.purge_manifests m on m.retention_row_id=d.retention_row_id and m.phase_id=d.phase_id and m.phase_revision=d.phase_revision
  cross join historical_scope s where d.immutable_envelope->>'proposalId'=(select body->>'proposalId' from historical_proposal)),
  'exact seven-day phase, manifest and retention row close together before the real scheduler can lapse the proposal');
select ok((select e.transferred_at=s.logical_at+interval '1 second' and e.disposition_effective_at=e.transferred_at
  and e.retention_expires_at=e.transferred_at+interval '18 years 9 months'+interval '24 months'
  and e.retention_expires_at>s.recorded_at and e.closing_date=e.retention_expires_at::date
  and e.closing_date_state='definitive_transferred_claim_window' from public.embryos e cross join historical_scope s where e.id=s.embryo),
  'all effective dates and the original future Card closing window come only from the real producer');
select is((select count(*) from public.retention_due_phases p cross join historical_scope s where p.target_id=s.subject
  and p.retention_id='embryo.transferred-claim-window'),5::bigint,'the transfer creates exactly all five registered phases');
select ok((select count(*)=2 and bool_and(m.created_at=s.logical_at+interval '1 second' and m.not_before=m.created_at
  and m.expires_at=m.created_at+interval '30 days' and m.expires_at>s.logical_at and m.expires_at<s.recorded_at
  and m.state='queued' and m.token_purpose is null and m.token_target_id is null
  and m.template_payload->>'effectiveAt'=(select body->>'effectiveAt' from historical_transfer))
  from public.mail_outbox m cross join historical_scope s where m.target_id=s.subject and m.purpose='embryo-disposition-notice'),
  'both exact current parents receive genuine queued historical disposition mail with original strict creation/expiry and no fake delivery');
select ok((select sources=(select jsonb_agg(to_jsonb(x) order by x.file_id) from private.embryo_canonical_sources x)
  and parts=(select jsonb_agg(to_jsonb(x) order by x.id) from private.embryo_canonical_parts x)
  and memberships=(select jsonb_agg(to_jsonb(x) order by x.file_id,x.part_id) from private.embryo_canonical_source_parts x)
  and signatures=(select jsonb_agg(to_jsonb(x) order by x.id) from public.consent_signatures x)
  and attestations=(select jsonb_agg(to_jsonb(x) order by x.id) from public.attestations x)
  and siblings=(select jsonb_agg(to_jsonb(e) order by e.id) from public.embryos e where e.id<>(select embryo from historical_scope))
  from historical_original),'actual canonical source, memberships, all signed history, attestations and siblings remain byte-identical');
select throws_ok($$select pg_temp.historical_call((select logical_at+interval '1 second' from historical_scope),'confirm',
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
  (select (body->>'proposalId')::uuid from historical_proposal),'historical-other-parent-confirm-0001')$$,
  '23505','operation nonce already used','one-use operation consumption is unchanged at the logical seam');
-- The genuine public ABI still has no caller time and captures its own actual
-- instant. A different sibling uses the same shared algorithm at real time.
create temporary table real_request_clock_before as select clock_timestamp() captured_at;
create temporary table real_proposal as select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select id from public.embryos where cohort_id=(select cohort_id from live) and sample_ordinal=2),
  'propose','transferred',null,'historical-real-wrapper-propose-0001') body;
create temporary table real_request_clock_after as select clock_timestamp() captured_at;
-- The unchanged public producer captures its expiry request clock before its
-- separately captured insertion clock. Pin both to the genuine call bounds,
-- and pin the receipt/phase/manifest to that exact immutable stored deadline.
select ok((select count(*)=1 and bool_and(
  clock_before.captured_at<=clock_after.captured_at
  and p.created_at>=clock_before.captured_at and p.created_at<=clock_after.captured_at
  and p.expires_at>=clock_before.captured_at+interval '7 days'
  and p.expires_at<=clock_after.captured_at+interval '7 days'
  and p.expires_at>p.created_at and p.expires_at<=p.created_at+interval '7 days'
  and receipt.body->>'status'='awaiting_other_parent'
  and receipt.body->>'expiresAt'=to_char(p.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  and phase.retention_id='embryo.disposition-proposal-7d'
  and phase.phase_id='embryo-disposition-proposal-expiry' and phase.phase_kind='purge'
  and phase.phase_revision=1 and phase.phase_deadline=p.expires_at and phase.status='pending'
  and phase.target_kind='subject' and phase.target_id=embryo.subject_id
  and phase.immutable_envelope=jsonb_build_object('proposalId',p.id)
  and retention.retention_id=phase.retention_id and retention.fixed_deadline=p.expires_at
  and retention.target_kind=phase.target_kind and retention.target_id=phase.target_id and retention.state='scheduled'
  and manifest.manifest_class='proposal-working' and manifest.manifest_revision=1 and manifest.state='frozen'
  and manifest.source_binding_fingerprint=encode(extensions.digest(convert_to(
    concat_ws(':','embryo-disposition-proposal-v1',p.id::text),'UTF8'),'sha256'),'hex'))
  from public.embryo_disposition_proposals p
  join public.embryos embryo on embryo.id=p.embryo_id
  join public.retention_due_phases phase on phase.immutable_envelope->>'proposalId'=p.id::text
  join public.retention_rows retention on retention.id=phase.retention_row_id
  join public.purge_manifests manifest on manifest.retention_row_id=phase.retention_row_id
    and manifest.phase_id=phase.phase_id and manifest.phase_revision=phase.phase_revision
  cross join real_request_clock_before clock_before cross join real_request_clock_after clock_after
  cross join real_proposal receipt where p.id=(receipt.body->>'proposalId')::uuid),
  'the original public path preserves its actual request clock and exact receipt/phase/manifest deadline');
create temporary table real_transfer as select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
  (select id from public.embryos where cohort_id=(select cohort_id from live) and sample_ordinal=2),
  'confirm','transferred',(select (body->>'proposalId')::uuid from real_proposal),'historical-real-wrapper-confirm-0001') body;
select ok((select p.confirmed_at>=s.recorded_at and p.confirmed_at>=p.created_at and p.confirmed_at<p.expires_at
  and p.status='confirmed' from public.embryo_disposition_proposals p cross join historical_scope s
  where p.id=(select (body->>'proposalId')::uuid from real_proposal)),
  'the original public confirmation and closure remain actual-clock events');
select ok((select count(*)=2 and bool_and(m.created_at>=scope.recorded_at
  and m.created_at>=(transfer.body->>'effectiveAt')::timestamptz and m.not_before=m.created_at
  and m.expires_at=embryo.disposition_effective_at+interval '30 days'
  and m.expires_at<=m.created_at+interval '30 days' and m.state='queued'
  and m.token_purpose is null and m.token_target_id is null)
  from public.mail_outbox m join public.embryos embryo on embryo.subject_id=m.target_id
  cross join historical_scope scope cross join real_transfer transfer
  where embryo.cohort_id=(select cohort_id from live) and embryo.sample_ordinal=2
    and m.purpose='embryo-disposition-notice'),
  'both public-path mails capture actual creation after locks while preserving their exact fixed expiry');
select is((select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public' and p.proname='record_embryo_disposition_v1'),1::bigint,'no public caller-clock overload exists');
select is(md5((select prosrc from pg_proc where oid='public.record_embryo_disposition_v1(uuid,uuid,uuid,text,text,uuid,text)'::regprocedure)),
  '2bb7b725bdab60364579c6ab762988cb','the complete current public authority wrapper stays byte-identical');
set constraints all immediate;
select * from finish();
rollback;
