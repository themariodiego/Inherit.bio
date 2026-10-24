begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
-- D-103, Path A (20261025400000_path_a_account_accept_typed_name.sql; owner
-- decision of 23 October 2026, "D-103: Path A acceptance includes a typed
-- name"). An adult accepting through their own account types their name; the
-- application encrypts it as Path B's e-signature does, and the account door
-- api.invitation-accept calls (public.accept_adult_subject_invitation_v1)
-- hands the ciphertext to the shared acceptance body for exactly one call.
-- The body writes it on the signature and confirms nothing for a caller that
-- declares no name, so the rights-session door api.withdraw used and the
-- mailed-token door accept nothing any more. Refusing is unchanged.
--
-- The last section runs the migration's guarded-patch body itself (the
-- function below is that body byte for byte; scripts/path-a-account-accept-
-- migration.test.ts holds the two texts equal) through every path it can
-- take: a predecessor, an ACL, a missing or repeated anchor and a successor
-- that differ each raise 55000, and the migration cannot be applied twice.
--
-- Every account, session, address, name and digest is synthetic, and
-- everything rolls back.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

do $$ declare n integer; begin
 for n in 1..3 loop
  insert into auth.users(id,email,email_confirmed_at) values(('7d1a0000-0000-4000-8000-00000000000'||n)::uuid,
   'path-a-name-'||n||'@example.invalid',now());
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(('7d1a0000-0000-4000-8000-00000000001'||n)::uuid,
   ('7d1a0000-0000-4000-8000-00000000000'||n)::uuid,now(),now(),'aal1');
 end loop;
 -- The invited adult's ended session.
 insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values('7d1a0000-0000-4000-8000-000000000014',
  '7d1a0000-0000-4000-8000-000000000002',now(),now(),'aal1',now()-interval '1 minute');
end $$;
create function pg_temp.account(n integer) returns uuid language sql immutable as $$ select ('7d1a0000-0000-4000-8000-00000000000'||n)::uuid $$;
create function pg_temp.session(n integer) returns uuid language sql immutable as $$ select ('7d1a0000-0000-4000-8000-00000000001'||n)::uuid $$;
create function pg_temp.hash(label text) returns text language sql immutable as $$ select encode(extensions.digest(convert_to(label,'UTF8'),'sha256'),'hex') $$;
-- The invited address is digest a…a, under the one contact revision held here.
create function pg_temp.invited() returns jsonb language sql immutable as $$ select jsonb_build_object('1',repeat('a',64)) $$;
-- Synthetic ciphertext: 28 bytes, the shape the application's AES-GCM output has at its shortest.
create function pg_temp.name() returns bytea language sql immutable as $$ select decode(repeat('5a',28),'hex') $$;

-- One pending Path A invitation, opened through its mailed token.
create temporary table inv as select * from public.create_adult_subject_invitation_v1(
 pg_temp.account(1),decode('00112233445566778899aabbccddeeff','hex'),repeat('a',64),repeat('b',64),true,
 p_quota_keys => pg_temp.invitation_quota_keys());
create temporary table delivery as select * from public.claim_mail_outbox();
create temporary table tok as select encode(extensions.digest(
 convert_to((select delivery_token from delivery),'UTF8'),'sha256'),'hex') as hash;
select is((select count(*) from public.activate_rights_session_v1((select hash from tok),repeat('d',64),
 'path-a-name-open-aaaaaaaaaaaa')),1::bigint,'the mailed token opens one rights session');

create function pg_temp.accept(nonce text,acting integer,auth integer,contact jsonb,name bytea,
 session_hash text default repeat('d',64)) returns uuid language sql as $$
 select public.accept_adult_subject_invitation_v1(session_hash,nonce,pg_temp.account(acting),
  pg_temp.session(auth),contact,name);
$$;
create function pg_temp.attempt(nonce text,acting integer,auth integer,contact jsonb,name bytea)
returns text language plpgsql as $$
begin
 return coalesce(pg_temp.accept(nonce,acting,auth,contact,name)::text,'null');
exception when others then return sqlstate;
end $$;
create function pg_temp.untouched() returns boolean language sql as $$
 select (select lifecycle='draft' and subject_account_id is null from public.subjects where id=(select subject_id from inv))
  and (select status='active' from public.rights_sessions where session_hash=repeat('d',64))
  and (select status='pending' from public.subject_invitations where id=(select invitation_id from inv))
  and not exists(select 1 from public.consent_signatures where target_id=(select subject_id from inv));
