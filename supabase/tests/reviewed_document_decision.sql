-- D-154: a Path B record made from a reviewed permission document gets the
-- same mitigation decision as an e-signature record
-- (20261122170000_inviter_grants_and_reviewed_document_decision.sql, item 2).
--
-- Proves, on synthetic rows only, with one record of each Path B flow in each
-- case, driven through the real doors (the reviewed document uploaded,
-- scanned, read and approved by a named reviewer; each request mailed,
-- opened and confirmed by the person):
--   * each account acceptance of a reviewed-document record records its
--     origin and starts its clocks exactly as an e-signature acceptance does
--     (20261120120000): an account created after the request both clocks, an
--     existing account the re-notice only;
--   * with the predecessor body (rebuilt here and swapped in, then swapped
--     back) the reviewed-document records answer not-found to their uploader
--     and to their person at every checkpoint (D-154), and the e-signature
--     records answer as now;
--   * from the patched body, at every checkpoint and every step, the uploader,
--     the person and anyone else get the same answer for a reviewed-document
--     record as for the e-signature record in the same state: the 72-hour hold
--     and its release once the second notice is accepted, the 30-day re-notice
--     and its release once the reminder is accepted, the person's own rights
--     and their held analysis, and the no-account record's rules (no live
--     730-day clock, a live one, and no re-notice from 30 days);
--   * the checkpoint callers answer the same for both flows (the result read
--     and the account export gate);
--   * the patched body carries its pinned successor and privileges.
-- Time is moved only by ageing each synthetic acceptance's own rows.
-- Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

\ir fixtures/path_b_source_setup.inc

