begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- G8.5: generated-artifacts is gone, the single-object export archive form
-- is retired, and the retention target id of the same name is untouched.
-- 20260930140100_drop_generated_artifacts_bucket.sql refuses to run while
-- anything is there, so on a fresh database this is its whole effect.

select is((select count(*) from storage.buckets where id='generated-artifacts'),0::bigint,'the generated-artifacts bucket is gone');
select set_eq('select id from storage.buckets',array['genomes','exports','future-person-identity'],
 'the exact surviving buckets are genomes, exports and private claim identity');
select ok((select not public and file_size_limit=20000028
 and allowed_mime_types=array['application/octet-stream'] from storage.buckets
 where id='future-person-identity'),'claim identity stays private with its exact sealed-byte limit');
select ok((select allowed_mime_types is null and not public from storage.buckets where id='genomes'),'genomes is unchanged');
select ok((select not public and file_size_limit=4000000 from storage.buckets where id='exports'),'exports is unchanged');
select is_empty($$select policyname from pg_policies where schemaname='storage'
 and (coalesce(qual,'')||coalesce(with_check,'')) like '%generated-artifacts%'$$,'no storage policy names the dropped bucket');

-- The literal survives only as the retention target id over database rows.
select set_eq($$select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private','storage') and p.prosrc like '%generated-artifacts%'$$,
 array['private.prepare_own_report_purge_v1(uuid,timestamp with time zone)','private.execute_own_report_purge_v1(uuid)'],
 'only the own-report purge functions carry the literal, as a retention target id');
select set_eq($$select store_name from public.purge_target_stores where target_id='generated-artifacts'$$,
 array['public.report_artifacts','public.generated_exports','public.download_sessions','public.model_contexts','private.own_analysis_runs','private.path_b_report_bindings'],
 'the generated-artifacts retention target keeps every old store and the closed Path B binding');

-- The single-object form cannot be recorded again. Foreign keys are off so
-- each insert reaches only the check it is aimed at.
set local session_replication_role=replica;
select throws_like($$insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values(gen_random_uuid(),'7a100000-0000-4000-8000-000000000001','generated-artifacts',gen_random_uuid(),repeat('a',64),1,1,'current')$$,
 '%genome_storage_objects_genomes_only%','no recorded object can name the dropped bucket');
select throws_like($$insert into public.genome_storage_objects(object_id,object_name,bucket_id,generated_export_id,sha256,byte_count,object_revision,state)
 values(gen_random_uuid(),'7a100000-0000-4000-8000-000000000002','genomes',gen_random_uuid(),repeat('a',64),1,1,'current')$$,
 '%genome_storage_objects_genomes_only%','no recorded object can be an export archive, even in genomes');
select lives_ok($$insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values(gen_random_uuid(),'7a100000-0000-4000-8000-000000000003','genomes',gen_random_uuid(),repeat('a',64),1,1,'current')$$,
 'a genome source in genomes is still recorded as before');
select throws_like($$insert into public.generated_exports(account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,
 lifecycle_revision,principal_graph_revision,principal_graph_fingerprint,export_revision,object_id)
 values(gen_random_uuid(),gen_random_uuid(),'account_portable','account',gen_random_uuid(),'raw.export',1,1,repeat('7',64),1,gen_random_uuid())$$,
 '%generated_exports_single_object_retired%','no export can name a single archive object');
select lives_ok($$insert into public.generated_exports(account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,
 lifecycle_revision,principal_graph_revision,principal_graph_fingerprint,export_revision,archive_version)
 values(gen_random_uuid(),gen_random_uuid(),'account_portable','account',gen_random_uuid(),'raw.export',1,1,repeat('7',64),1,'archive-segments-v1')$$,
 'a segmented export row is still accepted');
set local session_replication_role=origin;

-- A ready row without archive_version needs object_id, which can no longer
-- be set: the ready representation left is the segmented one.
select ok((select pg_get_constraintdef(oid) like '%WHEN (archive_version IS NULL) THEN (object_id IS NOT NULL)%'
 from pg_constraint where conname='generated_exports_ready_representation'),
 'the ready rule still needs object_id for a legacy row, so no legacy row can become ready');

select * from finish();
rollback;
