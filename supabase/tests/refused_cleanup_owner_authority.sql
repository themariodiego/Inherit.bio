-- Role proof for the registered owner-defined refusal worker, rollback only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(p.prosecdef and p.proconfig=array['search_path=""']::text[] and md5(p.prosrc)=x.body_md5,
 x.signature||' retains its exact reviewed body behind an empty-search-path definer')
 from (values ('public.claim_refused_invitation_draft_purge_v1(text)','eb80f8424c3d83bbccdc90035cd24b34'),
 ('public.authorize_refused_invitation_storage_v1(uuid,text,bigint[])','7c6b39f23efbc248af08b157a9362dee'),
 ('public.complete_refused_invitation_storage_v1(uuid,text,bigint[])','3ad1c3f784d13336f8a95448cd13b99b'),
 ('public.finish_refused_invitation_draft_purge_v1(uuid,text)','b6bc8b84951f70ade7c6968e510a54e2'),
 ('public.fail_refused_invitation_draft_purge_v1(uuid,text)','6ff72ac54047851920c711af4676bb51'))x(signature,body_md5)
 join pg_proc p on p.oid=to_regprocedure(x.signature);
select is(has_function_privilege(role,signature,'execute'),role='service_role',role||' exact native cleanup door '||signature)
 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role cross join
 unnest(array['public.claim_refused_invitation_draft_purge_v1(text)','public.authorize_refused_invitation_storage_v1(uuid,text,bigint[])','public.complete_refused_invitation_storage_v1(uuid,text,bigint[])','public.finish_refused_invitation_draft_purge_v1(uuid,text)','public.fail_refused_invitation_draft_purge_v1(uuid,text)'])signature;
select ok(not has_function_privilege(role,signature,'execute'),role||' cannot call internal cleanup selector '||signature)
 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role cross join
 unnest(array['private.refused_draft_evidence_objects_v1(text,uuid)','private.assert_refused_draft_v1(public.retention_due_phases)','private.lock_refused_draft_purge_v1(uuid,text)','private.assert_refused_evidence_exclusive_v1(text,uuid)'])signature;
set local role service_role;
select is(current_user::text,'service_role','the negative cleanup probes run as the actual service role');
select throws_ok($$select count(*) from public.future_person_claim_objections$$,'42501',null,
 'cleanup authority does not grant direct access to protected objections');
select throws_ok($$select private.refused_draft_evidence_objects_v1('cohort_draft',gen_random_uuid())$$,'42501',null,
 'the evidence selector cannot be called directly as service');
select throws_ok($$select private.assert_refused_evidence_exclusive_v1('cohort_draft',gen_random_uuid())$$,'42501',null,
 'the shared-evidence validator cannot be called directly as service');
select throws_ok($$select private.lock_refused_draft_purge_v1(gen_random_uuid(),repeat('a',64))$$,'42501',null,
 'the exact manifest locker cannot be called directly as service');
select throws_ok($$select private.assert_refused_draft_v1(null::public.retention_due_phases)$$,'42501',null,
 'the draft graph validator cannot be called directly as service');
select throws_ok($$select public.authorize_refused_invitation_storage_v1(gen_random_uuid(),repeat('a',64),array[1::bigint])$$,
 '55000','refusal_purge_claim_stale','the public storage door still refuses a nonexistent claimed manifest');
select throws_ok($$select public.complete_refused_invitation_storage_v1(gen_random_uuid(),repeat('a',64),array[1::bigint])$$,
 '55000','refusal_purge_claim_stale','the public completion door cannot acknowledge an unclaimed object');
select throws_ok($$select public.finish_refused_invitation_draft_purge_v1(gen_random_uuid(),repeat('a',64))$$,
 '55000','refusal_purge_claim_stale','the public owner-defined finalizer still refuses an invented claim');
reset role;
select is(has_table_privilege(role,relation,'truncate'),role='service_role' and relation='public.user_variants',
 role||' exact original maintenance tuple '||relation)
 from unnest(array['anon','authenticated','inherit_upload_only','service_role'])role
 cross join unnest(array['public.user_variants','public.report_observed_calls'])relation;
select * from finish();
rollback;
