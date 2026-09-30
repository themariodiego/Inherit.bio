begin;
select no_plan();
-- Genuine review/release/mail/activation, with all original predecessor proofs.
\ir fixtures/future_person_export_authority.inc
select ok((select audit_principal_id is not null from private.future_person_custody_slices where subject_id=(select subject from custody_ids)),
 'the genuine approved custody has its one newly issued exact audit selector');
select ok((select created_at is not null from public.audit_principals where id=private.future_person_audit_selector_v1((select subject from custody_ids))),
 'the new exact selector resolves an actually issued principal without a guessed old identity');
select is((private.future_person_export_audit_v1((select subject from custody_ids))->>'count')::integer,0,
 'no historical review or unrelated actor event is assigned to the new claimant');
create function pg_temp.legacy_stop() returns text language plpgsql as $$
declare principals bigint;stopped timestamptz;
begin
 select count(*) into principals from public.audit_principals;
 stopped:=public.stop_future_person_analysis_v1(pg_temp.h('rights'),'legacy-stop-nonce-aaaaaaaa');
 return ((select count(*) from public.audit_principals)=principals
  and (select audit_principal_id is null from public.legal_audit_log order by seq desc limit 1)
  and (private.future_person_export_capture_v1(pg_temp.h('rights'))#>>'{legalAudit,attribution}')='unrecorded'
  and (private.future_person_export_capture_v1(pg_temp.h('rights'))#>>'{membership,legalAuditEvents}')='0')::text;
end $$;
select is(pg_temp.probe('set constraints all immediate;
 alter table private.future_person_custody_slices disable trigger future_person_custody_slice_immutable;
 update private.future_person_custody_slices set audit_principal_id=null where subject_id=(select subject from custody_ids);
 alter table private.future_person_custody_slices enable trigger future_person_custody_slice_immutable;
 set constraints all deferred','select pg_temp.legacy_stop()'),
 'true','a genuine legacy NULL custody stop keeps its audit anonymous, allocates no principal and cannot be retroattributed');
-- Owner-only synthetic ledger paging input, through the actual single chain
-- writer. These rows prove membership transport, not a deletion API decision.
do $$declare n integer;foreign_actor uuid;begin
 for n in 1..500 loop
  perform private.append_legal_audit_event('claimant.deletion_requested',
   private.future_person_audit_selector_v1((select subject from custody_ids)),'api.future-person-delete','accepted','{}');
 end loop;
 insert into public.audit_principals default values returning id into foreign_actor;
 perform private.append_legal_audit_event('claimant.deletion_requested',foreign_actor,'api.future-person-delete','accepted','{}');
 perform private.append_legal_audit_event('claimant.deletion_requested',null,'api.future-person-delete','accepted','{}');
end $$;
select lives_ok($$select public.stop_future_person_analysis_v1(pg_temp.h('rights'),'attributed-stop-nonce-aaaaaaaa')$$,
 'the genuine activated claimant performs the irreversible stop through its unchanged current nonce door');
select is((select audit_principal_id from public.legal_audit_log where event_code='claimant.analysis_stopped' order by seq desc limit 1),
 private.future_person_audit_selector_v1((select subject from custody_ids)),
 'the real accepted claimant action records the exact pre-issued custody actor, not a fresh unlinked identity');
create temporary table ledger_authority as select public.future_person_export_request_v1('capture',pg_temp.h('rights')) body;
select is((select (body#>>'{membership,legalAuditEvents}')::integer from ledger_authority),501,
 'capture declares every actual own ledger event and excludes foreign and NULL actors');
select is((select body#>>'{legalAudit,attribution}' from ledger_authority),'assigned','metadata explicitly records genuine attribution');
select is((select (body#>>'{legalAudit,attributionStartedAt}')::timestamptz from ledger_authority),
 (select started_at from private.legal_audit_attribution_config where singleton),
 'metadata retains the existing non-personal ledger attribution reference clock');
select is((select array_agg(k order by k) from ledger_authority,jsonb_object_keys(body->'membership') k),
 array['agreements','figures','legalAuditEvents','qualityReports','reports','scores','variants'],
 'complete membership adds exactly the actual own ledger class');
select ok(not (select body::text from ledger_authority)~'audit_principal_id|row_hash|previous_hash|ciphertext',
 'the capture exposes no actor UUID, ledger chain material or identity ciphertext');
create function pg_temp.ledger_export(p_nonce text) returns jsonb language sql as $$
 select public.future_person_export_request_v1('create',pg_temp.h('rights'),jsonb_build_object(
  'exportCookieHash',pg_temp.h('ledger-cookie'),'envelope',jsonb_build_object(
   'routeId','api.future-person-export','origin','independent-rights','principalId',body->>'principalId',
   'targetKind','subject','targetId',(select subject from custody_ids)::text,'exportContract','approved-future-person-export-v1',
   'originBinding',body->>'originBinding','authorityReceipt',body->>'authorityReceipt','csrfBinding',pg_temp.h('csrf'),
   'operation','create','nonceHash',pg_temp.h(p_nonce),'issuedAt',n,'expiresAt',n+300000)),pg_temp.h('csrf'))
 from ledger_authority cross join lateral(select floor(extract(epoch from clock_timestamp())*1000)::bigint n) clock;
$$;
create temporary table ledger_export as select pg_temp.ledger_export('ledger-export') body;
set constraints all immediate;
set constraints all deferred;
create temporary table ledger_attempt as select gen_random_uuid() id;
select lives_ok($$select public.export_archive_worker_v1('preflight',(select (body->>'exportId')::uuid from ledger_export),
 (select id from ledger_attempt),(select body->>'authorityReceipt' from ledger_authority))$$,'the real durable worker authorizes the complete ledger origin');
select lives_ok($$select public.export_archive_worker_v1('begin',(select (body->>'exportId')::uuid from ledger_export),
 (select id from ledger_attempt),(select body->>'authorityReceipt' from ledger_authority))$$,'the complete origin starts its exact registered writing attempt');
create function pg_temp.ledger_page(p_after text default null) returns jsonb language sql as $$
 select public.future_person_export_members_v1('legal-audit',(select (body->>'exportId')::uuid from ledger_export),
  (select id from ledger_attempt),(select body->>'authorityReceipt' from ledger_authority),p_after);
$$;
create temporary table ledger_page_1 as select pg_temp.ledger_page() body;
create temporary table ledger_page_2 as select pg_temp.ledger_page((select body->>'nextAfterId' from ledger_page_1)) body;
select is((select (body->>'count')::integer from ledger_page_1),500,'a real own ledger page is bounded to500');
select is((select (body->>'count')::integer from ledger_page_2),1,'the second page includes the actual stop after all500 recorded entries');
select is((pg_temp.ledger_page((select body->>'nextAfterId' from ledger_page_2))->>'count')::integer,0,
 'exact keyset exhaustion includes every captured event without a fabricated sentinel');
select is((select array_agg(k order by k) from ledger_page_1,jsonb_object_keys(body->'rows'->0->'event') k),
 array['coded_context','event_code','occurred_at','outcome_code','route_id','seq'],'every actual exported ledger event has exactly the six original coded fields');
select ok((select bool_and(row->>'id'=row#>>'{event,seq}' and row#>'{event,coded_context}'='{}'::jsonb)
 from ledger_page_1,jsonb_array_elements(body->'rows') row),'all page wrappers bind the exact original sequence and empty registered context');
select ok(not ((select body::text from ledger_page_1)||(select body::text from ledger_page_2))~'audit_principal_id|row_hash|previous_hash|ciphertext',
 'neither page reveals actor identities or chain fields');
select throws_ok($$select pg_temp.ledger_page('1x')$$,'22023','invalid_request','a nonnumeric ledger selector cannot reach a numeric cast');
select throws_ok($$select pg_temp.ledger_page('0')$$,'22023','invalid_request','zero cannot masquerade as an issued ledger sequence');
select throws_ok($$select pg_temp.ledger_page('9223372036854775808')$$,'22023','invalid_request','a bigint overflow is refused before selecting any ledger row');
select throws_ok($$select pg_temp.ledger_page('-1')$$,'22023','invalid_request','a negative ledger selector is refused before data');
select throws_ok($$select pg_temp.ledger_page('99999999999999999999')$$,'22023','invalid_request','an unbounded ledger selector is refused before data');
select throws_ok($$select pg_temp.probe('do $x$ begin perform private.append_legal_audit_event(''claimant.deletion_requested'',
 private.future_person_audit_selector_v1((select subject from custody_ids)),''api.future-person-delete'',''accepted'',''{}'');end $x$',
 'select pg_temp.ledger_page()::text')$$,'42501','not_found','an added actual own event invalidates the complete captured receipt before any more bytes');
select throws_ok($$select pg_temp.probe('do $x$ begin perform private.append_legal_audit_event(''claimant.analysis_stopped'',
 private.future_person_audit_selector_v1((select subject from custody_ids)),null,''accepted'',''{}'');end $x$',
 'select public.future_person_export_request_v1(''capture'',pg_temp.h(''rights''))::text')$$,
 '55000','export_audit_unavailable','a NULL route cannot pass the exact registered claimant event envelope');
select throws_ok($$select pg_temp.probe('do $x$ begin perform private.append_legal_audit_event(''claimant.analysis_stopped'',
 private.future_person_audit_selector_v1((select subject from custody_ids)),''api.future-person-analysis-stop'',''accepted'',''{"nested":{"email":"synthetic@e2e.local"}}'');end $x$',
 'select public.future_person_export_request_v1(''capture'',pg_temp.h(''rights''))::text')$$,
 '55000','export_audit_unavailable','an unregistered nested context refuses the whole captured archive rather than leaking or dropping fields');
select ok((select bool_and(not has_function_privilege(role,'private.future_person_export_snapshot_v1(text)','execute')
 and not has_function_privilege(role,'private.future_person_export_audit_v1(uuid)','execute'))
 from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role),
 'no API role can bypass live claimant receipt authority through a private capture helper');
select * from finish();
rollback;
