begin;
select no_plan();
-- Actual signed upload/worker publication, documentary review and claimant
-- release producers. ACKs below are SQL-only metadata protocol evidence;
-- this is never physical-provider or hosted acceptance.
\ir fixtures/future_person_deletion_authority.inc
create temporary table last_claimant_source as select to_jsonb(x) source from private.embryo_canonical_sources x where file_id=(select file from custody_ids);
create temporary table last_parent_deletion(id uuid);
with r as (insert into public.account_deletion_requests(account_id,request_account_revision,request_auth_session_revision,
 principal_graph_revision,deletion_hold_revision,state,requested_at,notice_ends_at,delete_started_at,
 claim_token_hash,claim_expires_at,storage_manifest_frozen_at)
 select '7a000000-0000-0000-0000-000000000001',1,1,1,1,'delete_started',t.n-interval '8 days',
 t.n-interval '1 day',t.n,repeat('d',64),t.n+interval '5 minutes',t.n from(select clock_timestamp() n)t
 returning id) insert into last_parent_deletion select id from r;
select lives_ok($$select private.prepare_account_owned_cohorts_v1((select id from last_parent_deletion))$$,
 'the genuine parent due worker preserves detached claimant custody while selecting its own source');
create temporary table last_pair_before as select private.claimed_provenance_candidate_v1((select file from custody_ids)) candidate;
select throws_ok($$select private.purge_account_owned_cohorts_v1((select id from last_parent_deletion))$$,
 '55000','storage_purge_incomplete','the real parent finalizer cannot remove runtime before original and source disposal proof');
create function pg_temp.last_parent_dispose(p_unwind uuid) returns text language plpgsql as $$
declare d private.embryo_ingest_object_disposals;claim jsonb;evidence jsonb;
begin
 claim:=public.claim_embryo_ingest_object_disposals_v1(p_unwind,pg_temp.h('last-parent-disposal'));
 for d in select * from private.embryo_ingest_object_disposals where unwind_id=p_unwind order by ordinal loop
  if d.backend='supabase' then
   perform set_config('storage.allow_delete_query','true',true);
   delete from storage.objects where id=d.storage_object_id and bucket_id=d.bucket_id and name=d.object_name
    and version=d.storage_version and metadata->'size'=to_jsonb(d.byte_count);
   if not found then raise exception 'the exact original Storage metadata must be deleted once';end if;
   evidence:=jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1','provider','supabase',
    'disposition','object-deleted','bucket',d.bucket_id,'objectKey',d.object_name,'objectId',d.storage_object_id,
    'storageVersion',d.storage_version,'byteCount',d.byte_count);
  elsif d.backend='r2' then
   evidence:=jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1','provider','r2',
    'disposition','payload-tombstoned','bucket',d.bucket_id,'objectKey',d.object_name,'providerVersion',lpad(d.ordinal::text,32,'7'),
    'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  else raise exception 'unknown provider cannot acknowledge the actual parent inventory';end if;
  perform public.finish_embryo_ingest_object_disposal_v1(d.unwind_id,d.ordinal,pg_temp.h('last-parent-disposal'),
   private.embryo_ingest_disposal_receipt_v1(d),evidence);
 end loop;
 if public.confirm_embryo_ingest_unwind_storage_v1(p_unwind)->>'status'<>'storage_confirmed' then
  raise exception 'not all exact original provider objects are confirmed';end if;
 return public.complete_embryo_ingest_unwind_v1(p_unwind)->>'status';
end $$;
select is(pg_temp.last_parent_dispose((x->>'unwindId')::uuid),'complete','each actual parent inventory drains through its exact original provider door')
 from jsonb_array_elements(public.account_embryo_unwinds_v1((select id from last_parent_deletion),repeat('d',64))) x;
select lives_ok($$select public.complete_account_deletion_storage_v1((select id from last_parent_deletion),repeat('d',64))$$,
 'the due account closes Storage only after every exact provider ACK');
select lives_ok($$select private.purge_account_owned_cohorts_v1((select id from last_parent_deletion))$$,
 'the actual parent finalizer removes account runtime while retaining the genuine claimed source');
select is((select to_jsonb(x) from private.embryo_canonical_sources x where file_id=(select file from custody_ids)),
 (select source from last_claimant_source),'the full original detached claimant source remains byte-identical after parent disposal');
