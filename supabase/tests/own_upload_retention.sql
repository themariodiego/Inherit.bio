begin;
select no_plan();
-- pgTAP itself lives in extensions. This transaction-only harness grant is
-- not part of the role migration and grants no table or object access.

insert into private.upload_authorization_config(singleton,auth_issuer)
 values(true,'http://127.0.0.1:54321/auth/v1')
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer;
update private.upload_authorization_config set maximum_array_bytes=52428800,maximum_vcf_bytes=52428800,
 maximum_account_bytes=1073741824,maximum_active_uploads=32 where singleton;
insert into auth.users(id,email,raw_user_meta_data) values
 ('76400000-0000-4000-8000-000000000001','retention-role@e2e.local','{"display_name":"Synthetic uploader"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76400000-0000-4000-8000-000000000010','76400000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76400000-0000-4000-8000-000000000001';
create temporary table upload_role_subject as select id from public.subjects
 where subject_account_id='76400000-0000-4000-8000-000000000001' and subject_class='self';
create function pg_temp.issue_role_upload() returns jsonb language sql as $$
 select public.issue_own_storage_upload_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select id from upload_role_subject),'VCF',8,repeat('a',64));
$$;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010','own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select id from upload_role_subject),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select id from upload_role_subject),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));

create temporary table role_upload as select pg_temp.issue_role_upload() receipt;
grant select on role_upload,upload_role_subject to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*) from public.upload_staging_objects where upload_session_id=(select (receipt->>'uploadId')::uuid from role_upload)),1::bigint,'issuance records the exact staging reference');
select ok((select fixed_deadline=u.created_at+interval '2 hours' from public.retention_rows r join public.upload_sessions u on u.id=r.target_id
 where r.target_id=(select (receipt->>'uploadId')::uuid from role_upload)),'staging deadline is fixed at issuance plus two hours');
select is(public.claim_own_upload_purge_v1(repeat('e',64)),null::jsonb,'a live issued upload cannot be claimed early');
create temporary table original_deadlines as select r.fixed_deadline,d.phase_deadline,d.immutable_envelope
 from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
 where r.target_id=(select (receipt->>'uploadId')::uuid from role_upload);
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('genomes',(select receipt->>'stagingKey' from role_upload),'76400000-0000-4000-8000-000000000001','{"size":8}');
reset role;
create temporary table finalization_manifest as select public.begin_own_upload_finalization_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select (receipt->>'uploadId')::uuid from role_upload)) receipt;
grant select on finalization_manifest to service_role;
set local role service_role;
insert into storage.objects(bucket_id,name,metadata) values('genomes',(select receipt->>'finalKey' from finalization_manifest),'{"size":8}');
reset role;
select is((select count(*) from public.upload_staging_objects where upload_session_id=(select (receipt->>'uploadId')::uuid from role_upload)),2::bigint,'an unfinished copy has its own exact working reference');
select is(public.claim_own_upload_purge_v1(repeat('e',64)),null::jsonb,'a still-authorized active finalizer cannot be claimed');
-- Expire only this synthetic upload authority, preserving its original two-hour
-- retention clock and the schema requirement that expiry follows creation.
update public.upload_sessions set expires_at=created_at+interval '1 microsecond'
 where id=(select (receipt->>'uploadId')::uuid from role_upload);
select ok((select phase_deadline>clock_timestamp() from original_deadlines),'cleanup is tested before the original deadline, not by making that deadline overdue');
create temporary table purge_claim(receipt jsonb);
grant select,insert on purge_claim to service_role;
set local role service_role;
insert into purge_claim select public.claim_own_upload_purge_v1(repeat('a',64));
reset role;
select is(jsonb_array_length((select receipt->'objects' from purge_claim)),2,'claim freezes only the staging/final pair');
select is((select status from public.upload_sessions where id=(select (receipt->>'uploadId')::uuid from role_upload)),'rejected','claim atomically invalidates the abandoned upload');
select is(public.claim_own_upload_purge_v1(repeat('e',64)),null::jsonb,'an active cleanup claim is not reclaimed early');
select is((select jsonb_build_array(r.fixed_deadline,d.phase_deadline,d.immutable_envelope)
 from public.retention_rows r join public.retention_due_phases d on d.retention_row_id=r.id
 where r.target_id=(select (receipt->>'uploadId')::uuid from role_upload)),
 (select jsonb_build_array(fixed_deadline,phase_deadline,immutable_envelope) from original_deadlines),
 'early eligibility changes neither retention clock nor immutable authority envelope');
