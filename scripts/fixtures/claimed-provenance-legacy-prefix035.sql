-- Root-only additional forward-migration rehearsal on the exact owned
-- prefix035 with its ordinary pgTAP harness already present. Everything,
-- including036 catalog changes, is rolled back. Never run on production.
begin;
select no_plan();
select is(to_regprocedure('private.collect_claimed_provenance_pair_v1(text,uuid,jsonb,text)')::text,null::text,
 'the legacy rehearsal requires the genuine prefix before036 exists');
do $$ begin
 if to_regprocedure('private.collect_claimed_provenance_pair_v1(text,uuid,jsonb,text)') is not null
  or (select md5(prosrc) from pg_proc where oid='private.prepare_future_person_deletion_v1(text,text)'::regprocedure)
    is distinct from '825d2bb042623900b71bfc516f9e8b42' then
  raise exception using errcode='55000',message='legacy rehearsal requires exact prefix035';end if;
end $$;
\ir ../../supabase/tests/fixtures/future_person_deletion_authority.inc
create temporary table legacy_claimant_plan as select private.prepare_future_person_deletion_v1(pg_temp.h('deletion-rights'),
 'legacy-prefix035-delete-aaaaaaaa') id;
create temporary table legacy_phase_snapshot as select to_jsonb(p) value from legacy_claimant_plan d
 join public.purge_manifests m on m.id=d.id join public.retention_due_phases p on p.retention_row_id=m.retention_row_id and p.phase_id=m.phase_id;
create temporary table legacy_manifest_snapshot as select to_jsonb(m) value from public.purge_manifests m where id=(select id from legacy_claimant_plan);
select ok((select not(value->'immutable_envelope' ? 'sharedProvenance') from legacy_phase_snapshot),
 'the actual old native producer creates its genuine old immutable envelope without a pair candidate');
\ir ../../supabase/migrations/20261001036000_claimed_provenance_last_consumer.sql
select throws_ok($$select private.assert_future_person_deletion_plan_v1((select id from legacy_claimant_plan))$$,
 '42501','claimant deletion unavailable','the actual036 successor refuses a real old sealed plan without reconstructing or backfilling its pair');
select is((select to_jsonb(p) from legacy_claimant_plan d join public.purge_manifests m on m.id=d.id
 join public.retention_due_phases p on p.retention_row_id=m.retention_row_id and p.phase_id=m.phase_id),
 (select value from legacy_phase_snapshot),'forward migration/refusal preserves the full genuine old phase and all original clocks byte-exact');
select is((select to_jsonb(m) from public.purge_manifests m where id=(select id from legacy_claimant_plan)),
 (select value from legacy_manifest_snapshot),'the old manifest, fingerprint and authority state are not silently changed');
select * from finish();
rollback;
