begin;
set local search_path=public,extensions;
select no_plan();
select ok(has_function_privilege('service_role','public.prepare_new_correction_v1(text,text,text)','execute')
 and not has_function_privilege('authenticated','public.prepare_new_correction_v1(text,text,text)','execute')
 and not has_function_privilege('anon','public.prepare_new_correction_v1(text,text,text)','execute')
 and not has_function_privilege('inherit_upload_only','public.prepare_new_correction_v1(text,text,text)','execute'),
 'only the actual service route reaches preparation');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r
 where has_table_privilege(r,'private.new_correction_intakes','select,insert,update,delete')
 or has_function_privilege(r,'private.register_account_requester_statement_v1(text,uuid,jsonb,jsonb)','execute')),0::bigint,
 'API roles cannot fabricate a private case or original envelope registration');
\ir fixtures/future_person_deletion_authority.inc
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.prepare_new_correction_v1(pg_temp.h('deletion-rights'),'new-correction-closed-aaaaaaaa','display-label')$$,
 '42501','not_found','the native switch remains closed before any reservation');
update private.new_correction_intake_config set enabled=true where singleton;
insert into public.subject_principals(id,account_id,principal_kind) values
 ('84000000-0000-4000-8000-000000000001','7a000000-0000-0000-0000-000000000001','reviewer');
insert into private.new_correction_reviewers(principal_id,principal_revision,purpose_revision) values
 ('84000000-0000-4000-8000-000000000001',1,1);
select throws_ok($$select public.prepare_new_correction_v1(repeat('f',64),'new-correction-foreign-aaaaaaaa','display-label')$$,
 '42501','not_found','a nonexistent claimant session cannot borrow a current source');
select throws_ok($$select public.prepare_new_correction_v1(pg_temp.h('deletion-rights'),'new-correction-field-aaaaaaaa','reviewer-note')$$,
 '42501','not_found','reviewer prose cannot enter the own-statement producer');
create temporary table new_correction_frame as select public.prepare_new_correction_v1(
 pg_temp.h('deletion-rights'),'new-correction-own-aaaaaaaa','display-label')value;
