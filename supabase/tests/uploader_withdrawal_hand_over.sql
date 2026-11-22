-- The uploader's withdrawal hands a record its adult holds to that adult
-- (migration 20261122100000_uploader_withdrawal_hands_record_to_adult; owner
-- decision of 22 November 2026, "An uploader's withdrawal hands a record its
-- adult holds to that adult"). 01 adds two files for 02, who confirms the
-- request with their own account, confirms the first file and not the second,
-- keeps a result of their own, shares one with 01 and turns Copilot on for
-- 01, who asks it about the record. 09 is an outsider, and in one fixture the
-- holder of a family link to the record.
--
-- The transfer's switch, private.subject_transfer_open_v1(), answers true
-- since 20261122120000 (owner decision of 22 November 2026, "The transfer
-- notices are approved, with one added line, and the transfer is switched
-- on"). First, with the switch closed INSIDE A SAVEPOINT ONLY (as it was
-- before that migration), it is shown that the branch is refused and nothing
-- changes. Then, with the switch as the migration left it, the branch is run:
-- the person owns the record and the confirmed file, the unconfirmed file is
-- gone, the uploader's consent is withdrawn and kept, the uploader reads
-- nothing, the notices are queued once each, a ready export does not make it
-- fail, and the person's own later acts still work. The person's own
-- transfer, through the same function, is run once too.
--
-- Synthetic accounts, HMACs, files and results only. Three rows no door
-- writes are synthetic fixtures, named where they are made: the person's
-- READY export of the record, two download sessions, and a family link from
-- the record to 09. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc
\ir fixtures/own_copilot_synthetic_settings.inc

-- Accounts that existed before the request (no 72-hour hold) and whose
-- addresses are confirmed, as the terminal-notice worker requires of an
-- account recipient.
update auth.users set created_at=now()-interval '1 day',email_confirmed_at=now() where id::text like '0b5e0000-%';
-- D-163: relocations earlier local runs committed are set aside inside this
-- transaction, so the relocation worker's next item is this suite's own.
update private.subject_transfer_relocations set state='cancelled',cancelled_at=clock_timestamp(),current_attempt_id=null
 where state in ('queued','copying');
update private.invitation_terminal_notices set state='expired',contact_ciphertext=null,recipient_account_id=null
 where state='pending';
update public.mail_outbox set state='invalidated' where invitation_terminal_notice_id is not null and state in ('queued','claimed');
update public.report_templates set status='review' where status='published';
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants,citations)
 values('synthetic-handover-variant','synthetic','Synthetic variant','Synthetic hand-over fixture.',
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
create function pg_temp.result_payload() returns jsonb language sql as $$
 select jsonb_build_object('reports',coalesce(jsonb_agg(jsonb_build_object('slug',t.slug,'covered',true,
  'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,
   'title',t.title,'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,
   'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)),
  'variants',jsonb_build_array(jsonb_build_object('rsid',123,'outcome',jsonb_build_object('status','genotyped','genotype','AG',
   'interpretation','Synthetic covered genotype','strandFlipped',false))),'conflictingRsids','[]'::jsonb) order by t.slug),'[]'),
  'prs','[]'::jsonb) from public.report_templates t where status='published' and layer::text='variant_call';
$$;
create function pg_temp.complete_next_report(p_hash text) returns jsonb language plpgsql as $$
declare c jsonb;
begin
 c:=public.path_b_report_v1('claim',null,p_hash,null,null,true);
 perform public.path_b_report_v1('stage',(c->>'jobId')::uuid,p_hash,(c->>'claim')::uuid,pg_temp.result_payload(),true);
 return public.path_b_report_v1('complete',(c->>'jobId')::uuid,p_hash,(c->>'claim')::uuid,null,true);
end;
$$;
create function pg_temp.share(p_purpose text,p_direction text,p_nonce text) returns jsonb language sql as $$
 select public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),p_purpose,p_direction,a.version,
  a.body_sha256,repeat(p_nonce,64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key=case when p_direction='uploader' then 'consent.share-with-adult'
  when p_purpose='reports.monogenic' then 'consent.own-monogenic' else 'consent.own-polygenic' end and a.superseded_at is null;
$$;
create temporary table grants(name text primary key,id uuid);

-- The record: 02 confirms the request and the first file with their own
-- account, keeps a result of their own and shares one with 01.
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','ho-sign-aaaaaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 'fixture: the person confirms the request with their own account');
select is((select h->>'status' from (select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64)) h) x),'stored_quarantined',
 'fixture: a first file is held');
