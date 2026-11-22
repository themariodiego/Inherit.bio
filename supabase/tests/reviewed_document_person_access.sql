-- D-166: after a reviewed-document record's approved document is no longer
-- retained, its person keeps their own saved results and their exports of the
-- record and of their account, exactly as an e-signature record's person
-- does, and only the uploader's access ends
-- (20261122190000_reviewed_document_person_access.sql).
--
-- Proves, on synthetic rows only, with the fixture of
-- supabase/tests/path_b_reviewed_document_readers.sql (one confirmed record of
-- each Path B flow driven through the real doors: es, an e-signature request
-- 01 sends to 02; rd, a reviewed permission document for 05 that a named
-- reviewer reads in full and approves before 01 may send the request; each
-- person shares a report layer with 01, keeps one for themselves, confirms a
-- held file whose saved results the workers' doors complete, and turns
-- Copilot on for 01):
--   * Before the document's retention ends nothing changes, for either side
--     and either record: every answer is the same from the predecessor
--     bodies (rebuilt in place by reversing exactly the migration's anchors)
--     and from the patched ones.
--   * Its retention then ends as the code reads it: the document's fixed
--     deadline (retain_until, 730 days after acceptance) is past.
--     - With the predecessor bodies (D-166 as it was): the person's own saved
--       results and their exports stop, and so does the uploader's access.
--     - From the patched bodies: the person's choices, own saved results
--       (metadata, read decision, the results themselves), per-record and
--       whole-account export with the complete archive off and on, copies
--       made before and after, and "Download your data" answer exactly as
--       the e-signature record's person's do; a file 01 held before and the
--       person confirmed after is normalized and gets the person's own
--       result, as for the e-signature record.
--     - The uploader's paths answer exactly as they did before the
--       migration: no saved results, no shared layer to read, no Copilot,
--       no new held file, no upload card, no result made for a layer shared
--       with them, no export.
--     - After the retention sweep disposes of the document, the same.
--     - After the person's own move, and after the uploader's hand-over, the
--       person exports the record and their account and "Download your data"
--       lists and reads the file, as for the e-signature record, from either
--       set of bodies.
--   * The e-signature record answers the same throughout.
--   * The migration's bodies, helper and privileges, and what it leaves
--     unchanged (the uploader's confirmation read and its other callers).
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
 values('0b5e0000-0000-4000-8000-000000000005','d166-person@e2e.local','{"display_name":"Synthetic person"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 values('0b5e0000-0000-4000-8000-000000000015','0b5e0000-0000-4000-8000-000000000005',now(),now(),'aal1');
update public.profiles p set date_of_birth=date '1990-01-01',jurisdiction_code='GB',jurisdiction_declared_at=clock_timestamp(),
 jurisdiction_attestation_version=a.version,jurisdiction_attestation_sha256=a.body_sha256
 from public.consent_artifacts a where a.artifact_key='attestation.jurisdiction' and a.superseded_at is null
  and p.id='0b5e0000-0000-4000-8000-000000000005';
update auth.users set created_at=now()-interval '1 day',email_confirmed_at=now()-interval '1 day' where id::text like '0b5e0000-%';
insert into auth.users(id,email,raw_user_meta_data)
 values('d1660000-0000-4000-8000-000000000003','d166-reviewer@e2e.local','{"display_name":"Synthetic reviewer"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 values('d1660000-0000-4000-8000-000000000013','d1660000-0000-4000-8000-000000000003',now(),now(),'aal2');
select private.grant_claim_reviewer_v1('d1660000-0000-4000-8000-000000000003');
-- Notices already queued by earlier local runs are set aside, so every
-- notice below is this suite's own.
update private.invitation_terminal_notices set state='expired',contact_ciphertext=null,recipient_account_id=null
 where state='pending';
update public.mail_outbox set state='invalidated' where invitation_terminal_notice_id is not null and state in ('queued','claimed');
update public.report_templates set status='review' where status='published';
insert into public.report_templates(slug,category,title,summary,status,evidence,layer,estimate_kind,variants,citations)
 values('synthetic-d166-variant','synthetic','Synthetic variant','Synthetic reviewed-document person access fixture.',
  'published','emerging','variant_call',null,
  '[{"rsid":123,"gene":"SYNTHETIC","chrom":1,"pos38":100000,"ref":"A","alt":"G","interpretations":{"AG":"Synthetic covered genotype"}}]',
  '[{"pmid":"12345678","label":"fixture"}]');

-- Helpers -----------------------------------------------------------------------
create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('d166:'||p,'sha256'),'hex') $$;
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
 perform pg_temp.jwt('d1660000-0000-4000-8000-000000000003','d1660000-0000-4000-8000-000000000013');
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
 perform private.assign_permission_document_review_v1(v_document,'d1660000-0000-4000-8000-000000000003');
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

-- What the uploader reads of a record, each answer as it comes: the read
-- decision for the layer shared with them, their shares list, their saved
-- results (listed, and read), their one-record Copilot, their upload
-- authority and a new held file through it, their upload card, and an export.
create function pg_temp.uploader_reads(p_record text) returns text language plpgsql as $$
declare v_subject uuid:=pg_temp.sid(p_record); v_label text:=(select label from rec where name=p_record);
begin
 return 'read '||(private.path_b_result_read_v1(pg_temp.a('1'),v_subject,'reports.monogenic')->>'gate')
  ||' / shares '||coalesce((select string_agg(x->>'purpose'||':'||(x->>'gate'),',' order by x->>'purpose')
    from jsonb_array_elements(public.path_b_uploader_shares_v1(pg_temp.a('1'),pg_temp.s('1'),true)) e,jsonb_array_elements(e->'shared') x
    where e->>'label'=v_label),'none')
  ||' / results '||(select count(*) from jsonb_array_elements(public.path_b_report_metadata_v1(pg_temp.a('1'),pg_temp.s('1'),null,true)) e
    where e->>'subjectId'=v_subject::text)
  ||':'||pg_temp.probe('select 1',format($q$select jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('1'),pg_temp.s('1'),
    %L::uuid,'reports.monogenic',true))::text$q$,v_subject))
  ||' / copilot '||pg_temp.probe('select 1',format($q$select public.subject_copilot_scope_v1(pg_temp.a('1'),pg_temp.s('1'),%L::uuid)->>'state'$q$,
    v_subject))
  ||' / store '||pg_temp.probe('select 1',format($q$select (private.other_adult_upload_store_authority_v1(pg_temp.a('1'),pg_temp.s('1'),
    %L::uuid) ? 'uploadConsentId')::text$q$,v_subject))
  ||' / hold '||pg_temp.probe('select 1',format($q$select (public.issue_other_adult_held_upload_v1(pg_temp.a('1'),pg_temp.s('1'),%L::uuid,
    'VCF',8,repeat('8',64),true) ? 'uploadId')::text$q$,v_subject))
  ||' / card '||exists(select 1 from jsonb_array_elements(public.other_adult_upload_targets_v1(pg_temp.a('1'),pg_temp.s('1'),true)) e
    where e->>'subjectId'=v_subject::text)
  ||' / export '||pg_temp.can_export('1',p_record);
end $$;
-- What the person reads of their record, made generic so the two records'
-- answers compare whole: their choices (with each read gate), their saved
-- results listed and read, and what they can export.
create function pg_temp.person_reads(p_record text) returns text language plpgsql as $$
declare v text:=pg_temp.person(p_record); v_subject uuid:=pg_temp.sid(p_record);
begin
 return 'choices '||pg_temp.norm(public.path_b_person_choices_v1(pg_temp.a(v),pg_temp.s(v),true))
  ||' / results '||pg_temp.norm(public.path_b_report_metadata_v1(pg_temp.a(v),pg_temp.s(v),null,true))
  ||' / read '||pg_temp.probe('select 1',format($q$select pg_temp.norm(public.path_b_report_results_v1(pg_temp.a(%L),pg_temp.s(%L),
    %L::uuid,'reports.monogenic',true))$q$,v,v,v_subject))
  ||' / held '||pg_temp.norm(public.subject_held_files_v1(pg_temp.a(v),pg_temp.s(v),true))
  ||' / export '||pg_temp.exports(v,p_record);
end $$;
-- How many of the record's files "Download your data" lists.
create function pg_temp.listed_files(p_record text) returns bigint language sql as $$
 select count(*) from jsonb_array_elements(public.own_subject_export_content_v1('list',pg_temp.a(pg_temp.person(p_record)),
  pg_temp.s(pg_temp.person(p_record)),null,null,0)) x where x#>>'{file,subject_id}'=pg_temp.sid(p_record)::text $$;
-- Everything both sides read of a record.
create function pg_temp.everything(p_record text) returns text language sql as $$
 select pg_temp.seen(p_record)||' | '||pg_temp.person_reads(p_record)||' | '||pg_temp.uploader_reads(p_record) $$;
-- Whether the record's approved document is still retained, as every reader asks it.
create function pg_temp.retained(p_record text) returns boolean language sql as $$
 select private.path_b_reviewed_document_retained_v1(pg_temp.sid(p_record)) $$;
-- The approved document's retention ends, as the code reads it: its fixed
-- deadline (retain_until, set once at acceptance to 730 days later) is past.
-- Synthetic: the clock cannot move, and the deadline is fixed once, so its
-- guard trigger is set aside for this one update only.
create function pg_temp.end_retention(p_record text) returns bigint language plpgsql as $$
declare n bigint;
begin
 alter table private.permission_documents disable trigger permission_document_transition;
 update private.permission_documents set retain_until=clock_timestamp()-interval '1 minute'
  where subject_id=pg_temp.sid(p_record) and retain_until is not null;
 get diagnostics n=row_count;
 alter table private.permission_documents enable trigger permission_document_transition;
 return n;
end $$;
-- The saved-result bindings made for a file: whose layer, and its state.
create function pg_temp.bindings(p_file text) returns text language sql as $$
 select coalesce(string_agg((a->>'direction')||':'||b.state,',' order by a->>'direction'),'none')
 from private.path_b_report_bindings b,lateral (select b.authority a) x
 where b.file_id=pg_temp.fxv(p_file,'revision')::uuid $$;

-- The four bodies 20261122190000 patches: its own patch rows, so the
-- predecessors are rebuilt here by reversing exactly its anchors.
create temporary table d166_patches(ordinal integer primary key,target text,before_md5 text,after_md5 text,acl text,
 old_fragment text,new_fragment text,label text);
insert into d166_patches values
  -- The Path B source authority: the record's confirmation, with no reader in it.
  (1,'private.path_b_normalization_authority_v1(uuid,text)','591fc9f913fb7177ed86144a7ce654f4',
   'b08c6d4602197f532a3d578eebff4c6b','{postgres=X/postgres}',
   $old$ t:=private.path_b_subject_v1(h.uploader_account_id,h.subject_id);
$old$,
   $new$ -- 20261122190000 (D-166): the record's confirmation, which a reviewed-document record keeps after
 -- its approved document's retention ends; the read decision and the report authority still ask the
 -- uploader's own for the uploader.
 t:=private.path_b_confirmation_v1(h.uploader_account_id,h.subject_id);
$new$,
   'source authority'),
  -- The read decision: a reader other than the person is the uploader.
  (2,'private.path_b_result_read_v1(uuid,uuid,text)','d39c35dab17636d453a18f41bde4ede4',
   'e165f72a2ea253503f0f433284b8a3dd','{postgres=X/postgres}',
   $old$   if private.path_b_normalization_authority_v1((c->>'fileId')::uuid,'derived-write-and-read')=c->'authority' then
$old$,
   $new$   if private.path_b_normalization_authority_v1((c->>'fileId')::uuid,'derived-write-and-read')=c->'authority' then
    -- 20261122190000 (D-166): any reader but the person (the uploader) still needs the uploader's
    -- confirmation read, which for a reviewed-document record needs its approved document retained.
    if m->>'decision' is distinct from 'subject-own-right-only' then
     perform private.path_b_subject_v1(p_account_id,p_subject_id); end if;
$new$,
   'read decision'),
  -- The report authority: a layer other than the person's own is the uploader's.
  (3,'private.path_b_report_authority_v1(uuid,uuid,text)','a77b3f10be091726b10930ba06b82680',
   '689beb777fa9a4d1356e3689f9576eff','{postgres=X/postgres}',
   $old$ c:=private.path_b_person_v1(s.subject_account_id,g.path_b_originating_session_id,s.id);
$old$,
   $new$ -- 20261122190000 (D-166): any layer but the person's own (one shared with the uploader) still needs the
 -- uploader's confirmation read, which for a reviewed-document record needs its approved document retained.
 if d.direction is distinct from 'self' then perform private.path_b_subject_v1(s.owner_account_id,s.id); end if;
 c:=private.path_b_person_v1(s.subject_account_id,g.path_b_originating_session_id,s.id);
$new$,
   'report authority'),
  -- The person's capture of the record, alone or in their whole account.
  (4,'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)','5c9fee7018806a025ad537664cd23b69',
   '2fb0181f5c393cf7283cb9e33704789a','{postgres=X/postgres}',
   $old$    confirmation:=private.path_b_subject_v1(s.owner_account_id,s.id);
$old$,
   $new$    -- 20261122190000 (D-166): the record's confirmation, which the person keeps after a
    -- reviewed-document record's approved document is no longer retained.
    confirmation:=private.path_b_confirmation_v1(s.owner_account_id,s.id);
$new$,
   'person capture');
create temporary table d166_successors as select target,pg_get_functiondef(target::regprocedure) def from d166_patches;
-- Swaps every patched body for its predecessor (its anchor reversed) or back
-- to its successor; answers the bodies' md5s in patch order.
create function pg_temp.bodies(p_which text) returns text language plpgsql as $$
declare t record;
begin
 for t in select p.*,s.def from d166_patches p join d166_successors s using(target) order by p.ordinal loop
  execute case when p_which='predecessor' then replace(t.def,t.new_fragment,t.old_fragment) else t.def end;
 end loop;
 return (select string_agg(md5(pg_get_functiondef(target::regprocedure)),' ' order by ordinal) from d166_patches);
end $$;
create function pg_temp.expected(p_which text) returns text language sql as $$
 select string_agg(case when p_which='predecessor' then before_md5 else after_md5 end,' ' order by ordinal) from d166_patches $$;

-- 0. The migration --------------------------------------------------------------------
select is((select string_agg(md5(pg_get_functiondef(p.oid))||' '||p.proacl::text,', ' order by x.ordinal)
  from d166_patches x join pg_proc p on p.oid=x.target::regprocedure),
 (select string_agg(after_md5||' '||acl,', ' order by ordinal) from d166_patches),
 'the four patched bodies carry their pinned successors and unchanged privileges');
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text||' '||p.prosecdef::text||' '||p.provolatile::text||' '||array_to_string(p.proconfig,',')
  from pg_proc p where p.oid='private.path_b_confirmation_v1(uuid,uuid)'::regprocedure),
 '87d1170f0ed36bd81845c4cbfd1ac622 {postgres=X/postgres} true v search_path=pg_catalog, private',
 'the record''s confirmation is new, a definer, and callable by no API role');
