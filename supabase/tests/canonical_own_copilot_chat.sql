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
insert into auth.users(id,email) values('77900000-0000-4000-8000-000000000001','copilot-content@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='77900000-0000-4000-8000-000000000001';
create temporary table copilot_subject as select id from public.subjects
 where subject_account_id='77900000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));

create function pg_temp.save_model(model_name text default 'synthetic-model',class text default 'cloud') returns jsonb language sql as $$
 select public.save_own_copilot_settings_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 jsonb_build_object('provider','openai_compatible','baseUrl',case when class='local' then 'http://localhost:3103/v1' else 'https://model.synthetic.invalid/v1' end,'model',model_name,
 'origin',case when class='local' then 'http://localhost:3103' else 'https://model.synthetic.invalid' end,'providerLabel','Synthetic model','providerClass',class,'runtimeAttestationFingerprint',repeat('a',64)),
 null,repeat('b',64),null);
$$;
create function pg_temp.authority(expected jsonb default null) returns jsonb language sql as $$
 select public.own_copilot_authority_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),expected);
$$;
create function pg_temp.presentation() returns jsonb language sql as $$
 select public.own_copilot_presentation_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',(select id from copilot_subject));
$$;
create function pg_temp.grant_model(presentation jsonb,nonce text) returns jsonb language sql as $$
 select public.grant_own_copilot_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),presentation->'snapshot',presentation->'artifacts',nonce,clock_timestamp()+interval '9 minutes');
