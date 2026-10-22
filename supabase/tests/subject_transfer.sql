-- api.subject-transfer (migration 20261016221000_subject_transfer; owner
-- decisions 2026-10-16, "The subjects endpoints (G2.1)" and "Subjects delete
-- and transfer: four further cases", and the 2026-10-22 rule for wording
-- nobody has approved). The door is built closed; the transfer behind it is
-- tested directly. A Path B record bound to the person's own account becomes
-- the person's: their completed result stays readable under their own grant,
-- the uploader loses every access, nothing new is analysed, and each file is
-- relocated to a fresh flat key by the worker's doors. A pending file refuses
-- the whole transfer. Synthetic accounts, files and results only. Everything
-- rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc

update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
-- Reference selection is isolated to one published synthetic template.
update public.report_templates set status='review' where status='published';
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants)
 values('synthetic-transfer-variant','synthetic','Synthetic variant','Synthetic transfer fixture.',
  'published','emerging','variant_call',null,
  '[{"rsid":123,"gene":"SYNTHETIC","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AG":"Synthetic covered genotype"}}]');
create function pg_temp.insurance(p_account text,p_nonce text) returns jsonb language plpgsql as $$
declare c jsonb; v_subject uuid; a public.consent_artifacts%rowtype;
begin
 select id into strict v_subject from public.subjects where subject_class='self' and subject_account_id=pg_temp.a(p_account);
 c:=private.own_upload_context_v1(pg_temp.a(p_account),pg_temp.s(p_account),v_subject);
 select * into strict a from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and superseded_at is null;
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
  values(repeat(p_nonce,64),pg_temp.a(p_account),pg_temp.s(p_account),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
 return public.sign_own_upload_artifact_v1(pg_temp.a(p_account),pg_temp.s(p_account),v_subject,a.artifact_key,a.version,a.body_sha256,
  array['understood'],(c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,(c->>'jurisdictionRevision')::bigint,
  (c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,repeat(p_nonce,64));
end;
$$;
select pg_temp.insurance('1','9');
select pg_temp.insurance('2','0');
create function pg_temp.result_payload() returns jsonb language sql as $$
 select jsonb_build_object('reports',coalesce(jsonb_agg(jsonb_build_object('slug',t.slug,'covered',true,
  'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,
   'title',t.title,'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,
   'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)),
  'variants',jsonb_build_array(jsonb_build_object('rsid',123,'outcome',jsonb_build_object('status','genotyped','genotype','AG',
   'interpretation','Synthetic covered genotype','strandFlipped',false))),'conflictingRsids','[]'::jsonb) order by t.slug),'[]'),
  'prs','[]'::jsonb) from public.report_templates t where status='published' and layer::text='variant_call';
$$;
-- One queued report through its claim, stage and completion.
create function pg_temp.complete_next_report(p_hash text) returns jsonb language plpgsql as $$
declare c jsonb;
begin
 c:=public.path_b_report_v1('claim',null,p_hash,null,null,true);
 perform public.path_b_report_v1('stage',(c->>'jobId')::uuid,p_hash,(c->>'claim')::uuid,pg_temp.result_payload(),true);
 return public.path_b_report_v1('complete',(c->>'jobId')::uuid,p_hash,(c->>'claim')::uuid,null,true);
end;
$$;
create temporary table grants(name text primary key,receipt jsonb);
create function pg_temp.grant_id(p_name text) returns uuid language sql as
 $$ select (receipt->>'recordId')::uuid from grants where name=p_name $$;

-- The main record: the person (02) confirms with their own account, a file
-- is held and confirmed, normalized, and two results are completed, one for
-- the person and one the person shared with the uploader (01).
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','transfer-sign-aaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 'fixture: the person confirms the main record with their own account');
select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64));
insert into grants select 'self',public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),
 'reports.monogenic','self',a.version,a.body_sha256,repeat('6',64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key='consent.own-monogenic' and a.superseded_at is null;
select pg_temp.notice_session('main','1');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'transfer-confirm-111111111111','confirm',pg_temp.a('2')),
 'confirmed','fixture: the person confirms the file');
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
insert into grants select 'uploader',public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),
 'reports.monogenic','uploader',a.version,a.body_sha256,repeat('3',64),clock_timestamp()+interval '5 minutes',true)
 from public.consent_artifacts a where a.artifact_key='consent.share-with-adult' and a.superseded_at is null;
