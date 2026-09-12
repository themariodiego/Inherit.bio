# Glossary sources — method, findings, and what is still missing

The operator decided on 2026-09-12 to source all 42 `cited` glossary
definitions for real, on the explicit condition that **any source that cannot
actually be reached stays uncited and its term stays invisible**. Nothing here
is filled in from memory.

## The finding that set the method

A summarising web fetch of the NHGRI page for "polygenic risk score" reported:

> **Last Updated:** September 12, 2026

That page carries **no last-updated date anywhere in its HTML**. The model had
substituted the current date. The definition it quoted was real and verbatim;
the metadata beside it was invented.

A citation register exists to make provenance checkable, so a fabricated date
in it is worse than a missing one — it looks like evidence, and it is the exact
failure the "never invent a citation" rule is about. It would have been
invisible on review: the date was plausible, adjacent to a real quote, and
nothing in the output marked it as generated.

So every snapshot here is produced by `scripts/glossary/fetch-source.mjs`,
which reads the **raw bytes** and records only strings it can point at:

- `definition` — a substring of the page's own description metadata, never
  paraphrased;
- `fetchedAt` — this machine's clock at the moment of the request, the one date
  anyone here can honestly attest to;
- `pageSha256` — over the exact bytes received;
- `pageDate` — **`null` unless a date string is actually in the bytes**. Every
  NHGRI page fetched so far has `null`, which is a fact about those pages
  rather than a gap in the tool.

## Sourced so far, and the judgement on each

Judged against what Inherit's own definition in `data/jargon.json` claims, not
against the term's name.

| term | source | verdict |
|---|---|---|
| `carrier` | NHGRI, *Carrier* | **supports it.** "an individual who carries and is capable of passing on a genetic mutation … and may or may not display disease symptoms" covers Inherit's "can pass on, often without having the condition". |
| `genome-wide association study` | NHGRI, *Genome-Wide Association Studies (GWAS)* | **supports it**, from the page body rather than its one-line description: "surveying the genomes of many people, looking for genomic variants that occur more frequently in those with a specific disease or trait". Inherit's "many DNA positions in many people" needed that sentence; the description alone would have been a weaker claim than the definition makes. |
| `polygenic` | NHGRI, *Polygenic Risk Score (PRS)* | **does NOT support it.** Inherit defines the adjective — "influenced by many DNA positions, usually with small effects" — and this page defines a *score*. Searching the body for "small effect", "many variants" and "thousands" finds nothing that carries the adjective. The snapshot is kept as the evidence for that negative, and the term stays uncited until a source defines the word. |

NHGRI was probed for the other terms and does not have pages for
`heritability`, `penetrance`, `imputation`, `linkage disequilibrium`,
`pathogenic` or `association study` (all 404). The statistical half of the list
— `odds ratio`, `confidence interval`, `z-score`, `percentile`, `hazard ratio`,
`effect size`, `probability`, `average`, `baseline` — needs a statistics
authority rather than a genomics one, and the clinical half needs a clinical
one.

## THE MISSING MECHANISM, and it is not data entry

`renderableGlossaryEntries()` in `src/copy/glossary/index.ts` filters on
`citationClass === "plain"`. **There is currently no way for a `cited` term to
become visible by carrying a citation** — the only route is reclassifying it as
`plain`, which would be false about the term and would defeat the split.

So sourcing all 42 is necessary and not sufficient. The renderer needs to admit
a `cited` entry whose definition carries a resolvable `citationId`, and the
claims gate needs to check that link the way it checks the others. That is
design work, deliberately not improvised here alongside the research.