$$;
select throws_ok($$select public.save_own_copilot_settings_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010',null,null,null,null)$$,'22023','invalid_request','null settings cannot authorize a configuration');
select throws_ok($$select public.save_own_copilot_settings_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','[]',null,null,null)$$,'22023','invalid_request','array settings cannot reach object validation');
select throws_ok($$select public.grant_own_copilot_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010',(select id from copilot_subject),null,null,repeat('9',64),clock_timestamp()+interval '9 minutes')$$,
 '22023','invalid_request','null presentation cannot create a grant');
select throws_ok($$select public.revoke_own_copilot_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010',(select id from copilot_subject),null)$$,'22023','invalid_request','revoke requires the exact expected snapshot');

select pg_temp.save_model();
create temporary table chat_authority as select pg_temp.grant_model(pg_temp.presentation(),repeat('c',64)) value;
create function pg_temp.chat(op text,payload jsonb default '{}',chat_id uuid default null,expected_projection jsonb default null) returns jsonb language sql as $$
 select public.own_copilot_chat_v1(op,'77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),(select value from chat_authority),expected_projection,chat_id,payload);
$$;
create temporary table chat_projection as select pg_temp.chat('prepare') value;
create function pg_temp.turn(nonce text,chat_id uuid default null,last_ordinal integer default 0) returns jsonb language plpgsql as $$
begin
 if chat_id is null then
  perform pg_temp.chat('begin',jsonb_build_object('nonceHash',nonce,'expiresAt',clock_timestamp()+interval '9 minutes'),null,(select value from chat_projection));
 end if;
 return pg_temp.chat('commit',jsonb_build_object('message','Synthetic question','answer','Synthetic answer','citations','[]'::jsonb,
  'lastOrdinal',last_ordinal,'nonceHash',nonce),chat_id,(select value from chat_projection));
end;
$$;
select is((select value->'sources' from chat_projection),'[]'::jsonb,'no source is a valid recovery conversation');
select is(pg_temp.chat('reports','{"offset":0}',null,(select value from chat_projection)),'[]'::jsonb,'no source cannot generate reports on read');
create temporary table first_chat as select (pg_temp.turn(repeat('d',64))->>'chatId')::uuid id;
select is((select count(*) from public.chat_messages where chat_id=(select id from first_chat)),2::bigint,'validated first turn writes an atomic pair');
select pg_temp.turn(null,(select id from first_chat),1);
select is(jsonb_array_length(pg_temp.chat('history','{}',(select id from first_chat))->'messages'),4,'authorized server history returns both complete turns');
grant select on copilot_subject,chat_authority,first_chat to service_role;
set local role service_role;
select lives_ok($$select public.own_copilot_chat_v1('history','77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010',(select id from copilot_subject),(select value from chat_authority),null,(select id from first_chat),'{}')$$,
 'actual application service role can read authorized paired history');
select throws_ok($$select public.own_copilot_chat_v1('history','77900000-0000-4000-8000-000000000099',
 '77900000-0000-4000-8000-000000000010',(select id from copilot_subject),(select value from chat_authority),null,(select id from first_chat),'{}')$$,
 '42501','not_found','service role dispatcher still rejects a mismatched account');
set local role postgres;
savepoint unverified_pair;
update public.chat_messages set legacy_unverified=true where chat_id=(select id from first_chat) and turn_ordinal=1;
select throws_ok($$select pg_temp.chat('history','{}',(select id from first_chat))$$,'42501','not_found','unverified earlier pair cannot be omitted to revive a dependent suffix');
select throws_ok($$select pg_temp.turn(null,(select id from first_chat),2)$$,'42501','not_found','cannot append after an unverified pair');
rollback to unverified_pair;
savepoint stale_earlier_pair;
update public.chat_messages set canonical_projection=jsonb_set(canonical_projection,'{unavailableSources}',
 '[{"id":"77900000-0000-4000-8000-000000000099","reason":"source_unavailable"}]')
 where chat_id=(select id from first_chat) and turn_ordinal=1;
select throws_ok($$select pg_temp.chat('history','{}',(select id from first_chat))$$,'42501','not_found','one stale earlier pair invalidates the otherwise matching later pair');
select throws_ok($$select pg_temp.turn(null,(select id from first_chat),2)$$,'42501','not_found','fresh current projection cannot append after a stale earlier pair');
rollback to stale_earlier_pair;
select throws_ok($$select pg_temp.turn(repeat('d',64))$$,'23505',null,'new conversation nonce is single-use');
select throws_ok($$select pg_temp.chat('begin','{"nonceHash":null,"expiresAt":null}',null,(select value from chat_projection))$$,'22023','invalid_request','null context members fail closed');
select throws_ok($$select pg_temp.chat('calls','{"rsids":[4988235],"offset":null}',null,(select value from chat_projection))$$,'22023','invalid_request','null paging selector fails closed');
select throws_ok($$select pg_temp.chat('calls','{"rsids":[4988235],"offset":0,"subjectId":"77900000-0000-4000-8000-000000000099"}',null,(select value from chat_projection))$$,'22023','invalid_request','read selectors cannot widen scope');
select throws_ok($$select pg_temp.chat('commit','{"message":"x","answer":"x","citations":[],"lastOrdinal":0,"nonceHash":null}',(select id from first_chat),(select value from chat_projection))$$,'40001','chat_changed','concurrent history appends cannot overwrite a turn');
-- Reference fixtures are synthetic and roll back; no application seed or
-- completed analysis row is imported. The coverage output has a real PGS FK.
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('SYNTHETIC_COPILOT_CONTENT','Synthetic generation reference','Synthetic test trait',1,
 '{"label":"Synthetic test reference"}','http://localhost/synthetic-pgs','Synthetic fixture; no population inference.');
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,pgs_id)
 values('synthetic-copilot-content-estimate','synthetic','Synthetic generation estimate','Synthetic database test fixture.',
 'published','emerging','estimate','polygenic_score','SYNTHETIC_COPILOT_CONTENT');
insert into storage.objects(id,bucket_id,name,metadata) values('77900000-0000-4000-8000-000000000020',
 'genomes','77900000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('77900000-0000-4000-8000-000000000040','77900000-0000-4000-8000-000000000001',(select id from copilot_subject),
 '77900000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'77900000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('77900000-0000-4000-8000-000000000020','77900000-0000-4000-8000-000000000030','genomes',
 '77900000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040',purpose,
 case when op='begin' then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),public.own_report_context_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010',(select id from copilot_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;

select throws_ok($$select pg_temp.chat('check','{}',null,(select value from chat_projection))$$,'42501','not_found','adding a source changes the context before any provider dispatch');
select throws_ok($$select pg_temp.chat('history','{}',(select id from first_chat))$$,'42501','not_found','stale dependent history cannot be restored');
update chat_projection set value=pg_temp.chat('prepare');
select throws_ok($$select pg_temp.turn(null,(select id from first_chat),1)$$,'42501','not_found','freshly prepared projection cannot authorize append after a stale pair');
select is(jsonb_array_length((select value->'sources' from chat_projection)),1,'actual normalized source is now represented');
select is(pg_temp.chat('calls','{"rsids":[4988235],"offset":0}',null,(select value from chat_projection))->0->>'genotype','A/G','canonical observation comes from normalized GRCh38 locus');
select is(pg_temp.chat('reports','{"offset":0}',null,(select value from chat_projection)),'[]'::jsonb,'preparation alone still has no reports');
select pg_temp.grant_report('reports.polygenic',repeat('e',64));
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
select pg_temp.generate('complete','reports.polygenic','{"reports":[{"slug":"synthetic-copilot-content-estimate","covered":false,"conflictingRsids":[4988235],"variants":[{"rsid":4988235,"outcome":{"status":"not-covered"}}]}],"prs":[{"pgs_id":"SYNTHETIC_COPILOT_CONTENT","raw_score":0.1,"coverage":1,"matched":1}]}');
update chat_projection set value=pg_temp.chat('prepare');
select is(pg_temp.chat('reports','{"offset":0}',null,(select value from chat_projection))->0->'report'->'covered','false'::jsonb,'stored uncovered report outcome is preserved');
select is(pg_temp.chat('reports','{"offset":0}',null,(select value from chat_projection))->0->'report'->'conflictingRsids','[4988235]'::jsonb,'captured conflicts remain distinct from missing coverage');
select ok(not((pg_temp.chat('prs','{"offset":0}',null,(select value from chat_projection))->0) ?| array['raw_score','zscore','percentile','coverage']), 'PRS reader never returns unvalidated quantities');
-- The historical compatibility fixture has the same old processed-file
-- authority as existing legacy readers; it is never relabelled canonical.
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,build)
 values('77900000-0000-4000-8000-000000000050','77900000-0000-4000-8000-000000000001',(select id from copilot_subject),
 '77900000-0000-4000-8000-000000000051','Synthetic historical genome','vcf',1,8,repeat('f',64),'annotated','GRCh38');
insert into public.user_variants(user_id,subject_id,file_id,rsid,chrom,pos,ref,alt,genotype)
 values('77900000-0000-4000-8000-000000000001',(select id from copilot_subject),'77900000-0000-4000-8000-000000000050',4988235,2,135851076,'G','A','A/G');
update chat_projection set value=pg_temp.chat('prepare');
select is(jsonb_array_length((select value->'legacySources' from chat_projection)),1,'historical source remains explicitly classified');
select is(jsonb_array_length(pg_temp.chat('calls','{"rsids":[4988235],"offset":0}',null,(select value from chat_projection))),2,'mixed source union keeps both agreeing observations');
savepoint changed_legacy;
update public.genome_files set sha256=repeat('9',64) where id='77900000-0000-4000-8000-000000000050';
select throws_ok($$select pg_temp.chat('check','{}',null,(select value from chat_projection))$$,'42501','not_found','changed legacy source hash invalidates every later read');
rollback to changed_legacy;
savepoint deleted_legacy;
delete from public.genome_files where id='77900000-0000-4000-8000-000000000050';
select throws_ok($$select pg_temp.chat('check','{}',null,(select value from chat_projection))$$,'42501','not_found','deleted legacy source invalidates every later read');
rollback to deleted_legacy;
select throws_ok($$update public.genome_files set single_logical_sample_verified_at=null,status='annotated' where id='77900000-0000-4000-8000-000000000040'$$,'55000','immutable_file_identity','canonical source cannot become legacy by toggling status or its verification marker');
savepoint session_ended;
delete from auth.sessions where id='77900000-0000-4000-8000-000000000010';
select throws_ok($$select pg_temp.chat('check','{}',null,(select value from chat_projection))$$,'42501','not_found','ended originating session refuses source reads');
rollback to session_ended;
create temporary table report_chat as select (pg_temp.turn(repeat('6',64))->>'chatId')::uuid id;
select pg_temp.turn(null,(select id from report_chat),1);
savepoint selected_file_deletion;
create temporary table delete_receipt as select public.prepare_genome_file_deletion_v1(
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040') value;
select is((select jsonb_array_length(canonical_chat_manifest) from private.genome_file_deletions
 where file_id='77900000-0000-4000-8000-000000000040'),4,'selected-file prepare freezes both turns including the dependent later pair');
select throws_ok($$update private.genome_file_deletions set canonical_chat_manifest='[]'
 where file_id='77900000-0000-4000-8000-000000000040'$$,'55000','file_deletion_manifest_immutable','frozen selected-file membership cannot be narrowed');
select throws_ok($$select public.finish_genome_file_deletion_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040',(select (value->>'token')::uuid from delete_receipt))$$,
 '55000','file_delete_storage_incomplete','premature finish cannot bypass Storage acknowledgement');
update chat_projection set value=pg_temp.chat('prepare');
select is((select value->'unavailableSources' from chat_projection),'[]'::jsonb,
 'pending deletion is absent from fresh unavailable-source dependencies');
create temporary table during_delete_chat as select (pg_temp.turn(repeat('9',64))->>'chatId')::uuid id;
select is((select jsonb_array_length(canonical_chat_manifest) from private.genome_file_deletions
 where file_id='77900000-0000-4000-8000-000000000040'),4,
 'a new independent chat does not change the frozen deletion manifest');
-- SQL fixture simulates only its synthetic Storage acknowledgement; no object API is called.
set local storage.allow_delete_query='true';
delete from storage.objects where id='77900000-0000-4000-8000-000000000020';
set local storage.allow_delete_query='false';
select public.finish_genome_file_deletion_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040',(select (value->>'token')::uuid from delete_receipt));
select is((select count(*) from public.chat_messages where chat_id=(select id from report_chat)),0::bigint,'selected source and its quoted dependent pair are removed together');
select is((select count(*) from public.chat_messages where chat_id=(select id from first_chat)),4::bigint,'independent complete conversation outside frozen source membership survives');
select is((select count(*) from public.user_variants where file_id='77900000-0000-4000-8000-000000000050'),1::bigint,'other file observation survives selected deletion');
select is((select count(*) from public.chat_messages m where exists(
 select 1 from jsonb_array_elements((m.canonical_projection->'sources')||(m.canonical_projection->'legacySources')||(m.canonical_projection->'unavailableSources')) s
 where s->>'id'='77900000-0000-4000-8000-000000000040')),0::bigint,
 'no surviving old or newly committed message references the deleted file');
select is(jsonb_array_length(pg_temp.chat('history','{}',(select id from during_delete_chat))->'messages'),2,
 'chat created during Storage ACK retains only the other source and remains readable after finish');
rollback to selected_file_deletion;
-- Canonical Copilot withdrawal freezes exact pair membership first. Actual
-- execution below is selected by this synthetic grant only, never a worker sweep.
create temporary table old_copilot_grant as select (value->>'copilotGrantId')::uuid id from chat_authority;
select pg_temp.save_model('successor-model');
select throws_ok($$select pg_temp.chat('history','{}',(select id from report_chat))$$,'42501','not_found','settings change immediately invalidates old conversation authority');
create temporary table copilot_job as select j.id from public.worker_jobs j join public.retention_due_phases d on d.retention_row_id=j.source_binding_id
 where d.immutable_envelope->>'grantId'=(select id::text from old_copilot_grant);
select is((select count(*) from copilot_job),1::bigint,'one exact durable cleanup job exists');
select is((select count(*) from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
 join public.retention_due_phases d on d.retention_row_id=m.retention_row_id
 where d.immutable_envelope->>'grantId'=(select id::text from old_copilot_grant) and e.store_name='public.chat_messages'),8::bigint,
 'frozen manifest contains both old conversations and their dependent second pairs before deletion');
update chat_authority set value=pg_temp.grant_model(pg_temp.presentation(),repeat('7',64));
update chat_projection set value=pg_temp.chat('prepare');
create temporary table successor_chat as select (pg_temp.turn(repeat('8',64))->>'chatId')::uuid id;
savepoint legacy_context;
insert into public.chats(user_id,scope_kind,subject_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
 model_recipient_revision,authorization_fingerprint,legacy_unverified)
 values('77900000-0000-4000-8000-000000000001','self',(select id from copilot_subject),1,'cloud',1,1,repeat('4',64),true);
select throws_ok($$select private.execute_own_report_purge_v1((select id from copilot_job))$$,
 '55000','own_report_purge_unsupported_outputs','unverified legacy chat remains an explicit cleanup blocker');
rollback to legacy_context;
savepoint lifecycle_transition;
update public.subjects set lifecycle='restricted',lifecycle_revision=lifecycle_revision+1 where id=(select id from copilot_subject);
select is(private.execute_own_report_purge_v1((select id from copilot_job))->>'outcome','complete','queued cleanup uses frozen lifecycle and survives a later restriction');
select is((select count(*) from public.chat_messages where chat_id=(select id from successor_chat)),2::bigint,'lifecycle transition does not broaden old-grant manifest membership');
rollback to lifecycle_transition;
select is(private.execute_own_report_purge_v1((select id from copilot_job))->>'outcome','complete','exact synthetic Copilot job purges its frozen pairs');
select is((select count(*) from public.chat_messages where chat_id in(select id from first_chat union all select id from report_chat)),0::bigint,'old pairs physically removed together');
select is((select count(*) from public.chat_messages where chat_id=(select id from successor_chat)),2::bigint,'new-grant conversation is not a member of the older frozen manifest');
select is((select count(*) from private.own_analysis_runs where file_id='77900000-0000-4000-8000-000000000040'),1::bigint,'Copilot withdrawal preserves independently authorized report');
select public.revoke_directional_purpose_v1('77900000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from copilot_subject) and purpose='reports.polygenic' and revoked_at is null));
select is((select count(*) from public.chat_messages where chat_id=(select id from successor_chat)),0::bigint,'report withdrawal synchronously removes dependent canonical pair through manifest');
select is((select count(*) from public.report_observed_calls where file_id='77900000-0000-4000-8000-000000000040'),1::bigint,'report withdrawal preserves source observations');
select ok(not has_function_privilege('authenticated','public.own_copilot_chat_v1(text,uuid,uuid,uuid,jsonb,jsonb,uuid,jsonb)','EXECUTE'),'browser cannot bypass the server context/provenance dispatcher');
select ok(not has_table_privilege('authenticated','private.own_copilot_nonces','SELECT'),'browser cannot read context nonce bindings');
select ok(not has_table_privilege('authenticated','public.chat_messages','SELECT'),'browser cannot restore history directly');
set constraints all immediate;
select * from finish();
rollback;
