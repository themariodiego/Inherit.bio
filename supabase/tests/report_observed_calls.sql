begin;
select plan(16);
insert into auth.users(id,email,raw_user_meta_data) values
 ('83000000-0000-4000-8000-000000000001','observed-owner@example.invalid','{"display_name":"Observed fixture"}'),
 ('83000000-0000-4000-8000-000000000002','observed-other@example.invalid','{"display_name":"Other fixture"}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status,build,observed_call_sha256,observed_call_version)
select '83000000-0000-4000-8000-000000000003', s.owner_account_id,s.id,
 '83000000-0000-4000-8000-000000000003','observed-fixture.vcf','vcf',1,100,'annotated','GRCh38',repeat('a',64),'vcf-literal-diploid-snp-v1'
from public.subjects s where s.subject_account_id='83000000-0000-4000-8000-000000000001' and s.subject_class='self';
insert into public.report_observed_calls(file_id,user_id,subject_id,source_line,source_sha256,extraction_version,source_build,source_chrom,source_pos,source_ref,source_alt,source_gt,rsid,chrom,pos,ref,alt,genotype,quality_state,usable)
select id,user_id,subject_id,4,repeat('a',64),'vcf-literal-diploid-snp-v1','GRCh38',12,111803962,'G','A','0/0',671,12,111803962,'G','A','G/G','unknown',true
from public.genome_files where id='83000000-0000-4000-8000-000000000003';
select is((select count(*) from public.purge_target_stores where target_id='variant-rows' and store_name='public.report_observed_calls'),1::bigint,'observed genetic rows have an exact retention target');
select is(has_table_privilege('anon','public.report_observed_calls','select'),false,'anonymous reads denied');
select is(has_table_privilege('authenticated','public.report_observed_calls','insert'),false,'client insert denied');
select is(has_table_privilege('authenticated','public.report_observed_calls','update'),false,'client update denied');
select is(has_table_privilege('authenticated','public.report_observed_calls','delete'),false,'client delete denied');
select throws_ok($$update public.report_observed_calls set user_id='83000000-0000-4000-8000-000000000002' where file_id='83000000-0000-4000-8000-000000000003'$$,'23503',null,'file owner binding cannot be forged');
select throws_ok($$update public.report_observed_calls set subject_id=(select id from public.subjects where subject_account_id='83000000-0000-4000-8000-000000000002' and subject_class='self') where file_id='83000000-0000-4000-8000-000000000003'$$,'23503',null,'file subject binding cannot be forged');
select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*) from public.report_observed_calls),1::bigint,'owner reads completed matching extraction');
reset role;
select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.report_observed_calls),0::bigint,'another account reads no rows');
reset role;
select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
update public.genome_files set observed_call_sha256=repeat('b',64) where id='83000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.report_observed_calls),0::bigint,'mismatched extraction digest is unreadable');
reset role;
update public.genome_files set observed_call_sha256=repeat('a',64),status='parsing' where id='83000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.report_observed_calls),0::bigint,'partial processing is unreadable');
reset role;
update public.genome_files set status='annotated' where id='83000000-0000-4000-8000-000000000003';
update public.subjects set lifecycle='restricted' where subject_account_id='83000000-0000-4000-8000-000000000001' and subject_class='self';
set local role authenticated;
select is((select count(*) from public.report_observed_calls),0::bigint,'frozen subject is unreadable immediately');
reset role;
update public.subjects set lifecycle='active' where subject_account_id='83000000-0000-4000-8000-000000000001' and subject_class='self';
select lives_ok($$select private.assert_supported_account_fk_shape_v1('83000000-0000-4000-8000-000000000001',array[(select id from public.subjects where subject_account_id='83000000-0000-4000-8000-000000000001' and subject_class='self')],'{}'::uuid[])$$,'file-owned projection does not block account graph classification');
delete from public.genome_files where id='83000000-0000-4000-8000-000000000003';
select is((select count(*) from public.report_observed_calls),0::bigint,'exact file deletion cascades observed source rows');
select is((select count(*) from public.user_variants),0::bigint,'no reference row entered variant inputs');
select is((select relrowsecurity from pg_class where oid='public.report_observed_calls'::regclass),true,'RLS is enabled on observed calls');
select * from finish();
rollback;
