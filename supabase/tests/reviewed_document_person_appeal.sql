-- D-166, the public appeal: after a reviewed-document record's approved
-- document is no longer retained, an objection from the person's own contact
-- still resolves to the record and holds it, exactly as it does an
-- e-signature record (20261122200000_reviewed_document_person_appeal.sql).
--
-- Proves, on synthetic rows only, with the fixture of
-- supabase/tests/path_b_reviewed_document_readers.sql: a subject objection,
-- prepared, committed, its evidence session opened and both evidence
-- documents clean, whose verified contact is the person's; and inside each
-- probe one record made for that contact through its own flow's real doors
-- (es, an e-signature request 01 sends to 02; rd, a reviewed permission
-- document for 05 that a named reviewer reads in full and approves before 01
-- may send the request), confirmed by its person with their own account or,
-- with no account, through the request's own session.
--   * The migration's body, its privileges, and who asks each confirmation read.
--   * While the document is retained, the objection resolves to either record
--     and holds it, from the predecessor body (rebuilt in place by reversing
--     exactly the migration's anchor) and from the successor alike.
--   * Once its retention ends as the code reads it (its fixed retain_until
--     past), and again after the retention sweep shreds its key: from the
--     predecessor the objection no longer resolved to the reviewed-document
--     record and held nothing (D-166); from the successor it resolves and
--     holds it exactly as the e-signature record's, with an account and
--     without.
--   * A request the person never answered resolves to nothing, for either
--     flow, from either body.
-- 01 uploads; 02 and 05 are the people. Everything rolls back.
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
 values('synthetic-d166-variant','synthetic','Synthetic variant','Synthetic reviewed-document person appeal fixture.',
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

-- The one body 20261122200000 patches: its own patch row, so the predecessor
-- is rebuilt here by reversing exactly its anchor.
create temporary table d166b_patches(ordinal integer primary key,target text,before_md5 text,after_md5 text,acl text,
 old_fragment text,new_fragment text,label text);
insert into d166b_patches values
  -- The resolution's recheck of a Path B record's confirmed binding.
  (1,'private.public_appeal_provisional_binding_v1(uuid)','7d7b1f82a7703c625b5695ba2aad57b4',
   '48f544b2fbec8084fc24913ef173dd01','{postgres=X/postgres}',
   $old$      confirmed_binding:=private.path_b_subject_v1(subject_row.owner_account_id,subject_row.id);
$old$,
   $new$      -- 20261122200000 (D-166): the record's confirmation, which the person's objection keeps after a
      -- reviewed-document record's approved document is no longer retained.
      confirmed_binding:=private.path_b_confirmation_v1(subject_row.owner_account_id,subject_row.id);
$new$,
   'appeal binding confirmation');
create temporary table d166b_successors as select target,pg_get_functiondef(target::regprocedure) def from d166b_patches;
-- Swaps the patched body for its predecessor (its anchor reversed) or back to
-- its successor; answers its md5.
create function pg_temp.bodies(p_which text) returns text language plpgsql as $$
declare t record;
begin
 for t in select p.*,s.def from d166b_patches p join d166b_successors s using(target) order by p.ordinal loop
  execute case when p_which='predecessor' then replace(t.def,t.new_fragment,t.old_fragment) else t.def end;
 end loop;
 return (select string_agg(md5(pg_get_functiondef(target::regprocedure)),' ' order by ordinal) from d166b_patches);
end $$;
create function pg_temp.expected(p_which text) returns text language sql as $$
 select string_agg(case when p_which='predecessor' then before_md5 else after_md5 end,' ' order by ordinal) from d166b_patches $$;
-- Which bodies ask a read.
create function pg_temp.askers(p_read text) returns text language sql as $$
 select string_agg(p.oid::regprocedure::text,', ' order by p.oid::regprocedure::text) from pg_proc p
 where p.prosrc ~ ('[^a-z_]'||p_read||'\s*\(') and p.proname<>p_read $$;

-- 0. The migration --------------------------------------------------------------------
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text||' '||p.provolatile::text||' '||array_to_string(p.proconfig,',')
  from pg_proc p where p.oid='private.public_appeal_provisional_binding_v1(uuid)'::regprocedure),
 (select after_md5||' '||acl||' v search_path=""' from d166b_patches),
 'the appeal''s resolution carries its pinned successor and unchanged privileges');
