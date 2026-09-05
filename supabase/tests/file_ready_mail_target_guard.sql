begin;
select no_plan();

-- Only synthetic accounts, files and queue entries; every write rolls back.
insert into auth.users(id,email,raw_user_meta_data) values
 ('82000000-0000-4000-8000-000000000001','file-mail-owner@example.invalid','{}'),
 ('82000000-0000-4000-8000-000000000002','file-mail-other@example.invalid','{}');
insert into auth.sessions(id,user_id,aal) values
 ('82000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','aal1');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,status)
select ('82000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,owner_account_id,id,
 owner_account_id::text||'/mail-fixture-'||n,'synthetic.txt','array_ancestry',1,1,'annotated'
from public.subjects cross join generate_series(11,16) n
where owner_account_id='82000000-0000-4000-8000-000000000001' and subject_class='self';

create function pg_temp.enqueue_file_mail(p_file integer,p_key text,p_template text default 'report-ready',
 p_account uuid default '82000000-0000-4000-8000-000000000001')
returns uuid language sql as $$
 select public.enqueue_account_mail(p_account,decode('00112233445566778899aabbccddeeff','hex'),
 repeat('a',64),p_template,
 case when p_template='report-ready' then 'report.ready' else 'research.digest' end,
 case when p_template='report-ready' then 'genome_file' else 'changelog_entry' end,
 ('82000000-0000-4000-8000-'||lpad(p_file::text,12,'0'))::uuid,
 '{"reportCount":1,"dashboardUrl":"https://inherit.bio/genome/me/reports"}',
 encode(extensions.digest(p_key,'sha256'),'hex'));
$$;
create temporary table notices(label text primary key,id uuid);
insert into notices values
 ('pending-queued',pg_temp.enqueue_file_mail(11,'pending-queued')),
 ('pending-claimed',pg_temp.enqueue_file_mail(11,'pending-claimed')),
 ('removed',pg_temp.enqueue_file_mail(12,'removed')),
 ('live',pg_temp.enqueue_file_mail(13,'live')),
 ('failed',pg_temp.enqueue_file_mail(14,'failed')),
 ('stale-claimed',pg_temp.enqueue_file_mail(15,'stale-claimed')),
 ('history',pg_temp.enqueue_file_mail(11,'history')),
 ('research',pg_temp.enqueue_file_mail(99,'research','research-digest'));
select is(pg_temp.enqueue_file_mail(13,'live'),(select id from notices where label='live'),
 'live semantic replay preserves its existing queue identity');
select is((select count(*) from public.mail_outbox),8::bigint,'replay creates no duplicate');
select throws_ok($$select pg_temp.enqueue_file_mail(99,'missing')$$,'55000','file_target_unavailable',
 'missing source refuses late readiness enqueue');
select throws_ok($$select pg_temp.enqueue_file_mail(13,'foreign','report-ready','82000000-0000-4000-8000-000000000002')$$,
 '55000','file_target_unavailable','another recipient cannot enqueue this source readiness');

-- Simulate an already recorded provider acceptance without submitting email.
update public.mail_outbox set state='submitted' where id=(select id from notices where label='history');
update public.mail_outbox set state='claimed',attempt_count=1,claimed_at=clock_timestamp()-interval '11 minutes'
 where id in(select id from notices where label in('pending-claimed','stale-claimed'));
select public.prepare_genome_file_deletion_v1('82000000-0000-4000-8000-000000000001',
 '82000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000011');
select is((select count(*) from public.mail_outbox where id in(select id from notices
 where label in('pending-queued','pending-claimed')) and state='invalidated'),2::bigint,
 'prepare invalidates exactly this file queued and claimed readiness');
select is((select state from public.mail_outbox where id=(select id from notices where label='history')),
 'submitted','preparation preserves already-sent history');
select is((select state from public.mail_outbox where id=(select id from notices where label='research')),
 'queued','preparation preserves unrelated research digest');
select throws_ok($$select pg_temp.enqueue_file_mail(11,'late-pending')$$,'55000','file_target_unavailable',
 'post-annotated late enqueue cannot resurrect deletion-pending readiness');

-- Legacy rows may predate the new deletion prepare invalidation. They must also
-- be refused at claim, including stale claims and non-annotated source status.
delete from public.genome_files where id in('82000000-0000-4000-8000-000000000012','82000000-0000-4000-8000-000000000015');
update public.genome_files set status='failed' where id='82000000-0000-4000-8000-000000000014';
select throws_ok($$select pg_temp.enqueue_file_mail(12,'late-deleted')$$,'55000','file_target_unavailable',
 'removed source refuses a new readiness candidate');
select throws_ok($$select pg_temp.enqueue_file_mail(14,'not-ready')$$,'55000','file_target_unavailable',
 'non-annotated source refuses a new readiness candidate');
create temporary table claimed as select * from public.claim_mail_outbox();
insert into claimed select * from public.claim_mail_outbox();
select is((select count(*) from claimed),2::bigint,'only live readiness and catalog research remain claimable');
select is((select count(*) from claimed where outbox_id in(select id from notices where label in('live','research'))),
 2::bigint,'claim selects exactly the two eligible notices');
select is((select count(*) from public.mail_outbox where id in(select id from notices
 where label in('removed','failed','stale-claimed')) and state='invalidated'
 and last_outcome_code='file_target_unavailable'),3::bigint,'claim invalidates all stale source cases');
select is((select count(*) from public.claim_mail_outbox()),0::bigint,'invalidated rows cannot be retried');
select is((select state from public.mail_outbox where id=(select id from notices where label='history')),
 'submitted','claim preserves already-sent history');

select ok(not has_function_privilege('authenticated','private.guard_file_ready_mail_insert_v1()','EXECUTE'),
 'client cannot invoke private privileged trigger');
select ok(not has_function_privilege('anon','public.claim_mail_outbox()','EXECUTE'),
 'claim remains service-only');
select ok(has_function_privilege('service_role','public.claim_mail_outbox()','EXECUTE'),
 'worker retains claim access');
select * from finish();
rollback;
