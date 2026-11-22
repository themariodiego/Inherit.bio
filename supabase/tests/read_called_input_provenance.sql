-- G7.4 read calling (ADR 0038): the guarded read-calling provenance
-- projection of 20261022110000_read_called_input_provenance.sql. Entirely
-- synthetic, rollback-only; the fixture setup is own_input_provenance.sql's,
-- with its own identifiers.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Own the bounded configuration and catalog fixture; a fresh database has no
-- application seed. These changes roll back with the synthetic source.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads)
 values(true,'http://127.0.0.1:54321/auth/v1',65536,65536,262144,2)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,
 maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants,citations)
 values('read-called-facts-fixture','basic-traits','Fixture','Rollback-only source facts.','published','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email) values('76910000-0000-4000-8000-000000000001','read-called-facts@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76910000-0000-4000-8000-000000000010','76910000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76910000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='76910000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76910000-0000-4000-8000-000000000001','76910000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76910000-0000-4000-8000-000000000001','76910000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76910000-0000-4000-8000-000000000001','76910000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('76910000-0000-4000-8000-000000000020',
 'genomes','76910000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('76910000-0000-4000-8000-000000000040','76910000-0000-4000-8000-000000000001',(select id from generation_subject),
 '76910000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'76910000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('76910000-0000-4000-8000-000000000020','76910000-0000-4000-8000-000000000030','genomes',
 '76910000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '76910000-0000-4000-8000-000000000001','76910000-0000-4000-8000-000000000010','76910000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'76910000-0000-4000-8000-000000000001',
 '76910000-0000-4000-8000-000000000010','76910000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance',jsonb_build_object('version','listed-calls-v1','sourceSha256',repeat('a',64),
 'sourceBuild','GRCh37','targetBuild','GRCh38','buildBasis','source-declared','chainSha256',repeat('c',64),
 'variantRowsMapped',0,'variantRowsUnmapped',0,'attempted',1,
 'counts','{"called":1,"noCall":1,"unsupported":0,"failedFilter":0,"blocks":0,"singleSample":true,"buildClaim":true}'::jsonb)));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'76910000-0000-4000-8000-000000000001',
 '76910000-0000-4000-8000-000000000010','76910000-0000-4000-8000-000000000040',purpose,
 case when op='begin' then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('76910000-0000-4000-8000-000000000001','76910000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('76910000-0000-4000-8000-000000000001',
 '76910000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;
create function pg_temp.source_facts(purpose text default null) returns jsonb language sql as $$
 select public.read_own_input_sources_v1('76910000-0000-4000-8000-000000000001',
 '76910000-0000-4000-8000-000000000010',(select id from generation_subject),
 array['76910000-0000-4000-8000-000000000040'::uuid],purpose);
$$;

-- G7.4, ADR 0038: 20261022110000 projects a closed `readCalls` object into
-- the own-source display read and changes nothing else. The predecessor body
-- is rebuilt here from the live definition by reversing the one patched
-- anchor, and its md5 is checked against the predecessor's, so "before" is
-- the exact function production runs today, not a description of it.
do $predecessor$
declare definition text:=pg_get_functiondef('private.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text)'::regprocedure);
 new_fragment text:=$new$'singleSample',v_counts->'singleSample','buildClaim',v_counts->'buildClaim'))
     -- 20261022110000: TEST-LOCAL read-calling provenance, only in its closed shape.
     ||case when jsonb_typeof(p->'readCalls')='object'
      and (select array_agg(k collate "C" order by k collate "C") from jsonb_object_keys(p->'readCalls') k)
       =array['heterozygousHigh','heterozygousLow','homozygousMinimum','input','minimumBaseQuality',
        'minimumDepth','minimumMappingQuality','reviewed','version']::text[]
      and p->'readCalls'->'version'='"inherit-read-calls-v1"'::jsonb
      and p->'readCalls'->'input' in ('"BAM"'::jsonb,'"CRAM"'::jsonb)
      and p->'readCalls'->'reviewed'='false'::jsonb
      and not exists(select 1 from unnest(array['minimumDepth','minimumBaseQuality','minimumMappingQuality']) k
       where case when jsonb_typeof(p->'readCalls'->k)='number'
        then (p->'readCalls'->>k)!~'^(0|[1-9][0-9]{0,8})$' else true end)
      and not exists(select 1 from unnest(array['heterozygousLow','heterozygousHigh','homozygousMinimum']) k
       where case when jsonb_typeof(p->'readCalls'->k)='number'
        then (p->'readCalls'->>k)::numeric<0 or (p->'readCalls'->>k)::numeric>1 else true end)
     then jsonb_build_object('readCalls',p->'readCalls') else '{}'::jsonb end));$new$;
 old_fragment text:=$old$'singleSample',v_counts->'singleSample','buildClaim',v_counts->'buildClaim'))));$old$;
begin
 if (length(definition)-length(replace(definition,new_fragment,'')))/length(new_fragment)<>1 then
  raise exception 'patched anchor not found exactly once'; end if;
 execute replace(replace(definition,'private.read_own_input_sources_v1(','pg_temp.read_own_input_sources_predecessor('),
  new_fragment,old_fragment);
end;
$predecessor$;
select is((select md5(prosrc) from pg_proc where proname='read_own_input_sources_predecessor'),
 '5f6d4777cf080f59ffa0d7d5e888fc8b','the rebuilt predecessor is byte-identical to the body this migration replaced');
select is((select md5(prosrc) from pg_proc where oid='private.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text)'::regprocedure),
 '13d4287ed62bbb15069d56ca3c935d6f','the live reader is the guarded successor');
