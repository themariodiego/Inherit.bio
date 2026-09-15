begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Independent bounded fixture configuration. Every change, including an
-- update to an existing local singleton, is restored by transaction rollback.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads)
 values(true,'http://127.0.0.1:54321/auth/v1',65536,65536,262144,2)
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer,
 maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes,
 maximum_account_bytes=excluded.maximum_account_bytes,maximum_active_uploads=excluded.maximum_active_uploads;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email) values('79120000-0000-4000-8000-000000000001','ancestry-generation@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79120000-0000-4000-8000-000000000010','79120000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='79120000-0000-4000-8000-000000000001';
create temporary table ancestry_subject as select id from public.subjects
 where subject_account_id='79120000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('79120000-0000-4000-8000-000000000020',
 'genomes','79120000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('79120000-0000-4000-8000-000000000040','79120000-0000-4000-8000-000000000001',(select id from ancestry_subject),
 '79120000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'79120000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('79120000-0000-4000-8000-000000000020','79120000-0000-4000-8000-000000000030','genomes',
 '79120000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010','79120000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'79120000-0000-4000-8000-000000000001',
 '79120000-0000-4000-8000-000000000010','79120000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance',jsonb_build_object('version','listed-calls-v1','sourceSha256',repeat('a',64),
 'sourceBuild','GRCh37','targetBuild','GRCh38','buildBasis','source-declared','chainSha256',repeat('c',64),
 'variantRowsMapped',0,'variantRowsUnmapped',0,'attempted',1,
 'counts','{"called":1,"noCall":0,"unsupported":0,"failedFilter":0,"blocks":0,"singleSample":true,"buildClaim":true}'::jsonb)));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'ancestry',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'79120000-0000-4000-8000-000000000001',
 '79120000-0000-4000-8000-000000000010','79120000-0000-4000-8000-000000000040',purpose,
 case when op='begin' then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),public.own_report_context_v1('79120000-0000-4000-8000-000000000001',
 '79120000-0000-4000-8000-000000000010',(select id from ancestry_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'ancestry' then 'consent.own-ancestry' when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'ancestry' then 'consent.own-ancestry' when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;
create function pg_temp.readable(purpose text default 'ancestry') returns uuid[] language sql as $$
 select public.filter_own_analysis_files_v1('79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),purpose,array['79120000-0000-4000-8000-000000000040'::uuid],true);
$$;

create function pg_temp.read_ancestry() returns jsonb language sql as $$
 select public.own_ancestry_content_v1('79120000-0000-4000-8000-000000000001',
 '79120000-0000-4000-8000-000000000010','79120000-0000-4000-8000-000000000040');
$$;

-- Canonical preparation and owner choice use their existing transactions.
select pg_temp.grant_report('ancestry',repeat('c',64));
insert into claims values('ancestry',pg_temp.generate('begin'));
create temporary table ancestry_output as select jsonb_build_object('ancestry',jsonb_build_object(
 'schemaVersion',1,'computationRevision','own-ancestry-content-v1',
 'source',jsonb_build_object('fileId','79120000-0000-4000-8000-000000000040','subjectId',(select id from ancestry_subject),
  'normalizedBuild','GRCh38','callEncoding','vcf-literal','sourceRevision',1,'sourceSha256',repeat('a',64),
  'normalizedAt',receipt#>'{authorization,normalizedAt}'),
 'panel','{"id":"aims-kidd-seldin-168","version":"2026-08-28","provenance":"data/ref/AIMS_PROVENANCE.md","markerSha256":"e8109eedd184ab1fd3dedf9385357bd64ec166c3c3597e04d0213c1e1ed7064b","markerCount":168,"minimumMarkers":42}'::jsonb,
 'admixture','{"kind":"admixture","result":{"proportions":{"AFR":0.2,"AMR":0.2,"EAS":0.2,"EUR":0.2,"SAS":0.2},"markersUsed":0,"note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable."},"support_note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable.","model_id":"aims-kidd-seldin-168","model_version":"2026-08-28","coverage":0,"result_state":"not_covered","basis":"modelled","range":{"unavailable":true},"resolution":"five-broad-regions"}'::jsonb,
 'panelPositions','{"called":0,"missing":168,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0}'::jsonb,
 'lineages','[{"kind":"mtdna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0},{"kind":"ydna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0}]'::jsonb)) payload
 from claims where purpose='ancestry';

create temporary table captures as select payload->'ancestry' v1, null::jsonb v2,
 jsonb_set('{"schemaVersion":3,"computationRevision":"own-ancestry-content-v3","source":{"fileId":"78830000-0000-4000-8000-000000000001","subjectId":"78830000-0000-4000-8000-000000000002","normalizedBuild":"GRCh38","sourceRevision":1,"sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","callEncoding":"vcf-literal","normalizedAt":"2026-09-15T00:00:00Z"},"panel":{"id":"aims-hgdp-tgp-168","version":"hgdp-1kg-v3.1.2-cap30-168-v1","provenance":"data/ref/AIMS_SEVEN_REGION_PROVENANCE.md","markerSha256":"54279a25c01e72ed3c22caab0ffe778735a97fae8dffd0df498072a3f9857163","markerCount":168,"minimumMarkers":168},"admixture":{"kind":"admixture","result":{"proportions":null,"markersUsed":0,"note":"No usable ancestry markers were read. No region shares were computed.","fit":{"iterations":0,"converged":false},"reporting":{"policy":"merge-eur-mid-csa-v1","threshold":0.1,"merged":false,"caveat":"This panel cannot tell real mixed ancestry from its own errors between these regions. These shares may reflect either. It combines both, so people with mixed ancestry lose separate region detail more often."}},"support_note":"No usable ancestry markers were read. No region shares were computed.","model_id":"aims-hgdp-tgp-168","model_version":"hgdp-1kg-v3.1.2-cap30-168-v1","coverage":0,"result_state":"not_covered","basis":"modelled","range":{"unavailable":true},"resolution":"seven-regions-adaptive-v1"},"panelPositions":{"called":0,"missing":168,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0},"lineages":[{"kind":"mtdna","state":"unavailable","tree":{"id":"inherit-mtdna-curated-subset","version":"Build 17, Forensic Update 1a","sha256":"fb34d38ac78a900172a398e168b54b786711dbe662c12659db5fd09c6666efd1"},"markerPositions":106,"observedPositions":0,"readablePositions":0,"call":null,"reason":"no_supplied_positions"},{"kind":"ydna","state":"unavailable","tree":{"id":"inherit-ydna-curated-subset","version":"2016 index (4 January 2016)","sha256":"b5e956ec511dc3c4c3c40e38862c2e5af513be675cacead0b31469b174a168e3"},"markerPositions":31,"observedPositions":0,"readablePositions":0,"call":null,"reason":"no_supplied_positions"}]}'::jsonb,'{source}',payload#>'{ancestry,source}') v3 from ancestry_output;

update captures set v2=jsonb_set(jsonb_set(jsonb_set(v1,'{schemaVersion}','2'),'{computationRevision}','"own-ancestry-content-v2"'),'{lineages}',v3->'lineages');
select is(pg_temp.generate('complete','ancestry',jsonb_build_object('ancestry',(select v3 from captures)))->>'status','complete','synthetic v3 capture completes through the actual journal transaction');
insert into auth.users(id,email,email_confirmed_at) values
 ('79120000-0000-4000-8000-000000000002','ancestry-recipient@e2e.local',now()),
 ('79120000-0000-4000-8000-000000000003','ancestry-outsider@e2e.local',now());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('79120000-0000-4000-8000-000000000012','79120000-0000-4000-8000-000000000002',now(),now(),'aal1'),
 ('79120000-0000-4000-8000-000000000013','79120000-0000-4000-8000-000000000003',now(),now(),'aal1');
update public.profiles set date_of_birth='1990-01-01' where id in('79120000-0000-4000-8000-000000000002','79120000-0000-4000-8000-000000000003');
create function pg_temp.presentation() returns jsonb language sql as $$
 select public.family_ancestry_grant_presentation_v1('79120000-0000-4000-8000-000000000001',
 '79120000-0000-4000-8000-000000000010',(select id from ancestry_subject),'79120000-0000-4000-8000-000000000002'); $$;
create function pg_temp.share(receipt text,nonce text) returns uuid language sql as $$
 select public.grant_family_ancestry_purpose_v1('79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010',
 (select id from ancestry_subject),(select id from public.subject_principals where account_id='79120000-0000-4000-8000-000000000002'
 and principal_kind='account_subject' and status='active'),'79120000-0000-4000-8000-000000000002','ancestry',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,receipt); $$;
create function pg_temp.shared(mode text default 'content',after_file uuid default null) returns jsonb language sql as $$
 select public.family_shared_ancestry_results_v1('79120000-0000-4000-8000-000000000002',
 '79120000-0000-4000-8000-000000000012',(select id from ancestry_subject),after_file,mode); $$;
create function pg_temp.confirm(receipt text,mode text default 'content') returns boolean language sql as $$
 select public.confirm_family_shared_ancestry_results_v1('79120000-0000-4000-8000-000000000002',
 '79120000-0000-4000-8000-000000000012',(select id from ancestry_subject),mode,
 jsonb_build_array(jsonb_build_object('afterFile',null,'receipt',receipt))); $$;
select is(has_function_privilege('authenticated','public.family_shared_ancestry_results_v1(uuid,uuid,uuid,uuid,text)','execute'),false,'browser cannot call service capture');
select is(has_function_privilege('anon','public.grant_family_ancestry_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text)','execute'),false,'anonymous caller cannot grant ancestry');
select is(has_table_privilege('service_role','private.family_ancestry_grant_snapshots','insert'),false,'service client cannot fabricate endpoint proof');
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','a completed owner result is not a Family permission');
create temporary table old_share as select public.grant_directional_purpose_v1(
 '79120000-0000-4000-8000-000000000001',(select id from ancestry_subject),
 (select id from public.subject_principals where account_id='79120000-0000-4000-8000-000000000002' and principal_kind='account_subject' and status='active'),
 'ancestry','consent.share-with-adult',1,'ancestry-old-grant-nonce-0000') id;
select is(pg_temp.shared()->>'legacyOnly','true','historical ancestry grant has no fabricated endpoint proof');
select is(pg_temp.shared()->'sources','[]'::jsonb,'historical grant withholds ordinary canonical captures');
select is(pg_temp.presentation()->>'requiresConfirmation','true','owner is explicitly offered a fresh confirmation');
-- A legacy source has no canonical normalization contract. Its owner-purpose
-- gate and signed recipient direction still apply; old capture fields stay exact.
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
 values('79120000-0000-4000-8000-000000000041','79120000-0000-4000-8000-000000000001',(select id from ancestry_subject),
 'synthetic-legacy-ancestry','Synthetic legacy ancestry','vcf',1,8,'annotated');
insert into public.ancestry_results(user_id,file_id,subject_id,kind,result,support_note,model_id,model_version)
 select '79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000041',id,'admixture',
 '{"proportions":{"EUR":1},"markersUsed":168}','Synthetic historical result','legacy-model','legacy-version' from ancestry_subject;
select is(pg_temp.shared()#>>'{sources,0,kind}','legacy','historical permission can read an independently checked legacy result');
select is(pg_temp.shared()#>>'{sources,0,rows,0,model_version}','legacy-version','legacy model metadata is preserved');
create temporary table legacy_capture as select pg_temp.shared() receipt;
select is(pg_temp.confirm((select receipt->>'pageReceipt' from legacy_capture)),true,'legacy payload and source are covered by final confirmation');
savepoint legacy_changed;
update public.ancestry_results set support_note='Changed after read' where file_id='79120000-0000-4000-8000-000000000041';
select is(pg_temp.confirm((select receipt->>'pageReceipt' from legacy_capture)),false,'same legacy file with changed result cannot reuse a receipt');
rollback to legacy_changed;
create temporary table shared_grant as select pg_temp.share(pg_temp.presentation()->>'receipt','ancestry-new-grant-nonce-0000') id;
select isnt((select id from shared_grant),(select id from old_share),'fresh confirmation replaces the old grant instead of blessing it');
select ok((select revoked_at is not null from public.purpose_grants where grant_id=(select id from old_share)),'old grant is terminal');
select is(pg_temp.presentation()->>'requiresConfirmation','false','confirmed current endpoints need no further prompt');
select throws_ok($$select pg_temp.share(pg_temp.presentation()->>'receipt','ancestry-new-grant-nonce-0000')$$,'23505','presentation nonce already used','a fresh confirmation cannot replay its nonce');
select is(pg_temp.shared()->>'legacyOnly','false','fresh grant permits current canonical sources');
select is(jsonb_array_length(pg_temp.shared()->'sources'),2,'separate canonical and legacy results both survive');
select is(pg_temp.shared()#>>'{sources,0,content,schemaVersion}','3','v3 capture is returned as stored');
select is(pg_temp.shared()#>>'{sources,0,source,snapshot,sourceBuild}','GRCh37','authorized captured provenance keeps source-build attribution');
select is(pg_temp.shared()#>>'{sources,0,source,snapshot,targetBuild}','GRCh38','normalization target remains separate');
select ok(pg_temp.shared()::text !~ 'bucket_path|original_name|source_gt|objectKey|ancestry_source','wire result excludes raw storage and calls');
create temporary table captured_share as select pg_temp.shared() receipt;
create temporary table permission_capture as select pg_temp.shared('permission') receipt;
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),true,'final locked capture confirms all current sources');
select is(pg_temp.shared('permission')->'sources','[]'::jsonb,'ancestry-only link reads no source or result');
select is(pg_temp.shared('permission')->>'fileCount','0','permission capture has no source count');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from permission_capture),'permission'),true,'ancestry-only link has current recipient confirmation');
savepoint owner_logout;
delete from auth.sessions where id='79120000-0000-4000-8000-000000000010';
select is(jsonb_array_length(pg_temp.shared()->'sources'),2,'owner need not stay logged in for the recipient');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),true,'owner logout does not change source authority');
rollback to owner_logout;
savepoint viewer_logout;
delete from auth.sessions where id='79120000-0000-4000-8000-000000000012';
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','recipient session must remain live');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),false,'session loss withholds a captured result');
rollback to viewer_logout;
savepoint owner_revoke;
select public.revoke_directional_purpose_v1('79120000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from ancestry_subject) and purpose='ancestry'
 and grant_id not in(select id from shared_grant) and revoked_at is null));
select is(pg_temp.shared()->'sources','[]'::jsonb,'owner-purpose withdrawal withholds legacy and canonical ancestry');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),false,'owner-purpose withdrawal invalidates captured source and provenance');
rollback to owner_revoke;
savepoint recipient_revoke;
select public.revoke_directional_purpose_v1('79120000-0000-4000-8000-000000000001',(select id from shared_grant));
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','directional withdrawal denies content');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from permission_capture),'permission'),false,'directional withdrawal removes the ancestry-only link');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),false,'directional withdrawal removes previously captured results');
rollback to recipient_revoke;
savepoint paused;
select public.pause_family_sharing_v1('79120000-0000-4000-8000-000000000002','79120000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.shared()$$,'42501','not_found','either side can pause the shared result');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from permission_capture),'permission'),false,'pause removes the ancestry-only link');
rollback to paused;
savepoint drift;
select throws_ok($$update public.genome_files set upload_revision=upload_revision+1
 where id='79120000-0000-4000-8000-000000000040'$$,'23514',
 'new row for relation "genome_files" violates check constraint "normalization_source_completion"',
 'a partial source revision change is rejected before shared-reader validation');
-- Keep the completed-file constraint valid while making the stored capture stale.
update public.genome_files set upload_revision=upload_revision+1,
 normalization_source_revision=normalization_source_revision+1
 where id='79120000-0000-4000-8000-000000000040';
select is(jsonb_array_length(pg_temp.shared()->'sources'),1,'source drift preserves independently valid legacy sibling');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),false,'a valid sibling cannot mask earlier source drift');
rollback to drift;
select throws_ok($$update private.own_analysis_runs set result=jsonb_build_object('ancestry',(select v1 from captures))
 where file_id='79120000-0000-4000-8000-000000000040'$$,'55000','completed_report_is_immutable',
 'completed ancestry remains immutable during historical reader verification');
