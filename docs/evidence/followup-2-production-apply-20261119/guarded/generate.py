#!/usr/bin/env python3
# Run with: python3 -I generate.py [--head REV] <mode>
#
# Reproducible generator for the guarded production release of the 4 migrations that
# the follow-up branch adds over the follow-up release's migration tree (77d04563,
# 259a56dd...). Its pre-state is the follow-up kit's rehearsed post-state, so it runs
# only after the follow-up's release (../../followup-production-apply-20261023/) has
# read back EQUAL to its batch-2 post-state and code carrying exactly that migration tree
# is merged and deployed.
#
# The release is pinned to a supabase/migrations TREE, REV_TREE (be49d283...): the
# follow-up branch head d8dcb61a's tree (151259da...) with 20261025400000's revised
# predecessor guard (README.md, "The defect the first rehearsal found"). A tree id is
# content-addressed, so the commit that carries the revised file has exactly this tree,
# whatever its own id. Every migration is read byte for byte with
# `git show REV_TREE:<file>` from the repository this file lives in; nothing is read from
# a working tree.
#
# --head REV (default HEAD) names the commit that will be merged. Every mode refuses
# unless REV's supabase/migrations tree is exactly REV_TREE, so a later head that changes
# only tests or documents stays valid, and any migration change after the rehearsal stops
# the release. LOCAL ONLY: before the revised file is committed, --head may name REV_TREE
# itself (the rehearsal did); production always names the commit to be merged.
#
# History: the first rehearsal pinned 151259da...; there 20261025400000 refused on the
# mirror of production's state and `final` refused. That defect is fixed in the file
# (one callee, two reviewed bodies), and both batches are now measured.
#
# Modes
#   measure [K]  write local/measure-all.sql (batches 1..K, default all): one DO block that
#                runs those batches on the rehearsal mirror and raises the fingerprint
#                summary measured after each batch (so it always rolls back).
#   record F     parse the psql output F of measure-all.sql into local/expected-summaries.json
#                (batches 1..K, as measured).
#   final        refuses unless every batch has a measured post-state. Then writes
#                batch-<k>-apply.sql and batch-<k>-dry-run.sql for every batch,
#                all-batches-dry-run.sql, local/batch-<k>-probe.sql, expected-summaries.json,
#                a byte copy of fingerprint.sql for read-backs, and SHA256SUMS.
#   local K      LOCAL ONLY: writes local/batch-<k>-apply.sql, -dry-run.sql and -probe.sql for
#                k = 1..K (each must be measured), byte for byte what `final` writes for
#                that batch at this REV_TREE, for a rehearsal. Never SHA256SUMS; never production.
#   list         print the git-derived migration list and the batch cut; writes nothing.
#
# Each apply file is ONE DO statement (atomic under any client protocol), built exactly
# as ../../followup-production-apply-20261023/guarded/generate.py builds it: (a) session
# guards, timeouts and the fingerprint's pinned deparse settings; integrity of every
# embedded text; (b) predecessor checks on the ledger and the full in-block fingerprint
# summary; (c) each migration executed verbatim, in filename order, with the session's
# settings restored first; (d) the in-block fingerprint summary must equal the
# post-state measured on the rehearsal mirror; (e) one ledger row per migration
# (version, name, array[migration text]). The dry-run twin differs only in its last
# statement inside the block, which raises DRY_RUN_COMPLETE_ALL_CHECKS_PASSED so
# everything rolls back.

import hashlib
import json
import os
import re
import subprocess
import sys

REV_TREE = 'be49d283ec9a435c635ca54f28986d4676886910'   # the rehearsed supabase/migrations tree (281 files)
FIRST_TREE = '151259da5cb41959a57d767c4ed814621829436c'  # d8dcb61a's tree: the first rehearsal (refused); history only
BASE = '77d04563e3d568571215284afb8a3aae47b02d56'       # the follow-up release's migration tree
BASE_TREE = '259a56ddacc2a00e5ab2ce6913e8f237c2d58315'
EXPECTED_NEW = 4
EXPECTED_BASE = 277
HERE = os.path.dirname(os.path.abspath(__file__))
RELEASE = os.path.dirname(HERE)
LOCAL = os.path.join(HERE, 'local')
FP_PATH = os.path.join(RELEASE, 'fingerprint.sql')
FP_SHA256 = 'd5c4d2456db3eceb55c139fb9f07d3de194be17dcdc5577d1c397c806135916e'
FU_KIT = os.path.join(os.path.dirname(RELEASE), 'followup-production-apply-20261023', 'guarded', 'expected-summaries.json')

