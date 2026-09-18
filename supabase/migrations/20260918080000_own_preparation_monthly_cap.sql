-- Monthly admission cap for prepared-genome preparations. Owner decision:
-- a hard, database-enforced limit on how many NEW preparations one UTC
-- calendar month admits, so spend and the proof stay bounded. The number is
-- a private configuration value the owner can raise later; no response ever
-- carries it. The admission past the limit is refused at enqueue with
-- 'preparation_capacity_reached' and writes no job; the source file is kept.
alter table private.own_preparation_config
 add column monthly_admission_limit integer not null default 100
 check(monthly_admission_limit between 1 and 100000);
-- Jobs are retired by cleanup, so they cannot be counted. This ledger holds
-- one row per month and a count: no account, file, subject or session.
-- The key is pinned to the first day of a month through the immutable
-- timestamp form of date_trunc.
create table private.own_preparation_monthly_admissions (
 month_start date primary key check(month_start=date_trunc('month',month_start::timestamp)::date),
 admitted integer not null default 0 check(admitted>=0)
);
alter table private.own_preparation_monthly_admissions enable row level security;
revoke all on private.own_preparation_monthly_admissions from public,anon,authenticated,inherit_upload_only,service_role;

-- Same body as 20260908233418_own_preparation_checkpoints.sql, plus the cap
-- inside the new-job branch only. Every existing check keeps its place and
-- its code: the disabled gate, the source authority, the deadline. A replay
-- of an already queued file never enters that branch and consumes nothing.
create or replace function private.enqueue_own_preparation_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare c jsonb; j private.own_preparation_jobs%rowtype; stamp timestamptz; deadline timestamptz; seconds integer;
 monthly_limit integer; month_key date; admitted_count integer;
begin
 select max_job_seconds,monthly_admission_limit into seconds,monthly_limit
  from private.own_preparation_config where singleton and enabled for share;
 if not found then raise exception using errcode='55000',message='preparation_disabled'; end if;
 c:=private.own_preparation_source_v1(p_account_id,p_session_id,p_file_id);
 select * into j from private.own_preparation_jobs where file_id=p_file_id for update;
 if j.id is null then
  stamp:=clock_timestamp(); deadline:=least(stamp+make_interval(secs=>seconds),(c->>'authorityDeadline')::timestamptz);
  if deadline<=stamp then raise exception using errcode='42501',message='not_found'; end if;
  -- Monthly admission cap, UTC calendar month. The month row is created at
  -- zero on first use, then locked, so concurrent admissions read and raise
  -- the count one at a time and can never pass the limit together. A refusal
  -- leaves the count untouched and happens before any job row exists.
  month_key:=date_trunc('month',stamp at time zone 'UTC')::date;
  insert into private.own_preparation_monthly_admissions(month_start) values(month_key) on conflict(month_start) do nothing;
  select admitted into admitted_count from private.own_preparation_monthly_admissions where month_start=month_key for update;
  if admitted_count>=monthly_limit then raise exception using errcode='53400',message='preparation_capacity_reached'; end if;
  update private.own_preparation_monthly_admissions set admitted=admitted+1 where month_start=month_key;
  insert into private.own_preparation_jobs(file_id,account_id,subject_id,session_id,authority,source,created_at,job_deadline,cleanup_deadline)
  values(p_file_id,p_account_id,(c->'source'->>'subjectId')::uuid,p_session_id,c->'authority',c->'source',stamp,deadline,stamp+interval '2 hours')
  returning * into j;
 elsif j.account_id is distinct from p_account_id or j.session_id is distinct from p_session_id
  or j.authority is distinct from c->'authority' or j.source is distinct from c->'source' then
  raise exception using errcode='42501',message='not_found';
 end if;
 if j.state='frozen' or j.job_deadline<=clock_timestamp() then
  raise exception using errcode='55000',message='preparation_cleanup_pending'; end if;
 return jsonb_build_object('version',j.version,'jobId',j.id,'fileId',j.file_id,'state',j.state,'jobDeadline',j.job_deadline);
end; $$;
-- create or replace keeps the function's privileges; restated so the contract
-- is visible here exactly as 20260908164616 declared it. The public invoker
-- wrapper is unchanged.
revoke all on function private.enqueue_own_preparation_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.enqueue_own_preparation_v1(uuid,uuid,uuid) to service_role;
