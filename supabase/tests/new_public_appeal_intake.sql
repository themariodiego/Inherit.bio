begin;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/future_person_deletion_authority.inc
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.prepare_new_public_appeal_v1('subject-objection',repeat('a',64),repeat('b',64),
 jsonb_build_object('1',repeat('c',64)),jsonb_build_object('1',repeat('d',64)),jsonb_build_object('1',repeat('e',64))),
 null::jsonb,'native intake remains closed before quota/principal/case work');
select is((select count(*) from private.new_public_appeal_intakes),0::bigint,'closed preparation creates no private case');
select ok(has_function_privilege('service_role','public.prepare_new_public_appeal_v1(text,text,text,jsonb,jsonb,jsonb)','execute')
 and not has_function_privilege('anon','public.prepare_new_public_appeal_v1(text,text,text,jsonb,jsonb,jsonb)','execute')
 and not has_function_privilege('authenticated','public.commit_new_public_appeal_v1(jsonb,text,text,bytea,bytea,bytea,bytea,jsonb)','execute'),
 'only the actual server route can prepare and commit; a public browser has no native RPC grant');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
 where has_table_privilege(role_name,'private.new_public_appeal_intakes','select,insert,update,delete')
 or has_table_privilege(role_name,'private.new_public_appeal_reviewers','insert,update,delete')
 or has_function_privilege(role_name,'private.shred_new_public_appeal_v1(uuid)','execute')),0::bigint,
 'API roles cannot forge a case/reviewer/key or dispose foreign evidence');
update private.new_public_appeal_config set enabled=true where singleton;
insert into public.subject_principals(id,account_id,principal_kind) values
 ('86000000-0000-4000-8000-000000000001','7a000000-0000-0000-0000-000000000001','reviewer');
insert into private.new_public_appeal_reviewers(principal_id,principal_revision,purpose_revision) values
 ('86000000-0000-4000-8000-000000000001',1,1);
create temporary table public_appeal_prepared as select public.prepare_new_public_appeal_v1('subject-objection',
 repeat('a',64),repeat('b',64),jsonb_build_object('1',repeat('c',64)),jsonb_build_object('1',repeat('d',64)),
 jsonb_build_object('1',repeat('e',64)))value;
