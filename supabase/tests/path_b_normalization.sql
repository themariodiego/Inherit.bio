-- Synthetic, rollback-only Path B queued normalization and source boundaries.
-- Real byte parsing is proven by the paired worker unit tests; these cases
-- exercise actual database claim, authorization, atomic publication and RLS.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

\ir fixtures/path_b_source_setup.inc


update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','norm-sign-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),
 'accepted','the subject confirms with an independently existing account');
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
select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64));
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('main')),0::bigint,
 'an unconfirmed revision creates no source descriptor');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main')),0::bigint,
 'an unconfirmed revision creates no normalization job');
select pg_temp.notice_session('main','1');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'norm-confirm-1111111111111111','confirm',pg_temp.a('2')),
 'confirmed','the person confirms this exact file revision');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('main')),1::bigint,
 'confirmation creates one exact source descriptor after all common gates pass');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main') and kind='annotate_vcf'
 and output_kind='ingest.normalize' and source_binding_kind='genome-file'
 and source_binding_id=pg_temp.fxv('main','revision')::uuid),1::bigint,
 'confirmation queues only the registered source-revision normalization identity');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('main')),0::bigint,
 'confirmation and queue admission do not create an analytic purpose');
select throws_ok($$update public.worker_jobs set payload=jsonb_set(payload,'{authority,uploaderAccountId}',to_jsonb(pg_temp.a('9')::text))
 where subject_id=pg_temp.sid('main')$$,'23514','Path B normalization authority is immutable',
 'a queued source cannot replace its authority snapshot while preserving the dispatch tuple');
select throws_ok($$update public.worker_jobs set user_id=pg_temp.a('9') where subject_id=pg_temp.sid('main')$$,
 '23514','Path B normalization authority is immutable','a queued source cannot replace its billing owner');
select throws_ok($$update public.worker_jobs set file_id=null where subject_id=pg_temp.sid('main')$$,
 '23514','Path B normalization authority is immutable','a queued source cannot detach its exact file descriptor');
select ok((private.claim_worker_job_v2('synthetic-generic',repeat('7',64),60)).id is distinct from
 (select id from public.worker_jobs where subject_id=pg_temp.sid('main')),
 'the generic worker never receives the dedicated Path B job');
select throws_ok($$select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,false)$$,
 '42501','not_found','the test jurisdiction is required at claim');
create temporary table norm_manifest(c jsonb);
insert into norm_manifest select public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
grant select on norm_manifest,fx,held_fx to authenticated;
select is((select c->>'fileId' from norm_manifest),pg_temp.fxv('main','revision'),
 'the worker claims exactly the confirmed revision descriptor');
create function pg_temp.norm(p_operation text,p_payload jsonb default null) returns jsonb language sql as $$
 select public.path_b_normalization_v1(p_operation,(c->>'jobId')::uuid,repeat('8',64),(c->>'claim')::uuid,p_payload,true)
 from norm_manifest;
$$;
select is(pg_temp.norm('check'),(select c from norm_manifest),'each range has the identical current source manifest');
select throws_ok($$select public.path_b_normalization_v1('check',(select (c->>'jobId')::uuid from norm_manifest),
 repeat('7',64),(select (c->>'claim')::uuid from norm_manifest),null,true)$$,
 '42501','not_found','a different claim hash cannot read the source');
select is(public.register_path_b_normalization_positions_v1((select (c->>'jobId')::uuid from norm_manifest),
 repeat('8',64),pg_temp.fxv('main','revision')::uuid,(select (c->>'claim')::uuid from norm_manifest),0,'GRCh38',
 '[{"source_chrom":1,"source_pos":100000,"variant":{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"},"mapped":null}]',true),
 '{"acceptedVariantOrdinals":[0],"attempted":0,"unmapped":0}'::jsonb,'the exact claim owns bounded source-position registration');
select is(pg_temp.norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}'),
 'true'::jsonb,'canonical rows stage privately under the same current claim');
select is((select count(*) from public.user_variants where file_id=pg_temp.fxv('main','revision')::uuid),0::bigint,
 'staging exposes no canonical genetic rows');
select throws_ok($$select pg_temp.norm('stage','{"kind":"variants","sequence":0,"rows":[{}]}')$$,
 '22023','invalid_request','duplicate stage sequence is rejected');
-- A synthetic trigger models time expiry during the private INSERT itself;
-- the same SQL statement must roll back both the staged row and the mutation.
create function pg_temp.expire_stage_claim() returns trigger language plpgsql as $$
begin
 update private.own_normalization_runs set expires_at=clock_timestamp()-interval '1 second' where file_id=new.file_id;
 return new;
