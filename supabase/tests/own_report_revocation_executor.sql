begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Independent bounded fixture configuration; the entire transaction rolls
-- back, including any existing local singleton restored by ON CONFLICT.
insert into private.upload_authorization_config(singleton,auth_issuer,maximum_array_bytes,maximum_vcf_bytes,
 maximum_account_bytes,maximum_active_uploads)
 values(true,'http://127.0.0.1:54321/auth/v1',65536,65536,262144,2)
 on conflict(singleton) do update set auth_issuer=excluded.auth_issuer,
 maximum_array_bytes=excluded.maximum_array_bytes,maximum_vcf_bytes=excluded.maximum_vcf_bytes,
 maximum_account_bytes=excluded.maximum_account_bytes,maximum_active_uploads=excluded.maximum_active_uploads;
-- Entirely synthetic, rollback-only identity and compressed-source metadata.
insert into auth.users(id,email) values('76900000-0000-4000-8000-000000000001','revocation-executor@e2e.local');
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
 ('76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000001',now(),now(),'aal1');
update public.profiles set date_of_birth=date '1990-01-01' where id='76900000-0000-4000-8000-000000000001';
create temporary table generation_subject as select id from public.subjects
 where subject_account_id='76900000-0000-4000-8000-000000000001' and subject_class='self';
insert into public.account_operation_nonces(nonce_hash,account_id,session_id,operation,expires_at)
 select repeat(letter,64),'76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 'own_upload_artifact_sign',clock_timestamp()+interval '9 minutes' from unnest(array['a','b']) letter;
select public.sign_own_upload_artifact_v1('76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 (select id from generation_subject),'disclosure.insurance-and-discrimination',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='disclosure.insurance-and-discrimination' and version=1),
 array['understood'],1,1,1,1,1,repeat('a',64));
select public.sign_own_upload_artifact_v1('76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 (select id from generation_subject),'consent.upload-self',1,
 (select body_sha256 from public.consent_artifacts where artifact_key='consent.upload-self' and version=1),
 array['own-adult-dna'],1,1,1,1,1,repeat('b',64));
insert into storage.objects(id,bucket_id,name,metadata) values('76900000-0000-4000-8000-000000000020',
 'genomes','76900000-0000-4000-8000-000000000030','{"size":8}');
insert into public.genome_files(id,user_id,subject_id,bucket_path,original_name,file_type,tier,size_bytes,sha256,status,
 upload_revision,structural_validator_version,single_logical_sample_verified_at,source_sha256,storage_object_id)
 values('76900000-0000-4000-8000-000000000040','76900000-0000-4000-8000-000000000001',(select id from generation_subject),
 '76900000-0000-4000-8000-000000000030','Synthetic compressed genome','vcf',1,8,repeat('a',64),'uploaded',1,
 'single-logical-sample-v1',clock_timestamp(),repeat('b',64),'76900000-0000-4000-8000-000000000020');
insert into public.genome_storage_objects(object_id,object_name,bucket_id,genome_file_id,sha256,byte_count,object_revision,state)
 values('76900000-0000-4000-8000-000000000020','76900000-0000-4000-8000-000000000030','genomes',
 '76900000-0000-4000-8000-000000000040',repeat('a',64),8,1,'current');
create temporary table preparation as select public.own_upload_normalization_v1('begin',
 '76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000040') receipt;
create function pg_temp.prepare(op text,payload jsonb) returns jsonb language sql as $$
 select public.own_upload_normalization_v1(op,'76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000040',(select (receipt->>'claim')::uuid from preparation),payload);
$$;
select pg_temp.prepare('stage','{"kind":"observed","sequence":0,"rows":[{"source_line":7,"source_chrom":2,"source_pos":136608646,"source_ref":"G","source_alt":"A","source_gt":"0/1","rsid":4988235,"chrom":2,"pos":135851076,"ref":"G","alt":"A","genotype":"A/G","quality_state":"pass","usable":true}]}');
select pg_temp.prepare('complete',jsonb_build_object('sourceBuild','GRCh37','rawSha256',repeat('a',64),
 'decodedSha256',repeat('b',64),'variantCount',0,'observedCallCount',1,'provenance','{}'::jsonb));
