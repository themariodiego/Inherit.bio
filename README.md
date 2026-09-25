# Inherit

**Your genome, on your terms.** Inherit is an open-source consumer genomics
platform — created by [Plus Bio](https://www.plus.bio) as an open-source
project for the public good. It supports uploading your own genome data,
reading informational reports, exploring ancestry, and asking a configured
Copilot about your results. Inherit does not sell sequencing.

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
2. **Genome ingestion** — the own-genome uploader accepts supported array
   exports (23andMe, AncestryDNA, MyHeritage, FamilyTreeDNA), VCF and gVCF.
   It checks the source, stores it privately, and prepares supported calls
   in GRCh38; supported GRCh37 inputs use the bundled liftover data. File
   acceptance depends on the deployment's storage, upload and preparation
   limits. The standard own upload is a single direct-to-Storage request.
   The optional prepared-object worker is disabled by default; enabling it
   does not establish large-file capacity. FASTQ alignment and BAM/CRAM
   variant calling are not implemented in the [worker](worker/README.md).
3. **Reports** — 162 genotype-specific report templates across 16
   categories, with citations (PMID/DOI), evidence labels, and explicit
   missing-data states. A person chooses report purposes separately from
   storing their file. Completed own reports capture their source and
   content. Polygenic panels show coverage; personal scores, percentiles
   and risk estimates are withheld because the current calculation has no
   validated comparison group. A scheduled research pipeline watches
   GWAS/PGS/ClinVar releases and drafts reports for review. The research
   publisher requires a recorded human decision; the seed command installs
   the bundled catalogue directly as published. Neither citations nor
   automated tests establish clinical validation ([changelog](/changelog)).
4. **Exploration & ancestry** — variant search (rsID/gene/position), an
   embedded genome browser over your own data, and ancestry estimates from
   bundled reference markers. Current own ancestry uses seven broad regions
   and mtDNA/Y lineage markers, with coverage and unavailable states. These
   estimates depend on the supplied calls and reference panel.
5. **Copilot** — a chat over your own genome and completed results. It
   requires a configured connection and its own current permissions; upload
   or report permission alone does not enable it. Cloud permission names
   the recipient and data classes and can be withdrawn. A same-host endpoint
   needs the separate local transport settings and an operator-established
   network boundary described in the [self-hosting guide](docs/self-hosting.md).

## Privacy engineering, not privacy copy

- Row Level Security on every table holding user data, proven by an E2E
  test that attacks the real PostgREST/Storage APIs (`e2e/rls.spec.ts`).
- Zero third-party trackers or pixels — enforced by a CI network audit over
  real rendered pages (`e2e/network-audit.spec.ts`), not a promise.
- User genotypes are never sent to any third-party annotation API; the
  reference store is refreshed independently of any user's data
  ([ADR-0005](docs/adr/0005-annotation-reference-store.md)).
- File and account deletion use tracked cleanup work. A pending request is
  not a deletion receipt; completion depends on the configured storage and
  cleanup workers. Export is available from account settings.
- Legal pages are product surfaces: law-enforcement policy + transparency
  report, deceased-customer process, a GINA explainer that names GINA's
  gaps, a change-of-control commitment, and a children's-data section —
  fully drafted, with a CI gate that fails on placeholder text.

## Getting started

- **Self-host** (recommended — it's the point): [docs/self-hosting.md](docs/self-hosting.md)
- **Architecture**: [docs/architecture.md](docs/architecture.md)
- **Decisions**: [docs/adr/](docs/adr/README.md)
- **Dataset licenses**: [docs/dataset-licenses.md](docs/dataset-licenses.md)

Follow the [local first-run sequence](docs/self-hosting.md) in order. It
covers the pinned package manager, local stack and migrations, environment
loading for seeds, and the upload signer that Storage must accept. Copying
`.env.example` and starting the app alone does not enable uploads.

The [recorded first run](docs/evidence/self-host-first-run-20260923/README.md)
passed on a fresh GitHub-hosted Ubuntu checkout on 23 September 2026.
It followed the local guide through signup, the synthetic VCF upload and
results, including limited ancestry and unconfigured Copilot states.
This is separate from ordinary CI and does not prove hosted deployment,
optional inference or large-file capacity.

`pnpm test` runs unit tests, including three suites that need Chromium for
real DOM checks. `pnpm e2e` invokes the guarded browser harness
for the Playwright suite (RLS, network audit and upload/report flows). It
requires the local stack and a production build; see the self-hosting guide
for its prerequisites. It is not a substitute for first-run setup.

## Gates

Ten `pnpm gate:*` checks read the repository rather than a description of
it: routes against the register, claims against their citations, copy against
a plain-vocabulary list, environment variables against both the template and
the self-hosting guide, secrets over the tracked tree *and its history*, plus
jurisdictions, report templates, result headings, legal placeholders and
comparator names. Two more compare a deployed database with the repository:
its migrations and its report catalog.

`gate:names` is the one that cannot run from a clean checkout: its comparator
denylist is private, and it reads the path in `NAME_DENYLIST_FILE`. Point that
at a file outside the repository and the gate runs — its other three rules
(unreviewed external hosts, organisation-shaped names, evaluative words beside
either) check the whole tree **and every commit message since the allowlist's
baseline**, which is the half that catches things a file-only scan cannot.
Skipping it locally is how a failure reaches CI.

`gate:secrets` has the opposite trap, and it is easy to walk into: it scans
the **tracked** tree, so a file that is still untracked is invisible to it. A
new genome fixture passes locally and then fails in CI on the very next push,
because committing is what makes it tracked. Stage new files (`git add`)
before running the gates, or run them again after committing — every fixture
needs its classification, its generator and its current SHA-256 in
`e2e/fixtures/PROVENANCE.md`, which is what stops a real person's file being
committed as a synthetic one.

Ten run in CI. `gate:schema-drift` deliberately does not — it compares a
deployed database against `supabase/migrations`, and in CI that database was
built from those same files seconds earlier, so it could only ever confirm
itself. It belongs against a deployed environment, after a deploy, and it
**fails when it cannot check**: for a condition nothing else can see, a
skipped check is indistinguishable from a healthy one.

`gate:catalog-drift` is its counterpart for content. Deploying code never
refreshes `public.report_templates`, so a corrected template in
`data/templates` reaches nobody until the catalog is refreshed. Until then, a
report whose deployed text is registered as superseded shows the
historical-wording notice over that same old text. The gate compares
every published report field with the repository and names the wording that
`data/report-scientific-corrections.json` records as superseded. CI runs it
once against the freshly seeded stack, which can only confirm its own model
of the seed, not detect drift; run it with `SUPABASE_DB_URL` after each deploy
and each catalog refresh.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fthemariodiego%2FInherit.bio)

The hosted instance at [inherit.bio](https://inherit.bio) runs on Vercel. A
clone from the button needs the environment variables described in
[docs/self-hosting.md](docs/self-hosting.md) before it serves anything, and
uploads also require Storage to accept the dedicated signer. The optional
[prepared worker](worker/README.md) needs its own host, configuration and
lifecycle checks; the deploy button does not start it. FASTQ alignment and
BAM/CRAM variant calling remain unimplemented.

**Apply migrations before the code that needs them, and check afterwards.** A
deployment whose database is behind its application fails in the least visible
way available: the routes calling the missing functions return their
deliberate, detail-free 503, so nothing reaches an error aggregator and the
test suite stays green because CI builds its database from the migration files
themselves. That happened here, to every upload, for as long as it took a
person to say their upload did not work. `pnpm gate:schema-drift` exists
because of it; run it after each deploy.

## Non-goals

No sequencing sales, no imputation ([ADR-0003](docs/adr/0003-no-imputation.md)),
no microbiome claims (different assay), no diagnosis — Inherit is
informational and says so on every report.

## License

[AGPL-3.0](LICENSE). Sample data: synthetic and public reference material
only ([data/samples/PROVENANCE.md](data/samples/PROVENANCE.md)).
