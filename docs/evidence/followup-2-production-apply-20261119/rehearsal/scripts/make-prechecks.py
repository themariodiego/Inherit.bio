"""Write the kit's production-readonly-prechecks.sql from the rehearsal's guard map.

    python3 -I make-prechecks.py <out.sql>

Inputs (committed next to this script): ../data/guard-map.json (guards.py: every md5
guard of the 4 migrations, mapped on the mirror of the follow-up's rehearsed
post-state) and ../data/referenced-identifiers.tsv (idents.py: every schema-qualified
identifier the 4 files name, classified on that state: an existing function, an
existing relation, or ABSENT, which is what the release creates).
"""
import json
import os
import sys

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
guards = json.load(open(os.path.join(D, 'guard-map.json')))['guards']
ids = [l.rstrip('\n').split('|') for l in open(os.path.join(D, 'referenced-identifiers.tsv')) if l.strip()]


def lit(s):
    return "'" + s.replace("'", "''") + "'"


# Every md5 guard whose predecessor body exists before this release (all of them are
# production's own bodies, or the follow-up's consumer). One row per function: a callee
# 20261025400000 lists twice (current_adult_subject_invitation_v1, its repository body and
# production's comment-stripped body) is one row that accepts either md5; 20261025400000's
# patch 1 repeats its predecessor block's md5. Successor and postflight md5s are proven by
# the dry runs.
rows, by_fn = [], {}
for g in guards:
    if g['kind'] not in ('predecessor', 'callee', 'patch') or not g['origin'] or g['origin'].startswith('in-migration'):
        continue
    key = g['target']
    if key in by_fn:
        if g['before'] not in by_fn[key]['want']:
            by_fn[key]['want'].append(g['before'])
        continue
    by_fn[key] = dict(g, want=[g['before']])
    rows.append(by_fn[key])
assert len(rows) == 11, len(rows)
assert sum(len(g['want']) for g in rows) == 12
vals = []
for g in rows:
    ref = f"#{g['index']:02d} {g['file'][:-4]} line {g['line']}" + (f" (patch {g['ordinal']})" if g.get('ordinal') else '')
    want = 'array[' + ','.join(lit(w) for w in g['want']) + ']::text[]'
    vals.append(f"({lit(ref)}, {lit(g['target'])}, {want}, "
                f"{lit(g['acl']) if g['acl'] else 'null::text'}, {lit(g['origin'])})")
values = ',\n  '.join(vals)
fns = sorted(x for x, k in ids if k == 'fn' and x != 'auth.jwt')
rels = sorted(x for x, k in ids if k.startswith('rel:'))
absent = sorted(x for x, k in ids if k == 'ABSENT')
absent_fns = [x for x in absent if x != 'private.session_csrf_token_uses']
assert (len(fns), len(rels), len(absent_fns)) == (11, 6, 6), (len(fns), len(rels), len(absent_fns))
# Exact signatures the predecessor blocks of #1, #3 and #4 require, and the one the
# CSRF door calls (auth.jwt(), not checked by #2's predecessor).
SIGS = ['private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)',
        'public.remove_own_copilot_settings_v1(uuid,uuid)',
        'public.revoke_cloud_model_consent(uuid,uuid)',
        'public.revoke_own_copilot_v1(uuid,uuid,uuid,jsonb)',
        'private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)',
        'private.current_adult_subject_invitation_v1(uuid,uuid)',
        'private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)',
        'private.lock_invitation_transitions_v1()',
        'private.declare_contact_alias_groups_v1(jsonb)',
        'private.resolve_hmac_set_v1(text,text,jsonb)',
        'private.presented_contact_digest_v1(jsonb,text,bigint)',
        'auth.jwt()']
# Columns the new bodies read at run time. #2's and #4's predecessors check only that
# auth.sessions and auth.users exist; plpgsql does not resolve columns at create time, so
# a missing column would fail every call, not the migration. #4's checks its own column.
COLUMNS = [('auth', 'sessions', 'id', 'uuid'), ('auth', 'sessions', 'user_id', 'uuid'),
           ('auth', 'sessions', 'not_after', 'timestamp with time zone'),
           ('auth', 'users', 'id', 'uuid'), ('auth', 'users', 'deleted_at', 'timestamp with time zone'),
           ('public', 'consent_signatures', 'signing_name_encrypted', 'bytea')]
