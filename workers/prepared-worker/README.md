# Hosted preparation worker (Cloudflare Containers)

`src/index.mjs` is a Cloudflare Worker with one job: run the operator command
`pnpm worker:prepared --once` inside a Cloudflare Container on a schedule. A
cron fires every five minutes; the `scheduled` handler wakes the one Durable
Object named `preparation-worker`; that object starts its container if it is
not already running and otherwise does nothing. The container runs one
preparation attempt and one cleanup page (`scripts/prepared-worker.run.mts`),
then exits. ADR-0030 records the decision, the alternatives and the limits.

Nothing here decides whether a job runs. The container is the same process an
operator would start by hand from the repository root: it refuses to run
unless `INHERIT_PREPARED_WGS_ENABLED` is `true`, the database's
`own_preparation_config.enabled` gate is still separate, and the worker claims
work only under current source authority (ADR-0025). Deploying this Worker
activates nothing.

## Files

| File | Role |
| --- | --- |
| `wrangler.json` | The Worker: cron, container (`standard-1`, one instance), Durable Object binding and migration, four plain variables, observability off, no `workers.dev` URL. `env.preview` is the preview variant. |
| `src/index.mjs` | The Durable Object and the `scheduled` and `fetch` handlers, on the runtime's own container API (no `@cloudflare/containers` dependency). The wake stays open until the container exits and re-arms a twenty-second alarm while it runs, because an idle object is evicted and takes its container with it. `fetch` answers 404 with no body to everything. |
| `Dockerfile` | The image: Node 24, the repository's dependencies from the frozen lockfile, `src/`, `data/`, `docs/route-register.json` (imported by the worker module), `tsconfig.json` and the two scripts the entry needs, run as the unprivileged `node` user. The build context is the repository root, filtered by the root `.dockerignore`. |
| `src/index.test.ts` | Proves the object starts only a stopped container, forwards exactly the six variables below, and that the cron wakes the one named object. `scripts/cloudflare-hosting-config.test.ts` holds the configuration, the Dockerfile and the workflow to this README. |

## Bindings, variables and secrets

The container receives exactly six variables, the ones
`scripts/prepared-worker.run.mts` and the modules under it read. Four are plain
variables in `wrangler.json`:

| Name | Production | Preview |
| --- | --- | --- |
| `INHERIT_PREPARED_WGS_ENABLED` | `true` | `true` |
| `NEXT_PUBLIC_SUPABASE_URL` | the production project URL | `https://iofjhrtcyawjjhuxbgfd.supabase.co`, the `hosted-proof` preview branch (19 September 2026) |
| `INHERIT_PREPARED_R2_ORIGIN` | `https://inherit-prepared-artifacts.mariodiego-dev.workers.dev` | `https://inherit-prepared-artifacts-preview.mariodiego-dev.workers.dev` |
| `INHERIT_PREPARED_R2_BUCKET` | `inherit-prepared-production` | `inherit-prepared-preview` |

Two are Worker secrets, never in any file. Set each after the first deploy;
wrangler prompts for the value, so paste it rather than putting it on the
command line or in a shell history. Add `--env preview` for the preview Worker.

```sh
pnpm dlx wrangler@4.134.0 secret put SUPABASE_SERVICE_ROLE_KEY --config workers/prepared-worker/wrangler.json
pnpm dlx wrangler@4.134.0 secret put INHERIT_UPLOAD_SIGNING_JWK --config workers/prepared-worker/wrangler.json
```

`INHERIT_UPLOAD_SIGNING_JWK` is the app's own private upload signer
(`src/lib/uploads/storage-upload-token.ts`): the worker mints the gateway's
30-second capabilities with it, and the gateway in `../prepared-artifacts`
verifies them with the public half committed in its `SIGNING_PUBLIC_KEYS`. The
capability issuer is derived from `NEXT_PUBLIC_SUPABASE_URL` plus `/auth/v1`,
so that URL and the gateway's `TOKEN_ISSUER` must name the same project;
the hosting test checks that they do.

Secrets and variables reach the container only through the start options in
`src/index.mjs` (`container.start({ env })`). Nothing is baked into the image,
nothing is logged, and the Worker forwards no other binding.

## The gateway's signing key

The production gateway's `SIGNING_PUBLIC_KEYS` in `../prepared-artifacts/wrangler.json`
carries the public half of the app's upload signer as served by
`https://www.inherit.bio/.well-known/inherit-upload-jwks.json` (kid
`d5e4e50d-7017-4c8f-9435-22c07b5234a9`, committed 18 September 2026). A public
key is not a secret. `scripts/cloudflare-deploy-guard.ts` refuses a production
deploy whose committed keys differ from the served ones, so a rotated signer
means: update the app's `INHERIT_UPLOAD_SIGNING_JWK`, wait for the endpoint to
serve the new key, commit the new public half here, deploy. The preview
gateway carries the public half of the preview signer (kid
`4d1d178c-3f0c-41d0-902f-788c83fdef3d`, committed 19 September 2026): the key
the `hosted-proof` branch project trusts and the preview deployment serves,
never the production signer.

## Two-step origin bootstrap

