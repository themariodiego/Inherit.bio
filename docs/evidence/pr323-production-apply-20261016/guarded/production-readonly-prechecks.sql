-- Read-only pre-checks for the guarded release (one SELECT, one jsonb row; writes nothing).
-- Run:  psql "$INHERIT_PROD_DB_URL" -X -q -At -v ON_ERROR_STOP=1 -f production-readonly-prechecks.sql
-- Each "must_be_zero" value that is not 0 means a migration would refuse or fail on
-- production data (the dry runs would then fail too); the registry md5s equal to the
-- rehearsal mirror's mean the registry inserts behave exactly as rehearsed. Counts
-- under "sizes" bound validation, rewrite and trigger cost. Values under "context"
-- decide whether the conditional deploy-window items in compat-analysis.md can occur.
select jsonb_build_object(
 'session', jsonb_build_object(
   'current_user', current_user,
   'statement_timeout', current_setting('statement_timeout'),
   'lock_timeout', current_setting('lock_timeout'),
   'supautils_policy_grants_lists_auth_users',
     coalesce(current_setting('supautils.policy_grants', true), '') like '%auth.users%',
   'supautils_drop_trigger_grants_lists_auth_users',
     coalesce(current_setting('supautils.drop_trigger_grants', true), '') like '%auth.users%'),
 'ledger', (select jsonb_build_object('count', count(*), 'max', max(version),
   'release_versions_present', count(*) filter (where version in (
'20260929112000','20260929143000','20260929150000','20260929150100','20260929151000','20260929152000','20260930120000','20260930121000','20260930122000','20260930123000',
'20260930124000','20260930125000','20260930130000','20260930131000','20260930132000','20260930150000','20260930230000','20260930232000','20260930232100','20260930233000',
'20260930235000','20260930237000','20260930238000','20260930239000','20260930240000','20260930241000','20260930242000','20260930243000','20260930244000','20260930245000',
'20260930246000','20260930247000','20260930248000','20260930249000','20260930250000','20261001010000','20261001011000','20261001012000','20261001013000','20261001014000',
'20261001015000','20261001016000','20261001017000','20261001018000','20261001019000','20261001020000','20261001021000','20261001022000','20261001023000','20261001024000',
'20261001025000','20261001026000','20261001027000','20261001028000','20261001029000','20261001030000','20261001031000','20261001032000','20261001033000','20261001034000',
'20261001035000','20261001036000','20261001037000','20261001038000','20261001039000','20261001040000','20261002071943','20261002080931','20261002092244','20261002132000',
'20261003030000','20261009183314','20261009184100','20261009193600','20261009200845','20261009201500','20261009204626','20261009224500','20261009224501','20261010000000',
'20261010001000','20261010002000','20261010003000','20261010004000','20261010063629','20261010080500','20261010090000','20261010155222','20261010190500','20261011010251')))
   from supabase_migrations.schema_migrations),
 'must_be_zero', jsonb_build_object(
   -- #20 subjects_claimed_custody_shape (ELSE branch) and the two other new subjects CHECKs
   'embryo_subjects_without_owner', (select count(*) from public.subjects where subject_class = 'embryo' and owner_account_id is null),
   'subjects_in_claimed_lifecycle', (select count(*) from public.subjects where lifecycle in ('claimed_unbound', 'claimed_bound')),
   -- #20 embryos_live_cohort_shape
   'embryos_in_claimed_status', (select count(*) from public.embryos where status in ('claimed_unbound', 'claimed_bound')),
   -- #20 unique current principal per claimant
   'duplicate_current_claimant_principals', (select count(*) from (select principal_id from public.future_person_claimant_principals
     where status = 'current' group by principal_id having count(*) > 1) d),
   -- #7 unique split job per binding
   'duplicate_split_jobs_per_binding', (select count(*) from (select source_binding_id from public.worker_jobs
     where kind = 'split_cohort_vcf' group by source_binding_id having count(*) > 1) d),
   -- #13 guard
   'published_embryo_sessions_with_fragments', (select count(*) from public.embryo_ingest_sessions s where s.status = 'published'
     and exists (select 1 from public.embryo_ingest_fragments f where f.session_id = s.id)),
   -- #5 bucket guard (0 = absent)
   'future_person_identity_bucket', (select count(*) from storage.buckets where id = 'future-person-identity')),
 'registry_md5', jsonb_build_object(
   'purge_target_stores', (select md5(string_agg(target_id || '|' || store_name || '|' || store_order, ',' order by target_id collate "C", store_name collate "C")) from public.purge_target_stores),
   'purge_targets', (select md5(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text collate "C")) from public.purge_targets t),
   'retention_phase_registry', (select md5(string_agg(to_jsonb(r)::text, ',' order by to_jsonb(r)::text collate "C")) from public.retention_phase_registry r)),
 'sizes', jsonb_build_object(
   'chat_messages', (select count(*) from public.chat_messages),
   'subjects', (select count(*) from public.subjects),
   'embryos', (select count(*) from public.embryos),
   'embryo_variants', (select count(*) from public.embryo_variants),
   'genome_files', (select count(*) from public.genome_files),
   'user_variants', (select count(*) from public.user_variants),
   'report_observed_calls', (select count(*) from public.report_observed_calls),
   'worker_jobs', (select count(*) from public.worker_jobs),
   'generated_exports', (select count(*) from public.generated_exports)),
 'context', jsonb_build_object(
   'embryo_cohorts', (select count(*) from public.embryo_cohorts),
   'pending_account_deletions', (select count(*) from public.account_deletion_requests where state = 'notice_period'),
   'queued_adult_upload_notices', (select count(*) from public.mail_outbox where template_id = 'adult-upload-notice' and state in ('queued', 'claimed')),
   'held_other_adult_uploads', (select count(*) from public.other_adult_held_uploads),
   'draft_purge_phases_open', (select count(*) from public.retention_due_phases
     where retention_id in ('embryo.cohort-draft-30d', 'adult.subject-draft-30d') and status in ('pending', 'retry', 'claimed')),
   'queued_or_claimed_mail', (select count(*) from public.mail_outbox where state in ('queued', 'claimed')))
) as prechecks;
