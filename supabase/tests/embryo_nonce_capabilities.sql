begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

-- Owner-made hash-only rows isolate the expiry predicate from the live fixture.
insert into public.embryo_operation_nonces
 (nonce_hash,operation,target_kind,consumed_at,rights_session_hash,rights_receipt_expires_at)
values
 (repeat('6',64),'invitation_refuse','rights_session',clock_timestamp()-interval '3 hours',
  repeat('6',64),clock_timestamp()-interval '1 hour'),
 (repeat('7',64),'invitation_refuse','rights_session',clock_timestamp()-interval '1 hour',
  repeat('7',64),clock_timestamp()+interval '1 hour'),
 (repeat('8',64),'rights_activate','form',clock_timestamp()-interval '3 hours',null,null);
create temporary table nonce_snapshot as
 select jsonb_agg(to_jsonb(n) order by nonce_hash) as body from public.embryo_operation_nonces n;
grant select on nonce_snapshot,draft,acks to service_role;

select ok(not has_function_privilege(r,
 'private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)','execute'),
 r||' cannot consume an arbitrary target nonce')
from unnest(array['anon','authenticated','inherit_upload_only','service_role']) r;
select ok(not has_table_privilege('service_role','public.embryo_operation_nonces',p),
 'service_role has no direct nonce '||p)
from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
select ok(has_table_privilege('service_role','public.embryo_operation_nonces','SELECT'),
 'the service role retains nonce inspection');
select ok(not has_table_privilege(r,'public.embryo_operation_nonces','SELECT'),
 r||' cannot inspect operation nonces')
from unnest(array['anon','authenticated','inherit_upload_only']) r;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot expire refusal receipts through '||f)
from unnest(array['anon','authenticated','inherit_upload_only']) r
cross join unnest(array['public.expire_invitation_refusal_receipts_v1()',
 'private.expire_invitation_refusal_receipts_v1()']) f;
select ok(has_function_privilege('service_role',f,'execute'),'service expiry remains callable through '||f)
from unnest(array['public.expire_invitation_refusal_receipts_v1()',
 'private.expire_invitation_refusal_receipts_v1()']) f;
select ok(not (select prosecdef from pg_proc
 where oid='public.expire_invitation_refusal_receipts_v1()'::regprocedure)
 and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
 where oid='private.expire_invitation_refusal_receipts_v1()'::regprocedure),
 'expiry uses an invoker facade and a private definer with an empty search path');

set local role service_role;
select throws_ok($$select private.consume_embryo_operation_nonce_v1(
 'nonce-bypass-capability',null,null,'ingest_configure','ingest_session',
 '7a000000-0000-0000-0000-000000000099')$$,'42501',null,
 'a service caller cannot append a nonce for a missing or purged target');
select throws_ok($$insert into public.embryo_operation_nonces
 (nonce_hash,operation,target_kind,target_id) values(repeat('9',64),'ingest_configure','ingest_session',
 '7a000000-0000-0000-0000-000000000099')$$,'42501',null,
 'direct insertion cannot bypass the operation target checks');
select throws_ok($$update public.embryo_operation_nonces set consumed_at=consumed_at
 where nonce_hash=repeat('7',64)$$,'42501',null,'the service role cannot rewrite a live receipt');
select throws_ok($$delete from public.embryo_operation_nonces where nonce_hash=repeat('7',64)$$,
 '42501',null,'the service role cannot delete a live receipt');
select throws_ok($$truncate public.embryo_operation_nonces$$,'42501',null,
 'the service role cannot erase nonce replay protection with TRUNCATE');
select is((select jsonb_agg(to_jsonb(n) order by nonce_hash) from public.embryo_operation_nonces n),
 (select body from nonce_snapshot),'all refused direct mutations preserve every nonce');

select is(public.expire_invitation_refusal_receipts_v1(),1,'the service expiry facade deletes the expired receipt');
select is((select count(*) from public.embryo_operation_nonces where nonce_hash=repeat('6',64)),0::bigint,
 'the expired receipt is absent');
