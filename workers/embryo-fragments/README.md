# Private embryo fragment gateway

`worker.mjs` is a Cloudflare module Worker bound to one private Standard R2
bucket that holds sanitized embryo fragments during an upload. It is the store
the owner chose on 28 September 2026 so that cleanup can be proved rather than
assumed (`docs/protocol/decisions.md`, "Embryo upload cleanup must be proved,
not assumed"). **It is not deployed, and nothing in the repository deploys it.**

It follows `../prepared-artifacts/worker.mjs` and differs where embryo data
needs its own boundary:

| | Prepared-object gateway | Embryo fragment gateway |
| --- | --- | --- |
| Capability audience | `inherit-prepared-object-v1` | `inherit-embryo-fragment-v1` |
| Object keys | `prepared/<uuid v4>` | `embryo/<uuid v4>` (the fragment's random object id; no account or cohort id) |
| Bucket | `inherit-prepared-*` | `inherit-embryo-*`, a separate bucket |
| Binding | `ARTIFACTS` | `FRAGMENTS` |
| Largest object | 8,388,608 bytes | 4,004,096 bytes (a 4,000,000-byte chunk plus one header allowance) |
| Path | `/artifact` | `/fragment` |
| Ranged reads | yes | no; the worker reads whole fragments |
| Same bytes written again | 409 | 200 with the existing version, so a writer whose response was lost can resume |

Each gateway refuses the other's audience and keys, and neither binding can
reach the other bucket. The operations are the same three: a create-only PUT
whose SHA-256 R2 checks, an exact-version GET, and an unconditional empty
marker ("tombstone") read back to EOF. There is no list, delete, token or CORS
interface. `src/lib/embryos/fragment-gateway.test.ts` runs this file against an
in-memory binding.

Bindings:

| Binding | Value |
| --- | --- |
| `FRAGMENTS` | R2 bucket binding |
| `BUCKET_NAME` | Exact bucket name, matching `inherit-embryo-[a-z0-9-]{1,40}`, the app and SQL configuration |
| `TOKEN_ISSUER` | The existing upload signer's issuer |
| `SIGNING_PUBLIC_KEYS` | JSON array of the upload signer's public P-256 JWKs with their `kid` |

Never put private JWK fields or the database service key in this Worker.

**Do not configure lifecycle expiry or delete the empty markers.** A marker is
what stops an already admitted or replayed create-only upload from recreating a
fragment. It proves the current payload is gone and the key is fenced. It does
not prove key absence or physical-media erasure.

## Owner and lead actions before any embryo upload

Nothing below has been done. Each step needs the owner's Cloudflare access or
a production change, so none is done by the repository or by CI.

1. Create two private Standard R2 buckets, `inherit-embryo-production` and
   `inherit-embryo-preview`, with public access off, no lifecycle rules, no
   custom domain and no CORS policy.
2. Add `workers/embryo-fragments/wrangler.json` with name
   `inherit-embryo-fragments`, `main` `worker.mjs`, compatibility date
   `2026-09-08`, `workers_dev` true, `preview_urls` false, observability off,
   the `FRAGMENTS` binding to `inherit-embryo-production`, vars `BUCKET_NAME`,
   `TOKEN_ISSUER` and `SIGNING_PUBLIC_KEYS` as for the prepared gateway, and an
   `env.preview` block for `inherit-embryo-fragments-preview` on
   `inherit-embryo-preview`.
3. Extend `.github/workflows/deploy-cloudflare.yml`,
   `scripts/cloudflare-deploy-guard.ts` and
   `scripts/cloudflare-hosting-config.test.ts` to deploy and check this Worker
   exactly as they do the prepared gateway: refuse an empty key list, and refuse
   keys that differ from `/.well-known/inherit-upload-jwks.json`.
4. Deploy it, then set the app's `INHERIT_EMBRYO_R2_ORIGIN` (the Worker's
   `https://` origin, no path) and `INHERIT_EMBRYO_R2_BUCKET`
   (`inherit-embryo-production`).
5. Select the backend in the database, as a reviewed production change:
   `update private.embryo_ingest_object_config set provider='r2',
   r2_bucket='inherit-embryo-production' where singleton;`
   Until then, reserving an embryo fragment is refused.

A local HTTPS stand-in for browser journeys, like
`scripts/ci-browser/prepared-artifact-fixture.ts`, is still needed once an
embryo chunk route exists. `scripts/ci-browser/embryo-fragment-fixture.ts` is the
in-memory binding it would wrap.
