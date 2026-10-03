-- Native Path B array metadata/authority/publication plumbing, rollback only.
-- Eight-byte Storage metadata is not an actual array parser or provider proof.
-- Real-byte unit cases and full hosted native-operator journeys must qualify
-- their own transport/parser scope separately from these database fixtures.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

\ir fixtures/path_b_source_setup.inc


update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
-- The uploader signs the actual current insurance artifact for their own
-- account context, independently of the Path B upload-class artifact.
create temporary table own_context as select private.own_upload_context_v1(pg_temp.a('1'),pg_temp.s('1'),s.id) c,s.id
 from public.subjects s where s.subject_class='self' and s.subject_account_id=pg_temp.a('1');
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 values(repeat('9',64),pg_temp.a('1'),pg_temp.s('1'),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
select public.sign_own_upload_artifact_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from own_context),
 'disclosure.insurance-and-discrimination',a.version,a.body_sha256,array['understood'],
 (c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,(c->>'jurisdictionRevision')::bigint,
 (c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,repeat('9',64))
 from own_context,public.consent_artifacts a where a.artifact_key='disclosure.insurance-and-discrimination' and a.superseded_at is null;
create function pg_temp.hold_array(p_name text,p_subject uuid,p_format text,p_hash text) returns jsonb language plpgsql as $$
declare r jsonb; m jsonb; v_object uuid:=gen_random_uuid(); v_result jsonb;
begin
 r:=public.issue_other_adult_held_upload_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,p_format,8,p_hash,true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('genomes',r->>'stagingKey',pg_temp.a('1'),'{"size":8}');
 m:=public.begin_own_upload_finalization_v2(pg_temp.a('1'),pg_temp.s('1'),(r->>'uploadId')::uuid);
 insert into storage.objects(id,bucket_id,name,metadata) values(v_object,'genomes',m->>'finalKey','{"size":8}');
 perform set_config('role','postgres',true);
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='genomes' and name=r->>'stagingKey';
 perform set_config('role','service_role',true);
 v_result:=public.complete_own_upload_finalization_v1(pg_temp.a('1'),pg_temp.s('1'),(r->>'uploadId')::uuid,
  (m->>'claim')::uuid,v_object,p_hash,repeat('b',64));
 perform set_config('role','postgres',true);
 insert into held_fx values(p_name,(r->>'uploadId')::uuid,r->>'stagingKey',m->>'finalKey',v_object,p_hash,
  (v_result->>'fileId')::uuid);
 return v_result;
end;
$$;
create temporary table array_claim(c jsonb);
create function pg_temp.array_norm(p_operation text,p_payload jsonb default null) returns jsonb language sql as $$
 select public.path_b_normalization_v1(p_operation,(c->>'jobId')::uuid,repeat('8',64),(c->>'claim')::uuid,p_payload,true)
 from array_claim;
$$;

-- array_23andme: actual registered issuer, finalizer, account confirmation and claim.
select pg_temp.requested('array-1','a',repeat('a',64));
select is(pg_temp.account_confirms('a','array-sign-aaaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),
 'accepted','array_23andme: the real pre-existing person account confirms the request');
select is(pg_temp.hold_array('array-1',pg_temp.sid('array-1'),'consumer-array-text-v1',repeat('a',64))->>'status',
 'stored_quarantined','array_23andme: native finalization holds the exact declared array');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('array-1')),0::bigint,
 'array_23andme: no readable source descriptor exists before exact revision confirmation');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('array-1')),0::bigint,
 'array_23andme: no worker is admitted before exact revision confirmation');
select pg_temp.notice_session('array-1','1');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'array-confirm-1qqqqqqqqqqqqqqqqqqqq',
 'confirm',pg_temp.a('2')),'confirmed','array_23andme: actual file revision confirmation succeeds');