# Two batches, consecutive in filename order (1-based, inclusive). Batch 1 (#1-#3) is
# safe for the deployed follow-up code at its boundary (../compat-analysis.md) and holds
# the release's only strong table lock (ACCESS EXCLUSIVE on public.account_operation_nonces
# for #1's check rebuild). Batch 2 (#4) changes what the deployed code's Path A
# confirmation gets ('unavailable' instead of 'accepted'), so it is last and alone, and
# the merge follows it straight away.
BATCHES = [(1, 3), (4, 4)]

# Production facts after the follow-up's release, confirmed from its kit
# (../../followup-production-apply-20261023/guarded/expected-summaries.json, checked by
# check_pre_state): 273 rows + its 7 = 280 rows, max 20261023140000.
LEDGER_PRE_COUNT = 280
LEDGER_PRE_MAX = '20261023140000'
# The follow-up's rehearsed batch-2 post-state: the state production must read back
# EQUAL to after the follow-up's release, before batch 1 here.
PRODUCTION_PRE_SUMMARY = {
    'types': {'count': 5, 'md5': '12d5c67500e367470d000abab7e3cd4d'},
    'views': {'count': 0, 'md5': 'd751713988987e9331980363e24189ce'},
    'tables': {'count': 267, 'md5': '3d1bbd050b47347f0765d684c85ea7a6'},
    'functions': {'count': 1417, 'md5': '130b1314a0cd017ccb1f680a81c46425'},
    'sequences': {'count': 9, 'md5': 'dbbac44379a68bc662066f05e0d1dfd0'},
    'extensions': {'count': 6, 'md5': '5c2a24b528337a3bf52348d5c2c8ac8a'},
    'schema_acls': {'count': 2, 'md5': '61bd2caad5658e5e02638b5bb94b48bd'},
    'storage_buckets': {'count': 4, 'md5': '08130193feb5c8420b5453b21be859c6'},
    'storage_policies': {'count': 1, 'md5': '83f978bf2a86691480aca059d3285e5a'},
}
CATEGORIES = sorted(PRODUCTION_PRE_SUMMARY)

# The settings fingerprint.sql pins with set_config(..., true).
PINS = [('search_path', 'pg_catalog'), ('TimeZone', 'UTC'), ('DateStyle', 'ISO, MDY'),
        ('IntervalStyle', 'postgres'), ('extra_float_digits', '1'), ('bytea_output', 'hex')]
SAVED = {'search_path': 's_search_path', 'TimeZone': 's_timezone', 'DateStyle': 's_datestyle',
         'IntervalStyle': 's_intervalstyle', 'extra_float_digits': 's_extra_float_digits',
         'bytea_output': 's_bytea_output'}
STATEMENT_TIMEOUT_MS = 180000
DRY_RUN_LINE = "  raise exception using message = 'DRY_RUN_COMPLETE_ALL_CHECKS_PASSED';"


def git(*args):
    return subprocess.run(['git', '-C', TOP, *args], check=True, capture_output=True).stdout


# The top level of the repository this file lives in (pathspecs resolve from there).
TOP = subprocess.run(['git', '-C', HERE, 'rev-parse', '--show-toplevel'], check=True,
                     capture_output=True).stdout.decode().strip()


def rev_parse(spec):
    return git('rev-parse', '--verify', '--quiet', spec).decode().strip()


