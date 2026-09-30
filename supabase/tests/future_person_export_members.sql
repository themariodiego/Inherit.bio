begin;
select no_plan();
-- Metadata-only SQL proof: actual name encryption/decoding is independently
-- proved with runtime-random AES keys in future-person-content.test.ts.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
select ok(has_function_privilege('authenticated','public.decide_claim_review_attested_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,boolean,uuid,bytea,jsonb)','execute')
 and has_function_privilege('authenticated','public.decide_claim_review_v1(uuid,bigint,text,text,bytea)','execute')
 and not has_function_privilege('authenticated','private.decide_claim_review_v1(uuid,bigint,text,text,bytea)','execute')
 and not has_function_privilege('service_role','public.decide_claim_review_attested_v1(uuid,bigint,text,text,bytea,bytea,jsonb,date,boolean,uuid,bytea,jsonb)','execute'),
 'only the human own-JWT attested decision door can authorize release through the API');
\ir fixtures/future_person_custody_source.inc
\ir fixtures/future_person_custody_approved.inc
-- Restore the documentary predecessor. The real attested decision must create
-- every durable claimant, custody and delivery row itself, atomically.
delete from public.future_person_claimant_principals where id=(select claimant from custody_ids);
delete from public.future_person_claims where id=(select review from custody_ids);
delete from public.future_person_claim_sessions where id=(select intake from custody_ids);
delete from public.subject_principals where id=(select principal from custody_ids);
delete from private.claim_review_decisions where review_id=(select review from custody_ids);
delete from private.claim_review_reads where review_id=(select review from custody_ids);
update private.claim_reviews set state='document_review_pending',review_revision=1 where id=(select review from custody_ids);
create function pg_temp.receive(p_document uuid,p_cookie text) returns void language plpgsql as $$
declare d jsonb;proof text;n integer;
begin
 d:=public.open_claim_review_download_v1(p_document,p_cookie);
 perform public.open_claim_review_receipt_v1((d->>'session')::uuid,p_cookie,pg_temp.h('open:'||p_document));
 for n in 0..(d->>'chunkCount')::integer-1 loop
   proof:=pg_temp.h('verified-chunk:'||p_document||':'||n);
   perform public.prepare_claim_review_chunk_receipt_v1((d->>'session')::uuid,p_cookie,n,proof);
   perform public.acknowledge_claim_review_chunk_v1((d->>'session')::uuid,p_cookie,n,proof,pg_temp.h('ack:'||p_document||':'||n));
 end loop;
end $$;
select pg_temp.receive((select photo from custody_ids),pg_temp.h('photo-current'));
select pg_temp.receive((select birth from custody_ids),pg_temp.h('birth-current'));
create function pg_temp.approve() returns jsonb language sql as $$
 select public.decide_claim_review_attested_v1((select review from custody_ids),1,'approve-record-key',pg_temp.h('real-decision'),
   extensions.gen_random_bytes(64),extensions.gen_random_bytes(64),jsonb_build_object('1',pg_temp.h('verified-tuple')),
   ((clock_timestamp() at time zone 'UTC')::date-interval '19 years')::date,true,
   '7e100000-0000-4000-8000-000000000001',extensions.gen_random_bytes(128),jsonb_build_object('1',pg_temp.h('contact')));
$$;
create function pg_temp.probe(p_setup text,p_call text) returns text language plpgsql as $$
declare result text;
begin
 begin execute p_setup;execute p_call into result;raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;end;
 return result;
end $$;
select throws_ok($$select pg_temp.probe('delete from private.claim_review_reads where document_id=(select birth from custody_ids)',
 'select pg_temp.approve()::text')$$,'42501','claim review unavailable','an incomplete birth-record delivery creates no claimant or mail');
select throws_ok($$select pg_temp.probe('update public.embryos set status=''stored'' where id=(select embryo from custody_ids)',
 'select pg_temp.approve()::text')$$,'42501','claim review unavailable','a changed disposition cannot release despite reviewed evidence');
