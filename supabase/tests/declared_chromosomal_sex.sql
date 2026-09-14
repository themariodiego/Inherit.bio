begin;
select plan(22);

-- D-031. `declare_chromosomal_sex_v1` is the ONE writer for
-- `subject_demographics.chromosomal_sex`, and the authority rules are all
-- here rather than in the route that calls it. Synthetic accounts only; the
-- outer transaction rolls back.
--
-- The rule the rest of the suite exists to hold: the subject declares, the
-- holder does not. `subject_account_id` is the account a subject IS;
-- `owner_account_id` is the account that HOLDS it. An uploader who controls
-- another adult's record must not be able to record that adult's chromosomes.
--
-- Sign-up builds each account's own self subject through a trigger, so the
-- suite takes the subjects the product actually creates rather than writing
-- its own beside them, and adds only the two records the product would not
-- have made for it: a held adult and a minor.

insert into auth.users (id, email, raw_user_meta_data) values
 ('d0310000-0000-4000-8000-000000000001','declarer@example.invalid','{"display_name":"Declarer"}'),
 ('d0310000-0000-4000-8000-000000000002','holder@example.invalid','{"display_name":"Holder"}'),
 ('d0310000-0000-4000-8000-000000000003','stranger@example.invalid','{"display_name":"Stranger"}');

create temporary table d031 as
select
 (select id from public.subjects where subject_account_id='d0310000-0000-4000-8000-000000000001') as own_subject,
 (select id from public.subjects where subject_account_id='d0310000-0000-4000-8000-000000000003') as stranger_subject,
 'd0310000-0000-4000-8000-000000000001'::uuid as declarer,
 'd0310000-0000-4000-8000-000000000002'::uuid as holder,
 'd0310000-0000-4000-8000-000000000003'::uuid as stranger,
 'd0315000-0000-4000-8000-000000000002'::uuid as held_adult,
 'd0315000-0000-4000-8000-000000000003'::uuid as minor,
 'd0315000-0000-4000-8000-0000000000ff'::uuid as nobody,
 -- The audit log is append-only and shared, so this suite counts only the
 -- rows it adds rather than every row the database happens to hold.
 (select coalesce(max(seq),0) from public.legal_audit_log) as audit_from;

insert into public.subjects
 (id, owner_account_id, subject_account_id, subject_class, upload_class, display_label, lifecycle) values
 -- An adult the holder HOLDS and who has no account of their own.
 ('d0315000-0000-4000-8000-000000000002','d0310000-0000-4000-8000-000000000002',
  null,'other_adult','adult','Held adult','active'),
 -- A minor whose own account IS bound to the record, so the class check is
 -- the only thing that can refuse. Bound to a different account from the
 -- owner, because `subjects_check1` reserves owner = subject for `self`.
 ('d0315000-0000-4000-8000-000000000003','d0310000-0000-4000-8000-000000000002',
  'd0310000-0000-4000-8000-000000000003','minor','adult','A minor','active');

-- The stranger's own record is revoked: authority is over an active record.
update public.subjects set lifecycle='revoked'
 where id=(select stranger_subject from d031);

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

select throws_ok(
 format($$select public.declare_chromosomal_sex_v1(%L,%L,'XX')$$, holder, held_adult),
 '42501', 'chromosomal sex authority is unavailable',
 'the account that HOLDS another adult''s record cannot declare for them')
from d031;

select throws_ok(
 format($$select public.declare_chromosomal_sex_v1(%L,%L,'XX')$$, stranger, own_subject),
 '42501', 'chromosomal sex authority is unavailable',
 'a stranger cannot declare for somebody else''s subject')
from d031;

-- The account asking here IS the minor's account, so nothing but the subject
-- class stands between it and a write. Asked as the holder instead, this
-- would pass on the account check and prove nothing about minors.
select throws_ok(
 format($$select public.declare_chromosomal_sex_v1(%L,%L,'XX')$$, stranger, minor),
 '42501', 'chromosomal sex authority is unavailable',
 'a minor subject is out of reach even for the account bound to it')
from d031;

select throws_ok(
 format($$select public.declare_chromosomal_sex_v1(%L,%L,'XX')$$, stranger, stranger_subject),
 '42501', 'chromosomal sex authority is unavailable',
 'a revoked subject is not an active record to declare against')
from d031;

select throws_ok(
 format($$select public.declare_chromosomal_sex_v1(%L,%L,'XX')$$, declarer, nobody),
 '42501', 'chromosomal sex authority is unavailable',
 'an unknown subject answers exactly as an unauthorised one, so guessing learns nothing')
from d031;