select lives_ok('set constraints all immediate','array_23andme: confirmation passes every original deferred native constraint');
set constraints all deferred;
select is((select file_type::text from public.genome_files where id=pg_temp.fxv('array-1','revision')::uuid),
 'array_23andme','array_23andme: exact accepted internal format survives the queue descriptor');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('array-1') and kind='annotate_vcf'
 and output_kind='ingest.normalize' and computation_revision='path-b-normalization-v1'
 and source_binding_id=pg_temp.fxv('array-1','revision')::uuid and source_binding_kind='genome-file'),1::bigint,
 'array_23andme: only the original dedicated exact source tuple is queued');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('array-1')),0::bigint,
 'array_23andme: confirmation adds no analytic purpose');
select ok((private.claim_worker_job_v2('array-generic',repeat('7',64),60)).id is null,
 'array_23andme: the ordinary worker cannot claim the dedicated confirmed array');
truncate array_claim;
insert into array_claim select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
select is((select c->>'fileId' from array_claim),pg_temp.fxv('array-1','revision'),
 'array_23andme: actual bounded worker claims only that current confirmed revision');
select is((select c->>'fileType' from array_claim),'array_23andme','array_23andme: claimed source retains its actual array type');
select is(pg_temp.array_norm('check'),(select c from array_claim),'array_23andme: each read checkpoint reproduces complete live authority');
select throws_ok($$select pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38',
 'rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,
 'provenance','{}'::jsonb))$$,'22023','invalid_request','array_23andme: no whole source is invented from an empty staging set');
select is(public.register_path_b_normalization_positions_v1((select(c->>'jobId')::uuid from array_claim),repeat('8',64),
 pg_temp.fxv('array-1','revision')::uuid,(select(c->>'claim')::uuid from array_claim),0,'GRCh38',
 '[{"source_chrom":15,"source_pos":74749576,"variant":{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"},"mapped":null}]',true),
 '{"acceptedVariantOrdinals":[0],"attempted":0,"unmapped":0}'::jsonb,
 'array_23andme: native exact-claim ledger accepts unknown array alleles without synthesis');
select is(pg_temp.array_norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"}]}'),
 'true'::jsonb,'array_23andme: literal arrays stage through the existing private native writer');
select is((select count(*) from public.user_variants where file_id=pg_temp.fxv('array-1','revision')::uuid),0::bigint,
 'array_23andme: private staging is not canonical publication');
select is(pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance',
 jsonb_build_object('version','path-b-normalization-v1','sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)))->>'status',
 'normalization_complete','array_23andme: only the same claimed source publishes after current native final fences');
select is((select jsonb_agg(jsonb_build_object('rsid',rsid,'genotype',genotype,'ref',ref,'alt',alt)) from public.user_variants
 where file_id=pg_temp.fxv('array-1','revision')::uuid and subject_id=pg_temp.sid('array-1')),
 '[{"rsid":762551,"genotype":"A/C","ref":null,"alt":null}]'::jsonb,
 'array_23andme: saved fresh canonical readback is exactly the literal array reading');
select is((select count(*) from public.report_observed_calls where file_id=pg_temp.fxv('array-1','revision')::uuid),0::bigint,
 'array_23andme: no fabricated VCF depth, filter or quality rows are persisted');
select is((select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('array-1')),0::bigint,
 'array_23andme: normalization without a current purpose creates no analytic result binding');
select ok((select storage_object_id is null and status='stored' and normalization_completed_at is not null
 from public.genome_files where id=pg_temp.fxv('array-1','revision')::uuid),
 'array_23andme: original remains in held object inventory, never an own-file storage binding');

-- array_ancestry: actual registered issuer, finalizer, account confirmation and claim.
select pg_temp.requested('array-2','c',repeat('c',64));
select is(pg_temp.account_confirms('c','array-sign-cccccccccccccccccccc','2',repeat('c',64)),
 'accepted','array_ancestry: the real pre-existing person account confirms the request');
select is(pg_temp.hold_array('array-2',pg_temp.sid('array-2'),'consumer-array-text-v2',repeat('c',64))->>'status',
 'stored_quarantined','array_ancestry: native finalization holds the exact declared array');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('array-2')),0::bigint,
 'array_ancestry: no readable source descriptor exists before exact revision confirmation');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('array-2')),0::bigint,
 'array_ancestry: no worker is admitted before exact revision confirmation');
