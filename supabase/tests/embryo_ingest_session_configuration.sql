begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-configuration-finalize','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);

create function pg_temp.configure_ingest(
  p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_auth uuid default '7a000000-0000-4000-8000-0000000000a1',p_cookie text default null,
  p_cohort uuid default null,p_nonce text default 'nonce-configuration-001',
  p_format text default 'pgt_table',p_build text default null,p_evidence text default 'decision-required',
  p_test boolean default true
) returns jsonb language sql as $$
  select private.configure_embryo_ingest_session_v1(p_account,p_auth,(select id from live),
    coalesce(p_cookie,(select cookie_hash from live)),'http://localhost:3000',
    coalesce(p_cohort,(select cohort_id from live)),(select ingest_revision from live),
    p_format,p_build,p_evidence,p_nonce,p_test)
$$;
create function pg_temp.challenge(
  p_kind text default 'columns',p_count integer default 4,
  p_token text default repeat('C',43),p_nonce text default 'nonce-challenge-001',p_revision bigint default 1
) returns jsonb language sql as $$
  select private.create_embryo_mapping_challenge_v1(
    '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
    (select id from live),(select cookie_hash from live),'http://localhost:3000',
    (select cohort_id from live),(select ingest_revision from live),p_revision,p_kind,p_count,p_token,p_nonce,true)
$$;
create function pg_temp.resolve_challenge(
  p_token text default repeat('C',43),
  p_resolution jsonb default '[{"columnIndex":0,"field":"sample"},{"columnIndex":3,"field":"genotype"}]',
  p_nonce text default 'nonce-decision-001'
) returns jsonb language sql as $$
  select private.resolve_embryo_mapping_challenge_v1(
    '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
    (select id from live),(select cookie_hash from live),'http://localhost:3000',
    (select cohort_id from live),(select ingest_revision from live),p_token,p_resolution,p_nonce,true)
$$;

create function pg_temp.failure_probe(p_sql text,p_call text) returns text language plpgsql as $$
declare result text;
begin
 begin
  execute p_sql;
  execute p_call into result;
  raise exception using errcode='ZY001',message='restore synthetic probe';
 exception when sqlstate 'ZY001' then null;
 end;
 return result;
end $$;

select ok(not has_function_privilege('anon',
 'private.configure_embryo_ingest_session_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,text,boolean)','execute'),
 'anonymous callers cannot supply trusted configuration');
select ok(not has_function_privilege('authenticated',
 'private.create_embryo_mapping_challenge_v1(uuid,uuid,uuid,text,text,uuid,bigint,bigint,text,integer,text,text,boolean)','execute'),
 'authenticated clients cannot mint trusted mapping challenges');
select ok(not has_function_privilege('authenticated',
 'private.resolve_embryo_mapping_challenge_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,jsonb,text,boolean)','execute'),
 'authenticated clients cannot write a mapping decision directly');
select ok(has_function_privilege('service_role',
 'private.configure_embryo_ingest_session_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,text,boolean)','execute'),
 'the configured server role can execute the private prerequisite');
select throws_ok($$select pg_temp.configure_ingest(p_account:='7a000000-0000-0000-0000-000000000002')$$,
 '42501','ingest unavailable','another account cannot configure this cohort');
select throws_ok($$select pg_temp.configure_ingest(p_auth:='7a000000-0000-4000-8000-0000000000b1')$$,
 '42501','ingest unavailable','another live login cannot configure this session');
select throws_ok($$select pg_temp.configure_ingest(p_cookie:=repeat('f',64))$$,
 '42501','ingest unavailable','a wrong cookie cannot configure this session');
select throws_ok($$select pg_temp.configure_ingest(p_cohort:='7a000000-0000-0000-0000-000000000099')$$,
 '42501','ingest unavailable','a different expected cohort cannot mutate the real session');
select throws_ok($$select pg_temp.configure_ingest(p_test:=false)$$,
 '42501','jurisdiction unavailable','configuration cannot activate a real jurisdiction');