select is((select to_jsonb(n) from public.embryo_operation_nonces n where nonce_hash=repeat('7',64)),
 (select value from nonce_snapshot,jsonb_array_elements(body) where value->>'nonce_hash'=repeat('7',64)),
 'the complete live receipt and its original deadline are preserved');
select is((select to_jsonb(n) from public.embryo_operation_nonces n where nonce_hash=repeat('8',64)),
 (select value from nonce_snapshot,jsonb_array_elements(body) where value->>'nonce_hash'=repeat('8',64)),
 'expiry preserves an old unrelated form nonce');
select is(public.expire_invitation_refusal_receipts_v1(),0,'a second expiry call removes nothing');

-- An unbound activation form is intentionally spent even for a missing token.
select is((select count(*) from public.activate_rights_session_v1(repeat('0',64),repeat('1',64),
 'nonce-capability-empty-form')),0::bigint,'an unknown token creates no rights session');
select ok(exists(select 1 from public.embryo_operation_nonces where
 nonce_hash=encode(extensions.digest('nonce-capability-empty-form','sha256'),'hex')
 and operation='rights_activate' and target_kind='form' and target_id is null
 and account_id is null and session_id is null),'the NULL form target remains supported');
select throws_ok($$select public.activate_rights_session_v1(repeat('0',64),repeat('1',64),
 'nonce-capability-empty-form')$$,'23505','operation nonce already used','form replay still fails closed');

-- Exercise the legitimate account/draft/rights-session writers as the server
-- role, including create-before-target paths. No mail is sent by these RPCs.
create temporary table extra_draft as select * from public.create_embryo_cohort_draft_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 'own_embryos','true_two_parent',1,decode('00112233445566778899aabbccddeeff','hex'),repeat('a',64),
 array['ffeeddccbbaa99887766554433221100'],array[repeat('d',64)],'nonce-capability-new-draft',true);
select is((select count(*) from extra_draft),1::bigint,'a definer creates a draft through the service role');
select lives_ok($$select public.sign_embryo_artifact_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 'cohort_draft',(select draft_id from extra_draft),'consent.upload-embryo',1,
 private.embryo_statement_keys_v1('consent.upload-embryo','parent'),decode('01','hex'),'GB',
 'nonce-capability-new-sign')$$,'the service signing RPC retains nonce access');
create temporary table extra_inv as select * from public.create_embryo_draft_invitation_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select draft_id from extra_draft),repeat('d',64),repeat('4',64),'nonce-capability-new-invite',true);
select ok((select invitation_id from extra_inv) is not null,'the service invitation RPC retains nonce access');
create temporary table extra_delivery as select * from public.claim_mail_outbox();
select is((select target_id from public.token_candidates where id=(select candidate_id
 from public.token_hashes where token_hash=encode(extensions.digest(
 (select delivery_token from extra_delivery),'sha256'),'hex'))),
 (select invitation_id from extra_inv),'the service claim names this exact co-parent invitation');
select is((select count(*) from public.activate_rights_session_v1(
 encode(extensions.digest((select delivery_token from extra_delivery),'sha256'),'hex'),repeat('4',64),
 'nonce-capability-new-activate')),1::bigint,'the service activation RPC creates the new session');
select is(public.accept_embryo_co_parent_invitation_v1(
 repeat('4',64),'7a000000-0000-0000-0000-000000000002',repeat('d',64),decode('01','hex'),'GB',
 private.embryo_statement_keys_v1('consent.upload-embryo','parent'),
 private.embryo_statement_keys_v1('attestation.embryo-parentage'),'nonce-capability-new-accept'),
 (select draft_id from extra_draft),'the service acceptance RPC retains nonce access');

-- The complete original fixture can finalize, then configure and decide a
-- mapping while its session/cohort locks are held. No source bytes are written.
create temporary table minted as select public.finalize_embryo_cohort_ingest_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select draft_id from draft),(select insurance from acks),(select charter from acks),
 'nonce-capability-finalize','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
 where s.id=(select (body->'ingest'->>'session')::uuid from minted);