def verify_head(head):
    """The commit to be merged must carry exactly the rehearsed migration tree."""
    if git('cat-file', '-t', REV_TREE).decode().strip() != 'tree':
        raise SystemExit(f'the pinned migration tree {REV_TREE} is not in this repository; git fetch the head first')
    kind = git('cat-file', '-t', rev_parse(head)).decode().strip()
    if kind == 'tree':
        # LOCAL ONLY: the rehearsal ran before the revised file was committed.
        if rev_parse(head) != REV_TREE:
            raise SystemExit(f'tree {rev_parse(head)} is not the rehearsed tree {REV_TREE}')
        print(f'LOCAL ONLY: --head names the tree {REV_TREE[:8]}, not a commit; production names the commit to be merged',
              file=sys.stderr)
        return REV_TREE, REV_TREE
    commit = rev_parse(f'{head}^{{commit}}')
    have = rev_parse(f'{commit}:supabase/migrations')
    if have != REV_TREE:
        raise SystemExit(f'head {commit}: supabase/migrations tree {have} is not the rehearsed tree {REV_TREE}')
    if git('merge-base', BASE, commit).decode().strip() != BASE:
        raise SystemExit(f'{BASE[:8]} is not an ancestor of head {commit[:8]}')
    return commit, have


def migration_list():
    def tree(t):
        out = git('ls-tree', t).decode()
        entries = {}
        for line in out.splitlines():
            meta, name = line.split('\t', 1)
            entries[name] = meta.split()[2]
        return entries
    if rev_parse(f'{BASE}^{{commit}}') != BASE:
        raise SystemExit('the follow-up release commit is missing; git fetch first')
    if rev_parse(f'{BASE}:supabase/migrations') != BASE_TREE:
        raise SystemExit(f'{BASE[:8]} does not carry the follow-up release migration tree {BASE_TREE}')
    new, old = tree(REV_TREE), tree(BASE_TREE)
    if len(old) != EXPECTED_BASE:
        raise SystemExit(f'{BASE[:8]} has {len(old)} migration files, expected {EXPECTED_BASE}')
    for name, blob in old.items():  # every earlier migration is untouched
        if new.get(name) != blob:
            raise SystemExit(f'earlier migration changed or missing in {REV_TREE[:8]}: supabase/migrations/{name}')
    files = sorted(n for n in new if n not in old)
    # The same list as `git diff --name-only <base tree> <rev tree>`, which would also list a
    # changed earlier file (refused above).
    two_dot = sorted(git('diff', '--name-only', '--no-renames', BASE_TREE, REV_TREE).decode().split())
    if two_dot != files:
        raise SystemExit('ls-tree and git diff disagree on the migration list')
    if len(files) != EXPECTED_NEW or not all(re.fullmatch(r'\d{14}_[a-z0-9_]+\.sql', n) for n in files):
        raise SystemExit('unexpected migration list')
    if min(n[:14] for n in files) <= LEDGER_PRE_MAX:
        raise SystemExit("a new version is not above the ledger max after the follow-up's release")
    return files


def load_migrations():
    out = []
    for i, base in enumerate(migration_list(), 1):
        path = f'supabase/migrations/{base}'
        data = git('show', f'{REV_TREE}:{base}')
        text = data.decode('utf-8')  # strict: must be valid UTF-8
        if '\x00' in text:
            raise SystemExit(f'NUL byte in {path}')
        if not text.lstrip('-= \n').startswith('PRODUCTION RELEASE: GUARDED'):
            raise SystemExit(f'{path} is not headed PRODUCTION RELEASE: GUARDED')
        version, name = base[:-4].split('_', 1)
        out.append(dict(index=i, path=path, file=base, version=version, name=name, text=text,
                        bytes=len(data), md5=hashlib.md5(data).hexdigest(),
                        sha256=hashlib.sha256(data).hexdigest()))
    return out


def load_fingerprint():
    data = open(FP_PATH, 'rb').read()
    if hashlib.sha256(data).hexdigest() != FP_SHA256:
        raise SystemExit('fingerprint.sql is not the reviewed file')
    return data.decode('utf-8'), hashlib.md5(data).hexdigest()


