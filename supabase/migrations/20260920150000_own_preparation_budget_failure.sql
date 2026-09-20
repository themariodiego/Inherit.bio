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
-- Additive in effect, though not in text: two existing functions are replaced,
-- and each gains exactly one rule that no path can reach until the new function
-- is called. The identity guard learns the new column and makes it write-once,
-- which can only fire on a row that already carries a reason; the status
-- function emits a `reason` key only when one is recorded, so its answer stays
-- byte-identical for every job without one. Nothing else in either body moves,
-- no ceiling moves, and a deployment that never calls the new function behaves
-- exactly as before. Release order is the one the gVCF ceiling migration set
-- out: the app must accept the extra key before this is applied.
alter table private.own_preparation_jobs
 add column frozen_reason text
 check(frozen_reason is null or frozen_reason in ('artifact_budget_exhausted'));

comment on column private.own_preparation_jobs.frozen_reason is
 'Why a job was ended before it could publish, when the worker knows. Null for '
 'every other ending, including a deadline that simply passed. The set is closed '
 'because a surface chooses its wording from it; a sentence never belongs here.';

-- The identity guard forbids any column outside its mutable set from changing,
-- so a new column is rejected until the guard knows about it: run 35517541568
-- reached the happy path and raised `preparation_identity_immutable`. The guard
-- is right to do that, and this is the whole of what it needs — plus the rule
-- that makes the new column write-once, because a reason that could be edited
-- after the fact is not a record of anything. That clause is a second lock on a
-- door the frozen-row rule already holds, since this API sets the reason and
-- freezes in one call; it matters only if some later path records a reason
-- without freezing.
--
-- Everything else here is the deployed body character for character. That is a
-- claim you can check rather than trust: this body is
-- `20260908233337_own_prepared_r2_provider.sql`'s, and
-- `diff`ing the two functions must show only the two changes named above. The
-- first draft of this migration was built from the older
-- `20260908185537_own_prepared_publication.sql` body instead, and `create or
-- replace` would have reverted three protections that migration added later:
-- published rows would have become mutable again, a job could have been
-- published from a state other than `claimed`, and `provider_version` and
-- `provider_etag` would have left the artifacts row's mutable set.
--
-- Two of the three were already defended, and run 35519879598 proved it — the
-- first run to see that draft, three pushes having produced no run at all while
-- the PR was unmergeable. `own_prepared_publication.sql`'s "published job
-- cannot be reopened" went red, and the R2 ACK's own UPDATE began raising this
-- guard, taking `own_prepared_r2_provider.sql`, `own_prepared_cleanup.sql` and
-- `own_prepared_original_retirement.sql` down with it. A read-only production
-- preflight found it first and named all three, by diffing `pg_get_functiondef`
-- against this file. The third — publishing from a state other than `claimed` —
-- nothing covered, and the case below is what now covers it.
create or replace function private.guard_own_preparation_identity_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if tg_table_name='own_preparation_jobs' then
  if (to_jsonb(new)-array['state','attempt_id','claim_token_hash','claim_expires_at','attempts',
    'reserved_bytes','artifact_count','frozen_at','write_fence_at','frozen_reason']) is distinct from
   (to_jsonb(old)-array['state','attempt_id','claim_token_hash','claim_expires_at','attempts',
    'reserved_bytes','artifact_count','frozen_at','write_fence_at','frozen_reason'])
   or (old.state in('frozen','published') and to_jsonb(new) is distinct from to_jsonb(old))
   or (new.state='published' and old.state<>'claimed')
   or new.attempts<old.attempts or new.reserved_bytes<old.reserved_bytes or new.artifact_count<old.artifact_count
   or (old.frozen_reason is not null and new.frozen_reason is distinct from old.frozen_reason) then
   raise exception using errcode='22023',message='preparation_identity_immutable'; end if;
 else
  if (to_jsonb(new)-array['state','storage_object_id','observed_sha256','acknowledged_at','provider_version','provider_etag']) is distinct from
    (to_jsonb(old)-array['state','storage_object_id','observed_sha256','acknowledged_at','provider_version','provider_etag'])
   or (old.state='acknowledged' and to_jsonb(new) is distinct from to_jsonb(old)) then
   raise exception using errcode='22023',message='preparation_identity_immutable'; end if;
 end if;
 return new;