insert into grants select 'self',(pg_temp.share('reports.monogenic','self','6')->>'recordId')::uuid;
select is(pg_temp.notice_session('main','1'),1::bigint,'fixture: its notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'ho-confirm-1111111111111111111','confirm',pg_temp.a('2')),
 'confirmed','fixture: the person confirms the first file');
create temporary table source_claim as select public.path_b_normalization_v1('claim',null,repeat('7',64),null,null,true) c;
select public.path_b_normalization_v1('stage',(c->>'jobId')::uuid,repeat('7',64),(c->>'claim')::uuid,
 '{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}',true)
 from source_claim;
select public.path_b_normalization_v1('complete',(c->>'jobId')::uuid,repeat('7',64),(c->>'claim')::uuid,
 jsonb_build_object('sourceBuild','GRCh38','rawSha256',repeat('e',64),'decodedSha256',repeat('b',64),
  'variantCount',1,'observedCallCount',0,'provenance',jsonb_build_object('version','path-b-normalization-v1',
   'sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)),true) from source_claim;
select is(pg_temp.complete_next_report(repeat('8',64)),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'fixture: the person''s own result is completed');
insert into grants select 'variant',(pg_temp.share('reports.monogenic','uploader','3')->>'recordId')::uuid;
select is(pg_temp.complete_next_report(repeat('5',64)),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'fixture: the result the person shared with the uploader is completed');
insert into grants select 'copilot',(pg_temp.share('copilot.local','uploader','1')->>'recordId')::uuid;

-- The uploader's own local Copilot, and one conversation about the record.
create temporary table uploader_self as select id from public.subjects where subject_account_id=pg_temp.a('1') and subject_class='self';
select public.save_own_copilot_settings_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.synthetic_copilot_settings('synthetic-model','local'),
 null,repeat('b',64),null);
create temporary table presentation as select public.own_copilot_presentation_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self)) value;
select public.grant_own_copilot_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self),(select value->'snapshot' from presentation),
 (select value->'artifacts' from presentation),repeat('9',64),clock_timestamp()+interval '9 minutes');
create temporary table provider as select public.own_copilot_authority_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self)) value;
create function pg_temp.scope() returns jsonb language sql as $$
 select public.subject_copilot_scope_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main')); $$;
create temporary table authority as select pg_temp.scope()->'authority' value;
select is((select value->>'case' from authority),'uploader','fixture: the uploader''s one-record Copilot scope is open');
create temporary table first_turn as select (public.subject_copilot_chat_v1('commit',pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),null,
 jsonb_build_object('message','What did they share?','answer','One saved report.',
  'citations',jsonb_build_array(jsonb_build_object('id','report:x','label','Synthetic variant',
   'href','/genome/s-'||pg_temp.sid('main')||'/reports/synthetic-handover-variant')),
  'lastOrdinal',0,'nonceHash',encode(extensions.digest('ho-nonce-1','sha256'),'hex'),
  'expiresAt',to_jsonb(clock_timestamp()+interval '9 minutes'),'provider',(select value from provider),
  'authority',(select value from authority),
  'used',jsonb_build_array(jsonb_build_object('authority',(select value from authority),'purposes',jsonb_build_array('reports.monogenic'),
   'files',jsonb_build_array(jsonb_build_object('fileId',pg_temp.fxv('main','revision'),'purpose','reports.monogenic'))))))
 ->>'chatId')::uuid id;
create function pg_temp.read_record() returns bigint language sql as $$
 select count(*) from public.chat_messages where user_id=pg_temp.a('1') and retrieved_subject_ids && array[pg_temp.sid('main')]; $$;
select is(pg_temp.read_record(),2::bigint,'fixture: the uploader''s conversation read the record');

-- A second file, held and not confirmed.
select is((select h->>'status' from (select pg_temp.hold('main-2',pg_temp.sid('main'),repeat('9',64)) h) x),'stored_quarantined',
 'fixture: a second file is held and not yet confirmed');

-- Synthetic: the person's READY export of the record. No door writes a READY
-- subject export of a Path B record in SQL alone, so its rows are written as
-- the export worker leaves them: a job, its active attempt with the bytes
-- complete and its R2 completion, and the export published READY under the
-- transaction-local TEST R2 configuration the export suites use.
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
create temporary table xe as select gen_random_uuid() export_id,gen_random_uuid() attempt_id,
 date_trunc('second',clock_timestamp())+interval '23 hours' expires_at;
