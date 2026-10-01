-- Path B's reading layer (20260930220000_path_b_reading_layer.sql; G2.6 adult
-- half, G5.3), on top of the account branch. Fixtures and helpers are the
-- account-branch suite's, copied verbatim by the generator.
--
-- Proves, on synthetic rows only, that:
--   * other-adult-mitigation-state-v1 answers each register case this
--     deployment can prove, and fails closed, naming the gate, on every case
--     whose state is not built;
--   * a person bound to their own account grants one result layer at a time,
--     for themselves or for the uploader, under the approved text for that
--     layer; the uploader direction is refused where the mitigation decision
--     denies it; nobody else can grant;
--   * every reader, once past the grants, stops at analysis-eligibility-v1's
--     subject-bound source gate: no job, no file row, and a confirmed file
--     stays confirmed_blocked_current_gate;
--   * each side sees only its own choices and shares; revocation and the
--     person's deletion end grants, directions and the uploader relationship;
--   * with grants in place, no account-and-session function returns the held
--     source to the person or the uploader.
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

-- 1. Three confirmed people ----------------------------------------------------
-- main: confirmed with 02's account, which existed before the request.
-- nb: confirmed with no account. late: confirmed with 04's account, created
-- after the request was sent.
-- Accounts made a day before this suite's requests; 04 is moved after its own below.
update auth.users set created_at=now()-interval '1 day' where id::text like '0b5e0000-%';
select pg_temp.requested('main','a',repeat('a',64));
select pg_temp.account_confirms('a','read-sign-aaaaaaaaaaaaaaaaaaa','2',repeat('a',64));
select pg_temp.requested('nb','b',repeat('b',64));
select pg_temp.token_confirms('b','read-token-bbbbbbbbbbbbbbbbbb');
select pg_temp.requested('late','c',repeat('c',64));
update auth.users set created_at=clock_timestamp() where id=pg_temp.a('4');
select pg_temp.account_confirms('c','read-sign-ccccccccccccccccccc','4',repeat('c',64));
select is((select count(*) from public.subjects where id in (pg_temp.sid('main'),pg_temp.sid('nb'),pg_temp.sid('late'))
 and lifecycle='active'),3::bigint,'three Path B people are confirmed');

-- 2. other-adult-mitigation-state-v1 --------------------------------------------
create function pg_temp.m(p_name text,p_account text,p_checkpoint text default 'route-read-before-fetch') returns text
language sql as $$
 select (private.other_adult_mitigation_v1(pg_temp.sid(p_name),pg_temp.a(p_account),p_checkpoint)->>'decision')
  ||':'||coalesce(private.other_adult_mitigation_v1(pg_temp.sid(p_name),pg_temp.a(p_account),p_checkpoint)->>'gate','-')
$$;
select is(pg_temp.m('main','2'),'subject-own-right-only:-','the person''s own account is subject-own-right-only');
select is(pg_temp.m('main','1'),'allow:-',
 'the uploader of a person whose account predates the request, inside 30 days of acceptance, is allowed');
select is(pg_temp.m('nb','1'),'deny:adult.non-account-holder-24mo',
 'a no-account person''s uploader is denied: the 24-month confirmation state is not built');
select is(pg_temp.m('late','1'),'deny:adult.acceptance-hold-72h',
 'an account created after the request is treated as created from it: the 72-hour hold is not built');
select is(pg_temp.m('main','9'),'deny:not-found','anyone else is not found');
update public.subject_invitations set accepted_at=accepted_at-interval '31 days'
 where id=pg_temp.invitation_of(pg_temp.sid('main'));
select is(pg_temp.m('main','1','analysis-enqueue'),'deny:adult.re-notice-30d',
 'from the 30-day boundary the uploader is denied: the re-notice is not built');
update public.subject_invitations set accepted_at=accepted_at+interval '31 days'
 where id=pg_temp.invitation_of(pg_temp.sid('main'));
select throws_ok($$select private.other_adult_mitigation_v1(pg_temp.sid('main'),pg_temp.a('1'),'anything')$$,
 '22023','invalid_request','only the register''s checkpoints are answered');

-- 3. Before any grant, nobody reads -----------------------------------------------
create function pg_temp.r(p_name text,p_account text,p_purpose text) returns text language sql as $$
 select private.path_b_result_read_v1(pg_temp.a(p_account),pg_temp.sid(p_name),p_purpose)->>'gate'