select is((select count(*) from live),1::bigint,'the service finalization facade retains nested nonce access');
select is(private.configure_embryo_ingest_session_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select id from live),(select cookie_hash from live),'http://localhost:3000',
 (select cohort_id from live),(select ingest_revision from live),'pgt_table','GRCh38','explicit-header',
 'nonce-capability-configure',true)->>'status','configured','configuration retains its definer nonce write');
select is(private.configure_embryo_ingest_session_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select id from live),(select cookie_hash from live),'http://localhost:3000',
 (select cohort_id from live),(select ingest_revision from live),'pgt_table','GRCh38','explicit-header',
 'nonce-capability-configure',true)->>'status','configured','an exact configuration retry remains available');
select is(private.create_embryo_mapping_challenge_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select id from live),(select cookie_hash from live),'http://localhost:3000',
 (select cohort_id from live),(select ingest_revision from live),1,'columns',4,repeat('C',43),
 'nonce-capability-inspect',true)->>'status','challenge','inspection retains its definer nonce write');
select is(private.resolve_embryo_mapping_challenge_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select id from live),(select cookie_hash from live),'http://localhost:3000',
 (select cohort_id from live),(select ingest_revision from live),repeat('C',43),
 '[{"columnIndex":0,"field":"sample"},{"columnIndex":3,"field":"genotype"}]',
 'nonce-capability-decide',true)->>'status','resolved','mapping resolution retains its definer nonce write');
select throws_ok($$select public.sign_embryo_artifact_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 'cohort_draft',(select draft_id from draft),'consent.upload-embryo',1,
 private.embryo_statement_keys_v1('consent.upload-embryo','parent'),decode('01','hex'),'GB',
 'nonce-capability-ended-draft')$$,'42501','draft unavailable','a finalized draft still refuses a fresh nonce');
select ok(not exists(select 1 from public.embryo_operation_nonces where
 nonce_hash=encode(extensions.digest('nonce-capability-ended-draft','sha256'),'hex')),
 'the failed target check rolls back its early nonce consumption');

create temporary table adult_inv as select * from public.create_adult_subject_invitation_v1(
 '7a000000-0000-0000-0000-000000000001',decode('ffeeddccbbaa99887766554433221100','hex'),
 repeat('e',64),repeat('5',64),true);
create temporary table adult_delivery as select * from public.claim_mail_outbox();
select is((select target_id from public.token_candidates where id=(select candidate_id
 from public.token_hashes where token_hash=encode(extensions.digest(
 (select delivery_token from adult_delivery),'sha256'),'hex'))),
 (select invitation_id from adult_inv),'the service claim names this exact adult invitation');
select is((select count(*) from public.activate_rights_session_v1(
 encode(extensions.digest((select delivery_token from adult_delivery),'sha256'),'hex'),repeat('5',64),
 'nonce-capability-adult-activate')),1::bigint,'the service adult activation still creates a rights session');
select is(public.respond_adult_subject_invitation_session_v1(
 repeat('5',64),'refuse','nonce-capability-adult-respond'),'refused',
 'the accountless adult response retains its definer nonce write');


select is((select jsonb_array_length(cards) from public.deliver_embryo_record_key_cards_v1(
 '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
 (select cohort_id from live),'nonce-capability-cards')),3,'the service card RPC retains nonce access');
select lives_ok($$select public.grant_cohort_purpose_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select cohort_id from live),'consent.upload-embryo',1,
 private.embryo_statement_keys_v1('consent.upload-embryo','grant'),decode('01','hex'),'GB',
 'nonce-capability-purpose')$$,'the service purpose RPC retains nonce access');
select is(public.record_embryo_disposition_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select id from public.embryos where cohort_id=(select cohort_id from live) and sample_ordinal=0),
 'propose','stored',null,'nonce-capability-disposition')->>'status','awaiting_other_parent',
 'the service disposition RPC retains nonce access');
select lives_ok($$select public.restrict_embryo_cohort_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select cohort_id from live),'nonce-capability-restrict')$$,'the service restriction RPC retains nonce access');


reset role;
select * from finish();
rollback;
