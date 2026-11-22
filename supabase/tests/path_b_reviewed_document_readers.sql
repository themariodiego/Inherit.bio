-- D-165: a Path B record made from a reviewed permission document reaches
-- every Path B reader exactly as an e-signature record does
-- (20261122180000_path_b_reviewed_document_readers.sql).
--
-- Proves, on synthetic rows only, with one confirmed record of each Path B
-- flow driven through the real doors: es, an e-signature request 01 sends to
-- 02; rd, a reviewed permission document for 05 that a named reviewer reads
-- in full and approves before 01 may send the request. Each person confirms
-- with their own account (which predates the request), shares a report layer
-- with 01 and keeps one for themselves, confirms a held file, and the
-- registered Path B workers' doors normalize it and complete every saved
-- result; each person then turns Copilot on for 01.
--   * A reviewed-document draft is 'confirmed' only once its person has
--     confirmed a request bound to the reviewer's approval; a request not
--     confirmed, a document approved but never sent and a document refused
--     leave the draft 'invited', 'draft' or 'cancelled'.
--   * With the fifteen predecessor bodies swapped in (rebuilt in place by
--     reversing exactly the migration's anchors, then swapped back), the
--     reviewed-document record reaches none of the readers (D-165) while the
--     e-signature record reaches all of them.
--   * From the patched bodies the reviewed-document record behaves exactly as
--     the e-signature record at every reader: the person's choices and
--     sharing with the uploader; the uploader's shares and the saved-results
--     metadata; the held files; the uploader's one-record Copilot; the
--     per-record and whole-account export, with the complete archive off and
--     on, before and after the person's own move and the uploader's hand-over
--     (and the relocation worker's swap), and "Download your data"; the
--     held-upload job and the purged-grant cleanup; account deletion's
--     refusal of a grant; and the public appeal's resolution of an objection.
--   * A draft that is not confirmed reaches none of them, for either flow.
--   * The patched bodies carry their pinned successors and privileges.
-- 01 uploads; 02 and 05 are the people; 09 is an outsider. Everything rolls
-- back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
\ir fixtures/path_b_source_setup.inc
\ir fixtures/own_copilot_synthetic_settings.inc

-- 05, the reviewed-document record's person, with an account and a current
-- declaration; every account predates the requests, so no 72-hour hold
-- applies, and every address is confirmed. A named permission-document
-- reviewer in an MFA-stepped-up session.
insert into auth.users(id,email,raw_user_meta_data)
 values('0b5e0000-0000-4000-8000-000000000005','d165-person@e2e.local','{"display_name":"Synthetic person"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 values('0b5e0000-0000-4000-8000-000000000015','0b5e0000-0000-4000-8000-000000000005',now(),now(),'aal1');
update public.profiles p set date_of_birth=date '1990-01-01',jurisdiction_code='GB',jurisdiction_declared_at=clock_timestamp(),
 jurisdiction_attestation_version=a.version,jurisdiction_attestation_sha256=a.body_sha256
 from public.consent_artifacts a where a.artifact_key='attestation.jurisdiction' and a.superseded_at is null
  and p.id='0b5e0000-0000-4000-8000-000000000005';
update auth.users set created_at=now()-interval '1 day',email_confirmed_at=now()-interval '1 day' where id::text like '0b5e0000-%';
insert into auth.users(id,email,raw_user_meta_data)
 values('d1650000-0000-4000-8000-000000000003','d165-reviewer@e2e.local','{"display_name":"Synthetic reviewer"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 values('d1650000-0000-4000-8000-000000000013','d1650000-0000-4000-8000-000000000003',now(),now(),'aal2');
select private.grant_claim_reviewer_v1('d1650000-0000-4000-8000-000000000003');
-- Notices already queued by earlier local runs are set aside, so every
-- notice below is this suite's own.
update private.invitation_terminal_notices set state='expired',contact_ciphertext=null,recipient_account_id=null
 where state='pending';
update public.mail_outbox set state='invalidated' where invitation_terminal_notice_id is not null and state in ('queued','claimed');
update public.report_templates set status='review' where status='published';
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants,citations)
 values('synthetic-d165-variant','synthetic','Synthetic variant','Synthetic reviewed-document readers fixture.',
  'published','emerging','variant_call',null,
  '[{"rsid":123,"gene":"SYNTHETIC","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AG":"Synthetic covered genotype"}}]',
  '[{"pmid":"12345678","label":"fixture"}]');

-- Helpers -----------------------------------------------------------------------
create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('d165:'||p,'sha256'),'hex') $$;
create function pg_temp.own_sign(p_account text,p_artifact text,p_statement text,p_nonce text) returns jsonb language plpgsql as $$
declare c jsonb; v_subject uuid; a public.consent_artifacts%rowtype;
begin
 select id into strict v_subject from public.subjects where subject_class='self' and subject_account_id=pg_temp.a(p_account);
 c:=private.own_upload_context_v1(pg_temp.a(p_account),pg_temp.s(p_account),v_subject);
 select * into strict a from public.consent_artifacts where artifact_key=p_artifact and superseded_at is null;
 insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
  values(pg_temp.h(p_nonce),pg_temp.a(p_account),pg_temp.s(p_account),'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes');
 return public.sign_own_upload_artifact_v1(pg_temp.a(p_account),pg_temp.s(p_account),v_subject,a.artifact_key,a.version,a.body_sha256,
  array[p_statement],(c->>'accountRevision')::bigint,(c->>'authSessionRevision')::bigint,(c->>'jurisdictionRevision')::bigint,
  (c->>'subjectBindingRevision')::bigint,(c->>'accountBindingRevision')::bigint,pg_temp.h(p_nonce));
end;
$$;
select pg_temp.own_sign('1','disclosure.insurance-and-discrimination','understood','own-1-disclosure');
select pg_temp.own_sign('1','consent.upload-self','own-adult-dna','own-1-upload');
select pg_temp.own_sign('2','disclosure.insurance-and-discrimination','understood','own-2-disclosure');
select pg_temp.own_sign('5','disclosure.insurance-and-discrimination','understood','own-5-disclosure');

-- Each confirmed record, its person, and the name its uploader gave it.
create temporary table rec(name text primary key,person text,label text);
insert into rec values('es','2','Synthetic Relative'),('rd','5','Synthetic Reviewed Relative'),
 ('es-appeal','2','Synthetic Relative'),('rd-appeal','5','Synthetic Reviewed Relative');
create function pg_temp.person(p_record text) returns text language sql as $$ select person from rec where name=p_record $$;
create function pg_temp.flow(p_name text) returns text language sql as $$
 select adult_flow||':'||state from public.adult_subject_drafts where subject_id=pg_temp.sid(p_name) $$;
-- Runs a call and answers its error, or 'ok'.
create function pg_temp.try(p_call text) returns text language plpgsql as $$
begin
 execute p_call;
 return 'ok';
exception when others then return sqlstate||' '||sqlerrm;
end $$;
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
-- A reader's answer with every id, time, digest and the record's name made
-- generic, so the two records' answers compare whole.
create function pg_temp.norm(p jsonb) returns text language sql immutable as $$
 select regexp_replace(regexp_replace(regexp_replace(regexp_replace(p::text,
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','<id>','g'),
  '"[0-9]{4}-[0-9]{2}-[0-9]{2}T[^"]*"','"<time>"','g'),'"[0-9a-f]{64}"','"<digest>"','g'),
  'Synthetic Reviewed Relative','Synthetic Relative','g') $$;

-- The reviewed-document flow, through its real doors (20261016190000) ---------------
create temporary table docs(name text primary key,session_id uuid,document_id uuid,review_id uuid);
create function pg_temp.jwt(p_account uuid,p_session uuid) returns void language sql volatile as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',p_account,'role','authenticated','aal','aal2',
  'session_id',p_session,'iss',(select auth_issuer from private.upload_authorization_config where singleton),
  'aud','authenticated','exp',floor(extract(epoch from clock_timestamp()))+3600,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp()))-60)))::text,true);
$$;
create function pg_temp.as_reviewer(p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform pg_temp.jwt('d1650000-0000-4000-8000-000000000003','d1650000-0000-4000-8000-000000000013');
 perform set_config('role','authenticated',true);
 begin
  execute p_sql into r;
 exception when others then
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true);
  raise;
 end;
 perform set_config('role','postgres',true); perform set_config('request.jwt.claims','',true);
 return r;
