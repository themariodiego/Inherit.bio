-- The record transfer, switched on (migration 20261122120000_subject_transfer_open;
-- owner decision of 22 November 2026, "The transfer notices are approved,
-- with one added line, and the transfer is switched on"). The switch is read
-- as the migration left it: nothing here opens it. Both acts run end to end
-- through their own service doors:
--   1. the person's own "move this record into my account"
--      (public.transfer_subject_v1);
--   2. the uploader's withdrawal of its permission for a record the person
--      holds with their own account (public.withdraw_other_adult_upload_v1),
--      which hands the record to the person.
-- For each: the right notice kinds go to the right accounts and to no one
-- else, and the mail worker sends each; every download copy of the record
-- stops (the person's export of the record, and every whole-account export
-- the record is part of: the person's, the uploader's, and another
-- account's that holds its link to the record); the uploader's
-- conversations and every prior permission end; and the uploader's card
-- reads 'hand-over' before and finds nothing after. Each act runs from the
-- same starting point: the first is undone before the second.
--
-- 01 uploads; 02 is the person, with an account; 04 holds a family link to
-- the record 02 moves, and 09 to the record 01 withdraws from (no door writes
-- one on a Path B record: each stands for any other account whose access the
-- transfer ends, the contract's third notice); 03 has nothing to do with
-- either. Synthetic accounts, HMACs, files and results only. Rows no door
-- writes in SQL alone are synthetic and named where they are made: READY
-- exports with their jobs and attempts, two download sessions, and the
-- family links. Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc
\ir fixtures/own_copilot_synthetic_settings.inc

-- Accounts that existed before the requests (no 72-hour hold) and whose
-- addresses are confirmed, as the terminal-notice worker requires of an
-- account recipient. Notices and mail already queued by earlier local runs
-- are set aside, so every count below is this suite's own.
update auth.users set created_at=now()-interval '1 day',email_confirmed_at=now() where id::text like '0b5e0000-%';
update private.invitation_terminal_notices set state='expired',contact_ciphertext=null,recipient_account_id=null
 where state='pending';
update public.mail_outbox set state='invalidated' where invitation_terminal_notice_id is not null and state in ('queued','claimed');
update public.report_templates set status='review' where status='published';
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants,citations)
 values('synthetic-transfer-open-variant','synthetic','Synthetic variant','Synthetic transfer fixture.',
  'published','emerging','variant_call',null,
  '[{"rsid":123,"gene":"SYNTHETIC","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AG":"Synthetic covered genotype"}}]',
  '[{"pmid":"12345678","label":"fixture"}]');
-- The whole-account and subject exports are read under the TEST R2
-- configuration the export suites use, inside this transaction only.
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);

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
create function pg_temp.normalize(p_hash text,p_raw text) returns void language plpgsql as $$
declare c jsonb;
begin
 c:=public.path_b_normalization_v1('claim',null,p_hash,null,null,true);
 perform public.path_b_normalization_v1('stage',(c->>'jobId')::uuid,p_hash,(c->>'claim')::uuid,
  '{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}',true);
 perform public.path_b_normalization_v1('complete',(c->>'jobId')::uuid,p_hash,(c->>'claim')::uuid,
  jsonb_build_object('sourceBuild','GRCh38','rawSha256',p_raw,'decodedSha256',repeat('b',64),
   'variantCount',1,'observedCallCount',0,'provenance',jsonb_build_object('version','path-b-normalization-v1',
    'sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)),true);
end;
$$;
create function pg_temp.share(p_record text,p_purpose text,p_direction text,p_nonce text) returns jsonb language sql as $$
 select public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid(p_record),p_purpose,p_direction,a.version,
  a.body_sha256,repeat(p_nonce,64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key=case when p_direction='uploader' then 'consent.share-with-adult'
  when p_purpose='reports.monogenic' then 'consent.own-monogenic' else 'consent.own-polygenic' end and a.superseded_at is null;
$$;
create temporary table grants(name text primary key,id uuid);
create function pg_temp.origin(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('kind','account','accountId',pg_temp.a(p),'sessionId',pg_temp.s(p)) $$;
-- The authority every request, worker step, open and chunk of an export
-- recomputes (private.export_archive_current_v1 compares it to the job's
-- receipt), or the refusal it raises.
create function pg_temp.authority(p text,p_kind text,p_target uuid) returns jsonb language plpgsql as $$
begin
 return private.export_archive_authority_v1(pg_temp.origin(p),p_kind,p_target);
exception when others then return jsonb_build_object('refused',sqlstate||' '||sqlerrm);
end $$;
create temporary table copies(name text primary key,export_id uuid,attempt_id uuid,receipt text);
grant select on copies to service_role;
-- Synthetic: a READY export, written as the export worker leaves one (a job,
-- its active attempt with the bytes complete and its R2 completion, the
-- export published READY), bound to the authority captured now, as the
-- request door binds it.
create function pg_temp.ready_copy(p_name text,p text,p_kind text,p_target uuid) returns text language plpgsql as $$
declare c jsonb; v_export uuid:=gen_random_uuid(); v_attempt uuid:=gen_random_uuid();
 v_expires timestamptz:=date_trunc('second',clock_timestamp())+interval '23 hours';
begin
 c:=private.export_archive_authority_v1(pg_temp.origin(p),p_kind,p_target);
 insert into public.generated_exports(id,account_id,requester_principal_id,export_kind,target_kind,target_id,purpose,lifecycle_revision,
  principal_graph_revision,principal_graph_fingerprint,export_revision,subject_partitions,status,archive_version)
 values(v_export,pg_temp.a(p),(c->>'principalId')::uuid,case when p_kind='account' then 'account_portable' else 'subject_raw' end,
  p_kind,p_target,'raw.export',(c->>'lifecycleRevision')::bigint,(c->>'principalGraphRevision')::bigint,c->>'authorityReceipt',1,
  c->'subjectPartitions','building','archive-segments-v1');
 insert into private.export_archive_jobs(export_id,origin,route_id,export_contract,origin_binding,authority_receipt,
  export_cookie_hash,principal_hash,deadline)
 values(v_export,pg_temp.origin(p),case when p_kind='account' then 'api.export' else 'api.subject-export' end,
  case when p_kind='account' then 'account-export-v1' else 'subject-export-v1' end,c->>'originBinding',c->>'authorityReceipt',
  encode(extensions.digest('copy-cookie:'||p_name,'sha256'),'hex'),c->>'principalHash',clock_timestamp()+interval '23 hours');
 insert into private.export_archive_attempts(id,export_id,state,authority_receipt,lease_expires_at,stopped_at,cleanup_not_before,
  segment_count,byte_count,page_count,archive_sha256,manifest_sha256,account_r2_completion)
 values(v_attempt,v_export,'bytes_complete',c->>'authorityReceipt',clock_timestamp()+interval '1 hour',clock_timestamp(),
  clock_timestamp()+interval '1 hour',1,3,1,repeat('d',64),repeat('e',64),
  jsonb_build_object('authorityReceipt',c->>'authorityReceipt','archiveSha256',repeat('d',64),'manifestSha256',repeat('e',64),
   'sizeBytes',3,'expiresAt',v_expires));
 update private.export_archive_jobs set active_attempt=v_attempt where export_id=v_export;
 update public.generated_exports set status='ready',completed_at=clock_timestamp(),expires_at=v_expires,
  archive_sha256=repeat('d',64),manifest_sha256=repeat('e',64),byte_count=3 where id=v_export;
 insert into copies values(p_name,v_export,v_attempt,c->>'authorityReceipt');
 return c->>'authorityReceipt';
end $$;
-- Whether a copy still works: the gate every open and every chunk of it
-- passes (account_archive_test_ready_v1 and the open-ready door call it).
create function pg_temp.copy_works(p_name text) returns text language plpgsql as $$
begin
 perform private.export_archive_current_v1(c.export_id,c.receipt) from copies c where c.name=p_name;
 return 'works';
exception when others then return 'stopped '||sqlstate||' '||sqlerrm;
end $$;
-- Synthetic: a family link from a record to another account.
create function pg_temp.link(p_record text,p_account text) returns void language sql as $$
 insert into public.subject_relationships(subject_id,data_subject_principal_id,recipient_principal_id,recipient_account_id,
  relationship_kind,relationship_revision,status)
 select pg_temp.sid(p_record),p.id,r.id,pg_temp.a(p_account),'family_member',1,'current'
 from public.subject_principals p,public.subject_principals r join public.subjects rs on rs.id=r.subject_id and rs.subject_class='self'
 where p.subject_id=pg_temp.sid(p_record) and p.account_id=pg_temp.a('2') and p.status='active'
  and r.account_id=pg_temp.a(p_account) and r.principal_kind='account_subject' and r.status='active';
$$;
create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('subject-transfer-open:'||p,'sha256'),'hex') $$;
create function pg_temp.ready(p_record text) returns text language sql stable as
 $$ select public.other_adult_withdrawal_readiness_v1(pg_temp.a('1'),pg_temp.sid(p_record)) $$;
-- Every transfer notice of a record, as "kind account".
create function pg_temp.notices(p_record text) returns text[] language sql as $$
 select coalesce(array_agg(n.notice_kind||' '||right(n.recipient_account_id::text,2) order by n.notice_kind,n.recipient_account_id),'{}')
 from private.invitation_terminal_notices n where n.invitation_id=pg_temp.invitation_of(pg_temp.sid(p_record))
  and (n.notice_kind like 'subject-transfer-%' or n.notice_kind like 'withdrawal-transfer-%')
$$;
-- Every transfer notice written in this transaction, to anyone, as "kind
-- account": nothing to anyone else. (Earlier local runs may have committed
-- notices of their own; now() is this transaction's start.)
create function pg_temp.all_transfer_notices() returns text[] language sql as $$
 select coalesce(array_agg(n.notice_kind||' '||coalesce(right(n.recipient_account_id::text,2),'contact')
  order by n.notice_kind,n.recipient_account_id),'{}')
 from private.invitation_terminal_notices n where (n.notice_kind like 'subject-transfer-%' or n.notice_kind like 'withdrawal-transfer-%')
  and n.created_at>=now()
$$;
create function pg_temp.uploader_reads(p_record text) returns bigint language sql as $$
 select count(*) from public.chat_messages where user_id=pg_temp.a('1') and retrieved_subject_ids && array[pg_temp.sid(p_record)] $$;
create function pg_temp.prior_grants_live(p_record text) returns bigint language sql as $$
 select count(*) from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id
 where g.target_kind='subject' and g.target_id=pg_temp.sid(p_record) and d.recipient_account_id is distinct from pg_temp.a('2')
  and (g.revoked_at is null or d.status='current') $$;

-- The switch, as the migration left it ------------------------------------------------------
select ok(private.subject_transfer_open_v1()
 and (select md5(pg_get_functiondef(p.oid))='8d2e22d1e0c41c8bce0e43b9e45378d3' and p.proacl::text='{postgres=X/postgres}'
  and p.provolatile='i' and not p.prosecdef from pg_proc p where p.oid='private.subject_transfer_open_v1()'::regprocedure),
 'the transfer''s switch is open, as 20261122120000 left it: one immutable body answering true, callable by no API role');
select ok(not has_function_privilege('service_role','private.subject_transfer_open_v1()','execute')
 and not has_function_privilege('authenticated','private.subject_transfer_open_v1()','execute')
 and not has_function_privilege('anon','private.subject_transfer_open_v1()','execute'),
 '... and no API role may call the switch itself');


-- Runs a setup and a call, reads one observation, then undoes all three.
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
-- The terminal mail worker, run until the queue is empty.
create function pg_temp.claim_all() returns table(outbox_id uuid,attempt_ordinal smallint,idempotency_key text,
 notice_kind text,contact_ciphertext bytea,recipient_account_id uuid) language plpgsql as $$
declare n integer;
begin
 for i in 1..20 loop
  return query select * from public.claim_invitation_terminal_mail_v1();
  get diagnostics n=row_count;
  exit when n=0;
 end loop;
end $$;

-- 1. The person's own move into their account ------------------------------------------------
-- 1a. The uploader's own whole-account copy. While it holds a file of a
-- record its person holds, the uploader can make no whole-account export at
-- all (its capture refuses, export_result_projection_unavailable), so its copy
-- that holds such a record is shown on a record with no file yet: 02 confirms
-- a request from 01 with their own account and moves it at once. All of 1a
-- is undone before 1b.
savepoint bare_move;
select pg_temp.requested('bare','c',repeat('c',64));
select is(pg_temp.account_confirms('c','open-sign-cccccccccccccccccccc','2',repeat('c',64)),'accepted',
 'fixture: the person confirms a request with their own account, before any file');
select ok(pg_temp.ready_copy('bare-uploader-account','1','account',pg_temp.a('1')) ~ '^[0-9a-f]{64}$',
 'fixture: the uploader holds a READY export of its whole account');
select ok((select pg_temp.sid('bare')::text in (select jsonb_array_elements_text(e.subject_partitions)) from copies c
  join public.generated_exports e on e.id=c.export_id where c.name='bare-uploader-account'),
 'fixture: the record is a partition of it');
select is(pg_temp.copy_works('bare-uploader-account'),'works','before the move the uploader''s copy can still be opened and read');
set local role service_role;
select is(public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('bare'),pg_temp.h('bare-move'),
 clock_timestamp()+interval '5 minutes')->>'status','transferred','the person moves the record into their account');
reset role;
select is(pg_temp.copy_works('bare-uploader-account'),'stopped 42501 not_found',
 'the uploader''s whole-account copy can no longer be opened or read');
rollback to bare_move;

-- 1b. A record with a file: 02 confirms a request from 01 with their own
-- account and confirms its file; 02 keeps a result of their own; 04 holds a
-- family link to the record.
select pg_temp.requested('own','b',repeat('b',64));
select is(pg_temp.account_confirms('b','open-sign-bbbbbbbbbbbbbbbbbbbb','2',repeat('b',64)),'accepted',
 'fixture: the person confirms a request with their own account');
select is((select h->>'status' from (select pg_temp.hold('own',pg_temp.sid('own'),repeat('c',64)) h) x),'stored_quarantined',
 'fixture: its file is held');
insert into grants select 'own-self',(pg_temp.share('own','reports.monogenic','self','4')->>'recordId')::uuid;
select is(pg_temp.notice_session('own','2'),1::bigint,'fixture: its notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'open-confirm-2222222222222222222','confirm',pg_temp.a('2')),
 'confirmed','fixture: the person confirms it');
select pg_temp.normalize(repeat('3',64),repeat('c',64));
select is(pg_temp.complete_next_report(repeat('6',64)),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'fixture: the person''s own result on it is completed');
select pg_temp.link('own','4');

savepoint person_move;
-- Every download copy of the record before the move, each working: the
-- person's export of the record and of their whole account, both of which
-- hold the record. (The uploader can hold none here: see 1a.)
select ok(pg_temp.ready_copy('own-person-record','2','subject',pg_temp.sid('own')) ~ '^[0-9a-f]{64}$'
 and pg_temp.ready_copy('own-person-account','2','account',pg_temp.a('2')) ~ '^[0-9a-f]{64}$',
 'fixture: the person holds a READY export of the record and one of their whole account');
select is((select array_agg(c.name order by c.name) from copies c join public.generated_exports e on e.id=c.export_id
 where pg_temp.sid('own')::text in (select jsonb_array_elements_text(e.subject_partitions))),
 array['own-person-account','own-person-record'],'fixture: the record is a partition of both copies');
select is(pg_temp.authority('1','account',pg_temp.a('1'))->>'refused','0A000 export_result_projection_unavailable',
 'fixture: the uploader can hold no whole-account copy while it holds a file of the record');
select is(array[pg_temp.copy_works('own-person-record'),pg_temp.copy_works('own-person-account')],
 array['works','works'],'before the move each copy can still be opened and read');
select is(pg_temp.ready('own'),'hand-over','the uploader''s card for the record reads hand-over');
create temporary table own_consent as select sc.id from public.subject_consents sc where sc.subject_id=pg_temp.sid('own')
 and sc.account_id=pg_temp.a('1') and sc.consent_type='upload_class' and sc.revoked_at is null;

set local role service_role;
select throws_ok($$select public.transfer_subject_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('own'),pg_temp.h('uploader-door'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found','the open door answers not found to the uploader');
select throws_ok($$select public.transfer_subject_v1(pg_temp.a('9'),pg_temp.s('9'),pg_temp.sid('own'),pg_temp.h('outsider-door'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found','... and to an outsider');
create temporary table moved as select public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('own'),pg_temp.h('move'),
 clock_timestamp()+interval '5 minutes') body;
reset role;
select is((select body->>'status' from moved),'transferred','the person''s own move runs through the open door');
select ok((select s.owner_account_id=pg_temp.a('2') and s.subject_account_id=pg_temp.a('2') and s.subject_class='other_adult'
  and s.lifecycle='active' and s.ownership_transferred_at is not null from public.subjects s where s.id=pg_temp.sid('own'))
 and (select h.state='transferred' and f.user_id=pg_temp.a('2') from public.other_adult_held_uploads h
  join public.genome_files f on f.id=h.id where h.subject_id=pg_temp.sid('own')),
 'the record and its confirmed file are the person''s');
select ok((select revoked_at is not null and revocation_reason='superseded' from public.subject_consents
 where id=(select id from own_consent)),'the uploader''s permission ends as superseded, and is kept');
select is((select count(*) from public.account_operation_nonces where operation='subject_transfer' and nonce_hash=pg_temp.h('move')),
 1::bigint,'the move spends its api.subject-transfer code once');

-- The notices: the right kinds, to the right accounts, and to no one else.
select is(pg_temp.notices('own'),array['subject-transfer-access-revoked 04','subject-transfer-former-owner 01',
 'subject-transfer-new-owner 02'],
 'the move''s three notices: the new owner''s to the person, the former owner''s to the uploader, and 04''s');
select is(pg_temp.all_transfer_notices(),array['subject-transfer-access-revoked 04','subject-transfer-former-owner 01',
 'subject-transfer-new-owner 02'],'no transfer notice goes to any other account, nor to a contact');

-- Every download copy of the record has stopped working.
select is((select status from public.generated_exports where id=(select export_id from copies where name='own-person-record')),'revoked',
 'the person''s export of the record is revoked');
select is(array[pg_temp.copy_works('own-person-record'),pg_temp.copy_works('own-person-account')],
 array['stopped 42501 not_found','stopped 42501 not_found'],
 'no copy can be opened or read any more: the export of the record and the person''s whole-account export');

-- Permissions, results and the card.
select is(pg_temp.prior_grants_live('own'),0::bigint,'no other account keeps a permission on the record');
select is((select array_agg(status) from public.subject_relationships where subject_id=pg_temp.sid('own')
 and recipient_account_id=pg_temp.a('4')),array['revoked'],'04''s link to the record ends');
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('own'),'reports.monogenic',true)),1,
 'the person still reads the result they kept');
select throws_ok($$select pg_temp.ready('own')$$,'42501','not_found','the uploader''s card has nothing left to offer for it');

-- The terminal mail worker sends each, to its own account.
create temporary table own_claimed as select * from pg_temp.claim_all();
select is((select array_agg(notice_kind||' '||right(recipient_account_id::text,2) order by notice_kind,recipient_account_id)
 from own_claimed),array['subject-transfer-access-revoked 04','subject-transfer-former-owner 01','subject-transfer-new-owner 02'],
 'the terminal mail worker claims each of the three, for its own account, and nothing else');
select ok((select bool_and(public.authorize_invitation_terminal_mail_v1(outbox_id,attempt_ordinal)) from own_claimed),
 '... and is authorized to send each');
rollback to person_move;

-- 2. The uploader's withdrawal hands a record to the person ----------------------------------
-- A second record from 01 that 02 holds with their own account: 02 confirms
-- the first file and not the second, keeps a result of their own, shares one
-- with 01 and turns Copilot on for 01, who asks it about the record; 09 holds
-- a family link to it.
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','open-sign-aaaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 'fixture: the person confirms a second request with their own account');
select is((select h->>'status' from (select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64)) h) x),'stored_quarantined',
 'fixture: a first file is held');
insert into grants select 'main-self',(pg_temp.share('main','reports.monogenic','self','6')->>'recordId')::uuid;
select is(pg_temp.notice_session('main','1'),1::bigint,'fixture: its notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'open-confirm-1111111111111111111','confirm',pg_temp.a('2')),
 'confirmed','fixture: the person confirms the first file');
select pg_temp.normalize(repeat('7',64),repeat('e',64));
select is(pg_temp.complete_next_report(repeat('8',64)),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'fixture: the person''s own result is completed');
insert into grants select 'main-variant',(pg_temp.share('main','reports.monogenic','uploader','3')->>'recordId')::uuid;
select is(pg_temp.complete_next_report(repeat('5',64)),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'fixture: the result the person shared with the uploader is completed');
insert into grants select 'main-copilot',(pg_temp.share('main','copilot.local','uploader','1')->>'recordId')::uuid;
create temporary table uploader_self as select id from public.subjects where subject_account_id=pg_temp.a('1') and subject_class='self';
select public.save_own_copilot_settings_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.synthetic_copilot_settings('synthetic-model','local'),
 null,repeat('b',64),null);
create temporary table presentation as select public.own_copilot_presentation_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self)) value;
select public.grant_own_copilot_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self),(select value->'snapshot' from presentation),
 (select value->'artifacts' from presentation),repeat('9',64),clock_timestamp()+interval '9 minutes');