$$;
select is(pg_temp.r('main','2','ancestry'),'directional-purpose-grant-v1','the person needs their own grant for a layer');
select is(pg_temp.r('main','1','ancestry'),'directional-purpose-grant-v1','the uploader needs the person''s grant');
select is(pg_temp.r('nb','1','ancestry'),'adult.non-account-holder-24mo','a no-account person''s uploader stops at the mitigation gate');
select is(pg_temp.r('main','9','ancestry'),'not-found','an outsider is not found');
select is(pg_temp.r('main','2','copilot.cloud'),'purpose','only the three result layers are Path B purposes');

-- 4. Grants, one layer and one direction at a time ---------------------------------
create function pg_temp.artifact(p_key text) returns public.consent_artifacts language sql as $$
 select * from public.consent_artifacts where artifact_key=p_key and superseded_at is null
$$;
create function pg_temp.grant_as(p_account text,p_name text,p_purpose text,p_direction text,p_key text,p_nonce text,
 p_flag boolean default true) returns jsonb language sql as $$
 select public.grant_path_b_purpose_v1(pg_temp.a(p_account),pg_temp.s(p_account),pg_temp.sid(p_name),p_purpose,p_direction,
  (pg_temp.artifact(p_key)).version,(pg_temp.artifact(p_key)).body_sha256,
  encode(extensions.digest(p_nonce,'sha256'),'hex'),clock_timestamp()+interval '5 minutes',p_flag)
$$;
select throws_ok($$select pg_temp.grant_as('2','main','ancestry','self','consent.own-ancestry','n-flag',false)$$,
 '42501','not_found','grants exist only under TEST-LOCAL');
select throws_ok($$select pg_temp.grant_as('2','main','copilot.cloud','self','consent.own-ancestry','n-purpose')$$,
 '22023','invalid_request','only the three result layers can be granted');
select throws_ok($$select pg_temp.grant_as('2','main','ancestry','self','consent.own-monogenic','n-artifact')$$,
 '55000','consent_artifact_changed','a layer is granted only under its own text');
select throws_ok($$select pg_temp.grant_as('1','main','ancestry','self','consent.own-ancestry','n-uploader')$$,
 '42501','not_found','the uploader cannot grant for the person');
select throws_ok($$select pg_temp.grant_as('9','main','ancestry','self','consent.own-ancestry','n-outsider')$$,
 '42501','not_found','an outsider cannot grant for the person');
select is((pg_temp.grant_as('2','main','ancestry','self','consent.own-ancestry','n-self-anc'))->>'purposeKey','ancestry',
 'the person turns ancestry on for themselves');
select ok((select pg.data_subject_principal_id=pg.signer_principal_id and dg.direction='self'
  and dg.recipient_account_id=pg_temp.a('2') and dg.relationship_id is null and pg.artifact_key='consent.own-ancestry'
  and sp.account_id=pg_temp.a('2')
 from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 join public.subject_principals sp on sp.id=pg.data_subject_principal_id
 where pg.target_id=pg_temp.sid('main') and pg.purpose='ancestry' and pg.revoked_at is null),
 '... as one self-direction grant signed by their account principal');
select throws_ok($$select pg_temp.grant_as('2','main','ancestry','self','consent.own-ancestry','n-self-anc')$$,
 '23505',null,'a presentation grants at most once');
select is((pg_temp.grant_as('2','main','reports.monogenic','uploader','consent.share-with-adult','n-up-mono'))->>'purposeKey',
 'reports.monogenic','the person shares one layer with the uploader');
select ok((select dg.direction='subject_to_recipient' and dg.recipient_account_id=pg_temp.a('1')
  and r.relationship_kind='uploader' and r.status='current' and pg.artifact_key='consent.share-with-adult'
  and dg.relationship_or_pair_revision=r.relationship_revision
 from public.purpose_grants pg join public.directional_grants dg on dg.grant_id=pg.grant_id
 join public.subject_relationships r on r.id=dg.relationship_id
 where pg.target_id=pg_temp.sid('main') and pg.purpose='reports.monogenic' and pg.revoked_at is null),
 '... as a subject-to-uploader grant over an uploader relationship, never a family one');
select is((select count(*) from public.subject_relationships where subject_id=pg_temp.sid('main')
 and relationship_kind='family_member'),0::bigint,'no family relationship is made');