select is(pg_temp.complete_next_report(repeat('5',64)),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'fixture: the result the person shared with the uploader is completed');
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic',true)),1,
 'fixture: before a transfer the person reads their result');
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),'reports.monogenic',true)),1,
 'fixture: before a transfer the uploader reads the result shared with them');

-- A second record of the person's, with a file still pending, and a third
-- confirmed with no account.
select pg_temp.requested('pend','b',repeat('b',64));
select is(pg_temp.account_confirms('b','transfer-sign-bbbbbbbbbbbbbbbb','2',repeat('b',64)),'accepted',
 'fixture: the person confirms a second record with their own account');
select pg_temp.hold('pend',pg_temp.sid('pend'),repeat('d',64));
select pg_temp.requested('noacct','c',repeat('c',64));
select is(pg_temp.token_confirms('c','transfer-token-cccccccccccccccc'),'accepted','fixture: a third record is confirmed with no account');
select ok((select owner_account_id=pg_temp.a('1') and subject_account_id=pg_temp.a('2') and ownership_transferred_at is null
 from public.subjects where id=pg_temp.sid('main')),'fixture: the uploader owns the main record and it is bound to the person');

create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('subject-transfer:'||p,'sha256'),'hex') $$;
create function pg_temp.transfer(p_account text,p_subject uuid,p_code text) returns jsonb language sql volatile as
 $$ select private.transfer_subject_v1(pg_temp.a(p_account),pg_temp.s(p_account),p_subject,pg_temp.h(p_code),
   clock_timestamp()+interval '5 minutes') $$;
create function pg_temp.untouched() returns boolean language sql as $$
 select (select count(*) from public.account_operation_nonces where operation='subject_transfer')=0
  and (select count(*) from private.subject_ownership_transfers)=0
  and (select count(*) from private.subject_transfer_relocations)=0
  and not exists(select 1 from public.subjects where ownership_transferred_at is not null)
  and (select owner_account_id from public.subjects where id=pg_temp.sid('main'))=pg_temp.a('1')
  and (select state from public.other_adult_held_uploads where subject_id=pg_temp.sid('main'))='confirmed'
  and (select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('main'))=2
$$;

-- 1. Privileges and the closed door --------------------------------------------------------
select ok(has_function_privilege('service_role','public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute')
 and not has_function_privilege('authenticated','public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute')
 and not has_function_privilege('anon','public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute')
 and not has_function_privilege('inherit_upload_only','public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute'),
 'only the service role may call the transfer door');
select ok(not has_function_privilege('service_role','private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)','execute')
 and not has_function_privilege('service_role','private.purge_transferred_adult_subject_v1(uuid,uuid)','execute')
 and not has_function_privilege('service_role','private.subject_transfer_open_v1()','execute'),
 'nothing behind the door is callable by the service role');
select ok((select bool_and(has_function_privilege('service_role',f,'execute') and not has_function_privilege('authenticated',f,'execute')
  and not has_function_privilege('anon',f,'execute') and not has_function_privilege('inherit_upload_only',f,'execute'))
 from unnest(array['public.subject_transfer_relocation_work_v1(boolean)','public.claim_subject_transfer_relocation_v1(uuid,text,boolean)',
  'public.check_subject_transfer_relocation_v1(uuid,text,boolean)','public.swap_subject_transfer_relocation_v1(uuid,text,uuid,bigint,text,boolean)',
  'public.fence_subject_transfer_relocation_v1(uuid,text,boolean)','public.claim_subject_transfer_disposal_v1(uuid,text,boolean)',
  'public.finish_subject_transfer_disposal_v1(uuid,text,boolean)','public.claim_subject_transfer_retirement_v1(uuid,text,boolean)',
  'public.finish_subject_transfer_retirement_v1(uuid,text,boolean)']) f),
 'the relocation doors belong to the service role alone');