$$;

-- 1. The migration: the shared body is its reviewed successor, and the door is service-only.
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p
  where p.oid='private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)'::regprocedure),
 '99dfdec657617a2b4850f6632693ef51 {postgres=X/postgres}','the shared acceptance body is the reviewed successor, its ACL unchanged');
select is((select proacl::text from pg_proc where oid=s::regprocedure),'{postgres=X/postgres,service_role=X/postgres}',
 s||' is owner and service role only') from unnest(array[
  'public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)',
  'private.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)']) s;
select ok(not has_function_privilege(r,'public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)','execute'),
 r||' may not call the door') from unnest(array['anon','authenticated','inherit_upload_only']) r;

-- 2. A request without a name, or without the account's own live session, reads and consumes nothing.
select is(pg_temp.accept('path-a-name-none-aaaaaaaaaaaa',2,2,pg_temp.invited(),null),null,'no name: nothing');
select is(pg_temp.accept('path-a-name-short-aaaaaaaaaaa',2,2,pg_temp.invited(),decode(repeat('5a',15),'hex')),null,
 'fifteen bytes is not a ciphertext: nothing');
select is(pg_temp.accept('path-a-name-hash-aaaaaaaaaaaa',2,2,pg_temp.invited(),pg_temp.name(),'not-a-session-hash'),null,
 'a malformed session hash: nothing');
select is(public.accept_adult_subject_invitation_v1(repeat('d',64),'path-a-name-acct-aaaaaaaaaaaa',null,pg_temp.session(2),
 pg_temp.invited(),pg_temp.name()),null,'no account: nothing');
select is(pg_temp.accept('path-a-name-set-aaaaaaaaaaaaa',2,2,null,pg_temp.name()),null,'no keyed address: nothing');
select is(pg_temp.accept('path-a-name-other-auth-aaaaaa',2,3,pg_temp.invited(),pg_temp.name()),null,
 'another account''s auth session: nothing');
select is(pg_temp.accept('path-a-name-ended-auth-aaaaaa',2,4,pg_temp.invited(),pg_temp.name()),null,
 'the account''s ended auth session: nothing');
select is(pg_temp.accept('path-a-name-unknown-aaaaaaaaa',2,2,pg_temp.invited(),pg_temp.name(),repeat('9',64)),null,
 'an unknown rights session: nothing');
select is((select count(*) from public.embryo_operation_nonces where nonce_hash in (select pg_temp.hash(n) from unnest(array[
  'path-a-name-none-aaaaaaaaaaaa','path-a-name-short-aaaaaaaaaaa','path-a-name-hash-aaaaaaaaaaaa','path-a-name-acct-aaaaaaaaaaaa',
  'path-a-name-set-aaaaaaaaaaaaa','path-a-name-other-auth-aaaaaa','path-a-name-ended-auth-aaaaaa','path-a-name-unknown-aaaaaaaaa']) n)),
 0::bigint,'none of those consumed its nonce');
select ok(pg_temp.untouched(),'and the invitation, session and reserved subject are as they were');

-- 3. Only the invited address's own account accepts; the nonce is spent either way.
select is(pg_temp.accept('path-a-name-wrong-mail-aaaaaa',3,3,jsonb_build_object('1',repeat('f',64)),pg_temp.name()),null,
 'an account with another address does not accept');
select is(pg_temp.accept('path-a-name-inviter-aaaaaaaaa',1,1,pg_temp.invited(),pg_temp.name()),null,
 'the inviter never accepts, even holding the invited digest');
select ok(pg_temp.untouched(),'neither attempt accepted anything');
select is(pg_temp.attempt('path-a-name-wrong-mail-aaaaaa',2,2,pg_temp.invited(),pg_temp.name()),'23505',
 'a nonce already spent cannot accept');
select ok(exists(select 1 from public.embryo_operation_nonces where nonce_hash=pg_temp.hash('path-a-name-wrong-mail-aaaaaa')
  and operation='invitation_accept' and account_id=pg_temp.account(3)),'a refused attempt still spent its nonce');

-- 4. The doors that declare no name confirm nothing.
select is(public.respond_adult_subject_invitation_session_v1(repeat('d',64),'confirm','path-a-name-old-door-aaaaaaa',
 pg_temp.account(2),null,pg_temp.invited()),'unavailable','the rights-session door api.withdraw used accepts nothing');
