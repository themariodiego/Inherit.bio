begin;
select plan(14);
\ir fixtures/invitation_quota_keys.inc
-- global-contact-refusal-bar-v1.barKeyring for the co-parent path: a cohort
-- draft whose parent contact was keyed before a rotation is still invited and
-- accepted after it. Only synthetic accounts and digests; everything rolls back.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

insert into auth.users (id, email, raw_user_meta_data) values
 ('7e100000-0000-0000-0000-000000000001','keyring-owner@example.invalid','{"display_name":"Owner"}'),
 ('7e100000-0000-0000-0000-000000000002','keyring-parent@example.invalid','{"display_name":"Parent"}');
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
 ('7e100000-0000-4000-8000-0000000000a1','7e100000-0000-0000-0000-000000000001',
  clock_timestamp(), clock_timestamp(), 'aal1'),
 ('7e100000-0000-4000-8000-0000000000b1','7e100000-0000-0000-0000-000000000002',
  clock_timestamp(), clock_timestamp(), 'aal1');
select public.declare_jurisdiction_v1(account, session, 'GB',
  (select version from public.consent_artifacts
   where artifact_key = 'attestation.jurisdiction' and superseded_at is null),
  (select body_sha256 from public.consent_artifacts
   where artifact_key = 'attestation.jurisdiction' and superseded_at is null), false)
from (values
  ('7e100000-0000-0000-0000-000000000001'::uuid, '7e100000-0000-4000-8000-0000000000a1'::uuid),
  ('7e100000-0000-0000-0000-000000000002'::uuid, '7e100000-0000-4000-8000-0000000000b1'::uuid)
) as declared(account, session);

create temporary table d as
select n as name, encode(extensions.digest('hmac-keyring-cohort:'||n,'sha256'),'hex') as hmac
from unnest(array['o1','o2','p1','p2','s1','s2','t1','t2']) n;
create function pg_temp.h(p text) returns text language sql stable as
 $$ select hmac from d where name = p $$;
create function pg_temp.pair(p text) returns jsonb language sql stable as
 $$ select jsonb_build_object('1', pg_temp.h(p||'1'), '2', pg_temp.h(p||'2')) $$;

-- A draft named before rotation, keyed under revision 1 only.
create temporary table draft as select * from public.create_embryo_cohort_draft_v1(
 '7e100000-0000-0000-0000-000000000001','7e100000-0000-4000-8000-0000000000a1',
 'own_embryos','true_two_parent',3,decode('00112233445566778899aabbccddeeff','hex'),pg_temp.h('o1'),
 array['ffeeddccbbaa99887766554433221100'],array[pg_temp.h('p1')],'keyring-draft-nonce-aaaaaaaaaa',true);
select public.sign_embryo_artifact_v1(
 '7e100000-0000-0000-0000-000000000001','7e100000-0000-4000-8000-0000000000a1',
 'cohort_draft',(select draft_id from draft),'consent.upload-embryo',1,
 private.embryo_statement_keys_v1('consent.upload-embryo','parent'),decode('01','hex'),
 'GB','keyring-sign-nonce-aaaaaaaaaaa');

select lives_ok($$select private.begin_hmac_key_rotation_v1('contact', 2)$$,
 'the contact keyring rotates while the draft is open');
select throws_ok($$select * from public.create_embryo_draft_invitation_v1(
 '7e100000-0000-0000-0000-000000000001','7e100000-0000-4000-8000-0000000000a1',
 (select draft_id from draft),pg_temp.h('p1'),repeat('3',64),'keyring-invite-legacy-aaaaaa',true,
 p_quota_keys => pg_temp.invitation_quota_keys())$$,
 '55000','keyed digest set required','a bare parent digest is refused after rotation');

create temporary table inv as select * from public.create_embryo_draft_invitation_v1(
 '7e100000-0000-0000-0000-000000000001','7e100000-0000-4000-8000-0000000000a1',
 (select draft_id from draft),null,repeat('3',64),'keyring-invite-nonce-aaaaaaaa',true,
 p_contact_hmac_set => pg_temp.pair('p'), p_quota_keys => pg_temp.invitation_quota_keys());
select ok((select invitation_id from inv) is not null,
 'the parent named before rotation is still invited under the rotated keyring');
select is((select email_hmac||':'||email_hmac_key_revision from public.subject_invitations
 where id=(select invitation_id from inv)), pg_temp.h('p1')||':1',
 'the invitation keeps the revision its draft contact was written under');

create temporary table claimed as select * from public.claim_mail_outbox();
create temporary table tok as select encode(extensions.digest(
 convert_to((select delivery_token from claimed),'UTF8'),'sha256'),'hex') as token_hash;
