begin;
select no_plan();
-- All original native provider-attempt/refusal/current-delivery assertions.
-- Metadata is SQL authority evidence only: this fixture gives no native
-- document, actual provider, elapsed30-day period or human-review credit.
\ir fixtures/future_person_keyless_delivered.inc
select private.assign_keyless_review_operation_v1((select review from keyless_ids),
 '7a000000-0000-0000-0000-000000000001','claim-release');
create temporary table release_input as select (select review from keyless_ids) review,
 (select review_revision from private.claim_reviews) review_revision,
 (select notice_revision from public.future_person_claim_notices) notice_revision,
 (select notice_deadline from public.future_person_claim_notices) boundary,
 extensions.gen_random_uuid() contact;
grant select on release_input to authenticated,service_role,anon,inherit_upload_only;
create temporary table release_preserved as select
 (select jsonb_agg(to_jsonb(cs) order by file_id) from private.embryo_canonical_sources cs) sources,
 (select jsonb_agg(to_jsonb(part) order by id) from private.embryo_canonical_parts part) parts,
 (select to_jsonb(notice) from public.future_person_claim_notices notice) notice;
create function pg_temp.native_release(p_nonce text default 'native-fresh-release',p_revision bigint default null)
returns jsonb language sql security invoker as $$
 select public.decide_keyless_release_v1((select review from release_input),coalesce(p_revision,(select review_revision from release_input)),
  (select notice_revision from release_input),'approve-release',null,pg_temp.keyless_hash(p_nonce),
  extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),
  ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,jsonb_build_object('1',repeat('a',64)),
  jsonb_build_object('1',repeat('b',64)),(select contact from release_input),extensions.gen_random_bytes(128),jsonb_build_object('1',repeat('c',64)));
$$;
create function pg_temp.release_at(p_at timestamptz,p_nonce text default 'executor-fresh-release',p_revision bigint default null)
returns jsonb language sql security invoker as $$
 select private.decide_keyless_release_at_v1((select review from release_input),coalesce(p_revision,(select review_revision from release_input)),
  (select notice_revision from release_input),'approve-release',null,pg_temp.keyless_hash(p_nonce),
  extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),
  ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,jsonb_build_object('1',repeat('a',64)),
  jsonb_build_object('1',repeat('b',64)),(select contact from release_input),extensions.gen_random_bytes(128),jsonb_build_object('1',repeat('c',64)),p_at);
$$;
set local role authenticated;
select lives_ok($$select public.read_keyless_current_review_v1((select review from release_input))$$,
 'the own current named reviewer reads only this new distinct assigned operation');
select throws_ok($$select pg_temp.native_release()$$,'42501','claim review unavailable',
 'the actual public clock refuses before the immutable provider-committed30-day deadline');
select throws_ok($$select pg_temp.release_at((select boundary from release_input))$$,'42501',null,
 'authenticated JWT cannot invoke the synthetic clock seam');
reset role;
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name
 where has_function_privilege(role_name,'private.decide_keyless_release_at_v1(uuid,bigint,bigint,text,text,text,bytea,bytea,date,jsonb,jsonb,uuid,bytea,jsonb,timestamptz)','execute')),
 0::bigint,'all four API roles are denied at the owner-only executor seam');
select is((select array_agg(role_name order by role_name) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name
 where has_function_privilege(role_name,'public.decide_keyless_release_v1(uuid,bigint,bigint,text,text,text,bytea,bytea,date,jsonb,jsonb,uuid,bytea,jsonb)','execute')),
 array['authenticated']::text[],'only the actual own-JWT authenticated final native door is executable');
select throws_ok($$select pg_temp.release_at('infinity')$$,'42501','claim review unavailable','owner test seam rejects infinite server time');
select throws_ok($$select pg_temp.release_at(null)$$,'42501','claim review unavailable','owner test seam rejects absent server time');
select throws_ok($$select pg_temp.release_at((select boundary from release_input)-interval '1 microsecond')$$,'42501','claim review unavailable',
 'same execution core refuses even one microsecond before the real immutable boundary');
select throws_ok($$select pg_temp.release_at((select boundary from release_input))$$,'42501','claim review unavailable',
 'the new assignment cannot reuse initial documentary full-document receipts');
-- Genuine current assignment/current byte-digest/client-delivery metadata.
-- Only SQL refusal/executor rules are tested; these are not actual byte reads.
insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision,document_id,chunk_sequence,
 assignment_revision,document_sha256,delivery_verified_at,account_auth_session_revision,originating_session_revision)
 select review,'7a000000-0000-0000-0000-000000000001'::uuid,'7a000000-0000-4000-8000-0000000000a1'::uuid,
  (select review_revision from release_input),photo,0,2,pg_temp.keyless_hash('photo'),null,1,1 from keyless_ids;
select throws_ok($$select pg_temp.release_at((select boundary from release_input))$$,'42501','claim review unavailable',
 'a canceled/unacknowledged current photo response cannot satisfy full receipt');
update private.claim_review_reads set delivery_verified_at=clock_timestamp()
 where document_id=(select photo from keyless_ids) and review_revision=(select review_revision from release_input);
select throws_ok($$select pg_temp.release_at((select boundary from release_input))$$,'42501','claim review unavailable',
 'one fresh complete document cannot satisfy the independent final review');
insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision,document_id,chunk_sequence,
 assignment_revision,document_sha256,delivery_verified_at,account_auth_session_revision,originating_session_revision)
 select review,'7a000000-0000-0000-0000-000000000001'::uuid,'7a000000-0000-4000-8000-0000000000a1'::uuid,
  (select review_revision from release_input),birth,0,2,pg_temp.keyless_hash('birth'),clock_timestamp(),1,1 from keyless_ids;
select throws_ok($$select pg_temp.release_at((select boundary from release_input),p_revision=>99)$$,'42501','claim review unavailable',
 'an invented review revision has no custody or release effect');
set local role authenticated;
select throws_ok($$select pg_temp.native_release()$$,'42501','claim review unavailable',
 'even complete fresh SQL receipt metadata cannot make the public real clock expire early');
reset role;
create temporary table executed_release as select pg_temp.release_at((select boundary from release_input)) body;
select is((select body from executed_release),jsonb_build_object('claimId',(select review from release_input),
 'state','release_queued','reviewRevision',(select review_revision+1 from release_input)),
 'the same owner-only execution core commits precisely the registered receipt at its synthetic boundary');
select is((select count(*) from public.future_person_claimant_principals where status='current'),1::bigint,
 'successful atomic review creates one actual durable claimant');
select is((select count(*) from private.future_person_custody_slices),1::bigint,
 'successful atomic review preserves one exact detached custody slice');
select ok((select lifecycle='claimed_unbound' and owner_account_id is null and cohort_id is null
 and claimant_principal_id is not null from public.subjects where id=(select subject from keyless_ids)),
 'the genuine final transaction detaches current parent control from the claimed subject');
select ok((select sources=(select jsonb_agg(to_jsonb(cs) order by file_id) from private.embryo_canonical_sources cs)
 and parts=(select jsonb_agg(to_jsonb(part) order by id) from private.embryo_canonical_parts part)
 and notice=(select to_jsonb(n) from public.future_person_claim_notices n where n.notice_kind='owner_notice') from release_preserved),
 'all immutable canonical source, part and original provider-delivery tuples remain byte-identical');
select ok((select state='approved' and comparison_ciphertext is null and wrapped_comparison_key is null
 and comparison_key_shredded_at is not null from public.future_person_claim_review_packages),
 'final approval destroys the independent temporary documentary minimum');
select ok((select count(*)=2 and bool_and(wrapped_document_key is null and document_key_shredded_at is not null)
 from private.claim_document_sessions where intake_id=(select review from keyless_ids)),
 'final approval separately destroys both document wrappers');
select ok((select status='shredded' and contact_ciphertext is null from public.encrypted_contact_references
 where id=(select contact_id from notice_input)),'final approval destroys the old pending claimant delivery envelope');
select is((select count(*) from public.encrypted_contact_references where id=(select contact from release_input) and status='current'),1::bigint,
 'only the independently resealed approved seven-day handoff contact remains current');
select is((select count(*) from public.legal_audit_log ledger join private.future_person_custody_slices slice
 on slice.audit_principal_id=ledger.audit_principal_id where ledger.event_code='claim.resolved'
 and ledger.route_id='api.future-person-claim-release' and ledger.outcome_code='accepted'
 and ledger.coded_context='{"outcome":"approved"}'),1::bigint,
 'one successful own-reviewer transaction genuinely persists one exact attributed custody resolution');
select is((private.future_person_export_audit_v1((select subject from keyless_ids))->>'count')::bigint,1::bigint,
 'the strict attributable reader includes the exact new approved resolution');
create function pg_temp.probe(p_setup text,p_call text) returns text language plpgsql as $$
declare result text;
begin
 begin
  execute p_setup;execute p_call into result;
  raise exception using errcode='P9913',message='rollback exact refusal probe';
 exception when sqlstate 'P9913' then null;end;
 return result;
end $$;
select throws_ok($$select pg_temp.probe('do $x$ begin perform private.append_legal_audit_event(''claim.resolved'',
 private.future_person_audit_selector_v1((select subject from keyless_ids)),''api.future-person-delete'',''accepted'',''{"outcome":"approved"}'');end $x$',
 'select private.future_person_export_audit_v1((select subject from keyless_ids))::text')$$,
 '55000','export_audit_unavailable','a different route cannot borrow the attributable approval triple');
select throws_ok($$select pg_temp.probe('do $x$ begin perform private.append_legal_audit_event(''claim.resolved'',
 private.future_person_audit_selector_v1((select subject from keyless_ids)),''api.future-person-claim-release'',''accepted'',''{}'');end $x$',
 'select private.future_person_export_audit_v1((select subject from keyless_ids))::text')$$,
 '55000','export_audit_unavailable','an empty context cannot pretend to be the exact attributable approved code');
select throws_ok($$select pg_temp.probe('do $x$ begin perform private.append_legal_audit_event(''claim.resolved'',
 private.future_person_audit_selector_v1((select subject from keyless_ids)),''api.future-person-claim-release'',''refused'',''{"outcome":"approved"}'');end $x$',
 'select private.future_person_export_audit_v1((select subject from keyless_ids))::text')$$,
 '55000','export_audit_unavailable','a refused decision cannot become an attributable successful custody resolution');
select throws_ok($$select pg_temp.release_at((select boundary from release_input))$$,'42501','claim review unavailable',
 'resolved revision and consumed nonce cannot authorize another release');
set constraints all immediate;
select * from finish();
rollback;
