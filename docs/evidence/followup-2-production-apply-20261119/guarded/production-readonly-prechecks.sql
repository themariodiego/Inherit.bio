-- Read-only pre-checks for the guarded release after the follow-up (d8dcb61a over 77d04563;
-- one SELECT, one jsonb row; writes nothing). Run AFTER the follow-up's release has read back
-- EQUAL to its batch-2 post-state and code with its migration tree is deployed, BEFORE this
-- release's dry runs.
-- Run: python3 -I ../api/api-run.py production-readonly-prechecks.sql $R/prechecks --json-column prechecks
--  (or psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f production-readonly-prechecks.sql).
-- "guards" re-runs, read-only and in this session's settings (the ones the batches restore
-- before each migration), every md5 predecessor guard of the 4 migrations: each body exists
-- before this release (production's own body, or the follow-up's consumer). A guard with an
-- ACL also needs the exact ACL text. A guard with two md5s accepts either reviewed body. Every "must_be_zero" value that is not 0 means a
-- migration guard would refuse, or a statement would fail, or a new door would fail at run
-- time, on production as it is now. "compat_must_be_zero" not 0 means the deployed code could
-- meet the behaviour change of batch 2 in the deploy window (../compat-analysis.md).
-- "definitions" shows the constraint text #1 parses. "sizes" bound validation and lock time;
-- "context" says what can wait on batch 1's lock. Expected values (the rehearsal mirror of
-- the follow-up's post-state) are in README.md, "Pre-check stop rules".
with guard(ref, fn, want_md5s, want_acl, origin) as (values
  ('#01 20261024110000_copilot_settings_delete_nonce line 35', 'public.remove_own_copilot_settings_v1(uuid,uuid)', array['f45c9a8b18e64acc5b3e13612f1d6d86']::text[], '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#01 20261024110000_copilot_settings_delete_nonce line 84 (patch 1)', 'private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)', array['933df95029c3f1f8a9a306726fccccff']::text[], '{postgres=X/postgres}', 'the follow-up''s release'),
  ('#03 20261025200000_consent_revoke_provider_nonce line 39', 'public.revoke_cloud_model_consent(uuid,uuid)', array['40b1b49d088437b24878601795a2a2e0']::text[], '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#03 20261025200000_consent_revoke_provider_nonce line 42', 'public.revoke_own_copilot_v1(uuid,uuid,uuid,jsonb)', array['931fc94abdcb0840ff7a202404c9c4fc']::text[], '{postgres=X/postgres,service_role=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#04 20261025400000_path_a_account_accept_typed_name line 53', 'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)', array['824901bf47066e4e974bd90f2b1c7110']::text[], '{postgres=X/postgres}', 'production (2026-10-22 read-back)'),
  ('#04 20261025400000_path_a_account_accept_typed_name line 64', 'private.current_adult_subject_invitation_v1(uuid,uuid)', array['7fa7e1fe73fc4db2ecf9af8a7b26d265','78d147935e25d657d8df631583c6faea']::text[], null::text, 'production (2026-10-22 read-back)'),
  ('#04 20261025400000_path_a_account_accept_typed_name line 66', 'private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)', array['db5ce99583d6e1724eae8490eec6a9ef']::text[], null::text, 'production (2026-10-22 read-back)'),
  ('#04 20261025400000_path_a_account_accept_typed_name line 67', 'private.lock_invitation_transitions_v1()', array['3a28aeaf4bf736cbba89e3b209649557']::text[], null::text, 'production (2026-10-22 read-back)'),
  ('#04 20261025400000_path_a_account_accept_typed_name line 68', 'private.declare_contact_alias_groups_v1(jsonb)', array['60f413613a40bc0186e1edfc60518863']::text[], null::text, 'production (2026-10-22 read-back)'),
  ('#04 20261025400000_path_a_account_accept_typed_name line 69', 'private.resolve_hmac_set_v1(text,text,jsonb)', array['40d84663185bb3fe5fa5b67be4b364e3']::text[], null::text, 'production (2026-10-22 read-back)'),
  ('#04 20261025400000_path_a_account_accept_typed_name line 70', 'private.presented_contact_digest_v1(jsonb,text,bigint)', array['d0fef1099b2a5f5da60b43fc93a82437']::text[], null::text, 'production (2026-10-22 read-back)')),
