begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc

-- The shared fixture executes its original 38 assertions unchanged.
select throws_ok(
  $$select private.finalize_embryo_cohort_ingest_v1(
    '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
    (select draft_id from draft),(select insurance from acks),(select charter from acks),
    'nonce-session-final-001','http://localhost:3000',false)$$,
  '42501','jurisdiction unavailable','real unreviewed jurisdictions cannot mint a session');
select throws_ok(
  $$select private.finalize_embryo_cohort_ingest_v1(
    '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
    (select draft_id from draft),(select insurance from acks),(select charter from acks),
    'nonce-session-final-002','https://invalid.example/path',true)$$,
  '22023','invalid session request','invalid session input aborts cohort finalization');
select is((select count(*) from public.embryo_cohorts where draft_id=(select draft_id from draft)),
  0::bigint,'failed mint leaves no finalized cohort');
select is((select state from public.embryo_cohort_drafts where id=(select draft_id from draft)),
  'draft','failed mint restores the original draft');
select is((select count(*) from public.future_person_record_key_hashes),0::bigint,
  'failed mint leaves no provisional Record Key');
select is((select count(*) from public.embryo_ingest_sessions),0::bigint,
  'failed mint leaves no orphan session');

create function pg_temp.reject_session_due() returns trigger language plpgsql as $$
begin
  if new.retention_id='embryo.ingest-session-24h' then
    if current_setting('test.ingest_contention',true)='on' then
      raise exception using errcode='55P03',message='synthetic lock contention';
    end if;
    raise exception using errcode='ZY002',message='synthetic due-store failure';
  end if;
  return new;
end;
$$;
create trigger test_reject_session_due before insert on public.retention_due_phases
  for each row execute function pg_temp.reject_session_due();
select throws_ok($$select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-session-final-002','http://localhost:3000',true)$$,
  'ZY002','synthetic due-store failure','expiry-pair insertion failure aborts the whole finalization');
set local test.ingest_contention='on';
select throws_ok($$select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-session-final-002','http://localhost:3000',true)$$,
  '55P03','synthetic lock contention','contention remains a retriable transaction error');
set local test.ingest_contention='off';
drop trigger test_reject_session_due on public.retention_due_phases;
select ok(not exists(select 1 from public.embryo_cohorts)
  and not exists(select 1 from public.embryo_ingest_sessions)
  and not exists(select 1 from public.embryo_fragment_handle_maps)
  and not exists(select 1 from public.future_person_record_key_hashes),
  'late due-store failure leaves no cohort, session, handle or provisional key');

create function pg_temp.finalize_at_capacity() returns jsonb language plpgsql as $$
declare d public.embryo_cohort_drafts%rowtype; v_cohort uuid; i integer;
begin
  -- Synthetic prior attempts include expired and failure-pending work. Neither
  -- releases capacity before the terminal cleanup has actually removed it.
  for i in 1..2 loop
    select * into d from public.embryo_cohort_drafts where id=(select draft_id from draft);
    d.id:=gen_random_uuid();
    insert into public.embryo_cohort_drafts select d.*;
    insert into public.embryo_cohorts(draft_id,owner_account_id,upload_class,basis_case,
      basis_revision,participant_set_revision,donor_attribution_revision,embryo_count,retention_expires_at)
    values(d.id,d.owner_account_id,d.upload_class,d.basis_case,1,1,1,d.embryo_count,clock_timestamp()+interval '1 day')
    returning id into v_cohort;
    insert into public.embryo_ingest_sessions(cohort_id,originating_session_id,uploader_principal_id,
      basis_case,basis_revision,participant_set_revision,donor_attribution_revision,source_binding_fingerprint,
      created_at,expires_at,status)
    values(v_cohort,'7a000000-0000-4000-8000-0000000000a1',d.uploader_principal_id,
      d.basis_case,1,1,1,repeat('a',64),clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',
      case i when 1 then 'open' else 'failure_pending' end);
  end loop;
  return private.finalize_embryo_cohort_ingest_v1(
    '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
    (select draft_id from draft),(select insurance from acks),(select charter from acks),
    'nonce-session-final-002','http://localhost:3000',true);
end;
$$;
select throws_ok('select pg_temp.finalize_at_capacity()','54000','ingest capacity unavailable',
  'expired and failure-pending attempts still count toward the account cap');
