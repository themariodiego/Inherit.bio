-- A preparation retry is offered only to a job that can take it.
--
-- `own_preparation_artifacts` is unique(job_id,sequence), so one job owns one
-- artifact sequence namespace and a second attempt cannot restart at sequence
-- 0 while the first attempt's rows exist. `artifact_count` is monotonic for
-- that reason, and the worker requires a newly claimed attempt to start empty.
-- The claim predicate used to disagree, offering such jobs to attempts two and
-- three; each re-claimed and then failed at once with integrity_mismatch,
-- spending the retry budget on work that could not start.
--
-- `own_preparation_jobs.sql` cannot catch this: its retry case deliberately
-- uses a second source "without reading/adopting any artifact from the first
-- attempt", so its job has artifact_count 0. This file drives the same job
-- through both states, so the refusal is attributable to the consumed sequence
-- and to nothing else.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('89910000-0000-4000-8000-000000000001','preparation-retry@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89910000-0000-4000-8000-000000000010','89910000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89910000-0000-4000-8000-000000000001';
create temporary table retry_subject as select id from public.subjects
 where subject_account_id='89910000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89910000-0000-4000-8000-000000000001','89910000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('89910000-0000-4000-8000-000000000001','89910000-0000-4000-8000-000000000010',
 (select id from retry_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('89910000-0000-4000-8000-000000000001','89910000-0000-4000-8000-000000000010',
 (select id from retry_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table retry_issued as select public.issue_own_storage_upload_v1(
 '89910000-0000-4000-8000-000000000001','89910000-0000-4000-8000-000000000010',
 (select id from retry_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on retry_issued,retry_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from retry_issued),'89910000-0000-4000-8000-000000000001','{"size":8}');
create temporary table retry_finalizing as select public.begin_own_upload_finalization_v1(
 '89910000-0000-4000-8000-000000000001','89910000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from retry_issued)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('89910000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from retry_finalizing),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from retry_issued);
create temporary table retry_finalized as select public.complete_own_upload_finalization_v1(
 '89910000-0000-4000-8000-000000000001','89910000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from retry_issued),(select (receipt->>'claim')::uuid from retry_finalizing),
 '89910000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
grant select on retry_finalized to service_role;
create temporary table retry_receipts(label text primary key,receipt jsonb);
grant select,insert,update on retry_receipts to service_role;
update private.own_preparation_config set enabled=true where singleton;
create function pg_temp.retry_job_id() returns uuid language sql as $$
 select (receipt->>'jobId')::uuid from retry_receipts where label='first';
$$;

set local role service_role;
insert into retry_receipts values('job',public.enqueue_own_preparation_v1(
 '89910000-0000-4000-8000-000000000001','89910000-0000-4000-8000-000000000010',
 (select (receipt->>'fileId')::uuid from retry_finalized)));
insert into retry_receipts values('first',public.claim_next_own_preparation_v1(repeat('1',64)));
reset role;
select ok((select attempts=1 and artifact_count=0 and state='claimed'
 from private.own_preparation_jobs where id=pg_temp.retry_job_id()),
 'the first attempt holds a claimed job that has consumed none of its sequence');

-- Control: a job that wrote nothing is exactly what the retry budget is for.
-- Backoff at one attempt is 30*2^1 seconds, so move the claim past it.
update private.own_preparation_jobs set claim_expires_at=clock_timestamp()-interval '61 seconds'
 where id=pg_temp.retry_job_id();
set local role service_role;
insert into retry_receipts values('second',public.claim_next_own_preparation_v1(repeat('2',64)));
reset role;
select isnt((select receipt from retry_receipts where label='second'),null::jsonb,
 'a lapsed attempt that reserved nothing is offered to the next attempt');
select is((select attempts::integer from private.own_preparation_jobs where id=pg_temp.retry_job_id()),2,
 'the retry spent exactly one attempt');

-- Now consume one sequence position. The artifact's write lease is
-- least(now+30s, claim_expires_at, ...), so shortening the claim first makes
-- the lease elapse in about a second rather than thirty, and it is allowed to
-- elapse rather than rewritten: write_expires_at is immutable by design.
update private.own_preparation_jobs set claim_expires_at=clock_timestamp()+interval '1 second'
 where id=pg_temp.retry_job_id();
set local role service_role;
select public.reserve_own_preparation_artifact_v1(pg_temp.retry_job_id(),
 (select (receipt->>'attemptId')::uuid from retry_receipts where label='second'),repeat('2',64),
 jsonb_build_object('kind','container','sequence',0,'byteCount',8,'sha256',repeat('f',64)));
reset role;
select is((select artifact_count::integer from private.own_preparation_jobs where id=pg_temp.retry_job_id()),1,
 'the second attempt consumed sequence 0 of the job');
select pg_sleep(1.2);
select ok((select max(write_expires_at)<=clock_timestamp() from private.own_preparation_artifacts
 where job_id=pg_temp.retry_job_id()),'every write lease has elapsed, so no live writer explains a refusal');
-- Backoff at two attempts is 30*2^2 seconds.
update private.own_preparation_jobs set claim_expires_at=clock_timestamp()-interval '121 seconds'
 where id=pg_temp.retry_job_id();
set local role service_role;
select is(public.claim_next_own_preparation_v1(repeat('3',64)),null::jsonb,
 'a job that consumed part of its sequence is not offered a retry no attempt could take');
reset role;
select is((select attempts::integer from private.own_preparation_jobs where id=pg_temp.retry_job_id()),2,
 'the refusal spends no attempt, so the budget is not burned on work that cannot start');
select ok((select state='claimed' and artifact_count=1
 from private.own_preparation_jobs where id=pg_temp.retry_job_id()),
 'the job keeps its recorded artifacts for scratch cleanup rather than being silently reset');
select * from finish();
rollback;