select is((select string_agg(md5(pg_get_functiondef(x::regprocedure)),' ' order by o) from unnest(array[
  'private.path_b_confirmation_v1(uuid,uuid)','private.path_b_subject_v1(uuid,uuid)']) with ordinality as t(x,o)),
 '87d1170f0ed36bd81845c4cbfd1ac622 d174a83682e35479797ac7e738a65d79',
 'unchanged: the record''s confirmation and the uploader''s confirmation read');
select is(pg_temp.askers('path_b_subject_v1'),
 'private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text), private.other_adult_upload_store_authority_v1(uuid,uuid,uuid), '
 ||'private.path_b_report_authority_v1(uuid,uuid,text), private.path_b_result_read_v1(uuid,uuid,text)',
 'only the uploader''s doors and the uploader''s two gates still ask the uploader''s confirmation read');
select is(pg_temp.askers('path_b_confirmation_v1'),
 'private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid), private.path_b_normalization_authority_v1(uuid,text), '
 ||'private.public_appeal_provisional_binding_v1(uuid)',
 'the person''s capture, the source authority and the appeal''s resolution ask the record''s confirmation');
select is(pg_temp.askers('public_appeal_provisional_binding_v1'),'complete_public_appeal_before_information_v1(text,text,jsonb,boolean)',
 'the resolution is asked only when an appeal''s evidence completes');

-- The appeal's fixture (as supabase/tests/path_b_reviewed_document_readers.sql makes it) -------------------
-- A subject objection whose contact is the person's: a record of either flow
-- made for that contact inside each probe, confirmed by its person.
update private.new_public_appeal_config set enabled=true where singleton;
insert into public.subject_principals(id,account_id,principal_kind) values
 ('d1660000-0000-4000-8000-000000000101','d1660000-0000-4000-8000-000000000003','reviewer');
insert into private.new_public_appeal_reviewers(principal_id,principal_revision,purpose_revision) values
 ('d1660000-0000-4000-8000-000000000101',1,1);
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

-- The approved document's retention ends, as the code reads it: its fixed
-- deadline (retain_until, set once at acceptance to 730 days later) is past.
-- Synthetic: the clock cannot move, and the deadline is fixed once, so its
-- guard trigger is set aside for this one update only. An e-signature record
-- has no document: nothing is updated.
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
-- An objection from the person's contact, with a record of the given flow
-- made for that contact inside the probe through its own doors and confirmed
-- by its person (with their account, or with none through the request's own
-- session, or not at all), its document then retained, no longer retained, or
-- no longer retained and swept; from the given body. It answers how the case
-- matched and what it holds, whether that record is held, and whether the
-- record's document is still retained.
create function pg_temp.objects(p_record text,p_confirm text,p_retention text,p_body text default 'patched') returns text
language sql as $$
 select pg_temp.probe(format('select pg_temp.bodies(%L); ',p_body)
   ||case when p_record like 'es%' then format('select pg_temp.requested(%L,''9'',repeat(''9'',64))',p_record)
    else format('select pg_temp.reviewed_requested(%L,''9'')',p_record) end
   ||case p_confirm when 'account' then format('; select pg_temp.account_confirms(''9'',''d166-sign-99999999999999999999'',%L,repeat(''9'',64))',
     pg_temp.person(p_record))
    when 'token' then '; select pg_temp.token_confirms(''9'',''d166-token-9999999999999999999'')' else '' end
   ||case when p_retention in('ended','swept') then format('; select pg_temp.end_retention(%L)',p_record) else '' end
   ||case when p_retention='swept' then '; select count(*) from private.permission_document_objects_due_v1(1000)' else '' end,
  'select pg_temp.objection()',
  format($q$select private.public_appeal_target_held_v1('subject',pg_temp.sid(%1$L))::text||' '||coalesce((select
    (case when private.path_b_reviewed_document_retained_v1(pg_temp.sid(%1$L)) then 'retained' else 'not-retained' end)
    ||case when exists(select 1 from private.permission_documents d join private.permission_document_sessions s on s.id=d.session_id
     where d.subject_id=pg_temp.sid(%1$L) and s.wrapped_document_key is null) then ' shredded' else '' end
    where exists(select 1 from private.permission_documents d where d.subject_id=pg_temp.sid(%1$L))),'no-document')
   ||' '||coalesce((select d.state from public.adult_subject_drafts d where d.subject_id=pg_temp.sid(%1$L)),'none')$q$,p_record)) $$;

