begin;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '74000000-0000-0000-0000-000000000001',
    'inviter@example.invalid',
    '{"display_name":"Inviter"}'
  ),
  (
    '74000000-0000-0000-0000-000000000002',
    'recipient@example.invalid',
    '{"display_name":"Recipient"}'
  );

create temporary table created_invitation as
select * from public.create_adult_subject_invitation_v1(
  '74000000-0000-0000-0000-000000000001',
  decode('00112233445566778899aabbccddeeff', 'hex'),
  repeat('a', 64), repeat('b', 64), true
);

select is((select count(*) from created_invitation), 1::bigint,
  'an eligible account can reserve one adult invitation');
select is((select lifecycle from public.subjects
  where id = (select subject_id from created_invitation)), 'draft',
  'the reserved subject is non-readable draft state');
select is((select count(*) from public.genome_files
  where subject_id = (select subject_id from created_invitation)), 0::bigint,
  'an invitation creates no genetic file');
select is((select count(*) from public.purpose_grants
  where target_id = (select subject_id from created_invitation)), 0::bigint,
  'an invitation creates no analysis or access grant');

create temporary table claimed_invitation_mail as
select * from public.claim_mail_outbox();

select matches((select delivery_token from claimed_invitation_mail),
  '^[A-Za-z0-9_-]{43}$',
  'the mail worker receives one ephemeral URL-safe token');
select is(
  position((select delivery_token from claimed_invitation_mail)
    in (select template_payload::text from public.mail_outbox))::integer,
  0,
  'the raw invitation token is absent from durable mail payloads'
);

create temporary table invitation_token as
select encode(extensions.digest(
  convert_to((select delivery_token from claimed_invitation_mail), 'UTF8'),
  'sha256'
), 'hex') as token_hash;

select is((select state from public.resolve_adult_subject_invitation_v1(
  (select token_hash from invitation_token))), 'available',
  'the issued token resolves to an available invitation');
select is(public.respond_adult_subject_invitation_v1(
  (select token_hash from invitation_token), 'confirm',
  '74000000-0000-0000-0000-000000000002', repeat('f', 64)
), 'unavailable',
  'an account whose authenticated email does not match cannot accept');
select is(public.respond_adult_subject_invitation_v1(
  (select token_hash from invitation_token), 'confirm',
  '74000000-0000-0000-0000-000000000002', repeat('a', 64)
), 'accepted',
  'the matching adult account accepts atomically');
select is((select subject_account_id from public.subjects
  where id = (select subject_id from created_invitation)),
  '74000000-0000-0000-0000-000000000002'::uuid,
  'acceptance binds control to the invited adult');
select is((select lifecycle from public.subjects
  where id = (select subject_id from created_invitation)), 'active',
  'acceptance activates the reserved subject');
select is((select count(*) from public.purpose_grants
  where target_id = (select subject_id from created_invitation)), 0::bigint,
  'acceptance still grants the inviter no genetic-data purpose');
select is((select count(*) from public.consent_signatures
  where target_id = (select subject_id from created_invitation)
    and artifact_key = 'consent.subject-adult'), 1::bigint,
  'acceptance records the exact adult consent artifact');
select is(public.respond_adult_subject_invitation_v1(
  (select token_hash from invitation_token), 'confirm',
  '74000000-0000-0000-0000-000000000002', repeat('a', 64)
), 'unavailable',
  'the consumed token cannot be replayed');

create temporary table refused_invitation as
select * from public.create_adult_subject_invitation_v1(
  '74000000-0000-0000-0000-000000000001',
  decode('ffeeddccbbaa99887766554433221100', 'hex'),
  repeat('c', 64), repeat('d', 64), true
);
create temporary table refused_mail as select * from public.claim_mail_outbox();
create temporary table refused_token as
select encode(extensions.digest(
  convert_to((select delivery_token from refused_mail), 'UTF8'), 'sha256'
), 'hex') as token_hash;

select is(public.respond_adult_subject_invitation_v1(
  (select token_hash from refused_token), 'refuse'
), 'refused',
  'the invited person can refuse without an account');
select ok(
  (select lifecycle = 'purged' from public.subjects
   where id = (select subject_id from refused_invitation))
  and exists (
    select 1 from public.invitation_refusal_hmacs
    where email_hmac = repeat('c', 64) and expires_at > clock_timestamp()
  )
  and exists (
    select 1 from public.encrypted_contact_references
    where contact_hmac = repeat('c', 64)
      and status = 'shredded' and contact_ciphertext is null
  ),
  'refusal closes the draft, creates the refusal bar, and shreds contact ciphertext'
);

select * from finish();
rollback;