end; $$;

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

-- The surface learns this asynchronously, so the reason has to travel with the
-- status. Unlike the month's admission cap, which the database raises at
-- admission and the route answers 429 in the same request, a spent budget
-- happens later inside the container: /process already succeeded and the
-- browser finds out by polling. The status reports `failed` for a frozen job
-- already; this adds why, when there is a why.
--
-- The key is emitted ONLY when a reason exists, so the answer is byte-identical
-- to today's for every job that has none. Release order is still the one the
-- gVCF ceiling migration set out: the app must accept the extra key before this
-- is applied, because its schema is strict. Everything else in the body is the
-- current one unchanged.
create or replace function private.own_preparation_status_v1(p_account_id uuid,p_session_id uuid,p_file_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare f public.genome_files%rowtype; j private.own_preparation_jobs%rowtype; c jsonb;
 state text; deadline timestamptz;
begin
 if not exists(select 1 from private.own_preparation_config where singleton and enabled for share) then
  raise exception using errcode='55000',message='preparation_disabled'; end if;
 select * into f from public.genome_files where id=p_file_id and user_id=p_account_id;
 if f.id is null or f.subject_id is null or f.tier<>1 or f.file_type::text not in('vcf','gvcf')
  or f.single_logical_sample_verified_at is null or not exists(select 1 from public.subjects where id=f.subject_id
   and subject_class='self' and owner_account_id=p_account_id and subject_account_id=p_account_id and lifecycle='active') then
  raise exception using errcode='42501',message='not_found'; end if;
 -- Preliminary lookup only chooses the appropriate current authority resolver.
 select * into j from private.own_preparation_jobs where file_id=f.id;
 if j.state='published' then
  perform private.read_own_prepared_manifest_v1(p_account_id,p_session_id,p_file_id,null);
  return jsonb_build_object('version','own-preparation-status-v1','fileId',p_file_id,'jobId',j.id,'status','prepared');
 end if;
 if j.id is null and f.normalization_completed_at is not null then
  perform private.own_upload_store_authority_v1(p_account_id,p_session_id,f.subject_id);
  return jsonb_build_object('version','own-preparation-status-v1','fileId',p_file_id,'jobId',null,'status','not_applicable');
 end if;
 c:=private.own_preparation_source_v1(p_account_id,p_session_id,p_file_id);
 select * into j from private.own_preparation_jobs where file_id=p_file_id for share;
 if j.id is null then state:='not_requested';
 else
  if j.account_id is distinct from p_account_id or j.subject_id is distinct from f.subject_id or j.source is distinct from c->'source' then
   raise exception using errcode='42501',message='not_found'; end if;
  state:=case when j.state='frozen' or j.job_deadline<=clock_timestamp() then 'failed' else 'preparing' end;
  -- Status is metadata, not a second worker claim. Do not acquire an old
  -- session lock after current source locks; the worker independently rechecks
  -- all originating authority before any bytes or renewal.
  if state='preparing' and not exists(select 1 from auth.sessions where id=j.session_id and user_id=j.account_id
   and (not_after is null or not_after>clock_timestamp())) then state:='failed'; end if;
 end if;
 deadline:=(c->>'authorityDeadline')::timestamptz;
 if deadline is not null and deadline<=clock_timestamp() then raise exception using errcode='42501',message='not_found'; end if;
 return jsonb_build_object('version','own-preparation-status-v1','fileId',p_file_id,'jobId',j.id,'status',state)
  || case when j.frozen_reason is null then '{}'::jsonb
     else jsonb_build_object('reason',j.frozen_reason) end;
end; $$;