grant select on xe to service_role;
insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,lifecycle_revision,
 principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,status,archive_version)
 select xe.export_id,pg_temp.a('2'),sp.id,'subject_raw','subject',s.id,'raw.export',s.lifecycle_revision,1,repeat('3',64),1,
  jsonb_build_array(s.id),'building','archive-segments-v1'
 from xe,public.subjects s join public.subject_principals sp on sp.subject_id=s.id and sp.account_id=pg_temp.a('2')
  and sp.principal_kind='account_subject' and sp.status='active'
 where s.id=pg_temp.sid('main');
insert into private.export_archive_jobs(export_id,origin,route_id,export_contract,origin_binding,authority_receipt,
 export_cookie_hash,principal_hash,deadline)
 select export_id,jsonb_build_object('kind','account','accountId',pg_temp.a('2'),'sessionId',pg_temp.s('2')),'api.subject-export',
  'subject-export-v1',repeat('4',64),repeat('5',64),repeat('6',64),repeat('7',64),clock_timestamp()+interval '23 hours' from xe;
insert into private.export_archive_attempts(id,export_id,state,authority_receipt,lease_expires_at,stopped_at,cleanup_not_before,
 segment_count,byte_count,page_count,archive_sha256,manifest_sha256,account_r2_completion)
 select attempt_id,export_id,'bytes_complete',repeat('5',64),clock_timestamp()+interval '1 hour',clock_timestamp(),
  clock_timestamp()+interval '1 hour',1,3,1,repeat('d',64),repeat('e',64),
  jsonb_build_object('authorityReceipt',repeat('5',64),'archiveSha256',repeat('d',64),'manifestSha256',repeat('e',64),
   'sizeBytes',3,'expiresAt',expires_at) from xe;
update private.export_archive_jobs set active_attempt=(select attempt_id from xe) where export_id=(select export_id from xe);
update public.generated_exports set status='ready',completed_at=clock_timestamp(),expires_at=(select expires_at from xe),
 archive_sha256=repeat('d',64),manifest_sha256=repeat('e',64),byte_count=3 where id=(select export_id from xe);
select is((select status from public.generated_exports where id=(select export_id from xe)),'ready',
 'fixture: the person holds a READY export of the record');
-- Synthetic: two live download sessions, the uploader's of the record's
-- file and the person's of that export, over one stored object of that file.
create temporary table xo as select gen_random_uuid() object_id;
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision)
 select object_id,gen_random_uuid()::text,'genomes',pg_temp.fxv('main','revision')::uuid,repeat('e',64),8,1 from xo;
insert into public.download_sessions(account_id,auth_session_id,principal_id,target_kind,target_id,purpose,object_id,
 lifecycle_revision,publication_revision,authorization_fingerprint,max_bytes,expires_at,file_id)
 select pg_temp.a('1'),pg_temp.s('1'),(select sp.id from public.subject_principals sp join uploader_self u on u.id=sp.subject_id
  where sp.account_id=pg_temp.a('1') and sp.status='active'),'subject',pg_temp.sid('main'),'synthetic-uploader-download',
  (select object_id from xo),1,1,repeat('8',64),8,clock_timestamp()+interval '1 hour',pg_temp.fxv('main','revision')::uuid
 union all
 select pg_temp.a('2'),pg_temp.s('2'),(select sp.id from public.subject_principals sp where sp.subject_id=pg_temp.sid('main')
  and sp.account_id=pg_temp.a('2') and sp.status='active'),'export',(select export_id from xe),'synthetic-export-download',
  (select object_id from xo),1,1,repeat('9',64),3,clock_timestamp()+interval '1 hour',null;
-- Synthetic: a family link from the record to 09. No door writes one on a
-- Path B record; it stands for any other account whose access the transfer
-- ends, the contract's third notice.
insert into public.subject_relationships(subject_id,data_subject_principal_id,recipient_principal_id,recipient_account_id,
 relationship_kind,relationship_revision,status)
 select pg_temp.sid('main'),p.id,r.id,pg_temp.a('9'),'family_member',1,'current'
 from public.subject_principals p,public.subject_principals r join public.subjects rs on rs.id=r.subject_id and rs.subject_class='self'
 where p.subject_id=pg_temp.sid('main') and p.account_id=pg_temp.a('2') and p.status='active'
  and r.account_id=pg_temp.a('9') and r.principal_kind='account_subject' and r.status='active';
