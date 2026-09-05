# Withheld capability: pharmacogenomics (the Medicines category)

> **Source correction, 2026-09-06:** The cited original research's claim that
> NUDT15 *3 requires a second change was a table-interpretation error, not a
> scientific barrier. Its allowed repeat states include the reference state.
> See the [dated correction and CPIC receipt](../design/nudt15-source-correction-2026-09-06.md).
> This dossier remains historical; it does not reinstate that error or alter
> ADR 0021's approved per-position scope. No complete gene-form or phenotype
> call follows from the correction.

Status: `withheld` (brief §8, alternative complete outcome 1). ADR:
[0018](../adr/0018-pharmacogenomics-withheld.md). Register row:
`docs/capability-register.md`, "Pharmacogenomics".

> **Note, 2026-09-03 (ADR 0021).** On 2026-09-03 the operator lifted the
> withholding for the honest subset (`docs/protocol/decisions.md`, “Medicines:
> the operator lifts the withholding for the honest subset”). The Medicines
> category now ships as per-position reports in the `variant_call` layer —
> `data/templates/medicines.json` — under
> [ADR 0021](../adr/0021-pharmacogenomics-per-position-reports.md), which
> supersedes ADR 0018; the register row is `shipped-degraded`. This dossier is
> kept unchanged below as the record of why nothing more ships: no phenotype,
> dose, response or drug choice, and none of the candidates §4 and the research
> note exclude (CYP2D6, HLA-B\*57:01, IFNL3, UGT1A1\*28, TPMT \*3C, G6PD).
> Where the text below describes the absence paragraph, `MEDICINES_ABSENT`, the
> `withheld` status or the design-2 taxonomy failure as current, it describes
> the state before that decision.

Every fact in this dossier that came from outside the repository came from
`docs/design/pharmacogenomics-research-2026-09-03.md`, a read-only research pass
whose retrieval was performed on **2026-09-03** and which records the URL of
every claim. Facts that pass could not verify are marked UNVERIFIED there and are
marked UNVERIFIED here. No allele frequency, tag-SNP sensitivity or effect size
appears anywhere in this dossier or in the three designs, because none was
retrieved.

The nine elements the brief requires are below, in order, each headed by its
number.

---

## 1. The capability, stated exactly as specified

Brief line 2522 (X15):

> "The register must contain rows for, at minimum: array and sequence ingest;
> single-variant and polygenic reports; carrier status; **pharmacogenomics**,
> which currently has a named report category with zero published templates and
> therefore renders absent, not empty — it is either populated or registered as
> `withheld` with a dossier; …"

Brief line 254 (§4.2) names the category and its state:

> "The taxonomy names **nine** categories; **eight render today**, because
> `Medicines` has no published template in the repository and a category with
> zero published templates for that subject and layer is absent, not empty.
> Order, exactly: `Everyday traits`; `Food, drink and metabolism`; `Heart and
> circulation`; `Immune system and allergies`; `Medicines`; `Brain, memory and
> mood`; `Cancer`; `Having children`; `Ageing and longevity`."

Brief line 470 (§4.2 acceptance item 12):

> "Every published template resolves to exactly one of the nine categories; a
> unit test fails on any unmapped slug, and the categorised count equals the
> published count (151 on the seed data). `Medicines` is absent while it has zero
> published templates."

Brief line 1163 (§1.1) says where the content would live:

> "**`variant_call`** — a call on specific variants classified against an
> external professional framework (ACMG/AMP interpretation; ClinVar assertions
> with review status). Carrier status, high-penetrance P/LP findings,
> pharmacogenomic star alleles, Mendelian traits."

Brief line 398 (§6.3) bars it from one surface:

> "`Everyday traits`, `Brain, memory and mood`, `Ageing and longevity` and
> `Medicines` do not render for embryo subjects…"

Brief line 2785 records it as an open decision:

> "6. Whether pharmacogenomics ships as a populated report category or is
> registered as withheld. It is a core service of this category with zero
> published templates today, and populating it is a substantial science
> workstream nobody was assigned."

And the product’s own promise for the category, which is what "populated" would
have to keep — `src/copy/reports/strings.ts`, `CATEGORY_DESCRIPTIONS.medicines`:

> "How your body may respond to some common medicines."