-- Four more people with an account and a current declaration (05 to 08), and
-- a named permission-document reviewer in an MFA-stepped-up session.
insert into auth.users(id,email,raw_user_meta_data)
 select ('0b5e0000-0000-4000-8000-00000000000'||n)::uuid,'d154-'||n||'@e2e.local','{"display_name":"Synthetic person"}'
 from unnest(array['5','6','7','8']) n;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('0b5e0000-0000-4000-8000-00000000001'||n)::uuid,('0b5e0000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1'
 from unnest(array['5','6','7','8']) n;
update public.profiles p set date_of_birth=date '1990-01-01',jurisdiction_code='GB',jurisdiction_declared_at=clock_timestamp(),
 jurisdiction_attestation_version=a.version,jurisdiction_attestation_sha256=a.body_sha256
 from public.consent_artifacts a where a.artifact_key='attestation.jurisdiction' and a.superseded_at is null
  and p.id in ('0b5e0000-0000-4000-8000-000000000005','0b5e0000-0000-4000-8000-000000000006',
   '0b5e0000-0000-4000-8000-000000000007','0b5e0000-0000-4000-8000-000000000008');
update auth.users set created_at=now()-interval '1 day',email_confirmed_at=now()-interval '1 day'
 where id::text like '0b5e0000-%';
insert into auth.users(id,email,raw_user_meta_data)
 values('d1540000-0000-4000-8000-000000000003','d154-reviewer@e2e.local','{"display_name":"Synthetic reviewer"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 values('d1540000-0000-4000-8000-000000000013','d1540000-0000-4000-8000-000000000003',now(),now(),'aal2');
select private.grant_claim_reviewer_v1('d1540000-0000-4000-8000-000000000003');

-- Helpers ---------------------------------------------------------------------
create function pg_temp.m(p_name text,p_account text,p_checkpoint text default 'route-read-before-fetch') returns text
language sql as $$
 select (private.other_adult_mitigation_v1(pg_temp.sid(p_name),pg_temp.a(p_account),p_checkpoint)->>'decision')
  ||':'||coalesce(private.other_adult_mitigation_v1(pg_temp.sid(p_name),pg_temp.a(p_account),p_checkpoint)->>'gate','-')
$$;
-- Every checkpoint for one account, in checkpoint order.
create function pg_temp.at_each(p_name text,p_account text) returns text language sql as $$
 select string_agg(pg_temp.m(p_name,p_account,c),',' order by n) from unnest(array['purpose-grant-create','route-read-before-fetch',
  'model-context-before-retrieval','analysis-enqueue','worker-claim','source-read-and-every-bounded-range',
  'derived-write-and-read','export-create','export-source-read','download-session-create','every-download-chunk'])
  with ordinality c(c,n)
$$;
-- The distinct answers over every checkpoint, as the D-141 suite reads them.
create function pg_temp.all_checkpoints(p_name text,p_account text) returns text language sql as $$
 select string_agg(distinct pg_temp.m(p_name,p_account,c),',') from unnest(array['purpose-grant-create','route-read-before-fetch',
  'model-context-before-retrieval','analysis-enqueue','worker-claim','source-read-and-every-bounded-range',
  'derived-write-and-read','export-create','export-source-read','download-session-create','every-download-chunk']) c
$$;
create function pg_temp.inv(p_name text) returns uuid language sql as $$ select pg_temp.invitation_of(pg_temp.sid(p_name)) $$;
create function pg_temp.clock(p_name text,p_class text) returns text language sql as $$
 select coalesce((select r.state||':'||d.status from public.retention_rows r
  join public.retention_due_phases d on d.retention_row_id=r.id
  where r.retention_id=p_class and r.target_kind='invitation' and r.target_id=pg_temp.inv(p_name)),'none')
$$;
create function pg_temp.clocks(p_name text) returns text language sql as $$
 select pg_temp.clock(p_name,'adult.re-notice-30d')||' '||pg_temp.clock(p_name,'adult.acceptance-hold-72h') $$;
create function pg_temp.age(p_name text,p_by interval) returns void language sql as $$
 update public.subject_invitations set accepted_at=accepted_at-p_by,terminal_at=terminal_at-p_by where id=pg_temp.inv(p_name);
 update public.retention_rows set fixed_deadline=fixed_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv(p_name);
 update public.retention_due_phases set phase_deadline=phase_deadline-p_by where target_kind='invitation' and target_id=pg_temp.inv(p_name);
$$;
create function pg_temp.notices(p_name text,p_kind text) returns bigint language sql as $$
 select count(*) from private.invitation_terminal_notices where invitation_id=pg_temp.inv(p_name) and notice_kind=p_kind
$$;
-- The terminal mail worker, as src/lib/embryos/invitation-terminal-mail.ts
-- drives it: claim, authorize, complete. Every notice of one kind for this
-- suite's records is sent; the answer names those records, and a notice not
-- addressed to its record's own account stops it.
create function pg_temp.deliver_all(p_kind text) returns text language plpgsql as $$
declare c record; n integer; v_name text; v_sent text[]:='{}';
begin
 for n in 1..60 loop
  select * into c from public.claim_invitation_terminal_mail_v1();
  if c.outbox_id is null then exit; end if;
  select x.name into v_name from fx x join public.mail_outbox m on m.id=c.outbox_id and m.target_id=pg_temp.inv(x.name);
  if v_name is not null and c.notice_kind=p_kind then
   if c.recipient_account_id is distinct from (select subject_account_id from public.subjects where id=pg_temp.sid(v_name))
    or c.contact_ciphertext is not null then return 'wrong-recipient '||v_name; end if;
   if not public.authorize_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal) then return 'refused '||v_name; end if;
   perform public.complete_invitation_terminal_mail_v1(c.outbox_id,c.attempt_ordinal,true,
    encode(extensions.digest(convert_to('provider:'||c.outbox_id::text,'UTF8'),'sha256'),'hex'));
   v_sent:=v_sent||v_name;
  end if;
 end loop;
 return coalesce((select string_agg(x,' ' order by x) from unnest(v_sent) x),'none');
end $$;

-- The reviewed-document flow, through its real doors (20261016190000) ----------
create temporary table rd(name text primary key,session_id uuid,document_id uuid,review_id uuid);
create function pg_temp.jwt(p_account uuid,p_session uuid) returns void language sql volatile as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',p_account,'role','authenticated','aal','aal2',
  'session_id',p_session,'iss',(select auth_issuer from private.upload_authorization_config where singleton),
  'aud','authenticated','exp',floor(extract(epoch from clock_timestamp()))+3600,
  'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',floor(extract(epoch from clock_timestamp()))-60)))::text,true);
