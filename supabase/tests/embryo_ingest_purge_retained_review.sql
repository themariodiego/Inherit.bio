begin;
select no_plan();
-- The one retained review (20260930131000). A single-parent (parent
-- deceased) attempt is abandoned and purged to completion; the approved
-- review that named its draft survives unchanged. Any other row that names
-- the deleted graph still stops the purge. The upload is synthetic, one
-- embryo on the R2 backend; the review and evidence hash are synthetic.
\ir fixtures/embryo_ingest_attempt.inc

create temporary table attempt(session uuid, draft uuid, review uuid, unwind uuid);
create function pg_temp.new_single_parent_attempt() returns void language plpgsql as $$
declare
  v_owner uuid:=gen_random_uuid(); v_auth uuid:=gen_random_uuid(); v_draft uuid; v_cohort uuid;
  v_key text; v_insurance uuid; v_charter uuid; v_reviewer uuid; v_review uuid:=gen_random_uuid();
  v_session uuid;
begin
  insert into auth.users(id,email) values (v_owner,v_owner::text||'@single-parent.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at,aal)
    values (v_auth,v_owner,clock_timestamp(),clock_timestamp(),'aal1');
  perform public.declare_jurisdiction_v1(v_owner,v_auth,'GB',
    (select version from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),
    (select body_sha256 from public.consent_artifacts where artifact_key='attestation.jurisdiction' and superseded_at is null),false);
  select draft_id into v_draft from public.create_embryo_cohort_draft_v1(
    v_owner,v_auth,'own_embryos','parent_deceased',1,
    decode('00112233445566778899aabbccddeeff','hex'),encode(extensions.digest(v_owner::text,'sha256'),'hex'),
    '{}'::text[],'{}'::text[],gen_random_uuid()::text,true);
  foreach v_key in array array['consent.upload-embryo','attestation.embryo-parentage',
    'attestation.embryo-disposition-rights','attestation.embryo-single-parent-basis'] loop
    perform public.sign_embryo_artifact_v1(v_owner,v_auth,'cohort_draft',v_draft,v_key,1,
      case v_key when 'consent.upload-embryo' then private.embryo_statement_keys_v1(v_key,'parent')
        else private.embryo_statement_keys_v1(v_key) end,
      decode('deadbeef','hex'),'GB',gen_random_uuid()::text);
  end loop;
  v_insurance:=public.sign_embryo_artifact_v1(v_owner,v_auth,'cohort_draft',v_draft,
    'disclosure.insurance-and-discrimination',1,private.embryo_statement_keys_v1('disclosure.insurance-and-discrimination'),
    decode('deadbeef','hex'),'GB',gen_random_uuid()::text);
  v_charter:=public.sign_embryo_artifact_v1(v_owner,v_auth,'cohort_draft',v_draft,
    'charter.future-person',1,private.embryo_statement_keys_v1('charter.future-person'),
    decode('deadbeef','hex'),'GB',gen_random_uuid()::text);
  -- A named human reviewer approves the synthetic evidence.
  insert into public.subject_principals(principal_kind,principal_revision,status)
    values ('reviewer',1,'active') returning id into v_reviewer;
  insert into public.legal_reviews(id,target_kind,target_id,reviewer_principal_id,decision,decision_code,review_revision)
    values (v_review,'single_parent_basis',v_draft,v_reviewer,'approved','evidence-genuine',1);
  insert into public.reviewed_evidence(review_id,evidence_kind,evidence_sha256,evidence_revision)
    values (v_review,'parent-death-certificate',repeat('9',64),1);
  select cohort_id into v_cohort from public.finalize_embryo_cohort_v1(
    v_owner,v_auth,v_draft,v_insurance,v_charter,gen_random_uuid()::text);
  v_session:=(private.create_embryo_ingest_session_v1(v_owner,v_auth,v_cohort,'http://localhost:3000',200000000,true)
    ->>'session')::uuid;
  update public.embryo_ingest_sessions set source_format='vcf',reference_build='GRCh38' where id=v_session;
  insert into attempt values (v_session,v_draft,v_review,null);
end $$;
create function pg_temp.sid() returns uuid language sql as $$ select session from attempt; $$;
create function pg_temp.uid() returns uuid language sql as $$ select unwind from attempt; $$;

update private.embryo_ingest_object_config set provider='r2',r2_bucket='inherit-embryo-test' where singleton;
select lives_ok($$select pg_temp.new_single_parent_attempt()$$,
  'a parent-deceased cohort finalizes with an approved review of its evidence');
select is((select b.legal_review_id from public.embryo_basis_bindings b join public.embryo_cohorts c on c.id=b.cohort_id
    where c.draft_id=(select draft from attempt)),(select review from attempt),'its basis binding names the review');
select is(private.reserve_embryo_ingest_chunk_v1(pg_temp.sid(),0,repeat('d',64),100,1,60,jsonb_build_array(
    jsonb_build_object('ordinal',0,'sha256',repeat('b',64),'bytes',80,'lines',4)))->>'status','reserved',
  'the one embryo''s fragment is reserved');
select is(private.ack_embryo_ingest_r2_write_v1(pg_temp.sid(),0,0,private.embryo_ingest_write_target_v1(i),
    repeat('1',32),repeat('e',32),repeat('b',64),80)->>'providerVersion',repeat('1',32),'and lands on R2')
  from private.embryo_ingest_write_intents i where i.session_id=pg_temp.sid();
select is(private.mark_embryo_ingest_failure_v1(pg_temp.sid(),'abort')->>'status','failure_pending','the upload is aborted');
update attempt set unwind=(public.prepare_embryo_ingest_unwind_v1(
  (select cohort_id from public.embryo_ingest_sessions where id=pg_temp.sid()),1)->>'unwindId')::uuid;
select is((select state from public.embryo_ingest_unwinds where id=pg_temp.uid()),'storage_pending',
  'the unwind is planned from the single-parent matrix');
select pg_sleep(greatest(0,extract(epoch from (select fence_at from private.embryo_ingest_write_fences
  where session_id=pg_temp.sid())-clock_timestamp()))+0.05);
create temporary table claimed as select public.claim_embryo_ingest_object_disposals_v1(pg_temp.uid(),repeat('a',64)) body;
select is((select public.finish_embryo_ingest_object_disposal_v1(pg_temp.uid(),d.ordinal,repeat('a',64),
    private.embryo_ingest_disposal_receipt_v1(d),jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1',
      'provider','r2','disposition','payload-tombstoned','bucket',d.bucket_id,'objectKey',d.object_name,
      'providerVersion',repeat('9',32),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
      'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'))->>'state'
  from private.embryo_ingest_object_disposals d where d.unwind_id=pg_temp.uid()),'tombstoned',
  'its one key gets a verified marker');