select is((select count(*) from public.future_person_claimant_principals where claim_id=(select review from custody_ids)),0::bigint,
 'every refused approval leaves no durable claimant');
select is(pg_temp.approve()->>'state','release_queued','the real attested decision queues its exact release transaction');
set constraints all immediate;
select ok((select s.lifecycle='claimed_unbound' and s.owner_account_id is null and s.cohort_id is null
 from public.subjects s where s.id=(select subject from custody_ids)),'the same decision detaches the exact subject');
select ok((select state='closed' and resolved_at is not null from private.claim_reviews where id=(select review from custody_ids)),
 'the resolved private review closes without extending any deadline');
select ok((select octet_length(wrapped_data_key)=29 and octet_length(identity_ciphertext)=29
 from private.future_person_claim_intakes where id=(select review from custody_ids)),
 'the original claim-specific key and identity are crypto-shredded immediately');
select ok((select bool_and(wrapped_document_key is null and document_key_shredded_at is not null)
 from private.claim_document_sessions where intake_id=(select review from custody_ids)),
 'the approved record-key decision erases both independent document keys before Storage deletion');
select ok((select documentary_attestation_ciphertext is null and verified_identity_hmac is null
   and verified_date_of_birth is null and octet_length(reason_ciphertext)=29
 from private.claim_review_decisions where review_id=(select review from custody_ids)),
 'the working human identity, attestation and reason do not survive final release');
create temporary table release_mail as select m.id from public.mail_outbox m
 join public.future_person_claim_notices n on n.outbox_id=m.id where n.claim_id=(select review from custody_ids) and n.notice_kind='release';
select is((select count(*) from release_mail),1::bigint,'exactly one release mail event commits in the approval transaction');
select ok((select template_id='future-person-release' and purpose='approved-future-person-release' and target_kind='claimed-subject'
 and target_id=(select subject from custody_ids) and template_payload='{}'::jsonb
 and expires_at<=created_at+interval '7 days' from public.mail_outbox where id=(select id from release_mail)),
 'mail has only a fixed template and exact purpose/target/revision with the registered seven-day bound');
create function pg_temp.claim_release() returns table(outbox_id uuid,key text,attempt smallint,token text) language plpgsql as $$
declare r record;n integer;
begin for n in 1..30 loop
 select * into r from public.claim_mail_outbox();
 if r.outbox_id is null then return;end if;
 if r.outbox_id=(select id from release_mail) then return query select r.outbox_id,r.idempotency_key,r.attempt_ordinal,r.delivery_token;return;end if;
 end loop;end $$;
create temporary table delivered as select * from pg_temp.claim_release();
select ok((select token~'^[A-Za-z0-9_-]{43}$' from delivered),'the worker makes a bounded-runtime release token');
select ok(private.authorize_mail_submission_v1((select outbox_id from delivered),(select attempt from delivered)),
 'pre-submit rechecks the exact approved claimant and current source binding');
\ir fixtures/mail_attempt_retry.inc
select * from pg_temp.assert_mail_retry((select outbox_id from delivered),(select key from delivered),(select token from delivered));
select is(pg_temp.probe('update public.future_person_claimant_principals set release_revision=release_revision+1
 where claim_id=(select review from custody_ids)',
 'select private.authorize_mail_submission_v1((select outbox_id from delivered),(select attempt from delivered))::text'),
 'false','a replaced release authority cancels the old provider attempt');
select public.complete_mail_attempt((select outbox_id from delivered),(select attempt from delivered),true,pg_temp.h('provider'),'accepted');
-- The owner fixture probes the real shared session trigger before the genuine
-- one-time activation consumes this exact issued hash. Each setup rolls back.
create function pg_temp.forge_release_session() returns uuid language sql as $$
 insert into public.rights_sessions(token_hash_id,principal_id,purpose,target_kind,target_id,
   authority_revision,session_hash,status,expires_at,created_at)
 select h.id,cp.principal_id,'approved-future-person-release','claimed-subject',r.subject_id,
   r.credential_revision,pg_temp.h('forged-future-session'),'active',
   least(clock_timestamp()+interval '30 minutes',r.expires_at),clock_timestamp()
 from public.future_person_claim_release_credentials r
 join public.token_hashes h on h.candidate_id=r.candidate_id and h.token_hash=r.credential_hash
 join public.future_person_claimant_principals cp on cp.id=r.claimant_principal_id
 where r.claim_id=(select review from custody_ids) returning id;
