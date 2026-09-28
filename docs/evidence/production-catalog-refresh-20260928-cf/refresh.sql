-- D-134: guarded refresh of the production report catalog; owner-approved 2026-09-28
-- (docs/protocol/decisions.md, "The live cystic fibrosis report is reworded now").
-- One row: cystic-fibrosis-cftr-f508del-informational. It drops "carrier status" and the per-pregnancy 1-in-4 sentence and keeps
-- the finding, the caveats and the laboratory line.
-- Predecessor digests are data/templates/reproductive-family.json at 1ca33c6bd75c8db8a44cfc99495a5bc34ad57ab8;
-- successor digests are data/templates/reproductive-family.json at f40e61745433c278c112e0cb4dfd75af1f3431c7.
-- Only title, summary, variants, citations and updated_at are written; only variants differ.
-- Completed reports are untouched: private.capture_own_report_catalog_v1 keeps them immutable.
do $refresh$
declare changed integer; matched integer; published integer;
begin
  perform set_config('lock_timeout', '1000', true);
  perform set_config('statement_timeout', '15000', true);
  perform set_config('idle_in_transaction_session_timeout', '15000', true);

  perform 1 from public.report_templates where slug in ('cystic-fibrosis-cftr-f508del-informational') order by slug for update;

  select count(*) into matched from public.report_templates t
  join (values
    ('cystic-fibrosis-cftr-f508del-informational','b0289336feb2b4210eb27a05a597bca4','60fcce5c964bda69e91c342dcd91dfe6','d63a1ddeeb98332d5e24c46ee23db688','31175e116a7ccbb068b21acf84fd801c')
  ) g(slug, t_md5, s_md5, v_md5, c_md5)
    on g.slug = t.slug and md5(t.title) = g.t_md5 and md5(t.summary) = g.s_md5
   and md5(t.variants::text) = g.v_md5 and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> 1 then raise exception 'catalog_refresh_predecessor_guard: % of 1 rows hold the predecessor text', matched; end if;

  update public.report_templates set
    title = $t0$CFTR F508del status (informational) · CFTR$t0$,
    summary = $s0$F508del is the most common cystic fibrosis (CF) variant. It makes up about 70% of CF alleles in people with European ancestry. About 1 in 25 to 30 people in that group carries one copy. This report checks only F508del. It is not carrier screening. Clinical screening tests many CFTR variants. If you are planning a family and want carrier information, ask a doctor or genetic counselor about proper testing.$s0$,
    variants = $v0$[{"rsid": 113993960, "gene": "CFTR", "chrom": 7, "pos38": 117559591, "ref": "TCTT", "alt": "T", "interpretations": {"TCTTTCTT": "No F508del deletion detected at this site. Important caveat: this checks only one CFTR variant out of the hundreds that can cause cystic fibrosis, so it does not rule out the others. Clinical carrier screening, which covers many CFTR variants, is the appropriate route for family-planning decisions; a genetic counselor can explain the options.", "TTCTT": "One copy of F508del. Consumer arrays can misread this site. A clinical lab should confirm the result before you act on it. A genetic counselor can explain what it means for family planning.", "TT": "Two copies of F508del. This is the most common genotype in people with CF, which is usually found in childhood. This result would be unexpected in an adult with no known CF. An array error is likely because this site is hard to read. A clinical lab should confirm the result. You should also speak with a genetic counselor."}}]$v0$::jsonb,
    citations = $c0$[{"pmid": "2475911", "label": "Riordan et al., Science 1989"}]$c0$::jsonb,
    updated_at = now()
  where slug = 'cystic-fibrosis-cftr-f508del-informational' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'cystic-fibrosis-cftr-f508del-informational', changed; end if;

  select count(*) into matched from public.report_templates t
  join (values
    ('cystic-fibrosis-cftr-f508del-informational','b0289336feb2b4210eb27a05a597bca4','60fcce5c964bda69e91c342dcd91dfe6','9d86287c109cb8bb89e6df17338a488e','31175e116a7ccbb068b21acf84fd801c')
  ) g(slug, t_md5, s_md5, v_md5, c_md5)
    on g.slug = t.slug and md5(t.title) = g.t_md5 and md5(t.summary) = g.s_md5
   and md5(t.variants::text) = g.v_md5 and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> 1 then raise exception 'catalog_refresh_successor_check: % of 1 rows match the reworded text', matched; end if;

  select count(*) into published from public.report_templates where status = 'published';
  if published <> 162 then raise exception 'catalog_refresh_published_count: %', published; end if;
  -- Commit.
end
$refresh$;
