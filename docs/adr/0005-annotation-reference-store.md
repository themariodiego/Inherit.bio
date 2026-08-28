# ADR-0005 — Annotation reference store

- Status: **Accepted** · 2026-08-28

## Decision

Sequence maintains its own Postgres reference tables (`ref_variants`,
`ref_genes`, `prs_scores`/`prs_weights`) holding the report-relevant slice
of public datasets (ClinVar, dbSNP rsIDs, gnomAD frequencies, GWAS Catalog,
PGS Catalog — licenses audited in `docs/dataset-licenses.md`). User queries
join against these tables **inside the database**; no user genotype, rsID
list, or any other user-derived value is ever sent to a third-party
annotation API, geocoder, or lookup service.

The reference ETL (`/api/jobs/annotation-refresh` + `scripts/` seeds) fetches
data keyed by the platform's own template/score catalog — the same requests
regardless of which users exist — so outbound traffic can never encode a
user's genotype set. Sources: NCBI ClinVar/eutils and Ensembl REST (which
mirrors dbSNP positions/alleles and carries 1000G + gnomAD frequencies).

## Alternatives rejected

- Calling Ensembl/VEP/MyVariant per user query: simplest, but leaks exactly
  the variant set a user is looking at — the defining anti-pattern this
  platform exists to avoid.
- Hosting full ClinVar+dbSNP+gnomAD locally (hundreds of GB): out of scale
  for the 500 MB (Free) / 8 GB (Pro) database budgets in ADR-0001; the
  report-relevant slice is what reports actually read.
