# Pharmacogenomics ("Medicines") — read-only research pass

> **Correction, 2026-09-06:** The historical NUDT15 text in §3.3 and the §5
> candidate table incorrectly treats a second defining position as a required
> second change. CPIC's *3 definition permits the same repeat state as reference
> *1. Those claims are superseded by the [dated source receipt and explanation](./nudt15-source-correction-2026-09-06.md).
> The original text remains as an audit record, not as current evidence for
> excluding the corrected single-position report or calling a complete allele.

Repository: `/home/user/Inherit.bio` (nothing was modified).
All network retrieval performed **2026-09-03** (session clock `date -u` = `Thu Sep  3 12:20:26 UTC 2026`).
Every fact below carries the URL it was read from. Anything I could not read from a primary
source is marked **UNVERIFIED** and is not filled in from memory.

Verification convention used here:
- **Coordinates** are only reported where **three independent primary sources agree**: Ensembl REST,
  the NCBI dbSNP RefSNP JSON API, and the CPIC database API.
- **No allele frequencies are reported anywhere in this document.** I did not retrieve them, so
  every frequency claim is UNVERIFIED and must not be written into a template from this document.

---

## 0. The question on the table

`docs/inherit-v2-brief.md` line 2522 (X15) requires that pharmacogenomics be **either populated or
registered as `withheld` with a dossier**:

> "…**pharmacogenomics**, which currently has a named report category with zero published templates
> and therefore renders absent, not empty — it is either populated or registered as `withheld` with
> a dossier…"

Line 2785 records it as an open decision:

> "6. Whether pharmacogenomics ships as a populated report category or is registered as withheld. It
> is a core service of this category with zero published templates today, and populating it is a
> substantial science workstream nobody was assigned."

Current repository state (verified by reading the files):
- `src/lib/genome/taxonomy.ts` — `CATEGORY_TAXONOMY` entry `{ id: "medicines", label: "Medicines" }`.
- `src/copy/reports/strings.ts:118` — `medicines: "How your body may respond to some common medicines."`
- `data/templates/*.json` — 151 templates across 15 legacy category slugs; **zero** map to `medicines`.
  Counted: addiction 10, aesthetic-cosmetic 10, autoimmune 10, basic-traits 10, brain-health 10,
  cancer-risk 10, environmental-sensitivity 11, gastrointestinal 10, heart-cardiovascular 10,
  lifestyle-wellness 10, longevity 10, mental-health 10, metabolic-obesity 10, neurodegenerative 10,
  reproductive-family 10. `LEGACY_CATEGORY_DEFAULTS` maps **none** of the fifteen legacy slugs to
  `medicines`, so no template can reach the category without either a new legacy slug or an entry in
  `TEMPLATE_CATEGORY_EXCEPTIONS`.
- `docs/capability-register.md` row 33: Pharmacogenomics = `not shipped`; open work =
  "Populate the category from primary sources or complete `docs/withheld/pharmacogenomics.md`".
  `docs/withheld/` **does not exist** (`ls docs/withheld` → No such file or directory).
  Register counts on that revision: shipped 9 · shipped-degraded 3 · **withheld 0** · not shipped 10.
- `docs/protocol/defects.md` D-015 (2026-09-03) records the same gap as an open defect.

---

## 1. The template contract — exactly what a template needs, and what the gate rejects

Sources read: `data/templates/SCHEMA.md`, `scripts/validate-templates.ts`,
`src/lib/genome/template-prose.ts`, `src/lib/genome/taxonomy.ts`, `src/lib/genome/reports.ts`,
`scripts/seed.ts` (lines 80–150), `scripts/readability-gate.ts`.

### 1.1 Required fields (per template object; files are JSON **arrays**)

| Field | Type / rule | Enforced by |
|---|---|---|
| `slug` | unique, `^[a-z0-9-]+$` | validator |
| `category` | one of the **fifteen legacy slugs** (`medicines` is **not** one of them) | validator `CATEGORIES` set |
| `title` | ≤ 12 words; no jargon term/alias; no bare numeric figure | `titleFindings()` |
| `summary` | ≥ 40 characters; no naked relative figure; no worded ratio | validator + `nakedRelativeFindings()` |
| `evidence` | `clinical \| established \| emerging \| preliminary \| insufficient`; `insufficient` cannot be seeded | validator + `seed.ts` throw |
| `layer` | optional; `variant_call \| estimate` (default `estimate`) | validator + seed derivation |
| `estimate_kind` | optional; `single_locus \| polygenic_score` (default from `pgs_id`) | validator |
| `variants[]` | required unless `pgs_id`; each needs `rsid` (**numeric**, no "rs" prefix), `gene` (string), `chrom` (1–25; 23=X, 24=Y, 25=MT), `pos38` (GRCh38, 1-based int), `ref`/`alt` matching `^[ACGT]+$`, `interpretations` | validator |
| `interpretations` | **every** genotype key derivable from ref/alt must exist, each ≥ 20 chars, keys sorted alphabetically with no separator (`"AG"` not `"A/G"`), no `/` in any key | validator `genotypeKeys()` + `reports.ts genotypeKey()` |
| `pgs_id` | `null` for single-variant templates; else `^PGS\d{6}$` | validator |
| `citations[]` | ≥ 1; each needs `label` **and** (`pmid` matching `^\d{6,9}$` **or** `doi`) | validator |

**Title shape.** `Topic · GENE` (U+00B7) is a **convention, not a validator rule**: 149 of 151 shipped
titles contain `·`; the gate only enforces word count, jargon and bare figures.

### 1.2 What the gate rejects

1. **Jargon in titles** — every term and alias in `data/jargon.json` (110 terms), case-insensitively,
   word-boundary matched. Terms fatal to a naive PGx title include: **`allele`, `clinical`,
   `clinician`, `enzyme`, `genotype`, `haplotype`, `medical`, `medication`, `metabolism`*, `receptor`,
   `transporter`, `variant`, `gene`, `genetic`, `pathogenic`, `phenotype`, `protein`, `carrier`,
   `sensitivity`, `x-linked`**. (*`metabolism` is **not** in the list — the full list is reproduced in
   §1.3.) A title such as "Clopidogrel response · CYP2C19" passes; "Drug-metabolising enzyme · CYP2C19"
   fails on `enzyme`.
2. **Naked relative figures** — `%`, digit-adjacent `x`/`×`, or `-fold` within **40 characters** of
   `lower`, `higher`, `reduction`, `increase`, `less likely`, `more likely`, `times`; **plus** any
   numeric multiplier anywhere ("1.4 times the odds", "2×", "1.7-fold"), in `summary` **and** in every
   `interpretations` string. Almost all PGx literature effect sizes (hazard ratios for stent thrombosis,
   odds ratios for myopathy) are unusable as written.
3. **Reading grade > 9** — `pnpm gate:readability` (`scripts/readability-gate.ts`) scans
   `data/templates/` directly (line 610–618). Every user-facing block of **≥ 15 words** must score
   Flesch–Kincaid ≤ 9.0 (≤ 11.0 only on legal/consent routes). Brief §1155 additionally requires: no
   sentence over 25 words, and no term outside `data/plain-vocabulary.json` (638 words) without an
   inline definition on first use.
4. **Banned language patterns** (`BANNED_PATTERNS`, matched against the whole serialised template):
   `100% of your DNA`; `clinical[- ]grade`; `\bdiagnos(e|is|tic)\b`; `you (have|will develop|are going to)`;
   `\bcures?\b|\btreats?\b`. Note the last one: the word **"treats"** anywhere in a PGx interpretation
   fails the gate.
5. **Structural floors** — the run fails if total < 120 templates or categories < 12.

