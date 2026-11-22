begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Copilot for one other adult's record, the grantee case
-- (20261120130000_subject_copilot_scope.sql; owner decision of 19 November
-- 2026, "G8.5: Copilot for another adult's record opens"). Entirely
-- synthetic and rollback-only, built as the Family group suite builds its
-- adults: B prepares a real source and completes both own report layers
-- through the existing wrappers; A asks about B; C is an unrelated adult.
-- Every grant is signed through the real functions. The uploader case is
-- supabase/tests/subject_copilot_path_b.sql.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads) values(true,'http://127.0.0.1:54321/auth/v1',52428800,52428800,1073741824,32)
 on conflict(singleton) do update set maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes;
insert into auth.users(id,email,email_confirmed_at) values
 ('7a2d0000-0000-4000-8000-000000000001','subject-copilot-b@e2e.local',clock_timestamp()),
 ('7a2d0000-0000-4000-8000-000000000002','subject-copilot-a@e2e.local',clock_timestamp()),
 ('7a2d0000-0000-4000-8000-000000000003','subject-copilot-c@e2e.local',clock_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('7a2d0000-0000-4000-8000-000000000011','7a2d0000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('7a2d0000-0000-4000-8000-000000000012','7a2d0000-0000-4000-8000-000000000002',now(),now(),'aal1'),
 ('7a2d0000-0000-4000-8000-000000000013','7a2d0000-0000-4000-8000-000000000003',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id in('7a2d0000-0000-4000-8000-000000000001',
 '7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000003');
create temporary table ids as select
 (select id from public.subjects where subject_account_id='7a2d0000-0000-4000-8000-000000000001' and subject_class='self') b_self,
 (select id from public.subjects where subject_account_id='7a2d0000-0000-4000-8000-000000000002' and subject_class='self') a_self,
 (select id from public.subjects where subject_account_id='7a2d0000-0000-4000-8000-000000000003' and subject_class='self') c_self;
-- B's own later sign-in, as the Family group scope requires of an adult it reads.
update public.subjects set independent_login_at=clock_timestamp() where id=(select b_self from ids);

insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),account,session,'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from (values('a','7a2d0000-0000-4000-8000-000000000001'::uuid,'7a2d0000-0000-4000-8000-000000000011'::uuid),
  ('b','7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000011'),
  ('c','7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012'),
  ('d','7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012')) n(letter,account,session);
create function pg_temp.sign(account uuid,session uuid,subject uuid,artifact text,statement text,nonce text) returns jsonb language sql as $$
 select to_jsonb(public.sign_own_upload_artifact_v1(account,session,subject,artifact,1,
 (select body_sha256 from public.consent_artifacts where artifact_key=artifact and version=1),array[statement],1,1,1,1,1,nonce)); $$;
select pg_temp.sign('7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000011',(select b_self from ids),
 'disclosure.insurance-and-discrimination','understood',repeat('a',64));
select pg_temp.sign('7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000011',(select b_self from ids),
 'consent.upload-self','own-adult-dna',repeat('b',64));
select pg_temp.sign('7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',(select a_self from ids),
 'disclosure.insurance-and-discrimination','understood',repeat('c',64));
select pg_temp.sign('7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',(select a_self from ids),
 'consent.upload-self','own-adult-dna',repeat('d',64));

-- B's one real prepared source, with both own report layers completed.
insert into storage.objects(id,bucket_id,name,metadata) values('7a2d0000-0000-4000-8000-000000000020',
 'genomes','7a2d0000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('7a2d0000-0000-4000-8000-000000000040','7a2d0000-0000-4000-8000-000000000001',(select b_self from ids),
 '7a2d0000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'7a2d0000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('7a2d0000-0000-4000-8000-000000000020','7a2d0000-0000-4000-8000-000000000030','genomes',
 '7a2d0000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000011','7a2d0000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'7a2d0000-0000-4000-8000-000000000001',
 '7a2d0000-0000-4000-8000-000000000011','7a2d0000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload); $$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
insert into public.report_templates(slug,category,title,summary,evidence,layer,estimate_kind,variants,citations)
 values('subject-copilot-poly-fixture','basic-traits','Fixture estimate','Rollback-only estimate.','emerging','estimate','single_locus',
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]'),
 ('subject-copilot-mono-fixture','medicines','Fixture call','Rollback-only call.','emerging','variant_call',null,
 '[{"rsid":4988235,"gene":"X","chrom":2,"pos38":135851076,"ref":"G","alt":"A","interpretations":{"AG":"saved"}}]',
 '[{"pmid":"12345678","label":"fixture"}]');
insert into public.prs_scores(pgs_id,name,trait,n_variants,citation,source_url,ancestry_note)
 values('SUBJECT-COPILOT-FIXTURE','Fixture','Fixture',1,'{}','https://example.invalid/fixture','Synthetic fixture only');
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000011',
 (select b_self from ids),public.own_report_context_v1('7a2d0000-0000-4000-8000-000000000001',
 '7a2d0000-0000-4000-8000-000000000011',(select b_self from ids)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes'); $$;
create function pg_temp.output(purpose text) returns jsonb language sql as $$
 select jsonb_build_object('reports',jsonb_build_array(jsonb_build_object('slug',t.slug,'covered',true,'conflictingRsids','[]'::jsonb,
  'variants','[{"rsid":4988235,"outcome":{"status":"genotyped","genotype":"AG","interpretation":"saved","strandFlipped":false}}]'::jsonb,
  'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,'title',t.title,
   'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)))),
  'prs',case $1 when 'reports.polygenic' then '[{"pgs_id":"SUBJECT-COPILOT-FIXTURE","raw_score":0,"coverage":1,"matched":1}]'::jsonb else '[]'::jsonb end,
  'readyMail',jsonb_build_object('contactRevision',1,'contactCiphertext',repeat('ab',40),'contactHmac',repeat('e',64),
   'dashboardUrl','https://example.invalid/genome/me/reports'))
 from public.report_templates t where t.slug=case $1 when 'reports.polygenic' then 'subject-copilot-poly-fixture' else 'subject-copilot-mono-fixture' end; $$;
create function pg_temp.generate(purpose text) returns jsonb language plpgsql as $$
declare claim jsonb;
begin
 claim:=public.own_report_generation_with_mail_v1('begin','7a2d0000-0000-4000-8000-000000000001',
  '7a2d0000-0000-4000-8000-000000000011','7a2d0000-0000-4000-8000-000000000040',purpose);
 return public.own_report_generation_with_mail_v1('complete','7a2d0000-0000-4000-8000-000000000001',
  '7a2d0000-0000-4000-8000-000000000011','7a2d0000-0000-4000-8000-000000000040',purpose,(claim->>'claim')::uuid,pg_temp.output(purpose));
end; $$;
select pg_temp.grant_report('reports.polygenic',repeat('e',64));
select pg_temp.grant_report('reports.monogenic',repeat('f',64));
select is(pg_temp.generate('reports.polygenic')->>'status','complete','B completes the estimate layer through the real wrapper');
select is(pg_temp.generate('reports.monogenic')->>'status','complete','B completes the specific-variant layer through the real wrapper');

-- A's own local Copilot configuration and permission: the one model recipient.
\ir fixtures/own_copilot_synthetic_settings.inc
select public.save_own_copilot_settings_v1('7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',
 pg_temp.synthetic_copilot_settings('synthetic-model','local'),null,repeat('b',64),null);
create temporary table a_presentation as select public.own_copilot_presentation_v1('7a2d0000-0000-4000-8000-000000000002',
 '7a2d0000-0000-4000-8000-000000000012',(select a_self from ids)) value;
select public.grant_own_copilot_v1('7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',
 (select a_self from ids),(select value->'snapshot' from a_presentation),(select value->'artifacts' from a_presentation),
 repeat('9',64),clock_timestamp()+interval '9 minutes');
create temporary table a_provider as select public.own_copilot_authority_v1('7a2d0000-0000-4000-8000-000000000002',
 '7a2d0000-0000-4000-8000-000000000012',(select a_self from ids)) value;
select is((select value->>'providerClass' from a_provider),'local','A holds a current local Copilot authority');

create function pg_temp.principal(account uuid) returns uuid language sql as $$
 select id from public.subject_principals where account_id=account and principal_kind='account_subject' and status='active'
 order by created_at limit 1; $$;
-- copilot.local through the person-to-person permissions door, unchanged.
create function pg_temp.b_grants(purpose text,recipient uuid,nonce text) returns uuid language sql as $$
 select public.grant_directional_purpose_v1('7a2d0000-0000-4000-8000-000000000001',(select b_self from ids),
 pg_temp.principal(recipient),purpose,'consent.share-with-adult',1,nonce); $$;
create function pg_temp.b_shares(purpose text,recipient uuid,nonce text) returns uuid language sql as $$
 select public.grant_family_report_purpose_v1('7a2d0000-0000-4000-8000-000000000001',
 '7a2d0000-0000-4000-8000-000000000011',(select b_self from ids),pg_temp.principal(recipient),recipient,purpose,1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.share-with-adult' and version=1),nonce,
 public.family_report_grant_presentation_v1('7a2d0000-0000-4000-8000-000000000001',
  '7a2d0000-0000-4000-8000-000000000011',(select b_self from ids),recipient)); $$;
create function pg_temp.scope(account uuid,session uuid,subject uuid) returns jsonb language sql as $$
 select public.subject_copilot_scope_v1(account,session,subject); $$;
create function pg_temp.a_scope() returns jsonb language sql as $$
 select pg_temp.scope('7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',(select b_self from ids)); $$;
create function pg_temp.chat(op text,chat uuid,payload jsonb,subject uuid default null) returns jsonb language sql as $$
 select public.subject_copilot_chat_v1(op,'7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',
  coalesce(subject,case when chat is null then (select b_self from ids) end),chat,payload); $$;
create function pg_temp.used(authority jsonb,purposes text[]) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('authority',authority,'purposes',to_jsonb(purposes),
  'files',(select jsonb_agg(jsonb_build_object('fileId','7a2d0000-0000-4000-8000-000000000040','purpose',p)) from unnest(purposes) p))); $$;
create function pg_temp.commit(chat uuid,authority jsonb,used jsonb,last_ordinal integer,nonce text) returns jsonb language sql as $$
 select pg_temp.chat('commit',chat,jsonb_build_object('message','What did B share?','answer','B shared one estimate report.',
  'citations',jsonb_build_array(jsonb_build_object('id','person:s-'||(select b_self from ids),'label','Shared by B',
   'href','/family/s-'||(select b_self from ids))),
  'lastOrdinal',last_ordinal,'nonceHash',case when nonce is null then null else encode(extensions.digest(nonce,'sha256'),'hex') end,
  'expiresAt',case when nonce is null then null else to_jsonb(clock_timestamp()+interval '9 minutes') end,
  'provider',(select value from a_provider),'authority',authority,'used',used)); $$;
create function pg_temp.history(chat uuid) returns jsonb language sql as $$
 select pg_temp.chat('history',chat,jsonb_build_object('provider',(select value from a_provider))); $$;
create function pg_temp.from_b() returns bigint language sql as $$
 select count(*) from public.chat_messages where user_id='7a2d0000-0000-4000-8000-000000000002'
  and retrieved_subject_ids && array[(select b_self from ids)]; $$;

-- 1. Who may call what ---------------------------------------------------------------
select ok(not has_function_privilege('authenticated','public.subject_copilot_scope_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.subject_copilot_scope_v1(uuid,uuid,uuid)','execute')
 and not has_function_privilege('inherit_upload_only','public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)','execute'),
 'no browser or upload role can read the scope or reach the dispatcher');
select ok(has_function_privilege('service_role','public.subject_copilot_scope_v1(uuid,uuid,uuid)','execute')
 and has_function_privilege('service_role','public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)','execute'),
 'the service role reaches the two doors');
select is((select coalesce(string_agg(p.oid::regprocedure::text,', '),'') from pg_proc p
 where p.pronamespace='private'::regnamespace and p.proname in ('subject_copilot_uploader_grant_v1','subject_copilot_authority_v1',
  'subject_copilot_prune_v1','purge_subject_copilot_chats_v1')
  and (has_function_privilege('service_role',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),'',
 'the scope decision, the prune and the purge are reachable only through the service doors');
select ok((select prosecdef and proconfig=array['search_path=""'] from pg_proc
 where oid='public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)'::regprocedure),
 'the dispatcher runs as its definer with an empty search path');

-- 2. The register's gates for a grantee, in order ------------------------------------
select is(pg_temp.a_scope(),'{"state":"permission-missing"}'::jsonb,'with nothing granted, Copilot reads nothing about B');
create temporary table shared_estimate as select pg_temp.b_shares('reports.polygenic','7a2d0000-0000-4000-8000-000000000002',
 'sc-share-estimate-00000000000000') id;
select is(pg_temp.a_scope(),'{"state":"permission-missing"}'::jsonb,
 'a shared report layer without copilot.local is no permission for Copilot');
create temporary table shared_copilot as select pg_temp.b_grants('copilot.local','7a2d0000-0000-4000-8000-000000000002',
 'sc-share-copilot-00000000000000') id;
select is(pg_temp.a_scope()->>'state','ready','with copilot.local and one report layer the scope opens; Health picture is not needed');
create temporary table authority as select pg_temp.a_scope()->'authority' value;
select is((select value->>'case' from authority),'grantee','B''s own record is the grantee case');
select is((select value->>'subjectId' from authority),(select b_self::text from ids),'the scope reads B''s own self record');
select is((select value->>'accountId' from authority),'7a2d0000-0000-4000-8000-000000000001','the record belongs to B''s account');
select is((select value->'layers' from authority),jsonb_build_array(jsonb_build_object('purpose','reports.polygenic',
 'grantId',(select id from shared_estimate),'grantRevision',1)),'only the shared layer is readable; B''s unshared layer is absent');
select is((select value#>>'{copilot,grantId}' from authority),(select id::text from shared_copilot),'the exact copilot.local grant is bound');
-- The grant the permissions door wrote is the register's: signed by B's exact
-- current principal, for A over the current family relationship and revision.
select ok((select pg.signer_principal_id=pg_temp.principal('7a2d0000-0000-4000-8000-000000000001')
 and pg.data_subject_principal_id=pg.signer_principal_id and cs.signer_account_id='7a2d0000-0000-4000-8000-000000000001'
 and dg.direction='subject_to_recipient' and dg.recipient_account_id='7a2d0000-0000-4000-8000-000000000002'
 and dg.recipient_principal_id=pg_temp.principal('7a2d0000-0000-4000-8000-000000000002')
 and r.relationship_kind='family_member' and r.status='current' and dg.relationship_or_pair_revision=r.relationship_revision
 and pg.artifact_key='consent.share-with-adult'
 from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 join public.consent_signatures cs on cs.id=pg.signature_id join public.subject_relationships r on r.id=dg.relationship_id
 where pg.grant_id=(select id from shared_copilot)),
 'copilot.local is signed by the exact current adult subject principal for this recipient relationship');
select is(pg_temp.chat('check',null,jsonb_build_object('authority',(select value from authority))),'true'::jsonb,
 'a current authority passes the recheck');

-- 3. Nobody else, and nothing else ------------------------------------------------------
select is(pg_temp.scope('7a2d0000-0000-4000-8000-000000000003','7a2d0000-0000-4000-8000-000000000013',(select b_self from ids)),
 '{"state":"permission-missing"}'::jsonb,'an unrelated adult has no permission to B''s record');
select throws_ok($$select public.subject_copilot_chat_v1('check','7a2d0000-0000-4000-8000-000000000003',
 '7a2d0000-0000-4000-8000-000000000013',(select b_self from ids),null,jsonb_build_object('authority',(select value from authority)))$$,
 '42501','not_found','another account presenting A''s authority is refused');
select throws_ok($$select pg_temp.scope('7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000013',(select b_self from ids))$$,
 '42501','not_found','another account''s session cannot read A''s scope');
select throws_ok($$select pg_temp.scope('7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',(select a_self from ids))$$,
 '42501','not_found','the asker''s own record is not this scope');
select throws_ok($$select pg_temp.scope('7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',gen_random_uuid())$$,
 '42501','not_found','an unknown record is not found');
select throws_ok($$select pg_temp.chat('check',null,jsonb_build_object('authority',(select value from authority)),(select c_self from ids))$$,
 '42501','not_found','an authority for B cannot be checked against another person''s record');
savepoint copilot_only;
select public.revoke_directional_purpose_v1('7a2d0000-0000-4000-8000-000000000001',(select id from shared_estimate));
select is(pg_temp.a_scope(),'{"state":"permission-missing"}'::jsonb,'copilot.local with no shared report layer opens nothing');
rollback to copilot_only;
savepoint not_independent;
update public.subjects set independent_login_at=null where id=(select b_self from ids);
select is(pg_temp.a_scope(),'{"state":"permission-missing"}'::jsonb,'as for the Family group, an adult is read only after their own sign-in');
rollback to not_independent;

-- 4. A turn is bound to the record, its Copilot grant and what it read -------------------
select throws_ok($$select pg_temp.commit(null,(select value from authority),pg_temp.used((select value from authority),array['reports.monogenic']),0,'sc-nonce-0')$$,
 '42501','not_found','a turn cannot claim a layer that was not shared');
select throws_ok($$select pg_temp.chat('commit',null,jsonb_build_object('message','Q','answer','A','citations','[]'::jsonb,
 'lastOrdinal',0,'nonceHash',encode(extensions.digest('sc-nonce-x','sha256'),'hex'),'expiresAt',to_jsonb(clock_timestamp()+interval '9 minutes'),
 'provider',(select value from a_provider)||jsonb_build_object('providerClass','cloud'),'authority',(select value from authority),'used','[]'::jsonb))$$,
 '42501','not_found','a turn never commits under a cloud provider');
select throws_ok($$select pg_temp.commit(null,(select value from authority)||jsonb_build_object('lifecycleRevision',99),'[]'::jsonb,0,'sc-nonce-y')$$,
 '42501','not_found','a turn bound to any other authority is refused');
select throws_ok($$select pg_temp.chat('commit',null,jsonb_build_object('message','Q','answer','A','citations',
 '[{"id":"x","label":"x","href":"https://example.invalid/"}]'::jsonb,'lastOrdinal',0,'nonceHash',encode(extensions.digest('sc-nonce-z','sha256'),'hex'),
 'expiresAt',to_jsonb(clock_timestamp()+interval '9 minutes'),'provider',(select value from a_provider),'authority',(select value from authority),'used','[]'::jsonb))$$,
 '22023','invalid_request','an answer carries only the closed set of links');
create temporary table first_turn as select (pg_temp.commit(null,(select value from authority),
 pg_temp.used((select value from authority),array['reports.polygenic']),0,'sc-nonce-1')->>'chatId')::uuid id;
select is((select scope_kind||':'||subject_id::text||':'||(canonical_authority->>'scope')||':'||(canonical_authority->>'relationship')||':'||provider_classification
 from public.chats where id=(select id from first_turn)),'subject:'||(select b_self::text from ids)||':subject-adult:grantee:local',
 'the conversation is a canonical subject chat about B''s record, on the local model');
select is((select array_agg(distinct retrieved_subject_ids::text) from public.chat_messages where chat_id=(select id from first_turn)),
 array[array[(select b_self from ids)]::text],'both rows of the turn name B''s record as their only source');
select is((select retrieved_purpose_keys from public.chat_messages where chat_id=(select id from first_turn) and role='assistant'),
 array['copilot.local','reports.polygenic'],'the answer names every purpose it relied on');
select is((select contributor_ids from public.chat_messages where chat_id=(select id from first_turn) and role='user'),
 array['7a2d0000-0000-4000-8000-000000000001'::uuid],'the question row carries the same provenance');
select is((select count(*) from public.copilot_turn_dependencies where chat_id=(select id from first_turn)),5::bigint,
 'one dependency each: the record, copilot.local, the layer, B''s own report grant and the source');
select throws_ok($$select pg_temp.commit(null,(select value from authority),'[]'::jsonb,0,'sc-nonce-1')$$,'42501','not_found',
 'the page context is single use');
select is(jsonb_array_length(pg_temp.history((select id from first_turn))->'messages'),2,'A reads back the pair');
select is(jsonb_array_length(pg_temp.chat('list',null,'{}'::jsonb)),1,'A lists the conversation on B''s page');
select is(pg_temp.chat('list',null,'{}'::jsonb,(select c_self from ids)),'[]'::jsonb,'it is listed under no other record');
select throws_ok($$select public.subject_copilot_chat_v1('history','7a2d0000-0000-4000-8000-000000000003',
 '7a2d0000-0000-4000-8000-000000000013',null,(select id from first_turn),jsonb_build_object('provider',(select value from a_provider)))$$,
 '42501','not_found','another account cannot read A''s conversation');
select throws_ok($$select pg_temp.chat('history',(select id from first_turn),jsonb_build_object('provider',(select value from a_provider)),(select c_self from ids))$$,
 '42501','not_found','a conversation is read only under its own record');
select throws_ok($$select public.family_copilot_chat_v1('history','7a2d0000-0000-4000-8000-000000000002','7a2d0000-0000-4000-8000-000000000012',
 (select id from first_turn),jsonb_build_object('provider',(select value from a_provider)))$$,'42501','not_found',
 'the Family group dispatcher does not read a subject conversation');
create temporary table second_turn as select pg_temp.commit((select id from first_turn),(select value from authority),'[]'::jsonb,1,null) value;
select is((select retrieved_subject_ids from public.chat_messages where chat_id=(select id from first_turn) and turn_ordinal=2 and role='assistant'),
 array[(select b_self from ids)],'a turn whose tools returned nothing is still bound to B''s record');
select is((select retrieved_purpose_keys from public.chat_messages where chat_id=(select id from first_turn) and turn_ordinal=2 and role='assistant'),
 array['copilot.local'],'and to B''s Copilot grant');
savepoint provider_changed;
select throws_ok($$select pg_temp.chat('history',(select id from first_turn),jsonb_build_object('provider',
 (select value from a_provider)||jsonb_build_object('recipientRevision',99)))$$,'42501','not_found',
 'a changed model recipient cannot read the conversation');
rollback to provider_changed;

-- 5. Each way access ends, at the next request -------------------------------------------
savepoint paused;
select public.pause_family_sharing_v1('7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000002');
select is(pg_temp.a_scope(),'{"state":"permission-missing"}'::jsonb,'a pause closes the scope on the next read');
select throws_ok($$select pg_temp.chat('check',null,jsonb_build_object('authority',(select value from authority)))$$,
 '42501','not_found','a pause fails the recheck of a turn already in flight');
select is(pg_temp.history((select id from first_turn)),'null'::jsonb,'a paused conversation is unreadable');
select is(pg_temp.chat('list',null,'{}'::jsonb),'[]'::jsonb,'and is not listed');
select is((select count(*) from public.chat_messages where chat_id=(select id from first_turn)),4::bigint,'a pause deletes nothing');
select public.resume_family_sharing_v1('7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000002');
select is(jsonb_array_length(pg_temp.history((select id from first_turn))->'messages'),4,'resume restores the conversation');
rollback to paused;

savepoint copilot_revoked;
select public.revoke_directional_purpose_v1('7a2d0000-0000-4000-8000-000000000001',(select id from shared_copilot));
select is(pg_temp.a_scope(),'{"state":"permission-missing"}'::jsonb,'a revoked copilot.local closes the scope on the next read');
select throws_ok($$select pg_temp.chat('check',null,jsonb_build_object('authority',(select value from authority)))$$,
 '42501','not_found','a revoked copilot.local fails the recheck of a turn in flight');
select is(pg_temp.from_b(),0::bigint,'no message derived from B survives the revocation (derived.revocation-60s, synchronously)');
select is((select count(*) from public.copilot_turn_dependencies where chat_id=(select id from first_turn)),0::bigint,
 'no dependency row outlives the deleted turns');
select is(pg_temp.history((select id from first_turn)),'null'::jsonb,'the history endpoint answers not found');
rollback to copilot_revoked;

savepoint layer_revoked;
select public.revoke_directional_purpose_v1('7a2d0000-0000-4000-8000-000000000001',(select id from shared_estimate));
select is(pg_temp.a_scope(),'{"state":"permission-missing"}'::jsonb,'with its only layer withdrawn, the scope closes');
select is((select count(*) from public.chat_messages where chat_id=(select id from first_turn)),0::bigint,
 'the turn that read the withdrawn layer, and the turn built on it, are deleted');
rollback to layer_revoked;

savepoint stopped;
select public.stop_family_sharing_v1('7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000002');
select is(pg_temp.a_scope(),'{"state":"permission-missing"}'::jsonb,'stopping sharing closes the scope');
select is(pg_temp.from_b(),0::bigint,'stopping sharing removes every turn built on B''s record');
rollback to stopped;

savepoint emptied;
update public.genome_files set status='stored' where id='7a2d0000-0000-4000-8000-000000000040';
select public.delete_subject_v1('7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000011',(select b_self from ids),
 encode(extensions.digest('subject-copilot-delete','sha256'),'hex'),clock_timestamp()+interval '5 minutes');
select is((select count(*) from public.chats where subject_id=(select b_self from ids)),0::bigint,
 'when B empties their record, every conversation about it is deleted, A''s included');
select is(pg_temp.from_b(),0::bigint,'and no message that read it survives');
select is((select count(*) from public.copilot_context_tokens where target_id=(select b_self from ids)),0::bigint,
 'and no context token naming it survives');
rollback to emptied;

savepoint withdrawn;
update public.genome_files set status='stored' where id='7a2d0000-0000-4000-8000-000000000040';
select public.empty_self_subject_with_notice_v1('7a2d0000-0000-4000-8000-000000000001','7a2d0000-0000-4000-8000-000000000011',
 (select b_self from ids),encode(extensions.digest('subject-copilot-withdraw','sha256'),'hex'),clock_timestamp()+interval '5 minutes',
 jsonb_build_object('contactCiphertext',repeat('ab',40),'contactHmac',repeat('c',64),'contactRevision',1));
select is((select count(*) from public.chats where subject_id=(select b_self from ids)),0::bigint,
 'when B withdraws their own-file consent, every conversation about the record is deleted');
select is(pg_temp.from_b(),0::bigint,'and no message that read it survives');
rollback to withdrawn;

-- 6. The table's own rules still hold --------------------------------------------------
select throws_ok($$update public.chats set subject_id=(select c_self from ids) where id=(select id from first_turn)$$,
 '23514','chat scope is immutable','a conversation cannot be moved to another record');

select * from finish();
rollback;
