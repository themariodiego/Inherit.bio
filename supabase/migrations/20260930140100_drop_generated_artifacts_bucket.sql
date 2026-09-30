-- G8.5: drop the generated-artifacts Storage bucket, and retire the
-- single-object export archive form it was made for. Owner decision
-- 2026-09-28 (evening), docs/protocol/decisions.md.
--
-- 20260831224054_storage_and_download_sessions.sql created the bucket for
-- export archives stored as one object: a public.genome_storage_objects row
-- with generated_export_id set, named by public.generated_exports.object_id.
-- Nothing in src ever wrote it. The register never declared a prefix for it
-- and now puts every archive object in exports (storage.export-v1), as the
-- ordered segments of 20260923123240_export_archive_persistence.sql.
--
-- The drop is refused, and the whole migration rolls back, if the bucket
-- still holds an object or an unfinished multipart upload, if any row still
-- records a single-object archive or an object in this bucket, or if an
-- account-deletion or embryo-unwind manifest has a pending entry in it. So a
-- production apply either removes an empty, unreferenced bucket or reports
-- what is still there.
--
-- Not touched: 'generated-artifacts' is also a retention target id over
-- database rows (public.purge_target_stores: report_artifacts,
-- generated_exports, download_sessions, model_contexts and
-- private.own_analysis_runs). That meaning is unrelated to the bucket and
-- stays.

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'generated-artifacts') then
    raise exception using errcode = '55000', message = 'generated_artifacts_not_empty';
  end if;
  if exists (select 1 from storage.s3_multipart_uploads where bucket_id = 'generated-artifacts') then
    raise exception using errcode = '55000', message = 'generated_artifacts_upload_in_progress';
  end if;
  if exists (select 1 from public.genome_storage_objects
    where bucket_id = 'generated-artifacts' or generated_export_id is not null) then
    raise exception using errcode = '55000', message = 'generated_artifacts_object_recorded';
  end if;
  if exists (select 1 from public.generated_exports where object_id is not null) then
    raise exception using errcode = '55000', message = 'single_object_export_recorded';
  end if;
  -- A manifest entry still waiting to remove an object here would call
  -- remove() on a bucket that no longer exists, fail, and stall that
  -- account deletion or embryo unwind on every retry.
  if exists (select 1 from public.account_deletion_storage_entries
    where bucket_id = 'generated-artifacts' and status = 'pending') then
    raise exception using errcode = '55000', message = 'generated_artifacts_deletion_pending';
  end if;
  if exists (select 1 from public.embryo_ingest_delete_objects
    where bucket_id = 'generated-artifacts' and state = 'pending') then
    raise exception using errcode = '55000', message = 'generated_artifacts_unwind_pending';
  end if;
end $$;

-- The single-object form is retired. A ready export must now be the
-- segmented archive: generated_exports_ready_representation already requires
-- object_id for a ready row without archive_version, and object_id can no
-- longer be set. A recorded Storage object is a genome source in genomes; no
-- row can name an export archive or this bucket again. Both constraints are
-- additive, so the original column CHECKs stay as they were written, and the
-- account-deletion builder, which copies gso.bucket_id into its manifest, can
-- no longer produce this bucket.
alter table public.generated_exports
  add constraint generated_exports_single_object_retired check (object_id is null);
alter table public.genome_storage_objects
  add constraint genome_storage_objects_genomes_only
    check (bucket_id = 'genomes' and generated_export_id is null);

-- Storage refuses direct deletes unless asked for one, transaction-locally.
select pg_catalog.set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets where id = 'generated-artifacts';
select pg_catalog.set_config('storage.allow_delete_query', 'false', true);
