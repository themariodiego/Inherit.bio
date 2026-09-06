begin;
select plan(31);
\ir fixtures/refusal_evidence_pending.inc

-- A distinct, synthetic live authority graph shares the draft's reviewed
-- evidence. These rows never leave this transaction.
insert into public.embryo_cohort_drafts(id,owner_account_id,uploader_principal_id,upload_class,basis_case,embryo_count,fixed_expires_at)
select '9a000000-0000-4000-8000-0000000000b1',owner_account_id,uploader_principal_id,
 upload_class,basis_case,1,clock_timestamp()+interval '1 day'
from public.embryo_cohort_drafts where id=(select draft_id from draft);
insert into public.embryo_cohorts(id,draft_id,owner_account_id,upload_class,basis_case,basis_revision,
 participant_set_revision,donor_attribution_revision,embryo_count,retention_expires_at)
select '9a000000-0000-4000-8000-0000000000b2',id,owner_account_id,upload_class,basis_case,1,1,1,1,
 clock_timestamp()+interval '1 day' from public.embryo_cohort_drafts where id='9a000000-0000-4000-8000-0000000000b1';
insert into public.subjects(id,subject_class,upload_class,display_label,cohort_id)
values('9a000000-0000-4000-8000-0000000000b3','embryo','embryo_own','Embryo 1','9a000000-0000-4000-8000-0000000000b2');
insert into public.embryos(id,cohort_id,subject_id,sample_ordinal,retention_expires_at)
values('9a000000-0000-4000-8000-0000000000b4','9a000000-0000-4000-8000-0000000000b2',
 '9a000000-0000-4000-8000-0000000000b3',0,clock_timestamp()+interval '1 day');
insert into public.future_person_claim_sessions(id,embryo_id,candidate_principal_id,intake_revision,expires_at)
select '9a000000-0000-4000-8000-0000000000b5','9a000000-0000-4000-8000-0000000000b4',
 uploader_principal_id,1,clock_timestamp()+interval '1 day' from public.embryo_cohort_drafts where id=(select draft_id from draft);
insert into public.future_person_claims(id,intake_session_id,embryo_id,claimant_principal_id,claim_method,claim_revision,claimant_revision)
select '9a000000-0000-4000-8000-0000000000b6','9a000000-0000-4000-8000-0000000000b5',
 '9a000000-0000-4000-8000-0000000000b4',uploader_principal_id,'keyless_documentary',1,1
from public.embryo_cohort_drafts where id=(select draft_id from draft);
insert into public.correction_requests(id,subject_id,claimant_principal_id,correction_kind,correction_revision,statement_ciphertext)
select '9a000000-0000-4000-8000-0000000000b7','9a000000-0000-4000-8000-0000000000b3',
 uploader_principal_id,'identity',1,decode('01','hex') from public.embryo_cohort_drafts where id=(select draft_id from draft);
insert into public.appeal_intakes(id,appellant_principal_id,target_kind,target_id,appeal_revision,statement_ciphertext)
select '9a000000-0000-4000-8000-0000000000b8',uploader_principal_id,'claim',
 '9a000000-0000-4000-8000-0000000000b6',1,decode('01','hex')
from public.embryo_cohort_drafts where id=(select draft_id from draft);

-- The caught failure rolls back the inserted reference AND refusal, so each
-- case independently tests an actual pre-existing reference at cleanup time.
create function pg_temp.shared_blocks_cleanup(q text) returns boolean language plpgsql as $$
begin
 execute q;
 perform private.refuse_co_parent_invitation_v1(repeat('c',64),'fence-refusal-aaaaaaaaaaaaaaaa');
 perform public.claim_refused_invitation_draft_purge_v1(repeat('a',64));
 return false;
exception when sqlstate '55000' then return sqlerrm='refusal_purge_evidence_shared';
end;
$$;
select ok(pg_temp.shared_blocks_cleanup($$insert into public.embryo_basis_bindings(
 cohort_id,basis_case,basis_revision,participant_set_revision,reviewed_evidence_id,artifact_matrix_fingerprint)
 values('9a000000-0000-4000-8000-0000000000b2','true_two_parent',1,1,'9a000000-0000-4000-8000-0000000000a9',repeat('a',64))$$),
 'a direct live cohort basis blocks Storage selection');
select ok(pg_temp.shared_blocks_cleanup($$insert into public.embryo_basis_bindings(
 cohort_id,basis_case,basis_revision,participant_set_revision,legal_review_id,artifact_matrix_fingerprint)
 values('9a000000-0000-4000-8000-0000000000b2','true_two_parent',1,1,'9a000000-0000-4000-8000-0000000000a8',repeat('a',64))$$),
 'a cohort referencing only the legal review still blocks Storage selection');