$$;
create function pg_temp.as_reviewer(p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform pg_temp.jwt('d1540000-0000-4000-8000-000000000003','d1540000-0000-4000-8000-000000000013');
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
-- A reviewed-document draft signed, its document uploaded, scanned, read in
-- full and approved by the named reviewer, finalized, and its request mail
-- claimed and opened by the person.
create function pg_temp.reviewed_requested(p_name text,p_letter text) returns uuid language plpgsql as $$
declare r jsonb; v_subject uuid; v_session uuid; v_document uuid; f jsonb; b jsonb; job jsonb; lease text; d jsonb; n integer;
 cookie text:=encode(extensions.digest('cookie:'||p_letter,'sha256'),'hex');
 review_cookie text:=encode(extensions.digest('review:'||p_letter,'sha256'),'hex');
begin
 r:=public.create_path_b_reviewed_document_draft_v1(pg_temp.a('1'),pg_temp.s('1'),'Synthetic Relative',date '1980-05-05',
  decode('00112233445566778899aabbccddeeff','hex'),repeat(p_letter,64),pg_temp.kd('request:'||p_name),true);
 v_subject:=(r->>'subjectDraftId')::uuid;
 insert into fx(name,subject_id) values(p_name,v_subject);
 perform pg_temp.present(v_subject,p_letter);
 perform pg_temp.sign(v_subject,p_letter);
 v_session:=(public.open_permission_document_session_v1(pg_temp.a('1'),pg_temp.s('1'),v_subject,'application/pdf',5,
  encode(extensions.digest('document:'||p_letter,'sha256'),'hex'),cookie,extensions.gen_random_bytes(72),
  encode(extensions.digest('nonce:'||p_letter,'sha256'),'hex'),true)->>'session')::uuid;
 perform public.reserve_claim_document_chunk_v1(v_session,cookie,0,5,encode(extensions.digest('chunk:'||p_letter,'sha256'),'hex'));
 perform public.settle_claim_document_chunk_v1(v_session,cookie,0,true);
 b:=public.begin_claim_document_completion_v1(v_session,cookie,encode(extensions.digest('complete:'||p_letter,'sha256'),'hex'),1);
 f:=public.finish_claim_document_completion_v1(v_session,cookie,encode(extensions.digest('complete:'||p_letter,'sha256'),'hex'),
  'composed',b->>'objectKey');
 v_document:=(f->>'documentId')::uuid;
 lease:=encode(extensions.digest('lease:'||p_letter,'sha256'),'hex');
 job:=public.claim_next_permission_document_scan_v1(lease);
 if (job->>'documentId')::uuid is distinct from v_document then raise exception 'scan claimed another document'; end if;
 perform public.record_permission_document_scan_v1(v_document,lease,'OK',job->>'sha256','test-double',1,clock_timestamp());
 perform private.assign_permission_document_review_v1(v_document,'d1540000-0000-4000-8000-000000000003');
 d:=pg_temp.as_reviewer(format('select public.open_claim_review_download_v1(%L::uuid,%L)',v_document,review_cookie));
 for n in 0..(d->>'chunkCount')::integer-1 loop
  perform pg_temp.as_reviewer(format('select public.authorize_claim_review_chunk_v1(%L::uuid,%L,%s)',d->>'session',review_cookie,n));
 end loop;
 if pg_temp.as_reviewer(format('select public.decide_permission_document_v1(%L::uuid,%L,%s,%L,%L,%L::bytea)',
   v_document,(select sha256 from private.permission_documents where id=v_document),1,'approved',
   encode(extensions.digest('decision:'||p_letter,'sha256'),'hex'),'\x'||repeat('cd',48)))->>'decision'<>'approved' then
  raise exception 'approval failed for %',p_name; end if;
 insert into rd values(p_name,v_session,v_document,(select x.id from private.permission_document_reviews x where x.document_id=v_document));
 if public.finalize_path_b_reviewed_document_v1(pg_temp.a('1'),pg_temp.s('1'),v_subject,v_document,
   (select review_id from rd where name=p_name),encode(extensions.digest('finalize:'||p_letter,'sha256'),'hex'),
   encode(extensions.digest('idem:'||p_letter,'sha256'),'hex'),true,jsonb_build_object('1',repeat(p_letter,64)),
   pg_temp.invitation_quota_keys())->>'status'<>'received' then raise exception 'finalize failed for %',p_name; end if;
 update fx set token_hash=pg_temp.claim_for(pg_temp.invitation_of(v_subject)) where name=p_name;
 if pg_temp.open_session((select token_hash from fx where name=p_name),p_letter,'acct-open-'||p_letter||'aaaaaaaaaaaaaaaa')<>1 then
  raise exception 'request setup failed for %',p_name; end if;
 return v_subject;
end $$;
-- The flow each record was made through, as the draft records it.
create function pg_temp.flow(p_name text) returns text language sql as $$
 select adult_flow||':'||state from public.adult_subject_drafts where subject_id=pg_temp.sid(p_name) $$;

-- 0. The migration ---------------------------------------------------------------
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text||' '||p.provolatile::text||' '||p.prosecdef::text
  ||' '||array_to_string(p.proconfig,',')
  from pg_proc p where p.oid='private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'::regprocedure),
 '85be478145319e0c69dad7575e262941 {postgres=X/postgres} s true search_path=pg_catalog',
 'the decision carries its pinned successor, STABLE SECURITY DEFINER with its pinned search path and privileges');