select is((select (value#>>'{scope,originalDeadline}')::timestamptz-(value#>>'{scope,originalSubmittedAt}')::timestamptz
 from new_correction_frame),interval '30 days','native original clocks fix the exact thirty-day boundary');
select is((select value#>>'{scope,originalAuthorPrincipalId}' from new_correction_frame),
 (private.future_person_rights_session_v1(pg_temp.h('deletion-rights'),false)).principal_id::text,
 'the original author is the native claimant, not an address-resolved account');
select ok((select value#>>'{scope,originalSubjectId}' from new_correction_frame)=(select subject::text from custody_ids),
 'current native target scope is retained');
select throws_ok($$select public.read_new_correction_intake_contact_v1(pg_temp.h('deletion-rights'),
 'new-correction-own-aaaaaaaa',(select value||jsonb_build_object('sourceContactReferenceId',gen_random_uuid()) from new_correction_frame))$$,
 '42501','not_found','a substituted source contact is not selected');
select throws_ok($$select public.read_new_correction_intake_contact_v1(pg_temp.h('deletion-rights'),
 'new-correction-other-aaaaaaaa',(select value from new_correction_frame))$$,
 '42501','not_found','a foreign nonce does not adopt the preparation');
select throws_ok($$update private.new_correction_intakes set deadline=deadline+interval '1 day'$$,
 '42501','not_found','retry or owner update cannot extend the stored original clock');
select throws_ok($$select pg_temp.deletion_probe(
 'update private.new_correction_reviewers set active=false',
 'select public.read_new_correction_intake_contact_v1(pg_temp.h(''deletion-rights''),''new-correction-own-aaaaaaaa'',(select value from new_correction_frame))')$$,
 '42501','not_found','revoked reviewer purpose refuses before reading original ciphertext');
create temporary table new_correction_contact as select public.read_new_correction_intake_contact_v1(
 pg_temp.h('deletion-rights'),'new-correction-own-aaaaaaaa',(select value from new_correction_frame))value;
select is((select encode(extensions.digest(decode(value->>'sourceContactCiphertextHex','hex'),'sha256'),'hex')
 from new_correction_contact),(select value->>'sourceContactFingerprint' from new_correction_frame),
 'the selected ciphertext is exactly the native-source fingerprint');
select throws_ok($$select public.commit_new_correction_v1(pg_temp.h('deletion-rights'),'new-correction-own-aaaaaaaa',
 (select value from new_correction_frame),decode(repeat('ab',48),'hex'),decode(repeat('cd',48),'hex'),
 decode(repeat('de',72),'hex'),decode(repeat('ef',48),'hex'),jsonb_build_object('1',repeat('f',64)))$$,
 '42501','not_found','a different contact digest cannot install the case contact or consume a nonce');
create temporary table new_correction_receipt as select public.commit_new_correction_v1(
 pg_temp.h('deletion-rights'),'new-correction-own-aaaaaaaa',(select value from new_correction_frame),
 decode(repeat('ab',48),'hex'),decode(repeat('cd',48),'hex'),decode(repeat('de',72),'hex'),
 decode(repeat('ef',48),'hex'),jsonb_build_object('1',pg_temp.h('contact')))value;
select is((select value->>'status' from new_correction_receipt),'review_pending','actual insertion does not claim a human decision');
select is((select value->>'correctionId' from new_correction_receipt),(select value#>>'{scope,caseId}' from new_correction_frame),
 'the receipt identifies only the actual created correction');
select is((select count(*) from private.account_requester_statement_capsules c where c.case_kind='correction'
 and c.case_id=(select (value->>'correctionId')::uuid from new_correction_receipt)),1::bigint,
 'the original NEW statement is registered in the actual intake transaction');
select is((select c.envelope->>'statementCiphertextHex' from private.account_requester_statement_capsules c
 where c.case_id=(select (value->>'correctionId')::uuid from new_correction_receipt)),repeat('ab',48),
 'the capsule contains only the original statement bytes');
select ok((select subject_account_id is null from public.subjects where id=(select subject from custody_ids)),
 'claimant intake never creates account ownership from the selected contact');
select throws_ok($$select public.commit_new_correction_v1(pg_temp.h('deletion-rights'),'new-correction-own-aaaaaaaa',
 (select value from new_correction_frame),decode(repeat('ab',48),'hex'),decode(repeat('cd',48),'hex'),
 decode(repeat('de',72),'hex'),decode(repeat('ef',48),'hex'),jsonb_build_object('1',pg_temp.h('contact')))$$,
 '42501','not_found','a repeated commit neither adopts nor rewrites the original envelope');
update public.correction_requests set state='withdrawn',decided_at=clock_timestamp()
 where id=(select (value->>'correctionId')::uuid from new_correction_receipt);
select ok(not exists(select 1 from private.account_requester_statement_capsules where case_id=
 (select (value->>'correctionId')::uuid from new_correction_receipt))
 and not exists(select 1 from public.correction_working_data where correction_id=
 (select (value->>'correctionId')::uuid from new_correction_receipt))
 and (select wrapped_case_key is null and state='closed' from private.new_correction_intakes where id=
 (select (value->>'correctionId')::uuid from new_correction_receipt)),
 'terminal disposition removes the capsule, working data and original NEW key together');
select ok((select contact_ciphertext is null and status='shredded' from public.encrypted_contact_references
 where id=(select (value->>'caseContactId')::uuid from new_correction_frame)),
 'only the independent case contact copy is shredded');
select ok((select contact_ciphertext is not null and status='current' from public.encrypted_contact_references
 where id=(select (value->>'sourceContactReferenceId')::uuid from new_correction_frame)),
 'shared original claimant contact stays intact');
-- A separately declared expired preparation exercises the real drain. It
-- claims no producer/cryptography provenance and contains no case prose.
insert into private.new_correction_intakes(id,rights_session_id,nonce_hash,subject_id,author_principal_id,frame,
 reviewer_principal_id,reviewer_purpose_revision,prepare_expires_at,deadline,state)
select '84000000-0000-4000-8000-000000000010',x.rights_session_id,pg_temp.h('expired-preparation'),x.subject_id,
 x.author_principal_id,x.frame,x.reviewer_principal_id,x.reviewer_purpose_revision,
 clock_timestamp()-interval '1 second',x.deadline,'prepared' from private.new_correction_intakes x
where x.id=(select (value->>'correctionId')::uuid from new_correction_receipt);
select is(public.drain_due_new_corrections_v1(),'{"shredded":1,"completed":1,"held":0}'::jsonb,
 'the database selects and closes only a genuinely due preparation');
select is(public.drain_due_new_corrections_v1(),'{"shredded":0,"completed":0,"held":0}'::jsonb,
 'repeated drain never renews a clock or reclaims completion');
select is(private.future_person_deletion_row_v1('private.new_correction_intakes',
 jsonb_build_object('id',(select value->>'correctionId' from new_correction_receipt)),false),1::bigint,
 'coded intake evidence remains a counted exact physical erasure row');
select is((select count(*) from public.purge_target_stores where target_id='appeal-and-correction-working-packages'
 and store_name='private.new_correction_intakes'),1::bigint,'the new physical row has one registered store');
select finish();
rollback;
