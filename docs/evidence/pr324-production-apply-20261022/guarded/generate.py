#!/usr/bin/env python3
# Run with: python3 -I generate.py [--head REV] <mode>
#
# Reproducible generator for the guarded production release of the 25
# migrations that 538dcee6 (PR 324) adds over main 12f24475, which production
# already runs (PR 323's 90 migrations were applied on 22 October 2026 through
# ../../pr323-production-apply-20261016/). Every migration is read byte for byte
# with `git show 538dcee6:<path>` from the repository this file lives in;
# nothing is read from a working tree.
#
# --head REV (default HEAD) names the commit that will be merged. Every mode
# refuses unless REV's supabase/migrations tree is exactly 538dcee6's, so a later
# PR head that changes only tests or documents stays valid, and any migration
# change after the rehearsal stops the release.
#
# Modes
#   measure   write local/measure-all.sql: one DO block that runs every batch on
#             the production mirror and raises the fingerprint summary measured
#             after each batch (so it always rolls back).
#   record F  parse the psql output F of measure-all.sql into
#             local/expected-summaries.json.
#   final     write batch-<k>-apply.sql and batch-<k>-dry-run.sql for every
#             batch, all-batches-dry-run.sql (every batch in one rolled-back
#             transaction), local/batch-<k>-probe.sql (local-only lock probes),
#             using local/expected-summaries.json; plus expected-summaries.json
#             (per batch: versions, pre/post summaries), a byte copy of
#             fingerprint.sql for read-backs, and SHA256SUMS.
#   list      print the git-derived migration list and the batch cut; writes nothing.
#
# Each apply file is ONE DO statement (atomic under any client protocol), in
# this order: (a) session guards, timeouts and the fingerprint's pinned deparse
# settings; integrity of every embedded text; (b) predecessor checks on the
# ledger and the full in-block fingerprint summary; (c) each migration executed
# verbatim, in filename order; (d) the in-block fingerprint summary must equal
# the post-state measured on the rehearsal mirror; (e) one ledger row per
# migration (version, name, array[migration text]), as the precedents
# docs/evidence/export-persistence-production-apply-20260925/apply.sql and
# docs/evidence/pr323-production-apply-20261016/guarded/generate.py do.
# The dry-run twin differs only in its last statement inside the block, which
# raises DRY_RUN_COMPLETE_ALL_CHECKS_PASSED so everything rolls back.

import hashlib
import json
import os
import re
import subprocess
import sys

REV = '538dcee66a1595df11ca0937512e0efed2ced85c'
MAIN = '12f24475094653afe8f9935b75f352d76012b1b4'
EXPECTED_NEW = 25
EXPECTED_MAIN = 245
HERE = os.path.dirname(os.path.abspath(__file__))
RELEASE = os.path.dirname(HERE)
LOCAL = os.path.join(HERE, 'local')
FP_PATH = os.path.join(RELEASE, 'fingerprint.sql')
FP_SHA256 = 'd5c4d2456db3eceb55c139fb9f07d3de194be17dcdc5577d1c397c806135916e'
PR323_POST = os.path.join(os.path.dirname(RELEASE), 'pr323-production-apply-20261016', 'results',
                          'run-2026-10-22', 'fp-after-merge.json')

# Consecutive filename order, never splitting a migration (1-based, inclusive).
# No migration breaks main's production-reachable code (../compat-analysis.md), so
# the cut follows the locks held to commit: batch 1 holds the only auth.users lock
# (#2's foreign keys), batch 2 the genome_files, download_sessions, subject draft and
# Path B principal locks (#6-#11, the subjects endpoints, with the one
# production-reachable behaviour change, #7's file-deletion guard), batch 3 the
# consents and rights set and the correction slices (#12-#24), and batch 4 only #25,
# the one ACCESS EXCLUSIVE lock on public.subjects, with five in-place patches of
# production bodies and the account operation check rebuild.
BATCHES = [(1, 5), (6, 11), (12, 24), (25, 25)]