savepoint revision_one;
-- Use the real withdrawal/regrant/generation lifecycle. The completed-row
-- immutability trigger remains active; no completed result is rewritten.
select public.revoke_directional_purpose_v1('79120000-0000-4000-8000-000000000001',
 (select pg.grant_id from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  where pg.target_id=(select id from ancestry_subject) and pg.purpose='ancestry'
   and pg.revoked_at is null and dg.direction='self' and dg.status='current'));
select pg_temp.grant_report('ancestry',repeat('d',64));
update claims set receipt=pg_temp.generate('begin') where purpose='ancestry';
select is(pg_temp.generate('complete','ancestry',jsonb_build_object('ancestry',(select v1 from captures)))->>'status','complete',
 'historical v1 completes through a fresh authorized journal');
select is(pg_temp.shared()#>>'{sources,0,content,schemaVersion}','1','historical v1 stays readable without recomputation');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),false,'same file changed to a different capture invalidates old receipt');
rollback to revision_one;
savepoint revision_two;
-- Use the real withdrawal/regrant/generation lifecycle. The completed-row
-- immutability trigger remains active; no completed result is rewritten.
select public.revoke_directional_purpose_v1('79120000-0000-4000-8000-000000000001',
 (select pg.grant_id from public.purpose_grants pg join public.directional_grants dg
  on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
  where pg.target_id=(select id from ancestry_subject) and pg.purpose='ancestry'
   and pg.revoked_at is null and dg.direction='self' and dg.status='current'));
select pg_temp.grant_report('ancestry',repeat('e',64));
update claims set receipt=pg_temp.generate('begin') where purpose='ancestry';
select is(pg_temp.generate('complete','ancestry',jsonb_build_object('ancestry',(select v2 from captures)))->>'status','complete',
 'historical v2 completes through a fresh authorized journal');
select is(pg_temp.shared()#>>'{sources,0,content,schemaVersion}','2','historical v2 lineages stay readable');
rollback to revision_two;
savepoint stale_endpoint;
create temporary table old_prompt as select pg_temp.presentation()->>'receipt' receipt;
update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id='79120000-0000-4000-8000-000000000002' and status='current';
select throws_ok($$select pg_temp.share((select receipt from old_prompt),'ancestry-stale-prompt-nonce-0000')$$,'42501','not_found','same-ID changed recipient binding rejects stale confirmation');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),false,'changed recipient binding denies previously captured content');
rollback to stale_endpoint;