select ok((select bool_and(not has_function_privilege(r,'private.path_b_confirmation_v1(uuid,uuid)','execute'))
  from unnest(array['anon','authenticated','service_role','inherit_upload_only']) r),'no API role may call it');
-- It is the uploader's confirmation read without exactly its retention clause.
select is((select replace(prosrc,$q$  -- 20261016190000: or the reviewed-document flow, with its approved document still live.
  and ((adult_flow='path-b-subject-esignature' and evidence_kind='esignature')
   or (adult_flow='path-b-reviewed-document' and evidence_kind='uploaded_document'
    and private.path_b_reviewed_document_retained_v1(s.id)))
$q$,$q$  -- 20261122190000 (D-166): either Path B flow, each with its own evidence; the
  -- approved document's retention is the uploader's (private.path_b_subject_v1).
  and ((adult_flow='path-b-subject-esignature' and evidence_kind='esignature')
   or (adult_flow='path-b-reviewed-document' and evidence_kind='uploaded_document'))
$q$) from pg_proc where oid='private.path_b_subject_v1(uuid,uuid)'::regprocedure),
 (select prosrc from pg_proc where oid='private.path_b_confirmation_v1(uuid,uuid)'::regprocedure),
 'the record''s confirmation is the uploader''s confirmation read, line for line, without its retention clause');
