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
| `heritability` | NCI, *Dictionary of Genetics Terms* | **supports it.** "The proportion of variation in a population trait that can be attributed to inherited genetic factors" is Inherit's "the share of the differences between people in a trait that comes from their genes". |
| `linkage disequilibrium` | NCI, *Dictionary of Genetics Terms* | **supports it.** "occur together more often than can be accounted for by chance because of their physical proximity on a chromosome". |
| `odds ratio` | NCI, *Dictionary of Cancer Terms* | **supports it.** "the odds of an event happening in one group compared to the odds of the same event happening in another group" — including the "expressed as odds" half, which CDC's own definition of the measure does not state. |
| `hazard ratio` | NCI, *Dictionary of Cancer Terms* | **supports it.** "how often a particular event happens in one group compared to how often it happens in another group, over time". Inherit says "how much faster one group reaches an event"; that is the same quantity described the other way round, and the `claim` says so rather than leaving a reader to assume it. |
| `meta-analysis` | NCI, *Dictionary of Cancer Terms* | **supports it.** "A process that analyzes data from different studies done about the same subject." |
| `autoimmune` | NCI, *Dictionary of Cancer Terms* | **supports it.** "the body's immune system mistakes its own healthy tissues as foreign and attacks them". |
| `inflammation` | NCI, *Dictionary of Cancer Terms* | **supports it in part.** "A normal part of the body's response to injury or infection." Inherit's definition adds "irritation", which the source does not carry; the `claim` says so and does not attribute it. |
| `condition` | NCI, *Dictionary of Cancer Terms* | **supports it.** "a normal state with regard to one's health, such as pregnancy, or … a disease, disorder, illness, or injury". |
| `diagnosis` | NCI, *Dictionary of Cancer Terms* | **supports it.** "The process of identifying a disease, condition, or injury from its signs and symptoms." The source names the process; Inherit names the conclusion it reaches, which the `claim` records. |
| `clinical` | NCI, *Dictionary of Cancer Terms* | **supports it in part.** "Having to do with the examination and treatment of patients." The word "qualified" is Inherit's own restriction and is not attributed to NCI. |
| `clinician` | NCI, *Dictionary of Cancer Terms* | **supports it in part.** "A health professional who takes care of patients", with the same note about "qualified". |
| `sensitivity` | NCI, *Dictionary of Cancer Terms* | **supports it.** Inherit's definition holds two senses and so does the entry. The quote is the test sense; the entry's next sentence carries the other. |
| `pathogenic` | ACMG/AMP 2015 consensus recommendation (PMC4544753) | **supports it, where NHGRI did not.** Inherit's definition is the classification sense — "a DNA change that a clinical review has judged to cause a condition" — and this is the document that defines that scheme: "a variant classified as pathogenic using the proposed classification scheme has met criteria informed by empirical data". The same page adds that the category "does not imply 100% certainty", which Inherit's definition does not claim either. |
| `classification` | ACMG/AMP 2015 consensus recommendation (PMC4544753) | **supports it.** "a process for classification of variants into these five categories based on criteria using typical types of variant evidence" is Inherit's "published list that sorts DNA changes by how likely they are to cause a condition". |
| `estimate` | NIST/SEMATECH e-Handbook 1.3.5.2 | **supports it.** "the estimate of the mean varies from sample to sample" is Inherit's "a calculated value with uncertainty, not a known outcome". |
| `association` | CDC, *Principles of Epidemiology*, course Glossary | **supports half of it, and the half it does not carry is stated.** "the statistical relation between two or more events, characteristics, or other variables" is Inherit's "a pattern in groups". "Does not by itself prove cause" is Inherit's own restriction; it narrows the definition rather than widening it, and the register says it is not attributed to CDC. |
| `replication` | National Academies, *Reproducibility and Replicability in Science* (2019), ch. 3 | **supports it, under the related noun.** "Replicability is obtaining consistent results across studies aimed at answering the same scientific question, each of which has obtained its own data" is Inherit's "a new study finding a similar result with other data". The report defines `replicability`; Inherit's entry is `replication`, the act that noun names, and the `claim` says so. |
| `imputation` | IGSR / 1000 Genomes Project FAQ | **supports it, across one sentence.** The quote is "we can statistically infer the genotype for that variant in that individual using haplotype information"; the condition it answers, on the same line, is that the individual "has no coverage at a particular location", which is Inherit's "unmeasured DNA positions". Both halves are in the `claim`, because the quote alone would read as a claim about genotypes generally. |
| `polygenic` | NHGRI, *Polygenic Trait* | **supports it once Inherit stopped claiming more than the page does.** This term is in the rejected table below as well, and both entries stand: the definition that was rejected asserted "many DNA positions, usually with small effects", which nothing fetched here carries. Narrowed to "influenced by two or more genes rather than a single one", it is what the page says: "a characteristic, such as height or skin color, that is influenced by two or more genes". |
| `z-score` | NIST/SEMATECH e-Handbook 1.3.5.17 | **supports it, from a section named for something else.** "data is given in units of how many standard deviations it is from the mean" is Inherit's "in units of the usual spread". The definition sits inside *Detection of Outliers* under no heading of its own, which is why reading the handbook's table of contents had recorded the handbook as having none. |

