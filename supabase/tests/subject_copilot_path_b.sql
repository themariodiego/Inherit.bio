-- Copilot for one other adult's record, the uploader case, and the Path B
-- person's copilot.local choice (20261120130000_subject_copilot_scope.sql;
-- owner decision of 19 November 2026, "G8.5: Copilot for another adult's
-- record opens"). Synthetic and rollback-only: 01 adds a file for 02, who
-- confirms with their own account, shares one report layer with 01, and the
-- registered Path B workers' SQL doors normalize the file and complete that
-- one shared report. 09 is an outsider.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc
\ir fixtures/own_copilot_synthetic_settings.inc

-- Accounts that existed before the request, so no 72-hour hold applies.
update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
update public.report_templates set status='review' where status='published';
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants,citations)
 values('synthetic-copilot-path-b-variant','synthetic','Synthetic variant','Synthetic queued-report fixture.',
  'published','emerging','variant_call',null,
  '[{"rsid":123,"gene":"SYNTHETIC","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AG":"Synthetic covered genotype"}}]',
  '[{"pmid":"12345678","label":"fixture"}]');
create function pg_temp.own_sign(p_account text,p_artifact text,p_statement text,p_nonce text) returns jsonb language plpgsql as $$
declare c jsonb; v_subject uuid; a public.consent_artifacts%rowtype;
begin
 select id into strict v_subject from public.subjects where subject_class='self' and subject_account_id=pg_temp.a(p_account);
 c:=private.own_upload_context_v1(pg_temp.a(p_account),pg_temp.s(p_account),v_subject);
 select * into strict a from public.consent_artifacts where artifact_key=p_artifact and superseded_at is null;
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
  values(repeat(p_nonce,64),pg_temp.a(p_account),pg_temp.s(p_account),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
 return public.sign_own_upload_artifact_v1(pg_temp.a(p_account),pg_temp.s(p_account),v_subject,a.artifact_key,a.version,a.body_sha256,
  array[p_statement],(c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,(c->>'jurisdictionRevision')::bigint,
  (c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,repeat(p_nonce,64));
end;
$$;
select pg_temp.own_sign('1','disclosure.insurance-and-discrimination','understood','9');
select pg_temp.own_sign('1','consent.upload-self','own-adult-dna','8');
select pg_temp.own_sign('2','disclosure.insurance-and-discrimination','understood','0');
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','sc-sign-aaaaaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 'fixture: the person confirms the request with their own account');
select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64));
create function pg_temp.share(p_purpose text,p_direction text,p_nonce text,p_account text default '2') returns jsonb language sql as $$
 select public.grant_path_b_purpose_v1(pg_temp.a(p_account),pg_temp.s(p_account),pg_temp.sid('main'),p_purpose,p_direction,a.version,
  a.body_sha256,repeat(p_nonce,64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key=case when p_direction='uploader' then 'consent.share-with-adult'
  when p_purpose='reports.monogenic' then 'consent.own-monogenic' else 'consent.own-polygenic' end and a.superseded_at is null;
$$;
create temporary table grants(name text primary key,id uuid);
insert into grants select 'variant',(pg_temp.share('reports.monogenic','uploader','6')->>'recordId')::uuid;
select pg_temp.notice_session('main','1');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'sc-confirm-1111111111111111111','confirm',pg_temp.a('2')),
 'confirmed','fixture: the person confirms the file');
create temporary table source_claim as select public.path_b_normalization_v1('claim',null,repeat('7',64),null,null,true) c;
select is((select c->>'fileId' from source_claim),pg_temp.fxv('main','revision'),'fixture: the claim is this file''s');
select public.path_b_normalization_v1('stage',(c->>'jobId')::uuid,repeat('7',64),(c->>'claim')::uuid,
 '{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}',true) from source_claim;
