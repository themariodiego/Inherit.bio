begin;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('84000000-0000-4000-8000-000000000001','input-provenance@example.invalid','{}');
insert into auth.sessions(id,user_id,aal) values
 ('84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000001','aal1');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select '84000000-0000-4000-8000-000000000003', owner_account_id,id,
 '84000000-0000-4000-8000-000000000001/provenance-fixture','synthetic.vcf','vcf',1,100,'annotated'
from public.subjects where subject_account_id='84000000-0000-4000-8000-000000000001' and subject_class='self';

create function pg_temp.snapshot() returns jsonb language sql as $$
 select jsonb_build_object('version','listed-calls-v1','sourceSha256',repeat('a',64),
 'completedAt','2026-09-06T00:00:00.000Z','sourceBuild','GRCh38','buildBasis','source-declared',
 'targetBuild','GRCh38','chainSha256',null,'variantRowsMapped',1,'variantRowsUnmapped',0,
 'counts',jsonb_build_object('called',1,'noCall',0,'unsupported',0,'failedFilter',0,'blocks',0,'singleSample',true,'buildClaim',true))
$$;
select is(has_column_privilege('authenticated','public.genome_files','input_provenance','UPDATE'),false,'clients cannot update the snapshot');
select is(has_column_privilege('authenticated','public.genome_files','input_source_sha256','INSERT'),false,'clients cannot insert a verified digest');
select is((select input_provenance from public.genome_files where id='84000000-0000-4000-8000-000000000003'),null::jsonb,'legacy input remains unknown');
update public.genome_files set processing_finished_at='2026-09-06T00:00:00+00:00',input_source_sha256=repeat('a',64),input_provenance=pg_temp.snapshot()
where id='84000000-0000-4000-8000-000000000003';
select is((select input_provenance->>'sourceSha256' from public.genome_files where id='84000000-0000-4000-8000-000000000003'),repeat('a',64),'completion timestamp accepts equivalent ISO source syntax');
select throws_ok($$update public.genome_files set input_provenance='{}' where id='84000000-0000-4000-8000-000000000003'$$,'23514',null,'missing all required snapshot fields cannot pass CHECK through NULL');
select throws_ok($$update public.genome_files set input_provenance=pg_temp.snapshot()-'version' where id='84000000-0000-4000-8000-000000000003'$$,'23514',null,'missing version is refused');
select throws_ok($$update public.genome_files set input_provenance=pg_temp.snapshot()-'completedAt' where id='84000000-0000-4000-8000-000000000003'$$,'23514',null,'missing completion is refused');
select throws_ok($$update public.genome_files set input_provenance=pg_temp.snapshot()-'sourceSha256' where id='84000000-0000-4000-8000-000000000003'$$,'23514',null,'missing source hash is refused');
select throws_ok($$update public.genome_files set input_source_sha256=repeat('b',64) where id='84000000-0000-4000-8000-000000000003'$$,'23514',null,'source digest mismatch is refused');
select throws_ok($$update public.genome_files set processing_finished_at='2026-09-06T00:00:01Z' where id='84000000-0000-4000-8000-000000000003'$$,'23514',null,'stale completion is refused');

-- Deliberately simulate a future grant/policy regression, in this rollback only.
grant update(input_provenance,input_source_sha256,processing_run_id) on public.genome_files to authenticated;
create policy provenance_test_update on public.genome_files for update to authenticated
using(id='84000000-0000-4000-8000-000000000003') with check(id='84000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$update public.genome_files set input_provenance=null,input_source_sha256=null where id='84000000-0000-4000-8000-000000000003'$$,'42501','Processing provenance is service-written','trigger protects the snapshot even if a client write grant regresses');
select throws_ok($$update public.genome_files set processing_run_id='84000000-0000-4000-8000-000000000004' where id='84000000-0000-4000-8000-000000000003'$$,'42501','Processing provenance is service-written','clients cannot forge a run token even after a grant regression');
reset role;
with claimed as (
 update public.genome_files set status='parsing',processing_run_id='84000000-0000-4000-8000-000000000004'
 where id='84000000-0000-4000-8000-000000000003' and status in ('uploaded','annotated','failed') returning id
) select is((select count(*) from claimed),1::bigint,'eligible processing CAS admits exactly one run');
with claimed as (
 update public.genome_files set status='parsing',processing_run_id='84000000-0000-4000-8000-000000000005'
 where id='84000000-0000-4000-8000-000000000003' and status in ('uploaded','annotated','failed') returning id
) select is((select count(*) from claimed),0::bigint,'another run cannot claim the active file');
with stale as (
 update public.genome_files set status='annotated',input_source_sha256=repeat('a',64),input_provenance=pg_temp.snapshot()
 where id='84000000-0000-4000-8000-000000000003' and status='parsing'
 and processing_run_id='84000000-0000-4000-8000-000000000005' returning id
) select is((select count(*) from stale),0::bigint,'a stale run cannot certify completion');
with stale as (
 update public.genome_files set status='failed'
 where id='84000000-0000-4000-8000-000000000003' and status='parsing'
 and processing_run_id='84000000-0000-4000-8000-000000000005' returning id
) select is((select count(*) from stale),0::bigint,'a stale failure cannot release another active run');
select is((select input_provenance from public.genome_files where id='84000000-0000-4000-8000-000000000003'),null::jsonb,'processing clears old snapshot');
select is((select input_source_sha256 from public.genome_files where id='84000000-0000-4000-8000-000000000003'),null::text,'processing clears old digest');
update public.genome_files set status='annotated',input_source_sha256=repeat('a',64),input_provenance=pg_temp.snapshot() where id='84000000-0000-4000-8000-000000000003';
update public.genome_files set status='failed' where id='84000000-0000-4000-8000-000000000003';
select is((select input_provenance from public.genome_files where id='84000000-0000-4000-8000-000000000003'),null::jsonb,'failure clears snapshot without needing old completion values');
update public.genome_files set status='annotated',input_source_sha256=repeat('a',64),input_provenance=pg_temp.snapshot() where id='84000000-0000-4000-8000-000000000003';
select lives_ok($$select public.prepare_genome_file_deletion_v1('84000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000003')$$,'real deletion preparation remains compatible with provenance clearing');
select is((select input_provenance from public.genome_files where id='84000000-0000-4000-8000-000000000003'),null::jsonb,'deletion preparation never leaves a certified snapshot');
select * from finish();
rollback;