create temporary table provider as select public.own_copilot_authority_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self)) value;
create temporary table authority as select public.subject_copilot_scope_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'))->'authority' value;
select is((select value->>'case' from authority),'uploader','fixture: the uploader''s one-record Copilot scope is open');
create temporary table first_turn as select (public.subject_copilot_chat_v1('commit',pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),null,
 jsonb_build_object('message','What did they share?','answer','One saved report.',
  'citations',jsonb_build_array(jsonb_build_object('id','report:x','label','Synthetic variant',
   'href','/genome/s-'||pg_temp.sid('main')||'/reports/synthetic-transfer-open-variant')),
  'lastOrdinal',0,'nonceHash',encode(extensions.digest('open-nonce-1','sha256'),'hex'),
  'expiresAt',to_jsonb(clock_timestamp()+interval '9 minutes'),'provider',(select value from provider),
  'authority',(select value from authority),
  'used',jsonb_build_array(jsonb_build_object('authority',(select value from authority),'purposes',jsonb_build_array('reports.monogenic'),
   'files',jsonb_build_array(jsonb_build_object('fileId',pg_temp.fxv('main','revision'),'purpose','reports.monogenic'))))))
 ->>'chatId')::uuid id;
select is(pg_temp.uploader_reads('main'),2::bigint,'fixture: the uploader''s conversation read the record');
select is((select h->>'status' from (select pg_temp.hold('main-2',pg_temp.sid('main'),repeat('9',64)) h) x),'stored_quarantined',
 'fixture: a second file is held and not yet confirmed');