## Judged and REJECTED, with the snapshot kept as the evidence

| term | source checked | why it does not carry the definition |
|---|---|---|
| `polygenic` (the definition as it stood) | NHGRI, *Polygenic Trait*, and *Polygenic Risk Score (PRS)* | Inherit defined the adjective as "influenced by many DNA positions, usually with small effects". The PRS page defines a *score*, not the adjective. The Polygenic Trait page defines the adjective but as "influenced by two or more genes", and searching its body for "small effect", "many variants" and "thousands" finds nothing. **Resolved on 2026-09-13 by changing Inherit rather than the standard**: the quantitative half was Inherit's own and unsupported, the definition was narrowed to what the page carries, and the term is now cited above. The rejection is kept because it is the reason for the wording. |
| `medication` | NCI, *Dictionary of Cancer Terms* | Inherit's definition is "a drug **or care plan** used to prevent, manage, or treat illness". NCI's entry is about a dosage form and what it is used for; a care plan is not a dosage form, and nothing on the page carries that half. Rather than cite the supported half and quietly widen it, the term stays uncited — and Inherit's own definition is the thing to look at, because "or care plan" may simply be wrong. |
| `overload` | NCI, *Dictionary of Cancer Terms*, "iron overload" | Inherit defines the generic word — "a harmful buildup beyond what the body can handle well" — and NCI defines the iron-specific condition. Citing the specific for the generic would overstate it, and the term appears in no shipped copy, so nothing is lost by leaving it. |
| `pathogenic` (NHGRI only) | NHGRI, *Pathogenic Variant*, snapshot kept as `pathogenic-rejected-nhgri.json` | Inherit's definition is the ACMG sense — "a DNA change that a **clinical review has judged** to cause a condition" — and the page never mentions classification or review. It defines a pathogenic variant as one that "may increase a person's risk", and adds that carrying one "does not guarantee" the condition. That is a different claim from the one Inherit makes, so citing it would misrepresent both. The right authority was the ACMG/AMP classification guidance, which has since been fetched and is the citation the term now carries. |

## Authorities probed and what they can carry

- **NHGRI Talking Glossary** — static HTML, quotes verifiable. It has no page
  for `heritability`, `penetrance`, `imputation`, `linkage disequilibrium` or
  `meta-analysis`; its index was fetched and read rather than guessed at.
- **MedlinePlus Genetics** — static HTML, real modification dates. Covers the
  inheritance and variant-interpretation half. Its page on complex and
  multifactorial disorders was read for `polygenic` on 2026-09-13 and says
  "influenced by multiple genes (polygenic)" — the same claim NHGRI makes and
  no more, so NHGRI's own glossary entry is the one cited.
- **NIST/SEMATECH e-Handbook of Statistical Methods** — static HTML. Its table
  of contents has no section for `z-score`, `odds`, `baseline` or
  `effect size`, and its "process modeling" definition is not what Inherit's
  `model` means. **That reading was right about the contents and wrong about
  the handbook**: the handbook defines the Z-score inside §1.3.5.17,
  *Detection of Outliers*, under no heading of its own, and that definition is
  now the citation for `z-score`. A table of contents indexes titles, not
  content; searching the sections is what found it.
- **NIST's own hypertext glossary** (`handbook/glossary.htm`) — fetched
  2026-09-13, and it is not the general statistics dictionary its name
  suggests. It says on its face that it holds "selected terms from engineering
  statistics", with topic areas of experimental design, metrology, survey
  questionnaires, statistical process control and computer experiments. It has
  an entry for none of `probability`, `odds`, `effect size`, `baseline`,
  `replication`, `statistical` or `z-score`.
- **CDC, *Principles of Epidemiology in Public Health Practice*** — static
  HTML, and the authority for the epidemiological measures. It is served from
  `archive.cdc.gov`; the live `www.cdc.gov` path for the course now 404s. The
  archive is CDC's own, the snapshot pins the bytes, and the URL says plainly
  that it is an archive. **The course's own Glossary was not read until
  2026-09-13**, and it is a several-hundred-entry register, and it
  carries `association`, which is now cited from it. It defines `effect` as "the result of a cause" but not
  `effect size`, and has no entry for `probability`, `odds`, `baseline`,
  `model`, `statistical` or `replication`.