end;
$$;
create trigger synthetic_expire_path_b_stage after insert on private.own_normalization_batches
 for each row execute function pg_temp.expire_stage_claim();
select throws_ok($$select pg_temp.norm('stage','{"kind":"variants","sequence":1,"rows":[{"rsid":124,"chrom":1,"pos":100001,"ref":"A","alt":"G","genotype":"A/G"}]}')$$,
 '42501','not_found','expiry inside the stage write rolls back its whole statement');
select is((select count(*) from private.own_normalization_batches where file_id=pg_temp.fxv('main','revision')::uuid),1::bigint,
 'the failed statement adds no extra staged genetic row');
select ok((select expires_at>clock_timestamp() from private.own_normalization_runs where file_id=pg_temp.fxv('main','revision')::uuid),
 'the failed statement also rolls back its synthetic deadline mutation');
drop trigger synthetic_expire_path_b_stage on private.own_normalization_batches;
select throws_ok($$select pg_temp.norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('f',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 '22023','invalid_request','a different source hash cannot publish canonical rows');
select is(pg_temp.norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('e',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,
 'provenance',jsonb_build_object('version','path-b-normalization-v1','sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0))),
 jsonb_build_object('fileId',pg_temp.fxv('main','revision'),'status','normalization_complete','analysisState','not_generated'),
 'terminal publication returns only normalization completion, never report readiness');
select is((select count(*) from public.user_variants where file_id=pg_temp.fxv('main','revision')::uuid),1::bigint,
 'the final fenced transaction publishes the complete synthetic canonical batch');
select is((select count(*) from private.own_normalization_batches where file_id=pg_temp.fxv('main','revision')::uuid),0::bigint,
 'successful publication deletes all private staged genetic rows');
select ok((select status='done' and claim_token_hash is null and claim_expires_at is null
 from public.worker_jobs where subject_id=pg_temp.sid('main')),'the completed worker claim has no live bearer');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('main')),0::bigint,
 'normalization creates no analytic purpose');
select throws_ok($$select pg_temp.norm('fail')$$,'42501','not_found','late cleanup cannot erase completed canonical rows');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('main'),'reports.monogenic')->>'gate',
 'directional-purpose-grant-v1','normalization cannot authorize uploader reading');
select is(private.path_b_result_read_v1(pg_temp.a('2'),pg_temp.sid('main'),'reports.monogenic')->>'gate',
 'directional-purpose-grant-v1','normalization cannot authorize the subject''s analytic reading');
-- A real exact-purpose grant advances the source gate, never the execution gate.
select public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic','self',
 a.version,a.body_sha256,repeat('6',64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key='consent.own-monogenic' and a.superseded_at is null;
select is(private.path_b_result_read_v1(pg_temp.a('2'),pg_temp.sid('main'),'reports.monogenic')->>'gate',
 'analysis-not-generated','the exact granted layer sees completed source and the separate execution gate');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('main'),'reports.monogenic')->>'gate',
 'directional-purpose-grant-v1','the subject''s own result grant does not share it with the uploader');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status)
 select '0b5e0000-0000-4000-8000-000000000040',pg_temp.a('1'),id,
 '0b5e0000-0000-4000-8000-000000000041','synthetic-self.vcf','vcf',1,8,repeat('a',64),'stored'
 from public.subjects where subject_account_id=pg_temp.a('1') and subject_class='self';
insert into public.user_variants(user_id,file_id,subject_id,rsid,chrom,pos,ref,alt,genotype)
 select user_id,id,subject_id,125,1,100002,'A','G','A/G' from public.genome_files
 where id='0b5e0000-0000-4000-8000-000000000040';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0b5e0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(private.is_path_b_file_v1('0b5e0000-0000-4000-8000-000000000040'),false,
 'the policy helper keeps a self source readable');
select is((select count(*) from public.genome_files where id='0b5e0000-0000-4000-8000-000000000040'),1::bigint,
 'the uploader can still read their own self-file positive control');
select is((select count(*) from public.user_variants where file_id='0b5e0000-0000-4000-8000-000000000040'),1::bigint,
 'the uploader can still read their own self-variant positive control');
select is(private.is_path_b_file_v1((select (c->>'fileId')::uuid from norm_manifest)),true,
 'the policy helper denies the uploader''s actual other-adult descriptor');