def check_pre_state():
    """The pre-state constants must be the follow-up's rehearsed post-state and its ledger."""
    try:
        k = json.load(open(FU_KIT))
    except OSError:
        raise SystemExit(f'follow-up kit not found: {FU_KIT}')
    last = k['batches'][-1]
    if last['post_summary'] != PRODUCTION_PRE_SUMMARY:
        raise SystemExit("PRODUCTION_PRE_SUMMARY is not the follow-up's batch-2 post-state")
    versions = [v for b in k['batches'] for v in b['versions']]
    if k['ledger_pre']['count'] + len(versions) != LEDGER_PRE_COUNT or max(versions) != LEDGER_PRE_MAX:
        raise SystemExit('the ledger after the follow-up is not 280 rows, max 20261023140000')


def sql_literal(s):
    return "'" + s.replace("'", "''") + "'"


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(', ', ': '))


def tag_for(m):
    return f"$inherit_m_{m['version']}$"


def check_tags(migs, fp_text, outer):
    tags = [outer, '$inherit_release_fp$'] + [tag_for(m) for m in migs]
    if len(set(tags)) != len(tags):
        raise SystemExit('dollar-quote tags are not unique')
    bodies = [fp_text] + [m['text'] for m in migs]
    for t in tags:
        for b in bodies:
            if t in b:
                raise SystemExit(f'tag {t} occurs in an embedded text')


def pin_stmt():
    return '  perform ' + ',\n    '.join(
        f"pg_catalog.set_config({sql_literal(k)}, {sql_literal(v)}, true)" for k, v in PINS) + ';\n'


def restore_stmt(extra_lock=True):
    parts = [f"pg_catalog.set_config({sql_literal(k)}, {SAVED[k]}, true)" for k, _ in PINS]
    if extra_lock:
        parts.append("pg_catalog.set_config('lock_timeout', '10s', true)")
    return '  perform ' + ',\n    '.join(parts) + ';\n'


def fingerprint_read(into):
    return (pin_stmt()
            + f'  execute fp_query into {into};\n'
            + restore_stmt())


def header_lines(title, migs, extra):
    lines = [f'-- {title}',
             f'-- Generated by generate.py from git show {REV_TREE[:8]}:<file>, the supabase/migrations tree (over the follow-up release tree {BASE_TREE[:8]}).',
             '-- One DO statement: atomic under any client protocol. Run with a session-level',
             "-- statement_timeout of at most 180s (psql -c \"set statement_timeout = '180s'\" -f <this file>,",
             '-- or the Management API endpoint, whose session has 2min); the block refuses otherwise,',
             '-- because a SET inside the block cannot bound the statement that is already running.',
             "-- Runs only after the follow-up's guarded release has read back EQUAL to its batch-2 post-state."]
    lines += extra
    lines.append('-- Migrations (filename order): index version bytes sha256')
    for m in migs:
        lines.append(f"--   #{m['index']:02d} {m['file']} {m['bytes']} {m['sha256']}")
    return '\n'.join(lines) + '\n'


def declare_section(migs, fp_text, extra_decls):
    d = ['declare\n',
         f'  fp_query constant text := $inherit_release_fp${fp_text}$inherit_release_fp$;\n']
    for m in migs:
        t = tag_for(m)
        d.append(f"  m_{m['version']} constant text := {t}{m['text']}{t};\n")
    for k, _ in PINS:
        d.append(f"  {SAVED[k]} constant text := pg_catalog.current_setting({sql_literal(k)});\n")
    d.append('  fp jsonb;\n  n bigint;\n  v text;\n')
    d.extend(extra_decls)
    return ''.join(d)


