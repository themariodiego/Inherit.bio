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

\ir fixtures/own_copilot_synthetic_settings.inc
create function pg_temp.save_model(model_name text default 'synthetic-model',class text default 'cloud') returns jsonb language sql as $$
 select public.save_own_copilot_settings_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 pg_temp.synthetic_copilot_settings(model_name,class),
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
-- Reproduce persisted v1 evidence as historical rows, without changing any
-- artifact or disabling its immutability guard. All other bindings are current.
savepoint ancestry_disclosure_upgrade;
create temporary table historical_configuration as select pg_temp.presentation()->'snapshot' value;
insert into public.consent_signatures(id,artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,
 signer_account_id,target_kind,target_id,purpose,statement_keys,jurisdiction_code,jurisdiction_revision,subject_binding_revision)
 select case when a.artifact_key='consent.own-copilot-cloud' then '77900000-0000-4000-8000-000000000101'::uuid
 else '77900000-0000-4000-8000-000000000102'::uuid end,a.artifact_key,1,a.body_sha256,(c.value#>>'{context,principalId}')::uuid,
 '77900000-0000-4000-8000-000000000001','subject',(select id from copilot_subject),'copilot.cloud',
 array['model-named','data-classes-named','raw-file-excluded','revocable'],coalesce(p.jurisdiction_code,'ZZ'),p.jurisdiction_revision,
 (c.value#>>'{context,subjectBindingRevision}')::bigint from public.consent_artifacts a cross join historical_configuration c
 join public.profiles p on p.id='77900000-0000-4000-8000-000000000001'
 where a.artifact_key in('consent.own-copilot-cloud','consent.copilot-cloud-model') and a.version=1;
insert into public.purpose_grants(grant_id,grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,artifact_body_sha256,
 signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,jurisdiction_code,jurisdiction_revision,copilot_recipient_revision)
 select '77900000-0000-4000-8000-000000000103',1,'subject',s.target_id,s.purpose,s.artifact_key,s.artifact_version,s.artifact_body_sha256,
 s.id,s.signer_principal_id,s.signer_principal_id,s.subject_binding_revision,s.jurisdiction_code,s.jurisdiction_revision,
 (c.value->>'recipientRevision')::bigint from public.consent_signatures s cross join historical_configuration c
 where s.id='77900000-0000-4000-8000-000000000101';
insert into public.directional_grants(grant_id,grant_revision,recipient_principal_id,recipient_account_id,relationship_or_pair_revision,direction,self_principal_revision)
 select '77900000-0000-4000-8000-000000000103',1,(value#>>'{context,principalId}')::uuid,'77900000-0000-4000-8000-000000000001',
 (value#>>'{context,accountBindingRevision}')::bigint,'self',(value#>>'{context,principalRevision}')::bigint from historical_configuration;
insert into public.subject_consents(id,signature_id,subject_id,account_id,consent_type,scope,provider_key,grant_revision,copilot_recipient)
 select '77900000-0000-4000-8000-000000000104','77900000-0000-4000-8000-000000000102',(select id from copilot_subject),
 '77900000-0000-4000-8000-000000000001','cloud_model',array['genotypes','variant_search','reports','prs_coverage','chat_messages'],
 'canonical:77900000-0000-4000-8000-000000000001:'||(c.value->>'recipientRevision'),1,s.copilot_recipient
 from historical_configuration c join public.llm_settings s on s.user_id='77900000-0000-4000-8000-000000000001';
create temporary table historical_chat_authority as select value||jsonb_build_object('copilotGrantId','77900000-0000-4000-8000-000000000103',
 'copilotGrantRevision',1,'providerGrantId','77900000-0000-4000-8000-000000000104','providerGrantRevision',1) value from historical_configuration;
insert into public.chats(id,user_id,scope_kind,subject_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
 model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority)
 select '77900000-0000-4000-8000-000000000105','77900000-0000-4000-8000-000000000001','self',(select id from copilot_subject),
 (value#>>'{context,subjectLifecycleRevision}')::bigint,'cloud',1,(value->>'recipientRevision')::bigint,
 encode(digest(convert_to(value::text,'UTF8'),'sha256'),'hex'),false,value from historical_chat_authority;
insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,authorization_fingerprint,
 retrieved_subject_ids,retrieved_purpose_keys,contributor_ids,grant_revisions,lifecycle_revisions,provider_classification,
 runtime_attestation_revision,model_recipient_revision,legacy_unverified,canonical_projection,canonical_citations,citation_ids)
 select c.id,c.user_id,role,jsonb_build_array(jsonb_build_object('type','text','text','Historical synthetic text')),
 '77900000-0000-4000-8000-000000000106',1,role,c.scope_revision,c.authorization_fingerprint,array[c.subject_id],array['copilot.cloud'],
 array[c.user_id],array[1]::bigint[],array[c.lifecycle_revision],'cloud',1,c.model_recipient_revision,false,
 '{"sources":[],"legacySources":[],"unavailableSources":[]}'::jsonb,'[]','{}' from public.chats c
 cross join unnest(array['user','assistant']) role where c.id='77900000-0000-4000-8000-000000000105';
set constraints all immediate;
set constraints all deferred;
select is(pg_temp.authority(),null::jsonb,'a persisted v1 own-purpose grant cannot authorize the newly named ancestry disclosure');
select throws_ok($$select public.own_copilot_chat_v1('history','77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),(select value from historical_chat_authority),null,'77900000-0000-4000-8000-000000000105','{}')$$,
 '42501','not_found','v1 authority cannot read its historical paired conversation after v2 publication');
create temporary table fresh_disclosure_authority as select pg_temp.grant_model(pg_temp.presentation(),repeat('b1',32)) value;
select isnt((select value->>'copilotGrantId' from fresh_disclosure_authority),'77900000-0000-4000-8000-000000000103','fresh explicit v2 permission issues a new purpose grant');
select isnt((select value->>'providerGrantId' from fresh_disclosure_authority),'77900000-0000-4000-8000-000000000104','fresh explicit v2 permission binds a new cloud signature to the same recipient');
select is((select g.artifact_version from public.purpose_grants g where g.grant_id=(select (value->>'copilotGrantId')::uuid from fresh_disclosure_authority)),2,'new own-purpose signature records disclosure v2');
select is((select s.scope from public.subject_consents s where s.id=(select (value->>'providerGrantId')::uuid from fresh_disclosure_authority)),
 array['genotypes','variant_search','reports','prs_coverage','chat_messages']::text[],'fresh disclosure preserves the exact five existing cloud scope strings');
select is(pg_temp.authority(),(select value from fresh_disclosure_authority),'fresh explicit v2 permission is usable');
select throws_ok($$select public.own_copilot_chat_v1('history','77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),(select value from fresh_disclosure_authority),null,'77900000-0000-4000-8000-000000000105','{}')$$,
 '42501','not_found','new permission cannot revive a paired conversation made under v1');
select is(private.execute_own_report_purge_v1((select j.id from public.worker_jobs j join public.retention_due_phases d on d.retention_row_id=j.source_binding_id
 where d.immutable_envelope->>'grantId'='77900000-0000-4000-8000-000000000103'))->>'outcome','complete','v2 re-consent queues exact cleanup of superseded v1 purpose evidence');
select is((select count(*) from public.chat_messages where chat_id='77900000-0000-4000-8000-000000000105'),0::bigint,'old v1 paired messages are physically removed by their exact cleanup job');
rollback to ancestry_disclosure_upgrade;
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
savepoint empty_canonical_chat;
create temporary table empty_chat as with inserted as (
 insert into public.chats(user_id,scope_kind,subject_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
  model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority)
 select user_id,scope_kind,subject_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
  model_recipient_revision,authorization_fingerprint,false,canonical_authority from public.chats where id=(select id from first_chat)
 returning id
) select id from inserted;
select throws_ok($$select pg_temp.chat('history','{}',(select id from empty_chat))$$,'42501','not_found','empty canonical shell cannot supply history under valid current authority');
select throws_ok($$select pg_temp.turn(null,(select id from empty_chat),0)$$,'42501','not_found','empty canonical shell cannot accept an initial-looking append');
select is((select count(*) from jsonb_array_elements(pg_temp.chat('list')) c where c->>'id'=(select id::text from empty_chat)),0::bigint,'empty canonical shell is absent from conversation list');
select is((select count(*) from jsonb_array_elements(pg_temp.chat('list')) c where c->>'id'=(select id::text from first_chat)),1::bigint,'valid independent paired history remains listed');
select is(jsonb_array_length(pg_temp.chat('history','{}',(select id from first_chat))->'messages'),4,'empty-shell refusal leaves valid paired history readable');
select is((select count(*) from public.chats where id=(select id from empty_chat)),1::bigint,'read and append refusal do not delete the retained shell');
select is((select count(*) from public.chat_messages where chat_id=(select id from empty_chat)),0::bigint,'refused append cannot recreate purged messages');
rollback to empty_canonical_chat;
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
 (select version from public.consent_artifacts where artifact_key=case purpose when 'ancestry' then 'consent.own-ancestry' when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'ancestry' then 'consent.own-ancestry' when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
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

-- This savepoint exercises actual ancestry generation, grants and frozen purge
-- membership, then restores the independent pre-existing chat regression.
savepoint ancestry_copilot_contract;
create function pg_temp.chat_ancestry(expected jsonb default null) returns jsonb language sql as $$
 select public.own_copilot_ancestry_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
  (select id from copilot_subject),(select value from chat_authority),coalesce(expected,(select value from chat_projection)),
  '77900000-0000-4000-8000-000000000040');
$$;
create temporary table independent_ancestry_chat as select (pg_temp.turn(repeat('a1',32))->>'chatId')::uuid id;
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','raw-source and Copilot permission do not authorize unselected ancestry');
select pg_temp.grant_report('ancestry',repeat('a2',32));
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','ancestry permission alone does not expose an incomplete capture');
insert into claims values('ancestry',pg_temp.generate('begin','ancestry'));
-- The same closed, zero-panel-coverage DTO as the ancestry generation fixture.
-- Its supplied source call is outside the panel: this makes no personal claim.
\ir fixtures/own_ancestry_empty_content.inc
create temporary table chat_ancestry_output as select pg_temp.empty_ancestry_output(
 jsonb_build_object('fileId','77900000-0000-4000-8000-000000000040','subjectId',(select id from copilot_subject),
  'normalizedBuild','GRCh38','callEncoding','vcf-literal','sourceRevision',1,'sourceSha256',repeat('a',64),
  'normalizedAt',receipt#>'{authorization,normalizedAt}')) payload
 from claims where purpose='ancestry';
select pg_temp.generate('complete','ancestry',(select payload from chat_ancestry_output));
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','a newly completed ancestry result invalidates the old context');
update chat_projection set value=pg_temp.chat('prepare');
create temporary table ancestry_projection as select value from chat_projection;
create temporary table ancestry_receipt as select pg_temp.chat_ancestry() value;
select is((select value->'content' from ancestry_receipt),(select payload->'ancestry' from chat_ancestry_output),'Copilot reads exactly the captured ancestry page content');
select is((select value->>'resultHash' from ancestry_receipt),(select encode(digest(convert_to(result::text,'UTF8'),'sha256'),'hex')
 from private.own_analysis_runs where file_id='77900000-0000-4000-8000-000000000040' and purpose='ancestry'),'receipt pins the full completed ancestry journal digest');
select is((select count(*) from jsonb_array_elements((select value->'sources'->0->'completed' from ancestry_projection)) c where c->>'purpose'='ancestry'),1::bigint,'completed ancestry appears once in the immutable purpose projection');
grant select on ancestry_projection to service_role;
set local role service_role;
select lives_ok($$select public.own_copilot_ancestry_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),(select value from chat_authority),(select value from ancestry_projection),'77900000-0000-4000-8000-000000000040')$$,'actual application role reads ancestry through both Copilot and ancestry authority');
select throws_ok($$select public.own_copilot_ancestry_v1('77900000-0000-4000-8000-000000000099','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),(select value from chat_authority),(select value from ancestry_projection),'77900000-0000-4000-8000-000000000040')$$,'42501','not_found','service role cannot substitute another ancestry account');
set local role postgres;
select throws_ok($$select public.own_copilot_ancestry_v1('77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010',
 (select id from copilot_subject),(select value from chat_authority),(select value from ancestry_projection),'77900000-0000-4000-8000-000000000099')$$,'42501','not_found','caller cannot select a file outside the frozen projection');
savepoint ancestry_catalog_collision;
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,pgs_id)
 select 'inherit:ancestry',category,title,summary,status,evidence,layer,estimate_kind,pgs_id
 from public.report_templates where slug='synthetic-copilot-content-estimate';
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','reserved ancestry identity never shadows a published template');
rollback to ancestry_catalog_collision;
savepoint ancestry_capture_changed;
update private.own_analysis_runs set completed_at=completed_at+interval '1 second'
 where file_id='77900000-0000-4000-8000-000000000040' and purpose='ancestry';
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','changed completion receipt cannot reuse a pinned ancestry context');
rollback to ancestry_capture_changed;
savepoint ancestry_source_changed;
update public.genome_files set upload_revision=2,normalization_source_revision=2
 where id='77900000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','changed source revision cannot reuse ancestry context');
rollback to ancestry_source_changed;
savepoint ancestry_original_changed;
update public.genome_storage_objects set state='revoked',revoked_at=clock_timestamp()
 where genome_file_id='77900000-0000-4000-8000-000000000040';
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','loss of current original-object authority refuses ancestry');
rollback to ancestry_original_changed;
-- Fault injection happens after the unchanged real captured-content reader.
-- The original body is copied, not replaced by a fabricated result. Rollback
-- restores both the reader definition and all injected state transitions.
savepoint ancestry_read_transition;
do $test$
declare definition text;
begin
 definition:=pg_get_functiondef('private.own_ancestry_content_v1(uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,'FUNCTION private.own_ancestry_content_v1(','FUNCTION pg_temp.original_ancestry_reader(');
 if position('FUNCTION pg_temp.original_ancestry_reader(' in definition)=0 then raise exception 'expected ancestry reader definition'; end if;
 execute definition;
end;
$test$;
create temporary table ancestry_read_transition(kind text);
insert into ancestry_read_transition values('source');
create or replace function private.own_ancestry_content_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $test$
declare captured jsonb; transition text;
begin
 captured:=pg_temp.original_ancestry_reader(p_account_id,p_session_id,p_file_id);
 select kind into transition from pg_temp.ancestry_read_transition;
 if transition='source' then
  update public.genome_storage_objects set state='revoked',revoked_at=clock_timestamp() where genome_file_id=p_file_id;
 elsif transition='capture' then
  update private.own_analysis_runs set completed_at=completed_at+interval '1 second' where file_id=p_file_id and purpose='ancestry';
 elsif transition='purpose' then
  perform public.revoke_directional_purpose_v1(p_account_id,(select grant_id from private.own_analysis_runs where file_id=p_file_id and purpose='ancestry'));
 end if;
 return captured;
end;
$test$;
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','final chat check refuses original-object authority lost after the ancestry read');
update ancestry_read_transition set kind='capture';
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','receipt comparison refuses a capture replaced after the ancestry read');
update ancestry_read_transition set kind='purpose';
select throws_ok($$select pg_temp.chat_ancestry()$$,'42501','not_found','ancestry withdrawal between the content read and serialization returns no result');
rollback to ancestry_read_transition;
select pg_temp.chat('begin',jsonb_build_object('nonceHash',repeat('a3',32),'expiresAt',clock_timestamp()+interval '9 minutes'),null,(select value from chat_projection));
create temporary table ancestry_chat as select (pg_temp.chat('commit',jsonb_build_object('message','What was captured?',
 'answer','The saved result lacks enough markers.','citations',jsonb_build_array(jsonb_build_object(
 'id','ancestry:'||(value->>'fileId')||':'||(value->>'runId')||':'||(value->>'resultHash'),
 'label','Your captured ancestry result','href','/genome/me/ancestry')),
 'lastOrdinal',0,'nonceHash',repeat('a3',32)),null,(select value from chat_projection))->>'chatId')::uuid id from ancestry_receipt;
select pg_temp.turn(null,(select id from ancestry_chat),1);
select is((select canonical_citations->0->>'href' from public.chat_messages where chat_id=(select id from ancestry_chat) and role='assistant' and turn_ordinal=1),'/genome/me/ancestry','validated ancestry citation persists on its exact paired turn');
select ok((select bool_and('ancestry'=any(retrieved_purpose_keys)) from public.chat_messages where chat_id=(select id from ancestry_chat)),'every dependent pair retains the ancestry purpose dependency');
create temporary table old_ancestry_grant as select grant_id id from public.purpose_grants
 where target_id=(select id from copilot_subject) and purpose='ancestry' and revoked_at is null;
select public.revoke_directional_purpose_v1('77900000-0000-4000-8000-000000000001',(select id from old_ancestry_grant));
create temporary table old_ancestry_cleanup as select j.id job_id,
 jsonb_build_object('job',to_jsonb(j),'phase',to_jsonb(d),'manifest',to_jsonb(m)) terminal_before
 from public.worker_jobs j join public.retention_due_phases d on d.retention_row_id=j.source_binding_id
 join public.purge_manifests m on m.retention_row_id=d.retention_row_id
  and m.phase_id=d.phase_id and m.phase_revision=d.phase_revision and m.manifest_revision=1
 where d.immutable_envelope->>'grantId'=(select id::text from old_ancestry_grant)
  and d.phase_id='own-report-purpose-purge' and d.phase_revision=1
  and j.kind='revoke_purge' and j.source_binding_kind='revocation-disposition'
  and j.computation_revision='own-report-revocation-v1';
select is((select count(*) from old_ancestry_cleanup),1::bigint,'exact old ancestry grant has one canonical cleanup job and manifest');
select ok((select terminal_before#>>'{job,status}'='done'
 and terminal_before#>>'{job,result,outcome}'='exact_grant_residuals_zero'
 and terminal_before#>>'{job,finished_at}' is not null
 and terminal_before#>>'{phase,status}'='succeeded'
 and terminal_before#>>'{phase,terminal_outcome_code}'='exact_grant_residuals_zero'
 and terminal_before#>>'{manifest,state}'='complete'
 and terminal_before#>>'{manifest,physical_purge_started_at}' is not null
 and terminal_before#>>'{manifest,frozen_manifest_hash}' is not null from old_ancestry_cleanup),
 'actual ancestry withdrawal records completed job, phase and frozen-manifest evidence before replay');
select is((select count(*) from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
 join public.retention_due_phases d on d.retention_row_id=m.retention_row_id
 where d.immutable_envelope->>'grantId'=(select id::text from old_ancestry_grant) and e.store_name='public.chat_messages'),4::bigint,'ancestry withdrawal freezes exactly both dependent pairs');
select is((select count(*) from public.chat_messages where chat_id=(select id from ancestry_chat)),0::bigint,'ancestry withdrawal actually purges both dependent pairs');
select is((select count(*) from public.chat_messages where chat_id=(select id from independent_ancestry_chat)),2::bigint,'pre-existing conversation with no ancestry dependency survives');
select is(jsonb_array_length(pg_temp.chat('history','{}',(select id from independent_ancestry_chat))->'messages'),2,'the independent conversation is readable under the restored current projection');
select is((select count(*) from public.report_observed_calls where file_id='77900000-0000-4000-8000-000000000040'),1::bigint,'ancestry purge preserves raw source observations');
select is((select count(*) from private.own_analysis_runs where file_id='77900000-0000-4000-8000-000000000040' and purpose='reports.polygenic'),1::bigint,'ancestry purge preserves independent selected report');
select pg_temp.grant_report('ancestry',repeat('a4',32));
update claims set receipt=pg_temp.generate('begin','ancestry') where purpose='ancestry';
select pg_temp.generate('complete','ancestry',(select payload from chat_ancestry_output));
select throws_ok($$select pg_temp.chat_ancestry((select value from ancestry_projection))$$,'42501','not_found','regrant and regeneration cannot restore the predecessor context');
select throws_ok($$select pg_temp.chat('history','{}',(select id from ancestry_chat))$$,'42501','not_found','regrant cannot revive purged predecessor history');
update chat_projection set value=pg_temp.chat('prepare');
create temporary table successor_ancestry_chat as select (pg_temp.turn(repeat('a5',32))->>'chatId')::uuid id;
select is(private.execute_own_report_purge_v1((select job_id from old_ancestry_cleanup)),null::jsonb,
 'completed exact old ancestry cleanup is idempotently omitted');
select is((select jsonb_build_object('job',to_jsonb(j),'phase',to_jsonb(d),'manifest',to_jsonb(m))
 from public.worker_jobs j join public.retention_due_phases d on d.retention_row_id=j.source_binding_id
 join public.purge_manifests m on m.retention_row_id=d.retention_row_id
  and m.phase_id=d.phase_id and m.phase_revision=d.phase_revision and m.manifest_revision=1
 where j.id=(select job_id from old_ancestry_cleanup) and d.phase_id='own-report-purpose-purge' and d.phase_revision=1),
 (select terminal_before from old_ancestry_cleanup),'regrant and replay preserve the entire completed job, phase and manifest receipt');
select is((select count(*) from public.chat_messages where chat_id=(select id from successor_ancestry_chat)),2::bigint,'predecessor purge replay leaves successor-grant conversation intact');
select lives_ok($$select pg_temp.chat_ancestry()$$,'successor ancestry capture remains readable after predecessor purge replay');
select ok(not has_function_privilege(role_name,'public.own_copilot_ancestry_v1(uuid,uuid,uuid,jsonb,jsonb,uuid)','EXECUTE'),role_name||' cannot bypass the server ancestry dispatcher')
 from unnest(array['anon','authenticated','inherit_upload_only']) role_name;
select ok(not private.valid_own_copilot_citations_v1('[{"id":"ancestry","label":"Ancestry","href":"/genome/me/ancestry?file=other"}]'),'ancestry citation path does not accept a caller-selected query');
set constraints all immediate;
rollback to ancestry_copilot_contract;

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
-- Historical subject-only content has no file provenance. Both old backfill
-- (legacy_unverified=true) and old paired-writer (false) shapes are preserved.
create temporary table legacy_file_chat as
 with inserted as (insert into public.chats(user_id,scope_kind,subject_id,lifecycle_revision,
  provider_classification,runtime_attestation_revision,model_recipient_revision,authorization_fingerprint,legacy_unverified)
 select user_id,scope_kind,subject_id,lifecycle_revision,provider_classification,runtime_attestation_revision,
  model_recipient_revision,authorization_fingerprint,true from public.chats where id=(select id from first_chat)
 returning id) select id from inserted;
insert into public.chat_messages(chat_id,user_id,role,content,turn_id,turn_ordinal,paired_role,scope_revision,
 authorization_fingerprint,provider_classification,runtime_attestation_revision,model_recipient_revision,legacy_unverified)
 select (select id from legacy_file_chat),user_id,role,content,gen_random_uuid(),turn_ordinal,paired_role,scope_revision,
 authorization_fingerprint,provider_classification,runtime_attestation_revision,model_recipient_revision,role='user'
 from public.chat_messages where chat_id=(select id from first_chat) and turn_ordinal=1;
create temporary table legacy_file_history as select id,content,turn_id,legacy_unverified
 from public.chat_messages where chat_id=(select id from legacy_file_chat);
savepoint mixed_legacy_projection;
update public.chat_messages set canonical_projection='{}' where chat_id=(select id from legacy_file_chat) and role='assistant';
select throws_ok($$select public.prepare_genome_file_deletion_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040')$$,
 '55000','file_delete_shared_graph','legacy container with a partial canonical projection remains blocked');
rollback to mixed_legacy_projection;
savepoint mixed_legacy_citations;
update public.chat_messages set canonical_citations='[{"id":"historical-test","label":"Synthetic source","href":"/genome/me/reports/synthetic"}]'
 where chat_id=(select id from legacy_file_chat) and role='assistant';
select throws_ok($$select public.prepare_genome_file_deletion_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040')$$,
 '55000','file_delete_shared_graph','canonical citations alone cannot masquerade as unattributed legacy content');
rollback to mixed_legacy_citations;
savepoint stripped_canonical_markers;
update public.chats set canonical_authority=null where id=(select id from first_chat);
update public.chat_messages set canonical_projection=null where chat_id=(select id from first_chat);
select throws_ok($$select public.prepare_genome_file_deletion_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040')$$,
 '55000','file_delete_shared_graph','remaining retrieval and grant provenance blocks a stripped canonical history');
rollback to stripped_canonical_markers;
create temporary table delete_receipt as select public.prepare_genome_file_deletion_v1(
 '77900000-0000-4000-8000-000000000001','77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040') value;
select is((select jsonb_array_length(canonical_chat_manifest) from private.genome_file_deletions
 where file_id='77900000-0000-4000-8000-000000000040'),4,'selected-file prepare freezes both turns including the dependent later pair');
select is(public.prepare_genome_file_deletion_v1('77900000-0000-4000-8000-000000000001',
 '77900000-0000-4000-8000-000000000010','77900000-0000-4000-8000-000000000040'),
 (select value from delete_receipt),'retry with historical chats retains the exact Storage deletion receipt');

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
select results_eq($$select id,content,turn_id,legacy_unverified from public.chat_messages
 where chat_id=(select id from legacy_file_chat) order by id$$,
 $$select id,content,turn_id,legacy_unverified from legacy_file_history order by id$$,
 'successful file deletion preserves exact historical rows and text without inventing file attribution');

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
-- Prepare the current post-withdrawal source projection so a failed append
-- proves the empty-conversation boundary rather than stale-context rejection.
update chat_projection set value=pg_temp.chat('prepare');
select throws_ok($$select pg_temp.chat('history','{}',(select id from successor_chat))$$,'42501','not_found','synchronously purged report conversation has no readable history');
select throws_ok($$select pg_temp.turn(null,(select id from successor_chat),0)$$,'42501','not_found','fresh authority and source projection cannot restart a purged conversation');
select is((select count(*) from jsonb_array_elements(pg_temp.chat('list')) c where c->>'id'=(select id::text from successor_chat)),0::bigint,'synchronously purged report conversation is not listed');
select is((select count(*) from public.chats where id=(select id from successor_chat)),1::bigint,'purged shell remains retained without deleting unrelated chat identities');
create temporary table recovery_chat as select (pg_temp.turn(repeat('0',64))->>'chatId')::uuid id;
select pg_temp.turn(null,(select id from recovery_chat),1);
select is(jsonb_array_length(pg_temp.chat('history','{}',(select id from recovery_chat))->'messages'),4,'a new authorized conversation can commit and append both complete turns after report withdrawal');
select is((select count(*) from jsonb_array_elements(pg_temp.chat('list')) c where c->>'id'=(select id::text from recovery_chat)),1::bigint,'new valid paired conversation remains listed after purge');
select is((select count(*) from public.report_observed_calls where file_id='77900000-0000-4000-8000-000000000040'),1::bigint,'report withdrawal preserves source observations');
select ok(not has_function_privilege('authenticated','public.own_copilot_chat_v1(text,uuid,uuid,uuid,jsonb,jsonb,uuid,jsonb)','EXECUTE'),'browser cannot bypass the server context/provenance dispatcher');
select ok(not has_table_privilege('authenticated','private.own_copilot_nonces','SELECT'),'browser cannot read context nonce bindings');
select ok(not has_table_privilege('authenticated','public.chat_messages','SELECT'),'browser cannot restore history directly');
set constraints all immediate;
select * from finish();
rollback;
