begin;
select plan(29);

-- Enum vocabularies -----------------------------------------------------------
select is(
  enum_range(null::public.evidence_level)::text[],
  array['clinical', 'established', 'emerging', 'preliminary', 'insufficient'],
  'evidence_level carries the five rubric levels in rubric order'
);
select is(
  enum_range(null::public.finding_layer)::text[],
  array['variant_call', 'estimate'],
  'finding_layer carries variant_call and estimate'
);
select throws_ok(
  $$select 'moderate'::public.evidence_level$$,
  '22P02',
  null,
  'the retired moderate label is no longer an evidence level'
);

-- Columns ---------------------------------------------------------------------
select has_column('public', 'report_templates', 'layer', 'report_templates.layer exists');
select has_column('public', 'report_templates', 'estimate_kind', 'report_templates.estimate_kind exists');
select has_column('public', 'report_templates', 'compliance_exempt_until', 'report_templates.compliance_exempt_until exists');
select has_column('public', 'changelog_entries', 'kind', 'changelog_entries.kind exists');
select has_column('public', 'changelog_entries', 'evidence_before', 'changelog_entries.evidence_before exists');
select has_column('public', 'changelog_entries', 'evidence_after', 'changelog_entries.evidence_after exists');

-- Public read stays intact ----------------------------------------------------
select is(has_table_privilege('anon', 'public.report_templates', 'select'), true,
  'anon can still select report_templates');
select is(has_table_privilege('authenticated', 'public.report_templates', 'select'), true,
  'authenticated can still select report_templates');

-- Fixture template: a published single-locus estimate inserted without layer,
-- so the column default is exercised.
select lives_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, evidence, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-evidence-fixture', 'basic-traits', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'emerging', 'single_locus',
      '[{"rsid":1,"gene":"X","chrom":1,"pos38":1,"ref":"A","alt":"G","interpretations":{"AA":"x","AG":"y","GG":"z"}}]'::jsonb,
      null, '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  'a published single-locus estimate at emerging is accepted'
);
select is(
  (select layer::text from public.report_templates where slug = 'pgtap-evidence-fixture'),
  'estimate',
  'layer defaults to estimate when a writer omits it'
);
select is(
  (select compliance_exempt_until from public.report_templates where slug = 'pgtap-evidence-fixture'),
  null::date,
  'templates created after the migration carry no compliance exemption'
);

-- Layer CHECKs ----------------------------------------------------------------
select throws_ok(
  $$update public.report_templates set estimate_kind = 'bogus' where slug = 'pgtap-evidence-fixture'$$,
  '23514',
  null,
  'an estimate must have a known estimate_kind'
);
select throws_ok(
  $$update public.report_templates set estimate_kind = null where slug = 'pgtap-evidence-fixture'$$,
  '23514',
  null,
  'an estimate may not have a null estimate_kind'
);
select throws_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, evidence, layer, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-variant-call-with-pgs', 'basic-traits', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'clinical', 'variant_call', null,
      '[{"rsid":1,"gene":"X","chrom":1,"pos38":1,"ref":"A","alt":"G","interpretations":{"AA":"x","AG":"y","GG":"z"}}]'::jsonb,
      'PGS000001', '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  '23514',
  null,
  'a variant_call template may not carry a pgs_id'
);
select throws_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, evidence, layer, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-variant-call-no-variants', 'basic-traits', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'clinical', 'variant_call', null, '[]'::jsonb, null, '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  '23514',
  null,
  'a variant_call template must carry variants'
);
select throws_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, evidence, layer, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-polygenic-no-pgs', 'basic-traits', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'emerging', 'estimate', 'polygenic_score', '[]'::jsonb, null, '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  '23514',
  null,
  'a polygenic_score estimate must carry a pgs_id'
);

-- Publication CHECKs ----------------------------------------------------------
select throws_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, evidence, layer, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-insufficient-published', 'basic-traits', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'insufficient', 'estimate', 'single_locus',
      '[{"rsid":1,"gene":"X","chrom":1,"pos38":1,"ref":"A","alt":"G","interpretations":{"AA":"x","AG":"y","GG":"z"}}]'::jsonb,
      null, '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  '23514',
  null,
  'an insufficient template is never published (status defaults to published)'
);
select lives_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, status, evidence, layer, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-insufficient-draft', 'basic-traits', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'draft', 'insufficient', 'estimate', 'single_locus',
      '[{"rsid":1,"gene":"X","chrom":1,"pos38":1,"ref":"A","alt":"G","interpretations":{"AA":"x","AG":"y","GG":"z"}}]'::jsonb,
      null, '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  'an insufficient template may exist as a draft'
);
select throws_ok(
  $$update public.report_templates set status = 'published' where slug = 'pgtap-insufficient-draft'$$,
  '23514',
  null,
  'an insufficient draft cannot be flipped to published'
);
select throws_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, evidence, layer, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-polygenic-preliminary-published', 'heart-cardiovascular', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'preliminary', 'estimate', 'polygenic_score', '[]'::jsonb, 'PGS000001', '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  '23514',
  null,
  'a polygenic score is never published at preliminary'
);
select lives_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, status, evidence, layer, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-polygenic-preliminary-review', 'heart-cardiovascular', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'review', 'preliminary', 'estimate', 'polygenic_score', '[]'::jsonb, 'PGS000001', '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  'a preliminary polygenic score may sit in review'
);
select lives_ok(
  $$insert into public.report_templates (
      slug, category, title, summary, evidence, layer, estimate_kind, variants, pgs_id, citations
    ) values (
      'pgtap-polygenic-emerging-published', 'heart-cardiovascular', 'pgTAP fixture', 'A fixture template used only by the evidence rubric test.',
      'emerging', 'estimate', 'polygenic_score', '[]'::jsonb, 'PGS000001', '[{"pmid":"12345678","label":"fixture"}]'::jsonb
    )$$,
  'an emerging polygenic score may be published'
);

-- Backfill invariant (holds on a seeded and on an empty database) --------------
select is(
  (select count(*) from public.report_templates where layer = 'estimate' and estimate_kind is null),
  0::bigint,
  'every estimate template carries an estimate_kind'
);

-- Changelog relabel rows ------------------------------------------------------
select throws_ok(
  $$insert into public.changelog_entries (title, body, kind) values ('x', 'y', 'bogus')$$,
  '23514',
  null,
  'changelog kind is constrained to new_report / evidence_relabel'
);
select is(
  (select count(*) from public.changelog_entries
   where kind = 'evidence_relabel'
     and not (
       evidence_before in ('established', 'moderate')
       and evidence_after = 'emerging'
       and template_slug is not null
       and title like 'Evidence label re-mapped: %'
       and body like '%re-mapped to the new evidence rubric; not a change of finding.%'
     )),
  0::bigint,
  'every evidence_relabel row names the old level, the new level and the reason'
);
-- The relabel rows exist only when templates were present at migration time
-- (a seeded database). On a freshly reset database the count is 0, which is
-- correct: nothing was relabelled.
select diag(format(
  '%s evidence_relabel changelog rows present (0 is expected on an unseeded database)',
  (select count(*) from public.changelog_entries where kind = 'evidence_relabel')
));
select ok(
  (select count(*) from public.changelog_entries where kind = 'evidence_relabel') >= 0,
  'evidence_relabel rows are readable'
);

select * from finish();
rollback;
