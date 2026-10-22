begin;
set local search_path=public,extensions;
select no_plan();
-- Named human correction review (api.future-person-correction-review).
-- Synthetic data only; everything rolls back.
select ok(has_function_privilege('authenticated','public.read_future_person_correction_review_v1(uuid)','execute')
 and has_function_privilege('authenticated','public.decide_future_person_correction_review_v1(uuid,text,bigint,jsonb,text,bytea)','execute')
 and not has_function_privilege('anon','public.read_future_person_correction_review_v1(uuid)','execute')
 and not has_function_privilege('service_role','public.read_future_person_correction_review_v1(uuid)','execute')
 and not has_function_privilege('service_role','public.decide_future_person_correction_review_v1(uuid,text,bigint,jsonb,text,bytea)','execute')
 and not has_function_privilege('inherit_upload_only','public.check_future_person_correction_review_v1(uuid,jsonb)','execute'),
 'only a reviewer''s own JWT reaches the review doors');
select is((select count(*) from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r
 where has_function_privilege(r,'private.correction_review_context_v1(uuid)','execute')
  or has_function_privilege(r,'private.correction_review_provenance_v1(uuid,text)','execute')),0::bigint,
 'the private case reader is unexposed');
\ir fixtures/future_person_deletion_authority.inc
-- One genuine committed correction through the existing intake doors.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update private.new_correction_intake_config set enabled=true where singleton;
insert into public.subject_principals(id,account_id,principal_kind) values
 ('84000000-0000-4000-8000-000000000001','7a000000-0000-0000-0000-000000000001','reviewer');
insert into private.new_correction_reviewers(principal_id,principal_revision,purpose_revision) values
 ('84000000-0000-4000-8000-000000000001',1,1);
create temporary table review_frame as select public.prepare_new_correction_v1(
 pg_temp.h('deletion-rights'),'correction-review-own-aaaaaaaa','display-label')value;
select public.read_new_correction_intake_contact_v1(pg_temp.h('deletion-rights'),'correction-review-own-aaaaaaaa',
 (select value from review_frame));
create temporary table review_case as select (public.commit_new_correction_v1(
 pg_temp.h('deletion-rights'),'correction-review-own-aaaaaaaa',(select value from review_frame),
 decode(repeat('ab',48),'hex'),decode(repeat('cd',48),'hex'),decode(repeat('de',72),'hex'),
 decode(repeat('ef',48),'hex'),jsonb_build_object('1',pg_temp.h('contact')))->>'correctionId')::uuid id;
select throws_ok($$select public.read_future_person_correction_review_v1((select id from review_case))$$,
 '42501','not_found','a service credential is not a named reviewer');
create function pg_temp.reviewer(p_mfa_age integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','7a000000-0000-0000-0000-000000000001',
  'role','authenticated','session_id','7a000000-0000-4000-8000-0000000000a1','aal','aal2',
  'iss','http://127.0.0.1:54321/auth/v1','aud','authenticated','exp',extract(epoch from clock_timestamp())::bigint+3600,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from clock_timestamp())::bigint-p_mfa_age)))::text,true);
$$;
create function pg_temp.probe(p_setup text,p_call text) returns text language plpgsql as $$
declare result text;begin
 begin execute p_setup;execute p_call into result;raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;end;return result;end $$;
select pg_temp.reviewer(1800);
select throws_ok($$select public.read_future_person_correction_review_v1((select id from review_case))$$,
 '42501','not_found','an MFA step-up older than 15 minutes refuses');
select pg_temp.reviewer(60);
select throws_ok($$select public.read_future_person_correction_review_v1(gen_random_uuid())$$,
 '42501','not_found','an unknown case is the same opaque refusal');
select throws_ok($$select pg_temp.probe('update private.new_correction_intake_config set enabled=false',
 'select public.read_future_person_correction_review_v1((select id from review_case))')$$,
 '42501','not_found','the closed native switch refuses the read');
select throws_ok($$select pg_temp.probe('update private.new_correction_reviewers set active=false',
 'select public.read_future_person_correction_review_v1((select id from review_case))')$$,
 '42501','not_found','a revoked correction reviewer purpose refuses');
select throws_ok($$select pg_temp.probe('select private.revoke_claim_reviewer_v1(''7a000000-0000-0000-0000-000000000001'')',
 'select public.read_future_person_correction_review_v1((select id from review_case))')$$,
 '42501','not_found','a revoked claim reviewer standing refuses');