select is((select count(*) from public.genome_files where id=(select (c->>'fileId')::uuid from norm_manifest)),0::bigint,
 'legacy file ownership exposes no Path B descriptor to its uploader');
select is((select count(*) from public.user_variants where file_id=(select (c->>'fileId')::uuid from norm_manifest)),0::bigint,
 'legacy variant ownership exposes no Path B genetic data to its uploader');
select set_config('request.jwt.claims','{"sub":"0b5e0000-0000-4000-8000-000000000009","role":"authenticated"}',true);
select is(private.is_path_b_file_v1((select (c->>'fileId')::uuid from norm_manifest)),false,
 'the policy helper discloses no foreign-account Path B presence');
select is(private.is_path_b_file_v1('0b5e0000-0000-4000-8000-000000000040'),false,
 'the policy helper discloses no foreign-account self-file presence');
select is(private.is_path_b_file_v1('0b5e0000-0000-4000-8000-000000000099'),false,
 'an absent file and either foreign file produce the identical boolean');
select is((select count(*) from public.genome_files where id in
 ('0b5e0000-0000-4000-8000-000000000040'::uuid,(select (c->>'fileId')::uuid from norm_manifest))),0::bigint,
 'an outsider reads neither another account''s self file nor its Path B descriptor');
select is((select count(*) from public.user_variants where file_id in
 ('0b5e0000-0000-4000-8000-000000000040'::uuid,(select (c->>'fileId')::uuid from norm_manifest))),0::bigint,
 'an outsider reads neither another account''s self variants nor its Path B variants');
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select is((select count(*) from public.genome_files),0::bigint,
 'anonymous file reads return no rows without evaluating the authenticated-only helper');
select is((select count(*) from public.user_variants),0::bigint,
 'anonymous variant reads return no rows without evaluating the authenticated-only helper');
reset role;
select set_config('request.jwt.claims','{"sub":"0b5e0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(not has_function_privilege('authenticated','public.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean)','EXECUTE'),
 'an authenticated browser cannot claim or publish normalization');
select ok(not has_function_privilege('inherit_upload_only','public.path_b_normalization_v1(text,uuid,text,uuid,jsonb,boolean)','EXECUTE'),
 'an upload-only credential cannot claim or publish normalization');
select ok(private.end_other_adult_held_upload_v1(pg_temp.fxv('main','revision')::uuid,'deleted'),
 'the existing exact source disposition ends a normalized revision');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('main'))
 +(select count(*) from public.user_variants where subject_id=pg_temp.sid('main'))
 +(select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main')),0::bigint,
 'the same source disposition removes its descriptor, canonical rows and job');
select is((select count(*) from storage.objects where id=pg_temp.fxv('main','object')::uuid),1::bigint,
 'the original handle remains for the existing proven storage deletion executor');
select is((select count(*) from public.upload_staging_objects where upload_session_id=pg_temp.fxv('main','upload')::uuid
 and object_name=pg_temp.fxv('main','final')),1::bigint,'cleanup retains the exact original reference until object deletion is proved');
-- Revocation after staging is checked against actual current DB evidence.
select pg_temp.requested('revoked','b',repeat('b',64));
select is(pg_temp.account_confirms('b','norm-sign-bbbbbbbbbbbbbbbbbbb','2',repeat('b',64)),
 'accepted','a separate synthetic revision has its own subject confirmation');
select pg_temp.hold('revoked',pg_temp.sid('revoked'),repeat('d',64));
select pg_temp.notice_session('revoked','2');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'norm-confirm-2222222222222222','confirm',pg_temp.a('2')),
 'confirmed','the separate revision is confirmed before claim');
update norm_manifest set c=public.path_b_normalization_v1('claim',null,repeat('8',64),null,null,true);
select is(pg_temp.norm('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}'),
 'true'::jsonb,'a separate current claim stages a private batch');
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where subject_id=pg_temp.sid('revoked') and consent_type='upload_class';
select throws_ok($$select pg_temp.norm('check')$$,'42501','not_found','revocation denies the next bounded source read');
select throws_ok($$select pg_temp.norm('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('d',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 '42501','not_found','revocation denies publication of already staged batches');
select is(pg_temp.norm('fail'),'true'::jsonb,'exact private cleanup remains available after permission revocation');
select is((select count(*) from private.own_normalization_batches where file_id=pg_temp.fxv('revoked','revision')::uuid)
 +(select count(*) from public.user_variants where file_id=pg_temp.fxv('revoked','revision')::uuid),0::bigint,
 'revoked source leaves neither private staged rows nor published genetic rows');
select * from finish();
rollback;