select is(public.confirm_embryo_ingest_unwind_storage_v1(pg_temp.uid())->>'status','storage_confirmed',
  'storage is confirmed');
create temporary table review_before as select to_jsonb(r) row_json from public.legal_reviews r
  where r.id=(select review from attempt);
create temporary table evidence_before as select to_jsonb(e) row_json from public.reviewed_evidence e
  where e.review_id=(select review from attempt);

-- Any other review naming the draft still stops the purge.
insert into public.legal_reviews(target_kind,target_id,reviewer_principal_id,decision,decision_code,review_revision)
  select 'single_parent_basis',(select draft from attempt),reviewer_principal_id,'denied','evidence-insufficient',1
  from public.legal_reviews where id=(select review from attempt);
select throws_ok($$select public.complete_embryo_ingest_unwind_v1(pg_temp.uid())$$,'55000','unsupported unwind store',
  'a denied review naming the draft is not retained, so the purge refuses');
delete from public.legal_reviews where target_id=(select draft from attempt) and decision='denied';
-- So does a target_id column anywhere else that names the draft.
create table public.zz_target_probe(target_id uuid);
insert into public.zz_target_probe select draft from attempt;
select throws_ok($$select public.complete_embryo_ingest_unwind_v1(pg_temp.uid())$$,'55000','unsupported unwind store',
  'another table''s target_id naming the draft still stops the purge');
drop table public.zz_target_probe;

create temporary table done as select public.complete_embryo_ingest_unwind_v1(pg_temp.uid()) body;
select is((select body - 'completedAt' from done),
  '{"status":"complete","notices":1,"objects":1,"deliveryUnavailable":0}'::jsonb,
  'the single-parent attempt purges to completion, with one notice for its one parent');
select is((select to_jsonb(r) from public.legal_reviews r where r.id=(select review from attempt)),
  (select row_json from review_before),'the approved review survives unchanged');
select is((select to_jsonb(e) from public.reviewed_evidence e where e.review_id=(select review from attempt)),
  (select row_json from evidence_before),'and so does the evidence hash it approved');
select is((select count(*) from public.embryo_cohort_drafts where id=(select draft from attempt))
  +(select count(*) from public.embryo_ingest_sessions where id=pg_temp.sid())
  +(select count(*) from public.consent_signatures where target_id=(select draft from attempt))
  +(select count(*) from public.embryo_basis_bindings b where b.legal_review_id=(select review from attempt)),0::bigint,
  'the draft, session, signatures and basis binding are gone');


-- The residual check itself, after the purge: the approved review is the
-- only row it lets name the deleted draft.
select is(private.embryo_ingest_attempt_residue_v1(array[(select draft from attempt)],'{}'),
  '{"registered":{},"unregistered":{},"unverifiable":0}'::jsonb,
  'with only the approved review left, nothing names the deleted draft');
insert into public.legal_reviews(target_kind,target_id,reviewer_principal_id,decision,decision_code,review_revision)
  select 'single_parent_basis',(select draft from attempt),reviewer_principal_id,'denied','evidence-insufficient',2
  from public.legal_reviews where id=(select review from attempt);
insert into public.legal_reviews(target_kind,target_id,reviewer_principal_id,decision,decision_code,review_revision)
  select 'adult_control',(select draft from attempt),reviewer_principal_id,'approved','evidence-genuine',1
  from public.legal_reviews where id=(select review from attempt);
create table public.zz_target_probe(target_id uuid);
insert into public.zz_target_probe select draft from attempt;
select is(private.embryo_ingest_attempt_residue_v1(array[(select draft from attempt)],'{}'),
  '{"registered":{"public.legal_reviews":2},"unregistered":{"public.zz_target_probe":1},"unverifiable":0}'::jsonb,
  'a denied review, an approved review of another kind and another table''s target_id all still count');

select * from finish();
rollback;