select ok((select owner_account_id=pg_temp.a('1') and subject_account_id=pg_temp.a('2') and ownership_transferred_at is null
  from public.subjects where id=pg_temp.sid('main'))
 and (select array_agg(state order by held_at) from public.other_adult_held_uploads where subject_id=pg_temp.sid('main'))
  =array['confirmed','pending'],
 'fixture: the uploader owns the record, the person holds it, one file confirmed and one not');

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('uploader-hand-over:'||p,'sha256'),'hex') $$;
create function pg_temp.wd(p_account text,p_code text) returns jsonb language sql volatile as
 $$ select public.withdraw_other_adult_upload_v1(pg_temp.a(p_account),pg_temp.s(p_account),pg_temp.sid('main'),pg_temp.h(p_code),
   clock_timestamp()+interval '5 minutes') $$;
create function pg_temp.ready(p_account text) returns text language sql stable as
 $$ select public.other_adult_withdrawal_readiness_v1(pg_temp.a(p_account),pg_temp.sid('main')) $$;
create function pg_temp.notices() returns text[] language sql as $$
 select coalesce(array_agg(n.notice_kind||' '||case n.recipient_account_id when pg_temp.a('1') then '01' when pg_temp.a('2') then '02'
   when pg_temp.a('9') then '09' else 'other' end order by n.notice_kind,n.recipient_account_id),'{}')
 from private.invitation_terminal_notices n where n.invitation_id=pg_temp.invitation_of(pg_temp.sid('main')) and n.state='pending'
$$;
-- Everything the branch may change, read in one value.
create function pg_temp.state() returns jsonb language sql as $$
 select jsonb_build_object(
  'subject',(select jsonb_build_object('owner',owner_account_id,'person',subject_account_id,'transferred',ownership_transferred_at,
    'lifecycle',lifecycle,'revision',lifecycle_revision) from public.subjects where id=pg_temp.sid('main')),
  'files',(select jsonb_agg(state order by held_at) from public.other_adult_held_uploads where subject_id=pg_temp.sid('main')),
  'fileOwners',(select jsonb_agg(user_id order by id) from public.genome_files where subject_id=pg_temp.sid('main')),
  'consents',(select jsonb_agg(jsonb_build_object('id',id,'revoked',revoked_at,'reason',revocation_reason) order by id)
    from public.subject_consents where subject_id=pg_temp.sid('main')),
  'results',(select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('main')),
  'grants',(select jsonb_agg(revoked_at order by grant_id) from public.purpose_grants where target_kind='subject' and target_id=pg_temp.sid('main')),
  'relationships',(select jsonb_agg(status order by id) from public.subject_relationships where subject_id=pg_temp.sid('main')),
  'chats',(select count(*) from public.chats where subject_id=pg_temp.sid('main')),'reads',pg_temp.read_record(),
  'contexts',(select count(*) from public.copilot_context_tokens where target_id=pg_temp.sid('main')),
  'export',(select status from public.generated_exports where id=(select export_id from xe)),
  'attempt',(select state from private.export_archive_attempts where id=(select attempt_id from xe)),
  'downloads',(select jsonb_agg(status order by purpose) from public.download_sessions where purpose like 'synthetic-%'),
  'transfers',(select count(*) from private.subject_ownership_transfers),
  'relocations',(select count(*) from private.subject_transfer_relocations),
  'codes',(select count(*) from public.account_operation_nonces where operation in ('subject_delete','subject_transfer')),
  'notices',(select count(*) from private.invitation_terminal_notices where invitation_id=pg_temp.invitation_of(pg_temp.sid('main'))),
  'events',(select count(*) from public.legal_audit_log where event_code='subject.ownership_transferred'))
$$;
create temporary table before_state as select pg_temp.state() value;
grant select on before_state to service_role;

-- 1. With the switch closed the branch is refused and nothing changes ---------------
-- Since 20261122120000 the switch is open. Its closed branch is kept, and is
-- shown here with the switch closed inside this savepoint only.
savepoint switch_closed;
create or replace function private.subject_transfer_open_v1() returns boolean language sql immutable set search_path='' as
 $$ select false $$;
select is(private.subject_transfer_open_v1(),false,
 'inside this savepoint the transfer''s switch is closed, as it was before 20261122120000');
select is(pg_temp.ready('1'),'account-held','the page''s read still names the own-account branch, as before');
set local role service_role;
select throws_ok($$select pg_temp.wd('1','closed')$$,'42501','other_adult_withdrawal_account_held',
 'the uploader''s withdrawal is refused exactly as before');
