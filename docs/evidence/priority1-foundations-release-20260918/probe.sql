-- Bounded, rollback-only production probe for the two migrations applied on
-- 18 September 2026. Every call uses fresh random identities that match no
-- row, so the refusals are exercised without touching stored data; the one
-- accepted write (a valid month-ledger row) is made inside a block that
-- raises a sentinel, so it is rolled back before the block ends. Observations
-- live in a temporary table that is read once and discarded with the session.
create temporary table probe_receipt(check_name text, outcome text, passed boolean);
do $probe$
declare v jsonb; sqlstate_out text; msg text; c bigint; k text := repeat('0',64);
begin
  -- 1. No stranded record: the claim answers null and writes nothing.
  v := public.claim_due_genome_file_deletion_v1(k);
  insert into probe_receipt values('claim on empty table answers null', coalesce(v::text,'null'), v is null);
  select count(*) into c from private.genome_file_deletions;
  insert into probe_receipt values('claim on empty table wrote no record', c::text, c = 0);
  -- 2. A malformed token is refused before anything is read.
  begin perform public.claim_due_genome_file_deletion_v1('not-a-token'); insert into probe_receipt values('malformed token refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('malformed token refused', sqlstate_out||' '||msg, sqlstate_out='22023' and msg='invalid_retention_claim'); end;
  -- 3. A retry delay outside 1 minute..7 days is refused.
  begin perform public.claim_due_genome_file_deletion_v1(k, interval '8 days'); insert into probe_receipt values('retry delay bound refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('retry delay bound refused', sqlstate_out||' '||msg, sqlstate_out='22023'); end;
  -- 4. Releasing or finishing an unknown record is unauthorized, not found.
  begin perform public.fail_genome_file_deletion_claim_v1(gen_random_uuid(), k); insert into probe_receipt values('release of unknown record refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('release of unknown record refused', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='file_delete_unauthorized'); end;
  begin perform public.finish_genome_file_deletion_claimed_v1(gen_random_uuid(), k); insert into probe_receipt values('claimed finish of unknown record refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('claimed finish of unknown record refused', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='file_delete_unauthorized'); end;
  -- 5. The owner path still refuses without a live session (contract unchanged).
  begin perform public.prepare_genome_file_deletion_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()); insert into probe_receipt values('owner prepare without session refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('owner prepare without session refused', sqlstate_out||' '||msg, sqlstate_out='42501' and msg='file_delete_unauthorized'); end;
  -- 6. Preparation stays disabled: enqueue answers the disabled gate first, writing nothing.
  begin perform private.enqueue_own_preparation_v1(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()); insert into probe_receipt values('enqueue while disabled refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate, msg = message_text;
    insert into probe_receipt values('enqueue while disabled refused', sqlstate_out||' '||msg, sqlstate_out='55000' and msg='preparation_disabled'); end;
  select count(*) into c from private.own_preparation_monthly_admissions;
  insert into probe_receipt values('no month row written by the refused enqueue', c::text, c = 0);
  -- 7. The month ledger refuses a key that is not the first of a month; a valid row is rolled back inside its own block.
  begin insert into private.own_preparation_monthly_admissions(month_start) values (date '2026-09-02'); insert into probe_receipt values('mid-month key refused','no error',false);
  exception when others then get stacked diagnostics sqlstate_out = returned_sqlstate;
    insert into probe_receipt values('mid-month key refused', sqlstate_out, sqlstate_out='23514'); end;
  begin insert into private.own_preparation_monthly_admissions(month_start) values (date '2026-09-01'); raise exception 'probe_rollback';
  exception when others then get stacked diagnostics msg = message_text;
    insert into probe_receipt values('valid month row accepted then rolled back', msg, msg='probe_rollback'); end;
  select count(*) into c from private.own_preparation_monthly_admissions;
  insert into probe_receipt values('month ledger empty after the probe', c::text, c = 0);
  -- 8. Registry and limit as applied.
  insert into probe_receipt select 'registry class is inlineEventDriven', execution_class, execution_class='inlineEventDriven' from public.retention_registry where retention_id='source.revocation-7d';
  insert into probe_receipt select 'monthly limit is 100 with preparation disabled', monthly_admission_limit::text||' enabled='||enabled::text, monthly_admission_limit=100 and not enabled from private.own_preparation_config where singleton;
end $probe$;
select jsonb_build_object('observedAt', now(), 'checks', count(*), 'passed', count(*) filter (where passed), 'failed', jsonb_agg(check_name) filter (where not passed), 'rows', jsonb_agg(jsonb_build_object('check', check_name, 'outcome', outcome, 'passed', passed))) from probe_receipt;