select pg_temp.notice_session('array-2','2');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'array-confirm-22qqqqqqqqqqqqqqqqqqqq',
 'confirm',pg_temp.a('2')),'confirmed','array_ancestry: actual file revision confirmation succeeds');
select lives_ok('set constraints all immediate','array_ancestry: confirmation passes every original deferred native constraint');
set constraints all deferred;
select is((select file_type::text from public.genome_files where id=pg_temp.fxv('array-2','revision')::uuid),
 'array_ancestry','array_ancestry: exact accepted internal format survives the queue descriptor');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('array-2') and kind='annotate_vcf'
 and output_kind='ingest.normalize' and computation_revision='path-b-normalization-v1'
 and source_binding_id=pg_temp.fxv('array-2','revision')::uuid and source_binding_kind='genome-file'),1::bigint,
 'array_ancestry: only the original dedicated exact source tuple is queued');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('array-2')),0::bigint,
 'array_ancestry: confirmation adds no analytic purpose');
select ok((private.claim_worker_job_v2('array-generic',repeat('7',64),60)).id is null,
 'array_ancestry: the ordinary worker cannot claim the dedicated confirmed array');
truncate array_claim;
insert into array_claim select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
select is((select c->>'fileId' from array_claim),pg_temp.fxv('array-2','revision'),
 'array_ancestry: actual bounded worker claims only that current confirmed revision');
select is((select c->>'fileType' from array_claim),'array_ancestry','array_ancestry: claimed source retains its actual array type');
select is(pg_temp.array_norm('check'),(select c from array_claim),'array_ancestry: each read checkpoint reproduces complete live authority');
select throws_ok($$select pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38',
 'rawSha256',repeat('c',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,
 'provenance','{}'::jsonb))$$,'22023','invalid_request','array_ancestry: no whole source is invented from an empty staging set');
select is(public.register_path_b_normalization_positions_v1((select(c->>'jobId')::uuid from array_claim),repeat('8',64),
 pg_temp.fxv('array-2','revision')::uuid,(select(c->>'claim')::uuid from array_claim),0,'GRCh38',
 '[{"source_chrom":15,"source_pos":74749576,"variant":{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"},"mapped":null}]',true),
 '{"acceptedVariantOrdinals":[0],"attempted":0,"unmapped":0}'::jsonb,
 'array_ancestry: native exact-claim ledger accepts unknown array alleles without synthesis');
select is(pg_temp.array_norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"}]}'),
 'true'::jsonb,'array_ancestry: literal arrays stage through the existing private native writer');
select is((select count(*) from public.user_variants where file_id=pg_temp.fxv('array-2','revision')::uuid),0::bigint,
 'array_ancestry: private staging is not canonical publication');
