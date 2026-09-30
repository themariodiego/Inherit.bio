begin;
select plan(54);
\ir fixtures/invitation_quota_keys.inc
-- global-contact-refusal-bar-v1.barKeyring, before, during and after a
-- contact key rotation. Only synthetic accounts and synthetic digests; the
-- outer transaction rolls everything back, including the keyring itself.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');

insert into auth.users (id, email, raw_user_meta_data) values
 ('7e000000-0000-0000-0000-000000000001','keyring-inviter-a@example.invalid','{"display_name":"A"}'),
 ('7e000000-0000-0000-0000-000000000002','keyring-inviter-b@example.invalid','{"display_name":"B"}'),
 ('7e000000-0000-0000-0000-000000000003','keyring-recipient@example.invalid','{"display_name":"R"}');

-- One synthetic address per letter, under key revisions 1 and 2. The database
-- never sees an address; it sees these digests, as it would from the app.
create temporary table d as
select n as name, encode(extensions.digest('hmac-keyring-rotation:'||n,'sha256'),'hex') as hmac
from unnest(array['x1','x2','y1','y2','z1','z2','r1','r2','w1','w2','q1','q2']) n;
create function pg_temp.h(p text) returns text language sql stable as
 $$ select hmac from d where name = p $$;
create function pg_temp.pair(p text) returns jsonb language sql stable as
 $$ select jsonb_build_object('1', pg_temp.h(p||'1'), '2', pg_temp.h(p||'2')) $$;

-- Issue an adult invitation and return the digest of its mailed token.
create function pg_temp.invite(p_inviter uuid, p_legacy text, p_set jsonb)
returns table (invitation_id uuid, token_hash text) language plpgsql as $$
declare v_id uuid; v_token text;
begin
 update public.mail_outbox set state='invalidated' where state in ('queued','claimed');
 select i.invitation_id into v_id from public.create_adult_subject_invitation_v1(
  p_inviter, decode('00112233445566778899aabbccddeeff','hex'), p_legacy,
  encode(extensions.gen_random_bytes(32),'hex'), true,
  p_contact_hmac_set => p_set, p_quota_keys => pg_temp.invitation_quota_keys()) i;
 if v_id is not null then
  select encode(extensions.digest(convert_to(c.delivery_token,'UTF8'),'sha256'),'hex')
   into v_token from public.claim_mail_outbox() c;
 end if;
 return query select v_id, v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- Before rotation: one usable revision, and a bare digest is a complete set.
select is((select array_agg(keyring||':'||key_revision||':'||state order by keyring, key_revision)
 from private.hmac_key_versions), array['contact:1:active','rate-limit:1:active'],
 'each keyring starts with revision 1 active');

create temporary table inv_x as select * from pg_temp.invite(
 '7e000000-0000-0000-0000-000000000001', pg_temp.h('x1'), null);
select is((select email_hmac_key_revision from public.subject_invitations
 where id=(select invitation_id from inv_x)), 1::bigint,
 'a bare digest before rotation is stored as revision 1');

create temporary table inv_y as select * from pg_temp.invite(
 '7e000000-0000-0000-0000-000000000001', pg_temp.h('y1'), null);
select is(public.respond_adult_subject_invitation_v1((select token_hash from inv_y),'refuse'),
 'refused', 'address y refuses before rotation');
select is((select hmac_key_revision from public.invitation_refusal_hmacs where email_hmac=pg_temp.h('y1')),
 1::bigint, 'the pre-rotation bar is recorded under revision 1');

create temporary table inv_r as select * from pg_temp.invite(
 '7e000000-0000-0000-0000-000000000001', pg_temp.h('r1'), null);
select is((select count(*) from public.activate_rights_session_v1(
 (select token_hash from inv_r), repeat('5',64), 'keyring-session-open-aaaaaaa')), 1::bigint,
 'a revision-1 invitation opens a rights session before rotation');

create temporary table inv_w_old as select * from pg_temp.invite(
 '7e000000-0000-0000-0000-000000000002', pg_temp.h('w1'), null);
select ok((select invitation_id from inv_w_old) is not null,
 'another inviter has a pending revision-1 invitation to address w');

-- ---------------------------------------------------------------------------
-- Rotation.
select lives_ok($$select private.begin_hmac_key_rotation_v1('contact', 2)$$,
 'the operator makes revision 2 active');
select is((select array_agg(key_revision||':'||state order by key_revision)
 from private.hmac_key_versions where keyring='contact'), array['1:retiring','2:active'],
 'revision 1 keeps matching as retiring while revision 2 is written');
select throws_ok($$select private.begin_hmac_key_rotation_v1('contact', 5)$$,
 '22023', 'key revision must follow the newest', 'a rotation cannot skip revisions');
select is((select array_agg(key_revision||':'||state order by key_revision)
 from private.hmac_key_versions where keyring='rate-limit'), array['1:active'],
 'the rate-limit keyring rotates independently');