select ok(pg_temp.shared_blocks_cleanup($$insert into public.future_person_claim_documents(
 claim_id,evidence_kind,reviewed_evidence_id,evidence_revision,status)
 values('9a000000-0000-4000-8000-0000000000b6','clinic_record','9a000000-0000-4000-8000-0000000000a9',1,'approved')$$),
 'a direct claim document blocks Storage selection');
select ok(pg_temp.shared_blocks_cleanup($$insert into public.future_person_claim_objections(
 claim_id,objector_principal_id,objection_revision,reason_code,reviewed_evidence_id)
 select '9a000000-0000-4000-8000-0000000000b6',uploader_principal_id,1,'synthetic',
 '9a000000-0000-4000-8000-0000000000a9' from public.embryo_cohort_drafts where id=(select draft_id from draft)$$),
 'a direct claim objection blocks Storage selection');
select ok(pg_temp.shared_blocks_cleanup($$insert into public.correction_assignments(
 correction_id,reviewer_principal_id,review_revision,decision,reason_code,reviewed_evidence_id)
 select '9a000000-0000-4000-8000-0000000000b7',uploader_principal_id,1,'approve','synthetic',
 '9a000000-0000-4000-8000-0000000000a9' from public.embryo_cohort_drafts where id=(select draft_id from draft)$$),
 'a direct correction decision blocks Storage selection');
select ok(pg_temp.shared_blocks_cleanup($$insert into public.appeal_evidence(
 appeal_id,evidence_kind,reviewed_evidence_id,evidence_revision)
 values('9a000000-0000-4000-8000-0000000000b8','objective_ground','9a000000-0000-4000-8000-0000000000a9',1)$$),
 'a direct appeal reference blocks Storage selection');
select ok(pg_temp.shared_blocks_cleanup($$insert into public.reviewed_evidence(
 review_id,evidence_kind,evidence_sha256,storage_object_id,evidence_revision)
 values('9a000000-0000-4000-8000-0000000000a8','embryo-basis',repeat('a',64),
 '9a000000-0000-4000-8000-0000000000f4',2)$$),'a second reviewed row sharing the physical object blocks cleanup');
select ok(pg_temp.shared_blocks_cleanup($$update public.legal_reviews
 set target_kind='appeal',target_id='9a000000-0000-4000-8000-0000000000b8'
 where id='9a000000-0000-4000-8000-0000000000a8'$$),'an independent review target blocks cleanup');
select lives_ok($$select private.assert_refused_evidence_exclusive_v1('cohort_draft',
 (select draft_id from draft))$$,'the unshared fixture remains eligible after rolled-back probes');
select lives_ok($$select private.refuse_co_parent_invitation_v1(
 repeat('c',64),'fence-refusal-aaaaaaaaaaaaaaaa')$$,'actual refusal closes evidence authority');

select throws_ok($$insert into public.legal_evidence_fragments(session_id,fragment_ordinal,object_id,sha256,byte_count)
 values('9a000000-0000-4000-8000-0000000000e1',2,gen_random_uuid(),repeat('a',64),32)$$,
 '55000','evidence_session_closed','a late fragment cannot attach to cancelled evidence');
select throws_ok($$update public.legal_evidence_documents set object_id=gen_random_uuid()
 where id='9a000000-0000-4000-8000-0000000000e2'$$,
 '55000','evidence_session_closed','a late replacement cannot change the deletion target');
select throws_ok($$insert into public.legal_evidence_review_copies(document_id,reviewer_principal_id,object_id,copy_revision,expires_at)
 select '9a000000-0000-4000-8000-0000000000e2',uploader_principal_id,gen_random_uuid(),2,clock_timestamp()+interval '1 day'
 from public.embryo_cohort_drafts where id=(select draft_id from draft)$$,
 '55000','evidence_session_closed','a late reviewer copy cannot create residual evidence');
select throws_ok($$insert into public.legal_evidence_working_data(document_id,working_ciphertext,working_revision,expires_at)
 values('9a000000-0000-4000-8000-0000000000e2',decode('01','hex'),1,clock_timestamp()+interval '1 day')$$,
 '55000','evidence_session_closed','late reviewer working data cannot survive refusal');
select throws_ok($$insert into public.legal_evidence_assignments(document_id,reviewer_principal_id,assignment_revision,status)
 select '9a000000-0000-4000-8000-0000000000e2',uploader_principal_id,2,'assigned'
 from public.embryo_cohort_drafts where id=(select draft_id from draft)$$,
 '55000','evidence_session_closed','no reviewer assignment can revive the evidence');