The app's DNS is not on Cloudflare, so the gateway is served at its
`workers.dev` URL, and that URL is only known after the gateway has been
deployed once. Both steps are done for this account (18 September 2026):

1. Both Workers were first deployed with `INHERIT_PREPARED_R2_ORIGIN` empty
   (preview run 35379336714, production run 35379664900 of the deploy
   workflow). The gateways answer at
   `https://inherit-prepared-artifacts.mariodiego-dev.workers.dev` and
   `https://inherit-prepared-artifacts-preview.mariodiego-dev.workers.dev`,
   and refuse a request without a capability with an empty 404. The container
   Workers' crons start the container every five minutes; with the origin
   empty, the app's R2 transport is unavailable by its own fail-closed check,
   and with the database gate still off there is no job to claim, so each run
   reports idle and exits.
2. Those origins, scheme and host only, are the committed values above; the
   push that carries them redeploys production, and preview is redeployed by
   hand from the workflow.

The preview project URL is bootstrapped the same way once a Supabase preview
branch exists: set `NEXT_PUBLIC_SUPABASE_URL` under `env.preview` and the
matching `TOKEN_ISSUER` in the gateway's `env.preview`.

## Deployment

`.github/workflows/deploy-cloudflare.yml` deploys the gateway and then this
Worker on every push to `main` that touches the image or the Workers, and by
hand for either target. It is skipped entirely until the owner sets the
repository variable `CLOUDFLARE_DEPLOY_ENABLED` to `true` (a repository
variable, not an environment one: the job-level condition is evaluated before
the `cloudflare` environment is entered). The Cloudflare API token and account
id are secrets of that environment. Before deploying, the workflow runs
`scripts/cloudflare-deploy-guard.ts`, which refuses a production deploy while
the gateway's key list is empty or differs from the keys the app serves.

The image is built on the runner by wrangler from `Dockerfile`, with the
repository root as context, and pushed to the account's registry. Wrangler
does not create R2 buckets or secrets. The two buckets
(`inherit-prepared-preview`, `inherit-prepared-production`) exist since
18 September 2026, private, with no lifecycle rule
(`../prepared-artifacts/README.md` says why the tombstone markers must never
expire); the secrets are set as above.

## Instance and cost notes

- `standard-1` is 1/2 vCPU, 4 GiB memory and 8 GB disk. The one measured trial
  of `pnpm worker:prepared --once` peaked at about 480 MB resident; the image
  carries the full dependency tree (about 1 GB), well inside the disk. `basic`
  (1 GiB) leaves too little headroom for a whole-genome file; `standard-2`
  (1 vCPU, 6 GiB) is the next step if a measured run needs it.
- `max_instances` is 1 and the object is a named singleton, so at most one
  preparation runs at a time; a wake that finds the container running returns
  without starting another.
- Until 20 September 2026 the wake returned as soon as the container had
  started. The object then had no pending work, was evicted, and took the
  container with it about ninety seconds in: on the preview stack a 547-byte
  and two 4 MiB files finished, while a 64 MiB file died mid-run twice, on
  `standard-1` and on `standard-2` alike, and its job sat claimed until its
  deadline an hour later. The wake now awaits the container's exit and keeps
  an alarm armed while it runs.
- Containers bill per second of memory, vCPU and disk while running, plus the
  Workers Paid plan they require. A five-minute cron means up to 288 idle
  starts a day when there is nothing to prepare; each is a few seconds of
  Node start-up. Jobs can take tens of minutes. Check the current rates on
  Cloudflare's pricing page before enabling the workflow; ADR-0030 sets the
  ceiling at 30 dollars a month and the operator, not this configuration,
  watches the bill.
- The Worker's observability is off. The container's own stdout carries only
  the coded outcomes the entry prints (`preparation_idle`,
  `preparation_failed`, ...); whether Cloudflare keeps container logs is the
  application-level setting in the dashboard, not set here.

## What this does not prove

- The deploys of 18 September 2026 proved that the image builds, the Workers
  and the container application exist and the gateways refuse unauthenticated
  requests. Every container start until 19 September exited before its first
  request: the worker module imports `docs/route-register.json`, which the
  image did not copy (found by the hosted proof, when the preview branch's
  API logs showed no claim call across several cron ticks; fixed above). Both gateways now carry a
  committed key (the production one is guard-checked, see above; the preview
  one is compared by hand against the preview deployment's endpoint in
  `docs/evidence/hosted-proof-20260919/`).
- The instance size rests on one trial run, not on a full-size whole-genome
  file; capacity, throughput and 100 genomes a month remain unproved (D-124).
- A container that never exits keeps `running` true and blocks every later
  wake; there is no watchdog here. The operator stops it from the dashboard or
  with wrangler.
- A job whose container dies mid-run is not retried: its claim expires but the
  job stays `claimed`, and six five-minute ticks passed it over on the preview
  stack before its deadline. The person waits the full `max_job_seconds` and
  is then told the preparation could not be confirmed.
- A queued job waits for the next cron tick plus the container start; nothing
  here shortens that.
- Cloudflare becomes a processor of genotype data the moment a real job runs
  on it. The privacy notice names Supabase and Vercel today and must name
  Cloudflare before the database gate is opened (ADR-0030).
