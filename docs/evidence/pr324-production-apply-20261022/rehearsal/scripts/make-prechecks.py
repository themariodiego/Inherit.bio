"""Write the kit's production-readonly-prechecks.sql from the step analysis.

    python3 -I make-prechecks.py <out.sql>

Inputs (scratch, LOCAL ONLY): steps/steps.json (guard map), steps/funcs-00.json
(the mirror's pre-state = production's 2026-10-22 state), defs/new-objects.json.
"""
import json
import os
import sys

S = '/tmp/claude-0/-home-user-Inherit-bio/6541a88f-5423-5787-89b6-a4effe2d1864/scratchpad/rel324'
steps = json.load(open(f'{S}/steps/steps.json'))
pre = json.load(open(f'{S}/steps/funcs-00.json'))
new = json.load(open(f'{S}/defs/new-objects.json'))
main = set(os.listdir(f'{S}/src/main-supabase/migrations'))
files = sorted(f for f in os.listdir(f'{S}/src/head-supabase/migrations') if f not in main)
versions = [f[:14] for f in files]


def lit(s):
    return "'" + s.replace("'", "''") + "'"


def arr(xs):
    return 'array[' + ','.join(lit(x) for x in xs) + ']::text[]'


# What each production-predecessor guard checks besides md5(prosrc), read from the migration text.
EXTRA = {
    ('20261016153100', 25): dict(secdef=True, config=['search_path=""'], acl=['postgres=X/postgres', 'service_role=X/postgres'],
                                 owner='postgres', lang='plpgsql'),
    ('20261016181000', 43): dict(secdef=True, config=['search_path=""']),
    ('20261016221000', 264): dict(secdef=False, config=['search_path=pg_catalog']),
}
SIG = {  # regprocedure text for to_regprocedure
    'private.confirm_claim_document_objects_deleted_v1': 'private.confirm_claim_document_objects_deleted_v1(text[],text)',
    'private.queue_future_person_release_v1': 'private.queue_future_person_release_v1(uuid,uuid,bytea,jsonb)',
    'private.purge_future_person_contact_phase_v1': 'private.purge_future_person_contact_phase_v1(uuid,timestamptz)',
    'private.prepare_genome_file_deletion_body_v1': 'private.prepare_genome_file_deletion_body_v1(uuid,uuid)',
    'private.embryo_call_value_hash_v1': 'private.embryo_call_value_hash_v1(integer,bigint,text,text,text)',
    'private.other_adult_mitigation_before_public_appeal_v1': 'private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)',
    'public.activate_rights_session_v1': 'public.activate_rights_session_v1(text,text,text)',
    'private.guard_structural_file_identity_v1': 'private.guard_structural_file_identity_v1()',
    'private.end_path_b_normalized_revision_v1': 'private.end_path_b_normalized_revision_v1()',
    'private.path_b_result_read_v1': 'private.path_b_result_read_v1(uuid,uuid,text)',
    'private.path_b_report_results_v1': 'private.path_b_report_results_v1(uuid,uuid,uuid,text,boolean)',
    'private.path_b_report_read_ready_v1': 'private.path_b_report_read_ready_v1(uuid,uuid,text)',
}
rows = []
for s in steps:
    for g in s['guards']:
        if g['role'] != 'predecessor' or g['origin'] != ['production']:
            continue
        fn = g['functions'][0]
        sig = SIG[fn.split('(')[0]]
        assert pre[fn]['md5'] == g['md5'], fn
        e = EXTRA.get((s['file'][:14], g['line']), {})
        ref = f"#{s['index']:02d} {s['file'][:-4]} line {g['line']}"
        rows.append((ref, sig, g['md5'], e))
assert len(rows) == 12, len(rows)


def opt_bool(v):
    return 'null::boolean' if v is None else ('true' if v else 'false')


def opt_arr(v):
    return 'null::text[]' if v is None else arr(v)


def opt_text(v):
    return 'null::text' if v is None else lit(v)