select pg_temp.link('main','9');

-- Every download copy of the record before the withdrawal, each working: the
-- person's export of the record and of their whole account (the record is a
-- partition of both), 09's whole-account export (which holds 09's link to
-- the record), and two live download sessions (synthetic: the uploader's of
-- the record's file, the person's of that export). The uploader can hold no
-- whole-account copy here, as it holds a file of the record (see 1a).
select ok(pg_temp.ready_copy('main-person-record','2','subject',pg_temp.sid('main')) ~ '^[0-9a-f]{64}$'
 and pg_temp.ready_copy('main-person-account','2','account',pg_temp.a('2')) ~ '^[0-9a-f]{64}$'
 and pg_temp.ready_copy('main-other-account','9','account',pg_temp.a('9')) ~ '^[0-9a-f]{64}$',
 'fixture: the person holds a READY export of the record and of their whole account, and 09 one of theirs');
select is((select array_agg(c.name order by c.name) from copies c join public.generated_exports e on e.id=c.export_id
 where pg_temp.sid('main')::text in (select jsonb_array_elements_text(e.subject_partitions))),
 array['main-person-account','main-person-record'],'fixture: the record is a partition of both of the person''s copies');
select isnt(pg_temp.probe($$delete from public.subject_relationships where subject_id=pg_temp.sid('main')
  and recipient_account_id=pg_temp.a('9')$$,$$select pg_temp.authority('9','account',pg_temp.a('9'))->>'authorityReceipt'$$),
 (select receipt from copies where name='main-other-account'),'fixture: 09''s copy holds its link to the record');