select is(pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('c',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance',
 jsonb_build_object('version','path-b-normalization-v1','sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)))->>'status',
 'normalization_complete','array_ancestry: only the same claimed source publishes after current native final fences');
select is((select jsonb_agg(jsonb_build_object('rsid',rsid,'genotype',genotype,'ref',ref,'alt',alt)) from public.user_variants
 where file_id=pg_temp.fxv('array-2','revision')::uuid and subject_id=pg_temp.sid('array-2')),
 '[{"rsid":762551,"genotype":"A/C","ref":null,"alt":null}]'::jsonb,
 'array_ancestry: saved fresh canonical readback is exactly the literal array reading');
select is((select count(*) from public.report_observed_calls where file_id=pg_temp.fxv('array-2','revision')::uuid),0::bigint,
 'array_ancestry: no fabricated VCF depth, filter or quality rows are persisted');
select is((select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('array-2')),0::bigint,
 'array_ancestry: normalization without a current purpose creates no analytic result binding');
select ok((select storage_object_id is null and status='stored' and normalization_completed_at is not null
 from public.genome_files where id=pg_temp.fxv('array-2','revision')::uuid),
 'array_ancestry: original remains in held object inventory, never an own-file storage binding');

-- array_myheritage: actual registered issuer, finalizer, account confirmation and claim.
select pg_temp.requested('array-3','d',repeat('d',64));
select is(pg_temp.account_confirms('d','array-sign-dddddddddddddddddddd','2',repeat('d',64)),
 'accepted','array_myheritage: the real pre-existing person account confirms the request');
select is(pg_temp.hold_array('array-3',pg_temp.sid('array-3'),'consumer-array-text-v3',repeat('d',64))->>'status',
 'stored_quarantined','array_myheritage: native finalization holds the exact declared array');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('array-3')),0::bigint,
 'array_myheritage: no readable source descriptor exists before exact revision confirmation');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('array-3')),0::bigint,
 'array_myheritage: no worker is admitted before exact revision confirmation');
select pg_temp.notice_session('array-3','3');
select is(public.respond_adult_upload_revision_v1(repeat('3',64),'array-confirm-333qqqqqqqqqqqqqqqqqqqq',
 'confirm',pg_temp.a('2')),'confirmed','array_myheritage: actual file revision confirmation succeeds');
select lives_ok('set constraints all immediate','array_myheritage: confirmation passes every original deferred native constraint');
set constraints all deferred;
select is((select file_type::text from public.genome_files where id=pg_temp.fxv('array-3','revision')::uuid),
 'array_myheritage','array_myheritage: exact accepted internal format survives the queue descriptor');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('array-3') and kind='annotate_vcf'
 and output_kind='ingest.normalize' and computation_revision='path-b-normalization-v1'
 and source_binding_id=pg_temp.fxv('array-3','revision')::uuid and source_binding_kind='genome-file'),1::bigint,
 'array_myheritage: only the original dedicated exact source tuple is queued');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('array-3')),0::bigint,
 'array_myheritage: confirmation adds no analytic purpose');
select ok((private.claim_worker_job_v2('array-generic',repeat('7',64),60)).id is null,
 'array_myheritage: the ordinary worker cannot claim the dedicated confirmed array');
truncate array_claim;
insert into array_claim select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
select is((select c->>'fileId' from array_claim),pg_temp.fxv('array-3','revision'),
 'array_myheritage: actual bounded worker claims only that current confirmed revision');
select is((select c->>'fileType' from array_claim),'array_myheritage','array_myheritage: claimed source retains its actual array type');
select is(pg_temp.array_norm('check'),(select c from array_claim),'array_myheritage: each read checkpoint reproduces complete live authority');
select throws_ok($$select pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38',
 'rawSha256',repeat('d',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,
 'provenance','{}'::jsonb))$$,'22023','invalid_request','array_myheritage: no whole source is invented from an empty staging set');
select is(public.register_path_b_normalization_positions_v1((select(c->>'jobId')::uuid from array_claim),repeat('8',64),
 pg_temp.fxv('array-3','revision')::uuid,(select(c->>'claim')::uuid from array_claim),0,'GRCh38',
 '[{"source_chrom":15,"source_pos":74749576,"variant":{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"},"mapped":null}]',true),
 '{"acceptedVariantOrdinals":[0],"attempted":0,"unmapped":0}'::jsonb,
 'array_myheritage: native exact-claim ledger accepts unknown array alleles without synthesis');
select is(pg_temp.array_norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"}]}'),
 'true'::jsonb,'array_myheritage: literal arrays stage through the existing private native writer');
select is((select count(*) from public.user_variants where file_id=pg_temp.fxv('array-3','revision')::uuid),0::bigint,
 'array_myheritage: private staging is not canonical publication');