end $$;
grant execute on function pg_temp.as_reviewer(text) to authenticated;
-- A reviewed-document draft signed by 01, its document uploaded, scanned, read
-- in full by the named reviewer and decided.
create function pg_temp.reviewed_document(p_name text,p_letter text,p_decision text) returns uuid language plpgsql as $$
declare r jsonb; v_subject uuid; v_session uuid; v_document uuid; f jsonb; b jsonb; job jsonb; lease text; d jsonb; n integer;
 cookie text:=pg_temp.h('cookie:'||p_letter); review_cookie text:=pg_temp.h('review:'||p_letter);
begin
 r:=public.create_path_b_reviewed_document_draft_v1(pg_temp.a('1'),pg_temp.s('1'),'Synthetic Reviewed Relative',date '1980-05-05',
  decode('00112233445566778899aabbccddeeff','hex'),repeat(p_letter,64),pg_temp.kd('request:'||p_name),true);
 v_subject:=(r->>'subjectDraftId')::uuid;
 insert into fx(name,subject_id) values(p_name,v_subject);
 perform pg_temp.present(v_subject,p_letter);
 perform pg_temp.sign(v_subject,p_letter);
 v_session:=(public.open_permission_document_session_v1(pg_temp.a('1'),pg_temp.s('1'),v_subject,'application/pdf',5,
  pg_temp.h('document:'||p_letter),cookie,extensions.gen_random_bytes(72),pg_temp.h('nonce:'||p_letter),true)->>'session')::uuid;
 perform public.reserve_claim_document_chunk_v1(v_session,cookie,0,5,pg_temp.h('chunk:'||p_letter));
 perform public.settle_claim_document_chunk_v1(v_session,cookie,0,true);
 b:=public.begin_claim_document_completion_v1(v_session,cookie,pg_temp.h('complete:'||p_letter),1);
 f:=public.finish_claim_document_completion_v1(v_session,cookie,pg_temp.h('complete:'||p_letter),'composed',b->>'objectKey');
 v_document:=(f->>'documentId')::uuid;
 lease:=pg_temp.h('lease:'||p_letter);
 job:=public.claim_next_permission_document_scan_v1(lease);
 if (job->>'documentId')::uuid is distinct from v_document then raise exception 'scan claimed another document'; end if;
 perform public.record_permission_document_scan_v1(v_document,lease,'OK',job->>'sha256','test-double',1,clock_timestamp());
 perform private.assign_permission_document_review_v1(v_document,'d1650000-0000-4000-8000-000000000003');
 d:=pg_temp.as_reviewer(format('select public.open_claim_review_download_v1(%L::uuid,%L)',v_document,review_cookie));
 for n in 0..(d->>'chunkCount')::integer-1 loop
  perform pg_temp.as_reviewer(format('select public.authorize_claim_review_chunk_v1(%L::uuid,%L,%s)',d->>'session',review_cookie,n));
 end loop;
 if pg_temp.as_reviewer(format('select public.decide_permission_document_v1(%L::uuid,%L,%s,%L,%L,%L::bytea)',
   v_document,(select sha256 from private.permission_documents where id=v_document),1,p_decision,
   pg_temp.h('decision:'||p_letter),'\x'||repeat('cd',48)))->>'decision'<>p_decision then
  raise exception 'review failed for %',p_name; end if;
 insert into docs values(p_name,v_session,v_document,(select x.id from private.permission_document_reviews x where x.document_id=v_document));
 return v_subject;
end $$;
-- ... and once approved, finalized, its request mail claimed and opened by the person.
create function pg_temp.reviewed_requested(p_name text,p_letter text) returns uuid language plpgsql as $$
declare v_subject uuid;
begin
 v_subject:=pg_temp.reviewed_document(p_name,p_letter,'approved');
 if public.finalize_path_b_reviewed_document_v1(pg_temp.a('1'),pg_temp.s('1'),v_subject,(select document_id from docs where name=p_name),
   (select review_id from docs where name=p_name),pg_temp.h('finalize:'||p_letter),pg_temp.h('idem:'||p_letter),true,
   jsonb_build_object('1',repeat(p_letter,64)),pg_temp.invitation_quota_keys())->>'status'<>'received' then
  raise exception 'finalize failed for %',p_name; end if;
 update fx set token_hash=pg_temp.claim_for(pg_temp.invitation_of(v_subject)) where name=p_name;
 if pg_temp.open_session((select token_hash from fx where name=p_name),p_letter,'acct-open-'||p_letter||'aaaaaaaaaaaaaaaa')<>1 then
  raise exception 'request setup failed for %',p_name; end if;
 return v_subject;
end $$;

-- The registered Path B workers' SQL doors -------------------------------------------
create function pg_temp.result_payload() returns jsonb language sql as $$
 select jsonb_build_object('reports',coalesce(jsonb_agg(jsonb_build_object('slug',t.slug,'covered',true,
  'catalogSnapshot',jsonb_build_object('schemaVersion',1,'template',jsonb_build_object('slug',t.slug,'category',t.category,
   'title',t.title,'summary',t.summary,'evidence',t.evidence,'variants',t.variants,'pgs_id',t.pgs_id,
   'citations',t.citations,'layer',t.layer,'estimate_kind',t.estimate_kind)),
  'variants',jsonb_build_array(jsonb_build_object('rsid',123,'outcome',jsonb_build_object('status','genotyped','genotype','AG',
   'interpretation','Synthetic covered genotype','strandFlipped',false))),'conflictingRsids','[]'::jsonb) order by t.slug),'[]'),
  'prs','[]'::jsonb) from public.report_templates t where status='published' and layer::text='variant_call';
$$;
-- Every queued normalization, each with its own file's raw hash; the number done.
create function pg_temp.normalize_all() returns integer language plpgsql as $$
declare c jsonb; n integer; v_hash text;
begin
 for n in 1..10 loop
  v_hash:=pg_temp.h('normalize:'||n);
  c:=public.path_b_normalization_v1('claim',null,v_hash,null,null,true);
  if c is null then return n-1; end if;
  perform public.path_b_normalization_v1('stage',(c->>'jobId')::uuid,v_hash,(c->>'claim')::uuid,
   '{"kind":"variants","sequence":0,"rows":[{"rsid":123,"chrom":1,"pos":100000,"ref":"A","alt":"G","genotype":"A/G"}]}',true);
  perform public.path_b_normalization_v1('complete',(c->>'jobId')::uuid,v_hash,(c->>'claim')::uuid,
   jsonb_build_object('sourceBuild','GRCh38','rawSha256',(select sha256 from public.genome_files where id=(c->>'fileId')::uuid),
    'decodedSha256',repeat('b',64),'variantCount',1,'observedCallCount',0,'provenance',jsonb_build_object(
     'version','path-b-normalization-v1','sourceRevision',1,'liftoverSha256',null,'attempted',0,'unmapped',0)),true);
 end loop;
 return n;
end $$;
-- Every queued saved result, completed; the purposes done, in order.
create function pg_temp.complete_reports() returns text language plpgsql as $$
declare c jsonb; n integer; v_hash text; v_done text[]:='{}';
begin
 for n in 1..20 loop
  v_hash:=pg_temp.h('report:'||n);
  c:=public.path_b_report_v1('claim',null,v_hash,null,null,true);
  exit when c is null;
  perform public.path_b_report_v1('stage',(c->>'jobId')::uuid,v_hash,(c->>'claim')::uuid,pg_temp.result_payload(),true);
  v_done:=v_done||(public.path_b_report_v1('complete',(c->>'jobId')::uuid,v_hash,(c->>'claim')::uuid,null,true)->>'status');
 end loop;
 return array_to_string(v_done,' ');
end $$;
-- The person's choice through the real door (api.consents, Path B).
create function pg_temp.share(p_record text,p_purpose text,p_direction text,p_nonce text) returns jsonb language sql as $$
 select public.grant_path_b_purpose_v1(pg_temp.a(r.person),pg_temp.s(r.person),pg_temp.sid(p_record),p_purpose,p_direction,a.version,
  a.body_sha256,pg_temp.h('share:'||p_nonce),clock_timestamp()+interval '5 minutes',true)
 from rec r,public.consent_artifacts a where r.name=p_record and a.artifact_key=case when p_direction='uploader' then 'consent.share-with-adult'
  when p_purpose='reports.monogenic' then 'consent.own-monogenic' else 'consent.own-polygenic' end and a.superseded_at is null;
$$;
create temporary table grants(name text primary key,id uuid,result jsonb);