select is((select string_agg(md5(pg_get_functiondef(x::regprocedure)),' ' order by o) from unnest(array[
  'private.path_b_subject_v1(uuid,uuid)','private.path_b_reviewed_document_retained_v1(uuid)',
  'private.permission_document_live_v1(private.permission_documents)','private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)',
  'private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)','private.public_appeal_provisional_binding_v1(uuid)'])
  with ordinality as t(x,o)),
 'd174a83682e35479797ac7e738a65d79 a8e15740ad618a999aa73a1c9f909817 39de6ef674864bbcd2283003f72c0625 '
 ||'b8e13301350522ce9933d646c273d421 50b661f2167a28ba458a5153bb71ace3 7d7b1f82a7703c625b5695ba2aad57b4',
 'unchanged: the uploader''s confirmation read, what its retention clause asks, the uploader''s upload doors and the public appeal');
select is((select string_agg(p.oid::regprocedure::text,', ' order by p.oid::regprocedure::text) from pg_proc p
  where p.prosrc ~ '[^a-z_]path_b_subject_v1\s*\(' and p.oid<>'private.path_b_subject_v1(uuid,uuid)'::regprocedure),
 'private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text), private.other_adult_upload_store_authority_v1(uuid,uuid,uuid), '
 ||'private.path_b_report_authority_v1(uuid,uuid,text), private.path_b_result_read_v1(uuid,uuid,text), private.public_appeal_provisional_binding_v1(uuid)',
 'only the uploader''s doors, the uploader''s two gates and the public appeal still ask the uploader''s confirmation read');
