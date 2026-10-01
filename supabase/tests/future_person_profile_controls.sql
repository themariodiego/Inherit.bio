begin;
select no_plan();
\ir fixtures/future_person_custody_source.inc
create temporary table controls_record as select e.* from public.embryos e
  where e.cohort_id=(select cohort_id from live) and e.sample_ordinal=0;
create temporary table controls_proposal as select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select id from controls_record),'propose','transferred',null,'controls-transfer-propose-001') body;
select is(public.record_embryo_disposition_v1('7a000000-0000-0000-0000-000000000002',
  '7a000000-0000-4000-8000-0000000000b1',(select id from controls_record),'confirm','transferred',
  (select (body->>'proposalId')::uuid from controls_proposal),'controls-transfer-confirm-001')->>'disposition',
  'transferred','the actual other current parent confirms this fixture disposition');
create function pg_temp.controls(p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_session uuid default '7a000000-0000-4000-8000-0000000000a1',p_after uuid default null)
returns jsonb language sql as $$select public.future_person_profile_controls_v1(p_account,p_session,p_after);$$;
create temporary table controls_before as select pg_temp.controls() body,
  (select count(*) from public.embryo_operation_nonces) nonces,
  (select count(*) from public.future_person_identity) profiles;
select is(jsonb_array_length((select body->'items' from controls_before)),1,
  'only the actual currently transferred record has a prospective parent profile control');
select ok((select body->'nextCursor'='null'::jsonb
  and body#>>'{items,0,embryoId}'=(select id::text from controls_record)
  and body#>'{items,0,hasProfile}'='false'::jsonb
  and body#>'{items,0,saveContext}'<>'null'::jsonb
  and body#>'{items,0,deleteContext,consentSignatureId}'='null'::jsonb
  and (body#>>'{items,0,expiresAt}')::timestamptz=(select fixed_deadline from public.retention_rows
    where retention_id='embryo.transferred-claim-window' and target_id=(select subject_id from controls_record)
      and state in ('active','scheduled')) from controls_before),
  'the inventory binds the same exact parent authority and unchanged original deadline without saved fields');
select is(pg_temp.controls(),(select body from controls_before),'repeated settings reads are stable and do not rotate database authority');
select is((select count(*) from public.embryo_operation_nonces),(select nonces from controls_before),
  'read-only control discovery stores no operation nonce');
select is((select count(*) from public.future_person_identity),(select profiles from controls_before),
  'read-only control discovery creates no protected profile');
select ok((select body::text !~ 'parentNames|childDateOfBirth|ciphertext|wrapped|match_indexes' from controls_before),
  'the internal control inventory contains no saved profile plaintext, ciphertext, key or match index');
select is(jsonb_array_length(pg_temp.controls('7a000000-0000-0000-0000-000000000003',
  '7a000000-0000-4000-8000-0000000000c1')->'items'),0,'a stranger discovers no current-parent controls');
select is(jsonb_array_length(pg_temp.controls('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000b1')->'items'),0,'a crossed Auth session discovers no prospective operation');
select is(jsonb_array_length(pg_temp.controls(p_after=>(select id from controls_record))->'items'),0,
  'the current cursor advances past its exact record without duplicating an operation');
select ok(pg_temp.controls('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1')
    #>>'{items,0,saveContext,actorPrincipal}'<>(select body#>>'{items,0,saveContext,actorPrincipal}' from controls_before),
  'the other actual parent receives only their own consent/actor authority');
select is(public.write_future_person_profile_v1('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',(select id from controls_record),
  (select (body#>>'{items,0,saveContext,consentSignatureId}')::uuid from controls_before),
  (select body#>'{items,0,saveContext}' from controls_before),gen_random_uuid(),extensions.gen_random_bytes(64),
  extensions.gen_random_bytes(72),jsonb_build_object('1',repeat('a',64)),'controls-profile-save-00001')->>'status',
  'saved','the actual inventory receipt authorizes only its real current parent mutation');
select ok(pg_temp.controls()#>'{items,0,hasProfile}'='true'::jsonb
  and pg_temp.controls()#>'{items,0,deleteContext,currentProfileId}'<>'null'::jsonb,
  'a fresh read reports storage status and the new exact delete target without reading its fields');
create function pg_temp.controls_without_new_consent() returns jsonb language plpgsql as $$
declare body jsonb;
begin
  begin
    perform private.publish_consent_artifact_v1(a.artifact_key,a.version,a.body_sha256,a.version+1,
      a.body_markdown||E'\nSynthetic next-version publication.',a.summary_markdown,current_date,
      'Synthetic current-version authority rehearsal.')
      from public.consent_artifacts a where a.artifact_key='consent.upload-embryo' and a.superseded_at is null;
    body:=pg_temp.controls();
    raise exception using errcode='ZY001',message='restore genuine consent predecessor';
  exception when sqlstate 'ZY001' then null;end;
  return body;
end $$;
select ok(pg_temp.controls_without_new_consent()#>'{items,0,saveContext}'='null'::jsonb
  and pg_temp.controls_without_new_consent()#>'{items,0,deleteContext}'<>'null'::jsonb,
  'current parent deletion remains available when a new current upload consent would be required for saving');
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only']) role where
  has_function_privilege(role,'public.future_person_profile_controls_v1(uuid,uuid,uuid)','execute')),0::bigint,
  'ordinary JWTs cannot discover the trusted settings control inventory directly');
select ok(has_function_privilege('service_role','public.future_person_profile_controls_v1(uuid,uuid,uuid)','execute'),
  'only the trusted own-session page loader has the control inventory door');
select finish();
rollback;