select ok((select bool_and(not has_table_privilege(r,t,'select') and not has_table_privilege(r,t,'insert'))
 from unnest(array['private.subject_ownership_transfers','private.subject_transfer_relocations',
  'private.subject_transfer_relocation_attempts']) t cross join unnest(array['anon','authenticated','service_role','inherit_upload_only']) r),
 'no API role reads or writes the transfer and relocation rows');
select is(private.subject_transfer_open_v1(),false,
 'the door is closed: the three notices have no approved wording (2026-10-22 rule)');
set local role service_role;
select throws_ok($$select public.transfer_subject_v1('0b5e0000-0000-4000-8000-000000000002','0b5e0000-0000-4000-8000-000000000012',
 (select subject_id from fx where name='main'),encode(extensions.digest('subject-transfer:door','sha256'),'hex'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found','the closed door answers not found even to the record''s own person');
reset role;
select ok(pg_temp.untouched(),'the closed door writes nothing');
select ok((select pg_get_constraintdef(oid) like '%subject_transfer%' from pg_constraint
 where conname='account_operation_nonces_operation_check'),'the operation nonce check knows subject_transfer');
select ok((select pg_get_constraintdef(oid) like '%subject_sharing_stop%' and pg_get_constraintdef(oid) like '%subject_delete%'
  and pg_get_constraintdef(oid) like '%other_adult_upload_artifact_sign%' from pg_constraint
 where conname='account_operation_nonces_operation_check'),'... and keeps every earlier operation');

-- 2. Refusals behind the door write nothing ---------------------------------------------------
select throws_ok($$select pg_temp.transfer('9',pg_temp.sid('main'),'outsider')$$,'42501','not_found',
 'an outsider cannot transfer a record');
select throws_ok($$select pg_temp.transfer('1',pg_temp.sid('main'),'uploader')$$,'42501','not_found',
 'the uploader cannot transfer the record they hold');
select throws_ok($$select pg_temp.transfer('2',pg_temp.sid('noacct'),'noacct')$$,'42501','not_found',
 'a record not bound to the caller''s account cannot be transferred to them');
select throws_ok($$select pg_temp.transfer('2',pg_temp.sid('pend'),'pending')$$,'42501','not_found',
 'a record with a Path B file still pending is refused');
select throws_ok($$select private.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('1'),pg_temp.sid('main'),pg_temp.h('crossed'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found','another account''s session cannot carry the transfer');
select throws_ok($$select private.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),pg_temp.h('stale'),
 clock_timestamp()+interval '11 minutes')$$,'22023','invalid_operation_nonce','a code living past ten minutes is refused');
select ok(pg_temp.untouched() and (select owner_account_id from public.subjects where id=pg_temp.sid('pend'))=pg_temp.a('1')
 and (select state from public.other_adult_held_uploads where subject_id=pg_temp.sid('pend'))='pending',
 'every refusal writes nothing, and the pending record stays with its uploader');

-- 3. The transfer -----------------------------------------------------------------------------
create temporary table before_transfer as select s.lifecycle_revision,s.subject_binding_revision,
 (select count(*) from public.subject_consents where subject_id=s.id and revoked_at is null) consents,
 (select count(*) from public.consent_signatures where target_kind='subject' and target_id=s.id) signatures,
 (select count(*) from public.legal_audit_log) audit
 from public.subjects s where s.id=pg_temp.sid('main');
create temporary table transferred as select pg_temp.transfer('2',pg_temp.sid('main'),'main') body;
select is((select body->>'status' from transferred),'transferred','the transfer answers transferred');
select is((select body->>'subjectId' from transferred),pg_temp.sid('main')::text,'... with the route subject');
select ok((select (body->>'effectiveAt')::timestamptz=t.transferred_at from transferred,private.subject_ownership_transfers t),
 '... effective at the committed transfer time');
select ok((select s.owner_account_id=pg_temp.a('2') and s.subject_account_id=pg_temp.a('2') and s.subject_class='other_adult'
  and s.lifecycle='active' and s.ownership_transferred_at is not null
  and s.lifecycle_revision=b.lifecycle_revision+1 and s.subject_binding_revision=b.subject_binding_revision
 from public.subjects s,before_transfer b where s.id=pg_temp.sid('main')),
 'the record stays a separate other_adult record, now owned by the person, its binding revision kept');
select ok((select id<>pg_temp.sid('main') from public.subjects where subject_class='self' and subject_account_id=pg_temp.a('2')),
 'no upload is merged into the person''s own record');
select ok((select t.from_account_id=pg_temp.a('1') and t.to_account_id=pg_temp.a('2') and t.file_count=1
 from private.subject_ownership_transfers t where t.subject_id=pg_temp.sid('main')),'one immutable transfer row names both owners');
select throws_ok($$update private.subject_ownership_transfers set file_count=2$$,'42501','subject ownership transfer is immutable',
 'the transfer row cannot be changed');
select is((select count(*) from public.account_operation_nonces where operation='subject_transfer' and nonce_hash=pg_temp.h('main')),
 1::bigint,'the code is recorded once, in the same transaction');
select ok((select h.state='transferred' and h.terminal_at is not null from public.other_adult_held_uploads h
 where h.subject_id=pg_temp.sid('main')),'the confirmed revision ends as transferred');
select ok((select f.id=h.id and f.user_id=pg_temp.a('2') and f.bucket_path=h.object_name and f.storage_object_id is null
 from public.genome_files f join public.other_adult_held_uploads h on h.id=f.id where h.subject_id=pg_temp.sid('main')),
 'the file is detached into a person-owned file that still names the old object');
select is((select count(*) from public.user_variants v join public.other_adult_held_uploads h on h.id=v.file_id
 where h.subject_id=pg_temp.sid('main') and v.user_id is distinct from pg_temp.a('2')),0::bigint,
 'the file''s variant rows are the person''s too');
select ok((select r.state='queued' and r.old_object_id=h.storage_object_id and r.old_object_key=h.object_name
  and r.byte_count=h.size_bytes and r.sha256=h.raw_sha256 and r.old_owner_account_id=pg_temp.a('1')
  and r.new_owner_account_id=pg_temp.a('2') and r.file_id=h.id and r.new_object_key is null
 from private.subject_transfer_relocations r join public.other_adult_held_uploads h on h.id=r.held_upload_id
 where r.subject_id=pg_temp.sid('main')),'one relocation row records the exact object, its size, hash and both owners');
select ok((select count(*)=1 and bool_and(b.recipient_account_id=pg_temp.a('2') and b.state='complete')
 from private.path_b_report_bindings b where b.subject_id=pg_temp.sid('main')),
 'only the person''s own completed result stays; the result shared with the uploader is deleted');
select ok((select g.revoked_at is not null and g.revocation_reason='subject_transferred' and d.status='revoked'
 from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id
 where g.grant_id=pg_temp.grant_id('uploader')),'the uploader''s grant is revoked');
select ok((select g.revoked_at is null and d.status='current' from public.purpose_grants g
 join public.directional_grants d on d.grant_id=g.grant_id where g.grant_id=pg_temp.grant_id('self')),
 'the person''s own grant stays current');
select is((select count(*) from public.subject_relationships where subject_id=pg_temp.sid('main')
 and status in ('pending','current') and recipient_account_id is distinct from pg_temp.a('2')),0::bigint,
 'every relationship naming another recipient ends');
select ok((select (select count(*) from public.subject_consents where subject_id=pg_temp.sid('main') and revoked_at is null)=b.consents
 and (select count(*) from public.consent_signatures where target_kind='subject' and target_id=pg_temp.sid('main'))=b.signatures
 from before_transfer b),'original consents and signatures are kept as they were');
select ok(exists(select 1 from public.legal_audit_log where event_code='subject.ownership_transferred')
 and (select count(*) from public.legal_audit_log)>(select audit from before_transfer),
 'one subject.ownership_transferred event is appended to the kept audit chain');
select ok((select not (coded_context::text ~ '@|[0-9a-f]{64}') from public.legal_audit_log
 where event_code='subject.ownership_transferred'),'the audit event carries no contact or token');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main') and status in ('queued','running')),0::bigint,
 'no former-owner job is left queued or running');

-- 4. Reading after the transfer ------------------------------------------------------------------
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic',true)),1,
 'the person still reads their result under their own grant');
select is(private.path_b_result_read_v1(pg_temp.a('2'),pg_temp.sid('main'),'reports.monogenic'),'{"allowed":true,"gate":"ready"}'::jsonb,
 'the read decision opens for the person');
create temporary table reading as select public.capture_path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),true) c;
select is((select c->'metadata'->>'direction' from reading),'self','the saved reader names the person''s own direction');
select ok(public.confirm_path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),(select c->>'receipt' from reading),true),
 'the person''s saved projection confirms');