select is((select proacl::text from pg_proc where oid='private.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text)'::regprocedure),
 '{postgres=X/postgres,service_role=X/postgres}','the reader keeps its service-only grant');
create function pg_temp.before_facts() returns jsonb language sql as $$
 select pg_temp.read_own_input_sources_predecessor('76910000-0000-4000-8000-000000000001',
 '76910000-0000-4000-8000-000000000010',(select id from generation_subject),
 array['76910000-0000-4000-8000-000000000040'::uuid],null);
$$;
create function pg_temp.set_read_calls(value jsonb) returns void language sql as $$
 update private.own_normalization_runs set provenance=jsonb_set(provenance,'{readCalls}',value)
  where file_id='76910000-0000-4000-8000-000000000040';
$$;
create temporary table valid_read_calls as select '{"version":"inherit-read-calls-v1","input":"BAM","minimumDepth":10,
 "minimumBaseQuality":20,"minimumMappingQuality":20,"heterozygousLow":0.25,"heterozygousHigh":0.75,
 "homozygousMinimum":0.9,"reviewed":false}'::jsonb value;

-- 1. An ordinary source: the same bytes before and after.
select is(jsonb_array_length(pg_temp.source_facts()),1,'the ordinary VCF source is readable');
select is(pg_temp.source_facts(),pg_temp.before_facts(),'ordinary VCF source: the DTO is identical before and after');
select is(pg_temp.source_facts()::text,pg_temp.before_facts()::text,'ordinary VCF source: the DTO text is byte-identical');
select is((pg_temp.source_facts()->0->'snapshot')-array['sourceBuild','buildBasis','targetBuild','variantRowsMapped','variantRowsUnmapped','counts'],
 '{}'::jsonb,'ordinary VCF source: no readCalls key appears');
savepoint ordinary;
update public.genome_files set file_type='array_23andme' where id='76910000-0000-4000-8000-000000000040';
select is(pg_temp.source_facts()->0->>'fileType','array_23andme','the array variant of the fixture is read');
select is(pg_temp.source_facts()::text,pg_temp.before_facts()::text,'ordinary array source: the DTO text is byte-identical');
rollback to ordinary;

-- 2. A valid readCalls object is projected after counts, and nothing else moves.
select pg_temp.set_read_calls((select value from valid_read_calls));
select is(pg_temp.source_facts()->0->'snapshot'->'readCalls',(select value from valid_read_calls),'a valid readCalls object is projected');
select is((pg_temp.source_facts()->0->'snapshot')-'readCalls',pg_temp.before_facts()->0->'snapshot',
 'every other snapshot fact is unchanged beside it');
select is((pg_temp.source_facts()->0)-'snapshot',(pg_temp.before_facts()->0)-'snapshot','the closed top-level DTO is unchanged');
select is(pg_temp.before_facts()->0->'snapshot'->'readCalls',null,'the predecessor dropped it, which is why this patch exists');
select pg_temp.set_read_calls((select value||'{"input":"CRAM"}' from valid_read_calls));
select is(pg_temp.source_facts()->0->'snapshot'->'readCalls'->>'input','CRAM','a CRAM input is projected too');
rollback to ordinary;

-- 3. Every malformed shape is dropped, and the source itself is still read.
create temporary table malformed(label text, value jsonb);
insert into malformed select label, value from (values
 ('an extra key',(select value||'{"extra":1}' from valid_read_calls)),
 ('a missing key',(select value-'minimumDepth' from valid_read_calls)),
 ('a wrong version',(select value||'{"version":"inherit-read-calls-v2"}' from valid_read_calls)),
 ('an unknown input',(select value||'{"input":"FASTQ"}' from valid_read_calls)),
 ('a non-integer depth',(select value||'{"minimumDepth":10.5}' from valid_read_calls)),
 ('a negative depth',(select value||'{"minimumDepth":-1}' from valid_read_calls)),
 ('a negative base quality',(select value||'{"minimumBaseQuality":-20}' from valid_read_calls)),
 ('a non-integer mapping quality',(select value||'{"minimumMappingQuality":19.9}' from valid_read_calls)),
 ('a quality given as text',(select value||'{"minimumBaseQuality":"20"}' from valid_read_calls)),
 ('a fraction above one',(select value||'{"heterozygousHigh":1.5}' from valid_read_calls)),
 ('a fraction below zero',(select value||'{"homozygousMinimum":-0.1}' from valid_read_calls)),
 ('a fraction given as text',(select value||'{"heterozygousLow":"0.25"}' from valid_read_calls)),
 ('reviewed true',(select value||'{"reviewed":true}' from valid_read_calls)),
 ('reviewed null',(select value||'{"reviewed":null}' from valid_read_calls)),
 ('an array',(select jsonb_build_array(value) from valid_read_calls)),
 ('a string','"inherit-read-calls-v1"'::jsonb),
 ('a number','10'::jsonb),
 ('JSON null','null'::jsonb)) cases(label,value);
create function pg_temp.check_malformed(label text, value jsonb) returns setof text language plpgsql as $$
begin
 perform pg_temp.set_read_calls(value);
 return next is(jsonb_array_length(pg_temp.source_facts()),1,label||': the source is still read');
 return next is(pg_temp.source_facts()::text,pg_temp.before_facts()::text,label||': dropped, the DTO is byte-identical to the predecessor''s');
 update private.own_normalization_runs set provenance=provenance-'readCalls' where file_id='76910000-0000-4000-8000-000000000040';
end;
$$;
select pg_temp.check_malformed(label,value) from malformed order by label;
select is((select count(*) from malformed),18::bigint,'eighteen malformed shapes were checked');
set constraints all immediate;
select * from finish();
rollback;