create temporary table claims(purpose text primary key,receipt jsonb);
create function pg_temp.generate(op text,purpose text default 'reports.polygenic',payload jsonb default null) returns jsonb language sql as $$
 select public.own_report_generation_v1(op,'76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010','76900000-0000-4000-8000-000000000040',purpose,
 case when op='begin' then null else (select (receipt->>'claim')::uuid from claims where claims.purpose=$2) end,payload);
$$;
create function pg_temp.grant_report(purpose text,nonce text) returns jsonb language sql as $$
 select public.grant_own_report_purpose_v1('76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 (select id from generation_subject),public.own_report_context_v1('76900000-0000-4000-8000-000000000001',
 '76900000-0000-4000-8000-000000000010',(select id from generation_subject)),purpose,
 (select version from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),
 (select body_sha256 from public.consent_artifacts where artifact_key=case purpose when 'reports.polygenic' then 'consent.own-polygenic' else 'consent.own-monogenic' end and superseded_at is null),nonce,clock_timestamp()+interval '9 minutes');
$$;
create function pg_temp.readable(purpose text default 'reports.polygenic') returns uuid[] language sql as $$
 select public.filter_own_analysis_files_v1('76900000-0000-4000-8000-000000000001','76900000-0000-4000-8000-000000000010',
 (select id from generation_subject),purpose,array['76900000-0000-4000-8000-000000000040'::uuid],true);
$$;
create temporary table old_grant as select (pg_temp.grant_report('reports.polygenic',repeat('c',64))->>'recordId')::uuid id;
insert into claims values('reports.polygenic',pg_temp.generate('begin'));
create temporary table report_output as select jsonb_build_object('reports',jsonb_build_array(jsonb_build_object('slug',slug,'covered',1)),
 'prs','[{"pgs_id":"PGS000011","raw_score":0.1,"coverage":0.2,"matched":1}]'::jsonb) payload
 from public.report_templates where status='published' and layer='estimate' order by slug limit 1;
select is(pg_temp.generate('complete','reports.polygenic',(select payload from report_output))->>'status','complete','real selected generation completes before revocation');
create function pg_temp.interrupt_own_purge() returns trigger language plpgsql as $$
begin
 if old.file_id='76900000-0000-4000-8000-000000000040'::uuid then raise exception 'synthetic purge interruption'; end if;
 return old;
end $$;
create trigger synthetic_own_purge_interruption before delete on private.own_analysis_runs for each row execute function pg_temp.interrupt_own_purge();
select public.revoke_directional_purpose_v1('76900000-0000-4000-8000-000000000001',(select id from old_grant));
drop trigger synthetic_own_purge_interruption on private.own_analysis_runs;
select is(pg_temp.readable(),'{}'::uuid[],'interrupted physical purge still denies report reads immediately');
create temporary table old_job as select id,source_binding_id,file_sha256 from public.worker_jobs
 where user_id='76900000-0000-4000-8000-000000000001' and computation_revision='own-report-revocation-v1';
select is((select count(*) from old_job),1::bigint,'future own revocation enqueues one compliant job');
select is((select count(*) from public.worker_jobs where user_id='76900000-0000-4000-8000-000000000001' and computation_revision='family-revoke-purge-v1'),0::bigint,'future own revocation does not create a legacy job');
select ok((select w.source_binding_id=r.id and w.file_sha256=m.source_binding_fingerprint and r.fixed_deadline=g.revoked_at+interval '60 seconds'
 from old_job w join public.retention_rows r on r.id=w.source_binding_id join public.purge_manifests m on m.retention_row_id=r.id
 join public.purpose_grants g on g.grant_id=(select id from old_grant)),'disposition/manifest binding and original deadline precede enqueue');
select is((select count(*) from public.purge_manifest_entries e join public.purge_manifests m on m.id=e.manifest_id
 where m.retention_row_id=(select source_binding_id from old_job)),2::bigint,'manifest freezes both existing output primary keys before first delete');