select throws_ok($$update public.legal_evidence_ingest_sessions set state='open'
 where id='9a000000-0000-4000-8000-0000000000e1'$$,
 '55000','evidence_session_closed','a cancelled evidence session cannot reopen');
select throws_ok($$update public.legal_evidence_ingest_sessions
 set target_id='9a000000-0000-4000-8000-0000000000b1' where id='9a000000-0000-4000-8000-0000000000e1'$$,
 '55000','evidence_session_closed','a cancelled package cannot be moved to another draft');
select throws_ok($$insert into public.legal_evidence_ingest_sessions(principal_id,target_kind,target_id,evidence_kind,session_revision,state,expires_at)
 select uploader_principal_id,'cohort_draft',id,'embryo-basis',2,'open',clock_timestamp()+interval '1 day'
 from public.embryo_cohort_drafts where id=(select draft_id from draft)$$,
 '55000','evidence_session_closed','a new session cannot attach after draft cancellation');
select throws_ok($$insert into public.appeal_evidence(appeal_id,evidence_kind,reviewed_evidence_id,evidence_revision)
 values('9a000000-0000-4000-8000-0000000000b8','objective_ground','9a000000-0000-4000-8000-0000000000a9',1)$$,
 '55000','evidence_session_closed','a new independent reference cannot race cancellation');
select throws_ok($$insert into public.embryo_basis_bindings(
 cohort_id,basis_case,basis_revision,participant_set_revision,legal_review_id,artifact_matrix_fingerprint)
 values('9a000000-0000-4000-8000-0000000000b2','true_two_parent',1,1,'9a000000-0000-4000-8000-0000000000a8',repeat('a',64))$$,
 '55000','evidence_session_closed','a new review-only basis cannot race cancellation');

create temporary table cleanup as select * from public.claim_refused_invitation_draft_purge_v1(repeat('a',64));
select is(jsonb_array_length((select storage_objects from cleanup)),4,'the unshared draft still produces all four physical objects');
select ok(public.authorize_refused_invitation_storage_v1((select manifest_id from cleanup),repeat('a',64),array[1,2,3,4]::bigint[]),
 'the exact current batch is authorized before Storage deletion');
select throws_ok($$select public.authorize_refused_invitation_storage_v1(
 (select manifest_id from cleanup),repeat('b',64),array[1]::bigint[])$$,
 '55000','refusal_purge_claim_stale','an obsolete worker cannot begin physical deletion');
select throws_ok($$select public.authorize_refused_invitation_storage_v1(
 (select manifest_id from cleanup),repeat('a',64),array[99]::bigint[])$$,
 '22023','refusal_purge_batch_invalid','an out-of-manifest ordinal is never authorized');
select throws_ok($$insert into public.reviewed_evidence(review_id,evidence_kind,evidence_sha256,storage_object_id,evidence_revision)
 values('9a000000-0000-4000-8000-0000000000a8','embryo-basis',repeat('a',64),'9a000000-0000-4000-8000-0000000000f4',3)$$,
 '55000','evidence_attachment_closed','a frozen object cannot gain a new reviewed owner');
select is((select count(*) from storage.objects where id::text like '9a000000-0000-4000-8000-0000000000f%'),4::bigint,
 'no authorization query deletes Storage metadata');
select ok(not has_function_privilege('anon','public.authorize_refused_invitation_storage_v1(uuid,text,bigint[])','execute')
 and not has_function_privilege('authenticated','public.authorize_refused_invitation_storage_v1(uuid,text,bigint[])','execute'),
 'only the service worker may authorize a Storage batch');
select is((select array_agg(distinct c.conrelid::regclass::text order by c.conrelid::regclass::text)
 from pg_constraint c where c.contype='f' and c.confrelid='public.reviewed_evidence'::regclass),
 array['appeal_evidence','correction_assignments','embryo_basis_bindings','future_person_claim_documents',
 'future_person_claim_objections','legal_evidence_documents']::text[],
 'every direct reviewed-evidence reference has an explicit protection path');
select is((select count(*) from pg_trigger where tgname='evidence_transition_lock'
 and not tgisinternal and (tgtype & 1)=0),13::bigint,'all thirteen evidence writers lock before row access');
select is((select count(*) from pg_trigger where tgname='evidence_write_fence'
 and not tgisinternal and (tgtype & 1)=1),13::bigint,'all thirteen evidence writers check each attached row');
select * from finish();
rollback;