values = ',\n  '.join(
    f"({lit(ref)}, {lit(sig)}, {lit(md5)}, {opt_bool(e.get('secdef'))}, {opt_arr(e.get('config'))}, "
    f"{opt_arr(e.get('acl'))}, {opt_text(e.get('owner'))}, {opt_text(e.get('lang'))})"
    for ref, sig, md5, e in rows)

nf = ',\n   '.join(f"({lit(a)},{lit(b)})" for a, b in new['functions'])
nt = ','.join(lit(f'{a}.{b}') for a, b in new['tables'])
nc = ',\n   '.join(f"({lit(t[0] + '.' + t[1])},{lit(c)})" for t, c in new['columns'])
ncon = ',\n   '.join(f"({lit(t[0] + '.' + t[1])},{lit(c)})" for t, c in new['constraints'])
ntrg = ',\n   '.join(f"({lit(t[0] + '.' + t[1])},{lit(c)})" for t, c in new['triggers'])
nidx = ','.join(lit(f'{t[0]}.{c}') for t, c in new['indexes'])
vlist = ','.join(lit(v) for v in versions)
# Prerequisites ("... prerequisite missing" guards) that production must already hold.
pre_rows = sorted({tuple(l.rstrip('\n').split('\t')[1:3]) for l in open(f'{S}/defs/prereqs-state.tsv')
                   if l.rstrip('\n').split('\t')[3] == 't'})
assert len(pre_rows) == 67, len(pre_rows)
npre = ',\n   '.join(f"({lit(k)},{lit(n)})" for k, n in pre_rows)

