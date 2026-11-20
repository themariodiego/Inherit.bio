begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/invitation_quota_keys.inc
-- D-139 (20261119134500_path_a_sealed_invitation_note.sql). Path A's optional
-- invitation note reaches the database only as the envelope the route sealed,
-- in the transaction that creates the invitation and queues its mail.
--
--   1.  The migration's state: the three doors, the trigger function, the
--       check, the trigger and the pinned provider attempt key.
--   2.  A caller that sends no envelope is served as before, through both
--       public doors and their old argument lists.
--   3.  An envelope is on the queued row when the door returns, and the claim
--       hands the worker the provider attempt key its binding is checked by.
--   4.  A replay of the key keeps the first note (or no note) and makes no
--       second invitation or mail; a barred address writes no note.
--   5.  The door refuses everything that is not a well-formed envelope bound
--       to this key, plain text first, and writes nothing.
--   6.  The table refuses a plain note, a moved envelope and a note on Path
--       B's request, from any writer.
--   7.  The envelope goes when the row can no longer be sent, in the
--       transaction that moves it, and stays while it can.
--   8.  A note the new mail row cannot take fails the whole call.
--   9.  The migration's own blocks, byte for byte (scripts/path-a-sealed-
--       invitation-note-migration.test.ts holds the texts equal): the table
--       block removes plain notes only from rows that can no longer be sent
--       and refuses a sendable one; the predecessor block refuses to run
--       twice.
--
-- Every account, session, digest and envelope is synthetic: the envelopes
-- are hex of the right shape, sealed by nothing, and no note text exists
-- anywhere in this file. Everything rolls back.

-- `claim_mail_outbox` takes the oldest deliverable row; retiring other queued
-- mail inside this transaction keeps every claim below on this suite's rows.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed');
insert into auth.users(id,email,email_confirmed_at) values
 ('d1390000-0000-4000-8000-000000000001','sealed-note-inviter@example.invalid',now());
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('d1390000-0000-4000-8000-000000000011','d1390000-0000-4000-8000-000000000001',now(),now(),'aal1');

