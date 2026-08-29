# Inherit

**Your genome, on your terms.** Inherit is an open-source consumer genomics
platform — created by [Plus Bio](https://www.plus.bio) as an open-source
project for the public good — that gives an individual everything a
commercial consumer-WGS service provides, without the platform ever selling
sequencing, and with privacy engineering that is implemented rather than
announced.

Inherit operates as a legally separate entity from Plus Bio. It shares a
design language with Plus Bio; accounts are separate, there is no SSO,
and **no personal, health, or genetic data flows between Inherit and any
Plus Bio service in either direction** (see [About](/about) and the
[privacy policy](/privacy)).

## What it does

1. **Provider discovery** — a verified directory of real genome-testing
   providers (prices with capture dates, sequencing depth, the raw files you
   actually get back, shipping coverage incl. US-state exclusions, each
   provider's data practices, source links). You buy from the provider
   directly; Inherit never takes payment for sequencing.
2. **Genome ingestion** — upload your own raw data. Array exports (23andMe,
   AncestryDNA, MyHeritage, FamilyTreeDNA) and VCF/gVCF are fully processed
   into a canonical GRCh38 variant store (GRCh37 arrays are lifted over).
   BAM/CRAM are stored resumably (TUS direct-to-storage), hashed, and
   re-downloadable; FASTQ/BAM analysis runs on a self-host
   [worker](worker/README.md) — never claimed as serverless (see
   [ADR-0001](docs/adr/0001-gating-decision-large-files-and-compute.md)).
3. **Reports** — 120+ genotype-specific report templates across 12+
   categories, each with citations (PMID/DOI), an evidence label, honest
   "your file does not cover this variant" states, and an
   informational-not-medical-advice line on the report itself. Polygenic
   scores come with percentile context, a numeric coverage fraction, and a
   mandatory ancestry-portability caveat. A scheduled research pipeline
   watches GWAS/PGS/ClinVar releases and drafts new reports into a human
   review queue ([changelog](/changelog)).
4. **Exploration & ancestry** — variant search (rsID/gene/position), an
   embedded genome browser over your own data (first-party reference; no
   external genome host is contacted), continental admixture against 1000
   Genomes, and mtDNA/Y haplogroups with "what your file supports" labels.
5. **Copilot** — a chat over your own genome. Bring your own key: a local
   OpenAI-compatible endpoint (Ollama/LM Studio — the privacy-preferred
   path) or Anthropic Claude. Before any genome-derived data goes to a cloud
   provider, a consent dialog names the provider and the exact data classes;
   grants are stored and revocable.

## Privacy engineering, not privacy copy

- Row Level Security on every table holding user data, proven by an E2E
  test that attacks the real PostgREST/Storage APIs (`e2e/rls.spec.ts`).
- Zero third-party trackers or pixels — enforced by a CI network audit over
  real rendered pages (`e2e/network-audit.spec.ts`), not a promise.
- User genotypes are never sent to any third-party annotation API; the
  reference store is refreshed independently of any user's data
  ([ADR-0005](docs/adr/0005-annotation-reference-store.md)).
- Deletion deletes (DB rows + storage objects, verified by test). Export is
  one click, complete, and free forever.
- Legal pages are product surfaces: law-enforcement policy + transparency
  report, deceased-customer process, a GINA explainer that names GINA's
  gaps, a change-of-control commitment, and a children's-data section —
  fully drafted, with a CI gate that fails on placeholder text.

## Getting started

- **Self-host** (recommended — it's the point): [docs/self-hosting.md](docs/self-hosting.md)
- **Architecture**: [docs/architecture.md](docs/architecture.md)
- **Decisions**: [docs/adr/](docs/adr/README.md)
- **Dataset licenses**: [docs/dataset-licenses.md](docs/dataset-licenses.md)

```bash
pnpm install
pnpm supabase start        # local Postgres/Auth/Storage stack (Docker)
cp .env.example .env.local # fill in values printed by supabase start
pnpm seed                  # providers, report templates, PRS weights
pnpm dev
```

`pnpm test` runs unit tests; `pnpm e2e` runs the Playwright suite (RLS
proof, network audit, upload/report flows) against a production build and
the local stack.

## Non-goals

No sequencing sales, no imputation ([ADR-0003](docs/adr/0003-no-imputation.md)),
no microbiome claims (different assay), no diagnosis — Inherit is
informational and says so on every report.

## License

[AGPL-3.0](LICENSE). Sample data: synthetic and public reference material
only ([data/samples/PROVENANCE.md](data/samples/PROVENANCE.md)).