### 1.3 `data/jargon.json` — term names only (110)

absolute risk, adiponectin, admixture, allele, analysis, ancestry, association, autoimmune, autosomal,
average, baseline, bilirubin, call rate, carrier, chromosome, circulating, classification, clinical,
clinician, cohort, condition, confidence interval, consent, coverage, data processor, deidentified,
diagnosis, directly genotyped, disclosure, dominant, dopamine, effect size, enzyme, estimate, evidence,
exome, exposure, expression, fertility, frameshift, gene, genetic, genome build, genome-wide association
study, genotype, haplogroup, haplotype, hazard ratio, hemoglobin, heritability, heterozygous, homozygous,
imputation, incidence, inflammation, inheritance, insulin, intronic, jurisdiction, laboratory, liability,
liftover, linkage disequilibrium, locus, marker, medical, medication, meta-analysis, missense, model,
odds, odds ratio, opt-in, overload, pathogenic, penetrance, percentile, personal data, phenotype,
pigmentation, polygenic, population, preliminary, prevalence, probability, promoter, protein, raw data,
receptor, recessive, reference, reference panel, regulator, relative risk, replication, research consent,
revocable, risk allele, sample, sensitivity, sequencing, statistical, study, susceptibility, third party,
transporter, variant, whole genome, x-linked, z-score.

### 1.4 Two structural limits that decide several candidates

- **Multi-allelic sites cannot be expressed.** The schema carries exactly one `ref` and one `alt`, and
  `genotypeKeys()` derives exactly three diploid keys. A site with two functionally different alt
  alleles (verified below for **rs1142345**, where CPIC assigns `T>C` to TPMT\*3C and `T>G` to TPMT\*41)
  cannot be represented without silently discarding one.
- **Hemizygous X calls render as "unrecognized".** `genotypeKeys()` emits haploid keys **only for
  chrom 24 (Y) and 25 (MT)** — chrom 23 (X) gets diploid keys. Confirmed against the one existing
  chrom-23 template (`male-pattern-baldness-ar-rs6152`, keys `GG/AG/AA`). `reports.ts genotypeKey("T")`
  returns `"T"`, which matches no key, so `resolveVariant` falls through to
  `{ status: "unrecognized" }`, which the report page treats as a no-call
  (`src/app/(app)/genome/[subject]/reports/[slug]/page.tsx:250`). **Any X-linked report (G6PD) would
  silently fail for every subject with one X chromosome** unless the schema and renderer change first.

### 1.5 One worked example (`data/templates/gastrointestinal.json`, first two entries)

`lactase-persistence-lct-rs4988235` — title "Lactose tolerance · LCT/MCM6", `evidence: "emerging"`,
two variants (rs4988235 chr2:135851076 G/A; rs182549 chr2:135859184 C/T), three interpretations each,
`pgs_id: null`, one citation `{pmid: "11788828", label: "Enattah et al., Nat Genet 2002"}`.
`alcohol-flush-aldh2-rs671` — same shape, one variant (rs671 chr12:111803962 G/A), one citation
`{pmid: "19320537"}`. Both are `estimate`/`single_locus` by seed-time derivation. Brief §1.2 records
that **all 151 shipped templates are `estimate`/`single_locus`** and that the `variant_call` layer —
which is where brief §1163 explicitly places "pharmacogenomic star alleles" — has **zero templates**
(also recorded as defect D-014 in the capability register).

---

## 2. Licences, from primary sources

### 2.1 Where CPIC and PharmGKB now live (verified 2026-09-03)

`https://cpicpgx.org/` and `https://www.pharmgkb.org/` both return a 2,505-byte JavaScript shell
titled **"ClinPGx"**; `https://www.pharmgkb.org/page/dataUsagePolicy` 301s and `https://cpicpgx.org/license/`
302s to `https://www.clinpgx.org/page/dataUsagePolicy`, which serves no text without JavaScript. The
page content is served as JSON by the site's own API and was read there:
**`https://api.clinpgx.org/v1/data/page/dataUsagePolicy`** (retrieved 2026-09-03; page key
`dataUsagePolicy`, title "Data Usage Policy"). the public web archive is blocked by this session's egress
policy (403 "Blocked by egress policy"), so no archived copy was used.

### 2.2 ClinPGx / PharmGKB data — **CC BY-SA 4.0 plus a research-use term**

Exact wording, from `https://api.clinpgx.org/v1/data/page/dataUsagePolicy` (2026-09-03):

> "ClinPGx/PharmGKB grants use of its data and contents under the Creative Commons
> Attribution-ShareAlike 4.0 International License."

> "**Attribution**: You must give appropriate credit to PharmGKB, provide a link to this license, and
> indicate if changes were made. You may do so in any reasonable manner, but not in any way that
> suggests PharmGKB endorses you or approves of your use."

> "**Share-Alike**: If you alter, amend, reuse or otherwise change ClinPGx/PharmGKB data, you must
> distribute your contributions using this license as well. You may not apply legal terms or
> technological measures that legally restrict others from doing anything this license permits."

And, under "Terms and Conditions of Use":

> "ClinPGx/PharmGKB is for research purposes."

> "By accessing the data on the website, you are agreeing to the following: … **to use the data for
> research purposes and not with any intent to offer all or any part of the data for sale as a
> commercial item**, and acknowledge that the accuracy of the data in this knowledge base cannot be
> guaranteed and must be considered when using this data."

**Verdict against Inherit's policy.** `docs/dataset-licenses.md` states the rule: "no
non-commercial-licensed source may enter the reference store or seed data", and excludes SNPedia
precisely because CC BY-**NC**-SA is "incompatible with an AGPL platform serving arbitrary deployments
(including commercial self-hosts)". PharmGKB's licence itself is **not** NC — CC BY-SA 4.0 permits
commercial use — but the site's **Terms and Conditions add a research-purpose restriction** on top of
it. That combination is a live legal question this pass cannot settle: whether the added terms bind a
downstream user who takes the data under CC BY-SA (CC BY-SA 4.0 §2(a)(5)(B) forbids the licensor
adding restrictions, but the terms are asserted as a condition of *access*). **This needs a lawyer's
call, not an engineer's.** Marked as an unresolved legal question, not as a permission.

### 2.3 CPIC content — **CC0 1.0**, attribution requested

From the same page, section "CPIC License":

> "CPIC resources are freely available for use by anyone. All curated content published by CPIC is
> available free of restriction under the CC0 1.0 Universal (CC0 1.0) Public Domain Dedication.
> However, CPIC requests that you give attribution to CPIC whenever possible and appropriate and that
> you acknowledge: The primary source is at ClinPGx. Cite the relevant publication(s), if applicable.
> Indicate that CPIC guidelines and content are subject to updates and modifications, and users should
> refer to ClinPGx to confirm they are accessing the most current content. The CPIC logo and acronym
> may not be reproduced on another website or in advertising materials without the permission of NIH.
> To cite specific content, indicate CPIC®. URL [date accessed]."

> "**CPIC Database and API User Agreement.** The CPIC database and API are also bound by these
> licensing and terms of use. To cite content downloaded via the API or from the CPIC database, please
> indicate the URL, the date accessed, and the version number."

> "CPIC® is a registered service mark of the US Department of Health & Human Services (HHS)."

**Verdict against Inherit's policy: PERMITTED.** CC0 is neither non-commercial nor share-alike. The
only constraints are a trademark constraint (do not reproduce the CPIC logo/acronym in advertising
without NIH permission — note this bars putting "CPIC" in marketing copy, though a citation is fine)
and a currency-disclosure request. The CPIC API is live and unauthenticated:
`https://api.cpicpgx.org/v1/` (PostgREST 12.0.2 swagger, retrieved 2026-09-03) with tables
`gene`, `allele`, `allele_definition`, `allele_location_value`, `sequence_location`, `publication`,
`guideline`, `pair_view`, `recommendation`, and others.