# Production facts. The ledger after PR 323's release (ledger-4.body of
# run-2026-10-22): 248 rows, max 20261011010251. Early production versions differ
# from repository file names, so the full version list is never asserted.
LEDGER_PRE_COUNT = 248
LEDGER_PRE_MAX = '20261011010251'
# Production's summary read back on 2026-10-22 after PR 323 merged
# (fp-after-merge.json; equal to PR 323's batch-4 post-state).
PRODUCTION_PRE_SUMMARY = {
    'types': {'count': 5, 'md5': '12d5c67500e367470d000abab7e3cd4d'},
    'views': {'count': 0, 'md5': 'd751713988987e9331980363e24189ce'},
    'tables': {'count': 251, 'md5': '72e64110a4954bffafdac22c66bb4fc3'},
    'functions': {'count': 1245, 'md5': '9964c1ef8459c3e25677d47b5a2ad1cc'},
    'sequences': {'count': 8, 'md5': 'd1c660422dcc33967578c00a63a1b3e5'},
    'extensions': {'count': 6, 'md5': '5c2a24b528337a3bf52348d5c2c8ac8a'},
    'schema_acls': {'count': 2, 'md5': '61bd2caad5658e5e02638b5bb94b48bd'},
    'storage_buckets': {'count': 3, 'md5': 'e9ba83ea6ffdf8a041ff16ab32bb6019'},
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
    commit = rev_parse(f'{head}^{{commit}}')
    want, have = rev_parse(f'{REV}:supabase/migrations'), rev_parse(f'{commit}:supabase/migrations')
    if have != want:
        raise SystemExit(f'head {commit}: supabase/migrations tree {have} is not the rehearsed {REV[:8]} tree {want}')
    return commit, want


def migration_list():
    def tree(rev):
        out = git('ls-tree', '-r', rev, 'supabase/migrations/').decode()
        entries = {}
        for line in out.splitlines():
            meta, path = line.split('\t', 1)
            entries[path] = meta.split()[2]
        return entries
    if rev_parse(f'{MAIN}^{{commit}}') != MAIN or rev_parse(f'{REV}^{{commit}}') != REV:
        raise SystemExit('main or the release commit is missing; git fetch origin first')
    if git('merge-base', MAIN, REV).decode().strip() != MAIN:
        raise SystemExit(f'main {MAIN[:8]} is not an ancestor of {REV[:8]}')
    new, old = tree(REV), tree(MAIN)
    if len(old) != EXPECTED_MAIN:
        raise SystemExit(f'main has {len(old)} migration files, expected {EXPECTED_MAIN}')
    for path, blob in old.items():  # main's migrations are untouched by the branch
        if new.get(path) != blob:
            raise SystemExit(f'main migration changed or missing in {REV}: {path}')
    files = sorted(p for p in new if p not in old)
    # The same list as `git diff --name-only <main>...<rev> -- supabase/migrations`.
    three_dot = sorted(git('diff', '--name-only', '--no-renames', f'{MAIN}...{REV}', '--',
                           'supabase/migrations').decode().split())
    if three_dot != files:
        raise SystemExit('ls-tree and three-dot diff disagree on the migration list')
    names = [os.path.basename(p) for p in files]
    if len(names) != EXPECTED_NEW or not all(re.fullmatch(r'\d{14}_[a-z0-9_]+\.sql', n) for n in names):
        raise SystemExit('unexpected migration list')
    if min(n[:14] for n in names) <= LEDGER_PRE_MAX:
        raise SystemExit('a new version is not above the production ledger max')
    return files


def load_migrations():
    out = []
    for i, path in enumerate(migration_list(), 1):
        data = git('show', f'{REV}:{path}')
        text = data.decode('utf-8')  # strict: must be valid UTF-8
        if '\x00' in text:
            raise SystemExit(f'NUL byte in {path}')
        base = os.path.basename(path)
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


def check_pre_summary():
    # The constant must be the summary production read back after PR 323.
    if os.path.exists(PR323_POST):
        if json.load(open(PR323_POST))['summary'] != PRODUCTION_PRE_SUMMARY:
            raise SystemExit('PRODUCTION_PRE_SUMMARY is not fp-after-merge.json of PR 323')


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
             f'-- Generated by generate.py from git show {REV[:8]}:<path> (main {MAIN[:8]}).',
             '-- One DO statement: atomic under any client protocol. Run with a session-level',
             "-- statement_timeout of at most 180s (psql -c \"set statement_timeout = '180s'\" -f <this file>,",
             '-- or the Management API endpoint, whose session has 2min); the block refuses otherwise,',
             '-- because a SET inside the block cannot bound the statement that is already running.']
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
    title = (f'Guarded production release of PR 324, batch {k} of {len(BATCHES)} (#{lo}-#{hi}). batch-{k}-dry-run.sql is batch-{k}-apply.sql'
             ' with one final raise of DRY_RUN_COMPLETE_ALL_CHECKS_PASSED, so it rolls everything back.')
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


def build_measure(all_migs, fp_text, fp_md5):
    outer = '$inherit_release_measure_do$'
    check_tags(all_migs, fp_text, outer)
    out = [header_lines('LOCAL ONLY: measure the fingerprint summary after each batch on the production mirror; always raises, so nothing persists', all_migs, []),
           f'do {outer}\n',
           declare_section(all_migs, fp_text, [f"  expected_pre constant jsonb := {sql_literal(canonical(PRODUCTION_PRE_SUMMARY))};\n",
                                               "  result jsonb := '{}';\n  t0 timestamptz;\n"]),
           'begin\n', guards_and_integrity(all_migs, fp_md5), ledger_predecessor(all_migs, 1),
           fingerprint_read('fp'), summary_check('predecessor', 'expected_pre')]
    for k, (lo, hi) in enumerate(BATCHES, 1):
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
    title = (f'Guarded production release of PR 324, ALL batches in one DRY RUN (#1-#{len(all_migs)}): every batch check, then a final raise of '
             'DRY_RUN_COMPLETE_ALL_CHECKS_PASSED, so it rolls everything back. Never an apply.')
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