select public.path_b_normalization_v1('complete',(c->>'jobId')::uuid,repeat('7',64),(c->>'claim')::uuid,
 jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('e',64),'decodedSha256',repeat('b',64),
  'variantCount',1,'observedCallCount',0,'provenance',jsonb_build_object('version','path-b-normalization-v1',
   'sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)),true) from source_claim;
create temporary table report_claim as select public.path_b_report_v1('claim',null,repeat('8',64),null,null,true) c;
create function pg_temp.report(p_operation text,p_payload jsonb default null) returns jsonb language sql as $$
 select public.path_b_report_v1(p_operation,(c->>'jobId')::uuid,repeat('8',64),(c->>'claim')::uuid,p_payload,true) from report_claim;
$$;
select pg_temp.report('stage',(select jsonb_build_object('reports',jsonb_agg(jsonb_build_object('slug',t.slug,'covered',true,
  'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,
   'title',t.title,'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,
   'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)),
  'variants',jsonb_build_array(jsonb_build_object('rsid',123,'outcome',jsonb_build_object('status','genotyped','genotype','AG',
   'interpretation','Synthetic covered genotype','strandFlipped',false))),'conflictingRsids','[]'::jsonb)),'prs','[]'::jsonb)
 from public.report_templates t where t.slug='synthetic-copilot-path-b-variant'));
select is(pg_temp.report('complete')->>'status','complete','fixture: the shared report is completed for the uploader');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('main'),'reports.monogenic'),'{"allowed":true,"gate":"ready"}'::jsonb,
 'fixture: the uploader''s own read decision is ready for the shared layer');

-- The uploader's own local Copilot configuration and permission.
create temporary table uploader_self as select id from public.subjects where subject_account_id=pg_temp.a('1') and subject_class='self';
select public.save_own_copilot_settings_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.synthetic_copilot_settings('synthetic-model','local'),
 null,repeat('b',64),null);
create temporary table presentation as select public.own_copilot_presentation_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self)) value;
select public.grant_own_copilot_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self),(select value->'snapshot' from presentation),
 (select value->'artifacts' from presentation),repeat('9',64),clock_timestamp()+interval '9 minutes');
create temporary table provider as select public.own_copilot_authority_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self)) value;
select is((select value->>'providerClass' from provider),'local','fixture: the uploader holds a current local Copilot authority');

create function pg_temp.scope(p_account text default '1') returns jsonb language sql as $$
 select public.subject_copilot_scope_v1(pg_temp.a(p_account),pg_temp.s(p_account),pg_temp.sid('main')); $$;
create function pg_temp.chat(op text,chat uuid,payload jsonb) returns jsonb language sql as $$
 select public.subject_copilot_chat_v1(op,pg_temp.a('1'),pg_temp.s('1'),case when chat is null then pg_temp.sid('main') end,chat,payload); $$;
create function pg_temp.commit(chat uuid,authority jsonb,purposes text[],last_ordinal integer,nonce text) returns jsonb language sql as $$
 select pg_temp.chat('commit',chat,jsonb_build_object('message','What did they share?','answer','One saved report.',
  'citations',jsonb_build_array(jsonb_build_object('id','report:x','label','Synthetic variant (shared by Synthetic Relative)',
   'href','/genome/s-'||pg_temp.sid('main')||'/reports/synthetic-copilot-path-b-variant')),
  'lastOrdinal',last_ordinal,'nonceHash',case when nonce is null then null else encode(extensions.digest(nonce,'sha256'),'hex') end,
  'expiresAt',case when nonce is null then null else to_jsonb(clock_timestamp()+interval '9 minutes') end,
  'provider',(select value from provider),'authority',authority,
  'used',case when cardinality(purposes)=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('authority',authority,
   'purposes',to_jsonb(purposes),'files',(select jsonb_agg(jsonb_build_object('fileId',pg_temp.fxv('main','revision'),'purpose',p))
    from unnest(purposes) p))) end)); $$;
create function pg_temp.history(chat uuid) returns jsonb language sql as $$
 select pg_temp.chat('history',chat,jsonb_build_object('provider',(select value from provider))); $$;
create function pg_temp.read_record() returns bigint language sql as $$
 select count(*) from public.chat_messages where user_id=pg_temp.a('1') and retrieved_subject_ids && array[pg_temp.sid('main')]; $$;

-- 1. The person's Copilot choice ---------------------------------------------------------
select is(pg_temp.scope(),'{"state":"permission-missing"}'::jsonb,'a shared layer alone is no permission for the uploader''s Copilot');
select throws_ok($$select pg_temp.share('copilot.local','self','5')$$,'22023','invalid_request',
 'copilot.local has no "for you" row: it is a choice for the person who added the file only');