select is((select count(*) from public.subject_demographics), 0::bigint,
 'every refusal above wrote nothing');

-- ---------------------------------------------------------------------------
-- The value
-- ---------------------------------------------------------------------------

select throws_ok(
 format($$select public.declare_chromosomal_sex_v1(%L,%L,'female')$$, declarer, own_subject),
 '22023', 'chromosomal sex value is not recognised',
 'a word outside the four the column allows is refused by name')
from d031;

select is(
 (select public.declare_chromosomal_sex_v1(declarer, own_subject, 'XX') ->> 'action' from d031),
 'declared', 'the subject declares their own value');

select is(
 (select chromosomal_sex from public.subject_demographics
  where subject_id=(select own_subject from d031)),
 'XX', 'the row holds what was declared');

select is(
 (select demographics_revision from public.subject_demographics
  where subject_id=(select own_subject from d031)),
 1::bigint, 'the first declaration is revision 1');

-- ---------------------------------------------------------------------------
-- Repeating, replacing and withdrawing
-- ---------------------------------------------------------------------------

select is(
 (select public.declare_chromosomal_sex_v1(declarer, own_subject, 'XX') ->> 'action' from d031),
 'unchanged', 'declaring the same value again is a no-op, not a change');

select is(
 (select demographics_revision from public.subject_demographics
  where subject_id=(select own_subject from d031)),
 1::bigint, 'a no-op does not move the revision, so no audit reads a change that did not happen');

select is(
 (select public.declare_chromosomal_sex_v1(declarer, own_subject, 'XY') ->> 'action' from d031),
 'replaced', 'a different value replaces the last one');

select is(
 (select public.declare_chromosomal_sex_v1(declarer, own_subject, null) ->> 'action' from d031),
 'withdrawn', 'null withdraws through the same call, not a separate privilege');

select is(
 (select chromosomal_sex from public.subject_demographics
  where subject_id=(select own_subject from d031)),
 null, 'the withdrawn value is gone from the row');

-- A date of birth on the same row survives a withdrawal: withdrawing one
-- declaration must not quietly delete another.
update public.subject_demographics set date_of_birth = date '1990-01-01'
 where subject_id=(select own_subject from d031);
select public.declare_chromosomal_sex_v1(declarer, own_subject, 'XX') from d031;
select public.declare_chromosomal_sex_v1(declarer, own_subject, null) from d031;
select is(
 (select date_of_birth from public.subject_demographics
  where subject_id=(select own_subject from d031)),
 date '1990-01-01', 'withdrawing the declaration leaves the rest of the row alone');

-- ---------------------------------------------------------------------------
-- The audit row
-- ---------------------------------------------------------------------------

-- Five real changes reach here: declared, replaced, withdrawn, then the
-- declared and withdrawn of the date-of-birth case. The sixth declaration
-- comes after the reader assertions below.
select is(
 (select count(*) from public.legal_audit_log
  where seq > (select audit_from from d031)
    and event_code='demographics.chromosomal-sex'),
 5::bigint, 'one audit row per real change and none for the no-op');

select is(
 (select count(*) from public.legal_audit_log
  where seq > (select audit_from from d031)
    and event_code='demographics.chromosomal-sex'
    and (coded_context ? 'chromosomalSex' or coded_context ? 'value'
      or coded_context::text like '%XX%' or coded_context::text like '%XY%')),
 0::bigint,
 'no audit row carries the value: the log is append-only and outlives the row it would describe');

select is(
 (select count(distinct route_id) from public.legal_audit_log
  where seq > (select audit_from from d031)
    and event_code='demographics.chromosomal-sex'),
 1::bigint, 'every audit row names the one route that can reach the writer');

-- ---------------------------------------------------------------------------
-- The reader
-- ---------------------------------------------------------------------------

select throws_ok(
 format($$select public.own_chromosomal_sex_v1(%L,%L)$$, holder, own_subject),
 '42501', 'chromosomal sex authority is unavailable',
 'the reader refuses exactly where the writer does, so no page shows a value its reader could not set')
from d031;

select public.declare_chromosomal_sex_v1(declarer, own_subject, 'XY') from d031;
select is(
 (select public.own_chromosomal_sex_v1(declarer, own_subject) ->> 'chromosomalSex' from d031),
 'XY', 'the subject reads back their own declaration');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

select is(
 (select count(*) from information_schema.role_routine_grants
  where specific_schema='public'
    and routine_name in ('declare_chromosomal_sex_v1','own_chromosomal_sex_v1')
    and grantee in ('anon','authenticated','public')),
 0::bigint,
 'neither function is callable by a browser session: the route calls them as the service role');

select finish();
rollback;
