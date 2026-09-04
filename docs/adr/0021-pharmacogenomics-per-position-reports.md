# ADR 0021: The Medicines category ships as per-position reports from CPIC, dbSNP and PubMed

- Status: Accepted
- Date: 2026-09-03
- Supersedes: [ADR 0018](./0018-pharmacogenomics-withheld.md) (Pharmacogenomics is withheld)

## Context

ADR 0018 withheld pharmacogenomics on an obstacle classified safety (primary)
and scientific (supporting), with the dossier `docs/withheld/pharmacogenomics.md`
stating two testable conditions. Parts of condition A (safety) depend on a
person’s judgement rather than on code: item 3, the “What you can do”
collision with brief line 630, and item 4, the net-impression judgement under
the FTC standard at brief line 1902.

On 2026-09-03 the operator, recorded in `docs/protocol/decisions.md`
(“Medicines: the operator lifts the withholding for the honest subset”),
approved shipping the Pharmacogenomics (“Medicines”) section in full and
directed that no other section be degraded. That entry is binding and states
exactly what the approval does and does not change; this ADR records the
decision as built.

Every fact in the shipped templates comes from
`docs/design/pharmacogenomics-research-2026-09-03.md`, the read-only research
pass whose retrieval was performed on 2026-09-03 with the URL of every claim:
GRCh38 coordinates where Ensembl, dbSNP and CPIC agree; the CPIC forms that
carry each letter, from CPIC’s own allele-definition tables; and guideline
PMIDs verified against PubMed and CPIC’s publication table. Nothing was taken
from memory, and where the note has no fact a template says nothing.

## Decision

**The Medicines category ships as per-position reports.** `data/templates/medicines.json`
carries eleven templates under the legacy slug `pharmacogenomics`, which
`categoryFor` maps to the taxonomy’s `medicines` category (the function stays
total: the slug joins `LEGACY_CATEGORY_SLUGS` and `LEGACY_CATEGORY_DEFAULTS`).
Each is `layer: "variant_call"`, `estimate_kind: null` — brief line 1163 places
pharmacogenomic star alleles in that layer — and reads exactly one position.

| Slug | Position (GRCh38) | Ref > CPIC alt | Forms the letter names | Guideline PMID |
| --- | --- | --- | --- | --- |
| `vkorc1-rs9923231-one-position` | chr16:31096368 | C > T | VKORC1 reference (C) / variant (T), the only position CPIC uses for the gene | 28198005 |
| `cyp2c19-rs4244285-one-position` | chr10:94781859 | G > A | *2 (A); *38 (G) | 35034351 |
| `cyp2c19-rs12248560-one-position` | chr10:94761900 | C > T | T in *17, *44, *45 (and ambiguous in *4); *17 needs rs3758581 too; titled as a bare position | 35034351 |
| `cyp2c9-rs1799853-one-position` | chr10:94942290 | C > T | *2 (T), also *35, *61, *92 | 28198005, 32189324 |
| `cyp2c9-rs1057910-one-position` | chr10:94981296 | A > C | *3 (C), also *18, *68 | 28198005, 32189324 |
| `slco1b1-rs4149056-one-position` | chr12:21178615 | T > C | *5 (C), also *15, *40, *47 | 35152405 |
| `tpmt-rs1800462-one-position` | chr6:18143724 | C > G | *2 (G) | 41618934 |
| `tpmt-rs1800460-one-position` | chr6:18138997 | C > T | *3B (T); part of *3A with rs1142345 | 41618934 |
| `nudt15-rs116855232-one-position` | chr13:48045719 | C > T | *3 (T), which also needs rs746071566 | 41618934 |
| `dpyd-rs3918290-one-position` | chr1:97450058 | C > T | c.1905+1G>A (*2A) (T) | 29152729 |
| `cyp3a5-rs776746-one-position` | chr7:99672916 | T > C (GRCh38 reference is T) | *1 (T); *3 (C) | 25801146 |

