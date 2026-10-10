begin;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/future_person_deletion_authority.inc
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc
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
-- Authoritative producer/issued token above; no real provider delivery or
-- physical scan is claimed by this native transaction test.
create temporary table public_appeal_rights as select * from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select delivery_token from public_appeal_claim),'UTF8'),'sha256'),'hex'),
 repeat('1',64),repeat('A',32));
select is((select purpose from public_appeal_rights),'appeal-evidence','activation has exactly the appeal evidence purpose');
select is((select target_kind from public_appeal_rights),'appeal-case','case credential cannot become subject/cohort/account authority');
select is((select principal.account_id from public.subject_principals principal join public.rights_sessions rights
 on rights.principal_id=principal.id where rights.session_hash=repeat('1',64)),null::uuid,'verified contact never adopts an account');
select is((select count(*) from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select delivery_token from public_appeal_claim),'UTF8'),'sha256'),'hex'),repeat('2',64),repeat('B',32))),0::bigint,
 'the native activation token is consumed once');
-- Final rejection has its own current-case/MFA path. It does not fabricate
-- a complete document set or change the original documentary approval gate.
create function pg_temp.final_case_reviewer_jwt() returns void language sql as $test$
 select set_config('request.jwt.claims',jsonb_build_object('sub','7a000000-0000-0000-0000-000000000001',
 'role','authenticated','session_id','7a000000-0000-4000-8000-0000000000a1','aal','aal2',
 'iss','http://127.0.0.1:54321/auth/v1','aud','authenticated','exp',extract(epoch from clock_timestamp())::bigint+3600,
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())::bigint-60)))::text,true);
$test$;
create function pg_temp.final_case_rejection_probe() returns boolean language plpgsql as $test$
declare v_case uuid; context jsonb; result jsonb; target_before jsonb; ok boolean:=false;
begin
 begin
  select (value#>>'{frame,scope,caseId}')::uuid into v_case from public_appeal_prepared;
  select jsonb_build_object('subjects',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.subjects s),
   'cohorts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.embryo_cohorts c)) into target_before;
  perform pg_temp.final_case_reviewer_jwt();
  context:=public.read_public_appeal_case_context_v1(v_case);
  result:=public.decide_public_appeal_case_v1(v_case,'reject',(context->>'reviewRevision')::bigint,
   (context->>'evidenceRevision')::bigint,repeat('8',64),decode(repeat('ab',48),'hex'));
  ok:=result->>'outcome'='rejected' and result->>'state'='resolved'
   and exists(select 1 from private.new_public_appeal_intakes source where source.id=v_case and source.state='closed'
    and source.wrapped_case_key is null and source.working_ciphertext is null and source.case_contact_id is null)
   and exists(select 1 from private.public_appeal_case_decisions outcome where outcome.case_id=v_case
    and outcome.reason_ciphertext is null and outcome.reviewer_account_id='7a000000-0000-0000-0000-000000000001'
    and outcome.auth_session_id='7a000000-0000-4000-8000-0000000000a1')
   and not exists(select 1 from public.rights_sessions rights where rights.target_kind='appeal-case' and rights.target_id=v_case)
   and not exists(select 1 from private.appeal_document_sessions source where source.intake_id=v_case and source.wrapped_document_key is not null)
   and not exists(select 1 from private.public_appeal_provisional_targets source where source.case_id=v_case)
   and target_before=jsonb_build_object('subjects',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.subjects s),
    'cohorts',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.embryo_cohorts c));
  begin
   perform public.decide_public_appeal_case_v1(v_case,'reject',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,repeat('8',64),decode(repeat('ab',48),'hex'));
   ok:=false;
  exception when insufficient_privilege then null; end;
  raise exception using errcode='PZ001',message='restore synthetic case';
 exception when sqlstate 'PZ001' then null;
 end;
 return ok;
end $test$;
select throws_ok($$select public.read_public_appeal_case_context_v1((select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared))$$,
 '42501','appeal unavailable','service authority cannot read even an incomplete case in place of the named own-MFA reviewer');
select pg_temp.final_case_reviewer_jwt();
select is(jsonb_array_length(public.read_public_appeal_case_context_v1((select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared))->'documents'),0,
 'separate final-case context admits zero documents without fabricating evidence approval');
select throws_ok($$select public.read_public_appeal_review_v1((select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared))$$,
 '42501','appeal unavailable','original complete documentary review still refuses incomplete evidence');
select ok(pg_temp.final_case_rejection_probe(),'own-MFA incomplete rejection is terminal, clears case authority and preserves all target rows');
select is((select count(*) from private.public_appeal_case_decisions),0::bigint,'synthetic rollback preserves the original ongoing case and all final nonce rows');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok((public.new_public_appeal_evidence_view_v1(repeat('1',64))->'documentKinds')=
 '["appeal-photo-identity","appeal-subject-source-control"]'::jsonb,'server case kind selects the exact evidence set');
select throws_ok($$select public.open_public_appeal_document_v1(repeat('1',64),repeat('C',32),'appeal-genetic-parent-authority',
 'application/pdf',20,repeat('a',64),repeat('3',64),decode(repeat('12',72),'hex'))$$,'42501','appeal unavailable',
 'wrong case kind never creates a session or spends its nonce');
select throws_ok($$select public.open_public_appeal_document_v1(repeat('f',64),repeat('C',32),'appeal-photo-identity',
 'application/pdf',20,repeat('a',64),repeat('3',64),decode(repeat('12',72),'hex'))$$,'42501','appeal unavailable',
 'foreign/wrong purpose credential is opaque');
create temporary table appeal_uploaded(id uuid,kind text,cookie text,nonce text,sha text,key_byte text);
do $test$ declare kind text;ordinal integer:=0;opened jsonb;reserved jsonb;plan jsonb;scan jsonb;content text:='%PDF-1.7 synthetic';cookie text;nonce text;sha text;
begin
 for kind in select unnest(array['appeal-photo-identity','appeal-subject-source-control']) loop
  ordinal:=ordinal+1;cookie:=repeat(ordinal::text,64);nonce:=repeat((ordinal+3)::text,64);
  sha:=encode(extensions.digest(convert_to(content,'UTF8'),'sha256'),'hex');
  opened:=public.open_public_appeal_document_v1(repeat('1',64),repeat(chr(67+ordinal),32),kind,'application/pdf',octet_length(content),sha,cookie,
   decode(repeat(lpad(ordinal::text,2,'0'),72),'hex'));
  reserved:=public.reserve_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,octet_length(content),sha);
  if reserved->>'storageKind'<>'appeal' then raise exception 'wrong native storage domain';end if;
  perform public.settle_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,true);
  plan:=public.begin_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,1);
  if plan->>'storageKind'<>'appeal' or plan->>'status'<>'compose' then raise exception 'missing complete source manifest';end if;
  perform public.finish_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,'composed',plan->>'objectKey');
  scan:=public.claim_next_appeal_document_scan_v1(repeat('e',64));
  if scan->>'documentId' is distinct from plan->>'documentId' then raise exception 'wrong scan ownership';end if;
  perform public.record_appeal_document_scan_v1((scan->>'documentId')::uuid,repeat('e',64),'OK',sha,'synthetic native test',1,clock_timestamp());
  insert into appeal_uploaded values((plan->>'documentId')::uuid,kind,cookie,nonce,sha,lpad(ordinal::text,2,'0'));
 end loop;
end $test$;
select is((select count(*) from private.appeal_documents where state='clean' and scanned_sha256=sha256),2::bigint,
 'both exact documents have the complete native positive verdict bound to declared hash');
select throws_ok($$select public.confirm_appeal_document_objects_deleted_v1(
 array[(select object_key from private.appeal_documents limit 1)],'jobs.retention')$$,'42501','appeal document deletion unavailable',
 'an active clean document cannot acquire a fake disposal acknowledgement');
select throws_ok($$select public.complete_new_public_appeal_evidence_v1(repeat('1',64),repeat('Q',32),
 jsonb_build_object('photoIdentityDocumentId',(select id from appeal_uploaded where kind='appeal-photo-identity'),
 'geneticParentAuthorityDocumentId',(select id from appeal_uploaded where kind='appeal-subject-source-control')),true)$$,
 '42501','appeal unavailable','wrong server selected body refuses without assignment');
select throws_ok($$select public.complete_new_public_appeal_evidence_v1(repeat('1',64),repeat('Q',32),
 jsonb_build_object('photoIdentityDocumentId',(select id from appeal_uploaded where kind='appeal-photo-identity'),
 'subjectSourceControlDocumentId',(select id from appeal_uploaded where kind='appeal-photo-identity')),true)$$,
 '42501','appeal unavailable','one document cannot stand for both proof standards');
select is((select count(*) from private.public_appeal_pending_reviews),0::bigint,'invalid completion creates no review assignment');
select throws_ok($$select pg_temp.deletion_probe('update private.new_public_appeal_reviewers set active=false',
 'select public.complete_new_public_appeal_evidence_v1(repeat(''1'',64),repeat(''Q'',32),jsonb_build_object(''photoIdentityDocumentId'',
 (select id from appeal_uploaded where kind=''appeal-photo-identity''),''subjectSourceControlDocumentId'',
 (select id from appeal_uploaded where kind=''appeal-subject-source-control'')),true)')$$,'42501','appeal unavailable',
 'named reviewer revocation refuses completion atomically');
-- A same-revision potential match is never silently downgraded to no-match.
select lives_ok($$select pg_temp.deletion_probe(
 'insert into public.encrypted_contact_references(id,principal_id,contact_ciphertext,contact_hmac,key_revision,authority_revision)
 values(''86000000-0000-4000-8000-000000000101'',''86000000-0000-4000-8000-000000000001'',decode(repeat(''ab'',48),''hex''),repeat(''c'',64),1,1);
 insert into public.contact_hmac_indexes(contact_reference_id,contact_hmac,hmac_key_revision,status,expires_at)
 values(''86000000-0000-4000-8000-000000000101'',repeat(''c'',64),1,''current'',clock_timestamp()+interval ''1 day'')',
 'select public.complete_new_public_appeal_evidence_v1(repeat(''1'',64),repeat(''Q'',32),jsonb_build_object(''photoIdentityDocumentId'',
 (select id from appeal_uploaded where kind=''appeal-photo-identity''),''subjectSourceControlDocumentId'',
 (select id from appeal_uploaded where kind=''appeal-subject-source-control'')),true); do $probe$ begin if (select match_state from private.public_appeal_pending_reviews limit 1)<>''unresolved-potential''
  or exists(select 1 from private.public_appeal_provisional_targets) then raise exception ''unresolved match gained authority'';end if;end $probe$; select true')$$,
 'an unbound potential match remains privately unresolved and creates no target hold or account authority');
-- Real Path B invitation/confirmation supplies the typed target; no account is inferred from contact.
select lives_ok($$select pg_temp.deletion_probe(
 'select pg_temp.requested(''appeal-match'',''a'',repeat(''c'',64));
 select pg_temp.account_confirms(''a'',''synthetic-match-confirm-aaaaaaaa'',''2'',repeat(''c'',64))',
 'select public.complete_new_public_appeal_evidence_v1(repeat(''1'',64),repeat(''Q'',32),jsonb_build_object(''photoIdentityDocumentId'',
 (select id from appeal_uploaded where kind=''appeal-photo-identity''),''subjectSourceControlDocumentId'',
 (select id from appeal_uploaded where kind=''appeal-subject-source-control'')),true);
 do $probe$ begin if not exists(select 1 from private.public_appeal_provisional_targets where target_kind=''subject'' and target_id=pg_temp.sid(''appeal-match''))
 or not private.public_appeal_target_held_v1(''subject'',pg_temp.sid(''appeal-match''))
 or (select match_state from private.public_appeal_pending_reviews limit 1)<>''unique-current''
 or exists(select 1 from private.new_public_appeal_intakes i join public.subject_principals actor on actor.id=i.author_principal_id where actor.account_id is not null)
 then raise exception ''exact current target not held or case adopted an account'';end if;end $probe$; select true')$$,
 'genuine current subject confirmation places only an original-deadline provisional hold without account adoption');
select lives_ok($$select pg_temp.deletion_probe(
 'select pg_temp.requested(''appeal-stale'',''a'',repeat(''c'',64));
 select pg_temp.account_confirms(''a'',''synthetic-stale-confirm-aaaaaaaa'',''2'',repeat(''c'',64));
 update public.subject_principals set principal_revision=principal_revision+1 where subject_id=pg_temp.sid(''appeal-stale'')',
 'select public.complete_new_public_appeal_evidence_v1(repeat(''1'',64),repeat(''Q'',32),jsonb_build_object(''photoIdentityDocumentId'',
 (select id from appeal_uploaded where kind=''appeal-photo-identity''),''subjectSourceControlDocumentId'',
 (select id from appeal_uploaded where kind=''appeal-subject-source-control'')),true);
 do $probe$ begin if exists(select 1 from private.public_appeal_provisional_targets)
 or (select match_state from private.public_appeal_pending_reviews limit 1)<>''unresolved-potential'' then raise exception ''stale match became no-match or hold'';end if;end $probe$; select true')$$,
 'stale contact authority is retained as unresolved and never becomes no-match or a hold');