select is(pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('d',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance',
 jsonb_build_object('version','path-b-normalization-v1','sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)))->>'status',
 'normalization_complete','array_myheritage: only the same claimed source publishes after current native final fences');
select is((select jsonb_agg(jsonb_build_object('rsid',rsid,'genotype',genotype,'ref',ref,'alt',alt)) from public.user_variants
 where file_id=pg_temp.fxv('array-3','revision')::uuid and subject_id=pg_temp.sid('array-3')),
 '[{"rsid":762551,"genotype":"A/C","ref":null,"alt":null}]'::jsonb,
 'array_myheritage: saved fresh canonical readback is exactly the literal array reading');
select is((select count(*) from public.report_observed_calls where file_id=pg_temp.fxv('array-3','revision')::uuid),0::bigint,
 'array_myheritage: no fabricated VCF depth, filter or quality rows are persisted');
select is((select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('array-3')),0::bigint,
 'array_myheritage: normalization without a current purpose creates no analytic result binding');
select ok((select storage_object_id is null and status='stored' and normalization_completed_at is not null
 from public.genome_files where id=pg_temp.fxv('array-3','revision')::uuid),
 'array_myheritage: original remains in held object inventory, never an own-file storage binding');

-- array_ftdna: actual registered issuer, finalizer, account confirmation and claim.
select pg_temp.requested('array-4','e',repeat('e',64));
select is(pg_temp.account_confirms('e','array-sign-eeeeeeeeeeeeeeeeeeee','2',repeat('e',64)),
 'accepted','array_ftdna: the real pre-existing person account confirms the request');
select is(pg_temp.hold_array('array-4',pg_temp.sid('array-4'),'consumer-array-text-v4',repeat('e',64))->>'status',
 'stored_quarantined','array_ftdna: native finalization holds the exact declared array');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('array-4')),0::bigint,
 'array_ftdna: no readable source descriptor exists before exact revision confirmation');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('array-4')),0::bigint,
 'array_ftdna: no worker is admitted before exact revision confirmation');
select pg_temp.notice_session('array-4','4');
select is(public.respond_adult_upload_revision_v1(repeat('4',64),'array-confirm-4444qqqqqqqqqqqqqqqqqqqq',
 'confirm',pg_temp.a('2')),'confirmed','array_ftdna: actual file revision confirmation succeeds');
select lives_ok('set constraints all immediate','array_ftdna: confirmation passes every original deferred native constraint');
set constraints all deferred;
select is((select file_type::text from public.genome_files where id=pg_temp.fxv('array-4','revision')::uuid),
 'array_ftdna','array_ftdna: exact accepted internal format survives the queue descriptor');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('array-4') and kind='annotate_vcf'
 and output_kind='ingest.normalize' and computation_revision='path-b-normalization-v1'
 and source_binding_id=pg_temp.fxv('array-4','revision')::uuid and source_binding_kind='genome-file'),1::bigint,
 'array_ftdna: only the original dedicated exact source tuple is queued');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('array-4')),0::bigint,
 'array_ftdna: confirmation adds no analytic purpose');
select ok((private.claim_worker_job_v2('array-generic',repeat('7',64),60)).id is null,
 'array_ftdna: the ordinary worker cannot claim the dedicated confirmed array');
truncate array_claim;
insert into array_claim select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
select is((select c->>'fileId' from array_claim),pg_temp.fxv('array-4','revision'),
 'array_ftdna: actual bounded worker claims only that current confirmed revision');
select is((select c->>'fileType' from array_claim),'array_ftdna','array_ftdna: claimed source retains its actual array type');
select is(pg_temp.array_norm('check'),(select c from array_claim),'array_ftdna: each read checkpoint reproduces complete live authority');
select throws_ok($$select pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38',
 'rawSha256',repeat('e',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,
 'provenance','{}'::jsonb))$$,'22023','invalid_request','array_ftdna: no whole source is invented from an empty staging set');
