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
 ('76300000-0000-4000-8000-000000000001','finalize-role@e2e.local','{"display_name":"Synthetic uploader"}');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76300000-0000-4000-8000-000000000010','76300000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76300000-0000-4000-8000-000000000001';
create temporary table upload_role_subject as select id from public.subjects
 where subject_account_id='76300000-0000-4000-8000-000000000001' and subject_class='self';
create function pg_temp.issue_role_upload() returns jsonb language sql as $$
 select public.issue_own_storage_upload_v1('76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010',(select id from upload_role_subject),'VCF',8,repeat('a',64));
$$;
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010','own_upload_artifact_sign',clock_timestamp()+interval '9 minutes'
 from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010',(select id from upload_role_subject),
 'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010',(select id from upload_role_subject),
 'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
update private.upload_authorization_config set maximum_vcf_bytes=null where singleton;
select throws_ok($$select pg_temp.issue_role_upload()$$,'55000','upload_unavailable','missing deployment capacity refuses issuance');
update private.upload_authorization_config set maximum_vcf_bytes=7 where singleton;
select throws_ok($$select pg_temp.issue_role_upload()$$,'22023','file_too_large','server format limit is enforced');
update private.upload_authorization_config set maximum_vcf_bytes=52428800,maximum_account_bytes=7 where singleton;
select throws_ok($$select pg_temp.issue_role_upload()$$,'22023','file_too_large','server account limit is enforced');
update private.upload_authorization_config set maximum_account_bytes=1073741824 where singleton;
select is((select count(*) from public.upload_sessions where account_id='76300000-0000-4000-8000-000000000001'),0::bigint,
 'refused capacity checks reserve no upload row');
create temporary table role_upload as select pg_temp.issue_role_upload() receipt;
update private.upload_authorization_config set maximum_active_uploads=1 where singleton;
select throws_ok($$select pg_temp.issue_role_upload()$$,'55000','upload_unavailable','active lease count is enforced');
update private.upload_authorization_config set maximum_active_uploads=32,maximum_account_bytes=15 where singleton;
select throws_ok($$select pg_temp.issue_role_upload()$$,'22023','file_too_large','pending uploads reserve account bytes before publication');
update private.upload_authorization_config set maximum_account_bytes=1073741824 where singleton;
grant select on role_upload,upload_role_subject to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.begin_finalize() returns jsonb language sql as $$
 select public.begin_own_upload_finalization_v1('76300000-0000-4000-8000-000000000001',
  '76300000-0000-4000-8000-000000000010',(select (receipt->>'uploadId')::uuid from role_upload));
$$;
select throws_ok($$select pg_temp.begin_finalize()$$,'42501','not_found','an issued but unuploaded lease cannot begin finalization');
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from role_upload),'76300000-0000-4000-8000-000000000001','{"size":8}');
reset role;
create temporary table finalization_manifest as select pg_temp.begin_finalize() receipt;
grant select on finalization_manifest to service_role;
select is((select receipt->>'status' from finalization_manifest),'authorized','uploaded data can enter an exclusive validation lease');
select isnt((select receipt->>'finalKey' from finalization_manifest),(select receipt->>'stagingKey' from finalization_manifest),
 'the final object gets a fresh database-owned key');
select throws_ok($$select pg_temp.begin_finalize()$$,'42501','not_found','a second request cannot compete for the same finalization lease');
create function pg_temp.authorize_finalize(p_claim uuid default null) returns jsonb language sql as $$
 select public.authorize_own_upload_finalization_v1('76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010',(select (receipt->>'uploadId')::uuid from role_upload),
 coalesce(p_claim,(select (receipt->>'claim')::uuid from finalization_manifest)));
$$;
select throws_ok($$select pg_temp.authorize_finalize(gen_random_uuid())$$,'42501','not_found','a different finalization claim has no authority');
select is(pg_temp.authorize_finalize(),(select receipt from finalization_manifest),'rechecks return the identical closed manifest');
create temporary table final_object as select gen_random_uuid() id;
grant select on final_object to service_role;
set local role service_role;
insert into storage.objects(id,bucket_id,name,metadata)
 values((select id from final_object),'genomes',(select receipt->>'finalKey' from finalization_manifest),'{"size":8}');
reset role;
create function pg_temp.complete_finalize(p_hash text default repeat('a',64)) returns jsonb language sql as $$
 select public.complete_own_upload_finalization_v1('76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010',(select (receipt->>'uploadId')::uuid from role_upload),
 (select (receipt->>'claim')::uuid from finalization_manifest),(select id from final_object),p_hash,repeat('b',64));