select is((select string_agg(p.oid::regprocedure::text,', ' order by p.oid::regprocedure::text) from pg_proc p
  where p.prosrc ~ '[^a-z_]path_b_confirmation_v1\s*\(' and p.oid<>'private.path_b_confirmation_v1(uuid,uuid)'::regprocedure),
 'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid), private.path_b_normalization_authority_v1(uuid,text)',
 'the person''s capture and the source authority ask the record''s confirmation');

-- 1. The records, each through its own flow's real doors (the D-165 fixture) ----------------
select pg_temp.requested('es','a',repeat('a',64));
select is(pg_temp.account_confirms('a','d166-sign-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 '(es) the person confirms the e-signature request with their own account');
select pg_temp.reviewed_requested('rd','b');
select is(pg_temp.account_confirms('b','d166-sign-bbbbbbbbbbbbbbbbbbb','5',repeat('b',64)),'accepted',
 '(rd) the person confirms the request their permission document allowed, with their own account');
select is(pg_temp.flow('es')||' '||pg_temp.flow('rd'),'path-b-subject-esignature:confirmed path-b-reviewed-document:confirmed',
 'fixture: one confirmed record of each flow');
select ok((select d.retain_until=i.accepted_at+interval '730 days' and d.review_state='approved' and d.state='clean'
  from private.path_b_reviewed_document_requests r join private.permission_documents d on d.id=r.document_id
  join public.subject_invitations i on i.id=r.invitation_id where r.subject_id=pg_temp.sid('rd')),
 '(rd) the approved document is retained until 730 days after acceptance');
insert into grants select 'es-self',(r->>'recordId')::uuid,r from pg_temp.share('es','reports.monogenic','self','es-self') r;
insert into grants select 'rd-self',(r->>'recordId')::uuid,r from pg_temp.share('rd','reports.monogenic','self','rd-self') r;
insert into grants select 'es-up',(r->>'recordId')::uuid,r from pg_temp.share('es','reports.monogenic','uploader','es-up') r;
insert into grants select 'rd-up',(r->>'recordId')::uuid,r from pg_temp.share('rd','reports.monogenic','uploader','rd-up') r;
select is((select count(*) from grants where id is not null),4::bigint,'fixture: each person shares with the uploader and for themselves');
select is((select h->>'status' from (select pg_temp.hold('es-file',pg_temp.sid('es'),repeat('3',64)) h) x)||' '||
 (select h->>'status' from (select pg_temp.hold('rd-file',pg_temp.sid('rd'),repeat('4',64)) h) x),
 'stored_quarantined stored_quarantined','fixture: 01 holds a file for each');
select is(pg_temp.notice_session('es-file','3'),1::bigint,'fixture: (es) the file''s notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('3',64),'d166-confirm-3333333333333333333','confirm',pg_temp.a('2')),
 'confirmed','fixture: (es) the person confirms the file');
select is(pg_temp.notice_session('rd-file','4'),1::bigint,'fixture: (rd) the file''s notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('4',64),'d166-confirm-4444444444444444444','confirm',pg_temp.a('5')),
 'confirmed','fixture: (rd) the person confirms the file');
select is(pg_temp.normalize_all(),2,'fixture: both files are normalized');
select is(pg_temp.complete_reports(),'complete complete complete complete','fixture: every saved result is completed');
create temporary table uploader_self as select id from public.subjects where subject_account_id=pg_temp.a('1') and subject_class='self';
select public.save_own_copilot_settings_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.synthetic_copilot_settings('synthetic-model','local'),
 null,pg_temp.h('copilot-settings'),null);
create temporary table presentation as select public.own_copilot_presentation_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self)) value;
select public.grant_own_copilot_v1(pg_temp.a('1'),pg_temp.s('1'),(select id from uploader_self),(select value->'snapshot' from presentation),
 (select value->'artifacts' from presentation),pg_temp.h('copilot-grant'),clock_timestamp()+interval '9 minutes');
