# Hosted preparation: activation runbook

The order in which the prepared-genome path (single-sample VCF, VCF.gz and
gVCF on Cloudflare, ADR-0030) goes from the inert configuration in this
repository to a proven, enabled production path. Each step names who does
it. Nothing before step 8 changes what a person can do on `www.inherit.bio`.
The owner's decisions behind this order are recorded in
`docs/mvp-acceptance-next.md` (18 September 2026).

## Already done

- The app serves its upload signer's public key at
  `/.well-known/inherit-upload-jwks.json` (PR #136), and the production
  gateway configuration carries that key.
- The database-enforced monthly cap (default 100 admissions per UTC calendar
  month) and the source-revocation fold are applied to the Inherit project
  (`docs/evidence/priority1-foundations-release-20260918/`).
- `workers/prepared-artifacts/` (the private R2 gateway) and
  `workers/prepared-worker/` (the cron-woken container) have their wrangler
  configuration, tests and deploy workflow.
- Step 1 items 1 to 3 (18 September 2026): the Workers Paid plan is active on
  the account, the scoped token lives in the GitHub environment `cloudflare`
  with the account id, and `CLOUDFLARE_DEPLOY_ENABLED` is `true`.
- Step 2 (18 September 2026): the first deploys ran through the workflow,
  preview (run 35379336714) then production (run 35379664900): the guard
  passed, the gateways and the container Workers exist, the image built from
  `Dockerfile` and the container applications were created on `standard-1`.
  The gateways answer at
  `https://inherit-prepared-artifacts.mariodiego-dev.workers.dev` and
  `https://inherit-prepared-artifacts-preview.mariodiego-dev.workers.dev` and
  refuse a request without a capability with an empty 404. Both origins are
  committed as `INHERIT_PREPARED_R2_ORIGIN`; the push carrying them redeploys
  production, and preview is redeployed by hand.
- The two private R2 buckets `inherit-prepared-preview` and
  `inherit-prepared-production` exist in the account since 18 September 2026
  (location ENAM, default jurisdiction, standard storage class, public access
  off, no lifecycle rule, empty). They cost nothing while empty.

## 1. Owner: Cloudflare plan and token

1. Enable the Workers Paid plan on the Cloudflare account that already holds
   R2. Containers are not available on the free plan.
2. Create an API token limited to Workers Scripts (edit), Containers (edit)
   and R2 Storage (edit) on that account.
3. In the GitHub repository, create an environment named `cloudflare` with
   the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and a
   repository variable `CLOUDFLARE_DEPLOY_ENABLED` set to `true` when ready
   for deploys to run. The token is never pasted into chat or a session.
4. In the Supabase dashboard for the Inherit project, Storage → Settings,
   raise the global upload file size limit to at least 8 GiB. The database
   ceilings stay at 24 MiB until step 9; this only removes the provider cap
   the proof files would otherwise hit.

## 2. Engineering: the first deploy (done 18 September 2026)

1. Confirm the two buckets above are still private and empty.
2. Run the `Deploy Cloudflare` workflow for `preview`, then `production`.
   The gateway's first deploy prints its `workers.dev` origin.
3. Commit that origin as `INHERIT_PREPARED_R2_ORIGIN` in
   `workers/prepared-worker/wrangler.json` (production block and, with the
   preview gateway's origin, `env.preview`) and deploy again.

Still open from step 1: item 4, the Supabase Storage upload limit.

## 3. Owner: container secrets

Set the two Worker secrets on the container Worker once, with
`wrangler secret put` from the worker README, for production and with
`--env preview` for preview: `SUPABASE_SERVICE_ROLE_KEY` and
`INHERIT_UPLOAD_SIGNING_JWK` (the same private signer value Vercel holds;
the preview Worker needs the preview project's values once step 4 exists).

## 4. Engineering with owner: the preview stack

1. Create a Supabase preview branch of the Inherit project (billed per hour;
   deleted at the end of step 6).
2. Vercel preview deployments currently have no Supabase variables (every
   dynamic route answers 500 through the middleware). The owner sets the
   preview-target variables to the branch's URL, anon key, service-role key
   and a signer, or installs the Supabase and Vercel integration that syncs
   them. Deployment protection stays on; the proof uses a bypass link.
3. The preview signer is a fresh P-256 key, never the production one. The
   owner generates it (`docs/self-hosting.md`, *Generating the upload signing
   key*), saves it as `INHERIT_UPLOAD_SIGNING_JWK` on the Vercel preview
   target and as the preview container's secret (`--env preview`), and
   imports it as a standby signing key on the branch project in the Supabase
   dashboard, the way production's key was imported
   (`docs/hosted-own-upload-readiness.md`); the connected tools have no
   signing-key operation. Engineering then reads the public half from the
   preview deployment's `/.well-known/inherit-upload-jwks.json` and commits it
   into the preview gateway's `SIGNING_PUBLIC_KEYS` (the deploy guard checks
   only the production list against the live endpoint).
4. Point the preview gateway's `TOKEN_ISSUER` and the preview container's
   `NEXT_PUBLIC_SUPABASE_URL` at the branch, commit, deploy `preview`.
5. Enable preparation on the branch only: `own_preparation_config` with
   `enabled = true`, `artifact_provider = 'r2'`,
   `r2_bucket = 'inherit-prepared-preview'`, and set
   `INHERIT_PREPARED_WGS_ENABLED=true` on the Vercel preview target.

## 5. Engineering: the hosted proof

Synthetic files only, from `scripts/synthetic-wgs-fixture.mts`, which sizes a
file by the decoded bytes the ceilings are measured in and emits either
shape (`--plain` for VCF, gzip by default for VCF.gz, `--gvcf` for a gVCF of
reference blocks and called sites the sniffer classifies `gvcf`):

```sh
node --conditions=react-server --import tsx scripts/synthetic-wgs-fixture.mts --plain --bytes 2147483648 --out <vcf path>
node --conditions=react-server --import tsx scripts/synthetic-wgs-fixture.mts --bytes 2147483648 --out <vcf.gz path>
node --conditions=react-server --import tsx scripts/synthetic-wgs-fixture.mts --gvcf --bytes 8589934592 --out <gvcf path>
```

Run the whole journey against the preview stack:
browser upload → authorization → Storage → preparation in the container →
result → withdrawal, for VCF, VCF.gz and gVCF, including one file at each
ceiling the owner chose (2 GiB VCF, 8 GiB gVCF). Record job durations, peak
memory, artifact bytes and the number of container wakes; set
`max_job_seconds` and the instance type from the measurements; prove the
monthly cap refuses the admission past a limit set to a small number; prove
withdrawal deletes the original and the prepared artifacts (payload
tombstones) and leaves zero residue in every bucket. Evidence goes under
`docs/evidence/`.

## 6. Engineering: tear the preview down

Delete the Supabase preview branch, empty and delete
`inherit-prepared-preview` only if nothing else references it, and record
the bill for the proof.

## 7. Owner: the privacy notice

Approve the sentence naming Cloudflare as a processor (a draft is prepared
for the activation pull request) and confirm Cloudflare's data processing
agreement is in place. The notice must be live before step 8.

## 8. Engineering: production activation

1. Set `own_preparation_config` on the Inherit project: `enabled = true`,
   `artifact_provider = 'r2'`, `r2_bucket = 'inherit-prepared-production'`,
   `max_job_seconds` from step 5. The monthly cap stays at 100.
2. Hand the owner the three Vercel variables: `INHERIT_PREPARED_WGS_ENABLED`,
   `INHERIT_PREPARED_R2_ORIGIN`, `INHERIT_PREPARED_R2_BUCKET`. Activation
   completes when the owner sets them and the deployment is READY.
3. Run one synthetic production journey with zero residue, then record the
   release the way the earlier releases are recorded.

## 9. Engineering: ceilings

Before this step the schema needs a ceiling of its own for gVCF: until the
migration below is applied, one `maximum_vcf_bytes` governs VCF, VCF.gz and
gVCF alike in issuance, normalization, preparation admission and the limit
disclosure. `20260918150000_own_upload_gvcf_ceiling.sql` adds a nullable
`maximum_gvcf_bytes`, selects it for the `gVCF` declaration and the `gvcf`
file type with the VCF ceiling as the fallback while it is null (so applying
it changes no limit), and discloses it as `maximumGvcfBytes`;
`supabase/tests/own_upload_gvcf_ceiling.sql` proves each reader. The app
accepts the extra disclosure key before the database sends it, so this
migration was applied *after* the deployment that carries it, the reverse of
the usual order, with the same preflight, postflight and receipt: applied to
the Inherit project on 18 September 2026 (hosted version `20260918134705`,
`docs/evidence/gvcf-ceiling-release-20260918/`). Until `maximum_gvcf_bytes`
is set, a gVCF is measured against the VCF ceiling; the uploader's limit
sentence names the array and VCF ceilings and gains a gVCF clause when the
two values diverge.

Only after step 8 and that migration: raise `private.upload_authorization_config`
to the owner's ceilings with a read-only preflight and a receipt. Original
retention (`own_original_retention_config`) is already enabled and applies
to every prepared-source original from its creation.

**Two ceilings move together, and the earlier pair of numbers is superseded.**
Owner decision 30, 20 September 2026: `max_artifact_bytes` goes to the schema
maximum and both file ceilings to the largest honestly-supportable size, in
place of the 2 GiB VCF and 8 GiB gVCF this runbook named before. The file
ceiling governs what is *admitted*; `private.own_preparation_config.max_artifact_bytes`
governs what preparation may *write*, and a file admitted under a ceiling the
artifact budget cannot finish is refused part-way through with the terminal
`preparation_file_too_large` that decision 31(a) added. That refusal is honest,
but it is still a person's file failing after an upload, so the two must be set
as a pair.

The bounds, read from the Inherit project's CHECK constraints on 20 September
2026: `max_artifact_bytes` between 1 and **1,073,741,824** (1 GiB), and
`max_job_seconds` between 900 and **3,600**. Production sits at
`max_artifact_bytes = 104,857,600` (100 MiB) today, with preparation disabled
and no jobs. The preview measurement that prompted 31(a) spent 104,485,654
bytes on 540 artifacts in 483 seconds and had not finished a 2 GiB VCF, so the
total that file needs is above 100 MiB and **is not yet measured**. If the
step 5 measurement shows a candidate file needing more prepared bytes than the
1 GiB the schema allows, then the artifact budget — not the clock and not the
upload ceiling — is what binds, and the file ceiling comes down to fit it. Do
not assume the schema maximum is enough for any particular file size; measure
it.

## Applying a migration that replaces a function

`create or replace function` takes whatever body it is given and asks nothing
about what is deployed. A body copied from the wrong migration therefore reverts
every change made after it, silently and with no diff in the migration to show
it. So before applying any migration containing `create or replace`:

1. Read the deployed body: `select pg_get_functiondef(p.oid) from pg_proc p join
   pg_namespace n on n.oid=p.pronamespace where n.nspname=... and p.proname=...`.
2. `diff` it against the migration's new body. Everything that differs must be a
   change the migration's own comment names. Anything else is a revert you did
   not intend.
3. Check which migration the new body was copied from. `grep -l` the function's
   name across `supabase/migrations/` and take the *latest* one, not the one the
   function is most associated with.

This is a rule because it already failed once. The 31(a) migration's guard
replacement was built from `20260908185537_own_prepared_publication.sql` while
`20260908233337_own_prepared_r2_provider.sql` was deployed, which would have
reverted three protections. The preflight above caught it; CI then caught two of
the three independently on run 35519879598 once the PR became mergeable enough
to run at all. A conflicted pull request receives no workflow run, so a draft
can sit untested across several pushes — check `mergeable_state`, and query runs
by branch, because a query by commit returns nothing for both "never ran" and
"queued".

## What stays out of scope here

FASTQ, BAM and CRAM; the cohort source executor (no embryo source can exist
before ingest); the Supabase-provider guard on `own_preparation_config`
(D-126); the provenance counter's reading of a gVCF's called sites as blocks
(D-128, its own change; the row says what it needs); and any limit change
before its proof.
