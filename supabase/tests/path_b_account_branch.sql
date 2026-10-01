-- Path B's account branch (20260930210000_path_b_account_branch.sql; G2.6
-- adult half, G5.3), on top of 20260928150000_other_adult_held_upload.sql.
--
-- Proves, on synthetic rows only, that:
--   * a person signed in with the invited address confirms a Path B request
--     into their own account: the subject stays the uploader's, is bound to
--     the person's account, and the one confirmation principal becomes that
--     account's; their country is the account's own current declaration;
--   * a different address, the uploader, another account's session, an
--     account with no current declaration and a request outside TEST-LOCAL
--     are all refused, and exactly one of the account and no-account
--     confirmations can ever commit;
--   * the account match goes through the contact keyring: after a rotation a
--     bare digest and a set missing a revision are refused, and the whole
--     set confirms an invitation written under the new revision;
--   * the uploader can upload for the account-bound subject, the file is held
--     and noticed as before, and nothing any account-and-session function
--     returns names the held source, the person's account included;
--   * the person's account lists the file (name, kind, dates, state) and
--     nothing else; no one else's does;
--   * a file answer from its notice needs no account, refuses a different
--     present account, and a confirmation rechecks the account's declaration;
--   * a person who asks to delete their account has the subject deleted and
--     unbound, so it never blocks that deletion.
-- Everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc

update public.mail_outbox set state='invalidated' where state in ('queued','claimed');
insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=52428800,
 maximum_account_bytes=1073741824,maximum_active_uploads=32 where singleton;

-- 01 uploads; 02 is the person, with an account; 03 has an account and no
-- declaration; 04 is a person whose invitation is written after a rotation;
-- 09 is an outsider.
insert into auth.users(id,email,raw_user_meta_data) values
 ('0b5e0000-0000-4000-8000-000000000001','acct-uploader@e2e.local','{"display_name":"Synthetic uploader"}'),
 ('0b5e0000-0000-4000-8000-000000000002','acct-person@e2e.local','{"display_name":"Synthetic person"}'),
 ('0b5e0000-0000-4000-8000-000000000003','acct-undeclared@e2e.local','{"display_name":"Synthetic undeclared"}'),
 ('0b5e0000-0000-4000-8000-000000000004','acct-rotated@e2e.local','{"display_name":"Synthetic rotated"}'),
 ('0b5e0000-0000-4000-8000-000000000009','acct-outsider@e2e.local','{"display_name":"Synthetic outsider"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
 select ('0b5e0000-0000-4000-8000-00000000001'||n)::uuid,('0b5e0000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1'
 from unnest(array['1','2','3','4','9']) n;
update public.profiles set date_of_birth=date '1990-01-01' where id::text like '0b5e0000-%';
-- A current own jurisdiction declaration for everyone but 03.
update public.profiles p set jurisdiction_code='GB',jurisdiction_declared_at=clock_timestamp(),
 jurisdiction_attestation_version=a.version,jurisdiction_attestation_sha256=a.body_sha256
 from public.consent_artifacts a where a.artifact_key='attestation.jurisdiction' and a.superseded_at is null
  and p.id in ('0b5e0000-0000-4000-8000-000000000001','0b5e0000-0000-4000-8000-000000000002',
   '0b5e0000-0000-4000-8000-000000000004','0b5e0000-0000-4000-8000-000000000009');
update public.profiles set jurisdiction_code=null,jurisdiction_declared_at=null,jurisdiction_attestation_version=null,
 jurisdiction_attestation_sha256=null where id='0b5e0000-0000-4000-8000-000000000003';

-- Helpers ---------------------------------------------------------------------
create function pg_temp.a(p text) returns uuid language sql immutable as
 $$ select ('0b5e0000-0000-4000-8000-00000000000'||p)::uuid $$;
create function pg_temp.s(p text) returns uuid language sql immutable as
 $$ select ('0b5e0000-0000-4000-8000-00000000001'||p)::uuid $$;
create function pg_temp.kd(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('path-b-account:'||p,'sha256'),'hex') $$;
create function pg_temp.pair(p text) returns jsonb language sql immutable as
 $$ select jsonb_build_object('1',pg_temp.kd(p||'1'),'2',pg_temp.kd(p||'2')) $$;
create temporary table fx(name text primary key, subject_id uuid, token_hash text);
grant all on fx to service_role;
create function pg_temp.sid(p_name text) returns uuid language sql as $$ select subject_id from fx where name=p_name $$;
create function pg_temp.draft(p_name text,p_hmac text,p_set jsonb default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 r:=public.create_path_b_adult_draft_v1(pg_temp.a('1'),pg_temp.s('1'),'Synthetic Relative',date '1980-05-05',
  decode('00112233445566778899aabbccddeeff','hex'),p_hmac,pg_temp.kd('request:'||p_name),true,p_contact_hmac_set=>p_set);
 insert into fx(name,subject_id) values(p_name,(r->>'subjectDraftId')::uuid) on conflict(name) do nothing;
 return r;
end;
$$;
create function pg_temp.present(p_subject uuid,p_nonce text) returns jsonb language sql as $$
 select public.present_other_adult_upload_artifact_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,repeat(p_nonce,64),
  clock_timestamp()+interval '9 minutes',true);
$$;
create function pg_temp.sign(p_subject uuid,p_nonce text) returns jsonb language sql as $$
 select public.sign_other_adult_upload_artifact_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,a.version,a.body_sha256,
  array['subject-alive-and-adult','subject-permission-held','lawfully-held-with-knowledge','contact-belongs-to-subject',
   'no-excluded-relationship','held-until-accepted','no-uploader-access'],decode(repeat('ab',24),'hex'),repeat(p_nonce,64),true)
 from public.consent_artifacts a where a.artifact_key='consent.upload-other-adult' and a.superseded_at is null;
$$;
create function pg_temp.invite(p_subject uuid,p_hmac text,p_set jsonb default null) returns jsonb language sql as $$
 select public.create_path_b_invitation_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,p_hmac,
  pg_temp.kd('idem:'||p_subject::text),true,p_contact_hmac_set=>p_set,p_quota_keys=>pg_temp.invitation_quota_keys());