$$;
select throws_ok($$select pg_temp.probe('update public.token_candidates set state=''pending''
 where outbox_id=(select id from release_mail)','select pg_temp.forge_release_session()::text')$$,
 '42501','rights purpose unavailable','a current Future hash still cannot authorize a candidate that was never issued');
select throws_ok($$select pg_temp.probe('update public.token_candidates set expires_at=clock_timestamp()-interval ''1 second''
 where outbox_id=(select id from release_mail)','select pg_temp.forge_release_session()::text')$$,
 '42501','rights purpose unavailable','an expired Future candidate cannot create a session despite a current credential');
select throws_ok($$select pg_temp.probe('update public.token_hashes set token_revision=token_revision+1
 where candidate_id=(select id from public.token_candidates where outbox_id=(select id from release_mail))',
 'select pg_temp.forge_release_session()::text')$$,
 '42501','rights purpose unavailable','the exact issued hash revision must equal the candidate and claimant credential revisions');
select throws_ok($$select pg_temp.probe('update public.token_hashes set status=''revoked'',ended_at=clock_timestamp()
 where candidate_id=(select id from public.token_candidates where outbox_id=(select id from release_mail))',
 'select pg_temp.forge_release_session()::text')$$,
 '42501','rights purpose unavailable','a revoked Future hash cannot create a session');
select is((select count(*) from public.rights_sessions where session_hash=pg_temp.h('forged-future-session')),0::bigint,
 'all forged Future session attempts leave no rights row');
create temporary table activated as select * from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select token from delivered),'UTF8'),'sha256'),'hex'),pg_temp.h('rights'),
 'future-person-activation-nonce-aaaaaaaa');
select is((select purpose||':'||target_kind from activated),'approved-future-person-release:claimed-subject',
 'activation selects the claimant purpose and one claimed subject');
select ok((select expires_at<=created_at+interval '60 minutes' from public.rights_sessions where session_hash=pg_temp.h('rights')),
 'activation has the registered absolute sixty-minute session bound');
select is((select count(*) from public.activate_rights_session_v1(
 encode(extensions.digest(convert_to((select token from delivered),'UTF8'),'sha256'),'hex'),pg_temp.h('rights-replay'),
 'future-person-activation-nonce-bbbbbbbb')),0::bigint,'the raw release credential is consumed exactly once');
select is((select array_agg(k order by k) from jsonb_object_keys(public.future_person_rights_view_v1(pg_temp.h('rights'))) k),
 array['allowedActionIds','lifecycleState','retentionMaximumDays','safeClaimedSubjectLabel'],'the claimant page returns exactly its four registered safe fields');
select ok(not public.future_person_rights_view_v1(pg_temp.h('rights'))::text~'subjectId|claimant|cipher|source|genotype|e2e.local',
 'the page exposes no genetic data, internal identifiers or contact fields');

-- The documentary approval explicitly flushed all deferred invariants above.
-- Restore their declared initial mode before this new atomic export workflow.
set constraints all deferred;
select ok(private.embryo_call_value_hash_v1(1,1000,'A',null,'A/A') is not null,
 'a genuine reference-only call receives an indexed null-aware value hash');
select isnt(private.embryo_call_value_hash_v1(1,1000,'A',null,'A/A'),
 private.embryo_call_value_hash_v1(1,1000,'A','','A/A'),'null and empty alternate values cannot collide');