select throws_ok($$select public.authorize_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from purge_claim),repeat('b',64))$$,'55000','upload_purge_claim_stale','a foreign claim cannot authorize deletion');
select throws_ok($$select public.authorize_own_upload_finalization_v1('76400000-0000-4000-8000-000000000001',
 '76400000-0000-4000-8000-000000000010',(select (receipt->>'uploadId')::uuid from role_upload),
 (select (receipt->>'claim')::uuid from finalization_manifest))$$,'42501','not_found','an expired finalizer cannot resume after retention claims the upload');
select throws_ok($$select public.finish_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from purge_claim),repeat('a',64))$$,'55000','upload_purge_storage_remaining','metadata rows are not deleted before provider cleanup');
select lives_ok($$select public.fail_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from purge_claim),repeat('a',64))$$,'failed provider cleanup records a retry');
update purge_claim set receipt=public.claim_own_upload_purge_v1(repeat('c',64));
select ok(public.authorize_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from purge_claim),repeat('c',64)),'retry uses the same frozen references with a fresh claim');
update public.retention_due_phases set claim_expires_at=clock_timestamp()-interval '1 second' where target_id=(select (receipt->>'uploadId')::uuid from role_upload);
select throws_ok($$select public.authorize_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from purge_claim),repeat('c',64))$$,'55000','upload_purge_claim_stale','a crashed expired worker loses authority');
update purge_claim set receipt=public.claim_own_upload_purge_v1(repeat('d',64));
select ok(public.authorize_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from purge_claim),repeat('d',64)),'another worker recovers an expired claim');
select set_config('storage.allow_delete_query','true',true);
-- Synthetic rollback-only metadata, never actual bytes.
delete from storage.objects where bucket_id='genomes' and name in(select object_name from public.upload_staging_objects
 where upload_session_id=(select (receipt->>'uploadId')::uuid from role_upload));
select is(public.finish_own_upload_purge_v1((select (receipt->>'manifestId')::uuid from purge_claim),repeat('d',64)),true,'only zero-residual storage permits purge completion');
select is((select count(*) from public.upload_sessions where id=(select (receipt->>'uploadId')::uuid from role_upload)),0::bigint,'working upload session is removed');
select is((select count(*) from public.upload_staging_objects where upload_session_id=(select (receipt->>'uploadId')::uuid from role_upload)),0::bigint,'working references are removed after storage');
select is((select state from public.purge_manifests where id=(select (receipt->>'manifestId')::uuid from purge_claim)),'complete','the nonauthorizing manifest survives for crash recovery');
select ok((select d.completed_at<o.phase_deadline and d.phase_deadline=o.phase_deadline
 from public.retention_due_phases d cross join original_deadlines o
 where d.target_id=(select (receipt->>'uploadId')::uuid from role_upload)),
 'retry and crash recovery complete before the unchanged two-hour deadline');
set local role service_role;
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('genomes',(select receipt->>'finalKey' from finalization_manifest),'{"size":8}')$$,
 '42501','upload_unavailable','a delayed provider copy cannot recreate purged bytes after session deletion');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values('genomes',(select receipt->>'stagingKey' from role_upload),'76400000-0000-4000-8000-000000000001','{"size":8}')$$,
 '42501','upload_unavailable','a delayed staging completion cannot recreate purged bytes');
reset role;
select ok(not has_function_privilege('authenticated','public.claim_own_upload_purge_v1(text)','EXECUTE')
 and not has_function_privilege('inherit_upload_only','public.claim_own_upload_purge_v1(text)','EXECUTE'),'cleanup authority is not granted to browser or upload roles');
select * from finish();
rollback;