-- The account export doors (as supabase/tests/transferred_record_exports.sql reads them).
create function pg_temp.origin(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('kind','account','accountId',pg_temp.a(p),'sessionId',pg_temp.s(p)) $$;
create function pg_temp.authority(p text,p_kind text,p_target uuid) returns jsonb language plpgsql as $$
begin
 return private.export_archive_authority_v1(pg_temp.origin(p),p_kind,p_target);
exception when others then return jsonb_build_object('refused',sqlstate||' '||sqlerrm);
end $$;
-- What an account can export of a record: its per-record capture (the record
-- its one partition) and its whole-account capture (the record one of its
-- partitions), or each refusal.
create function pg_temp.can_export(p text,p_record text) returns text language plpgsql as $$
declare r jsonb:=pg_temp.authority(p,'subject',pg_temp.sid(p_record)); w jsonb:=pg_temp.authority(p,'account',pg_temp.a(p));
begin
 return 'record '||coalesce(r->>'refused',((r->'subjectPartitions')=jsonb_build_array(pg_temp.sid(p_record)))::text)
  ||' / account '||coalesce(w->>'refused',(pg_temp.sid(p_record)::text in (select jsonb_array_elements_text(w->'subjectPartitions')))::text);
end $$;
-- The same with the TEST native complete account archive off, then on, each
-- only inside a probe; each answer names whether the archive was on.
create function pg_temp.exports(p text,p_record text) returns text language sql as $$
 select 'off '||pg_temp.probe('update private.account_archive_r2_configuration set enabled=false',
   format('select private.account_archive_complete_enabled_v1(pg_temp.origin(%L))||'' ''||pg_temp.can_export(%L,%L)',p,p,p_record))
  ||' | on '||pg_temp.probe($q$update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',
   binding_sha256=repeat('2',64)$q$,
   format('select private.account_archive_complete_enabled_v1(pg_temp.origin(%L))||'' ''||pg_temp.can_export(%L,%L)',p,p,p_record)) $$;
create temporary table copies(name text primary key,export_id uuid,attempt_id uuid,receipt text);
grant select on copies to service_role;
-- Synthetic: a READY export, written as the export worker leaves one, bound to
-- the authority captured now, as the request door binds it.
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
  pg_temp.h('copy-cookie:'||p_name),c->>'principalHash',clock_timestamp()+interval '23 hours');
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
-- Whether a copy still works: the gate every open and every chunk of it passes.
create function pg_temp.copy_works(p_name text) returns text language plpgsql as $$
begin
 perform private.export_archive_current_v1(c.export_id,c.receipt) from copies c where c.name=p_name;
 return 'works';
exception when others then return 'stopped';
end $$;
-- A new READY copy of the record and one of the whole account, made now, and
-- whether each can be opened and read.
create function pg_temp.new_copies(p_label text,p_record text) returns text language plpgsql as $$
begin
 perform pg_temp.ready_copy(p_label||'-record',pg_temp.person(p_record),'subject',pg_temp.sid(p_record));
 perform pg_temp.ready_copy(p_label||'-account',pg_temp.person(p_record),'account',pg_temp.a(pg_temp.person(p_record)));
 return pg_temp.copy_works(p_label||'-record')||' / '||pg_temp.copy_works(p_label||'-account');
end $$;
-- "Download your data": the listed source of the record's file, if any.
create function pg_temp.listed(p_record text) returns jsonb language sql as $$
 select x from jsonb_array_elements(public.own_subject_export_content_v1('list',pg_temp.a(pg_temp.person(p_record)),
  pg_temp.s(pg_temp.person(p_record)),null,null,0)) x where x#>>'{file,subject_id}'=pg_temp.sid(p_record)::text $$;
