# Fixture paths in production code

Brief G8.2(b): any production code path that accepts fixture input is
authenticated and listed here with its authentication mechanism. This is the
list, and it is short on purpose.

`scripts/mock-token-allowlist.test.ts` enforces the companion rule G8.2(c) — it
greps production source under `src/` and `worker/src/` for demonstration, mock,
fixture and dummy tokens and fails on anything not justified in
`scripts/mock-token-allowlist.json`, and on any listed file that no longer
matches. It runs in CI under `pnpm test`.

## Paths that accept fixture input

| Path | Input | Authentication |
|---|---|---|
| `src/app/api/jobs/research-refresh/route.ts` (POST) | An optional `fixture` body carrying a source, release key and associations, so the E2E suite drives the live refresh path deterministically instead of a copy of it | `Authorization: Bearer <secret>` matching **`JOBS_SECRET`**. An unmatched or absent header answers 401 before the body is read; a body carrying a fixture then answers 401 unless the secret is the operator's |

The same route's `GET` is the Vercel Cron entry point and is live-only — it
passes `null` where `POST` passes the fixture — and it accepts `JOBS_SECRET` or
`CRON_SECRET`, as does a `POST` with no fixture in it.

That split is the point: fixture input is an operator's, so it takes the
operator secret, while the schedule's secret drives the live path and nothing
else. Both are server-side and neither reaches a browser, so this narrows an
unnecessary credential path rather than closing an open one. Every existing
`POST` caller already used `JOBS_SECRET`. `route.test.ts` pins all four cases,
and the first of them fails if the narrowing is removed.

## Paths that exclude fixture data

| Path | Behaviour |
|---|---|
| `src/app/api/export/route.ts` | Report templates seeded by the E2E suite carry the `auto-e2e-` slug prefix and are filtered out of every export. The token names data the export must never contain, so this is protective rather than an input |

## Everything else the grep finds

The remaining matches are comments, or synthetic fixture modules that no route
or component imports — verified by import scan, not by assumption.
`scripts/mock-token-allowlist.json` carries one line of justification for each,
and `scripts/no-demo-result-path.test.ts` separately proves that no route
segment offers a demonstration and no page or component reaches a fixture
module.

## What none of this proves

G8.2(a) — that no user-reachable route renders a value not derived from the
authenticated person's own rows — is not established here and cannot be. It
needs the two-seed evidence of G8.3, which requires `docs/figures-register.json`
and a two-seed browser suite that do not yet exist. A file that accepts fixture
input under an operator secret is a narrower claim than a surface that renders
only a person's own data, and only the narrower one is made here.