select ok(pg_temp.untouched(),'and wrote nothing');
create temporary table inv3 as select * from public.create_adult_subject_invitation_v1(
 pg_temp.account(1),decode('00112233445566778899aabbccddee00','hex'),repeat('c',64),repeat('e',64),true,
 p_quota_keys => pg_temp.invitation_quota_keys());
create temporary table delivery3 as select * from public.claim_mail_outbox();
create temporary table tok3 as select encode(extensions.digest(
 convert_to((select delivery_token from delivery3),'UTF8'),'sha256'),'hex') as hash;
select is(public.respond_adult_subject_invitation_v1((select hash from tok3),'confirm',pg_temp.account(2),repeat('c',64)),
 'unavailable','the mailed-token door accepts nothing either');
select is((select lifecycle from public.subjects where id=(select subject_id from inv3)),'draft',
 'and its reserved subject stays a draft');
select is((select status from public.token_hashes where token_hash=(select hash from tok3)),'current',
 'and its token is still the person''s to use');

-- 5. The invited adult accepts, and the signature carries the name's ciphertext.
-- Each request is its own transaction in the product; this suite is one, so
-- the actor the refused attempts above noted is cleared first.
select set_config('inherit.legal_audit_actor','',true);
select is(pg_temp.accept('path-a-name-accept-aaaaaaaaaa',2,2,pg_temp.invited(),pg_temp.name()),
 (select subject_id from inv),'the invited adult''s own account accepts and the door names the subject');
select is((select row(owner_account_id,subject_account_id,lifecycle)::text from public.subjects where id=(select subject_id from inv)),
 row(null::uuid,pg_temp.account(2),'active')::text,'the subject is the accepting account''s own, and active');
select is((select signing_name_encrypted from public.consent_signatures where target_id=(select subject_id from inv)
  and purpose='adult-subject-account-acceptance'),pg_temp.name(),'the signature stores exactly the ciphertext it was given');
select is((select statement_keys from public.consent_signatures where target_id=(select subject_id from inv)
  and purpose='adult-subject-account-acceptance'),
 array['age-18-plus','mailbox-control','no-inviter-access','identity-not-verified','revocable'],
 'with the five published statement keys, in order');
select is((select signer_account_id from public.consent_signatures where target_id=(select subject_id from inv)),
 pg_temp.account(2),'signed by the accepting account');
select ok(exists(select 1 from public.embryo_operation_nonces where nonce_hash=pg_temp.hash('path-a-name-accept-aaaaaaaaaa')
  and operation='invitation_accept' and account_id=pg_temp.account(2) and session_id=pg_temp.session(2)
  and target_kind='rights_session' and target_id=(select id from public.rights_sessions where session_hash=repeat('d',64))),
 'the nonce is recorded for this account, auth session and rights session');
select is((select status from public.subject_invitations where id=(select invitation_id from inv)),'accepted','the invitation is answered');
select is((select status from public.rights_sessions where session_hash=repeat('d',64)),'consumed','the rights session is spent');
select is(current_setting('inherit.adult_subject_signing_name',true),'','the declaration is cleared after the call');
select ok(exists(select 1 from public.legal_audit_log where event_code='invitation.accepted'
  and route_id='api.invitation-accept' and audit_principal_id is not null
  and audit_principal_id=(select audit_principal_id from private.legal_audit_account_principals where account_id=pg_temp.account(2))),
 'the accepted event names api.invitation-accept and the accepting account''s pseudonym');
select is((select count(*) from public.purpose_grants where target_id=(select subject_id from inv)),0::bigint,
 'acceptance grants no purpose');
select is(pg_temp.accept('path-a-name-again-aaaaaaaaaaa',2,2,pg_temp.invited(),pg_temp.name()),null,
 'the spent session cannot accept twice');

-- 6. Refusing is unchanged and needs no name or account.
select is((select count(*) from public.activate_rights_session_v1((select hash from tok3),repeat('7',64),
 'path-a-name-open-bbbbbbbbbbbb')),1::bigint,'the second invitation opens its own session');
select is(public.respond_adult_subject_invitation_session_v1(repeat('7',64),'refuse','path-a-name-refuse-aaaaaaaaaa'),
 'refused','refusing needs no account and no name');
select is((select lifecycle from public.subjects where id=(select subject_id from inv3)),'purged','refusal closes the reservation');

-- 7. The migration's guarded-patch body, through each of its paths.
create type pg_temp.patch_item as (ordinal integer,target text,before_md5 text,after_md5 text,acl text,
 old_fragment text,new_fragment text,label text);