CPIC's own **guideline disclaimer**, which any Inherit surface citing CPIC should not contradict:

> "CPIC guidelines reflect expert consensus based on clinical evidence and peer-reviewed literature
> available at the time they are written and are **intended only to assist clinicians in decision
> making** and to identify questions for further research. … It remains the responsibility of the
> healthcare provider to determine the best course of treatment for a patient."

### 2.4 PharmVar — **UNVERIFIED**

I could not read PharmVar's terms from any primary source. Attempts, all 2026-09-03:
- `https://www.pharmvar.org/`, `/terms`, `/about`, `/faq`, `/documentation` — all return the same
  1,493-byte JavaScript shell with no text content.
- `https://www.pharmvar.org/built/bundle.js` (5.27 MB, retrieved) — contains **no** occurrence of
  "Creative Commons", and no licence, terms-of-use, copyright or redistribution statement (168
  occurrences of "PharmVar", none in a licensing context; the only `license` strings are Swagger-UI
  component code).
- `https://www.pharmvar.org/api-service/genes/list` and `/api-service/alleles?...` → **HTTP 401**:
  `{"errorMessage":"API Key is invalid or missing. The PharmVar API now requires a valid API key for
  access. Keys may be generated with a PharmVar Account on the Account Settings Page.","errorCode":401}`
- `https://www.pharmvar.org/documents/pharmvar_overview.pdf` (4.8 MB, 24 pages) retrieved but is an
  image-based slide deck; no text layer could be extracted in this environment.

One adjacent fact **is** verified and is relevant: the PharmVar founding publication is licensed
**CC BY-NC-ND 4.0**. From the PMC record `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5836850/`
(read via `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=PMC5836850`, 2026-09-03):

> "This is an open access article under the terms of the Creative Commons
> Attribution-NonCommercial-NoDerivs License, which permits use and distribution in any medium,
> provided the original work is properly cited, the use is non-commercial and no modifications or
> adaptations are made."
> (Gaedigk et al., *Clin Pharmacol Ther* 2018, doi:10.1002/cpt.910, PMID 29134625)

That governs the *article*, not the database, and facts are not copyrightable — but it means the
obvious human-readable source for PharmVar allele definitions is NC-ND, and the database's own terms
are unreadable without an account. **Conclusion: PharmVar's licence position is UNVERIFIED and must be
treated as a blocker for any PharmVar-derived data until a lawyer reads the account-gated terms.**
Note that Inherit does not need PharmVar if it uses CPIC: CPIC publishes its own allele definition
tables under CC0 (verified above), and PharmCAT — Stanford/Penn, **MPL-2.0** per the same data-usage
page and `https://raw.githubusercontent.com/PharmGKB/PharmCAT/development/LICENSE` — states it "uses
gene allele definitions included in the CPIC database" (`https://pharmcat.clinpgx.org/Disclaimers/`).

### 2.5 Sources already cleared in `docs/dataset-licenses.md` (audit date 2026-08-28)

dbSNP and ClinVar (NCBI: no restrictions, attribution requested), gnomAD (CC0), Ensembl/EMBL-EBI
(open, attribution), 1000 Genomes (open). **SNPedia is excluded** (CC BY-NC-SA 3.0). The audit also
records: "Report-template citations reference the primary literature directly (PubMed/DOI), not
aggregator databases". A PGx template built on **dbSNP coordinates + a PubMed-cited CPIC guideline**
therefore needs **no new licence entry**; one built on PharmGKB clinical annotations or PharmVar
definition files does.

---

## 3. Candidate-by-candidate verified facts

### 3.1 Coordinates — three sources in agreement

Every row below was read on **2026-09-03** from all three of:
- Ensembl REST `https://rest.ensembl.org/variation/human/rs<ID>?content-type=application/json`
- NCBI dbSNP `https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/<ID>` (SPDI on `NC_0000NN.NN` = GRCh38)
- CPIC `https://api.cpicpgx.org/v1/sequence_location?select=id,genesymbol,name,chromosomelocation,dbsnpid,position`

`pos38` is 1-based (dbSNP SPDI position + 1). `chrom` is the value the Inherit schema wants.

| rsID | dbSNP gene locus | chrom | pos38 (GRCh38) | ref | alt used by CPIC | other alt alleles in dbSNP | CPIC's own name |
|---|---|---|---|---|---|---|---|
| rs4244285 | CYP2C19 | 10 | 94781859 | G | A | C, T | `19154G>A` / `g.94781859G>A` |
| rs12248560 | CYP2C19 | 10 | 94761900 | C | T | A | `-806C>T` |
| rs1799853 | CYP2C9 | 10 | 94942290 | C | T | A | `3608C>T` |
| rs1057910 | CYP2C9 | 10 | 94981296 | A | C | G | `42614A>C` |
| rs9923231 | VKORC1 | 16 | 31096368 | C | T | A, G | `-1639G>A` / `g.31096368C>T` |
| rs4149056 | SLCO1B1 | 12 | 21178615 | T | C | A | `37041T>C` |
| rs1800462 | TPMT | 6 | 18143724 | C | G | — | `238G>C` / `g.18143724C>G` |
| rs1800460 | TPMT | 6 | 18138997 | C | T | A, G | `460G>A` / `g.18138997C>T` |
| rs1142345 | TPMT | 6 | 18130687 | T | **C and G** | A | `719A>G;719A>C` — **two alt alleles** |
| rs116855232 | NUDT15 | 13 | 48045719 | C | T | — | `7973C>T` |
| rs3918290 | DPYD | 1 | 97450058 | C | T | A, G | `c.1905+1G>A` / `g.97450058C>T` |
| rs2395029 | **HCP5** (not HLA-B) | 6 | 31464003 | T | *(not used by CPIC)* | — | absent from CPIC |
| rs776746 | CYP3A5, ZSCAN25 | 7 | 99672916 | **T** | C | A, G | `6981A>G` / `g.99672916T>C` |
| rs12979860 | **IFNL4** (not IFNL3) | 19 | 39248147 | C | T | G | `-1595G>A` / `g.39248147C>T` |
| rs3064744 | UGT1A1 (+8 other UGT1A) | 2 | 233760234–233760248 | TA-repeat | *(repeat length)* | **7 alleles** | `CA(TA)5TAA … CA(TA)8TAA` |
| rs1050828 | G6PD | 23 (X) | 154536002 | C | T | — | `c.202G>A` |
| rs1050829 | G6PD | 23 (X) | 154535277 | T | C | A | `c.376A>G` |

Three coordinate notes that matter and are easy to get wrong:
1. **rs776746 changed reference allele between builds.** dbSNP gives GRCh37 `NC_000007.13:99270538 C`
   but GRCh38 `NC_000007.14:99672915 T`. On GRCh38 the reference base is **T** and CPIC writes
   `g.99672916T>C`. A template copied from a GRCh37-era source would invert every genotype key.
2. **rs2395029 has MHC alt-scaffold mappings** (Ensembl: `HSCHR6_MHC_COX_CTG1:2941328` and
   `HSCHR6_MHC_SSTO_CTG1:2763252` in addition to `6:31464003`). Whether a user's VCF reports it on the
   primary assembly or an alt contig is a real ingest hazard.
3. **rs3064744 is a `delins` with seven alleles** (dbSNP `variant_type: "delins"`;
   deleted `ATATATATATATATA`, inserted sequences ranging `ATATATATATA` … `ATATATATATATATATATATATA`).

