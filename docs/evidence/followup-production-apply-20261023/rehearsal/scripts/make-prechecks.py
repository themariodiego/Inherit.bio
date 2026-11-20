"""Write the kit's production-readonly-prechecks.sql from the rehearsal's guard map.

    python3 -I make-prechecks.py <out.sql>

Inputs (committed next to this script): ../data/guard-map.json (guards.py: every md5
guard of the 7 migrations, mapped on the mirror of PR 324's rehearsed post-state) and
../data/referenced-identifiers.tsv (every schema-qualified identifier the 7 files name,
classified on that state: an existing function, an existing relation, or ABSENT, which
is what the release creates).
"""
import json
import os
import sys

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
guards = json.load(open(os.path.join(D, 'guard-map.json')))['guards']
ids = [l.rstrip('\n').split('|') for l in open(os.path.join(D, 'referenced-identifiers.tsv')) if l.strip()]


def lit(s):
    return "'" + s.replace("'", "''") + "'"


# Every guard whose predecessor body exists before this release (production's own body,
# or the one PR 324's release writes). In-release predecessors are proven by the dry runs.
rows = [g for g in guards if g['origin'] in ('production', 'PR 324')]
assert len(rows) == 19, len(rows)
# 20261022100000 checks attributes with its md5(prosrc) predecessor guard.
EXTRA = {('20261022100000', 96): dict(secdef='true', volatile="'v'", config="array['search_path=pg_catalog']::text[]")}
vals = []
for g in rows:
    e = EXTRA.get((g['file'][:14], g['line']), {})
    ref = f"#{g['index']:02d} {g['file'][:-4]} line {g['line']}" + (f" (patch {g['ordinal']})" if g.get('ordinal') else '')
    vals.append(f"({lit(ref)}, {lit(g['target'])}, {lit(g['kind'])}, {lit(g['before'])}, "
                f"{lit(g['acl']) if g['acl'] else 'null::text'}, {e.get('secdef', 'null::boolean')}, "
                f"{e.get('volatile', 'null::text')}, {e.get('config', 'null::text[]')}, {lit(g['origin'])})")
values = ',\n  '.join(vals)
fns = sorted(x for x, k in ids if k == 'fn')
rels = sorted(x for x, k in ids if k.startswith('rel:'))
absent = sorted(x for x, k in ids if k == 'ABSENT')
assert (len(fns), len(rels), len(absent)) == (44, 22, 21), (len(fns), len(rels), len(absent))
# Exact signatures the "prerequisite missing / differs" blocks of #1, #5 and #6 require.
SIGS = ['private.validate_own_ancestry_content_v1(jsonb,uuid,uuid,jsonb,text)',
        'private.validate_own_ancestry_content_v3(jsonb,uuid,uuid,jsonb,text)',
        'private.note_legal_audit_actor_from_nonce_v1()',
        'private.record_subject_operation_nonce_v1(uuid,uuid,text,uuid,text,timestamptz)',
        'private.legal_audit_person_event_v1(text,text)',
        'private.adult_subject_control_v1(text,text,text,text,boolean)',
        'public.bind_adult_subject_account_v1(text,text,uuid,uuid,boolean)',
        'public.create_path_b_adult_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)',
        'public.create_path_b_reviewed_document_draft_v1(uuid,uuid,text,date,bytea,text,text,boolean,jsonb)',
        'public.open_subject_original_download_v1(uuid,uuid,uuid,uuid,text)']
versions = ['20261022100000', '20261022110000', '20261023100000', '20261023110000', '20261023120000',
            '20261023130000', '20261023140000']
pr324_versions = ['20261016120000', '20261016151200', '20261016153100', '20261016170000', '20261016175000',
                  '20261016180000', '20261016181000', '20261016190000', '20261016191000', '20261016195000',
                  '20261016196000', '20261016200000', '20261016201000', '20261016202000', '20261016203000',
                  '20261016204000', '20261016205000', '20261016206000', '20261016207000', '20261016208000',
                  '20261016210000', '20261016211000', '20261016212000', '20261016220000', '20261016221000']


def arr(xs):
    return 'array[' + ','.join(lit(x) for x in xs) + ']::text[]'


sql = f"""-- Read-only pre-checks for the guarded follow-up release (77d04563 over PR 324; one SELECT,
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
  {values}),
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
 select unnest(string_to_array((regexp_match(def, '''\\{{([a-z_,]+)\\}}''::text\\[\\]'))[1], ',')) from nonce),
literals as (
 -- every quoted literal the check holds, in either rendering, parsed or not
 select x[1] v from nonce, regexp_matches(def, '''([^'']*)''::text(?!\\[)', 'g') x
 union all
 select unnest(string_to_array((regexp_match(def, '''\\{{([^}}'']*)\\}}''::text\\[\\]'))[1], ',')) from nonce)
select jsonb_build_object(
 'session', jsonb_build_object(
   'current_user', current_user,
   'statement_timeout', current_setting('statement_timeout'),
   'lock_timeout', current_setting('lock_timeout'),
   'search_path', current_setting('search_path'),
   'server_version', current_setting('server_version')),
 'ledger', (select jsonb_build_object('count', count(*), 'max', max(version),
   'above_pr324_max', count(*) filter (where version > '20261016221000'),
   'pr324_versions_present', count(*) filter (where version = any({arr(pr324_versions)})),
   'release_versions_present', count(*) filter (where version = any({arr(versions)})))
   from supabase_migrations.schema_migrations),
 'guards', (select jsonb_object_agg(ref, jsonb_build_object('function', fn, 'kind', kind, 'origin', origin, 'ok', ok,
   'present', present, 'want_md5', want_md5, 'have_md5', have_md5, 'want_acl', want_acl, 'proacl', acl,
   'prosecdef', prosecdef, 'provolatile', volatile, 'proconfig', to_jsonb(proconfig))) from checked),
 'must_be_zero', jsonb_build_object(
   -- the 19 md5 predecessor guards on bodies that exist before this release (with their extra predicates)
   'guarded_bodies_not_as_rehearsed', (select count(*) from checked where not ok),
   -- the exact signatures the predecessor blocks of #1, #5 and #6 require
   'prerequisite_signatures_missing', (select count(*) from unnest({arr(SIGS)}) s where pg_catalog.to_regprocedure(s) is null),
   -- every existing function (by name) and relation the 7 files name: {len(fns)} functions, {len(rels)} relations
   'prerequisite_functions_missing', (select count(*) from unnest({arr(fns)}) f
     where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'prerequisite_relations_missing', (select count(*) from unnest({arr(rels)}) r where pg_catalog.to_regclass(r) is null),
   -- 20261023130000: its predecessor needs this trigger of PR 324's release
   'embryo_nonce_actor_trigger_missing', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_trigger
     where tgrelid = 'public.embryo_operation_nonces'::regclass and tgname = 'legal_audit_actor_on_consume')),
   -- every function the release creates (20, and the one #3 creates and #4 drops), and #5's trigger
   'release_functions_present', (select count(*) from unnest({arr(absent)}) f
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
"""
open(sys.argv[1], 'w', encoding='utf-8').write(sql)
print(sys.argv[1], len(sql))
