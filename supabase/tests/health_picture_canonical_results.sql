begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads)
values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
create function pg_temp.pid(n integer) returns uuid language sql immutable as $$ select ('79310000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.sid(n integer) returns uuid language sql as $$ select id from public.subjects where subject_account_id=pg_temp.pid(n) and subject_class='self'; $$;
create function pg_temp.principal(n integer) returns uuid language sql as $$ select id from public.subject_principals where subject_id=pg_temp.sid(n) and account_id=pg_temp.pid(n) and principal_kind='account_subject' and status='active'; $$;
-- Real signing and normalization transitions over rollback-only synthetic
-- object metadata. No result, genotype, ROH, or grant is manufactured.
do $$ declare n integer; artifact text; nonce text; claim uuid; begin
 for n in 1..3 loop
  insert into auth.users(id,email,email_confirmed_at) values(pg_temp.pid(n),'health-picture-'||n||'@e2e.local',now());
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
create function pg_temp.joint(n integer,recipient integer,strong boolean default true) returns uuid language plpgsql as $$
begin
 if not strong then return public.grant_directional_purpose_v1(pg_temp.pid(n),pg_temp.sid(n),pg_temp.principal(recipient),'family.heritability','consent.share-with-adult',1,gen_random_uuid()::text); end if;
 return public.grant_health_picture_purpose_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.principal(recipient),pg_temp.pid(recipient),'family.heritability',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),gen_random_uuid()::text,
 public.health_picture_grant_presentation_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.pid(recipient)));
end; $$;
create function pg_temp.counterparts() returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('subjectId',pg_temp.sid(2),'accountId',pg_temp.pid(2))); $$;
create function pg_temp.page(n integer,p text default 'reports.polygenic') returns jsonb language sql as $$
 select public.health_picture_results_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.counterparts(),pg_temp.sid(n),p); $$;
create function pg_temp.capture() returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('subjectId',pg_temp.sid(n),'purpose',p,'afterFile',null,'receipt',pg_temp.page(n,p)->>'pageReceipt') order by pg_temp.sid(n),p)
 from generate_series(1,2) n cross join unnest(array['reports.monogenic','reports.polygenic']) p; $$;
create function pg_temp.confirm(capture jsonb) returns boolean language sql as $$
 select public.confirm_health_picture_results_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.counterparts(),array['reports.monogenic','reports.polygenic'],capture); $$;
create function pg_temp.share(p text default 'reports.polygenic') returns uuid language sql as $$
 select public.grant_family_report_purpose_v1(pg_temp.pid(2),pg_temp.pid(12),pg_temp.sid(2),pg_temp.principal(1),pg_temp.pid(1),p,1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),gen_random_uuid()::text,
 public.family_report_grant_presentation_v1(pg_temp.pid(2),pg_temp.pid(12),pg_temp.sid(2),pg_temp.pid(1))); $$;