select is((select count(*) from public.activate_rights_session_v1(
 (select token_hash from tok), repeat('c',64), 'keyring-form-nonce-aaaaaaaaaa')), 1::bigint,
 'the invitation opens a rights session');
select throws_ok($$select public.accept_embryo_co_parent_invitation_v1(
 repeat('c',64),'7e100000-0000-0000-0000-000000000002',null,decode('deadbeef','hex'),'GB',
 private.embryo_statement_keys_v1('consent.upload-embryo','parent'),
 private.embryo_statement_keys_v1('attestation.embryo-parentage'),
 'keyring-accept-wrong-aaaaaaaa',pg_temp.pair('t'))$$,
 '42501','address does not match','another address cannot accept');
select is(public.accept_embryo_co_parent_invitation_v1(
 repeat('c',64),'7e100000-0000-0000-0000-000000000002',null,decode('deadbeef','hex'),'GB',
 private.embryo_statement_keys_v1('consent.upload-embryo','parent'),
 private.embryo_statement_keys_v1('attestation.embryo-parentage'),
 'keyring-accept-nonce-aaaaaaaa',pg_temp.pair('p')),
 (select draft_id from draft),
 'the co-parent accepts through a session whose invitation predates rotation');

-- A draft named during the overlap is written under revision 2 and indexed
-- under both revisions.
select throws_ok($$select * from public.create_embryo_cohort_draft_v1(
 '7e100000-0000-0000-0000-000000000001','7e100000-0000-4000-8000-0000000000a1',
 'own_embryos','true_two_parent',3,decode('00112233445566778899aabbccddeeff','hex'),pg_temp.h('o1'),
 array['ffeeddccbbaa99887766554433221100'],array[pg_temp.h('s1')],'keyring-draft2-legacy-aaaaaa',true)$$,
 '55000','keyed digest set required','a bare owner digest is refused after rotation');
create temporary table draft2 as select * from public.create_embryo_cohort_draft_v1(
 '7e100000-0000-0000-0000-000000000001','7e100000-0000-4000-8000-0000000000a1',
 'own_embryos','true_two_parent',3,decode('00112233445566778899aabbccddeeff','hex'),null,
 array['ffeeddccbbaa99887766554433221100'],null,'keyring-draft2-nonce-aaaaaaaaa',true,
 pg_temp.pair('o'), jsonb_build_array(pg_temp.pair('s')));
select is((select e.contact_hmac||':'||e.key_revision
 from public.draft_participant_slots s
 join public.encrypted_contact_references e on e.principal_id=s.principal_id and e.status='current'
 where s.embryo_draft_id=(select draft_id from draft2) and s.state='pending'),
 pg_temp.h('s2')||':2', 'the named parent is stored under the active revision');
select is((select array_agg(h.hmac_key_revision||':'||h.contact_hmac order by h.hmac_key_revision)
 from public.draft_participant_slots s
 join public.encrypted_contact_references e on e.principal_id=s.principal_id and e.status='current'
 join public.contact_hmac_indexes h on h.contact_reference_id=e.id
 where s.embryo_draft_id=(select draft_id from draft2) and s.state='pending'),
 array['1:'||pg_temp.h('s1'), '2:'||pg_temp.h('s2')],
 'and indexed under both usable revisions');
select is((select e.key_revision
 from public.draft_participant_slots s
 join public.encrypted_contact_references e on e.principal_id=s.principal_id and e.status='current'
 where s.embryo_draft_id=(select draft_id from draft2) and s.slot_kind='parent_a'),
 2::bigint, 'the owner''s own contact is stored under the active revision too');
select throws_ok($$select * from public.create_embryo_cohort_draft_v1(
 '7e100000-0000-0000-0000-000000000001','7e100000-0000-4000-8000-0000000000a1',
 'own_embryos','true_two_parent',3,decode('00112233445566778899aabbccddeeff','hex'),null,
 array['ffeeddccbbaa99887766554433221100'],null,'keyring-draft3-nonce-aaaaaaaaa',true,
 pg_temp.pair('o'), jsonb_build_array(jsonb_build_object('2', pg_temp.h('s2'))))$$,
 '55000','keyed digest set incomplete','a contact set missing a usable revision is refused');
select is(current_setting('inherit.contact_alias_groups', true), '{}',
 'no declared contact set outlives the call that declared it');

select ok(not has_function_privilege('service_role', f, 'execute'),
 'the service role cannot bypass the keyed door through '||f)
from unnest(array[
 'private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)'
]) f;

select * from finish();
rollback;