select throws_ok($$select public.grant_path_b_purpose_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),'copilot.local','uploader',
 a.version,a.body_sha256,repeat('4',64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key='consent.share-with-adult' and a.superseded_at is null$$,
 '42501','not_found','the uploader cannot sign the person''s Copilot choice for themselves');
select throws_ok($$select pg_temp.share('copilot.local','uploader','3','9')$$,'42501','not_found',
 'nor can an outsider');
select throws_ok($$select public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'copilot.local','uploader',
 a.version,a.body_sha256,repeat('2',64),clock_timestamp()+interval '5 minutes',false)
 from public.consent_artifacts a where a.artifact_key='consent.share-with-adult' and a.superseded_at is null$$,
 '42501','not_found','outside the test jurisdiction the door stays closed');
savepoint forged;
-- A copilot.local grant on the record that the person did not sign: no door
-- writes one (above), so its rows are written directly, signed by the
-- uploader's own principal over the uploader relationship.
create temporary table forged_signature as
 select gen_random_uuid() id,up.id principal,s.subject_binding_revision binding,pr.jurisdiction_revision jurisdiction,
  r.id relationship,r.relationship_revision relationship_revision,a.artifact_key,a.version,a.body_sha256
 from public.subjects s join public.subject_relationships r on r.subject_id=s.id and r.relationship_kind='uploader' and r.status='current'
 join public.subject_principals up on up.id=r.recipient_principal_id join public.profiles pr on pr.id=pg_temp.a('1')
 join public.consent_artifacts a on a.artifact_key='consent.share-with-adult' and a.superseded_at is null
 where s.id=pg_temp.sid('main');
insert into public.consent_signatures(id,artifact_key,artifact_version,artifact_body_sha256,signer_principal_id,signer_account_id,
 target_kind,target_id,purpose,statement_keys,jurisdiction_code,jurisdiction_revision,subject_binding_revision)
 select id,artifact_key,version,body_sha256,principal,pg_temp.a('1'),'subject',pg_temp.sid('main'),'copilot.local',
  array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time'],'GB',jurisdiction,binding from forged_signature;
with g as (insert into public.purpose_grants(grant_revision,target_kind,target_id,purpose,artifact_key,artifact_version,
 artifact_body_sha256,signature_id,signer_principal_id,data_subject_principal_id,subject_binding_revision,jurisdiction_code,jurisdiction_revision)
 select 1,'subject',pg_temp.sid('main'),'copilot.local',artifact_key,version,body_sha256,id,principal,principal,binding,'GB',jurisdiction
 from forged_signature returning grant_id)
insert into public.directional_grants(grant_id,grant_revision,recipient_principal_id,recipient_account_id,relationship_id,
 relationship_or_pair_revision,direction)
 select g.grant_id,1,f.principal,pg_temp.a('1'),f.relationship,f.relationship_revision,'subject_to_recipient' from g,forged_signature f;
select is(pg_temp.scope(),'{"state":"permission-missing"}'::jsonb,
 'a copilot.local grant signed by anyone but the person, the uploader included, opens nothing');
rollback to forged;
insert into grants select 'copilot',(pg_temp.share('copilot.local','uploader','1')->>'recordId')::uuid;
select ok((select pg.purpose='copilot.local' and pg.artifact_key='consent.share-with-adult'
 and pg.signer_principal_id=pg.data_subject_principal_id and sp.account_id=pg_temp.a('2') and sp.principal_kind='account_subject'
 and cs.signer_account_id=pg_temp.a('2')
 and cs.statement_keys=array['one-purpose','one-named-adult','own-account','pause-or-stop-any-time']
 and dg.direction='subject_to_recipient' and dg.recipient_account_id=pg_temp.a('1')
 and r.relationship_kind='uploader' and r.status='current' and dg.relationship_or_pair_revision=r.relationship_revision
 from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 join public.subject_principals sp on sp.id=pg.data_subject_principal_id join public.consent_signatures cs on cs.id=pg.signature_id
 join public.subject_relationships r on r.id=dg.relationship_id where pg.grant_id=(select id from grants where name='copilot')),
 'the person signs copilot.local for the uploader as their own current principal, over the uploader relationship');
