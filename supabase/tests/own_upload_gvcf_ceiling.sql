-- The gVCF admission ceiling (20260918150000_own_upload_gvcf_ceiling.sql),
-- proved on a fresh database with rollback-only synthetic identities: unset,
-- every reader falls back to the VCF ceiling; set, a gVCF is measured against
-- its own number at issuance, normalization and preparation admission, and the
-- disclosure names both. Nothing here prepares bytes or reads a provider.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,8,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes,
 maximum_account_bytes=excluded.maximum_account_bytes,maximum_active_uploads=excluded.maximum_active_uploads,maximum_gvcf_bytes=null;
-- Entirely synthetic, rollback-only identity and metadata-only Storage rows.
insert into auth.users(id,email,email_confirmed_at) values('89c20000-0000-4000-8000-000000000001','gvcf-ceiling@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('89c20000-0000-4000-8000-000000000010','89c20000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='89c20000-0000-4000-8000-000000000001';
create temporary table ceiling_subject as select id from public.subjects
 where subject_account_id='89c20000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010',
 (select id from ceiling_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010',
 (select id from ceiling_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local storage.allow_delete_query='true';
create function pg_temp.limits() returns jsonb language sql as $$
 select public.own_upload_limits_v1('89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010'); $$;
create function pg_temp.issue(format text,size bigint,raw text) returns jsonb language sql as $$
 select public.issue_own_storage_upload_v1('89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010',
  (select id from ceiling_subject),format,size,raw); $$;
create temporary table issued(label text primary key,value jsonb);
-- One issued and finalized source through the real RPCs, the fixture shape the
-- sibling preparation tests use, with the declared format and size chosen here.
create function pg_temp.make_source(label text,format text,size bigint,raw text,decoded text) returns uuid language plpgsql as $$
declare i jsonb; finalizing jsonb; finalized jsonb; oid uuid;
begin
 i:=pg_temp.issue(format,size,raw);
 insert into issued values(label,i);
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('genomes',i->>'stagingKey',
  '89c20000-0000-4000-8000-000000000001',jsonb_build_object('size',size));
 finalizing:=public.begin_own_upload_finalization_v1('89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010',
  (i->>'uploadId')::uuid);
 insert into storage.objects(bucket_id,name,metadata) values('genomes',finalizing->>'finalKey',jsonb_build_object('size',size)) returning id into oid;
 delete from storage.objects where bucket_id='genomes' and name=i->>'stagingKey';
 finalized:=public.complete_own_upload_finalization_v1('89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010',
  (i->>'uploadId')::uuid,(finalizing->>'claim')::uuid,oid,raw,decoded);
 return (finalized->>'fileId')::uuid;
end; $$;
create temporary table sources(label text primary key,file_id uuid not null);
grant select on sources to service_role;
create function pg_temp.enqueue(label text) returns jsonb language sql as $$
 select public.enqueue_own_preparation_v1('89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010',
  (select file_id from sources s where s.label=enqueue.label)); $$;
create function pg_temp.normalize_begin(label text) returns jsonb language sql as $$
 select public.own_upload_normalization_v1('begin','89c20000-0000-4000-8000-000000000001','89c20000-0000-4000-8000-000000000010',
  (select file_id from sources s where s.label=normalize_begin.label),null,null); $$;

-- The column.
select ok((select is_nullable='YES' and data_type='bigint' from information_schema.columns
 where table_schema='private' and table_name='upload_authorization_config' and column_name='maximum_gvcf_bytes'),
 'the gVCF ceiling is a nullable bigint on the deployment configuration');
select throws_ok($$update private.upload_authorization_config set maximum_gvcf_bytes=0 where singleton$$,'23514',null,
 'a zero gVCF ceiling is refused');

-- Unset: every reader falls back to the VCF ceiling.
select is(pg_temp.limits()->'maximumGvcfBytes',to_jsonb(8),'unset, the disclosed gVCF ceiling is the VCF ceiling');
select throws_ok($$select pg_temp.issue('gVCF',12,repeat('0',64))$$,'22023','file_too_large',
 'unset, a gVCF declaration is measured against the VCF ceiling');
select is((select count(*)::integer from public.upload_sessions where account_id='89c20000-0000-4000-8000-000000000001'),0,
 'the refused declaration left no session');

-- Set: the two ceilings are independent.
update private.upload_authorization_config set maximum_gvcf_bytes=16 where singleton;
select is(pg_temp.limits(),jsonb_build_object('maximumArrayBytes',52428800,'maximumVcfBytes',8,'maximumGvcfBytes',16,
 'maximumAccountBytes',1073741824,'maximumActiveUploads',32,'reservedBytes',0,'activeUploads',0),
 'set, the disclosure names both ceilings and nothing else changes');
select throws_ok($$select pg_temp.issue('VCF',12,repeat('1',64))$$,'22023','file_too_large',
 'a VCF above the VCF ceiling is refused whatever the gVCF ceiling says');
select throws_ok($$select pg_temp.issue('VCF.GZ',12,repeat('2',64))$$,'22023','file_too_large',
 'a VCF.GZ above the VCF ceiling is refused whatever the gVCF ceiling says');
insert into sources values('first',pg_temp.make_source('first','gVCF',12,repeat('3',64),repeat('4',64)));
select is((select maximum_decoded_bytes from public.upload_sessions where id=((select value from issued where label='first')->>'uploadId')::uuid),
 16::bigint,'the gVCF ceiling is stored as the session''s decoded ceiling');
select is((select declared_format from public.upload_sessions where id=((select value from issued where label='first')->>'uploadId')::uuid),
 'gVCF','the session keeps the gVCF declaration');
select is((select file_type::text||':'||size_bytes from public.genome_files where id=(select file_id from sources where label='first')),
 'gvcf:12','the finalized source is a gvcf of the declared size, above the VCF ceiling');

-- Normalization admission reads the gVCF ceiling for a gvcf source.
create temporary table receipts(label text primary key,value jsonb);
grant select,insert on receipts to service_role;
insert into receipts values('normalize-first',pg_temp.normalize_begin('first'));
select is((select value->>'status' from receipts where label='normalize-first'),'authorized',
 'a stored gvcf within the gVCF ceiling may begin normalization');
select is((select (value->>'maximumDecodedBytes')::bigint from receipts where label='normalize-first'),16::bigint,
 'the normalization manifest carries the gVCF ceiling as its decoded ceiling');
insert into sources values('second',pg_temp.make_source('second','gVCF',12,repeat('5',64),repeat('6',64)));
update private.upload_authorization_config set maximum_gvcf_bytes=8 where singleton;
select throws_ok($$select pg_temp.normalize_begin('second')$$,'55000','unavailable',
 'a stored gvcf above a lowered gVCF ceiling cannot begin normalization');
update private.upload_authorization_config set maximum_gvcf_bytes=16 where singleton;

-- Preparation admission reads the gVCF ceiling for a gvcf source.
update private.own_preparation_config set enabled=true,artifact_provider='r2',r2_bucket='inherit-prepared-test' where singleton;
set local role service_role;
insert into receipts values('enqueue-second',pg_temp.enqueue('second'));
reset role;
select is((select count(*)::integer from private.own_preparation_jobs where file_id=(select file_id from sources where label='second')),1,
 'a stored gvcf within the gVCF ceiling is admitted to preparation');
select is((select (source->>'maximumDecodedBytes')::bigint from private.own_preparation_jobs
 where file_id=(select file_id from sources where label='second')),16::bigint,
 'the preparation job carries the gVCF ceiling as its decoded ceiling');
insert into sources values('third',pg_temp.make_source('third','gVCF',12,repeat('7',64),repeat('8',64)));
update private.upload_authorization_config set maximum_gvcf_bytes=8 where singleton;
set local role service_role;
select throws_ok($$select pg_temp.enqueue('third')$$,'42501','not_found',
 'a stored gvcf above a lowered gVCF ceiling is refused preparation admission');
reset role;
select is((select count(*)::integer from private.own_preparation_jobs where file_id=(select file_id from sources where label='third')),0,
 'the refused gvcf has no job');

-- A VCF is never measured against the gVCF ceiling.
update private.upload_authorization_config set maximum_vcf_bytes=16,maximum_gvcf_bytes=8 where singleton;
insert into sources values('fourth',pg_temp.make_source('fourth','VCF',12,repeat('9',64),repeat('a',64)));
set local role service_role;
insert into receipts values('enqueue-fourth',pg_temp.enqueue('fourth'));
reset role;
select is((select (source->>'maximumDecodedBytes')::bigint from private.own_preparation_jobs
 where file_id=(select file_id from sources where label='fourth')),16::bigint,
 'a vcf above the gVCF ceiling but within the VCF ceiling is admitted against the VCF ceiling');
select throws_ok($$select pg_temp.issue('gVCF',12,repeat('b',64))$$,'22023','file_too_large',
 'with the ceilings reversed a gVCF above the gVCF ceiling is refused although a VCF of that size is not');

-- Replacing the four functions kept their grants and search_path.
select ok(has_function_privilege('service_role','public.own_upload_limits_v1(uuid,uuid)','execute')
 and has_function_privilege('service_role','public.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text)','execute'),
 'the server role still reaches the public wrappers');
select ok(not has_function_privilege('authenticated','private.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text)','execute')
 and not has_function_privilege('anon','private.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text)','execute')
 and not has_function_privilege('inherit_upload_only','private.issue_own_storage_upload_v1(uuid,uuid,uuid,text,bigint,text)','execute'),
 'the private issuer stays unreachable from browser and upload roles');
select ok(not has_function_privilege('authenticated','private.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)','execute')
 and not has_function_privilege('anon','private.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)','execute')
 and not has_function_privilege('inherit_upload_only','private.own_upload_normalization_v1(text,uuid,uuid,uuid,uuid,jsonb)','execute'),
 'the private normalizer stays unreachable from browser and upload roles');
select ok(not has_function_privilege('authenticated','private.own_preparation_source_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','private.own_preparation_source_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','private.own_preparation_source_v1(uuid,uuid,uuid)','execute'),
 'the private preparation source reader stays unreachable from browser and upload roles');
select ok(not has_function_privilege('authenticated','private.own_upload_limits_v1(uuid,uuid)','execute')
 and not has_function_privilege('anon','private.own_upload_limits_v1(uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','private.own_upload_limits_v1(uuid,uuid)','execute'),
 'the private disclosure stays unreachable from browser and upload roles');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
 and p.proname in('issue_own_storage_upload_v1','own_upload_normalization_v1','own_preparation_source_v1','own_upload_limits_v1')
 and p.prosecdef and array_to_string(p.proconfig,',') like 'search_path=pg_catalog,%private%'),4,
 'all four replaced functions are still security definers with the pinned search_path');

select * from finish();
rollback;
