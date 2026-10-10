-- Genuine SQL normalization/report/readiness algorithm from
-- canonical_own_report_ready_mail.sql, scoped to the actual v2 owner/contact.
-- Synthetic Auth, source-object metadata and observed-call report only.
-- No PRS/calibrated result, scientific admission, provider ACK or delivery.
-- The same rollback-only limits as the existing normalization/readiness test.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
update public.profiles set date_of_birth=date '1990-01-01'
 where id='7a000000-0000-0000-0000-000000000001';
create temporary table contact_ready_subject as select sp.subject_id id
 from account_contact c join public.subject_principals sp on sp.id=c.principal_id;
create temporary table contact_ready_authority as select p.account_revision,p.auth_session_revision,p.jurisdiction_revision,
 s.subject_binding_revision,b.binding_revision from public.profiles p
 join public.subjects s on s.id=(select id from contact_ready_subject)
 join public.subject_account_bindings b on b.subject_id=s.id and b.status='current' and b.binding_kind='self'
 where p.id='7a000000-0000-0000-0000-000000000001' and b.account_id=p.id;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select pg_temp.keyless_hash(label),'7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from unnest(array['contact-ready-insurance','contact-ready-upload']) label;
select public.sign_own_upload_artifact_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select id from contact_ready_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],(select account_revision from contact_ready_authority),(select auth_session_revision from contact_ready_authority),
 (select jurisdiction_revision from contact_ready_authority),(select subject_binding_revision from contact_ready_authority),
 (select binding_revision from contact_ready_authority),pg_temp.keyless_hash('contact-ready-insurance'));
select public.sign_own_upload_artifact_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select id from contact_ready_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],(select account_revision from contact_ready_authority),(select auth_session_revision from contact_ready_authority),
 (select jurisdiction_revision from contact_ready_authority),(select subject_binding_revision from contact_ready_authority),
 (select binding_revision from contact_ready_authority),pg_temp.keyless_hash('contact-ready-upload'));
insert into storage.objects(id,bucket_id,name,metadata) values('7a0c0000-0000-4000-8000-000000000020',
 'genomes','7a0c0000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('7a0c0000-0000-4000-8000-000000000040','7a000000-0000-0000-0000-000000000001',(select id from contact_ready_subject),
 '7a0c0000-0000-4000-8000-000000000030','Synthetic contact readiness source','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'7a0c0000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('7a0c0000-0000-4000-8000-000000000020','7a0c0000-0000-4000-8000-000000000030','genomes',
 '7a0c0000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table contact_ready_preparation as select public.own_upload_normalization_v1('begin',
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1','7a0c0000-0000-4000-8000-000000000040') receipt;
create function pg_temp.contact_ready_prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1','7a0c0000-0000-4000-8000-000000000040',
 (select (receipt->>'claim')::uuid from contact_ready_preparation),payload);
$$;
select pg_temp.contact_ready_prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.contact_ready_prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('contact-ready-observed-call','medicines','Synthetic contact readiness','Rollback-only observed call.',
 'emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"synthetic fixture metadata"}]');
select public.grant_own_report_purpose_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 (select id from contact_ready_subject),public.own_report_context_v1('7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1',(select id from contact_ready_subject)),'reports.monogenic',
 (select version from public.consent_artifacts where artifact_key='consent.own-monogenic' and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.own-monogenic' and superseded_at is null),
 pg_temp.keyless_hash('contact-ready-monogenic'),clock_timestamp()+interval '9 minutes');
create temporary table contact_ready_claim as select public.own_report_generation_with_mail_v1('begin',
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1','7a0c0000-0000-4000-8000-000000000040',
 'reports.monogenic') receipt;
select is(public.own_report_generation_with_mail_v1('complete','7a000000-0000-0000-0000-000000000001',
 '7a000000-0000-4000-8000-0000000000a1','7a0c0000-0000-4000-8000-000000000040','reports.monogenic',
 (select (receipt->>'claim')::uuid from contact_ready_claim),jsonb_build_object(
 'reports','[{"slug":"contact-ready-observed-call","covered":true,"conflictingRsids":[],"variants":[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved"}}]}]'::jsonb,
 'prs','[]'::jsonb,'readyMail',jsonb_build_object('contactRevision',
 (select mail_contact_revision from public.profiles where id='7a000000-0000-0000-0000-000000000001'),
 'contactCiphertext',encode((select contact_ciphertext from account_contact),'hex'),
 'contactHmac',(select contact_hmac from account_contact),'dashboardUrl','https://example.invalid/genome/me/reports')))->>'status',
 'complete','the real selected observed-call report completes through the actual readiness producer');
create temporary table contact_ready_mail as select * from public.mail_outbox
 where target_id='7a0c0000-0000-4000-8000-000000000040';
select is((select count(*) from contact_ready_mail),1::bigint,'the genuine report producer creates one exact readiness event');
select ok((select m.contact_reference_id=(select id from account_contact)
 and private.file_ready_mail_current_v1(m) from public.mail_outbox m
 join contact_ready_mail captured on captured.id=m.id),
 'genuine current readiness reuses the v2 proven contact rather than rotating it to legacy authority');