insert into grants select 'es-copilot',(r->>'recordId')::uuid,r from pg_temp.share('es','copilot.local','uploader','es-copilot') r;
insert into grants select 'rd-copilot',(r->>'recordId')::uuid,r from pg_temp.share('rd','copilot.local','uploader','rd-copilot') r;
select is((select count(*) from grants where id is not null),6::bigint,'fixture: each person turns Copilot on for the uploader');
-- 01 holds a second file for each, before anything ends; each person answers it later.
select is((select h->>'status' from (select pg_temp.hold('es-late',pg_temp.sid('es'),repeat('6',64)) h) x)||' '||
 (select h->>'status' from (select pg_temp.hold('rd-late',pg_temp.sid('rd'),repeat('7',64)) h) x),
 'stored_quarantined stored_quarantined','fixture: 01 holds a second file for each, not yet answered');

-- 2. Before the document's retention ends: nothing changes -----------------------------------
select ok(pg_temp.retained('rd'),'(retained) the reviewed-document record''s approved document is retained');
select is(pg_temp.seen('rd'),pg_temp.all_readers(),'(retained) the reviewed-document record reaches every reader');
select is(pg_temp.seen('es'),pg_temp.all_readers(),'(retained) as the e-signature record does');
create temporary table retained_answers(record text primary key,bodies text,answers text);
insert into retained_answers select x,'patched',pg_temp.everything(x) from unnest(array['es','rd']) x;
select is((select answers from retained_answers where record='rd'),(select answers from retained_answers where record='es'),
 '(retained) both sides read the reviewed-document record exactly as the e-signature record');
