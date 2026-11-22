-- A record transferred to its person is theirs to export (migration
-- 20261122160000_transferred_record_exports; D-162), a hand-over refused at
-- that moment says so (D-158), and the hand-over's audit event is on the
-- closed list of person-caused events (D-159). Owner decisions and defect
-- rows of 22 November 2026.
--
-- D-162. After either act (the person's own move through
-- public.transfer_subject_v1, the uploader's hand-over through
-- public.withdraw_other_adult_upload_v1) the person can export the record and
-- their whole account at once: the per-record and whole-account captures
-- (private.export_archive_authority_v1, which every request, worker step,
-- open and chunk recomputes) answer, with the TEST complete account archive
-- off and (inside a probe) on, a new READY copy of each passes
-- private.export_archive_current_v1, and "Download your data"
-- (public.own_subject_export_content_v1) lists the record's file and reads its
-- variants; before the relocation worker's swap (the file still under the key
-- the transfer recorded) and after it. The former uploader still cannot
-- export the record. Before any act, the person's exports read as they did,
-- and "Download your data" lists no file of a record the uploader holds.
--
-- 01 uploads; 02 is the person, with an account; 09 is an outsider.
-- Synthetic accounts, HMACs, files and results only; READY copies are
-- synthetic, written as the export worker leaves one. Everything rolls back.
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
-- What an account can export of a record: its per-record capture (the
-- record its one partition) and its whole-account capture (the record one of
-- its partitions), or each refusal.
create function pg_temp.can_export(p text,p_record text) returns text language plpgsql as $$
declare r jsonb:=pg_temp.authority(p,'subject',pg_temp.sid(p_record)); w jsonb:=pg_temp.authority(p,'account',pg_temp.a(p));
begin
 return 'record '||coalesce(r->>'refused',((r->'subjectPartitions')=jsonb_build_array(pg_temp.sid(p_record)))::text)
  ||' / account '||coalesce(w->>'refused',(pg_temp.sid(p_record)::text in (select jsonb_array_elements_text(w->'subjectPartitions')))::text);
end $$;
-- The same with the TEST native complete archive turned on, only inside a
-- probe: the whole-account capture is then
-- private.account_archive_complete_capture_v1 (the per-record one is the same).
create function pg_temp.can_export_archive(p text,p_record text) returns text language sql as $$
 select pg_temp.probe($q$update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',
   binding_sha256=repeat('2',64)$q$,
  format('select case when private.account_archive_complete_enabled_v1(pg_temp.origin(%L)) then pg_temp.can_export(%L,%L) else %L end',
   p,p,p_record,'archive off')) $$;
-- "Download your data": the listed source of the record's file, if any.
create function pg_temp.listed(p_record text) returns jsonb language sql as $$
 select x from jsonb_array_elements(public.own_subject_export_content_v1('list',pg_temp.a('2'),pg_temp.s('2'),null,null,0)) x
 where x#>>'{file,subject_id}'=pg_temp.sid(p_record)::text $$;
