# Glossary sources — method, findings, and what is still missing

The operator decided on 2026-09-12 to source all 42 `cited` glossary
definitions for real, on the explicit condition that **any source that cannot
actually be reached stays uncited and its term stays invisible**. Nothing here
is filled in from memory.

## The finding that set the method, and its correction

A summarising web fetch of the NHGRI page for "polygenic risk score" reported
it as last updated on the day of the fetch. That was recorded here as a
fabrication — a model substituting today's date for metadata the page did not
carry.

**That reading was wrong, and reading the raw bytes the same day disproved
it.** The page really does say `updated: September 12, 2026`, and so do
`Susceptibility`, `Pathogenic Variant` and `Polygenic Trait`. NHGRI renders the
**current date** as every glossary entry's update line. Nothing was invented;
the source itself supplies a date that carries no information.

The conclusion survives the correction and is stronger for it. A summariser
cannot warn you about this, because the summariser is reading the page
correctly — the page is what is unreliable. A citation register exists to make
provenance checkable, so a meaningless date in it is worse than a missing one:
it looks like evidence.

So every snapshot here is produced by `scripts/glossary/fetch-source.mjs`,
which reads the **raw bytes** and records only strings it can point at:

- `pageDescription` — the page's own description metadata, never paraphrased.
  It is the term's definition on a glossary and the course blurb on a syllabus,
  so it is named for what it is;
- `fetchedAt` — this machine's clock at the moment of the request, the one date
  anyone here can honestly attest to;
- `pageSha256` — over the exact bytes received;
- `pageDate` — `null` unless a date string is actually in the bytes, and
  accompanied by `pageDateIsFetchDate`, which is `true` on every NHGRI snapshot
  and is how the tell above shows up in the file rather than in a regex that
  happened not to match it.

The quote is the evidence. Nothing is recorded as a quote until the script has
located it in the fetched bytes, so a source whose definition is rendered by
JavaScript cannot be cited here at all — see the NCI note below.

## Sourced, and the judgement on each

Judged against what Inherit's own definition in `data/jargon.json` claims, not
against the term's name.

| term | source | verdict |
|---|---|---|
| `carrier` | NHGRI, *Carrier* | **supports it.** "an individual who carries and is capable of passing on a genetic mutation … and may or may not display disease symptoms" covers Inherit's "can pass on, often without having the condition". |
| `genome-wide association study` | NHGRI, *Genome-Wide Association Studies (GWAS)* | **supports it**, from the page body rather than its one-line description: "surveying the genomes of many people, looking for genomic variants that occur more frequently in those with a specific disease or trait". Inherit's "many DNA positions in many people" needed that sentence; the description alone would have been a weaker claim than the definition makes. |
| `susceptibility` | NHGRI, *Susceptibility* | **supports it.** "the state of being predisposed to, or sensitive to, developing a certain disease" is Inherit's "a tendency toward an outcome". The definition's "not a certain result" is that same fact stated negatively, which is recorded in the register's `claim` rather than treated as something the page separately asserts. |
| `penetrance` | MedlinePlus Genetics, *What are reduced penetrance and variable expressivity?* | **supports it,** almost word for word: "the proportion of people with a particular genetic variant … who exhibit signs and symptoms of a genetic disorder" against Inherit's "how often people with a DNA change show the linked trait or condition". This page is also the only one sourced so far that carries a real modification date (April 19, 2021) rather than the date of the fetch. |
| `confidence interval` | NIST/SEMATECH e-Handbook 7.1.4 | **supports it.** "provides a range of values which is likely to contain the population parameter of interest" carries both halves of "a range showing uncertainty around an estimate". |
| `percentile` | NIST/SEMATECH e-Handbook 7.2.6.2 | **supports it.** "Percentiles split a set of ordered data into hundredths" is Inherit's "one hundred equal parts". |
| `average` | NIST/SEMATECH e-Handbook 1.3.5.1 | **supports it.** "to find a typical or central value that best describes the data", and the same section states plainly that the mean "is that value that is most commonly referred to as the average". |
| `prevalence` | CDC, *Principles of Epidemiology*, Lesson 3 §2 | **supports it.** "the proportion of persons in a population who have a particular disease or attribute at a specified point in time". |
| `incidence` | CDC, *Principles of Epidemiology*, Lesson 3 §2 | **supports it, from a table.** The quote is the numerator CDC gives for incidence proportion — "Number of new cases of disease during specified time interval" — and the denominator on the same row is the population at the start of the interval. Both halves are recorded in the register's `claim`, because a table cell quoted alone would look like more than it is. |
| `absolute risk` | CDC, *Principles of Epidemiology*, Lesson 3 §2 | **supports it, under another name.** CDC calls the measure incidence proportion and lists "risk" among its synonyms on the same page. That is why the citation is not to a page using the phrase "absolute risk", and the register says so. |
| `relative risk` | CDC, *Principles of Epidemiology*, Lesson 3 §5 | **supports it.** "compares the risk of a health event … among one group with the risk among another group", and CDC gives "relative risk" as the alternative name for the risk ratio in the same sentence. |