select throws_ok($$select public.family_shared_ancestry_results_v1('79120000-0000-4000-8000-000000000003',
 '79120000-0000-4000-8000-000000000013',(select id from ancestry_subject))$$,'42501','not_found','unrelated recipient cannot use the same source');
select throws_ok($$select pg_temp.shared('unknown')$$,'22023','invalid_request','unknown projection mode refuses');
select is((select cs.statement_keys from public.consent_signatures cs join public.purpose_grants pg on pg.signature_id=cs.id where pg.grant_id=(select id from shared_grant)),
 array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'],'fresh proof retains the exact approved statement keys');
savepoint prepared_source;
insert into private.own_preparation_jobs(file_id,account_id,subject_id,session_id,authority,source,created_at,job_deadline,cleanup_deadline)
 select '79120000-0000-4000-8000-000000000040','79120000-0000-4000-8000-000000000001',(select id from ancestry_subject),
 '79120000-0000-4000-8000-000000000010','{}','{}',t,t+interval '10 minutes',t+interval '2 hours' from (select clock_timestamp() t) stamp;
select is(pg_temp.shared()->>'preparedUnavailable','true','an active prepared job is explicitly unavailable for Family ancestry');
select is(jsonb_array_length(pg_temp.shared()->'sources'),1,'prepared identity cannot fall back to the older DB-normalized capture');
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),false,'prepared transition invalidates previously captured DB result');
rollback to prepared_source;
savepoint pagination;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
 select ('79120000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'79120000-0000-4000-8000-000000000001',(select id from ancestry_subject),
 'synthetic-page-'||n,'Synthetic empty legacy file','vcf',1,8,'annotated' from generate_series(1,100) n;
create temporary table pages as select pg_temp.shared() first_page;
alter table pages add column second_page jsonb;
update pages set second_page=pg_temp.shared('content',(first_page->>'nextAfter')::uuid);
select is((select first_page->>'fileCount' from pages),'100','first page is bounded at 100 sources');
select is((select second_page->>'fileCount' from pages),'2','terminal page preserves remaining authorized source count');
select is(pg_temp.confirm((select first_page->>'pageReceipt' from pages)),false,'a nonterminal first page alone cannot confirm');
select is(public.confirm_family_shared_ancestry_results_v1('79120000-0000-4000-8000-000000000002',
 '79120000-0000-4000-8000-000000000012',(select id from ancestry_subject),'content',
 (select jsonb_build_array(jsonb_build_object('afterFile',null,'receipt',first_page->>'pageReceipt'),
 jsonb_build_object('afterFile',first_page->'nextAfter','receipt',second_page->>'pageReceipt')) from pages)),true,
 'one locked operation confirms the complete cursor chain including an empty result page');
rollback to pagination;
-- Operational proof lifecycle. A second actual endpoint-proof grant establishes
-- that cleanup targets one direction; no snapshot fixture is inserted by hand.
create temporary table sibling_grant as select public.grant_family_ancestry_purpose_v1(
 '79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010',(select id from ancestry_subject),
 (select id from public.subject_principals where account_id='79120000-0000-4000-8000-000000000003'
  and principal_kind='account_subject' and status='active'),
 '79120000-0000-4000-8000-000000000003','ancestry',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),
 'ancestry-sibling-proof-nonce-0000',public.family_ancestry_grant_presentation_v1(
  '79120000-0000-4000-8000-000000000001','79120000-0000-4000-8000-000000000010',
  (select id from ancestry_subject),'79120000-0000-4000-8000-000000000003')->>'receipt') id;