def guards_and_integrity(migs, fp_md5):
    s = []
    s.append("  -- (a) Session guards, timeouts and the fingerprint's pinned deparse settings.\n")
    s.append("  if current_user is distinct from 'postgres' then\n"
             "    raise exception using message = 'session: run as postgres, the owner of every migrated object'; end if;\n")
    s.append("  select setting::bigint into n from pg_catalog.pg_settings where name = 'statement_timeout';\n"
             f"  if n is null or n <= 0 or n > {STATEMENT_TIMEOUT_MS} then\n"
             "    raise exception using message = 'session: set statement_timeout to at most 180s for the session before this statement (a SET inside the block does not bound it)'; end if;\n")
    s.append("  perform pg_catalog.set_config('statement_timeout', '180s', true),\n"
             "    pg_catalog.set_config('lock_timeout', '10s', true);\n")
    s.append(pin_stmt())
    s.append('  -- Integrity: every embedded text is byte-for-byte the reviewed file.\n')
    s.append(f"  if pg_catalog.md5(fp_query) <> '{fp_md5}' then\n"
             "    raise exception using message = 'integrity: the embedded fingerprint query is not fingerprint.sql'; end if;\n")
    for m in migs:
        s.append(f"  if pg_catalog.md5(m_{m['version']}) <> '{m['md5']}' then\n"
                 f"    raise exception using message = 'integrity: embedded {m['file']} is not the reviewed file'; end if;\n")
    return ''.join(s)


def ledger_predecessor(all_migs, k):
    lo, hi = BATCHES[k - 1]
    prev = [m for m in all_migs if m['index'] < lo]
    later = [m for m in all_migs if m['index'] >= lo]
    count = LEDGER_PRE_COUNT + len(prev)
    mx = max([LEDGER_PRE_MAX] + [m['version'] for m in prev])
    s = ['  -- (b) Predecessor: the ledger.\n',
         '  select count(*), max(version) into n, v from supabase_migrations.schema_migrations;\n',
         f"  if n <> {count} or v is distinct from '{mx}' then\n"
         f"    raise exception using message = format('predecessor: ledger has %s rows, max %s; expected {count} rows, max {mx}', n, v); end if;\n"]
    arr = 'array[' + ','.join(sql_literal(m['version']) for m in later) + ']::text[]'
    s.append(f'  if exists (select 1 from supabase_migrations.schema_migrations where version = any({arr})) then\n'
             f"    raise exception using message = 'predecessor: a version of batch {k} or a later batch is already in the ledger'; end if;\n")
    if prev:
        va = 'array[' + ','.join(sql_literal(m['version']) for m in prev) + ']::text[]'
        na = 'array[' + ','.join(sql_literal(m['name']) for m in prev) + ']::text[]'
        s.append('  select count(*) into n from supabase_migrations.schema_migrations s\n'
                 f'    join unnest({va}, {na}) as e(version, name) on e.version = s.version and e.name = s.name;\n'
                 f"  if n <> {len(prev)} then\n"
                 f"    raise exception using message = 'predecessor: the {len(prev)} ledger rows of the earlier batches are not all present'; end if;\n")
    return ''.join(s)


def summary_check(label, var):
    return (f"  if (fp -> 'summary') is distinct from {var} then\n"
            f"    raise exception using message = '{label}: fingerprint summary differs: ' || (fp -> 'summary')::text; end if;\n")


def run_migrations(migs):
    s = ['  -- (c) The migrations, verbatim, in filename order. The session values of the pinned\n'
         '  -- settings are restored first, so each runs as the CLI would run it.\n']
    for m in migs:
        s.append(f"  -- #{m['index']:02d} {m['file']}\n")
        s.append(restore_stmt())
        s.append(f"  execute m_{m['version']};\n")
    return ''.join(s)


def ledger_inserts(migs):
    rows = ',\n    '.join(f"({sql_literal(m['version'])}, {sql_literal(m['name'])}, array[m_{m['version']}])" for m in migs)
    return ('  -- (e) Ledger rows under the repository versions and names, one statement each, as the CLI records them.\n'
            f'  insert into supabase_migrations.schema_migrations (version, name, statements)\n  values\n    {rows};\n')