### 3.2 Guideline citations — verified against PubMed and against CPIC's own publication table

All PMIDs, titles, journals, years and DOIs below were read on **2026-09-03** from
`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=…`
and cross-checked against `https://api.cpicpgx.org/v1/publication?select=pmid,doi,title,journal,year,guidelineid`.
(`https://doi.org/…` itself returns **403** through this proxy, so DOIs are reported as recorded by
PubMed and CPIC, not as resolved links.)

| Guideline | PMID | Journal, year, pages | DOI |
|---|---|---|---|
| CYP2C19 and clopidogrel: 2022 Update | **35034351** | Clin Pharmacol Ther 2022 Nov;112(5):959-967 | 10.1002/cpt.2526 |
| SLCO1B1, ABCG2, CYP2C9 and statin-associated musculoskeletal symptoms | **35152405** | Clin Pharmacol Ther 2022 May;111(5):1007-1021 | 10.1002/cpt.2557 |
| Pharmacogenetics-guided warfarin dosing: 2017 Update (CYP2C9, VKORC1, CYP4F2) | **28198005** | Clin Pharmacol Ther 2017 Sep;102(3):397-404 | 10.1002/cpt.668 |
| TPMT and NUDT15 thiopurine dosing: **2025 Update** | **41618934** | Clin Pharmacol Ther 2026 Apr;119(4):916-927 | 10.1002/cpt.70209 |
| TPMT and NUDT15 thiopurine dosing: 2018 Update (superseded) | 30447069 | Clin Pharmacol Ther 2019 May;105(5):1095-1105 | 10.1002/cpt.1304 |
| DPYD and fluoropyrimidine dosing: 2017 Update | **29152729** | Clin Pharmacol Ther 2018 Feb;103(2):210-216 | 10.1002/cpt.911 |
| HLA-B genotype and abacavir dosing: 2014 Update | **24561393** | Clin Pharmacol Ther 2014 May;95(5):499-500 | 10.1038/clpt.2014.38 |
| CYP2C9 and NSAIDs | **32189324** | Clin Pharmacol Ther 2020 Aug;108(2):191-200 | 10.1002/cpt.1830 |
| CYP2D6, OPRM1, COMT and select opioid therapy | 33387367 | Clin Pharmacol Ther 2021 Oct;110(4):888-896 | 10.1002/cpt.2149 |
| CYP2D6 and codeine: 2014 Update | 24458010 | Clin Pharmacol Ther 2014 Apr;95(4):376-82 | 10.1038/clpt.2013.254 |
| CYP3A5 and tacrolimus dosing | **25801146** | Clin Pharmacol Ther 2015 Jul;98(1):19-24 | 10.1002/cpt.113 |
| UGT1A1 and atazanavir prescribing | **26417955** | Clin Pharmacol Ther 2016 Apr;99(4):363-9 | 10.1002/cpt.269 |
| Expanded guideline for medication use in the context of G6PD genotype | **36049896** | Clin Pharmacol Ther 2023 May;113(5):973-985 | 10.1002/cpt.2735 |
| Rasburicase in the context of G6PD deficiency genotype (2014) | 24787449 | Clin Pharmacol Ther 2014 Aug;96(2):169-74 | 10.1038/clpt.2014.97 |
| IFNL3 (IL28B) and PEG-interferon-α regimens | 24096968 | Clin Pharmacol Ther 2014 Feb;95(2):141-6 | 10.1038/clpt.2013.203 |

**Trap avoided:** a PubMed search for "CPIC guideline CYP2C19 clopidogrel" also returns **28520346**,
**28520347**, **28520350**, **28520363**, **28520376**, **32997466** — these are *Medical Genetics
Summaries* book chapters (2012, no journal, no DOI), **not** the CPIC guidelines. Citing them as CPIC
guidelines would be a fabricated attribution.

### 3.3 The structural fact that governs every candidate

From `https://api.cpicpgx.org/v1/gene` and `/allele_definition`, `/allele_location_value`,
`/sequence_location` (all 2026-09-03):

| Gene | CPIC lookup method | allele definitions | of which structural | defining positions |
|---|---|---|---|---|
| CYP2C19 | PHENOTYPE | 49 | 3 | 43 |
| CYP2C9 | ACTIVITY_SCORE | 94 | 0 | 88 |
| VKORC1 | PHENOTYPE | 2 | 0 | **1** |
| SLCO1B1 | PHENOTYPE | 47 | 2 | 35 |
| TPMT | PHENOTYPE | 49 | 0 | 45 |
| NUDT15 | PHENOTYPE | 23 | 0 | 20 |
| DPYD | ACTIVITY_SCORE | 84 | 0 | 83 |
| HLA-B | ALLELE_STATUS | 3 | 0 | **0** |
| CYP2D6 | ACTIVITY_SCORE | **184** | **5** | **157** |
| UGT1A1 | PHENOTYPE | 9 | 0 | 4 |
| IFNL3 | ALLELE_STATUS | 2 | 0 | **1** |
| CYP3A5 | PHENOTYPE | 8 | 0 | 7 |
| G6PD | PHENOTYPE | **187** | 0 | **173** |

And PharmCAT's disclaimer, `https://pharmcat.clinpgx.org/Disclaimers/` (2026-09-03), states the
default-to-reference problem in the project's own words:

> "For cytochrome P450 genes, NAT2, TPMT, NUDT15, UGT1A1, and SLCO1B1, the \*1 allele is defined by the
> **absence of variation** specified in the gene definition tables. This allele cannot be identified by
> variants; rather, \*1 is assigned by default when no variation for the queried positions is reported
> in the submitted VCF file. … It is always possible un-interrogated variation can occur which could
> potentially affect allele function, but because it is undetected, the assignment would be defaulted
> to a \*1 (or reference) allele and normal function."

> "PharmCAT matches variants to genotypes **assuming unphased data** … in cases where an allele is
> defined by a combination of two or more variants, where each variant alone also defines an allele,
> the match is based on the longer allele. For example, TPMT\*3B is defined by one SNP, \*3C is defined
> by another SNP, and \*3A is defined by the combination of those two SNPs. In the case of unphased data
> that is heterozygous for both SNPs, the \*1/\*3A genotype is returned though the possibility of
> \*3B/\*3C cannot be ruled out."

That last sentence is the honest limitation for the whole category, stated by the reference
implementation: **a single position, or even two unphased positions, does not determine a diplotype,
and a diplotype is what a phenotype needs.**

### 3.4 Each candidate

Format: verified facts → what one position can and cannot say → the one-sentence limitation.

---

**CYP2C19\*2 — rs4244285 (clopidogrel).**
Verified: chr10:94781859 G>A (GRCh38), CPIC `19154G>A`. CPIC's \*2 definition row carries 4 positions
(rs12769205, rs58973490, **rs4244285=A**, rs3758581) — the other three are IUPAC `R` (unconstrained),
so rs4244285=A is the discriminating base among them. Only **two** CPIC alleles carry a call at
rs4244285: \*2 (`A`) and \*38 (`G`, a 43-position reference-like haplotype). Guideline: PMID 35034351.
CYP2C19 has 49 CPIC alleles over 43 positions, **3 of them structural** (\*36 has zero defining
positions — it is a deletion/hybrid that no SNP can see).
Can say: whether the subject carries 0, 1 or 2 copies of the \*2 no-function base at this position.
Cannot say: the diplotype or the metabolizer phenotype — \*3, \*4, \*17, \*35 and the structural \*36
all sit elsewhere, and CPIC's lookup method for CYP2C19 is **PHENOTYPE**, i.e. keyed on the diplotype.
Limitation sentence: "This reads one position out of the 43 CPIC uses to name CYP2C19 alleles, so it
can tell you whether that one change is present but not which pair of gene copies you carry."