select is((select count(*) from public.embryo_cohorts),0::bigint,
  'capacity rejection rolls back the attempted finalization and synthetic fixtures');
select ok((select proconfig @> array['lock_timeout=250ms'] from pg_proc
  where oid='private.create_embryo_ingest_session_v1(uuid,uuid,uuid,text,bigint,boolean)'::regprocedure),
  'mint bounds implicit and inherited lock waits');
select ok((select proconfig @> array['lock_timeout=250ms'] from pg_proc
  where oid='private.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)'::regprocedure),
  'wrapper bounds legacy finalization lock waits');

create temporary table minted as select private.finalize_embryo_cohort_ingest_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),
  'nonce-session-final-002','http://localhost:3000',true) as body;
create temporary table live as select s.* from public.embryo_ingest_sessions s
  where s.id=(select (body->'ingest'->>'session')::uuid from minted);
select is((select count(*) from live),1::bigint,'finalization and one session commit together');
select is((select count(*) from public.embryos where cohort_id=(select cohort_id from live)),
  3::bigint,'all three ordinal reservations exist with the session');
select is((select expires_at-created_at from live),interval '24 hours','deadline is exactly 24 hours from creation');
select is((select count(*) from public.retention_rows where target_id=(select id from live)),
  1::bigint,'session has exactly one retention row');
select is((select count(*) from public.retention_due_phases where target_id=(select id from live)),
  1::bigint,'session has exactly one due phase');
select ok((select r.fixed_deadline=s.expires_at and d.phase_deadline=s.expires_at
    and d.phase_revision=s.ingest_revision and r.retention_revision=s.ingest_revision
    and d.immutable_envelope=jsonb_build_object('cohortId',s.cohort_id,'ingestRevision',s.ingest_revision)
  from live s join public.retention_rows r on r.target_id=s.id
    join public.retention_due_phases d on d.retention_row_id=r.id),
  'one exact cohort/revision/fixed-deadline envelope binds the due pair');
select ok((select (body->'ingest'->>'cookieValue') ~ '^[A-Za-z0-9_-]{43}$' from minted),
  'session credential has 256 random bits');
select ok((select (body->'ingest'->>'challenge') ~ '^[A-Za-z0-9_-]{43}$' from minted),
  'transport challenge is a random opaque value');
select ok((select s.cookie_hash=encode(extensions.digest(convert_to(m.body->'ingest'->>'cookieValue','UTF8'),'sha256'),'hex')
  from live s cross join minted m),'only the cookie digest is stored');
select ok((select position((m.body->'ingest'->>'cookieValue') in row_to_json(s)::text)=0 from live s cross join minted m),
  'stored session has no raw credential');
select is((select count(*) from public.embryo_fragment_handle_maps where session_id=(select id from live)),
  3::bigint,'one handle digest per ordinal');
select is((select count(distinct handle_hash) from public.embryo_fragment_handle_maps where session_id=(select id from live)),
  3::bigint,'handle digests are distinct');
select ok((select bool_and(h.handle_hash=encode(extensions.digest(convert_to(x.value->>'handle','UTF8'),'sha256'),'hex')
    and h.expires_at=s.expires_at)
  from minted m cross join live s cross join lateral jsonb_array_elements(m.body->'ingest'->'sampleHandles') x
    join public.embryo_fragment_handle_maps h on h.session_id=s.id and h.sample_ordinal=(x.value->>'ordinal')::smallint),
  'each returned random handle binds to the same ordinal and deadline');
select ok((select bool_and(position(x.value->>'handle' in row_to_json(h)::text)=0)
  from minted m cross join lateral jsonb_array_elements(m.body->'ingest'->'sampleHandles') x
    join public.embryo_fragment_handle_maps h on h.session_id=(m.body->'ingest'->>'session')::uuid
      and h.sample_ordinal=(x.value->>'ordinal')::smallint),'raw handles are not persisted');
select is((select authority_fingerprint from live),
  private.embryo_ingest_authority_fingerprint_v1((select cohort_id from live)),
  'session binds the current exact authority fingerprint');
select throws_ok($$update public.embryo_ingest_sessions set expires_at=expires_at+interval '1 hour'
  where id=(select id from live)$$,'55000','immutable ingest binding','expiry cannot be extended');