select throws_ok($$select pg_temp.configure_ingest(p_format:='bam')$$,
 '22023','invalid ingest configuration','an unsupported format is not recorded');
select throws_ok($$select pg_temp.configure_ingest(p_build:='GRCh38')$$,
 '22023','invalid ingest configuration','decision-required cannot masquerade as an inferred build');
select throws_ok($$select pg_temp.configure_ingest(p_format:='vcf',p_evidence:='reference-inference',p_build:='GRCh38')$$,
 '22023','invalid ingest configuration','the table-only inference path cannot assign a VCF build');
select is((select to_jsonb(s) from public.embryo_ingest_sessions s where id=(select id from live)),
 (select to_jsonb(s) from live s),'every denied configuration preserves the complete session');

create temporary table configured as select pg_temp.configure_ingest() as body;
select is((select body->>'status' from configured),'configured','trusted unresolved table metadata is configured');
select is(pg_temp.configure_ingest(),(select body from configured),'exact configuration retry is idempotent');
select throws_ok($$select pg_temp.configure_ingest(p_nonce:='different-configuration-001')$$,
 '55000','ingest configuration already fixed','another operation cannot adopt the first configuration');
select throws_ok($$select pg_temp.configure_ingest(p_build:='GRCh38',p_evidence:='explicit-header')$$,
 '55000','ingest configuration already fixed','a retry cannot substitute a new build');
select is((select source_format from public.embryo_ingest_sessions where id=(select id from live)),
 'pgt_table','the format is recorded without source labels');
select is((select reference_build from public.embryo_ingest_sessions where id=(select id from live)),
 null::text,'an unresolved build remains unresolved');

create temporary table issued as select pg_temp.challenge() as body;
select is((select body->>'status' from issued),'challenge','a bounded challenge is created');
select is(pg_temp.challenge(),(select body from issued),'exact issuance retry preserves revision and expiry');
select is((select count(*) from public.embryo_mapping_challenges),1::bigint,'retry creates no duplicate challenge');
select ok(not exists(select 1 from public.embryo_mapping_challenges c where
 position(repeat('C',43) in to_jsonb(c)::text)>0),'the raw random challenge token is never persisted');
select ok((select c.expires_at<=s.expires_at from public.embryo_mapping_challenges c
 join public.embryo_ingest_sessions s on s.id=c.ingest_session_id),'challenge cannot outlive its fixed session');
select throws_ok($$update public.embryo_mapping_challenges set expires_at=expires_at+interval '1 minute'$$,
 '55000','immutable mapping challenge','challenge retry cannot extend its expiry');
select throws_ok($$update public.embryo_mapping_challenges set challenge_kind='build',column_count=null$$,
 '55000','immutable mapping challenge','an issued challenge cannot change kind');
create function pg_temp.plant_nonce_contention() returns trigger language plpgsql as $$
begin
 if new.operation='ingest_mapping_inspect' then
  raise exception using errcode='55P03',message='synthetic nonce contention';
 end if;
 return new;
end $$;
create trigger test_nonce_contention before insert on public.embryo_operation_nonces
 for each row execute function pg_temp.plant_nonce_contention();
select throws_ok($$select pg_temp.challenge(p_token:=repeat('D',43),p_nonce:='nonce-contention-probe')$$,
 '55P03','synthetic nonce contention','contention aborts issuance rather than replacing its identity');
drop trigger test_nonce_contention on public.embryo_operation_nonces;
select is(pg_temp.challenge(),(select body from issued),'contention preserves the original challenge and deadline');
select is((select count(*) from public.embryo_mapping_challenges),1::bigint,'failed issuance leaves no competing challenge');
select throws_ok($$select pg_temp.challenge(p_count:=129,p_nonce:='nonce-too-many-columns')$$,
 '22023','invalid mapping challenge','header cardinality stays bounded');
select throws_ok($$select pg_temp.challenge(p_revision:=2,p_nonce:='nonce-stale-revision')$$,
 '55000','mapping challenge unavailable','a different transport revision cannot acquire the challenge');