---

**CYP2C19\*17 — rs12248560.**
Verified: chr10:94761900 C>T, CPIC `-806C>T`. **rs12248560=T appears in three CPIC alleles — \*17,
\*44 and \*45 — and as ambiguity `Y` in \*4**; \*17 additionally requires rs3758581=G. So a T at this
position is **not** equivalent to \*17.
Can say: presence of the -806T base.
Cannot say: that the subject is \*17, or that they are a rapid/ultrarapid metaboliser.
Limitation: "The change this report reads is shared by four different CYP2C19 versions, so on its own
it cannot tell you which one you have."

---

**CYP2C9\*2 (rs1799853) and \*3 (rs1057910) — warfarin, NSAIDs.**
Verified: chr10:94942290 C>T (`3608C>T`) and chr10:94981296 A>C (`42614A>C`). Each defines its star
allele with **1** position in CPIC. But **rs1799853=T also appears in \*35, \*61 and \*92**, and
**rs1057910=C also appears in \*18 and \*68**. CYP2C9's CPIC lookup method is **ACTIVITY_SCORE**
(94 alleles, 88 positions), i.e. the phenotype is a sum over both gene copies. Guidelines: warfarin
PMID 28198005; NSAIDs PMID 32189324.
Can say: presence/absence of the two commonest reduced-function bases.
Cannot say: the activity score (needs both copies and the other 86 positions), and nothing about
warfarin dose — the brief forbids dosing language outright (§4).
Limitation: "Two positions cannot produce the activity score CPIC uses, and other reduced-function
changes are common in some ancestries."

---

**VKORC1 rs9923231 (warfarin).**
Verified: chr16:31096368 C>T, CPIC `-1639G>A`. **This is the cleanest candidate structurally**: CPIC's
VKORC1 table has exactly **2 alleles over 1 position** — "rs9923231 reference (C)" and "rs9923231
variant (T)". The gene is genuinely single-position in CPIC's model. Guideline PMID 28198005.
Can say: the genotype at the one position CPIC uses for VKORC1.
Cannot say: a warfarin dose or a bleeding risk. The 2017 guideline's dosing content is exactly what
Inherit may not reproduce.
Limitation: "This is one of several inputs a prescriber combines; by itself it is not a dose."

---

**SLCO1B1 rs4149056 (statins).**
Verified: chr12:21178615 T>C, CPIC `37041T>C`. \*5 is defined by this position alone, but **the C
allele also appears in \*15 (with rs2306283=G), \*40, \*47, and as `Y` in \*45** — six CPIC alleles
touch this position, out of 47 alleles over 35 positions, 2 of them structural (\*48, \*49 are partial
or whole gene deletions that a VCF cannot see — PharmCAT lists them explicitly). CPIC lookup method:
PHENOTYPE. The 2022 guideline (PMID 35152405) is a **three-gene** guideline (SLCO1B1 **+ ABCG2 +
CYP2C9**), so a single-gene report is a partial rendering of it by construction.
Can say: presence of the decreased-function C allele.
Cannot say: the SLCO1B1 phenotype (needs the diplotype), and nothing about which statin or what dose.
Limitation: "The guideline this comes from reads three genes together; this report reads one position
in one of them."

---

**TPMT rs1800462 (\*2), rs1800460 (\*3B), rs1142345 (\*3C) — thiopurines.**
Verified: chr6:18143724 C>G, chr6:18138997 C>T, chr6:18130687 T>C. TPMT: 49 CPIC alleles over 45
positions, lookup method PHENOTYPE. **\*3A is defined by rs1800460 + rs1142345 together**, and
PharmCAT's disclaimer (quoted in §3.3) says in terms that unphased heterozygosity at both cannot
distinguish \*1/\*3A (intermediate) from \*3B/\*3C (**poor**) — a phenotype difference, not a
cosmetic one. **rs1142345 is multi-allelic in CPIC's own table: `T>C` gives \*3C, `T>G` gives \*41**,
which the one-`ref`/one-`alt` schema cannot express. Current guideline: **PMID 41618934 (2025 Update,
CPT 2026)**, superseding PMID 30447069.
Can say: the base at each of three positions.
Cannot say: which chromosome carries what, therefore not the phenotype in the exact case that matters.
Limitation: "When two of these changes are both present, this cannot tell whether they sit on the same
gene copy or on different ones, and that difference changes the answer."

---

**NUDT15 rs116855232 — thiopurines.**
The following historical second-change inference is corrected on 2026-09-06;
see the dated note above. Two defining positions do not require two changes.
Verified: chr13:48045719 C>T. Two CPIC alleles carry a call here: \*1 (`C`) and **\*3 (`T`) — but \*3
also requires rs746071566** (a `GAGTCG(3)`/`GAGTCG(4)` repeat), so this SNP alone does not call \*3.
23 alleles over 20 positions; lookup method PHENOTYPE. Same 2025 guideline (PMID 41618934). PharmCAT
also lists NUDT15 `*1/*2` vs `*3/*6` as an unphased ambiguity with different phenotypes.
Can say: presence of the T allele at the single best-known NUDT15 position.
Cannot say: the \*3 call (a repeat variant is co-required) or the phenotype.
Limitation: as TPMT.

---

**DPYD rs3918290 — fluoropyrimidines.**
Verified: chr1:97450058 C>T; CPIC names the allele `c.1905+1G>A (*2A)` and defines it with **1**
position (variant allele `T` on the plus strand; the gene is on the minus strand). DPYD: 84 alleles
over 83 positions, lookup method **ACTIVITY_SCORE**. Guideline PMID 29152729. CPIC's pair table marks
DPYD–capecitabine and DPYD–fluorouracil as **"Testing Required"** (level A) — the strongest testing
category in CPIC's own vocabulary. PharmCAT's exception page: "If unphased data … is provided in the
VCF file, and the data are not homozygous at all positions, the Named Allele Matcher **will not attempt
to call a diplotype**" for DPYD.
Can say: presence of one of the four canonical no-function DPYD variants.
Cannot say: the gene activity score (CPIC sums the two lowest-scoring variants across the gene), and
absence here is emphatically not absence of DPYD deficiency.
Limitation: "A negative result here does not rule out DPYD deficiency; other no-function changes exist
and this report reads one of them." **Safety-critical:** the drugs are chemotherapeutics and CPIC
classifies testing as required — a "reassuring" reading of a negative could contribute to a fatal
overdose. This is the candidate where a false-reassurance harm is most severe.

---

**HLA-B\*57:01 tag SNP rs2395029 — abacavir.**
Verified: chr6:31464003 T>G; **dbSNP assigns the locus to HCP5, not HLA-B**; Ensembl additionally maps
it to two MHC alt scaffolds. **CPIC's HLA-B table has 3 allele definitions and ZERO sequence
positions** — CPIC's lookup method for HLA-B is `ALLELE_STATUS`, i.e. it expects an HLA typing result
as input, and defines \*57:01 by **no** SNP at all. PharmCAT (`/using/Calling-HLA/`, 2026-09-03):

> "Calling HLA from a VCF is difficult given that most of the variation necessary to type an HLA allele
> can be missing from the files, and methods to call HLA from a VCF file generally rely on using well
> known haplotype tagging SNPs in the population or HLA imputation using population references. We
> recommend that you use targeted high resolution typing for HLA … **we do NOT recommend imputing HLA
> from a VCF**".