def build_batch(all_migs, fp_text, fp_md5, k, pre, post, mode):
    lo, hi = BATCHES[k - 1]
    migs = [m for m in all_migs if lo <= m['index'] <= hi]
    outer = f'$inherit_release_b{k}_do$'
    check_tags(migs, fp_text, outer)
    # apply and dry-run share this header byte for byte; only the last line of the block differs.
    title = (f'Guarded production release after the follow-up (tree {REV_TREE[:8]} over {BASE_TREE[:8]}), batch {k} of {len(BATCHES)} (#{lo}-#{hi}).'
             f' batch-{k}-dry-run.sql is batch-{k}-apply.sql with one final raise of DRY_RUN_COMPLETE_ALL_CHECKS_PASSED,'
             ' so it rolls everything back.')
    if mode == 'probe':
        title = f'LOCAL ONLY lock probe, batch {k} (#{lo}-#{hi}): raises the relation locks it holds, so nothing persists.'
    extra = [f'-- Expected pre-state summary: {canonical(pre)}',
             f'-- Expected post-state summary (measured on the rehearsal mirror): {canonical(post)}']
    out = [header_lines(title, migs, extra), f'do {outer}\n',
           declare_section(migs, fp_text, [f"  expected_pre constant jsonb := {sql_literal(canonical(pre))};\n",
                                           f"  expected_post constant jsonb := {sql_literal(canonical(post))};\n"]),
           'begin\n', guards_and_integrity(migs, fp_md5), ledger_predecessor(all_migs, k),
           '  -- (b) Predecessor: the full catalog fingerprint summary, computed in this block.\n',
           fingerprint_read('fp'), summary_check('predecessor', 'expected_pre'),
           run_migrations(migs),
           '  -- (d) Postcheck: the summary must equal the post-state measured on the rehearsal mirror.\n',
           fingerprint_read('fp'), summary_check('postcheck', 'expected_post'),
           ledger_inserts(migs)]
    if mode == 'probe':
        out.append("  raise exception using message = 'PROBE_LOCKS ' || (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(ns.nspname, c.relname, c.relkind::text, l.mode) order by ns.nspname, c.relname, l.mode)\n"
                   "    from pg_catalog.pg_locks l join pg_catalog.pg_class c on c.oid = l.relation join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace\n"
                   "    where l.pid = pg_catalog.pg_backend_pid() and l.locktype = 'relation' and l.granted)::text;\n")
    else:
        out.append((DRY_RUN_LINE if mode == 'dry-run' else '') + '\n')
    out.append(f'end\n{outer};\n')
    return ''.join(out)


def build_measure(all_migs, fp_text, fp_md5, through):
    outer = '$inherit_release_measure_do$'
    migs_in = [m for m in all_migs if m['index'] <= BATCHES[through - 1][1]]
    check_tags(migs_in, fp_text, outer)
    out = [header_lines(f'LOCAL ONLY: measure the fingerprint summary after batches 1..{through} on the rehearsal mirror; always raises, so nothing persists', migs_in, []),
           f'do {outer}\n',
           declare_section(migs_in, fp_text, [f"  expected_pre constant jsonb := {sql_literal(canonical(PRODUCTION_PRE_SUMMARY))};\n",
                                              "  result jsonb := '{}';\n  t0 timestamptz;\n"]),
           'begin\n', guards_and_integrity(migs_in, fp_md5), ledger_predecessor(all_migs, 1),
           fingerprint_read('fp'), summary_check('predecessor', 'expected_pre')]
    for k, (lo, hi) in enumerate(BATCHES[:through], 1):
        migs = [m for m in all_migs if lo <= m['index'] <= hi]
        out.append('  t0 := pg_catalog.clock_timestamp();\n')
        out.append(run_migrations(migs))
        out.append(fingerprint_read('fp'))
        out.append(f"  result := result || pg_catalog.jsonb_build_object('batch{k}', fp -> 'summary', 'batch{k}_seconds', extract(epoch from pg_catalog.clock_timestamp() - t0));\n")
    out.append("  raise exception using message = 'MEASURED_SUMMARIES ' || result::text;\nend\n" + outer + ';\n')
    return ''.join(out)