create function pg_temp.variants(p_record text) returns integer language sql as $$
 select jsonb_array_length(public.own_subject_export_content_v1('variants',pg_temp.a('2'),pg_temp.s('2'),
  (pg_temp.listed(p_record)#>>'{file,id}')::uuid,pg_temp.listed(p_record),0)) $$;
-- A new READY copy of the record and one of the whole account, each made now,
-- and whether each can be opened and read.
create function pg_temp.new_copies(p_label text,p_record text) returns text language plpgsql as $$
begin
 perform pg_temp.ready_copy(p_label||'-record','2','subject',pg_temp.sid(p_record));
 perform pg_temp.ready_copy(p_label||'-account','2','account',pg_temp.a('2'));
 return pg_temp.copy_works(p_label||'-record')||' / '||pg_temp.copy_works(p_label||'-account');
end $$;
-- The relocation worker's copy of a record's one file: its claim, the new
-- object it writes, and the swap (claimed by row, so another queued row of
-- an earlier local run is never taken).
create function pg_temp.relocate(p_record text,p_raw text) returns boolean language plpgsql as $$
declare c jsonb; v_object uuid:=gen_random_uuid();
begin
 c:=public.claim_subject_transfer_relocation_v1((select id from private.subject_transfer_relocations
  where subject_id=pg_temp.sid(p_record)),repeat('f',64),true);
 insert into storage.objects(id,bucket_id,name,metadata) values(v_object,'genomes',c->>'newKey','{"size":8}');
 return public.swap_subject_transfer_relocation_v1((c->>'attemptId')::uuid,repeat('f',64),v_object,8,repeat(p_raw,64),true);
end $$;

-- 0. The bodies and the two helpers -------------------------------------------------------
select is((select string_agg(md5(pg_get_functiondef(p.oid))||' '||p.proacl::text,', ' order by p.oid::regprocedure::text) from pg_proc p
 where p.oid in ('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)'::regprocedure,
  'private.export_account_path_b_snapshot_v1(jsonb,uuid)'::regprocedure,'private.own_export_source_v1(uuid,uuid,uuid)'::regprocedure,
  'private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure,'private.legal_audit_person_event_v1(text,text)'::regprocedure)),
 -- 20261122180000 (D-165) widens the two export bodies in place to either
 -- Path B flow, md5-guarded from exactly these successors.
 -- 20261122190000 (D-166) then has the capture ask the record's confirmation
 -- (private.path_b_confirmation_v1), md5-guarded from exactly its successor.
 case when position('20261122190000 (D-166)' in pg_get_functiondef('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)'::regprocedure))>0
  then '2fb0181f5c393cf7283cb9e33704789a {postgres=X/postgres}, e2d07abe4aa844c3c3a913e18be72015 {postgres=X/postgres}, '
  when position('20261122180000 (D-165)' in pg_get_functiondef('private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)'::regprocedure))>0
  then '5c9fee7018806a025ad537664cd23b69 {postgres=X/postgres}, e2d07abe4aa844c3c3a913e18be72015 {postgres=X/postgres}, '
  else '583e9efa4a60f086e3875fc40e03f491 {postgres=X/postgres}, b9ae87c681a443f9ac3fb1846a69520b {postgres=X/postgres}, ' end
 ||'f06ad94838f724581b457e800162a6bb {postgres=X/postgres}, a8000a6cccd2fce9c2b285ab268ed642 {postgres=X/postgres,service_role=X/postgres}, 0bb151e8b9849da4f6671237efc3d4c4 {postgres=X/postgres}',
 'the five bodies are as 20261122160000 left them (the two export bodies as 20261122180000 then widened them, the capture as 20261122190000 then patched it), each with its ACL');
select ok((select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['service_role','authenticated','anon','inherit_upload_only']) r
 cross join unnest(array['private.transferred_export_person_v1(uuid,uuid,uuid)','private.transferred_export_confirmation_v1(uuid)']) f),
 'no API role may call either new helper');

-- 1. D-159: the hand-over's event is a person-caused event of its route -----------------------
select ok(private.legal_audit_person_event_v1('subject.ownership_transferred','api.subject-delete')
 and private.legal_audit_person_event_v1('subject.ownership_transferred','api.subject-transfer')
 and private.legal_audit_person_event_v1('subject.deleted','api.subject-delete')
 and private.legal_audit_person_event_v1('embryo.upload-consent.withdrawn','api.consent-revoke'),
 'the closed list names the transfer on api.subject-delete, and keeps every pair it had');
select ok(not private.legal_audit_person_event_v1('subject.ownership_transferred','api.export')
 and not private.legal_audit_person_event_v1('subject.ownership_transferred','api.subject-sharing'),
 '... and no other route for that event');

-- 2. The person's own move ----------------------------------------------------------------
-- 02 confirms a request from 01 with their own account, confirms its file,
-- and keeps a result of their own.
select pg_temp.requested('own','b',repeat('b',64));
select is(pg_temp.account_confirms('b','exp-sign-bbbbbbbbbbbbbbbbbbbbbb','2',repeat('b',64)),'accepted',
 'fixture: the person confirms a request with their own account');
select is((select h->>'status' from (select pg_temp.hold('own',pg_temp.sid('own'),repeat('c',64)) h) x),'stored_quarantined',
 'fixture: its file is held');
insert into grants select 'own-self',(pg_temp.share('own','reports.monogenic','self','4')->>'recordId')::uuid;
select is(pg_temp.notice_session('own','2'),1::bigint,'fixture: its notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'exp-confirm-22222222222222222222','confirm',pg_temp.a('2')),
 'confirmed','fixture: the person confirms it');
select pg_temp.normalize(repeat('3',64),repeat('c',64));
select is(pg_temp.complete_next_report(repeat('6',64)),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'fixture: the person''s own result on it is completed');

-- Before the move, as before this migration.
select is(pg_temp.can_export('2','own'),'record true / account true',
 'before the move the person exports the record and their whole account, as before');
select is(pg_temp.can_export_archive('2','own'),'record true / account true','... with the complete archive on as well');
select is(pg_temp.listed('own'),null,'... and "Download your data" lists no file of a record the uploader holds');
select is(pg_temp.can_export('1','own'),'record 42501 not_found / account 0A000 export_result_projection_unavailable',
 'the uploader exports neither the record nor (while it holds a file of it) its whole account');

savepoint own_move;
set local role service_role;
select is(public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('own'),pg_temp.h('exp-move'),
 clock_timestamp()+interval '5 minutes')->>'status','transferred','the person moves the record into their account');
reset role;
create temporary table own_relocation as select * from private.subject_transfer_relocations where subject_id=pg_temp.sid('own');

-- At once, before the relocation worker's swap.
select is(pg_temp.can_export('2','own'),'record true / account true',
 'at once the person can export the record and their whole account, the record in each');
select is(pg_temp.can_export_archive('2','own'),'record true / account true',
 '... and the complete account archive captures the record too');
select is(pg_temp.new_copies('own-before-swap','own'),'works / works',
 '... and a new copy of each can be made, opened and read');
select ok((select (x#>>'{file,id}')::uuid=r.file_id and x#>>'{file,bucket_path}'=r.old_object_key
  and (x#>>'{file,storage_object_id}')::uuid=r.old_object_id and (x->>'normalized')::boolean
  and x#>>'{binding,accountId}'=pg_temp.a('2')::text
 from (select pg_temp.listed('own') x) l,own_relocation r),
 '"Download your data" lists the file, read through the exact object the transfer recorded, normalized');
select is(pg_temp.variants('own'),1,'... and reads its variants');
select is(public.own_subject_export_content_v1('check',pg_temp.a('2'),pg_temp.s('2'),(pg_temp.listed('own')#>>'{file,id}')::uuid,
 pg_temp.listed('own'),0),pg_temp.listed('own'),'... and its source rechecks as listed');
select is(pg_temp.can_export('1','own'),'record 42501 not_found / account 0A000 export_result_projection_unavailable',
 'the former uploader still exports nothing of the record');
select is(pg_temp.can_export_archive('1','own'),'record 42501 not_found / account 0A000 export_result_projection_unavailable',
 '... nor through the complete archive');
select is(pg_temp.authority('9','subject',pg_temp.sid('own'))->>'refused','42501 not_found','nor does an outsider');

-- After the swap.
select ok(pg_temp.relocate('own','c'),'fixture: the relocation worker copies the file to a key of its own and swaps');
select is(pg_temp.can_export('2','own'),'record true / account true',
 'after the swap the person still exports the record and their whole account');
select is(pg_temp.can_export_archive('2','own'),'record true / account true','... the complete archive too');
select is(pg_temp.new_copies('own-after-swap','own'),'works / works','... and a new copy of each works');
select ok((select x#>>'{file,bucket_path}'=r.new_object_key and (x#>>'{file,storage_object_id}')::uuid=r.new_object_id
  and (x->>'normalized')::boolean from (select pg_temp.listed('own') x) l,private.subject_transfer_relocations r
 where r.subject_id=pg_temp.sid('own') and r.state='swapped'),
 '"Download your data" lists the file under its own new object');
select is(pg_temp.variants('own'),1,'... and reads its variants');
select is(pg_temp.can_export('1','own'),'record 42501 not_found / account 0A000 export_result_projection_unavailable',
 'the former uploader still exports nothing of the record');
rollback to own_move;

-- 3. The uploader's hand-over ---------------------------------------------------------------
-- A second record from 01 that 02 holds with their own account: one file
-- confirmed with a result of the person's, one not confirmed.
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','exp-sign-aaaaaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 'fixture: the person confirms a second request with their own account');
select is((select h->>'status' from (select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64)) h) x),'stored_quarantined',
 'fixture: a first file is held');
insert into grants select 'main-self',(pg_temp.share('main','reports.monogenic','self','6')->>'recordId')::uuid;
select is(pg_temp.notice_session('main','1'),1::bigint,'fixture: its notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'exp-confirm-11111111111111111111','confirm',pg_temp.a('2')),
 'confirmed','fixture: the person confirms the first file');
select pg_temp.normalize(repeat('7',64),repeat('e',64));
select is(pg_temp.complete_next_report(repeat('8',64)),'{"status":"complete","purpose":"reports.monogenic"}'::jsonb,
 'fixture: the person''s own result is completed');
select is((select h->>'status' from (select pg_temp.hold('main-2',pg_temp.sid('main'),repeat('9',64)) h) x),'stored_quarantined',
 'fixture: a second file is held and not yet confirmed');
create function pg_temp.wd(p_account text,p_code text) returns text language sql volatile as
 $$ select public.withdraw_other_adult_upload_v1(pg_temp.a(p_account),pg_temp.s(p_account),pg_temp.sid('main'),pg_temp.h(p_code),
   clock_timestamp()+interval '5 minutes')::text $$;
create function pg_temp.untouched() returns text language sql as $$
 select (select owner_account_id::text from public.subjects where id=pg_temp.sid('main'))
  ||' '||(select string_agg(state,',' order by held_at) from public.other_adult_held_uploads where subject_id=pg_temp.sid('main'))
  ||' '||(select count(*) from private.subject_ownership_transfers where subject_id=pg_temp.sid('main'))
  ||' '||(select count(*) from public.account_operation_nonces where account_id=pg_temp.a('1') and operation='subject_delete') $$;
create temporary table main_before as select pg_temp.untouched() value;

-- D-158: a hand-over refused at that moment says so; nothing is written.
select is(pg_temp.probe($$update public.upload_sessions set status='validating' where id=pg_temp.fxv('main-2','upload')::uuid$$,
  $$select pg_temp.wd('1','validating')$$,$$select pg_temp.untouched()$$),
 '55000 hand_over_not_now / '||(select value from main_before),
 'D-158: a file still being validated refuses the hand-over for now, and nothing is written');
select is(pg_temp.probe($$insert into public.genome_files(user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
   values(pg_temp.a('1'),pg_temp.sid('main'),gen_random_uuid()::text,'Unexpected','vcf',1,8,'uploaded')$$,
  $$select pg_temp.wd('1','shape')$$,$$select pg_temp.untouched()$$),
 '55000 hand_over_not_now / '||(select value from main_before),
 'D-158: a file of a shape the transfer does not expect refuses the hand-over for now, and nothing is written');
select is(pg_temp.probe($$update auth.users set deleted_at=clock_timestamp() where id=pg_temp.a('2')$$,
  $$select pg_temp.wd('1','account-gone')$$,$$select pg_temp.untouched()$$),
 '55000 hand_over_not_now / '||(select value from main_before),
 'D-158: the person''s account gone refuses the hand-over for now, and nothing is written');
select is(pg_temp.probe($$update public.upload_sessions set status='validating' where id=pg_temp.fxv('main-2','upload')::uuid$$,
  $$select public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'),pg_temp.h('person-validating'),
   clock_timestamp()+interval '5 minutes')::text$$),
 '42501 not_found','the person''s own move keeps its opaque refusal');
select is(pg_temp.probe('select 1',$$select pg_temp.wd('9','outsider')$$),'42501 not_found',
 'and every other refusal of the hand-over stays opaque');

-- The hand-over, then the exports.
set local role service_role;
select is(pg_temp.wd('1','withdraw'),'{"case": "adult"}','the uploader''s withdrawal hands the record to the person');
reset role;
create temporary table main_relocation as select * from private.subject_transfer_relocations where subject_id=pg_temp.sid('main');
select is(pg_temp.can_export('2','main'),'record true / account true',
 'at once the person can export the record and their whole account, the record in each');
select is(pg_temp.can_export_archive('2','main'),'record true / account true',
 '... and the complete account archive captures the record too');
select is(pg_temp.new_copies('main-before-swap','main'),'works / works','... and a new copy of each can be made, opened and read');
select ok((select x#>>'{file,bucket_path}'=r.old_object_key and (x#>>'{file,storage_object_id}')::uuid=r.old_object_id
  and (x->>'normalized')::boolean from (select pg_temp.listed('main') x) l,main_relocation r),
 '"Download your data" lists the confirmed file through the exact object the transfer recorded');
select is((select count(*) from jsonb_array_elements(public.own_subject_export_content_v1('list',pg_temp.a('2'),pg_temp.s('2'),null,null,0)) x
 where x#>>'{file,subject_id}'=pg_temp.sid('main')::text),1::bigint,'... and only that file: the one not confirmed is gone');
select is(pg_temp.variants('main'),1,'... and reads its variants');
select is(pg_temp.can_export('1','main'),'record 42501 not_found / account 0A000 export_result_projection_unavailable',
 'the former uploader exports nothing of the record');
select ok(pg_temp.relocate('main','e'),'fixture: the relocation worker copies the file and swaps');
select is(pg_temp.can_export('2','main'),'record true / account true','after the swap the person still exports both');
select is(pg_temp.can_export_archive('2','main'),'record true / account true','... the complete archive too');
select is(pg_temp.new_copies('main-after-swap','main'),'works / works','... and a new copy of each works');
select ok((select x#>>'{file,bucket_path}'=r.new_object_key and (x#>>'{file,storage_object_id}')::uuid=r.new_object_id
  from (select pg_temp.listed('main') x) l,private.subject_transfer_relocations r where r.subject_id=pg_temp.sid('main')),
 '"Download your data" lists the file under its own new object');
select is(pg_temp.variants('main'),1,'... and reads its variants');
select is(pg_temp.can_export('1','main'),'record 42501 not_found / account 0A000 export_result_projection_unavailable',
 'the former uploader still exports nothing of the record');
select lives_ok('set constraints all immediate','every deferred constraint holds');

select * from finish();
rollback;
