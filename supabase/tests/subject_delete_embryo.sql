begin;
select no_plan();
-- api.subject-delete, the embryo cases (migration 20261016181000_subject_delete;
-- owner decisions 2026-10-16, "The subjects endpoints (G2.1)", Q1 and Q5).
-- Actual synthetic canonical publication of three embryos (two with a
-- source), the native two-parent transfer, and the delete door. Synthetic
-- accounts, genotypes and digests only. Everything rolls back.
select set_config('inherit.synthetic_signing_ciphertext',repeat('ab',64),true);
\ir fixtures/future_person_custody_source.inc

create temporary table emb as select e.sample_ordinal ordinal, e.id embryo, e.subject_id subject
 from public.embryos e where e.cohort_id=(select cohort_id from live);
grant select on emb to service_role;
create function pg_temp.e(p integer) returns uuid language sql as $$ select embryo from emb where ordinal=p $$;
create function pg_temp.s(p integer) returns uuid language sql as $$ select subject from emb where ordinal=p $$;
create function pg_temp.h(p text) returns text language sql immutable as
 $$ select encode(extensions.digest('subject-delete-embryo:'||p,'sha256'),'hex') $$;
create function pg_temp.del(p_account uuid, p_session uuid, p_subject uuid, p_code text) returns jsonb language sql volatile as
 $$ select public.delete_subject_v1(p_account, p_session, p_subject, pg_temp.h(p_code), clock_timestamp()+interval '5 minutes') $$;
create function pg_temp.parent_a(p_subject uuid, p_code text) returns jsonb language sql volatile as
 $$ select pg_temp.del('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',p_subject,p_code) $$;
create function pg_temp.parent_b(p_subject uuid, p_code text) returns jsonb language sql volatile as
 $$ select pg_temp.del('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',p_subject,p_code) $$;
create function pg_temp.codes() returns bigint language sql as
 $$ select count(*) from public.account_operation_nonces where operation='subject_delete' $$;
select ok((select count(*) from emb)=3 and (select count(*) from sources where embryo_id=pg_temp.e(2))=1
 and (select count(*) from sources where embryo_id=pg_temp.e(0))=1,'fixture: three embryos, the first and third with a source');

-- Embryo 3 is transferred through the native two-parent writer.
create temporary table proposal as select public.record_embryo_disposition_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',pg_temp.e(2),'propose','transferred',null,
 'subject-delete-propose-000001') body;
select is(public.record_embryo_disposition_v1('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b1',
 pg_temp.e(2),'confirm','transferred',(select (body->>'proposalId')::uuid from proposal),'subject-delete-confirm-000001')->>'disposition',
 'transferred','fixture: the second parent confirms the transfer');