**The capability, then:** report to a person, from their own uploaded file, how
their body may respond to some common medicines — as reports under the
`Medicines` category of the nine-category taxonomy, in the `variant_call` layer,
each resolving through the six-heading report skeleton like every other report.

---

## 2. The obstacle, classified

**Safety (primary), with scientific as the supporting class.**

**Safety.** The brief’s own rules subtract the operative content of every
pharmacogenetic guideline, and what remains creates a net impression the brief
forbids. Specifically: §6.4's lexical blocklist (line 913) bans
`we recommend you take`, `\bdosage\b` and `\bsupplement\b` outside a refusal
string, "because Inherit gives information, not treatment advice"; line 630 fixes
"What you can do" to a no-action string that exists "so the mandatory heading can
never be filled with treatment advice, which §6.4 forbids"; line 1902 applies the
FTC Health Products Compliance Guidance, which "assesses claims by the
advertisement’s **net impression as a whole**" and "treats hedges such as 'may'
or 'preliminary' as inadequate qualifiers"; and line 2262 requires the Copilot
prohibition "no diagnosis, no prognosis, **no treatment or supplement advice**"
to be enforced by `src/lib/copilot/guard.ts`, **which does not exist in this
repository**, so a populated Medicines category would ship with free-text chat
over medication genotypes and no enforced refusal path.

The safety class is not a judgement about the underlying science, which is
strong. It is that a surface headed "Medicines" showing a clopidogrel- or
warfarin-related genotype reads as medication guidance, and the one honest thing
Inherit could add — what to do about it — is precisely what it may not say. The
highest-consequence case verified by the research pass is DPYD: CPIC marks the
fluoropyrimidine pairs "Testing Required", the drugs are chemotherapeutics, and a
negative result at one position does not exclude deficiency, so a reassuring
reading could contribute to a fatal overdose
(`https://api.cpicpgx.org/v1/pair_view`, read 2026-09-03).

**Scientific (supporting).** A phenotype needs a diplotype, and a consumer file
does not determine one. The reference implementation says so in its own words
(§3 below): unphased data cannot distinguish TPMT `*1/*3A` from `*3B/*3C`; CYP2D6
must not be called from a VCF at all; HLA-B is defined by allele status with zero
sequence positions and must not be imputed. The repository’s schema adds its own
limits: one `ref` and one `alt` per variant against rs1142345's two alt alleles,
and no haploid genotype key for the X chromosome.

**Not legal, and not data-availability.** CPIC’s curated content is CC0 1.0 and
its API is open (§3), PubMed citation needs no new licence entry, and
`docs/dataset-licenses.md` already clears dbSNP, ClinVar, Ensembl and gnomAD. The
data are freely retrievable — the research pass retrieved them. Two legal
questions remain live but are avoidable rather than blocking, and are recorded in
§6 and in ADR 0018 so they are not lost.

---

## 3. Primary-source evidence

Every URL below was read on **2026-09-03** and is recorded, with the retrieved
content, in `docs/design/pharmacogenomics-research-2026-09-03.md`.

### 3.1 That one position does not determine a phenotype

From `https://api.cpicpgx.org/v1/gene`, `/allele_definition`,
`/allele_location_value` and `/sequence_location` (accessed 2026-09-03), CPIC’s
own model of each gene:

| Gene | CPIC lookup method | Allele definitions | Of which structural | Defining positions |
| --- | --- | --- | --- | --- |
| CYP2C19 | PHENOTYPE | 49 | 3 | 43 |
| CYP2C9 | ACTIVITY_SCORE | 94 | 0 | 88 |
| VKORC1 | PHENOTYPE | 2 | 0 | 1 |
| SLCO1B1 | PHENOTYPE | 47 | 2 | 35 |
| TPMT | PHENOTYPE | 49 | 0 | 45 |
| NUDT15 | PHENOTYPE | 23 | 0 | 20 |
| DPYD | ACTIVITY_SCORE | 84 | 0 | 83 |
| HLA-B | ALLELE_STATUS | 3 | 0 | 0 |
| CYP2D6 | ACTIVITY_SCORE | 184 | 5 | 157 |
| UGT1A1 | PHENOTYPE | 9 | 0 | 4 |
| CYP3A5 | PHENOTYPE | 8 | 0 | 7 |
| G6PD | PHENOTYPE | 187 | 0 | 173 |