select is(pg_temp.authority('1','account',pg_temp.a('1'))->>'refused','0A000 export_result_projection_unavailable',
 'fixture: the uploader can hold no whole-account copy while it holds a file of the record');
select is(array[pg_temp.copy_works('main-person-record'),pg_temp.copy_works('main-person-account'),pg_temp.copy_works('main-other-account')],
 array['works','works','works'],'before the withdrawal each copy can still be opened and read');
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
  and sp.account_id=pg_temp.a('2') and sp.status='active'),'export',(select export_id from copies where name='main-person-record'),
  'synthetic-export-download',(select object_id from xo),1,1,repeat('9',64),3,clock_timestamp()+interval '1 hour',null;
select ok((select owner_account_id=pg_temp.a('1') and subject_account_id=pg_temp.a('2') and ownership_transferred_at is null
  from public.subjects where id=pg_temp.sid('main'))
 and (select array_agg(state order by held_at) from public.other_adult_held_uploads where subject_id=pg_temp.sid('main'))
  =array['confirmed','pending'],
 'fixture: the uploader owns the record, the person holds it, one file confirmed and one not');

-- The card's read and the withdrawal.
select is(pg_temp.ready('main'),'hand-over','the uploader''s card reads hand-over: its withdrawal hands the record to the person');
create temporary table withdrawal_consent as select sc.id from public.subject_consents sc where sc.subject_id=pg_temp.sid('main')
 and sc.account_id=pg_temp.a('1') and sc.consent_type='upload_class' and sc.revoked_at is null;