## Judged and REJECTED, with the snapshot kept as the evidence

| term | source checked | why it does not carry the definition |
|---|---|---|
| `polygenic` | NHGRI, *Polygenic Trait*, and *Polygenic Risk Score (PRS)* | Inherit defines the adjective — "influenced by many DNA positions, usually with small effects". The PRS page defines a *score*, not the adjective. The Polygenic Trait page defines the adjective but as "influenced by two or more genes", and searching its body for "small effect", "many variants" and "thousands" finds nothing. Two or more genes is not "many DNA positions … with small effects", so the term stays uncited. |
| `pathogenic` | NHGRI, *Pathogenic Variant* | Inherit's definition is the ACMG sense — "a DNA change that a **clinical review has judged** to cause a condition" — and the page never mentions classification or review. It defines a pathogenic variant as one that "may increase a person's risk", and adds that carrying one "does not guarantee" the condition. That is a different claim from the one Inherit makes, so citing it would misrepresent both. The right authority is the ACMG/AMP classification guidance or ClinGen; neither has been fetched yet. |

## Authorities probed and what they can carry

- **NHGRI Talking Glossary** — static HTML, quotes verifiable. It has no page
  for `heritability`, `penetrance`, `imputation`, `linkage disequilibrium` or
  `meta-analysis`; its index was fetched and read rather than guessed at.
- **MedlinePlus Genetics** — static HTML, real modification dates. Covers the
  inheritance and variant-interpretation half.
- **NIST/SEMATECH e-Handbook of Statistical Methods** — static HTML, and the
  natural authority for `odds ratio`, `z-score`, `hazard ratio`, `effect size`,
  `probability`, `baseline`, `estimate` and `model`, which are statistics
  rather than genetics.
- **CDC, *Principles of Epidemiology in Public Health Practice*** — static
  HTML, and the authority for the epidemiological measures. It is served from
  `archive.cdc.gov`; the live `www.cdc.gov` path for the course now 404s. The
  archive is CDC's own, the snapshot pins the bytes, and the URL says plainly
  that it is an archive.
- **NCI Dictionary of Cancer Terms — CANNOT BE CITED BY THIS METHOD.** Every
  `cancer.gov/publications/dictionaries/...` page returns a JavaScript shell
  whose body is "You need to enable JavaScript to run this app." The definition
  is fetched at runtime from `webapis.cancer.gov`, so the quote is not in the
  bytes at the URL a reader would open. Quoting it would mean recording a quote
  the snapshot cannot verify, which is the one thing this method exists to
  prevent. It stays unused unless the register is willing to cite an API
  response separately from the human page — a decision, not a workaround.

## Still uncited: 31 of 42

`association`, `autoimmune`, `baseline`, `classification`, `clinical`,
`clinician`, `condition`, `diagnosis`, `effect size`, `estimate`,
`hazard ratio`, `heritability`, `imputation`, `inflammation`,
`linkage disequilibrium`, `medical`, `medication`, `meta-analysis`, `model`,
`odds`, `odds ratio`, `overload`, `pathogenic`, `polygenic`, `probability`,
`reference panel`, `replication`, `risk allele`, `sensitivity`, `statistical`,
`z-score`.

Each stays invisible to readers until a fetched page carries its definition.
That is the operator's condition working as intended, not a gap to be closed by
lowering the standard.
