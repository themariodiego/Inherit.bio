-- Report taxonomy and evidence rubric (v2 workstream W2).
--
-- 1. public.evidence_level becomes the five-level rubric
--    ('clinical', 'established', 'emerging', 'preliminary', 'insufficient').
--    Existing rows are re-mapped deterministically and never upgraded:
--    established -> emerging, moderate -> emerging, preliminary -> preliminary.
--    Postgres cannot drop an enum value and cannot use a value added by
--    ALTER TYPE ... ADD VALUE inside the same transaction, so the column is
--    swapped onto a freshly created type and the old type is dropped.
-- 2. Every relabel writes one public.changelog_entries row
--    (kind = 'evidence_relabel') naming the old level, the new level and the
--    reason, so the relabel is published rather than silent.
-- 3. public.report_templates gains layer (public.finding_layer) and
--    estimate_kind, backfilled as estimate / single_locus (or polygenic_score
--    when pgs_id is set), plus compliance_exempt_until: the 180-day window in
--    which templates published before this migration are exempt from the
--    two-reviewer rule (2026-09-03 + 180 days = 2027-03-02).
-- 4. Publication guards as CHECK constraints: an 'insufficient' template is
--    never published, and a polygenic score is never published at
--    'preliminary' or 'insufficient'.
--
-- Additive: report_templates keeps its public-read policy and default grants;
-- no revoke is issued here. New columns are readable through the existing
-- policy.

-- ---------------------------------------------------------------------------
-- 1. Capture the pre-migration evidence level per slug BEFORE the type swap.
-- ---------------------------------------------------------------------------
create temp table evidence_remap on commit drop as
select slug, evidence::text as old_level
from public.report_templates
where evidence in ('established', 'moderate');

-- ---------------------------------------------------------------------------
-- 2. Five-level evidence rubric: new type, column swap with deterministic
--    remap, retire the old type, take over its name.
-- ---------------------------------------------------------------------------
create type public.evidence_level_v2 as enum (
  'clinical', 'established', 'emerging', 'preliminary', 'insufficient'
);

alter table public.report_templates
  alter column evidence type public.evidence_level_v2
  using (
    case evidence::text
      when 'established' then 'emerging'
      when 'moderate' then 'emerging'
      when 'preliminary' then 'preliminary'
    end
  )::public.evidence_level_v2;

-- Only report_templates.evidence depended on the old type.
drop type public.evidence_level;
alter type public.evidence_level_v2 rename to evidence_level;

-- ---------------------------------------------------------------------------
-- 3. Finding layer and estimate kind.
-- ---------------------------------------------------------------------------
create type public.finding_layer as enum ('variant_call', 'estimate');

alter table public.report_templates
  add column layer public.finding_layer,
  add column estimate_kind text;

update public.report_templates
set layer = 'estimate',
    estimate_kind = case
      when pgs_id is not null then 'polygenic_score'
      else 'single_locus'
    end;

-- Writers that omit layer (seed, research drafts) get 'estimate'; both
-- writers also set it explicitly.
alter table public.report_templates
  alter column layer set not null,
  alter column layer set default 'estimate';

alter table public.report_templates
  add constraint report_templates_estimate_kind_check
    check (layer <> 'estimate' or estimate_kind in ('single_locus', 'polygenic_score'))
    not valid,
  add constraint report_templates_variant_call_shape_check
    check (layer <> 'variant_call' or (pgs_id is null and variants <> '[]'::jsonb))
    not valid,
  add constraint report_templates_polygenic_pgs_check
    check (estimate_kind <> 'polygenic_score' or pgs_id is not null)
    not valid,
  -- Closes the three-valued-logic hole in the first check: an estimate row
  -- with a NULL estimate_kind would otherwise pass it.
  add constraint report_templates_estimate_kind_present_check
    check (layer <> 'estimate' or estimate_kind is not null)
    not valid;

alter table public.report_templates
  validate constraint report_templates_estimate_kind_check;