$$;
create function pg_temp.claim_for(p_target uuid) returns text language plpgsql as $$
declare d record; i integer;
begin
 for i in 1..50 loop
  select * into d from public.claim_mail_outbox();
  if d.outbox_id is null then return null; end if;
  if exists(select 1 from public.mail_outbox m where m.id=d.outbox_id and m.token_target_id=p_target) then
   return encode(extensions.digest(convert_to(d.delivery_token,'UTF8'),'sha256'),'hex');
  end if;
 end loop;
 return null;
end;
$$;
create function pg_temp.invitation_of(p_subject uuid) returns uuid language sql as $$
 select id from public.subject_invitations where target_kind='subject' and target_id=p_subject
  and invitation_kind='adult_subject' order by created_at desc limit 1
$$;
create function pg_temp.open_session(p_token_hash text,p_session text,p_form text) returns bigint language sql as $$
 select count(*) from public.activate_rights_session_v1(p_token_hash,repeat(p_session,64),p_form)
$$;
-- A draft signed and requested, its mail claimed and its request opened.
create function pg_temp.requested(p_name text,p_letter text,p_hmac text,p_set jsonb default null) returns uuid
language plpgsql as $$
declare v_subject uuid;
begin
 perform pg_temp.draft(p_name,p_hmac,p_set);
 v_subject:=pg_temp.sid(p_name);
 perform pg_temp.present(v_subject,p_letter);
 perform pg_temp.sign(v_subject,p_letter);
 perform pg_temp.invite(v_subject,p_hmac,p_set);
 update fx set token_hash=pg_temp.claim_for(pg_temp.invitation_of(v_subject)) where name=p_name;
 if pg_temp.open_session((select token_hash from fx where name=p_name),p_letter,'acct-open-'||p_letter||'aaaaaaaaaaaaaaaa')<>1 then
  raise exception 'request setup failed for %',p_name; end if;
 return v_subject;
end;
$$;
create function pg_temp.esig() returns public.consent_artifacts language sql as $$
 select * from public.consent_artifacts where artifact_key='consent.subject-adult-esignature' and superseded_at is null