create function pg_temp.variants(p_record text) returns integer language sql as $$
 select jsonb_array_length(public.own_subject_export_content_v1('variants',pg_temp.a(pg_temp.person(p_record)),
  pg_temp.s(pg_temp.person(p_record)),(pg_temp.listed(p_record)#>>'{file,id}')::uuid,pg_temp.listed(p_record),0)) $$;
-- The relocation worker's copy of a record's one file: claim, write, swap.
create function pg_temp.relocate(p_record text) returns boolean language plpgsql as $$
declare c jsonb; v_object uuid:=gen_random_uuid(); r private.subject_transfer_relocations%rowtype;
begin
 select * into strict r from private.subject_transfer_relocations where subject_id=pg_temp.sid(p_record);
 c:=public.claim_subject_transfer_relocation_v1(r.id,repeat('f',64),true);
 insert into storage.objects(id,bucket_id,name,metadata) values(v_object,'genomes',c->>'newKey','{"size":8}');
 return public.swap_subject_transfer_relocation_v1((c->>'attemptId')::uuid,repeat('f',64),v_object,8,r.sha256,true);
end $$;

-- Where each record is seen: every reader this migration widens, in order.
create function pg_temp.seen(p_record text) returns text language plpgsql as $$
declare v_person text:=pg_temp.person(p_record); v_label text:=(select label from rec where name=p_record);
 v_subject text:=pg_temp.sid(p_record)::text; v text[]:='{}'; w jsonb;
begin
 if exists(select 1 from jsonb_array_elements(public.path_b_person_choices_v1(pg_temp.a(v_person),pg_temp.s(v_person),true)) e
   where e->>'subjectId'=v_subject) then v:=v||'choices'::text; end if;
 if exists(select 1 from jsonb_array_elements(public.subject_held_files_v1(pg_temp.a(v_person),pg_temp.s(v_person),true)) e
   where e->>'label'=v_label) then v:=v||'held-files'::text; end if;
 if exists(select 1 from jsonb_array_elements(public.path_b_uploader_shares_v1(pg_temp.a('1'),pg_temp.s('1'),true)) e
   where e->>'label'=v_label) then v:=v||'uploader-shares'::text; end if;
 if exists(select 1 from jsonb_array_elements(public.path_b_report_metadata_v1(pg_temp.a('1'),pg_temp.s('1'),null,true)) e
   where e->>'subjectId'=v_subject) then v:=v||'uploader-results'::text; end if;
 if exists(select 1 from jsonb_array_elements(public.path_b_report_metadata_v1(pg_temp.a(v_person),pg_temp.s(v_person),null,true)) e
   where e->>'subjectId'=v_subject) then v:=v||'own-results'::text; end if;
 begin
  if public.subject_copilot_scope_v1(pg_temp.a('1'),pg_temp.s('1'),v_subject::uuid)->>'state'='ready' then v:=v||'copilot'::text; end if;
 exception when insufficient_privilege then null;
 end;
 if (select bool_or(private.export_account_path_b_file_v1(f.id)) from public.genome_files f where f.subject_id=v_subject::uuid) then
  v:=v||'export-file'::text; end if;
 if pg_temp.authority(v_person,'subject',v_subject::uuid) ? 'authorityReceipt' then v:=v||'record-export'::text; end if;
 w:=pg_temp.authority(v_person,'account',pg_temp.a(v_person));
 if w->'subjectPartitions' @> jsonb_build_array(v_subject) then v:=v||'account-export'::text; end if;
 return coalesce(nullif(array_to_string(v,' '),''),'none');
end $$;
create function pg_temp.all_readers() returns text language sql immutable as
 $$ select 'choices held-files uploader-shares uploader-results own-results copilot export-file record-export account-export' $$;
-- The grants on a record still live, and its uploader relationship.
create function pg_temp.live_grants(p_record text) returns bigint language sql as $$
 select count(*) from public.purpose_grants g join public.directional_grants d on d.grant_id=g.grant_id
 where g.target_kind='subject' and g.target_id=pg_temp.sid(p_record) and g.revoked_at is null and d.status='current' $$;
create function pg_temp.ended(p_record text) returns text language sql as $$
 select (select lifecycle from public.subjects where id=pg_temp.sid(p_record))
  ||' / files '||coalesce((select string_agg(state,',' order by held_at) from public.other_adult_held_uploads where subject_id=pg_temp.sid(p_record)),'none')
  ||' / live grants '||pg_temp.live_grants(p_record)
  ||' / uploader '||coalesce((select string_agg(status,',') from public.subject_relationships
   where subject_id=pg_temp.sid(p_record) and relationship_kind='uploader'),'none') $$;
-- Account deletion's refusal, or 'allowed'.
create function pg_temp.deletion(p text) returns text language plpgsql as $$
begin
 perform private.assert_account_path_b_deletion_supported_v1(pg_temp.a(p));
 return 'allowed';
exception when others then return sqlstate||' '||sqlerrm;
end $$;
-- The person shares one layer with an adult of their family (09), through
-- api.consents' directional door, as any account holder of a record may.
create function pg_temp.family_grant(p_record text) returns uuid language sql as $$
 select public.grant_directional_purpose_v1(pg_temp.a(pg_temp.person(p_record)),pg_temp.sid(p_record),
  (select sp.id from public.subject_principals sp join public.subjects s on s.id=sp.subject_id and s.subject_class='self'
   where sp.account_id=pg_temp.a('9') and sp.principal_kind='account_subject' and sp.status='active' order by sp.created_at limit 1),
  'reports.monogenic','consent.share-with-adult',
  (select version from public.consent_artifacts where artifact_key='consent.share-with-adult' and superseded_at is null),
  'd165-family-'||p_record||'-nonce') $$;

-- The fifteen bodies 20261122180000 patches: its own patch rows, so the
-- predecessors are rebuilt here by reversing exactly its anchors.
create temporary table d165_patches(ordinal integer primary key,target text,before_md5 text,after_md5 text,acl text,
 old_fragment text,new_fragment text,label text);
insert into d165_patches values
  -- The person's own read of a Path B record (sharing, reports, exports).
  (1,'private.path_b_person_v1(uuid,uuid,uuid)','9f0434499b394a5c8ece4151838918e3',
   'd4293c9003c615825bb81ca391067ca9','{postgres=X/postgres}',
   $old$  and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
  and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
$new$,
   'person read'),
  -- The person's choices page.
  (2,'private.path_b_person_choices_v1(uuid,uuid,boolean)','88fdc054ac411342681e08a38834996f',
   '8f21a23d1a1a16360c0107d6fb26a06c','{postgres=X/postgres,service_role=X/postgres}',
   $old$  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
  join public.adult_subject_drafts d on d.subject_id=s.id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')
   and d.state='confirmed'
$new$,
   'person choices'),
  -- The uploader's list of what each person shared with them.
  (3,'private.path_b_uploader_shares_v1(uuid,uuid,boolean)','4791a74ac0dd7f919a69cd4899f7a158',
   'b9439ab870b3699821089de38c4b4d6a','{postgres=X/postgres,service_role=X/postgres}',
   $old$  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
  join public.adult_subject_drafts d on d.subject_id=s.id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')
   and d.state='confirmed'
$new$,
   'uploader shares'),
  -- The saved-results metadata, for the uploader and the person.
  (4,'private.path_b_report_metadata_v1(uuid,uuid,uuid,boolean)','057612020df71da9eeedc4e4212e546a',
   'f62bef1989ac48e4c55ec42710b6d235','{postgres=X/postgres,service_role=X/postgres}',
   $old$   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') order by sub.id for share
$old$,
   $new$   -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') order by sub.id for share
$new$,
   'report metadata'),
  -- The person's held files.
  (5,'private.subject_held_files_v1(uuid,uuid,boolean)','807a31dda5b3c9ed7a674ad37996e519',
   '4d4ed19c94e72ab160882b759470954e','{postgres=X/postgres,service_role=X/postgres}',
   $old$  join public.adult_subject_drafts d on d.subject_id=s.id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
  join public.adult_subject_drafts d on d.subject_id=s.id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')
   and d.state='confirmed'
$new$,
   'held files'),
  -- The uploader's one-record Copilot.
  (6,'private.subject_copilot_authority_v1(uuid,uuid,uuid)','835e5f67cb5ef03e9f97735de1aeeb10',
   '6e29a3a6e809e5d0b1db9df42847abe5','{postgres=X/postgres}',
   $old$   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
$old$,
   $new$   -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
$new$,
   'copilot authority'),
  -- The account export's Path B test of a file.
  (7,'private.export_account_path_b_file_v1(uuid)','71e1c10e7b5410f4cb4b77c7ccc10577',
   'e061731060ee8f717c4f97409c7706dc','{postgres=X/postgres}',
   $old$   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed');
$old$,
   $new$   -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed');
$new$,
   'export path b file'),
  -- The person's saved results of a Path B record, in either capture.
  (8,'private.export_account_path_b_snapshot_v1(jsonb,uuid)','b9ae87c681a443f9ac3fb1846a69520b',
   'e2d07abe4aa844c3c3a913e18be72015','{postgres=X/postgres}',
   $old$   and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
$old$,
   $new$   -- 20261122180000 (D-165): a confirmed draft of either Path B flow.
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
$new$,
   'export snapshot'),
  -- The whole-account and per-record capture of a Path B record.
  (9,'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','583e9efa4a60f086e3875fc40e03f491',
   '5c9fee7018806a025ad537664cd23b69','{postgres=X/postgres}',
   $old$    and d.adult_flow='path-b-subject-esignature' and d.evidence_kind='esignature'
$old$,
   $new$    -- 20261122180000 (D-165): a confirmed draft of either Path B flow, each with its own evidence.
    and ((d.adult_flow='path-b-subject-esignature' and d.evidence_kind='esignature')
     or (d.adult_flow='path-b-reviewed-document' and d.evidence_kind='uploaded_document'))
$new$,
   'export readable authority'),
  -- The person of a transferred record, and its confirmation (20261122160000).
  (10,'private.transferred_export_person_v1(uuid,uuid,uuid)','80421178d9b4e5fc38f5090756770096',
   '5b185a02a35c00b04a43457f2cd08f6e','{postgres=X/postgres}',
   $old$   and d.owner_account_id=t.from_account_id and d.adult_flow='path-b-subject-esignature' and d.state='confirmed') then
$old$,
   $new$   -- 20261122180000 (D-165): the confirmed request of either Path B flow.
   and d.owner_account_id=t.from_account_id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed') then
$new$,
   'transferred person'),
  (11,'private.transferred_export_confirmation_v1(uuid)','0f903e4ee3b7eaf66f226174a7030a80',
   '4010fc23e2ff05c5fe3c29a774fdc3a9','{postgres=X/postgres}',
   $old$  and adult_flow='path-b-subject-esignature' and evidence_kind='esignature' and state='confirmed' for share;
$old$,
   $new$  -- 20261122180000 (D-165): the confirmed request of either Path B flow, each with its own evidence.
  and ((adult_flow='path-b-subject-esignature' and evidence_kind='esignature')
   or (adult_flow='path-b-reviewed-document' and evidence_kind='uploaded_document'))
  and state='confirmed' for share;
$new$,
   'transferred confirmation'),
  -- The held-upload job: a person who asked to delete their account.
  (12,'public.expire_due_other_adult_held_uploads_v1()','5120605e1f785010cbc13deffcbbe5aa',
   '591682cc0b9c9377cb8dbeeef44b18b5','{postgres=X/postgres,service_role=X/postgres}',
   $old$  where d.adult_flow='path-b-subject-esignature' and d.state='confirmed' and s.lifecycle='active'
$old$,
   $new$  -- 20261122180000 (D-165): a confirmed record of either Path B flow.
  where d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and d.state='confirmed' and s.lifecycle='active'
$new$,
   'held-upload expiry'),
  -- The purged-grant cleanup.
  (13,'private.end_purged_path_b_grants_v1()','0add773cff4bad835ea35bcf80d7a4fc',
   '5163b00a8509ac4a28f9708ae1118258','{postgres=X/postgres}',
   $old$  and d.adult_flow='path-b-subject-esignature') then return null; end if;
$old$,
   $new$  -- 20261122180000 (D-165): a record of either Path B flow.
  and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')) then return null; end if;
$new$,
   'purged-grant cleanup'),
  -- The public appeal's resolution of a subject objection.
  (14,'private.public_appeal_provisional_binding_v1(uuid)','d4b8500ac4a7e6ac2ff76e642ebd0353',
   'e05639a338708b169bb878a8d8e6ca0a','{postgres=X/postgres}',
   $old$      and ((d.adult_flow='path-b-subject-esignature' and artifact.artifact_key='consent.subject-adult-esignature'
$old$,
   $new$      -- 20261122180000 (D-165): the Path B confirmation of either flow (the person signs the same text).
      and ((d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document') and artifact.artifact_key='consent.subject-adult-esignature'
$new$,
   'appeal binding confirmation'),
  (15,'private.public_appeal_provisional_binding_v1(uuid)','e05639a338708b169bb878a8d8e6ca0a',
   '7d7b1f82a7703c625b5695ba2aad57b4','{postgres=X/postgres}',
   $old$    if signature_id is not null and exists(select 1 from public.adult_subject_drafts d where d.subject_id=subject_row.id and d.adult_flow='path-b-subject-esignature') then
$old$,
   $new$    -- 20261122180000 (D-165): a record of either Path B flow is rechecked against its confirmed binding.
    if signature_id is not null and exists(select 1 from public.adult_subject_drafts d where d.subject_id=subject_row.id
      and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')) then
$new$,
   'appeal binding recheck'),
  -- Account deletion's refusal of a grant on a Path B record.
  (16,'private.assert_account_path_b_deletion_supported_v1(uuid)','8ef417e756e4b632b6a97c39538c7ee4',
   '4f06febdcbf2b30205cdc312045c98ce','{postgres=X/postgres}',
   $old$        where d.subject_id=g.target_id and d.adult_flow='path-b-subject-esignature'))
$old$,
   $new$        -- 20261122180000 (D-165): a grant on a record of either Path B flow.
        where d.subject_id=g.target_id and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')))
$new$,
   'deletion guard grants');
create temporary table d165_successors as
 select distinct on (target) target,pg_get_functiondef(target::regprocedure) def from d165_patches order by target;
-- Swaps every patched body for its predecessor (each anchor reversed, last
-- first) or back to its successor; answers the bodies' md5s in patch order.
create function pg_temp.bodies(p_which text) returns text language plpgsql as $$
declare t record; r record; d text;
begin
 for t in select * from d165_successors order by target loop
  d:=t.def;
  if p_which='predecessor' then
   for r in select * from d165_patches where target=t.target order by ordinal desc loop
    d:=replace(d,r.new_fragment,r.old_fragment);
   end loop;
  end if;
  execute d;
 end loop;
 return (select string_agg(md5(pg_get_functiondef(p.oid)),' ' order by x.first) from (select target,min(ordinal) first
  from d165_patches group by target) x join pg_proc p on p.oid=x.target::regprocedure);
end $$;
-- 20261122190000 (D-166) then has the capture ask the record's confirmation
-- (private.path_b_confirmation_v1), md5-guarded from exactly its successor
-- here and outside every anchor above; with it applied the capture's two md5s
-- follow it (its predecessor rebuilt here carries that one line too). Every
-- other md5 is this migration's own.
create function pg_temp.d166(p_md5 text) returns text language sql as $$
 select case when position('20261122190000 (D-166)' in pg_get_functiondef(
   'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)'::regprocedure))=0 then p_md5
  when p_md5='5c9fee7018806a025ad537664cd23b69' then '2fb0181f5c393cf7283cb9e33704789a'
  when p_md5='583e9efa4a60f086e3875fc40e03f491' then '1ee6b7092b77885fe752b324766bc844' else p_md5 end $$;
create function pg_temp.expected(p_which text) returns text language sql as $$
 select string_agg(pg_temp.d166(case when p_which='predecessor' then f.before_md5 else l.after_md5 end),' ' order by x.first)
 from (select target,min(ordinal) first,max(ordinal) last from d165_patches group by target) x
 join d165_patches f on f.ordinal=x.first join d165_patches l on l.ordinal=x.last $$;

-- 0. The migration --------------------------------------------------------------------
select is((select string_agg(md5(pg_get_functiondef(p.oid))||' '||p.proacl::text,', ' order by x.first)
  from (select target,min(ordinal) first from d165_patches group by target) x join pg_proc p on p.oid=x.target::regprocedure),
 (select string_agg(pg_temp.d166(l.after_md5)||' '||l.acl,', ' order by x.first) from (select target,min(ordinal) first,max(ordinal) last
  from d165_patches group by target) x join d165_patches l on l.ordinal=x.last),
 'the fifteen patched bodies carry their pinned successors and unchanged privileges');
select is((select count(*) from d165_patches),16::bigint,'sixteen anchors in fifteen bodies');

-- 1. The records, each through its own flow's real doors ------------------------------------
select pg_temp.requested('es','a',repeat('a',64));
select is(pg_temp.account_confirms('a','d165-sign-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 '(es) the person confirms the e-signature request with their own account');
select pg_temp.reviewed_requested('rd','b');
select is(pg_temp.account_confirms('b','d165-sign-bbbbbbbbbbbbbbbbbbb','5',repeat('b',64)),'accepted',
 '(rd) the person confirms the request their permission document allowed, with their own account');
-- Not confirmed: a request never answered (each flow), a document approved
-- but never sent, and a document the reviewer refused.
select pg_temp.requested('es-invited','c',repeat('c',64));
select pg_temp.reviewed_requested('rd-invited','d');
select pg_temp.reviewed_document('rd-approved','e','approved');
select pg_temp.reviewed_document('rd-refused','f','rejected');
select is((select string_agg(x||'='||pg_temp.flow(x),' ' order by x)
  from unnest(array['es','rd','es-invited','rd-invited','rd-approved','rd-refused']) x),
 'es=path-b-subject-esignature:confirmed es-invited=path-b-subject-esignature:invited '
 ||'rd=path-b-reviewed-document:confirmed rd-approved=path-b-reviewed-document:draft '
 ||'rd-invited=path-b-reviewed-document:invited rd-refused=path-b-reviewed-document:cancelled',
 'a reviewed-document draft is confirmed only once its person confirms; unanswered, unsent and refused ones are not');
select ok((select q.decision='approved' and q.document_sha256=d.sha256 and r.review_revision=q.review_revision
   and r.document_sha256=q.document_sha256 and i.status='accepted' and i.id=r.invitation_id and d.review_state='approved'
  from private.path_b_reviewed_document_requests r join private.permission_document_reviews q on q.id=r.review_id
  join private.permission_documents d on d.id=r.document_id join public.subject_invitations i on i.id=r.invitation_id
  where r.subject_id=pg_temp.sid('rd')),
 '(rd) the confirmed request is bound to the named reviewer''s approval of the exact document');
select is((select lifecycle||' '||coalesce(subject_account_id::text,'no-account') from public.subjects where id=pg_temp.sid('rd-refused')),
 'purged no-account','(rd-refused) a refused document ends its draft and its record');

-- Each person shares one layer with 01 and keeps one for themselves; 01
-- holds a file for each, the person confirms it, and the workers' doors
-- normalize it and complete every saved result.
insert into grants select 'es-self',(r->>'recordId')::uuid,r from pg_temp.share('es','reports.monogenic','self','es-self') r;
insert into grants select 'rd-self',(r->>'recordId')::uuid,r from pg_temp.share('rd','reports.monogenic','self','rd-self') r;
insert into grants select 'es-up',(r->>'recordId')::uuid,r from pg_temp.share('es','reports.monogenic','uploader','es-up') r;
insert into grants select 'rd-up',(r->>'recordId')::uuid,r from pg_temp.share('rd','reports.monogenic','uploader','rd-up') r;
select is((select count(*) from grants where id is not null),4::bigint,'fixture: each person shares with the uploader and for themselves');
select is((select h->>'status' from (select pg_temp.hold('es-file',pg_temp.sid('es'),repeat('3',64)) h) x)||' '||
 (select h->>'status' from (select pg_temp.hold('rd-file',pg_temp.sid('rd'),repeat('4',64)) h) x),
 'stored_quarantined stored_quarantined','fixture: 01 holds a file for each');
select is(pg_temp.notice_session('es-file','3'),1::bigint,'fixture: (es) the file''s notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('3',64),'d165-confirm-3333333333333333333','confirm',pg_temp.a('2')),
 'confirmed','fixture: (es) the person confirms the file');
select is(pg_temp.notice_session('rd-file','4'),1::bigint,'fixture: (rd) the file''s notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('4',64),'d165-confirm-4444444444444444444','confirm',pg_temp.a('5')),
 'confirmed','fixture: (rd) the person confirms the file');
select is(pg_temp.normalize_all(),2,'fixture: both files are normalized');
select is(pg_temp.complete_reports(),'complete complete complete complete','fixture: every saved result is completed');
-- 01's own local Copilot, and each person's Copilot choice for 01.
create temporary table uploader_self as select id from public.subjects where subject_account_id=pg_temp.a('1') and subject_class='self';
select public.save_own_copilot_settings_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.synthetic_copilot_settings('synthetic-model','local'),
 null,pg_temp.h('copilot-settings'),null);
create temporary table presentation as select public.own_copilot_presentation_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self)) value;
select public.grant_own_copilot_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self),(select value->'snapshot' from presentation),
 (select value->'artifacts' from presentation),pg_temp.h('copilot-grant'),clock_timestamp()+interval '9 minutes');
insert into grants select 'es-copilot',(r->>'recordId')::uuid,r from pg_temp.share('es','copilot.local','uploader','es-copilot') r;
insert into grants select 'rd-copilot',(r->>'recordId')::uuid,r from pg_temp.share('rd','copilot.local','uploader','rd-copilot') r;
select is((select count(*) from grants where id is not null),6::bigint,'fixture: each person turns Copilot on for the uploader');

-- 2. D-165 as it was: the predecessors answered for e-signature records only ------------------
select is(pg_temp.bodies('predecessor'),pg_temp.expected('predecessor'),
 '(predecessor) swapped in: the fifteen bodies as 20261122170000 left them');
select is(pg_temp.seen('es'),pg_temp.all_readers(),'(predecessor) the e-signature record reaches every reader');
select is(pg_temp.seen('rd'),'none','(predecessor) D-165: the reviewed-document record reaches none of them');
select is(pg_temp.try($$select pg_temp.share('rd','reports.polygenic','uploader','rd-poly-old')$$)||' | '||
 pg_temp.probe('select 1',$$select (pg_temp.share('es','reports.polygenic','uploader','es-poly-old')->>'recordId' is not null)::text$$),
 '42501 not_found | true','(predecessor) its person could not share with the uploader; the e-signature record''s person could');
select is(pg_temp.probe($$update public.profiles set deletion_requested_at=clock_timestamp() where id in(pg_temp.a('2'),pg_temp.a('5'))$$,
  'select (public.expire_due_other_adult_held_uploads_v1()>=1)::text',
  $$select (select lifecycle from public.subjects where id=pg_temp.sid('es'))||' '||(select lifecycle from public.subjects where id=pg_temp.sid('rd'))$$),
 'true / purged active','(predecessor) the held-upload job deleted the e-signature record of a person leaving, and left the reviewed-document one');
select is(pg_temp.probe('select 1',$$select (public.delete_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('es'),pg_temp.h('delete-es-old'),
   clock_timestamp()+interval '5 minutes') is not null)::text$$,$$select pg_temp.ended('es')$$)||' | '||
 pg_temp.probe('select 1',$$select (public.delete_subject_v1(pg_temp.a('5'),pg_temp.s('5'),pg_temp.sid('rd'),pg_temp.h('delete-rd-old'),
   clock_timestamp()+interval '5 minutes') is not null)::text$$,$$select pg_temp.ended('rd')$$),
 'true / purged / files deleted / live grants 0 / uploader revoked | true / purged / files deleted / live grants 3 / uploader current','(predecessor) a purged reviewed-document record kept its grants and its uploader relationship; an e-signature one did not');