select throws_ok($$select pg_temp.probe('update public.subject_principals set principal_revision=principal_revision+1 where id=''84000000-0000-4000-8000-000000000001''',
 'select public.read_future_person_correction_review_v1((select id from review_case))')$$,
 '42501','not_found','a changed reviewer principal revision refuses');
select throws_ok($$select pg_temp.probe('alter table private.new_correction_intakes disable trigger guard_new_correction_intake;
 update private.new_correction_intakes set deadline=date_trunc(''milliseconds'',clock_timestamp())-interval ''1 second'',
  frame=jsonb_set(frame,''{scope,originalDeadline}'',to_jsonb(to_char((date_trunc(''milliseconds'',clock_timestamp())-interval ''1 second'') at time zone ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')))
  where id=(select id from review_case)',
 'select public.read_future_person_correction_review_v1((select id from review_case))')$$,
 '42501','not_found','a case past its fixed 30-day deadline refuses');
create temporary table audit_before as select count(*) n from public.legal_audit_log where event_code='correction.review.read';
create temporary table review_read as select public.read_future_person_correction_review_v1((select id from review_case)) value;
select is((select count(*) from public.legal_audit_log where event_code='correction.review.read'
 and route_id='api.future-person-correction-review'),(select n+1 from audit_before),'every read appends one ledger event');
select is((select value->>'correctionId' from review_read),(select id::text from review_case),'the read names the assigned case');
select is((select value->>'field' from review_read),'display-label','the requested field is returned');
select is((select (value->>'correctionRevision')::int from review_read),1,'the correction revision is current');
select is((select (value->>'reviewRevision')::int from review_read),0,'no decision exists yet');
select is((select (value->'provenance')-'sourceDigest' from review_read),
 '{"fieldVersion":1,"sourceKind":"neutral-display-label","provenanceRevision":1,"affectedResultCount":0,"analysisStopped":false}'::jsonb,
 'a label correction affects no result and nothing has been approved');
select ok((select value#>>'{provenance,sourceDigest}' ~ '^[0-9a-f]{64}$' from review_read),'the source digest is opaque');
select is((select value#>>'{envelope,statementCiphertextHex}' from review_read),repeat('ab',48),
 'the sealed original statement is handed only to the named reviewer');
select is((select value#>>'{binding,actor,accountId}' from review_read),'7a000000-0000-0000-0000-000000000001',
 'the binding names the reviewer''s own account');
select ok(public.check_future_person_correction_review_v1((select id from review_case),(select value->'binding' from review_read)),
 'the unaudited recheck accepts the unchanged binding');
select ok(not public.check_future_person_correction_review_v1((select id from review_case),
 (select jsonb_set(value->'binding','{sourceHash}',to_jsonb(repeat('0',64))) from review_read)),
 'the recheck refuses a different source');
select is((select value-'sourceDigest'-'sourceKind'-'fieldVersion'-'provenanceRevision' from (
 select private.correction_review_provenance_v1((select subject from custody_ids),'variant-call-source') value)x),
 jsonb_build_object('affectedResultCount',(select count(*) from public.report_artifacts r join private.future_person_custody_slices x
   on x.subject_id=r.subject_id and x.source_sha256=r.source_binding_fingerprint where r.subject_id=(select subject from custody_ids))
  +(select count(*) from public.embryo_scores s join public.embryos e on e.id=s.embryo_id join private.future_person_custody_slices x
   on x.subject_id=e.subject_id and x.source_sha256=s.source_binding_fingerprint where e.subject_id=(select subject from custody_ids)),
  'analysisStopped',false),'a disputed source call counts every result bound to the canonical source');
select is(private.correction_review_provenance_v1((select subject from custody_ids),'variant-call-source')->>'sourceKind',
 'imported-variant-source','the source call field is the imported variant source');
-- Decisions.
create function pg_temp.decide(p_decision text,p_revision bigint,p_binding jsonb,p_nonce text) returns jsonb language sql as $$
 select public.decide_future_person_correction_review_v1((select id from review_case),p_decision,p_revision,p_binding,
  pg_temp.h(p_nonce),decode(repeat('9a',64),'hex'));
$$;
select throws_ok($$select pg_temp.decide('approve',1,(select value->'binding' from review_read),'approve-1')$$,
 '42501','not_found','approval is refused while its effect is undecided');
select throws_ok($$select pg_temp.decide('rejected-documentary-conflict',1,(select value->'binding' from review_read),'other-1')$$,
 '42501','not_found','an unregistered decision refuses');
select throws_ok($$select pg_temp.decide('reject',2,(select value->'binding' from review_read),'stale-1')$$,
 '42501','not_found','a stale correction revision refuses');
select throws_ok($$select pg_temp.decide('reject',1,(select jsonb_set(value->'binding','{assignmentRevision}','2') from review_read),'foreign-1')$$,
 '42501','not_found','a binding from another assignment refuses');
select throws_ok($$select public.decide_future_person_correction_review_v1((select id from review_case),'reject',1,
 (select value->'binding' from review_read),pg_temp.h('short'),decode('00','hex'))$$,
 '42501','not_found','a reason that is not a sealed envelope refuses');
select is((select count(*) from public.correction_assignments where correction_id=(select id from review_case)),0::bigint,
 'no refused decision wrote a row');
select is(pg_temp.decide('needs-more-information',1,(select value->'binding' from review_read),'more-1'),
 jsonb_build_object('correctionId',(select id from review_case),'state','more_information_required','reviewRevision',1),
 'a request for more information is a new committed review revision');
select is((select state from public.correction_requests where id=(select id from review_case)),'reviewing',
 'the request stays open for a later decision');
select ok((select state='committed' and wrapped_case_key is not null from private.new_correction_intakes where id=(select id from review_case))
 and exists(select 1 from public.correction_working_data where correction_id=(select id from review_case)),
 'an open request keeps its sealed package');
select is((select reason_code||'|'||decision||'|'||(reason_ciphertext is not null)::text from public.correction_assignments
 where correction_id=(select id from review_case)),'more_information_required|more_information|true',
 'the coded outcome and the sealed reason are stored');
select is((select (frame#>>'{scope,originalDeadline}')::timestamptz=deadline from private.new_correction_intakes
 where id=(select id from review_case)),true,'the original deadline is unchanged');
select throws_ok($$select pg_temp.decide('reject',1,(select value->'binding' from review_read),'reject-old')$$,
 '42501','not_found','the binding read before the last decision is stale');
create temporary table review_read_2 as select public.read_future_person_correction_review_v1((select id from review_case)) value;
select is((select (value->>'reviewRevision')::int from review_read_2),1,'the next read sees the committed revision');
select throws_ok($$select pg_temp.decide('reject',1,(select value->'binding' from review_read_2),'more-1')$$,
 '42501','not_found','a decision nonce is consumed once');
select is(pg_temp.decide('reject',1,(select value->'binding' from review_read_2),'reject-1'),
 jsonb_build_object('correctionId',(select id from review_case),'state','rejected','reviewRevision',2),
 'a rejection closes the request at the next revision');
select ok((select state='rejected' and decided_at is not null and statement_ciphertext=''::bytea from public.correction_requests
 where id=(select id from review_case)),'the rejected request is final and its statement is shredded');
select ok((select state='closed' and wrapped_case_key is null from private.new_correction_intakes where id=(select id from review_case))
 and not exists(select 1 from public.correction_working_data where correction_id=(select id from review_case)),
 'final resolution crypto-shreds the case key and working package');
select is((select count(*) from public.correction_assignments where correction_id=(select id from review_case)
 and reason_ciphertext is null),2::bigint,'every reviewer reason is shredded at final resolution');
select is((select string_agg(reason_code,',' order by review_revision) from public.correction_assignments
 where correction_id=(select id from review_case)),'more_information_required,rejected','only the coded versioned outcomes remain');
select is((select count(*) from public.subjects where id=(select subject from custody_ids)
 and lifecycle='claimed_unbound' and analysis_stopped_at is null),1::bigint,'no decision mutates the subject');
select throws_ok($$select public.read_future_person_correction_review_v1((select id from review_case))$$,
 '42501','not_found','a resolved case can no longer be read');
select is((select count(*) from public.legal_audit_log where event_code='correction.review.decided'
 and route_id='api.future-person-correction-review'),2::bigint,'each decision appends one coded ledger event');
select finish();
rollback;