$$;
-- The account confirmation, as the route calls it.
create function pg_temp.account_confirms(p_session text,p_nonce text,p_account text,p_hmac text,
 p_set jsonb default null,p_flag boolean default true,p_auth_session uuid default null) returns text language sql as $$
 select public.confirm_path_b_subject_account_v1(repeat(p_session,64),p_nonce,(pg_temp.esig()).version,
  (pg_temp.esig()).body_sha256,array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees',
   'may-withdraw-any-time'],decode(repeat('cd',24),'hex'),pg_temp.a(p_account),coalesce(p_auth_session,pg_temp.s(p_account)),
  p_hmac,p_flag,p_account_email_hmac_set=>p_set);
$$;
create function pg_temp.token_confirms(p_session text,p_nonce text) returns text language sql as $$
 select public.confirm_path_b_subject_v1(repeat(p_session,64),p_nonce,(pg_temp.esig()).version,(pg_temp.esig()).body_sha256,
  array['knows-uploader-has-file','agrees-to-upload','shown-what-uploader-sees','may-withdraw-any-time'],
  decode(repeat('cd',24),'hex'),'GB',true);
$$;
create temporary table held_fx(name text primary key, upload_id uuid, staging text, final_name text, object_id uuid,
 raw text, revision_id uuid);