- **NCI Dictionaries of Cancer Terms and of Genetics Terms** — reachable, but
  not at the address a person would type. Every
  `cancer.gov/publications/dictionaries/...` page returns a JavaScript shell
  whose body is "You need to enable JavaScript to run this app.", so the
  definition is not in those bytes and a quote taken from them could not be
  verified. Reading the page's own bundle gives the endpoint it calls:
  `https://webapis.cancer.gov/glossary/v1/Terms/{dictionary}/{audience}/en/{term}`,
  which is NCI's own, returns the record as JSON, and carries the definition in
  the bytes.

  **Twelve definitions are cited there, at that URL.** The verification
  property is unchanged and arguably stronger — the quote is checked against
  the exact bytes the register names, and those bytes are the record itself
  rather than a rendering of it. Each of those entries says in its `claim` why
  the endpoint rather than the page is cited, so nobody has to reverse-engineer
  the choice. The alternative was leaving twelve terms invisible while a real
  authority defined every one of them.

  Re-probed term by term on 2026-09-13, for the sixteen then uncited, against
  the two dictionary-and-audience endpoints this register already uses (the
  Cancer.gov patient dictionary and the Genetics health-professional one):
  only `baseline` and `medication` return a record at all, and both are the
  wrong sense (an initial measurement of a condition; a dosage form). The
  other fourteen return nothing at either endpoint.
- **National Academies, *Reproducibility and Replicability in Science* (2019)**
  — read on NCBI Bookshelf, which serves the chapter text as static HTML. Its
  Conclusion 3-1 is the citation for `replication`. NCBI Bookshelf is worth
  remembering as a delivery route for consensus reports whose publisher pages
  are JavaScript.
- **IGSR / 1000 Genomes Project** — static HTML with real dates, and the
  citation for `imputation`. Its FAQ answers the question in the method's own
  terms. It does not define `reference panel`.
- **Michigan Imputation Server documentation, GWAS Catalog methods, PGS Catalog
  documentation** — all reachable and all read. The imputation server's
  Reference Panels page lists the panels it offers and never says what one is;
  the two catalogues describe their own fields. None defines `reference panel`
  or `risk allele`.
- **OECD Glossary of Statistical Terms** — gone. Both `stats.oecd.org/glossary`
  paths tried return 404.

## Still uncited: 11 of 42

`baseline`, `effect size`, `medical`, `medication`, `model`, `odds`,
`overload`, `probability`, `reference panel`, `risk allele`, `statistical`.

Grouped by what each actually needs, so the next pass does not re-probe
authorities already ruled out:

- **A statistics authority that defines primitives.** `probability`,
  `statistical`, `odds`, `effect size`, `model`, `baseline`. Four registers
  have now been read term by term for these — NIST's handbook contents, NIST's
  own glossary, CDC's course glossary and both NCI dictionaries — and not one
  of the six is defined in any of them. `baseline` is the closest miss: CDC
  uses the word ("comparison groups … provide baseline or expected values")
  but defines the group, not the rate, and Inherit's "with stated matching
  features" is the operative half. Citing that would leave most of the
  definition unattributed, which is a different thing from the one disclosed
  word in `clinical`.
- **A genomics-methods authority.** `reference panel`, `risk allele`. Not in
  NHGRI's glossary, not in either NCI dictionary; the GWAS Catalog methods
  page, the PGS Catalog documentation and the Michigan Imputation Server's
  reference-panel page were all fetched and define neither. ClinVar uses "risk
  allele" in the ClinGen sense of a low-penetrance Mendelian variant, which is
  not the group-level sense Inherit means.
- **Nothing, because the definition is the problem.** `medication` says "a drug
  or care plan", and the "or care plan" half is there because the entry also
  glosses its aliases `therapy`, `treatment` and `treatments`; narrowing it to
  a drug would leave three aliases mis-glossed, so this needs the entry split
  in two rather than a source. `overload` is generic where every authority is
  iron-specific, and appears in no shipped copy.
- **`medical`.** An earlier version of this file recorded it as "likely belongs
  in the plain class", which was wrong to write as an open question:
  `data/glossary-citation-classes.json` says in `whyThatLine` that `clinician`
  and `medical` "were argued both ways and are cited, because a reader who
  mistakes this product for clinical care is the failure the brief cares most
  about". That is a decision with a recorded reason, not an oversight. What is
  true is narrower: no authority read here glosses a word this general, so it
  stays invisible.

Each stays invisible to readers until a fetched page carries its definition.
That is the operator's condition working as intended, not a gap to be closed by
lowering the standard.