select is(pg_temp.bodies('predecessor'),pg_temp.expected('predecessor'),'(retained) the predecessors swapped in: the four bodies as 20261122180000 left them');
select is(pg_temp.everything('rd'),(select answers from retained_answers where record='rd'),
 '(retained) from them, every answer about the reviewed-document record is the same');
select is(pg_temp.everything('es'),(select answers from retained_answers where record='es'),
 '(retained) and about the e-signature record');
select is(pg_temp.bodies('patched'),pg_temp.expected('patched'),'(retained) the successors swapped back');

-- 3. The approved document's retention ends -------------------------------------------------
savepoint retention_ended;
update private.account_archive_r2_configuration set enabled=true,bucket='inherit-export-test',binding_sha256=repeat('2',64);
select is(pg_temp.new_copies('rd-kept','rd')||' | '||pg_temp.new_copies('es-kept','es'),'works / works | works / works',
 'fixture: a copy of each record and of each whole account, made while the document is retained, works');
select is(pg_temp.end_retention('rd'),1::bigint,'the reviewed-document record''s approved document reaches its fixed deadline');
select is(pg_temp.retained('rd')::text||' '||(select count(*) from private.permission_documents where subject_id=pg_temp.sid('es')),
 'false 0','(ended) it is no longer retained; the e-signature record has no document');

-- 3a. D-166 as it was: the predecessors.
select is(pg_temp.bodies('predecessor'),pg_temp.expected('predecessor'),'(predecessor) swapped in');
select is(pg_temp.seen('rd'),'choices held-files uploader-shares export-file',
 '(predecessor) D-166: the person''s own saved results and exports stopped with the uploader''s access');
select is(pg_temp.seen('es'),pg_temp.all_readers(),'(predecessor) the e-signature record reaches every reader');
select is(pg_temp.exports('5','rd'),'off false record 42501 not_found / account 42501 not_found | on true record 42501 not_found / account 42501 not_found',
 '(predecessor) the person could export neither the record nor their whole account');
select is(pg_temp.copy_works('rd-kept-record')||' / '||pg_temp.copy_works('rd-kept-account'),'stopped / stopped',
 '(predecessor) and their copies made before stopped');
create temporary table ended_answers(record text,bodies text,part text,answers text,primary key(record,bodies,part));
insert into ended_answers select x,'predecessor','uploader',pg_temp.uploader_reads(x) from unnest(array['es','rd']) x;
insert into ended_answers select 'es','predecessor','everything',pg_temp.everything('es');
select is(pg_temp.bodies('patched'),pg_temp.expected('patched'),'(patched) swapped back');

-- 3b. The person keeps their own access.
select is(pg_temp.seen('rd'),'choices held-files uploader-shares own-results export-file record-export account-export',
 '(ended) the person''s own saved results and exports continue; the uploader''s saved results and Copilot do not');
select is(pg_temp.seen('es'),pg_temp.all_readers(),'(ended) the e-signature record reaches every reader');
select is(pg_temp.everything('es'),(select answers from ended_answers where record='es' and part='everything'),
 '(ended) every answer about the e-signature record is the same from either set of bodies');
select is(pg_temp.norm(public.path_b_person_choices_v1(pg_temp.a('5'),pg_temp.s('5'),true)),
 pg_temp.norm(public.path_b_person_choices_v1(pg_temp.a('2'),pg_temp.s('2'),true)),
 '(ended) the person''s choices page lists the record exactly as the e-signature record''s person''s does');
select is((select (e->'readGate')::text from jsonb_array_elements(public.path_b_person_choices_v1(pg_temp.a('5'),pg_temp.s('5'),true)) e),
 '{"ancestry": "directional-purpose-grant-v1", "reports.monogenic": "ready", "reports.polygenic": "directional-purpose-grant-v1"}',
 '(ended) their own saved result is ready to read');
select is(pg_temp.norm(public.path_b_report_metadata_v1(pg_temp.a('5'),pg_temp.s('5'),null,true)),
 pg_temp.norm(public.path_b_report_metadata_v1(pg_temp.a('2'),pg_temp.s('2'),null,true)),
 '(ended) their saved results are listed as the e-signature record''s person''s are');