set local role service_role;
create temporary table withdrawal as select public.withdraw_other_adult_upload_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),
 pg_temp.h('withdraw'),clock_timestamp()+interval '5 minutes') body;
reset role;
select is((select body from withdrawal),'{"case":"adult"}'::jsonb,'the withdrawal is accepted as the adult case');

-- What moved, what ended.
select ok((select s.owner_account_id=pg_temp.a('2') and s.subject_account_id=pg_temp.a('2') and s.subject_class='other_adult'
  and s.lifecycle='active' and s.ownership_transferred_at is not null from public.subjects s where s.id=pg_temp.sid('main')),
 'the record is the person''s');
select is((select array_agg(h.state||' '||coalesce(f.user_id::text,'none') order by h.held_at) from public.other_adult_held_uploads h
  left join public.genome_files f on f.id=h.id where h.subject_id=pg_temp.sid('main')),
 array['transferred '||pg_temp.a('2'),'withdrawn none'],
 'the file the person confirmed is theirs; the file they had not confirmed is withdrawn and has no file row');
select ok((select revoked_at is not null and revocation_reason='withdrawn' from public.subject_consents
 where id=(select id from withdrawal_consent)),'the uploader''s permission is withdrawn, and kept');
select is((select count(*) from public.account_operation_nonces where operation='subject_delete' and nonce_hash=pg_temp.h('withdraw')),
 1::bigint,'the withdrawal spends its api.subject-delete code once');