create temporary table proof_before as select * from private.family_ancestry_grant_snapshots
 where grant_id in(select id from shared_grant union all select id from sibling_grant);
create temporary table signed_before as select pg.grant_id,to_jsonb(cs) signature from public.purpose_grants pg
 join public.consent_signatures cs on cs.id=pg.signature_id where pg.grant_id=(select id from shared_grant);
create function pg_temp.proof(id uuid) returns jsonb language sql as $$
 select endpoints from private.family_ancestry_grant_snapshots where grant_id=$1; $$;
create function pg_temp.original_proof(id uuid) returns jsonb language sql as $$
 select endpoints from proof_before where grant_id=$1; $$;
select is((select count(*) from proof_before),2::bigint,'two current independently signed directions each hold operational proof');
select is(has_function_privilege('service_role','private.clear_family_ancestry_snapshot_v1()','execute'),false,'service clients cannot invoke the cleanup helper');
select is(has_function_privilege('authenticated','private.clear_family_ancestry_snapshot_v1()','execute'),false,'browser roles cannot invoke the cleanup helper');
select is(has_table_privilege('service_role','private.family_ancestry_grant_snapshots','delete'),false,'service clients cannot delete endpoint proof directly');

savepoint proof_current;
update public.purpose_grants set grant_revision=grant_revision where grant_id=(select id from shared_grant);
update public.directional_grants set status=status,grant_revision=grant_revision where grant_id=(select id from shared_grant);
select is(pg_temp.proof((select id from shared_grant)),pg_temp.original_proof((select id from shared_grant)),'unchanged current grant writes retain exact endpoint proof');
select public.pause_family_sharing_v1('79120000-0000-4000-8000-000000000002','79120000-0000-4000-8000-000000000001');
select is(pg_temp.proof((select id from shared_grant)),pg_temp.original_proof((select id from shared_grant)),'pause preserves proof without terminalizing the grant');
select public.resume_family_sharing_v1('79120000-0000-4000-8000-000000000002','79120000-0000-4000-8000-000000000001');
select is(pg_temp.proof((select id from shared_grant)),pg_temp.original_proof((select id from shared_grant)),'resume uses the same exact proof');
select is(pg_temp.shared()->>'legacyOnly','false','resume retains canonical access without a new signature');
rollback to proof_current;

