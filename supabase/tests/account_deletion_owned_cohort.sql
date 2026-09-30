begin;
select no_plan();
-- Metadata-only synthetic canonical publication and reviewed custody. This
-- proves SQL authority/receipt transitions, never hosted-provider deletion.
\ir fixtures/future_person_custody_source.inc
\ir fixtures/account_cohort_custody_approved.inc
select is(private.detach_future_person_subject_v1((select review from custody_ids)),
  (select claimant from custody_ids),'the real approved custody transition detaches one exact source');
set constraints all immediate;
set constraints all deferred;
create function pg_temp.snapshot() returns jsonb language sql as $$
 select jsonb_build_object('source',(select to_jsonb(x) from private.embryo_canonical_sources x where file_id=(select file from custody_ids)),
  'memberships',(select jsonb_agg(to_jsonb(m) order by m.sequence) from private.embryo_canonical_source_parts m where file_id=(select file from custody_ids)),
  'parts',(select jsonb_agg(to_jsonb(p) order by p.sequence) from private.embryo_canonical_parts p
    join private.embryo_canonical_source_parts m on m.part_id=p.id where m.file_id=(select file from custody_ids)),
  'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.embryo_variants v where source_file_id=(select file from custody_ids)),
  'agreement',(select to_jsonb(x) from private.future_person_custody_slices x where subject_id=(select subject from custody_ids)));
$$;
create temporary table before_source as select pg_temp.snapshot() body;
create function pg_temp.request_without_contact() returns uuid language plpgsql as $$
begin
 update public.encrypted_contact_references set status='rotated',ended_at=clock_timestamp()
 where principal_id=any(private.embryo_cohort_set_v1((select cohort_id from live),'notice_recipients')) and status='current';
 return (select deletion_id from public.request_account_deletion_v2(
 '7a000000-0000-0000-0000-000000000001','7a000000-0000-4000-8000-0000000000a1',
 repeat('1',64),clock_timestamp()+interval '9 minutes',decode('0011223344556677','hex'),repeat('2',64),repeat('3',64)));
end $$;
select throws_ok($$select pg_temp.request_without_contact()$$,
 '55000','account_notice_binding_unavailable','an owned-cohort request refuses missing exact affected-recipient contacts');
select is((select count(*) from public.account_deletion_requests where account_id='7a000000-0000-0000-0000-000000000001'),
 0::bigint,'a refused request creates no hold or deletion row');
select ok((select deletion_requested_at is null from public.profiles where id='7a000000-0000-0000-0000-000000000001'),
 'a refused request preserves the account');
-- An exact already-started due worker envelope isolates the prerequisite.
-- No browser acceptance or complete request/notice journey is claimed.
create temporary table deletion(id uuid);
with r as (insert into public.account_deletion_requests(account_id,request_account_revision,request_auth_session_revision,
 principal_graph_revision,deletion_hold_revision,state,requested_at,notice_ends_at,delete_started_at,
 claim_token_hash,claim_expires_at,storage_manifest_frozen_at)
 select '7a000000-0000-0000-0000-000000000001',1,1,1,1,'delete_started',t.n-interval '8 days',
 t.n-interval '1 day',t.n,repeat('d',64),t.n+interval '5 minutes',t.n from(select clock_timestamp() n)t
 returning id) insert into deletion select id from r;
select throws_ok($$select private.capture_claimed_embryo_provenance_v1(gen_random_uuid(),(select cohort_id from live))$$,
 '42501','account cohort purge unavailable','a caller without a due deletion cannot create provenance receipts');
select throws_ok($$select public.account_embryo_unwinds_v1((select id from deletion),repeat('e',64))$$,
 '42501','account cohort purge unavailable','a crossed deletion claim cannot select any provider work');
create function pg_temp.expired_read() returns jsonb language plpgsql as $$
begin
 update public.account_deletion_requests set claim_expires_at=clock_timestamp()-interval '1 second' where id=(select id from deletion);
 return public.account_embryo_unwinds_v1((select id from deletion),repeat('d',64));
end $$;
select throws_ok($$select pg_temp.expired_read()$$,'42501','account cohort purge unavailable',
 'an expired worker claim cannot select provider work');
