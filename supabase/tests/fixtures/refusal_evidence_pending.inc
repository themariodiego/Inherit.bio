\ir rights_invitation_pending.inc
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
