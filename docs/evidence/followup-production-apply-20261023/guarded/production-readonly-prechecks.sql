-- Read-only pre-checks for the guarded follow-up release (77d04563 over PR 324; one SELECT,
-- one jsonb row; writes nothing). Run AFTER PR 324's release has read back EQUAL to its
-- batch-4 post-state, BEFORE this release's dry runs.
-- Run: python3 -I ../api/api-run.py production-readonly-prechecks.sql $R/prechecks --json-column prechecks
--  (or psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f production-readonly-prechecks.sql).
-- "guards" re-runs, read-only and in this session's settings (the ones the batches restore
-- before each migration), every md5 predecessor guard of the 7 migrations whose body exists
-- before this release: production's own body, or the one PR 324's release writes. An
-- md5(pg_get_functiondef) guard also needs the exact ACL text; 20261022100000's guard also needs
-- security definer, volatile and search_path=pg_catalog. Every "must_be_zero" value that is not 0
-- means a migration guard would refuse, or a statement would fail, on production as it is now.
-- "compat_must_be_zero" not 0 means PR 324's deployed code would read something new in the
-- deploy window (../compat-analysis.md). "definitions" shows the constraint text #5 and #6 parse.
-- "sizes" bound validation and lock time; "context" says whether the TEST-only items can occur.
-- Expected values (the rehearsal mirror of PR 324's post-state) are in README.md,
-- "Pre-check stop rules".
with guard(ref, fn, kind, want_md5, want_acl, want_secdef, want_volatile, want_config, origin) as (values
  ('#01 20261022100000_neanderthal_ancestry_content line 96', 'private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)', 'prosrc', '901478e0f2a5123e13d72b1cbbb47e08', null::text, true, 'v', array['search_path=pg_catalog']::text[], 'production'),
  ('#02 20261022110000_read_called_input_provenance line 55', 'private.read_own_input_sources_v1(uuid,uuid,uuid,uuid[],text)', 'prosrc', '5f6d4777cf080f59ffa0d7d5e888fc8b', null::text, null::boolean, null::text, null::text[], 'production'),
  ('#03 20261023100000_subject_export_joint_results line 163 (patch 1)', 'private.export_subject_joint_results_v1(uuid)', 'def', '767354cddd9908bebbf8e244a0dedb76', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#03 20261023100000_subject_export_joint_results line 174 (patch 2)', 'private.export_subject_class_inventory_v1(uuid,jsonb)', 'def', 'ee769c5811458dfb4031f2c464c5256f', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#03 20261023100000_subject_export_joint_results line 190 (patch 3)', 'private.export_account_owned_capture_pre_requester_v1(jsonb,text,uuid)', 'def', 'ca9b6bcefc719018f196f0d4f8e4e73f', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#03 20261023100000_subject_export_joint_results line 195 (patch 4)', 'public.export_archive_account_classes_v1(text,uuid,uuid,text,text,uuid)', 'def', '42f4a34ba7a127e89130617a4a005a35', '{postgres=X/postgres,service_role=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#04 20261023110000_export_completeness line 199 (patch 2)', 'private.export_subject_scope_v1(jsonb,uuid)', 'def', 'fe31c38687c4f5dba894d687c7e72d5c', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#04 20261023110000_export_completeness line 205 (patch 3)', 'private.export_subject_graph_capture_v1(uuid,jsonb)', 'def', '23a4c87eb5002d72e9816009021079bd', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#04 20261023110000_export_completeness line 214 (patch 4)', 'private.export_subject_graph_projection_v1(uuid,uuid[],text)', 'def', 'b3d75d95193c0c6a752ba21ba23155e0', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#04 20261023110000_export_completeness line 226 (patch 5)', 'private.export_subject_history_projection_v1(uuid,uuid[],text)', 'def', '59bb66b368b8769f0e4de3bc7cf87003', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#04 20261023110000_export_completeness line 261 (patch 9)', 'public.export_archive_account_content_v1(text,uuid,uuid,text,jsonb)', 'def', '25ab819a16105020897e9c0cf7e1fef1', '{postgres=X/postgres,service_role=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#04 20261023110000_export_completeness line 289 (patch 11)', 'private.export_account_owned_capture_pre_member_frame_v1(jsonb,text,uuid)', 'def', '65c53bbe4787500a69c764f2bd50951f', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#04 20261023110000_export_completeness line 312 (patch 12)', 'private.export_account_graph_capture_v1(uuid,jsonb)', 'def', '26513cf7d20ed98f3fb4316283a96e14', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'production'),
  ('#04 20261023110000_export_completeness line 325 (patch 13)', 'private.account_archive_complete_class_rows_v1(jsonb,jsonb,jsonb,text)', 'def', 'bf340049d6858f1f7f8c6b21f0886bd7', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'production'),
  ('#05 20261023120000_legal_audit_attribution_completeness line 240 (patch 1)', 'private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)', 'def', '9539afdc5057346d44c1b8cd826b7ee2', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#05 20261023120000_legal_audit_attribution_completeness line 246 (patch 2)', 'private.legal_audit_person_event_v1(text,text)', 'def', 'b566386791e9736ef744924a2d4d3039', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'production'),
  ('#06 20261023130000_legal_audit_attribution_remaining line 169 (patch 2)', 'public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)', 'def', 'a7375f589e70ff54ced2b5b1d34b69cd', '{postgres=X/postgres,service_role=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#06 20261023130000_legal_audit_attribution_remaining line 86', 'private.adult_subject_control_v1(text,text,text,text,boolean)', 'def', 'f6201a3830d82dcd8a95d2b8487b59ad', '{postgres=X/postgres}', null::boolean, null::text, null::text[], 'PR 324'),
  ('#07 20261023140000_review_download_clock line 26 (patch 1)', 'public.open_permission_review_download_v1(uuid,text)', 'def', '243f68d2eabb8a27013df14d87cddb6b', '{postgres=X/postgres,authenticated=X/postgres}', null::boolean, null::text, null::text[], 'PR 324')),
guards as (
 select g.ref, g.fn, g.kind, g.want_md5, g.origin, p.oid is not null as present,
  case g.kind when 'prosrc' then md5(p.prosrc) else md5(pg_catalog.pg_get_functiondef(p.oid)) end as have_md5,
  p.proacl::text as acl, p.prosecdef, p.provolatile::text as volatile, p.proconfig
 from guard g left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(g.fn)),
checked as (
 select x.*, coalesce(x.present and x.have_md5 = g.want_md5
   and (g.want_acl is null or x.acl = g.want_acl)
   and (g.want_secdef is null or x.prosecdef = g.want_secdef)
   and (g.want_volatile is null or x.volatile = g.want_volatile)
   and (g.want_config is null or x.proconfig = g.want_config), false) as ok, g.want_acl
 from guards x join guard g on g.ref = x.ref),
nonce as (
 select pg_catalog.pg_get_constraintdef(c.oid) as def from pg_catalog.pg_constraint c
 where c.conrelid = 'public.account_operation_nonces'::regclass and c.conname = 'account_operation_nonces_operation_check'),
parsed as (
 -- 20261023120000's $widen$ parse (20261023130000 reads the same way), applied to today's text
 select m[1] v from nonce, regexp_matches(def, '''([a-z_]+)''::text', 'g') m
 union all
 select unnest(string_to_array((regexp_match(def, '''\{([a-z_,]+)\}''::text\[\]'))[1], ',')) from nonce),
literals as (
 -- every quoted literal the check holds, in either rendering, parsed or not
 select x[1] v from nonce, regexp_matches(def, '''([^'']*)''::text(?!\[)', 'g') x
 union all
 select unnest(string_to_array((regexp_match(def, '''\{([^}'']*)\}''::text\[\]'))[1], ',')) from nonce)
select jsonb_build_object(
 'session', jsonb_build_object(
   'current_user', current_user,
   'statement_timeout', current_setting('statement_timeout'),
   'lock_timeout', current_setting('lock_timeout'),
   'search_path', current_setting('search_path'),
   'server_version', current_setting('server_version')),
 'ledger', (select jsonb_build_object('count', count(*), 'max', max(version),
   'above_pr324_max', count(*) filter (where version > '20261016221000'),
   'pr324_versions_present', count(*) filter (where version = any(array['20261016120000','20261016151200','20261016153100','20261016170000','20261016175000','20261016180000','20261016181000','20261016190000','20261016191000','20261016195000','20261016196000','20261016200000','20261016201000','20261016202000','20261016203000','20261016204000','20261016205000','20261016206000','20261016207000','20261016208000','20261016210000','20261016211000','20261016212000','20261016220000','20261016221000']::text[])),
   'release_versions_present', count(*) filter (where version = any(array['20261022100000','20261022110000','20261023100000','20261023110000','20261023120000','20261023130000','20261023140000']::text[])))
   from supabase_migrations.schema_migrations),
 'guards', (select jsonb_object_agg(ref, jsonb_build_object('function', fn, 'kind', kind, 'origin', origin, 'ok', ok,
   'present', present, 'want_md5', want_md5, 'have_md5', have_md5, 'want_acl', want_acl, 'proacl', acl,
   'prosecdef', prosecdef, 'provolatile', volatile, 'proconfig', to_jsonb(proconfig))) from checked),
 'must_be_zero', jsonb_build_object(
   -- the 19 md5 predecessor guards on bodies that exist before this release (with their extra predicates)
   'guarded_bodies_not_as_rehearsed', (select count(*) from checked where not ok),
   -- the exact signatures the predecessor blocks of #1, #5 and #6 require
   'prerequisite_signatures_missing', (select count(*) from unnest(array['private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)','private.validate_own_ancestry_content_v3(jsonb,uuid,uuid,jsonb,text)','private.note_legal_audit_actor_from_nonce_v1()','private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)','private.legal_audit_person_event_v1(text,text)','private.adult_subject_control_v1(text,text,text,text,boolean)','public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)','public.create_path_b_adult_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)','public.create_path_b_reviewed_document_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)','public.open_subject_original_download_v1(uuid,uuid,uuid,uuid,text)']::text[]) s where pg_catalog.to_regprocedure(s) is null),
   -- every existing function (by name) and relation the 7 files name: 44 functions, 22 relations
   'prerequisite_functions_missing', (select count(*) from unnest(array['extensions.digest','private.account_archive_complete_class_rows_v1','private.adult_subject_control_v1','private.export_account_door_scope_v1','private.export_account_graph_capture_v1','private.export_account_graph_projection_v1','private.export_account_owned_capture_pre_member_frame_v1','private.export_account_owned_capture_pre_requester_v1','private.export_scoped_class_projection_v1','private.export_subject_class_inventory_v1','private.export_subject_cohort_role_v1','private.export_subject_graph_capture_v1','private.export_subject_graph_projection_v1','private.export_subject_history_projection_v1','private.export_subject_joint_results_v1','private.export_subject_ordinary_target_v1','private.export_subject_scope_v1','private.family_copilot_prune_v1','private.family_copilot_turn_state_v1','private.family_portrait_authority_v1','private.legal_audit_person_event_v1','private.note_legal_audit_actor_from_nonce_v1','private.own_export_source_v1','private.read_own_input_sources_v1','private.record_subject_operation_nonce_v1','private.valid_family_copilot_citations_v1','private.validate_own_ancestry_content_v1','private.validate_own_ancestry_content_v3','public.acknowledge_portrait_v1','public.bind_adult_subject_account_v1','public.create_adult_subject_invitation_v1','public.create_path_b_adult_draft_v1','public.create_path_b_reviewed_document_draft_v1','public.declare_chromosomal_sex_v1','public.declare_jurisdiction_v2','public.export_archive_account_classes_v1','public.export_archive_account_content_v1','public.export_archive_content_v1','public.open_permission_review_download_v1','public.open_subject_original_download_v1','public.pause_family_sharing_v1','public.resume_family_sharing_v1','public.revoke_directional_purpose_v1','public.stop_family_sharing_v1']::text[]) f
     where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'prerequisite_relations_missing', (select count(*) from unnest(array['auth.sessions','private.permission_document_review_downloads','private.permission_documents','public.account_operation_nonces','public.ancestry_regions','public.attestation_contradictions','public.chat_messages','public.chats','public.embryo_cohorts','public.embryo_donor_attributions','public.embryo_operation_nonces','public.embryo_participant_sets','public.embryos','public.family_pairs','public.portrait_results','public.profiles','public.purpose_grant_nonces','public.report_artifacts','public.subject_control_refusal_authorities','public.subject_principals','public.subjects','public.suppressions']::text[]) r where pg_catalog.to_regclass(r) is null),
   -- 20261023130000: its predecessor needs this trigger of PR 324's release
   'embryo_nonce_actor_trigger_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.embryo_operation_nonces'::regclass and tgname = 'legal_audit_actor_on_consume')),
   -- every function the release creates (20, and the one #3 creates and #4 drops), and #5's trigger
   'release_functions_present', (select count(*) from unnest(array['private.adult_subject_control_for_account_v1','private.consume_account_operation_nonce_v1','private.export_scoped_class_rows_v1','private.export_subject_family_conversation_v1','private.export_subject_family_turn_capture_v1','private.export_subject_family_turn_rows_v1','private.export_subject_portrait_rows_v1','public.acknowledge_portrait_with_nonce_v1','public.create_adult_subject_invitation_with_nonce_v1','public.create_path_b_adult_draft_with_nonce_v1','public.create_path_b_reviewed_document_draft_with_nonce_v1','public.declare_chromosomal_sex_with_nonce_v1','public.declare_jurisdiction_with_nonce_v1','public.open_subject_original_download_with_nonce_v1','public.own_export_writerless_rows_v1','public.pause_family_sharing_with_nonce_v1','public.pause_subject_sharing_v1','public.resume_family_sharing_with_nonce_v1','public.resume_subject_sharing_v1','public.revoke_directional_purpose_with_nonce_v1','public.stop_family_sharing_with_nonce_v1']::text[]) f
     where exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'release_trigger_present', (select count(*) from pg_catalog.pg_trigger
     where tgrelid = 'public.account_operation_nonces'::regclass and tgname = 'legal_audit_actor_on_consumed_insert'),
   -- 20261023120000's $widen$ refuses unless the check holds subject_transfer (PR 324's 221000 adds it)
   'nonce_check_without_subject_transfer', (select count(*) from (select 1) x where not exists (select 1 from parsed where v = 'subject_transfer')),
   -- a value the $widen$ parse would not read would be dropped silently by the rebuild
   'nonce_check_values_not_parsed', (select count(*) from literals l where not exists (select 1 from parsed p where p.v = l.v))),
 'compat_must_be_zero', jsonb_build_object(
   -- 20261022110000 projects readCalls into the own-source snapshot, which PR 324's strict parser
   -- (src/lib/genome/canonical-input-sources.ts) refuses; PR 324's code never writes it
   'normalization_runs_with_read_calls', (select count(*) from private.own_normalization_runs where provenance ? 'readCalls')),
 'definitions', jsonb_build_object(
   'account_operation_nonces_operation_check', (select def from nonce),
   'parsed_like_120000', (select to_jsonb(array_agg(v order by v)) from parsed),
   'literal_count', (select count(*) from literals)),
 'sizes', jsonb_build_object(
   'account_operation_nonces', (select count(*) from public.account_operation_nonces),
   'portrait_results', (select count(*) from public.portrait_results),
   'chats', (select count(*) from public.chats),
   'chat_messages', (select count(*) from public.chat_messages),
   'family_pairs', (select count(*) from public.family_pairs),
   'embryo_cohorts', (select count(*) from public.embryo_cohorts),
   'own_normalization_runs', (select count(*) from private.own_normalization_runs),
   'permission_documents', (select count(*) from private.permission_documents),
   'subjects', (select count(*) from public.subjects)),
 'context', jsonb_build_object(
   'account_archive_r2_enabled', (select coalesce(bool_or(enabled), false) from private.account_archive_r2_configuration),
   'export_archive_jobs', (select count(*) from private.export_archive_jobs),
   'generated_exports_open', (select count(*) from public.generated_exports where status in ('queued', 'building', 'ready')),
   'family_conversations', (select count(*) from public.chats where scope_kind = 'family' and legacy_unverified is false),
   'pair_anchored_family_conversations', (select count(*) from public.chats where scope_kind = 'family'
     and family_pair_id is not null and legacy_unverified is false),
   'permission_review_downloads', (select count(*) from private.permission_document_review_downloads),
   'unconsumed_account_operation_nonces', (select count(*) from public.account_operation_nonces
     where consumed_at is null and expires_at > now()))
) as prechecks;
