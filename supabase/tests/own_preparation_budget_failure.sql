-- fail_own_preparation_claim_v1: the claim holder ends its own attempt and says
-- why. Measured need, 20 September 2026: a 2 GiB VCF exhausted
-- max_artifact_bytes after 540 artifacts, nothing retried it, and the row sat
-- `claimed` for the rest of its hour because freeze_due_own_preparations_v1
-- only freezes on a passed deadline or a third attempt.
--
-- A defect is planted per branch: bad reason, wrong attempt, wrong token, the
-- happy path, and replay after the transition. The fixture mirrors
-- own_preparation_checkpoints.sql, which is the nearest one that reaches a live
-- claim; identities differ so the two can run in the same suite.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('89210000-0000-4000-8000-000000000001','prepared-budget@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89210000-0000-4000-8000-000000000010','89210000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89210000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='89210000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89210000-0000-4000-8000-000000000001','89210000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('89210000-0000-4000-8000-000000000001','89210000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('89210000-0000-4000-8000-000000000001','89210000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table issued_upload as select public.issue_own_storage_upload_v1(
 '89210000-0000-4000-8000-000000000001','89210000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from issued_upload),'89210000-0000-4000-8000-000000000001','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '89210000-0000-4000-8000-000000000001','89210000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('89210000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '89210000-0000-4000-8000-000000000001','89210000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '89210000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
-- SQL authority and metadata only. No provider bytes are proved here.
create temporary table pub_receipts(label text primary key,value jsonb);
grant select,insert,update on pub_receipts to service_role;
grant select on finalized_upload to service_role;
-- A small artifact budget so a modest byte count exhausts it, the way a real
-- source does against the deployed one. The CHECK allows 1 to 1073741824.
update private.own_preparation_config set enabled=true,max_artifact_bytes=1000 where singleton;
create function pg_temp.file_id() returns uuid language sql as $$
 select (receipt->>'fileId')::uuid from finalized_upload; $$;
create function pg_temp.job_id() returns uuid language sql as $$
 select (value->>'jobId')::uuid from pub_receipts where label='claim'; $$;
create function pg_temp.attempt_id() returns uuid language sql as $$
 select (value->>'attemptId')::uuid from pub_receipts where label='claim'; $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into pub_receipts values('job',public.enqueue_own_preparation_v1('89210000-0000-4000-8000-000000000001',
 '89210000-0000-4000-8000-000000000010',pg_temp.file_id()));
insert into pub_receipts values('claim',public.claim_next_own_preparation_v1(repeat('e',64)));

-- The column starts null, and stays null for a job nothing has failed.
select is((select frozen_reason from private.own_preparation_jobs where id=pg_temp.job_id()),null::text,
 'a live claim carries no frozen reason');
select is((select state from private.own_preparation_jobs where id=pg_temp.job_id()),'claimed',
 'the fixture reaches a live claim before anything is failed');

-- A reason outside the closed set is refused, and nothing moves. The set is
-- closed because a surface chooses its wording from it.
select throws_ok($$select public.fail_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),'too_big',2000)$$,
 '22023','invalid_request','an unlisted reason is refused rather than stored');
select throws_ok($$select public.fail_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),null,2000)$$,
 '22023','invalid_request','a null reason is refused');
select is((select state from private.own_preparation_jobs where id=pg_temp.job_id()),'claimed',
 'a refused reason leaves the claim untouched');

-- Authority: the caller must hold this exact claim. It never names a job.
select throws_ok($$select public.fail_own_preparation_claim_v1(pg_temp.job_id(),gen_random_uuid(),repeat('e',64),'artifact_budget_exhausted',2000)$$,
 '42501','not_found','another attempt cannot end this one');
select throws_ok($$select public.fail_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('0',64),'artifact_budget_exhausted',2000)$$,
 '42501','not_found','wrong token cannot end the attempt');
select throws_ok($$select public.fail_own_preparation_claim_v1(gen_random_uuid(),pg_temp.attempt_id(),repeat('e',64),'artifact_budget_exhausted',2000)$$,
 '42501','not_found','a job this claim does not name cannot be reached');
select is((select state from private.own_preparation_jobs where id=pg_temp.job_id()),'claimed',
 'three refused attempts leave the claim live');

-- The reason is verified, not taken on the caller's word. 0 reserved bytes
-- plus 1 does not pass a 1000-byte budget, so the claim is false and refused;
-- a reason nothing corroborates would be an invented claim, and a surface
-- reads its wording from this column.
select throws_ok($$select public.fail_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),'artifact_budget_exhausted',1)$$,
 '22023','reason_not_established','a budget that is not spent cannot be recorded as spent');
select is((select state from private.own_preparation_jobs where id=pg_temp.job_id()),'claimed',
 'an unestablished reason leaves the claim live');
select is((select frozen_reason from private.own_preparation_jobs where id=pg_temp.job_id()),null::text,
 'an unestablished reason is not written');
select throws_ok($$select public.fail_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),'artifact_budget_exhausted',0)$$,
 '22023','invalid_request','a byte count of zero is refused before anything is read');

-- The happy path: the claim holder ends its own attempt, at once. 2000 bytes
-- against a 1000-byte budget is the same comparison the reserve makes.
insert into pub_receipts values('failed',
 public.fail_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),'artifact_budget_exhausted',2000));
select is((select value->>'state' from pub_receipts where label='failed'),'frozen',
 'the receipt is the freeze receipt, so the transition stays in one place');
select is((select state from private.own_preparation_jobs where id=pg_temp.job_id()),'frozen',
 'the job is frozen immediately, not at its deadline');
select is((select frozen_reason from private.own_preparation_jobs where id=pg_temp.job_id()),'artifact_budget_exhausted',
 'the reason is recorded by the call that ends the attempt');
select isnt((select frozen_at from private.own_preparation_jobs where id=pg_temp.job_id()),null::timestamptz,
 'freezing stamps the row the way the scan would have');

-- Replay is refused: the claim is no longer live, so the second call cannot
-- re-freeze or overwrite the reason.
select throws_ok($$select public.fail_own_preparation_claim_v1(pg_temp.job_id(),pg_temp.attempt_id(),repeat('e',64),'artifact_budget_exhausted',2000)$$,
 '42501','not_found','the ended attempt cannot be ended twice');
select is((select frozen_reason from private.own_preparation_jobs where id=pg_temp.job_id()),'artifact_budget_exhausted',
 'a refused replay does not disturb the recorded reason');

-- The scan has nothing left to do, and the original file is untouched.
select is(public.freeze_due_own_preparations_v1(),
 '{"version":"own-preparation-freeze-scan-v1","frozen":0,"cleanupComplete":false}'::jsonb,
 'a job already ended by its claim holder is not frozen again by the scan');
select is((select count(*)::integer from public.genome_files where id=pg_temp.file_id()),1,
 'ending a preparation preserves the original source row');
select is((select count(*)::integer from private.own_analysis_runs where file_id=pg_temp.file_id()),0,
 'a failed preparation grants no report readiness');
reset role;
select * from finish();
rollback;
