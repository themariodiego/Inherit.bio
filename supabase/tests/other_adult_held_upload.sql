-- Another adult's genome, held apart until that adult answers
-- (20260928150000_other_adult_held_upload.sql; G2.6 adult half, G5.3).
--
-- Proves, on synthetic rows only, that:
--   * the draft artifact installs only under TEST-LOCAL and only as the exact
--     pinned text, and is signable only under TEST-LOCAL;
--   * the uploader cannot issue, store or finalize without that signature;
--   * a held source has no genome_files row and is unreadable by every
--     subject- or file-scoped reader function, for every account;
--   * acceptance releases it to the accepting account's own self subject,
--     where that account's own consents make it readable and the uploader
--     still cannot read it;
--   * refusal, deletion, expiry and the uploader's account deletion reject
--     it, and the existing upload-working executor purges its objects and rows.
-- Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- claim_mail_outbox hands out the oldest deliverable row; retire any queued
-- mail on a shared developer database so every claim below is this suite's.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=52428800,
 maximum_account_bytes=1073741824,maximum_active_uploads=32 where singleton;

insert into auth.users(id,email,raw_user_meta_data) values
 ('0a5e0000-0000-4000-8000-000000000001','held-uploader@e2e.local','{"display_name":"Synthetic uploader"}'),
 ('0a5e0000-0000-4000-8000-000000000002','held-subject@e2e.local','{"display_name":"Synthetic subject"}'),
 ('0a5e0000-0000-4000-8000-000000000003','held-refuser@e2e.local','{"display_name":"Synthetic refuser"}'),
 ('0a5e0000-0000-4000-8000-000000000009','held-outsider@e2e.local','{"display_name":"Synthetic outsider"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('0a5e0000-0000-4000-8000-000000000011','0a5e0000-0000-4000-8000-000000000001',now(),now(),'aal1'),
 ('0a5e0000-0000-4000-8000-000000000012','0a5e0000-0000-4000-8000-000000000002',now(),now(),'aal1'),
 ('0a5e0000-0000-4000-8000-000000000019','0a5e0000-0000-4000-8000-000000000009',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id in
 ('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000009');

-- 1. The draft artifact ------------------------------------------------------
create temporary table draft_text as select
 $artifact$What this consent is:

You ask Inherit to hold a DNA file that belongs to another adult. You have their permission, and Inherit has invited them by email to say yes or no.

We cannot verify who you are or whose DNA this is. What we can do is make it impossible to do this by accident, keep a permanent record of exactly what you told us, and give the other person a real way to stop it.

We cannot check that the person accepting this invitation is the person whose DNA this is.

What happens to the file:

The file is held apart until the other person answers. Inherit does not read it to make a result, a report, an ancestry estimate or a Copilot answer. Nobody can open it, including you.

If they accept in their own account, the file moves to their account. From then on it is theirs, and only their own choices apply to it. Nothing is analysed until they choose.

If they refuse, delete the invitation, or do not answer within 30 days, Inherit deletes the file. Nothing is analysed.

You will not see their results. They can choose to share results with you later, one purpose at a time, and they can stop at any time.

What you confirm:

1. The person whose DNA this is is alive and 18 or older.

2. They gave me permission to upload their DNA to Inherit, and I can show that permission if asked.

3. I got this file lawfully, and they know I have it.

4. The email address I gave belongs to them.

5. They are not my employee, job applicant, tenant or student, they are not applying to me for insurance, and I am not in a legal case against them.

6. I understand that nothing is analysed until they accept, and that the file is deleted if they refuse or do not answer within 30 days.

7. I understand that I will not see their results unless they choose to share them with me.

How you sign:

You sign by ticking each statement and typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.$artifact$::text as body,
 $summary$You ask Inherit to hold another adult's DNA file until they answer. Nobody can read it and nothing is analysed until they accept in their own account. If they refuse, or do not answer within 30 days, the file is deleted. You will not see their results unless they choose to share them. Signing this when it is not true may be a crime.$summary$::text as summary;
grant select on draft_text to service_role;

select is((select count(*) from public.consent_artifacts where artifact_key='consent.upload-other-adult'),0::bigint,
 'no migration seeds the unapproved draft artifact');
select throws_ok($$select public.install_test_local_other_adult_artifact_v1(
 (select body from draft_text),(select summary from draft_text),date '2026-09-28',false)$$,
 '42501','not_found','the draft installs only under TEST-LOCAL');
select throws_ok($$select public.install_test_local_other_adult_artifact_v1(
 (select body from draft_text)||' ',(select summary from draft_text),date '2026-09-28',true)$$,
 '22023','invalid_request','the installer accepts only the exact pinned body');
select throws_ok($$select public.install_test_local_other_adult_artifact_v1(
 (select body from draft_text),(select summary from draft_text)||' ',date '2026-09-28',true)$$,
 '22023','invalid_request','the installer accepts only the exact pinned summary');
select is(public.install_test_local_other_adult_artifact_v1(
 (select body from draft_text),(select summary from draft_text),date '2026-09-28',true),true,
 'under TEST-LOCAL the exact draft installs');
select is(public.install_test_local_other_adult_artifact_v1(
 (select body from draft_text),(select summary from draft_text),date '2026-09-28',true),true,
 'a second install is a no-op on the identical row');
select is((select body_sha256=encode(extensions.digest(convert_to(body_markdown,'UTF8'),'sha256'),'hex')
 from public.consent_artifacts where artifact_key='consent.upload-other-adult' and version=1),true,
 'the installed artifact is hash-verified');

-- 2. Fixtures: invitations, their mailed tokens, and helpers -----------------
create temporary table fx(name text primary key, subject_id uuid, invitation_id uuid, token_hash text);
grant all on fx to service_role;
create function pg_temp.invite(p_name text,p_hmac text,p_idem text) returns void language plpgsql as $$
declare i record; d record;
begin
 select * into i from public.create_adult_subject_invitation_v1('0a5e0000-0000-4000-8000-000000000001',
  decode('00112233445566778899aabbccddeeff','hex'),p_hmac,p_idem,true);
 select * into d from public.claim_mail_outbox();
 insert into fx values(p_name,i.subject_id,i.invitation_id,
  encode(extensions.digest(convert_to(d.delivery_token,'UTF8'),'sha256'),'hex'));
end;
$$;
select pg_temp.invite('accept',repeat('1',64),repeat('5',64));
select pg_temp.invite('refuse',repeat('2',64),repeat('6',64));
select pg_temp.invite('expire',repeat('3',64),repeat('7',64));
select pg_temp.invite('legacy',repeat('4',64),repeat('8',64));
select pg_temp.invite('withdraw',repeat('0',64),repeat('9',64));
select is((select count(distinct token_hash) from fx),5::bigint,'each reservation has its own mailed token');

create function pg_temp.sid(p_name text) returns uuid language sql as $$ select subject_id from fx where name=p_name $$;
create function pg_temp.present(p_name text,p_nonce text,p_flag boolean default true) returns jsonb language sql as $$
 select public.present_other_adult_upload_artifact_v1('0a5e0000-0000-4000-8000-000000000001',
  '0a5e0000-0000-4000-8000-000000000011',pg_temp.sid(p_name),repeat(p_nonce,64),clock_timestamp()+interval '9 minutes',p_flag);
$$;
create function pg_temp.sign(p_name text,p_nonce text,p_keys text[] default array['subject-alive-and-adult',
 'subject-permission-held','lawfully-held-with-knowledge','contact-belongs-to-subject','no-excluded-relationship',
 'held-until-accepted','no-uploader-access'],p_flag boolean default true) returns jsonb language sql as $$
 select public.sign_other_adult_upload_artifact_v1('0a5e0000-0000-4000-8000-000000000001',
  '0a5e0000-0000-4000-8000-000000000011',pg_temp.sid(p_name),1,
  (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-other-adult' and version=1),
  p_keys,decode(repeat('ab',24),'hex'),repeat(p_nonce,64),p_flag);
$$;
create function pg_temp.issue(p_name text,p_hash text,p_flag boolean default true,
 p_account uuid default '0a5e0000-0000-4000-8000-000000000001',p_session uuid default '0a5e0000-0000-4000-8000-000000000011')
returns jsonb language sql as $$
 select public.issue_other_adult_held_upload_v1(p_account,p_session,pg_temp.sid(p_name),'VCF',8,p_hash,p_flag);
$$;
-- The whole transport for one issued lease: the Storage write, finalization
-- and completion, exactly as the service route drives them.
create temporary table held_fx(name text primary key, upload_id uuid, staging text, final_name text, object_id uuid, raw text);
grant all on held_fx to service_role;
create function pg_temp.hold(p_name text,p_hash text) returns jsonb language plpgsql as $$
declare r jsonb; m jsonb; v_object uuid:=gen_random_uuid(); v_result jsonb;
begin
 r:=pg_temp.issue(p_name,p_hash);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('genomes',r->>'stagingKey','0a5e0000-0000-4000-8000-000000000001','{"size":8}');
 m:=public.begin_own_upload_finalization_v2('0a5e0000-0000-4000-8000-000000000001',
  '0a5e0000-0000-4000-8000-000000000011',(r->>'uploadId')::uuid);
 insert into storage.objects(id,bucket_id,name,metadata) values(v_object,'genomes',m->>'finalKey','{"size":8}');
 perform set_config('role','postgres',true);
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='genomes' and name=r->>'stagingKey';
 perform set_config('role','service_role',true);
 v_result:=public.complete_own_upload_finalization_v1('0a5e0000-0000-4000-8000-000000000001',
  '0a5e0000-0000-4000-8000-000000000011',(r->>'uploadId')::uuid,(m->>'claim')::uuid,v_object,p_hash,repeat('b',64));
 perform set_config('role','postgres',true);
 insert into held_fx values(p_name,(r->>'uploadId')::uuid,r->>'stagingKey',m->>'finalKey',v_object,p_hash);
 return v_result;
end;
$$;

-- 3. No signature, no upload -------------------------------------------------
select throws_ok($$select pg_temp.issue('accept',repeat('e',64))$$,'55000','upload_consent_required',
 'without the signed draft artifact the uploader cannot open an upload');
select throws_ok($$select pg_temp.present('accept','c',false)$$,'42501','not_found',
 'the artifact is presented only under TEST-LOCAL');
select throws_ok($$select public.present_other_adult_upload_artifact_v1('0a5e0000-0000-4000-8000-000000000009',
 '0a5e0000-0000-4000-8000-000000000019',pg_temp.sid('accept'),repeat('c',64),clock_timestamp()+interval '9 minutes',true)$$,
 '42501','not_found','another account cannot sign for this reservation');
select is((select p->>'artifactKey' from (select pg_temp.present('accept','c') p) x),'consent.upload-other-adult',
 'the uploader is presented the current draft artifact');
select throws_ok($$select pg_temp.sign('accept','c',array['subject-alive-and-adult'])$$,'22023','invalid_request',
 'every published statement must be affirmed, one by one');
select throws_ok($$select pg_temp.sign('accept','c',p_flag=>false)$$,'42501','not_found',
 'the draft artifact is signable only under TEST-LOCAL');
select throws_ok($$select pg_temp.sign('accept','d')$$,'42501','not_found',
 'a signature needs a nonce the server presented');
select is((select s->>'recordKind' from (select pg_temp.sign('accept','c') s) x),'artifact_signature',
 'the uploader signs the draft artifact for this exact reservation');
select throws_ok($$select pg_temp.sign('accept','c')$$,'42501','not_found','a presented nonce signs once');
select ok((select cs.purpose='other-adult-upload' and cs.signing_name_encrypted is not null and cs.target_id=pg_temp.sid('accept')
 and cs.signer_account_id='0a5e0000-0000-4000-8000-000000000001'
 from public.consent_signatures cs where cs.artifact_key='consent.upload-other-adult'),
 'the signature records the uploader, the reservation and an encrypted typed name');
select is((select count(*) from public.subject_consents where subject_id=pg_temp.sid('accept')
 and account_id='0a5e0000-0000-4000-8000-000000000001' and consent_type='upload_class' and revoked_at is null),1::bigint,
 'one live store consent for the uploader on this reservation');
select throws_ok($$select pg_temp.issue('accept',repeat('e',64),false)$$,'42501','not_found',
 'the held-upload branch is closed outside TEST-LOCAL');
select throws_ok($$select pg_temp.issue('accept',repeat('e',64),true,'0a5e0000-0000-4000-8000-000000000009',
 '0a5e0000-0000-4000-8000-000000000019')$$,'42501','not_found','another account cannot upload for this reservation');
select throws_ok($$select public.issue_own_storage_upload_v1('0a5e0000-0000-4000-8000-000000000001',
 '0a5e0000-0000-4000-8000-000000000011',pg_temp.sid('accept'),'VCF',8,repeat('e',64))$$,'42501','not_found',
 'the own-subject issuer still refuses the uploader for another adult''s reservation');

-- 4. Upload and hold ---------------------------------------------------------
select is((select h->>'status' from (select pg_temp.hold('accept',repeat('e',64)) h) x),'stored_quarantined',
 'the finished upload is stored as quarantined');
create function pg_temp.fxv(p_name text,p_field text) returns text language sql as $$
 select case p_field when 'upload' then upload_id::text when 'final' then final_name when 'object' then object_id::text
  when 'raw' then raw when 'staging' then staging end from held_fx where name=p_name
$$;
select ok((select status='held' and finalized_file_id is null and consumed_at is null and upload_authority_kind='other-adult-held'
 from public.upload_sessions where id=pg_temp.fxv('accept','upload')::uuid),'the session is held, with no file');
select ok((select state='held' and uploader_account_id='0a5e0000-0000-4000-8000-000000000001'
 and fixed_deadline<=(select expires_at from public.subject_invitations where id=h.invitation_id)
 and fixed_deadline<=held_at+interval '30 days'
 from public.other_adult_held_uploads h where upload_session_id=pg_temp.fxv('accept','upload')::uuid),
 'the held row is clamped to the earlier of 30 days and the invitation deadline');
select ok((select d.status='pending' and d.phase_deadline=h.fixed_deadline from public.retention_due_phases d
 join public.other_adult_held_uploads h on h.upload_session_id=d.target_id
 where d.retention_id='adult.unconfirmed-30d' and d.phase_id='adult-unconfirmed-source-expiry'
  and d.target_id=pg_temp.fxv('accept','upload')::uuid),'adult.unconfirmed-30d is scheduled at the fixed deadline');
select throws_ok($$select pg_temp.issue('accept',repeat('f',64))$$,'55000','upload_unavailable',
 'one held upload per reservation');
select is(public.begin_own_upload_finalization_v2('0a5e0000-0000-4000-8000-000000000001',
 '0a5e0000-0000-4000-8000-000000000011',pg_temp.fxv('accept','upload')::uuid),
 jsonb_build_object('status','held','uploadId',pg_temp.fxv('accept','upload')::uuid),
 'finalizing again only reports that the file is held');

-- 5. Quarantined: unreadable by every reader --------------------------------
select is((select count(*) from public.genome_files where bucket_path=pg_temp.fxv('accept','final')
 or storage_object_id=pg_temp.fxv('accept','object')::uuid or sha256=pg_temp.fxv('accept','raw')),0::bigint,
 'a held source has no genome_files row, so no file reader can address it');
select is((select count(*) from public.genome_storage_objects where object_id=pg_temp.fxv('accept','object')::uuid
 or object_name=pg_temp.fxv('accept','final')),0::bigint,'nor any genome_storage_objects row');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('accept')),0::bigint,'no job exists for it');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('accept')),0::bigint,
 'no analytic purpose exists for it');
