begin;
select no_plan();
-- The complete real producer/provider/account-objection predecessor is
-- retained. Synthetic ciphertext and receipt metadata below prove SQL
-- authority only, never human, browser, document-byte or provider delivery.
\ir fixtures/future_person_keyless_objection.inc
create temporary table current_objection as select id,claim_id,notice_id,objection_revision
  from public.future_person_claim_objections;
grant select on current_objection to authenticated;
select is((select review_revision from private.claim_reviews),3::bigint,
  'the genuine accepted owner objection advanced the review exactly once');
set local role authenticated;
select lives_ok($$select public.read_keyless_review_operation_v1((select id from current_objection),'claim-objection')$$,
  'the same actual named reviewer can read only the new objection operation');
select throws_ok($$select public.decide_keyless_objection_v1((select id from current_objection),1,3,2,
  'overrule-objection',pg_temp.keyless_hash('decision-without-new-bytes'),extensions.gen_random_bytes(64))$$,
  '42501','claim review unavailable','the old documentary receipts cannot authorize the new decision');
reset role;
insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision,document_id,chunk_sequence,
  assignment_revision,document_sha256,delivery_verified_at,account_auth_session_revision,originating_session_revision)
  select review,'7a000000-0000-0000-0000-000000000001'::uuid,'7a000000-0000-4000-8000-0000000000a1'::uuid,3,
    photo,0,2,pg_temp.keyless_hash('photo'),clock_timestamp(),1,1 from keyless_ids;
set local role authenticated;
select throws_ok($$select public.decide_keyless_objection_v1((select id from current_objection),1,3,2,
  'overrule-objection',pg_temp.keyless_hash('decision-with-one-document'),extensions.gen_random_bytes(64))$$,
  '42501','claim review unavailable','one newly complete document still cannot authorize the decision');
reset role;
insert into private.claim_review_reads(review_id,reviewer_account_id,auth_session_id,review_revision,document_id,chunk_sequence,
  assignment_revision,document_sha256,delivery_verified_at,account_auth_session_revision,originating_session_revision)
  select review,'7a000000-0000-0000-0000-000000000001'::uuid,'7a000000-0000-4000-8000-0000000000a1'::uuid,3,
    birth,0,2,pg_temp.keyless_hash('birth'),clock_timestamp(),1,1 from keyless_ids;
-- Branch probes invoke the genuine public decision, capture its exact
-- resulting rows, then roll back the subtransaction. TAP assertions remain
-- outside it, and the base branch/receipts are never silently overwritten.
create function pg_temp.objection_outcome(p_decision text) returns jsonb language plpgsql as $$
declare snapshot jsonb; result jsonb; claimed_mail record; mail_authorized boolean;
begin
  begin
    result:=public.decide_keyless_objection_v1((select id from current_objection),1,3,2,p_decision,
      pg_temp.keyless_hash('decision:'||p_decision),extensions.gen_random_bytes(64));
    if p_decision='needs-more-information' then
      set local role service_role;
      select * into claimed_mail from public.claim_mail_outbox();
      if claimed_mail.outbox_id is null or claimed_mail.template_id<>'future-person-more-information'
        or claimed_mail.delivery_token is not null then
        raise exception 'synthetic information request was not genuinely claimed without a token';end if;
      mail_authorized:=public.authorize_mail_submission_v1(claimed_mail.outbox_id,claimed_mail.attempt_ordinal);
      reset role;
    end if;
    snapshot:=jsonb_build_object('receipt',result,
      'objection',(select to_jsonb(obj) from public.future_person_claim_objections obj),
      'review',(select to_jsonb(review) from private.claim_reviews review),
      'package',(select to_jsonb(package) from public.future_person_claim_review_packages package),
      'notice',(select to_jsonb(notice) from public.future_person_claim_notices notice),
      'assignment',(select to_jsonb(assigned) from private.claim_review_assignments assigned where assigned.status='current'),
      'mail',(select to_jsonb(mail) from public.mail_outbox mail where mail.purpose='future-person-claim-more-information'),
      'overrulePhase',(select to_jsonb(phase) from public.retention_due_phases phase where phase.phase_id='overrule-release-close'),
      'priorPhase',(select to_jsonb(phase) from public.retention_due_phases phase where phase.phase_id='objection-review-decision-close'),
      'informationAuthorized',mail_authorized,
      'claimants',(select count(*) from public.future_person_claimant_principals),
      'custody',(select count(*) from private.future_person_custody_slices),
      'sourceUnchanged',(select subject=(select to_jsonb(subject) from public.subjects subject where subject.id=(select subject from keyless_ids))
        and embryo=(select to_jsonb(embryo) from public.embryos embryo where embryo.id=(select embryo from keyless_ids))
        and files=(select jsonb_agg(to_jsonb(file) order by file.id) from public.genome_files file where file.subject_id=(select subject from keyless_ids))
        and sources=(select jsonb_agg(to_jsonb(source) order by source.file_id) from private.embryo_canonical_sources source)
        and parts=(select jsonb_agg(to_jsonb(part) order by part.id) from private.embryo_canonical_parts part)
        and cards=(select jsonb_agg(to_jsonb(card) order by card.key_revision) from public.future_person_record_key_hashes card)
        from notice_preserved));
    if p_decision='needs-more-information' then
      perform private.close_keyless_notice_v1((select claim_id from current_objection),'refused');
      set local role service_role;
      mail_authorized:=public.authorize_mail_submission_v1(claimed_mail.outbox_id,claimed_mail.attempt_ordinal);
      reset role;
      snapshot:=snapshot||jsonb_build_object('terminalMailClosed',not mail_authorized and
        (select state='invalidated' from public.mail_outbox where id=claimed_mail.outbox_id));
    end if;
    set constraints all immediate;
    raise exception using errcode='P9911',message='rollback synthetic outcome';
  exception when sqlstate 'P9911' then null;end;
  return snapshot;
