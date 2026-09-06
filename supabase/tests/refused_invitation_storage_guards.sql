begin;
select plan(12);
\ir fixtures/rights_invitation_pending.inc
select public.activate_rights_session_v1((select hash from tok),repeat('c',64),'storage-form-aaaaaaaaaaaaaaaa');
insert into storage.buckets(id,name,public) values('legal-evidence','legal-evidence',false) on conflict do nothing;
-- Only rolled-back metadata fixtures; no real Storage object is created or
-- deleted with SQL. The production-route test covers actual API deletion.
insert into storage.objects(id,bucket_id,name) values
 ('9a000000-0000-4000-8000-0000000000f1','legal-evidence','synthetic-guard-fragment'),
 ('9a000000-0000-4000-8000-0000000000f2','legal-evidence','synthetic-guard-document'),
 ('9a000000-0000-4000-8000-0000000000f3','legal-evidence','synthetic-guard-review-copy'),
 ('9a000000-0000-4000-8000-0000000000f4','legal-evidence','synthetic-guard-reviewed-original');
insert into public.legal_evidence_ingest_sessions(
 id,principal_id,target_kind,target_id,evidence_kind,session_revision,state,expires_at)
select '9a000000-0000-4000-8000-0000000000e1',uploader_principal_id,'cohort_draft',id,
 'embryo-basis',1,'open',clock_timestamp()+interval '1 day'
from public.embryo_cohort_drafts where id=(select draft_id from draft);
insert into public.legal_evidence_fragments(session_id,fragment_ordinal,object_id,sha256,byte_count)
values('9a000000-0000-4000-8000-0000000000e1',1,'9a000000-0000-4000-8000-0000000000f1',repeat('a',64),32);
insert into public.legal_reviews(id,target_kind,target_id,reviewer_principal_id,decision,decision_code,review_revision)
select '9a000000-0000-4000-8000-0000000000a8','single_parent_basis',id,uploader_principal_id,
 'approved','synthetic-only',1 from public.embryo_cohort_drafts where id=(select draft_id from draft);
insert into public.reviewed_evidence(id,review_id,evidence_kind,evidence_sha256,storage_object_id,evidence_revision)
values('9a000000-0000-4000-8000-0000000000a9','9a000000-0000-4000-8000-0000000000a8','embryo-basis',
 repeat('a',64),'9a000000-0000-4000-8000-0000000000f4',1);
insert into public.legal_evidence_documents(
 id,session_id,reviewed_evidence_id,document_kind,document_sha256,object_id,envelope_key_revision,document_revision,state)
values('9a000000-0000-4000-8000-0000000000e2','9a000000-0000-4000-8000-0000000000e1',
 '9a000000-0000-4000-8000-0000000000a9','embryo-basis',repeat('a',64),
 '9a000000-0000-4000-8000-0000000000f2',1,1,'reviewed');
insert into public.legal_evidence_review_copies(document_id,reviewer_principal_id,object_id,copy_revision,expires_at)
select '9a000000-0000-4000-8000-0000000000e2',uploader_principal_id,
 '9a000000-0000-4000-8000-0000000000f3',1,clock_timestamp()+interval '1 day'
from public.embryo_cohort_drafts where id=(select draft_id from draft);
select private.refuse_co_parent_invitation_v1(repeat('c',64),'storage-refuse-aaaaaaaaaaaaaaaa');
create temporary table cleanup as select * from public.claim_refused_invitation_draft_purge_v1(repeat('a',64));
select is(jsonb_array_length((select storage_objects from cleanup)),4,
 'all fragment, document, review-copy and reviewed-original objects are frozen');
select ok((select bool_and(x->>'bucketId'='legal-evidence' and x ? 'objectId' and x ? 'objectName')
 from cleanup,jsonb_array_elements(storage_objects) x),'the manifest contains exact server-resolved object addresses');
select throws_ok($$select public.complete_refused_invitation_storage_v1(
 (select manifest_id from cleanup),repeat('a',64),array[1]::bigint[])$$,
 '55000','refusal_purge_storage_remaining','a claimed provider receipt cannot hide a remaining object');
select throws_ok($$select public.complete_refused_invitation_storage_v1(
 (select manifest_id from cleanup),repeat('a',64),array[999]::bigint[])$$,
 '22023','refusal_purge_batch_invalid','an arbitrary ordinal cannot be acknowledged');
select throws_ok($$select public.complete_refused_invitation_storage_v1(
 (select manifest_id from cleanup),repeat('a',64),array[1,1]::bigint[])$$,
 '22023','refusal_purge_batch_invalid','duplicate ordinals cannot inflate completion');
select throws_ok($$select public.finish_refused_invitation_draft_purge_v1(
 (select manifest_id from cleanup),repeat('a',64))$$,'55000','refusal_purge_storage_remaining',
 'database cleanup cannot run before physical storage deletion');
select is((select count(*) from public.legal_evidence_documents
 where id='9a000000-0000-4000-8000-0000000000e2'),1::bigint,'failed cleanup preserves the evidence binding for retry');
update public.retention_due_phases set claim_expires_at=clock_timestamp()-interval '1 second'
where retention_row_id=(select retention_row_id from public.purge_manifests where id=(select manifest_id from cleanup));
select is((select storage_objects from public.claim_refused_invitation_draft_purge_v1(repeat('b',64))),
 (select storage_objects from cleanup),'expired worker lease retries the same frozen addresses');
select throws_ok($$select public.complete_refused_invitation_storage_v1(
 (select manifest_id from cleanup),repeat('a',64),array[1]::bigint[])$$,
 '55000','refusal_purge_claim_stale','an old storage receipt cannot mutate the new worker attempt');
update public.embryo_cohort_drafts set participant_set_revision=participant_set_revision+1
where id=(select draft_id from draft);
select throws_ok($$select public.finish_refused_invitation_draft_purge_v1(
 (select manifest_id from cleanup),repeat('b',64))$$,'55000','refusal_purge_draft_changed',
 'a changed draft revision invalidates the cleanup authority');
select lives_ok($$select public.fail_refused_invitation_draft_purge_v1(
 (select manifest_id from cleanup),repeat('b',64))$$,'changed authority does not prevent releasing the failed attempt');
select * from finish();
rollback;
