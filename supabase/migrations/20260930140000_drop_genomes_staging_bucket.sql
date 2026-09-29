-- G8.5: drop the genomes-staging Storage bucket, which nothing writes.
--
-- 20260906133807_cutover_subject_upload_transport.sql dropped
-- genomes_staging_create_once, the only policy that ever wrote this bucket.
-- Since then every upload path names genomes: the surviving insert policy,
-- the issuing function, upload_sessions_token_snapshot_check, the RLS
-- predicate that guards the upload JWT, finalization's copy and remove, and
-- the upload.staging-2h executor. The register declares no prefix here, and
-- docs/route-divergence.json recorded the bucket as created-not-declared with
-- the closing "until the bucket is dropped by a migration".
--
-- The drop is refused, and the whole migration rolls back, if the bucket
-- still holds any object or unfinished multipart upload, if a legacy upload
-- session that still names it is not terminal, or if an account-deletion or
-- embryo-unwind manifest still has a pending entry in it. So a production
-- apply either removes an empty, unreferenced bucket or reports what is
-- still there.
--
-- Left alone on purpose: the 'genomes-staging' literals in
-- public.claim_due_account_deletion_v1 and public.prepare_embryo_ingest_unwind_v1
-- and in the bucket CHECK constraints of their two manifest tables (D-130,
-- recorded in docs/register-contract-divergence.json#allowlistedBucketNotCreated).
-- The account-deletion leg joins storage.objects on this bucket, so it keeps
-- matching nothing. The embryo leg belongs to the embryo-ingest work.

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'genomes-staging') then
    raise exception using errcode = '55000', message = 'genomes_staging_not_empty';
  end if;
  if exists (select 1 from storage.s3_multipart_uploads where bucket_id = 'genomes-staging') then
    raise exception using errcode = '55000', message = 'genomes_staging_upload_in_progress';
  end if;
  if exists (select 1 from public.upload_sessions where storage_bucket = 'genomes-staging'
    and status in ('issued', 'uploaded', 'validating')) then
    raise exception using errcode = '55000', message = 'genomes_staging_session_live';
  end if;
  -- A manifest entry still waiting to remove an object here would call
  -- remove() on a bucket that no longer exists, fail, and stall that
  -- account deletion or embryo unwind on every retry.
  if exists (select 1 from public.account_deletion_storage_entries
    where bucket_id = 'genomes-staging' and status = 'pending') then
    raise exception using errcode = '55000', message = 'genomes_staging_deletion_pending';
  end if;
  if exists (select 1 from public.embryo_ingest_delete_objects
    where bucket_id = 'genomes-staging' and state = 'pending') then
    raise exception using errcode = '55000', message = 'genomes_staging_unwind_pending';
  end if;
end $$;

-- Every live insert names its bucket, and every token-bearing session must
-- name genomes. A row that relied on the default would otherwise name a
-- bucket that no longer exists.
alter table public.upload_sessions alter column storage_bucket set default 'genomes';

-- Storage refuses direct deletes unless asked for one, transaction-locally.
select pg_catalog.set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets where id = 'genomes-staging';
select pg_catalog.set_config('storage.allow_delete_query', 'false', true);