-- The notices: the right kinds, to the right accounts, and to no one else.
select is(pg_temp.notices('main'),array['subject-transfer-access-revoked 09','withdrawal-transfer-former-owner 01',
 'withdrawal-transfer-new-owner 02'],
 'the withdrawal''s three notices: the new owner''s to the person, the former owner''s to the uploader, and 09''s');
select is(pg_temp.all_transfer_notices(),array['subject-transfer-access-revoked 09','withdrawal-transfer-former-owner 01',
 'withdrawal-transfer-new-owner 02'],'no transfer notice goes to any other account, nor to a contact');
select is((select count(*) from public.mail_outbox m join private.invitation_terminal_notices n on n.id=m.invitation_terminal_notice_id
 where n.invitation_id=pg_temp.invitation_of(pg_temp.sid('main')) and n.state='pending' and m.state='queued'
  and m.template_payload=jsonb_build_object('kind',n.notice_kind)),3::bigint,
 'each has one queued mail row that carries only its kind (the app holds the words)');

-- Every download copy of the record has stopped working.
select ok((select e.status='revoked' and e.completed_at is null and a.state='cleanup_pending' and j.active_attempt is null
 from public.generated_exports e join private.export_archive_attempts a on a.export_id=e.id
  join private.export_archive_jobs j on j.export_id=e.id where e.id=(select export_id from copies where name='main-person-record')),
 'the person''s export of the record is stopped through the cleanup door and revoked');