select throws_ok($$update public.embryo_ingest_sessions set cohort_id=gen_random_uuid()
  where id=(select id from live)$$,'55000','immutable ingest binding','session cannot be retargeted');
select throws_ok($$update public.embryo_ingest_sessions set account_auth_session_revision=2
  where id=(select id from live)$$,'55000','immutable ingest binding','stored auth revision cannot be refreshed');
select throws_ok($$select private.create_embryo_ingest_session_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select cohort_id from live),'http://localhost:3000',200000000,true)$$,
  '55000','ingest attempt already exists','a repeat never recreates the deadline or credential');

-- Roll back each mutation inside a subtransaction; pgTAP assertions run outside
-- it, so test numbering/evidence is never reset by rollback.
create function pg_temp.authority_changes(p_sql text) returns boolean language plpgsql as $$
declare v_changed boolean:=false; v_mutated boolean:=false; v_original text;
begin
  v_original:=private.embryo_ingest_authority_fingerprint_v1((select cohort_id from live));
  begin
    execute p_sql;
    v_mutated:=true;
    v_changed:=private.embryo_ingest_authority_fingerprint_v1((select cohort_id from live))<>v_original;
    raise exception using errcode='ZY001',message='rollback fixture';
  exception
    when sqlstate 'ZY001' then null;
    when insufficient_privilege or object_not_in_prerequisite_state then v_changed:=v_mutated;
  end;
  return v_changed;
end;
$$;
select ok(pg_temp.authority_changes($$update public.embryo_participant_sets set revoked_at=clock_timestamp()
  where cohort_id=(select cohort_id from live) and set_kind='record_key_recipients'$$),
  'changed Card-recipient membership invalidates the authority');
select ok(pg_temp.authority_changes($$update public.embryo_participant_sets set membership_revision=membership_revision+1
  where cohort_id=(select cohort_id from live) and set_kind='notice_recipients'$$),
  'same-member notice revision changes the fingerprint');
select ok(pg_temp.authority_changes($$update public.embryo_cohorts set basis_revision=basis_revision+1
  where id=(select cohort_id from live)$$),'changed basis invalidates the authority');
select ok(pg_temp.authority_changes($$update public.profiles set jurisdiction_revision=jurisdiction_revision+1
  where id='7a000000-0000-0000-0000-000000000002'$$),'co-parent jurisdiction changes invalidate old signatures');
select ok(pg_temp.authority_changes($$update public.subject_principals set status='revoked'
  where id in(select principal_id from public.embryo_participant_sets
    where cohort_id=(select cohort_id from live) and set_kind='required_upload_principals')$$),
  'revoked parents cannot retain ingest authority');
select throws_ok($$update public.consent_artifacts set superseded_at=clock_timestamp()
  where artifact_key='consent.upload-embryo' and superseded_at is null$$,
  '55000','immutable row','ordinary writes cannot supersede immutable artifacts');
-- Simulate an administrative artifact migration inside the rolled-back fixture.
-- The production immutable trigger remains enabled and is separately tested.
select ok(pg_temp.authority_changes($$alter table public.consent_artifacts disable trigger consent_artifacts_immutable;
  update public.consent_artifacts set superseded_at=clock_timestamp()
  where artifact_key='consent.upload-embryo' and superseded_at is null;
  alter table public.consent_artifacts enable trigger consent_artifacts_immutable$$),
  'superseded upload consent invalidates the session evidence');
select ok(pg_temp.authority_changes($$delete from public.attestations
  where target_kind='cohort_draft' and target_id=(select draft_id from draft) and kind='disposition_rights'$$),
  'a missing typed rights attestation is not replaced by its signature');
select ok(pg_temp.authority_changes($$update public.attestations set attestation_revision=attestation_revision+1
  where target_kind='cohort_draft' and target_id=(select draft_id from draft)$$),
  'typed attestation revisions are part of the captured authority');
select ok(pg_temp.authority_changes($$insert into public.attestation_contradictions
  (cohort_id,principal_id,contradiction_code,lifecycle_revision)
  select cohort_id,uploader_principal_id,'synthetic-disposition-conflict',cohort_lifecycle_revision from live$$),
  'unresolved cohort contradictions prevent ingest authority');
select is(private.embryo_ingest_binding_failure_v1((select id from live)),null::text,
  'unchanged newly minted authority passes the per-chunk binding check');