-- 1. Six acceptances: each flow with an account created after the request, with
-- an account that predates it, and with no account -------------------------------
select pg_temp.requested('es-new','c',repeat('c',64));
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('5');
select is(pg_temp.account_confirms('c','d154-sign-ccccccccccccccccccc','5',repeat('c',64)),'accepted',
 '(es-new) an e-signature request accepted by an account created after it');
select pg_temp.reviewed_requested('rd-new','d');
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('6');
select is(pg_temp.account_confirms('d','d154-sign-ddddddddddddddddddd','6',repeat('d',64)),'accepted',
 '(rd-new) a reviewed-document request accepted by an account created after it');
select pg_temp.requested('es-old','e',repeat('e',64));
select is(pg_temp.account_confirms('e','d154-sign-eeeeeeeeeeeeeeeeeee','7',repeat('e',64)),'accepted',
 '(es-old) an e-signature request accepted by an account that predates it');
select pg_temp.reviewed_requested('rd-old','f');
select is(pg_temp.account_confirms('f','d154-sign-fffffffffffffffffff','8',repeat('f',64)),'accepted',
 '(rd-old) a reviewed-document request accepted by an account that predates it');
select pg_temp.requested('es-none','a',repeat('a',64));
select is(pg_temp.token_confirms('a','d154-token-aaaaaaaaaaaaaaaaaa'),'accepted','(es-none) an e-signature request confirmed with no account');
select pg_temp.reviewed_requested('rd-none','b');
select is(pg_temp.token_confirms('b','d154-token-bbbbbbbbbbbbbbbbbb'),'accepted','(rd-none) a reviewed-document request confirmed with no account');
select is((select string_agg(x||'='||pg_temp.flow(x),' ' order by x)
  from unnest(array['es-new','rd-new','es-old','rd-old','es-none','rd-none']) x),
 'es-new=path-b-subject-esignature:confirmed es-none=path-b-subject-esignature:confirmed es-old=path-b-subject-esignature:confirmed '
 ||'rd-new=path-b-reviewed-document:confirmed rd-none=path-b-reviewed-document:confirmed rd-old=path-b-reviewed-document:confirmed',
 'each record is confirmed through its own flow');

