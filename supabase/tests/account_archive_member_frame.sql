begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Actual Auth/session/signature/normalization/report producers; only physical
-- byte metadata is synthetic. This is SQL protocol proof, not provider/browser.
\ir fixtures/account_archive_ordinary_scientific.inc
-- A second actual normalized source makes old/new retarget coverage independent
-- of mere graph discovery. Both files already belong to the captured job.
insert into storage.objects(id,bucket_id,name,metadata) values('77900000-0000-4000-8000-000000000061',
 'genomes','77900000-0000-4000-8000-000000000062','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('77900000-0000-4000-8000-000000000063','77900000-0000-4000-8000-000000000001',(select id from normalization_subject),
 '77900000-0000-4000-8000-000000000062','Second actual normalized source','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'77900000-0000-4000-8000-000000000061');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('77900000-0000-4000-8000-000000000061','77900000-0000-4000-8000-000000000062','genomes',
 '77900000-0000-4000-8000-000000000063',repeat('a',64),8,1,'current');
create temporary table second_normalization as select public.own_upload_normalization_v1('begin',
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000063') receipt;
select public.own_upload_normalization_v1('stage','77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000063',
 (select (receipt->>'claim')::uuid from second_normalization),
 '{"kind":"variants","sequence":0,"rows":[{"rsid":124,"chrom":1,"pos":100001,"ref":"C","alt":"T","genotype":"C/T"}]}');
select public.own_upload_normalization_v1('complete','77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000063',
 (select (receipt->>'claim')::uuid from second_normalization),jsonb_build_object('sourceBuild','GRCh38',
 'rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb));
create temporary table actual_member_job(origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into actual_member_job(origin,attempt) values(jsonb_build_object('kind','account',
 'accountId','77900000-0000-4000-8000-000000000001','sessionId','77900000-0000-4000-8000-000000000010'),gen_random_uuid());
grant select,update on actual_member_job to service_role;
create temporary table content_clocks as select id,export_content_revision from public.genome_files;
grant select on content_clocks,normalization_subject to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update actual_member_job set capture=public.export_archive_request_v1('capture',origin,'account','77900000-0000-4000-8000-000000000001');
select is((select capture->>'fileCount' from actual_member_job),'2','both real normalized files are captured before any mutation');
update actual_member_job set created=public.export_archive_request_v1('create',origin,'account','77900000-0000-4000-8000-000000000001',
 jsonb_build_object('exportCookieHash',repeat('9',64),'envelope',jsonb_build_object('routeId','api.export',
 'origin','authenticated','principalId',capture->>'principalId','targetKind','account','targetId','77900000-0000-4000-8000-000000000001',
 'exportContract','account-export-v1','originBinding',capture->>'originBinding','authorityReceipt',capture->>'authorityReceipt',
 'csrfBinding',repeat('c',64),'operation','create','nonceHash',repeat('7',64),
 'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
 'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000)),repeat('c',64));
select lives_ok('set constraints all immediate','actual whole member request flushes every deferred creation invariant before worker reads');
set constraints all deferred;
select public.export_archive_worker_v1('begin',(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt') from actual_member_job;
create function pg_temp.member_metadata(op text,after_id uuid default null) returns jsonb language sql as $$
 select public.export_archive_account_metadata_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',after_id)
 from actual_member_job
$$;
create temporary table actual_member_metadata as select pg_temp.member_metadata('context') counts,
 pg_temp.member_metadata('profile') profile,pg_temp.member_metadata('purpose-grants') grants,pg_temp.member_metadata('legacy-counts') files;
reset role;
select is((select counts#>>'{rows,0,fileCount}' from actual_member_metadata),'2','actual metadata count covers both captured ordinary files');
select is((select profile#>>'{rows,0,id}' from actual_member_metadata),'77900000-0000-4000-8000-000000000001','profile belongs only to the actual stored requester');
select is((select profile#>>'{rows,0,date_of_birth}' from actual_member_metadata),'1990-01-01','the actual supplied birth date is included');
select set_eq($$select (g->>'grant_id')::uuid from actual_member_metadata,jsonb_array_elements(grants->'rows')g$$,
 $$select g.grant_id from public.purpose_grants g join public.consent_signatures s on s.id=g.signature_id
 where s.signer_account_id='77900000-0000-4000-8000-000000000001' and g.target_kind='subject'
 and g.target_id=(select id from normalization_subject)$$,'every actual own signed purpose grant appears once, with no inferred counterparty');
select is((select jsonb_array_length(files->'rows') from actual_member_metadata),2,'legacy count metadata contains exactly every actual selected file');
select ok((select bool_and((r->>'variantCount')::bigint=1 and (r->>'observedCallCount')::bigint=0
 and (r->>'revision')::bigint=c.export_content_revision) from actual_member_metadata,jsonb_array_elements(files->'rows')r
 join content_clocks c on c.id=(r->>'fileId')::uuid),'complete actual source counts and clocks agree with the real normalization outputs');
create function pg_temp.member_job_state() returns jsonb language sql as $$
 select jsonb_build_object('export',(select to_jsonb(e) from public.generated_exports e where e.id=(select (created->>'exportId')::uuid from actual_member_job)),
 'job',(select to_jsonb(j) from private.export_archive_jobs j where j.export_id=(select (created->>'exportId')::uuid from actual_member_job)),
 'attempts',(select jsonb_agg(to_jsonb(a) order by id) from private.export_archive_attempts a where a.export_id=(select (created->>'exportId')::uuid from actual_member_job)))
$$;
create temporary table unchanged_member_job as select pg_temp.member_job_state() value;
set local role service_role;
select throws_ok($$update public.genome_files set export_content_revision=export_content_revision+1
 where id='77900000-0000-4000-8000-000000000040'$$,'23514','export content revision is trigger-owned','the actual service role cannot forge even one correct-looking counter increment');
select throws_ok($$update public.genome_files set export_content_revision=1
 where id='77900000-0000-4000-8000-000000000040'$$,'23514','export content revision is trigger-owned','the actual service role cannot rewind the existing content clock');
select throws_ok($$insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status,export_content_revision)
 values('77900000-0000-4000-8000-000000000070','77900000-0000-4000-8000-000000000001',(select id from normalization_subject),
 '77900000-0000-4000-8000-000000000071','Forged counter','vcf',1,1,'uploaded',77)$$,
 '23514','export content revision is trigger-owned','a new file cannot choose a fabricated initial content counter');
select throws_ok($$select public.export_archive_account_metadata_v1('context',(select (created->>'exportId')::uuid from actual_member_job),
 gen_random_uuid(),(select capture->>'authorityReceipt' from actual_member_job))$$,
 '42501','export_source_unavailable','a foreign writing attempt cannot use real member metadata');
select throws_ok($$select pg_temp.member_metadata('profile',gen_random_uuid())$$,
 '22023','invalid_request','the profile selector has no caller-selected cursor or foreign account');
reset role;
savepoint real_batch;
set local role service_role;
insert into public.user_variants(user_id,subject_id,file_id,rsid,chrom,pos,ref,alt,genotype) values
 ('77900000-0000-4000-8000-000000000001',(select id from normalization_subject),'77900000-0000-4000-8000-000000000040',125,1,100002,'A','C','A/C'),
 ('77900000-0000-4000-8000-000000000001',(select id from normalization_subject),'77900000-0000-4000-8000-000000000040',126,1,100003,'A','T','A/T');
select is((select export_content_revision from public.genome_files where id='77900000-0000-4000-8000-000000000040'),
 (select export_content_revision+1 from content_clocks where id='77900000-0000-4000-8000-000000000040'),'one actual multi-row INSERT advances its one file exactly once');
select throws_ok($$select pg_temp.member_metadata('profile')$$,'42501','not_found','an actual source insertion invalidates the whole old request even for buffered metadata');
reset role;
select is(pg_temp.member_job_state(),(select value from unchanged_member_job),'refused reads cannot change any durable job or attempt');
rollback to real_batch;
savepoint real_update;
set local role service_role;
update public.user_variants set genotype='G/G' where file_id='77900000-0000-4000-8000-000000000040';
select is((select export_content_revision from public.genome_files where id='77900000-0000-4000-8000-000000000040'),
 (select export_content_revision+1 from content_clocks where id='77900000-0000-4000-8000-000000000040'),'an actual same-count payload UPDATE advances its file once');
select throws_ok($$select pg_temp.member_metadata('legacy-counts')$$,'42501','not_found','same row cardinality cannot conceal changed genetic content');
reset role;rollback to real_update;
savepoint real_retarget;
set local role service_role;
update public.user_variants set file_id='77900000-0000-4000-8000-000000000063' where file_id='77900000-0000-4000-8000-000000000040';
select ok((select bool_and(f.export_content_revision=c.export_content_revision+1) from public.genome_files f
 join content_clocks c on c.id=f.id where f.id in('77900000-0000-4000-8000-000000000040','77900000-0000-4000-8000-000000000063')),
 'retarget advances BOTH actual old and new files once without a guessed current-owner slice');
select throws_ok($$select pg_temp.member_metadata('context')$$,'42501','not_found','retargeting refuses the original whole request');
reset role;rollback to real_retarget;
savepoint real_delete;
set local role service_role;
delete from public.user_variants where file_id='77900000-0000-4000-8000-000000000040';
select is((select export_content_revision from public.genome_files where id='77900000-0000-4000-8000-000000000040'),
 (select export_content_revision+1 from content_clocks where id='77900000-0000-4000-8000-000000000040'),'actual genetic row deletion advances its original file');
select throws_ok($$select pg_temp.member_metadata('purpose-grants')$$,'42501','not_found','deletion refuses every later member of the old request');
reset role;rollback to real_delete;
savepoint actual_observation;
set local role service_role;
insert into public.report_observed_calls(file_id,user_id,subject_id,source_line,source_sha256,extraction_version,source_build,
 source_chrom,source_pos,source_ref,source_alt,source_gt,rsid,chrom,pos,ref,alt,genotype,quality_state,usable)
 values('77900000-0000-4000-8000-000000000040','77900000-0000-4000-8000-000000000001',(select id from normalization_subject),
 1,repeat('b',64),'vcf-literal-diploid-snp-v1','GRCh38',1,100000,'A','G','0/1',123,1,100000,'A','G','A/G','pass',true);
select is((select export_content_revision from public.genome_files where id='77900000-0000-4000-8000-000000000040'),
 (select export_content_revision+1 from content_clocks where id='77900000-0000-4000-8000-000000000040'),'an actual observed-call insertion shares the same protected content clock');
select throws_ok($$select pg_temp.member_metadata('context')$$,'42501','not_found','an added literal source observation invalidates the old whole request');
update public.report_observed_calls set genotype='G/G',source_gt='1/1' where file_id='77900000-0000-4000-8000-000000000040';
select is((select export_content_revision from public.genome_files where id='77900000-0000-4000-8000-000000000040'),
 (select export_content_revision+2 from content_clocks where id='77900000-0000-4000-8000-000000000040'),'actual observed-call payload UPDATE advances once independently of cardinality');
update public.report_observed_calls set file_id='77900000-0000-4000-8000-000000000063' where file_id='77900000-0000-4000-8000-000000000040';
select is((select export_content_revision from public.genome_files where id='77900000-0000-4000-8000-000000000040'),
 (select export_content_revision+3 from content_clocks where id='77900000-0000-4000-8000-000000000040'),'observed-call retarget advances its actual old file');
select is((select export_content_revision from public.genome_files where id='77900000-0000-4000-8000-000000000063'),
 (select export_content_revision+1 from content_clocks where id='77900000-0000-4000-8000-000000000063'),'observed-call retarget advances its actual new file');
delete from public.report_observed_calls where file_id='77900000-0000-4000-8000-000000000063';
select is((select export_content_revision from public.genome_files where id='77900000-0000-4000-8000-000000000063'),
 (select export_content_revision+2 from content_clocks where id='77900000-0000-4000-8000-000000000063'),'actual observed-call DELETE advances that exact file');
reset role;rollback to actual_observation;
savepoint empty_statement;
set local role service_role;
update public.user_variants set genotype='G/G' where false;
delete from public.report_observed_calls where false;
select ok((select bool_and(f.export_content_revision=c.export_content_revision) from public.genome_files f
 join content_clocks c on c.id=f.id),'empty statements cannot fabricate a content change');
select is(pg_temp.member_metadata('context'),(select counts from actual_member_metadata),
 'an empty source statement preserves the exact current member request');
reset role;rollback to empty_statement;
savepoint actual_file_purge;
set local role service_role;
create temporary table member_file_deletion as select public.prepare_genome_file_deletion_v1(
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 '77900000-0000-4000-8000-000000000063') manifest;
select throws_ok($$select public.finish_genome_file_deletion_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000063',
 (select (manifest->>'token')::uuid from member_file_deletion))$$,
 '55000','file_delete_storage_incomplete','the protected clock cannot bypass real file deletion storage absence');
reset role;
-- SQL-only Storage metadata ACK seam, identical to the existing deletion
-- fixture. Actual provider removal remains a separate required proof.
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name='77900000-0000-4000-8000-000000000062';
set local role service_role;
select lives_ok($$select public.finish_genome_file_deletion_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000063',
 (select (manifest->>'token')::uuid from member_file_deletion))$$,
 'the actual file deletion protocol keeps its cascade and does not require disabling content guards');
select is((select count(*) from public.genome_files where id='77900000-0000-4000-8000-000000000063'),0::bigint,
 'a cascade cannot recreate the deleted file merely to advance its clock');
select is((select count(*) from public.user_variants where file_id='77900000-0000-4000-8000-000000000063'),0::bigint,
 'actual normalized rows are removed by the existing file cascade');
select is((select count(*) from public.report_observed_calls where file_id='77900000-0000-4000-8000-000000000063'),0::bigint,
 'actual deletion retains no observed source rows');
select is((select count(*) from public.genome_files where id='77900000-0000-4000-8000-000000000040'),1::bigint,
 'deleting one source preserves the other actual normalized source');
select throws_ok($$select pg_temp.member_metadata('context')$$,'42501','not_found',
 'after deletion no member bytes or metadata can leave under the old whole-account source receipt');
reset role;
select lives_ok('set constraints all immediate','the completed real cascade flushes every deferred source identity invariant');
set constraints all deferred;
rollback to actual_file_purge;
savepoint privileged_maintenance;
set local role service_role;
select is(current_user::text,'service_role','the original permitted service maintenance uses the actual role');
truncate public.user_variants;
reset role;
select ok((select bool_and(f.export_content_revision=c.export_content_revision+1) from public.genome_files f
 join content_clocks c on c.id=f.id where f.id in('77900000-0000-4000-8000-000000000040','77900000-0000-4000-8000-000000000063')),
 'service maintenance advances every actual affected source once while browser/upload maintenance stays denied');
set local role service_role;
select throws_ok($$select pg_temp.member_metadata('context')$$,'42501','not_found',
 'privileged maintenance also invalidates the old consumed source frame');
reset role;rollback to privileged_maintenance;
savepoint genuine_profile_change;
update public.profiles set date_of_birth=date '1991-01-01' where id='77900000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select pg_temp.member_metadata('profile')$$,'42501','not_found','a changed actual profile cannot enter the old member receipt');
reset role;rollback to genuine_profile_change;
savepoint actual_session_revocation;
delete from auth.sessions where id='77900000-0000-4000-8000-000000000010';
set local role service_role;
select throws_ok($$select pg_temp.member_metadata('context')$$,'42501','not_found','actual session revocation refuses counts and every source/member read');
reset role;rollback to actual_session_revocation;
select ok(not has_function_privilege(r,f,'execute'),r||' cannot call internal frame/clock trigger '||f)
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r cross join unnest(array[
 'private.guard_export_content_revision_v1()','private.advance_export_content_revision_v1()',
 'private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)'])f;
select is(has_function_privilege(r,'public.export_archive_account_metadata_v1(text,uuid,uuid,text,uuid)','execute'),r='service_role',
 r||' exact consumed-worker metadata grant') from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r;
select is(has_table_privilege(r,t,'TRUNCATE'),r='service_role' and t='public.user_variants',
 r||' exact original maintenance tuple still passes through the source DML clock '||t)
 from unnest(array['anon','authenticated','service_role','inherit_upload_only'])r cross join unnest(array['public.user_variants','public.report_observed_calls'])t;
select is(pg_temp.member_job_state(),(select value from unchanged_member_job),'every refusal preserves the complete original durable request and attempt');
select * from finish();rollback;