A `PHENOTYPE` or `ACTIVITY_SCORE` lookup is keyed on the pair of gene copies. A
report that reads one of 43, 88 or 173 defining positions cannot produce that
key. The one exception in the table is VKORC1, which CPIC models with two alleles
over one position — and VKORC1's guideline content is a warfarin dose, which §6.4
forbids Inherit to state.

### 3.2 That a file does not determine the pair of gene copies

`https://pharmcat.clinpgx.org/Disclaimers/` (accessed 2026-09-03), the reference
implementation, on unphased data:

> "PharmCAT matches variants to genotypes **assuming unphased data** … in cases
> where an allele is defined by a combination of two or more variants, where each
> variant alone also defines an allele, the match is based on the longer allele.
> For example, TPMT\*3B is defined by one SNP, \*3C is defined by another SNP, and
> \*3A is defined by the combination of those two SNPs. In the case of unphased
> data that is heterozygous for both SNPs, the \*1/\*3A genotype is returned
> though the possibility of \*3B/\*3C cannot be ruled out."

The same page, on the default-to-reference problem:

> "For cytochrome P450 genes, NAT2, TPMT, NUDT15, UGT1A1, and SLCO1B1, the \*1
> allele is defined by the **absence of variation** specified in the gene
> definition tables. This allele cannot be identified by variants; rather, \*1 is
> assigned by default when no variation for the queried positions is reported in
> the submitted VCF file."

`https://pharmcat.clinpgx.org/using/Calling-CYP2D6/` (accessed 2026-09-03):

> "While PharmCAT supports CYP2D6, **we do NOT recommend calling CYP2D6 from
> VCF** due to the large influence of structural variation (SV) and copy number
> variation (CNV) on inferring CYP2D6 phenotype, **which is beyond the scope of
> what can be called from SNPs or INDELs in a VCF file.**"

`https://pharmcat.clinpgx.org/using/Calling-HLA/` (accessed 2026-09-03):

> "we do NOT recommend imputing HLA from a VCF"

`https://pharmcat.clinpgx.org/methods/Gene-Definition-Exceptions/` (accessed
2026-09-03) records that PharmCAT cannot call two G6PD alleles at all
(Mediterranean Haplotype, Villeurbanne) because of reference-base and
co-located-indel representation problems.

### 3.3 The guideline citations, verified

Read from `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed`
and cross-checked against `https://api.cpicpgx.org/v1/publication` (both accessed
2026-09-03). The three designs cite only from this set:

| Guideline | PMID | Journal, year |
| --- | --- | --- |
| CYP2C19 and clopidogrel, 2022 update | 35034351 | Clin Pharmacol Ther 2022 |
| SLCO1B1, ABCG2, CYP2C9 and statin-associated musculoskeletal symptoms | 35152405 | Clin Pharmacol Ther 2022 |
| Pharmacogenetics-guided warfarin dosing, 2017 update | 28198005 | Clin Pharmacol Ther 2017 |
| CYP2C9 and NSAIDs | 32189324 | Clin Pharmacol Ther 2020 |
| TPMT and NUDT15 thiopurine dosing, 2025 update | 41618934 | Clin Pharmacol Ther 2026 |
| Expanded guideline for medication use in the context of G6PD genotype | 36049896 | Clin Pharmacol Ther 2023 |

Two currency findings from the same pass bear on any future decision to revisit
this: the thiopurine guideline **superseded** PMID 30447069 with PMID 41618934,
and `https://api.cpicpgx.org/v1/pair_view?genesymbol=eq.IFNL3` (accessed
2026-09-03) returns both peginterferon pairs with `"cpiclevel":"Retired"`. A
pharmacogenomic report that is not re-checked against its guideline is worse than
no report.

### 3.4 The licence position

`https://api.clinpgx.org/v1/data/page/dataUsagePolicy` (accessed 2026-09-03),
section "CPIC License":

> "CPIC resources are freely available for use by anyone. All curated content
> published by CPIC is available free of restriction under the CC0 1.0 Universal
> (CC0 1.0) Public Domain Dedication."

Same page, on the companion knowledge base:

> "ClinPGx/PharmGKB grants use of its data and contents under the Creative
> Commons Attribution-ShareAlike 4.0 International License."

and, under "Terms and Conditions of Use":

> "to use the data for research purposes and not with any intent to offer all or
> any part of the data for sale as a commercial item"

Whether that research-purpose term survives the CC BY-SA 4.0 grant is a legal
question the research pass deliberately did not answer; it is a lawyer’s call.
It is avoidable — CPIC plus dbSNP plus PubMed needs no new licence entry — so it
is not the obstacle, but it is recorded here and in ADR 0018 as a live question.

**UNVERIFIED, and not papered over:** PharmVar’s own terms could not be read
(site is JavaScript-only, API is key-gated, the bundle carries no licence text,
the overview PDF has no text layer). Any future work touching PharmVar
allele-definition files must have those terms read by a person first. Also
UNVERIFIED: every allele frequency, every per-ancestry tag-SNP
sensitivity/specificity — in particular the ancestry dependence of rs2395029 as
an HLA-B\*57:01 proxy — and every effect size. None was retrieved and none is
stated here.

### 3.5 The repository’s own limits, at the exact code lines

- `scripts/validate-templates.ts`, `genotypeKeys()`:
  `if (chrom === 24 || chrom === 25) return [ref, alt];` — haploid keys for the Y
  chromosome and mitochondria only, so an X-chromosome template is validated
  against diploid keys.
- `scripts/validate-templates.ts`, per variant:
  `!/^[ACGT]+$/.test(v.ref ?? "") || !/^[ACGT]+$/.test(v.alt ?? "")` — one `ref`
  and one `alt`, against rs1142345's verified two alt alleles (`T>C` = *3C,
  `T>G` = *41; `https://api.cpicpgx.org/v1/allele_location_value`, accessed
  2026-09-03).
- `src/lib/genome/reports.ts`, `resolveVariant()` — a genotype matching neither
  the template alleles nor their complement returns `{ status: "unrecognized" }`,
  which `src/app/(app)/genome/[subject]/reports/[slug]/page.tsx` renders as a
  no-call.
- `scripts/seed.ts`, `if (!refVariants.has(v.rsid))` — the first template to
  mention an rsID fixes its `ref`/`alt` in `ref_variants`; a second entry for the
  same rsID is dropped without an error.
- `src/lib/genome/taxonomy.ts`, `categoryFor()` — a total mapping with a
  per-legacy-category default and a named exception list; **no legacy slug maps
  to `medicines`**, so no template can reach the category without a taxonomy
  change.
- `src/copy/reports/strings.ts`, `NOTHING_TO_DO`, rendered unconditionally in
  "What you can do".

---

## 4. Three materially different designs, actually built, and the gate each failed

All three are in `docs/withheld/pharmacogenomics/designs/`, each with its fixture
and a `gate-output.md` recording the command, exit code and verbatim output of
`pnpm gate:templates` and `pnpm gate:readability`. Every run was made in an
isolated worktree of `b6c6877` created with `git worktree add`, with
`node_modules` symlinked from the main tree and one preparatory change (P0)
applied **in the worktree only**: `"pharmacogenomics"` added to the validator’s
`CATEGORIES` and to the taxonomy’s legacy slugs and defaults (mapped to
`medicines`), so that each design fails on its own defect rather than on
`bad category`. No fixture was ever placed under `data/templates/` in the main
tree. The structural failures are pinned by
`src/lib/genome/pharmacogenomics-withheld.test.ts`, each assertion naming its
rule.

### Design 1 — guideline-level response statements

`designs/1-guideline-statement/` — three templates that say what the guideline
says: metabolizer status for CYP2C19 and clopidogrel, a starting-dose direction
for warfarin from VKORC1 and two CYP2C9 positions, and a statin muscle-symptom
statement from SLCO1B1. This is the only design that keeps the category’s
promise.

**Failed `pnpm gate:templates`** (exit 1) on `BANNED_PATTERNS`: `treatment claim`
and `deterministic claim` before this work’s change, and `treatment advice
(§6.4)` after it — one per template. **Failed `pnpm gate:readability`** (exit 1)
with six findings: grade 12.0 and 10.4 against the ceiling of 9, and the
unregistered words `clopidogrel`, `warfarin`, `statin` and `symptoms` in titles.
Two runs are recorded, before and after the §6.4 rows were added to the validator
in the main tree.

