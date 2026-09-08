begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email,email_confirmed_at) values('89500000-0000-4000-8000-000000000001','position-registration@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89500000-0000-4000-8000-000000000010','89500000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89500000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='89500000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89500000-0000-4000-8000-000000000001','89500000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('89500000-0000-4000-8000-000000000001','89500000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('89500000-0000-4000-8000-000000000001','89500000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table issued_upload as select public.issue_own_storage_upload_v1(
 '89500000-0000-4000-8000-000000000001','89500000-0000-4000-8000-000000000010',
 (select id from generation_subject),'VCF.GZ',8,repeat('a',64)) receipt;
grant select on issued_upload,generation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from issued_upload),'89500000-0000-4000-8000-000000000001','{"size":8}');
create temporary table finalizing_upload as select public.begin_own_upload_finalization_v1(
 '89500000-0000-4000-8000-000000000001','89500000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('89500000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from issued_upload);
create temporary table finalized_upload as select public.complete_own_upload_finalization_v1(
 '89500000-0000-4000-8000-000000000001','89500000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from issued_upload),(select (receipt->>'claim')::uuid from finalizing_upload),
 '89500000-0000-4000-8000-000000000020',repeat('a',64),repeat('b',64)) receipt;
reset role;
select ok((select u.status='promoted' and u.upload_consent_id=sc.id and u.finalized_file_id=(f.receipt->>'fileId')::uuid
 from public.upload_sessions u join public.subject_consents sc on sc.id=u.upload_consent_id
 cross join finalized_upload f where u.id=(select (receipt->>'uploadId')::uuid from issued_upload)),
 'real finalization retains an exact consent-bound promoted upload session');
create temporary table normalization_manifest(receipt jsonb);
grant select,insert,update,delete on normalization_manifest to service_role;
create function pg_temp.normalize(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'89500000-0000-4000-8000-000000000001',
 '89500000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload),
 case when op='begin' then null else (select (receipt->>'claim')::uuid from normalization_manifest) end,payload);
$$;
insert into normalization_manifest select pg_temp.normalize('begin');
create function pg_temp.entry(pos bigint,variant boolean default true,mapped boolean default true,chrom integer default 1) returns jsonb language sql as $$
 select jsonb_build_object('source_chrom',chrom,'source_pos',pos,'mapped',mapped,'variant',
 case when variant then jsonb_build_object('rsid',123,'chrom',chrom,'pos',pos,'ref','A','alt','G','genotype','A/G') else null end);
$$;
create function pg_temp.register(seq integer,entries jsonb,build text default 'GRCh37') returns jsonb language sql as $$
 select public.register_own_normalization_positions_v1('89500000-0000-4000-8000-000000000001',
 '89500000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload),
 (select (receipt->>'claim')::uuid from normalization_manifest),seq,build,entries);