select is(pg_temp.norm(public.path_b_report_results_v1(pg_temp.a('5'),pg_temp.s('5'),pg_temp.sid('rd'),'reports.monogenic',true)),
 pg_temp.norm(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('es'),'reports.monogenic',true)),
 '(ended) and read as theirs are');
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('5'),pg_temp.s('5'),pg_temp.sid('rd'),'reports.monogenic',true)),1,
 '(ended) the one saved result of their own');
select is(pg_temp.exports('5','rd'),'off false record true / account true | on true record true / account true',
 '(ended) the person exports the record and their whole account, with the complete archive off and on');
select is(pg_temp.exports('5','rd'),pg_temp.exports('2','es'),'(ended) as the e-signature record''s person does');
select is(pg_temp.copy_works('rd-kept-record')||' / '||pg_temp.copy_works('rd-kept-account')||' | '||
 pg_temp.copy_works('es-kept-record')||' / '||pg_temp.copy_works('es-kept-account'),'works / works | works / works',
 '(ended) their copies made before still work, as the e-signature record''s person''s do');
select is(pg_temp.probe('select 1',$q$select pg_temp.new_copies('rd-ended','rd')$q$),'works / works',
 '(ended) and a new copy of each can be made, opened and read');
select is(coalesce(pg_temp.listed('rd')::text,'none')||' '||coalesce(pg_temp.listed('es')::text,'none'),'none none',
 '(ended) "Download your data" lists no file of a record the uploader still holds, for either, as before');
select is(pg_temp.person_reads('rd'),pg_temp.person_reads('es'),
 '(ended) everything the person reads of the record, exactly as the e-signature record''s person');

-- 3c. The uploader's access still requires the retained document.
select is(pg_temp.uploader_reads('rd'),(select answers from ended_answers where record='rd' and bodies='predecessor' and part='uploader'),
 '(ended) every uploader path answers exactly as before the migration');
select is(pg_temp.uploader_reads('rd'),
 'read subject-bound-source / shares reports.monogenic:subject-bound-source / results 0:0 / copilot permission-missing'
 ||' / store 42501 not_found / hold 42501 not_found / card false / export record 42501 not_found / account 0A000 export_result_projection_unavailable',
 '(ended) the uploader reads no saved result, opens no Copilot, may hold no new file, has no upload card and exports nothing');
select is(pg_temp.uploader_reads('es'),
 'read ready / shares reports.monogenic:ready / results 1:1 / copilot ready'
 ||' / store true / hold 55000 upload_unavailable / card true / export record 42501 not_found / account 0A000 export_result_projection_unavailable',
 '(ended) the e-signature record''s uploader keeps all of them (a new held file waits only for the one not yet answered)');
select is(pg_temp.uploader_reads('es'),(select answers from ended_answers where record='es' and bodies='predecessor' and part='uploader'),
 '(ended) as before the migration');

-- 3d. A file 01 held before and the person confirmed after.
select is(pg_temp.notice_session('es-late','6'),1::bigint,'fixture: (es) the second file''s notice opens a session');
select is(pg_temp.notice_session('rd-late','7'),1::bigint,'fixture: (rd) the second file''s notice opens a session');
select is(pg_temp.probe('select pg_temp.bodies(''predecessor'')',
  $q$select public.respond_adult_upload_revision_v1(repeat('7',64),'d166-confirm-7777777777777777777','confirm',pg_temp.a('5'))$q$,
  $q$select pg_temp.normalize_all()::text$q$),'confirmed / 0',
 '(predecessor) the person could confirm it, but it was never normalized');
select is(public.respond_adult_upload_revision_v1(repeat('6',64),'d166-confirm-6666666666666666666','confirm',pg_temp.a('2'))||' '||
 public.respond_adult_upload_revision_v1(repeat('7',64),'d166-confirm-7777777777777777777','confirm',pg_temp.a('5')),
 'confirmed confirmed','(late) each person confirms the second file after the document''s retention ended');
select is(pg_temp.normalize_all(),2,'(late) both are normalized, as for the e-signature record');
select is(pg_temp.complete_reports(),'complete complete complete','(late) three saved results are made');
select is(pg_temp.bindings('rd-late')||' | '||pg_temp.bindings('es-late'),'self:complete | self:complete,subject_to_recipient:complete',
 '(late) the person''s own result of it is made; none for the uploader, who has one of the e-signature record''s');
select is(jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('5'),pg_temp.s('5'),pg_temp.sid('rd'),'reports.monogenic',true))||' '||
 jsonb_array_length(public.path_b_report_results_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('es'),'reports.monogenic',true)),'2 2',
 '(late) the person reads both of their own results, as the e-signature record''s person does');
select is(pg_temp.exports('5','rd'),pg_temp.exports('2','es'),'(late) and exports the record and their account with both');
select is(pg_temp.uploader_reads('rd'),(select answers from ended_answers where record='rd' and bodies='predecessor' and part='uploader'),
 '(late) the uploader still reads nothing of the record');