$$;
select throws_ok($$select pg_temp.complete_finalize()$$,'42501','upload_unavailable','publication requires staging metadata deletion first');
-- Only synthetic, rollback-only metadata was inserted above: no physical file.
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from role_upload);
select throws_ok($$select pg_temp.complete_finalize(repeat('c',64))$$,'42501','upload_unavailable','the browser hash cannot be replaced by a different attestation');
create temporary table finalized_receipt as select pg_temp.complete_finalize() receipt;
select is((select receipt->>'status' from finalized_receipt),'finalized_ready_for_processing','publication is ready for later processing, not an analysis claim');
select is((select status from public.retention_due_phases where retention_id='upload.staging-2h'
 and target_id=(select (receipt->>'uploadId')::uuid from role_upload)),'cancelled','the immutable publication cancels only its staging expiry phase');
select is((select count(*) from public.upload_staging_objects where upload_session_id=(select (receipt->>'uploadId')::uuid from role_upload)),0::bigint,
 'published source is no longer a working object eligible for staging cleanup');
savepoint promoted_expiry;
update public.upload_sessions set expires_at=created_at+interval '1 microsecond'
 where id=(select (receipt->>'uploadId')::uuid from role_upload);
select is(public.claim_own_upload_purge_v1(repeat('e',64)),null::jsonb,
 'even an expired promoted session cannot be selected by early staging cleanup');
select is((select count(*) from public.genome_files where id=(select (receipt->>'fileId')::uuid from finalized_receipt)),1::bigint,
 'the promoted source survives early cleanup selection');
rollback to promoted_expiry;
select is((select count(*) from public.worker_jobs where file_id=(select (receipt->>'fileId')::uuid from finalized_receipt)),0::bigint,
 'finalization creates no processing job');
select is((select count(*) from public.purpose_grants where target_id=(select id from upload_role_subject)),0::bigint,
 'finalization creates no analytic permission');
select ok((select single_logical_sample_verified_at is not null and structural_validator_version='single-logical-sample-v1'
 and source_sha256=repeat('b',64) and sha256=repeat('a',64) from public.genome_files
 where id=(select (receipt->>'fileId')::uuid from finalized_receipt)),
 'raw integrity and decoded structural evidence remain distinct and bound to the final file');
select is(pg_temp.begin_finalize(),jsonb_build_object('status','complete','fileId',(select receipt->>'fileId' from finalized_receipt)),
 'a completed request returns its existing file without copying again');
select throws_ok($$update public.genome_files set source_sha256=repeat('c',64)
 where id=(select (receipt->>'fileId')::uuid from finalized_receipt)$$,'55000','immutable_file_identity',
 'structural evidence cannot be mutated after publication');
create function pg_temp.abort_finalize() returns jsonb language sql as $$
 select public.abort_own_upload_finalization_v1('76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010',(select (receipt->>'uploadId')::uuid from role_upload),
 (select (receipt->>'claim')::uuid from finalization_manifest));
$$;
select throws_ok($$select pg_temp.abort_finalize()$$,'42501','not_found','an uncertain response cannot authorize deletion of a committed file');
update role_upload set receipt=pg_temp.issue_role_upload();
set local role service_role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 values('genomes',(select receipt->>'stagingKey' from role_upload),'76300000-0000-4000-8000-000000000001','{"size":8}');
reset role;
update finalization_manifest set receipt=pg_temp.begin_finalize();
update public.subject_consents set revoked_at=clock_timestamp(),revocation_reason='withdrawn'
 where account_id='76300000-0000-4000-8000-000000000001' and consent_type='upload_class';
select throws_ok($$select pg_temp.authorize_finalize()$$,'42501','not_found','revocation stops further validation and promotion operations');
select lives_ok($$select pg_temp.abort_finalize()$$,'cleanup still has authority over its exact uncommitted lease after revocation');
select throws_ok($$select public.ack_own_upload_finalization_cleanup_v1('76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010',(select (receipt->>'uploadId')::uuid from role_upload),
 (select (receipt->>'claim')::uuid from finalization_manifest))$$,'42501','not_found','cleanup cannot acknowledge a remaining staging object');
delete from storage.objects where bucket_id='genomes' and name=(select receipt->>'stagingKey' from role_upload);
select is(public.ack_own_upload_finalization_cleanup_v1('76300000-0000-4000-8000-000000000001',
 '76300000-0000-4000-8000-000000000010',(select (receipt->>'uploadId')::uuid from role_upload),
 (select (receipt->>'claim')::uuid from finalization_manifest)),true,'cleanup acknowledgement clears only a fully removed staging pair');
select is((select count(*) from public.genome_files where user_id='76300000-0000-4000-8000-000000000001'),1::bigint,
 'a rejected upload neither creates a second file nor removes the previously committed file');
select * from finish();
rollback;
