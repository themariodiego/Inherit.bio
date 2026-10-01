begin;
select no_plan();
\ir fixtures/embryo_cohort_pre_finalize.inc
create temporary table disposition_final as select * from public.finalize_embryo_cohort_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select draft_id from draft),(select insurance from acks),(select charter from acks),'disposition-control-final-00001');
create temporary table disposition_records as select e.* from public.embryos e where e.cohort_id=(select cohort_id from disposition_final);
create function pg_temp.disposition_controls(p_account uuid default '7a000000-0000-0000-0000-000000000001',
  p_session uuid default '7a000000-0000-4000-8000-0000000000a1',p_after uuid default null)
returns jsonb language sql as $$select public.embryo_disposition_controls_v1(p_account,p_session,p_after);$$;
create temporary table disposition_before as select pg_temp.disposition_controls() body,
  (select count(*) from public.embryo_operation_nonces) nonces,
  (select count(*) from public.embryo_disposition_proposals) proposals,
  (select count(*) from public.retention_rows) retention;
select is(jsonb_array_length((select body->'items' from disposition_before)),3,
  'all three genuine finalized records expose their own parent disposition rights before any QC/source/analysis grant');
select is((select count(*) from public.purpose_grants where target_kind='cohort' and target_id=(select cohort_id from disposition_final)
  and purpose='embryo.analysis' and revoked_at is null),0::bigint,'no analytical grant is manufactured for this legal control');
select is((select count(*) from private.embryo_canonical_sources where cohort_id=(select cohort_id from disposition_final)),0::bigint,
  'disposition controls do not depend on an analytical source or successful QC');
select is(pg_temp.disposition_controls(),(select body from disposition_before),'repeated discovery returns stable current neutral facts');
select ok((select count(*) from public.embryo_operation_nonces)=(select nonces from disposition_before)
  and (select count(*) from public.embryo_disposition_proposals)=(select proposals from disposition_before)
  and (select count(*) from public.retention_rows)=(select retention from disposition_before),
  'page discovery stores no operation nonce, proposal, retention row or grant');
select ok((select bool_and((select array_agg(key collate "C" order by key collate "C") from jsonb_object_keys(item) key)
  =array['currentDisposition','embryoId','label','mode','proposal']) from disposition_before,
  jsonb_array_elements(body->'items') item),'each inventory row has exactly the closed neutral current-parent control fields');
select ok((select body::text !~ 'qc_|genotype|genome|score|rank|actorPrincipal|basisFingerprint|recordKey' from disposition_before),
  'no analytical result, raw key or private authority snapshot reaches the inventory');
select is(jsonb_array_length(pg_temp.disposition_controls('7a000000-0000-0000-0000-000000000003',
  '7a000000-0000-4000-8000-0000000000c1')->'items'),0,'a stranger is never treated as a disposition authority');
select is(jsonb_array_length(pg_temp.disposition_controls('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000b1')->'items'),0,'a crossed live Auth session discovers no parent control');
select is(jsonb_array_length(pg_temp.disposition_controls('7a000000-0000-0000-0000-000000000002',
  '7a000000-0000-4000-8000-0000000000b2')->'items'),0,'the genuine older sensitive session cannot discover a recent operation');
select is(jsonb_array_length(pg_temp.disposition_controls(p_after=>(select id from disposition_records order by id desc limit 1))->'items'),0,
  'the cursor advances over the exact ordered record set');
create function pg_temp.disposition_without_new_upload_consent() returns jsonb language plpgsql as $$
declare result jsonb;
begin
  begin
    perform private.publish_consent_artifact_v1(a.artifact_key,a.version,a.body_sha256,a.version+1,
      a.body_markdown||E'\nSynthetic next-version publication.',a.summary_markdown,current_date,
      'Synthetic current-version authority rehearsal.')
      from public.consent_artifacts a where a.artifact_key='consent.upload-embryo' and a.superseded_at is null;
    result:=pg_temp.disposition_controls();
    raise exception using errcode='ZY001',message='restore upload predecessor';
  exception when sqlstate 'ZY001' then null;end;
  return result;
end $$;
select is(jsonb_array_length(pg_temp.disposition_without_new_upload_consent()->'items'),3,
  'a legal disposition right requires no new analytical/upload consent signature');