select is(public.path_b_report_results_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),'reports.monogenic',true),'[]'::jsonb,
 'the uploader reads nothing');
select is(public.path_b_report_metadata_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),true),'[]'::jsonb,
 'the uploader sees no reading metadata');
select throws_ok($$select public.capture_path_b_report_results_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),true)$$,
 '42501','not_found','the uploader cannot capture anything');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('main'),'reports.monogenic')->>'gate','not-found',
 'the uploader''s read decision is not found');
select is(public.path_b_report_results_v1(pg_temp.a('9'),pg_temp.s('9'),pg_temp.sid('main'),'reports.monogenic',true),'[]'::jsonb,
 'an outsider reads nothing');
select ok(not exists(select 1 from jsonb_array_elements(public.other_adult_upload_targets_v1(pg_temp.a('1'),pg_temp.s('1'),true)) t
 where (t->>'subjectId')::uuid=pg_temp.sid('main')),'the record leaves the uploader''s held-upload list');
select throws_ok($$select public.issue_other_adult_held_upload_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),'VCF',8,repeat('f',64),true)$$,
 '42501','not_found','the uploader cannot add a file');
-- No new analysis runs.
select is(public.enqueue_path_b_reports_v1(pg_temp.sid('main'),true),0,'no report can be queued for the transferred record');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main') and status in ('queued','running'))
 +(select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('main') and state<>'complete'),0::bigint,
 '... and no job or binding is created');