**What every report says, and only this.** Which letters the file shows at the
position (the observed genotype figure, class `variant-call`); which
CPIC-named forms carry that letter; and the single most important thing the
position cannot tell the reader (brief §7.1 slot 2) — that one position does
not show the pair of gene copies, and that it says nothing about how a
medicine works in the reader, about a dose or about a choice of medicine.
No frequency, no effect size, no phenotype word, no “may respond”, no dose
direction, no drug choice. The DPYD report leads, in its summary and again in
its reference-homozygous reading, with two sentences that name no phenotype
and no count Inherit did not read: “This is one of the positions guidelines
list for DPYD. C on both copies here says nothing about the other positions,
which this report does not read.” The CYP2C19 rs12248560 report is titled as
a bare position (“Clopidogrel, one CYP2C19 position”), names the forms that
carry its T (*17, *44, *45) and states that it is not a *17 call; no title
or summary claims a form from one position. Every summary defines CPIC at its
first mention (“a group of clinicians and scientists who write guidelines
about genes and medicines”), and every sentence a reader sees is at most 25
words, which `scripts/validate-templates.ts` enforces for the category on
the readability gate’s own splitter. No report carries a CPIC function label
(“no function”, “decreased function”): the decision names letters, forms and
limits, and fewer claims beats more caveats.

**Evidence level.** `emerging`. ADR 0011’s rubric defines `clinical` as
ACMG/AMP P/LP with a ClinVar review status, which a CPIC allele definition is
not, and `established` as replicated and checked by comparing siblings, which
no template has; `emerging` is the level the rubric defines for a replicated
finding without the sibling check, and the research note (§4 item 13) records
that the rubric has no level that says “strong guideline, weak single-position
rendering”. The label is honest about the rendering, not about the guideline.

**The “What you can do” heading.** Brief line 630’s fixed string is false on a
position a prescribing guideline names, and filling the heading with advice is
what §6.4 forbids. For the `medicines` category alone the renderer selects one
new constant, `WHAT_YOU_CAN_DO_MEDICINES` in `src/copy/reports/strings.ts`:

> “Inherit does not say what any doctor should do with this result. You can
> show it to any doctor you choose.”

Two sentences, neither implying that the result is relevant to any
prescription; the earlier wording (“A doctor who prescribes for you may want
to know this result”) implied a relevance no report establishes and was
replaced after review.

`whatYouCanDo(categoryId)` returns it for `medicines` and brief line 630’s
string for every other category; pinned by `src/copy/reports/strings.test.ts`,
`src/lib/genome/pharmacogenomics-withheld.test.ts` and `e2e/report-skeleton.spec.ts`.

**The category description** no longer promises “how your body may respond”.
It says what the reports are: “The letters your file shows at single DNA
positions that prescribing guidelines name.”

**The absence paragraph is removed.** `MEDICINES_ABSENT` and its render site
on the reports list go; the Medicines section renders like any other
category. This is the only subtraction.

**Gate rows.** `scripts/validate-templates.ts` gains `MEDICINES_BANNED_PATTERNS`
for the `pharmacogenomics` slug — metabolizer and phenotype words (poor,
intermediate, normal, rapid, ultrarapid), function labels, response
language, dose direction and “dosing”, drug choice (avoid, stop or start
taking, switch, instead of, alternative) and “should … take/use” — applied
to every prose field a reader sees (title, summary, interpretations) and
not to a citation label, which is the cited work’s own title; beside the
§6.4 rows that stay in force for every template; it requires `layer: "variant_call"`,
`estimate_kind: null`, an `accessedOn` date on every citation and a `source`
object on every Medicines template. `data/templates/SCHEMA.md` documents the
two new optional fields (`citations[].accessedOn`, `source`); `source` is
validated in the seed file and not stored by `scripts/seed.ts`.

**Sources and licence.** CPIC (curated content CC0 1.0, attribution
requested; CPIC® is a registered service mark of HHS and its logo and acronym
stay out of marketing), dbSNP (NCBI, no restrictions, attribution requested)
and PubMed only. Each template’s `source` names CPIC and dbSNP with
`accessedOn: "2026-09-03"`, and each citation carries the same date. CPIC’s
licence asks that users record the version number of the content used; the
API endpoints read on 2026-09-03 exposed none, so each CPIC source carries
`version: null` with a `versionNote` saying so, and no version is invented.
`docs/dataset-licenses.md` gains the CPIC row and records that ClinPGx/PharmGKB
(CC BY-SA 4.0 with a research-use term, a live legal question) and PharmVar
(terms UNVERIFIED) are not used. The words `warfarin`, `clopidogrel`,
`nsaids`, `statins`, `thiopurines`, `fluorouracil`, `capecitabine` and
`tacrolimus` join `data/plain-vocabulary.json` so the titles can name the
guideline’s medicine rather than a class the note does not verify.

## Exclusions, on the research note’s verified facts