savepoint proof_revoked;
select public.revoke_directional_purpose_v1('79120000-0000-4000-8000-000000000001',(select id from shared_grant));
select is(pg_temp.proof((select id from shared_grant)),null::jsonb,'actual grant withdrawal atomically removes obsolete ancestry endpoint JSON');
select is(pg_temp.proof((select id from sibling_grant)),pg_temp.original_proof((select id from sibling_grant)),'withdrawal preserves the unrelated recipient proof byte for byte');
select is((select to_jsonb(cs) from public.consent_signatures cs join public.purpose_grants pg on pg.signature_id=cs.id
 where pg.grant_id=(select id from shared_grant)),(select signature from signed_before),'withdrawal retains the exact signed consent history');
select ok(exists(select 1 from public.purpose_grants where grant_id=(select id from shared_grant) and revoked_at is not null),'cleanup retains the terminal parent grant');
rollback to proof_revoked;

savepoint proof_base_revision;
update public.purpose_grants set grant_revision=grant_revision+1 where grant_id=(select id from shared_grant);
select is(pg_temp.proof((select id from shared_grant)),null::jsonb,'base revision change removes old proof in that statement');
update public.directional_grants set grant_revision=grant_revision+1 where grant_id=(select id from shared_grant);
set constraints purpose_grants_pair_check,directional_grants_pair_check immediate;
select is(pg_temp.proof((select id from sibling_grant)),pg_temp.original_proof((select id from sibling_grant)),'paired base revision transition preserves unrelated proof');
rollback to proof_base_revision;