select throws_ok($$select pg_temp.challenge(p_token:=repeat('D',43))$$,
 '42501','mapping challenge unavailable','one nonce cannot identify two challenges');
select throws_ok($$select pg_temp.resolve_challenge(p_token:=repeat('F',43))$$,
 '42501','mapping challenge unavailable','an unknown challenge reveals no state');
select throws_ok($$select pg_temp.resolve_challenge(p_resolution:='[{"columnIndex":4,"field":"sample"}]')$$,
 '22023','invalid mapping decision','column indices must belong to this header width');
select throws_ok($$select pg_temp.resolve_challenge(p_resolution:='[{"columnIndex":0,"field":"sample"},{"columnIndex":0,"field":"genotype"}]')$$,
 '22023','invalid mapping decision','a source column cannot satisfy two decisions');
select throws_ok($$select pg_temp.resolve_challenge(p_resolution:='[{"columnIndex":0,"field":"sample"},{"columnIndex":1,"field":"sample"}]')$$,
 '22023','invalid mapping decision','a canonical field cannot be assigned twice');
select throws_ok($$select pg_temp.resolve_challenge(p_resolution:='[{"columnIndex":0,"field":"sex"}]')$$,
 '22023','invalid mapping decision','a declared sex field never becomes DNA evidence');
select throws_ok($$select pg_temp.resolve_challenge(p_resolution:='[{"columnIndex":0,"field":"sample","header":"private label"}]')$$,
 '22023','invalid mapping decision','source labels and unknown fields never enter the stored mapping');
select throws_ok($$select pg_temp.resolve_challenge(p_resolution:='{"referenceBuild":"GRCh38"}')$$,
 '22023','invalid mapping decision','the stored challenge kind controls the request shape');
select is(pg_temp.failure_probe(
 $$alter table public.embryo_mapping_challenges disable trigger embryo_mapping_challenge_immutable; update public.embryo_mapping_challenges set expires_at=clock_timestamp()-interval '1 second' where state='pending'$$,
 $$select pg_temp.resolve_challenge()->>'status'$$),'failure_pending','an expired challenge cannot resolve or renew the attempt');
select is(pg_temp.resolve_challenge()->>'status','resolved','valid canonical column decisions resolve');
select is(pg_temp.resolve_challenge()->>'status','resolved','the identical resolution is idempotent');
select is((select count(*) from public.embryo_operation_nonces where operation='ingest_mapping_decide'),
 1::bigint,'resolution retry does not consume another nonce');
select is((select resolution from public.embryo_mapping_challenges),
 '[{"columnIndex":0,"field":"sample"},{"columnIndex":3,"field":"genotype"}]'::jsonb,
 'only canonical column indices and fields survive');
select is(pg_temp.configure_ingest(),(select body from configured),'configuration remains idempotent after mapping');
select is(pg_temp.failure_probe(
 $$update public.embryo_ingest_sessions set transport_revision=transport_revision+1 where id=(select id from live)$$,
 $$select pg_temp.resolve_challenge()->>'status'$$),'failure_pending',
 'an exact resolved replay cannot cross a later transport revision');
select is(pg_temp.failure_probe(
 $$alter table public.embryo_mapping_challenges disable trigger embryo_mapping_challenge_immutable; update public.embryo_mapping_challenges set expires_at=clock_timestamp()-interval '1 second' where state='resolved'$$,
 $$select pg_temp.resolve_challenge()->>'status'$$),'failure_pending',
 'resolved replay does not bypass challenge expiry');


select is(pg_temp.challenge('build',null,repeat('B',43),'nonce-build-challenge')->>'status','challenge',
 'an unresolved table receives a separate build challenge');
select is(pg_temp.failure_probe('select 1',
 $$select pg_temp.resolve_challenge(repeat('B',43),'{"referenceBuild":"unknown"}','nonce-unknown-build')->>'status'$$),
 'failure_pending','unknown build retains the attempt for identical unwind and produces no source');
