-- Family ancestry shared authority: bounded, rollback-only production probe.
-- Every fixture row is synthetic, created under fresh random identities inside
-- one PL/pgSQL block whose final statement raises a sentinel so the block's
-- subtransaction is always rolled back. Observations live in local variables,
-- which survive that rollback. Residue is then verified to be zero before a
-- sanitized receipt is returned; any failed check raises instead of returning.
set local statement_timeout = '240s';
set local lock_timeout = '5s';
create temporary table probe_ids(owner_id uuid, owner_session uuid, recipient_id uuid, recipient_session uuid,
 outsider_id uuid, outsider_session uuid, subject_id uuid, file_id uuid, legacy_file_id uuid, object_id uuid);
create temporary table probe_receipt(receipt jsonb);
create function pg_temp.shared(mode text default 'content', after_file uuid default null) returns jsonb language sql as $h$
 select public.family_shared_ancestry_results_v1(i.recipient_id,i.recipient_session,i.subject_id,after_file,mode) from probe_ids i $h$;
create function pg_temp.confirm(receipt text, mode text default 'content') returns boolean language sql as $h$
 select public.confirm_family_shared_ancestry_results_v1(i.recipient_id,i.recipient_session,i.subject_id,mode,
  jsonb_build_array(jsonb_build_object('afterFile',null,'receipt',receipt))) from probe_ids i $h$;
create function pg_temp.presentation(recipient uuid default null) returns jsonb language sql as $h$
 select public.family_ancestry_grant_presentation_v1(i.owner_id,i.owner_session,i.subject_id,coalesce(recipient,i.recipient_id)) from probe_ids i $h$;
create function pg_temp.share(receipt text, nonce text, recipient uuid default null) returns uuid language sql as $h$
 select public.grant_family_ancestry_purpose_v1(i.owner_id,i.owner_session,i.subject_id,
  (select sp.id from public.subject_principals sp where sp.account_id=coalesce(recipient,i.recipient_id) and sp.principal_kind='account_subject' and sp.status='active'),
  coalesce(recipient,i.recipient_id),'ancestry',1,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,receipt) from probe_ids i $h$;
create function pg_temp.proof(g uuid) returns jsonb language sql as $h$
 select endpoints from private.family_ancestry_grant_snapshots where grant_id=g $h$;
create function pg_temp.err(q text) returns text language plpgsql as $h$
begin execute q; return 'no_error'; exception when others then return sqlstate||':'||sqlerrm; end $h$;
create function pg_temp.chk(n text, ok boolean, o text default null) returns jsonb language sql immutable as $h$
 select jsonb_build_array(jsonb_build_object('n',n,'ok',coalesce(ok,false),'o',left(o,200))) $h$;

do $probe$
declare
 i probe_ids%rowtype;
 prefix text := encode(extensions.gen_random_bytes(4),'hex');
 tag text := encode(extensions.gen_random_bytes(6),'hex');
 nonce_a text := encode(extensions.gen_random_bytes(32),'hex');
 nonce_b text := encode(extensions.gen_random_bytes(32),'hex');
 nonce_c text := encode(extensions.gen_random_bytes(32),'hex');
 nonce_d text := encode(extensions.gen_random_bytes(32),'hex');
 nonce_e text := encode(extensions.gen_random_bytes(32),'hex');
 own_version integer; own_sha text; share_sha text; disclosure_sha text; upload_sha text;
 prep jsonb; claim jsonb; payload jsonb; v1 jsonb; v2 jsonb; v3 jsonb;
 old_share uuid; shared_grant uuid; sibling_grant uuid; self_grant uuid;
 captured jsonb; permission_capture jsonb; legacy_capture jsonb; observed jsonb; tmp jsonb; matrix jsonb := '{}';
 proof_shared jsonb; proof_sibling jsonb; signed_before jsonb; old_prompt text;
 checks jsonb := '[]'; x text; b boolean; b2 boolean; b3 boolean; st public.genome_file_status; term text;
 t0 timestamptz := clock_timestamp(); t_inner_start timestamptz; inner_ms numeric := null;
 audit_seq_start bigint; side jsonb; residue jsonb; receipt jsonb; failed text[];