Guideline PMID 24561393. The tag-SNP caveat is therefore not a nuance to footnote — it is the whole
finding: rs2395029 is a **population-specific linkage proxy**, and its predictive value differs by
ancestry (the specific per-ancestry sensitivity/specificity figures are **UNVERIFIED** — I did not
retrieve them and will not state numbers).
Cannot say: HLA-B\*57:01 status. Abacavir hypersensitivity is a serious, occasionally fatal reaction
and \*57:01 screening is standard of care; a wrong answer here is a clinical harm, not an inconvenience.

---

**CYP2D6 — recommend exclusion, on primary evidence.**
Verified: CPIC lists **184 CYP2D6 allele definitions over 157 positions, 5 of them structural**, with
lookup method ACTIVITY_SCORE. PharmCAT's own documentation
(`https://pharmcat.clinpgx.org/using/Calling-CYP2D6/`, 2026-09-03) states:

> "While PharmCAT supports CYP2D6, **we do NOT recommend calling CYP2D6 from VCF** due to the large
> influence of structural variation (SV) and copy number variation (CNV) on inferring CYP2D6 phenotype,
> **which is beyond the scope of what can be called from SNPs or INDELs in a VCF file.**"

> "**CYP2D6 UMs cannot be called using only SNPs and INDELs in a VCF file.**"

> "In the specific case where a sample has the whole gene deletion (\*5) on one CYP2D6 allele and
> presents variants on the other CYP2D6 allele, **these hemizygous variants will be falsely presented
> as homozygous in the VCF**, e.g. \*5/\*29 will be detected as \*29/\*29".

They also publish a 6-sample comparison against the CDC GeT-RM consensus calls showing WES and
low-coverage WGS producing `No_call` or wrong copy numbers, concluding: "we do not recommend the use
WES or low-coverage WGS for calling CYP2D6 for both research and clinical purposes."
**Recommendation: exclude CYP2D6 entirely**, in any form, including a "one SNP" report. A single-SNP
CYP2D6 report is not a weak report; it is a wrong one, and it is wrong in the direction of
under-calling no-function alleles.

---

**UGT1A1\*28 — rs3064744.**
Verified: **it is a TA dinucleotide repeat, not a SNP.** dbSNP `variant_type: "delins"`, GRCh38
chr2:233760234–233760248, with **seven** alleles (`ATATATATATA` … `ATATATATATATATATATATATA`). CPIC
records it at position 233760235 with names `CA(TA)5TAA / CA(TA)6TAA / CA(TA)7TAA / CA(TA)8TAA` and
HGVS `TA[6]; TA[7]; TA[8]; TA[9]`, and assigns: **\*1 = TA(7), \*28 = TA(8), \*36 = TA(6), \*37 = TA(9)**
in that HGVS-repeat-count notation (the count is one higher than the conventional "(TA)n" label because
the trailing TAA contributes a TA). dbSNP maps the position to **nine** UGT1A genes.
**Can a VCF or array call it?** Verified answer: consumer **arrays** genotype single bases at fixed
probes and do not size repeats — an array cannot call it (this follows from the array format itself, and
Inherit's own not-covered copy already says arrays "test a fixed set of positions"). A **VCF** can in
principle represent it, but PharmCAT's exception documentation shows how fragile co-located
indel/SNP representation is in practice, and CPIC's own table for UGT1A1 also has the compound
haplotypes \*80+\*28 and \*80+\*37 which PharmCAT lists among the unphased-ambiguity cases
(`*1/*80+*28` [Intermediate] vs `*28/*80` [Indeterminate]).
**Against the Inherit schema this is fatal**: `ref`/`alt` are single strings, `genotypeKeys()` produces
three diploid keys, and a 7-allele repeat cannot be encoded. **Exclude on schema grounds alone.**

---

**IFNL3 rs12979860 — exclude, and the reason is decisive.**
Verified: chr19:39248147 C>T; **dbSNP assigns the locus to IFNL4, not IFNL3**; CPIC calls it
`-1595G>A` under IFNL3 and defines exactly two "alleles" (reference C / variant T) over one position —
structurally the cleanest candidate of all. **But CPIC has retired the pair.**
`https://api.cpicpgx.org/v1/pair_view?genesymbol=eq.IFNL3` (2026-09-03) returns both
peginterferon alfa-2a and alfa-2b with **`"cpiclevel":"Retired"`**. The guideline (PMID 24096968,
2014) concerns interferon-based hepatitis C regimens that direct-acting antivirals have displaced.
A report about response to a retired therapy is not a service to a reader.

---

**CYP3A5\*3 — rs776746 (tacrolimus).**
Verified: chr7:99672916, **GRCh38 ref T**, alt C (CPIC `6981A>G` / `g.99672916T>C`); the GRCh37
reference base was C, so build handling must be right. CPIC: 8 alleles over 7 positions, lookup method
PHENOTYPE; \*3 defined by this one position, \*6 by rs10264272, \*7 by rs41303343. Only two alleles
touch rs776746: \*1 (`T`) and \*3 (`C`). Guideline PMID 25801146. CPIC level A pair: **tacrolimus only**
— a single immunosuppressant given after organ transplant.
Can say: the genotype at the single defining position of \*3.
Cannot say: the phenotype without \*6 and \*7, which are relevant in African-ancestry populations
(the specific frequencies are **UNVERIFIED** here).
Limitation, and the real objection: the only drug is one that transplant recipients take under
specialist supervision with therapeutic drug monitoring. A consumer report adds nothing a transplant
team does not already have, and risks a patient second-guessing a monitored dose.

---

**G6PD — X-linked, sex-dependent, and blocked in this codebase.**
Verified: CPIC lists **187 G6PD allele definitions over 173 positions**, gene on chrX, lookup method
PHENOTYPE. CPIC's phenotype vocabulary for G6PD
(`https://api.cpicpgx.org/v1/gene_result?genesymbol=eq.G6PD`, 2026-09-03) is: **Normal, Deficient,
Deficient with CNSHA, Variable, Indeterminate** — with "Variable" carrying EHR priority
"Abnormal/Priority/High Risk". The existence of a distinct **"Variable"** phenotype is exactly the
sex-dependence problem: heterozygous individuals cannot be assigned to Normal or Deficient. Guideline:
PMID 36049896 (expanded, 2023). CPIC's level-A G6PD pairs include rasburicase, primaquine, tafenoquine
and pegloticase, several marked **"Testing Required"**.
Two hard blockers, both verified:
1. **Repository blocker.** `genotypeKeys()` emits haploid keys only for chrom 24/25; a hemizygous X
   call yields `{status: "unrecognized"}`, rendered as a no-call. The schema cannot express an X-linked
   result today.
2. **Scientific blocker.** 173 defining positions; and PharmCAT documents that it cannot even call two
   G6PD alleles (Mediterranean Haplotype, Villeurbanne) because of reference-base and co-located-indel
   representation problems (`https://pharmcat.clinpgx.org/methods/Gene-Definition-Exceptions/`).
   Reading rs1050828 and rs1050829 alone captures the A- variants and misses the Mediterranean class
   entirely — the class with the most severe haemolysis.
Limitation: "For a gene on the X chromosome, one copy or two changes what a result means, and this
reads two positions out of the 173 CPIC uses."

---

## 4. Safety rules from the brief that constrain any Medicines report

Grepped from `docs/inherit-v2-brief.md` (`medicine|dose|dosage|prescrib|pharmac|not a doctor|clinician|
diagnos|supplement|treatment`):

1. **§6.1, line 1849 — the point-of-display string, verbatim and mandatory**:
   `"This is not a diagnosis. Inherit is not a doctor and no clinician has reviewed this. Talk to a
   qualified professional before acting on anything here."` It must render on `/reports/[slug]` among
   other routes. Already in the repo at `src/copy/reports/strings.ts:39` (`NOT_DIAGNOSTIC`).
2. **§6.4, line 913 — lexical blocklist**: `we recommend you take`, `\bdosage\b`, `\bsupplement\b`
   outside a refusal string — "Inherit gives information, not treatment advice." **No dosing language
   of any kind may appear**, which excludes the operative content of every CPIC guideline.
3. **Line 630 — "What you can do" has a fixed no-action string**: "There is nothing you need to do
   about this result. It does not change what any doctor would advise for you today." — "This string
   exists so the mandatory heading can never be filled with treatment advice, which §6.4 forbids."
   Note the collision: for a PGx report this string is *false* if the finding is actionable, and
   *forbidden to replace with advice* if it is. That collision needs resolving before any PGx template
   ships.
4. **Line 1492 — "Will not claim"**: diagnosis, treatment or medical advice; that a report is a
   clinical test; **that an absent finding is a negative result**; coverage/completeness claims.
5. **Line 1983 / §6.1 lexical gate** — `diagnos*`, `physician-ordered`, `clinically validated`, `FDA`,
   `medical advice` may appear only inside `data/legal/allowed-sentences.json` sentences or a
   `data-legal-verbatim` region.
6. **Line 2331 — will not build**: "any clinical diagnosis, physician order, or output labelled
   clinical-grade."
7. **Line 2262 — Copilot prohibitions**: "no diagnosis, no prognosis, **no treatment or supplement
   advice**", enforced by `src/lib/copilot/guard.ts` (**file does not exist yet**;
   `src/copy/copilot/` does not exist either — so the Copilot would answer questions about a Medicines
   report with no guard in place today).