-- 2. What each acceptance recorded (20261120120000) -----------------------------------
select is(pg_temp.clocks('rd-new')||' | '||pg_temp.clocks('es-new'),'scheduled:pending scheduled:pending | scheduled:pending scheduled:pending',
 '(rd-new) an account created after a reviewed-document request starts both clocks, as an e-signature one does');
select is(pg_temp.clocks('rd-old')||' | '||pg_temp.clocks('es-old'),'scheduled:pending none | scheduled:pending none',
 '(rd-old) an existing account starts the re-notice clock only, as for an e-signature one');
select is(pg_temp.clocks('rd-none')||' | '||pg_temp.clocks('es-none'),'none none | none none',
 '(rd-none) a confirmation with no account starts no clock, as for an e-signature one');
select is(public.adult_subject_acceptance_origin_v1(pg_temp.a('6'),pg_temp.sid('rd-new'))||' '||
 public.adult_subject_acceptance_origin_v1(pg_temp.a('8'),pg_temp.sid('rd-old')),'created_from_this_invitation existing_account',
 '(rd) each reviewed-document acceptance records its origin');

-- 3. D-154 as it was: the predecessor answered not-found -------------------------------
-- The body under test, and its predecessor rebuilt from it in place (the one
-- anchor of 20261122170000 reversed), each checked by its md5.
create temporary table bodies as
 select pg_get_functiondef('private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'::regprocedure) patched;
create function pg_temp.body(p_which text) returns text language plpgsql as $$
declare v_old constant text:=$old$  join public.adult_subject_drafts d on d.subject_id=i.target_id and d.adult_flow='path-b-subject-esignature'
   and d.state='confirmed'
$old$; v_new constant text:=$new$  -- 20261122170000 (D-154): a confirmed draft of either Path B flow, as the
  -- original download authority and the account export gate read them.
  join public.adult_subject_drafts d on d.subject_id=i.target_id
   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')
   and d.state='confirmed'
$new$;
begin
 if p_which='predecessor' then execute replace((select patched from bodies),v_new,v_old);
 else execute (select patched from bodies); end if;
 return md5(pg_get_functiondef('private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)'::regprocedure));
end $$;
select is(pg_temp.body('predecessor'),'91dfb6e4abf766e3da6e5827d4381daf','(predecessor) swapped in: the body 20261120120000 left');
select is(pg_temp.all_checkpoints('rd-new','1')||' | '||pg_temp.all_checkpoints('rd-new','6')||' | '||pg_temp.all_checkpoints('rd-old','1')
 ||' | '||pg_temp.all_checkpoints('rd-none','1'),'deny:not-found | deny:not-found | deny:not-found | deny:not-found',
 '(predecessor) D-154: every reviewed-document record answers not-found to its uploader and to its person at every checkpoint');
select is(pg_temp.all_checkpoints('es-new','1')||' | '||pg_temp.all_checkpoints('es-old','1'),
 'deny:adult.acceptance-hold-72h | allow:-','(predecessor) while the e-signature records answer the hold and the release');
select is(pg_temp.body('patched'),'85be478145319e0c69dad7575e262941','(patched) swapped back: the successor');

-- 4. Just accepted: the hold, and an existing account allowed ------------------------------
select is(pg_temp.all_checkpoints('rd-new','1'),'deny:adult.acceptance-hold-72h',
 '(rd-new) during the hold the uploader is denied at all eleven checkpoints');
select is(pg_temp.at_each('rd-new','1'),pg_temp.at_each('es-new','1'),'(rd-new) at each checkpoint, as for the e-signature record');
select is(pg_temp.at_each('rd-new','6'),
 'subject-own-right-only:-,deny:adult.acceptance-hold-72h,deny:adult.acceptance-hold-72h,deny:adult.acceptance-hold-72h,'
 ||'deny:adult.acceptance-hold-72h,deny:adult.acceptance-hold-72h,deny:adult.acceptance-hold-72h,subject-own-right-only:-,'
 ||'subject-own-right-only:-,subject-own-right-only:-,subject-own-right-only:-',
 '(rd-new) the person''s own analysis and derived reads wait out the hold, their own rights never do');
