begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- The Family group Copilot scope (20260929140000_family_copilot_scope.sql).
-- Entirely synthetic and rollback-only. B prepares a real source and
-- completes both own report layers through the existing wrappers; A asks;
-- C is an unrelated adult. Every grant is signed through the real functions.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into auth.users(id,email,email_confirmed_at) values
 ('7a2c0000-0000-4000-8000-000000000001','family-copilot-b@e2e.local',clock_timestamp()),
 ('7a2c0000-0000-4000-8000-000000000002','family-copilot-a@e2e.local',clock_timestamp()),
 ('7a2c0000-0000-4000-8000-000000000003','family-copilot-c@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a2c0000-0000-4000-8000-000000000011','7a2c0000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('7a2c0000-0000-4000-8000-000000000012','7a2c0000-0000-4000-8000-000000000002',now(),now(),'aal1'),
 ('7a2c0000-0000-4000-8000-000000000013','7a2c0000-0000-4000-8000-000000000003',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id in('7a2c0000-0000-4000-8000-000000000001',
 '7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000003');
create temporary table ids as select
 (select id from public.subjects where subject_account_id='7a2c0000-0000-4000-8000-000000000001' and subject_class='self') b_self,
 (select id from public.subjects where subject_account_id='7a2c0000-0000-4000-8000-000000000002' and subject_class='self') a_self,
 (select id from public.subjects where subject_account_id='7a2c0000-0000-4000-8000-000000000003' and subject_class='self') c_self;
-- The fixture's independent sign-in marker for B; Health picture grants require it.
update public.subjects set independent_login_at=clock_timestamp() where id=(select b_self from ids);

-- Upload consent for B and A through the real signing function.
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),account,session,'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from (values('a','7a2c0000-0000-4000-8000-000000000001'::uuid,'7a2c0000-0000-4000-8000-000000000011'::uuid),
  ('b','7a2c0000-0000-4000-8000-000000000001','7a2c0000-0000-4000-8000-000000000011'),
  ('c','7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000012'),
  ('d','7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000012')) n(letter,account,session);
create function pg_temp.sign(account uuid,session uuid,subject uuid,artifact text,statement text,nonce text) returns jsonb language sql as $$
 select to_jsonb(public.sign_own_upload_artifact_v1(account,session,subject,artifact,1,
 (select body_sha256 from public.consent_artifacts where artifact_key=artifact and version=1),array[statement],1,1,1,1,1,nonce)); $$;
select pg_temp.sign('7a2c0000-0000-4000-8000-000000000001','7a2c0000-0000-4000-8000-000000000011',(select b_self from ids),
 'disclosure.insurance-and-discrimination','understood',repeat('a',64));
select pg_temp.sign('7a2c0000-0000-4000-8000-000000000001','7a2c0000-0000-4000-8000-000000000011',(select b_self from ids),
 'consent.upload-self','own-adult-dna',repeat('b',64));
select pg_temp.sign('7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000012',(select a_self from ids),
 'disclosure.insurance-and-discrimination','understood',repeat('c',64));
select pg_temp.sign('7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000012',(select a_self from ids),
 'consent.upload-self','own-adult-dna',repeat('d',64));

