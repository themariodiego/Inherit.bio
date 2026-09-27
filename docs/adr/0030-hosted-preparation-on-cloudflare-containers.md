# ADR-0030 — Hosted preparation on Cloudflare Containers

- Status: Accepted by owner decision · 2026-09-18
- Deciders: The owner; Inherit engineering within the approved WGS scope
- Extends: ADR-0025 and ADR-0016; no format, limit or public admission change

## Decision

The canonical prepared WGS worker is an operator-started process,
`pnpm worker:prepared --once`, that drains bounded cleanup, runs at most one
preparation attempt when no cleanup is eligible, and exits (`scripts/prepared-worker.run.mts`,
`src/lib/uploads/own-preparation-worker-loop.ts`). ADR-0025 left where that
process runs as a deployment requirement. This decision names the host.

Run it as a Cloudflare Container managed by one Durable Object
(`workers/prepared-worker/`). A cron fires every five minutes and wakes the one
named object; the object starts the container only if it is not already
running. The instance type is `standard-1` (1/2 vCPU, 4 GiB memory, 8 GB
disk), `max_instances` is 1, and every wake runs the same `--once` pass, so at
most one preparation is ever in flight and each run ends on its own. The
container receives exactly the six variables the operator process reads: the
enablement flag, the project URL, the gateway origin and bucket as plain
variables, and the service-role key and the private upload signer as Worker
secrets set with `wrangler secret put`. The gateway it writes through is the
private R2 gateway of `workers/prepared-artifacts/`, deployed by the same
workflow.

The image is built from the repository root: the dependencies from the frozen
lockfile, `src/`, `data/` (the liftover chain is read from the working
directory), `tsconfig.json` and the entry's two scripts, on Node 24 to match
the production runtime, running as the unprivileged `node` user. The
container is the same process an operator would start by hand; the hosted
path changes who starts it and nothing else.

## Alternatives considered

- **Vercel functions.** The app already runs there, but a function is capped
  at 800 seconds of wall time on the Pro plan and a preparation can take tens
  of minutes. Fitting it would mean redesigning the worker into resumable
  slices driven by a scheduler, which ADR-0027 shows is a separate and larger
  piece of work, and it would still hold a whole-genome file in a function's
  memory. Rejected for this slice.
- **An owner-run host.** A machine the owner operates, started by hand as
  `worker/README.md` describes. It keeps the genome off every third party's
  compute, which is the honest default for a self-host, but for the hosted
  service it makes availability depend on one person's machine and gives the
  queue no schedule. Kept as the self-hosting path; not the hosted one.
- **GitHub Actions.** A scheduled workflow could run the same command on a
  hosted runner for nothing. Rejected: those are shared runners, and a
  person's genotype data would be processed on infrastructure that is neither
  a contracted processor nor under the owner's control.

Cloudflare was chosen because the private gateway already lives there, a
container is a plain long-running process with no redesign of the worker, the
cost at the expected volume is small, and the owner had asked that existing
resources be preferred.

## Consequences

- **Cloudflare becomes a processor of genotype data** the moment a real job
  runs on it: the container reads the original file through the app's
  authority and writes prepared artifacts to R2. The privacy notice names
  Supabase and Vercel as the two processors today; it must name Cloudflare,
  under a data processing agreement, before the database gate is opened.
  This ADR does not make that change.
- **Budget.** The ceiling is 30 dollars a month for the Workers Paid plan the
  containers require plus the container seconds. A five-minute cron starts an
  idle container up to 288 times a day when there is nothing to do; those
  starts are seconds each. The operator watches the bill; nothing in the
  configuration enforces the ceiling.
- **Latency.** A queued job waits for the next tick plus the container start.
  The cadence is a configuration value, not a promise.
- **Observability.** The Worker's observability is off, as the gateway's is.
  The container's stdout carries only the coded outcomes the entry prints.
- **Bootstrap.** The gateway is served at its `workers.dev` URL because the
  app's DNS is not on Cloudflare, so the container Worker's origin is
  committed empty and set after the first gateway deploy reveals it; the app
  refuses an empty origin fail-closed. The public signing keys are likewise
  committed empty, and the deploy workflow refuses to deploy the production
  gateway while they are.
- **The workflow is disabled** until the owner sets
  `CLOUDFLARE_DEPLOY_ENABLED`. Main stays green and nothing is deployed by
  merging this.

## What this does not do

Nothing here activates anything. `INHERIT_PREPARED_WGS_ENABLED` alone enables
nothing (ADR-0025): the database's `own_preparation_config.enabled` gate stays
off, no gateway key is committed, no origin is set, no bucket is created, and
no deployment has been made from this repository. The instance size rests on
one trial run that peaked near 480 MB, not on a full-size file; capacity,
throughput and 100 genomes a month remain unproved. A container that never
exits blocks every later wake until the operator stops it; there is no
watchdog. Raw-read formats, original retention and the complete journey of
ADR-0025 remain their own release gates.

## Evidence

`scripts/cloudflare-hosting-config.test.ts` holds both wrangler files, the
Dockerfile and the workflow to this decision; `workers/prepared-worker/src/index.test.ts`
proves the wake and forwarding behaviour; `scripts/cloudflare-deploy-guard.test.ts`
proves the production key refusals. Before the gate opens: a deployed gateway
with the app's served keys, one real job end to end on the container with its
time, memory and bytes recorded, the bill for a month of idle wakes, and the
privacy notice change.