begin
 select coalesce(max(seq),0) into audit_seq_start from public.legal_audit_log;
 select version, body_sha256 into own_version, own_sha from public.consent_artifacts where artifact_key='consent.own-ancestry' and superseded_at is null;
 select body_sha256 into share_sha from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1;
 select body_sha256 into disclosure_sha from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1;
 select body_sha256 into upload_sha from public.consent_artifacts where artifact_key='consent.upload-self' and version=1;
 i.owner_id := gen_random_uuid(); i.owner_session := gen_random_uuid();
 i.recipient_id := gen_random_uuid(); i.recipient_session := gen_random_uuid();
 i.outsider_id := gen_random_uuid(); i.outsider_session := gen_random_uuid();
 i.object_id := gen_random_uuid();
 -- Deterministic ordering under a random prefix: canonical < legacy < 100 page files.
 i.file_id := (prefix||'-0000-4000-8000-000000000040')::uuid;
 i.legacy_file_id := (prefix||'-0000-4000-8000-000000000041')::uuid;
 t_inner_start := clock_timestamp();
 begin
  -- ===== Synthetic owner, session, adult profile, self subject =====
  insert into auth.users(id,email) values (i.owner_id,'family-probe-owner-'||tag||'@e2e.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values (i.owner_session,i.owner_id,now(),now(),'aal1');
  update public.profiles set date_of_birth=date '1990-01-01' where id=i.owner_id;
  select id into i.subject_id from public.subjects where subject_account_id=i.owner_id and subject_class='self';
  insert into probe_ids(owner_id,owner_session,recipient_id,recipient_session,outsider_id,outsider_session,subject_id,file_id,legacy_file_id,object_id)
   values (i.owner_id,i.owner_session,i.recipient_id,i.recipient_session,i.outsider_id,i.outsider_session,i.subject_id,i.file_id,i.legacy_file_id,i.object_id);
  -- ===== Actual upload consent, synthetic metadata-only source, real normalization writer =====
  insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at) values
   (nonce_a,i.owner_id,i.owner_session,'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'),
   (nonce_b,i.owner_id,i.owner_session,'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
  perform public.sign_own_upload_artifact_v1(i.owner_id,i.owner_session,i.subject_id,'disclosure.insurance-and-discrimination',1,disclosure_sha,array['understood'],1,1,1,1,1,nonce_a);
  perform public.sign_own_upload_artifact_v1(i.owner_id,i.owner_session,i.subject_id,'consent.upload-self',1,upload_sha,array['own-adult-dna'],1,1,1,1,1,nonce_b);
  insert into storage.objects(id,bucket_id,name,metadata) values (i.object_id,'genomes',i.object_id::text,'{"size":8}');
  insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
   upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
   values (i.file_id,i.owner_id,i.subject_id,i.object_id::text,'Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
   'single-logical-sample-v1',clock_timestamp(),repeat('b',64),i.object_id);
  insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
   values (i.object_id,i.object_id::text,'genomes',i.file_id,repeat('a',64),8,1,'current');
  prep := public.own_upload_normalization_v1('begin',i.owner_id,i.owner_session,i.file_id,null::uuid,null::jsonb);
  perform public.own_upload_normalization_v1('stage',i.owner_id,i.owner_session,i.file_id,(prep->>'claim')::uuid,
   '{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}'::jsonb);
  perform public.own_upload_normalization_v1('complete',i.owner_id,i.owner_session,i.file_id,(prep->>'claim')::uuid,
   jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,
    'provenance',jsonb_build_object('version','listed-calls-v1','sourceSha256',repeat('a',64),'sourceBuild','GRCh37','targetBuild','GRCh38','buildBasis','source-declared',
     'chainSha256',repeat('c',64),'variantRowsMapped',0,'variantRowsUnmapped',0,'attempted',1,
     'counts','{"called":1,"noCall":0,"unsupported":0,"failedFilter":0,"blocks":0,"singleSample":true,"buildClaim":true}'::jsonb)));
  -- ===== Owner ancestry purpose and a synthetic v3 capture through the real journal =====
  perform public.grant_own_report_purpose_v1(i.owner_id,i.owner_session,i.subject_id,
   public.own_report_context_v1(i.owner_id,i.owner_session,i.subject_id),'ancestry',own_version,own_sha,nonce_c,clock_timestamp()+interval '9 minutes');
  claim := public.own_report_generation_v1('begin',i.owner_id,i.owner_session,i.file_id,'ancestry',null::uuid,null::jsonb);
  payload := jsonb_build_object('ancestry',jsonb_build_object(
   'schemaVersion',1,'computationRevision','own-ancestry-content-v1',
   'source',jsonb_build_object('fileId',i.file_id,'subjectId',i.subject_id,'normalizedBuild','GRCh38','callEncoding','vcf-literal','sourceRevision',1,'sourceSha256',repeat('a',64),'normalizedAt',claim#>'{authorization,normalizedAt}'),
   'panel','{"id":"aims-kidd-seldin-168","version":"2026-08-28","provenance":"data/ref/AIMS_PROVENANCE.md","markerSha256":"e8109eedd184ab1fd3dedf9385357bd64ec166c3c3597e04d0213c1e1ed7064b","markerCount":168,"minimumMarkers":42}'::jsonb,
   'admixture','{"kind":"admixture","result":{"proportions":{"AFR":0.2,"AMR":0.2,"EAS":0.2,"EUR":0.2,"SAS":0.2},"markersUsed":0,"note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable."},"support_note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable.","model_id":"aims-kidd-seldin-168","model_version":"2026-08-28","coverage":0,"result_state":"not_covered","basis":"modelled","range":{"unavailable":true},"resolution":"five-broad-regions"}'::jsonb,
   'panelPositions','{"called":0,"missing":168,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0}'::jsonb,
   'lineages','[{"kind":"mtdna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0},{"kind":"ydna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0}]'::jsonb));
  v1 := payload->'ancestry';
  v3 := jsonb_set('{"schemaVersion":3,"computationRevision":"own-ancestry-content-v3","source":{"fileId":"78830000-0000-4000-8000-000000000001","subjectId":"78830000-0000-4000-8000-000000000002","normalizedBuild":"GRCh38","sourceRevision":1,"sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","callEncoding":"vcf-literal","normalizedAt":"2026-09-15T00:00:00Z"},"panel":{"id":"aims-hgdp-tgp-168","version":"hgdp-1kg-v3.1.2-cap30-168-v1","provenance":"data/ref/AIMS_SEVEN_REGION_PROVENANCE.md","markerSha256":"54279a25c01e72ed3c22caab0ffe778735a97fae8dffd0df498072a3f9857163","markerCount":168,"minimumMarkers":168},"admixture":{"kind":"admixture","result":{"proportions":null,"markersUsed":0,"note":"No usable ancestry markers were read. No region shares were computed.","fit":{"iterations":0,"converged":false},"reporting":{"policy":"merge-eur-mid-csa-v1","threshold":0.1,"merged":false,"caveat":"This panel cannot tell real mixed ancestry from its own errors between these regions. These shares may reflect either. It combines both, so people with mixed ancestry lose separate region detail more often."}},"support_note":"No usable ancestry markers were read. No region shares were computed.","model_id":"aims-hgdp-tgp-168","model_version":"hgdp-1kg-v3.1.2-cap30-168-v1","coverage":0,"result_state":"not_covered","basis":"modelled","range":{"unavailable":true},"resolution":"seven-regions-adaptive-v1"},"panelPositions":{"called":0,"missing":168,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0},"lineages":[{"kind":"mtdna","state":"unavailable","tree":{"id":"inherit-mtdna-curated-subset","version":"Build 17, Forensic Update 1a","sha256":"fb34d38ac78a900172a398e168b54b786711dbe662c12659db5fd09c6666efd1"},"markerPositions":106,"observedPositions":0,"readablePositions":0,"call":null,"reason":"no_supplied_positions"},{"kind":"ydna","state":"unavailable","tree":{"id":"inherit-ydna-curated-subset","version":"2016 index (4 January 2016)","sha256":"b5e956ec511dc3c4c3c40e38862c2e5af513be675cacead0b31469b174a168e3"},"markerPositions":31,"observedPositions":0,"readablePositions":0,"call":null,"reason":"no_supplied_positions"}]}'::jsonb,
   '{source}',payload#>'{ancestry,source}');
  v2 := jsonb_set(jsonb_set(jsonb_set(v1,'{schemaVersion}','2'::jsonb),'{computationRevision}','"own-ancestry-content-v2"'::jsonb),'{lineages}',v3->'lineages');
  observed := public.own_report_generation_v1('complete',i.owner_id,i.owner_session,i.file_id,'ancestry',(claim->>'claim')::uuid,jsonb_build_object('ancestry',v3));
  checks := checks || pg_temp.chk('synthetic v3 capture completes through the actual journal transaction', observed->>'status'='complete', observed->>'status');
  -- ===== Recipient and unrelated adult =====
  insert into auth.users(id,email,email_confirmed_at) values
   (i.recipient_id,'family-probe-recipient-'||tag||'@e2e.invalid',now()),
   (i.outsider_id,'family-probe-outsider-'||tag||'@e2e.invalid',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
   (i.recipient_session,i.recipient_id,now(),now(),'aal1'),(i.outsider_session,i.outsider_id,now(),now(),'aal1');
  update public.profiles set date_of_birth=date '1990-01-01' where id in (i.recipient_id,i.outsider_id);
  checks := checks || pg_temp.chk('browser cannot call service capture', has_function_privilege('authenticated','public.family_shared_ancestry_results_v1(uuid,uuid,uuid,uuid,text)','execute') is false);
  checks := checks || pg_temp.chk('anonymous caller cannot grant ancestry', has_function_privilege('anon','public.grant_family_ancestry_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text)','execute') is false);
  checks := checks || pg_temp.chk('service client cannot fabricate endpoint proof', has_table_privilege('service_role','private.family_ancestry_grant_snapshots','insert') is false);
  x := pg_temp.err('select pg_temp.shared()');
  checks := checks || pg_temp.chk('a completed owner result is not a Family permission', x='42501:not_found', x);
  -- ===== Historical directional grant without endpoint proof =====
  old_share := public.grant_directional_purpose_v1(i.owner_id,i.subject_id,
   (select sp.id from public.subject_principals sp where sp.account_id=i.recipient_id and sp.principal_kind='account_subject' and sp.status='active'),
   'ancestry','consent.share-with-adult',1,'ancestry-old-grant-nonce-'||tag);
  observed := pg_temp.shared();
  checks := checks || pg_temp.chk('historical ancestry grant has no fabricated endpoint proof', observed->>'legacyOnly'='true', observed->>'legacyOnly');
  checks := checks || pg_temp.chk('historical grant withholds ordinary canonical captures', observed->'sources'='[]'::jsonb, (observed->'sources')::text);
  checks := checks || pg_temp.chk('owner is explicitly offered a fresh confirmation', pg_temp.presentation()->>'requiresConfirmation'='true');
  insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
   values (i.legacy_file_id,i.owner_id,i.subject_id,'synthetic-legacy-ancestry-'||tag,'Synthetic legacy ancestry','vcf',1,8,'annotated');
  insert into public.ancestry_results(user_id,file_id,subject_id,kind,result,support_note,model_id,model_version)
   values (i.owner_id,i.legacy_file_id,i.subject_id,'admixture','{"proportions":{"EUR":1},"markersUsed":168}','Synthetic historical result','legacy-model','legacy-version');
  observed := pg_temp.shared();
  checks := checks || pg_temp.chk('historical permission can read an independently checked legacy result', observed#>>'{sources,0,kind}'='legacy', observed#>>'{sources,0,kind}');
  checks := checks || pg_temp.chk('legacy model metadata is preserved', observed#>>'{sources,0,rows,0,model_version}'='legacy-version');
  legacy_capture := observed;
  checks := checks || pg_temp.chk('legacy payload and source are covered by final confirmation', pg_temp.confirm(legacy_capture->>'pageReceipt') is true);
  begin
   update public.ancestry_results set support_note='Changed after read' where file_id=i.legacy_file_id;
   b := pg_temp.confirm(legacy_capture->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('same legacy file with changed result cannot reuse a receipt', b is false);
  -- ===== Fresh affirmative confirmation replaces the old grant =====
  shared_grant := pg_temp.share(pg_temp.presentation()->>'receipt','ancestry-new-grant-nonce-'||tag);
  checks := checks || pg_temp.chk('fresh confirmation replaces the old grant instead of blessing it', shared_grant<>old_share);
  checks := checks || pg_temp.chk('old grant is terminal', (select revoked_at is not null from public.purpose_grants where grant_id=old_share));
  checks := checks || pg_temp.chk('confirmed current endpoints need no further prompt', pg_temp.presentation()->>'requiresConfirmation'='false');
  x := pg_temp.err(format('select pg_temp.share(pg_temp.presentation()->>''receipt'',%L)','ancestry-new-grant-nonce-'||tag));
  checks := checks || pg_temp.chk('a fresh confirmation cannot replay its nonce', x='23505:presentation nonce already used', x);
  observed := pg_temp.shared();
  checks := checks || pg_temp.chk('fresh grant permits current canonical sources', observed->>'legacyOnly'='false');
  checks := checks || pg_temp.chk('separate canonical and legacy results both survive', jsonb_array_length(observed->'sources')=2, jsonb_array_length(observed->'sources')::text);
  checks := checks || pg_temp.chk('v3 capture is returned as stored', observed#>>'{sources,0,content,schemaVersion}'='3', observed#>>'{sources,0,content,schemaVersion}');
  checks := checks || pg_temp.chk('authorized captured provenance keeps source-build attribution', observed#>>'{sources,0,source,snapshot,sourceBuild}'='GRCh37');
  checks := checks || pg_temp.chk('normalization target remains separate', observed#>>'{sources,0,source,snapshot,targetBuild}'='GRCh38');
  checks := checks || pg_temp.chk('wire result excludes raw storage and calls', observed::text !~ 'bucket_path|original_name|source_gt|objectKey|ancestry_source');
  captured := observed;
  permission_capture := pg_temp.shared('permission');
  checks := checks || pg_temp.chk('final locked capture confirms all current sources', pg_temp.confirm(captured->>'pageReceipt') is true);
  checks := checks || pg_temp.chk('ancestry-only link reads no source or result', permission_capture->'sources'='[]'::jsonb);
  checks := checks || pg_temp.chk('permission capture has no source count', permission_capture->>'fileCount'='0');
  checks := checks || pg_temp.chk('ancestry-only link has current recipient confirmation', pg_temp.confirm(permission_capture->>'pageReceipt','permission') is true);
  -- ===== Sessions =====
  begin
   delete from auth.sessions where id=i.owner_session;
   observed := pg_temp.shared(); b := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('owner need not stay logged in for the recipient', jsonb_array_length(observed->'sources')=2);
  checks := checks || pg_temp.chk('owner logout does not change source authority', b is true);
  begin
   delete from auth.sessions where id=i.recipient_session;
   x := pg_temp.err('select pg_temp.shared()'); b := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('recipient session must remain live', x='42501:not_found', x);
  checks := checks || pg_temp.chk('session loss withholds a captured result', b is false);
  -- ===== Withdrawals and pause =====
  select pg.grant_id into self_grant from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
   where pg.target_id=i.subject_id and pg.purpose='ancestry' and pg.revoked_at is null and dg.direction='self' and dg.status='current';
  begin
   perform public.revoke_directional_purpose_v1(i.owner_id,self_grant);
   observed := pg_temp.shared(); b := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('owner-purpose withdrawal withholds legacy and canonical ancestry', observed->'sources'='[]'::jsonb, (observed->'sources')::text);
  checks := checks || pg_temp.chk('owner-purpose withdrawal invalidates captured source and provenance', b is false);
  begin
   perform public.revoke_directional_purpose_v1(i.owner_id,shared_grant);
   x := pg_temp.err('select pg_temp.shared()');
   b := pg_temp.confirm(permission_capture->>'pageReceipt','permission');
   b2 := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('directional withdrawal denies content', x='42501:not_found', x);
  checks := checks || pg_temp.chk('directional withdrawal removes the ancestry-only link', b is false);
  checks := checks || pg_temp.chk('directional withdrawal removes previously captured results', b2 is false);
  begin
   perform public.pause_family_sharing_v1(i.recipient_id,i.owner_id);
   x := pg_temp.err('select pg_temp.shared()'); b := pg_temp.confirm(permission_capture->>'pageReceipt','permission');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('either side can pause the shared result', x='42501:not_found', x);
  checks := checks || pg_temp.chk('pause removes the ancestry-only link', b is false);
  -- ===== Source drift and immutability =====
  begin
   x := pg_temp.err(format('update public.genome_files set upload_revision=upload_revision+1 where id=%L',i.file_id));
   update public.genome_files set upload_revision=upload_revision+1, normalization_source_revision=normalization_source_revision+1 where id=i.file_id;
   observed := pg_temp.shared(); b := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('a partial source revision change is rejected before shared-reader validation', x like '23514:%normalization_source_completion%', x);
  checks := checks || pg_temp.chk('source drift preserves independently valid legacy sibling', jsonb_array_length(observed->'sources')=1, jsonb_array_length(observed->'sources')::text);
  checks := checks || pg_temp.chk('a valid sibling cannot mask earlier source drift', b is false);
  x := pg_temp.err(format('update private.own_analysis_runs set result=%L::jsonb where file_id=%L', jsonb_build_object('ancestry',v1)::text, i.file_id));
  checks := checks || pg_temp.chk('completed ancestry remains immutable during historical reader verification', x='55000:completed_report_is_immutable', x);
  -- ===== Historical v1 and v2 captures through the real lifecycle =====
  begin
   perform public.revoke_directional_purpose_v1(i.owner_id,(select pg.grant_id from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
     where pg.target_id=i.subject_id and pg.purpose='ancestry' and pg.revoked_at is null and dg.direction='self' and dg.status='current'));
   perform public.grant_own_report_purpose_v1(i.owner_id,i.owner_session,i.subject_id,public.own_report_context_v1(i.owner_id,i.owner_session,i.subject_id),'ancestry',own_version,own_sha,nonce_d,clock_timestamp()+interval '9 minutes');
   claim := public.own_report_generation_v1('begin',i.owner_id,i.owner_session,i.file_id,'ancestry',null::uuid,null::jsonb);
   tmp := public.own_report_generation_v1('complete',i.owner_id,i.owner_session,i.file_id,'ancestry',(claim->>'claim')::uuid,jsonb_build_object('ancestry',v1));
   x := tmp->>'status';
   observed := pg_temp.shared(); b := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('historical v1 completes through a fresh authorized journal', x='complete', x);
  checks := checks || pg_temp.chk('historical v1 stays readable without recomputation', observed#>>'{sources,0,content,schemaVersion}'='1', observed#>>'{sources,0,content,schemaVersion}');
  checks := checks || pg_temp.chk('same file changed to a different capture invalidates old receipt', b is false);
  begin
   perform public.revoke_directional_purpose_v1(i.owner_id,(select pg.grant_id from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id and dg.grant_revision=pg.grant_revision
     where pg.target_id=i.subject_id and pg.purpose='ancestry' and pg.revoked_at is null and dg.direction='self' and dg.status='current'));
   perform public.grant_own_report_purpose_v1(i.owner_id,i.owner_session,i.subject_id,public.own_report_context_v1(i.owner_id,i.owner_session,i.subject_id),'ancestry',own_version,own_sha,nonce_e,clock_timestamp()+interval '9 minutes');
   claim := public.own_report_generation_v1('begin',i.owner_id,i.owner_session,i.file_id,'ancestry',null::uuid,null::jsonb);
   tmp := public.own_report_generation_v1('complete',i.owner_id,i.owner_session,i.file_id,'ancestry',(claim->>'claim')::uuid,jsonb_build_object('ancestry',v2));
   x := tmp->>'status';
   observed := pg_temp.shared();
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('historical v2 completes through a fresh authorized journal', x='complete', x);
  checks := checks || pg_temp.chk('historical v2 lineages stay readable', observed#>>'{sources,0,content,schemaVersion}'='2', observed#>>'{sources,0,content,schemaVersion}');
  -- ===== Stale recipient binding =====
  begin
   old_prompt := pg_temp.presentation()->>'receipt';
   update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id=i.recipient_id and status='current';
   x := pg_temp.err(format('select pg_temp.share(%L,%L)',old_prompt,'ancestry-stale-prompt-nonce-'||tag));
   b := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('same-ID changed recipient binding rejects stale confirmation', x='42501:not_found', x);
  checks := checks || pg_temp.chk('changed recipient binding denies previously captured content', b is false);
  -- ===== Unrelated recipient, invalid mode, exact statement keys =====
  x := pg_temp.err(format('select public.family_shared_ancestry_results_v1(%L,%L,%L)',i.outsider_id,i.outsider_session,i.subject_id));
  checks := checks || pg_temp.chk('unrelated recipient cannot use the same source', x='42501:not_found', x);
  x := pg_temp.err('select pg_temp.shared(''unknown'')');
  checks := checks || pg_temp.chk('unknown projection mode refuses', x='22023:invalid_request', x);
  checks := checks || pg_temp.chk('fresh proof retains the exact approved statement keys',
   (select cs.statement_keys from public.consent_signatures cs join public.purpose_grants pg on pg.signature_id=cs.id where pg.grant_id=shared_grant)
    = array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time']);
  -- ===== Prepared source is explicitly unavailable =====
  begin
   insert into private.own_preparation_jobs(file_id,account_id,subject_id,session_id,authority,source,created_at,job_deadline,cleanup_deadline)
    select i.file_id,i.owner_id,i.subject_id,i.owner_session,'{}','{}',stamp.t,stamp.t+interval '10 minutes',stamp.t+interval '2 hours' from (select clock_timestamp() t) stamp;
   observed := pg_temp.shared(); b := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('an active prepared job is explicitly unavailable for Family ancestry', observed->>'preparedUnavailable'='true', observed->>'preparedUnavailable');
  checks := checks || pg_temp.chk('prepared identity cannot fall back to the older DB-normalized capture', jsonb_array_length(observed->'sources')=1);
  checks := checks || pg_temp.chk('prepared transition invalidates previously captured DB result', b is false);
  -- ===== Pagination: 100 further empty legacy files =====
  begin
   insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
    select (prefix||'-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,i.owner_id,i.subject_id,'synthetic-page-'||tag||'-'||n,'Synthetic empty legacy file','vcf',1,8,'annotated' from generate_series(1,100) n;
   observed := pg_temp.shared();
   tmp := pg_temp.shared('content',(observed->>'nextAfter')::uuid);
   x := (observed->>'fileCount')||'/'||(tmp->>'fileCount');
   b := pg_temp.confirm(observed->>'pageReceipt');
   b2 := public.confirm_family_shared_ancestry_results_v1(i.recipient_id,i.recipient_session,i.subject_id,'content',
     jsonb_build_array(jsonb_build_object('afterFile',null,'receipt',observed->>'pageReceipt'),jsonb_build_object('afterFile',observed->'nextAfter','receipt',tmp->>'pageReceipt')));
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('first page is bounded at 100 sources', split_part(x,'/',1)='100', x);
  checks := checks || pg_temp.chk('terminal page preserves remaining authorized source count', split_part(x,'/',2)='2', x);
  checks := checks || pg_temp.chk('a nonterminal first page alone cannot confirm', b is false);
  checks := checks || pg_temp.chk('one locked operation confirms the complete cursor chain including an empty result page', b2 is true);
  -- ===== Operational proof lifecycle with an unrelated sibling direction =====
  sibling_grant := pg_temp.share(pg_temp.presentation(i.outsider_id)->>'receipt','ancestry-sibling-proof-nonce-'||tag,i.outsider_id);
  proof_shared := pg_temp.proof(shared_grant); proof_sibling := pg_temp.proof(sibling_grant);
  select to_jsonb(cs) into signed_before from public.consent_signatures cs join public.purpose_grants pg on pg.signature_id=cs.id where pg.grant_id=shared_grant;
  checks := checks || pg_temp.chk('two current independently signed directions each hold operational proof',
   proof_shared is not null and proof_sibling is not null and (select count(*) from private.family_ancestry_grant_snapshots where grant_id in (shared_grant,sibling_grant))=2);
  checks := checks || pg_temp.chk('service clients cannot invoke the cleanup helper', has_function_privilege('service_role','private.clear_family_ancestry_snapshot_v1()','execute') is false);
  checks := checks || pg_temp.chk('browser roles cannot invoke the cleanup helper', has_function_privilege('authenticated','private.clear_family_ancestry_snapshot_v1()','execute') is false);
  checks := checks || pg_temp.chk('service clients cannot delete endpoint proof directly', has_table_privilege('service_role','private.family_ancestry_grant_snapshots','delete') is false);
  begin
   update public.purpose_grants set grant_revision=grant_revision where grant_id=shared_grant;
   update public.directional_grants set status=status,grant_revision=grant_revision where grant_id=shared_grant;
   b := pg_temp.proof(shared_grant)=proof_shared;
   perform public.pause_family_sharing_v1(i.recipient_id,i.owner_id);
   b2 := pg_temp.proof(shared_grant)=proof_shared;
   perform public.resume_family_sharing_v1(i.recipient_id,i.owner_id);
   b3 := pg_temp.proof(shared_grant)=proof_shared;
   x := pg_temp.shared()->>'legacyOnly';
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('unchanged current grant writes retain exact endpoint proof', b);
  checks := checks || pg_temp.chk('pause preserves proof without terminalizing the grant', b2);
  checks := checks || pg_temp.chk('resume uses the same exact proof', b3);
  checks := checks || pg_temp.chk('resume retains canonical access without a new signature', x='false', x);
  begin
   perform public.revoke_directional_purpose_v1(i.owner_id,shared_grant);
   b := pg_temp.proof(shared_grant) is null;
   b2 := pg_temp.proof(sibling_grant)=proof_sibling;
   b3 := (select to_jsonb(cs) from public.consent_signatures cs join public.purpose_grants pg on pg.signature_id=cs.id where pg.grant_id=shared_grant)=signed_before;
   x := (exists(select 1 from public.purpose_grants where grant_id=shared_grant and revoked_at is not null))::text;
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('actual grant withdrawal atomically removes obsolete ancestry endpoint JSON', b);
  checks := checks || pg_temp.chk('withdrawal preserves the unrelated recipient proof byte for byte', b2);
  checks := checks || pg_temp.chk('withdrawal retains the exact signed consent history', b3);
  checks := checks || pg_temp.chk('cleanup retains the terminal parent grant', x='true', x);
  begin
   update public.purpose_grants set grant_revision=grant_revision+1 where grant_id=shared_grant;
   b := pg_temp.proof(shared_grant) is null;
   update public.directional_grants set grant_revision=grant_revision+1 where grant_id=shared_grant;
   set constraints purpose_grants_pair_check, directional_grants_pair_check immediate;
   b2 := pg_temp.proof(sibling_grant)=proof_sibling;
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('base revision change removes old proof in that statement', b);
  checks := checks || pg_temp.chk('paired base revision transition preserves unrelated proof', b2);
  begin
   update public.directional_grants set grant_revision=grant_revision+1 where grant_id=shared_grant;
   b := pg_temp.proof(shared_grant) is null;
   update public.purpose_grants set grant_revision=grant_revision+1 where grant_id=shared_grant;
   set constraints purpose_grants_pair_check, directional_grants_pair_check immediate;
   b2 := pg_temp.proof(sibling_grant)=proof_sibling;
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('direction revision change independently removes old proof', b);
  checks := checks || pg_temp.chk('paired direction revision transition preserves unrelated proof', b2);
  foreach term in array array['revoked','superseded','expired'] loop
   begin
    update public.directional_grants set status=term,ended_at=clock_timestamp() where grant_id=shared_grant;
    b := pg_temp.proof(shared_grant) is null;
    update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='lifecycle-test' where grant_id=shared_grant;
    set constraints purpose_grants_pair_check, directional_grants_pair_check immediate;
    b2 := pg_temp.proof(sibling_grant)=proof_sibling;
    raise exception using errcode='PRB01', message='rollback_only';
   exception when sqlstate 'PRB01' then null; end;
   checks := checks || pg_temp.chk('direction '||term||' removes ancestry proof before any base update', b);
   checks := checks || pg_temp.chk('direction '||term||' cleanup leaves unrelated proof intact', b2);
  end loop;
  begin
   delete from public.purpose_grant_nonces where grant_id=shared_grant;
   delete from public.purpose_grants where grant_id=shared_grant;
   b := pg_temp.proof(shared_grant) is null;
   delete from public.directional_grants where grant_id=shared_grant;
   set constraints purpose_grants_pair_check, directional_grants_pair_check immediate;
   b2 := pg_temp.proof(sibling_grant)=proof_sibling;
   b3 := (select to_jsonb(cs) from public.consent_signatures cs where cs.id=(signed_before->>'id')::uuid)=signed_before;
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('registered parent deletion cascades to only its operational proof', b);
  checks := checks || pg_temp.chk('parent cascade preserves unrelated ancestry proof', b2);
  checks := checks || pg_temp.chk('operational-child deletion does not erase separately retained signed history', b3);
  begin
   delete from public.directional_grants where grant_id=shared_grant;
   b := pg_temp.proof(shared_grant) is null;
   delete from public.purpose_grant_nonces where grant_id=shared_grant;
   delete from public.purpose_grants where grant_id=shared_grant;
   set constraints purpose_grants_pair_check, directional_grants_pair_check immediate;
   b2 := pg_temp.proof(sibling_grant)=proof_sibling;
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('direction deletion removes its proof before parent deletion', b);
  checks := checks || pg_temp.chk('direction deletion preserves unrelated ancestry proof', b2);
  -- ===== Every real file status with a stale legacy result still present =====
  begin
   for st in select unnest(enum_range(null::public.genome_file_status)) loop
    update public.genome_files set status=st where id=i.legacy_file_id;
    observed := pg_temp.shared();
    tmp := pg_temp.shared('permission');
    matrix := matrix || jsonb_build_object(st::text, jsonb_build_object('preparing',observed->'preparing','fileCount',observed->'fileCount',
     'sources',jsonb_array_length(observed->'sources'),'sibling',observed#>'{sources,0}'=captured#>'{sources,0}',
     'confirmed',pg_temp.confirm(observed->>'pageReceipt'),
     'permission',(tmp->'sources'='[]'::jsonb and tmp->'fileCount'='0'::jsonb and tmp->'preparing'='false'::jsonb)));
   end loop;
   update public.genome_files set status='stored' where id=i.legacy_file_id;
   b := pg_temp.confirm(captured->>'pageReceipt');
   raise exception using errcode='PRB01', message='rollback_only';
  exception when sqlstate 'PRB01' then null; end;
  checks := checks || pg_temp.chk('legacy preparing matches the four actual in-flight states; stored and failed promise no processing',
   (select jsonb_object_agg(k,v->'preparing') from jsonb_each(matrix) e(k,v))='{"uploading":true,"uploaded":true,"parsing":true,"parsed":true,"annotated":false,"failed":false,"stored":false}'::jsonb,
   (select jsonb_object_agg(k,v->'preparing') from jsonb_each(matrix) e(k,v))::text);
  checks := checks || pg_temp.chk('each non-failed legacy state counts its source while failed stays excluded',
   (select jsonb_object_agg(k,v->'fileCount') from jsonb_each(matrix) e(k,v))='{"uploading":2,"uploaded":2,"parsing":2,"parsed":2,"annotated":2,"failed":1,"stored":2}'::jsonb,
   (select jsonb_object_agg(k,v->'fileCount') from jsonb_each(matrix) e(k,v))::text);
  checks := checks || pg_temp.chk('only annotated legacy files expose saved ancestry; other states withhold stale rows',
   (select jsonb_object_agg(k,v->'sources') from jsonb_each(matrix) e(k,v))='{"uploading":1,"uploaded":1,"parsing":1,"parsed":1,"annotated":2,"failed":1,"stored":1}'::jsonb,
   (select jsonb_object_agg(k,v->'sources') from jsonb_each(matrix) e(k,v))::text);
  checks := checks || pg_temp.chk('every legacy state preserves the exact independently authorized canonical sibling', (select bool_and((v->>'sibling')::boolean) from jsonb_each(matrix) e(k,v)));
  checks := checks || pg_temp.chk('final locked confirmation accepts each unchanged current file-state receipt', (select bool_and((v->>'confirmed')::boolean) from jsonb_each(matrix) e(k,v)));
  checks := checks || pg_temp.chk('ancestry-only permission capture exposes no file state or preparing signal', (select bool_and((v->>'permission')::boolean) from jsonb_each(matrix) e(k,v)));
  checks := checks || pg_temp.chk('an annotated-to-stored legacy transition invalidates the earlier result receipt', b is false);
  -- ===== Exact restoration after every nested rollback =====
  observed := pg_temp.shared();
  checks := checks || pg_temp.chk('all rollback-only probes restore the exact shared ancestry page and authority', observed=captured);
  -- ===== Side effects reached inside the transaction, observed before it is discarded =====
  side := jsonb_build_object(
   'mailOutboxRowsForFixtureTargets', (select count(*) from public.mail_outbox m where m.target_id in (i.subject_id,i.owner_id,i.recipient_id,i.outsider_id)
     or m.recipient_principal_id in (select id from public.subject_principals where account_id in (i.owner_id,i.recipient_id,i.outsider_id))),
   'workerJobsForFixtureAccounts', (select count(*) from public.worker_jobs where user_id in (i.owner_id,i.recipient_id,i.outsider_id)),
   'legalAuditRowsAppendedSinceStart', (select count(*) from public.legal_audit_log where seq>audit_seq_start),
   'sharingPauseRowsForFixtureAccounts', (select count(*) from public.family_sharing_pauses where account_low_id in (i.owner_id,i.recipient_id,i.outsider_id) or account_high_id in (i.owner_id,i.recipient_id,i.outsider_id)),
   'snapshotRowsForFixtureGrants', (select count(*) from private.family_ancestry_grant_snapshots where grant_id in (old_share,shared_grant,sibling_grant)),
   'genomeFilesForFixtureSubject', (select count(*) from public.genome_files where subject_id=i.subject_id),
   'storageObjectRows', (select count(*) from storage.objects where id=i.object_id));
  inner_ms := extract(epoch from clock_timestamp()-t_inner_start)*1000;
  raise exception using errcode='PRB00', message='rollback_only';
 exception when sqlstate 'PRB00' then null;
 end;
 -- ===== Residue must be zero for every fixture key =====
 residue := jsonb_build_object(
  'authUsers', (select count(*) from auth.users where id in (i.owner_id,i.recipient_id,i.outsider_id)),
  'authSessions', (select count(*) from auth.sessions where id in (i.owner_session,i.recipient_session,i.outsider_session)),
  'profiles', (select count(*) from public.profiles where id in (i.owner_id,i.recipient_id,i.outsider_id)),
  'subjects', (select count(*) from public.subjects where subject_account_id in (i.owner_id,i.recipient_id,i.outsider_id) or id=i.subject_id),
  'subjectPrincipals', (select count(*) from public.subject_principals where account_id in (i.owner_id,i.recipient_id,i.outsider_id)),
  'genomeFiles', (select count(*) from public.genome_files where id in (i.file_id,i.legacy_file_id) or user_id=i.owner_id or subject_id=i.subject_id),
  'storageObjects', (select count(*) from storage.objects where id=i.object_id or name=i.object_id::text),
  'genomeStorageObjects', (select count(*) from public.genome_storage_objects where object_id=i.object_id),
  'purposeGrants', (select count(*) from public.purpose_grants where target_id=i.subject_id or grant_id in (old_share,shared_grant,sibling_grant,self_grant)),
  'directionalGrants', (select count(*) from public.directional_grants where recipient_account_id in (i.owner_id,i.recipient_id,i.outsider_id)),
  'snapshots', (select count(*) from private.family_ancestry_grant_snapshots where grant_id in (old_share,shared_grant,sibling_grant)),
  'relationships', (select count(*) from public.subject_relationships where subject_id=i.subject_id or recipient_account_id in (i.recipient_id,i.outsider_id)),
  'consentSignatures', (select count(*) from public.consent_signatures where signer_account_id in (i.owner_id,i.recipient_id,i.outsider_id) or target_id=i.subject_id),
  'ancestryResults', (select count(*) from public.ancestry_results where user_id=i.owner_id or subject_id=i.subject_id),
  'ownAnalysisRuns', (select count(*) from private.own_analysis_runs where account_id=i.owner_id or file_id=i.file_id),
  'ownNormalizationRuns', (select count(*) from private.own_normalization_runs where file_id=i.file_id),
  'ownPreparationJobs', (select count(*) from private.own_preparation_jobs where file_id=i.file_id),
  'operationNonces', (select count(*) from public.account_operation_nonces where account_id=i.owner_id or nonce_hash in (nonce_a,nonce_b)),
  'grantNonces', (select count(*) from public.purpose_grant_nonces where account_id in (i.owner_id,i.recipient_id,i.outsider_id)),
  'mailOutbox', (select count(*) from public.mail_outbox m where m.target_id in (i.subject_id,i.owner_id,i.recipient_id,i.outsider_id)),
  'workerJobs', (select count(*) from public.worker_jobs where user_id in (i.owner_id,i.recipient_id,i.outsider_id)),
  'sharingPauses', (select count(*) from public.family_sharing_pauses where account_low_id in (i.owner_id,i.recipient_id,i.outsider_id) or account_high_id in (i.owner_id,i.recipient_id,i.outsider_id)));
 if exists(select 1 from jsonb_each(residue) e(k,v) where v<>'0'::jsonb) then
  raise exception 'fixture residue detected after rollback: %', residue::text; end if;
 select array_agg(c->>'n'||' => '||coalesce(c->>'o','(no observation)')) into failed from jsonb_array_elements(checks) c where not (c->>'ok')::boolean;
 receipt := jsonb_build_object(
  'kind','family-ancestry-shared-authority production rollback-only probe',
  'observedAt',t0,'elapsedMs',round(extract(epoch from clock_timestamp()-t0)*1000),'innerTransactionMs',round(inner_ms),
  'checks',jsonb_array_length(checks),'passed',(select count(*) from jsonb_array_elements(checks) c where (c->>'ok')::boolean),
  'failed',coalesce(to_jsonb(failed),'[]'::jsonb),
  'observedBeforeRollback',side,'residueAfterRollback',residue,
  'concurrentLegalAuditRowsSinceStart',(select count(*) from public.legal_audit_log where seq>audit_seq_start),
  'catalog',jsonb_build_object(
   'migrationVersion',(select version from supabase_migrations.schema_migrations where name='family_ancestry_shared_authority'),
   'functionMetadataMd5',(select md5(string_agg(ns.nspname||'.'||p.proname||':'||md5(p.prosrc)||':'||p.prosecdef::text||':'||coalesce(array_to_string(p.proconfig,';'),''),',' order by (ns.nspname||'.'||p.proname) collate "C"))
     from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where (ns.nspname,p.proname) in (('private','grant_family_ancestry_purpose_v1'),('private','family_ancestry_recipient_v1'),('private','family_source_ancestry_grant_v1'),
      ('private','family_source_ancestry_authority_v1'),('private','family_ancestry_grant_presentation_v1'),('private','family_ancestry_input_view_v1'),('private','family_shared_ancestry_results_v1'),
      ('private','confirm_family_shared_ancestry_results_v1'),('public','family_ancestry_grant_presentation_v1'),('public','grant_family_ancestry_purpose_v1'),('public','family_shared_ancestry_results_v1'),
      ('public','confirm_family_shared_ancestry_results_v1'),('private','clear_family_ancestry_snapshot_v1'))),
   'triggerMetadataMd5',(select md5(string_agg(t.tgname||':'||t.tgenabled::text||':'||md5(pg_get_triggerdef(t.oid)),',' order by t.tgname collate "C")) from pg_trigger t where t.tgname like 'clear_family_ancestry_snapshot%')),
  'effectiveTimeouts',jsonb_build_object('statement',current_setting('statement_timeout'),'lock',current_setting('lock_timeout')),
  'checkList',checks,
  'limits',jsonb_build_array('No browser evidence.','No provider bytes were uploaded, read or deleted; storage was synthetic metadata only.',
   'No Auth API sign-up or email delivery; identities were synthetic rows.','Mail and worker rows were observed only as uncommitted database rows.',
   'Time-only grant expiry cleanup is not exercised.','Concurrent audit rows are counted, not attributed.'));
 insert into probe_receipt values (receipt);
 if array_length(failed,1)>0 then raise exception 'probe checks failed: %', array_to_string(failed,' | '); end if;
end $probe$;
select jsonb_pretty(receipt) as probe_receipt from probe_receipt;