grant all on held_fx to service_role;
create function pg_temp.hold(p_name text,p_subject uuid,p_hash text) returns jsonb language plpgsql as $$
declare r jsonb; m jsonb; v_object uuid:=gen_random_uuid(); v_result jsonb;
begin
 r:=public.issue_other_adult_held_upload_v1(pg_temp.a('1'),pg_temp.s('1'),p_subject,'VCF',8,p_hash,true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('role','service_role',true);
 insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('genomes',r->>'stagingKey',pg_temp.a('1'),'{"size":8}');
 m:=public.begin_own_upload_finalization_v2(pg_temp.a('1'),pg_temp.s('1'),(r->>'uploadId')::uuid);
 insert into storage.objects(id,bucket_id,name,metadata) values(v_object,'genomes',m->>'finalKey','{"size":8}');
 perform set_config('role','postgres',true);
 perform set_config('storage.allow_delete_query','true',true);
 delete from storage.objects where bucket_id='genomes' and name=r->>'stagingKey';
 perform set_config('role','service_role',true);
 v_result:=public.complete_own_upload_finalization_v1(pg_temp.a('1'),pg_temp.s('1'),(r->>'uploadId')::uuid,
  (m->>'claim')::uuid,v_object,p_hash,repeat('b',64));
 perform set_config('role','postgres',true);
 insert into held_fx values(p_name,(r->>'uploadId')::uuid,r->>'stagingKey',m->>'finalKey',v_object,p_hash,
  (v_result->>'fileId')::uuid);
 return v_result;
end;
$$;
create function pg_temp.fxv(p_name text,p_field text) returns text language sql as $$
 select case p_field when 'upload' then upload_id::text when 'final' then final_name when 'object' then object_id::text
  when 'raw' then raw when 'staging' then staging when 'revision' then revision_id::text end from held_fx where name=p_name
$$;
create function pg_temp.notice_session(p_name text,p_session text) returns bigint language sql as $$
 select pg_temp.open_session(pg_temp.claim_for(pg_temp.fxv(p_name,'revision')::uuid),p_session,
  'acct-notice-'||p_session||'aaaaaaaaaaaaaa')
$$;

-- 1. The person confirms with their account ------------------------------------
select pg_temp.requested('main','a',repeat('a',64));
select is(pg_temp.account_confirms('a','acct-flag-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64),p_flag=>false),'unavailable',
 'the account confirmation exists only under TEST-LOCAL');
select is(pg_temp.account_confirms('a','acct-addr-aaaaaaaaaaaaaaaaaaa','2',repeat('e',64)),'unavailable',
 'an account whose address is not the invited one cannot confirm');
select is(pg_temp.account_confirms('a','acct-upld-aaaaaaaaaaaaaaaaaaa','1',repeat('a',64)),'unavailable',
 'the uploader can never confirm for the person, even presenting the invited address');
select is(pg_temp.account_confirms('a','acct-decl-aaaaaaaaaaaaaaaaaaa','3',repeat('a',64)),'unavailable',
 'an account with no current own jurisdiction declaration cannot confirm');
select is(pg_temp.account_confirms('a','acct-sess-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64),p_auth_session=>pg_temp.s('9')),
 'unavailable','the account must be on its own live session');
select is((select count(*) from public.subjects where id=pg_temp.sid('main') and lifecycle='draft' and subject_account_id is null),
 1::bigint,'... and none of those refusals changed the request');
select is(pg_temp.account_confirms('a','acct-sign-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64)),'accepted',
 'the person signed in with the invited address confirms into their account');
select ok((select s.lifecycle='active' and s.owner_account_id=pg_temp.a('1') and s.subject_account_id=pg_temp.a('2')
  and s.subject_class='other_adult' and d.state='confirmed' and i.status='accepted'
 from public.subjects s join public.adult_subject_drafts d on d.subject_id=s.id
 join public.subject_invitations i on i.target_id=s.id where s.id=pg_temp.sid('main')),
 'the subject stays the uploader''s and is bound to the person''s account');
select ok((select count(*)=1 and bool_and(sp.principal_kind='account_subject' and sp.account_id=pg_temp.a('2')
  and sp.status='active' and e.status='current' and e.authority_revision=sp.principal_revision)
 from public.subject_principals sp join public.encrypted_contact_references e on e.principal_id=sp.id
 where sp.subject_id=pg_temp.sid('main') and sp.status='active'),
 'its one confirmation principal is now the person''s account, with the invited contact still live');
select ok((select cs.signer_account_id=pg_temp.a('2') and cs.purpose='adult-subject-path-b-confirmation'
  and cs.jurisdiction_code='GB' and cs.artifact_key='consent.subject-adult-esignature'
  and cs.jurisdiction_revision=(select jurisdiction_revision from public.profiles where id=pg_temp.a('2'))
  and cs.subject_binding_revision=(select subject_binding_revision from public.subjects where id=pg_temp.sid('main'))
 from public.consent_signatures cs where cs.target_id=pg_temp.sid('main') and cs.artifact_key='consent.subject-adult-esignature'),
 'the signature is the account''s, with the account''s own declared country');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('main'))
 +(select count(*) from public.subject_consents where subject_id=pg_temp.sid('main') and consent_type<>'upload_class')
 +(select count(*) from public.subject_account_bindings where subject_id=pg_temp.sid('main')),0::bigint,
 'confirmation creates no purpose grant, no source consent and no account binding: reading comes later');
select is(pg_temp.token_confirms('a','acct-token-aaaaaaaaaaaaaaaaaa'),'unavailable',
 'the no-account confirmation cannot also commit');
-- The other order: the no-account confirmation first.
select pg_temp.requested('race','b',repeat('b',64));
select is(pg_temp.token_confirms('b','acct-token-bbbbbbbbbbbbbbbbbb'),'accepted','(race) the person signs with no account');
select is(pg_temp.account_confirms('b','acct-sign-bbbbbbbbbbbbbbbbbbb','2',repeat('b',64)),'unavailable',
 '... and then no account confirmation can commit');
select ok((select subject_account_id is null from public.subjects where id=pg_temp.sid('race')),
 '... so the subject stays unbound');

-- 2. The uploader uploads; the file is held and noticed ---------------------------
select is((select p->>'artifactKey' from (select pg_temp.present(pg_temp.sid('main'),'d') p) x),'consent.upload-other-adult',
 'the uploader can still sign for an account-bound person');
create temporary table main_receipt as select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64)) r;
grant select on main_receipt to service_role;
select is((select r-'fileId' from main_receipt),
 jsonb_build_object('status','stored_quarantined','analysisState','quarantined','noticeState','queued'),
 'the uploader''s file for the account-bound person is stored, quarantined and noticed');
select ok((select h.confirmation_principal_id=sp.id and sp.account_id=pg_temp.a('2')
  and m.recipient_principal_id=sp.id and m.recipient_authority_revision=sp.principal_revision and m.state='queued'
 from public.other_adult_held_uploads h join public.subject_principals sp on sp.id=h.confirmation_principal_id
 join public.mail_outbox m on m.id=h.notice_outbox_id where h.id=pg_temp.fxv('main','revision')::uuid),
 'the revision is bound to the account principal and its notice goes to the invited contact');
select is((select count(*) from public.genome_files where subject_id=pg_temp.sid('main')),0::bigint,
 'no file row exists for it');

-- 3. The person's account lists it, and no one else's does -------------------------
select is(jsonb_array_length(public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)),1,
 'the person''s account lists one person');
select is((select jsonb_agg(k order by k) from jsonb_object_keys(public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)->0) k),
 '["files","label"]'::jsonb,'... with the name the uploader typed and the files, nothing else');