checked as (
 select g.ref, g.fn, g.want_md5s, g.want_acl, g.origin, p.oid is not null as present,
  md5(pg_catalog.pg_get_functiondef(p.oid)) as have_md5, p.proacl::text as acl,
  coalesce(p.oid is not null and md5(pg_catalog.pg_get_functiondef(p.oid)) = any(g.want_md5s)
   and (g.want_acl is null or p.proacl::text = g.want_acl), false) as ok
 from guard g left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(g.fn)),
col(s, t, c, ty) as (values
  ('auth', 'sessions', 'id', 'uuid'),
  ('auth', 'sessions', 'user_id', 'uuid'),
  ('auth', 'sessions', 'not_after', 'timestamp with time zone'),
  ('auth', 'users', 'id', 'uuid'),
  ('auth', 'users', 'deleted_at', 'timestamp with time zone'),
  ('public', 'consent_signatures', 'signing_name_encrypted', 'bytea')),
nonce as (
 select pg_catalog.pg_get_constraintdef(c.oid) as def from pg_catalog.pg_constraint c
 where c.conrelid = 'public.account_operation_nonces'::regclass and c.conname = 'account_operation_nonces_operation_check'),
parsed as (
 -- 20261024110000's $widen$ parse, applied to today's text
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
   'above_followup_max', count(*) filter (where version > '20261023140000'),
   'followup_versions_present', count(*) filter (where version = any(array['20261022100000','20261022110000','20261023100000','20261023110000','20261023120000','20261023130000','20261023140000']::text[])),
   'release_versions_present', count(*) filter (where version = any(array['20261024110000','20261024220000','20261025200000','20261025400000']::text[])))
   from supabase_migrations.schema_migrations),
 'guards', (select jsonb_object_agg(ref, jsonb_build_object('function', fn, 'origin', origin, 'ok', ok, 'present', present,
   'want_md5s', to_jsonb(want_md5s), 'have_md5', have_md5, 'want_acl', want_acl, 'proacl', acl)) from checked),
 'must_be_zero', jsonb_build_object(
   -- the 11 md5 predecessor guards on bodies that exist before this release
   'guarded_bodies_not_as_rehearsed', (select count(*) from checked where not ok),
   -- 20261025200000's predecessor: the consumer must name consent_revoke and keep its ACL
   'consumer_without_consent_revoke', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)')
       and pg_catalog.pg_get_functiondef(p.oid) like '%''consent_revoke''%' and p.proacl::text = '{postgres=X/postgres}')),
   -- the exact signatures the predecessor blocks require, and auth.jwt() which #2's door calls
   'prerequisite_signatures_missing', (select count(*) from unnest(array['private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)','public.remove_own_copilot_settings_v1(uuid,uuid)','public.revoke_cloud_model_consent(uuid,uuid)','public.revoke_own_copilot_v1(uuid,uuid,uuid,jsonb)','private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)','private.current_adult_subject_invitation_v1(uuid,uuid)','private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)','private.lock_invitation_transitions_v1()','private.declare_contact_alias_groups_v1(jsonb)','private.resolve_hmac_set_v1(text,text,jsonb)','private.presented_contact_digest_v1(jsonb,text,bigint)','auth.jwt()']::text[]) s where pg_catalog.to_regprocedure(s) is null),
   -- every existing function (by name) and relation the 4 files name: 11 functions, 6 relations
   'prerequisite_functions_missing', (select count(*) from unnest(array['private.adult_subject_invitation_response_v1','private.consume_account_operation_nonce_v1','private.consume_embryo_operation_nonce_v1','private.current_adult_subject_invitation_v1','private.declare_contact_alias_groups_v1','private.lock_invitation_transitions_v1','private.presented_contact_digest_v1','private.resolve_hmac_set_v1','public.remove_own_copilot_settings_v1','public.revoke_cloud_model_consent','public.revoke_own_copilot_v1']::text[]) f
     where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'prerequisite_relations_missing', (select count(*) from unnest(array['auth.sessions','auth.users','public.account_operation_nonces','public.consent_signatures','public.rights_sessions','public.subject_invitations']::text[]) r where pg_catalog.to_regclass(r) is null),
   -- columns the new doors read at run time, with their types
   'prerequisite_columns_missing', (select count(*) from col where not exists (select 1 from information_schema.columns i
     where i.table_schema = col.s and i.table_name = col.t and i.column_name = col.c and i.data_type = col.ty)),
   -- every migration revokes from these roles; a missing role fails the statement
   'roles_missing', (select count(*) from unnest(array['anon','authenticated','inherit_upload_only','service_role']::text[]) r where not exists (select 1 from pg_catalog.pg_roles where rolname = r)),
   -- every function the release creates (6) and its one table
   'release_functions_present', (select count(*) from unnest(array['private.accept_adult_subject_invitation_v1','public.accept_adult_subject_invitation_v1','public.consume_session_csrf_v1','public.remove_own_copilot_settings_with_nonce_v1','public.revoke_cloud_model_consent_with_nonce_v1','public.revoke_own_copilot_with_nonce_v1']::text[]) f
     where exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'release_relations_present', (select count(*) from (select 1) x where pg_catalog.to_regclass('private.session_csrf_token_uses') is not null),
   -- 20261024110000's $widen$ refuses unless the check holds subject_download_open (the
   -- follow-up's 130000 adds it) and refuses if it already holds provider_setting_delete
   'nonce_check_without_subject_download_open', (select count(*) from (select 1) x where not exists (select 1 from parsed where v = 'subject_download_open')),
   'nonce_check_with_provider_setting_delete', (select count(*) from parsed where v = 'provider_setting_delete'),
   -- a value the $widen$ parse would not read would be dropped silently by the rebuild
   'nonce_check_values_not_parsed', (select count(*) from literals l where not exists (select 1 from parsed p where p.v = l.v))),
 'compat_must_be_zero', jsonb_build_object(
   -- Batch 2 (#4): the deployed code's Path A confirmation (api.withdraw, through
   -- respond_adult_subject_invitation_session_v1) answers 404 from batch 2's commit until the
   -- new code is deployed. It is reachable only through a pending, unexpired adult invitation
   -- and its active rights session; the deployed code cannot create one in production
   -- (third_party_adult_analysis is unreviewed for every real jurisdiction).
   'pending_adult_invitations', (select count(*) from public.subject_invitations
     where invitation_kind = 'adult_subject' and status = 'pending' and expires_at > clock_timestamp()),
   'active_adult_invitation_rights_sessions', (select count(*) from public.rights_sessions
     where purpose = 'adult-subject-invitation' and status = 'active' and expires_at > clock_timestamp())),
 'definitions', jsonb_build_object(
   'account_operation_nonces_operation_check', (select def from nonce),
   'parsed_like_110000', (select to_jsonb(array_agg(v order by v)) from parsed),
   'literal_count', (select count(*) from literals)),
 'sizes', jsonb_build_object(
   'account_operation_nonces', (select count(*) from public.account_operation_nonces),
   'consent_signatures', (select count(*) from public.consent_signatures),
   'subject_invitations', (select count(*) from public.subject_invitations),
   'rights_sessions', (select count(*) from public.rights_sessions)),
 'context', jsonb_build_object(
   'unconsumed_account_operation_nonces', (select count(*) from public.account_operation_nonces
     where consumed_at is null and expires_at > now()))
) as prechecks;