Not gate-visible and fatal on its own: brief line 630's fixed "What you can do"
string is false on an actionable pharmacogenetic finding, and replacing it with
advice is what §6.4 forbids.

### Design 2 — bare single-position reports in the `variant_call` layer

`designs/2-bare-position/` — five templates, one per candidate the research pass
found could render honestly (VKORC1 rs9923231, CYP2C19 rs4244285, CYP2C9
rs1799853 and rs1057910, SLCO1B1 rs4149056), each stating only the letters at one
position and what that position cannot tell the reader.

**Passed both gates** (exit 0 each) and is recorded as the control: it proves the
other two fail on their content, not on a fixture accident. It fails elsewhere.
`categoryFor` throws `Unknown legacy category "pharmacogenomics"` under the
shipped taxonomy, and re-slugged to a shipped legacy category all five land under
"Food, drink and metabolism" — pinned by the unit test. Under §7.1 slot 2 (brief
line 949) the mandatory "single most important thing it cannot tell you" is, for
every one of the five, that it cannot tell the reader how they respond to the
medicine; a category all of whose reports lead with that denial does not keep the
promise `CATEGORY_DESCRIPTIONS.medicines` makes. And under the FTC
net-impression standard (brief line 1902) the page reads as medication guidance
whatever each sentence says.

### Design 3 — a diplotype caller over unphased calls

`designs/3-diplotype-caller/` — TPMT over its three defining positions and G6PD
over two, with the caller written as a pure function (`callTpmtDiplotype` in
`src/lib/genome/pharmacogenomics-withheld.test.ts`) over the six CPIC TPMT forms.

**Failed `pnpm gate:templates`** (exit 1) with `bad ref/alt` plus two impossible
genotype keys (`"C,GT"`, `"C,GC,G"`), because rs1142345 has two alt alleles and
the schema carries one. The two-entry workaround **passes both gates** (exit 0)
and is the evidence for the worse failure: `scripts/seed.ts` keeps the first
entry per rsID, so the *41 allele is dropped silently and `resolveVariant`
returns `unrecognized` for `T/G` and `C/G` — a *41 carrier is told nothing, in
the same words as someone whose file could not be read. The caller returns
`indeterminate` for `*1/*3A` versus `*3B/*3C` on identical inputs, which is the
reference implementation’s own documented limit. And every G6PD subject with one
X chromosome gets a no-call, because `genotypeKeys()` emits haploid keys only for
chromosomes 24 and 25.

---

## 5. The narrowest honest subset that can ship, and evidence that it does

The narrowest honest subset is **the statement of the absence itself**: one
paragraph on the reports list, in one place, saying that Inherit does not offer
reports about medicines and why. It ships today.

- The string is `MEDICINES_ABSENT` in `src/copy/reports/strings.ts`.
- It renders at `src/app/(app)/genome/[subject]/reports/page.tsx`, as a paragraph
  carrying `data-slot="category-absent"` and `data-category="medicines"` — not a
  section and not `#medicines`, so no link can target an empty group.
- `e2e/report-skeleton.spec.ts` pins it: the nine-category order with Medicines
  absent, `#medicines` at count 0, exactly one absence paragraph, its text
  character-for-character, and that it contains none of "coming soon", "soon",
  "yet" or "currently".
- The gate run that proved the surface green with this statement in place is
  recorded in `docs/protocol/gates.md`: GitHub Actions `checks` on `70c15ce`, CI
  run 33756942519, exit 0.

What does **not** ship, and why the subset is no larger: design 2 is the smallest
report-shaped thing that passes the prose gates, and §4 records why five bare
positions under a "Medicines" heading is not an honest rendering of the
category’s promise.

---

## 6. What would have to change, as a testable condition

Two conditions, one per obstacle class. Both are testable, and **both depend on
outside parties**, which is why element 7's UI state says the capability is not
offered rather than implying it is forthcoming.

**Condition A (safety).** All four of these hold:

1. `src/lib/copilot/guard.ts` exists and refuses treatment, dose and supplement
   intents before any model call, with the refusal string held in
   `src/copy/copilot/refusals.ts` and asserted by `e2e/copilot-refusal.spec.ts`
   over the "supplement, dosage, diet" prompts brief line 1040 requires.