select ok((select value is not null from public_appeal_prepared),'real preparation binds a named active reviewer and complete frame');
select is((select (value#>>'{frame,scope,originalDeadline}')::timestamptz
 -(value#>>'{frame,scope,originalSubmittedAt}')::timestamptz from public_appeal_prepared),interval '30 days',
 'retry/reassignment cannot renew the original submission clock');
select ok(not exists(select 1 from public.subject_principals actor where actor.id=
 (select (value#>>'{frame,scope,originalAuthorPrincipalId}')::uuid from public_appeal_prepared)),
 'preparation reserves a random ID without manufacturing any principal or account');
create temporary table public_appeal_quota as select jsonb_build_object('1',jsonb_build_object(
 'normalized-identifier',repeat('d',64),'source-network',repeat('e',64),'global-capacity',
 encode(extensions.digest(convert_to('api.subject-access-request|global-capacity','UTF8'),'sha256'),'hex')))value;
select throws_ok($$select public.commit_new_public_appeal_v1((select value||'{"accountId":"foreign"}'::jsonb
 from public_appeal_prepared),repeat('a',64),repeat('b',64),decode(repeat('ab',72),'hex'),decode(repeat('bc',48),'hex'),
 decode(repeat('cd',48),'hex'),decode(repeat('de',48),'hex'),(select value from public_appeal_quota))$$,
 '42501','not_found','an account/target field cannot be added to the complete native preparation');
select throws_ok($$select public.commit_new_public_appeal_v1((select value from public_appeal_prepared),
 repeat('f',64),repeat('b',64),decode(repeat('ab',72),'hex'),decode(repeat('bc',48),'hex'),decode(repeat('cd',48),'hex'),
 decode(repeat('de',48),'hex'),(select value from public_appeal_quota))$$,
 '42501','not_found','a different original request cannot borrow the signature/nonce');
select throws_ok($$select pg_temp.deletion_probe('update private.new_public_appeal_reviewers set active=false',
 'select public.commit_new_public_appeal_v1((select value from public_appeal_prepared),repeat(''a'',64),repeat(''b'',64),
 decode(repeat(''ab'',72),''hex''),decode(repeat(''bc'',48),''hex''),decode(repeat(''cd'',48),''hex''),decode(repeat(''de'',48),''hex''),
 (select value from public_appeal_quota))')$$,'42501','not_found','current reviewer revocation refuses before case writes');
select is(public.commit_new_public_appeal_v1((select value from public_appeal_prepared),repeat('a',64),repeat('b',64),
 decode(repeat('ab',72),'hex'),decode(repeat('bc',48),'hex'),decode(repeat('cd',48),'hex'),decode(repeat('de',48),'hex'),
 (select value from public_appeal_quota)),true,'actual complete case/contact/candidate inserts commit atomically');
select ok((select actor.principal_kind='case_requester' and actor.account_id is null and actor.subject_id is null
 from public.subject_principals actor where actor.id=(select (value#>>'{frame,scope,originalAuthorPrincipalId}')::uuid
 from public_appeal_prepared)),'the principal is genuinely case-only and never contact-resolved to an account');
select ok((select appeal.target_kind='public_case' and appeal.target_id=appeal.id and appeal.appellant_account_id is null
 from public.appeal_intakes appeal where appeal.id=(select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared)),
 'no source subject/claim/cohort authority or target hold was fabricated');
select is((select count(*) from public.mail_outbox mail join public.token_candidates candidate on candidate.outbox_id=mail.id
 where mail.purpose='appeal-evidence' and candidate.purpose='appeal-evidence' and candidate.state='pending'),1::bigint,
 'the same commit created exactly one non-authorizing delivery candidate');
select ok((select candidate.expires_at=least(intake.deadline,intake.submitted_at+interval '7 days')
 and mail.expires_at=candidate.expires_at and intake.deadline=intake.submitted_at+interval '30 days'
 from private.new_public_appeal_intakes intake join public.mail_outbox mail on mail.id=intake.outbox_id
 join public.token_candidates candidate on candidate.id=intake.candidate_id
 where intake.id=(select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared)),
 'the evidence credential and delivery end at7days while the original case deadline stays30days');
select throws_ok($$select public.commit_new_public_appeal_v1((select value from public_appeal_prepared),repeat('a',64),repeat('b',64),
 decode(repeat('ab',72),'hex'),decode(repeat('bc',48),'hex'),decode(repeat('cd',48),'hex'),decode(repeat('de',48),'hex'),
 (select value from public_appeal_quota))$$,'42501','not_found','a repeated completion cannot rewrite/adopt the original case');
select throws_ok($$update public.subject_principals set account_id='7a000000-0000-0000-0000-000000000001'
 where principal_kind='case_requester'$$,'42501','not_found','no later account adoption of the random case principal');
select throws_ok($$update private.new_public_appeal_intakes set deadline=deadline+interval '1 day'$$,
 '42501','not_found','native clock cannot be extended');
select throws_ok($$update public.appeal_intakes set statement_ciphertext=decode(repeat('ff',48),'hex')
 where target_kind='public_case'$$,'42501','not_found','the stored original statement cannot be silently rewritten');
-- Synthetic ciphertext has shape only: this native test does not claim real
-- cryptography/provider acceptance. The separate library test seals/opens it.
create temporary table public_appeal_claim as select * from public.claim_mail_outbox();
select is((select count(*) from public_appeal_claim),1::bigint,'dedicated worker claims one exact candidate');
select is(length((select delivery_token from public_appeal_claim)),43,'native claim returns only a fresh one-use fragment candidate');
select ok(public.authorize_mail_submission_v1((select outbox_id from public_appeal_claim),
 (select attempt_ordinal from public_appeal_claim)),'fresh exact current source permits submission only');
select is((select intake.deadline-candidate.expires_at from private.new_public_appeal_intakes intake
 join public.token_candidates candidate on candidate.id=intake.candidate_id where intake.id=
 (select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared)),interval '23 days',
 'native token issuance never changes the original case clock');
-- Synthetic expired-mail metadata preserves the original case/candidate clocks.
select is(pg_temp.deletion_probe('update public.mail_outbox set created_at=clock_timestamp()-interval ''2 seconds'',not_before=clock_timestamp()-interval ''2 seconds'',expires_at=clock_timestamp()-interval ''1 second'' where id=(select outbox_id from public_appeal_claim)',
 'select public.authorize_mail_submission_v1((select outbox_id from public_appeal_claim),(select attempt_ordinal from public_appeal_claim))'),
 'false','expired credential delivery refuses even while the case deadline remains open');
select is((public.read_new_public_appeal_mail_contact_v1((select outbox_id from public_appeal_claim),
 (select attempt_ordinal from public_appeal_claim))->>'contactCiphertextHex'),repeat('de',48),
 'dedicated reader returns only actual bound ciphertext and original wrapped key/scope');
-- A separately declared owner fixture is already due. It is not an intake
-- producer/provider proof and does not bypass any immutable UPDATE guard.
-- Starting in submitted (rather than terminal) exercises the drainer ordering.
create temporary table public_appeal_expired_clock as
 select date_trunc('milliseconds',clock_timestamp())-interval '31 days' submitted;
insert into public.subject_principals(id,principal_kind) values
 ('86000000-0000-4000-8000-000000000011','case_requester');
insert into public.appeal_intakes
 select (jsonb_populate_record(null::public.appeal_intakes,to_jsonb(appeal)||jsonb_build_object(
 'id','86000000-0000-4000-8000-000000000010','target_id','86000000-0000-4000-8000-000000000010',
 'appellant_principal_id','86000000-0000-4000-8000-000000000011','submitted_at',original_clock.submitted))).*
 from public.appeal_intakes appeal cross join public_appeal_expired_clock original_clock where appeal.id=(select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared);
insert into private.new_public_appeal_intakes
 select (jsonb_populate_record(null::private.new_public_appeal_intakes,to_jsonb(intake)||jsonb_build_object(
 'id','86000000-0000-4000-8000-000000000010','author_principal_id','86000000-0000-4000-8000-000000000011',
 'form_nonce_hash',repeat('9',64),'submitted_at',original_clock.submitted,
 'prepare_expires_at',original_clock.submitted+interval '10 minutes','deadline',original_clock.submitted+interval '30 days',
 'case_contact_id','86000000-0000-4000-8000-000000000012','outbox_id','86000000-0000-4000-8000-000000000013',
 'candidate_id','86000000-0000-4000-8000-000000000014'))).*
 from private.new_public_appeal_intakes intake cross join public_appeal_expired_clock original_clock
 where intake.id=(select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared);
select is(public.drain_due_new_public_appeals_v1(),'{"completed":1,"shredded":1,"held":0}'::jsonb,
 'a due committed case first expires then shreds without a ciphertext guard failure');
select ok((select state='expired' and decided_at is not null and octet_length(statement_ciphertext)=0
 from public.appeal_intakes where id='86000000-0000-4000-8000-000000000010'),
 'expiry is terminal and blanks the original statement in the same transaction');
select ok((select state='closed' and frame is null and wrapped_case_key is null and working_ciphertext is null
 and case_contact_id is null and outbox_id is null and candidate_id is null from private.new_public_appeal_intakes
 where id='86000000-0000-4000-8000-000000000010'),
 'the expiry path disposes every locally held key and private delivery binding');
select ok(public.authorize_mail_submission_v1((select outbox_id from public_appeal_claim),
 (select attempt_ordinal from public_appeal_claim)),
 'an unrelated due case cannot revoke the genuine current case mail authority');
update public.appeal_intakes set state='withdrawn',decided_at=clock_timestamp()
 where id=(select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared);
select ok((select state='closed' and frame is null and wrapped_case_key is null and working_ciphertext is null
 and case_contact_id is null and outbox_id is null and candidate_id is null from private.new_public_appeal_intakes
 where id=(select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared)),
 'terminal disposition shreds the key and deletes contact/request/delivery bindings');
select is((select count(*) from public.mail_outbox where purpose='appeal-evidence'),0::bigint,
 'local outbox, token, contact and delivery copies are deleted; no remote purge ACK is inferred');
select is(octet_length((select statement_ciphertext from public.appeal_intakes
 where id=(select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared))),0,
 'only the coded kind/outcome/timestamps/principal reference remains');
select is(public.prepare_new_public_appeal_v1('subject-objection',repeat('a',64),repeat('b',64),
 jsonb_build_object('1',repeat('c',64)),jsonb_build_object('1',repeat('d',64)),jsonb_build_object('1',repeat('e',64))),
 null::jsonb,'a just-closed case does not unspend its still-live form nonce');
select finish();
rollback;