savepoint proof_direction_revision;
update public.directional_grants set grant_revision=grant_revision+1 where grant_id=(select id from shared_grant);
select is(pg_temp.proof((select id from shared_grant)),null::jsonb,'direction revision change independently removes old proof');
update public.purpose_grants set grant_revision=grant_revision+1 where grant_id=(select id from shared_grant);
set constraints purpose_grants_pair_check,directional_grants_pair_check immediate;
select is(pg_temp.proof((select id from sibling_grant)),pg_temp.original_proof((select id from sibling_grant)),'paired direction revision transition preserves unrelated proof');
rollback to proof_direction_revision;

savepoint proof_direction_revoked;
update public.directional_grants set status='revoked',ended_at=clock_timestamp() where grant_id=(select id from shared_grant);
select is(pg_temp.proof((select id from shared_grant)),null::jsonb,'direction revoked removes ancestry proof before any base update');
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='lifecycle-test' where grant_id=(select id from shared_grant);
set constraints purpose_grants_pair_check,directional_grants_pair_check immediate;
select is(pg_temp.proof((select id from sibling_grant)),pg_temp.original_proof((select id from sibling_grant)),'direction revoked cleanup leaves unrelated proof intact');
rollback to proof_direction_revoked;

savepoint proof_direction_superseded;
update public.directional_grants set status='superseded',ended_at=clock_timestamp() where grant_id=(select id from shared_grant);
select is(pg_temp.proof((select id from shared_grant)),null::jsonb,'direction superseded removes ancestry proof before any base update');
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='lifecycle-test' where grant_id=(select id from shared_grant);
set constraints purpose_grants_pair_check,directional_grants_pair_check immediate;
select is(pg_temp.proof((select id from sibling_grant)),pg_temp.original_proof((select id from sibling_grant)),'direction superseded cleanup leaves unrelated proof intact');
rollback to proof_direction_superseded;