select is(pg_temp.probe('select 1','select (pg_temp.family_grant(''es'') is not null)::text','select pg_temp.deletion(''9'')')||' | '||
 pg_temp.probe('select 1','select (pg_temp.family_grant(''rd'') is not null)::text','select pg_temp.deletion(''9'')'),
 'true / 55000 unsupported_account_graph | true / allowed',
 '(predecessor) account deletion refused a grant on an e-signature record and did not see one on a reviewed-document record');
select is(pg_temp.bodies('patched'),pg_temp.expected('patched'),'(patched) swapped back: the fifteen successors');

-- 3. From the patched bodies: every reader, exactly as for the e-signature record ---------------
select is(pg_temp.seen('rd'),pg_temp.all_readers(),'(rd) the reviewed-document record reaches every reader');
select is(pg_temp.seen('es'),pg_temp.all_readers(),'(es) as the e-signature record does');
-- The person's choices and sharing with the uploader.
select is(pg_temp.norm(public.path_b_person_choices_v1(pg_temp.a('5'),pg_temp.s('5'),true)),
 pg_temp.norm(public.path_b_person_choices_v1(pg_temp.a('2'),pg_temp.s('2'),true)),
 '(choices) the person''s choices page lists the record exactly as the e-signature record''s person''s does');
select is((select e->'uploaderShare'->>'decision'||' '||(e->'readGate'->>'reports.monogenic')||' '||(select string_agg(g->>'purpose'||':'||(g->>'direction'),','
   order by g->>'purpose',g->>'direction') from jsonb_array_elements(e->'grants') g)
  from jsonb_array_elements(public.path_b_person_choices_v1(pg_temp.a('5'),pg_temp.s('5'),true)) e),
 'allow ready copilot.local:uploader,reports.monogenic:self,reports.monogenic:uploader',
 '(choices) sharing with the uploader is open, the person''s own result is ready, and every choice they made is listed');