select is(array[pg_temp.copy_works('main-person-record'),pg_temp.copy_works('main-person-account'),pg_temp.copy_works('main-other-account')],
 array['stopped 42501 not_found','stopped 42501 not_found','stopped 42501 not_found'],
 'no copy can be opened or read any more: the export of the record, the person''s whole-account export and 09''s');
select is((select jsonb_agg(status order by purpose) from public.download_sessions where purpose like 'synthetic-%'),
 '["revoked","revoked"]'::jsonb,'both live download sessions are revoked, the uploader''s and the person''s');

-- Conversations, permissions and the card.
select is(pg_temp.uploader_reads('main'),0::bigint,'every turn of the uploader''s that read the record is deleted');
select is((select count(*) from public.chats where subject_id=pg_temp.sid('main') and user_id<>pg_temp.a('2'))
 +(select count(*) from public.chats where id=(select id from first_turn)),0::bigint,
 'the uploader''s conversation about the record is deleted, never reassigned');
select is((select count(*) from public.copilot_context_tokens where target_id=pg_temp.sid('main')),0::bigint,
 'no context token names the record');
select is(pg_temp.prior_grants_live('main'),0::bigint,'every permission the person gave another account on the record ends');
select ok((select bool_and(g.revoked_at is not null and g.revocation_reason='subject_transferred' and d.status='revoked')
 from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id
 where g.grant_id in (select id from grants where name in ('main-variant','main-copilot'))),
 '... both of the uploader''s, the result layer and Copilot, revoked as transferred');