create temporary table profile_context as select public.future_person_profile_context_v1(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',pg_temp.e(2),(select id from sig_upload)) body;
select is(public.write_future_person_profile_v1('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 pg_temp.e(2),(select id from sig_upload),(select body from profile_context),gen_random_uuid(),extensions.gen_random_bytes(128),
 extensions.gen_random_bytes(72),jsonb_build_object('1',repeat('b',64)),'subject-delete-profile-00001')->>'status','saved',
 'fixture: the parent saves an identity profile for the transferred record');
select ok((select count(*) from public.future_person_record_key_hashes where embryo_id=pg_temp.e(2) and status='current')>0
 and (select count(*) from public.retention_rows where retention_id='embryo.transferred-claim-window' and target_kind='subject'
  and target_id=pg_temp.s(2) and state in ('scheduled','active'))=1
 and (select count(*) from public.future_person_identity where embryo_id=pg_temp.e(2) and state='current')=1,
 'fixture: the transferred record holds a current record key, its claim window and a profile');
create temporary table before_cohort as select status, lifecycle_revision from public.embryo_cohorts where id=(select cohort_id from live);

-- Anyone but a current parent is not found ---------------------------------------
select throws_ok($$select pg_temp.del('7a000000-0000-0000-0000-000000000003','7a000000-0000-4000-8000-0000000000c1',pg_temp.s(2),'stranger')$$,
 '42501',null,'a stranger is never treated as a disposition authority');
select throws_ok($$select pg_temp.del('7a000000-0000-0000-0000-000000000002','7a000000-0000-4000-8000-0000000000b2',pg_temp.s(2),'older-session')$$,
 '42501',null,'a parent''s older sign-in cannot delete');
select throws_ok($$select pg_temp.del('7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000b1',pg_temp.s(2),'crossed')$$,
 '42501','not_found','another account''s session cannot delete');
select is(pg_temp.codes(),0::bigint,'a refused delete records no code');

-- Q5: an open claim or claim review leaves the transferred record as it is --------
create function pg_temp.open_claim_probe(p_kind text) returns text language plpgsql as $$
declare r text; v_principal uuid:=gen_random_uuid(); v_session uuid:=gen_random_uuid(); v_review uuid:=gen_random_uuid();
begin
 begin
  if p_kind='claim' then
   insert into public.subject_principals(id,subject_id,principal_kind,status) values(v_principal,pg_temp.s(2),'future_person','active');
   insert into public.future_person_claim_sessions(id,embryo_id,candidate_principal_id,intake_revision,state,expires_at)
    values(v_session,pg_temp.e(2),v_principal,1,'submitted',clock_timestamp()+interval '1 hour');
   insert into public.future_person_claims(id,intake_session_id,embryo_id,claimant_principal_id,claim_method,
    claim_revision,claimant_revision,status,submitted_at)
    values(gen_random_uuid(),v_session,pg_temp.e(2),v_principal,'record_key',1,1,'submitted',clock_timestamp());
  else
   insert into private.future_person_claim_intakes(id,session_hash,form_nonce_hash,mode,key_hash,identity_ciphertext,
    wrapped_data_key,identifier_hmac,identifier_key_revision,network_hmac,network_key_revision,created_at,last_active_at,expires_at,completed_at)
    select v_review,pg_temp.h('session'),pg_temp.h('form'),'record-key',pg_temp.h('record-key'),extensions.gen_random_bytes(64),
     extensions.gen_random_bytes(60),pg_temp.h('identifier'),1,pg_temp.h('network'),1,t.n,t.n,t.n+interval '24 hours',t.n
    from (select clock_timestamp() n) t;
   insert into private.claim_reviews(id,mode,case_kind,matched_embryo_id,photo_sha256,birth_record_sha256,
    completion_nonce_hash,state,review_revision,created_at,deadline)
    select v_review,'record-key','record_key',pg_temp.e(2),pg_temp.h('photo'),pg_temp.h('birth'),pg_temp.h('completion'),
     'document_review_pending',1,t.n,t.n+interval '30 days' from (select clock_timestamp() n) t;
  end if;
  begin
   perform pg_temp.parent_a(pg_temp.s(2),'open-'||p_kind);
   r:='committed';
  exception when insufficient_privilege then r:=sqlstate||':'||sqlerrm; end;
  if pg_temp.codes()<>0 or (select lifecycle from public.subjects where id=pg_temp.s(2))<>'active'
   or (select count(*) from public.future_person_record_key_hashes where embryo_id=pg_temp.e(2) and status='current')=0
   or (select count(*) from public.future_person_identity where embryo_id=pg_temp.e(2) and state='current')<>1
   or (select count(*) from private.embryo_canonical_sources where embryo_id=pg_temp.e(2))<>1 then
   r:=r||':written'; end if;
  raise exception using errcode='ZY001',message='restore';
 exception when sqlstate 'ZY001' then null; end;
 return r;
end $$;
select is(pg_temp.open_claim_probe('claim'),'42501:not_found','an open claim of the record answers not found and writes nothing');
select is(pg_temp.open_claim_probe('review'),'42501:not_found','an open claim review of the record answers not found and writes nothing');

-- Q5: the transferred, unclaimed record is purged alone ------------------------------
create temporary table siblings_before as select id, lifecycle, lifecycle_revision from public.subjects
 where id in (pg_temp.s(0),pg_temp.s(1));
create temporary table unwinds_before as select count(*) n from public.embryo_ingest_unwinds where purpose='source';
create temporary table transferred_source as select file_id from sources where embryo_id=pg_temp.e(2);
set local role service_role;
create temporary table purged as select pg_temp.parent_a(pg_temp.s(2),'transferred') body;
reset role;
select is((select body from purged),'{"case":"embryo-transferred-unclaimed","sources":1}'::jsonb,
 'the transferred, unclaimed record is purged with its one source');
select is((select lifecycle from public.subjects where id=pg_temp.s(2)),'purged','the record is purged');
select is((select count(*) from public.future_person_record_key_hashes where embryo_id=pg_temp.e(2) and status='current'),0::bigint,
 'its record key is revoked');
select is((select count(*) from public.future_person_record_key_print_rights where embryo_id=pg_temp.e(2) and status='unconsumed'),0::bigint,
 'no print right for it remains');
select is((select state from public.retention_rows where retention_id='embryo.transferred-claim-window' and target_kind='subject'
 and target_id=pg_temp.s(2)),'cancelled','its claim window closes');
select is((select count(*) from public.retention_due_phases p join public.retention_rows r on r.id=p.retention_row_id
 where r.retention_id='embryo.transferred-claim-window' and r.target_id=pg_temp.s(2) and p.status in ('pending','retry','claimed')),0::bigint,
 'no claim-window phase can still run');
select is((select count(*) from public.future_person_identity where embryo_id=pg_temp.e(2) and state='current'),0::bigint,
 'its identity profile is shredded');
select is((select count(*) from public.embryo_scores where embryo_id=pg_temp.e(2))+(select count(*) from public.embryo_qc where embryo_id=pg_temp.e(2))
 +(select count(*) from public.embryo_variants where embryo_id=pg_temp.e(2)),0::bigint,'its derived rows are deleted');
select ok((select count(*) from private.embryo_canonical_sources where embryo_id=pg_temp.e(2))=0
 and (select count(*) from public.genome_files where id in (select file_id from transferred_source))=0,
 'its one canonical source is deleted');
select is((select count(*) from public.embryo_ingest_unwinds where purpose='source')-(select n from unwinds_before),1::bigint,
 'the source''s parts wait under one planned unwind');
select is((select count(*) from private.embryo_canonical_sources where embryo_id=pg_temp.e(0)),1::bigint,
 'a sibling''s source is untouched');
select ok((select bool_and(s.lifecycle=b.lifecycle and s.lifecycle_revision=b.lifecycle_revision) from public.subjects s
 join siblings_before b on b.id=s.id),'no sibling record changes');
select ok((select c.status=b.status and c.lifecycle_revision=b.lifecycle_revision from public.embryo_cohorts c, before_cohort b
 where c.id=(select cohort_id from live)),'the cohort is not restricted');
select is((select count(*) from public.legal_audit_log where event_code='subject.deleted' and route_id='api.subject-delete'
 and coded_context->>'case'='embryo-transferred-unclaimed'),1::bigint,'one audit event records the purge');
select is(pg_temp.codes(),1::bigint,'the code is spent');
select throws_ok($$select pg_temp.parent_a(pg_temp.s(2),'transferred-again')$$,'42501',null,'a purged record is not found');

-- Q1: a record whose claim is approved belongs to its claimant ----------------------
create function pg_temp.approved_claim_probe() returns text language plpgsql as $$
declare r text; v_principal uuid:=gen_random_uuid(); v_session uuid:=gen_random_uuid();
begin
 begin
  insert into public.subject_principals(id,subject_id,principal_kind,status) values(v_principal,pg_temp.s(1),'future_person','active');
  insert into public.future_person_claim_sessions(id,embryo_id,candidate_principal_id,intake_revision,state,expires_at)
   values(v_session,pg_temp.e(1),v_principal,1,'submitted',clock_timestamp()+interval '1 hour');
  insert into public.future_person_claims(id,intake_session_id,embryo_id,claimant_principal_id,claim_method,
   claim_revision,claimant_revision,status,decided_at)
   values(gen_random_uuid(),v_session,pg_temp.e(1),v_principal,'record_key',1,1,'approved',clock_timestamp());
  begin
   perform pg_temp.parent_b(pg_temp.s(1),'approved-claim');
   r:='committed';
  exception when insufficient_privilege then r:=sqlstate; end;
  if pg_temp.codes()<>1 or (select status from public.embryo_cohorts where id=(select cohort_id from live))<>'active' then
   r:=r||':written'; end if;
  raise exception using errcode='ZY001',message='restore';
 exception when sqlstate 'ZY001' then null; end;
 return r;
end $$;
select is(pg_temp.approved_claim_probe(),'42501','a parent cannot delete a record whose claim is approved, and nothing is written');

-- Any other record restricts the whole cohort, as api.cohort-restrict does ----------
set local role service_role;
create temporary table restricted as select pg_temp.parent_b(pg_temp.s(1),'other') body;
reset role;
select is((select body from restricted),'{"case":"embryo-other"}'::jsonb,'a stored record restricts its whole cohort');
select is((select status from public.embryo_cohorts where id=(select cohort_id from live)),'restricted','the cohort is restricted');
select ok((select bool_and(lifecycle='restricted') from public.subjects where id in (pg_temp.s(0),pg_temp.s(1))),
 'every record still in the cohort is restricted');
select is((select lifecycle from public.subjects where id=pg_temp.s(2)),'purged','the purged record stays purged');
select is((select count(*) from private.embryo_canonical_sources where cohort_id=(select cohort_id from live)),0::bigint,
 'the cohort''s remaining source is deleted by the restriction core');
select is(pg_temp.codes(),2::bigint,'the second code is spent');
select throws_ok($$select pg_temp.parent_b(pg_temp.s(0),'restricted-again')$$,'42501',null,
 'a restricted cohort cannot be restricted again through a record');
select is(pg_temp.codes(),2::bigint,'and that refusal records no code');

select * from finish();
rollback;