select ok((select claim_expires_at>clock_timestamp() from public.account_deletion_requests where id=(select id from deletion)),
 'the refused expiry probe leaves the original exact lease unchanged');
select lives_ok($$select private.assert_account_owned_cohorts_v1('7a000000-0000-0000-0000-000000000001')$$,
 'the owned published two-parent graph is recognized without granting parent power over the claim');
select lives_ok($$select private.prepare_account_owned_cohorts_v1((select id from deletion))$$,
 'the due worker selects only current parent-controlled material');
select is(pg_temp.snapshot(),(select body from before_source),'planning preserves claimed source, memberships, parts, genotypes and agreement byte for byte');
select is((select count(*) from private.claimed_embryo_ingest_receipts),1::bigint,'one minimum session receipt is captured');
select is((select count(*) from private.claimed_embryo_job_receipts),1::bigint,'one exact completed dispatch receipt is captured');
select ok((select p.fixed_deadline=d.notice_ends_at from private.account_owned_cohort_purges p join deletion k on k.id=p.deletion_id
 join public.account_deletion_requests d on d.id=k.id),'the cohort plan keeps the original account deadline');
select is((select count(*) from private.embryo_canonical_sources where cohort_id=(select cohort_id from live)),1::bigint,
 'the unclaimed source is removed while its parts still await provider evidence');
select is((select count(*) from public.embryo_variants v join public.embryos e on e.id=v.embryo_id where e.cohort_id=(select cohort_id from live)),
 0::bigint,'all parent-controlled variants become unavailable immediately');
select throws_ok($$select public.complete_account_deletion_storage_v1((select id from deletion),repeat('d',64))$$,
 '55000','storage_purge_incomplete','unfinished cohort disposal blocks account Storage completion');
select throws_ok($$select private.purge_account_owned_cohorts_v1((select id from deletion))$$,
 '55000','storage_purge_incomplete','unfinished provider work blocks runtime and cohort removal');
select throws_ok($$update private.claimed_embryo_ingest_receipts set publication_revision=publication_revision+1$$,
 '23514','claimed provenance receipt immutable','even a privileged caller cannot silently rewrite the publication receipt');
select throws_ok($$update private.claimed_embryo_job_receipts set attempt=attempt+1$$,
 '23514','claimed provenance receipt immutable','the exact historical job attempt cannot be rewritten');
select is((select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']) role
 where has_table_privilege(role,'private.claimed_embryo_ingest_receipts','insert')
 or has_table_privilege(role,'private.claimed_embryo_job_receipts','insert')
 or has_function_privilege(role,'private.capture_claimed_embryo_provenance_v1(uuid,uuid)','execute')),0::bigint,
 'no API role has a generic receipt creation door');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
 where table_schema='private' and table_name='claimed_embryo_ingest_receipts'),
 array['id','historical_cohort_id','worker_job_id','ingest_revision','publication_revision','manifest_sha256',
 'manifest_chunk_count','source_binding_fingerprint','reference_build']::text[],
 'the ingest receipt contains only the exact frozen provenance fields, no account or credential');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
 where table_schema='private' and table_name='claimed_embryo_job_receipts'),
 array['id','session_id','historical_cohort_id','attempt','source_binding_revision','file_sha256','computation_revision','idempotency_key']::text[],
 'the completed dispatch receipt contains no full job payload, principal, account or secret');
select is((select count(*) from pg_constraint where contype='f' and conrelid in(
 'private.claimed_embryo_ingest_receipts'::regclass,'private.claimed_embryo_job_receipts'::regclass)
 and confrelid in('auth.users'::regclass,'public.subject_principals'::regclass,'public.embryo_cohorts'::regclass,
 'public.embryo_ingest_sessions'::regclass,'public.worker_jobs'::regclass)),0::bigint,
 'historical receipts cannot preserve a parent authority or runtime foreign key');