8. **Line 1040** — `e2e/copilot-refusal.spec.ts` must cover "supplement, dosage, diet" prompts.
9. **§4.2 line 254 and line 470** — "`Medicines` is absent while it has zero published templates"; a
   category with zero published templates "is absent, not empty."
10. **Line 398 — embryo allowlist**: `Medicines` **does not render for embryo subjects**. A populated
    Medicines category must be excluded from every embryo surface by construction.
11. **§7.1 line 955 — Limits slot**: ≤ 40 words, always visible, must state that this is an estimate
    about groups and not a diagnosis, the ancestry groups the model was tested in, and one named thing
    it does not account for. For PGx the "one named thing" is the other star alleles — which is close
    to the whole finding.
12. **Line 1902 — FTC Health Products Compliance Guidance** applies by its terms to diagnostic tests,
    requires competent and reliable scientific evidence **in hand before dissemination**, judges the
    **net impression**, and treats "may"/"preliminary" as inadequate qualifiers. A page headed
    "Medicines" that shows a clopidogrel-related genotype creates a net impression of medication
    guidance regardless of caveats.
13. **§8 evidence rubric** — `clinical` and `established` are reachable **only by two-reviewer review**
    (§7.2); a new template can therefore ship at most at `emerging`. A category called "Medicines"
    populated entirely with `emerging` findings drawn from CPIC level-A guidelines misrepresents the
    evidence in the *opposite* direction from usual — the underlying science is strong, the
    single-position rendering of it is weak, and the rubric has no level that says that.

---

## 5. Recommendation table

| Candidate | Verdict | Reason (all facts verified above) |
|---|---|---|
| VKORC1 rs9923231 | **populate** | Coordinates verified 3×; CPIC models the gene with exactly 2 alleles over 1 position, so a single-position report is a complete rendering of CPIC's own model; guideline PMID 28198005 verified. Must carry no dose language. |
| CYP2C19\*2 rs4244285 | **populate (guarded)** | Coordinates verified; only 2 CPIC alleles touch the position; guideline PMID 35034351 verified. Honest only if the report claims presence of one change, never a metaboliser status. |
| CYP2C9\*2 rs1799853 | **populate (guarded)** | Verified; defines \*2 with 1 position, but the same base appears in \*35/\*61/\*92 and the gene is scored by activity across both copies. |
| CYP2C9\*3 rs1057910 | **populate (guarded)** | As above; base shared with \*18/\*68. |
| SLCO1B1 rs4149056 | **populate (guarded)** | Verified; but 6 CPIC alleles touch the position and the 2022 guideline is a three-gene guideline — the report is a partial rendering by construction. |
| CYP2C19\*17 rs12248560 | **exclude** | Verified that the T allele appears in \*17, \*44, \*45 and ambiguously in \*4; a "\*17" claim from this SNP alone is not supportable. Could be populated only as a bare-position report with no star-allele name. |
| TPMT rs1800462 / rs1800460 / rs1142345 | **exclude** | Phase-dependent: PharmCAT states \*1/\*3A (intermediate) cannot be distinguished from \*3B/\*3C (poor) in unphased data. **rs1142345 is multi-allelic in CPIC (T>C and T>G)** and cannot be encoded in the one-alt schema. |
| NUDT15 rs116855232 | **exclude (historical; corrected 2026-09-06 above)** | Original rationale: \*3 requires a co-defining repeat variant (rs746071566); the SNP alone does not call the allele, and unphased \*1/\*2 vs \*3/\*6 is ambiguous. The required-change inference is superseded by the dated source correction. |
| DPYD rs3918290 | **exclude** | Activity-score gene (83 positions); CPIC marks the drug pairs "Testing Required"; PharmCAT refuses to call a DPYD diplotype from unphased heterozygous data. Absence of this variant does not exclude deficiency, and the drugs are chemotherapeutics — highest false-reassurance harm of any candidate. |
| HLA-B\*57:01 tag rs2395029 | **exclude** | CPIC defines HLA-B by allele status with **zero** sequence positions; dbSNP places rs2395029 in **HCP5**; PharmCAT explicitly does not recommend calling or imputing HLA from a VCF. Tag-SNP performance varies by ancestry and the figures are UNVERIFIED. |
| CYP2D6 (any single SNP) | **exclude** | 184 alleles / 157 positions / 5 structural; PharmCAT states in terms that CYP2D6 must not be called from VCF, that UM cannot be called from SNPs/indels, and that a \*5 deletion makes hemizygous variants look homozygous. |
| UGT1A1\*28 rs3064744 | **exclude** | It is a 7-allele TA-repeat `delins`, not a SNP; the schema's single `ref`/`alt` and three diploid keys cannot represent it; arrays cannot size repeats. |
| IFNL3 rs12979860 | **exclude** | CPIC marks both peginterferon pairs **"Retired"**; the therapy is superseded. (Also: dbSNP assigns the locus to IFNL4.) |
| CYP3A5\*3 rs776746 | **exclude** | Structurally clean, but the only level-A drug is tacrolimus, taken by transplant recipients under therapeutic drug monitoring; no consumer benefit, real risk of second-guessing a monitored dose. Also a GRCh37→38 reference-base flip that must not be got wrong. |
| G6PD (rs1050828 / rs1050829) | **exclude** | X-linked: `genotypeKeys()` produces no haploid key for chrom 23, so a hemizygous call renders "unrecognized"; CPIC needs 173 positions and has a distinct "Variable" phenotype for heterozygotes; PharmCAT cannot call two G6PD alleles at all. |

### 5.1 Overall recommendation

**Recommend: WITHHELD, with a dossier — not populate.**

Five candidates could survive as bare single-position reports (VKORC1, CYP2C19\*2, CYP2C9\*2, CYP2C9\*3,
SLCO1B1). That is not a defensible "Medicines" category, for reasons that are themselves verified
facts rather than judgement calls:

- **The category's own promise cannot be kept.** The copy says "How your body may respond to some
  common medicines." Four of the five survivors are about **warfarin, clopidogrel, NSAIDs and statins**
  — and in every case the honest report says only "you carry this base", while the thing the reader
  came for (how they respond) requires a diplotype the file cannot supply. Brief §7.1 slot 2 requires
  the plain summary to state "the single most important thing it cannot tell you"; here that sentence
  swallows the report.
- **The brief's own layer definition points the other way.** §1163 puts "pharmacogenomic star alleles"
  in the **`variant_call`** layer, which has zero templates and no renderer path today (defect D-014).
  Shipping PGx as `estimate`/`single_locus` — the only layer that currently works — mislabels it.
- **The safety rules subtract the guideline's content.** No dosing, no `dosage`, no treatment advice,
  a fixed "nothing you need to do" string, and the FTC net-impression standard. What remains of a CPIC
  guideline after those subtractions is a genotype and a caveat.
- **The Copilot guard that §2262 requires does not exist** (`src/lib/copilot/guard.ts` absent), so a
  Medicines category would ship with free-text chat over medication genotypes and no enforced refusal
  path.

**Classified obstacle for the dossier: SAFETY (primary), with SCIENTIFIC as the supporting class.**
It is **not** legal — CPIC content is CC0 and PubMed citation needs no new licence entry, so a licence
story exists (the PharmGKB research-use term and the unreadable PharmVar terms are avoidable by using
CPIC + dbSNP + PubMed only). It is **not** data-availability — the data are all freely retrievable, as
this pass demonstrates.

### 5.2 What the withheld dossier must prove — including what I could not establish

A dossier claiming evidenced impossibility must carry, at minimum:

1. **The single-position honesty proof, per candidate.** For each gene, the CPIC allele count, the
   defining-position count, and the list of alleles sharing the candidate position — all of which are
   in §3.3 and §3.4 above with their API URLs and the 2026-09-03 access date.
2. **The phase argument, quoted from the reference implementation.** PharmCAT's TPMT \*1/\*3A vs
   \*3B/\*3C paragraph and the DPYD "will not attempt to call a diplotype" paragraph.
3. **The structural-variation argument.** PharmCAT's CYP2D6 page and CPIC's structural-allele counts
   (CYP2D6 5, CYP2C19 3, SLCO1B1 2).
4. **The schema argument, with the exact code lines.** `genotypeKeys()` chrom 24/25 haploid rule; the
   single `ref`/`alt` pair versus rs1142345's two alt alleles and rs3064744's seven; the
   `{status:"unrecognized"}` fall-through for a hemizygous X call.
5. **The safety argument**, listing the twelve brief rules in §4 and demonstrating that the residue
   after applying them is not the category's stated promise.
6. **A currency commitment.** CPIC's own licence asks users to "indicate that CPIC guidelines and
   content are subject to updates and modifications" — and this pass already found one supersession in
   flight (thiopurines: PMID 30447069 → **41618934**) and one retirement (IFNL3 → "Retired"). A
   dossier must state how Inherit would have detected those, because a stale PGx report is worse than
   none.

**What I could not establish, and a dossier must not paper over:**
- **PharmVar's licence terms — UNVERIFIED.** Site is JS-only, API is key-gated, bundle contains no
  licence text, overview PDF has no extractable text layer, and the public web archive is blocked by this
  session's egress policy. If any future work touches PharmVar allele-definition files, this must be
  read by a human first.
- **Whether PharmGKB's research-use Terms of Use survive its CC BY-SA 4.0 grant.** A legal question,
  stated in §2.2, deliberately not answered here.
- **Every allele frequency, per-ancestry tag-SNP sensitivity/specificity, and every effect size.** None
  were retrieved; all are UNVERIFIED. In particular the ancestry-dependence of rs2395029 as an
  HLA-B\*57:01 proxy — the fact that would justify the abacavir exclusion in numbers — is asserted here
  only qualitatively, from CPIC's zero-sequence-position HLA-B definition and PharmCAT's
  do-not-impute recommendation.
- **What "populate" would cost.** I did not attempt to determine whether a `variant_call` renderer,
  an X-chromosome haploid key path, or a multi-allelic schema extension are days or weeks of work.

### 5.3 If the orchestrator chooses "populate" anyway

The minimum honest version is: **VKORC1 rs9923231 only**, as a bare-position report, in the
`variant_call` layer once that layer has a renderer, titled without any jargon term, with no dose or
drug-choice language, carrying PMID 28198005, and with the category description rewritten so it does
not promise "how your body may respond". Even then, a single-template category renders a "Medicines"
heading over one warfarin-related genotype, which is arguably a worse net impression under the FTC
standard than the category's honest absence. And under X15, absence itself is only permissible **as a
registered withholding with a dossier** — silence is never a withholding.

---

## Appendix — every URL read, all on 2026-09-03

Repository (read-only): `docs/inherit-v2-brief.md`, `docs/dataset-licenses.md`,
`docs/capability-register.md`, `docs/protocol/defects.md`, `data/templates/SCHEMA.md`,
`data/templates/gastrointestinal.json`, `data/templates/*.json`, `data/jargon.json`,
`data/plain-vocabulary.json`, `data/ref/AIMS_PROVENANCE.md` (there is no `data/ref/PROVENANCE.md`),
`scripts/validate-templates.ts`, `scripts/readability-gate.ts`, `scripts/seed.ts`,
`src/lib/genome/template-prose.ts`, `src/lib/genome/taxonomy.ts`, `src/lib/genome/reports.ts`,
`src/lib/genome/types.ts`, `src/copy/reports/strings.ts`,
`src/app/(app)/genome/[subject]/reports/page.tsx`, `src/app/(app)/genome/[subject]/reports/[slug]/page.tsx`.

Network:
- `https://rest.ensembl.org/variation/human/rs{4244285,12248560,1799853,1057910,9923231,4149056,1800462,1800460,1142345,116855232,3918290,2395029,776746,12979860,3064744,1050828,1050829}?content-type=application/json`
- `https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/{same set}`
- `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` and `esummary.fcgi` (db=pubmed) for every PMID in §3.2
- `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=PMC5836850`
- `https://api.clinpgx.org/v1/data/page/dataUsagePolicy` (the licence text of §2.2 and §2.3)
- `https://www.clinpgx.org/assets/main-D-rWJZJl.js` (confirms the site's own footer links "Licensing & Usage" → `/page/dataUsagePolicy` and the CC BY-SA 4.0 badge)
- `https://api.cpicpgx.org/v1/` (swagger), `/gene`, `/allele_definition`, `/allele_location_value`, `/sequence_location`, `/publication`, `/pair_view`, `/gene_result`
- `https://pharmcat.clinpgx.org/methods/`, `/using/Calling-CYP2D6/`, `/using/Calling-HLA/`, `/Disclaimers/`, `/methods/Gene-Definition-Exceptions/`
- `https://raw.githubusercontent.com/PharmGKB/PharmCAT/development/LICENSE` (MPL-2.0)
- `https://files.cpicpgx.org/` (S3 listing; CPIC database dumps)
- Attempted and blocked/unusable: `https://doi.org/10.1002/cpt.2526` (403 via proxy),
  the public web archive (403 "Blocked by egress policy"),
  `https://api.pharmgkb.org/v1/download` (502 CONNECT, policy denial),
  `https://www.pharmvar.org/{,terms,about,faq,documentation}` (JS shell only),
  `https://www.pharmvar.org/api-service/*` (401, API key required),
  `https://www.pharmvar.org/documents/pharmvar_overview.pdf` (no text layer).