select is((select jsonb_agg(k order by k) from jsonb_object_keys(public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)->0->'files'->0) k),
 '["addedOn","confirmedOn","deleteBy","fileKind","state"]'::jsonb,'... and each file is a kind, dates and a state');
select is(public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)->0->'files'->0->>'state','pending',
 '... waiting for their answer');
select is(public.subject_held_files_v1(pg_temp.a('1'),pg_temp.s('1'),true)
 ||public.subject_held_files_v1(pg_temp.a('9'),pg_temp.s('9'),true)
 ||public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),false),'[]'::jsonb,
 'the uploader, an outsider and a call outside TEST-LOCAL see nothing');
select throws_ok($$select public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('9'),true)$$,'42501','not_found',
 'another account''s session reads nothing');
select is(public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)::text like '%'||pg_temp.fxv('main','revision')||'%'
 or public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)::text like '%'||pg_temp.sid('main')::text||'%',false,
 'the list carries no identifier');

-- 4. Quarantined: unreadable by every reader, the person's account included -------
create temporary table reader_calls(fn text, args text, outcome text);
create function pg_temp.probe(p_account uuid,p_session uuid,p_target uuid) returns void language plpgsql as $$
declare f record; v_sql text; v_out text; v_rest text; v_needles text[]; v_done boolean;
begin
 v_needles:=array[pg_temp.fxv('main','final'),pg_temp.fxv('main','object'),pg_temp.fxv('main','raw'),
  pg_temp.fxv('main','upload'),pg_temp.fxv('main','staging')];
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
      and position(x in coalesce(v_out,''))>0) then 'LEAKED' else 'returned-nothing-held' end);
  end;
 end loop;
end;
$$;
select pg_temp.probe(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'));
select pg_temp.probe(pg_temp.a('2'),pg_temp.s('2'),pg_temp.fxv('main','revision')::uuid);
select pg_temp.probe(pg_temp.a('2'),pg_temp.s('2'),pg_temp.fxv('main','upload')::uuid);
select pg_temp.probe(pg_temp.a('2'),pg_temp.s('2'),pg_temp.fxv('main','object')::uuid);
select pg_temp.probe(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'));
select pg_temp.probe(pg_temp.a('9'),pg_temp.s('9'),pg_temp.sid('main'));
select cmp_ok((select count(distinct fn) from reader_calls),'>=',100::bigint,
 'the probe discovered the whole account-and-session function family');
select is((select coalesce(string_agg(distinct fn,', '),'') from reader_calls where outcome='LEAKED'),'',
 'an account-bound person''s held source is unreadable by every reader function, their own account included');

-- 5. Answering a file from its notice -----------------------------------------------
select is(pg_temp.notice_session('main','1'),1::bigint,'the notice opens a session for the file');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'acct-wrong-11111111111111111','confirm',pg_temp.a('9')),
 'unavailable','a different signed-in account cannot answer for the person');
-- An attestation the account affirmed that is no longer the current one.
create temporary table held_sha as select jurisdiction_attestation_sha256 v from public.profiles where id=pg_temp.a('2');
update public.profiles set jurisdiction_attestation_sha256=repeat('0',64) where id=pg_temp.a('2');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'acct-decl-111111111111111111','confirm'),
 'unavailable','a confirmation rechecks the account''s current own declaration');
update public.profiles set jurisdiction_attestation_sha256=(select v from held_sha) where id=pg_temp.a('2');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'acct-conf-111111111111111111','confirm',pg_temp.a('2')),
 'confirmed','the person confirms the file signed in as themselves');
select ok((select state='confirmed' and analysis_state='confirmed_blocked_current_gate' from public.other_adult_held_uploads
 where id=pg_temp.fxv('main','revision')::uuid),'... with the same confirmed_blocked_current_gate outcome and zero job');
select is(public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)->0->'files'->0->>'state','confirmed',
 'the person''s account shows it confirmed');
select is((select h->>'status' from (select pg_temp.hold('main-2',pg_temp.sid('main'),repeat('f',64)) h) x),
 'stored_quarantined','the uploader adds a second file');
select is(pg_temp.notice_session('main-2','2'),1::bigint,'its own notice opens its own session');
select is(public.respond_adult_upload_revision_v1(repeat('2',64),'acct-refuse-2222222222222222','refuse'),'refused',
 'the person refuses it from the notice with no account session');
