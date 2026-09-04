# ADR 0018: Pharmacogenomics is withheld; the Medicines category ships as a stated absence

- Status: Superseded by [0021](./0021-pharmacogenomics-per-position-reports.md) (2026-09-03)
- Date: 2026-09-03

## Context

The taxonomy names nine categories and `Medicines` is one of them
(`src/lib/genome/taxonomy.ts`), with the promise "How your body may respond to
some common medicines." (`src/copy/reports/strings.ts`). It has zero published
templates. X15 (brief line 2522) allows exactly two outcomes for it: populated,
or registered as `withheld` with a dossier. Brief line 2785 records the choice as
an open decision nobody was assigned. Silence is not one of the outcomes, and
defect D-015 recorded that the category was being dropped from the DOM entirely
until the absence statement shipped.

A read-only research pass on 2026-09-03
(`docs/design/pharmacogenomics-research-2026-09-03.md`) verified, from primary
sources with every URL and access date recorded, the GRCh38 coordinates of
seventeen candidate positions against three independent sources, the guideline
citations against PubMed and the guideline body’s own publication table, and the
licence position of each data source. Its findings: the guideline body’s curated
content is CC0 1.0; the companion knowledge base is CC BY-SA 4.0 with an
unresolved research-use term; the allele registry’s terms could not be read at
all and are UNVERIFIED; of fifteen candidate reports only five could render
honestly, and each as a bare genotype rather than the response the category
promises. It recommended `withheld`, classified safety (primary) with scientific
supporting.

This ADR records the decision taken after building the three designs the dossier
requires.

## Decision

**Pharmacogenomics is withheld.** `docs/withheld/pharmacogenomics.md` carries the
nine elements X15 and §8 require; the capability register’s Pharmacogenomics row
moves from `not shipped` to `withheld` and references it; the acceptance matrix
reports one withheld capability at the top.

Three materially different designs were built and are kept as evidence under
`docs/withheld/pharmacogenomics/designs/`, each with its fixture and a
`gate-output.md` recording the command, exit code and verbatim output of
`pnpm gate:templates` and `pnpm gate:readability`:

1. **Guideline-level response statements** — fails `pnpm gate:templates` on
   `BANNED_PATTERNS` (`treatment claim`, `deterministic claim`, and the new
   `treatment advice (§6.4)` row) and `pnpm gate:readability` on grade 12.0 and
   10.4 against the ceiling of 9 plus four unregistered title words.
2. **Bare single-position reports in the `variant_call` layer** — passes both
   gates and is kept as the control; fails the taxonomy (`categoryFor` throws, or
   the reports land under another category’s heading), §7.1 slot 2, and the FTC
   net-impression standard.
3. **A diplotype caller over unphased calls** — fails `pnpm gate:templates` with
   `bad ref/alt`, because rs1142345 carries two alt alleles and the schema carries
   one; the two-entry workaround passes the gate and drops the second allele
   silently in `scripts/seed.ts`, and the caller returns `indeterminate` for
   `*1/*3A` versus `*3B/*3C` on identical inputs.

Two changes ship with the decision. **The §6.4 blocklist rows enter the gate**:
`\bdosage\b`, `\bsupplement\b` and `we recommend you take` join `BANNED_PATTERNS`
in `scripts/validate-templates.ts` under the label `treatment advice (§6.4)`,
pinned by `scripts/validate-templates.test.ts`. Brief line 913 bans those words
outside a refusal string and template prose is never a refusal string, so the
rule belonged in the gate rather than in review. **The UI state says "does not
offer"**: `MEDICINES_ABSENT` changes from "Inherit has no reports about
medicines." to "Inherit does not offer reports about medicines." — a withholding
states that the capability is not offered, and "has no reports" reads as an
inventory gap that will fill.

The structural failures are pinned by
`src/lib/genome/pharmacogenomics-withheld.test.ts`, which reads the three
fixtures from the dossier directory so the evidence and the tests cannot drift
apart.

## Alternatives rejected

- **Populate the category with the five honest candidates** (design 2). Rejected:
  the summary of every one of the five must, under §7.1 slot 2, lead with the
  fact that it cannot tell the reader how they respond to the medicine, and a
  category whose every report leads with that denial does not keep the promise
  the category description makes. Under the FTC net-impression standard (brief
  line 1902) the page reads as medication guidance whatever each sentence says.
- **Populate with VKORC1 alone**, the one gene the guideline body models with two
  alleles over one position. Rejected: a "Medicines" heading over a single
  warfarin-related genotype is a worse net impression than the honest absence,
  and the guideline’s content for it is a dose, which §6.4 forbids Inherit to
  state.
- **Rename the category** to something the bare positions could honestly fill.
  Rejected: brief line 254 ships the nine category labels character-for-character
  and in order.
- **Remove the category from the taxonomy.** Rejected: X15 says silence about a
  capability is never a withholding, and removing the label would make the gap
  unspeakable rather than declared.
- **Classify the obstacle as legal.** Rejected on the evidence: the guideline
  body’s curated content is CC0 1.0 and PubMed citation needs no new licence
  entry, so a licence-clean path exists and the designs use it. Two legal
  questions stay live and are recorded rather than resolved: whether the
  companion knowledge base’s research-use term survives its CC BY-SA 4.0 grant,
  and the allele registry’s unreadable terms (UNVERIFIED). Neither blocks the
  designs, and neither may be treated as settled by later work.
- **Wait for the Copilot guard, the multi-allelic schema and the X-chromosome key
  path, and ship then.** Rejected as a reason not to write the dossier: those are
  conditions 6-A-1, 6-B-1 and 6-B-2 of the dossier and are inside the operator’s
  control, but the conditions that are not — a guideline body’s published
  position on consumer wording, a regulator-facing judgement by a person, and
  what sequencing providers put in a file — are what makes the state "not
  offered" rather than "not yet".

## Consequences

- The capability register carries its first `withheld` row; the counts line and
  the acceptance matrix’s header count move with it, and G7.4’s evidence names
  the dossier.
- `pnpm gate:templates` now fails any template using `dosage`, `supplement` or
  "we recommend you take". No shipped template uses them, so the rule lands
  green; a future Medicines template cannot land without meeting it.
- `MEDICINES_ABSENT` changed, so `e2e/report-skeleton.spec.ts` is re-pinned to
  the new sentence and additionally asserts that it contains none of "coming
  soon", "soon", "yet" or "currently" — the words §8 forbids where the testable
  condition depends on outside parties. The change is recorded in
  `docs/test-diff-register.md`.
- Reversing this decision means a superseding ADR, not an edit: the dossier’s
  element 6 states the conditions that would have to hold first, each as a test.