select throws_ok($$select pg_temp.grant_as('4','late','reports.monogenic','uploader','consent.share-with-adult','n-late')$$,
 '55000','uploader_share_unavailable','a share the mitigation decision denies is refused at purpose-grant-create');
select is((pg_temp.grant_as('4','late','reports.monogenic','self','consent.own-monogenic','n-late-self'))->>'purposeKey',
 'reports.monogenic','... while that person''s own grant is still theirs to make');

-- 5. After the grants, the closed gate ----------------------------------------------
select is(pg_temp.r('main','2','ancestry'),'subject-bound-source',
 'the person''s granted layer stops at analysis-eligibility-v1''s subject-bound source gate');
select is(pg_temp.r('main','2','reports.monogenic'),'directional-purpose-grant-v1',
 'sharing a layer with the uploader does not grant it to the person''s own reading');
select is(pg_temp.r('main','1','reports.monogenic'),'subject-bound-source',
 'the uploader''s shared layer stops at the same gate');
select is(pg_temp.r('main','1','ancestry'),'directional-purpose-grant-v1','a layer not shared stays closed to the uploader');
select is(pg_temp.r('main','9','reports.monogenic'),'not-found','an outsider is still not found');
-- A held, confirmed file, with every grant in place, still starts nothing.
create temporary table held as select pg_temp.hold('main',pg_temp.sid('main'),repeat('e',64)) r;
select is(pg_temp.notice_session('main','1'),1::bigint,'the file''s notice opens');
select is(public.respond_adult_upload_revision_v1(repeat('1',64),'read-confirm-1111111111111111','confirm',pg_temp.a('2')),
 'confirmed','the person confirms the file');
select ok((select analysis_state='confirmed_blocked_current_gate' from public.other_adult_held_uploads
 where id=pg_temp.fxv('main','revision')::uuid),'the confirmed file stays confirmed_blocked_current_gate');
select is((select count(*) from public.worker_jobs where subject_id=pg_temp.sid('main'))
 +(select count(*) from public.genome_files where subject_id=pg_temp.sid('main')),0::bigint,
 'no job and no file row exist for it, grants or not');

-- 6. What each side sees ---------------------------------------------------------------
create temporary table choices as select public.path_b_person_choices_v1(pg_temp.a('2'),pg_temp.s('2'),true) c;
select is((select jsonb_array_length(c) from choices),1,'the person sees their one Path B subject');
select is((select jsonb_agg(k order by k) from choices,jsonb_object_keys(c->0) k),
 '["grants","label","readGate","subjectId","uploaderShare"]'::jsonb,'... with its grants, gates and share decision');
select is((select jsonb_agg((g->>'purpose')||'/'||(g->>'direction') order by g->>'purpose') from choices,
 jsonb_array_elements(c->0->'grants') g),'["ancestry/self", "reports.monogenic/uploader"]'::jsonb,
 '... and exactly the two grants they made');
select is((select c->0->'readGate'->>'ancestry' from choices),'subject-bound-source','... and the gate each layer stops at');
select is((select public.path_b_person_choices_v1(pg_temp.a('1'),pg_temp.s('1'),true)
 ||public.path_b_person_choices_v1(pg_temp.a('9'),pg_temp.s('9'),true)
 ||public.path_b_person_choices_v1(pg_temp.a('2'),pg_temp.s('2'),false)),'[]'::jsonb,
 'the uploader, an outsider and a call outside TEST-LOCAL see no one''s choices');
select is(public.path_b_uploader_shares_v1(pg_temp.a('1'),pg_temp.s('1'),true),
 jsonb_build_array(
  jsonb_build_object('label','Synthetic Relative','shared',
   jsonb_build_array(jsonb_build_object('purpose','reports.monogenic','gate','subject-bound-source'))),
  jsonb_build_object('label','Synthetic Relative','shared','[]'::jsonb)),
 'the uploader sees which layers each account-bound person shared, and the gate that still stands');
select throws_ok($$select public.path_b_uploader_shares_v1(pg_temp.a('1'),pg_temp.s('2'),true)$$,'42501','not_found',
 'another account''s session reads nothing');

-- 7. Revocation -------------------------------------------------------------------------------
create temporary table share_grant as select pg.grant_id from public.purpose_grants pg
 where pg.target_id=pg_temp.sid('main') and pg.purpose='reports.monogenic' and pg.revoked_at is null;
