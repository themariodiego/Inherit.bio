-- A job that exhausts its artifact budget ends now, and says why.
--
-- Measured on the hosted preview stack on 20 September 2026: a 2 GiB VCF was
-- admitted, wrote 540 artifacts and 104,485,654 bytes in 483 seconds, and
-- stopped against max_artifact_bytes with fifty minutes of its hour unused.
-- Nothing retried it. A fresh claim must start at checkpoint revision 0, so
-- the written work cannot be adopted, and freeze_due_own_preparations_v1 only
-- freezes a claimed job once job_deadline passes or attempts reaches 3 with an
-- expired claim. This job had one attempt, so neither branch fired and the row
-- sat `claimed` for the rest of its hour while the person waited to be told
-- the preparation could not be confirmed.
--
-- Owner decision 31(a), 20 September 2026: it must fail at once and say the
-- file was too large to prepare. The refusal is terminal, not transient: the
-- budget is a property of the file's size against the configuration, so a
-- second attempt spends another claim to reach the same refusal.
--
-- Additive only. No existing function changes behaviour, no ceiling moves, and
-- a deployment that never calls the new function behaves exactly as before.
alter table private.own_preparation_jobs
 add column frozen_reason text
 check(frozen_reason is null or frozen_reason in ('artifact_budget_exhausted'));

comment on column private.own_preparation_jobs.frozen_reason is
 'Why a job was ended before it could publish, when the worker knows. Null for '
 'every other ending, including a deadline that simply passed. The set is closed '
 'because a surface chooses its wording from it; a sentence never belongs here.';

-- The claim holder ends its own attempt. The caller does not name a job it may
-- freeze: it presents the claim it already holds, and that claim names the job.
-- This is why the function is shaped like renew_own_preparation_claim_v1 and
-- not like freeze_own_preparation_job_v1, which stays reachable only from the
-- service-owned bounded scan with no caller-selected account or target.
--
-- Lock order, stated so it can be checked rather than trusted:
-- check_own_preparation_claim_v1 takes the job row `for update` first, then
-- this calls freeze_own_preparation_job_v1, which takes auth.users and
-- auth.sessions for share and profiles, subjects and genome_files for update
-- before re-taking the job it already holds. So this transaction acquires job
-- then parents, while freeze_due_own_preparations_v1 acquires parents then
-- job. That inversion cannot deadlock here because the scan takes the job with
-- `for update skip locked` and moves on rather than waiting, so only one side
-- ever blocks.
create function private.fail_own_preparation_claim_v1(p_job_id uuid,p_attempt_id uuid,
 p_claim_token_hash text,p_reason text,p_byte_count bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare j private.own_preparation_jobs%rowtype; cfg private.own_preparation_config%rowtype;
begin
 if p_reason is null or p_reason not in ('artifact_budget_exhausted')
  or p_byte_count is null or p_byte_count<=0 then
  raise exception using errcode='22023',message='invalid_request'; end if;
 -- Authority first and always: a live claim for this exact attempt and token,
 -- inside its lease, with the source and authority still matching.
 perform private.check_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash);
 select * into j from private.own_preparation_jobs where id=p_job_id;
 select * into cfg from private.own_preparation_config where singleton for share;
 -- The reason is VERIFIED, not taken on the caller's word. A worker says the
 -- budget is spent; this re-runs the same comparison
 -- reserve_own_preparation_artifact_v1 makes, against the same rows, and
 -- refuses to record a reason that is not true. A reason nothing corroborates
 -- would be an invented claim, and a surface reads its wording from this
 -- column.
 if p_reason='artifact_budget_exhausted'
  and not (j.artifact_count>=4096 or j.reserved_bytes+p_byte_count>cfg.max_artifact_bytes) then
  raise exception using errcode='22023',message='reason_not_established'; end if;
 update private.own_preparation_jobs set frozen_reason=p_reason
  where id=p_job_id and state='claimed' and attempt_id=p_attempt_id
   and claim_token_hash=p_claim_token_hash returning * into j;
 if not found then raise exception using errcode='42501',message='not_found'; end if;
 -- The transition itself stays where it already is, with the locks it already
 -- takes and the published-job refusal it already makes.
 return private.freeze_own_preparation_job_v1(p_job_id);
end; $$;

create function public.fail_own_preparation_claim_v1(p_job_id uuid,p_attempt_id uuid,
 p_claim_token_hash text,p_reason text,p_byte_count bigint)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
 select private.fail_own_preparation_claim_v1(p_job_id,p_attempt_id,p_claim_token_hash,p_reason,p_byte_count); $$;

revoke all on function private.fail_own_preparation_claim_v1(uuid,uuid,text,text,bigint),
 public.fail_own_preparation_claim_v1(uuid,uuid,text,text,bigint)
 from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.fail_own_preparation_claim_v1(uuid,uuid,text,text,bigint),
 public.fail_own_preparation_claim_v1(uuid,uuid,text,text,bigint) to service_role;