-- A request that cannot present every usable revision is refused, never
-- matched with less: that is the invitation gap rotation must not open.
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 '7e000000-0000-0000-0000-000000000002', decode('00112233445566778899aabbccddeeff','hex'),
 pg_temp.h('q1'), repeat('6',64), true, p_quota_keys => pg_temp.invitation_quota_keys())$$,
 '55000', 'keyed digest set required', 'a bare digest is refused once the keyring has rotated');
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 '7e000000-0000-0000-0000-000000000002', decode('00112233445566778899aabbccddeeff','hex'),
 null, repeat('6',64), true, p_contact_hmac_set => jsonb_build_object('1', pg_temp.h('q1')),
 p_quota_keys => pg_temp.invitation_quota_keys())$$,
 '55000', 'keyed digest set incomplete', 'a set missing the active revision is refused');
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 '7e000000-0000-0000-0000-000000000002', decode('00112233445566778899aabbccddeeff','hex'),
 null, repeat('6',64), true, p_contact_hmac_set => jsonb_build_object('2', pg_temp.h('q2')),
 p_quota_keys => pg_temp.invitation_quota_keys())$$,
 '55000', 'keyed digest set incomplete', 'a set missing the retiring revision is refused');
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 '7e000000-0000-0000-0000-000000000002', decode('00112233445566778899aabbccddeeff','hex'),
 null, repeat('6',64), true,
 p_contact_hmac_set => jsonb_build_object('1', pg_temp.h('q1'), '2', pg_temp.h('q1')),
 p_quota_keys => pg_temp.invitation_quota_keys())$$,
 '22023', 'keyed digest set invalid', 'one digest under two revisions is refused');
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 '7e000000-0000-0000-0000-000000000002', decode('00112233445566778899aabbccddeeff','hex'),
 pg_temp.h('z1'), repeat('6',64), true, p_contact_hmac_set => pg_temp.pair('q'),
 p_quota_keys => pg_temp.invitation_quota_keys())$$,
 '22023', 'keyed digest set invalid', 'a bare digest must agree with the set it travels with');

-- No gap: the revision-1 bar still stops an invitation presented under both.
create temporary table y_again as select * from pg_temp.invite(
 '7e000000-0000-0000-0000-000000000002', null, pg_temp.pair('y'));
select ok((select invitation_id from y_again) is null,
 'a pre-rotation refusal still bars the address when it arrives under revision 2');
select is((select count(*) from public.subject_invitations
 where email_hmac in (pg_temp.h('y1'), pg_temp.h('y2')) and status='pending'), 0::bigint,
 'the barred attempt writes no invitation');

-- New rows are written under the active revision and indexed under both.
create temporary table inv_z as select * from pg_temp.invite(
 '7e000000-0000-0000-0000-000000000002', pg_temp.h('z1'), pg_temp.pair('z'));
select is((select email_hmac||':'||email_hmac_key_revision from public.subject_invitations
 where id=(select invitation_id from inv_z)), pg_temp.h('z2')||':2',
 'a new invitation stores the active revision''s digest');
select is((select e.key_revision from public.encrypted_contact_references e
 join public.invitation_candidates c on c.contact_reference_id=e.id
 where c.invitation_id=(select invitation_id from inv_z)), 2::bigint,
 'its contact reference records revision 2');
select is((select array_agg(h.hmac_key_revision||':'||h.contact_hmac order by h.hmac_key_revision)
 from public.contact_hmac_indexes h join public.invitation_candidates c
  on c.contact_reference_id=h.contact_reference_id
 where c.invitation_id=(select invitation_id from inv_z)),
 array['1:'||pg_temp.h('z1'), '2:'||pg_temp.h('z2')],
 'the contact is indexed under every usable revision');

-- A live session opened under revision 1 is not stranded by rotation.
select throws_ok($$select public.respond_adult_subject_invitation_session_v1(
 repeat('5',64), 'confirm', 'keyring-session-legacy-aaaaaaa',
 '7e000000-0000-0000-0000-000000000003', pg_temp.h('r1'))$$,
 '55000', 'keyed digest set required',
 'after rotation the account address must be presented under every usable revision');
select is(public.respond_adult_subject_invitation_session_v1(
 repeat('5',64), 'confirm', 'keyring-session-wrong-aaaaaaaa',
 '7e000000-0000-0000-0000-000000000003', null, pg_temp.pair('q')),
 'unavailable', 'a different address still cannot accept');
select is(public.respond_adult_subject_invitation_session_v1(
 repeat('5',64), 'confirm', 'keyring-session-accept-aaaaaaa',
 '7e000000-0000-0000-0000-000000000003', null, pg_temp.pair('r')),
 'accepted', 'the revision-1 session still accepts under the rotated keyring');

-- A refusal under revision 2 bars the address under revision 1 as well, so the
-- other inviter's pending revision-1 invitation stops working.
create temporary table inv_w as select * from pg_temp.invite(
 '7e000000-0000-0000-0000-000000000001', null, pg_temp.pair('w'));
select ok((select invitation_id from inv_w) is not null,
 'address w is invited again during the overlap');
select is(public.respond_adult_subject_invitation_v1((select token_hash from inv_w),'refuse'),
 'refused', 'address w refuses the revision-2 invitation');