savepoint proof_direction_expired;
update public.directional_grants set status='expired',ended_at=clock_timestamp() where grant_id=(select id from shared_grant);
select is(pg_temp.proof((select id from shared_grant)),null::jsonb,'direction expired removes ancestry proof before any base update');
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='lifecycle-test' where grant_id=(select id from shared_grant);
set constraints purpose_grants_pair_check,directional_grants_pair_check immediate;
select is(pg_temp.proof((select id from sibling_grant)),pg_temp.original_proof((select id from sibling_grant)),'direction expired cleanup leaves unrelated proof intact');
rollback to proof_direction_expired;

savepoint proof_parent_deleted;
-- The registered parent cleanup first removes its exact replay-nonce child;
-- that existing FK is RESTRICT, independently of the snapshot's CASCADE.
delete from public.purpose_grant_nonces where grant_id=(select id from shared_grant);
delete from public.purpose_grants where grant_id=(select id from shared_grant);
select is(pg_temp.proof((select id from shared_grant)),null::jsonb,'registered parent deletion cascades to only its operational proof');
delete from public.directional_grants where grant_id=(select id from shared_grant);
set constraints purpose_grants_pair_check,directional_grants_pair_check immediate;
select is(pg_temp.proof((select id from sibling_grant)),pg_temp.original_proof((select id from sibling_grant)),'parent cascade preserves unrelated ancestry proof');
select is((select to_jsonb(cs) from public.consent_signatures cs where cs.id=((select signature from signed_before)->>'id')::uuid),
 (select signature from signed_before),'operational-child deletion does not erase separately retained signed history');