select is(pg_temp.at_each('rd-new','6'),pg_temp.at_each('es-new','5'),'(rd-new) the person, as the e-signature record''s person');
select is(pg_temp.all_checkpoints('rd-new','9')||' '||pg_temp.all_checkpoints('rd-new','8'),'deny:not-found deny:not-found',
 '(rd-new) anyone else, another person included, is not found');
select is(pg_temp.all_checkpoints('rd-old','1'),'allow:-','(rd-old) an existing account''s uploader is allowed at all eleven checkpoints');
select is(pg_temp.at_each('rd-old','1')||' | '||pg_temp.at_each('rd-old','8'),pg_temp.at_each('es-old','1')||' | '||pg_temp.at_each('es-old','7'),
 '(rd-old) uploader and person, as for the e-signature record');
-- The checkpoint callers answer for the reviewed-document record as for the other.
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('rd-new'),'reports.monogenic')->>'gate',
 'adult.acceptance-hold-72h','(rd-new) route-read-before-fetch: the uploader''s result read stops at the hold, not at not-found');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('rd-old'),'reports.monogenic')->>'gate',
 private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('es-old'),'reports.monogenic')->>'gate',
 '(rd-old) the uploader''s result read stops where the e-signature record''s does');
select throws_ok($$select private.account_archive_other_adult_export_gate_v1(pg_temp.sid('rd-new'),pg_temp.a('1'))$$,
 '42501','not_found','(rd-new) export-create: the uploader''s account export leaves the record out during the hold');
select is(private.account_archive_other_adult_export_gate_v1(pg_temp.sid('rd-old'),pg_temp.a('1'))->>'path',
 'path-b','(rd-old) export-create: an existing account''s record is in the uploader''s account export, now that the decision allows it');

-- 5. No account: the 730-day clock and the 30-day boundary -----------------------------------
select is(pg_temp.all_checkpoints('rd-none','1')||' | '||pg_temp.all_checkpoints('es-none','1'),
 'deny:adult.non-account-holder-24mo | deny:adult.non-account-holder-24mo',
 '(rd-none) with no confirmed file there is no live 730-day clock: denied, as for the e-signature record');
select is((select h->>'status' from (select pg_temp.hold('rd-none',pg_temp.sid('rd-none'),repeat('d',64)) h) x)||' '||
 (select h->>'status' from (select pg_temp.hold('es-none',pg_temp.sid('es-none'),repeat('c',64)) h) x),
 'stored_quarantined stored_quarantined','(none) the uploader holds a file for each');
select is(pg_temp.notice_session('rd-none','1'),1::bigint,'(rd-none) the file''s notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'d154-confirm-1111111111111111','confirm'),'confirmed',
 '(rd-none) the person says yes with no account');
select is(pg_temp.notice_session('es-none','2'),1::bigint,'(es-none) the file''s notice opens a session');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'d154-confirm-2222222222222222','confirm'),'confirmed',
 '(es-none) the person says yes with no account');
select is(pg_temp.all_checkpoints('rd-none','1')||' | '||pg_temp.all_checkpoints('es-none','1'),'allow:- | allow:-',
 '(rd-none) with a live 730-day clock and inside 30 days the uploader is allowed, as for the e-signature record');
select is(pg_temp.all_checkpoints('rd-none','9'),'deny:not-found','(rd-none) anyone else is not found');

-- 6. 72 hours: the second notice, and the release ---------------------------------------------
select pg_temp.age(x,interval '72 hours') from unnest(array['rd-new','es-new']) x;
select is(pg_temp.m('rd-new','1','analysis-enqueue')||' '||pg_temp.m('es-new','1','analysis-enqueue'),
 'deny:adult.acceptance-hold-72h deny:adult.acceptance-hold-72h','(72 h) before the second notice both are still held');