select is((select jsonb_agg(f->>'state' order by f->>'addedOn') from jsonb_array_elements(
 public.subject_held_files_v1(pg_temp.a('2'),pg_temp.s('2'),true)->0->'files') f),'["confirmed"]'::jsonb,
 'the refused file leaves the account''s list');

-- 6. The contact keyring --------------------------------------------------------------
select private.begin_hmac_key_rotation_v1('contact',2);
select pg_temp.requested('keyed','c',null,pg_temp.pair('c'));
select ok((select email_hmac=pg_temp.kd('c2') and email_hmac_key_revision=2 from public.subject_invitations
 where id=pg_temp.invitation_of(pg_temp.sid('keyed'))),'(keyed) the request is written under revision 2');
select throws_ok($$select pg_temp.account_confirms('c','acct-bare-ccccccccccccccccccc','4',pg_temp.kd('c1'))$$,
 '55000','keyed digest set required','after a rotation a bare account digest is refused');
select throws_ok($$select pg_temp.account_confirms('c','acct-short-cccccccccccccccccc','4',null,
 jsonb_build_object('1',pg_temp.kd('c1')))$$,'55000','keyed digest set incomplete',
 'an account digest set missing a usable revision is refused');
select is(pg_temp.account_confirms('c','acct-other-cccccccccccccccccc','4',null,pg_temp.pair('x')),'unavailable',
 'a whole set for another address is refused');
select is(pg_temp.account_confirms('c','acct-sign-ccccccccccccccccccc','4',null,pg_temp.pair('c')),'accepted',
 'the whole set confirms the invitation written under the new revision');
select is(private.declared_contact_aliases_v1(),'{}'::jsonb,'the declared set ends with the call');

-- 7. The person deletes their account ---------------------------------------------------
update public.profiles set deletion_requested_at=clock_timestamp() where id=pg_temp.a('2');
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the sweep runs after the person''s deletion request');
select ok((select s.lifecycle='purged' and s.subject_account_id is null
 from public.subjects s where s.id=pg_temp.sid('main')),
 'the person''s Path B subject is deleted and no longer names their account');
select ok((select state='deleted' from public.other_adult_held_uploads where id=pg_temp.fxv('main','revision')::uuid)
 and not exists(select 1 from public.subject_principals where subject_id=pg_temp.sid('main') and status='active')
 and not exists(select 1 from public.encrypted_contact_references e join public.subject_principals sp on sp.id=e.principal_id
  where sp.subject_id=pg_temp.sid('main') and e.status='current'),
 '... its files end, and its principal and contact are removed');
select is((select count(*) from public.subjects where subject_account_id=pg_temp.a('2') and subject_class<>'self'),0::bigint,
 'nothing of Path B is left in the person''s own account graph');
select ok((select subject_account_id=pg_temp.a('4') and lifecycle='active' from public.subjects where id=pg_temp.sid('keyed')),
 'another person''s subject is untouched');

-- 8. Privileges ------------------------------------------------------------------------------
select ok(not has_function_privilege('service_role',
  'private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)','execute')
 and not has_function_privilege('service_role','private.path_b_account_current_v1(uuid)','execute')
 and has_function_privilege('service_role',
  'public.confirm_path_b_subject_account_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean,jsonb)','execute')
 and has_function_privilege('service_role','public.subject_held_files_v1(uuid,uuid,boolean)','execute')
 and has_function_privilege('service_role','public.respond_adult_upload_revision_v1(text,text,text,uuid)','execute'),
 'the unkeyed body and the account check are callable by no API role; the doors by the service role');
select is((select coalesce(string_agg(p.oid::regprocedure::text,', '),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('confirm_path_b_subject_account_v1',
  'confirm_path_b_subject_account_keyed_v1','confirm_path_b_subject_account_core_v1','subject_held_files_v1',
  'path_b_account_current_v1','respond_adult_upload_revision_v1')
  and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
   or has_function_privilege('inherit_upload_only',p.oid,'execute'))),'',
 'no browser or upload role can execute any account-branch function');
select is((select count(*) from pg_proc where proname='respond_adult_upload_revision_v1'),1::bigint,
 'the file answer has one signature, so no overload without the account check remains');

select * from finish();
rollback;