rollback to proof_parent_deleted;

savepoint proof_direction_deleted;
delete from public.directional_grants where grant_id=(select id from shared_grant);
select is(pg_temp.proof((select id from shared_grant)),null::jsonb,'direction deletion removes its proof before parent deletion');
delete from public.purpose_grant_nonces where grant_id=(select id from shared_grant);
delete from public.purpose_grants where grant_id=(select id from shared_grant);
set constraints purpose_grants_pair_check,directional_grants_pair_check immediate;
select is(pg_temp.proof((select id from sibling_grant)),pg_temp.original_proof((select id from sibling_grant)),'direction deletion preserves unrelated ancestry proof');
rollback to proof_direction_deleted;

-- Every real file enum value must be readable without an enum-cast exception.
-- Keep the existing legacy result in place to prove that an in-flight or
-- storage-only file cannot leak that stale result. The canonical sibling stays.
savepoint legacy_status_matrix;
create function pg_temp.legacy_status_snapshot(p_status public.genome_file_status)
returns jsonb language plpgsql as $$
declare observed jsonb;
begin
 update public.genome_files set status=p_status where id='79120000-0000-4000-8000-000000000041';
 observed:=pg_temp.shared();
 return jsonb_build_object('page',observed,'confirmed',pg_temp.confirm(observed->>'pageReceipt'),
  'permission',pg_temp.shared('permission'));
end; $$;
create temporary table legacy_status_matrix as
 select status,pg_temp.legacy_status_snapshot(status) observed
 from unnest(enum_range(null::public.genome_file_status)) as states(status);
select is((select jsonb_object_agg(status,observed#>'{page,preparing}') from legacy_status_matrix),
 '{"uploading":true,"uploaded":true,"parsing":true,"parsed":true,"annotated":false,"failed":false,"stored":false}'::jsonb,
 'legacy preparing matches the four actual in-flight states; stored and failed promise no processing');
select is((select jsonb_object_agg(status,observed#>'{page,fileCount}') from legacy_status_matrix),
 '{"uploading":2,"uploaded":2,"parsing":2,"parsed":2,"annotated":2,"failed":1,"stored":2}'::jsonb,
 'each non-failed legacy state counts its source while failed stays excluded');
select is((select jsonb_object_agg(status,jsonb_array_length(observed#>'{page,sources}')) from legacy_status_matrix),
 '{"uploading":1,"uploaded":1,"parsing":1,"parsed":1,"annotated":2,"failed":1,"stored":1}'::jsonb,
 'only annotated legacy files expose saved ancestry; other states withhold stale rows');
select is((select bool_and(observed#>'{page,sources,0}'=(select receipt#>'{sources,0}' from captured_share)) from legacy_status_matrix),
 true,'every legacy state preserves the exact independently authorized canonical sibling');
select is((select bool_and((observed->>'confirmed')::boolean) from legacy_status_matrix),true,
 'final locked confirmation accepts each unchanged current file-state receipt');
select is((select bool_and(observed#>'{permission,sources}'='[]'::jsonb
 and observed#>'{permission,fileCount}'='0'::jsonb and observed#>'{permission,preparing}'='false'::jsonb)
 from legacy_status_matrix),true,'ancestry-only permission capture exposes no file state or preparing signal');
update public.genome_files set status='stored' where id='79120000-0000-4000-8000-000000000041';
select is(pg_temp.confirm((select receipt->>'pageReceipt' from captured_share)),false,
 'an annotated-to-stored legacy transition invalidates the earlier result receipt');
rollback to legacy_status_matrix;

-- Assert after the final savepoint rollback: pgTAP's result sequence survives
-- rollback, while its current-test cache is transactional.
select is(pg_temp.shared(),(select receipt from captured_share),
 'all rollback-only probes restore the exact shared ancestry page and authority');

select * from finish();
rollback;