-- Only the lifecycle functions name the held table, and none of them is a reader.
select is((select string_agg(n.nspname||'.'||p.proname,', ' order by n.nspname,p.proname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prosrc like '%other_adult_held_uploads%'),
 'private.adult_subject_invitation_response_v1, private.complete_own_upload_finalization_v1, private.end_other_adult_held_uploads_v1, private.other_adult_upload_targets_v1, private.release_other_adult_held_uploads_v1, public.expire_due_other_adult_held_uploads_v1',
 'the held table is named only by the lifecycle functions');
select is((select jsonb_agg(k order by k) from (select distinct jsonb_object_keys(t) k from jsonb_array_elements(
 public.other_adult_upload_targets_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',true)) t) x),
 '["answerBy","deleteBy","heldAt","invitedAt","label","state","subjectId"]'::jsonb,
 'the uploader''s view carries states and dates only, never an object, hash or address');
select is(public.other_adult_upload_targets_v1('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',false),
 '[]'::jsonb,'outside TEST-LOCAL the uploader sees no reservation');

-- Every account-and-session function (the reader family: its first two
-- arguments are an account and its session, its third a uuid target) is
-- called by every account in this suite against the reservation, the
-- uploader's own subject and every held identifier. Each either refuses or
-- returns nothing that names the held source: not its object, its object id,
-- its hash or its session. The set comes from the catalogue, so a reader
-- added later is probed too. Each call runs in a subtransaction that is
-- always rolled back, so a writer in the family changes nothing.
create temporary table reader_calls(fn text, args text, outcome text);
create function pg_temp.probe(p_account uuid,p_session uuid,p_target uuid) returns void language plpgsql as $$
declare f record; v_sql text; v_out text; v_rest text; v_needles text[]; v_done boolean;
begin
 v_needles:=array[pg_temp.fxv('accept','final'),pg_temp.fxv('accept','object'),pg_temp.fxv('accept','raw'),
  pg_temp.fxv('accept','upload'),pg_temp.fxv('accept','staging')];
 for f in select p.oid,n.nspname,p.proname,p.proargtypes
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f' and p.pronargs>=3
   and (p.proargnames)[1] in ('p_account_id','p_account') and (p.proargnames)[2] in ('p_session_id','p_session')
   and p.proargtypes[0]='uuid'::regtype and p.proargtypes[1]='uuid'::regtype and p.proargtypes[2]='uuid'::regtype
  order by 2,3
 loop
  select string_agg(format('null::%s',format_type(t,null)),',' order by o) into v_rest
   from unnest(f.proargtypes::oid[]) with ordinality u(t,o) where o>3;
  v_sql:=format('select coalesce(string_agg(r::text,%L),%L) from %I.%I(%L::uuid,%L::uuid,%L::uuid%s) r',',','',
   f.nspname,f.proname,p_account,p_session,p_target,coalesce(','||v_rest,''));
  v_out:=null; v_done:=false;
  begin
   execute v_sql into v_out;
   v_done:=true;
   raise exception using errcode='P0001',message='probe_rollback';
  exception when others then
   insert into reader_calls values(f.nspname||'.'||f.proname,p_account||'/'||p_target,
    case when not v_done then 'refused'
     when exists(select 1 from unnest(v_needles) x where x is not null and x<>p_target::text
      and position(x in coalesce(v_out,''))>0) then 'LEAKED'
     else 'returned-nothing-held' end);
  end;
 end loop;
end;
$$;
select pg_temp.probe('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',pg_temp.sid('accept'));
select pg_temp.probe('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',
 (select id from public.subjects where subject_account_id='0a5e0000-0000-4000-8000-000000000001' and subject_class='self'));
select pg_temp.probe('0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000012',pg_temp.sid('accept'));
select pg_temp.probe('0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000012',
 (select id from public.subjects where subject_account_id='0a5e0000-0000-4000-8000-000000000002' and subject_class='self'));
select pg_temp.probe('0a5e0000-0000-4000-8000-000000000009','0a5e0000-0000-4000-8000-000000000019',pg_temp.sid('accept'));
select pg_temp.probe('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',pg_temp.fxv('accept','upload')::uuid);
select pg_temp.probe('0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',pg_temp.fxv('accept','object')::uuid);
select pg_temp.probe('0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000012',pg_temp.fxv('accept','object')::uuid);
select cmp_ok((select count(distinct fn) from reader_calls),'>=',100::bigint,
 'the reader probe discovered the whole account-and-session function family');
select is((select coalesce(string_agg(distinct fn,', '),'') from reader_calls where outcome='LEAKED'),'',
 'quarantined source is unreadable by every reader function');
select is((select count(*) from reader_calls where fn in ('private.own_upload_store_authority_v1','private.own_upload_context_v1')
 and args='0a5e0000-0000-4000-8000-000000000001/'||pg_temp.sid('accept')::text and outcome='refused'),2::bigint,
 'the own-subject authority itself refuses the uploader for the reservation');
-- The account-wide export list, which is not subject-scoped, sees nothing held either.
select is(position(pg_temp.fxv('accept','final') in public.own_subject_export_content_v1('list',
 '0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011')::text),0,
 'the uploader''s export lists nothing held');

-- 6. Recipient review closes the upload window -------------------------------
select is((select count(*) from public.activate_rights_session_v1(
 (select token_hash from fx where name='accept'),repeat('d',64),'held-session-open-aaaaaaaaaaa')),1::bigint,
 'the invitee opens the mailed invitation');
select throws_ok($$select pg_temp.present('accept','e')$$,'55000','recipient_reviewing',
 'once the invitee is reviewing, the uploader cannot sign or add anything');
select is((select t->>'state' from jsonb_array_elements(public.other_adult_upload_targets_v1(
 '0a5e0000-0000-4000-8000-000000000001','0a5e0000-0000-4000-8000-000000000011',true)) t
 where t->>'subjectId'=pg_temp.sid('accept')::text),'held','the uploader sees one line: held');

-- 7. Acceptance releases the file to the subject's own account ---------------
select is(public.respond_adult_subject_invitation_session_v1(repeat('d',64),'confirm','held-session-accept-aaaaaaaaa',
 '0a5e0000-0000-4000-8000-000000000002',repeat('1',64)),'accepted','the invitee accepts in their own account');
create temporary table released as select h.*, f.user_id, f.subject_id as file_subject_id, f.sha256, f.source_sha256,
 f.status as file_status, f.single_logical_sample_verified_at, f.bucket_path, f.storage_object_id as file_object_id
 from public.other_adult_held_uploads h join public.genome_files f on f.id=h.released_file_id
 where h.upload_session_id=pg_temp.fxv('accept','upload')::uuid;
grant select on released to service_role;
select is((select count(*) from released),1::bigint,'the held file is released as one genome file');
select ok((select state='released' and released_account_id='0a5e0000-0000-4000-8000-000000000002'
 and user_id='0a5e0000-0000-4000-8000-000000000002'
 and file_subject_id=(select id from public.subjects where subject_account_id='0a5e0000-0000-4000-8000-000000000002' and subject_class='self')
 and sha256=pg_temp.fxv('accept','raw') and source_sha256=repeat('b',64) and file_status='uploaded'
 and single_logical_sample_verified_at is not null and bucket_path=pg_temp.fxv('accept','final')
 and file_object_id=pg_temp.fxv('accept','object')::uuid from released),
 'it becomes the subject''s own unprepared file, with the evidence finalization proved');
select ok((select status='promoted' and finalized_file_id=(select released_file_id from released)
 from public.upload_sessions where id=pg_temp.fxv('accept','upload')::uuid),'the upload session is promoted to that file');
select is((select string_agg(retention_id||':'||status||':'||coalesce(terminal_outcome_code,''),', ' order by retention_id)
 from public.retention_due_phases where target_id=pg_temp.fxv('accept','upload')::uuid),
 'adult.unconfirmed-30d:cancelled:subject_confirmed, upload.staging-2h:cancelled:immutable_file_published',
 'both clocks end: the source is confirmed and published');
select is((select count(*) from public.worker_jobs where file_id=(select released_file_id from released)),0::bigint,
 'release enqueues nothing');
select is((select count(*) from public.purpose_grants where target_id in (pg_temp.sid('accept'),
 (select file_subject_id from released))),0::bigint,'release grants no analytic purpose');
select is((select count(*) from public.genome_files where user_id='0a5e0000-0000-4000-8000-000000000001'),0::bigint,
 'the uploader holds no file');
-- Readable, by the subject and only by the subject, under the subject's own consent.
create temporary table subject_ctx as select public.own_upload_context_v1('0a5e0000-0000-4000-8000-000000000002',
 '0a5e0000-0000-4000-8000-000000000012',(select file_subject_id from released)) c;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000012',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['7','8']) letter;
create function pg_temp.sign_own(p_key text,p_keys text[],p_nonce text) returns jsonb language sql as $$
 select public.sign_own_upload_artifact_v1('0a5e0000-0000-4000-8000-000000000002','0a5e0000-0000-4000-8000-000000000012',
  (select file_subject_id from released),p_key,1,
  (select body_sha256 from public.consent_artifacts where artifact_key=p_key and version=1),p_keys,
  (select (c->>'accountRevision')::bigint from subject_ctx),(select (c->>'authSessionRevision')::bigint from subject_ctx),
  (select (c->>'jurisdictionRevision')::bigint from subject_ctx),(select (c->>'subjectBindingRevision')::bigint from subject_ctx),
  (select (c->>'accountBindingRevision')::bigint from subject_ctx),repeat(p_nonce,64));
$$;
select throws_ok($$select private.own_upload_normalization_v1('begin','0a5e0000-0000-4000-8000-000000000002',
 '0a5e0000-0000-4000-8000-000000000012',(select released_file_id from released),null,null)$$,'55000',
 'insurance_acknowledgement_required','before the subject''s own consent, even the subject cannot prepare it');
select lives_ok($$select pg_temp.sign_own('disclosure.insurance-and-discrimination',array['understood'],'7')$$,
 'the subject acknowledges the insurance disclosure');
select lives_ok($$select pg_temp.sign_own('consent.upload-self',array['own-adult-dna'],'8')$$,
 'the subject signs their own upload consent');
select is((select m->>'status' from (select private.own_upload_normalization_v1('begin','0a5e0000-0000-4000-8000-000000000002',
 '0a5e0000-0000-4000-8000-000000000012',(select released_file_id from released),null,null) m) x),'authorized',
 'confirmed: the subject''s own preparation may now read the source');
select throws_ok($$select private.own_upload_normalization_v1('begin','0a5e0000-0000-4000-8000-000000000001',
 '0a5e0000-0000-4000-8000-000000000011',(select released_file_id from released),null,null)$$,'42501','not_found',
 'the uploader still cannot read it');

-- 8. Refusal: rejected at once, then purged by the upload-working executor -----
select lives_ok($$select pg_temp.present('refuse','9')$$,'(refuse) presented');
select lives_ok($$select pg_temp.sign('refuse','9')$$,'(refuse) signed');
select is((select h->>'status' from (select pg_temp.hold('refuse',repeat('a',64)) h) x),'stored_quarantined','(refuse) held');
select is((select count(*) from public.activate_rights_session_v1(
 (select token_hash from fx where name='refuse'),repeat('6',64),'held-session-open-bbbbbbbbbbb')),1::bigint,'(refuse) opened');
select is(public.respond_adult_subject_invitation_session_v1(repeat('6',64),'refuse','held-session-refuse-aaaaaaaaa'),
 'refused','the invitee refuses without an account');
select ok((select state='refused' and terminal_at is not null from public.other_adult_held_uploads
 where upload_session_id=pg_temp.fxv('refuse','upload')::uuid),'the held file is refused in the same transaction');
select ok((select status='rejected' and consumed_at is not null and finalization_cleanup_pending and expires_at<=clock_timestamp()
 from public.upload_sessions where id=pg_temp.fxv('refuse','upload')::uuid),'its session is rejected and due now');
select is((select status||':'||terminal_outcome_code from public.retention_due_phases
 where retention_id='adult.unconfirmed-30d' and target_id=pg_temp.fxv('refuse','upload')::uuid),
 'cancelled:subject_refused','its adult.unconfirmed-30d clock ends as refused');
create function pg_temp.claim_for(p_upload uuid) returns jsonb language plpgsql as $$
declare c jsonb; i integer;
begin
 for i in 1..200 loop
  c:=public.claim_own_upload_purge_v1(encode(extensions.digest(convert_to(p_upload::text||i,'UTF8'),'sha256'),'hex'));
  if c is null then return null; end if;
  if exists(select 1 from public.purge_manifests m join public.retention_due_phases d on d.retention_row_id=m.retention_row_id
   and d.phase_id=m.phase_id where m.id=(c->>'manifestId')::uuid and d.target_id=p_upload) then
   return c||jsonb_build_object('claimToken',encode(extensions.digest(convert_to(p_upload::text||i,'UTF8'),'sha256'),'hex'));
  end if;
 end loop;
 return null;
end;
$$;
-- The executor takes the earliest due phase first. On a shared developer
-- database older due sessions may exist; putting this one first changes only
-- the order of work, never which sessions are eligible.
update public.retention_due_phases set phase_deadline=clock_timestamp()-interval '10 years'
 where retention_id='upload.staging-2h' and target_id=pg_temp.fxv('refuse','upload')::uuid;
create temporary table refused_claim as select pg_temp.claim_for(pg_temp.fxv('refuse','upload')::uuid) c;
grant select on refused_claim to service_role;
select is((select jsonb_agg(o->>'objectName' order by o->>'objectName') from refused_claim,jsonb_array_elements(c->'objects') o),
 (select jsonb_agg(x order by x) from unnest(array[pg_temp.fxv('refuse','staging'),pg_temp.fxv('refuse','final')]) x),
 'the existing executor claims exactly the staging and final objects of the refused file');
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name in (pg_temp.fxv('refuse','staging'),pg_temp.fxv('refuse','final'));
select is(public.finish_own_upload_purge_v1((select (c->>'manifestId')::uuid from refused_claim),
 (select c->>'claimToken' from refused_claim)),true,'the executor finishes after Storage deletion');
select is((select count(*) from public.upload_sessions where id=pg_temp.fxv('refuse','upload')::uuid)
 +(select count(*) from public.other_adult_held_uploads where upload_session_id=pg_temp.fxv('refuse','upload')::uuid)
 +(select count(*) from public.genome_files where sha256=pg_temp.fxv('refuse','raw'))
 +(select count(*) from storage.objects where name in (pg_temp.fxv('refuse','staging'),pg_temp.fxv('refuse','final'))),0::bigint,
 'after refusal: zero session, held, file and Storage rows remain');

-- 9. The older token path cannot accept a file its page never showed ----------
select lives_ok($$select pg_temp.present('legacy','5')$$,'(legacy) presented');
select lives_ok($$select pg_temp.sign('legacy','5')$$,'(legacy) signed');
select is((select h->>'status' from (select pg_temp.hold('legacy',repeat('c',64)) h) x),'stored_quarantined','(legacy) held');
select is(public.respond_adult_subject_invitation_v1((select token_hash from fx where name='legacy'),'confirm',
 '0a5e0000-0000-4000-8000-000000000002',repeat('4',64)),'unavailable',
 'a held file is never released through the older token path');
select is(public.respond_adult_subject_invitation_v1((select token_hash from fx where name='legacy'),'delete'),'deleted',
 'the older path can still delete the reservation');
select ok((select state='deleted' from public.other_adult_held_uploads where upload_session_id=pg_temp.fxv('legacy','upload')::uuid),
 'deleting the reservation ends its held file');

-- 10. Expiry and the uploader's account deletion ------------------------------
select lives_ok($$select pg_temp.present('expire','3')$$,'(expire) presented');
select lives_ok($$select pg_temp.sign('expire','3')$$,'(expire) signed');
select is((select h->>'status' from (select pg_temp.hold('expire',repeat('d',64)) h) x),'stored_quarantined','(expire) held');
select lives_ok($$select pg_temp.present('withdraw','4')$$,'(withdraw) presented');
select lives_ok($$select pg_temp.sign('withdraw','4')$$,'(withdraw) signed');
select is((select h->>'status' from (select pg_temp.hold('withdraw',repeat('f',64)) h) x),'stored_quarantined','(withdraw) held');
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the sweep runs');
select is((select count(*) from public.other_adult_held_uploads where state='held'
 and upload_session_id in (pg_temp.fxv('expire','upload')::uuid,pg_temp.fxv('withdraw','upload')::uuid)),2::bigint,
 'nothing of this suite is due while both invitations are pending');
update public.subject_invitations set expires_at=created_at+interval '1 microsecond'
 where id=(select invitation_id from fx where name='expire');
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the sweep runs again');
select ok((select h.state='expired' and u.status='rejected' from public.other_adult_held_uploads h
 join public.upload_sessions u on u.id=h.upload_session_id where h.upload_session_id=pg_temp.fxv('expire','upload')::uuid),
 'expiry rejects the held session for purge');
select is((select status||':'||terminal_outcome_code from public.retention_due_phases
 where retention_id='adult.unconfirmed-30d' and target_id=pg_temp.fxv('expire','upload')::uuid),
 'succeeded:adult_unconfirmed_source_expired','adult.unconfirmed-30d completes as expired');
select ok((select state='held' from public.other_adult_held_uploads
 where upload_session_id=pg_temp.fxv('withdraw','upload')::uuid),'a pending invitation''s held file is untouched by expiry');
update public.profiles set deletion_requested_at=clock_timestamp() where id='0a5e0000-0000-4000-8000-000000000001';
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the sweep runs after the deletion request');
select ok((select state='withdrawn' from public.other_adult_held_uploads
 where upload_session_id=pg_temp.fxv('withdraw','upload')::uuid),'it is withdrawn, not left blocking account deletion');
select is((select count(*) from public.upload_sessions where account_id='0a5e0000-0000-4000-8000-000000000001'
 and token_jti is not null and status not in ('promoted','rejected')),0::bigint,
 'no held session remains to block the uploader''s account purge');

-- 11. Privileges --------------------------------------------------------------
select ok(not has_table_privilege('anon','public.other_adult_held_uploads','select')
 and not has_table_privilege('authenticated','public.other_adult_held_uploads','select')
 and not has_table_privilege('inherit_upload_only','public.other_adult_held_uploads','select'),
 'no browser role can read the held table');
select is((select coalesce(string_agg(p.oid::regprocedure::text,', '),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and (p.proname like '%other_adult%' or p.proname='subject_upload_store_authority_v1')
  and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
   or has_function_privilege('inherit_upload_only',p.oid,'execute'))),'',
 'no browser or upload role can execute any held-upload function');
select is((select count(*) from public.purge_target_stores where store_name='public.other_adult_held_uploads'
 and target_id='upload-and-ingest-working-state'),1::bigint,'the held table is a registered purge store');

select * from finish();
rollback;