select ok(not has_function_privilege('authenticated','public.health_picture_results_v1(uuid,uuid,uuid,jsonb,uuid,text,uuid)','execute'),'content reader is service-only');
select ok(not has_table_privilege('service_role','private.health_picture_grant_snapshots','insert'),'service client cannot backfill endpoint proof');
select throws_ok($$select pg_temp.page(1)$$,'42501','not_found','no reciprocal permission denies even own comparison column');
create temporary table joints(n int,grant_id uuid);
insert into joints values(1,pg_temp.joint(1,2,false)),(2,pg_temp.joint(2,1,false));
select is(pg_temp.page(2)->>'access','not-shared','joint permission never substitutes report-layer sharing');
select pg_temp.share();
select is(pg_temp.page(2)->>'access','legacy-only','historical joint grants never authorize canonical saved reports');
select is(pg_temp.page(2)->'sources','[]'::jsonb,'historical joint grants do not expose canonical source metadata');
select is(pg_temp.page(1)->>'hasPreparedSource','true','own prepared source remains independently available');
update joints set grant_id=pg_temp.joint(n,3-n);
select is(pg_temp.page(2)->>'access','canonical','both explicitly reaffirmed directions permit canonical reader');
select is(pg_temp.page(2)->'sources','[]'::jsonb,'source preparation and sharing alone do not create saved reports');
select is((select count(*) from public.family_pairs where subject_low_id in(pg_temp.sid(1),pg_temp.sid(2))),0::bigint,'Health Picture creates no Portrait family pair');
create temporary table prepared_capture as select pg_temp.capture() value;
select is(pg_temp.confirm((select value from prepared_capture)),true,'all prepared and not-shared empty captures confirm');
select is(pg_temp.confirm((select value from prepared_capture)-0),false,'omitting an empty purpose from terminal check denies');
-- Own choices and actual completion use the same normalization/grant/generation
-- functions as the browser path; no grant or result row is manually inserted.
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
select pg_temp.generate(1,'reports.polygenic');
select pg_temp.generate(2,'reports.polygenic');
select is(pg_temp.confirm((select value from prepared_capture)),false,'new owner choices and completion invalidate earlier empty capture');
select is(jsonb_array_length(pg_temp.page(1)->'sources'),1,'A reads its independently generated report');
select is(jsonb_array_length(pg_temp.page(2)->'sources'),1,'B requires its own completion plus separate strong report and joint grants');
select is(pg_temp.page(1,'reports.monogenic')->'sources','[]'::jsonb,'unselected own layer stays empty without hiding selected polygenic layer');
select is(pg_temp.page(2,'reports.monogenic')->>'access','not-shared','B unshared layer is explicit before file readiness');
select is(pg_temp.page(2)#>>'{sources,0,reports,0,catalogSnapshot,template,title}','Captured poly','comparison preserves captured scientific template');
select ok(pg_temp.page(2)::text !~ 'raw_score|percentile|zscore|bucket_path|source_sha256','projection excludes raw PRS and storage paths');
create temporary table capture as select pg_temp.capture() value;
select is(pg_temp.confirm((select value from capture)),true,'single final transaction checks both adults and both layer states');
savepoint change;
select pg_temp.share('reports.monogenic');
select is(pg_temp.confirm((select value from capture)),false,'new sharing invalidates captured not-shared state');
rollback to change;
savepoint change;
update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id=pg_temp.pid(2);
select is(pg_temp.confirm((select value from capture)),false,'same-ID recipient binding transition denies the whole capture');
rollback to change;
savepoint change;
update public.subject_relationships set relationship_revision=relationship_revision+1 where subject_id=pg_temp.sid(2);
select is(pg_temp.confirm((select value from capture)),false,'relationship revision transition invalidates joint authority');
rollback to change;
savepoint change;
select public.revoke_directional_purpose_v1(pg_temp.pid(2),(select grant_id from public.purpose_grants pg join public.directional_grants dg using(grant_id) where pg.target_id=pg_temp.sid(2) and pg.purpose='reports.polygenic' and dg.recipient_account_id=pg_temp.pid(1) and pg.revoked_at is null));
select is(pg_temp.confirm((select value from capture)),false,'B recipient-layer withdrawal invalidates terminal comparison');
select is(pg_temp.page(2)->>'access','not-shared','fresh capture truthfully withholds B withdrawn report layer');
select is(jsonb_array_length(pg_temp.page(1)->'sources'),1,'B sharing withdrawal preserves A own saved result');
rollback to change;
savepoint change;
update public.genome_files set status='failed' where id=pg_temp.pid(41);
select is(pg_temp.confirm((select value from capture)),false,'A source failure denies earlier source receipt');
rollback to change;
savepoint change;
delete from auth.sessions where id=pg_temp.pid(11);
select is(pg_temp.confirm((select value from capture)),false,'actual viewer session deletion denies every column');
rollback to change;
savepoint change;
select public.revoke_directional_purpose_v1(pg_temp.pid(1),(select grant_id from joints where n=1));
select is(pg_temp.confirm((select value from capture)),false,'one joint withdrawal denies comparison');
update joints set grant_id=pg_temp.joint(1,2) where n=1;
select is(pg_temp.page(2)->>'access','canonical','first direction off/on does not stale the opposite grant');
select public.revoke_directional_purpose_v1(pg_temp.pid(2),(select grant_id from joints where n=2));
update joints set grant_id=pg_temp.joint(2,1) where n=2;
select is(pg_temp.page(2)->>'access','canonical','second direction off/on preserves the first strong grant');
rollback to change;
select is((select count(*) from public.genome_files where id in(pg_temp.pid(41),pg_temp.pid(42))),2::bigint,'all read/revoke probes preserve independently stored originals');
savepoint own_choice;
select public.revoke_directional_purpose_v1(pg_temp.pid(1),(select pg.grant_id from public.purpose_grants pg join public.directional_grants dg using(grant_id)
 where pg.target_id=pg_temp.sid(1) and pg.purpose='reports.polygenic' and dg.recipient_account_id=pg_temp.pid(1) and pg.revoked_at is null));
select is(pg_temp.confirm((select value from capture)),false,'A own-purpose withdrawal invalidates capture separately from joint grants');
select is(pg_temp.page(1)->'sources','[]'::jsonb,'A revoked own layer no longer returns saved results');
select is(jsonb_array_length(pg_temp.page(2)->'sources'),1,'independently authorized B source survives A own withdrawal');
rollback to own_choice;
savepoint legacy_files;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status)
values(pg_temp.pid(80),pg_temp.pid(1),pg_temp.sid(1),'legacy-health-a','Historical A','vcf',1,8,repeat('c',64),'annotated'),
 (pg_temp.pid(81),pg_temp.pid(2),pg_temp.sid(2),'legacy-health-b','Historical B','vcf',1,8,repeat('d',64),'annotated');