select throws_ok($$select private.enqueue_path_b_normalization_v1((select id from public.other_adult_held_uploads where subject_id=pg_temp.sid('main')))$$,
 '42501','not_found','no normalization can be queued for it');
select throws_ok($$select public.grant_path_b_purpose_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.polygenic','self',
 a.version,a.body_sha256,repeat('4',64),clock_timestamp()+interval '5 minutes',true) from public.consent_artifacts a
 where a.artifact_key='consent.own-polygenic' and a.superseded_at is null$$,'42501','not_found',
 'the person cannot start a new Path B analysis on it either');
select throws_ok($$select pg_temp.transfer('2',pg_temp.sid('main'),'again')$$,'42501','not_found','a record transfers once');
-- The file identity guard admits the transfer's own transitions only.
select throws_ok($$update public.genome_files set user_id=pg_temp.a('9') where id=(select id from public.other_adult_held_uploads
 where subject_id=pg_temp.sid('main'))$$,'55000','immutable_file_identity','the rebind cannot be borrowed for another account');
select ok((select not private.file_transfer_transition_matches_v1(jsonb_populate_record(f,jsonb_build_object('user_id',pg_temp.a('1'))),
  jsonb_populate_record(f,jsonb_build_object('user_id',pg_temp.a('9'))))
  and private.file_transfer_transition_matches_v1(jsonb_populate_record(f,jsonb_build_object('user_id',pg_temp.a('1'))),f)
 from public.genome_files f where f.subject_id=pg_temp.sid('main')),
 'the rebind matches only the transfer''s own former and new owner');
select throws_ok($$update public.genome_files set bucket_path=gen_random_uuid()::text where id=(select id from public.other_adult_held_uploads
 where subject_id=pg_temp.sid('main'))$$,'55000','immutable_file_identity','the old key cannot be swapped outside the worker''s swap');

-- 5. Deleting before the relocation ran (rolled back) --------------------------------------------
savepoint delete_early;
create temporary table early as select public.delete_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),
 pg_temp.h('delete-early'),clock_timestamp()+interval '5 minutes') body;