select throws_ok($$update public.retention_due_phases set phase_deadline=clock_timestamp() where retention_row_id=(select source_binding_id from old_job)$$,
 '23514','own_report_purge_binding_immutable','original deadline cannot be extended');
select throws_ok($$update public.worker_jobs set file_sha256=repeat('f',64) where id=(select id from old_job)$$,
 '23514','worker job dispatch binding is immutable','dispatch cannot be relabelled');
-- A frozen entry must not escape by being moved to an unprotected manifest.
create temporary table generic_retention as
 with inserted as (insert into public.retention_rows(retention_id,target_kind,target_id,retention_revision,target_lifecycle_revision,disposition_revision,fixed_deadline)
 select 'audit.legal-log-7y',target_kind,target_id,1,target_lifecycle_revision,1,fixed_deadline
 from public.retention_rows where id=(select source_binding_id from old_job) returning *) select * from inserted;
insert into public.retention_due_phases(retention_row_id,retention_id,phase_id,phase_kind,phase_revision,phase_deadline,target_kind,target_id,
 target_lifecycle_revision,disposition_revision,recipient_authority_kind,recipient_authority_revision)
 select id,retention_id,'audit-legal-log-prefix-purge','purge',1,fixed_deadline,target_kind,target_id,target_lifecycle_revision,1,'test',1 from generic_retention;
create temporary table generic_manifest as
 with inserted as (insert into public.purge_manifests(retention_row_id,phase_id,phase_revision,manifest_class,manifest_revision,source_binding_fingerprint)
 select id,'audit-legal-log-prefix-purge',1,'purpose-derived-only',1,repeat('a',64) from generic_retention returning id) select * from inserted;
select throws_ok($$update public.purge_manifest_entries set manifest_id=(select id from generic_manifest)
 where manifest_id in(select id from public.purge_manifests where retention_row_id=(select source_binding_id from old_job))$$,
 '23514','own_report_purge_membership_immutable','moving frozen membership to a generic manifest is forbidden');
-- Exercise the real dispatch/error boundary with only this exact synthetic
-- queued job. No global selector or unrelated fixture is changed.
create function pg_temp.fail_own_purge_transient() returns trigger language plpgsql as $$
begin
 if old.file_id='76900000-0000-4000-8000-000000000040'::uuid then
  raise exception using errcode=current_setting('test.own_purge_sqlstate'),message='synthetic bounded failure';
 end if;
 return old;
end $$;
create trigger synthetic_own_purge_transient before delete on public.user_prs for each row execute function pg_temp.fail_own_purge_transient();
savepoint transient_attempt;
select set_config('test.own_purge_sqlstate','55P03',true);
select is(private.dispatch_own_report_purge_v1((select id from old_job))->>'outcome','retry','lock contention is a retryable receipt');
select ok((select status='queued' and attempts=1 and not_before>clock_timestamp() and result->>'cleanupComplete'='false'
 from public.worker_jobs where id=(select id from old_job)),'transient failure preserves pending work with bounded backoff');
select ok((select state='frozen' and physical_purge_started_at is null from public.purge_manifests where retention_row_id=(select source_binding_id from old_job)),
 'failed subtransaction rolls back first-delete state and physical writes');
update public.worker_jobs set attempts=max_attempts-1,not_before=clock_timestamp() where id=(select id from old_job);
select is(private.dispatch_own_report_purge_v1((select id from old_job))->>'outcome','retry','last transient attempt remains an honest noncompletion receipt');
select ok((select status='failed' and attempts=max_attempts and error='own_report_purge_retry_exhausted' and result->>'cleanupComplete'='false'
 from public.worker_jobs where id=(select id from old_job)),'retry exhaustion is explicit and cannot masquerade as cleanup');
