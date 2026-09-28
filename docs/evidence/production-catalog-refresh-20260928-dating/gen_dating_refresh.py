"""Guarded citations-only refresh of the production report catalog after PR #247 (citation access
dates, G4.7). Same guarded shape as the CF and corrections refreshes (reuses catalog_digest_lib.py).

Usage (from a repository worktree):
  python3 gen_dating_refresh.py <dir-with-catalog_digest_lib.py> <pred-ref> <succ-ref> <out-dir>

pred-ref: the commit whose catalog production holds now (main after the CF refresh, f40e6174).
succ-ref: main after #247 merged (1291052f).
The generator refuses unless, on every changed row, title, summary, variants, category, evidence,
layer, estimate kind and pgs_id are identical: only citations may change. Only citations and
updated_at are written.
"""
import hashlib, json, os, subprocess, sys

SP, PRED_REF, SUCC_REF, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sys.path.insert(0, SP)
import catalog_digest_lib as L  # noqa: E402

PUBLISHED = 162


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, text=True, check=True).stdout


def full(ref):
    return git('rev-parse', ref).strip()


def templates_at(sha, path, raw=False):
    text = git('show', f'{sha}:{path}')
    return json.loads(text) if raw else json.loads(text, parse_float=L.pnum, parse_int=L.Num)


def plain(v):
    return getattr(v, 's', v)


def dq(value, tag):
    assert f'${tag}$' not in value, tag
    return f'${tag}${value}${tag}$'


pred_sha, succ_sha = full(PRED_REF), full(SUCC_REF)


def catalog(sha, raw=False):
    rows, files = {}, {}
    for name in sorted(git('ls-tree', '--name-only', f'{sha}:data/templates').split()):
        if not name.endswith('.json'):
            continue
        for t in templates_at(sha, f'data/templates/{name}', raw=raw):
            if plain(t['evidence']) == 'insufficient':
                continue
            assert t['slug'] not in rows, t['slug']
            rows[t['slug']] = t
            files[t['slug']] = f'data/templates/{name}'
    return rows, files


pred_all, _ = catalog(pred_sha)
succ_all, file_of = catalog(succ_sha)
raw_succ, _ = catalog(succ_sha, raw=True)
assert sorted(pred_all) == sorted(succ_all), 'slug sets differ'
assert len(succ_all) == PUBLISHED, len(succ_all)
changed = sorted(s for s in succ_all if L.digest_template(pred_all[s]) != L.digest_template(succ_all[s]))
assert changed, 'no row changed'
pd = {s: L.digest_template(pred_all[s]) for s in changed}
sd = {s: L.digest_template(succ_all[s]) for s in changed}
for s in changed:
    assert (pd[s]['t'], pd[s]['s'], pd[s]['v']) == (sd[s]['t'], sd[s]['s'], sd[s]['v']), f'{s}: more than citations changed'
    for k in ('category', 'evidence', 'pgs_id', 'layer', 'estimate_kind'):
        assert plain(pred_all[s].get(k)) == plain(succ_all[s].get(k)), (s, k)
    # Every change is an added accessedOn on an otherwise identical citation list.
    pc, sc = pred_all[s]['citations'], succ_all[s]['citations']
    assert len(pc) == len(sc), s
    for a, b in zip(pc, sc):
        a2 = {k: plain(v) for k, v in a.items() if k != 'accessedOn'}
        b2 = {k: plain(v) for k, v in b.items() if k != 'accessedOn'}
        assert a2 == b2, (s, 'a citation changed beyond its access date')
        assert 'accessedOn' not in a or plain(a['accessedOn']) == plain(b.get('accessedOn')), (s, 'an existing date changed')


def tup(s, d):
    return f"('{s}','{d['c']}')"


def guard_values(digs):
    return ',\n    '.join(tup(s, digs[s]) for s in changed)


def updates():
    out = []
    for i, s in enumerate(changed):
        n = raw_succ[s]
        out.append(f"""  update public.report_templates set
    citations = {dq(json.dumps(n['citations'], ensure_ascii=False), f'c{i}')}::jsonb,
    updated_at = now()
  where slug = '{s}' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', '{s}', changed; end if;""")
    return '\n'.join(out)


N = len(changed)
SLUG_LIST = ', '.join("'" + s + "'" for s in changed)