-- Recorded historical components are written before the authority capture,
-- then frozen by that exact capture. No current-catalog substitution occurs.
create temporary table recorded_finding as select $synthetic${"embryo_label":"Embryo 1","condition_id":"retired-synthetic-condition","condition_name":"Synthetic condition retired-synthetic-condition","finding":{"kind":"absolute_risk","risk_model":{"model_id":"synthetic-model-retired-synthetic-condition","model_version":"1","age_band":"lifetime","prevalence_basis":"lifetime_risk","birth_cohort":"synthetic 1990s","calibration_cohort":"synthetic cohort","calibration_n":1000},"score_coverage":0.9,"absolute_risk":0.071,"interval_low":0.056799999999999996,"interval_high":0.08875,"matched_baseline":{"absolute_risk":0.05,"interval_low":0.04,"interval_high":0.06,"citation_ids":["synthetic:1"]},"difference_pp":2.1,"natural_frequency":{"subject_numerator":5,"comparator_numerator":5,"denominator":100,"fallback_copy_id":null},"number_needed_to_select":null,"comparators":[{"comparator":"vs_average_embryo","relative_difference":0,"absolute_difference_pp":0,"number_needed_to_select":null,"lead":false},{"comparator":"vs_randomly_selected_embryo","relative_difference":0,"absolute_difference_pp":0,"number_needed_to_select":null,"lead":true},{"comparator":"vs_highest_risk_embryo","relative_difference":0,"absolute_difference_pp":0,"number_needed_to_select":null,"lead":false},{"comparator":"vs_population_baseline","relative_difference":0,"absolute_difference_pp":0,"number_needed_to_select":null,"lead":false}],"within_family":{"status":"not_measured","point_estimate":null,"interval_low":null,"interval_high":null,"family_count":null,"citation_ids":[],"display_copy_id":"embryo.within-family.not-tested","enabled_by_default":false}},"evidence_label":"emerging","coverage_state":"covered","citation_ids":["synthetic:1"],"not_covered_reason":null}$synthetic$::jsonb body;
insert into public.embryo_scores(id,embryo_id,condition_id,condition_name,finding,evidence_label,coverage_state,citation_ids,
 not_covered_reason,model_id,model_version,source_binding_fingerprint,computation_revision,computed_at)
select '7a100000-0000-4000-8000-000000000001'::uuid,(select embryo from custody_ids),body->>'condition_id',body->>'condition_name',
 body->'finding',body->>'evidence_label',body->>'coverage_state',array['synthetic:1'],null,
 'retired-synthetic-model','original',pg_temp.h('recorded-own-finding'),2,clock_timestamp() from recorded_finding;
