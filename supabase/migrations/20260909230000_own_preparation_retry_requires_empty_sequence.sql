-- Stop offering a retry that no attempt can take.
--
-- A job owns one artifact sequence namespace: `own_preparation_artifacts` is
-- unique on (job_id, sequence), so a second attempt cannot restart at sequence
-- 0 while the first attempt's rows are still there, and `artifact_count` is
-- deliberately monotonic for exactly that reason. The worker knows this and
-- requires a newly claimed attempt to start empty
-- (`src/lib/uploads/own-preparation-worker.ts`), reading `nextArtifactSequence`
-- from the job-wide `artifact_count`.
--
-- The claim predicate did not know it. A job whose first attempt reserved even
-- one artifact was still offered to attempts two and three, which re-claimed
-- successfully and then failed at once. Reproduced before this change:
--
--   after reserve   attempts 1   artifact_count 1
--   reclaimed       t
--   after reclaim   attempts 2   artifact_count 1   nextArtifactSequence 1
--
-- Two consequences, both bad. The retry budget and its exponential backoff were
-- spent on work that could not start; and each wasted attempt raised
-- `integrity_mismatch` from the worker, an error that reads like tampering, so
-- a real integrity failure would arrive amid routine noise.
--
-- Retry is therefore offered only where it can be taken: a job that has
-- consumed none of its sequence. That is the case the retry was always for —
-- an attempt lost before it wrote anything. Recovery for a job that did write
-- is unchanged and remains what the design already provides: scratch cleanup
-- retires the job, and preparation is requested again.
--
-- This admits nothing new, weakens no authority check, and moves no limit. It
-- narrows one candidate predicate to match a requirement the worker already
-- enforced.
create or replace function private.claim_next_own_preparation_v1(p_claim_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $function$
declare candidate record; j private.own_preparation_jobs%rowtype; c jsonb; stamp timestamptz;
begin
 if p_claim_token_hash is null or p_claim_token_hash!~'^[0-9a-f]{64}$' then
  raise exception using errcode='22023',message='invalid_request'; end if;
 if not exists(select 1 from private.own_preparation_config where singleton and enabled for share) then
  raise exception using errcode='55000',message='preparation_disabled'; end if;
 -- Candidate lookup is not authority. Obtain account/source locks before the
 -- job lock; a second claimant rechecks state after those locks are acquired.
 for candidate in select id,account_id,session_id,file_id from private.own_preparation_jobs
  where job_deadline>clock_timestamp() and attempts<3 and (state='queued' or
   (state='claimed' and artifact_count=0
    and claim_expires_at+make_interval(secs=>30*power(2,attempts)::integer)<=clock_timestamp()))
  order by created_at,id limit 5 loop
  begin c:=private.own_preparation_source_v1(candidate.account_id,candidate.session_id,candidate.file_id);
  exception when insufficient_privilege or object_not_in_prerequisite_state then continue; end;
  select * into j from private.own_preparation_jobs where id=candidate.id for update skip locked;
  if j.id is null or j.state='frozen' or j.attempts>=3 or j.job_deadline<=clock_timestamp()
   or j.authority is distinct from c->'authority' or j.source is distinct from c->'source'
   or (j.state='claimed' and (j.artifact_count>0
    or j.claim_expires_at+make_interval(secs=>30*power(2,j.attempts)::integer)>clock_timestamp())) then continue; end if;
  if exists(select 1 from private.own_preparation_artifacts a where a.job_id=j.id and a.write_expires_at>clock_timestamp()) then continue; end if;
  stamp:=clock_timestamp();
  update private.own_preparation_jobs set state='claimed',attempt_id=gen_random_uuid(),claim_token_hash=p_claim_token_hash,
   attempts=attempts+1,claim_expires_at=least(stamp+interval '5 minutes',job_deadline,(c->>'authorityDeadline')::timestamptz)
   where id=j.id returning * into j;
  if j.claim_expires_at<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
  return private.own_preparation_claim_receipt_v1(j);
 end loop;
 return null;
end; $function$;
-- CREATE OR REPLACE keeps existing privileges, but this is a security definer
-- function and the storage-authorization test counts exactly which of those the
-- upload role may execute. Restate them rather than depend on remembering that.
revoke all on function private.claim_next_own_preparation_v1(text) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.claim_next_own_preparation_v1(text) to service_role;