select is((select body from early),'{"case":"adult"}'::jsonb,'the person deletes the transferred record through the adult case');
select ok((select state='cancelled' from private.subject_transfer_relocations where subject_id=pg_temp.sid('main')),
 'a waiting relocation is cancelled');
select ok((select d.object_name=r.old_object_key and d.account_id=pg_temp.a('2') from private.genome_file_deletions d
 join private.subject_transfer_relocations r on r.file_id=d.file_id where r.subject_id=pg_temp.sid('main')),
 '... and the file deletion pipeline removes the old object the file still names');
rollback to delete_early;

-- 6. The relocation worker's doors ------------------------------------------------------------------
select throws_ok($$select public.subject_transfer_relocation_work_v1(false)$$,'42501','not_found','the worker runs only under TEST-LOCAL');
create temporary table work1 as select public.subject_transfer_relocation_work_v1(true) w;
select is((select w->>'kind' from work1),'copy','the queued row is the next copy');
create temporary table claim1 as select public.claim_subject_transfer_relocation_v1((select (w->>'relocationId')::uuid from work1),
 repeat('a',64),true) c;
select ok((select c->>'oldKey'=r.old_object_key and c->>'newKey'=c->>'attemptId' and c->>'newKey'<>r.old_object_key
  and (c->>'byteCount')::bigint=r.byte_count and c->>'sha256'=r.sha256 and c->>'bucket'='genomes'
  and c->>'newKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 from claim1,private.subject_transfer_relocations r where r.subject_id=pg_temp.sid('main')),
 'the claim names the exact old object and one fresh flat <uuid> key');
select is(public.claim_subject_transfer_relocation_v1((select (c->>'relocationId')::uuid from claim1),repeat('b',64),true),null,
 'a row being copied cannot be claimed twice');
select ok(public.check_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim1),repeat('a',64),true),
 'the current claim checks');
select ok(not public.check_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim1),repeat('c',64),true),
 'another token does not');
-- A failed copy: only its own new key is disposed of.
insert into storage.objects(id,bucket_id,name,metadata) select gen_random_uuid(),'genomes',c->>'newKey','{"size":8}' from claim1;
select ok(public.fence_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim1),repeat('a',64),true),
 'a failed attempt is fenced');
select is((select state from private.subject_transfer_relocations where subject_id=pg_temp.sid('main')),'queued','... and its row is queued again');
select ok((select bucket_path=r.old_object_key and storage_object_id is null from public.genome_files f
 join private.subject_transfer_relocations r on r.file_id=f.id where r.subject_id=pg_temp.sid('main')),
 '... and the file still names the old object');
create temporary table work2 as select public.subject_transfer_relocation_work_v1(true) w;
select is((select w->>'kind'||':'||(w->>'attemptId') from work2),'dispose:'||(select c->>'attemptId' from claim1),
 'the fenced attempt''s new key is the next disposal');
create temporary table dispose1 as select public.claim_subject_transfer_disposal_v1((select (w->>'attemptId')::uuid from work2),repeat('d',64),true) c;
select is((select c->>'key' from dispose1),(select c->>'newKey' from claim1),'disposal names only the attempt''s own new key');
select throws_ok($$select public.finish_subject_transfer_disposal_v1((select (c->>'attemptId')::uuid from dispose1),repeat('d',64),true)$$,
 '55000','relocation_disposal_incomplete','disposal is not finished while the new key still exists');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='genomes' and name=(select c->>'key' from dispose1);
select ok(public.finish_subject_transfer_disposal_v1((select (c->>'attemptId')::uuid from dispose1),repeat('d',64),true),
 'disposal finishes once the new key is gone');
-- An expired lease is fenced by the next work call.
create temporary table claim2 as select public.claim_subject_transfer_relocation_v1(
 (select id from private.subject_transfer_relocations where subject_id=pg_temp.sid('main')),repeat('e',64),true) c;
update private.subject_transfer_relocation_attempts set claim_expires_at=clock_timestamp()-interval '1 second'
 where id=(select (c->>'attemptId')::uuid from claim2);
select is((select w->>'kind' from (select public.subject_transfer_relocation_work_v1(true) w) x),'dispose',
 'an expired attempt is fenced and handed to disposal');