$$;
insert into auth.users(id,email,email_confirmed_at) values('89600000-0000-4000-8000-000000000001','position-isolation@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89600000-0000-4000-8000-000000000010','89600000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89600000-0000-4000-8000-000000000001';
create temporary table isolation_subject as select id from public.subjects
 where subject_account_id='89600000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89600000-0000-4000-8000-000000000001','89600000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['c','d']) letter;
select public.sign_own_upload_artifact_v1('89600000-0000-4000-8000-000000000001','89600000-0000-4000-8000-000000000010',
 (select id from isolation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('c',64));
select public.sign_own_upload_artifact_v1('89600000-0000-4000-8000-000000000001','89600000-0000-4000-8000-000000000010',
 (select id from isolation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('d',64));
-- Keep the actual consent-bound session created by issuance/finalization.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table isolation_issued_upload as select public.issue_own_storage_upload_v1(
 '89600000-0000-4000-8000-000000000001','89600000-0000-4000-8000-000000000010',
 (select id from isolation_subject),'VCF.GZ',8,repeat('c',64)) receipt;
grant select on isolation_issued_upload,isolation_subject to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from isolation_issued_upload),'89600000-0000-4000-8000-000000000001','{"size":8}');
create temporary table isolation_finalizing_upload as select public.begin_own_upload_finalization_v1(
 '89600000-0000-4000-8000-000000000001','89600000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from isolation_issued_upload)) receipt;
insert into storage.objects(id,bucket_id,name,metadata) values('89600000-0000-4000-8000-000000000020',
 'genomes',(select receipt->>'finalKey' from isolation_finalizing_upload),'{"size":8}');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from isolation_issued_upload);
create temporary table isolation_finalized_upload as select public.complete_own_upload_finalization_v1(
 '89600000-0000-4000-8000-000000000001','89600000-0000-4000-8000-000000000010',
 (select (receipt->>'uploadId')::uuid from isolation_issued_upload),(select (receipt->>'claim')::uuid from isolation_finalizing_upload),
 '89600000-0000-4000-8000-000000000020',repeat('c',64),repeat('d',64)) receipt;
reset role;
create temporary table isolation_manifest as select public.own_upload_normalization_v1('begin',
 '89600000-0000-4000-8000-000000000001','89600000-0000-4000-8000-000000000010',
 (select (receipt->>'fileId')::uuid from isolation_finalized_upload)) receipt;
select public.register_own_normalization_positions_v1('89600000-0000-4000-8000-000000000001','89600000-0000-4000-8000-000000000010',
 (select (receipt->>'fileId')::uuid from isolation_finalized_upload),(select (receipt->>'claim')::uuid from isolation_manifest),0,'GRCh38',
 '[{"source_chrom":1,"source_pos":100,"mapped":null,"variant":{"rsid":999,"chrom":1,"pos":100,"ref":"A","alt":"C","genotype":"A/C"}}]');
create temporary table isolation_before as select to_jsonb(n) run,to_jsonb(f) file,to_jsonb(d) position
 from private.own_normalization_runs n join public.genome_files f on f.id=n.file_id
 join private.own_normalization_positions d on d.file_id=f.id
 where n.account_id='89600000-0000-4000-8000-000000000001';

create temporary table original_run as select claim,expires_at,authority,manifest from private.own_normalization_runs
 where file_id=(select (receipt->>'fileId')::uuid from finalized_upload);
-- Exact PostgreSQL JSONB byte counts: the new registration envelope must not
-- reject an existing-valid singleton. No file/decoded/stage ceiling is raised.
savepoint byte_envelope;
create temporary table byte_variant as select jsonb_build_object('rsid',null,'chrom',1,'pos',100000,
 'ref','A','alt',repeat('C',1999930),'genotype','A/'||repeat('C',1999930)) value;
select is((select octet_length(jsonb_build_object('kind','variants','sequence',0,'rows',jsonb_build_array(value))::text) from byte_variant),3999989,
 'near-cap singleton remains below the original four-MB stage bound');
select is((select octet_length(jsonb_build_array(jsonb_build_object('source_chrom',1,'source_pos',100000,'mapped',null,'variant',value))::text) from byte_variant),4000014,
 'only the new registration metadata crosses four MB');
select is(pg_temp.register(0,(select jsonb_build_array(jsonb_build_object('source_chrom',1,'source_pos',100000,'mapped',null,'variant',value)) from byte_variant),'GRCh38'),
 '{"acceptedVariantOrdinals":[0],"attempted":0,"unmapped":0}'::jsonb,'bounded registration headroom accepts the old-valid singleton');
select is(pg_temp.normalize('stage',(select jsonb_build_object('kind','variants','sequence',0,'rows',jsonb_build_array(value)) from byte_variant)),
 'true'::jsonb,'unchanged actual stage accepts the exact same near-cap variant');
rollback to byte_envelope;
savepoint original_stage_bound;
select pg_temp.register(0,jsonb_build_array(jsonb_build_object('source_chrom',1,'source_pos',100000,'mapped',null,
 'variant',jsonb_build_object('rsid',null,'chrom',1,'pos',100000,'ref','A','alt',repeat('C',2000000),'genotype','A/'||repeat('C',2000000)))),'GRCh38');
select throws_ok($$select pg_temp.normalize('stage',jsonb_build_object('kind','variants','sequence',0,'rows',jsonb_build_array(
 jsonb_build_object('rsid',null,'chrom',1,'pos',100000,'ref','A','alt',repeat('C',2000000),'genotype','A/'||repeat('C',2000000)))))$$,
 '22023','invalid_request','registration metadata allowance does not enlarge the existing genetic stage bound');
rollback to original_stage_bound;
select throws_ok($$select pg_temp.register(0,jsonb_build_array(jsonb_build_object('source_chrom',1,'source_pos',100000,'mapped',null,
 'variant',jsonb_build_object('rsid',null,'chrom',1,'pos',100000,'ref','A','alt',repeat('C',2000500),'genotype','A/'||repeat('C',2000500)))),'GRCh38')$$,
 '22023','invalid_request','registration allowance is itself bounded to 1024 extra metadata bytes');
savepoint pristine;
set local role service_role;
select is(pg_temp.register(0,jsonb_build_array(pg_temp.entry(100,false),pg_temp.entry(100),pg_temp.entry(100),
 pg_temp.entry(200,false,false),pg_temp.entry(300,true,null,23))),
 '{"acceptedVariantOrdinals":[1,4],"attempted":2,"unmapped":1}'::jsonb,
 'actual service role accepts first variant after observation, deduplicates same-batch variant and excludes nonautosomal count');
reset role;
select is(pg_temp.register(1,jsonb_build_array(pg_temp.entry(100,false),pg_temp.entry(200,true,false))),
 '{"acceptedVariantOrdinals":[1],"attempted":2,"unmapped":1}'::jsonb,
 'an earlier observation position accepts its first later variant without recounting the position');
select is(pg_temp.register(2,jsonb_build_array(pg_temp.entry(100),pg_temp.entry(200,true,false))),
 '{"acceptedVariantOrdinals":[],"attempted":2,"unmapped":1}'::jsonb,'identical cross-batch variants are not emitted again');
select results_eq($$select claim,expires_at,authority,manifest from private.own_normalization_runs where account_id='89500000-0000-4000-8000-000000000001'$$,
 $$select * from original_run$$,'registration does not renew the lease or change immutable authority/source manifest');
select is((select count(*) from private.own_normalization_positions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),3::bigint,'one private row represents each source position');
select is((select count(*) from public.user_variants where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'registration publishes no genetic rows');
select throws_ok($$select pg_temp.register(2,jsonb_build_array(pg_temp.entry(400)))$$,'22023','invalid_request','duplicate sequence is refused');
select throws_ok($$select pg_temp.register(4,jsonb_build_array(pg_temp.entry(400)))$$,'22023','invalid_request','dropped sequence is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(100)||jsonb_build_object('variant',(pg_temp.entry(100)->'variant')||'{"genotype":"G/G"}'::jsonb)))$$,
 '22023','normalization_position_conflict','conflicting cross-batch literal variant refuses');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400),pg_temp.entry(400)||jsonb_build_object('variant',(pg_temp.entry(400)->'variant')||'{"rsid":124}'::jsonb)))$$,
 '22023','normalization_position_conflict','conflicting within-batch variant refuses before representative selection');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(100,true,false)))$$,'22023','normalization_position_conflict','point mapping cannot change across batches');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400),pg_temp.entry(400,false,false)))$$,'22023','normalization_position_conflict','point mapping cannot conflict within a batch');