-- Exact synthetic provider acknowledgements target the SQL verifier only.
create function pg_temp.dispose(p_unwind uuid) returns text language plpgsql as $$
declare claimed jsonb; receipt jsonb; evidence jsonb; item private.embryo_ingest_object_disposals; result jsonb;
begin
 claimed:=public.claim_embryo_ingest_object_disposals_v1(p_unwind,repeat('a',64));
 for item in select d.* from private.embryo_ingest_object_disposals d where d.unwind_id=p_unwind order by ordinal loop
  receipt:=private.embryo_ingest_disposal_receipt_v1(item);
  if item.backend='r2' then
   evidence:=jsonb_build_object('version','embryo-ingest-object-tombstone-evidence-v1','provider','r2',
    'disposition','payload-tombstoned','bucket',item.bucket_id,'objectKey',item.object_name,
    'providerVersion',lpad(item.ordinal::text,32,'9'),'etag','d41d8cd98f00b204e9800998ecf8427e','byteCount',0,
    'sha256','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  else
   delete from storage.objects where id=(receipt->>'storageObjectId')::uuid and version=receipt->>'storageVersion'
    and bucket_id=receipt->>'bucket' and name=receipt->>'objectKey';
   evidence:=jsonb_build_object('version','embryo-ingest-object-delete-evidence-v1','provider','supabase','disposition','object-deleted',
    'objectId',receipt->'storageObjectId','bucket',receipt->'bucket','objectKey',receipt->'objectKey',
    'storageVersion',receipt->'storageVersion','byteCount',receipt->'byteCount');
  end if;
  perform public.finish_embryo_ingest_object_disposal_v1(p_unwind,item.ordinal,repeat('a',64),receipt,evidence);
 end loop;
 result:=public.confirm_embryo_ingest_unwind_storage_v1(p_unwind);
 if result->>'status'<>'storage_confirmed' then raise exception 'synthetic disposal incomplete'; end if;
 return public.complete_embryo_ingest_unwind_v1(p_unwind)->>'status';
end $$;
select is(pg_temp.dispose((x->>'unwindId')::uuid),'complete','the exact synthetic disposal verifier completes its planned unwind')
 from jsonb_array_elements(public.account_embryo_unwinds_v1((select id from deletion),repeat('d',64))) x;
select is(public.account_embryo_unwinds_v1((select id from deletion),repeat('d',64)),'[]'::jsonb,
 'the account-scoped selector confirms no unresolved cohort disposal remains');
select lives_ok($$select public.complete_account_deletion_storage_v1((select id from deletion),repeat('d',64))$$,
 'account Storage completes only after every exact planned provider disposal');
select lives_ok($$select private.purge_account_owned_cohorts_v1((select id from deletion))$$,
 'the worker removes parent runtime and owned cohort authority');
set constraints all immediate;
select is((select count(*) from public.embryo_cohorts where id=(select cohort_id from live)),0::bigint,'the owned parent cohort is deleted');
select is((select count(*) from public.embryo_cohort_drafts where id=(select draft_id from draft)),0::bigint,'its parent draft is deleted');
select is((select count(*) from public.embryo_ingest_sessions where id=(select id from live)),0::bigint,'the account-bearing ingest session is deleted');
select is((select count(*) from public.worker_jobs where id=(select id from job)),0::bigint,'the account-bearing full worker payload is deleted');
select is(pg_temp.snapshot(),(select body from before_source),'claimed source bytes and immutable historical references survive the parent runtime purge');
select is((select count(*) from public.subjects where cohort_id=(select cohort_id from live)),0::bigint,'no unclaimed live-cohort subject remains');
select is((select count(*) from private.account_owned_cohort_purges where deletion_id=(select id from deletion)),0::bigint,'the temporary worker plan is deleted');
select lives_ok($$select private.assert_embryo_part_provenance_v1(p.id) from private.embryo_canonical_parts p
 join private.embryo_canonical_source_parts m on m.part_id=p.id where m.file_id=(select file from custody_ids)$$,
 'the closed historical path validates every retained part after the live rows are gone');
select throws_ok($$delete from private.claimed_embryo_job_receipts$$,'23514','invalid embryo part provenance',
 'deleting the replacement job receipt cannot strand a retained part');
select throws_ok($$delete from private.claimed_embryo_ingest_receipts$$,'23503',null,
 'deleting the replacement session receipt cannot strand its exact completed dispatch');
select * from finish();
rollback;