select is((select string_agg(pg_temp.norm(result),' ' order by name) from grants where name like 'rd-%'),
 (select string_agg(pg_temp.norm(result),' ' order by name) from grants where name like 'es-%'),
 '(sharing) each choice the person made through the door answered as the e-signature record''s person''s did');
-- The uploader's shares and the saved-results metadata.
select is((select pg_temp.norm(e) from jsonb_array_elements(public.path_b_uploader_shares_v1(pg_temp.a('1'),pg_temp.s('1'),true)) e
  where e->>'label'='Synthetic Reviewed Relative'),
 (select pg_temp.norm(e) from jsonb_array_elements(public.path_b_uploader_shares_v1(pg_temp.a('1'),pg_temp.s('1'),true)) e
  where e->>'label'='Synthetic Relative'),
 '(shares) the uploader''s list shows what the person shared, as for the e-signature record');
select is((select string_agg(e->>'purpose'||':'||(e->>'gate'),',') from jsonb_array_elements(public.path_b_uploader_shares_v1(pg_temp.a('1'),
  pg_temp.s('1'),true)) x,jsonb_array_elements(x->'shared') e where x->>'label'='Synthetic Reviewed Relative'),
 'reports.monogenic:ready','(shares) one shared layer, ready to read');
select is((select pg_temp.norm(e) from jsonb_array_elements(public.path_b_report_metadata_v1(pg_temp.a('1'),pg_temp.s('1'),null,true)) e
  where e->>'subjectId'=pg_temp.sid('rd')::text),
 (select pg_temp.norm(e) from jsonb_array_elements(public.path_b_report_metadata_v1(pg_temp.a('1'),pg_temp.s('1'),null,true)) e
  where e->>'subjectId'=pg_temp.sid('es')::text),
 '(metadata) the uploader''s saved results of the record are listed as the e-signature record''s are');
select is(pg_temp.norm(public.path_b_report_metadata_v1(pg_temp.a('5'),pg_temp.s('5'),null,true)),
 pg_temp.norm(public.path_b_report_metadata_v1(pg_temp.a('2'),pg_temp.s('2'),null,true)),
 '(metadata) and the person''s own, as the e-signature record''s person''s');
select is((select e->>'direction'||' '||(e->'purposes')::text from jsonb_array_elements(public.path_b_report_metadata_v1(pg_temp.a('5'),
  pg_temp.s('5'),null,true)) e),'self ["reports.monogenic"]','(metadata) the person''s own saved result is theirs');
-- The held files.
select is(pg_temp.norm(public.subject_held_files_v1(pg_temp.a('5'),pg_temp.s('5'),true)),
 pg_temp.norm(public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)),
 '(held files) the person''s held files are listed as the e-signature record''s person''s are');
select is((select string_agg(f->>'state'||':'||(f->>'fileKind'),',') from jsonb_array_elements(public.subject_held_files_v1(pg_temp.a('5'),
  pg_temp.s('5'),true)) e,jsonb_array_elements(e->'files') f),'confirmed:vcf','(held files) the one file they confirmed');
-- The uploader's one-record Copilot.
select is(pg_temp.norm(public.subject_copilot_scope_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('rd'))),
 pg_temp.norm(public.subject_copilot_scope_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('es'))),
 '(Copilot) the uploader''s scope for the record opens as for the e-signature record');