select is((select position_sequence from private.own_normalization_runs where account_id='89500000-0000-4000-8000-000000000001'),3,'all rejected batches preserve the next sequence');
select throws_ok($$select pg_temp.register(3,null,'GRCh37')$$,'22023','invalid_request','SQL NULL entries is refused');
select throws_ok($$select pg_temp.register(3,'null'::jsonb,'GRCh37')$$,'22023','invalid_request','JSON null entries is refused');
select throws_ok($$select pg_temp.register(3,'[]'::jsonb,'GRCh37')$$,'22023','invalid_request','empty entries is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400,true,null)),'GRCh37')$$,'22023','invalid_request','null mapped autosome is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)||'{"mapped":"true"}'::jsonb),'GRCh37')$$,'22023','invalid_request','string mapped is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)-'variant'),'GRCh37')$$,'22023','invalid_request','missing variant is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)||'{"account_id":null}'::jsonb),'GRCh37')$$,'22023','invalid_request','unknown entry key is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)||'{"source_pos":null}'::jsonb),'GRCh37')$$,'22023','invalid_request','null source position is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)||'{"source_pos":1.5}'::jsonb),'GRCh37')$$,'22023','invalid_request','fractional source position is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)||jsonb_build_object('variant',pg_temp.entry(401)->'variant')),'GRCh37')$$,'22023','invalid_request','variant position mismatch is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)||jsonb_build_object('variant',(pg_temp.entry(400)->'variant')||'{"extra":1}'::jsonb)),'GRCh37')$$,'22023','invalid_request','unknown variant key is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)||jsonb_build_object('variant',(pg_temp.entry(400)->'variant')||'{"genotype":null}'::jsonb)),'GRCh37')$$,'22023','invalid_request','null genotype is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)),null)$$,'22023','invalid_request','null source build is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400,true,null)),'GRCh38')$$,'22023','invalid_request','source build changed is refused');
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)),'GRCh38')$$,'22023','invalid_request','mapped GRCh38 is refused');
select throws_ok($$select pg_temp.register(3,(select jsonb_agg(pg_temp.entry(n)) from generate_series(1,1001)n),'GRCh37')$$,'22023','invalid_request','oversized batch is refused');
select throws_ok($$select public.register_own_normalization_positions_v1('89500000-0000-4000-8000-000000000001',
 '89500000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload),gen_random_uuid(),3,'GRCh37',jsonb_build_array(pg_temp.entry(400)))$$,
 '42501','not_found','a foreign claim cannot use or alter the index');
savepoint session_loss;
delete from auth.sessions where id='89500000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)))$$,'42501','not_found','session deletion denies registration');
rollback to session_loss;
savepoint withdrawal;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where account_id='89500000-0000-4000-8000-000000000001' and consent_type='upload_class';
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)))$$,'55000','upload_consent_required','store withdrawal denies registration');
select is(pg_temp.normalize('fail'),'true'::jsonb,'failed claim can clean its own working rows after withdrawal');
select is((select count(*) from private.own_normalization_positions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'fail transition removes the genetic index');
rollback to withdrawal;
savepoint expiry;
update private.own_normalization_runs set expires_at=clock_timestamp()-interval '1 second' where account_id='89500000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.register(3,jsonb_build_array(pg_temp.entry(400)))$$,'42501','not_found','expired claim cannot register');
select is(public.reap_expired_own_normalizations_v1(),1,'actual expired-run reaper cleans the exact fixture');
select is((select count(*) from private.own_normalization_positions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'reaper removes index even while retaining the failed run');
rollback to expiry;
savepoint restart;
update private.own_normalization_runs set expires_at=clock_timestamp()-interval '1 second' where account_id='89500000-0000-4000-8000-000000000001';
select lives_ok($$select pg_temp.normalize('begin')$$,'new claim can restart an expired run');
select is((select count(*) from private.own_normalization_positions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'restart cannot inherit previous claim positions');
select is((select position_sequence from private.own_normalization_runs where account_id='89500000-0000-4000-8000-000000000001'),0,'restart resets sequence and counters');
rollback to restart;
-- Completed and rejected branches start from the same genuine unregistered run.
rollback to pristine;
savepoint rejected;
select is(pg_temp.register(0,jsonb_build_array(pg_temp.entry(100,true,null)),'GRCh38'),
 '{"acceptedVariantOrdinals":[0],"attempted":0,"unmapped":0}'::jsonb,'GRCh38 retains legacy zero liftover counts');
select lives_ok($$select pg_temp.normalize('reject-build')$$,'rejected-build transition remains available before source staging');
select is((select count(*) from private.own_normalization_positions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'rejected-build transition clears registration scratch');
rollback to rejected;
savepoint legacy;
select pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100,"ref":"A","alt":"G","genotype":"A/G"}]}');
select lives_ok($$select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb))$$,
 'legacy runtime can complete without registration');