end $$;
create temporary table upheld as select pg_temp.objection_outcome('uphold-objection') body;
select is((select body->'receipt' from upheld),jsonb_build_object('objectionId',(select id from current_objection),
  'state','claim_rejected','objectionRevision',2),'a genuine uphold commits only the exact closed refusal receipt');
select ok((select body#>>'{objection,status}'='upheld' and body#>'{objection,statement_ciphertext}'='null'
  and body#>'{objection,wrapped_statement_key}'='null' and body#>>'{objection,statement_key_shredded_at}' is not null
  and body#>'{objection,review_reason_ciphertext}'='null' and body#>>'{review,state}'='closed' from upheld),
  'uphold terminalizes only the claim and shreds the independent statement and its professional basis');
select ok((select body#>'{package,comparison_ciphertext}'='null' and body#>'{package,wrapped_comparison_key}'='null'
  and body->>'sourceUnchanged'='true' and body->>'claimants'='0' and body->>'custody'='0' from upheld),
  'claim refusal shreds its minimum while preserving every source, Card and custody boundary');
create temporary table information as select pg_temp.objection_outcome('needs-more-information') body;
select is((select body->'receipt' from information),jsonb_build_object('objectionId',(select id from current_objection),
  'state','more_information_required','objectionRevision',2),'the real information branch commits its closed nonterminal receipt');
select ok((select body#>>'{objection,status}'='submitted' and body#>'{objection,decided_at}'='null'
  and (body#>>'{objection,timely_deadline}')::timestamptz=(select timely_deadline from public.future_person_claim_objections)
  and body#>>'{review,state}'='approved_pending_owner_notice' and body#>>'{assignment,review_operation}'='claim-objection'
  and body#>>'{assignment,assignment_revision}'='3' from information),
  'information rotates the named operation and keeps the exact original objection deadline');
select ok((select body#>>'{mail,purpose}'='future-person-claim-more-information' and body#>>'{mail,template_id}'='future-person-more-information'
  and body#>'{mail,template_payload}'='{}' and body#>'{mail,token_purpose}'='null' and body#>'{mail,token_target_id}'='null'
  and body#>>'{mail,semantic_revision}'='4' and body#>>'{mail,expires_at}'=body#>>'{objection,timely_deadline}'
  and body->>'sourceUnchanged'='true' and body->>'claimants'='0' and body->>'custody'='0' from information),
  'the minimal notification has no token, reason or identity, no extension and no source mutation');
select ok((select body->>'informationAuthorized'='true' and body->>'terminalMailClosed'='true' from information),
  'the real service role claims and authorizes the token-free request; terminal resolution invalidates it before any later submit');
create temporary table overruled as select pg_temp.objection_outcome('overrule-objection') body;
select is((select body->'receipt' from overruled),jsonb_build_object('objectionId',(select id from current_objection),
  'state','release_recheck_required','objectionRevision',2),'an overrule queues only the distinct future operation');
select ok((select body#>>'{objection,status}'='overruled' and body#>>'{assignment,review_operation}'='claim-release'
  and body#>>'{assignment,assignment_revision}'='3'
  and (body#>>'{objection,release_recheck_deadline}')::timestamptz=least(
    (body#>>'{objection,decided_at}')::timestamptz+interval '24 hours',(body#>>'{objection,timely_deadline}')::timestamptz)
  and body#>>'{priorPhase,status}'='cancelled'
  and body#>>'{overrulePhase,phase_deadline}'=body#>>'{objection,release_recheck_deadline}' from overruled),
  'overrule first persists the bounded replacement and supersedes the prior close phase');
select ok((select body#>>'{notice,notice_revision}'='3' and body#>>'{notice,delivery_notice_revision}'='2'
  and ((body->'notice')-'notice_revision')=(select to_jsonb(notice)-'notice_revision' from public.future_person_claim_notices notice)
  and body->>'sourceUnchanged'='true' and body->>'claimants'='0' and body->>'custody'='0' from overruled),
  'overrule advances only the current decision revision; delivery, owner, provider and30-day period are immutable');
set local role authenticated;
select throws_ok($$select public.decide_keyless_objection_v1((select id from current_objection),1,4,2,
  'overrule-objection',pg_temp.keyless_hash('wrong-current-review'),extensions.gen_random_bytes(64))$$,
  '42501','claim review unavailable','a stale or guessed review revision has zero decision effect');
select throws_ok($$select public.decide_keyless_objection_v1((select id from current_objection),1,3,3,
  'overrule-objection',pg_temp.keyless_hash('wrong-notice'),extensions.gen_random_bytes(64))$$,
  '42501','claim review unavailable','a foreign notice revision has zero decision effect');
select throws_ok($$select public.decide_keyless_objection_v1((select id from current_objection),1,3,2,
  'approve-release',pg_temp.keyless_hash('wrong-operation'),extensions.gen_random_bytes(64))$$,
  '42501','claim review unavailable','an objection decision cannot borrow the distinct release operation');
select is(public.decide_keyless_objection_v1((select id from current_objection),1,3,2,
  'overrule-objection',pg_temp.keyless_hash('committed-overrule'),extensions.gen_random_bytes(64)),
  jsonb_build_object('objectionId',(select id from current_objection),'state','release_recheck_required','objectionRevision',2),
  'the real public own-JWT decision commits the genuine bounded overrule');
select throws_ok($$select public.decide_keyless_objection_v1((select id from current_objection),1,3,2,
  'overrule-objection',pg_temp.keyless_hash('committed-overrule'),extensions.gen_random_bytes(64))$$,
  '42501','claim review unavailable','a consumed operation/revision cannot replay after overrule');
select throws_ok($$select public.read_keyless_review_operation_v1((select claim_id from current_objection),'claim-release')$$,
  '42501','claim review unavailable','the new release assignment cannot shorten the delivered30-day period');
reset role;
select ok(not has_function_privilege('service_role','public.decide_keyless_objection_v1(uuid,bigint,bigint,bigint,text,text,bytea)','EXECUTE')
  and not has_function_privilege('anon','public.decide_keyless_objection_v1(uuid,bigint,bigint,bigint,text,text,bytea)','EXECUTE')
  and not has_function_privilege('inherit_upload_only','public.decide_keyless_objection_v1(uuid,bigint,bigint,bigint,text,text,bytea)','EXECUTE'),
  'machine, anonymous and upload roles cannot make a named human decision');
set constraints all immediate;
select * from finish();
rollback;