select is((select v->>'state'||' '||(v#>>'{authority,case}')||' '||(v#>>'{authority,accountId}')||' '||(v#>>'{authority,copilot,grantId}')
  ||' '||(v#>'{authority,layers,0}'->>'grantId') from (select public.subject_copilot_scope_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('rd')) v) x),
 'ready uploader '||pg_temp.a('5')||' '||(select id from grants where name='rd-copilot')||' '||(select id from grants where name='rd-up'),
 '(Copilot) bound to the person''s account, their Copilot choice and the layer they shared');
select is(pg_temp.try($$select public.subject_copilot_scope_v1(pg_temp.a('9'),pg_temp.s('9'),pg_temp.sid('rd'))$$)||' | '||
 pg_temp.try($$select public.subject_copilot_scope_v1(pg_temp.a('9'),pg_temp.s('9'),pg_temp.sid('es'))$$),
 '42501 not_found | 42501 not_found','(Copilot) an outsider is not found, for either');

-- 4. The account export, before any transfer ------------------------------------------------
select is(pg_temp.exports('5','rd'),'off false record true / account true | on true record true / account true',
 '(export) the person exports the record and their whole account, with the complete archive off and on');
select is(pg_temp.exports('5','rd'),pg_temp.exports('2','es'),'(export) as the e-signature record''s person does');
select is(pg_temp.can_export('1','rd')||' | '||(pg_temp.authority('9','subject',pg_temp.sid('rd'))->>'refused'),
 pg_temp.can_export('1','es')||' | '||(pg_temp.authority('9','subject',pg_temp.sid('es'))->>'refused'),
 '(export) the uploader and an outsider are refused exactly as for the e-signature record');
select is(pg_temp.authority('1','subject',pg_temp.sid('rd'))->>'refused','42501 not_found','(export) the uploader cannot export the record');
select is(coalesce(pg_temp.listed('rd')::text,'none')||' '||coalesce(pg_temp.listed('es')::text,'none'),'none none',
 '(export) "Download your data" lists no file of a record the uploader holds, for either');

-- 5. After the person's own move ---------------------------------------------------------------
savepoint own_move;
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
select is(pg_temp.new_copies('rd-before','rd')||' | '||pg_temp.new_copies('es-before','es'),'works / works | works / works',
 'fixture: a copy of each record and of each whole account, made before the move, works');
set local role service_role;
select is(public.transfer_subject_v1(pg_temp.a('5'),pg_temp.s('5'),pg_temp.sid('rd'),pg_temp.h('move-rd'),
 clock_timestamp()+interval '5 minutes')->>'status','transferred','(rd) the person moves the reviewed-document record into their account');
select is(public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('es'),pg_temp.h('move-es'),
 clock_timestamp()+interval '5 minutes')->>'status','transferred','(es) as the e-signature record''s person does');
reset role;
select is(pg_temp.copy_works('rd-before-record')||' / '||pg_temp.copy_works('rd-before-account')||' | '||
 pg_temp.copy_works('es-before-record')||' / '||pg_temp.copy_works('es-before-account'),'stopped / stopped | stopped / stopped',
 '(moved) any copy made before has stopped working, for either record');
select is(pg_temp.exports('5','rd'),'off false record true / account true | on true record true / account true',
 '(moved) at once the person can make a new export of the record and of their whole account, archive off and on');
select is(pg_temp.exports('5','rd'),pg_temp.exports('2','es'),'(moved) as the e-signature record''s person can');
select is(pg_temp.new_copies('rd-moved','rd'),'works / works','(moved) and a new copy of each can be made, opened and read');
select ok((select (x#>>'{file,id}')::uuid=r.file_id and x#>>'{file,bucket_path}'=r.old_object_key
  and (x#>>'{file,storage_object_id}')::uuid=r.old_object_id and (x->>'normalized')::boolean and x#>>'{binding,accountId}'=pg_temp.a('5')::text
 from (select pg_temp.listed('rd') x) l,private.subject_transfer_relocations r where r.subject_id=pg_temp.sid('rd')),
 '(moved) "Download your data" lists the file through the exact object the transfer recorded');
select is(pg_temp.variants('rd')||' '||pg_temp.variants('es'),'1 1','(moved) and reads its variants, as for the e-signature record');
select is(pg_temp.can_export('1','rd'),pg_temp.can_export('1','es'),'(moved) the former uploader is refused as for the e-signature record');
select is(pg_temp.can_export('1','rd'),'record 42501 not_found / account 0A000 export_result_projection_unavailable',
 '(moved) and exports nothing of the record');
select ok(pg_temp.relocate('rd') and pg_temp.relocate('es'),'fixture: the relocation worker copies each file to a key of its own and swaps');
select is(pg_temp.exports('5','rd'),pg_temp.exports('2','es'),'(swapped) the person still exports both, as for the e-signature record');
select is(pg_temp.exports('5','rd'),'off false record true / account true | on true record true / account true',
 '(swapped) the record and the whole account, archive off and on');
select is(pg_temp.new_copies('rd-swapped','rd'),'works / works','(swapped) and a new copy of each works');
select ok((select x#>>'{file,bucket_path}'=r.new_object_key and (x#>>'{file,storage_object_id}')::uuid=r.new_object_id
 from (select pg_temp.listed('rd') x) l,private.subject_transfer_relocations r where r.subject_id=pg_temp.sid('rd') and r.state='swapped'),
 '(swapped) "Download your data" lists the file under its own new object');
rollback to own_move;

-- 6. After the uploader's hand-over ------------------------------------------------------------
savepoint hand_over;
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
set local role service_role;
select is(public.withdraw_other_adult_upload_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('rd'),pg_temp.h('withdraw-rd'),
 clock_timestamp()+interval '5 minutes')::text||' '||public.withdraw_other_adult_upload_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('es'),
 pg_temp.h('withdraw-es'),clock_timestamp()+interval '5 minutes')::text,'{"case": "adult"} {"case": "adult"}',
 '(handed over) the uploader''s withdrawal hands each record to its person');
reset role;
select is(pg_temp.exports('5','rd'),'off false record true / account true | on true record true / account true',
 '(handed over) at once the person exports the record and their whole account, archive off and on');
select is(pg_temp.exports('5','rd'),pg_temp.exports('2','es'),'(handed over) as the e-signature record''s person does');
select is(pg_temp.new_copies('rd-handed','rd'),'works / works','(handed over) and a new copy of each works');
select is(pg_temp.variants('rd')||' '||pg_temp.variants('es'),'1 1','(handed over) "Download your data" lists and reads the file, for either');
select is(pg_temp.can_export('1','rd'),pg_temp.can_export('1','es'),'(handed over) the former uploader is refused as for the e-signature record');
rollback to hand_over;

-- 7. Not confirmed: no reader takes a draft that is not confirmed, for either flow ---------------
select is((select count(*) from jsonb_array_elements(public.path_b_uploader_shares_v1(pg_temp.a('1'),pg_temp.s('1'),true))),2::bigint,
 '(unconfirmed) the uploader''s shares list the two confirmed records only');
select is((select string_agg(e->>'subjectId',',' order by e->>'subjectId') from jsonb_array_elements(public.path_b_report_metadata_v1(pg_temp.a('1'),
  pg_temp.s('1'),null,true)) e),(select string_agg(id::text,',' order by id::text) from unnest(array[pg_temp.sid('es'),pg_temp.sid('rd')]) id),
 '(unconfirmed) as do the uploader''s saved results');
select is((select count(*) from public.genome_files f where f.subject_id in(pg_temp.sid('es-invited'),pg_temp.sid('rd-invited'),
  pg_temp.sid('rd-approved'),pg_temp.sid('rd-refused')) and private.export_account_path_b_file_v1(f.id)),0::bigint,
 '(unconfirmed) and none of the other drafts has a file the export takes as Path B');
-- A confirmed record whose draft is set back (synthetic: no door does this),
-- to every other state, keeping everything else: neither record reaches any
-- reader, so the readers take a confirmed draft and only that.
create function pg_temp.set_back(p_state text) returns text language sql as $$
 select pg_temp.probe(format('update public.adult_subject_drafts set state=%L where subject_id in(pg_temp.sid(''es''),pg_temp.sid(''rd''))',p_state),
  'select pg_temp.seen(''rd'')||'' | ''||pg_temp.seen(''es'')') $$;
select is(pg_temp.set_back('invited'),'none | none','(unconfirmed) a draft still awaiting the person''s answer reaches no reader, for either flow');
select is(pg_temp.set_back('draft'),'none | none','(unconfirmed) nor does a draft whose request was never sent');
select is(pg_temp.set_back('cancelled'),'none | none','(refused) nor a cancelled draft, as a refused document leaves it');
select is(pg_temp.set_back('expired'),'none | none','(unconfirmed) nor an expired one');
select is(pg_temp.probe(format('update public.adult_subject_drafts set state=%L where subject_id in(pg_temp.sid(''es''),pg_temp.sid(''rd''))','invited'),
  $$select pg_temp.try('select pg_temp.share(''rd'',''reports.polygenic'',''uploader'',''rd-poly-unconfirmed'')')||' | '||
   pg_temp.try('select pg_temp.share(''es'',''reports.polygenic'',''uploader'',''es-poly-unconfirmed'')')$$),
 '42501 not_found | 42501 not_found','(unconfirmed) and its person cannot share from it, for either flow');


-- 8. The held-upload job and the purged-grant cleanup ----------------------------------------------
select is(pg_temp.ended('rd'),pg_temp.ended('es'),'(cleanup) before anything ends, both records stand alike');
select is(pg_temp.ended('rd'),'active / files confirmed / live grants 3 / uploader current',
 '(cleanup) the record, its confirmed file, its three grants and the uploader relationship');
create function pg_temp.leaves(p_record text) returns text language sql as $$
 select pg_temp.probe(format('update public.profiles set deletion_requested_at=clock_timestamp() where id=pg_temp.a(%L)',pg_temp.person(p_record)),
  'select (public.expire_due_other_adult_held_uploads_v1()>=1)::text',format('select pg_temp.ended(%L)',p_record)) $$;
select is(pg_temp.leaves('rd'),pg_temp.leaves('es'),
 '(held-upload job) a person who asks to delete their account loses the record as the e-signature record''s person does');
select is(pg_temp.leaves('rd'),'true / purged / files deleted / live grants 0 / uploader revoked','(held-upload job) the record is deleted, its file ended, its grants and the uploader relationship ended');
create function pg_temp.deletes(p_record text) returns text language sql as $$
 select pg_temp.probe('select 1',format('select (public.delete_subject_v1(pg_temp.a(%1$L),pg_temp.s(%1$L),pg_temp.sid(%2$L),pg_temp.h(%3$L),
   clock_timestamp()+interval ''5 minutes'') is not null)::text',pg_temp.person(p_record),p_record,'delete-'||p_record),
  format('select pg_temp.ended(%L)',p_record)) $$;
select is(pg_temp.deletes('rd'),pg_temp.deletes('es'),
 '(purged-grant cleanup) when the person deletes the record, its grants end as the e-signature record''s do');
select is(pg_temp.deletes('rd'),'true / purged / files deleted / live grants 0 / uploader revoked','(purged-grant cleanup) every grant and the uploader relationship end with the record');

-- 9. Account deletion's refusal of a grant on a Path B record ----------------------------------------
select is(pg_temp.deletion('9'),'allowed','(deletion) the outsider holds nothing of Path B');
select is(pg_temp.probe('select 1','select (pg_temp.family_grant(''rd'') is not null)::text','select pg_temp.deletion(''9'')'),
 pg_temp.probe('select 1','select (pg_temp.family_grant(''es'') is not null)::text','select pg_temp.deletion(''9'')'),
 '(deletion) a grant on the reviewed-document record stops the recipient''s account deletion as one on the e-signature record does');
select is(pg_temp.probe('select 1','select (pg_temp.family_grant(''rd'') is not null)::text','select pg_temp.deletion(''9'')'),
 'true / 55000 unsupported_account_graph','(deletion) refused: no executor can yet dispose of a Path B graph');

-- 10. The public appeal's resolution of a subject objection ------------------------------------------
-- A subject objection whose contact is the person's: a record of either flow
-- made for that contact inside each probe, confirmed by its person.
update private.new_public_appeal_config set enabled=true where singleton;
insert into public.subject_principals(id,account_id,principal_kind) values
 ('d1650000-0000-4000-8000-000000000101','d1650000-0000-4000-8000-000000000003','reviewer');
insert into private.new_public_appeal_reviewers(principal_id,principal_revision,purpose_revision) values
 ('d1650000-0000-4000-8000-000000000101',1,1);
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table appeal_prepared as select public.prepare_new_public_appeal_v1('subject-objection',pg_temp.h('appeal-payload'),
 pg_temp.h('appeal-form'),jsonb_build_object('1',repeat('9',64)),jsonb_build_object('1',pg_temp.h('appeal-identifier')),
 jsonb_build_object('1',pg_temp.h('appeal-network'))) value;
select ok((select value is not null from appeal_prepared),'fixture: a subject objection is prepared with a named reviewer');
select is(public.commit_new_public_appeal_v1((select value from appeal_prepared),pg_temp.h('appeal-payload'),pg_temp.h('appeal-form'),
 decode(repeat('ab',72),'hex'),decode(repeat('bc',48),'hex'),decode(repeat('cd',48),'hex'),decode(repeat('de',48),'hex'),
 jsonb_build_object('1',jsonb_build_object('normalized-identifier',pg_temp.h('appeal-identifier'),'source-network',pg_temp.h('appeal-network'),
  'global-capacity',encode(extensions.digest(convert_to('api.subject-access-request|global-capacity','UTF8'),'sha256'),'hex')))),
 true,'fixture: and committed');
create temporary table appeal_claim as select * from public.claim_mail_outbox();
select ok(public.authorize_mail_submission_v1((select outbox_id from appeal_claim),(select attempt_ordinal from appeal_claim)),
 'fixture: its evidence mail may be sent');
select is((select count(*) from public.activate_rights_session_v1(encode(extensions.digest(convert_to((select delivery_token from appeal_claim),
 'UTF8'),'sha256'),'hex'),repeat('7',64),repeat('A',32))),1::bigint,'fixture: its evidence session opens');
create temporary table appeal_uploaded(id uuid,kind text);
do $appeal$ declare v_kind text; ordinal integer:=0; opened jsonb; plan jsonb; scan jsonb; content text:='%PDF-1.7 synthetic';
 cookie text; nonce text; sha text;
begin
 for v_kind in select unnest(array['appeal-photo-identity','appeal-subject-source-control']) loop
  ordinal:=ordinal+1; cookie:=pg_temp.h('appeal-cookie:'||ordinal); nonce:=pg_temp.h('appeal-nonce:'||ordinal);
  sha:=encode(extensions.digest(convert_to(content,'UTF8'),'sha256'),'hex');
  opened:=public.open_public_appeal_document_v1(repeat('7',64),repeat(chr(67+ordinal),32),v_kind,'application/pdf',octet_length(content),
   sha,cookie,decode(repeat(lpad(ordinal::text,2,'0'),72),'hex'));
  perform public.reserve_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,octet_length(content),sha);
  perform public.settle_claim_document_chunk_v1((opened->>'session')::uuid,cookie,0,true);
  plan:=public.begin_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,1);
  perform public.finish_claim_document_completion_v1((opened->>'session')::uuid,cookie,nonce,'composed',plan->>'objectKey');
  scan:=public.claim_next_appeal_document_scan_v1(pg_temp.h('appeal-lease'));
  if scan->>'documentId' is distinct from plan->>'documentId' then raise exception 'scan claimed another document'; end if;
  perform public.record_appeal_document_scan_v1((scan->>'documentId')::uuid,pg_temp.h('appeal-lease'),'OK',sha,'synthetic native test',1,
   clock_timestamp());
  insert into appeal_uploaded values((plan->>'documentId')::uuid,v_kind);
 end loop;