rollback to legacy;
select pg_temp.register(0,jsonb_build_array(pg_temp.entry(100,true,null),pg_temp.entry(100,false,null)),'GRCh38');
select pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100,"ref":"A","alt":"G","genotype":"A/G"}]}');
select pg_temp.normalize('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":1,"source_pos":100,"source_ref":"A","source_alt":"G","source_gt":"0/1","rsid":123,"chrom":1,"pos":100,"ref":"A","alt":"G","genotype":"A/G","quality_state":"pass","usable":true},{"source_line":8,"source_chrom":1,"source_pos":100,"source_ref":"A","source_alt":"G","source_gt":"0/1","rsid":123,"chrom":1,"pos":100,"ref":"A","alt":"G","genotype":"A/G","quality_state":"pass","usable":true}]}');
savepoint cleanup_expiry;
create temporary sequence cleanup_entered;
create function pg_temp.cross_cleanup_deadline() returns trigger language plpgsql as $$
declare remaining numeric;
begin
 if old.file_id=(select (receipt->>'fileId')::uuid from finalized_upload) then
  perform nextval('pg_temp.cleanup_entered');
  select extract(epoch from expires_at-clock_timestamp()) into remaining from private.own_normalization_runs where file_id=old.file_id;
  if remaining is null or remaining>3 then raise exception 'fixture_deadline_out_of_bounds'; end if;
  perform pg_sleep(greatest(remaining,0)::double precision+0.02);
 end if;
 return old;