select throws_ok($$select public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),pg_temp.h('person-closed'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found','and so is the person''s own transfer');
select throws_ok($$select public.delete_subject_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),pg_temp.h('delete-closed'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found','and the uploader''s delete');
reset role;
select is(pg_temp.state(),(select value from before_state),
 'nothing changes: no code, transfer, notice, file, consent, result, grant, chat, export or download');
select is(pg_temp.read_record(),2::bigint,'the uploader''s conversation stands');
rollback to switch_closed;

-- 2. The switch, open as 20261122120000 left it ------------------------------------------
select ok(private.subject_transfer_open_v1()
 and (select md5(pg_get_functiondef(p.oid))='8d2e22d1e0c41c8bce0e43b9e45378d3' and p.proacl::text='{postgres=X/postgres}'
  from pg_proc p where p.oid='private.subject_transfer_open_v1()'::regprocedure),
 'the switch is open, as 20261122120000 left it, its ACL unchanged');
select is(pg_temp.ready('1'),'hand-over','the read now says the record is handed to its person');
select throws_ok($$select pg_temp.ready('9')$$,'42501','not_found','an outsider reads nothing');
select throws_ok($$select pg_temp.ready('2')$$,'42501','not_found','nor does the person, who is not the uploader');
select ok(not has_function_privilege('service_role','private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])','execute')
 and not has_function_privilege('authenticated','private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])','execute')
 and not has_function_privilege('anon','private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])','execute')
 and not has_function_privilege('service_role','private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute')
 and (select proacl::text from pg_proc where oid='public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure)
  ='{postgres=X/postgres,service_role=X/postgres}',
 'only the service role may run the door; nothing behind it is callable by any API role');

-- Refusals, before anything is written.
set local role service_role;
select throws_ok($$select pg_temp.wd('9','outsider')$$,'42501','not_found','an outsider cannot withdraw');
select throws_ok($$select pg_temp.wd('2','person')$$,'42501','not_found','the person cannot use the uploader''s withdrawal');
select throws_ok($$select public.transfer_subject_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),pg_temp.h('uploader-door'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found',
 'the uploader cannot reach the transfer through the person''s door: only the withdrawal door names its act');
reset role;
select throws_ok($$select set_config('inherit.subject_transfer_withdrawal',gen_random_uuid()::text,true),
 private.transfer_subject_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),pg_temp.h('other-marker'),clock_timestamp()+interval '5 minutes')$$,
 '42501','not_found','a marker naming another record is no withdrawal of this one');
select set_config('inherit.subject_transfer_withdrawal','',true);
create function pg_temp.probe(p_setup text,p_call text,p_observe text default 'select null::text')
returns text language plpgsql as $$
declare v_result text; v_observed text;
begin
 begin
  execute p_setup;
  begin
   execute p_call into v_result;
  exception when others then v_result:=sqlstate||' '||sqlerrm;
  end;
  execute p_observe into v_observed;
  raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;
 end;
 return coalesce(v_result,'')||coalesce(' / '||v_observed,'');
end $$;
select is(pg_temp.probe($$update public.upload_sessions set status='validating' where id=pg_temp.fxv('main-2','upload')::uuid$$,
  $$select pg_temp.wd('1','validating')::text$$,$$select pg_temp.state()=(select value from before_state)$$),
 '55000 hand_over_not_now / true',
 'a file still being validated refuses the whole withdrawal for now (D-158, 20261122160000), and writes nothing');
select is(pg_temp.probe($$update public.profiles set jurisdiction_code=null,jurisdiction_declared_at=null,jurisdiction_attestation_version=null,
   jurisdiction_attestation_sha256=null where id=pg_temp.a('1')$$,
  $$select pg_temp.wd('1','undeclared')::text$$,$$select (select owner_account_id from public.subjects where id=pg_temp.sid('main'))::text$$),
 '{"case": "adult"} / '||pg_temp.a('2')::text,
 'a withdrawal is a right: an uploader whose account is no longer current for analysis can still withdraw');
select is(pg_temp.state(),(select value from before_state),'every refusal writes nothing');

-- 3. The person's own transfer, through the same function --------------------------------
savepoint person_transfers;
set local role service_role;
select throws_ok($$select public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),pg_temp.h('person-pending'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found',
 'the person''s own transfer still refuses while a file waits for them');
reset role;
select ok(private.end_other_adult_held_upload_v1(pg_temp.fxv('main-2','revision')::uuid,'refused'),
 'fixture: the person refuses the second file');
set local role service_role;
select is(public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),pg_temp.h('person'),
 clock_timestamp()+interval '5 minutes')->>'status','transferred','with the switch open the person''s own transfer runs');
