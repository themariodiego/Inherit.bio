# Contributing to Inherit

Inherit is an open-source consumer genomics platform, created by
[Plus Bio](https://www.plus.bio) as an open-source project for the public good.
Contributions are welcome.

Everyone participating is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). It carries one project-specific rule
worth repeating here: **never post another person's genome file, variant call,
report, or account data** in an issue, pull request, or commit. Use the
synthetic fixtures in `data/samples/`.

## Getting set up

```bash
pnpm install
pnpm supabase start        # local Postgres/Auth/Storage stack (Docker)
cp .env.example .env.local # fill in values printed by supabase start
pnpm seed                  # providers, report templates, PRS weights
pnpm dev
```

Full details, including the self-host path, are in
[`docs/self-hosting.md`](docs/self-hosting.md) and
[`docs/architecture.md`](docs/architecture.md).

## Before you open a pull request

Before pushing a draft, run the focused unit tests for every changed flow,
then these source checks:

```bash
pnpm typecheck
pnpm lint
pnpm test:source-inventories
pnpm gate:legal && pnpm gate:first-glance && pnpm gate:names && pnpm gate:templates
pnpm gate:readability && pnpm gate:secrets && pnpm gate:routes && pnpm gate:claims
pnpm gate:citations
pnpm gate:env && pnpm gate:jurisdictions && pnpm gate:sql-includes
```

New migration tables must also have an explicit disposition in
`docs/export-member-plan.json`; regenerate its native test block with
`pnpm exec tsx scripts/export-member-plan.ts`. The source inventory preflight
checks literal new table declarations. Hosted CI then checks the complete
actual database catalog immediately after fresh startup and repeats the
unchanged full database suite later.


The source-inventory command checks exact environment reads, TEST-only token
readers, native function sites, rendered mail, routes and the complete
`scripts/ci-browser` source-contract test namespace, including partition,
accessibility and queue placement. Run it when files, routes, environment reads, migrations,
mail or test partitions change. A missing or stale inventory must fail before
a draft push. Mail rendering requires a clean committed input tree; a local
commit is allowed before these checks. Configure `NAME_DENYLIST_FILE` for the
name gate. Stage changes for the tracked secret scan and run the history scan
on the final local commit before pushing.

The owner approved complete hosted unit, database and browser verification
as the permanent policy for all current and future branches. The complete
`pnpm test`, fresh-database pgTAP suite and browser suite must pass on the final
version before any merge or production change. A focused selection cannot
replace these complete suites. Keep all assertions and time limits. Missing,
failed, skipped, cancelled, retried or stale tests and jobs block release.
Six fresh isolated browser jobs must together cover the complete discovered
suite exactly once, on the same source, run and attempt. Use **Re-run all jobs**
after a CI failure; retain the original failure.

Complete local production migration rollback checks remain required. Then
production changes must pass the predecessor checks, exact dry-run sentinel,
guarded apply and read-only verification in that order. CI does not replace
these checks. A database reset is only for a disposable local test stack.

`pnpm test`, `pnpm exec supabase db reset && pnpm exec supabase test db` and
`pnpm e2e` remain optional complete local checks for development. The permanent
policy is recorded in [`docs/protocol/decisions.md`](docs/protocol/decisions.md)
(30 September and 3–4 October 2026). The browser workflow and its coverage
checks are described in
[`docs/evidence/ci-browser-sharding.md`](docs/evidence/ci-browser-sharding.md).

The [citation surface gate](docs/citation-surface-gate.md) complements
`pnpm gate:claims`; passing either does not certify that the existing human
source-review backlog is complete.

## What we are looking for

Good places to start:

- **Report templates.** 120+ genotype-specific templates live in the seed data.
  Each needs citations (PMID/DOI), an evidence label, and honest "your file does
  not cover this variant" handling. New templates go through the human review
  queue — see the [changelog](https://inherit.bio/changelog).
- **Provider directory accuracy.** Prices with capture dates, sequencing depth,
  the raw files a provider actually returns, shipping coverage. If a listing is
  stale, a correction with a source link is a genuinely useful contribution.
- **Ingestion formats.** Array exports and VCF/gVCF are handled; new consumer
  formats are welcome.
- **Privacy and security engineering.** See [SECURITY.md](SECURITY.md) for
  anything exploitable — report it privately rather than opening an issue.

## What we will not merge

These are settled decisions, recorded as ADRs in [`docs/adr/`](docs/adr/):

- **Imputation** — see [ADR-0003](docs/adr/0003-no-imputation.md).
- **Sequencing sales.** Inherit never takes payment for sequencing.
- **Third-party trackers or pixels.** A CI network audit
  (`e2e/network-audit.spec.ts`) enforces this over real rendered pages.
- **Sending user genotypes to third-party annotation APIs** — see
  [ADR-0005](docs/adr/0005-annotation-reference-store.md).
- **Diagnosis, treatment, or medical-advice framing.** Inherit is informational
  and says so on every report.

If you want to change one of these, open an issue proposing a new ADR before
writing code. Decisions are reversible; they are just not reversible silently.

## Conventions

- TypeScript throughout; see [`docs/coding-guidelines.md`](docs/coding-guidelines.md).
- Architectural decisions are recorded as ADRs in [`docs/adr/`](docs/adr/).
- Keep changes surgical. Touch what the change needs and no more.
- Every user-facing claim needs a source. This is a genomics product; unsourced
  assertions about what a variant means do not merge.

## Licensing

Inherit is [AGPL-3.0](LICENSE). By contributing, you agree that your
contributions are licensed under the same terms.

Before a fresh database reset or test, run `pnpm gate:sql-includes`. It checks the complete tracked SQL/fixture include graph without database access, resolving every literal relative include from its containing file. Missing, escaping, dynamic or cyclic paths refuse the run. CI and the native browser bootstrap enforce this preflight before starting their database.

The focused source-inventory preflight also checks every kept page has an actual named accessibility audit. A new protected page needs a genuine authorized fixture; a 404 visit or an unexecuted coverage label does not satisfy its browser audit.