select ok(not public.check_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim2),repeat('e',64),true),
 'an expired claim no longer checks');
select is((select c->>'key' from (select public.claim_subject_transfer_disposal_v1((select (c->>'attemptId')::uuid from claim2),
 repeat('2',64),true) c) x),(select c->>'newKey' from claim2),'the expired attempt''s own key is the one disposed of');
select ok(public.finish_subject_transfer_disposal_v1((select (c->>'attemptId')::uuid from claim2),repeat('2',64),true),
 'an expired attempt that never wrote its key is disposed of');
-- The successful copy.
create temporary table claim3 as select public.claim_subject_transfer_relocation_v1(
 (select id from private.subject_transfer_relocations where subject_id=pg_temp.sid('main')),repeat('f',64),true) c;
create temporary table new_object(id uuid);
insert into new_object values(gen_random_uuid());
insert into storage.objects(id,bucket_id,name,metadata) select n.id,'genomes',c->>'newKey','{"size":8}' from claim3,new_object n;
select throws_ok($$select public.swap_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim3),repeat('f',64),
 (select id from new_object),8,repeat('0',64),true)$$,'22023','relocation_integrity_mismatch','a hash that differs never swaps');
select throws_ok($$select public.swap_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim3),repeat('f',64),
 (select id from new_object),9,repeat('e',64),true)$$,'22023','relocation_integrity_mismatch','a size that differs never swaps');
select throws_ok($$select public.swap_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim3),repeat('9',64),
 (select id from new_object),8,repeat('e',64),true)$$,'42501','not_found','another token never swaps');
select ok(public.swap_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim3),repeat('f',64),
 (select id from new_object),8,repeat('e',64),true),'the verified copy swaps');
select ok((select f.bucket_path=c->>'newKey' and f.storage_object_id=(select id from new_object) and f.user_id=pg_temp.a('2')
  and o.state='current' and o.object_name=c->>'newKey' and o.sha256=repeat('e',64) and o.byte_count=8
 from public.genome_files f join public.genome_storage_objects o on o.genome_file_id=f.id,claim3
 where f.subject_id=pg_temp.sid('main')),'the file now names the new flat key and its own storage object');
select ok((select r.state='swapped' and r.new_object_key=c->>'newKey' from private.subject_transfer_relocations r,claim3
 where r.subject_id=pg_temp.sid('main')),'the row is swapped');
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),'reports.monogenic',true)),1,
 'the person still reads their result after the swap');
select ok(not public.fence_subject_transfer_relocation_v1((select (c->>'attemptId')::uuid from claim3),repeat('f',64),true)
 and (select state from private.subject_transfer_relocations where subject_id=pg_temp.sid('main'))='swapped',
 'a committed swap cannot be fenced, so its new key is never disposed of');
-- Readable only while the person's own grant is: revoked, expired, or after
-- its signing session ends, nothing is served (each case rolled back).
create temporary table reading_session(id uuid primary key);
insert into reading_session values(gen_random_uuid());
insert into auth.sessions(id,user_id,not_after) select id,pg_temp.a('2'),clock_timestamp()+interval '30 minutes' from reading_session;
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('2'),(select id from reading_session),pg_temp.sid('main'),
 'reports.monogenic',true)),1,'fixture: a second session of the person reads the result');
savepoint grant_cases;
update public.purpose_grants set revoked_at=clock_timestamp(),revocation_reason='withdrawn' where grant_id=pg_temp.grant_id('self');
select is(public.path_b_report_results_v1(pg_temp.a('2'),(select id from reading_session),pg_temp.sid('main'),'reports.monogenic',true),
 '[]'::jsonb,'a revoked grant serves nothing');
select is(private.path_b_result_read_v1(pg_temp.a('2'),pg_temp.sid('main'),'reports.monogenic')->>'gate','analysis-not-generated',
 '... and the read decision closes');
rollback to grant_cases;
-- Expired just after it was granted: always past, and always after granted_at
-- as the table requires, however soon after the grant this runs.
update public.purpose_grants set expires_at=granted_at+interval '1 microsecond' where grant_id=pg_temp.grant_id('self');
select is(public.path_b_report_results_v1(pg_temp.a('2'),(select id from reading_session),pg_temp.sid('main'),'reports.monogenic',true),
 '[]'::jsonb,'an expired grant serves nothing');