create function pg_temp.inviter() returns uuid language sql immutable as $$ select 'd1390000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.session() returns uuid language sql immutable as $$ select 'd1390000-0000-4000-8000-000000000011'::uuid $$;
create function pg_temp.key(label text) returns text language sql immutable as $$
 select encode(extensions.digest(convert_to('d139-idempotency|'||label,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.contact(label text) returns text language sql immutable as $$
 select encode(extensions.digest(convert_to('d139-contact|'||label,'UTF8'),'sha256'),'hex') $$;
-- A well-formed envelope for one key: 144 hex digits of wrapped key and a
-- sealed note of p_bytes bytes. Nothing here can be opened.
create function pg_temp.envelope(p_key text,p_fill text default 'cd',p_bytes integer default 40) returns jsonb language sql immutable as $$
 select jsonb_build_object('version',1,'idempotencyKey',p_key,'wrappedKey',repeat('ab',72),'ciphertext',repeat(p_fill,p_bytes)) $$;
create function pg_temp.invite(p_label text,p_envelope jsonb default null) returns uuid language sql as $$
 select invitation_id from public.create_adult_subject_invitation_v1(pg_temp.inviter(),
  convert_to('d139-ciphertext|'||p_label,'UTF8'),pg_temp.contact(p_label),pg_temp.key(p_label),true,
  p_quota_keys=>pg_temp.invitation_quota_keys(),p_note_envelope=>p_envelope) $$;
create function pg_temp.mail(p_label text) returns public.mail_outbox language sql as $$
 select m from public.mail_outbox m where m.idempotency_key=pg_temp.key(p_label) $$;
create function pg_temp.rows(p_label text) returns text language sql as $$
 select (select count(*) from public.mail_outbox where idempotency_key=pg_temp.key(p_label))||' mail, '
  ||(select count(*) from public.subject_invitations where email_hmac=pg_temp.contact(p_label))||' invitation' $$;
create function pg_temp.attempt_key(p_key text,p_attempt integer) returns text language sql immutable as $$
 select encode(extensions.digest(convert_to('mail-token-attempt-v1|'||p_key||'|'||p_attempt,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.soon() returns timestamptz language sql as $$ select clock_timestamp()+interval '5 minutes' $$;
create function pg_temp.nonce(label text) returns text language sql immutable as $$
 select encode(extensions.digest(convert_to('d139-nonce|'||label,'UTF8'),'sha256'),'hex') $$;

-- ---------------------------------------------------------------------------
-- 1. The migration's state
-- ---------------------------------------------------------------------------
select is((select md5(pg_get_functiondef(p.oid))||' '||p.proacl::text from pg_proc p where p.oid=x.signature::regprocedure),
 x.expected,x.signature||' is its reviewed body with its ACL') from (values
 ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)',
  '72ea3d6e8b41bfe74d8645259f7cfad7 {postgres=X/postgres}'),
 ('private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)',
  'd52340218a6b537108fe5a607babc934 {postgres=X/postgres,service_role=X/postgres}'),
 ('public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)',
  '24cfb0d901b6dad3b06bed8589dea711 {postgres=X/postgres,service_role=X/postgres}'),
 ('public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)',
  'de553b25718a0ef23dba647af8365714 {postgres=X/postgres,service_role=X/postgres}'),
 ('private.clear_adult_invitation_note_envelope_v1()','a5755b564addae646189029029729b3c {postgres=X/postgres}')
) x(signature,expected);
select is(to_regprocedure(x.signature),null,x.signature||' is gone') from (values
 ('private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)'),
 ('public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)'),
 ('public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz)')) x(signature);
select ok(has_function_privilege('service_role',f,'execute') and not has_function_privilege('anon',f,'execute')
 and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('inherit_upload_only',f,'execute'),
 f||' is service-only') from unnest(array[
 'private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)',
 'public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)',
 'public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)']) f;
select is((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid='public.mail_outbox'::regclass
 and c.conname='mail_outbox_adult_invitation_note_sealed' and c.contype='c' and c.convalidated),
 'CHECK (((template_id <> ''adult-subject-invitation''::text) OR COALESCE((((template_payload - ARRAY[''request''::text, '
 ||'''noteEnvelope''::text]) = ''{}''::jsonb) AND (NOT ((template_payload ? ''request''::text) AND (template_payload ? '
 ||'''noteEnvelope''::text))) AND ((NOT (template_payload ? ''noteEnvelope''::text)) OR ((jsonb_typeof((template_payload -> '
 ||'''noteEnvelope''::text)) = ''object''::text) AND ((template_payload -> ''noteEnvelope''::text) ?& ARRAY[''version''::text, '
 ||'''idempotencyKey''::text, ''wrappedKey''::text, ''ciphertext''::text]) AND (((template_payload -> ''noteEnvelope''::text) - '
 ||'ARRAY[''version''::text, ''idempotencyKey''::text, ''wrappedKey''::text, ''ciphertext''::text]) = ''{}''::jsonb) AND '
 ||'(((template_payload -> ''noteEnvelope''::text) -> ''version''::text) = ''1''::jsonb) AND (((template_payload -> '
 ||'''noteEnvelope''::text) -> ''idempotencyKey''::text) = to_jsonb(idempotency_key)) AND (jsonb_typeof(((template_payload -> '
 ||'''noteEnvelope''::text) -> ''wrappedKey''::text)) = ''string''::text) AND (((template_payload -> ''noteEnvelope''::text) ->> '
 ||'''wrappedKey''::text) ~ ''^[0-9a-f]{144}$''::text) AND (jsonb_typeof(((template_payload -> ''noteEnvelope''::text) -> '
 ||'''ciphertext''::text)) = ''string''::text) AND (((template_payload -> ''noteEnvelope''::text) ->> ''ciphertext''::text) ~ '
 ||'''^[0-9a-f]+$''::text) AND ((length(((template_payload -> ''noteEnvelope''::text) ->> ''ciphertext''::text)) >= 58) AND '
 ||'(length(((template_payload -> ''noteEnvelope''::text) ->> ''ciphertext''::text)) <= 3056)) AND ((length(((template_payload -> '
 ||'''noteEnvelope''::text) ->> ''ciphertext''::text)) % 2) = 0)))), false)))',
 'the table holds an invitation payload to request or a bound, bounded envelope, and never a plain note');