select is(pg_temp.resolve_challenge(repeat('B',43),'{"referenceBuild":"GRCh38"}','nonce-build-decision')->>'status','resolved',
 'the explicit bounded build answer resolves its own challenge');
select is((select reference_build from public.embryo_ingest_sessions where id=(select id from live)),
 'GRCh38','accepted canonical build is recorded without changing the original configuration evidence');
select is(pg_temp.configure_ingest(),(select body from configured),'original configuration retry cannot erase the later build decision');
select throws_ok($$select pg_temp.challenge('build',null,repeat('E',43),'nonce-build-overwrite')$$,
 '55000','mapping challenge unavailable','a decided build cannot be overwritten by another challenge');

select throws_ok($$update public.embryo_ingest_sessions set reference_build='GRCh37' where id=(select id from live)$$,
 '55000','immutable ingest configuration','a decided build cannot be replaced by a direct database update');
select throws_ok($$update public.embryo_ingest_sessions set source_format='vcf' where id=(select id from live)$$,
 '55000','immutable ingest configuration','the source format is write-once');

-- Isolated failure probes preserve the successful fixture using a savepoint.
select is(pg_temp.failure_probe(
 $$delete from auth.sessions where id='7a000000-0000-4000-8000-0000000000a1'$$,
 $$select pg_temp.configure_ingest()->>'status'$$),'failure_pending','revocation wins even over an otherwise idempotent replay');
select is(pg_temp.failure_probe(
 $$update public.embryo_fragment_handle_maps set consumed_at=clock_timestamp() where session_id=(select id from live) and sample_ordinal=0$$,
 $$select pg_temp.configure_ingest()->>'status'$$),'failure_pending','current handle authority is rechecked on every retry');
select is(pg_temp.failure_probe(
 $$update public.profiles set auth_session_revision=auth_session_revision+1 where id='7a000000-0000-0000-0000-000000000001'$$,
 $$select pg_temp.configure_ingest()->>'status'$$),'failure_pending','a revised account session cannot reuse earlier configuration authority');

select is(pg_temp.failure_probe(
 $$update public.profiles set jurisdiction_revision=jurisdiction_revision+1 where id='7a000000-0000-0000-0000-000000000002'$$,
 $$select pg_temp.configure_ingest()->>'status'$$),'failure_pending','a co-parent jurisdiction change invalidates earlier authority');
select is(pg_temp.failure_probe(
 $$alter table public.consent_artifacts disable trigger consent_artifacts_immutable;
 update public.consent_artifacts set superseded_at=clock_timestamp() where artifact_key='consent.upload-embryo' and superseded_at is null;
 alter table public.consent_artifacts enable trigger consent_artifacts_immutable$$,
 $$select pg_temp.configure_ingest()->>'status'$$),'failure_pending','superseded upload consent cannot authorize configuration replay');

select is((select expires_at from public.embryo_ingest_sessions where id=(select id from live)),
 (select expires_at from live),'configuration and challenge round trips never renew session expiry');
select ok(exists(select 1 from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
 where r.target_id=(select id from live) and r.fixed_deadline=(select expires_at from live)
 and d.phase_deadline=(select expires_at from live) and d.status='pending'),
 'the original unwind target and absolute deadline remain scheduled');
select is((select count(*) from public.embryo_ingest_chunks),0::bigint,'configuration writes no chunks');
select is((select count(*) from public.embryo_ingest_fragments),0::bigint,'configuration writes no fragments');
select is((select count(*) from public.genome_files),0::bigint,'configuration publishes no source files');
select is((select count(*) from public.worker_jobs where kind='split_cohort_vcf'),0::bigint,'configuration enqueues no sanitization jobs');
select ok((select proconfig @> array['lock_timeout=250ms'] from pg_proc where
 oid='private.configure_embryo_ingest_session_v1(uuid,uuid,uuid,text,text,uuid,bigint,text,text,text,text,boolean)'::regprocedure),
 'configuration bounds contending lock waits');
select * from finish();
rollback;