rollback to transient_attempt;
savepoint blocked_attempt;
select set_config('test.own_purge_sqlstate','55000',true);
select is(private.dispatch_own_report_purge_v1((select id from old_job))->>'outcome','blocked','unsupported failure produces a distinct blocked receipt');
select ok((select status='failed' and error='own_report_purge_blocked' and result->>'cleanupComplete'='false'
 from public.worker_jobs where id=(select id from old_job)),'blocked candidate becomes terminal without claiming purge success');
select is((select count(*) from public.user_prs where file_id='76900000-0000-4000-8000-000000000040'),1::bigint,'blocked attempt leaves physical data intact for a corrected executor');
rollback to blocked_attempt;
drop trigger synthetic_own_purge_transient on public.user_prs;
-- A later authorized grant and actual generation must survive the older queued purge.
select pg_temp.grant_report('reports.polygenic',repeat('d',64));
update claims set receipt=pg_temp.generate('begin') where purpose='reports.polygenic';
select is(pg_temp.generate('complete','reports.polygenic',(select payload from report_output))->>'status','complete','new grant generates a real replacement result');
savepoint changed_source;
update private.own_analysis_runs set source_revision=source_revision+1 where file_id='76900000-0000-4000-8000-000000000040';
select throws_ok($$select private.execute_own_report_purge_v1((select id from old_job))$$,
 '55000','own_report_purge_residuals','complete state without current source binding cannot establish protected regrant coverage');
rollback to changed_source;
savepoint changed_normalization_object;
update private.own_normalization_runs set manifest=jsonb_set(manifest,'{objectKey}',to_jsonb('wrong-object'::text))
 where file_id='76900000-0000-4000-8000-000000000040';
select throws_ok($$select private.execute_own_report_purge_v1((select id from old_job))$$,
 '55000','own_report_purge_residuals','a newer result with mismatched normalization object cannot certify residual completion');
select ok((select physical_purge_started_at is null from public.purge_manifests where retention_row_id=(select source_binding_id from old_job)),
 'invalid regrant object binding leaves no physical progress');
rollback to changed_normalization_object;
savepoint changed_generation_subject_binding;
update private.own_analysis_runs set authority=jsonb_set(authority,'{context,subjectBindingRevision}','999'::jsonb)
 where file_id='76900000-0000-4000-8000-000000000040';
select throws_ok($$select private.execute_own_report_purge_v1((select id from old_job))$$,
 '55000','own_report_purge_residuals','a stale newer generation subject binding cannot certify residual completion');
rollback to changed_generation_subject_binding;
savepoint changed_lifecycle;
update public.subjects set lifecycle_revision=lifecycle_revision+1 where id=(select id from generation_subject);
select throws_ok($$select private.execute_own_report_purge_v1((select id from old_job))$$,
 '55000','own_report_purge_binding_invalid','a changed target revision never silently broadens the frozen disposition');
rollback to changed_lifecycle;
select is(private.execute_own_report_purge_v1((select id from old_job))->>'outcome','complete','old exact-grant residual verification completes');
select is((select count(*) from public.user_prs where file_id='76900000-0000-4000-8000-000000000040'),1::bigint,'old purge preserves new-grant coverage output');
select is(pg_temp.readable(),array['76900000-0000-4000-8000-000000000040'::uuid],'new grant and completed source remain readable');
select ok((select m.state='complete' and m.physical_purge_started_at is not null and m.frozen_manifest_hash is not null
 and w.status='done' and w.result->>'outcome'='exact_grant_residuals_zero'
 from public.purge_manifests m join public.worker_jobs w on w.source_binding_id=m.retention_row_id where w.id=(select id from old_job)),
 'only actual residual proof writes the completion receipt');