select is(pg_temp.page(1)->'legacyFileIds',jsonb_build_array(pg_temp.pid(80)),'own legacy membership excludes every prepared modern file');
select is(pg_temp.page(2)->'legacyFileIds',jsonb_build_array(pg_temp.pid(81)),'B legacy membership remains exact and independently attributed');
select is(pg_temp.page(2,'reports.monogenic')->>'access','not-shared','legacy IDs never override a per-purpose not-shared state');
select is(pg_temp.confirm((select value from capture)),false,'new legacy membership invalidates prior whole comparison');
rollback to legacy_files;
savepoint clock_expiry;
-- Delay only the later terminal page after its source has been read. This
-- rollback-local function body hook never reaches migration/runtime code.
do $probe$ declare definition text; begin
 select pg_get_functiondef('public.health_picture_results_v1(uuid,uuid,uuid,jsonb,uuid,text,uuid)'::regprocedure) into definition;
 definition:=replace(definition,' return page||jsonb_build_object',
 $hook$ if current_setting('inherit.health_picture_expiry_probe',true)='on'
  and p_subject_id=greatest(pg_temp.sid(1),pg_temp.sid(2)) and p_purpose='reports.polygenic' then perform pg_sleep(1.2); end if;
 return page||jsonb_build_object$hook$);
 execute definition;
end $probe$;
update public.subject_consents set expires_at=clock_timestamp()+interval '1 second'
 where subject_id=least(pg_temp.sid(1),pg_temp.sid(2)) and consent_type='upload_class' and revoked_at is null;
select set_config('inherit.health_picture_expiry_probe','on',true);
select is(pg_temp.confirm((select value from capture)),false,'store consent expiring after its page but during a later page fails terminal clock fence');
select ok((select expires_at<=clock_timestamp() from public.subject_consents where subject_id=least(pg_temp.sid(1),pg_temp.sid(2)) and consent_type='upload_class' and revoked_at is null),'expiry probe actually crossed the earlier source deadline');
rollback to clock_expiry;
savepoint stale_prompt;
create temporary table hp_prompt as select public.health_picture_grant_presentation_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.pid(2)) receipt;
update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id=pg_temp.pid(2);
select throws_ok($$select public.grant_health_picture_purpose_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),pg_temp.principal(2),pg_temp.pid(2),'family.heritability',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),'health-picture-stale-prompt-proof',(select receipt from hp_prompt))$$,
 '42501','not_found','same-ID binding transition between prompt and commit refuses without upgrading grant');
rollback to stale_prompt;
savepoint third_adult;
select pg_temp.joint(1,3);
select pg_temp.joint(3,1);
create temporary table multiple as select pg_temp.counterparts()||jsonb_build_array(jsonb_build_object('subjectId',pg_temp.sid(3),'accountId',pg_temp.pid(3))) cps;
create temporary table multiple_capture as select jsonb_agg(jsonb_build_object('subjectId',pg_temp.sid(n),'purpose',p,'afterFile',null,'receipt',
 public.health_picture_results_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),(select cps from multiple),pg_temp.sid(n),p)->>'pageReceipt') order by pg_temp.sid(n),p) value
 from generate_series(1,3) n cross join unnest(array['reports.monogenic','reports.polygenic']) p;
select is(public.confirm_health_picture_results_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),(select cps from multiple),array['reports.monogenic','reports.polygenic'],(select value from multiple_capture)),true,'three-adult outer transaction confirms all own/shared/empty columns together');
select is(public.health_picture_results_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),(select cps from multiple),pg_temp.sid(3),'reports.polygenic')->>'access','not-shared','third adult with joint grants alone has no report-layer access');
select is(public.confirm_health_picture_results_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.sid(1),(select cps from multiple),array['reports.monogenic','reports.polygenic'],(select value from multiple_capture)-5),false,'omitting the later adult empty capture denies whole transaction');
rollback to third_adult;
grant select on capture to service_role;
set local role service_role;
select is(pg_temp.confirm((select value from capture)),true,'actual service-role terminal RPC confirms original exact comparison after rollback probes');
reset role;
select * from finish();
rollback;