def body(final):
    return f"""-- D-134: guarded refresh of the production report catalog after PR #247 (citation access
-- dates, G4.7). {N} rows of report_templates; only citations and updated_at are written. On every
-- row the only change is an access date added to a citation that was retrieved and checked.
-- Predecessor digests are data/templates at {pred_sha};
-- successor digests are data/templates at {succ_sha}.
-- Completed reports are untouched: private.capture_own_report_catalog_v1 keeps them immutable.
do $refresh$
declare changed integer; matched integer; published integer;
begin
  perform set_config('lock_timeout', '1000', true);
  perform set_config('statement_timeout', '15000', true);
  perform set_config('idle_in_transaction_session_timeout', '15000', true);

  perform 1 from public.report_templates where slug in ({SLUG_LIST}) order by slug for update;

  select count(*) into matched from public.report_templates t
  join (values
    {guard_values(pd)}
  ) g(slug, c_md5)
    on g.slug = t.slug and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> {N} then raise exception 'catalog_refresh_predecessor_guard: % of {N} rows hold the predecessor citations', matched; end if;

{updates()}

  select count(*) into matched from public.report_templates t
  join (values
    {guard_values(sd)}
  ) g(slug, c_md5)
    on g.slug = t.slug and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> {N} then raise exception 'catalog_refresh_successor_check: % of {N} rows match the dated citations', matched; end if;

  select count(*) into published from public.report_templates where status = 'published';
  if published <> {PUBLISHED} then raise exception 'catalog_refresh_published_count: %', published; end if;
{final}
end
$refresh$;
"""


def catalog_digest(rows):
    lines = []
    for slug in sorted(rows, key=lambda s: s.encode()):
        t = rows[slug]
        layer = plain(t.get('layer')) or 'estimate'
        kind = None if layer == 'variant_call' else (
            plain(t.get('estimate_kind')) or ('polygenic_score' if t.get('pgs_id') else 'single_locus'))
        d = L.digest_template(t)
        lines.append('|'.join([slug, t['category'], plain(t['evidence']), layer, kind or '',
                               plain(t.get('pgs_id')) or '', d['t'], d['s'], d['v'], d['c']]))
    return hashlib.md5('\n'.join(lines).encode()).hexdigest(), len(lines)


pred_cat, succ_cat = catalog_digest(pred_all), catalog_digest(succ_all)


def state_case():
    pred = ' or '.join(f"(t.slug = '{s}' and md5(t.citations::text) = '{pd[s]['c']}')" for s in changed)
    succ = ' or '.join(f"(t.slug = '{s}' and md5(t.citations::text) = '{sd[s]['c']}')" for s in changed)
    return f"case when {pred} then 'predecessor' when {succ} then 'successor' else 'neither' end"


COMMON = f"""with p as (select * from public.report_templates where status = 'published'),
corr as (select * from public.report_templates where slug in ({SLUG_LIST}) and status = 'published')
select '01 rows_in_predecessor' as check_name,
       (select count(*)::text from corr t where ({state_case()}) = 'predecessor') as value
union all select '02 rows_in_successor', (select count(*)::text from corr t where ({state_case()}) = 'successor')
union all select '03 rows_neither', (select count(*)::text from corr t where ({state_case()}) = 'neither')
union all select '04 published', (select count(*)::text from p)
union all select '05 catalog_md5', (select md5(string_agg(concat_ws('|', slug, category, evidence::text, layer::text,
    coalesce(estimate_kind::text, ''), coalesce(pgs_id, ''), md5(title), md5(summary),
    md5(variants::text), md5(citations::text)), E'\\n' order by slug collate "C")) from p)
union all select '06 runs_not_complete', (select count(*)::text from private.own_analysis_runs where state <> 'complete')"""

precheck = f"""-- Read-only pre-check for the {N}-row citation-dating refresh. One SELECT; it writes nothing.
-- Expected before: 01 = {N}; 02 = 0; 03 = 0; 04 = {PUBLISHED};
--   05 = {pred_cat[0]} (data/templates at {pred_sha[:8]}); 06 = 0.
{COMMON}
 order by 1;
"""

postcheck = f"""-- Read-only post-check for the {N}-row citation-dating refresh. One SELECT; it writes nothing.
-- Expected after: 01 = 0; 02 = {N}; 03 = 0; 04 = {PUBLISHED};
--   05 = {succ_cat[0]} (data/templates at {succ_sha[:8]}).
{COMMON}
 order by 1;
"""

os.makedirs(OUT, exist_ok=True)
outputs = {
    'refresh.sql': body('  -- Commit.'),
    'refresh-dryrun.sql': body("  raise exception 'catalog_refresh_dry_run_ok: guard and successor check passed; rolled back';"),
    'precheck.sql': precheck,
    'postcheck.sql': postcheck,
}
for name, content in outputs.items():
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(content)
digests = {s: {'predecessorCitationsMd5': pd[s]['c'], 'successorCitationsMd5': sd[s]['c'], 'templatePath': file_of[s]}
           for s in changed}