alter table public.report_templates
  validate constraint report_templates_variant_call_shape_check;
alter table public.report_templates
  validate constraint report_templates_polygenic_pgs_check;
alter table public.report_templates
  validate constraint report_templates_estimate_kind_present_check;

-- ---------------------------------------------------------------------------
-- 4. Review-compliance window for templates that predate this migration.
-- ---------------------------------------------------------------------------
alter table public.report_templates
  add column compliance_exempt_until date;

-- Migration date 2026-09-03 + 180 days.
update public.report_templates
set compliance_exempt_until = date '2027-03-02';

-- ---------------------------------------------------------------------------
-- 5. Publication guards.
-- ---------------------------------------------------------------------------
alter table public.report_templates
  add constraint report_templates_insufficient_never_published_check
    check (status <> 'published' or evidence <> 'insufficient')
    not valid,
  add constraint report_templates_polygenic_publish_evidence_check
    check (not (
      status = 'published'
      and estimate_kind = 'polygenic_score'
      and evidence in ('preliminary', 'insufficient')
    ))
    not valid;

alter table public.report_templates
  validate constraint report_templates_insufficient_never_published_check;
alter table public.report_templates
  validate constraint report_templates_polygenic_publish_evidence_check;

-- ---------------------------------------------------------------------------
-- 6. Changelog: structured relabel columns and one row per relabelled template.
-- ---------------------------------------------------------------------------
alter table public.changelog_entries
  add column kind text
    constraint changelog_entries_kind_check
    check (kind is null or kind in ('new_report', 'evidence_relabel')),
  add column evidence_before text,
  add column evidence_after text;

insert into public.changelog_entries (
  title, body, template_slug, kind, evidence_before, evidence_after
)
select
  'Evidence label re-mapped: ' || t.title,
  'Evidence level changed from ' || r.old_level || ' to ' || t.evidence::text
    || '. Reason: re-mapped to the new evidence rubric; not a change of finding.',
  t.slug,
  'evidence_relabel',
  r.old_level,
  t.evidence::text
from evidence_remap r
join public.report_templates t on t.slug = r.slug;

-- ---------------------------------------------------------------------------
-- 7. Guard: the remap must be complete and fully published.
-- ---------------------------------------------------------------------------
do $$
declare
  captured bigint;
  relabelled bigint;
begin
  select count(*) into captured from evidence_remap;
  select count(*) into relabelled
  from public.changelog_entries
  where kind = 'evidence_relabel';

  if exists (
    select 1 from public.report_templates
    where evidence::text in ('established', 'moderate', 'clinical')
  ) then
    raise exception 'evidence rubric migration left a report_templates row at established, moderate or clinical';
  end if;
  if exists (select 1 from public.report_templates where layer is null) then
    raise exception 'evidence rubric migration left a report_templates row with a null layer';
  end if;
  if exists (
    select 1 from public.report_templates
    where layer = 'estimate' and estimate_kind is null
  ) then
    raise exception 'evidence rubric migration left an estimate template without an estimate_kind';
  end if;
  if relabelled <> captured then
    raise exception 'evidence relabel wrote % changelog rows for % captured templates',
      relabelled, captured;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Column documentation.
-- ---------------------------------------------------------------------------
comment on column public.report_templates.layer is
  'Finding layer: variant_call (a call on specific variants classified against an external clinical framework) or estimate (a modelled statistical association). Recorded as data, never derived at render time.';
comment on column public.report_templates.estimate_kind is
  'For layer = estimate: single_locus (one variant, an association effect size) or polygenic_score (weighted alleles summed across many loci; requires pgs_id). Null for variant_call.';
comment on column public.report_templates.compliance_exempt_until is
  'Templates published before the evidence-rubric migration are exempt from the two-reviewer rule until this date (migration date + 180 days). Null for templates created afterwards; never extended.';
comment on column public.changelog_entries.kind is
  'null for free-form entries; new_report for a publication; evidence_relabel for a rubric re-mapping (evidence_before / evidence_after carry the levels).';
