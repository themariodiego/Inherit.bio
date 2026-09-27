# ADR 0034: Embryo sex only for a serious sex-linked condition; polygenic embryo estimates for research only

- Status: Accepted (owner decision, 27 September 2026)
- Date: 2026-09-27
- Amends ADR 0019 point 5; leaves every other point of ADR 0019 in force

## Context

On 27 September 2026 the owner asked how consumer services that sell partner and
embryo analysis manage the legal risk. The research, read that day, found
that no one does it without risk, and that the lower-risk services narrow what
they report. Three findings bear on code that already exists here:

- **Embryo sex.** Identifying an embryo's sex outside a sex-linked disease is
  a criminal offence in Canada (Assisted Human Reproduction Act s.5(1)(e)) and
  India (ART Act 2021 s.26). It is barred in the United Kingdom (HFE Act Sch 2
  para 1ZB), in Germany, and under Article 14 of the Oviedo Convention. Each
  of these allows it to avoid a serious sex-linked disease. On 22 September
  the owner had asked for a DNA-based embryo sex result, and draft #189
  started building one.
- **Polygenic embryo estimates.** ACMG (2024), ASRM (December 2025), ESHG,
  ESHRE, ISPG and BGA all say polygenic embryo screening should not be offered
  clinically. ASRM limits it to research under ethics-board oversight. The UK
  regulator said in February 2026 that it is unlawful there. The embryo design
  here (ADR 0019, `absoluteRiskFinding`) supports disease estimates, with the
  condition registry still empty.
- **Structure.** Inherit has no physician order, certified laboratory or
  counsellor behind its results. Narrow scope is the protection it can build
  itself.

Asked as selectable choices, the owner chose:
- "Sex-linked disease only" for embryo sex;
- "Research only" for polygenic embryo estimates.

## Decision

1. **No embryo sex result.** Sex is never a field, label, filter, count, order
   or toggle on any embryo surface, export or job output. The standalone
   DNA-based sex result the owner asked for on 22 September is withdrawn.
2. **The one exception is a serious sex-linked condition.** X and Y calls may
   be read only to work out a registered serious sex-linked condition for that
   embryo, and the result is worded about the condition, never about sex.
   - Nothing may read them for any other purpose, and a test must enforce
     that where they are read.
   - Until such a condition is registered and its evaluation built, ADR 0019
     point 5 stands as written: non-autosomal records are discarded at ingest.
   - The evaluation also needs `embryo_single_locus`, and therefore a signed
     review, in every jurisdiction involved.
3. **Polygenic embryo estimates are research only.**
   - `embryo_statistical_estimate` is listed in
     `data/jurisdictions.json#productionPolicy.researchOnlyCapabilities`.
   - `gate:jurisdictions` refuses any real jurisdiction or subdivision that
     marks it `permitted`, and the list itself is pinned.
   - The runtime resolver (`src/lib/legal/jurisdictions.ts`, `researchOnly`)
     reads such a decision as `unreviewed`, with source `research-only`. A
     `prohibited` decision stands.
   - The TEST-LOCAL acceptance row still permits it, so the kept design stays
     tested. The design itself is kept but unreachable in production.
   - Running estimates for real people would need an ethics-board-approved
     study path, which does not exist and would need its own ADR.
4. **Everything else is unchanged:**
   - no ranking, composite or recommendation;
   - no trait, cognitive or appearance output;
   - every genetic parent signs;
   - default deny in every jurisdiction.

## Alternatives rejected

- **Keep the 22 September sex result, for US users only.** This is the
  highest legal and reputational exposure. Sex is criminal to disclose in two
  of the named markets, and restricting by declared country depends on
  declarations being truthful.
- **No sex at all, even for sex-linked disease.** Safer still, but it would
  refuse the one use every restrictive jurisdiction allows. The owner chose
  not to.
- **Drop the polygenic estimate design entirely.** This was recommended. The
  owner chose to keep the design, closed by data and runtime, so a future
  study does not start from nothing.
- **Keep disease-only estimates, reviewable per country.** Every major
  professional body rejects clinical use, and a jurisdiction review would
  have to say more than the medical consensus does.

## Consequences

- `/embryo-analysis` now says that embryo scores that add up many small
  effects are for research only, and that Inherit will not offer them as a
  service. `src/app/(marketing)/embryo-analysis/page.test.ts` holds that
  sentence true against a register that permits every code.
- The rule is pinned by tests:
  - `scripts/jurisdiction-gate.test.ts`: a permitted research-only decision
    fails; a prohibited one is not a research-only breach; the pinned list
    cannot be emptied.
  - `src/lib/legal/jurisdictions.test.ts`: a signed permitted decision is
    clamped, a prohibition stands, and TEST-LOCAL is unchanged.
- Draft #189 must be narrowed before it can land. X/Y retention may stay only
  behind the point-2 guard, and the chromosomal-sex calculator may not produce
  or persist a result of its own.
- A future change to any numbered point above is a superseding ADR.