-- 1. While the document is retained, nothing changes ---------------------------------------------
select is(pg_temp.objects('rd-appeal','account','retained'),'unique-current subject / true retained confirmed',
 '(retained) an objection from the person''s contact resolves to the reviewed-document record and holds it');
select is(pg_temp.objects('es-appeal','account','retained'),'unique-current subject / true no-document confirmed',
 '(retained) as it does the e-signature record');
select is(pg_temp.objects('rd-appeal','account','retained','predecessor')||' | '||pg_temp.objects('es-appeal','account','retained','predecessor'),
 pg_temp.objects('rd-appeal','account','retained')||' | '||pg_temp.objects('es-appeal','account','retained'),
 '(retained) the predecessor answered both the same');

-- 2. The document's retention ends ----------------------------------------------------------------
select is(pg_temp.objects('rd-appeal','account','ended','predecessor'),'unresolved-potential no-hold / false not-retained confirmed',
 '(predecessor) D-166: the objection no longer resolved to the reviewed-document record and held nothing');
select is(pg_temp.objects('es-appeal','account','ended','predecessor'),'unique-current subject / true no-document confirmed',
 '(predecessor) while it still held the e-signature record');
select is(pg_temp.objects('rd-appeal','account','ended'),'unique-current subject / true not-retained confirmed',
 '(ended) the objection resolves to the reviewed-document record and holds it');
select is(replace(pg_temp.objects('rd-appeal','account','ended'),'not-retained','no-document'),pg_temp.objects('es-appeal','account','ended'),
 '(ended) exactly as it does the e-signature record');
select is(pg_temp.objects('rd-appeal','account','swept'),'unique-current subject / true not-retained shredded confirmed',
 '(swept) and after the retention sweep shreds the document''s key');
select is(pg_temp.objects('rd-appeal','account','swept','predecessor'),'unresolved-potential no-hold / false not-retained shredded confirmed',
 '(swept, predecessor) where it resolved to nothing');

-- 3. A person with no account -----------------------------------------------------------------------
select is(pg_temp.objects('rd-appeal','token','retained')||' | '||pg_temp.objects('es-appeal','token','retained'),
 'unique-current subject / true retained confirmed | unique-current subject / true no-document confirmed',
 '(no account, retained) the objection resolves to either record and holds it');
select is(pg_temp.objects('rd-appeal','token','ended','predecessor'),'unresolved-potential no-hold / false not-retained confirmed',
 '(no account, predecessor) D-166: it no longer resolved to the reviewed-document record');
select is(pg_temp.objects('rd-appeal','token','ended')||' | '||pg_temp.objects('es-appeal','token','ended'),
 'unique-current subject / true not-retained confirmed | unique-current subject / true no-document confirmed',
 '(no account, ended) it resolves to either record and holds it');

-- 4. A request never answered resolves to nothing, for either flow, from either body ------------------
-- (A document gets its retention deadline only at acceptance, so there is none to end.)
select is(pg_temp.objects('rd-appeal','none','retained')||' | '||pg_temp.objects('es-appeal','none','retained'),
 'unresolved-potential no-hold / false retained invited | unresolved-potential no-hold / false no-document invited',
 '(unanswered) an objection resolves to no record a request never answered made, for either flow');
select is(pg_temp.objects('rd-appeal','none','retained','predecessor')||' | '||pg_temp.objects('es-appeal','none','retained','predecessor'),
 pg_temp.objects('rd-appeal','none','retained')||' | '||pg_temp.objects('es-appeal','none','retained'),
 '(unanswered) as from the predecessor');
select is(pg_temp.probe('select pg_temp.reviewed_requested(''rd-appeal'',''9'')',$q$select pg_temp.end_retention('rd-appeal')::text$q$,
  $q$select string_agg(coalesce(retain_until::text,'no-deadline'),',') from private.permission_documents
   where subject_id=pg_temp.sid('rd-appeal')$q$),'0 / no-deadline',
 '(unanswered) its document has no retention deadline before the request is accepted, so none can end');
select is(pg_temp.bodies('patched'),pg_temp.expected('patched'),'every probe swapped back: the successor');

select lives_ok('set constraints all immediate','every deferred constraint holds');
select * from finish();
rollback;