reset role;
select ok((select revoked_at is not null and revocation_reason='superseded' from public.subject_consents
 where subject_id=pg_temp.sid('main') and consent_type='upload_class' and account_id=pg_temp.a('1')),
 'D-147: on the person''s own act the uploader''s permission ends as superseded, and is kept');
select is(pg_temp.notices(),array['subject-transfer-access-revoked 09','subject-transfer-former-owner 01','subject-transfer-new-owner 02'],
 'the person''s own act queues its three notices, one to each account');
select is((select route_id||' '||outcome_code||' '||(coded_context->>'act') from public.legal_audit_log
 where event_code='subject.ownership_transferred' order by seq desc limit 1),'api.subject-transfer accepted subject-account',
 'its event is the transfer''s own');
select is((select count(*) from public.account_operation_nonces where operation='subject_transfer' and nonce_hash=pg_temp.h('person')),
 1::bigint,'it spends the api.subject-transfer code');
select is((select status from public.generated_exports where id=(select export_id from xe)),'revoked',
 'D-151: the person''s ready export no longer makes their own transfer fail');
rollback to person_transfers;

-- 4. The uploader's withdrawal ----------------------------------------------------------
create temporary table before_withdrawal as select
 (select count(*) from public.legal_audit_log) events,
 (select sc.id from public.subject_consents sc where sc.subject_id=pg_temp.sid('main') and sc.account_id=pg_temp.a('1')
  and sc.consent_type='upload_class' and sc.revoked_at is null) consent,
 (select sc.signature_id from public.subject_consents sc where sc.subject_id=pg_temp.sid('main') and sc.account_id=pg_temp.a('1')
  and sc.consent_type='upload_class' and sc.revoked_at is null) signature,
 (select count(*) from public.subject_consents where subject_id=pg_temp.sid('main')) consents,
 (select count(*) from public.subject_consents where subject_id=pg_temp.sid('main') and revoked_at is null) live_consents,
 (select notice_outbox_id from public.other_adult_held_uploads where id=pg_temp.fxv('main-2','revision')::uuid) pending_notice;
set local role service_role;
create temporary table withdrawal as select pg_temp.wd('1','withdraw') body;
reset role;
select is((select body from withdrawal),'{"case":"adult"}'::jsonb,'the withdrawal is accepted as the adult case, as the route reads it');

-- The record and the confirmed file are the person's.
select ok((select s.owner_account_id=pg_temp.a('2') and s.subject_account_id=pg_temp.a('2') and s.subject_class='other_adult'
  and s.lifecycle='active' and s.ownership_transferred_at is not null from public.subjects s where s.id=pg_temp.sid('main')),
 'the person owns the record, which stays a separate other_adult record');
select ok((select t.from_account_id=pg_temp.a('1') and t.to_account_id=pg_temp.a('2') and t.file_count=1
 from private.subject_ownership_transfers t where t.subject_id=pg_temp.sid('main')),
 'one immutable transfer row, from the uploader to the person, for the one confirmed file');
select ok((select h.state='transferred' and f.user_id=pg_temp.a('2') from public.other_adult_held_uploads h
 join public.genome_files f on f.id=h.id where h.id=pg_temp.fxv('main','revision')::uuid),
 'the confirmed file is the person''s');
select ok((select r.state='queued' and r.file_id=pg_temp.fxv('main','revision')::uuid and r.new_owner_account_id=pg_temp.a('2')
 from private.subject_transfer_relocations r where r.subject_id=pg_temp.sid('main')),
 '... and is queued for relocation to a key of its own');
-- The unconfirmed file is gone.
select is((select state from public.other_adult_held_uploads where id=pg_temp.fxv('main-2','revision')::uuid),'withdrawn',
 'the file the person had not confirmed ends as withdrawn');
select ok((select status='rejected' and finalization_cleanup_pending from public.upload_sessions
 where id=pg_temp.fxv('main-2','upload')::uuid),'... its upload is rejected and its stored object queued for cleanup');
select ok(not exists(select 1 from public.genome_files where id=pg_temp.fxv('main-2','revision')::uuid)
 and not exists(select 1 from private.subject_transfer_relocations where held_upload_id=pg_temp.fxv('main-2','revision')::uuid),
 '... no file of it moves to the person');