create temporary table appeal_target_before as select
 (select coalesce(jsonb_agg(to_jsonb(subject) order by subject.id),'[]') from public.subjects subject)subjects,
 (select coalesce(jsonb_agg(to_jsonb(cohort) order by cohort.id),'[]') from public.embryo_cohorts cohort)cohorts;
create temporary table appeal_completion as select public.complete_new_public_appeal_evidence_v1(repeat('1',64),repeat('Q',32),
 jsonb_build_object('photoIdentityDocumentId',(select id from appeal_uploaded where kind='appeal-photo-identity'),
 'subjectSourceControlDocumentId',(select id from appeal_uploaded where kind='appeal-subject-source-control')),true)value;
select is((select value->>'status' from appeal_completion),'review_pending','whole no-match evidence set reaches named pending review');
select is((select array_agg(key order by key) from appeal_completion,jsonb_object_keys(value)key),array['deadline','status'],
 'receipt contains no match/document/reviewer/account/genetic detail');
select ok((select value->>'deadline' from appeal_completion)::timestamptz=(select deadline from private.new_public_appeal_intakes limit 1),
 'completion does not extend the original30day deadline');
select ok((select subjects is not distinct from
 (select coalesce(jsonb_agg(to_jsonb(subject) order by subject.id),'[]') from public.subjects subject)
 and cohorts is not distinct from
 (select coalesce(jsonb_agg(to_jsonb(cohort) order by cohort.id),'[]') from public.embryo_cohorts cohort) from appeal_target_before),
 'no-match submission changes no subject/cohort authority, lifecycle, result access or purge state');
select ok((select reviewer_principal_id='86000000-0000-4000-8000-000000000001'::uuid and evidence_revision=1 and state='pending'
 from private.public_appeal_pending_reviews),'assignment retains the exact current named reviewer and full evidence revision');
select ok((select revision=2 and state='submitted' from private.new_public_appeal_evidence_state),'evidence revision rotates after submission');
select is((select status from public.rights_sessions where session_hash=repeat('1',64)),'consumed','no completion or new upload can reuse the credential');
select throws_ok($$select public.complete_new_public_appeal_evidence_v1(repeat('1',64),repeat('Q',32),
 jsonb_build_object('photoIdentityDocumentId',(select id from appeal_uploaded where kind='appeal-photo-identity'),
 'subjectSourceControlDocumentId',(select id from appeal_uploaded where kind='appeal-subject-source-control')),true)$$,
 '42501','appeal unavailable','submission cannot replay or reassign a completed set');
create function pg_temp.stale_appeal_review_cleanup() returns boolean language plpgsql as $test$
declare keys text[];result boolean;
begin
 begin
  update private.new_public_appeal_reviewers set active=false;
  select array_agg(object_key) into keys from public.appeal_document_objects_due_v1(100);
  if (select count(*) from private.appeal_document_sessions where wrapped_document_key is not null)<>0 then
   raise exception 'keys retained after revoked authority';end if;
  -- Simulated physical ACK only: native tests do not claim Storage deletion.
  perform public.confirm_appeal_document_objects_deleted_v1(keys,'jobs.retention');
  result:=not exists(select 1 from private.public_appeal_pending_reviews) and not exists(select 1 from private.appeal_documents);
  if not result then raise exception 'stale assignment blocked disposal';end if;
  raise exception using errcode='P0002',message='rollback synthetic disposal';
 exception when no_data_found then return result;
 end;
end $test$;
select ok(pg_temp.stale_appeal_review_cleanup(),'revoked reviewer cleanup shreds keys first then confirms removal without a pending-review FK or current clean row');
select is((select count(*) from private.public_appeal_pending_reviews),1::bigint,'the separate synthetic cleanup subtransaction restores the original pending review');
-- Native receipt callback simulates Storage delivery only, not physical provider acceptance.
create function pg_temp.appeal_reviewer_jwt() returns void language sql as $test$
 select set_config('request.jwt.claims',jsonb_build_object('sub','7a000000-0000-0000-0000-000000000001',
 'role','authenticated','session_id','7a000000-0000-4000-8000-0000000000a1','aal','aal2',
 'iss','http://127.0.0.1:54321/auth/v1','aud','authenticated','exp',extract(epoch from clock_timestamp())::bigint+3600,
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())::bigint-60)))::text,true);
$test$;
create temporary table appeal_review_audit_before as select coalesce(max(seq),0)seq from public.legal_audit_log;
select throws_ok($$select public.read_public_appeal_review_v1((select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared))$$,
 '42501','appeal unavailable','service authority cannot replace the named reviewer own MFA session');
select pg_temp.appeal_reviewer_jwt();
select ok(public.read_public_appeal_review_v1((select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared)) is not null,
 'own current named MFA reviewer reads only the assigned case');
select ok((select count(*)=1 and bool_and(event_code='appeal.review.read' and coded_context='{}')
 from public.legal_audit_log where seq>(select seq from appeal_review_audit_before)),
 'assigned case reading appends only a coded content-free audit event');
select is(public.review_document_domain_v1((select id from private.appeal_documents where document_kind='appeal-photo-identity')),'appeal',
 'native domain classification requires the current own-MFA assigned complete document');
select is((select count(*) from private.public_appeal_review_downloads),0::bigint,'classification cannot mint a download session');
select throws_ok($$select public.review_document_domain_v1('86000000-0000-4000-8000-999999999999')$$,
 '42501','review unavailable','native document classification refuses a foreign or absent document');
create function pg_temp.appeal_read_and_decide(p_kind text,p_decision text,p_cookie text,p_nonce text) returns jsonb language plpgsql as $test$
declare doc private.appeal_documents;opened jsonb;receipt jsonb;proof text;review_revision bigint;
begin
 perform pg_temp.appeal_reviewer_jwt();
 select d.* into doc from private.appeal_documents d where d.document_kind=p_kind;
 select pending.review_revision into review_revision from private.public_appeal_pending_reviews pending where pending.case_id=doc.intake_id;
 opened:=public.open_claim_review_download_v1(doc.id,p_cookie);
 receipt:=public.open_claim_review_receipt_v1((opened->>'session')::uuid,p_cookie,p_nonce);
 perform public.authorize_claim_review_chunk_v1((opened->>'session')::uuid,p_cookie,0);
 begin
  perform public.decide_public_appeal_document_v1(doc.id,doc.sha256,review_revision,p_decision,p_nonce,
   decode(repeat('ab',48),'hex'),repeat('f',64),decode(repeat('cd',76),'hex'));
  raise exception 'decision accepted before native receipt ACK';
 exception when insufficient_privilege then null;end;
 proof:=encode(extensions.digest(decode(receipt#>>'{chunks,0,challenge}','hex')||convert_to('%PDF-1.7 synthetic','UTF8'),'sha256'),'hex');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.prepare_claim_review_chunk_receipt_v1((opened->>'session')::uuid,p_cookie,0,proof);
 perform pg_temp.appeal_reviewer_jwt();
 perform public.acknowledge_claim_review_chunk_v1((opened->>'session')::uuid,p_cookie,0,proof,p_nonce);
 return public.decide_public_appeal_document_v1(doc.id,doc.sha256,review_revision,p_decision,p_nonce,
  decode(repeat('ab',48),'hex'),encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex'),decode(repeat('cd',76),'hex'));
end $test$;
select is(pg_temp.appeal_read_and_decide('appeal-photo-identity','approved',repeat('a',64),repeat('b',64))->>'decision','approved',
 'whole native challenged delivery and own ACK permit only a documentary approval');
select is(pg_temp.appeal_read_and_decide('appeal-subject-source-control','rejected',repeat('c',64),repeat('d',64))->>'decision','rejected',
 'whole native delivery binds the real source-control rejection producer');
select is((select count(*) from public.legal_audit_log where event_code='appeal.document.chunk.read' and coded_context='{}'),2::bigint,
 'each separately authorized actual document chunk has a coded content-free read audit');
select is((select count(*) from private.public_appeal_document_decisions),2::bigint,'each exact current document has one immutable native decision');
select ok((select reason_ciphertext is not null and reference_ciphertext is not null from private.public_appeal_document_decisions where decision='rejected'),
 'private reason/reference are retained encrypted until original case disposition');
select is((select count(*) from private.appeal_document_sessions ds join private.public_appeal_document_decisions decision on decision.document_id=ds.document_id
 where decision.decision='rejected' and ds.wrapped_document_key is not null),0::bigint,'rejection shreds the unusable document key before any physical cleanup');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(public.read_public_appeal_decision_notice_v1(repeat('1',64)) is not null,'the original verified consumed session reads only its own notice without renewal');
select is((select status from public.rights_sessions where session_hash=repeat('1',64)),'consumed','notice read does not reactivate upload authority');
select is(public.read_public_appeal_decision_notice_v1(repeat('f',64)),null::jsonb,'foreign session cannot read a decision/reference');
-- These are real native decision-event/candidate/session functions. Ciphertext
-- and the provider are synthetic; this does not establish physical delivery.
select is((select count(*) from private.public_appeal_decision_notices),2::bigint,
 'each immutable native document decision atomically queued exactly one deduplicated notice');
select ok((select bool_and(mail.contact_reference_id=intake.case_contact_id and mail.recipient_principal_id=intake.author_principal_id
 and candidate.purpose='appeal-decision-notice' and candidate.token_revision=decision.review_revision
 and notice.expires_at=least(notice.created_at+interval '7 days',intake.deadline))
 from private.public_appeal_decision_notices notice join private.new_public_appeal_intakes intake on intake.id=notice.case_id
 join private.public_appeal_document_decisions decision on decision.id=notice.decision_id
 join public.mail_outbox mail on mail.id=notice.outbox_id join public.token_candidates candidate on candidate.id=notice.candidate_id),
 'notice recipients are only the exact previously verified case contact, with separate bounded credentials');
create temporary table public_appeal_notice_claim as select * from public.claim_mail_outbox();
select ok(public.authorize_mail_submission_v1((select outbox_id from public_appeal_notice_claim),
 (select attempt_ordinal from public_appeal_notice_claim)),'notice mail requires fresh same-recipient native currentness');
select is((public.read_new_public_appeal_mail_contact_v1((select outbox_id from public_appeal_notice_claim),
 (select attempt_ordinal from public_appeal_notice_claim))->>'contactCiphertextHex'),repeat('de',48),
 'notice delivery uses the original case envelope, not a generic account contact reader');
create temporary table public_appeal_notice_activation as select * from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select delivery_token from public_appeal_notice_claim),'UTF8'),'sha256'),'hex'),repeat('6',64),repeat('N',32));
select is((select purpose from public_appeal_notice_activation),'appeal-decision-notice','new activation has only a notice purpose');
select is((select count(*) from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select delivery_token from public_appeal_notice_claim),'UTF8'),'sha256'),'hex'),repeat('7',64),repeat('M',32))),0::bigint,
 'the notice token is one-use, and replay creates no second session');
select is(jsonb_array_length(public.read_public_appeal_decision_notice_v1(repeat('6',64))->'decisions'),1,
 'recipient continuation reads exactly its immutable decision without notes or target data');
select is(public.new_public_appeal_evidence_view_v1(repeat('6',64)),null::jsonb,'notice purpose cannot reopen intake/evidence collection');
select ok(not private.rights_action_permitted_v1('appeal-decision-notice','create-kind-bound-document-session','api.appeal-document-session')
 and not private.rights_action_permitted_v1('appeal-decision-notice','complete-evidence-set','api.appeal-complete'),
 'notice session has no upload, completion or target actions');
select is((select status from public.rights_sessions where session_hash=repeat('1',64)),'consumed',
 'new continuation leaves the original intake session consumed');
select is(pg_temp.deletion_probe('update public.rights_sessions set status=''expired'',ended_at=clock_timestamp() where session_hash=repeat(''6'',64)',
 'select public.read_public_appeal_decision_notice_v1(repeat(''6'',64))'),null::text,'expired notice sessions expose no result');
select is(pg_temp.deletion_probe('update public.encrypted_contact_references set status=''rotated'' where id=(select case_contact_id from private.new_public_appeal_intakes limit 1)',
 'select public.read_public_appeal_decision_notice_v1(repeat(''6'',64))'),null::text,'rotated original recipient refuses without adopting an account contact');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only'])role_name
 where has_table_privilege(role_name,'private.public_appeal_decision_notices','select,insert,update,delete')
 or has_function_privilege(role_name,'private.queue_public_appeal_decision_notice_v1()','execute')),0::bigint,
 'API roles cannot manufacture a recipient, notice or native event');
select ok(private.public_appeal_underlying_binding_v1(encode(extensions.digest(convert_to(repeat('d',64),'UTF8'),'sha256'),'hex'),jsonb_build_object('1',repeat('c',64))) is not null,
 'only actual source rejection plus approved photo and same current verified recipient binds underlying access review');
select is(private.public_appeal_underlying_binding_v1(encode(extensions.digest(convert_to(repeat('d',64),'UTF8'),'sha256'),'hex'),jsonb_build_object('1',repeat('9',64))),null::jsonb,
 'foreign recipient cannot borrow a real decision reference');