sql = f"""-- Read-only pre-checks for the guarded PR 324 release (one SELECT, one jsonb row; writes nothing).
-- Run: python3 -I ../api/api-run.py production-readonly-prechecks.sql $R/prechecks --json-column prechecks
--  (or psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -f production-readonly-prechecks.sql).
-- Every "must_be_zero" value that is not 0 means a migration guard would refuse, or a statement would
-- fail, on production as it is now (the dry runs would then fail too). "guards" re-runs, read-only,
-- every md5(prosrc) predecessor guard of the 25 migrations whose body production already holds,
-- with the extra predicates that guard checks; "definitions" shows the constraint text the
-- definition-reading guards and rebuilds parse. "registry_md5" equal to the mirror's means the
-- registry rows the guards read are exactly the rehearsed ones. "sizes" bound validation and lock
-- time; "context" decides whether the conditional deploy-window items in ../compat-analysis.md
-- can occur. Expected values (rehearsal mirror = production's 2026-10-22 read-back) are in
-- README.md, "Pre-check stop rules".
with guard(ref, fn, want_md5, want_secdef, want_config, want_acl, want_owner, want_lang) as (values
  {values}),
guards as (
 select g.ref, g.fn, g.want_md5, p.oid is not null as present, md5(p.prosrc) as have_md5,
  p.prosecdef, p.proconfig, p.proacl::text[] as acl, pg_catalog.pg_get_userbyid(p.proowner) as owner, l.lanname,
  coalesce(p.oid is not null and md5(p.prosrc) = g.want_md5
   and (g.want_secdef is null or p.prosecdef = g.want_secdef)
   and (g.want_config is null or p.proconfig = g.want_config)
   and (g.want_acl is null or p.proacl::text[] = g.want_acl)
   and (g.want_owner is null or pg_catalog.pg_get_userbyid(p.proowner) = g.want_owner)
   and (g.want_lang is null or l.lanname = g.want_lang), false) as ok
 from guard g
 left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(g.fn)
 left join pg_catalog.pg_language l on l.oid = p.prolang),
new_functions(nsp, name) as (values
   {nf}),
new_columns(rel, col) as (values
   {nc}),
new_constraints(rel, con) as (values
   {ncon}),
new_triggers(rel, trg) as (values
   {ntrg}),
prerequisites(kind, name) as (values
   {npre}),
nonce as (
 select pg_catalog.pg_get_constraintdef(c.oid) as def from pg_catalog.pg_constraint c
 where c.conrelid = 'public.account_operation_nonces'::regclass and c.conname = 'account_operation_nonces_operation_check'),
required_registry_rows as (
 -- 20261016153100, 20261016170000 and 20261016175000 predecessors
 select (select count(*) from public.retention_phase_registry where retention_id = 'future-person.claimant-reverification-until-request'
    and phase_id = 'future-person-claimed-source-disposal' and phase_kind = 'purge')
  + (select count(*) from public.retention_phase_registry where retention_id = 'adult.non-account-holder-24mo'
    and phase_id = 'adult-non-account-holder-expiry' and phase_kind = 'compound-atomic')
  + (select count(*) from public.retention_registry where retention_id = 'adult.non-account-holder-24mo'
    and execution_class = 'scheduledDuePhase')
  + (select count(*) from public.retention_phase_registry where retention_id = 'future-person.claimed-unbound-24mo'
    and phase_id = 'claimed-unbound-working-data-purge' and phase_kind = 'purge')
  -- 20261016201000, 202000, 203000, 206000, 207000 predecessors
  + (select count(*) from private.rights_purpose_matrix where (purpose, action, route_id) in (
     ('embryo-record-key-card-delivery', 'deliver-record-key-cards', 'api.embryo-record-key-cards-rights'),
     ('adult-subject-control', 'revoke-purpose', 'api.consent-revoke-rights'),
     ('adult-subject-control', 'grant-purpose', 'api.consent-grant-rights'),
     ('consent-reaffirm', 'reaffirm', 'api.consent-reaffirm-rights'),
     ('adult-subject-control', 'bind-account', 'api.adult-subject-bind'))) as n)
select jsonb_build_object(
 'session', jsonb_build_object(
   'current_user', current_user,
   'statement_timeout', current_setting('statement_timeout'),
   'lock_timeout', current_setting('lock_timeout'),
   'search_path', current_setting('search_path'),
   'server_version', current_setting('server_version'),
   'supautils_policy_grants_lists_auth_users',
     coalesce(current_setting('supautils.policy_grants', true), '') like '%auth.users%',
   'supautils_drop_trigger_grants_lists_auth_users',
     coalesce(current_setting('supautils.drop_trigger_grants', true), '') like '%auth.users%'),
 'ledger', (select jsonb_build_object('count', count(*), 'max', max(version),
   'above_main_max', count(*) filter (where version > '20261011010251'),
   'release_versions_present', count(*) filter (where version in ({vlist})))
   from supabase_migrations.schema_migrations),
 'guards', (select jsonb_object_agg(ref, jsonb_build_object('function', fn, 'ok', ok, 'present', present,
   'want_md5', want_md5, 'have_md5', have_md5, 'prosecdef', prosecdef, 'proconfig', to_jsonb(proconfig),
   'proacl', to_jsonb(acl), 'owner', owner, 'language', lanname)) from guards),
 'must_be_zero', jsonb_build_object(
   -- the 67 existing functions and tables the "prerequisite missing" guards require
   'prerequisites_missing', (select count(*) from prerequisites where case kind
     when 'to_regprocedure' then pg_catalog.to_regprocedure(name) is null else pg_catalog.to_regclass(name) is null end),
   -- the 12 md5(prosrc) predecessor guards on bodies production holds now (with their extra predicates)
   'guarded_bodies_not_as_rehearsed', (select count(*) from guards where not ok),
   -- every "successor already exists" guard, and every ADD COLUMN / ADD CONSTRAINT / CREATE TRIGGER / CREATE TABLE
   'release_functions_present', (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     join new_functions f on f.nsp = n.nspname and f.name = p.proname),
   'release_tables_present', (select count(*) from unnest(array[{nt}]) t where pg_catalog.to_regclass(t) is not null),
   'release_columns_present', (select count(*) from new_columns c join pg_catalog.pg_attribute a
     on a.attrelid = pg_catalog.to_regclass(c.rel) and a.attname = c.col and not a.attisdropped),
   'release_constraints_present', (select count(*) from new_constraints c join pg_catalog.pg_constraint k
     on k.conrelid = pg_catalog.to_regclass(c.rel) and k.conname = c.con),
   'release_triggers_present', (select count(*) from new_triggers t join pg_catalog.pg_trigger g
     on g.tgrelid = pg_catalog.to_regclass(t.rel) and g.tgname = t.trg),
   'release_indexes_present', (select count(*) from unnest(array[{nidx}]) i where pg_catalog.to_regclass(i) is not null),
   'release_sequence_present', (select count(*) from unnest(array['private.subject_ownership_transfers_transfer_revision_seq']) s
     where pg_catalog.to_regclass(s) is not null),
   -- 20261016190000: the bucket is inserted (or must already be identical) and no Storage policy may name it
   'legal_evidence_bucket_present', (select count(*) from storage.buckets where id = 'legal-evidence'),
   'legal_evidence_storage_policies', (select count(*) from pg_catalog.pg_policies where schemaname = 'storage'
     and tablename = 'objects' and (qual like '%legal-evidence%' or with_check like '%legal-evidence%')),
   -- 20261016175000: refuses while a claimant contact clock runs (no deadline is rewritten)
   'claimed_unbound_24mo_clocks_running', (select count(*) from public.retention_rows
     where retention_id = 'future-person.claimed-unbound-24mo' and state in ('scheduled', 'active')),
   -- 20261016206000: refuses if the consent-reaffirm issuer is already registered
   'consent_reaffirm_session_purpose_present', (select count(*) from private.rights_session_purposes
     where session_purpose = 'consent-reaffirm'),
   -- 20261016153100, 170000, 175000, 201000, 202000, 203000, 206000, 207000: 9 registry rows must exist
   'required_registry_rows_missing', (select 9 - n from required_registry_rows),
   -- 20261016191000: download_sessions_subject_original_shape is validated on ADD
   'subject_original_download_sessions', (select count(*) from public.download_sessions where purpose = 'subject-original-download'),
   -- 20261016180000: its predecessor reads this constraint's text
   'nonce_check_without_other_adult_upload_artifact_sign', (select count(*) from (select 1) x
     where not exists (select 1 from nonce where def like '%other_adult_upload_artifact_sign%')),
   -- 20261016181000 re-adds the check with 7 literal values: rows outside them would fail validation
   'nonces_outside_subject_delete_list', (select count(*) from public.account_operation_nonces where operation not in
     ('account_delete','account_delete_cancel','own_upload_artifact_sign','own_account_completion',
      'other_adult_upload_artifact_sign','subject_sharing_stop','subject_delete')),
   -- 20261016210000: its predecessor compares this constraint's text exactly
   'correction_decision_check_not_exact', (select count(*) from (select 1) x where not exists (
     select 1 from pg_catalog.pg_constraint where conrelid = 'public.correction_assignments'::regclass
      and pg_catalog.pg_get_constraintdef(oid) = 'CHECK ((decision = ANY (ARRAY[''approve''::text, ''reject''::text, ''close''::text])))')),
   -- 20261016220000 needs path-b-reviewed-document in this check; only 20261016190000 may add it
   'adult_flow_check_already_has_reviewed_document', (select count(*) from pg_catalog.pg_constraint
     where conname = 'adult_subject_drafts_adult_flow_check' and pg_catalog.pg_get_constraintdef(oid) like '%path-b-reviewed-document%')),
 'definitions', jsonb_build_object(
   'account_operation_nonces_operation_check', (select def from nonce),
   -- the two parses of 20261016200000 ($widen$) and 20261016221000 ($widen$), applied to today's text
   'parsed_like_200000', (select to_jsonb(array_agg(m[1] order by m[1])) from nonce, regexp_matches(def, '''([a-z_]+)''::text', 'g') m),
   'parsed_like_221000', (select to_jsonb(array_agg(v order by v)) from (
     select m[1] v from nonce, regexp_matches(def, '''([a-z_]+)''::text', 'g') m
     union all
     select unnest(string_to_array((regexp_match(def, '''\\{{([a-z_,]+)\\}}''::text\\[\\]'))[1], ',')) from nonce) s),
   'correction_assignments_decision_check', (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
     where conrelid = 'public.correction_assignments'::regclass and conname = 'correction_assignments_decision_check'),
   'adult_subject_drafts_adult_flow_check', (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
     where conname = 'adult_subject_drafts_adult_flow_check'),
   'other_adult_held_uploads_state_check', (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
     where conrelid = 'public.other_adult_held_uploads'::regclass and conname = 'other_adult_held_uploads_state_check'),
   'subjects_self_or_claimant_owner_shape', (select pg_catalog.pg_get_constraintdef(oid) from pg_catalog.pg_constraint
     where conrelid = 'public.subjects'::regclass and conname = 'subjects_self_or_claimant_owner_shape')),
 'registry_md5', jsonb_build_object(
   'purge_target_stores', (select md5(string_agg(target_id || '|' || store_name || '|' || store_order, ',' order by target_id collate "C", store_name collate "C")) from public.purge_target_stores),
   'purge_targets', (select md5(string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text collate "C")) from public.purge_targets t),
   'retention_phase_registry', (select md5(string_agg(to_jsonb(r)::text, ',' order by to_jsonb(r)::text collate "C")) from public.retention_phase_registry r),
   'retention_registry', (select md5(string_agg(to_jsonb(r)::text, ',' order by to_jsonb(r)::text collate "C")) from public.retention_registry r),
   'rights_purpose_matrix', (select md5(string_agg(to_jsonb(r)::text, ',' order by to_jsonb(r)::text collate "C")) from private.rights_purpose_matrix r),
   'rights_session_purposes', (select md5(string_agg(to_jsonb(r)::text, ',' order by to_jsonb(r)::text collate "C")) from private.rights_session_purposes r)),
 'sizes', jsonb_build_object(
   'subjects', (select count(*) from public.subjects),
   'genome_files', (select count(*) from public.genome_files),
   'download_sessions', (select count(*) from public.download_sessions),
   'account_operation_nonces', (select count(*) from public.account_operation_nonces),
   'adult_subject_drafts', (select count(*) from public.adult_subject_drafts),
   'other_adult_held_uploads', (select count(*) from public.other_adult_held_uploads),
   'embryo_ingest_sessions', (select count(*) from public.embryo_ingest_sessions),
   'embryo_mapping_challenges', (select count(*) from public.embryo_mapping_challenges),
   'embryo_split_variants', (select count(*) from private.embryo_split_variants),
   'correction_assignments', (select count(*) from public.correction_assignments),
   'user_variants', (select count(*) from public.user_variants)),
 'context', jsonb_build_object(
   'account_archive_r2_enabled', (select coalesce(bool_or(enabled), false) from private.account_archive_r2_configuration),
   'embryo_split_enabled', (select coalesce(bool_or(enabled), false) from private.embryo_split_config),
   'pgt_table_ingest_sessions', (select count(*) from public.embryo_ingest_sessions where source_format = 'pgt_table'),
   'generated_exports', (select count(*) from public.generated_exports),
   'export_archive_jobs', (select count(*) from private.export_archive_jobs),
   'family_pairs_ended', (select count(*) from public.family_pairs where status not in ('pending', 'current')),
   'family_pairs_open', (select count(*) from public.family_pairs where status in ('pending', 'current')),
   'path_b_drafts', (select count(*) from public.adult_subject_drafts where adult_flow <> 'path-a-own-account'),
   'future_person_claim_intakes', (select count(*) from private.future_person_claim_intakes),
   'new_correction_intakes', (select count(*) from private.new_correction_intakes),
   'active_download_sessions', (select count(*) from public.download_sessions where status = 'active'),
   'pending_account_deletions', (select count(*) from public.account_deletion_requests where state = 'notice_period'),
   'queued_or_claimed_mail', (select count(*) from public.mail_outbox where state in ('queued', 'claimed')))
) as prechecks;
"""
open(sys.argv[1], 'w', encoding='utf-8').write(sql)
print(sys.argv[1], len(sql))