select is((select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid='public.mail_outbox'::regclass
 and t.tgname='clear_adult_invitation_note_envelope' and t.tgenabled='O'),
 'CREATE TRIGGER clear_adult_invitation_note_envelope BEFORE UPDATE ON public.mail_outbox FOR EACH ROW '
 ||'WHEN (((new.template_id = ''adult-subject-invitation''::text) AND (new.state <> ALL (ARRAY[''queued''::text, '
 ||'''claimed''::text])) AND (new.template_payload ? ''noteEnvelope''::text))) '
 ||'EXECUTE FUNCTION private.clear_adult_invitation_note_envelope_v1()',
 'the envelope trigger fires only for an invitation row that can no longer be sent');
select is(private.mail_provider_attempt_key_v1(jsonb_populate_record(null::public.mail_outbox,jsonb_build_object(
 'idempotency_key',repeat('a',64),'token_purpose','adult-subject-invitation','attempt_count',3))),
 '6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517',
 'the provider attempt key is the digest the worker reproduces (src/lib/adult-invitation-note.test.ts pins the same value)');

-- ---------------------------------------------------------------------------
-- 2. No envelope: served as before, through both doors and their old lists
-- ---------------------------------------------------------------------------
select isnt((select invitation_id from public.create_adult_subject_invitation_v1(pg_temp.inviter(),
 convert_to('d139-ciphertext|plain','UTF8'),pg_temp.contact('plain'),pg_temp.key('plain'),true,null,
 pg_temp.invitation_quota_keys())),null,'the public door still takes its seven arguments');
select is((pg_temp.mail('plain')).template_payload,'{}'::jsonb,'and queues the invitation mail with nothing in its payload');
select is((select count(*) from public.create_adult_subject_invitation_with_nonce_v1(pg_temp.inviter(),pg_temp.session(),
 convert_to('d139-ciphertext|nonce-plain','UTF8'),pg_temp.contact('nonce-plain'),pg_temp.key('nonce-plain'),true,null,
 pg_temp.invitation_quota_keys(),pg_temp.nonce('nonce-plain'),pg_temp.soon())),1::bigint,
 'the nonce door still takes its ten arguments, as the deployed route sends them');
select is((pg_temp.mail('nonce-plain')).template_payload,'{}'::jsonb,'and its mail carries no note');
select is((select count(*) from public.account_operation_nonces where nonce_hash=pg_temp.nonce('nonce-plain')
 and consumed_at is not null),1::bigint,'and records its nonce as before');

-- ---------------------------------------------------------------------------
-- 3. An envelope is on the queued row when the door returns
-- ---------------------------------------------------------------------------
create temporary table sealed_invitation as select pg_temp.invite('sealed',pg_temp.envelope(pg_temp.key('sealed'))) id;
select isnt((select id from sealed_invitation),null,'an invitation with a note is created');
select is((pg_temp.mail('sealed')).template_payload,jsonb_build_object('noteEnvelope',pg_temp.envelope(pg_temp.key('sealed'))),
 'its queued mail already holds the envelope, in the transaction that created both');
select is((pg_temp.mail('sealed')).state,'queued','and the mail is still queued for the worker');
select is((pg_temp.mail('sealed')).target_id,(select id from sealed_invitation),'on the row of that invitation');
select is((select count(*) from public.create_adult_subject_invitation_with_nonce_v1(pg_temp.inviter(),pg_temp.session(),
 convert_to('d139-ciphertext|nonce-sealed','UTF8'),pg_temp.contact('nonce-sealed'),pg_temp.key('nonce-sealed'),true,null,
 pg_temp.invitation_quota_keys(),pg_temp.nonce('nonce-sealed'),pg_temp.soon(),pg_temp.envelope(pg_temp.key('nonce-sealed')))),
 1::bigint,'the nonce door takes the envelope as its eleventh argument');
select is((pg_temp.mail('nonce-sealed')).template_payload->'noteEnvelope',pg_temp.envelope(pg_temp.key('nonce-sealed')),
 'and its queued mail holds it');

-- The worker's claim: the envelope travels with the row, and the key handed
-- over is the provider attempt key the envelope's binding must reproduce.
update public.mail_outbox set state='invalidated' where state in ('queued','claimed') and idempotency_key<>pg_temp.key('sealed');
create temporary table sealed_claim as select * from public.claim_mail_outbox();
select is((select outbox_id from sealed_claim),(pg_temp.mail('sealed')).id,'the worker claims the sealed invitation mail');
select is((select template_payload->'noteEnvelope'->>'idempotencyKey' from sealed_claim),pg_temp.key('sealed'),
 'with the envelope, which names the row''s own key');
select is((select idempotency_key from sealed_claim),pg_temp.attempt_key(pg_temp.key('sealed'),(select attempt_ordinal from sealed_claim)),
 'and the provider attempt key the worker checks that key against');
select isnt((select idempotency_key from sealed_claim),pg_temp.key('sealed'),'never the row''s own key itself');

-- ---------------------------------------------------------------------------
-- 4. A replay keeps the first note; a barred address records none
-- ---------------------------------------------------------------------------
select is(pg_temp.invite('sealed',pg_temp.envelope(pg_temp.key('sealed'),'ef',41)),(select id from sealed_invitation),
 'a replay of the key with another note returns the same invitation');
select is(pg_temp.rows('sealed'),'1 mail, 1 invitation','and makes no second invitation or mail');
select is((pg_temp.mail('sealed')).template_payload->'noteEnvelope',pg_temp.envelope(pg_temp.key('sealed')),
 'and keeps the first note');
select isnt(pg_temp.invite('plain',pg_temp.envelope(pg_temp.key('plain'))),null,
 'a replay that adds a note to an invitation made without one returns that invitation');
select is((pg_temp.mail('plain')).template_payload,'{}'::jsonb,'and adds nothing to its mail');
select is(pg_temp.rows('plain'),'1 mail, 1 invitation','nor a second invitation or mail');
insert into public.invitation_refusal_hmacs(email_hmac,refusal_revision,expires_at)
 values(pg_temp.contact('barred'),1,clock_timestamp()+interval '1 day');
select is(pg_temp.invite('barred',pg_temp.envelope(pg_temp.key('barred'))),null,'a barred address gets the empty receipt');
select is(pg_temp.rows('barred'),'0 mail, 0 invitation','and nothing, note included, is written for it');

-- ---------------------------------------------------------------------------
-- 5. The door refuses everything but a well-formed envelope bound to this key
-- ---------------------------------------------------------------------------
select throws_ok(format('select pg_temp.invite(%L,%L::jsonb)','refused-'||x.label,x.envelope),'22023',
 'adult invitation note invalid','the door refuses '||x.why) from (values
 ('string','"plain words"','a plain string'),
 ('note','{"note":"plain words"}','a plain note object'),
 ('number','1','a number'),
 ('array','[]','an array'),
 ('extra',(pg_temp.envelope(pg_temp.key('refused-extra'))||'{"note":"plain words"}')::text,'an envelope that also carries a plain note'),
 ('missing',(pg_temp.envelope(pg_temp.key('refused-missing'))-'wrappedKey')::text,'an envelope without its wrapped key'),
 ('version',jsonb_set(pg_temp.envelope(pg_temp.key('refused-version')),'{version}','2')::text,'another version'),
 ('version-text',jsonb_set(pg_temp.envelope(pg_temp.key('refused-version-text')),'{version}','"1"')::text,'a version that is a string'),
 ('other-key',pg_temp.envelope(pg_temp.key('another invitation'))::text,'an envelope bound to another invitation''s key'),
 ('short-wrap',jsonb_set(pg_temp.envelope(pg_temp.key('refused-short-wrap')),'{wrappedKey}',to_jsonb(repeat('ab',71)))::text,
  'a wrapped key one byte short'),
 ('upper-wrap',jsonb_set(pg_temp.envelope(pg_temp.key('refused-upper-wrap')),'{wrappedKey}',to_jsonb(repeat('AB',72)))::text,
  'a wrapped key in capitals'),
 ('odd',jsonb_set(pg_temp.envelope(pg_temp.key('refused-odd')),'{ciphertext}',to_jsonb(repeat('c',81)))::text,
  'a sealed note of odd length'),
 ('empty',pg_temp.envelope(pg_temp.key('refused-empty'),'cd',28)::text,'a sealed note with no note in it (overhead only)'),
 ('long',pg_temp.envelope(pg_temp.key('refused-long'),'cd',1529)::text,'a sealed note longer than 500 characters can seal to'),
 ('nonhex',pg_temp.envelope(pg_temp.key('refused-nonhex'),'zz',40)::text,'a sealed note that is not hex'),
 ('number-text',jsonb_set(pg_temp.envelope(pg_temp.key('refused-number-text')),'{ciphertext}','1234')::text,'a sealed note that is a number')
) x(label,envelope,why);
select is((select count(*) from public.mail_outbox where idempotency_key in (select pg_temp.key('refused-'||l) from unnest(array[
 'string','note','number','array','extra','missing','version','version-text','other-key','short-wrap','upper-wrap','odd','empty',
 'long','nonhex','number-text']) l)),0::bigint,'and no refusal wrote a mail or an invitation');
select isnt(pg_temp.invite('shortest',pg_temp.envelope(pg_temp.key('shortest'),'cd',29)),null,
 'the shortest sealed note (one byte) is accepted');
select isnt(pg_temp.invite('longest',pg_temp.envelope(pg_temp.key('longest'),'cd',1528)),null,
 'the longest (1,500 bytes) is accepted');
select throws_ok($$select count(*) from public.create_adult_subject_invitation_with_nonce_v1(pg_temp.inviter(),pg_temp.session(),
 convert_to('d139-ciphertext|nonce-refused','UTF8'),pg_temp.contact('nonce-refused'),pg_temp.key('nonce-refused'),true,null,
 pg_temp.invitation_quota_keys(),pg_temp.nonce('nonce-refused'),pg_temp.soon(),'{"note":"plain words"}'::jsonb)$$,
 '22023','adult invitation note invalid','the nonce door refuses a plain note too');
select is((select count(*) from public.account_operation_nonces where nonce_hash=pg_temp.nonce('nonce-refused')),0::bigint,
 'and its nonce is not spent');

-- ---------------------------------------------------------------------------
-- 6. The table refuses a plain note, a moved envelope and a note on Path B's
-- request, whoever writes it
-- ---------------------------------------------------------------------------
-- (The claim above retired this row; it is queued again for these writes.)
update public.mail_outbox set state='queued' where id=(pg_temp.mail('plain')).id;
select throws_like(format($$update public.mail_outbox set template_payload=%L where id=%L$$,x.payload,(pg_temp.mail('plain')).id),
 '%mail_outbox_adult_invitation_note_sealed%','the table refuses '||x.why) from (values
 ('{"note":"plain words"}','a plain note'),
 (jsonb_build_object('noteEnvelope',pg_temp.envelope(pg_temp.key('sealed')))::text,'an envelope moved from another invitation''s row'),
 (jsonb_build_object('request','esignature','noteEnvelope',pg_temp.envelope(pg_temp.key('plain')))::text,'a note on Path B''s request'),
 (jsonb_build_object('noteEnvelope','"plain words"'::jsonb)::text,'a plain string where the envelope goes'),
 ('{"message":"plain words"}','any other key')
) x(payload,why);
-- The route's old write, as the service role sent it after the commit.
select (pg_temp.mail('plain')).id as plain_outbox \gset
savepoint service_write;
set local role service_role;
select throws_like($$update public.mail_outbox set template_payload='{"note":"plain words"}'
 where id='$$||:'plain_outbox'||$$'$$,'%mail_outbox_adult_invitation_note_sealed%',
 'the service role''s direct write of a plain note, the route''s old one, is refused');
rollback to service_write;
select lives_ok(format($$update public.mail_outbox set template_payload=%L where id=%L$$,
 jsonb_build_object('noteEnvelope',pg_temp.envelope(pg_temp.key('plain'))),(pg_temp.mail('plain')).id),
 'an envelope bound to the row''s own key is admitted');
select is((pg_temp.mail('plain')).template_payload->'noteEnvelope',pg_temp.envelope(pg_temp.key('plain')),'and held');
select lives_ok(format($$update public.mail_outbox set template_payload='{"request":"esignature"}' where id=%L$$,
 (pg_temp.mail('plain')).id),'Path B''s request is admitted as before');
update public.mail_outbox set template_payload='{}' where id=(pg_temp.mail('plain')).id;

-- ---------------------------------------------------------------------------
-- 7. The envelope goes when the row can no longer be sent
-- ---------------------------------------------------------------------------
select lives_ok(format($$select public.complete_mail_attempt(%L,%s::smallint,false,'','provider_or_payload_error')$$,
 (select outbox_id from sealed_claim),(select attempt_ordinal from sealed_claim)),'a failed attempt is recorded');
select is((pg_temp.mail('sealed')).state,'queued','and the row is queued again for its retry');
select is((pg_temp.mail('sealed')).template_payload->'noteEnvelope',pg_temp.envelope(pg_temp.key('sealed')),
 'with its note, which the retry needs');
update public.mail_outbox set not_before=clock_timestamp()-interval '1 second' where id=(pg_temp.mail('sealed')).id;
update public.mail_outbox set state='invalidated' where state in ('queued','claimed') and idempotency_key<>pg_temp.key('sealed');
create temporary table sealed_retry as select * from public.claim_mail_outbox();
select is((select outbox_id from sealed_retry),(pg_temp.mail('sealed')).id,'the retry claims the same row');
select is((select idempotency_key from sealed_retry),pg_temp.attempt_key(pg_temp.key('sealed'),2),
 'under the next attempt''s provider key, which the same envelope key reproduces');
select lives_ok(format($$select public.complete_mail_attempt(%L,%s::smallint,true,%L,'accepted')$$,
 (select outbox_id from sealed_retry),(select attempt_ordinal from sealed_retry),repeat('9',64)),
 'provider acceptance is recorded');
select is((pg_temp.mail('sealed')).state,'submitted','the row is submitted');
select is((pg_temp.mail('sealed')).template_payload,'{}'::jsonb,
 'and the envelope went in the same transaction: nothing of the note stays after provider acceptance');
select is((select count(*) from public.mail_outbox where template_payload::text like '%'||repeat('cd',40)||'%'
 and id=(pg_temp.mail('sealed')).id),0::bigint,'not even its ciphertext');

select isnt(pg_temp.invite(x.label,pg_temp.envelope(pg_temp.key(x.label))),null,'a sealed invitation for '||x.label)
 from unnest(array['to-claimed','to-delivered','to-expired','to-failed','to-invalidated','to-service']) x(label);
select is((select count(*) from public.mail_outbox where idempotency_key in (select pg_temp.key(l) from unnest(array[
 'to-claimed','to-delivered','to-expired','to-failed','to-invalidated','to-service']) l) and state='queued'
 and template_payload ? 'noteEnvelope'),6::bigint,'each holds its envelope while it is queued');
update public.mail_outbox m set state=x.state from (values ('to-failed','failed'),('to-invalidated','invalidated'),
 ('to-expired','expired'),('to-delivered','delivered'),('to-claimed','claimed')) x(label,state)
 where m.idempotency_key=pg_temp.key(x.label);
select is((select string_agg(x.label||' '||((pg_temp.mail(x.label)).template_payload ? 'noteEnvelope')::text,', ' order by x.label)
 from unnest(array['to-claimed','to-delivered','to-expired','to-failed','to-invalidated']) x(label)),
 'to-claimed true, to-delivered false, to-expired false, to-failed false, to-invalidated false',
 'a failed, invalidated, expired or delivered row loses its envelope; a claimed one keeps it');
select (pg_temp.mail('to-service')).id as service_outbox \gset
savepoint service_terminal;
set local role service_role;
select lives_ok($$update public.mail_outbox set state='failed' where id='$$||:'service_outbox'||$$'$$,
 'the service role can end the row directly');
reset role;
select is((pg_temp.mail('to-service')).template_payload,'{}'::jsonb,'and the trigger removes the envelope for it too');
rollback to service_terminal;

-- ---------------------------------------------------------------------------
-- 8. A note the new mail row cannot take fails the whole call
-- ---------------------------------------------------------------------------
savepoint untakeable;
create function private.d139_probe_untakeable() returns trigger language plpgsql as $$
begin new.template_payload:='{"request":"esignature"}'::jsonb; return new; end $$;
create trigger d139_probe_untakeable before insert on public.mail_outbox for each row
 when (new.template_id='adult-subject-invitation') execute function private.d139_probe_untakeable();
select throws_ok($$select pg_temp.invite('untakeable',pg_temp.envelope(pg_temp.key('untakeable')))$$,'55000',
 'adult invitation note unrecorded','an invitation whose mail cannot take its note is refused');
select is(pg_temp.rows('untakeable'),'0 mail, 0 invitation','and nothing of it commits: no invitation goes out without its note');
rollback to untakeable;

-- ---------------------------------------------------------------------------
-- 9. The migration's own blocks, byte for byte
-- ---------------------------------------------------------------------------
create function pg_temp.predecessor() returns void language plpgsql as $predecessor$
begin
 -- Each door its reviewed body and ACL, and the core as 20261119110000 left
 -- it. Distinct signatures are counted, so no body can stand in for another.
 if (select count(distinct x.signature) from pg_proc p join (values
    ('private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)','72ea3d6e8b41bfe74d8645259f7cfad7',
     '{postgres=X/postgres}'),
    ('private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)','20bdaa2fe113d92c696af0112fe072b5',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)','160df78ea5b4bce3a1680fa84cb2cec9',
     '{postgres=X/postgres,service_role=X/postgres}'),
    ('public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz)',
     '9819f58145dbbacb8926b651f983c8c2','{postgres=X/postgres,service_role=X/postgres}')
   ) as x(signature,body,acl) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body
    and p.proacl::text=x.acl)<>4
  -- The provider attempt key the worker checks an envelope's key against.
  or private.mail_provider_attempt_key_v1(jsonb_populate_record(null::public.mail_outbox,jsonb_build_object(
    'idempotency_key',repeat('a',64),'token_purpose','adult-subject-invitation','attempt_count',3)))
   is distinct from '6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517'
  -- Nothing this migration creates exists yet.
  or to_regprocedure('private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)') is not null
  or to_regprocedure('public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)') is not null
  or to_regprocedure('public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)')
   is not null
  or to_regprocedure('private.clear_adult_invitation_note_envelope_v1()') is not null
  or exists(select 1 from pg_constraint where conrelid='public.mail_outbox'::regclass
   and conname='mail_outbox_adult_invitation_note_sealed')
  or exists(select 1 from pg_trigger where tgrelid='public.mail_outbox'::regclass
   and tgname='clear_adult_invitation_note_envelope') then
  raise exception using errcode='55000',message='sealed invitation note prerequisite differs'; end if;
end;
$predecessor$;
create function pg_temp.seal_table() returns void language plpgsql as $seal_table$
begin
 lock table public.mail_outbox in access exclusive mode;
 if exists(select 1 from public.mail_outbox where template_id='adult-subject-invitation'
   and state in ('queued','claimed') and template_payload ? 'note') then
  raise exception using errcode='55000',message='plain invitation note on a sendable row'; end if;
 update public.mail_outbox set template_payload=template_payload-'note'
  where template_id='adult-subject-invitation' and state not in ('queued','claimed') and template_payload ? 'note';
 alter table public.mail_outbox add constraint mail_outbox_adult_invitation_note_sealed check (
  template_id<>'adult-subject-invitation'
  or coalesce(template_payload-array['request','noteEnvelope']='{}'::jsonb
   and not (template_payload ? 'request' and template_payload ? 'noteEnvelope')
   and (not template_payload ? 'noteEnvelope' or (
    jsonb_typeof(template_payload->'noteEnvelope')='object'
    and (template_payload->'noteEnvelope') ?& array['version','idempotencyKey','wrappedKey','ciphertext']
    and (template_payload->'noteEnvelope')-array['version','idempotencyKey','wrappedKey','ciphertext']='{}'::jsonb
    and template_payload->'noteEnvelope'->'version'='1'::jsonb
    and template_payload->'noteEnvelope'->'idempotencyKey'=to_jsonb(idempotency_key)
    and jsonb_typeof(template_payload->'noteEnvelope'->'wrappedKey')='string'
    and template_payload->'noteEnvelope'->>'wrappedKey' ~ '^[0-9a-f]{144}$'
    and jsonb_typeof(template_payload->'noteEnvelope'->'ciphertext')='string'
    and template_payload->'noteEnvelope'->>'ciphertext' ~ '^[0-9a-f]+$'
    and length(template_payload->'noteEnvelope'->>'ciphertext') between 58 and 3056
    and length(template_payload->'noteEnvelope'->>'ciphertext')%2=0)),false));
end;
$seal_table$;

-- How the table reads: whether the check is there, and how many invitation
-- rows hold a plain note.
create function pg_temp.table_state() returns text language sql as $$
 select case when exists(select 1 from pg_constraint where conrelid='public.mail_outbox'::regclass
   and conname='mail_outbox_adult_invitation_note_sealed') then 'sealed' else 'open' end
  ||', '||(select count(*) from public.mail_outbox where template_id='adult-subject-invitation' and template_payload ? 'note')
  ||' plain' $$;
-- Run one block on the state before the check, with one prepared row, report
-- what it did and how the table reads, then undo the whole probe.
create function pg_temp.probe(p_block text,p_setup text) returns text language plpgsql as $$
declare v_outcome text;
begin
 begin
  set constraints all immediate;
  alter table public.mail_outbox drop constraint mail_outbox_adult_invitation_note_sealed;
  if p_setup is not null then execute p_setup; end if;
  begin
   execute format('select pg_temp.%I()',p_block);
   v_outcome:='applied';
  exception when others then
   v_outcome:=sqlstate||' '||sqlerrm;
  end;
  v_outcome:=v_outcome||'; '||pg_temp.table_state();
  raise exception using errcode='ZZ001',message='probe undone';
 exception when sqlstate 'ZZ001' then
  return v_outcome;
 end;
end $$;
select is(pg_temp.table_state(),'sealed, 0 plain','(the migration is applied)');
select is(pg_temp.probe('predecessor',null),'55000 sealed invitation note prerequisite differs; open, 0 plain',
 'the predecessor block refuses once the doors are replaced: the migration cannot run twice');
select is(pg_temp.probe('seal_table',null),'applied; sealed, 0 plain','on a table with no plain note the block adds the check');
select is(pg_temp.probe('seal_table',format($s$update public.mail_outbox set template_payload='{"note":"plain words"}',
 state=%L where id=%L$s$,x.state,(pg_temp.mail('plain')).id)),'applied; sealed, 0 plain',
 'a plain note on a row now '||x.state||', which nothing sends again, is removed and the check added')
 from unnest(array['submitted','delivered','failed','invalidated','expired']) x(state);
select is(pg_temp.probe('seal_table',format($s$update public.mail_outbox set template_payload='{"note":"plain words"}',
 state=%L where id=%L$s$,x.state,(pg_temp.mail('plain')).id)),
 '55000 plain invitation note on a sendable row; open, 1 plain',
 'a plain note on a row still '||x.state||' refuses the block, which writes nothing')
 from unnest(array['queued','claimed']) x(state);
select is(pg_temp.table_state(),'sealed, 0 plain','(and every probe was undone)');

select * from finish();
rollback;