create function pg_temp.disposition_stale_parent_artifact() returns text language plpgsql as $$
begin
  begin
    perform private.publish_consent_artifact_v1(a.artifact_key,a.version,a.body_sha256,a.version+1,
      a.body_markdown||E'\nSynthetic next-version publication.',a.summary_markdown,current_date,
      'Synthetic current-version authority rehearsal.')
      from public.consent_artifacts a where a.artifact_key='attestation.embryo-disposition-rights' and a.superseded_at is null;
    if jsonb_array_length(pg_temp.disposition_controls()->'items')<>0 then return 'unexpected control';end if;
    perform public.record_embryo_disposition_v1('7a000000-0000-0000-0000-000000000001',
      '7a000000-0000-4000-8000-0000000000a1',(select id from disposition_records where sample_ordinal=0),
      'propose','transferred',null,'disposition-stale-parent-0001');
    return 'unexpected commit';
  exception when insufficient_privilege then return SQLSTATE;end;
end $$;
select is(pg_temp.disposition_stale_parent_artifact(),'42501','a real changed parent-right artifact closes both discovery and the mutation writer');
select ok((select count(*) from public.embryo_operation_nonces)=(select nonces from disposition_before)
  and (select count(*) from public.embryo_disposition_proposals)=(select proposals from disposition_before),
  'the stale current parent matrix creates no nonce or proposal');
create temporary table disposition_proposal as select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
  (select id from disposition_records where sample_ordinal=0),'propose','transferred',null,'disposition-native-propose-001') body;
select is((select body->>'status' from disposition_proposal),'awaiting_other_parent','the actual first parent proposes under the current matrix');
select ok((select item#>>'{proposal,id}'=(select body->>'proposalId' from disposition_proposal)
  and item#>'{proposal,callerIsProposer}'='true'::jsonb from jsonb_array_elements(pg_temp.disposition_controls()->'items') item
  where item->>'embryoId'=(select id::text from disposition_records where sample_ordinal=0)),
  'the proposer sees the same exact pending proposal and receives no invented confirmation authority');
select throws_ok($$select public.record_embryo_disposition_v1('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',(select id from disposition_records where sample_ordinal=0),
  'confirm','transferred',(select (body->>'proposalId')::uuid from disposition_proposal),'disposition-self-confirm-001')$$,
  '42501','proposal unavailable','the original writer still refuses self-confirmation');
select ok((select item#>'{proposal,callerIsProposer}'='false'::jsonb
  and item#>>'{proposal,disposition}'='transferred' from jsonb_array_elements(pg_temp.disposition_controls(
    '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1')->'items') item
    where item->>'embryoId'=(select id::text from disposition_records where sample_ordinal=0)),
  'only the genuine other parent receives the exact current confirmation control');
create temporary table disposition_transfer as select public.record_embryo_disposition_v1(
  '7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
  (select id from disposition_records where sample_ordinal=0),'confirm','transferred',
  (select (body->>'proposalId')::uuid from disposition_proposal),'disposition-native-confirm-001') body;
select ok((select body->>'disposition'='transferred' and body->>'callerState'='delivered_inline'
  and body#>>'{card,record_key}'~'^[0-9A-HJKMNP-TV-Z]{20}$'
  and body#>>'{card,closing_date_state}'='definitive_transferred_claim_window' from disposition_transfer),
  'the original transfer writer delivers only the acting other parents genuine one-time replacement card');
select is(jsonb_array_length(pg_temp.disposition_controls()->'items'),2,'the terminal transferred record is not offered another disposition');
select throws_ok($$select public.record_embryo_disposition_v1('7a000000-0000-0000-0000-000000000001',
  '7a000000-0000-4000-8000-0000000000a1',(select id from disposition_records where sample_ordinal=0),
  'propose','donated',null,'disposition-final-propose-001')$$,
  '55000','disposition final','the original terminal disposition refusal remains exact');
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role where
  has_function_privilege(role,'private.embryo_disposition_authority_v1(uuid,uuid,uuid,boolean)','execute')
  or has_function_privilege(role,'private.record_embryo_disposition_before_current_authority_v1(uuid,uuid,uuid,text,text,uuid,text)','execute')),0::bigint,
  'every API role including service_role is denied the current helper and preserved writer bypass');
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only']) role where
  has_function_privilege(role,'public.embryo_disposition_controls_v1(uuid,uuid,uuid)','execute')
  or has_function_privilege(role,'public.record_embryo_disposition_v1(uuid,uuid,uuid,text,text,uuid,text)','execute')),0::bigint,
  'ordinary JWTs cannot call the trusted page or write doors directly');
select ok(has_function_privilege('service_role','public.embryo_disposition_controls_v1(uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.record_embryo_disposition_v1(uuid,uuid,uuid,text,text,uuid,text)','execute'),
  'only the trusted own-Auth page and native mutation route hold the closed public doors');
select finish();
rollback;
