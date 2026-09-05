begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','file-delete-owner@example.invalid','{}'),
 ('81000000-0000-4000-8000-000000000002','file-delete-other@example.invalid','{}');
insert into auth.sessions(id,user_id,aal) values
 ('81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','aal1'),
 ('81000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000002','aal1');
insert into storage.buckets(id,name) values('genomes','genomes') on conflict do nothing;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select '81000000-0000-4000-8000-000000000005',owner_account_id,id,
 '81000000-0000-4000-8000-000000000001/synthetic','synthetic.txt','array_ancestry',1,1,'annotated'
from public.subjects where owner_account_id='81000000-0000-4000-8000-000000000001' and subject_class='self';
insert into storage.objects(bucket_id,name) values('genomes','81000000-0000-4000-8000-000000000001/synthetic');
insert into public.user_variants(user_id,subject_id,file_id,chrom,pos,genotype)
select user_id,subject_id,id,1,100,'AG' from public.genome_files where id='81000000-0000-4000-8000-000000000005';
select ok(not has_function_privilege('authenticated','public.prepare_genome_file_deletion_v1(uuid,uuid,uuid)','EXECUTE'),'authenticated cannot invoke privileged prepare');
select ok(not has_function_privilege('anon','public.finish_genome_file_deletion_v1(uuid,uuid,uuid,uuid)','EXECUTE'),'anonymous cannot finish');
select ok(not has_table_privilege('authenticated','public.genome_files','DELETE'),'direct client deletion stays revoked');
select throws_ok($$select public.prepare_genome_file_deletion_v1('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000005')$$,'P0002','file_delete_not_found','other account cannot target file');
select throws_ok($$select public.prepare_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000004','81000000-0000-4000-8000-000000000005')$$,'42501','file_delete_unauthorized','foreign session refused');
update public.genome_files set status='parsing' where id='81000000-0000-4000-8000-000000000005';
select throws_ok($$select public.prepare_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000005')$$,'55000','file_delete_processing','active parser keeps its source');
update public.genome_files set status='annotated' where id='81000000-0000-4000-8000-000000000005';
insert into public.report_artifacts(subject_id,report_kind,report_revision,source_binding_fingerprint,artifact)
select subject_id,'fixture',1,repeat('a',64),'{}' from public.genome_files where id='81000000-0000-4000-8000-000000000005';
select throws_ok($$select public.prepare_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000005')$$,'55000','file_delete_shared_graph','unbound derived artifact cannot be silently stranded');
delete from public.report_artifacts where report_kind='fixture';
insert into public.subjects(id,owner_account_id,subject_class,upload_class,display_label) values
 ('81000000-0000-4000-8000-000000000006','81000000-0000-4000-8000-000000000001','other_adult','adult','Synthetic adult');
update public.genome_files set subject_id='81000000-0000-4000-8000-000000000006' where id='81000000-0000-4000-8000-000000000005';
select throws_ok($$select public.prepare_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000005')$$,'55000','file_delete_subject_unavailable','uploader cannot bypass another adult subject controls');
update public.genome_files set subject_id=(select id from public.subjects where subject_class='self' and owner_account_id='81000000-0000-4000-8000-000000000001') where id='81000000-0000-4000-8000-000000000005';
insert into public.worker_jobs(user_id,file_id,subject_id,kind,output_kind,source_binding_kind,source_binding_id,source_binding_revision,file_sha256,computation_revision,idempotency_key)
select user_id,id,subject_id,'annotate_vcf','ingest.normalize','genome-file',id,1,repeat('b',64),'fixture',repeat('c',64)
from public.genome_files where id='81000000-0000-4000-8000-000000000005';
select throws_ok($$select public.prepare_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000005')$$,'55000','file_delete_processing','queued worker keeps source');
update public.worker_jobs set status='done' where file_id='81000000-0000-4000-8000-000000000005';
create temporary table deletion as select public.prepare_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000005') as manifest;
select is((select manifest->>'name' from deletion),'81000000-0000-4000-8000-000000000001/synthetic','exact database-owned target');
select is((select count(*) from public.user_variants where file_id='81000000-0000-4000-8000-000000000005'),1::bigint,'prepare keeps derivatives until storage ACK');
select is((select status::text from public.genome_files where id='81000000-0000-4000-8000-000000000005'),'failed','pending deletion excluded from processed reports');
select throws_ok($$update public.genome_files set status='parsing' where id='81000000-0000-4000-8000-000000000005'$$,'55000','file_deletion_pending','racing parser cannot restart');
select throws_ok($$update public.worker_jobs set status='queued' where file_id='81000000-0000-4000-8000-000000000005'$$,'55000','file_deletion_pending','worker cannot restart after deletion begins');
select throws_ok($$select public.finish_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000005',(select (manifest->>'token')::uuid from deletion))$$,'55000','file_delete_storage_incomplete','premature finish retains file');
select is(public.prepare_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000005'),(select manifest from deletion),'retry retains exact immutable manifest');
-- SQL-only fixture models Storage metadata ACK; E2E uses the actual API.
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name='81000000-0000-4000-8000-000000000001/synthetic';
select lives_ok($$select public.finish_genome_file_deletion_v1('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000005',(select (manifest->>'token')::uuid from deletion))$$,'acknowledged target finishes');
select is((select count(*) from public.genome_files where id='81000000-0000-4000-8000-000000000005'),0::bigint,'file removed');
select is((select count(*) from public.user_variants where file_id='81000000-0000-4000-8000-000000000005'),0::bigint,'file variants cascade');
select is((select count(*) from private.genome_file_deletions),0::bigint,'completed manifest removed with file');
select is((select count(*) from public.subjects where subject_class='self' and owner_account_id='81000000-0000-4000-8000-000000000001'),1::bigint,'own subject retained');
select * from finish();
rollback;