create function pg_temp.guarded_patch(item pg_temp.patch_item) returns void language plpgsql as $guarded$
declare definition text;before_acl aclitem[];
begin
  select pg_get_functiondef(p.oid),p.proacl into definition,before_acl from pg_proc p
   where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;
  if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;
  if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then
   raise exception using errcode='55000',message=item.label||' anchor differs';end if;
  execute replace(definition,item.old_fragment,item.new_fragment);
  if not exists(select 1 from pg_proc p where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.after_md5
    and p.proacl is not distinct from before_acl) then
   raise exception using errcode='55000',message=item.label||' successor differs';end if;
end $guarded$;

-- Applied twice: the shared body is no longer the predecessor the first patch names.
select throws_ok($$select pg_temp.guarded_patch(row(1,'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)',
 '824901bf47066e4e974bd90f2b1c7110','d59e9ff8a73fc1793e6fbce77c26461f','{postgres=X/postgres}',
 '  v_terminal_status text;'||chr(10)||'begin','  v_terminal_status text;'||chr(10)||'  v_signing_name bytea;'||chr(10)||'begin',
 'adult acceptance name variable')::pg_temp.patch_item)$$,'55000','adult acceptance name variable predecessor differs',
 'the migration cannot be applied twice');

-- A probe function stands for a patched one.
create function private.path_a_guard_probe_v0() returns text language sql as $probe$ select 'one anchor, then two two'::text $probe$;
revoke all on function private.path_a_guard_probe_v0() from public,anon,authenticated,inherit_upload_only,service_role;
create function pg_temp.probe_md5() returns text language sql as $$
 select md5(pg_get_functiondef('private.path_a_guard_probe_v0()'::regprocedure)) $$;
create function pg_temp.probe_item(before_md5 text,after_md5 text,acl text,old_fragment text,new_fragment text)
returns pg_temp.patch_item language sql as $$
 select row(1,'private.path_a_guard_probe_v0()',before_md5,after_md5,acl,old_fragment,new_fragment,'probe')::pg_temp.patch_item $$;
create temporary table probe as select pg_temp.probe_md5() as before_md5,
 md5(replace(pg_get_functiondef('private.path_a_guard_probe_v0()'::regprocedure),'one anchor','one patched anchor')) as after_md5;

select throws_ok($$select pg_temp.guarded_patch(pg_temp.probe_item(md5('another body'),(select after_md5 from probe),
 '{postgres=X/postgres}','one anchor','one patched anchor'))$$,'55000','probe predecessor differs','a predecessor that differs is refused');
select throws_ok($$select pg_temp.guarded_patch(pg_temp.probe_item((select before_md5 from probe),(select after_md5 from probe),
 '{postgres=X/postgres,service_role=X/postgres}','one anchor','one patched anchor'))$$,'55000','probe predecessor differs',
 'an ACL that differs is refused');
select throws_ok($$select pg_temp.guarded_patch(pg_temp.probe_item((select before_md5 from probe),(select after_md5 from probe),
 '{postgres=X/postgres}','no such anchor','one patched anchor'))$$,'55000','probe anchor differs','a missing anchor is refused');
select throws_ok($$select pg_temp.guarded_patch(pg_temp.probe_item((select before_md5 from probe),(select after_md5 from probe),
 '{postgres=X/postgres}','two','three'))$$,'55000','probe anchor differs','a repeated anchor is refused');
select throws_ok($$select pg_temp.guarded_patch(pg_temp.probe_item((select before_md5 from probe),md5('another successor'),
 '{postgres=X/postgres}','one anchor','one patched anchor'))$$,'55000','probe successor differs','a successor that differs is refused');
select is(pg_temp.probe_md5(),(select before_md5 from probe),'and the refused patch left the function as it was');
select lives_ok($$select pg_temp.guarded_patch(pg_temp.probe_item((select before_md5 from probe),(select after_md5 from probe),
 '{postgres=X/postgres}','one anchor','one patched anchor'))$$,'the exact predecessor, ACL, anchor and successor patch');
select is(private.path_a_guard_probe_v0(),'one patched anchor, then two two','the patch took effect');
select is((select proacl::text from pg_proc where oid='private.path_a_guard_probe_v0()'::regprocedure),'{postgres=X/postgres}',
 'and the ACL is unchanged');

select * from finish();
rollback;