select throws_ok($$select public.revoke_directional_purpose_v1(pg_temp.a('1'),(select grant_id from share_grant))$$,
 '42501',null,'the uploader cannot end the person''s grant');
select lives_ok($$select public.revoke_directional_purpose_v1(pg_temp.a('2'),(select grant_id from share_grant))$$,
 'the person ends their share with the existing revocation');
select is(pg_temp.r('main','1','reports.monogenic'),'directional-purpose-grant-v1','the uploader''s layer closes again');

-- 8. Nothing reads the held source, the grants notwithstanding --------------------------------
create temporary table reader_calls(fn text, outcome text);
create function pg_temp.probe(p_account uuid,p_session uuid,p_target uuid) returns void language plpgsql as $$
declare f record; v_sql text; v_out text; v_rest text; v_needles text[]; v_done boolean;
begin
 v_needles:=array[pg_temp.fxv('main','final'),pg_temp.fxv('main','object'),pg_temp.fxv('main','raw'),
  pg_temp.fxv('main','upload'),pg_temp.fxv('main','staging')];
 for f in select p.oid,n.nspname,p.proname,p.proargtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace
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
   execute v_sql into v_out; v_done:=true;
   raise exception using errcode='P0001',message='probe_rollback';
  exception when others then
   insert into reader_calls values(f.nspname||'.'||f.proname,
    case when not v_done then 'refused' when exists(select 1 from unnest(v_needles) x where x is not null
     and x<>p_target::text and position(x in coalesce(v_out,''))>0) then 'LEAKED' else 'nothing-held' end);
  end;
 end loop;
end;
$$;
select pg_temp.probe(pg_temp.a('2'),pg_temp.s('2'),pg_temp.sid('main'));
select pg_temp.probe(pg_temp.a('1'),pg_temp.s('1'),pg_temp.sid('main'));
select pg_temp.probe(pg_temp.a('2'),pg_temp.s('2'),pg_temp.fxv('main','revision')::uuid);
select cmp_ok((select count(distinct fn) from reader_calls),'>=',100::bigint,'the probe found the whole function family');
select is((select coalesce(string_agg(distinct fn,', '),'') from reader_calls where outcome='LEAKED'),'',
 'with grants in place, no reader returns the held source to the person or the uploader');

-- 9. Deleting everything ends every grant -------------------------------------------------------
update public.profiles set deletion_requested_at=clock_timestamp() where id=pg_temp.a('2');
select lives_ok($$select public.expire_due_other_adult_held_uploads_v1()$$,'the person''s deletion request is swept');
select is((select count(*) from public.purpose_grants where target_id=pg_temp.sid('main') and revoked_at is null)
 +(select count(*) from public.directional_grants dg join public.purpose_grants pg on pg.grant_id=dg.grant_id
   where pg.target_id=pg_temp.sid('main') and dg.status='current')
 +(select count(*) from public.subject_relationships where subject_id=pg_temp.sid('main') and status='current'),0::bigint,
 'the purged subject keeps no grant, direction or uploader relationship');
select ok((select lifecycle='purged' from public.subjects where id=pg_temp.sid('main')),'... and is purged');

-- 10. Privileges -------------------------------------------------------------------------------------
select ok(not has_function_privilege('service_role','private.other_adult_mitigation_v1(uuid,uuid,text)','execute')
 and not has_function_privilege('service_role','private.path_b_result_read_v1(uuid,uuid,text)','execute')
 and not has_function_privilege('service_role','private.path_b_person_v1(uuid,uuid,uuid)','execute')
 and has_function_privilege('service_role',
  'public.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamp with time zone,boolean)','execute')
 and has_function_privilege('service_role','public.path_b_person_choices_v1(uuid,uuid,boolean)','execute')
 and has_function_privilege('service_role','public.path_b_uploader_shares_v1(uuid,uuid,boolean)','execute'),
 'the decisions are callable by no API role; the doors by the service role');
select is((select coalesce(string_agg(p.oid::regprocedure::text,', '),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('other_adult_mitigation_v1','path_b_person_v1',
  'grant_path_b_purpose_v1','path_b_result_read_v1','path_b_person_choices_v1','path_b_uploader_shares_v1',
  'end_purged_path_b_grants_v1')
  and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
   or has_function_privilege('inherit_upload_only',p.oid,'execute'))),'',
 'no browser or upload role can execute any reading-layer function');

select * from finish();
rollback;