insert into public.embryo_figures(id,finding_id,figure_kind,payload,figure_revision,created_at)
select ('7a200000-0000-4000-8000-00000000000'||ordinal)::uuid,'7a100000-0000-4000-8000-000000000001'::uuid,kind,
 case kind when 'absolute_risk' then body->'finding'
 when 'interval' then jsonb_build_object('interval_low',body#>'{finding,interval_low}','interval_high',body#>'{finding,interval_high}')
 when 'natural_frequency' then body#>'{finding,natural_frequency}' else body#>'{finding,within_family}' end,
 3,clock_timestamp() from recorded_finding cross join (values(1,'absolute_risk'),(2,'interval'),(3,'natural_frequency'),(4,'within_family')) kinds(ordinal,kind);
insert into public.report_artifacts(id,subject_id,report_kind,report_revision,source_binding_fingerprint,artifact,created_at)
select '7a300000-0000-4000-8000-000000000001'::uuid,(select subject from custody_ids),'historical-own-finding',4,
 pg_temp.h('recorded-own-report'),body,clock_timestamp() from recorded_finding;
create temporary table member_authority as select public.future_person_export_request_v1('capture',pg_temp.h('rights')) body;
create function pg_temp.claimant_export(p_nonce text) returns jsonb language sql as $$
 select public.future_person_export_request_v1('create',pg_temp.h('rights'),jsonb_build_object(
  'exportCookieHash',pg_temp.h('export-cookie'),'envelope',jsonb_build_object(
   'routeId','api.future-person-export','origin','independent-rights','principalId',body->>'principalId',
   'targetKind','subject','targetId',(select subject from custody_ids)::text,'exportContract','approved-future-person-export-v1',
   'originBinding',body->>'originBinding','authorityReceipt',body->>'authorityReceipt','csrfBinding',pg_temp.h('csrf'),
   'operation','create','nonceHash',pg_temp.h(p_nonce),'issuedAt',n,'expiresAt',n+300000)),pg_temp.h('csrf'))
 from member_authority cross join lateral (select floor(extract(epoch from clock_timestamp())*1000)::bigint n) clock;
$$;
create temporary table member_export as select pg_temp.claimant_export('create-export') body;
select is((select count(*) from public.generated_exports where id=(select (body->>'exportId')::uuid from member_export)
 and origin_kind='independent-rights' and account_id is null and target_id=(select subject from custody_ids)),1::bigint,
 'the actual claimant job has exactly one accountless subject origin without a fabricated account');
set constraints all immediate;
set constraints all deferred;
select throws_ok($$select pg_temp.claimant_export('duplicate-export')$$,'55000','export_already_pending',
 'a current exact subject export cannot be duplicated with a second operation nonce');
create temporary table member_attempt as select extensions.gen_random_uuid() id;
select lives_ok($$select public.export_archive_worker_v1('preflight',(select (body->>'exportId')::uuid from member_export),
 (select id from member_attempt),(select body->>'authorityReceipt' from member_authority))$$,'the existing durable worker preflight resolves the live claimant origin');
select lives_ok($$select public.export_archive_worker_v1('begin',(select (body->>'exportId')::uuid from member_export),
 (select id from member_attempt),(select body->>'authorityReceipt' from member_authority))$$,'the real worker starts exactly this registered claimant attempt');
create temporary table member_page as select public.future_person_export_members_v1('variants',
 (select (body->>'exportId')::uuid from member_export),(select id from member_attempt),
 (select body->>'authorityReceipt' from member_authority)) body;
select is((select (body->>'count')::integer from member_page),2,'the leased worker reads every actual own canonical call');
select is((select array_agg(k order by k) from member_page,jsonb_object_keys(body->'rows'->0) k),
 array['alternateAllele','chromosome','genotype','id','position','referenceAllele'],'worker variants have exactly the registered own fields');
select lives_ok($$select public.future_person_export_members_v1('quality',(select (body->>'exportId')::uuid from member_export),
 (select id from member_attempt),(select body->>'authorityReceipt' from member_authority))$$,'own quality is read under the same genuine durable attempt');
create temporary table historical_figure_page as select public.future_person_export_members_v1('figures',
 (select (body->>'exportId')::uuid from member_export),(select id from member_attempt),(select body->>'authorityReceipt' from member_authority)) body;
select is((select (body->>'count')::integer from historical_figure_page),4,'all four genuine historical figure rows are included before projection');
select is((select array_agg(k order by k) from historical_figure_page,jsonb_object_keys(body->'rows'->0) k),
 array['created_at','figure_kind','figure_revision','findingRecord','finding_id','id','payload'],'the figure envelope has exactly the recorded fields and bound finding');
select ok((select bool_and(row->>'finding_id'=row#>>'{findingRecord,id}' and row#>>'{findingRecord,model_id}'='retired-synthetic-model'
 and row#>>'{findingRecord,model_version}'='original' and row#>>'{findingRecord,computation_revision}'='2'
 and row#>>'{findingRecord,source_binding_fingerprint}'=pg_temp.h('recorded-own-finding')
 and not(row->'findingRecord'?'embryo_id')) from historical_figure_page,jsonb_array_elements(body->'rows') row),
 'every figure binds the real historical own finding and preserves its original scientific version without a parent selector');
select is((select body->'rows'->0->'payload' from historical_figure_page),(select body->'finding' from recorded_finding),
 'the stored absolute-risk payload is returned exactly, never recreated from a current model');
create temporary table historical_report_page as select public.future_person_export_members_v1('reports',
 (select (body->>'exportId')::uuid from member_export),(select id from member_attempt),(select body->>'authorityReceipt' from member_authority)) body;
select is((select (body->>'count')::integer from historical_report_page),1,'the actual stored subject report is included');
select is((select array_agg(k order by k) from historical_report_page,jsonb_object_keys(body->'rows'->0) k),
 array['artifact','created_at','embryoId','id','report_kind','report_revision','source_binding_fingerprint'],
 'the report envelope is closed to exact stored evidence and the authority-derived embryo binding');
select is((select (body#>>'{rows,0,embryoId}')::uuid from historical_report_page),(select embryo from custody_ids),
 'a caller cannot supply a different embryo for the historical report');
select is((select body#>'{rows,0,artifact}' from historical_report_page),(select body from recorded_finding),
 'all actual recorded report bytes precede the runtime closed DTO projection');
select throws_ok($$select pg_temp.probe('update public.embryo_figures set payload=jsonb_build_object(''changed'',true)
 where id=''7a200000-0000-4000-8000-000000000001''','select public.future_person_export_members_v1(''figures'',
 (select (body->>''exportId'')::uuid from member_export),(select id from member_attempt),
 (select body->>''authorityReceipt'' from member_authority))::text')$$,'42501','not_found',
 'a changed stored figure invalidates the originating receipt before another byte is returned');
select throws_ok($$select pg_temp.probe('update public.report_artifacts set artifact=jsonb_build_object(''changed'',true)
 where id=''7a300000-0000-4000-8000-000000000001''','select public.future_person_export_members_v1(''reports'',
 (select (body->>''exportId'')::uuid from member_export),(select id from member_attempt),
 (select body->>''authorityReceipt'' from member_authority))::text')$$,'42501','not_found',
 'a changed stored report invalidates the originating receipt before another byte is returned');
select throws_ok($$update public.embryo_variants set genotype='G/G' where source_file_id=(select file from custody_ids)$$,
 '55000','canonical_calls_immutable','published canonical calls cannot change while the archive is reading');
select throws_ok($$delete from public.embryo_variants where source_file_id=(select file from custody_ids)$$,
 '42501','embryo_source_unavailable','the claimed source cannot disappear between content passes');
select throws_ok($$select public.future_person_export_members_v1('variants',(select (body->>'exportId')::uuid from member_export),
 extensions.gen_random_uuid(),(select body->>'authorityReceipt' from member_authority))$$,'42501','not_found',
 'a receipt cannot replace the exact registered writing attempt');
select throws_ok($$select pg_temp.probe('update public.rights_sessions set status=''revoked'',ended_at=clock_timestamp()
 where session_hash=pg_temp.h(''rights'')','select public.future_person_export_members_v1(''context'',
 (select (body->>''exportId'')::uuid from member_export),(select id from member_attempt),
 (select body->>''authorityReceipt'' from member_authority))::text')$$,'42501','not_found',
 'revoked claimant authority stops the actual durable worker before another member is returned');
select ok(not has_function_privilege('authenticated','public.future_person_export_members_v1(text,uuid,uuid,text,text)','execute')
 and not has_function_privilege('anon','public.future_person_export_request_v1(text,text,jsonb,text)','execute'),
 'browser JWTs cannot invoke the service member/request doors directly');
select is((select call_immutability_proof from private.embryo_canonical_sources where file_id=(select file from custody_ids)),
 'exact-staged-calls-v1','the genuine new producer has exact immutable staged-copy proof');
select throws_ok($$select pg_temp.probe('alter table private.embryo_canonical_sources disable trigger user;
 update private.embryo_canonical_sources set call_immutability_proof=null where file_id=(select file from custody_ids);
 alter table private.embryo_canonical_sources enable trigger user',
 'select public.future_person_export_source_v1(''capture'',pg_temp.h(''rights''))::text')$$,
 '55000','export_source_immutability_unproven','a legacy source remains fail-closed without an invented historical proof');
select is((select count(*) from public.purge_target_stores),147::bigint,'all existing stores retain exact purge and credential dispositions');
select ok(position('export_publication_not_integrated' in pg_get_functiondef('private.guard_segmented_export_publication_v1()'::regprocedure))>0,
 'the whole-account and incomplete claim archive READY hold remains exact');
select * from finish();
rollback;
