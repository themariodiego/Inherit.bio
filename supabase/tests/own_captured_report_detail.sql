begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads)
values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
create function pg_temp.pid(n integer) returns uuid language sql immutable as $$ select ('79410000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.sid(n integer) returns uuid language sql as $$ select id from public.subjects where subject_account_id=pg_temp.pid(n) and subject_class='self'; $$;
create function pg_temp.principal(n integer) returns uuid language sql as $$ select id from public.subject_principals where subject_id=pg_temp.sid(n) and account_id=pg_temp.pid(n) and principal_kind='account_subject' and status='active'; $$;
-- Real signing and normalization transitions over rollback-only synthetic
-- object metadata. No result, genotype, ROH, or grant is manufactured.
do $$ declare n integer; artifact text; nonce text; claim uuid; begin
 for n in 1..3 loop
  insert into auth.users(id,email,email_confirmed_at) values(pg_temp.pid(n),'own-saved-detail-'||n||'@e2e.local',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(pg_temp.pid(n+10),pg_temp.pid(n),now(),now(),'aal1');
  update public.profiles set date_of_birth='1990-01-01' where id=pg_temp.pid(n);
  perform public.mark_independent_login_v1(pg_temp.pid(n),pg_temp.pid(n+10));
  if n=3 then continue; end if;
  foreach artifact in array array['disclosure.insurance-and-discrimination','consent.upload-self'] loop
   nonce:=encode(extensions.digest(n::text||artifact,'sha256'),'hex');
   insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
   values(nonce,pg_temp.pid(n),pg_temp.pid(n+10),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
   perform public.sign_own_upload_artifact_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),artifact,1,
    (select body_sha256 from public.consent_artifacts where artifact_key=artifact and version=1),
    case when artifact='consent.upload-self' then array['own-adult-dna'] else array['understood'] end,1,1,1,1,1,nonce);
  end loop;
  insert into storage.objects(id,bucket_id,name,metadata) values(pg_temp.pid(n+20),'genomes',pg_temp.pid(n+30)::text,'{"size":8}');
  insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
   upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
  values(pg_temp.pid(n+40),pg_temp.pid(n),pg_temp.sid(n),pg_temp.pid(n+30)::text,'Synthetic source','vcf',1,8,repeat('a',64),'uploaded',1,
   'single-logical-sample-v1',clock_timestamp(),repeat('b',64),pg_temp.pid(n+20));
  insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
  values(pg_temp.pid(n+20),pg_temp.pid(n+30)::text,'genomes',pg_temp.pid(n+40),repeat('a',64),8,1,'current');
  claim:=(public.own_upload_normalization_v1('begin',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40))->>'claim')::uuid;
  perform public.own_upload_normalization_v1('stage',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),claim,
   '{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
  perform public.own_upload_normalization_v1('complete',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),claim,
   jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
 end loop;