select ok((select to_jsonb(s)=candidate->'ingest' and to_jsonb(j)=candidate->'job' from last_pair_before b
 join private.claimed_embryo_ingest_receipts s on s.id=(b.candidate#>>'{ingest,id}')::uuid
 join private.claimed_embryo_job_receipts j on j.id=(b.candidate#>>'{job,id}')::uuid),
 'the surviving claimed source preserves both exact minimum receipts byte-identically');
select ok(not exists(select 1 from public.embryo_ingest_sessions where id=(select id from live))
 and not exists(select 1 from public.worker_jobs where id=(select id from job))
 and not exists(select 1 from public.embryo_cohorts where id=(select cohort_id from live)),
 'the actual account-bearing parent cohort, job and session are gone before claimant disposal');
set constraints all immediate;
select throws_ok($$delete from private.claimed_embryo_job_receipts where id=(select id from job)$$,
 '23514','invalid embryo part provenance','direct receipt deletion still refuses while a claimed part survives');
select throws_ok($$delete from private.claimed_embryo_ingest_receipts where id=(select id from live)$$,
 '23503',null,'the exact job still protects its parent ingest receipt from direct deletion');
select throws_ok($$update private.claimed_embryo_job_receipts set computation_revision='replacement' where id=(select id from job)$$,
 '23514','claimed provenance receipt immutable','a surviving claimant receipt cannot be rewritten');
set constraints all immediate;
set constraints all deferred;
select lives_ok($$select private.assert_future_person_settled_source_v1((select file from custody_ids))$$,
 'the same genuine source settles through its exact archived tuple after parent runtime is gone');
create temporary table last_claimant_plan as select private.prepare_future_person_deletion_v1(pg_temp.h('deletion-rights'),
 'last-claimant-delete-positive-aaaaaaaa') id;
select is((select p.immutable_envelope->'sharedProvenance' from last_claimant_plan d join public.purge_manifests m on m.id=d.id
 join public.retention_due_phases p on p.retention_row_id=m.retention_row_id and p.phase_id=m.phase_id),
 (select candidate from last_pair_before),'the genuine claimant request seals the unchanged archived pair without rebuilding historical values');
create temporary table last_claimed_parts as select public.future_person_deletion_parts_v1('claim',
 (select id from last_claimant_plan),pg_temp.h('last-claimant-disposal')) receipt;
select is((select jsonb_array_length(receipt->'objects') from last_claimed_parts),2,'only the last claimant own exact two canonical parts are claimed');
select throws_ok($$select private.finish_future_person_deletion_v1((select id from last_claimant_plan),pg_temp.h('last-claimant-disposal'))$$,
 '42501','claimant deletion unavailable','a live part lease without actual exact marker acknowledgements cannot collect either receipt');
do $$ declare item jsonb;begin
 for item in select jsonb_array_elements(receipt->'objects') from last_claimed_parts loop
  perform public.future_person_deletion_parts_v1('acknowledge',(select id from last_claimant_plan),pg_temp.h('last-claimant-disposal'),item,
   jsonb_build_object('disposition','payload-tombstoned','bucket',item->>'bucket','objectKey',item->>'objectKey',
    'providerVersion',repeat('b',32),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
    'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
 end loop;
end $$;
select throws_ok($$select private.finish_future_person_deletion_v1((select id from last_claimant_plan),pg_temp.h('last-claimant-disposal'))$$,
 '42501','claimant deletion unavailable','source ACKs still cannot substitute for the genuine claimant document disposal callback');
select public.confirm_claim_document_objects_deleted_v1((select array_agg(d.object_key) from private.claim_documents d
 where d.intake_id=(select review from custody_ids)),'jobs.retention');
select throws_ok($$select private.finish_future_person_deletion_v1((select id from last_claimant_plan),pg_temp.h('crossed-last-claimant'))$$,
 '42501','claimant deletion unavailable','a crossed disposal lease cannot enter the last-consumer final transaction');
select ok((select to_jsonb(s)=candidate->'ingest' and to_jsonb(j)=candidate->'job' from last_pair_before b
 join private.claimed_embryo_ingest_receipts s on s.id=(b.candidate#>>'{ingest,id}')::uuid
 join private.claimed_embryo_job_receipts j on j.id=(b.candidate#>>'{job,id}')::uuid),
 'all missing source/document ACK and crossed-lease refusals leave both real receipt rows unchanged');
select is(private.finish_future_person_deletion_v1((select id from last_claimant_plan),pg_temp.h('last-claimant-disposal'))->>'status',
 'deleted','the real last claimant finalizer collects the minimum pair only inside complete acknowledged graph disposal');
select ok(not exists(select 1 from private.claimed_embryo_ingest_receipts where id=(select id from live))
 and not exists(select 1 from private.claimed_embryo_job_receipts where id=(select id from job))
 and not exists(select 1 from private.embryo_canonical_parts where session_id=(select id from live))
 and not exists(select 1 from private.embryo_canonical_sources where session_id=(select id from live)),
 'both archived receipts, all actual shared parts and source consumers are gone after genuine last-claimant disposal');
select is((select p.immutable_envelope->>'sharedProvenanceDisposition' from last_claimant_plan d join public.purge_manifests m on m.id=d.id
 join public.retention_due_phases p on p.retention_row_id=m.retention_row_id and p.phase_id=m.phase_id),'collected',
 'the minimized terminal receipt contains only the closed collected disposition');
select ok((select not(p.immutable_envelope ? 'sharedProvenance') from last_claimant_plan d join public.purge_manifests m on m.id=d.id
 join public.retention_due_phases p on p.retention_row_id=m.retention_row_id and p.phase_id=m.phase_id),
 'last-claimant completion retains no original pair identifiers in its terminal phase');
select throws_ok($$select private.finish_future_person_deletion_v1((select id from last_claimant_plan),pg_temp.h('last-claimant-disposal'))$$,
 '42501','claimant deletion unavailable','the completed last-consumer manifest cannot replay collection');
set constraints all immediate;
select * from finish();
rollback;