rollback to grant_cases;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=pg_temp.s('2');
select is(public.path_b_report_results_v1(pg_temp.a('2'),(select id from reading_session),pg_temp.sid('main'),'reports.monogenic',true),
 '[]'::jsonb,'once the grant''s own signing session ends nothing is served, as before the transfer');
rollback to grant_cases;
update public.subjects set subject_binding_revision=subject_binding_revision+1 where id=pg_temp.sid('main');
select is(public.path_b_report_results_v1(pg_temp.a('2'),(select id from reading_session),pg_temp.sid('main'),'reports.monogenic',true),
 '[]'::jsonb,'a grant made for another binding revision serves nothing');
rollback to grant_cases;
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('2'),(select id from reading_session),pg_temp.sid('main'),
 'reports.monogenic',true)),1,'with the grant current again the result is served');
create temporary table work3 as select public.subject_transfer_relocation_work_v1(true) w;
select is((select w->>'kind' from work3),'retire','after a committed swap the old object is next');
create temporary table retire1 as select public.claim_subject_transfer_retirement_v1((select (w->>'relocationId')::uuid from work3),repeat('1',64),true) c;
select is((select c->>'key' from retire1),(select old_object_key from private.subject_transfer_relocations where subject_id=pg_temp.sid('main')),
 'retirement names only the exact old object');
select throws_ok($$select public.finish_subject_transfer_retirement_v1((select (c->>'relocationId')::uuid from retire1),repeat('1',64),true)$$,
 '55000','relocation_retirement_incomplete','retirement is not finished while the old object exists');
delete from storage.objects where bucket_id='genomes' and name=(select c->>'key' from retire1);
select ok(public.finish_subject_transfer_retirement_v1((select (c->>'relocationId')::uuid from retire1),repeat('1',64),true),
 'retirement finishes once the old object is gone');
select ok((select r.state='complete' and r.completed_at is not null from private.subject_transfer_relocations r
 where r.subject_id=pg_temp.sid('main')),'the relocation is complete');
select is((select count(*) from public.upload_staging_objects w join public.other_adult_held_uploads h on h.upload_session_id=w.upload_session_id
 where h.subject_id=pg_temp.sid('main') and w.state<>'deleted' and w.object_name=(select c->>'key' from retire1)),0::bigint,
 'the held session''s working row no longer names a stored object');
select is(public.subject_transfer_relocation_work_v1(true),null,'nothing is left to do');
select lives_ok('set constraints all immediate','the transfer and relocation satisfy every deferred constraint');
set constraints all deferred;

-- 7. Deleting after the relocation ------------------------------------------------------------------
select throws_ok($$select public.delete_subject_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'),pg_temp.h('uploader-delete'),
 clock_timestamp()+interval '5 minutes')$$,'42501','not_found','the former uploader cannot delete it');
create temporary table late as select public.delete_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),
 pg_temp.h('delete-late'),clock_timestamp()+interval '5 minutes') body;
select is((select body from late),'{"case":"adult"}'::jsonb,'the person deletes it after the relocation');
select ok((select s.lifecycle='purged' and s.subject_account_id is null from public.subjects s where s.id=pg_temp.sid('main')),
 'the record is purged and stops naming the person''s account');
select ok((select d.object_name=(select c->>'newKey' from claim3) and d.account_id=pg_temp.a('2') from private.genome_file_deletions d
 join public.genome_files f on f.id=d.file_id where f.subject_id=pg_temp.sid('main')),
 'the person-owned file goes through the file deletion pipeline with its new key');
select is((select count(*) from private.path_b_report_bindings where subject_id=pg_temp.sid('main')),0::bigint,'its saved result goes at once');
select ok(exists(select 1 from public.contact_refusal_bars where target_kind='subject' and target_id=pg_temp.sid('main')),
 'the person''s delete writes the subject-controlled refusal bar');
select lives_ok('set constraints all immediate','the delete after a transfer satisfies every deferred constraint');

select * from finish();
rollback;