end $appeal$;
select is((select count(*) from appeal_uploaded),2::bigint,'fixture: both evidence documents are clean');
-- The evidence completed: how the case matched, and what it holds.
create function pg_temp.objection() returns text language plpgsql as $$
declare v_case uuid:=(select (value#>>'{frame,scope,caseId}')::uuid from appeal_prepared);
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.complete_new_public_appeal_evidence_v1(repeat('7',64),repeat('Q',32),jsonb_build_object(
  'photoIdentityDocumentId',(select id from appeal_uploaded where kind='appeal-photo-identity'),
  'subjectSourceControlDocumentId',(select id from appeal_uploaded where kind='appeal-subject-source-control')),true);
 return (select match_state from private.public_appeal_pending_reviews where case_id=v_case)||' '
  ||coalesce((select string_agg(target_kind,',') from private.public_appeal_provisional_targets where case_id=v_case),'no-hold');
end $$;
create function pg_temp.objects_to(p_record text,p_pre text default 'select 1') returns text language sql as $$
 select pg_temp.probe(p_pre||'; '||case when p_record like 'es%' then format('select pg_temp.requested(%L,''9'',repeat(''9'',64))',p_record)
   else format('select pg_temp.reviewed_requested(%L,''9'')',p_record) end
   ||format('; select pg_temp.account_confirms(''9'',''d165-sign-99999999999999999999'',%L,repeat(''9'',64))',pg_temp.person(p_record)),
  'select pg_temp.objection()',format('select private.public_appeal_target_held_v1(''subject'',pg_temp.sid(%L))::text',p_record)) $$;
select is(pg_temp.objects_to('rd-appeal'),pg_temp.objects_to('es-appeal'),
 '(appeal) an objection from the reviewed-document record''s person resolves to the record and holds it, as for the e-signature record');
select is(pg_temp.objects_to('rd-appeal'),'unique-current subject / true','(appeal) one current match, provisionally held');
select is(pg_temp.objects_to('rd-appeal','select pg_temp.bodies(''predecessor'')')||' | '||
 pg_temp.objects_to('es-appeal','select pg_temp.bodies(''predecessor'')'),
 'unresolved-potential no-hold / false | unique-current subject / true',
 '(predecessor) the objection did not resolve to a reviewed-document record and held nothing; an e-signature one it held');
select is(md5(pg_get_functiondef('private.public_appeal_provisional_binding_v1(uuid)'::regprocedure)),
 (select after_md5 from d165_patches where ordinal=15),'(patched) every probe swapped back');

select lives_ok('set constraints all immediate','every deferred constraint holds');
select * from finish();
rollback;