def main():
    args = sys.argv[1:]
    head = 'HEAD'
    if args[:1] == ['--head']:
        if len(args) < 2:
            raise SystemExit('--head needs a revision')
        head, args = args[1], args[2:]
    mode = args[0] if args else ''
    commit, tree = verify_head(head)
    check_pre_summary()
    migs = load_migrations()
    check_batches(len(migs))
    fp_text, fp_md5 = load_fingerprint()
    print(f'head {commit}: supabase/migrations tree {tree} == {REV[:8]}', file=sys.stderr)
    if mode == 'list':
        for m in migs:
            k = next(i for i, (lo, hi) in enumerate(BATCHES, 1) if lo <= m['index'] <= hi)
            print(f"batch {k} #{m['index']:02d} {m['file']} {m['bytes']} {m['sha256']}")
        return
    os.makedirs(LOCAL, exist_ok=True)
    if mode == 'measure':
        p = os.path.join(LOCAL, 'measure-all.sql')
        open(p, 'w', encoding='utf-8').write(build_measure(migs, fp_text, fp_md5))
        print(p, sha256_file(p))
    elif mode == 'record':
        text = open(args[1], encoding='utf-8').read()
        m = re.search(r'ERROR:  MEASURED_SUMMARIES (\{.*\})', text)
        if not m:
            raise SystemExit('no MEASURED_SUMMARIES line')
        measured = json.loads(m.group(1))
        exp = {'batch0': PRODUCTION_PRE_SUMMARY}
        for k in range(1, len(BATCHES) + 1):
            exp[f'batch{k}'] = measured[f'batch{k}']
            if sorted(exp[f'batch{k}']) != CATEGORIES:
                raise SystemExit('unexpected categories')
        p = os.path.join(LOCAL, 'expected-summaries.json')
        json.dump({'summaries': exp, 'measure_seconds': {k: v for k, v in measured.items() if k.endswith('_seconds')}},
                  open(p, 'w'), indent=1, sort_keys=True)
        print(p)
    elif mode == 'final':
        exp = json.load(open(os.path.join(LOCAL, 'expected-summaries.json')))['summaries']
        if exp['batch0'] != PRODUCTION_PRE_SUMMARY:
            raise SystemExit('batch0 is not the production summary')
        if sorted(exp) != [f'batch{k}' for k in range(len(BATCHES) + 1)]:
            raise SystemExit('local/expected-summaries.json does not match the batch cut; measure and record again')
        written = ['expected-summaries.json']
        with open(os.path.join(HERE, 'expected-summaries.json'), 'w') as f:
            json.dump({'batches': [{'batch': k, 'first': lo, 'last': hi,
                                    'versions': [m['version'] for m in migs if lo <= m['index'] <= hi],
                                    'pre_summary': exp[f'batch{k - 1}'], 'post_summary': exp[f'batch{k}']}
                                   for k, (lo, hi) in enumerate(BATCHES, 1)],
                       'ledger_pre': {'count': LEDGER_PRE_COUNT, 'max': LEDGER_PRE_MAX}}, f, indent=1, sort_keys=True)
            f.write('\n')
        for k in range(1, len(BATCHES) + 1):
            pre, post = exp[f'batch{k - 1}'], exp[f'batch{k}']
            texts = {}
            for mode_k, path in (('apply', f'batch-{k}-apply.sql'), ('dry-run', f'batch-{k}-dry-run.sql'),
                                 ('probe', os.path.join('local', f'batch-{k}-probe.sql'))):
                texts[mode_k] = build_batch(migs, fp_text, fp_md5, k, pre, post, mode_k)
                open(os.path.join(HERE, path), 'w', encoding='utf-8').write(texts[mode_k])
                written.append(path)
            a = texts['apply'].split('\n'); d = texts['dry-run'].split('\n')
            diff = [(i, x, y) for i, (x, y) in enumerate(zip(a, d)) if x != y]
            # apply and dry-run differ only in the one raise line
            if len(a) != len(d) or len(diff) != 1 or diff[0][1] != '' or diff[0][2] != DRY_RUN_LINE:
                raise SystemExit(f'batch {k}: dry-run is not the apply plus the final raise')
        open(os.path.join(HERE, 'all-batches-dry-run.sql'), 'w', encoding='utf-8').write(
            build_all_dry_run(migs, fp_text, fp_md5, exp))
        written.append('all-batches-dry-run.sql')
        open(os.path.join(HERE, 'fingerprint.sql'), 'w', encoding='utf-8').write(fp_text)  # the reviewed read-back query
        written.append('fingerprint.sql')
        with open(os.path.join(HERE, 'SHA256SUMS'), 'w') as f:
            for path in ['generate.py', 'check-readback.py', 'production-readonly-prechecks.sql',
                         'local/expected-summaries.json'] + written:
                f.write(f'{sha256_file(os.path.join(HERE, path))}  {path}\n')
        print(open(os.path.join(HERE, 'SHA256SUMS')).read(), end='')
    else:
        raise SystemExit('usage: generate.py [--head REV] measure | record <psql-output> | final | list')


if __name__ == '__main__':
    main()