ROLES = ['anon', 'authenticated', 'inherit_upload_only', 'service_role']
versions = ['20261024110000', '20261024220000', '20261025200000', '20261025400000']
followup_versions = ['20261022100000', '20261022110000', '20261023100000', '20261023110000', '20261023120000',
                     '20261023130000', '20261023140000']


def arr(xs):
    return 'array[' + ','.join(lit(x) for x in xs) + ']::text[]'


cols = ',\n  '.join(f"({lit(s)}, {lit(t)}, {lit(c)}, {lit(ty)})" for s, t, c, ty in COLUMNS)
sql = f"""-- Read-only pre-checks for the guarded release after the follow-up (d8dcb61a over 77d04563;
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
  {values}),
checked as (
 select g.ref, g.fn, g.want_md5s, g.want_acl, g.origin, p.oid is not null as present,
  md5(pg_catalog.pg_get_functiondef(p.oid)) as have_md5, p.proacl::text as acl,
  coalesce(p.oid is not null and md5(pg_catalog.pg_get_functiondef(p.oid)) = any(g.want_md5s)
   and (g.want_acl is null or p.proacl::text = g.want_acl), false) as ok
 from guard g left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(g.fn)),
col(s, t, c, ty) as (values
  {cols}),
nonce as (
 select pg_catalog.pg_get_constraintdef(c.oid) as def from pg_catalog.pg_constraint c
 where c.conrelid = 'public.account_operation_nonces'::regclass and c.conname = 'account_operation_nonces_operation_check'),
parsed as (
 -- 20261024110000's $widen$ parse, applied to today's text
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
   'above_followup_max', count(*) filter (where version > '20261023140000'),
   'followup_versions_present', count(*) filter (where version = any({arr(followup_versions)})),
   'release_versions_present', count(*) filter (where version = any({arr(versions)})))
   from supabase_migrations.schema_migrations),
 'guards', (select jsonb_object_agg(ref, jsonb_build_object('function', fn, 'origin', origin, 'ok', ok, 'present', present,
   'want_md5s', to_jsonb(want_md5s), 'have_md5', have_md5, 'want_acl', want_acl, 'proacl', acl)) from checked),
 'must_be_zero', jsonb_build_object(
   -- the {len(rows)} md5 predecessor guards on bodies that exist before this release
   'guarded_bodies_not_as_rehearsed', (select count(*) from checked where not ok),
   -- 20261025200000's predecessor: the consumer must name consent_revoke and keep its ACL
   'consumer_without_consent_revoke', (select count(*) from (select 1) x where not exists (select 1 from pg_catalog.pg_proc p
     where p.oid = pg_catalog.to_regprocedure('private.consume_account_operation_nonce_v1(uuid,uuid,text,text,timestamptz)')
       and pg_catalog.pg_get_functiondef(p.oid) like '%''consent_revoke''%' and p.proacl::text = '{{postgres=X/postgres}}')),
   -- the exact signatures the predecessor blocks require, and auth.jwt() which #2's door calls
   'prerequisite_signatures_missing', (select count(*) from unnest({arr(SIGS)}) s where pg_catalog.to_regprocedure(s) is null),
   -- every existing function (by name) and relation the 4 files name: {len(fns)} functions, {len(rels)} relations
   'prerequisite_functions_missing', (select count(*) from unnest({arr(fns)}) f
     where not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = f)),
   'prerequisite_relations_missing', (select count(*) from unnest({arr(rels)}) r where pg_catalog.to_regclass(r) is null),
   -- columns the new doors read at run time, with their types
   'prerequisite_columns_missing', (select count(*) from col where not exists (select 1 from information_schema.columns i
     where i.table_schema = col.s and i.table_name = col.t and i.column_name = col.c and i.data_type = col.ty)),
   -- every migration revokes from these roles; a missing role fails the statement
   'roles_missing', (select count(*) from unnest({arr(ROLES)}) r where not exists (select 1 from pg_catalog.pg_roles where rolname = r)),
   -- every function the release creates ({len(absent_fns)}) and its one table
   'release_functions_present', (select count(*) from unnest({arr(absent_fns)}) f
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
"""
open(sys.argv[1], 'w', encoding='utf-8').write(sql)
print(sys.argv[1], len(sql))
