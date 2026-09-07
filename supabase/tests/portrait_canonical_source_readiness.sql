begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,maximum_account_bytes,maximum_active_uploads)
values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
create function pg_temp.pid(n integer) returns uuid language sql immutable as $$ select ('79610000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.sid(n integer) returns uuid language sql as $$ select id from public.subjects where subject_account_id=pg_temp.pid(n) and subject_class='self'; $$;
create function pg_temp.principal(n integer) returns uuid language sql as $$ select id from public.subject_principals where subject_id=pg_temp.sid(n) and account_id=pg_temp.pid(n) and principal_kind='account_subject' and status='active'; $$;
-- Real signing and normalization transitions over rollback-only synthetic
-- object metadata. No result, genotype, ROH, or grant is manufactured.
do $$ declare n integer; artifact text; nonce text; claim uuid; begin
 for n in 1..3 loop
  insert into auth.users(id,email,email_confirmed_at) values(pg_temp.pid(n),'portrait-ready-'||n||'@e2e.local',now());
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
create function pg_temp.presentation(n integer) returns text language sql as $$ select public.family_portrait_grant_presentation_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.pid(3-n)); $$;
create function pg_temp.grant_portrait(n integer,receipt text,nonce text) returns uuid language sql as $$
 select public.grant_family_portrait_purpose_v1(pg_temp.pid(n),pg_temp.pid(n+10),pg_temp.sid(n),pg_temp.principal(3-n),pg_temp.pid(3-n),'family.portrait',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,receipt); $$;
create function pg_temp.pair() returns uuid language sql as $$ select id from public.family_pairs where subject_low_id=least(pg_temp.sid(1),pg_temp.sid(2)) and subject_high_id=greatest(pg_temp.sid(1),pg_temp.sid(2)); $$;
create function pg_temp.ready(expected text default null) returns jsonb language sql as $$
 select public.family_portrait_source_readiness_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pair(),pg_temp.pid(2),expected); $$;