-- 3e. The retention sweep disposes of the document.
select ok((select count(*)>=0 from private.permission_document_objects_due_v1(1000)),'the retention sweep runs');
select is((select (s.wrapped_document_key is null)::text from private.permission_documents d
  join private.permission_document_sessions s on s.id=d.session_id where d.subject_id=pg_temp.sid('rd')),'true',
 '(swept) the document''s key is shredded');
select is(pg_temp.seen('rd'),'choices held-files uploader-shares own-results export-file record-export account-export',
 '(swept) the person keeps the same access');
select is(pg_temp.person_reads('rd'),pg_temp.person_reads('es'),
 '(swept) everything the person reads, exactly as the e-signature record''s person');
select is(pg_temp.uploader_reads('rd'),(select answers from ended_answers where record='rd' and bodies='predecessor' and part='uploader'),
 '(swept) and the uploader still reads nothing');

-- 4. After a transfer (the document's retention ended) ----------------------------------------
savepoint own_move;
set local role service_role;
select is(public.transfer_subject_v1(pg_temp.a('5'),pg_temp.s('5'),pg_temp.sid('rd'),pg_temp.h('move-rd'),
 clock_timestamp()+interval '5 minutes')->>'status','transferred','(moved) the person moves the reviewed-document record into their account');
select is(public.transfer_subject_v1(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('es'),pg_temp.h('move-es'),
 clock_timestamp()+interval '5 minutes')->>'status','transferred','(moved) as the e-signature record''s person does');
reset role;
select is(pg_temp.exports('5','rd'),'off false record true / account true | on true record true / account true',
 '(moved) the person exports the record and their whole account, archive off and on');
select is(pg_temp.exports('5','rd'),pg_temp.exports('2','es'),'(moved) as the e-signature record''s person does');
select is(pg_temp.listed_files('rd')||' '||pg_temp.variants('rd')||' | '||pg_temp.listed_files('es')||' '||pg_temp.variants('es'),'2 1 | 2 1',
 '(moved) "Download your data" lists both files and reads them, for either');
select is(pg_temp.probe('select pg_temp.bodies(''predecessor'')',$q$select pg_temp.exports('5','rd')||' '||pg_temp.variants('rd')$q$),
 'off false record true / account true | on true record true / account true 1',
 '(moved, predecessor) after a transfer the retention was never read');
select is(pg_temp.can_export('1','rd'),pg_temp.can_export('1','es'),'(moved) the former uploader is refused as for the e-signature record');
rollback to own_move;
savepoint hand_over;
set local role service_role;
select is(public.withdraw_other_adult_upload_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('rd'),pg_temp.h('withdraw-rd'),
 clock_timestamp()+interval '5 minutes')::text||' '||public.withdraw_other_adult_upload_v1(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('es'),
 pg_temp.h('withdraw-es'),clock_timestamp()+interval '5 minutes')::text,'{"case": "adult"} {"case": "adult"}',
 '(handed over) the uploader''s withdrawal hands each record to its person');
reset role;
select is(pg_temp.exports('5','rd'),pg_temp.exports('2','es'),'(handed over) the person exports the record and their account as the e-signature record''s person does');
select is(pg_temp.exports('5','rd'),'off false record true / account true | on true record true / account true',
 '(handed over) archive off and on');
select is(pg_temp.listed_files('rd')||' '||pg_temp.variants('rd')||' | '||pg_temp.listed_files('es')||' '||pg_temp.variants('es'),'2 1 | 2 1',
 '(handed over) "Download your data" lists both files and reads them, for either');
rollback to hand_over;

-- 5. The e-signature record, throughout ----------------------------------------------------
create temporary table es_late as select pg_temp.everything('es') answers;
select is(pg_temp.bodies('predecessor'),pg_temp.expected('predecessor'),'(predecessor) swapped in once more');
select is(pg_temp.everything('es'),(select answers from es_late),
 '(late) every answer about the e-signature record, its second file confirmed, is the same from either set of bodies');
select is(pg_temp.bodies('patched'),pg_temp.expected('patched'),'(patched) swapped back');
rollback to retention_ended;
select is(pg_temp.everything('es'),(select answers from retained_answers where record='es'),
 'and the same as before the document''s retention ended');
select is(pg_temp.everything('rd'),(select answers from retained_answers where record='rd'),
 'the reviewed-document record, its document retained again, answers as before');
select is(pg_temp.bodies('patched'),pg_temp.expected('patched'),'every body is its successor');

select lives_ok('set constraints all immediate','every deferred constraint holds');
select * from finish();
rollback;