select is(private.public_appeal_underlying_binding_v1(repeat('8',64),jsonb_build_object('1',repeat('c',64))),null::jsonb,
 'arbitrary/legacy decision references remain unbound');
-- Genuine source rejection above, followed by a separate same-recipient
-- access appeal and a different named reviewer. These are real native doors;
-- ciphertext/Storage callbacks are synthetic, so this is not provider proof.
create function pg_temp.prior_appeal_reviewer_jwt(p_same_account boolean default false) returns void language plpgsql as $test$
 begin
 if p_same_account then perform pg_temp.appeal_reviewer_jwt();return;end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub','7a000000-0000-0000-0000-000000000002',
 'role','authenticated','session_id','7a000000-0000-4000-8000-0000000000b1','aal','aal2',
 'iss','http://127.0.0.1:54321/auth/v1','aud','authenticated','exp',extract(epoch from clock_timestamp())::bigint+3600,
 'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())::bigint-60)))::text,true);
end $test$;
create function pg_temp.prior_appeal_read_and_approve(p_document uuid,p_cookie text,p_nonce text,p_same_account boolean default false) returns void
language plpgsql as $test$
declare opened jsonb;receipt jsonb;proof text;revision bigint;doc private.appeal_documents;
begin
 perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
 select source.* into strict doc from private.appeal_documents source where source.id=p_document;
 select pending.review_revision into strict revision from private.public_appeal_pending_reviews pending where pending.case_id=doc.intake_id;
 opened:=public.open_claim_review_download_v1(doc.id,p_cookie);
 receipt:=public.open_claim_review_receipt_v1((opened->>'session')::uuid,p_cookie,p_nonce);
 perform public.authorize_claim_review_chunk_v1((opened->>'session')::uuid,p_cookie,0);
 begin
  perform public.decide_public_appeal_document_v1(doc.id,doc.sha256,revision,'approved',p_nonce,
   decode(repeat('ab',48),'hex'),repeat('f',64),decode(repeat('cd',76),'hex'));
  raise exception 'uphold evidence approved before native whole delivery ACK';
 exception when insufficient_privilege then null;end;
 proof:=encode(extensions.digest(decode(receipt#>>'{chunks,0,challenge}','hex')||convert_to('%PDF-1.7 synthetic','UTF8'),'sha256'),'hex');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.prepare_claim_review_chunk_receipt_v1((opened->>'session')::uuid,p_cookie,0,proof);
 perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
 perform public.acknowledge_claim_review_chunk_v1((opened->>'session')::uuid,p_cookie,0,proof,p_nonce);
 perform public.decide_public_appeal_document_v1(doc.id,doc.sha256,revision,'approved',p_nonce,
  decode(repeat('ab',48),'hex'),encode(extensions.digest(convert_to(p_nonce,'UTF8'),'sha256'),'hex'),decode(repeat('cd',76),'hex'));
end $test$;
create function pg_temp.prior_appeal_uphold_probe(p_same_account boolean default false) returns jsonb language plpgsql as $test$
declare prepared jsonb;v_case uuid;source_case uuid;source_before jsonb;target_before jsonb;
 claim record;activated record;kind text;ordinal integer:=0;opened jsonb;plan jsonb;scan jsonb;cookie text;nonce text;
 sha text:=encode(extensions.digest(convert_to('%PDF-1.7 synthetic','UTF8'),'sha256'),'hex');
 documents jsonb:='{}';v_document uuid;context jsonb;result jsonb;flags jsonb:='{}';receipt jsonb;
begin
 begin
  select (value#>>'{frame,scope,caseId}')::uuid into source_case from public_appeal_prepared;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform private.grant_claim_reviewer_v1('7a000000-0000-0000-0000-000000000002');
  insert into public.subject_principals(id,account_id,principal_kind) values
   ('86000000-0000-4000-8000-000000000002',case when p_same_account then '7a000000-0000-0000-0000-000000000001'::uuid else '7a000000-0000-0000-0000-000000000002'::uuid end,'reviewer');
  insert into private.new_public_appeal_reviewers(principal_id,principal_revision,purpose_revision)
   values('86000000-0000-4000-8000-000000000002',1,1);
  prepared:=public.prepare_new_public_appeal_v1('access-or-review-appeal',pg_temp.h('uphold-payload'),pg_temp.h('uphold-form'),
   jsonb_build_object('1',repeat('c',64)),jsonb_build_object('1',pg_temp.h('uphold-identifier')),
   jsonb_build_object('1',pg_temp.h('uphold-network')),encode(extensions.digest(convert_to(repeat('d',64),'UTF8'),'sha256'),'hex'));
  if prepared is null then raise exception 'real same-recipient access preparation unavailable';end if;
  v_case:=(prepared#>>'{frame,scope,caseId}')::uuid;
  flags:=flags||jsonb_build_object('distinctPrincipalNativeBinding',prepared#>>'{frame,reviewer,principalId}'='86000000-0000-4000-8000-000000000002'
   and prepared#>>'{frame,underlyingDecision,sourceCaseId}'=source_case::text);
  perform public.commit_new_public_appeal_v1(prepared,pg_temp.h('uphold-payload'),pg_temp.h('uphold-form'),
   decode(repeat('ab',72),'hex'),decode(repeat('bc',48),'hex'),decode(repeat('cd',48),'hex'),decode(repeat('de',48),'hex'),
   jsonb_build_object('1',jsonb_build_object('normalized-identifier',pg_temp.h('uphold-identifier'),
    'source-network',pg_temp.h('uphold-network'),'global-capacity',encode(extensions.digest(convert_to('api.subject-access-request|global-capacity','UTF8'),'sha256'),'hex'))));
  -- The actual public queue may first issue the older documentary notice.
  -- Every token is native; only this exact candidate may activate this case.
  for ordinal in 1..4 loop
   select * into claim from public.claim_mail_outbox();
   exit when claim.outbox_id=(select source.outbox_id from private.new_public_appeal_intakes source where source.id=v_case);
  end loop;
  if claim.outbox_id is distinct from (select source.outbox_id from private.new_public_appeal_intakes source where source.id=v_case)
   or not public.authorize_mail_submission_v1(claim.outbox_id,claim.attempt_ordinal) then raise exception 'access candidate not owned';end if;
  select * into activated from public.activate_rights_session_v1(
   encode(extensions.digest(convert_to(claim.delivery_token,'UTF8'),'sha256'),'hex'),pg_temp.h('uphold-rights'),repeat('U',32));
  if activated.target_id<>v_case or activated.purpose<>'appeal-evidence' then raise exception 'wrong access session';end if;
  perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
  context:=public.read_public_appeal_case_context_v1(v_case);
  flags:=flags||jsonb_build_object('incompleteClosed',context->'allowedDecisions'='["reject","needs-more-information"]'::jsonb);
  begin
   perform public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'incomplete evidence admitted uphold';
  exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  ordinal:=0;
  for kind in select unnest(array['appeal-photo-identity','appeal-subject-source-control','appeal-decision-notice']) loop
   ordinal:=ordinal+1;cookie:=pg_temp.h('uphold-upload:'||kind);nonce:=pg_temp.h('uphold-compose:'||kind);
   opened:=public.open_public_appeal_document_v1(pg_temp.h('uphold-rights'),repeat(chr(85+ordinal),32),kind,
    'application/pdf',octet_length('%PDF-1.7 synthetic'),sha,cookie,decode(repeat(lpad((40+ordinal)::text,2,'0'),72),'hex'));
   perform public.reserve_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,octet_length('%PDF-1.7 synthetic'),sha);
   perform public.settle_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,true);
   plan:=public.begin_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,1);
   perform public.finish_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,'composed',plan->>'objectKey');
   scan:=public.claim_next_appeal_document_scan_v1(pg_temp.h('uphold-scan:'||kind));
   if scan->>'documentId' is distinct from plan->>'documentId' then raise exception 'foreign access scan';end if;
   perform public.record_appeal_document_scan_v1((scan->>'documentId')::uuid,pg_temp.h('uphold-scan:'||kind),'OK',sha,
    'synthetic native test',1,clock_timestamp());
   documents:=documents||jsonb_build_object(case kind when 'appeal-photo-identity' then 'photoIdentityDocumentId'
    when 'appeal-subject-source-control' then 'subjectSourceControlDocumentId' else 'decisionNoticeDocumentId' end,plan->>'documentId');
  end loop;
  perform public.complete_new_public_appeal_evidence_v1(pg_temp.h('uphold-rights'),repeat('Z',32),documents,true);
  perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
  context:=public.read_public_appeal_case_context_v1(v_case);
  flags:=flags||jsonb_build_object('pendingClosed',context->'allowedDecisions'='["reject","needs-more-information"]'::jsonb);
  begin
   perform public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'unread pending evidence admitted uphold';
  exception when insufficient_privilege then null;end;
  for kind,v_document in select doc.document_kind,doc.id from private.appeal_documents doc where doc.intake_id=v_case order by doc.document_kind loop
   perform pg_temp.prior_appeal_read_and_approve(v_document,pg_temp.h('uphold-read:'||kind),pg_temp.h('uphold-review:'||kind),p_same_account);
  end loop;
  context:=public.read_public_appeal_case_context_v1(v_case);
  if p_same_account then
   if context->'allowedDecisions' is distinct from '["reject","needs-more-information"]'::jsonb then
    raise exception 'two principals disguised the original reviewer account';end if;
   begin
    perform public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint,
     (context->>'evidenceRevision')::bigint,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
    raise exception 'same original reviewer account admitted uphold';
   exception when insufficient_privilege then null;end;
   flags:=flags||jsonb_build_object('sameAccountRefused',
    context->'allowedDecisions'='["reject","needs-more-information"]'::jsonb and jsonb_array_length(context->'documents')=3
    and not exists(select 1 from jsonb_array_elements(context->'documents') doc where doc->>'decision'<>'approved')
    and not exists(select 1 from private.public_appeal_case_decisions));
   raise exception using errcode='PZ002',message='restore same-account synthetic case';
  end if;
  flags:=flags||jsonb_build_object('wholeApprovedNativeSet',context->'allowedDecisions'='["reject","uphold","reverse-prior-decision","needs-more-information"]'::jsonb
   and jsonb_array_length(context->'documents')=3 and not exists(select 1 from jsonb_array_elements(context->'documents') doc
    where doc->>'decision'<>'approved'));
  begin
   perform public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint+1,
    (context->>'evidenceRevision')::bigint,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'stale review admitted uphold';
  exception when insufficient_privilege then null;end;
  begin
   perform public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint+1,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'stale evidence admitted uphold';
  exception when insufficient_privilege then null;end;
  perform pg_temp.appeal_reviewer_jwt();
  begin
   perform public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'original source reviewer replaced independent review';
  exception when insufficient_privilege then null;end;
  perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
  begin
   update public.encrypted_contact_references set status='rotated' where id=(select source.case_contact_id from private.new_public_appeal_intakes source where source.id=source_case);
   perform public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'stale source recipient admitted uphold';
  exception when insufficient_privilege then null;end;
  flags:=flags||jsonb_build_object('refusalsAtomic',not exists(select 1 from private.public_appeal_case_decisions));
  select jsonb_build_object('intake',to_jsonb(source),'appeal',(select to_jsonb(appeal) from public.appeal_intakes appeal where appeal.id=source_case),
   'decisions',(select jsonb_agg(to_jsonb(outcome) order by outcome.id) from private.public_appeal_document_decisions outcome where outcome.case_id=source_case),
   'documents',(select jsonb_agg(to_jsonb(doc) order by doc.id) from private.appeal_documents doc where doc.intake_id=source_case))
   into source_before from private.new_public_appeal_intakes source where source.id=source_case;
  select jsonb_build_object('subjects',(select coalesce(jsonb_agg(to_jsonb(subject) order by subject.id),'[]') from public.subjects subject),
   'cohorts',(select coalesce(jsonb_agg(to_jsonb(cohort) order by cohort.id),'[]') from public.embryo_cohorts cohort)) into target_before;
  receipt:=public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint,
   (context->>'evidenceRevision')::bigint,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
  flags:=flags||jsonb_build_object('nativeUpheld',receipt=jsonb_build_object('caseId',v_case,'state','resolved','outcome','upheld',
    'reviewRevision',(context->>'reviewRevision')::bigint+1)
   and exists(select 1 from private.public_appeal_case_decisions outcome where outcome.case_id=v_case and outcome.decision='uphold'
    and outcome.prior_decision_id=(context#>>'{priorDecision,decisionId}')::uuid
    and outcome.prior_decision_revision=(context#>>'{priorDecision,decisionRevision}')::bigint
    and outcome.prior_evidence_revision=(context#>>'{priorDecision,evidenceRevision}')::bigint and outcome.reason_ciphertext is null
    and outcome.reviewer_account_id='7a000000-0000-0000-0000-000000000002'),
   'terminalDisposal',exists(select 1 from private.new_public_appeal_intakes source where source.id=v_case and source.state='closed'
    and source.wrapped_case_key is null and source.working_ciphertext is null and source.case_contact_id is null)
    and not exists(select 1 from public.rights_sessions rights where rights.target_kind='appeal-case' and rights.target_id=v_case)
    and not exists(select 1 from private.public_appeal_provisional_targets hold where hold.case_id=v_case)
    and not exists(select 1 from private.appeal_document_sessions session where session.intake_id=v_case and session.wrapped_document_key is not null));
  select jsonb_build_object('intake',to_jsonb(source),'appeal',(select to_jsonb(appeal) from public.appeal_intakes appeal where appeal.id=source_case),
   'decisions',(select jsonb_agg(to_jsonb(outcome) order by outcome.id) from private.public_appeal_document_decisions outcome where outcome.case_id=source_case),
   'documents',(select jsonb_agg(to_jsonb(doc) order by doc.id) from private.appeal_documents doc where doc.intake_id=source_case))
   into result from private.new_public_appeal_intakes source where source.id=source_case;
  flags:=flags||jsonb_build_object('sourceUnchanged',result=source_before,'targetsUnchanged',target_before=jsonb_build_object(
   'subjects',(select coalesce(jsonb_agg(to_jsonb(subject) order by subject.id),'[]') from public.subjects subject),
   'cohorts',(select coalesce(jsonb_agg(to_jsonb(cohort) order by cohort.id),'[]') from public.embryo_cohorts cohort)));
  begin
   perform public.decide_public_appeal_case_v1(v_case,'uphold',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('uphold-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'closed uphold replay admitted';
  exception when insufficient_privilege then null;end;
  raise exception using errcode='PZ002',message='restore synthetic upheld case';
 exception when sqlstate 'PZ002' then null;
 end;
 return flags;
end $test$;

-- Create the other actual rejection kind through its genuine producer, never
-- by relabeling a subject-source outcome. Storage callbacks remain synthetic.
create function pg_temp.reversal_genetic_source() returns uuid language plpgsql as $test$
declare prepared jsonb;v_case uuid;claim record;activated record;kind text;ordinal integer:=0;opened jsonb;plan jsonb;scan jsonb;
 cookie text;nonce text;documents jsonb:='{}';doc private.appeal_documents;receipt jsonb;proof text;revision bigint;decision text;
 sha text:=encode(extensions.digest(convert_to('%PDF-1.7 synthetic','UTF8'),'sha256'),'hex');
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 prepared:=public.prepare_new_public_appeal_v1('genetic-parent-objection',pg_temp.h('genetic-source-payload'),pg_temp.h('genetic-source-form'),
  jsonb_build_object('1',repeat('9',64)),jsonb_build_object('1',pg_temp.h('genetic-source-identifier')),
  jsonb_build_object('1',pg_temp.h('genetic-source-network')));
 if prepared is null then raise exception 'genetic source preparation unavailable';end if;
 v_case:=(prepared#>>'{frame,scope,caseId}')::uuid;
 if prepared#>>'{frame,reviewer,principalId}'<>'86000000-0000-4000-8000-000000000001' then
  raise exception 'genetic source reviewer not original';end if;
 perform public.commit_new_public_appeal_v1(prepared,pg_temp.h('genetic-source-payload'),pg_temp.h('genetic-source-form'),
  decode(repeat('ab',72),'hex'),decode(repeat('bc',48),'hex'),decode(repeat('cd',48),'hex'),decode(repeat('de',48),'hex'),
  jsonb_build_object('1',jsonb_build_object('normalized-identifier',pg_temp.h('genetic-source-identifier'),
   'source-network',pg_temp.h('genetic-source-network'),'global-capacity',encode(extensions.digest(convert_to('api.subject-access-request|global-capacity','UTF8'),'sha256'),'hex'))));
 for ordinal in 1..8 loop
  select * into claim from public.claim_mail_outbox();
  exit when claim.outbox_id=(select source.outbox_id from private.new_public_appeal_intakes source where source.id=v_case);
 end loop;
 if claim.outbox_id is distinct from (select source.outbox_id from private.new_public_appeal_intakes source where source.id=v_case)
  or not public.authorize_mail_submission_v1(claim.outbox_id,claim.attempt_ordinal) then raise exception 'genetic source candidate unavailable';end if;
 select * into activated from public.activate_rights_session_v1(
  encode(extensions.digest(convert_to(claim.delivery_token,'UTF8'),'sha256'),'hex'),pg_temp.h('genetic-source-rights'),repeat('G',32));
 if activated.target_id is distinct from v_case or activated.purpose is distinct from 'appeal-evidence' then
  raise exception 'wrong genetic source authority';end if;
 ordinal:=0;
 for kind in select unnest(array['appeal-photo-identity','appeal-genetic-parent-authority']) loop
  ordinal:=ordinal+1;cookie:=pg_temp.h('genetic-source-upload:'||kind);nonce:=pg_temp.h('genetic-source-compose:'||kind);
  opened:=public.open_public_appeal_document_v1(pg_temp.h('genetic-source-rights'),repeat(chr(71+ordinal),32),kind,
   'application/pdf',octet_length('%PDF-1.7 synthetic'),sha,cookie,decode(repeat(lpad((30+ordinal)::text,2,'0'),72),'hex'));
  perform public.reserve_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,octet_length('%PDF-1.7 synthetic'),sha);
  perform public.settle_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,true);
  plan:=public.begin_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,1);
  perform public.finish_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,'composed',plan->>'objectKey');
  scan:=public.claim_next_appeal_document_scan_v1(pg_temp.h('genetic-source-scan:'||kind));
  if scan->>'documentId' is distinct from plan->>'documentId' then raise exception 'foreign genetic source scan';end if;
  perform public.record_appeal_document_scan_v1((scan->>'documentId')::uuid,pg_temp.h('genetic-source-scan:'||kind),'OK',sha,
   'synthetic native test',1,clock_timestamp());
  documents:=documents||jsonb_build_object(case kind when 'appeal-photo-identity' then 'photoIdentityDocumentId'
   else 'geneticParentAuthorityDocumentId' end,plan->>'documentId');
 end loop;
 perform public.complete_new_public_appeal_evidence_v1(pg_temp.h('genetic-source-rights'),repeat('J',32),documents,true);
 -- Photo approval precedes the real genetic-parent documentary rejection.
 for doc in select source.* from private.appeal_documents source where source.intake_id=v_case
  order by case source.document_kind when 'appeal-photo-identity' then 0 else 1 end loop
  perform pg_temp.appeal_reviewer_jwt();
  select pending.review_revision into strict revision from private.public_appeal_pending_reviews pending where pending.case_id=v_case;
  cookie:=pg_temp.h('genetic-source-read:'||doc.document_kind);nonce:=pg_temp.h('genetic-source-review:'||doc.document_kind);
  decision:=case doc.document_kind when 'appeal-photo-identity' then 'approved' else 'rejected' end;
  opened:=public.open_claim_review_download_v1(doc.id,cookie);
  receipt:=public.open_claim_review_receipt_v1((opened->>'session')::uuid,cookie,nonce);
  perform public.authorize_claim_review_chunk_v1((opened->>'session')::uuid,cookie,0);
  begin
   perform public.decide_public_appeal_document_v1(doc.id,doc.sha256,revision,decision,nonce,
    decode(repeat('ab',48),'hex'),repeat('f',64),decode(repeat('cd',76),'hex'));
   raise exception 'genetic source decision accepted without whole ACK';
  exception when insufficient_privilege then null;end;
  proof:=encode(extensions.digest(decode(receipt#>>'{chunks,0,challenge}','hex')||convert_to('%PDF-1.7 synthetic','UTF8'),'sha256'),'hex');
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.prepare_claim_review_chunk_receipt_v1((opened->>'session')::uuid,cookie,0,proof);
  perform pg_temp.appeal_reviewer_jwt();
  perform public.acknowledge_claim_review_chunk_v1((opened->>'session')::uuid,cookie,0,proof,nonce);
  perform public.decide_public_appeal_document_v1(doc.id,doc.sha256,revision,decision,nonce,
   decode(repeat('ab',48),'hex'),encode(extensions.digest(convert_to(nonce,'UTF8'),'sha256'),'hex'),decode(repeat('cd',76),'hex'));
 end loop;
 return v_case;
end $test$;

-- Exact native source correction; callbacks remain synthetic and UNRUN.
create function pg_temp.prior_appeal_reverse_probe(p_same_account boolean default false,p_deleted boolean default false,p_genetic boolean default false,
 p_capture_clock_fixture boolean default false) returns jsonb language plpgsql as $test$
declare prepared jsonb;v_case uuid;source_case uuid;source_before jsonb;target_before jsonb;
 claim record;activated record;kind text;ordinal integer:=0;opened jsonb;plan jsonb;scan jsonb;cookie text;nonce text;
 sha text:=encode(extensions.digest(convert_to('%PDF-1.7 synthetic','UTF8'),'sha256'),'hex');
 documents jsonb:='{}';v_document uuid;context jsonb;result jsonb;flags jsonb:='{}';receipt jsonb;source_outcome uuid;prior_revision bigint;erased_keys text[];
 authority_kind text:=case when p_genetic then 'appeal-genetic-parent-authority' else 'appeal-subject-source-control' end;
 contact_digest text:=case when p_genetic then repeat('9',64) else repeat('c',64) end;reference_hash text;
begin
 begin
  if p_genetic then source_case:=pg_temp.reversal_genetic_source();
  else select (value#>>'{frame,scope,caseId}')::uuid into source_case from public_appeal_prepared;end if;
  select source.decision_reference_hash into strict reference_hash from private.public_appeal_document_decisions source
   where source.case_id=source_case and source.document_kind=authority_kind and source.decision='rejected';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform private.grant_claim_reviewer_v1('7a000000-0000-0000-0000-000000000002');
  insert into public.subject_principals(id,account_id,principal_kind) values
   ('86000000-0000-4000-8000-000000000002',case when p_same_account then '7a000000-0000-0000-0000-000000000001'::uuid else '7a000000-0000-0000-0000-000000000002'::uuid end,'reviewer');
  insert into private.new_public_appeal_reviewers(principal_id,principal_revision,purpose_revision)
   values('86000000-0000-4000-8000-000000000002',1,1);
  prepared:=public.prepare_new_public_appeal_v1('access-or-review-appeal',pg_temp.h('reversal-payload'),pg_temp.h('reversal-form'),
   jsonb_build_object('1',contact_digest),jsonb_build_object('1',pg_temp.h('reversal-identifier')),
   jsonb_build_object('1',pg_temp.h('reversal-network')),reference_hash);
  if prepared is null then raise exception 'real same-recipient access preparation unavailable';end if;
  v_case:=(prepared#>>'{frame,scope,caseId}')::uuid;
  flags:=flags||jsonb_build_object('distinctPrincipalNativeBinding',prepared#>>'{frame,reviewer,principalId}'='86000000-0000-4000-8000-000000000002'
   and prepared#>>'{frame,underlyingDecision,sourceCaseId}'=source_case::text
   and prepared#>>'{frame,underlyingDecision,requiredAuthorityKind}'=authority_kind);
  perform public.commit_new_public_appeal_v1(prepared,pg_temp.h('reversal-payload'),pg_temp.h('reversal-form'),
   decode(repeat('ab',72),'hex'),decode(repeat('bc',48),'hex'),decode(repeat('cd',48),'hex'),decode(repeat('de',48),'hex'),
   jsonb_build_object('1',jsonb_build_object('normalized-identifier',pg_temp.h('reversal-identifier'),
    'source-network',pg_temp.h('reversal-network'),'global-capacity',encode(extensions.digest(convert_to('api.subject-access-request|global-capacity','UTF8'),'sha256'),'hex'))));
  -- The actual public queue may first issue the older documentary notice.
  -- Every token is native; only this exact candidate may activate this case.
  for ordinal in 1..4 loop
   select * into claim from public.claim_mail_outbox();
   exit when claim.outbox_id=(select source.outbox_id from private.new_public_appeal_intakes source where source.id=v_case);
  end loop;
  if claim.outbox_id is distinct from (select source.outbox_id from private.new_public_appeal_intakes source where source.id=v_case)
   or not public.authorize_mail_submission_v1(claim.outbox_id,claim.attempt_ordinal) then raise exception 'access candidate not owned';end if;
  select * into activated from public.activate_rights_session_v1(
   encode(extensions.digest(convert_to(claim.delivery_token,'UTF8'),'sha256'),'hex'),pg_temp.h('reversal-rights'),repeat('U',32));
  if activated.target_id<>v_case or activated.purpose<>'appeal-evidence' then raise exception 'wrong access session';end if;
  perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
  context:=public.read_public_appeal_case_context_v1(v_case);
  flags:=flags||jsonb_build_object('incompleteClosed',context->'allowedDecisions'='["reject","needs-more-information"]'::jsonb);
  begin
   perform public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'incomplete evidence admitted reversal';
  exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  ordinal:=0;
  for kind in select unnest(array['appeal-photo-identity',authority_kind,'appeal-decision-notice']) loop
   ordinal:=ordinal+1;cookie:=pg_temp.h('reversal-upload:'||kind);nonce:=pg_temp.h('reversal-compose:'||kind);
   opened:=public.open_public_appeal_document_v1(pg_temp.h('reversal-rights'),repeat(chr(85+ordinal),32),kind,
    'application/pdf',octet_length('%PDF-1.7 synthetic'),sha,cookie,
    decode(repeat(lpad((20+ordinal)::text,2,'0'),72),'hex'));
   perform public.reserve_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,octet_length('%PDF-1.7 synthetic'),sha);
   perform public.settle_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,true);
   plan:=public.begin_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,1);
   perform public.finish_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,'composed',plan->>'objectKey');
   scan:=public.claim_next_appeal_document_scan_v1(pg_temp.h('reversal-scan:'||kind));
   if scan->>'documentId' is distinct from plan->>'documentId' then raise exception 'foreign access scan';end if;
   perform public.record_appeal_document_scan_v1((scan->>'documentId')::uuid,pg_temp.h('reversal-scan:'||kind),'OK',sha,
    'synthetic native test',1,clock_timestamp());
   documents:=documents||jsonb_build_object(case kind when 'appeal-photo-identity' then 'photoIdentityDocumentId'
    when 'appeal-subject-source-control' then 'subjectSourceControlDocumentId'
    when 'appeal-genetic-parent-authority' then 'geneticParentAuthorityDocumentId' else 'decisionNoticeDocumentId' end,plan->>'documentId');
  end loop;
  perform public.complete_new_public_appeal_evidence_v1(pg_temp.h('reversal-rights'),repeat('Z',32),documents,true);
  perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
  context:=public.read_public_appeal_case_context_v1(v_case);
  flags:=flags||jsonb_build_object('pendingClosed',context->'allowedDecisions'='["reject","needs-more-information"]'::jsonb);
  begin
   perform public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'unread pending evidence admitted reversal';
  exception when insufficient_privilege then null;end;
  for kind,v_document in select doc.document_kind,doc.id from private.appeal_documents doc where doc.intake_id=v_case order by doc.document_kind loop
   perform pg_temp.prior_appeal_read_and_approve(v_document,pg_temp.h('reversal-read:'||kind),pg_temp.h('reversal-review:'||kind),p_same_account);
  end loop;
  context:=public.read_public_appeal_case_context_v1(v_case);
  if p_same_account then
   if context->'allowedDecisions' is distinct from '["reject","needs-more-information"]'::jsonb then
    raise exception 'two principals disguised the original reviewer account';end if;
   begin
    perform public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint,
     (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
    raise exception 'same original reviewer account admitted reversal';
   exception when insufficient_privilege then null;end;
   flags:=flags||jsonb_build_object('sameAccountRefused',
    context->'allowedDecisions'='["reject","needs-more-information"]'::jsonb and jsonb_array_length(context->'documents')=3
    and not exists(select 1 from jsonb_array_elements(context->'documents') doc where doc->>'decision'<>'approved')
    and not exists(select 1 from private.public_appeal_case_decisions));
   raise exception using errcode='PZ002',message='restore same-account synthetic case';
  end if;
  flags:=flags||jsonb_build_object('wholeApprovedNativeSet',context->'allowedDecisions'='["reject","uphold","reverse-prior-decision","needs-more-information"]'::jsonb
   and jsonb_array_length(context->'documents')=3 and not exists(select 1 from jsonb_array_elements(context->'documents') doc
    where doc->>'decision'<>'approved'));
  if p_capture_clock_fixture then
   if not (flags->>'distinctPrincipalNativeBinding')::boolean or not (flags->>'wholeApprovedNativeSet')::boolean then
    raise exception 'complete originating/reviewer/ACK clock fixture unavailable';end if;
   -- Only the deadline probe retains this otherwise-real complete pipeline.
   -- Its enclosing subtransaction snapshots then rolls back every new row.
   return flags||jsonb_build_object('fixtureCaseId',v_case,'context',context);
  end if;
  begin
   perform public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint+1,
    (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'stale review admitted reversal';
  exception when insufficient_privilege then null;end;
  begin
   perform public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint+1,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'stale evidence admitted reversal';
  exception when insufficient_privilege then null;end;
  perform pg_temp.appeal_reviewer_jwt();
  begin
   perform public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'original source reviewer replaced independent review';
  exception when insufficient_privilege then null;end;
  perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
  begin
   update public.encrypted_contact_references set status='rotated' where id=(select source.case_contact_id from private.new_public_appeal_intakes source where source.id=source_case);
   perform public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'stale source recipient admitted reversal';
  exception when insufficient_privilege then null;end;
  flags:=flags||jsonb_build_object('refusalsAtomic',not exists(select 1 from private.public_appeal_case_decisions));
  source_outcome:=(prepared#>>'{frame,underlyingDecision,decisionId}')::uuid;
  prior_revision:=(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint;
  begin
   perform public.reverse_public_appeal_prior_decision_v1(v_case,prior_revision+1,(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'stale prior revision admitted reversal';
  exception when insufficient_privilege then null;end;
  if p_deleted then
   -- Native ACK only; this does not prove physical Storage/provider removal.
   select array_agg(doc.object_key) into erased_keys from private.appeal_documents doc
    join private.public_appeal_document_decisions outcome on outcome.document_id=doc.id
    where outcome.id=source_outcome and doc.object_key=any(array(select source.object_key from public.appeal_document_objects_due_v1(100) source));
   if cardinality(erased_keys) is distinct from 1 then raise exception 'rejected object not native-due';end if;
   perform public.confirm_appeal_document_objects_deleted_v1(erased_keys,'jobs.retention');
   if exists(select 1 from private.public_appeal_document_decisions outcome where outcome.id=source_outcome and outcome.document_id is not null) then
    raise exception 'lawfully removed source document remains linked';end if;
  end if;
  select jsonb_build_object('intake',to_jsonb(source),'appeal',(select to_jsonb(appeal) from public.appeal_intakes appeal where appeal.id=source_case),
   'decisions',(select jsonb_agg(to_jsonb(outcome) order by outcome.id) from private.public_appeal_document_decisions outcome where outcome.case_id=source_case),
   'documents',(select jsonb_agg(to_jsonb(doc) order by doc.id) from private.appeal_documents doc where doc.intake_id=source_case))
   into source_before from private.new_public_appeal_intakes source where source.id=source_case;
  select jsonb_build_object('profiles',(select coalesce(jsonb_agg(to_jsonb(profile) order by profile.id),'[]') from public.profiles profile),
   'files',(select coalesce(jsonb_agg(to_jsonb(file) order by file.id),'[]') from public.genome_files file),'subjects',(select coalesce(jsonb_agg(to_jsonb(subject) order by subject.id),'[]') from public.subjects subject),
   'cohorts',(select coalesce(jsonb_agg(to_jsonb(cohort) order by cohort.id),'[]') from public.embryo_cohorts cohort)) into target_before;
  receipt:=public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint,
   (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
  flags:=flags||jsonb_build_object('nativeUpheld',receipt=jsonb_build_object('caseId',v_case,'state','resolved','outcome','prior_decision_reversed',
    'reviewRevision',(context->>'reviewRevision')::bigint+1)
   and exists(select 1 from private.public_appeal_case_decisions outcome where outcome.case_id=v_case and outcome.decision='reverse-prior-decision'
    and outcome.prior_decision_id=(context#>>'{priorDecision,decisionId}')::uuid
    and outcome.prior_decision_revision=(context#>>'{priorDecision,decisionRevision}')::bigint
    and outcome.prior_evidence_revision=(context#>>'{priorDecision,evidenceRevision}')::bigint and outcome.reason_ciphertext is null
    and outcome.corrected_prior_decision_revision=outcome.prior_decision_revision+1
    and outcome.corrected_prior_evidence_revision=outcome.prior_evidence_revision+1
    and outcome.reviewer_account_id='7a000000-0000-0000-0000-000000000002'),
   'terminalDisposal',exists(select 1 from private.new_public_appeal_intakes source where source.id=v_case and source.state='closed'
    and source.wrapped_case_key is null and source.working_ciphertext is null and source.case_contact_id is null)
    and not exists(select 1 from public.rights_sessions rights where rights.target_kind='appeal-case' and rights.target_id=v_case)
    and not exists(select 1 from private.public_appeal_provisional_targets hold where hold.case_id=v_case)
    and not exists(select 1 from private.appeal_document_sessions session where session.intake_id=v_case and session.wrapped_document_key is not null));
  select jsonb_build_object('intake',to_jsonb(source),'appeal',(select to_jsonb(appeal) from public.appeal_intakes appeal where appeal.id=source_case),
   'decisions',(select jsonb_agg(to_jsonb(outcome) order by outcome.id) from private.public_appeal_document_decisions outcome where outcome.case_id=source_case),
   'documents',(select jsonb_agg(to_jsonb(doc) order by doc.id) from private.appeal_documents doc where doc.intake_id=source_case))
   into result from private.new_public_appeal_intakes source where source.id=source_case;
  flags:=flags||jsonb_build_object('sourceUnchanged',result=source_before,'targetsUnchanged',target_before=jsonb_build_object(
   'profiles',(select coalesce(jsonb_agg(to_jsonb(profile) order by profile.id),'[]') from public.profiles profile),
   'files',(select coalesce(jsonb_agg(to_jsonb(file) order by file.id),'[]') from public.genome_files file),'subjects',(select coalesce(jsonb_agg(to_jsonb(subject) order by subject.id),'[]') from public.subjects subject),
   'cohorts',(select coalesce(jsonb_agg(to_jsonb(cohort) order by cohort.id),'[]') from public.embryo_cohorts cohort)));
  flags:=flags||jsonb_build_object('referenceRetired',private.public_appeal_underlying_binding_v1(
   prepared#>>'{frame,underlyingDecision,decisionReferenceHash}',jsonb_build_object('1',contact_digest)) is null,
   'discardedSourceKeyNotRevived',not exists(select 1 from private.appeal_document_sessions session
    join private.public_appeal_document_decisions outcome on outcome.original_document_id=session.document_id
    where outcome.id=source_outcome and session.wrapped_document_key is not null));
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  result:=public.prepare_new_public_appeal_v1('access-or-review-appeal',pg_temp.h('reversed-source-payload'),pg_temp.h('reversed-source-form'),
   jsonb_build_object('1',contact_digest),jsonb_build_object('1',pg_temp.h('reversed-source-identifier')),
   jsonb_build_object('1',pg_temp.h('reversed-source-network')),reference_hash);
  flags:=flags||jsonb_build_object('retiredIntakeRefused',result is null);
  perform pg_temp.prior_appeal_reviewer_jwt(p_same_account);
  begin
   update private.public_appeal_case_decisions set corrected_prior_decision_revision=corrected_prior_decision_revision+1 where case_id=v_case;
   raise exception 'append-only correction was rewritten';
  exception when insufficient_privilege then null;end;
  begin
   perform public.reverse_public_appeal_prior_decision_v1(v_case,(prepared#>>'{frame,underlyingDecision,decisionRevision}')::bigint,(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,pg_temp.h('reversal-outcome'),decode(repeat('ab',48),'hex'));
   raise exception 'closed reversal replay admitted';
  exception when insufficient_privilege then null;end;
  raise exception using errcode='PZ002',message='restore synthetic upheld case';
 exception when sqlstate 'PZ002' then null;
 end;
 return flags;
end $test$;
create temporary table prior_appeal_reversal_result as select pg_temp.prior_appeal_reverse_probe() value;
select ok((value->>'distinctPrincipalNativeBinding')::boolean and (value->>'wholeApprovedNativeSet')::boolean,
 'same-recipient independent own-MFA and all three whole-read approved documents bind reversal') from prior_appeal_reversal_result;
select ok((value->>'incompleteClosed')::boolean and (value->>'pendingClosed')::boolean and (value->>'refusalsAtomic')::boolean,
 'missing ACKs, foreign reviewer/recipient and stale prior/review/evidence revisions create no correction') from prior_appeal_reversal_result;
select ok((value->>'nativeUpheld')::boolean and (value->>'terminalDisposal')::boolean,
 'exact prior_decision_reversed receipt appends successor revisions and closes only this appeal') from prior_appeal_reversal_result;
select ok((value->>'sourceUnchanged')::boolean and (value->>'targetsUnchanged')::boolean and (value->>'discardedSourceKeyNotRevived')::boolean,
 'whole immutable source and every profile/file/subject/cohort bag stay unchanged with no key revival') from prior_appeal_reversal_result;
select ok((value->>'referenceRetired')::boolean and (value->>'retiredIntakeRefused')::boolean,
 'the reversed reference cannot bind another genuine intake or be reversed again') from prior_appeal_reversal_result;
select ok((pg_temp.prior_appeal_reverse_probe(true)->>'sameAccountRefused')::boolean,
 'a different principal of the original reviewer account cannot reverse its own decision');
select ok((pg_temp.prior_appeal_reverse_probe(false,true)->>'nativeUpheld')::boolean,
 'lawfully removed source evidence permits only coded correction, not recreated bytes or authority');
create temporary table prior_genetic_reversal_result as select pg_temp.prior_appeal_reverse_probe(false,false,true) value;
select ok((value->>'distinctPrincipalNativeBinding')::boolean and (value->>'wholeApprovedNativeSet')::boolean
 and (value->>'nativeUpheld')::boolean and (value->>'sourceUnchanged')::boolean and (value->>'targetsUnchanged')::boolean,
 'real genetic-parent rejection, approved photo and new complete three-file ACK set permit only its append-only correction') from prior_genetic_reversal_result;
select is((select count(*) from private.public_appeal_case_decisions),0::bigint,'rollback restores every correction and nonce');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name
 where has_function_privilege(role_name,'private.public_appeal_reversal_binding_v1(uuid)','execute')
 or has_function_privilege(role_name,'private.public_appeal_underlying_before_reversal_v1(text,jsonb)','execute')),0::bigint,
 'API roles cannot bypass the correction/source authority');

create temporary table prior_appeal_uphold_result as select pg_temp.prior_appeal_uphold_probe() value;
select ok((value->>'distinctPrincipalNativeBinding')::boolean,'real prior source and same recipient select a genuinely different current named reviewer') from prior_appeal_uphold_result;
select ok((value->>'incompleteClosed')::boolean and (value->>'pendingClosed')::boolean,
 'incomplete, pending and not-yet-delivered evidence cannot enable uphold') from prior_appeal_uphold_result;
select ok((value->>'wholeApprovedNativeSet')::boolean,'all three real native full-read ACK and documentary approval doors enable the exact registered prior actions') from prior_appeal_uphold_result;
select ok((value->>'refusalsAtomic')::boolean,'foreign reviewer, stale source recipient and either stale revision record no outcome or nonce') from prior_appeal_uphold_result;
select ok((value->>'nativeUpheld')::boolean,'same-recipient independent MFA uphold records only exact prior outcome provenance') from prior_appeal_uphold_result;
select ok((value->>'terminalDisposal')::boolean,'uphold closes this case and shreds its keys, contacts, sessions and provisional hold') from prior_appeal_uphold_result;
select ok((value->>'sourceUnchanged')::boolean and (value->>'targetsUnchanged')::boolean,
 'uphold preserves the complete original documentary outcome, source case and all subject/cohort rows') from prior_appeal_uphold_result;
select ok((pg_temp.prior_appeal_uphold_probe(true)->>'sameAccountRefused')::boolean,
 'a second principal of the original Auth account cannot uphold even after all three native full-read approvals');
select is((select count(*) from private.public_appeal_case_decisions),0::bigint,'uphold rollback restores every outcome/nonce row and the original ongoing case');
select is((select count(*) from private.new_public_appeal_intakes),1::bigint,'the independent access-case test leaves no case, principal or account adoption behind');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name
 where has_function_privilege(role_name,'private.public_appeal_uphold_binding_v1(uuid)','execute')
 or has_function_privilege(role_name,'public.decide_public_appeal_case_before_uphold_v1(uuid,text,bigint,bigint,text,bytea)','execute')),
 0::bigint,'no API role can bypass the native optional branch or call the preserved rejection implementation');
-- This probe uses the original genuinely prepared/committed/activated case.
-- Storage/provider callbacks remain explicitly synthetic. Every change is
-- rolled back; no test adopts an account or a foreign mailbox.
create function pg_temp.appeal_information_probe() returns jsonb language plpgsql as $information_test$
declare v_case uuid;before_intake jsonb;before_holds jsonb;before_targets jsonb;context jsonb;after_context jsonb;
 request private.public_appeal_information_requests;mail record;activated record;fresh_hash text:=repeat('d',64);
 flags jsonb:='{}';result jsonb;nonce_hash text:=repeat('5',64);
 kind text;ordinal integer:=0;cookie text;compose_nonce text;opened jsonb;plan jsonb;scan jsonb;documents jsonb:='{}';
 sha text:=encode(extensions.digest(convert_to('%PDF-1.7 information fixture','UTF8'),'sha256'),'hex');
begin
 select (value#>>'{frame,scope,caseId}')::uuid into v_case from public_appeal_prepared;
 begin
  perform pg_temp.final_case_reviewer_jwt();
  select to_jsonb(source) into before_intake from private.new_public_appeal_intakes source where source.id=v_case;
  select coalesce(jsonb_agg(to_jsonb(source) order by source.case_id),'[]') into before_holds from private.public_appeal_provisional_targets source;
  before_targets:=jsonb_build_object('subjects',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.subjects source),
   'cohorts',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.embryo_cohorts source));
  context:=public.read_public_appeal_case_context_v1(v_case);
  if not(context->'allowedDecisions' ? 'needs-more-information') then raise exception 'information option absent';end if;
  begin
   perform public.decide_public_appeal_case_v1(v_case,'needs-more-information',(context->>'reviewRevision')::bigint+1,
    (context->>'evidenceRevision')::bigint,nonce_hash,decode(repeat('ab',48),'hex'));
   raise exception 'stale information request accepted';exception when insufficient_privilege then null;end;
  begin
   perform public.decide_public_appeal_case_v1(v_case,'needs-more-information',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint+1,nonce_hash,decode(repeat('ab',48),'hex'));
   raise exception 'stale evidence information request accepted';exception when insufficient_privilege then null;end;
  result:=public.decide_public_appeal_case_v1(v_case,'needs-more-information',(context->>'reviewRevision')::bigint,
   (context->>'evidenceRevision')::bigint,nonce_hash,decode(repeat('ab',48),'hex'));
  select source.* into request from private.public_appeal_information_requests source where source.case_id=v_case;
  if result->>'state'<>'more_information_required' or result->>'outcome'<>'more_information_required'
   or (result->>'reviewRevision')::bigint<>(context->>'reviewRevision')::bigint+1
   or request.original_deadline<>(before_intake->>'deadline')::timestamptz
   or request.expires_at<>least(request.created_at+interval '7 days',request.original_deadline)
   or exists(select 1 from private.public_appeal_case_decisions outcome where outcome.case_id=v_case)
   or exists(select 1 from private.appeal_document_sessions session where session.intake_id=v_case and session.wrapped_document_key is not null)
   or exists(select 1 from public.rights_sessions rights where rights.target_kind='appeal-case' and rights.target_id=v_case and rights.purpose='appeal-evidence' and rights.status='active')
   then raise exception 'information request did not rotate only its own evidence';end if;
  flags:=flags||jsonb_build_object('nativeRotation',true);
  after_context:=public.read_public_appeal_case_context_v1(v_case);
  if after_context->'documents'<>'[]'::jsonb or (after_context->>'documentDecisionsAvailable')::boolean
   or (after_context->>'reviewRevision')::bigint<>(context->>'reviewRevision')::bigint+1 then raise exception 'old documents leaked into new set';end if;
  begin
   perform public.decide_public_appeal_case_v1(v_case,'needs-more-information',(context->>'reviewRevision')::bigint,
    (context->>'evidenceRevision')::bigint,nonce_hash,decode(repeat('ab',48),'hex'));
   raise exception 'stale replay accepted';exception when insufficient_privilege then null;end;
  begin
   perform public.decide_public_appeal_case_v1(v_case,'needs-more-information',(after_context->>'reviewRevision')::bigint,
    (after_context->>'evidenceRevision')::bigint,nonce_hash,decode(repeat('ab',48),'hex'));
   raise exception 'spent nonce accepted for fresh revisions';exception when unique_violation then null;end;
  if (select count(*) from private.public_appeal_information_requests source where source.case_id=v_case)<>1 then raise exception 'replay created a second request';end if;
  flags:=flags||jsonb_build_object('staleReplayAtomic',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select * into mail from public.claim_mail_outbox();
  if mail.outbox_id is distinct from request.outbox_id or not public.authorize_mail_submission_v1(mail.outbox_id,mail.attempt_ordinal)
   or public.read_new_public_appeal_mail_contact_v1(mail.outbox_id,mail.attempt_ordinal)->>'caseContactId' is distinct from before_intake->>'case_contact_id'
   then raise exception 'request did not use original recipient';end if;
  begin
   update public.mail_outbox source set recipient_principal_id='86000000-0000-4000-8000-000000000001' where source.id=mail.outbox_id;
   if public.authorize_mail_submission_v1(mail.outbox_id,mail.attempt_ordinal) then raise exception 'foreign recipient submission accepted';end if;
   raise exception using errcode='PZ003',message='restore wrong recipient';exception when sqlstate 'PZ003' then null;end;
  begin
   update private.new_public_appeal_reviewers set active=false where principal_id=(before_intake->>'reviewer_principal_id')::uuid;
   if public.authorize_mail_submission_v1(mail.outbox_id,mail.attempt_ordinal) then raise exception 'revoked reviewer submission accepted';end if;
   raise exception using errcode='PZ003',message='restore assignment';exception when sqlstate 'PZ003' then null;end;
  flags:=flags||jsonb_build_object('originalRecipientOnly',true);
  select * into activated from public.activate_rights_session_v1(encode(extensions.digest(convert_to(mail.delivery_token,'UTF8'),'sha256'),'hex'),fresh_hash,repeat('j',32));
  if activated.purpose is distinct from 'appeal-evidence' or activated.target_id is distinct from v_case
   or activated.expires_at>request.expires_at or activated.expires_at>clock_timestamp()+interval '60 minutes'
   then raise exception 'new evidence credential did not activate';end if;
  if exists(select 1 from public.activate_rights_session_v1(encode(extensions.digest(convert_to(mail.delivery_token,'UTF8'),'sha256'),'hex'),repeat('e',64),repeat('k',32)))
   then raise exception 'rotated credential replay accepted';end if;
  if (private.new_public_appeal_rights_at_v1(fresh_hash,false)).id is null
   or public.new_public_appeal_evidence_view_v1(fresh_hash)->>'informationRequested' is distinct from 'true'
   or public.new_public_appeal_evidence_view_v1(fresh_hash)->'documents'<>'[]'::jsonb
   then raise exception 'new evidence view not isolated';end if;
  if (private.new_public_appeal_rights_at_v1(repeat('1',64),false)).id is not null then raise exception 'old upload authority revived';end if;
  flags:=flags||jsonb_build_object('oneUseContinuation',true);
  -- Existing native byte reservation/composition and scan callbacks, rather
  -- than direct document inserts, produce this new round's current set.
  for kind in select unnest(array['appeal-photo-identity','appeal-subject-source-control']) loop
   ordinal:=ordinal+1;cookie:=pg_temp.h('information-upload:'||kind);compose_nonce:=pg_temp.h('information-compose:'||kind);
   opened:=public.open_public_appeal_document_v1(fresh_hash,repeat(chr(105+ordinal),32),kind,
    'application/pdf',octet_length('%PDF-1.7 information fixture'),sha,cookie,decode(repeat(lpad((50+ordinal)::text,2,'0'),72),'hex'));
   perform public.reserve_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,octet_length('%PDF-1.7 information fixture'),sha);
   perform public.settle_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,true);
   plan:=public.begin_claim_document_completion_v1((opened->>'session')::uuid,cookie,compose_nonce,1);
   perform public.finish_claim_document_completion_v1((opened->>'session')::uuid,cookie,compose_nonce,'composed',plan->>'objectKey');
   scan:=public.claim_next_appeal_document_scan_v1(pg_temp.h('information-scan:'||kind));
   if scan->>'documentId' is distinct from plan->>'documentId' then raise exception 'wrong new-round scan';end if;
   perform public.record_appeal_document_scan_v1((scan->>'documentId')::uuid,pg_temp.h('information-scan:'||kind),'OK',sha,
    'synthetic native test',1,clock_timestamp());
   documents:=documents||jsonb_build_object(case kind when 'appeal-photo-identity' then 'photoIdentityDocumentId' else 'subjectSourceControlDocumentId' end,plan->>'documentId');
  end loop;
  result:=public.complete_new_public_appeal_evidence_v1(fresh_hash,repeat('m',32),documents,true);
  perform pg_temp.final_case_reviewer_jwt();context:=public.read_public_appeal_case_context_v1(v_case);
  if result->>'status'<>'review_pending' or jsonb_array_length(context->'documents')<>2
   or not(context->>'documentDecisionsAvailable')::boolean
   or (context->>'reviewRevision')::bigint<>request.review_revision
   or (context->>'evidenceRevision')::bigint<>request.evidence_revision
   or (select pending.evidence_revision from private.public_appeal_pending_reviews pending where pending.case_id=v_case)<>request.evidence_revision
   or exists(select 1 from jsonb_array_elements(context->'documents') document where document->>'documentId' not in
    (documents->>'photoIdentityDocumentId',documents->>'subjectSourceControlDocumentId')) then
   raise exception 'new round not current named pending review';end if;
  flags:=flags||jsonb_build_object('newRoundPendingReview',true);

  -- Whole terminal cleanup is exercised inside this rollback: child token/
  -- delivery FKs must not prevent original key/contact disposal.
  perform pg_temp.final_case_reviewer_jwt();context:=public.read_public_appeal_case_context_v1(v_case);
  result:=public.decide_public_appeal_case_v1(v_case,'reject',(context->>'reviewRevision')::bigint,
   (context->>'evidenceRevision')::bigint,repeat('6',64),decode(repeat('ab',48),'hex'));
  if result->>'state'<>'resolved' or exists(select 1 from private.public_appeal_information_requests source where source.case_id=v_case)
   or exists(select 1 from public.token_candidates source where source.id=request.candidate_id)
   or exists(select 1 from public.mail_outbox source where source.id=request.outbox_id)
   or exists(select 1 from public.rights_sessions source where source.target_kind='appeal-case' and source.target_id=v_case)
   then raise exception 'information child cleanup failed';end if;
  flags:=flags||jsonb_build_object('terminalChildDisposal',true);
  raise exception using errcode='PZ003',message='restore complete original case';
 exception when sqlstate 'PZ003' then null;end;
 if (select to_jsonb(source) from private.new_public_appeal_intakes source where source.id=v_case) is distinct from before_intake
  or (select coalesce(jsonb_agg(to_jsonb(source) order by source.case_id),'[]') from private.public_appeal_provisional_targets source) is distinct from before_holds
  or jsonb_build_object('subjects',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.subjects source),
   'cohorts',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.embryo_cohorts source)) is distinct from before_targets
  then raise exception 'request changed original intake, holds or target rows';end if;
 flags:=flags||jsonb_build_object('originalAndTargetsRestored',true);
 return flags;
end $information_test$;
create temporary table appeal_information_result as select pg_temp.appeal_information_probe() value;
select ok((value->>'nativeRotation')::boolean,'current own-MFA request creates one nonfinal case-only candidate with immutable deadline and revokes old keys/authority') from appeal_information_result;
select ok((value->>'staleReplayAtomic')::boolean,'both stale revisions and spent nonce change no request, clock or evidence set') from appeal_information_result;
select ok((value->>'originalRecipientOnly')::boolean,'actual worker rejects foreign recipient and revoked reviewer without a delivered claim') from appeal_information_result;
select ok((value->>'oneUseContinuation')::boolean,'same verified recipient activates only once and sees only the new evidence set') from appeal_information_result;
select ok((value->>'newRoundPendingReview')::boolean,'new same-case reserved/composed/scanned files submit through the original complete gate to current named review') from appeal_information_result;
select ok((value->>'terminalChildDisposal')::boolean,'final refusal removes rotated child delivery/credentials before original case/contact disposal') from appeal_information_result;
select ok((value->>'originalAndTargetsRestored')::boolean,'rollback keeps complete original intake, existing holds and whole subjects/cohorts unchanged') from appeal_information_result;
select is((select count(*) from private.public_appeal_information_requests),0::bigint,'rollback leaves no information request or nonce');

-- An owner-only initially past/live pair isolates the fixed-clock predicate.
-- It is not a new producer/recipient-verification claim: real activation was
-- tested above. No immutable clock is rewritten and no trigger is disabled.
create function pg_temp.appeal_information_clock_fixture(p_past boolean) returns uuid language plpgsql as $clock_fixture$
declare original private.new_public_appeal_intakes;row_data jsonb;v_case uuid:=gen_random_uuid();author_id uuid:=gen_random_uuid();
 contact_id uuid:=gen_random_uuid();mail_id uuid:=gen_random_uuid();candidate_id uuid:=gen_random_uuid();token_id uuid:=gen_random_uuid();
 created timestamptz:=case when p_past then clock_timestamp()-interval '31 days' else clock_timestamp() end;
 token_time timestamptz;source_rights public.rights_sessions;
begin
 select source.* into original from private.new_public_appeal_intakes source where source.id=(select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared);
 select source.* into source_rights from public.rights_sessions source where source.session_hash=repeat('1',64);
 token_time:=created+interval '1 second';
 insert into public.subject_principals(id,principal_kind,principal_revision,status) values(author_id,'case_requester',1,'active');
 select to_jsonb(source) into row_data from public.encrypted_contact_references source where source.id=original.case_contact_id;
 row_data:=row_data||jsonb_build_object('id',contact_id,'principal_id',author_id,'created_at',created);
 insert into public.encrypted_contact_references select (jsonb_populate_record(null::public.encrypted_contact_references,row_data)).*;
 select to_jsonb(source) into row_data from public.mail_outbox source where source.id=original.outbox_id;
 row_data:=row_data||jsonb_build_object('id',mail_id,'target_id',v_case,'token_target_id',v_case,'recipient_principal_id',author_id,
  'contact_reference_id',contact_id,'created_at',created,'expires_at',created+interval '7 days',
  'idempotency_key',encode(extensions.digest(convert_to('clock-fixture|'||v_case,'UTF8'),'sha256'),'hex'));
 insert into public.mail_outbox select (jsonb_populate_record(null::public.mail_outbox,row_data)).*;
 select to_jsonb(source) into row_data from public.token_candidates source where source.id=original.candidate_id;
 row_data:=row_data||jsonb_build_object('id',candidate_id,'outbox_id',mail_id,'target_id',v_case,'expires_at',created+interval '7 days');
 insert into public.token_candidates select (jsonb_populate_record(null::public.token_candidates,row_data)).*;
 select to_jsonb(source) into row_data from public.token_hashes source where source.id=source_rights.token_hash_id;
 row_data:=row_data||jsonb_build_object('id',token_id,'candidate_id',candidate_id,'created_at',token_time,'ended_at',token_time+interval '1 second',
  'token_hash',encode(extensions.digest(convert_to('clock-token|'||v_case,'UTF8'),'sha256'),'hex'));
 insert into public.token_hashes select (jsonb_populate_record(null::public.token_hashes,row_data)).*;
 row_data:=to_jsonb(source_rights)||jsonb_build_object('id',gen_random_uuid(),'target_id',v_case,'principal_id',author_id,
  'token_hash_id',token_id,'created_at',token_time+interval '1 second','last_activity_at',token_time+interval '2 seconds',
  'expires_at',token_time+interval '60 minutes','ended_at',token_time+interval '2 seconds',
  'session_hash',encode(extensions.digest(convert_to('clock-rights|'||v_case,'UTF8'),'sha256'),'hex'));
 insert into public.rights_sessions select (jsonb_populate_record(null::public.rights_sessions,row_data)).*;
 row_data:=to_jsonb(original)||jsonb_build_object('id',v_case,'author_principal_id',author_id,'case_contact_id',contact_id,
  'outbox_id',mail_id,'candidate_id',candidate_id,'submitted_at',created,'prepare_expires_at',created+interval '10 minutes','deadline',created+interval '30 days',
  'form_nonce_hash',encode(extensions.digest(convert_to('clock-form|'||v_case,'UTF8'),'sha256'),'hex'),
  'frame',jsonb_set(jsonb_set(jsonb_set(jsonb_set(original.frame,'{scope,caseId}',to_jsonb(v_case)),
    '{scope,originalAuthorPrincipalId}',to_jsonb(author_id)),'{scope,originalSubmittedAt}',to_jsonb(created)),
    '{scope,originalDeadline}',to_jsonb(created+interval '30 days')));
 insert into private.new_public_appeal_intakes select (jsonb_populate_record(null::private.new_public_appeal_intakes,row_data)).*;
 select to_jsonb(source) into row_data from public.appeal_intakes source where source.id=original.id;
 row_data:=row_data||jsonb_build_object('id',v_case,'target_id',v_case,'appellant_principal_id',author_id);
 insert into public.appeal_intakes select (jsonb_populate_record(null::public.appeal_intakes,row_data)).*;
 return v_case;
end $clock_fixture$;
create function pg_temp.appeal_information_deadline_probe() returns boolean language plpgsql as $clock_probe$
declare live_id uuid;expired_id uuid;context jsonb;passed boolean:=false;
begin
 begin
  live_id:=pg_temp.appeal_information_clock_fixture(false);expired_id:=pg_temp.appeal_information_clock_fixture(true);
  perform pg_temp.final_case_reviewer_jwt();
  context:=public.read_public_appeal_case_context_v1(live_id);
  if context->>'caseId' is distinct from live_id::text then raise exception 'live control shape unavailable';end if;
  begin
   perform public.decide_public_appeal_case_v1(expired_id,'needs-more-information',1,1,repeat('7',64),decode(repeat('ab',48),'hex'));
   raise exception 'past original clock renewed';exception when insufficient_privilege then null;end;
  if exists(select 1 from private.public_appeal_information_requests request where request.case_id=expired_id)
   or exists(select 1 from public.mail_outbox mail where mail.target_id=expired_id and mail.semantic_revision>1)
   then raise exception 'expired fixture received new authority';end if;
  passed:=true;raise exception using errcode='PZ004',message='restore initially expired clock fixtures';
 exception when sqlstate 'PZ004' then null;end;
 return passed;
end $clock_probe$;
select ok(pg_temp.appeal_information_deadline_probe(),'same-shaped live control admits review while an initially past immutable case refuses rotation with no new candidate');

-- Snapshot the otherwise-valid pipeline above before any final correction.
-- The owner-only clock copies preserve its actual native nonce, recipient,
-- source, three positive scans, whole challenged ACKs and reviewer decisions.
-- No provider/cryptographic acceptance is implied by synthetic native rows.
create function pg_temp.appeal_reversal_clock_graph(p_case uuid) returns jsonb language sql as $clock_graph$
 select jsonb_build_object(
 'public.subject_principals',(select jsonb_agg(to_jsonb(r) order by r.id) from public.subject_principals r
  where r.id in((select author_principal_id from private.new_public_appeal_intakes where id=p_case),
   (select reviewer_principal_id from private.new_public_appeal_intakes where id=p_case))),
 'public.encrypted_contact_references',(select jsonb_agg(to_jsonb(r) order by r.id) from public.encrypted_contact_references r
  where r.id=(select case_contact_id from private.new_public_appeal_intakes where id=p_case)),
 'public.contact_hmac_indexes',(select jsonb_agg(to_jsonb(r) order by r.hmac_key_revision) from public.contact_hmac_indexes r
  where r.contact_reference_id=(select case_contact_id from private.new_public_appeal_intakes where id=p_case)),
 'public.mail_outbox',(select jsonb_agg(to_jsonb(r) order by r.id) from public.mail_outbox r
  where r.id=(select outbox_id from private.new_public_appeal_intakes where id=p_case)),
 'public.token_candidates',(select jsonb_agg(to_jsonb(r) order by r.id) from public.token_candidates r
  where r.id=(select candidate_id from private.new_public_appeal_intakes where id=p_case)),
 'public.token_hashes',(select jsonb_agg(to_jsonb(r) order by r.id) from public.token_hashes r
  where r.candidate_id=(select candidate_id from private.new_public_appeal_intakes where id=p_case)),
 'private.new_public_appeal_intakes',(select jsonb_agg(to_jsonb(r) order by r.id) from private.new_public_appeal_intakes r where r.id=p_case),
 'public.appeal_intakes',(select jsonb_agg(to_jsonb(r) order by r.id) from public.appeal_intakes r where r.id=p_case),
 'private.new_public_appeal_evidence_state',(select jsonb_agg(to_jsonb(r) order by r.case_id) from private.new_public_appeal_evidence_state r where r.case_id=p_case),
 'public.rights_sessions',(select jsonb_agg(to_jsonb(r) order by r.id) from public.rights_sessions r where r.target_kind='appeal-case' and r.target_id=p_case),
 'private.appeal_document_sessions',(select jsonb_agg(to_jsonb(r) order by r.id) from private.appeal_document_sessions r where r.intake_id=p_case),
 'private.appeal_document_fragments',(select jsonb_agg(to_jsonb(r) order by r.session_id,r.sequence) from private.appeal_document_fragments r
  where r.session_id in(select id from private.appeal_document_sessions where intake_id=p_case)),
 'private.appeal_documents',(select jsonb_agg(to_jsonb(r) order by r.id) from private.appeal_documents r where r.intake_id=p_case),
 'private.public_appeal_pending_reviews',(select jsonb_agg(to_jsonb(r) order by r.case_id) from private.public_appeal_pending_reviews r where r.case_id=p_case),
 'private.public_appeal_review_downloads',(select jsonb_agg(to_jsonb(r) order by r.id) from private.public_appeal_review_downloads r where r.case_id=p_case),
 'private.public_appeal_review_chunks',(select jsonb_agg(to_jsonb(r) order by r.download_id,r.sequence) from private.public_appeal_review_chunks r
  where r.download_id in(select id from private.public_appeal_review_downloads where case_id=p_case)),
 'private.public_appeal_document_decisions',(select jsonb_agg(to_jsonb(r) order by r.id) from private.public_appeal_document_decisions r where r.case_id=p_case));
$clock_graph$;

create function pg_temp.appeal_reversal_clock_fixture(p_graph jsonb,p_past boolean) returns jsonb language plpgsql as $clock_fixture$
declare table_name text;source_row jsonb;row_data jsonb;field_name text;rows jsonb;expected jsonb:='{}';
 shift_by interval:=case when p_past then interval '31 days' else interval '0 days' end;columns_list text;
 tables text[]:=array['public.subject_principals','public.encrypted_contact_references','public.contact_hmac_indexes',
 'public.mail_outbox','public.token_candidates','public.token_hashes','private.new_public_appeal_intakes','public.appeal_intakes',
 'private.new_public_appeal_evidence_state','public.rights_sessions','private.appeal_document_sessions','private.appeal_document_fragments',
 'private.appeal_documents','private.public_appeal_pending_reviews','private.public_appeal_review_downloads',
 'private.public_appeal_review_chunks','private.public_appeal_document_decisions'];
begin
 -- This is one fixed test-case graph, not a producer or arbitrary table restore.
 if (select array_agg(key order by key) from jsonb_object_keys(p_graph) key)
  is distinct from (select array_agg(name order by name) from unnest(tables) name) then raise exception 'clock graph scope differs';end if;
 perform private.grant_claim_reviewer_v1('7a000000-0000-0000-0000-000000000002');
 foreach table_name in array tables loop
  rows:='[]';
  for source_row in select value from jsonb_array_elements(coalesce(nullif(p_graph->table_name,'null'::jsonb),'[]')) loop
   row_data:=source_row;
   -- All relational clocks move together at INSERT, preserving their exact
   -- intervals. IDs, bytes, proofs, decisions and prior source binding do not.
   for field_name in select attname from pg_catalog.pg_attribute
    where attrelid=table_name::regclass and attnum>0 and not attisdropped and atttypid='timestamptz'::regtype loop
    if row_data->>field_name is not null then
     row_data:=jsonb_set(row_data,array[field_name],to_jsonb((row_data->>field_name)::timestamptz-shift_by));end if;
   end loop;
   if p_past and table_name='private.new_public_appeal_intakes' then
    row_data:=jsonb_set(jsonb_set(row_data,'{frame,scope,originalSubmittedAt}',
     to_jsonb(to_char((row_data->>'submitted_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
     '{frame,scope,originalDeadline}',to_jsonb(to_char((row_data->>'deadline')::timestamptz at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));end if;
   rows:=rows||jsonb_build_array(row_data);
   if table_name='private.appeal_documents' then
    -- Keep the real INSERT/scan transition guard enabled. Recreate the
    -- snapshot's already-proved positive scan via its existing owner GUC;
    -- no new scan/provider or whole-byte delivery is claimed here.
    execute format('insert into %s select (jsonb_populate_record(null::%s,$1)).*',table_name::regclass,table_name::regclass)
     using row_data||jsonb_build_object('state','quarantined','scan_verdict',null,'scanned_sha256',null,
      'scan_engine',null,'scan_signature_version',null,'scan_signature_at',null,'scanned_at',null);
    perform set_config('inherit.appeal_document_scan',row_data->>'id',true);
    select string_agg(quote_ident(attname),',' order by attnum) into columns_list from pg_catalog.pg_attribute
     where attrelid=table_name::regclass and attnum>0 and not attisdropped;
    execute format('update %s set (%s)=(select %s from jsonb_populate_record(null::%s,$1)) where id=($1->>''id'')::uuid',
     table_name::regclass,columns_list,columns_list,table_name::regclass) using row_data;
    perform set_config('inherit.appeal_document_scan','',true);
   else
    execute format('insert into %s select (jsonb_populate_record(null::%s,$1)).*',table_name::regclass,table_name::regclass) using row_data;
   end if;
  end loop;
  expected:=expected||jsonb_build_object(table_name,case when rows='[]'::jsonb then 'null'::jsonb else rows end);
  if table_name='public.subject_principals' then
   insert into private.new_public_appeal_reviewers(principal_id,principal_revision,purpose_revision)
    values('86000000-0000-4000-8000-000000000002',1,1);end if;
 end loop;
 return expected;
end $clock_fixture$;

create function pg_temp.appeal_reversal_deadline_probe() returns jsonb language plpgsql as $clock_probe$
declare fixture jsonb;graph jsonb;expected jsonb;context jsonb;receipt jsonb;v_case uuid;binding jsonb;
 p_past boolean;before_outcomes jsonb;before_targets jsonb;result jsonb:='{}';
begin
 begin
  fixture:=pg_temp.prior_appeal_reverse_probe(false,false,false,true);
  v_case:=(fixture->>'fixtureCaseId')::uuid;context:=fixture->'context';
  graph:=pg_temp.appeal_reversal_clock_graph(v_case);
  if jsonb_array_length(graph->'private.appeal_documents')<>3
   or jsonb_array_length(graph->'private.public_appeal_document_decisions')<>3
   or jsonb_array_length(graph->'private.public_appeal_review_chunks')<>3
   or exists(select 1 from jsonb_array_elements(graph->'private.public_appeal_review_chunks') chunk
    where chunk->>'acknowledged_at' is null or chunk->>'expected_proof' is null or chunk->>'nonce_hash' is null)
   then raise exception 'clock fixture lacks actual whole-byte ACK pipeline';end if;
  raise exception using errcode='PZ004',message='restore complete native clock snapshot';
 exception when sqlstate 'PZ004' then null;end;
 -- Both copies reuse the same exact real source outcome and reviewer/account
 -- independence. Their only difference is coherent clocks declared at INSERT.
 foreach p_past in array array[false,true] loop
  begin
   expected:=pg_temp.appeal_reversal_clock_fixture(graph,p_past);
   if pg_temp.appeal_reversal_clock_graph(v_case) is distinct from expected then
    raise exception 'complete copied clock graph differs';end if;
   perform pg_temp.prior_appeal_reviewer_jwt();
   select private.public_appeal_underlying_binding_v1(source.frame#>>'{underlyingDecision,decisionReferenceHash}',source.frame->'contactDigests')
    into binding from private.new_public_appeal_intakes source where source.id=v_case;
   if binding is distinct from context->'priorDecision' then raise exception 'otherwise-current original prior binding differs';end if;
   select coalesce(jsonb_agg(to_jsonb(source) order by source.case_id),'[]') into before_outcomes from private.public_appeal_case_decisions source;
   select jsonb_build_object('profiles',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.profiles source),
    'files',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.genome_files source),
    'subjects',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.subjects source),
    'cohorts',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.embryo_cohorts source),
    'prior',(select to_jsonb(source) from private.public_appeal_document_decisions source where source.id=(binding->>'decisionId')::uuid)) into before_targets;
   if not p_past then
    if public.read_public_appeal_case_context_v1(v_case) is distinct from context then raise exception 'live complete control differs';end if;
    receipt:=public.reverse_public_appeal_prior_decision_v1(v_case,(binding->>'decisionRevision')::bigint,(context->>'reviewRevision')::bigint,
     (context->>'evidenceRevision')::bigint,repeat('7',64),decode(repeat('ab',48),'hex'));
    if receipt is distinct from jsonb_build_object('caseId',v_case,'state','resolved','outcome','prior_decision_reversed',
     'reviewRevision',(context->>'reviewRevision')::bigint+1) then raise exception 'live full control failed reversal';end if;
    result:=result||jsonb_build_object('liveCompleteReversal',true);
   else
    begin
     perform public.reverse_public_appeal_prior_decision_v1(v_case,(binding->>'decisionRevision')::bigint,(context->>'reviewRevision')::bigint,
      (context->>'evidenceRevision')::bigint,repeat('7',64),decode(repeat('ab',48),'hex'));
     raise exception 'expired complete original case admitted correction';exception when insufficient_privilege then null;end;
    if pg_temp.appeal_reversal_clock_graph(v_case) is distinct from expected
     or before_outcomes is distinct from (select coalesce(jsonb_agg(to_jsonb(source) order by source.case_id),'[]') from private.public_appeal_case_decisions source)
     then raise exception 'expired refusal changed a complete case row or outcome/nonce';end if;
    result:=result||jsonb_build_object('expiredCompleteRefusal',true);
   end if;
   if before_targets is distinct from jsonb_build_object(
    'profiles',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.profiles source),
    'files',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.genome_files source),
    'subjects',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.subjects source),
    'cohorts',(select coalesce(jsonb_agg(to_jsonb(source) order by source.id),'[]') from public.embryo_cohorts source),
    'prior',(select to_jsonb(source) from private.public_appeal_document_decisions source where source.id=(binding->>'decisionId')::uuid))
    then raise exception 'clock probe changed original decision or target bags';end if;
   raise exception using errcode='PZ004',message='restore complete live/past reversal clock fixture';
  exception when sqlstate 'PZ004' then null;end;
 end loop;
 return result;
end $clock_probe$;
create temporary table appeal_reversal_clock_result as select pg_temp.appeal_reversal_deadline_probe() value;
select ok((value->>'liveCompleteReversal')::boolean,'otherwise-valid native originating evidence, independent reviewer and all three whole ACKs actually permit the live reversal') from appeal_reversal_clock_result;
select ok((value->>'expiredCompleteRefusal')::boolean,'the identical complete pipeline with initially past immutable clocks refuses reversal and preserves every case row, outcome/nonce, original decision and target bag') from appeal_reversal_clock_result;

select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name
 where has_table_privilege(role_name,'private.public_appeal_information_requests','select,insert,update,delete')
  or has_function_privilege(role_name,'public.decide_public_appeal_case_before_information_v1(uuid,text,bigint,bigint,text,bytea)','execute')),
 0::bigint,'API roles cannot choose a recipient/deadline or bypass the current native dispatcher');

select pg_temp.final_case_reviewer_jwt();
create temporary table final_case_context as select public.read_public_appeal_case_context_v1(
 (select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared)) value;
select throws_ok($$select public.decide_public_appeal_case_v1((select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared),
 'approve-access',(select (value->>'reviewRevision')::bigint from final_case_context),
 (select (value->>'evidenceRevision')::bigint from final_case_context),repeat('8',64),decode(repeat('ab',48),'hex'))$$,
 '42501','appeal unavailable','final rejection cannot be used to approve access or infer target authority');
select throws_ok($$select public.decide_public_appeal_case_v1((select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared),
 'reject',(select (value->>'reviewRevision')::bigint+1 from final_case_context),
 (select (value->>'evidenceRevision')::bigint from final_case_context),repeat('8',64),decode(repeat('ab',48),'hex'))$$,
 '42501','appeal unavailable','stale final review revision records no outcome or nonce');
select throws_ok($$select public.decide_public_appeal_case_v1((select (value#>>'{frame,scope,caseId}')::uuid from public_appeal_prepared),
 'reject',(select (value->>'reviewRevision')::bigint from final_case_context),
 (select (value->>'evidenceRevision')::bigint+1 from final_case_context),repeat('8',64),decode(repeat('ab',48),'hex'))$$,
 '42501','appeal unavailable','stale final evidence revision records no outcome or nonce');
select throws_ok($$select pg_temp.deletion_probe('update private.new_public_appeal_reviewers set active=false',
 'select public.decide_public_appeal_case_v1((select (value#>>''{frame,scope,caseId}'')::uuid from public_appeal_prepared),''reject'',
 (select (value->>''reviewRevision'')::bigint from final_case_context),(select (value->>''evidenceRevision'')::bigint from final_case_context),
 repeat(''8'',64),decode(repeat(''ab'',48),''hex''))')$$,'42501','appeal unavailable','revoked final named assignment refuses atomically');
select is((select count(*) from private.public_appeal_case_decisions),0::bigint,'all refused final branches leave complete outcome and nonce rows empty');
select ok(pg_temp.final_case_rejection_probe(),'final rejection after real documentary decisions clears credentials, keys and hold with zero target effects');
select ok((select bool_and(intake.state='committed' and intake.wrapped_case_key is not null) from private.new_public_appeal_intakes intake),
 'full-case rejection subtransaction restores the unchanged original native source');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only']) role_name
 where has_table_privilege(role_name,'private.public_appeal_case_decisions','select,insert,update,delete')
 or has_function_privilege(role_name,'private.public_appeal_case_review_at_v1(uuid)','execute')),0::bigint,
 'API roles cannot forge a final reviewer outcome or bypass native currentness');
select ok(has_function_privilege('authenticated','public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea)','execute')
 and not has_function_privilege('service_role','public.decide_public_appeal_case_v1(uuid,text,bigint,bigint,text,bytea)','execute'),
 'only the own-JWT review route has a final native door; server owner callbacks cannot replace the human');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.appeal_intakes set state='withdrawn',decided_at=clock_timestamp() where target_kind='public_case';
select is((select count(*) from private.public_appeal_pending_reviews),0::bigint,'terminal disposition disposes the live assignment and document links');
select is((select count(*) from private.appeal_document_sessions where wrapped_document_key is not null),0::bigint,
 'terminal case shreds every independent evidence key');
select is((select count(*) from private.new_public_appeal_intakes where wrapped_case_key is not null),0::bigint,
 'original case key, contact and working package are disposed separately');
select is((select count(*) from private.public_appeal_decision_notices),0::bigint,'terminal disposal removes every late notice and separate credential');
select is((select count(*) from public.mail_outbox where purpose='appeal-decision-notice'),0::bigint,'terminal disposal removes the neutral pending notice delivery rows');
select is((select count(*) from public.rights_sessions where purpose='appeal-decision-notice'),0::bigint,'terminal disposal invalidates notice sessions before the original case key disappears');
select is((select count(*) from private.appeal_documents),2::bigint,'native object locators remain until real physical deletion acknowledgement');
select ok(not has_table_privilege('service_role','private.public_appeal_pending_reviews','insert,update,delete')
 and not has_function_privilege('authenticated','public.complete_new_public_appeal_evidence_v1(text,text,jsonb,boolean)','execute'),
 'neither browser nor server table client can forge a named review or document set');
select finish();rollback;