2. The §6.4 blocklist rows for `\bdosage\b`, `\bsupplement\b` and
   `we recommend you take` remain in `scripts/validate-templates.ts` and every
   Medicines template passes `pnpm gate:templates` with them in place. *(This
   half is inside the operator’s control and is done: the rows were added by this
   work and are pinned by `scripts/validate-templates.test.ts`.)*
3. The "What you can do" collision is resolved by a rule that is not treatment
   advice — which requires either a change to brief line 630's fixed string or a
   published guideline-body statement of what a consumer report may say — and the
   resolution is asserted by a test on the report page.
4. A Medicines report’s net impression is judged acceptable against the FTC
   standard at brief line 1902 by a reviewer competent to make that judgement,
   recorded as a claim entry with its evidence and `net_impression_note`.

**Outside the operator’s control:** 3 and 4. Item 3 needs the guideline body’s
own position on consumer-facing wording, or a specification change the operator
does not make alone; item 4 needs a regulator-facing judgement by a person, which
no test can manufacture.

**Condition B (scientific).** All three of these hold:

1. `pnpm gate:templates` accepts a variant with more than one alt allele, and
   `reports.ts` resolves each of the resulting genotypes — asserted by a test
   over rs1142345's `T>C` and `T>G`.
2. `genotypeKeys()` emits haploid keys for chromosome 23 and `resolveVariant`
   resolves a one-letter call on it — asserted by a test over G6PD rs1050828 for
   a subject with one X chromosome.
3. A diplotype can be assigned to a consumer file **without inferring phase or
   copy number**: either the uploaded files carry phase, or the guideline body
   publishes a lookup that assigns a phenotype from unphased genotypes without an
   ambiguity of the `*1/*3A` versus `*3B/*3C` kind. Asserted by a test in which
   `callTpmtDiplotype`, or its successor, returns a single call rather than
   `indeterminate` for that input.

**Outside the operator’s control:** 3. Items 1 and 2 are schema and renderer work
the operator could do. Item 3 depends on what consumer sequencing providers put
in their files and on what the guideline body publishes; neither is Inherit’s to
decide, and until one of them changes the ambiguity is a property of the data,
not of the code.

**Also recorded, and neither blocking nor resolved:** whether the companion
knowledge base’s research-use term survives its CC BY-SA 4.0 grant (§3.4), and
PharmVar’s unreadable terms (§3.4, UNVERIFIED). Both are avoidable by using CPIC
plus dbSNP plus PubMed only, which is what the three designs do.

---

## 7. The UI state a user meets instead

Rendered on `/genome/[subject]/reports`, in one place, at full ink:

> "Inherit does not offer reports about medicines. How a body handles a medicine
> depends on more than one DNA position. A report built from one position would
> say less than it seems to."

33 words, reading grade 6.58 (`scripts/readability.ts`, jargon replaced as the
gate replaces it). It names the reason in plain language: more than one position
is needed, and one position would overstate itself. Because condition (6)'s
testable conditions depend on outside parties — a guideline body’s published
position, a regulator-facing judgement by a person, and what sequencing providers
put in a file — the state says the capability is **not offered** and contains
none of "coming soon", "soon", "yet" or "currently". `e2e/report-skeleton.spec.ts`
asserts both the exact sentence and the absence of those four words.

---

## 8. ADR

[ADR 0018 — Pharmacogenomics is withheld: the Medicines category ships as a
stated absence](../adr/0018-pharmacogenomics-withheld.md). Status: Accepted,
2026-09-03. It records the decision, the three designs and their gates, the
alternatives rejected, and the two live legal questions.

---

## 9. Capability-register entry

`docs/capability-register.md`, row "Pharmacogenomics", status `withheld`,
referencing this dossier and the three designs' gate outputs. The register’s
counts line and `docs/acceptance-matrix.md`'s withheld count are updated in the
same change, as the brief requires the count of withheld capabilities to be
reported at the top of the matrix.

Nothing else is degraded, blocked or excused by this withholding: the taxonomy
still names nine categories, the other eight still render, and `pnpm
gate:templates`, `pnpm gate:readability` and the unit suite pass on the main tree
with the §6.4 rows in place.