select ok((select g.revoked_at is null and d.status='current' from public.purpose_grants g
 join public.directional_grants d on d.grant_id=g.grant_id where g.grant_id=(select id from grants where name='main-self')),
 '... and the person''s own permission stays current');
select is((select array_agg(status) from public.subject_relationships where subject_id=pg_temp.sid('main')
 and recipient_account_id=pg_temp.a('9')),array['revoked'],'09''s link to the record ends');
select is(public.path_b_report_results_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),'reports.monogenic',true),'[]'::jsonb,
 'the uploader reads no result');
select throws_ok($$select pg_temp.ready('main')$$,'42501','not_found','the uploader''s card has nothing left to offer');

-- The terminal mail worker sends each, to its own account.
create temporary table main_claimed as select * from pg_temp.claim_all();
select is((select array_agg(notice_kind||' '||right(recipient_account_id::text,2) order by notice_kind,recipient_account_id)
 from main_claimed),array['subject-transfer-access-revoked 09','withdrawal-transfer-former-owner 01','withdrawal-transfer-new-owner 02'],
 'the terminal mail worker claims each of the three, for its own account, and nothing else');
select ok((select bool_and(public.authorize_invitation_terminal_mail_v1(outbox_id,attempt_ordinal)) from main_claimed),
 '... and is authorized to send each');
select lives_ok('set constraints all immediate','the withdrawal satisfies every deferred constraint');

select * from finish();
rollback;