select is(private.execute_own_report_purge_v1((select id from old_job)),null::jsonb,'completed work is idempotently omitted');
select is((select count(*) from public.report_observed_calls where file_id='76900000-0000-4000-8000-000000000040'),1::bigint,'raw observed calls are preserved');
select is((select count(*) from storage.objects where name='76900000-0000-4000-8000-000000000030'),1::bigint,'raw Storage metadata is never a purpose manifest member');
-- Rollback-only historical queued fixture uses the original real enqueue
-- formula. Its grant was actually revoked above; no completed state is seeded.
create temporary table historical as select private.enqueue_worker_job_v2(
 '76900000-0000-4000-8000-000000000001','revoke_purge','lifecycle.revoke-purge',(select id from generation_subject),null,
 'revocation-disposition',(select id from old_grant),1,
 encode(extensions.digest(convert_to(concat_ws(':','family-revoke-purge-v1',(select id::text from old_grant),
 (select id::text from generation_subject),jsonb_build_object('disposition','purpose-revocation','purpose','reports.polygenic',
 'grant_id',(select id from old_grant),'pair_ids','[]'::jsonb)::text),'UTF8'),'sha256'),'hex'),'family-revoke-purge-v1',null,
 jsonb_build_object('disposition','purpose-revocation','purpose','reports.polygenic','grant_id',(select id from old_grant),
 'pair_ids','[]'::jsonb,'retention_id','purpose.derived-60s','manifest_class','purpose-derived-only')) job;
select is(private.execute_own_report_purge_v1((select (job).id from historical))->>'outcome','superseded','validated historical dispatch gets a visible supersession');
select ok((select w.status='cancelled' and w.result->>'outcome'='superseded' and w.result->>'cleanupComplete'='false'
 and w.file_sha256=(h.job).file_sha256 and w.source_binding_id=(h.job).source_binding_id
 from public.worker_jobs w,historical h where w.id=(h.job).id),'historical job preserves binding and never claims cleanup');
select is(private.execute_own_report_purge_v1((select (job).id from historical)),null::jsonb,'repeat supersession never duplicates an existing disposition');
select ok(not has_function_privilege('anon','public.run_own_report_purge_v1()','EXECUTE')
 and not has_function_privilege('authenticated','public.run_own_report_purge_v1()','EXECUTE')
 and not has_function_privilege('inherit_upload_only','public.run_own_report_purge_v1()','EXECUTE'),
 'no browser or restricted-upload role may run the purge');
select ok(has_function_privilege('service_role','public.run_own_report_purge_v1()','EXECUTE'),'only service execution is exposed');
-- Without injected failure, the real revoke transaction executes registered
-- physical deletion and residual verification synchronously within its deadline.
select public.revoke_directional_purpose_v1('76900000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from generation_subject) and purpose='reports.polygenic' and revoked_at is null));
select is((select count(*) from public.user_prs where file_id='76900000-0000-4000-8000-000000000040'),0::bigint,'ordinary synchronous revocation physically deletes coverage rows');
select is((select count(*) from private.own_analysis_runs where file_id='76900000-0000-4000-8000-000000000040'),0::bigint,'ordinary synchronous revocation physically deletes its journal');
select ok((select bool_and((w.result->>'completedWithinDeadline')::boolean) from public.worker_jobs w
 where w.user_id='76900000-0000-4000-8000-000000000001' and computation_revision='own-report-revocation-v1' and status='done'),
 'real completions retain the original 60-second deadline receipt');
select pg_temp.grant_report('reports.monogenic',repeat('e',64));
insert into claims values('reports.monogenic',pg_temp.generate('begin','reports.monogenic'));
select public.revoke_directional_purpose_v1('76900000-0000-4000-8000-000000000001',
 (select grant_id from public.purpose_grants where target_id=(select id from generation_subject) and purpose='reports.monogenic' and revoked_at is null));
select is((select count(*) from private.own_analysis_runs where file_id='76900000-0000-4000-8000-000000000040'),0::bigint,'monogenic unfinished journal uses the same real executor');
select is((select count(*) from public.report_observed_calls where file_id='76900000-0000-4000-8000-000000000040'),1::bigint,'monogenic purge preserves raw observations');
select ok(private.own_report_purge_hash_matches_v1(repeat('a',64),repeat('a',64))
 and not private.own_report_purge_hash_matches_v1(repeat('a',64),repeat('b',64)),
 'dispatch fingerprint comparison checks every byte without a prefix exit');
set constraints all immediate;
select * from finish();
rollback;