select is(public.register_path_b_normalization_positions_v1((select(c->>'jobId')::uuid from array_claim),repeat('8',64),
 pg_temp.fxv('array-4','revision')::uuid,(select(c->>'claim')::uuid from array_claim),0,'GRCh38',
 '[{"source_chrom":15,"source_pos":74749576,"variant":{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"},"mapped":null}]',true),
 '{"acceptedVariantOrdinals":[0],"attempted":0,"unmapped":0}'::jsonb,
 'array_ftdna: native exact-claim ledger accepts unknown array alleles without synthesis');
select is(pg_temp.array_norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"}]}'),
 'true'::jsonb,'array_ftdna: literal arrays stage through the existing private native writer');
select is((select count(*) from public.user_variants where file_id=pg_temp.fxv('array-4','revision')::uuid),0::bigint,
 'array_ftdna: private staging is not canonical publication');
select is(pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('e',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance',
 jsonb_build_object('version','path-b-normalization-v1','sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)))->>'status',
 'normalization_complete','array_ftdna: only the same claimed source publishes after current native final fences');
select is((select jsonb_agg(jsonb_build_object('rsid',rsid,'genotype',genotype,'ref',ref,'alt',alt)) from public.user_variants
 where file_id=pg_temp.fxv('array-4','revision')::uuid and subject_id=pg_temp.sid('array-4')),
 '[{"rsid":762551,"genotype":"A/C","ref":null,"alt":null}]'::jsonb,
 'array_ftdna: saved fresh canonical readback is exactly the literal array reading');
select is((select count(*) from public.report_observed_calls where file_id=pg_temp.fxv('array-4','revision')::uuid),0::bigint,
 'array_ftdna: no fabricated VCF depth, filter or quality rows are persisted');
select is((select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('array-4')),0::bigint,
 'array_ftdna: normalization without a current purpose creates no analytic result binding');
select ok((select storage_object_id is null and status='stored' and normalization_completed_at is not null
 from public.genome_files where id=pg_temp.fxv('array-4','revision')::uuid),
 'array_ftdna: original remains in held object inventory, never an own-file storage binding');

select pg_temp.requested('array-revoked','f',repeat('f',64));
select is(pg_temp.account_confirms('f','array-revocation-sign-ffffffff','2',repeat('f',64)),
 'accepted','array revocation uses the actual current subject account');
select pg_temp.hold_array('array-revoked',pg_temp.sid('array-revoked'),'consumer-array-text-v1',repeat('f',64));
select pg_temp.notice_session('array-revoked','5');
select is(public.respond_adult_upload_revision_v1(repeat('5',64),'array-revocation-confirm-55555','confirm',pg_temp.a('2')),
 'confirmed','the separately confirmed array reaches its own genuine queue');
set constraints all immediate;
set constraints all deferred;
truncate array_claim;
insert into array_claim select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
select is(pg_temp.array_norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":762551,"chrom":15,"pos":74749576,"ref":null,"alt":null,"genotype":"A/C"}]}'),
 'true'::jsonb,'the array stages only under the current source authority');
update public.consents set revoked_at=clock_timestamp() where subject_id=pg_temp.sid('array-revoked') and consent_type='upload_class';
select throws_ok($$select pg_temp.array_norm('check')$$,'42501','not_found','array revocation refuses the next actual range checkpoint');
select throws_ok($$select pg_temp.array_norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('f',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 '42501','not_found','array revocation refuses final publication of already staged calls');
select is(pg_temp.array_norm('fail'),'true'::jsonb,'exact private array cleanup remains available after revocation');
select is((select count(*) from private.own_normalization_batches where file_id=pg_temp.fxv('array-revoked','revision')::uuid)
 +(select count(*) from public.user_variants where file_id=pg_temp.fxv('array-revoked','revision')::uuid),0::bigint,
 'the revoked array leaves neither private genetic batches nor canonical calls');
select * from finish();
set constraints all immediate;
rollback;