def build_all_dry_run(all_migs, fp_text, fp_md5, exp):
    """Every batch in one transaction, each batch's postcheck and ledger rows
    included, ending in the dry-run raise: an upfront whole-release dry run."""
    outer = '$inherit_release_all_do$'
    check_tags(all_migs, fp_text, outer)
    title = (f'Guarded production release after the follow-up (tree {REV_TREE[:8]} over {BASE_TREE[:8]}), ALL batches in one DRY RUN (#1-#{len(all_migs)}):'
             ' every batch check, then a final raise of DRY_RUN_COMPLETE_ALL_CHECKS_PASSED, so it rolls everything back. Never an apply.')
    decls = [f"  expected_b{k} constant jsonb := {sql_literal(canonical(exp[f'batch{k}']))};\n" for k in range(len(BATCHES) + 1)]
    out = [header_lines(title, all_migs, []), f'do {outer}\n', declare_section(all_migs, fp_text, decls),
           'begin\n', guards_and_integrity(all_migs, fp_md5), ledger_predecessor(all_migs, 1),
           '  -- (b) Predecessor: the full catalog fingerprint summary, computed in this block.\n',
           fingerprint_read('fp'), summary_check('predecessor', 'expected_b0')]
    for k, (lo, hi) in enumerate(BATCHES, 1):
        migs = [m for m in all_migs if lo <= m['index'] <= hi]
        out += [f'  -- ===== batch {k} (#{lo}-#{hi}) =====\n', run_migrations(migs),
                fingerprint_read('fp'), summary_check(f'postcheck batch {k}', f'expected_b{k}'), ledger_inserts(migs)]
    out.append(DRY_RUN_LINE + '\nend\n' + outer + ';\n')
    return ''.join(out)


def sha256_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def check_batches(n):
    if BATCHES[0][0] != 1 or BATCHES[-1][1] != n or any(
            lo > hi or (i and lo != BATCHES[i - 1][1] + 1) for i, (lo, hi) in enumerate(BATCHES)):
        raise SystemExit('BATCHES must cover 1..n consecutively')


def measured():
    exp = json.load(open(os.path.join(LOCAL, 'expected-summaries.json')))['summaries']
    if exp['batch0'] != PRODUCTION_PRE_SUMMARY:
        raise SystemExit("batch0 is not the follow-up's post-state summary")
    have = sorted(exp)
    if have != [f'batch{k}' for k in range(len(have))] or len(have) > len(BATCHES) + 1:
        raise SystemExit('local/expected-summaries.json does not match the batch cut; measure and record again')
    return exp


def write_batch_files(migs, fp_text, fp_md5, exp, k, where):
    pre, post = exp[f'batch{k - 1}'], exp[f'batch{k}']
    texts, written = {}, []
    for mode_k, path in (('apply', os.path.join(where, f'batch-{k}-apply.sql')),
                         ('dry-run', os.path.join(where, f'batch-{k}-dry-run.sql')),
                         ('probe', os.path.join('local', f'batch-{k}-probe.sql'))):
        texts[mode_k] = build_batch(migs, fp_text, fp_md5, k, pre, post, mode_k)
        open(os.path.join(HERE, path), 'w', encoding='utf-8').write(texts[mode_k])
        written.append(path)
    a = texts['apply'].split('\n'); d = texts['dry-run'].split('\n')
    diff = [(i, x, y) for i, (x, y) in enumerate(zip(a, d)) if x != y]
    # apply and dry-run differ only in the one raise line
    if len(a) != len(d) or len(diff) != 1 or diff[0][1] != '' or diff[0][2] != DRY_RUN_LINE:
        raise SystemExit(f'batch {k}: dry-run is not the apply plus the final raise')
    return written


