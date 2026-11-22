-- api.consent-reaffirm (20261016205000_consent_reaffirm.sql; owner decision
-- 2026-10-22, "Reaffirmation"). Synthetic accounts and rows only. Everything
-- rolls back.
--
-- Proves that:
--   * nothing is offered while the signed text is still current;
--   * once the text is superseded by a current version of the same key, an
--     own-subject self grant and an adult directional grant are each re-run
--     through the grant function that wrote them, and the successor pair
--     carries one identical grant revision, the prior one plus one, while the
--     prior pair is superseded in the same transaction;
--   * a stale, tampered, foreign, replayed or already reaffirmed request,
--     an artifact signature (the donor-attribution case) and an expired
--     presentation write nothing;
--   * only the service role reaches either function.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('77100000-0000-4000-8000-000000000001','reaffirm-one@e2e.local','{"display_name":"Synthetic reaffirm one"}'),
 ('77100000-0000-4000-8000-000000000002','reaffirm-two@e2e.local','{"display_name":"Synthetic reaffirm two"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('77100000-0000-4000-8000-000000000010','77100000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('77100000-0000-4000-8000-000000000020','77100000-0000-4000-8000-000000000002',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id::text like '77100000-%';

create temporary table fx as select
 '77100000-0000-4000-8000-000000000001'::uuid one, '77100000-0000-4000-8000-000000000010'::uuid one_session,
 '77100000-0000-4000-8000-000000000002'::uuid two, '77100000-0000-4000-8000-000000000020'::uuid two_session,
 (select id from public.subjects where subject_account_id='77100000-0000-4000-8000-000000000001' and subject_class='self') one_subject,
 (select id from public.subject_principals where account_id='77100000-0000-4000-8000-000000000002'
   and principal_kind='account_subject' and status='active' order by created_at limit 1) two_principal;
grant select on fx to service_role;
select ok((select one_subject is not null and two_principal is not null from fx),'fixture: a self record and a recipient principal exist');

-- The own upload consents the own-report authority needs.
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),one,one_session,'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from fx, unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1(one,one_session,one_subject,'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64)) from fx;
select public.sign_own_upload_artifact_v1(one,one_session,one_subject,'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64)) from fx;

create function pg_temp.current(p_key text) returns public.consent_artifacts language sql as $$
 select * from public.consent_artifacts where artifact_key=p_key and superseded_at is null $$;
create function pg_temp.publish_next(p_key text) returns void language sql as $$
 select private.publish_consent_artifact_v1(p_key,(pg_temp.current(p_key)).version,(pg_temp.current(p_key)).body_sha256,
  (pg_temp.current(p_key)).version+1,'Synthetic next body of '||p_key||'.','Synthetic summary.',current_date,
  'Synthetic changed body.') $$;
create function pg_temp.offer(p_grant uuid,p_account uuid default '77100000-0000-4000-8000-000000000001',
 p_session uuid default '77100000-0000-4000-8000-000000000010') returns jsonb language sql as $$
 select public.consent_reaffirm_offer_v1(p_account,p_session,p_grant) $$;
create function pg_temp.reaffirm(p_grant uuid,p_offer jsonb,p_nonce text,
 p_account uuid default '77100000-0000-4000-8000-000000000001',
 p_session uuid default '77100000-0000-4000-8000-000000000010',
 p_expires timestamptz default clock_timestamp()+interval '9 minutes') returns jsonb language sql as $$
 select public.reaffirm_purpose_grant_v1(p_account,p_session,p_grant,p_offer,p_nonce,p_expires,false) $$;
create function pg_temp.live(p_purpose text) returns bigint language sql as $$
 select count(*) from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 where pg.target_id=(select one_subject from fx) and pg.purpose=p_purpose and pg.revoked_at is null and dg.status='current' $$;

-- 0. Admission ------------------------------------------------------------------
select ok(has_function_privilege('service_role','public.reaffirm_purpose_grant_v1(uuid,uuid,uuid,jsonb,text,timestamptz,boolean)','execute')
 and not has_function_privilege('authenticated','public.reaffirm_purpose_grant_v1(uuid,uuid,uuid,jsonb,text,timestamptz,boolean)','execute')
 and not has_function_privilege('anon','public.reaffirm_purpose_grant_v1(uuid,uuid,uuid,jsonb,text,timestamptz,boolean)','execute')
 and not has_function_privilege('inherit_upload_only','public.reaffirm_purpose_grant_v1(uuid,uuid,uuid,jsonb,text,timestamptz,boolean)','execute'),
 'only the service role reaches the reaffirm door');
select ok(has_function_privilege('service_role','public.consent_reaffirm_offer_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.consent_reaffirm_offer_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.consent_reaffirm_offer_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.consent_reaffirm_offer_v1(uuid,uuid,uuid)','execute'),
 'only the service role reads an offer, and only through its public wrapper');
select throws_ok($$select public.consent_reaffirm_offer_v1((select one from fx),(select one_session from fx),gen_random_uuid())$$,
 '42501','not_found','the offer wrapper refuses a caller that is not the service role');

-- 1. An own-subject self grant ---------------------------------------------------
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table own_grant as select (public.grant_own_report_purpose_v1(one,one_session,one_subject,
 public.own_report_context_v1(one,one_session,one_subject),'reports.monogenic',(pg_temp.current('consent.own-monogenic')).version,
 (pg_temp.current('consent.own-monogenic')).body_sha256,repeat('c',64),clock_timestamp()+interval '9 minutes')->>'recordId')::uuid id
 from fx;
select is(pg_temp.live('reports.monogenic'),1::bigint,'fixture: one own monogenic grant is current');
select is(pg_temp.offer((select id from own_grant)),null,'nothing is offered while the signed text is current');
select throws_ok($$select pg_temp.reaffirm((select id from own_grant),'{}'::jsonb,'reaffirm-nonce-own-00000001')$$,
 '42501','not_found','with nothing offered the door refuses');

select pg_temp.publish_next('consent.own-monogenic');
create temporary table own_offer as select pg_temp.offer((select id from own_grant)) o;
select is((select o->>'kind' from own_offer),'own-report','once superseded, an own-report reaffirmation is offered');
select ok((select o->>'grantFunction'='grant_own_report_purpose_v1' and (o->>'priorRevision')::bigint=1
  and (o->>'artifactVersion')::integer=(pg_temp.current('consent.own-monogenic')).version
  and o->>'artifactBodySha256'=(pg_temp.current('consent.own-monogenic')).body_sha256
  and o->'statementKeys'='["make-this-result-for-me"]'::jsonb and o->>'direction'='self'
  and o->'context'=public.own_report_context_v1((select one from fx),(select one_session from fx),(select one_subject from fx))
 from own_offer),'the offer names the grant function, revision, current text, published statements and context');
select is(pg_temp.offer((select id from own_grant),(select two from fx),(select two_session from fx)),null,
 'another account is offered nothing for this grant');
select is(pg_temp.offer((select id from own_grant),(select one from fx),(select two_session from fx)),null,
 'another session is offered nothing');

select throws_ok($$select pg_temp.reaffirm((select id from own_grant),(select o||'{"artifactVersion":2}' from own_offer),
 'reaffirm-nonce-own-00000002')$$,'42501','not_found','a tampered offer writes nothing');
select throws_ok($$select pg_temp.reaffirm((select id from own_grant),(select o from own_offer),'reaffirm-nonce-own-00000003',
 (select two from fx),(select two_session from fx))$$,'42501','not_found','another account cannot reaffirm it');
select throws_ok($$select pg_temp.reaffirm((select id from own_grant),(select o from own_offer),'reaffirm-nonce-own-00000004',
 p_expires=>clock_timestamp()+interval '11 minutes')$$,'22023','invalid_request','a presentation may live at most ten minutes');
select throws_ok($$select pg_temp.reaffirm((select id from own_grant),(select o from own_offer),'short')$$,
 '22023','invalid_request','a malformed nonce is refused');
select ok((select pg.revoked_at is null and dg.status='current' and pg.grant_revision=1 from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id where pg.grant_id=(select id from own_grant)),
 'every refusal left the prior pair current and unchanged');

-- G5.6 (20261023130000, owner decision of 23 October 2026): the
-- reaffirmation's own transaction proves who acted. The grant function it
-- re-runs records the presentation's single-use nonce in purpose_grant_nonces
-- for the account, and that insert names the account. The actor is
-- transaction-local, so it is cleared here where production would have
-- committed, and no user JWT is present.
savepoint unproven_reaffirm;
drop trigger legal_audit_actor_on_consume on public.purpose_grant_nonces;
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('inherit.legal_audit_actor','',true);
select pg_temp.reaffirm((select id from own_grant),(select o from own_offer),'reaffirm-nonce-own-00000005');
select is((select audit_principal_id from public.legal_audit_log where event_code='purpose.reaffirmed' and route_id='api.consent-reaffirm' order by seq desc limit 1),null::uuid,
 'planted: a reaffirmation whose nonce names no account records no one');
rollback to unproven_reaffirm;
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('inherit.legal_audit_actor','',true);
create temporary table own_receipt as select pg_temp.reaffirm((select id from own_grant),(select o from own_offer),
 'reaffirm-nonce-own-00000005') r;
select ok(coalesce((select audit_principal_id from public.legal_audit_log where event_code='purpose.reaffirmed' and route_id='api.consent-reaffirm' order by seq desc limit 1)
  =(select audit_principal_id from private.legal_audit_account_principals where account_id=(select one from fx)),false),'the reaffirmation names the account that reaffirmed');
select ok((select r->>'recordKind'='purpose_grant' and r->>'purposeKey'='reports.monogenic'
  and (r->>'artifactVersion')::integer=(pg_temp.current('consent.own-monogenic')).version
  and r->>'artifactKey'='consent.own-monogenic' and (r->>'recordId')::uuid<>(select id from own_grant) from own_receipt),
 'the reaffirmation answers consent-recorded-v1 for a new pair under the current text');
select ok((select pg.grant_revision=2 and dg.grant_revision=2 and dg.status='current' and pg.revoked_at is null
  and dg.direction='self' and pg.signer_principal_id=(select (o->>'signerPrincipalId')::uuid from own_offer)
  from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
  where pg.grant_id=(select (r->>'recordId')::uuid from own_receipt)),
 'the new pair carries one identical grant revision, the prior one plus one');
select ok((select pg.revocation_reason='superseded' and dg.status='superseded' from public.purpose_grants pg
 join public.directional_grants dg on dg.grant_id=pg.grant_id where pg.grant_id=(select id from own_grant)),
 'the prior pair is superseded, not revoked');
select is(pg_temp.live('reports.monogenic'),1::bigint,'exactly one monogenic pair is current');
select ok((select cs.artifact_version=(pg_temp.current('consent.own-monogenic')).version
  and cs.statement_keys=array['make-this-result-for-me'] and cs.signer_account_id=(select one from fx)
 from public.purpose_grants pg join public.consent_signatures cs on cs.id=pg.signature_id
 where pg.grant_id=(select (r->>'recordId')::uuid from own_receipt)),'a fresh signature of the current text was written');
select is((select count(*) from public.legal_audit_log where event_code='purpose.reaffirmed'
  and route_id='api.consent-reaffirm'),1::bigint,'one reaffirmation audit event');
select throws_ok($$select pg_temp.reaffirm((select id from own_grant),(select o from own_offer),'reaffirm-nonce-own-00000006')$$,
 '42501','not_found','the superseded prior row cannot be reaffirmed again');
select is(pg_temp.offer((select (r->>'recordId')::uuid from own_receipt)),null,'the new pair under current text is offered nothing');
select throws_ok($$select pg_temp.reaffirm((select (cs.id) from public.purpose_grants pg join public.consent_signatures cs
 on cs.id=pg.signature_id where pg.grant_id=(select (r->>'recordId')::uuid from own_receipt)),'{}'::jsonb,'reaffirm-nonce-sig-00000001')$$,
 '42501','not_found','an artifact signature id (the donor-attribution case) is not a reaffirmable purpose grant');

-- 2. An adult directional grant ------------------------------------------------------
create temporary table dir_grant as select public.grant_directional_purpose_v1(one,one_subject,two_principal,'raw.browse',
 'consent.share-with-adult',(pg_temp.current('consent.share-with-adult')).version,'directional-present-0000001') id from fx;
select is(pg_temp.live('raw.browse'),1::bigint,'fixture: one directional grant to another adult is current');
select is(pg_temp.offer((select id from dir_grant)),null,'nothing is offered while consent.share-with-adult is current');
select pg_temp.publish_next('consent.share-with-adult');
create temporary table dir_offer as select pg_temp.offer((select id from dir_grant)) o;
select ok((select o->>'kind'='family' and o->>'grantFunction'='grant_directional_purpose_v1'
  and o->>'direction'='subject_to_recipient' and (o->>'recipientPrincipalId')::uuid=(select two_principal from fx)
  and (o->>'recipientAccountId')::uuid=(select two from fx) and o->'statementKeys'=
   '["one-purpose","one-named-adult","own-account","pause-or-stop-any-time"]'::jsonb from dir_offer),
 'the directional offer re-runs the function api.consents dispatches it to, for the same recipient');
select is(pg_temp.offer((select id from dir_grant),(select two from fx),(select two_session from fx)),null,
 'the recipient is offered nothing for a grant they did not sign');
select throws_ok($$select pg_temp.reaffirm((select id from dir_grant),(select o from dir_offer),'reaffirm-nonce-dir-00000004',
 (select two from fx),(select two_session from fx))$$,'42501','not_found','the recipient cannot reaffirm it');
select throws_ok($$select pg_temp.reaffirm((select id from dir_grant),(select o||'{"recipientAccountId":null}' from dir_offer),
 'reaffirm-nonce-dir-00000001')$$,'42501','not_found','a cross-recipient offer writes nothing');
select throws_ok($$select pg_temp.reaffirm((select id from dir_grant),(select o from dir_offer),'reaffirm-nonce-dir-00000003',
 p_expires=>clock_timestamp()+interval '11 minutes')$$,'22023','invalid_request',
 'the ten-minute ceiling holds for a grant function that takes no expiry of its own');
create temporary table dir_receipt as select pg_temp.reaffirm((select id from dir_grant),(select o from dir_offer),
 'reaffirm-nonce-dir-00000002') r;
select ok((select pg.grant_revision=2 and dg.grant_revision=2 and dg.status='current'
  and dg.recipient_principal_id=(select two_principal from fx) and dg.recipient_account_id=(select two from fx)
  and dg.relationship_id=(select (o->>'relationshipId')::uuid from dir_offer)
  and dg.relationship_or_pair_revision=(select (o->>'relationshipOrPairRevision')::bigint from dir_offer)
  and pg.artifact_version=(pg_temp.current('consent.share-with-adult')).version
 from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 where pg.grant_id=(select (r->>'recordId')::uuid from dir_receipt)),
 'the directional successor keeps its recipient and relationship and carries revision 2');
select ok((select dg.status='superseded' from public.directional_grants dg where dg.grant_id=(select id from dir_grant)),
 'the prior directional pair is superseded');
select is(pg_temp.live('raw.browse'),1::bigint,'exactly one directional pair is current');
select throws_ok($$select pg_temp.reaffirm((select (r->>'recordId')::uuid from dir_receipt),(select o from dir_offer),
 'reaffirm-nonce-dir-00000002')$$,'42501','not_found','the new pair is not reaffirmable');

-- 3. A replayed presentation nonce -------------------------------------------------------
create temporary table own_grant2 as select (public.grant_own_report_purpose_v1(one,one_session,one_subject,
 public.own_report_context_v1(one,one_session,one_subject),'reports.polygenic',(pg_temp.current('consent.own-polygenic')).version,
 (pg_temp.current('consent.own-polygenic')).body_sha256,repeat('d',64),clock_timestamp()+interval '9 minutes')->>'recordId')::uuid id
 from fx;
select pg_temp.publish_next('consent.own-polygenic');
select throws_ok($$select pg_temp.reaffirm((select id from own_grant2),pg_temp.offer((select id from own_grant2)),
 'reaffirm-nonce-own-00000005')$$,'23505',null,'a presentation nonce reaffirms at most once');
select is(pg_temp.live('reports.polygenic'),1::bigint,'... and the refused replay left the prior pair current');

select * from finish();
rollback;