select ok(public.run_due_adult_acceptance_notices_v1()>=2,'(72 h) the executor queues the second notices');
select is(pg_temp.notices('rd-new','adult-acceptance-second-notice')||' '||pg_temp.notices('es-new','adult-acceptance-second-notice'),
 '1 1','(72 h) exactly one second notice for each');
select is((select recipient_kind||' '||(recipient_account_id=pg_temp.a('6'))::text||' '||(contact_ciphertext is null)::text
  from private.invitation_terminal_notices where invitation_id=pg_temp.inv('rd-new')),
 'account true true','(rd-new) addressed to the person''s account; no contact is copied');
select is(pg_temp.at_each('rd-new','1'),pg_temp.at_each('es-new','1'),'(72 h) queued but not accepted: still held, as the other');
select is(pg_temp.deliver_all('adult-acceptance-second-notice'),'es-new rd-new',
 '(72 h) the worker sends each to its person''s account, the reviewed-document one included');
select is(pg_temp.all_checkpoints('rd-new','1'),'allow:-','(rd-new) released: the uploader is allowed at all eleven checkpoints');
select is(pg_temp.at_each('rd-new','1')||' | '||pg_temp.at_each('rd-new','6'),pg_temp.at_each('es-new','1')||' | '||pg_temp.at_each('es-new','5'),
 '(rd-new) uploader and person, released as for the e-signature record');
select is(private.path_b_result_read_v1(pg_temp.a('1'),pg_temp.sid('rd-new'),'reports.monogenic')->>'gate',
 'directional-purpose-grant-v1','(rd-new) the uploader''s read now stops only at the person''s own grant');

-- 7. 30 days: the re-notice, and its release -----------------------------------------------
select pg_temp.age(x,interval '30 days'-interval '72 hours') from unnest(array['rd-new','es-new']) x;
select pg_temp.age(x,interval '30 days') from unnest(array['rd-old','es-old','rd-none','es-none']) x;
select is(pg_temp.all_checkpoints('rd-new','1')||' | '||pg_temp.all_checkpoints('rd-old','1')||' | '||pg_temp.all_checkpoints('rd-none','1'),
 'deny:adult.re-notice-30d | deny:adult.re-notice-30d | deny:adult.re-notice-30d',
 '(30 d) from 30 days every reviewed-document uploader is denied adult.re-notice-30d');
select is(pg_temp.at_each('rd-new','1')||' | '||pg_temp.at_each('rd-old','1')||' | '||pg_temp.at_each('rd-none','1')
 ||' | '||pg_temp.at_each('rd-old','8'),
 pg_temp.at_each('es-new','1')||' | '||pg_temp.at_each('es-old','1')||' | '||pg_temp.at_each('es-none','1')||' | '||pg_temp.at_each('es-old','7'),
 '(30 d) at each checkpoint, uploader and person, as for the e-signature records');
select ok(public.run_due_adult_acceptance_notices_v1()>=4,'(30 d) the executor queues the reminders');
select is(pg_temp.deliver_all('adult-revocation-renotice'),'es-new es-old rd-new rd-old',
 '(30 d) each reminder is sent to its person''s account, the two reviewed-document ones included');
select is(pg_temp.all_checkpoints('rd-new','1')||' | '||pg_temp.all_checkpoints('rd-old','1'),'allow:- | allow:-',
 '(reminded) the reviewed-document uploaders are allowed again');
select is(pg_temp.at_each('rd-new','1')||' | '||pg_temp.at_each('rd-old','1')||' | '||pg_temp.at_each('rd-none','1'),
 pg_temp.at_each('es-new','1')||' | '||pg_temp.at_each('es-old','1')||' | '||pg_temp.at_each('es-none','1'),
 '(reminded) as the e-signature ones; with no account there is no reminder, and both stay denied');
select is(pg_temp.all_checkpoints('rd-none','1'),'deny:adult.re-notice-30d','(rd-none) no reminder is built with no account');

select * from finish();
rollback;