def main():
    args = sys.argv[1:]
    head = 'HEAD'
    if args[:1] == ['--head']:
        if len(args) < 2:
            raise SystemExit('--head needs a revision')
        head, args = args[1], args[2:]
    mode = args[0] if args else ''
    commit, tree = verify_head(head)
    check_pre_state()
    migs = load_migrations()
    check_batches(len(migs))
    fp_text, fp_md5 = load_fingerprint()
    print(f'head {commit}: supabase/migrations tree {tree} == the rehearsed tree', file=sys.stderr)
    if mode == 'list':
        for m in migs:
            k = next(i for i, (lo, hi) in enumerate(BATCHES, 1) if lo <= m['index'] <= hi)
            print(f"batch {k} #{m['index']:02d} {m['file']} {m['bytes']} {m['sha256']}")
        return
    os.makedirs(LOCAL, exist_ok=True)
    if mode == 'measure':
        through = int(args[1]) if len(args) > 1 else len(BATCHES)
        if not 1 <= through <= len(BATCHES):
            raise SystemExit('measure K: 1 <= K <= number of batches')
        p = os.path.join(LOCAL, 'measure-all.sql')
        open(p, 'w', encoding='utf-8').write(build_measure(migs, fp_text, fp_md5, through))
        print(p, sha256_file(p))
    elif mode == 'record':
        text = open(args[1], encoding='utf-8').read()
        m = re.search(r'ERROR:  MEASURED_SUMMARIES (\{.*\})', text)
        if not m:
            raise SystemExit('no MEASURED_SUMMARIES line')
        got = json.loads(m.group(1))
        exp = {'batch0': PRODUCTION_PRE_SUMMARY}
        for k in range(1, len(BATCHES) + 1):
            if f'batch{k}' not in got:
                break
            exp[f'batch{k}'] = got[f'batch{k}']
            if sorted(exp[f'batch{k}']) != CATEGORIES:
                raise SystemExit('unexpected categories')
        p = os.path.join(LOCAL, 'expected-summaries.json')
        json.dump({'summaries': exp, 'measure_seconds': {k: v for k, v in got.items() if k.endswith('_seconds')}},
                  open(p, 'w'), indent=1, sort_keys=True)
        print(p, 'batches measured:', len(exp) - 1, 'of', len(BATCHES))
    elif mode == 'local':
        exp = measured()
        through = int(args[1]) if len(args) > 1 else 0
        if not 1 <= through <= len(exp) - 1:
            raise SystemExit(f'local K: 1 <= K <= {len(exp) - 1} (the batches measured)')
        for k in range(1, through + 1):
            for path in write_batch_files(migs, fp_text, fp_md5, exp, k, 'local'):
                print(path, sha256_file(os.path.join(HERE, path)))
    elif mode == 'final':
        exp = measured()
        if len(exp) - 1 != len(BATCHES):
            missing = len(exp)
            raise SystemExit(f'batch {missing} (#{BATCHES[missing - 1][0]}-#{BATCHES[missing - 1][1]}) has no measured post-state: '
                             'it refuses on the rehearsal mirror (README.md, "Blocked"). No production file is written.')
        written = ['expected-summaries.json']
        with open(os.path.join(HERE, 'expected-summaries.json'), 'w') as f:
            json.dump({'batches': [{'batch': k, 'first': lo, 'last': hi,
                                    'versions': [m['version'] for m in migs if lo <= m['index'] <= hi],
                                    'pre_summary': exp[f'batch{k - 1}'], 'post_summary': exp[f'batch{k}']}
                                   for k, (lo, hi) in enumerate(BATCHES, 1)],
                       'ledger_pre': {'count': LEDGER_PRE_COUNT, 'max': LEDGER_PRE_MAX}}, f, indent=1, sort_keys=True)
            f.write('\n')
        for k in range(1, len(BATCHES) + 1):
            written += write_batch_files(migs, fp_text, fp_md5, exp, k, '')
        open(os.path.join(HERE, 'all-batches-dry-run.sql'), 'w', encoding='utf-8').write(
            build_all_dry_run(migs, fp_text, fp_md5, exp))
        written.append('all-batches-dry-run.sql')
        open(os.path.join(HERE, 'fingerprint.sql'), 'w', encoding='utf-8').write(fp_text)  # the reviewed read-back query
        written.append('fingerprint.sql')
        with open(os.path.join(HERE, 'SHA256SUMS'), 'w') as f:
            for path in ['generate.py', 'check-readback.py', 'production-readonly-prechecks.sql',
                         'local/expected-summaries.json'] + written:
                f.write(f'{sha256_file(os.path.join(HERE, path))}  {path}\n')
            f.write(f"{sha256_file(os.path.join(RELEASE, 'api', 'api-run.py'))}  ../api/api-run.py\n")
        print(open(os.path.join(HERE, 'SHA256SUMS')).read(), end='')
    else:
        raise SystemExit('usage: generate.py [--head REV] measure [K] | record <psql-output> | local K | final | list')


if __name__ == '__main__':
    main()