-- B's one real prepared source.
insert into storage.objects(id,bucket_id,name,metadata) values('7a2c0000-0000-4000-8000-000000000020',
 'genomes','7a2c0000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('7a2c0000-0000-4000-8000-000000000040','7a2c0000-0000-4000-8000-000000000001',(select b_self from ids),
 '7a2c0000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'7a2c0000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('7a2c0000-0000-4000-8000-000000000020','7a2c0000-0000-4000-8000-000000000030','genomes',
 '7a2c0000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '7a2c0000-0000-4000-8000-000000000001','7a2c0000-0000-4000-8000-000000000011','7a2c0000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'7a2c0000-0000-4000-8000-000000000001',
 '7a2c0000-0000-4000-8000-000000000011','7a2c0000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload); $$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('family-copilot-poly-fixture','basic-traits','Fixture estimate','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]'),
 ('family-copilot-mono-fixture','medicines','Fixture call','Rollback-only call.','emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('FAMILY-COPILOT-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('7a2c0000-0000-4000-8000-000000000001','7a2c0000-0000-4000-8000-000000000011',
 (select b_self from ids),public.own_report_context_v1('7a2c0000-0000-4000-8000-000000000001',
 '7a2c0000-0000-4000-8000-000000000011',(select b_self from ids)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes'); $$;
create function pg_temp.output(purpose text) returns jsonb language sql as $$
 select jsonb_build_object('reports',jsonb_build_array(jsonb_build_object('slug',t.slug,'covered',true,'conflictingRsids','[]'::jsonb,
  'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved","strandFlipped":false}}]'::jsonb,
  'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,
   'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)))),
  'prs',case $1 when 'reports.polygenic' then '[{"pgs_id":"FAMILY-COPILOT-FIXTURE","raw_score":0,"coverage":1,"matched":1}]'::jsonb else '[]'::jsonb end,
  'readyMail',jsonb_build_object('contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),
   'dashboardUrl','https://example.invalid/genome/me/reports'))
 from public.report_templates t where t.slug=case $1 when 'reports.polygenic' then 'family-copilot-poly-fixture' else 'family-copilot-mono-fixture' end; $$;
create function pg_temp.generate(purpose text) returns jsonb language plpgsql as $$
declare claim jsonb;
begin
 claim:=public.own_report_generation_with_mail_v1('begin','7a2c0000-0000-4000-8000-000000000001',
  '7a2c0000-0000-4000-8000-000000000011','7a2c0000-0000-4000-8000-000000000040',purpose);
 return public.own_report_generation_with_mail_v1('complete','7a2c0000-0000-4000-8000-000000000001',
  '7a2c0000-0000-4000-8000-000000000011','7a2c0000-0000-4000-8000-000000000040',purpose,(claim->>'claim')::uuid,pg_temp.output(purpose));
end; $$;
select pg_temp.grant_report('reports.polygenic',repeat('e',64));
select pg_temp.grant_report('reports.monogenic',repeat('f',64));
select is(pg_temp.generate('reports.polygenic')->>'status','complete','B completes the estimate layer through the real wrapper');
select is(pg_temp.generate('reports.monogenic')->>'status','complete','B completes the specific-variant layer through the real wrapper');

-- A's own local Copilot configuration and permission: the recipient every
-- group turn is bound to.
\ir fixtures/own_copilot_synthetic_settings.inc
select public.save_own_copilot_settings_v1('7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000012',
 pg_temp.synthetic_copilot_settings('synthetic-model','local'),null,repeat('b',64),null);
create temporary table a_presentation as select public.own_copilot_presentation_v1('7a2c0000-0000-4000-8000-000000000002',
 '7a2c0000-0000-4000-8000-000000000012',(select a_self from ids)) value;
select public.grant_own_copilot_v1('7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000012',
 (select a_self from ids),(select value->'snapshot' from a_presentation),(select value->'artifacts' from a_presentation),
 repeat('9',64),clock_timestamp()+interval '9 minutes');
create temporary table a_provider as select public.own_copilot_authority_v1('7a2c0000-0000-4000-8000-000000000002',
 '7a2c0000-0000-4000-8000-000000000012',(select a_self from ids)) value;
select is((select value->>'providerClass' from a_provider),'local','A holds a current local Copilot authority');

-- Grants B signs for a named recipient, through the real signing functions.
create function pg_temp.principal(account uuid) returns uuid language sql as $$
 select id from public.subject_principals where account_id=account and principal_kind='account_subject' and status='active'
 order by created_at limit 1; $$;
create function pg_temp.b_grants(purpose text,recipient uuid,nonce text) returns uuid language sql as $$
 select public.grant_directional_purpose_v1('7a2c0000-0000-4000-8000-000000000001',(select b_self from ids),
 pg_temp.principal(recipient),purpose,'consent.share-with-adult',1,nonce); $$;
create function pg_temp.b_shares(purpose text,recipient uuid,nonce text) returns uuid language sql as $$
 select public.grant_family_report_purpose_v1('7a2c0000-0000-4000-8000-000000000001',
 '7a2c0000-0000-4000-8000-000000000011',(select b_self from ids),pg_temp.principal(recipient),recipient,purpose,1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,
 public.family_report_grant_presentation_v1('7a2c0000-0000-4000-8000-000000000001',
  '7a2c0000-0000-4000-8000-000000000011',(select b_self from ids),recipient)); $$;
create function pg_temp.scope(account uuid,session uuid) returns jsonb language sql as $$
 select public.family_copilot_scope_v1(account,session); $$;
create function pg_temp.a_scope() returns jsonb language sql as $$
 select pg_temp.scope('7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000012'); $$;
create function pg_temp.chat(op text,chat uuid,payload jsonb) returns jsonb language sql as $$
 select public.family_copilot_chat_v1(op,'7a2c0000-0000-4000-8000-000000000002','7a2c0000-0000-4000-8000-000000000012',chat,payload); $$;
create function pg_temp.used(member jsonb,purposes text[]) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('authority',member,'purposes',to_jsonb(purposes),
  'files',(select jsonb_agg(jsonb_build_object('fileId','7a2c0000-0000-4000-8000-000000000040','purpose',p)) from unnest(purposes) p))); $$;
create function pg_temp.commit(chat uuid,used jsonb,last_ordinal integer,nonce text) returns jsonb language sql as $$
 select pg_temp.chat('commit',chat,jsonb_build_object('message','What did B share?','answer','B shared one estimate report.',
  'citations',jsonb_build_array(jsonb_build_object('id','person:'||(select b_self from ids),'label','Shared by B',
   'href','/family/s-'||(select b_self from ids))),
  'lastOrdinal',last_ordinal,'nonceHash',case when nonce is null then null else encode(extensions.digest(nonce,'sha256'),'hex') end,
  'expiresAt',case when nonce is null then null else to_jsonb(clock_timestamp()+interval '9 minutes') end,
  'provider',(select value from a_provider),'used',used)); $$;

select is(has_function_privilege('authenticated','public.family_copilot_scope_v1(uuid,uuid)','execute'),false,
 'no browser role can read the group');
select is(has_function_privilege('anon','public.family_copilot_chat_v1(text,uuid,uuid,uuid,jsonb)','execute'),false,
 'no browser role can reach the dispatcher');
select is(has_function_privilege('service_role','private.family_copilot_member_v1(uuid,uuid,uuid)','execute'),false,
 'the member check is reachable only through the service doors');
select is(pg_temp.a_scope(),'[]'::jsonb,'with nothing granted the group is empty');

-- Purpose isolation: sharing a result layer is not permission for Copilot.
create temporary table shared_estimate as select pg_temp.b_shares('reports.polygenic','7a2c0000-0000-4000-8000-000000000002',
 'fc-share-estimate-00000000000000') id;
create temporary table shared_heritability as select pg_temp.b_grants('family.heritability','7a2c0000-0000-4000-8000-000000000002',
 'fc-share-heritability-000000000') id;
select is(pg_temp.a_scope(),'[]'::jsonb,'a shared layer and Health picture without copilot.local open nothing to Copilot');
create temporary table shared_copilot as select pg_temp.b_grants('copilot.local','7a2c0000-0000-4000-8000-000000000002',
 'fc-share-copilot-00000000000000') id;
create temporary table member as select pg_temp.a_scope()->0 value;
select is(jsonb_array_length(pg_temp.a_scope()),1,'with copilot.local, Health picture and a layer, B is in A''s group');
select is((select value->>'subjectId' from member),(select b_self::text from ids),'the member is B''s own self subject');
select is((select value->'layers' from member),jsonb_build_array(jsonb_build_object('purpose','reports.polygenic',
 'grantId',(select id from shared_estimate),'grantRevision',1)),'only the shared layer is readable; the unshared layer is absent');
select is((select value#>>'{copilot,grantId}' from member),(select id::text from shared_copilot),'the exact copilot.local grant is bound');
select is((select value#>>'{heritability,grantId}' from member),(select id::text from shared_heritability),'the exact Health picture grant is bound');
select is(pg_temp.chat('check',null,jsonb_build_object('members',jsonb_build_array((select value from member)))),'true'::jsonb,
 'a current member passes the recheck');

-- A non-member cannot read the group, even holding A's member authority.
select is(pg_temp.scope('7a2c0000-0000-4000-8000-000000000003','7a2c0000-0000-4000-8000-000000000013'),'[]'::jsonb,
 'an unrelated adult''s group is empty');
select throws_ok($$select public.family_copilot_chat_v1('check','7a2c0000-0000-4000-8000-000000000003',
 '7a2c0000-0000-4000-8000-000000000013',null,jsonb_build_object('members',jsonb_build_array((select value from member))))$$,
 '42501','not_found','a non-member presenting another account''s member authority is refused');
select throws_ok($$select public.family_copilot_scope_v1('7a2c0000-0000-4000-8000-000000000002',
 '7a2c0000-0000-4000-8000-000000000013')$$,'42501','not_found','another account''s session cannot read A''s group');
savepoint copilot_only_to_c;
select pg_temp.b_grants('copilot.local','7a2c0000-0000-4000-8000-000000000003','fc-share-copilot-c-0000000000000');
select is(pg_temp.scope('7a2c0000-0000-4000-8000-000000000003','7a2c0000-0000-4000-8000-000000000013'),'[]'::jsonb,
 'copilot.local alone, with no shared layer or Health picture, opens nothing');
rollback to copilot_only_to_c;

-- A turn records exactly whose data it used.
select throws_ok($$select pg_temp.commit(null,pg_temp.used((select value from member),array['reports.monogenic']),0,'fc-nonce-0')$$,
 '42501','not_found','a turn cannot claim a layer that was not shared');
select throws_ok($$select pg_temp.chat('commit',null,jsonb_build_object('message','Q','answer','A','citations','[]'::jsonb,
 'lastOrdinal',0,'nonceHash',encode(extensions.digest('fc-nonce-x','sha256'),'hex'),'expiresAt',to_jsonb(clock_timestamp()+interval '9 minutes'),
 'provider',(select value from a_provider)||jsonb_build_object('providerClass','cloud'),'used','[]'::jsonb))$$,
 '42501','not_found','a group turn never commits under a cloud provider');
create temporary table first_turn as select (pg_temp.commit(null,pg_temp.used((select value from member),array['reports.polygenic']),0,'fc-nonce-1')->>'chatId')::uuid id;
select is((select scope_kind||':'||coalesce(family_pair_id::text,'none')||':'||(canonical_authority->>'scope') from public.chats
 where id=(select id from first_turn)),'family:none:family-group','the chat is an unanchored family group chat');
select is((select retrieved_subject_ids from public.chat_messages where chat_id=(select id from first_turn) and role='assistant'),
 array[(select b_self from ids)],'the answer names B''s subject as its only source');
select is((select retrieved_purpose_keys from public.chat_messages where chat_id=(select id from first_turn) and role='assistant'),
 array['copilot.local','family.heritability','reports.polygenic'],'the answer names every purpose it relied on');
select is((select contributor_ids from public.chat_messages where chat_id=(select id from first_turn) and role='user'),
 array['7a2c0000-0000-4000-8000-000000000001'::uuid],'both rows of the turn carry the same provenance');
select is((select count(*) from public.copilot_turn_dependencies where chat_id=(select id from first_turn)),6::bigint,
 'one dependency each: subject, copilot, Health picture, layer, own report grant, source file');
select is((select canonical_citations->0->>'label' from public.chat_messages where chat_id=(select id from first_turn) and role='assistant'),
 'Shared by B','per-answer provenance says whose data was used');
select throws_ok($$select pg_temp.commit(null,'[]'::jsonb,0,'fc-nonce-1')$$,'42501','not_found','the page context is single use');
select is(jsonb_array_length(pg_temp.chat('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider)))->'messages'),2,
 'A reads back the pair');
select is(jsonb_array_length(pg_temp.chat('list',null,'{}'::jsonb)),1,'A lists the conversation');
select throws_ok($$select public.family_copilot_chat_v1('history','7a2c0000-0000-4000-8000-000000000003',
 '7a2c0000-0000-4000-8000-000000000013',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider)))$$,
 '42501','not_found','another account cannot read A''s group conversation');
create temporary table second_turn as select pg_temp.commit((select id from first_turn),'[]'::jsonb,1,null) value;
select is((select retrieved_subject_ids from public.chat_messages where chat_id=(select id from first_turn) and turn_ordinal=2 and role='assistant'),
 '{}'::uuid[],'a turn whose tools returned nobody''s data names no one');

-- Pause: the group and the conversation go dark on the next query, and
-- come back on resume; nothing is deleted.
savepoint paused;
select public.pause_family_sharing_v1('7a2c0000-0000-4000-8000-000000000001','7a2c0000-0000-4000-8000-000000000002');
select is(pg_temp.a_scope(),'[]'::jsonb,'a pause removes B from the next scope read');
select throws_ok($$select pg_temp.chat('check',null,jsonb_build_object('members',jsonb_build_array((select value from member))))$$,
 '42501','not_found','a pause fails the recheck of a turn already in flight');
select is(pg_temp.chat('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider))),'null'::jsonb,
 'a paused conversation is unreadable');
select is(pg_temp.commit((select id from first_turn),'[]'::jsonb,2,null),'null'::jsonb,
 'no turn can be appended after a paused one');
select is((select count(*) from public.chat_messages where chat_id=(select id from first_turn)),4::bigint,'a pause deletes nothing');
select public.resume_family_sharing_v1('7a2c0000-0000-4000-8000-000000000001','7a2c0000-0000-4000-8000-000000000002');
select is(jsonb_array_length(pg_temp.chat('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider)))->'messages'),4,
 'resume restores the conversation');
rollback to paused;

-- Revocation mid-conversation: the next check refuses, the next commit
-- refuses, and the turns that used B are gone at once (brief item 19).
savepoint revoked;
select public.revoke_directional_purpose_v1('7a2c0000-0000-4000-8000-000000000001',(select id from shared_copilot));
select is(pg_temp.a_scope(),'[]'::jsonb,'a revoked copilot.local grant removes B from the next scope read');
select throws_ok($$select pg_temp.chat('check',null,jsonb_build_object('members',jsonb_build_array((select value from member))))$$,
 '42501','not_found','a revoked grant is not readable on the next check');
select throws_ok($$select pg_temp.commit(null,pg_temp.used((select value from member),array['reports.polygenic']),0,'fc-nonce-2')$$,
 '42501','not_found','a revoked grant cannot bind a new turn');
select is((select count(*) from public.chat_messages where user_id='7a2c0000-0000-4000-8000-000000000002'
 and retrieved_subject_ids && array[(select b_self from ids)]),0::bigint,'no message derived from B survives the revocation');
select is((select count(*) from public.chat_messages where chat_id=(select id from first_turn)),0::bigint,
 'the later turn built on B''s answer is deleted with it');
select is((select count(*) from public.copilot_turn_dependencies where chat_id=(select id from first_turn)),0::bigint,
 'no dependency row outlives the deleted turns');
select is(pg_temp.chat('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider))),'null'::jsonb,
 'the history endpoint answers not found');
rollback to revoked;

savepoint layer_revoked;
select public.revoke_directional_purpose_v1('7a2c0000-0000-4000-8000-000000000001',(select id from shared_estimate));
select is(pg_temp.a_scope(),'[]'::jsonb,'with its only layer withdrawn, B leaves the group');
select is((select count(*) from public.chat_messages where chat_id=(select id from first_turn) and turn_ordinal=1),0::bigint,
 'the turn that used the withdrawn layer is deleted');
rollback to layer_revoked;

-- B withdraws the own report purpose itself: no Family revocation helper
-- runs, so the dependency check ends and deletes the turn on the next read.
savepoint own_withdrawn;
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where target_id=(select b_self from ids) and artifact_key='consent.own-polygenic';
select is(pg_temp.chat('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider))),'null'::jsonb,
 'a conversation built on a withdrawn own report is unreadable');
select is((select count(*) from public.chat_messages where chat_id=(select id from first_turn)),0::bigint,
 'stale state deletes the whole dependent chain on the next read');
rollback to own_withdrawn;

savepoint provider_changed;
select throws_ok($$select pg_temp.chat('history',(select id from first_turn),jsonb_build_object('provider',
 (select value from a_provider)||jsonb_build_object('recipientRevision',99)))$$,'42501','not_found',
 'a changed model recipient cannot read the conversation');
rollback to provider_changed;

select is(private.valid_family_copilot_citations_v1('[{"id":"x","label":"x","href":"https://example.invalid/"}]'),false,
 'a reply cannot carry an arbitrary link');
select is(private.valid_family_copilot_citations_v1('[{"id":"x","label":"x","href":"/genome/me/reports/x"}]'),false,
 'a group reply never links to the asker''s own report as if it were shared');
select throws_ok($$insert into public.chats(user_id,scope_kind,lifecycle_revision,provider_classification,runtime_attestation_revision,
 model_recipient_revision,authorization_fingerprint,legacy_unverified,canonical_authority)
 values('7a2c0000-0000-4000-8000-000000000002','family',1,'local',1,1,repeat('a',64),true,null)$$,
 '23514',null,'an unanchored family chat must be a canonical group chat');

select * from finish();
rollback;