digests['_catalog'] = {
    'predecessor': {'commit': pred_sha, 'catalogMd5': pred_cat[0], 'published': pred_cat[1]},
    'successor': {'commit': succ_sha, 'catalogMd5': succ_cat[0], 'published': succ_cat[1]},
    'changedRows': changed,
}
with open(os.path.join(OUT, 'digests.json'), 'w') as f:
    json.dump(digests, f, indent=2)
    f.write('\n')
for name in (*outputs, 'digests.json'):
    s = open(os.path.join(OUT, name)).read()
    print(name, len(s.encode()), 'bytes sha256', hashlib.sha256(s.encode()).hexdigest())
print('changed rows', N)
print('catalog md5 predecessor', pred_cat, 'successor', succ_cat)


# Compact form: add each access date in place. The whole-catalog digest guards every field of all
# 162 published rows before (predecessor) and after (successor), so nothing else can differ.
pairs = []
for s in changed:
    for i, (a, b) in enumerate(zip(pred_all[s]['citations'], succ_all[s]['citations'])):
        if 'accessedOn' not in a and 'accessedOn' in b:
            pairs.append((s, i, plain(b['accessedOn'])))
assert all(p[2] == '2026-09-28' for p in pairs), sorted({p[2] for p in pairs})
CATALOG_MD5 = """(select md5(string_agg(concat_ws('|', slug, category, evidence::text, layer::text,
    coalesce(estimate_kind::text, ''), coalesce(pgs_id, ''), md5(title), md5(summary),
    md5(variants::text), md5(citations::text)), E'\\n' order by slug collate "C"))
     from public.report_templates where status = 'published')"""
values = ',\n    '.join(f"('{s}',{i})" for s, i, _ in pairs)


def compact(final):
    return f"""-- D-134: guarded refresh of the production report catalog after PR #247 (citation access
-- dates, G4.7). {N} published rows of report_templates; {len(pairs)} citations gain
-- "accessedOn": "2026-09-28". Only citations and updated_at are written.
-- Guards: the whole published catalog (every field digested for all {PUBLISHED} rows) must equal
-- data/templates at {pred_sha} before, and data/templates at {succ_sha} after.
-- Completed reports are untouched: private.capture_own_report_catalog_v1 keeps them immutable.
do $refresh$
declare changed integer; published integer; digest text;
begin
  perform set_config('lock_timeout', '1000', true);
  perform set_config('statement_timeout', '15000', true);
  perform set_config('idle_in_transaction_session_timeout', '15000', true);

  perform 1 from public.report_templates where status = 'published' order by slug for update;
  digest := {CATALOG_MD5};
  if digest is distinct from '{pred_cat[0]}' then
    raise exception 'catalog_refresh_predecessor_guard: catalog md5 %', digest; end if;

  with d(slug, idx) as (values
    {values}
  ), a as (select slug, array_agg(idx) as idxs from d group by slug)
  update public.report_templates t set
    citations = (select jsonb_agg(case when (e.ord - 1)::int = any(a.idxs)
        then e.c || jsonb_build_object('accessedOn', '2026-09-28') else e.c end order by e.ord)
      from jsonb_array_elements(t.citations) with ordinality e(c, ord)),
    updated_at = now()
  from a where t.slug = a.slug and t.status = 'published';
  get diagnostics changed = row_count;
  if changed <> {N} then raise exception 'catalog_refresh_update_count: %', changed; end if;

  digest := {CATALOG_MD5};
  if digest is distinct from '{succ_cat[0]}' then
    raise exception 'catalog_refresh_successor_check: catalog md5 %', digest; end if;
  select count(*) into published from public.report_templates where status = 'published';
  if published <> {PUBLISHED} then raise exception 'catalog_refresh_published_count: %', published; end if;
{final}
end
$refresh$;
"""


check = f"""-- Read-only. One SELECT; it writes nothing. Before the refresh expect catalog_md5 = {pred_cat[0]};
-- after it expect {succ_cat[0]}. published = {PUBLISHED}; runs_not_complete = 0.
select {CATALOG_MD5} as catalog_md5,
  (select count(*) from public.report_templates where status = 'published') as published,
  (select count(*) from private.own_analysis_runs where state <> 'complete') as runs_not_complete;
"""
for name, content in (('compact-refresh.sql', compact('  -- Commit.')),
                      ('compact-refresh-dryrun.sql', compact("  raise exception 'catalog_refresh_dry_run_ok: guard and successor check passed; rolled back';")),
                      ('check.sql', check)):
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(content)
    print(name, len(content.encode()), 'bytes sha256', hashlib.sha256(content.encode()).hexdigest())
print('dated citations', len(pairs))