select is((select state from public.mail_outbox where id=(select pending_notice from before_withdrawal)),'invalidated',
 '... and its request to the person to confirm it is withdrawn');
-- The uploader's consent.
select ok((select revoked_at is not null and revocation_reason='withdrawn' from public.subject_consents
 where id=(select consent from before_withdrawal)),'the uploader''s upload consent is marked withdrawn');
select ok((select count(*) from public.subject_consents where subject_id=pg_temp.sid('main'))=(select consents from before_withdrawal)
 and (select count(*) from public.subject_consents where subject_id=pg_temp.sid('main') and revoked_at is null)
  =(select live_consents from before_withdrawal)-1
 and exists(select 1 from public.consent_signatures where id=(select signature from before_withdrawal)),
 '... and kept, with its signature; every other consent on the record is as it was');
select is((select count(*) from public.account_operation_nonces where operation='subject_delete' and account_id=pg_temp.a('1')
 and nonce_hash=pg_temp.h('withdraw')),1::bigint,'the withdrawal spends its api.subject-delete code once');
select is((select count(*) from public.account_operation_nonces where operation='subject_transfer'
 and account_id in (select pg_temp.a(x) from unnest(array['1','2','3','4','9']) x)),0::bigint,
 '... and no api.subject-transfer code');

-- The uploader reads nothing.
select is(public.path_b_report_results_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),'reports.monogenic',true),'[]'::jsonb,
 'the uploader reads no result');
select is(public.path_b_report_metadata_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),true),'[]'::jsonb,
 '... no reading metadata');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('main'),'reports.monogenic')->>'gate','not-found',
 '... and its read decision is not found');
select throws_ok($$select public.capture_path_b_report_results_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),true)$$,
 '42501','not_found','the uploader cannot capture anything');
select is((select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('main')
 and recipient_account_id is distinct from pg_temp.a('2')),0::bigint,'the result shared with the uploader is deleted');
select throws_ok($$select pg_temp.scope()$$,'42501','not_found','the uploader''s one-record Copilot scope is not found');
select is(pg_temp.read_record(),0::bigint,'every turn of the uploader''s that read the record is deleted');
select is((select count(*) from public.chats where id=(select id from first_turn))
 +(select count(*) from public.chats where subject_id=pg_temp.sid('main') and user_id<>pg_temp.a('2')),0::bigint,
 'the uploader''s one-record conversation is deleted');
select is((select count(*) from public.copilot_context_tokens where target_id=pg_temp.sid('main')),0::bigint,
 'nor does any context token name the record');
select ok((select bool_and(g.revoked_at is not null and g.revocation_reason='subject_transferred' and d.status='revoked')
 from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id
 where g.grant_id in (select id from grants where name in ('variant','copilot'))),
 'both permissions the person gave the uploader, the result layer and Copilot, are revoked');
select is((select count(*) from public.subject_relationships where subject_id=pg_temp.sid('main') and status in ('pending','current')
 and recipient_account_id is distinct from pg_temp.a('2')),0::bigint,'every link from the record to another account ends');
select is((select jsonb_agg(status order by purpose) from public.download_sessions where purpose like 'synthetic-%'),
 '["revoked","revoked"]'::jsonb,'every download of the record or its export is revoked, the uploader''s included');
select ok(not exists(select 1 from jsonb_array_elements(public.other_adult_upload_targets_v1(pg_temp.a('1'),pg_temp.s('1'),true)) t
 where (t->>'subjectId')::uuid=pg_temp.sid('main')),'the record leaves the uploader''s list');
select throws_ok($$select public.issue_other_adult_held_upload_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),'VCF',8,repeat('f',64),true)$$,
 '42501','not_found','the uploader can add nothing more');