select is((select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('main')),1::bigint,
 'turning Copilot on queues no analysis');
select ok((select jsonb_path_exists(public.path_b_person_choices_v1(pg_temp.a('2'),pg_temp.s('2'),true),
 '$[*].grants[*] ? (@.purpose == "copilot.local" && @.direction == "uploader")')),
 'the person''s choices list the Copilot choice beside the result layers');

-- 2. The scope, in the register's order ---------------------------------------------------
select is(pg_temp.scope()->>'state','ready','with copilot.local and one shared report layer the uploader''s scope opens');
create temporary table authority as select pg_temp.scope()->'authority' value;
select is((select value->>'case' from authority),'uploader','a Path B record the asker added is the uploader case');
select is((select value->>'accountId' from authority),pg_temp.a('2')::text,'the record is held by the person''s own account');
select is((select value->'layers' from authority),jsonb_build_array(jsonb_build_object('purpose','reports.monogenic',
 'grantId',(select id from grants where name='variant'),'grantRevision',1)),'only the shared, completed layer is readable');
select is((select value#>>'{copilot,grantId}' from authority),(select id::text from grants where name='copilot'),'the exact Copilot grant is bound');
select throws_ok($$select pg_temp.scope('2')$$,'42501','not_found',
 'the person''s own account is not the uploader-or-grantee case (their own record is not built here)');
select throws_ok($$select pg_temp.scope('9')$$,'42501','not_found','an outsider''s request is not found');
select is(pg_temp.chat('check',null,jsonb_build_object('authority',(select value from authority))),'true'::jsonb,
 'a current authority passes the recheck');
savepoint polygenic_ungranted;
insert into grants select 'estimate',(pg_temp.share('reports.polygenic','uploader','0')->>'recordId')::uuid;
select is(jsonb_array_length(pg_temp.scope()->'authority'->'layers'),1,'a shared layer with no completed report is not read');
rollback to polygenic_ungranted;

-- 3. A turn ----------------------------------------------------------------------------------
select throws_ok($$select pg_temp.commit(null,(select value from authority),array['reports.polygenic'],0,'pb-nonce-0')$$,
 '42501','not_found','a turn cannot claim a layer that was not shared');
select throws_ok($$select pg_temp.chat('commit',null,jsonb_build_object('message','Q','answer','A','citations','[]'::jsonb,
 'lastOrdinal',0,'nonceHash',encode(extensions.digest('pb-nonce-x','sha256'),'hex'),'expiresAt',to_jsonb(clock_timestamp()+interval '9 minutes'),
 'provider',(select value from provider)||jsonb_build_object('providerClass','cloud'),'authority',(select value from authority),'used','[]'::jsonb))$$,
 '42501','not_found','a turn never commits under a cloud provider');
create temporary table first_turn as select (pg_temp.commit(null,(select value from authority),array['reports.monogenic'],0,'pb-nonce-1')->>'chatId')::uuid id;
select is((select scope_kind||':'||(canonical_authority->>'relationship') from public.chats where id=(select id from first_turn)),
 'subject:uploader','the conversation is a subject chat in the uploader case');
select is((select retrieved_purpose_keys from public.chat_messages where chat_id=(select id from first_turn) and role='assistant'),
 array['copilot.local','reports.monogenic'],'the answer names every purpose it relied on');
select is((select count(*) from public.copilot_turn_dependencies where chat_id=(select id from first_turn)),4::bigint,
 'one dependency each: the record, copilot.local, the layer and the source');
select is(pg_temp.read_record(),2::bigint,'both rows of the turn name the record');
select is(jsonb_array_length(pg_temp.history((select id from first_turn))->'messages'),2,'the uploader reads back the pair');
select throws_ok($$select public.subject_copilot_chat_v1('history',pg_temp.a('2'),pg_temp.s('2'),null,(select id from first_turn),
 jsonb_build_object('provider',(select value from provider)))$$,'42501','not_found','the person cannot read the uploader''s conversation');

-- 4. The hold re-arms at 30 days: nothing is read until the re-notice is accepted ------
savepoint renotice;
update public.subject_invitations set accepted_at=accepted_at-interval '31 days',terminal_at=terminal_at-interval '31 days'
 where id=pg_temp.invitation_of(pg_temp.sid('main'));
select is(pg_temp.scope(),'{"state":"held"}'::jsonb,'from 30 days the mitigation decision holds the record, and nothing says why');
select throws_ok($$select pg_temp.chat('check',null,jsonb_build_object('authority',(select value from authority)))$$,
 '42501','not_found','a turn in flight fails at its next recheck');
select is(pg_temp.history((select id from first_turn)),'null'::jsonb,'the conversation is unreadable while held');
select is(pg_temp.chat('list',null,'{}'::jsonb),'[]'::jsonb,'and not listed');
select is(pg_temp.read_record(),2::bigint,'a hold deletes nothing: the register denies reads, it does not revoke');
-- The re-notice accepted by the provider (its delivery path is the D-141 suite's).
update public.retention_due_phases set status='succeeded',completed_at=clock_timestamp(),terminal_outcome_code='provider_submission_accepted'
 where retention_id='adult.re-notice-30d' and phase_id='adult-revocation-renotice' and target_kind='invitation'
  and target_id=pg_temp.invitation_of(pg_temp.sid('main'));
select is(pg_temp.scope()->>'state','ready','once the re-notice is accepted the scope opens again');
select is(jsonb_array_length(pg_temp.history((select id from first_turn))->'messages'),2,'and the conversation is readable again');
rollback to renotice;

-- 5. Each way access ends, and what is purged ----------------------------------------------
savepoint copilot_revoked;
select public.revoke_directional_purpose_v1(pg_temp.a('2'),(select id from grants where name='copilot'));
select is(pg_temp.scope(),'{"state":"permission-missing"}'::jsonb,'the person turning Copilot off closes the scope');
select is(pg_temp.read_record(),0::bigint,'and every turn that read the record is deleted at once');
select is(pg_temp.history((select id from first_turn)),'null'::jsonb,'the history endpoint answers not found');
rollback to copilot_revoked;

savepoint layer_revoked;
select public.revoke_directional_purpose_v1(pg_temp.a('2'),(select id from grants where name='variant'));
select is(pg_temp.scope(),'{"state":"permission-missing"}'::jsonb,'turning off the only shared layer closes the scope');
select is(pg_temp.read_record(),0::bigint,'and the turn that read that layer is deleted');
rollback to layer_revoked;

savepoint person_deletes;
select public.delete_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),
 encode(extensions.digest('subject-copilot-path-b-delete','sha256'),'hex'),clock_timestamp()+interval '5 minutes');
select is((select lifecycle from public.subjects where id=pg_temp.sid('main')),'purged','fixture: the person deletes the record');
select is((select count(*) from public.chats where subject_id=pg_temp.sid('main')),0::bigint,
 'every conversation about the purged record is deleted, the uploader''s included');
select is(pg_temp.read_record(),0::bigint,'and no message that read it survives');
select is((select count(*) from public.copilot_context_tokens where target_id=pg_temp.sid('main')),0::bigint,
 'nor any context token naming it');
rollback to person_deletes;

savepoint uploader_withdraws;
select throws_ok($$select public.withdraw_other_adult_upload_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),
 encode(extensions.digest('subject-copilot-path-b-withdraw','sha256'),'hex'),clock_timestamp()+interval '5 minutes')$$,
 '42501','other_adult_withdrawal_account_held',
 'the uploader''s withdrawal is refused for a record the person holds with their own account (20261119160000)');
select is(pg_temp.read_record(),2::bigint,'so nothing about the record changes, its conversation included');
rollback to uploader_withdraws;

savepoint no_person_account;
-- The same purge for a record no person holds: the uploader's withdrawal
-- purges it, and the trigger takes every conversation that read it.
update public.subjects set lifecycle='purged',lifecycle_revision=lifecycle_revision+1,subject_account_id=null
 where id=pg_temp.sid('main');
select is((select count(*) from public.chats where subject_id=pg_temp.sid('main')),0::bigint,
 'any purge of an other_adult record deletes its subject conversations');
rollback to no_person_account;

-- Outside every probe above, so the plan counts each one.
select is(jsonb_array_length(pg_temp.history((select id from first_turn))->'messages'),2,
 'with nothing ended, the uploader''s conversation stands as it was');

select * from finish();
rollback;