end;
$$;
create trigger fixture_cleanup_deadline after delete on private.own_normalization_positions
 for each row execute function pg_temp.cross_cleanup_deadline();
update private.own_normalization_runs set expires_at=clock_timestamp()+interval '1 second'
 where account_id='89500000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',2,'provenance','{}'::jsonb))$$,
 '42501','not_found','the unchanged final publication fence includes actual index-cleanup time');
select is((select last_value from cleanup_entered),1::bigint,'actual scratch-row deletion entered the bounded deadline hook');
select is((select count(*) from private.own_normalization_positions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),1::bigint,'expired completion rolls back scratch deletion');
select is((select count(*) from public.user_variants where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'expired completion publishes no variant');
select is((select count(*) from public.report_observed_calls where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'expired completion publishes no observation');
select is((select state from private.own_normalization_runs where account_id='89500000-0000-4000-8000-000000000001'),'running','expired completion leaves its exact private claim for failure cleanup');
rollback to cleanup_expiry;
select lives_ok($$select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',2,'provenance','{}'::jsonb))$$,
 'existing atomic completion publishes staged deduplicated variants and all observations');
select is((select count(*) from private.own_normalization_positions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'completion removes all private position scratch');
select is((select count(*) from public.user_variants where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),1::bigint,'one variant is published');
select is((select count(*) from public.report_observed_calls where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),2::bigint,'duplicate-source observations remain separate');
select ok(exists(select 1 from public.purge_target_stores where target_id='variant-rows' and store_name='private.own_normalization_positions'),'genetic scratch is in the registered purge store inventory');
select ok(not has_table_privilege('service_role','private.own_normalization_positions','SELECT') and not has_table_privilege('authenticated','private.own_normalization_positions','SELECT'),'scratch table has no direct service or browser read');
select ok(not has_function_privilege('anon','public.register_own_normalization_positions_v1(uuid,uuid,uuid,uuid,integer,text,jsonb)','EXECUTE') and
 not has_function_privilege('authenticated','public.register_own_normalization_positions_v1(uuid,uuid,uuid,uuid,integer,text,jsonb)','EXECUTE') and
 not has_function_privilege('inherit_upload_only','public.register_own_normalization_positions_v1(uuid,uuid,uuid,uuid,integer,text,jsonb)','EXECUTE'),'registration is service-only');
-- Actual selected-file deletion follows completed normalization and exact Storage ACK.
create temporary table deletion as select public.prepare_genome_file_deletion_v1('89500000-0000-4000-8000-000000000001',
 '89500000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload)) manifest;
select throws_ok($$select public.finish_genome_file_deletion_v1('89500000-0000-4000-8000-000000000001',
 '89500000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload),
 (select (manifest->>'token')::uuid from deletion))$$,'55000','file_delete_storage_incomplete','source deletion still requires exact Storage ACK');
set local storage.allow_delete_query='true';
delete from storage.objects where id='89500000-0000-4000-8000-000000000020';
select lives_ok($$select public.finish_genome_file_deletion_v1('89500000-0000-4000-8000-000000000001',
 '89500000-0000-4000-8000-000000000010',(select (receipt->>'fileId')::uuid from finalized_upload),
 (select (manifest->>'token')::uuid from deletion))$$,'actual selected-file deletion completes after Storage ACK');
select is((select count(*) from private.own_normalization_positions where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'deleted source has zero position residual');
select is((select count(*) from private.own_normalization_runs where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'deleted source has zero normalization journal residual');
select is((select count(*) from public.user_variants where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'deleted source has zero variant residual');
select is((select count(*) from public.report_observed_calls where file_id=(select (receipt->>'fileId')::uuid from finalized_upload)),0::bigint,'deleted source has zero observation residual');
select results_eq($$select to_jsonb(n),to_jsonb(f),to_jsonb(d)
 from private.own_normalization_runs n join public.genome_files f on f.id=n.file_id
 join private.own_normalization_positions d on d.file_id=f.id where n.account_id='89600000-0000-4000-8000-000000000001'$$,
 $$select * from isolation_before$$,'unrelated account/source/claim/index remain byte-identical after every transition and exact source deletion');
select * from finish();
rollback;