select throws_ok($$select pg_temp.ready('1')$$,'42501','not_found','the read no longer offers the uploader anything');
set local role service_role;
select throws_ok($$select pg_temp.wd('1','again')$$,'42501','not_found','a second withdrawal finds nothing');
select throws_ok($$select public.delete_subject_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),pg_temp.h('delete-after'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found','the former uploader cannot delete the record');
reset role;

-- The ready export did not make it fail.
select ok((select e.status='revoked' and e.completed_at is null and e.expires_at is null and a.state='cleanup_pending'
  and a.stopped_at is not null and j.active_attempt is null
 from public.generated_exports e join private.export_archive_attempts a on a.export_id=e.id
 join private.export_archive_jobs j on j.export_id=e.id where e.id=(select export_id from xe)),
 'D-151: the ready export was stopped through the cleanup door and revoked, so the withdrawal did not fail');

-- The notices.
select is(pg_temp.notices(),array['subject-transfer-access-revoked 09','withdrawal-transfer-former-owner 01',
 'withdrawal-transfer-new-owner 02'],'the three notices, once each: to the person, to the uploader and to the other account');
select ok((select bool_and(n.recipient_kind='account' and n.contact_ciphertext is null
  and n.expires_at=n.created_at+interval '7 days' and n.idempotency_key ~ '^[0-9a-f]{64}$')
 from private.invitation_terminal_notices n where n.invitation_id=pg_temp.invitation_of(pg_temp.sid('main')) and n.state='pending'),
 'each goes to an account, never to a contact, for seven days');
select is((select recipient_authority_revision from private.invitation_terminal_notices
 where notice_kind='withdrawal-transfer-new-owner' and invitation_id=pg_temp.invitation_of(pg_temp.sid('main'))),(select principal_revision from public.subject_principals
 where subject_id=pg_temp.sid('main') and account_id=pg_temp.a('2') and status='active'),
 'the person''s notice names their current principal on the record');
select is((select count(*) from public.mail_outbox m join private.invitation_terminal_notices n on n.id=m.invitation_terminal_notice_id
 where n.invitation_id=pg_temp.invitation_of(pg_temp.sid('main')) and n.state='pending'
  and m.template_payload=jsonb_build_object('kind',n.notice_kind) and m.state='queued'),3::bigint,
 'each has one queued mail row that carries only its kind');
create temporary table claimed as select * from public.claim_invitation_terminal_mail_v1()
 union all select * from public.claim_invitation_terminal_mail_v1() union all select * from public.claim_invitation_terminal_mail_v1();
select is((select array_agg(notice_kind||' '||case recipient_account_id when pg_temp.a('1') then '01' when pg_temp.a('2') then '02'
  when pg_temp.a('9') then '09' end order by notice_kind) from claimed),
 array['subject-transfer-access-revoked 09','withdrawal-transfer-former-owner 01','withdrawal-transfer-new-owner 02'],
 'the terminal mail worker claims each, for its account');
select ok((select bool_and(public.authorize_invitation_terminal_mail_v1(outbox_id,attempt_ordinal)) from claimed),
 '... and is authorized to send each');
select is((select count(*) from public.claim_invitation_terminal_mail_v1()),0::bigint,'nothing else is queued');

-- The audit event.
select is((select route_id||' '||outcome_code||' '||(coded_context->>'act')||' '||(coded_context->>'unconfirmed_withdrawn')
  ||' '||(coded_context->>'notices')||' '||(coded_context->>'files') from public.legal_audit_log
 where event_code='subject.ownership_transferred' and occurred_at>=now()),'api.subject-delete withdrawn uploader-withdrawal 1 3 1',
 'one transfer event, on the route the uploader used, naming the act');
select is((select audit_principal_id from public.legal_audit_log where event_code='subject.ownership_transferred'
 and occurred_at>=now()),
 (select audit_principal_id from private.legal_audit_account_principals where account_id=pg_temp.a('1')),
 '... attributed to the uploader, who spent the code');
select ok((select not (coded_context::text ~ '@|[0-9a-f]{64}') from public.legal_audit_log
 where event_code='subject.ownership_transferred' and occurred_at>=now()),'... with no contact or token');

-- 5. The person's own later acts still work ---------------------------------------------
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic',true)),1,
 'the person still reads their own result under their own permission');
select ok((select g.revoked_at is null and d.status='current' from public.purpose_grants g
 join public.directional_grants d on d.grant_id=g.grant_id where g.grant_id=(select id from grants where name='self')),
 '... which stays current');
select is((select w->>'kind' from (select public.subject_transfer_relocation_work_v1(true) w) x),'copy',
 'the relocation worker takes the person''s file next');
savepoint person_deletes;
set local role service_role;
select is(public.delete_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),pg_temp.h('person-delete'),
 clock_timestamp()+interval '5 minutes'),'{"case":"adult"}'::jsonb,'the person deletes the record they now own');
reset role;
select is((select lifecycle from public.subjects where id=pg_temp.sid('main')),'purged','... and it is purged');
rollback to person_deletes;
select lives_ok('set constraints all immediate','the withdrawal satisfies every deferred constraint');

select * from finish();
rollback;