These candidates stay excluded, and no future edit to `medicines.json` may add
one without a superseding ADR:

- **CYP2D6** — 184 CPIC allele definitions over 157 positions, 5 structural;
  PharmCAT states in terms that CYP2D6 must not be called from a VCF, that
  ultrarapid metabolizers cannot be called from SNPs or indels, and that a *5
  deletion makes hemizygous variants look homozygous. A single-SNP CYP2D6
  report is wrong, not weak.
- **HLA-B\*57:01 (rs2395029)** — CPIC defines HLA-B by allele status with zero
  sequence positions; dbSNP places rs2395029 in HCP5; PharmCAT does not
  recommend imputing HLA from a VCF; the tag SNP is a population-specific proxy
  whose per-ancestry performance is UNVERIFIED. It must not be imputed.
- **IFNL3 (rs12979860)** — CPIC marks both peginterferon pairs `Retired`; a
  report about response to a retired therapy serves no reader (and dbSNP
  assigns the locus to IFNL4).
- **UGT1A1\*28 (rs3064744)** — a seven-allele TA-repeat `delins`, not a SNP;
  the one-`ref`/one-`alt` schema and three diploid keys cannot represent it,
  and arrays cannot size repeats.
- **TPMT \*3C (rs1142345)** — multi-allelic in CPIC’s own table (`T>C` = *3C,
  `T>G` = *41); the schema carries one alt, the two-entry workaround drops *41
  silently in `scripts/seed.ts`, and unphased heterozygosity at rs1800460 and
  rs1142345 cannot separate *1/*3A from *3B/*3C. Pinned in
  `src/lib/genome/pharmacogenomics-withheld.test.ts`.
- **G6PD** — X-linked: `genotypeKeys()` emits no haploid key for chromosome
  23, so every subject with one X is unrecognized; 173 defining positions;
  CPIC’s distinct “Variable” phenotype for heterozygotes; PharmCAT cannot call
  two G6PD alleles at all.

Six of the eleven shipped positions are ones the research note’s §5 table
marked **exclude**. They ship because the operator’s decision of 2026-09-03
lifted the withholding for every position whose four facts the note verifies
(coordinate, alleles, forms, PMID), and because every reason the note gave
concerned a phenotype claim — a diplotype, a phase, a function, a dose —
which no report makes. Each is a bare position that names its letters, the
forms that carry them and its limit:

- **CYP2C19 rs12248560** — the note: a “*17” claim from this SNP alone is
  not supportable (T is in *17, *44, *45 and ambiguously *4), and it could
  be populated only as a bare-position report with no star-allele name. It
  ships exactly so, titled “Clopidogrel, one CYP2C19 position”.
- **TPMT rs1800462 and rs1800460** — the note: unphased data cannot separate
  *1/*3A from *3B/*3C, and rs1142345 is multi-allelic. Neither report names
  a pair of forms; rs1142345 stays excluded (below).
- **NUDT15 rs116855232** — the note: *3 needs a second, co-defining variant,
  and *1/*2 against *3/*6 is ambiguous unphased. The report says T is part
  of *3, that *3 needs a second change not read here, and that it is not a
  *3 call.
- **DPYD rs3918290** — the note: an activity-score gene of 83 positions,
  a reference implementation that refuses a diplotype from unphased data,
  and the highest false-reassurance harm of any candidate. The report leads
  with the two sentences above, states no deficiency and no activity, and
  reads one position of the 83.
- **CYP3A5 rs776746** — the note: no consumer benefit, since tacrolimus is
  taken under therapeutic drug monitoring, and a reader might second-guess
  a monitored dose. The report says nothing about a dose and carries the
  Medicines “What you can do” string; the GRCh37→GRCh38 reference-base flip
  the note warns of is pinned (ref T).

## The science limit (dossier condition B, unchanged)

A metabolizer phenotype needs the pair of gene copies. An unphased consumer
file does not determine one, and for cytochrome P450 genes, TPMT, NUDT15 and
SLCO1B1 the *1 form is assigned by the absence of variation across every
defining position, so one position cannot even say “*1”. The reports say so.
No report states a phenotype, a dose, a drug choice or a response, and the
gate rows make that mechanical.

## The currency risk

CPIC asks users to indicate that its guidelines and content are subject to
updates and to confirm the current content at ClinPGx. The research pass
found one supersession in flight (thiopurines: PMID 30447069 → 41618934) and
one retirement (IFNL3). Every template carries the guideline PMID and the date
it was read; Inherit has **no automatic detection of a superseded guideline
yet**, and the capability register says so. A pharmacogenomic report that is
not re-checked against its guideline is worse than no report, so a re-read of
CPIC’s publication and pair tables against the eleven PMIDs is due before any
release that touches the category, and a superseded PMID is a defect.

## What would allow a phenotype later

Dossier condition B, as tests: `pnpm gate:templates` accepting more than one
alt allele with `reports.ts` resolving each genotype (rs1142345 `T>C` and
`T>G`); `genotypeKeys()` emitting haploid keys for chromosome 23 and
`resolveVariant` resolving a one-letter call (G6PD rs1050828); and a diplotype
assignable without inferring phase or copy number — phased uploads, or a
guideline-body lookup that assigns a phenotype from unphased genotypes without
the *1/*3A versus *3B/*3C ambiguity — with `callTpmtDiplotype` or its successor
returning a single call. Plus, for the safety class, a claim entry in
`data/claims.json` from a reviewer competent to judge the net impression: the
operator’s approval is recorded, and no reviewer claim entry exists.

## Alternatives rejected

- **Keep the withholding.** Rejected by the operator on 2026-09-03: the
  judgement parts of condition A are the operator’s to make, and the honest
  subset is true, useful to a prescriber and free of advice.
- **VKORC1 alone.** Rejected: one warfarin-related genotype under a
  “Medicines” heading is a worse net impression than eleven positions that
  each say the same limit; the category is either a set of per-position
  reports or nothing.
- **Guideline-level statements** (design 1) and **a diplotype caller**
  (design 3). Rejected on the dossier’s evidence, unchanged: the first trips
  the §6.4 and deterministic rows, the second cannot be carried by the schema
  and returns `indeterminate` on the case that matters.
- **Name a medicine class in titles** (“Blood clotting medicines”, as design 2
  did). Rejected: the note verifies the medicine each guideline is about, not
  its class, and a class name is a fact the note does not carry.
- **Carry CPIC’s function labels** (“no function”, “decreased function”).
  Rejected: the decision names letters, forms and limits; a function label
  reads as an effect and invites a phenotype the position cannot support.
- **Prefer the estimate layer as the reports list’s default tab.** Not
  changed here: `LAYERS` orders `variant_call` first (brief X5.1 lists
  “Specific variants” first), so with both layers non-empty the list opens on
  the Specific variants group, which today is Medicines alone. That is the
  designed behaviour of the layer tabs, not a Medicines decision; if the
  operator wants the estimates first it is a one-line product change to the
  list page, recorded here so it is not made by accident.

## Consequences

- `docs/capability-register.md`: Pharmacogenomics → `shipped-degraded`, with
  the limits on the surface, the exclusions, the currency gap, the operator
  approval and the absence of a reviewer claim entry; withheld count 1 → 0.
- 162 seed templates: 151 estimates and 11 variant calls. The Overview’s split
  string gains its variant-call half; the reports list renders the layer tabs
  and its Specific variants group; counts stay per layer, never summed.
- A gated report’s “Not now” link now names its layer
  (`/genome/[subject]/reports?layer=estimate#cancer`): the list renders one
  group at a time and opens on the first populated one, so a bare hash would
  land on the Specific variants group without its target.
- The Overview starter list (brief §2 §7.2, A10) admits `variant_call`
  templates at `emerging`, and Medicines is not on its excluded-category
  list, so a Medicines report covered by the reader’s file can appear among
  the reports to read first, ranked by category order. That is the existing
  rule, not a Medicines decision; excluding the category there would be a
  product change and is recorded here rather than made.
- The Copilot intent guard (brief line 2262, dossier condition A item 1) is
  being built on a sibling branch and is not touched here; the §6.4 rows stay
  in force (item 2).
- Brief line 398 bars Medicines from embryo subjects. No embryo surface exists
  today (register: `not shipped`); the embryo allowlist must exclude
  `medicines` by construction when one does.
- `src/lib/genome/pharmacogenomics-withheld.test.ts` pins the shipped state
  and keeps the exclusion pins; `e2e/report-skeleton.spec.ts` pins the list,
  the Medicines report page, the “What you can do” string and the DPYD
  sentence; `docs/test-diff-register.md` records each change.
- `docs/withheld/pharmacogenomics.md` stays as the record of why nothing more
  ships, with a dated header note; ADR 0018 is superseded, not edited.