select is((select array_agg(email_hmac||':'||hmac_key_revision order by hmac_key_revision)
 from public.invitation_refusal_hmacs where email_hmac in (pg_temp.h('w1'), pg_temp.h('w2'))),
 array[pg_temp.h('w1')||':1', pg_temp.h('w2')||':2'],
 'the refusal bars the address under both revisions');
select is((select count(distinct expires_at) from public.invitation_refusal_hmacs
 where email_hmac in (pg_temp.h('w1'), pg_temp.h('w2'))), 1::bigint,
 'both bars carry the refusal''s one deadline');
select is((select count(*) from public.contact_refusal_bars
 where contact_hmac = pg_temp.h('w1') and expires_at > clock_timestamp()), 1::bigint,
 'the target bar is copied to revision 1 too');
select ok(private.invitation_contact_barred_v1(pg_temp.h('w1')),
 'the revision-1 digest alone now reads as barred');
select is((select count(*) from public.activate_rights_session_v1(
 (select token_hash from inv_w_old), repeat('4',64), 'keyring-session-w-old-aaaaaa')), 0::bigint,
 'the other inviter''s revision-1 invitation can no longer open a session');

-- ---------------------------------------------------------------------------
-- Retirement.
select throws_ok($$select private.retire_hmac_key_version_v1('contact', 2)$$,
 '55000', 'only a retiring key revision can retire', 'the active revision cannot retire');
select throws_ok($$select private.retire_hmac_key_version_v1('contact', 1)$$,
 '55000', 'key revision still protects live rows',
 'revision 1 cannot retire while its bars and pending invitations are live');
select ok(private.hmac_key_revision_in_use_v1('contact', 1), 'revision 1 is still in use');

-- Let every revision-1 dependency lapse, as time would. The shared local
-- database may hold other revision-1 rows; this rolls back with the rest.
update public.contact_refusal_bars set created_at=clock_timestamp()-interval '400 days',
 expires_at=clock_timestamp()-interval '1 day' where hmac_key_revision=1;
update public.invitation_refusal_hmacs set created_at=clock_timestamp()-interval '400 days',
 expires_at=clock_timestamp()-interval '1 day' where hmac_key_revision=1;
select ok(private.hmac_key_revision_in_use_v1('contact', 1),
 'expired bars alone do not release revision 1 while invitations are pending');
update public.subject_invitations set status='expired', terminal_at=clock_timestamp()
 where email_hmac_key_revision=1 and status='pending';
update public.contact_hmac_indexes set status='expired'
 where hmac_key_revision=1 and status='current';
update public.subject_control_refusal_authorities set status='expired' where status='current';
select ok(not private.hmac_key_revision_in_use_v1('contact', 1),
 'nothing live depends on revision 1 any more');
select lives_ok($$select private.retire_hmac_key_version_v1('contact', 1)$$,
 'revision 1 retires once nothing depends on it');
select is((select array_agg(key_revision||':'||state order by key_revision)
 from private.hmac_key_versions where keyring='contact'), array['1:retired','2:active'],
 'revision 1 is retired');

-- After retirement the old key matches nothing: its digest is dropped from
-- every presented set, and a bare digest (revision 1 by construction) is refused.
select is(private.resolve_hmac_set_v1('contact', null, pg_temp.pair('x')),
 jsonb_build_object('2', pg_temp.h('x2')), 'a retired revision is dropped from a presented set');
select is(private.presented_contact_digest_v1(
 private.resolve_hmac_set_v1('contact', null, pg_temp.pair('x')), pg_temp.h('x1'), 1),
 pg_temp.h('x2'), 'a stored revision-1 digest is no longer matched by a presented set');
select throws_ok($$select * from public.create_adult_subject_invitation_v1(
 '7e000000-0000-0000-0000-000000000002', decode('00112233445566778899aabbccddeeff','hex'),
 pg_temp.h('q1'), repeat('6',64), true, p_quota_keys => pg_temp.invitation_quota_keys())$$,
 '55000', 'keyed digest set required', 'a bare revision-1 digest stays refused after retirement');
create temporary table inv_q as select * from pg_temp.invite(
 '7e000000-0000-0000-0000-000000000002', null, jsonb_build_object('2', pg_temp.h('q2')));
select is((select email_hmac_key_revision from public.subject_invitations
 where id=(select invitation_id from inv_q)), 2::bigint,
 'after retirement the active revision alone is a complete set');
select throws_ok($$select private.retire_hmac_key_version_v1('contact', 1)$$,
 '55000', 'only a retiring key revision can retire', 'a retired revision cannot retire twice');

-- ---------------------------------------------------------------------------
-- Privileges.
select ok(not has_table_privilege(r, 'private.hmac_key_versions', 'select'),
 r||' cannot read the keyring')
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r, f, 'execute'), r||' cannot run '||f)
from unnest(array['anon','authenticated','service_role']) r
cross join unnest(array['private.begin_hmac_key_rotation_v1(text,bigint)',
 'private.retire_hmac_key_version_v1(text,bigint)',
 'private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)']) f;

select * from finish();
rollback;
