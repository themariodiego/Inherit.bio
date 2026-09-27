begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Synthetic metadata only; every fixture and assertion rolls back. One rich
-- file is built through the real consent, normalization, grant and report
-- functions; 104 more are plain ready sources so pagination crosses a page.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into auth.users(id,email) values
 ('79700000-0000-4000-8000-000000000001','reader-owner@e2e.local'),
 ('79700000-0000-4000-8000-000000000002','reader-empty@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79700000-0000-4000-8000-000000000010','79700000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('79700000-0000-4000-8000-000000000011','79700000-0000-4000-8000-000000000002',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='79700000-0000-4000-8000-000000000001';
create temporary table reader_subject as select id from public.subjects
 where subject_account_id='79700000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79700000-0000-4000-8000-000000000001','79700000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('79700000-0000-4000-8000-000000000001','79700000-0000-4000-8000-000000000010',
 (select id from reader_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('79700000-0000-4000-8000-000000000001','79700000-0000-4000-8000-000000000010',
 (select id from reader_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
-- The rich file sorts first: its id ends in 0...0040, below every plain file.
insert into storage.objects(id,bucket_id,name,metadata) values('79700000-0000-4000-8000-000000000020',
 'genomes','79700000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('79700000-0000-4000-8000-000000000040','79700000-0000-4000-8000-000000000001',(select id from reader_subject),
 '79700000-0000-4000-8000-000000000030','Synthetic genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'79700000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('79700000-0000-4000-8000-000000000020','79700000-0000-4000-8000-000000000030','genomes',
 '79700000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table normalization_manifest(receipt jsonb);
create function pg_temp.normalize(op text,payload jsonb default null) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'79700000-0000-4000-8000-000000000001',
 '79700000-0000-4000-8000-000000000010','79700000-0000-4000-8000-000000000040',
 case when op='begin' then null else (select (receipt->>'claim')::uuid from normalization_manifest) end,payload);
$$;
insert into normalization_manifest select pg_temp.normalize('begin');
select pg_temp.normalize('stage','{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}');
select pg_temp.normalize('complete',jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance','{}'::jsonb));
select public.grant_own_report_purpose_v1('79700000-0000-4000-8000-000000000001','79700000-0000-4000-8000-000000000010',
 (select id from reader_subject),public.own_report_context_v1('79700000-0000-4000-8000-000000000001',
 '79700000-0000-4000-8000-000000000010',(select id from reader_subject)),
 'reports.polygenic',2,(select body_sha256 from public.consent_artifacts where artifact_key='consent.own-polygenic' and version=2),
 repeat('c',64),clock_timestamp()+interval '9 minutes');
insert into public.report_templates(slug,category,title,summary,evidence,estimate_kind,variants,citations)
 values('reader-fixture','basic-traits','Fixture','Rollback-only reader fixture.','emerging','single_locus',
 '[{"rsid":123,"gene":"X","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AA":"x","AG":"y","GG":"z"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('READER-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create temporary table generation_manifest as select public.own_report_generation_v1('begin',
 '79700000-0000-4000-8000-000000000001','79700000-0000-4000-8000-000000000010',
 '79700000-0000-4000-8000-000000000040','reports.polygenic') as receipt;
select public.own_report_generation_v1('complete','79700000-0000-4000-8000-000000000001',
 '79700000-0000-4000-8000-000000000010','79700000-0000-4000-8000-000000000040','reports.polygenic',
 (select (receipt->>'claim')::uuid from generation_manifest),
 '{"reports":[{"slug":"reader-fixture","covered":true,"conflictingRsids":[],"variants":[{"rsid":123,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved outcome","strandFlipped":false}}]}],"prs":[{"pgs_id":"READER-FIXTURE","raw_score":0,"coverage":1,"matched":1}]}');
-- 104 plain ready sources: exact current Storage identity, not normalized.
insert into storage.objects(id,bucket_id,name,metadata)
 select format('79710000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,'genomes',
  format('79720000-0000-4000-8000-%s',lpad(n::text,12,'0')),'{"size":8}' from generate_series(1,104) n;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 select format('79730000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,'79700000-0000-4000-8000-000000000001',
  (select id from reader_subject),format('79720000-0000-4000-8000-%s',lpad(n::text,12,'0')),'Synthetic plain','vcf',1,8,
  repeat('a',64),'uploaded',1,'single-logical-sample-v1',clock_timestamp(),repeat('b',64),
  format('79710000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid from generate_series(1,104) n;
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 select format('79710000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,format('79720000-0000-4000-8000-%s',lpad(n::text,12,'0')),
  'genomes',format('79730000-0000-4000-8000-%s',lpad(n::text,12,'0'))::uuid,repeat('a',64),8,1,'current' from generate_series(1,104) n;

-- A job and a begun attempt for each account, through the real request and worker RPCs.
create temporary table reader_job(account uuid primary key,origin jsonb,capture jsonb,created jsonb,attempt uuid);
insert into reader_job(account,origin,attempt) values
 ('79700000-0000-4000-8000-000000000001',jsonb_build_object('kind','account','accountId','79700000-0000-4000-8000-000000000001',
  'sessionId','79700000-0000-4000-8000-000000000010'),'79700000-0000-4000-8000-000000000050'),
 ('79700000-0000-4000-8000-000000000002',jsonb_build_object('kind','account','accountId','79700000-0000-4000-8000-000000000002',
  'sessionId','79700000-0000-4000-8000-000000000011'),'79700000-0000-4000-8000-000000000051');
create function pg_temp.open_job(who uuid,nonce text) returns void language plpgsql as $$
declare row_at record;
begin
 update reader_job set capture=public.export_archive_request_v1('capture',origin,'account',account) where account=who;
 select * into row_at from reader_job where account=who;
 update reader_job set created=public.export_archive_request_v1('create',row_at.origin,'account',who,jsonb_build_object(
  'envelope',jsonb_build_object('routeId','api.export','origin','authenticated','principalId',row_at.capture->>'principalId',
   'targetKind','account','targetId',who,'exportContract','account-export-v1','originBinding',row_at.capture->>'originBinding',
   'authorityReceipt',row_at.capture->>'authorityReceipt','csrfBinding',repeat('c',64),'operation','create','nonceHash',nonce,
   'issuedAt',floor(extract(epoch from statement_timestamp())*1000)::bigint,
   'expiresAt',floor(extract(epoch from statement_timestamp())*1000)::bigint+300000),
  'exportCookieHash',nonce),repeat('c',64)) where account=who;
 select * into row_at from reader_job where account=who;
 perform public.export_archive_worker_v1('begin',(row_at.created->>'exportId')::uuid,row_at.attempt,row_at.capture->>'authorityReceipt');
end $$;
create function pg_temp.reader(who uuid,op text,payload jsonb default null) returns jsonb language sql as $$
 select public.export_archive_content_v1(op,(created->>'exportId')::uuid,attempt,capture->>'authorityReceipt',payload)
 from reader_job where account=who;
$$;
create function pg_temp.owner(op text,payload jsonb default null) returns jsonb language sql as $$
 select pg_temp.reader('79700000-0000-4000-8000-000000000001',op,payload);
$$;
create function pg_temp.snap(file uuid) returns jsonb language sql as $$
 select private.own_export_source_v1('79700000-0000-4000-8000-000000000001','79700000-0000-4000-8000-000000000010',file);
$$;
create function pg_temp.state() returns jsonb language sql as $$
 select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j) order by j.export_id) from private.export_archive_jobs j),
  'attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from private.export_archive_attempts a),
  'exports',(select jsonb_agg(to_jsonb(e) order by e.id) from public.generated_exports e),
  'nonces',(select count(*) from private.export_archive_nonce_uses),
  'segments',(select count(*) from private.export_archive_segments),
  'downloads',(select count(*) from private.export_archive_downloads));
$$;

select pg_temp.open_job('79700000-0000-4000-8000-000000000001',repeat('a',64));
select pg_temp.open_job('79700000-0000-4000-8000-000000000002',repeat('b',64));
create temporary table before_reads as select pg_temp.state() value;

-- Context: stored origin, route, contract and target; never caller input.
select is(pg_temp.owner('context')->'origin',(select origin from reader_job where account='79700000-0000-4000-8000-000000000001'),
 'context returns the stored originating account and session');
select is(pg_temp.owner('context')->>'routeId','api.export','context returns the stored route');
select is(pg_temp.owner('context')->>'exportContract','account-export-v1','context returns the stored contract');
select is((pg_temp.owner('context')->>'fileCount')::integer,105,'context file count is the captured source membership');
select is(pg_temp.owner('context')->>'authorityReceipt',(select capture->>'authorityReceipt' from reader_job
 where account='79700000-0000-4000-8000-000000000001'),'context echoes only the pinned receipt');

-- Keyset pages: every in-scope file exactly once, in id order.
create temporary table page_one as select pg_temp.owner('files','{"afterFileId":null}') value;
select is(jsonb_array_length((select value->'files' from page_one)),100,'first page is bounded at 100 sources');
select ok((select value->>'nextAfterFileId' is not null from page_one),'a further page is announced');
create temporary table page_two as select pg_temp.owner('files',jsonb_build_object('afterFileId',(select value->'nextAfterFileId' from page_one))) value;
select is(jsonb_array_length((select value->'files' from page_two)),5,'second page holds the remaining sources');
select is((select value->'nextAfterFileId' from page_two),'null'::jsonb,'last page ends the cursor');
select is((select array_agg((s#>>'{file,id}')::uuid order by ord) from (
  select s,ord from page_one,jsonb_array_elements(value->'files') with ordinality x(s,ord)
  union all select s,100+ord from page_two,jsonb_array_elements(value->'files') with ordinality x(s,ord)) pages),
 (select array_agg(id order by id) from public.genome_files where user_id='79700000-0000-4000-8000-000000000001'),
 'the two pages cover every file once, in order, with no omission');
select is((select value->'files'->0 from page_one),pg_temp.snap('79700000-0000-4000-8000-000000000040'),
 'each member is the exact current source snapshot');

-- An account with no files is a real, complete, empty membership.
select is((pg_temp.reader('79700000-0000-4000-8000-000000000002','context')->>'fileCount')::integer,0,'no-file account has an authorized context');
select is(pg_temp.reader('79700000-0000-4000-8000-000000000002','files','{"afterFileId":null}'),
 '{"files":[],"nextAfterFileId":null}'::jsonb,'no-file account pages to an empty, closed membership');

-- Per-file content under both the job's and the file's authority.
select is(pg_temp.owner('check',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'))),pg_temp.snap('79700000-0000-4000-8000-000000000040'),
 'check confirms the exact current snapshot');
select is(jsonb_array_length(pg_temp.owner('variants',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset',0))),1,'raw own rows export without an analytic grant');
select is(pg_temp.owner('reports',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset',0))->0->'report'->'variants'->0->'outcome'->>'interpretation',
 'saved outcome','a report under its current grant is exported verbatim');
select is(pg_temp.owner('prs',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset',0))->0->>'matched','1','current PRS coverage is exported');
select is(pg_temp.owner('ancestry',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset',0)),'[]'::jsonb,'no ancestry grant, no ancestry result');
select is(pg_temp.owner('variants',jsonb_build_object('fileId','79730000-0000-4000-8000-000000000001',
 'snapshot',pg_temp.snap('79730000-0000-4000-8000-000000000001'),'offset',0)),'[]'::jsonb,'an unnormalized file exports no rows');

-- Refusals: shape, identity, receipt, attempt, lease and scope.
select throws_ok($$select pg_temp.owner('list')$$,'22023','invalid_request','the older unbounded list is not an operation here');
select throws_ok($$select pg_temp.owner('context','{}')$$,'22023','invalid_request','context takes no payload');
select throws_ok($$select pg_temp.owner('files','{"afterFileId":null,"limit":1000}')$$,'22023','invalid_request','caller cannot choose a page size');
select throws_ok($$select pg_temp.owner('files','{"afterFileId":"not-a-uuid"}')$$,'22023','invalid_request','malformed cursor refused');
select throws_ok($$select pg_temp.owner('variants',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset','0'))$$,'22023','invalid_request','numeric strings are not offsets');
select throws_ok($$select pg_temp.owner('variants',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset',-1))$$,'22023','invalid_request','negative offsets refused');
select throws_ok($$select public.export_archive_content_v1('context',(select (created->>'exportId')::uuid from reader_job
 where account='79700000-0000-4000-8000-000000000001'),'79700000-0000-4000-8000-000000000050',repeat('0',64))$$,
 '42501','not_found','a caller receipt is not authority');
select throws_ok($$select public.export_archive_content_v1('context',(select (created->>'exportId')::uuid from reader_job
 where account='79700000-0000-4000-8000-000000000002'),'79700000-0000-4000-8000-000000000050',
 (select capture->>'authorityReceipt' from reader_job where account='79700000-0000-4000-8000-000000000001'))$$,
 '42501','not_found','one export cannot borrow another account''s receipt');
select throws_ok($$select public.export_archive_content_v1('context',(select (created->>'exportId')::uuid from reader_job
 where account='79700000-0000-4000-8000-000000000001'),'79700000-0000-4000-8000-000000000051',
 (select capture->>'authorityReceipt' from reader_job where account='79700000-0000-4000-8000-000000000001'))$$,
 '42501','not_found','another job''s attempt is refused');
select throws_ok($$select pg_temp.owner('check',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000099',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040')))$$,'42501','not_found','a file outside the captured partitions is refused');
select throws_ok($$select pg_temp.reader('79700000-0000-4000-8000-000000000002','check',jsonb_build_object(
 'fileId','79700000-0000-4000-8000-000000000040','snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040')))$$,
 '42501','not_found','another account''s file is outside this export''s partitions');
select throws_ok($$select pg_temp.owner('check',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79730000-0000-4000-8000-000000000001')))$$,'42501','not_found','a different file''s snapshot is refused');
savepoint stopped_attempt;
select public.export_archive_cleanup_v1('stop',(select (created->>'exportId')::uuid from reader_job
 where account='79700000-0000-4000-8000-000000000001'),'79700000-0000-4000-8000-000000000050');
select throws_ok($$select pg_temp.owner('context')$$,'42501','not_found','a stopped attempt reads nothing');
rollback to stopped_attempt;
savepoint expired_lease;
-- Clock movement is fixture metadata, not a provider or wall-clock claim.
update private.export_archive_attempts set lease_expires_at=clock_timestamp()-interval '1 second',
 started_at=clock_timestamp()-interval '2 seconds' where id='79700000-0000-4000-8000-000000000050';
select throws_ok($$select pg_temp.owner('files','{"afterFileId":null}')$$,'42501','not_found','an expired lease reads nothing');
rollback to expired_lease;
savepoint logged_out;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='79700000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.owner('context')$$,'42501','not_found','the originating session ending stops every read');
rollback to logged_out;
savepoint new_file;
insert into storage.objects(id,bucket_id,name,metadata) values('79740000-0000-4000-8000-000000000001','genomes',
 '79740000-0000-4000-8000-000000000002','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('79740000-0000-4000-8000-000000000003','79700000-0000-4000-8000-000000000001',(select id from reader_subject),
 '79740000-0000-4000-8000-000000000002','Synthetic late file','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'79740000-0000-4000-8000-000000000001');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('79740000-0000-4000-8000-000000000001','79740000-0000-4000-8000-000000000002','genomes',
 '79740000-0000-4000-8000-000000000003',repeat('a',64),8,1,'current');
select throws_ok($$select pg_temp.owner('files','{"afterFileId":null}')$$,'42501','not_found',
 'a file added after capture changes the graph, so the attempt cannot quietly include or omit it');
rollback to new_file;
savepoint unready_file;
update public.genome_files set status='uploading' where id='79730000-0000-4000-8000-000000000050';
select throws_ok($$select pg_temp.owner('files','{"afterFileId":null}')$$,'55000','export_source_unavailable',
 'a member without an exact source refuses the whole read instead of disappearing');
rollback to unready_file;

-- The database backend now gets the purpose gate the older helper gave only
-- prepared sources. A grant already expired when the export was captured
-- must not let its completed report into the archive.
savepoint expired_before_capture;
select public.export_archive_cleanup_v1('stop',(select (created->>'exportId')::uuid from reader_job
 where account='79700000-0000-4000-8000-000000000001'),'79700000-0000-4000-8000-000000000050');
update private.export_archive_attempts set cleanup_not_before=clock_timestamp()-interval '1 second'
 where id='79700000-0000-4000-8000-000000000050';
delete from private.export_archive_attempts where id='79700000-0000-4000-8000-000000000050';
delete from public.generated_exports where id=(select (created->>'exportId')::uuid from reader_job
 where account='79700000-0000-4000-8000-000000000001');
update public.purpose_grants set granted_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour'
 where purpose='reports.polygenic' and target_id=(select id from reader_subject);
select pg_temp.open_job('79700000-0000-4000-8000-000000000001',repeat('e',64));
select is(jsonb_array_length(private.own_subject_export_content_v1('reports','79700000-0000-4000-8000-000000000001',
 '79700000-0000-4000-8000-000000000010','79700000-0000-4000-8000-000000000040',
 pg_temp.snap('79700000-0000-4000-8000-000000000040'),0)),1,'the older helper still returns the report on the database backend');
select is(pg_temp.owner('reports',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset',0)),'[]'::jsonb,
 'the reader withholds a report whose purpose grant is no longer current');
select is(pg_temp.owner('prs',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset',0)),'[]'::jsonb,
 'the reader withholds PRS coverage under the same gate');
select is(jsonb_array_length(pg_temp.owner('variants',jsonb_build_object('fileId','79700000-0000-4000-8000-000000000040',
 'snapshot',pg_temp.snap('79700000-0000-4000-8000-000000000040'),'offset',0))),1,'raw own rows are not gated by an analytic grant');
rollback to expired_before_capture;

-- No reader call wrote anything.
select is(pg_temp.state(),(select value from before_reads),'jobs, attempts, exports, nonces, segments and downloads are unchanged');
select ok(has_function_privilege('service_role','public.export_archive_content_v1(text,uuid,uuid,text,jsonb)','EXECUTE'),
 'the reader is a service-only entry point');
select ok(not has_function_privilege('authenticated','public.export_archive_content_v1(text,uuid,uuid,text,jsonb)','EXECUTE'),
 'browsers cannot call the reader');
select ok(not has_function_privilege('anon','public.export_archive_content_v1(text,uuid,uuid,text,jsonb)','EXECUTE'),
 'anonymous callers cannot call the reader');
select * from finish();
rollback;