create function pg_temp.stale_authority_reservation() returns boolean language plpgsql as $$
declare v_result jsonb; v_ok boolean;
begin
  begin
    update public.embryo_participant_sets set membership_revision=membership_revision+1
      where cohort_id=(select cohort_id from live) and set_kind='notice_recipients';
    v_result:=private.reserve_embryo_ingest_chunk_v1((select id from live),0,repeat('a',64),100,1,100,
      '[{"ordinal":0,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bytes":50,"lines":1}]');
    v_ok:=v_result->>'status'='failure_pending'
      and (select failure_code='stale-binding' from public.embryo_ingest_sessions where id=(select id from live))
      and not exists(select 1 from public.embryo_ingest_chunks where session_id=(select id from live))
      and exists(select 1 from public.retention_due_phases where target_id=(select id from live) and status='pending');
    raise exception using errcode='ZY001',message='rollback fixture';
  exception when sqlstate 'ZY001' then null;
  end;
  return v_ok;
end;
$$;
select ok(pg_temp.stale_authority_reservation(),
  'chunk reservation denies changed authority durably without new objects or removing the due phase');
create function pg_temp.contention_preserves_attempt() returns boolean language plpgsql as $$
declare v_seen boolean:=false;
begin
  begin
    -- Inject the same SQLSTATE produced by a concurrent NOWAIT parent lock.
    -- The replacement and every attempted write roll back in this subtransaction.
    execute $replacement$create or replace function private.embryo_ingest_authority_fingerprint_v1(p_cohort_id uuid)
      returns text language plpgsql security definer set search_path='' as $body$
      begin raise exception using errcode='55P03',message='synthetic parent contention'; end;
      $body$
      $replacement$;
    perform private.reserve_embryo_ingest_chunk_v1((select id from live),0,repeat('a',64),100,1,100,
      '[{"ordinal":0,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bytes":50,"lines":1}]');
    raise exception using errcode='ZY001',message='rollback fixture';
  exception
    when lock_not_available then v_seen:=true;
    when sqlstate 'ZY001' then null;
  end;
  return v_seen
    and (select status='open' and failure_code is null and accepted_chunks=0
      from public.embryo_ingest_sessions where id=(select id from live))
    and not exists(select 1 from public.embryo_ingest_chunks where session_id=(select id from live))
    and exists(select 1 from public.retention_due_phases where target_id=(select id from live) and status='pending');
end;
$$;
select ok(pg_temp.contention_preserves_attempt(),
  '55P03 bypasses the broad 55000 handler and preserves the retryable attempt');
create function pg_temp.due_change_is_denied(p_sql text) returns boolean language plpgsql as $$
declare v_ok boolean;
begin
  begin
    execute p_sql;
    v_ok:=private.embryo_ingest_binding_failure_v1((select id from live))='stale-binding';
    raise exception using errcode='ZY001',message='rollback fixture';
  exception when sqlstate 'ZY001' then null;
  end;
  return v_ok;
end;
$$;
select ok(pg_temp.due_change_is_denied($$update public.retention_due_phases
  set recipient_authority_kind='synthetic-wrong-kind' where target_id=(select id from live)$$),
  'a changed due-phase recipient kind denies the session');
select ok(pg_temp.due_change_is_denied($$update public.retention_due_phases
  set recipient_authority_revision=999 where target_id=(select id from live)$$),
  'a changed due-phase recipient revision denies the session');
select ok(pg_temp.due_change_is_denied($$update public.retention_due_phases
  set disposition_revision=999 where target_id=(select id from live)$$),
  'a changed due-phase disposition revision denies the session');
select ok(pg_temp.due_change_is_denied($$update public.retention_rows
  set disposition_revision=999 where target_id=(select id from live)$$),
  'a changed retention-row disposition revision denies the session');
select ok(not has_function_privilege('authenticated',
  'private.create_embryo_ingest_session_v1(uuid,uuid,uuid,text,bigint,boolean)','EXECUTE'),
  'clients cannot mint a session');
select ok(not has_function_privilege('anon',
  'private.finalize_embryo_cohort_ingest_v1(uuid,uuid,uuid,uuid,uuid,text,text,boolean)','EXECUTE'),
  'anon cannot finalize a cohort');
select is((select status from public.retention_due_phases where target_id=(select id from live)),
  'pending','all nonterminal work preserves the same pending due phase');
select * from finish();
rollback;
