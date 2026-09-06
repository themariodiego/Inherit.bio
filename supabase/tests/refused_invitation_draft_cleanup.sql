begin;
select plan(22);
\ir fixtures/rights_invitation_pending.inc
select public.activate_rights_session_v1((select hash from tok),repeat('c',64),'cleanup-form-aaaaaaaaaaaaaaaa');
create temporary table before_cleanup as select
 (select count(*) from public.genome_files) files,
 (select count(*) from public.embryo_cohorts) cohorts,
 (select count(*) from public.subjects) subjects,
 (select count(*) from auth.users) accounts;
insert into public.legal_evidence_ingest_sessions(
 id,principal_id,target_kind,target_id,evidence_kind,session_revision,state,expires_at)
select '9a000000-0000-0000-0000-0000000000e1',uploader_principal_id,'cohort_draft',id,
 'embryo-basis',1,'open',clock_timestamp()+interval '1 day'
from public.embryo_cohort_drafts where id=(select draft_id from draft);
insert into public.legal_evidence_fragments(session_id,fragment_ordinal,object_id,sha256,byte_count)
values('9a000000-0000-0000-0000-0000000000e1',1,'9a000000-0000-0000-0000-0000000000f1',repeat('a',64),32);
select private.refuse_co_parent_invitation_v1(repeat('c',64),'cleanup-refuse-aaaaaaaaaaaaaaaa');
select lives_ok($$select public.run_due_embryo_retention_phases_v1()$$,
 'normal expiry leaves refusal cleanup to its storage-aware worker');
select is((select status from public.retention_due_phases
 where target_id=(select draft_id from draft) and phase_id='embryo-cohort-draft-expiry'),
 'pending','old expiry does not cancel refused draft cleanup');
set local role service_role;
create temporary table cleanup as select * from public.claim_refused_invitation_draft_purge_v1(repeat('a',64));
select is((select count(*) from cleanup),1::bigint,'service worker claims exactly one refused draft');
select is((select storage_objects from cleanup),'[]'::jsonb,'already absent synthetic evidence needs no storage call');
select is((select count(*) from public.claim_refused_invitation_draft_purge_v1(repeat('b',64))),0::bigint,
 'a second worker cannot steal a live lease');
select throws_ok($$select public.finish_refused_invitation_draft_purge_v1(
 (select manifest_id from cleanup),repeat('b',64))$$,'55000','refusal_purge_claim_stale',
 'a stale worker cannot finish the draft');
select lives_ok($$select public.fail_refused_invitation_draft_purge_v1(
 (select manifest_id from cleanup),repeat('a',64))$$,'failure releases its exact claim for retry');
select is((select count(*) from public.claim_refused_invitation_draft_purge_v1(repeat('b',64))),1::bigint,
 'a retry reacquires the same frozen manifest');
select throws_ok($$select public.finish_refused_invitation_draft_purge_v1(
 (select manifest_id from cleanup),repeat('a',64))$$,'55000','refusal_purge_claim_stale',
 'the superseded worker stays fenced after reacquisition');
select lives_ok($$select public.finish_refused_invitation_draft_purge_v1(
 (select manifest_id from cleanup),repeat('b',64))$$,'current worker completes the exact draft cleanup');
reset role;
select is((select count(*) from public.embryo_cohort_drafts where id=(select draft_id from draft)),0::bigint,
 'the cancelled draft is physically removed');
select is((select count(*) from public.subject_invitations where id=(select invitation_id from inv)),0::bigint,
 'the original invitation is physically removed');
select is((select count(*) from public.rights_sessions where session_hash=repeat('c',64)),0::bigint,
 'old rights credentials are removed');
select is((select count(*) from public.legal_evidence_ingest_sessions
 where id='9a000000-0000-0000-0000-0000000000e1'),0::bigint,'draft evidence and fragments are removed');
select is((select count(*) from public.mail_outbox where invitation_terminal_notice_id in(
 select id from private.invitation_terminal_notices where invitation_id=(select invitation_id from inv))),
 2::bigint,'both pending terminal notices survive draft cleanup');
select is((select count(*) from public.genome_files),(select files from before_cleanup),'no genome is deleted');
select is((select count(*) from public.embryo_cohorts),(select cohorts from before_cleanup),'no live cohort is deleted');
select is((select count(*) from public.subjects),(select subjects from before_cleanup),'no co-parent subject is deleted');
select is((select count(*) from auth.users),(select accounts from before_cleanup),'no account is deleted');
select is((select state from public.purge_manifests where id=(select manifest_id from cleanup)),
 'complete','completion is recorded only after all cleanup succeeds');
select ok(not has_function_privilege('anon','public.claim_refused_invitation_draft_purge_v1(text)','execute')
 and not has_function_privilege('authenticated','public.finish_refused_invitation_draft_purge_v1(uuid,text)','execute'),
 'unauthenticated and account clients cannot run purge workers');
select * from finish();
rollback;
