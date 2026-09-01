begin;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '72000000-0000-0000-0000-000000000001',
  'new-account@example.invalid',
  '{"display_name":"New account"}'
);

select is(
  (select count(*) from public.profiles where id = '72000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a profile is provisioned'
);
select is(
  (select count(*) from public.subjects where subject_account_id = '72000000-0000-0000-0000-000000000001' and subject_class = 'self'),
  1::bigint,
  'one self subject is provisioned'
);
select is(
  (select display_label from public.subjects where subject_account_id = '72000000-0000-0000-0000-000000000001' and subject_class = 'self'),
  'New account',
  'the subject label uses account metadata'
);
select is(
  (select count(*) from public.subject_principals where account_id = '72000000-0000-0000-0000-000000000001' and principal_kind = 'account_subject' and status = 'active'),
  1::bigint,
  'one active account-subject principal is provisioned'
);
select is(
  (select count(*) from public.subject_account_bindings where account_id = '72000000-0000-0000-0000-000000000001' and binding_kind = 'self' and status = 'current'),
  1::bigint,
  'the current self binding is provisioned'
);
select is(
  (select count(*) from public.subject_relationships where recipient_account_id = '72000000-0000-0000-0000-000000000001' and relationship_kind = 'self' and status = 'current'),
  1::bigint,
  'the current self relationship is provisioned'
);
select is(
  (select count(*) from public.subjects s join public.subject_principals sp on sp.subject_id = s.id where s.subject_account_id = '72000000-0000-0000-0000-000000000001' and sp.account_id = s.subject_account_id),
  1::bigint,
  'the subject and principal are linked to the same account'
);

insert into public.upload_sessions (
  id, account_id, auth_session_id, subject_id, staging_object_name,
  expected_size, expected_sha256, content_type, upload_revision, status,
  expires_at
)
select
  '72000000-0000-4000-8000-000000000010',
  '72000000-0000-0000-0000-000000000001',
  '72000000-0000-4000-8000-000000000011',
  s.id,
  '72000000-0000-4000-8000-000000000012',
  100,
  repeat('a', 64),
  'application/octet-stream',
  1,
  'issued',
  clock_timestamp() + interval '1 hour'
from public.subjects s
where s.subject_account_id = '72000000-0000-0000-0000-000000000001'
  and s.subject_class = 'self';

create temporary table completed_upload as
select public.complete_upload_session(
  '72000000-0000-4000-8000-000000000010',
  '72000000-0000-0000-0000-000000000001',
  '72000000-0000-4000-8000-000000000011',
  '72000000-0000-4000-8000-000000000013',
  'sample.vcf',
  'vcf',
  1::smallint
) as file_id;

select isnt((select file_id from completed_upload), null::uuid,
  'the service-only completion returns a file id');
select is((select status from public.upload_sessions where id = '72000000-0000-4000-8000-000000000010'),
  'promoted', 'the upload session is terminally promoted');
select is((select count(*) from public.genome_files where id = (select file_id from completed_upload) and subject_id is not null),
  1::bigint, 'the genome file is subject-bound');
select is((select count(*) from public.genome_storage_objects where genome_file_id = (select file_id from completed_upload) and state = 'current'),
  1::bigint, 'the final storage object is bound');
select is(has_function_privilege('authenticated', 'public.complete_upload_session(uuid,uuid,uuid,uuid,text,text,smallint)', 'execute'),
  false, 'authenticated clients cannot call upload completion directly');

select * from finish();
rollback;