create temporary table captured_tokens as select 1 n,pg_temp.presentation(1) token union all select 2,pg_temp.presentation(2);
grant all on captured_tokens to service_role;
set local role service_role;
select ok(pg_temp.ready() is null,'no pair grant creates no readiness authority');
savepoint stale_presentation;
update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id=pg_temp.pid(2);
select throws_ok($$select pg_temp.grant_portrait(1,(select token from captured_tokens where n=1),'stale-portrait-presentation')$$,'42501','not_found','recipient rebind after presentation refuses before granting');
select is((select count(*) from public.purpose_grants where purpose='family.portrait' and target_id in(pg_temp.sid(1),pg_temp.sid(2))),0::bigint,'stale presentation writes no grant');
rollback to stale_presentation;
-- Historical grants still have their original coarse legacy authority only.
select public.grant_directional_purpose_v1(pg_temp.pid(1),pg_temp.sid(1),pg_temp.principal(2),'family.portrait','consent.share-with-adult',1,'portrait-historical-a');
select public.grant_directional_purpose_v1(pg_temp.pid(2),pg_temp.sid(2),pg_temp.principal(1),'family.portrait','consent.share-with-adult',1,'portrait-historical-b');
select public.acknowledge_portrait_v1(pg_temp.pid(1),pg_temp.sid(1));
select public.acknowledge_portrait_v1(pg_temp.pid(2),pg_temp.sid(2));
select is(pg_temp.ready()->>'kind','legacy-only','historical grants are not upgraded by a new reader');
select is(pg_temp.ready()#>>'{a,hasPreparedSource}','false','historical authority never exposes canonical source readiness');
create temporary table grants as select 1 n,pg_temp.grant_portrait(1,pg_temp.presentation(1),'portrait-current-a') grant_id;
select is(pg_temp.ready()->>'kind','legacy-only','one new grant does not upgrade the other direction');
insert into grants values(2,pg_temp.grant_portrait(2,pg_temp.presentation(2),'portrait-current-b'));
create temporary table capture as select pg_temp.ready() value;
select is((select value->>'kind' from capture),'canonical','two explicitly reaffirmed exact endpoint grants allow canonical readiness');
select is((select value#>>'{a,hasPreparedSource}' from capture),'true','first exact prepared source is present');
select is((select value#>>'{b,hasPreparedSource}' from capture),'true','second exact prepared source is present');
select ok((select value::text !~ 'genotype|score|sha256|manifest|object|interpretation|roh|catalog' from capture),'closed result contains metadata booleans only, not source or genetic payload');
select is(pg_temp.ready((select value->>'receipt' from capture)),(select value from capture),'terminal receipt recheck returns the identical closed metadata');
select is((select count(*) from public.portrait_results where family_pair_id=pg_temp.pair()),0::bigint,'readiness creates no Portrait result');
select is((select count(*) from public.purpose_grants where target_id in(pg_temp.sid(1),pg_temp.sid(2)) and purpose like 'reports.%'),0::bigint,'metadata readiness does not fabricate or require unrelated report-purpose grants');
select ok(public.family_portrait_source_readiness_v1(pg_temp.pid(3),pg_temp.pid(13),pg_temp.pair(),pg_temp.pid(1)) is null,'foreign viewer is denied');
select ok(public.family_portrait_source_readiness_v1(pg_temp.pid(1),pg_temp.pid(11),pg_temp.pair(),pg_temp.pid(3)) is null,'wrong counterpart expectation is denied');
savepoint source_change;
update public.genome_files set status='failed' where id=pg_temp.pid(41);
select ok(pg_temp.ready((select value->>'receipt' from capture)) is null,'source failure invalidates the captured readiness before serialization');
rollback to source_change;
savepoint store_withdrawal;
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn' where account_id=pg_temp.pid(2) and consent_type='upload_class';
select ok(pg_temp.ready((select value->>'receipt' from capture)) is null,'current store consent withdrawal on the other source denies');
rollback to store_withdrawal;
savepoint session_end;
reset role;
delete from auth.sessions where id=pg_temp.pid(11);
set local role service_role;
select ok(pg_temp.ready((select value->>'receipt' from capture)) is null,'viewer logout denies a captured ready pair');
rollback to session_end;
savepoint pair_change;
update public.family_pairs set pair_revision=pair_revision+1 where id=pg_temp.pair();
select ok(pg_temp.ready() is null,'same-ID pair revision change invalidates exact grants');
rollback to pair_change;
savepoint recipient_change;
update public.subject_account_bindings set binding_revision=binding_revision+1 where account_id=pg_temp.pid(2);
select ok(pg_temp.ready() is null,'same-ID endpoint rebind denies strong grants');
rollback to recipient_change;
savepoint sharing_pause;
select public.pause_family_sharing_v1(pg_temp.pid(1),pg_temp.pid(2));
select ok(pg_temp.ready() is null,'sharing pause denies both source readiness bits');
rollback to sharing_pause;
-- Actual UI off/on order, rather than the wrapper's historical replacement:
-- each off uses the public revoke route's RPC; each on gets a fresh presentation.
savepoint reaffirmation_cycle;
create temporary table pair_before as select pair_revision from public.family_pairs where id=pg_temp.pair();
select public.revoke_directional_purpose_v1(pg_temp.pid(1),(select grant_id from grants where n=1));
select is((select pair_revision from public.family_pairs where id=pg_temp.pair()),(select pair_revision from pair_before),'first participant turning off preserves pair revision');
select pg_temp.grant_portrait(1,pg_temp.presentation(1),'portrait-off-on-a');
select is(pg_temp.ready()->>'kind','canonical','first participant off/on does not stale the opposite grant');
select public.revoke_directional_purpose_v1(pg_temp.pid(2),(select grant_id from grants where n=2));
select pg_temp.grant_portrait(2,pg_temp.presentation(2),'portrait-off-on-b');
select is(pg_temp.ready()->>'kind','canonical','both successive real off/on cycles restore exact canonical pair authority');
select is((select pair_revision from public.family_pairs where id=pg_temp.pair()),(select pair_revision from pair_before),'neither ordinary off/on cycle increments the pair revision');
rollback to reaffirmation_cycle;
savepoint legacy_source_selection;
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status)
select pg_temp.pid(n+100),pg_temp.pid(n),pg_temp.sid(n),'synthetic-legacy-'||n,'Synthetic legacy source','vcf',1,8,repeat('c',64),'annotated' from generate_series(1,3) n;
select is(pg_temp.ready()#>'{a,legacyFileIds}',jsonb_build_array(pg_temp.pid(101)),'first side receives only exact legacy file IDs for its subject');
select is(pg_temp.ready()#>'{b,legacyFileIds}',jsonb_build_array(pg_temp.pid(102)),'second side receives only exact legacy IDs, excluding canonical and foreign files');
select ok(pg_temp.ready((select value->>'receipt' from capture)) is null,'legacy membership changes invalidate the earlier source receipt');
rollback to legacy_source_selection;
select public.revoke_directional_purpose_v1(pg_temp.pid(2),(select grant_id from grants where n=2));
select ok(pg_temp.ready((select value->>'receipt' from capture)) is null,'actual grant withdrawal closes the pair immediately');
select is((select count(*) from public.genome_files where id in(pg_temp.pid(41),pg_temp.pid(42))),2::bigint,'withdrawal preserves both independent original sources');
select is((select count(*) from public.report_observed_calls where file_id in(pg_temp.pid(41),pg_temp.pid(42))),2::bigint,'withdrawal preserves independently normalized own observations');
select ok(not has_function_privilege('authenticated','public.family_portrait_source_readiness_v1(uuid,uuid,uuid,uuid,text)','EXECUTE')
 and not has_function_privilege('anon','public.grant_family_portrait_purpose_v1(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text)','EXECUTE'),'new grant and metadata RPCs are service-only');
select * from finish();
rollback;