end $$;
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('health-picture-poly','basic-traits','Captured poly','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]'),
 ('health-picture-mono','medicines','Captured mono','Rollback-only call.','emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
create function pg_temp.generate(n int,p text) returns void language plpgsql as $$
declare key text; t public.report_templates%rowtype; claim uuid; content jsonb;
begin
 key:=case p when 'reports.monogenic' then 'consent.own-monogenic' else 'consent.own-polygenic' end;
 perform public.grant_own_report_purpose_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),
 public.own_report_context_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n)),p,
 (select version from public.consent_artifacts where artifact_key=key and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=key and superseded_at is null),
 encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),clock_timestamp()+interval '9 minutes');
 claim:=(public.own_report_generation_with_mail_v1('begin',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),p)->>'claim')::uuid;
 select * into t from public.report_templates where slug=case p when 'reports.monogenic' then 'health-picture-mono' else 'health-picture-poly' end;
 content:=jsonb_build_object('reports',jsonb_build_array(jsonb_build_object('slug',t.slug,'covered',true,'conflictingRsids','[]'::jsonb,
 'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved","strandFlipped":false}}]'::jsonb,
 'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,
 'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)))),
 'prs','[]'::jsonb,'readyMail',jsonb_build_object('contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat(case n when 1 then 'e' else 'f' end,64),'dashboardUrl','https://example.invalid/genome/me/reports'));
 perform public.own_report_generation_with_mail_v1('complete',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+40),p,claim,content);
end; $$;
create function pg_temp.generate_second(n int,p text) returns void language plpgsql as $$
declare key text; t public.report_templates%rowtype; claim uuid; content jsonb;
begin
 key:=case p when 'reports.monogenic' then 'consent.own-monogenic' else 'consent.own-polygenic' end;
 perform public.grant_own_report_purpose_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),
 public.own_report_context_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n)),p,
 (select version from public.consent_artifacts where artifact_key=key and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=key and superseded_at is null),
 encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),clock_timestamp()+interval '9 minutes');
 claim:=(public.own_report_generation_with_mail_v1('begin',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+50),p)->>'claim')::uuid;
 select * into t from public.report_templates where slug=case p when 'reports.monogenic' then 'health-picture-mono' else 'health-picture-poly' end;
 content:=jsonb_build_object('reports',jsonb_build_array(jsonb_build_object('slug',t.slug,'covered',true,'conflictingRsids','[]'::jsonb,
 'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved","strandFlipped":false}}]'::jsonb,
 'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,
 'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)))),
 'prs','[]'::jsonb,'readyMail',jsonb_build_object('contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat(case n when 1 then 'e' else 'f' end,64),'dashboardUrl','https://example.invalid/genome/me/reports'));
 perform public.own_report_generation_with_mail_v1('complete',pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.pid(n+50),p,claim,content);
end; $$;
create function pg_temp.saved(n int default 1,expected text default null) returns jsonb language sql as $$
 select public.own_captured_report_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.pid(n+40),'health-picture-poly',expected); $$;
select ok(not has_function_privilege('authenticated','public.own_captured_report_v1(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
 and not has_function_privilege('anon','public.own_captured_report_v1(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'exact own captured result is service-only');
select ok(pg_temp.saved() is null,'prepared source without explicit own purpose/completion has no captured report');
select pg_temp.generate(1,'reports.polygenic');
select pg_temp.generate(2,'reports.polygenic');
create temporary table captured as select pg_temp.saved() value;
select is((select value#>>'{source,fileId}' from captured),pg_temp.pid(41)::text,'result binds the selected own source');
select is((select value#>>'{source,reports,0,catalogSnapshot,template,title}' from captured),'Captured poly','title comes from completion-time catalog');
select is((select value#>>'{source,reports,0,variants,0,outcome,genotype}' from captured),'AG','stored genotype outcome is preserved');
select is(pg_temp.saved(1,(select value->>'receipt' from captured)),(select value from captured),'exact receipt confirms the same captured source and outcome');
select is((select count(*) from public.purpose_grants where purpose='family.heritability' and target_id in(pg_temp.sid(1),pg_temp.sid(2))),0::bigint,'own detail never requires or creates a Health Picture counterpart grant');
select ok(public.own_captured_report_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.pid(42),'health-picture-poly') is null,'another adult source cannot be retargeted to the viewer subject');
select ok(public.own_captured_report_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(2),pg_temp.pid(42),'health-picture-poly') is null,'own reader never impersonates another adult subject');
select ok(public.own_captured_report_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.pid(99),'health-picture-poly') is null,'missing explicit file does not fall back to another own source');
select ok(public.own_captured_report_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.pid(41),'absent-slug') is null,'uncompleted report slug does not reinterpret current template');
select ok(pg_temp.saved(1,repeat('0',64)) is null,'changed expected receipt refuses');
savepoint catalog_change;
update public.report_templates set title='Changed current title',summary='Changed current summary' where slug='health-picture-poly';
select is(pg_temp.saved(1,(select value->>'receipt' from captured)),(select value from captured),'current catalog edits cannot change previously captured result or receipt');
rollback to catalog_change;
savepoint source_change;
update public.genome_files set status='failed' where id=pg_temp.pid(41);
select ok(pg_temp.saved(1,(select value->>'receipt' from captured)) is null,'source failure invalidates exact receipt');
select ok(pg_temp.saved(2) is not null,'unrelated adult own source remains available');
rollback to source_change;
savepoint store_change;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn' where account_id=pg_temp.pid(1) and consent_type='upload_class';
select ok(pg_temp.saved(1,(select value->>'receipt' from captured)) is null,'current store withdrawal refuses before serialization');
rollback to store_change;
savepoint purpose_change;
select public.revoke_directional_purpose_v1(pg_temp.pid(1),(select pg.grant_id from public.purpose_grants pg join public.directional_grants dg using(grant_id)
 where pg.target_id=pg_temp.sid(1) and pg.purpose='reports.polygenic' and dg.recipient_account_id=pg_temp.pid(1) and pg.revoked_at is null));
select ok(pg_temp.saved(1,(select value->>'receipt' from captured)) is null,'own report-purpose withdrawal denies captured result');
select is((select count(*) from public.genome_files where id=pg_temp.pid(41)),1::bigint,'report withdrawal preserves original source');
rollback to purpose_change;
savepoint session_change;
delete from auth.sessions where id=pg_temp.pid(11);
select ok(pg_temp.saved(1,(select value->>'receipt' from captured)) is null,'actual session deletion denies captured result');
rollback to session_change;
savepoint binding_change;
update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id=pg_temp.pid(1);
select ok(pg_temp.saved(1,(select value->>'receipt' from captured)) is null,'same-ID own binding revision change refuses');
rollback to binding_change;
savepoint session_expiry;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=pg_temp.pid(11);
select ok(pg_temp.saved(1,(select value->>'receipt' from captured)) is null,'actual session clock expiry denies final receipt');
rollback to session_expiry;
savepoint selected_delete;
select public.prepare_genome_file_deletion_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pid(41));
select ok(pg_temp.saved(1,(select value->>'receipt' from captured)) is null,'real selected-file deletion prepare refuses saved source before Storage ACK');
select ok(pg_temp.saved(2) is not null,'selected-file deletion leaves the independent other adult source available');
rollback to selected_delete;
savepoint second_own;
insert into storage.objects(id,bucket_id,name,metadata) values(pg_temp.pid(61),'genomes',pg_temp.pid(71)::text,'{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
values(pg_temp.pid(51),pg_temp.pid(1),pg_temp.sid(1),pg_temp.pid(71)::text,'Second synthetic own source','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),pg_temp.pid(61));
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
values(pg_temp.pid(61),pg_temp.pid(71)::text,'genomes',pg_temp.pid(51),repeat('a',64),8,1,'current');
do $$ declare claim uuid; begin
 claim:=(public.own_upload_normalization_v1('begin',pg_temp.pid(1),pg_temp.pid(11),pg_temp.pid(51))->>'claim')::uuid;
 perform public.own_upload_normalization_v1('stage',pg_temp.pid(1),pg_temp.pid(11),pg_temp.pid(51),claim,
 '{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
 perform public.own_upload_normalization_v1('complete',pg_temp.pid(1),pg_temp.pid(11),pg_temp.pid(51),claim,
 jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
end $$;
select ok(public.own_captured_report_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.pid(51),'health-picture-poly') is null,'newer prepared own source cannot borrow an older file completion');
update public.report_templates set title='Second own captured title' where slug='health-picture-poly';
select pg_temp.generate_second(1,'reports.polygenic');
select is(public.own_captured_report_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.pid(51),'health-picture-poly')#>>'{source,reports,0,catalogSnapshot,template,title}',
 'Second own captured title','second own file addresses its own separately captured catalog');
select is(pg_temp.saved(1,(select value->>'receipt' from captured)),(select value from captured),'explicit first source never switches to the newer own file or its catalog');
select public.prepare_genome_file_deletion_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pid(41));
select ok(pg_temp.saved(1,(select value->>'receipt' from captured)) is null,'deleting the selected first own file refuses its saved detail');
select is(public.own_captured_report_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.pid(51),'health-picture-poly')#>>'{source,reports,0,catalogSnapshot,template,title}',
 'Second own captured title','deleting first own file preserves the second own saved result');
rollback to second_own;
grant select on captured to service_role;
set local role service_role;
select is(pg_temp.saved(1,(select value->>'receipt' from captured)),(select value from captured),'actual service-role RPC confirms exact original after rollback probes');
reset role;
select * from finish();
rollback;
