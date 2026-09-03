# ADR 0017: The Family health picture: people side by side without arithmetic between them

- Status: Accepted
- Date: 2026-09-03
- G7.1 name: "the health picture"

## Context

The brief's Family domain puts two or more adults' results side by side on
one page (`brief:344`), lets two adults see the carrier changes they share
(`brief:346`), and forbids everything a comparison page usually does: a
family score, a sort by person, a "highest", any difference computed between
cells, and any inference of relatedness (`brief:344`, `brief:348`). G4.5
(`brief:2632`) requires the joint-selection constraint and the exact gate
string "Inherit does not rank embryos and does not recommend one." on every
comparison surface. X4 (`brief:211`) requires every figure to go through the
shared contract, X5.1 (`brief:2434`) forbids mixing report layers in one
table, and X16.3 (`brief:2530`) ties carrier pairs to the condition
registry's gene symbols rather than to prose.

Three repository facts bound the design:

- **No absolute risk exists yet.** No `risk_models` row and no demographics
  are recorded for any subject, so the only true cell today is the observed
  genotype, and every column footer must say that no baseline is known.
- **Every `ref_variants.clinvar_significance` is null in production.** The
  carrier candidate set is therefore empty today, and the page's honest
  state is the sentence that says how many positions both files cover.
- **Nothing records a person's chromosomal sex.** No writer sets
  `subject_demographics`, so an X-linked carrier pair cannot be turned into
  the hundred-pregnancy split the design reserves for it.

## Decision

1. **Rows are conditions, columns are people.** A column exists only for the
   viewer's own self subject and for each adult whose `family.heritability`
   grant toward the viewer is live from that adult's own session, with the
   viewer's grant toward them also live (both directions, X12.2). Under two
   columns the page renders the design's empty sentence.
2. **One table per layer, and cells are figures.** The observed genotype is
   the cell's figure (`class` = the layer's class, provenance
   `computed:genome/reports`), followed by the layer chip and one "Open"
   link to that person's report page. Both the figure and the link render
   for another adult only where the viewer holds that layer's own grant
   from that person: the register's `multiSubjectLayer` rule makes
   `family.heritability` the authority for the joint comparison and never
   for an individual result layer, and a genotype in a cell is an
   individual result. Without the layer grant the cell reads "Not shared
   with you". Not covered and no-file states are words. The table has no
   sortable header, no `aria-sort`, no button in any `<th>`.
3. **Nothing is computed across columns.** No difference, ranking, family
   score or "highest" exists in the code; the browser suite asserts the
   absence of any ranking control and of any relatedness vocabulary.
4. **The banner, the trade-off panel and the gate string ship verbatim.**
   The banner ("These are different people compared against different
   baselines…") and the trade-off panel's three sentences are non-dismissible
   and character-exact; the `baselines` definition renders on the line below
   the banner so the banner text stays byte-exact for the gate.
5. **The carrier panel evaluates one closed rule, per gene.** Candidates
   are classified reference positions grouped by gene through the
   registry's `gene_symbols`; a pair exists when each person has at least
   one heterozygous pathogenic or likely pathogenic variant in that gene,
   at the same position or not (`brief:346`). A classification label is
   read token by token (`/`, `,`, `;`, `|`): pathogenic only when every
   token is pathogenic or likely pathogenic, harmless only when every
   token is benign or likely benign. Autosomal recessive, both
   heterozygous, and runs of homozygosity below threshold in both files:
   the exact 25-in-100 sentence around one natural-frequency figure with
   basis `exact`, and the block names each person's variant and
   classification. Where a file shows several classified changes in the
   gene, the block names one, chosen by a fixed rule: pathogenic before
   unknown before harmless, two copies before one before "not shown",
   then the lower rsid; two copies wins because two copies of any
   pathogenic change means every child gets one, so 1 in 4 would be
   false. Any other case, a file that shows two changed copies included:
   the exact "cannot turn that into a chance" sentence with one reason
   from the closed table of eight, the two-copies reason judged after the
   pattern checks and before the runs check. A gene where both files are
   no-calls renders no block; a failed trigger never drops a pair from
   the panel. The brief's wording ("in the same gene") won over the
   design's narrower same-position rule.
6. **A seventh reason, `sex-unknown`, for an X-linked pattern.** The design
   reserves the hundred-pregnancy distribution for Portrait and it needs each
   person's chromosomal sex, which Inherit does not record. Rendering
   nothing would hide a match; a 1-in-4 figure would be false. The panel
   names the reason instead ("this pattern depends on which parent carries
   the change on the X, and Inherit does not record that"). When a sourced
   route for sex exists, the Portrait libraries' X-linked cross replaces
   this reason (D-031, open).
7. **Runs of homozygosity are measured once, at ingest, from the file's own
   calls and stored per file.** A run is a maximal stretch of two or more
   consecutive same-reading autosomal calls; the denominator is the
   autosomal span the file covers, so no genome length is assumed; the only
   constants are the brief's 100 Mb and 0.0156. The processing route writes
   the measure to `genome_files` (D-030), and the panel reads it: every
   annotated file of a person must be measured and below threshold. A run
   must span more than zero bases; a file that reports no such stretch,
   or no autosomal call, is `not_measurable`, which yields the reason,
   never a number; a file processed before the measure existed (null
   columns) counts as not below threshold; a re-run nulls the columns
   before it starts. Nothing is ever read from two files together.
8. **The heritability grant has its own permission row.** No screen granted
   `family.heritability` before this decision, so the two-column state was
   unreachable outside the test suite. The permissions page gains a sixth
   row, "Side-by-side health picture", on the same directional, own-session
   rules as the other five.

## Alternatives rejected

- **A family score or a per-row winner.** Rejected by `brief:344` and G4.5;
  different people are compared against different baselines, so any
  cross-column arithmetic would be a false statement about the people.
- **Sortable columns.** Rejected: a sort by person is a ranking control;
  `brief:2242` forbids it on comparison surfaces.
- **Rendering an X-linked pair as 1 in 4.** Rejected: the fraction is wrong
  for an X-linked pattern (`brief:346`), and the correct split needs a fact
  Inherit does not hold.
- **Inferring relatedness from shared positions.** Rejected by `brief:348`
  and the capability register's declared gap; the comparison is per-position
  identity on classified sites, not a relatedness quantity, and the browser
  suite asserts the vocabulary is absent.
- **Declaring runs from the file's declared type ("array files only").**
  Rejected: the mandated `.vcf` fixture would be unmeasurable and the
  mandated 25-in-100 assertion unreachable; measuring the file's own calls
  is both truer and testable.

## Consequences

- The page is honest today: genotype cells, "No baseline" footers, and the
  empty carrier sentence, because the data that would make it more is not
  in the repository.
- The empty carrier state says in words that no classified position exists
  yet; a count renders only over a non-empty classified set.
- The Overview's carrier line and the page's carrier panel both require
  `third_party_adult_analysis`, `family_heritability` and `carrier_match`
  to permit before any row of another adult is read (register
  `family:carrier-arithmetic`).
- The capability register records "Family risk comparison (side by side)"
  and "Carrier-pair arithmetic" as shipped-degraded with these limits on
  the surface; G4.5's exact string is present and asserted.
- Superseding this decision needs: a `risk_models` row with a citation for
  absolute risk; a sourced writer for chromosomal sex for the X-linked
  cross; a signed jurisdiction review for `carrier_match` where it is
  unreviewed.
