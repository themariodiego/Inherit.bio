# Self-hosting Inherit

Two ways to run Inherit yourself: fully local (everything on your machine,
good for trying it out and for local-LLM privacy) or hosted (Vercel +
Supabase + Resend, what the public demo runs). Both start the same way.

## Prerequisites

- Node.js ≥ 20.9 and pnpm ≥ 9 (`corepack enable`) — the optional Tier-3
  worker needs Node 22+
- Docker (for the local Supabase stack and the optional worker)
- Git

## 1. Clone and install

```bash
git clone https://github.com/themariodiego/Inherit.bio.git
cd Inherit.bio
pnpm install
```

## 2. Fully local (recommended first run)

```bash
pnpm supabase start
```

This boots Postgres, Auth, Storage, and Mailpit in Docker and applies every
migration in `supabase/migrations/`. When it finishes it prints the local
credentials. Create `.env.local` with them:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

| Variable | Value for local |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `ANON_KEY` printed by `supabase start` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `SERVICE_ROLE_KEY` printed by `supabase start` |
| `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` — **set this.** It builds the links inside outbound mail: invitations, rights and withdrawal links, and the cancel/export links in an account-deletion notice. It falls back to the hosted deployment rather than to localhost, so leaving it unset sends your users' mail links, and the rights tokens they carry, to a site you do not run. |
| `BYOK_ENCRYPTION_KEY` | output of `openssl rand -base64 32` |
| `JOBS_SECRET` | output of `openssl rand -hex 32` |
| `INHERIT_UPLOAD_SIGNING_JWK` | the single line printed by the generator in section 5 — **the uploader needs it**: without it `POST /api/files/upload-session` answers 503 and no file can be staged. Your Supabase project must also accept what that key signs; section 5 says what that takes. |
| `RESEND_API_KEY` | leave unset locally — **delete the line** the copy brought over: the template ships `re_YOUR_KEY`, and any non-empty value makes the app build a real client instead of no-opping. Unset, auth emails land in Mailpit (http://127.0.0.1:54324) and app emails no-op with a console note |
| `EMAIL_FROM` | anything locally, e.g. `Inherit <inherit@localhost>` |

Those are the values a first local run needs. `.env.example` declares more
than that — the mail webhook, the upload size caps, the copilot's local-model
policy, the normalization and prepared-WGS switches — and section 5 lists
every one of them, including the variables you must deliberately leave unset.

Seed the reference data (provider directory, report templates, PRS
weights):

```bash
pnpm seed
```

Run it:

```bash
pnpm dev
```

Open http://localhost:3000, sign up (the verification email is in Mailpit
at http://127.0.0.1:54324), and upload a sample:
`data/samples/synthetic_23andme.txt` (synthetic person) or
`data/samples/HG001_GRCh38_chr20-22.vcf.gz` (public GIAB reference
material).

### Local LLM copilot (the privacy-preferred setup)

Run [Ollama](https://ollama.com) (`ollama pull llama3.1 && ollama serve`).
First, because the copilot fetches the endpoint server-side, set
`ALLOW_PRIVATE_LLM_ENDPOINTS=true` in `.env.local` and restart `pnpm dev` —
this opts your self-hosted deployment into reaching a local/private model
(it stays off by default so a shared deployment can't be used to reach
internal addresses; cloud-metadata and link-local addresses are always
refused). Then in **Settings → Copilot provider** choose *OpenAI-compatible*,
base URL `http://localhost:11434/v1`, model `llama3.1`. Local endpoints need
no consent grant (nothing leaves your infrastructure) and the chat shows a
data-flow indicator saying exactly that.

That flag governs the copilot's ordinary provider fetch. The own-copilot local
transport is a separate and stricter mechanism with four more variables, all
of which have to agree before it turns on; see section 5.

### Tests

```bash
pnpm test        # unit
pnpm e2e         # Playwright: RLS proof, network audit, flows (needs the
                 # local stack running and a production build; see
                 # playwright.config.ts)
pnpm gate:legal  # placeholder gate over legal pages
```

One unit suite, `src/lib/claims/capture-emails.test.ts`, re-renders production
email from the checkout and refuses to attest one that carries files git does
not track — including the `.env.local` you just created, which it names
explicitly. In a checkout configured as above it fails with
`email-capture:untracked-ignored-inputs`; it passes on the same commit with no
`.env.local` present. The rest of the suite passed in a checkout configured
this way, with one other exception: `scripts/ci-browser-runtime.test.ts` asserts that
the host user is unprivileged, so six of its tests fail when you run the suite
as root.

## 3. Hosted (Vercel + Supabase + Resend)

1. **Supabase**: create a project at supabase.com. Link and push the
   migrations:

   ```bash
   pnpm supabase login
   pnpm supabase link --project-ref YOUR-PROJECT-REF
   pnpm supabase db push
   ```

   In *Storage → Settings*, set the global file size limit to what your
   plan and Tier-2 policy allow (Free caps objects at 50 MB; Pro allows up
   to 500 GB — see ADR-0001). In *Authentication → Providers*, enable Email
   (confirmations on) and optionally GitHub OAuth (callback:
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`).

   In *Authentication → URL Configuration*, set **Site URL** to your
   production URL and add `https://YOUR-DOMAIN/**` to **Redirect URLs**.
   This is required: it defaults to `http://localhost:3000`, and redirect
   targets not on the allowlist are ignored, so until it's set every
   verification and reset link bounces the user to a dead
   `localhost:3000/?code=…`.

2. **Resend**: create an API key. Verify a sending domain (or use
   `onboarding@resend.dev`, which only delivers to your own account's
   inbox — fine for a single-operator demo, useless for real users). For
   auth emails, set Supabase *Authentication → SMTP* to
   `smtp.resend.com:465`, username `resend`, password = your API key,
   sender = your verified address.

   To have delivery, bounce and complaint statuses recorded, add a Resend
   webhook pointing at `https://YOUR-DOMAIN/api/webhooks/resend` and set
   `RESEND_WEBHOOK_SECRET` to that endpoint's signing secret. Unset, the
   route answers 503 and no status is ever written.

3. **Vercel**: import the repo, framework Next.js. Set the environment
   variables from `.env.example` (production values; generate fresh
   `BYOK_ENCRYPTION_KEY` and `JOBS_SECRET`, and set `CRON_SECRET` so Vercel
   Cron can call the scheduled jobs). `vercel.json` schedules the research
   and annotation jobs daily. Section 5 lists every variable, what a wrong
   value does, and the seven that Vercel or the test harness sets for you and
   you must therefore never set by hand.

   > **Note**: production env belongs in the hosting platform's environment
   > variables (the Vercel dashboard), never in a committed file such as
   > `.env.production`. `NEXT_PUBLIC_*` values are inlined into the client
   > bundle at build time, so the build itself must receive them — make sure
   > they point at *your* Supabase project wherever the build runs.

4. **Seed** the production project (uses the service-role key against the
   hosted URL):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY \
   pnpm seed
   ```

### Production sizing notes

- **Free tier demo** (what the public demo runs): 500 MB database ≈ a
  handful of processed array files (an array file inserts ~600 k variant
  rows ≈ 45–60 MB with indexes); 1 GB storage; 50 MB max object —
  Tier-2 BAM/CRAM is effectively demo-only. Set
  `NEXT_PUBLIC_MAX_ARRAY_BYTES`, `NEXT_PUBLIC_MAX_VCF_BYTES` and
  `NEXT_PUBLIC_MAX_BAM_BYTES` accordingly (see `src/lib/limits.ts`).
- **Supabase Pro**: 8 GB+ database (≈ 100+ array users; VCFs cost more),
  100 GB storage included, 500 GB max object — real Tier-2 support.
- **Vercel**: Hobby caps functions at 300 s (fine for the demo caps); Pro
  allows 800 s and per-minute cron. Processing a 200 MB VCF fits in 300 s;
  raise caps only with Pro + tested headroom.

## 4. The Tier-3 worker (FASTQ/BAM analysis)

See [worker/README.md](../worker/README.md). Short version:

```bash
cd worker
cp .env.example .env   # fill in DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
docker compose --env-file .env up --build
```

(Without Docker: `npm install && npm start`, which needs Node 22+.)

The worker keeps its own template with its own names: what `worker/.env`
calls `SUPABASE_URL` is what this app calls `NEXT_PUBLIC_SUPABASE_URL`. The
app never reads `worker/.env`, and `pnpm gate:env` does not cover it.

The worker polls `worker_jobs` and runs the annotation stage against files
in your storage. Alignment/variant calling are documented extension points
— they need real CPU/RAM that no serverless platform provides (ADR-0001).

## 5. Every variable in `.env.example`

`.env.example` is the whole configuration surface, and `pnpm gate:env` keeps
it that way: it fails if the code reads a variable the template does not
declare, if the template declares one nothing reads, if a template key is
missing from the tables below, or if this guide names a variable the template
does not declare. Copy the template, then work through these.

### Required

| Variable | What to set, and what a missing or wrong value does |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The project URL — local `http://127.0.0.1:54321`, hosted `https://YOUR-PROJECT-REF.supabase.co`. Inlined into the browser bundle at build time, so whatever machine builds must already have it. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The publishable key of that same project. It routes browser requests through the Supabase gateway; it is never the upload authorization. |
| `SUPABASE_SERVICE_ROLE_KEY` | The secret key of that same project: research-library pipeline, account deletion, privileged jobs. Server only — never under a name beginning NEXT_PUBLIC, and never in the browser bundle. |
| `NEXT_PUBLIC_SITE_URL` | Canonical public URL of this deployment, no trailing slash. It falls back to `http://localhost:3000`, so a missing value fails where you can see it. |
| `NEXT_PUBLIC_APP_URL` | The origin used to build the links **inside outbound mail**: invitations, rights and withdrawal links, and the cancel/export links in an account-deletion notice. Set it explicitly. It sits beside `NEXT_PUBLIC_SITE_URL` and the two fall back in opposite directions — this one falls back to the hosted deployment at `https://www.inherit.bio`, so leaving it unset silently sends your users' mail links, and the rights tokens those links carry, to a site you do not run. |
| `BYOK_ENCRYPTION_KEY` | `openssl rand -base64 32`. It encrypts users' own model keys at rest and derives the keyed digests used to match values that are never stored in the clear. Anything that is not 32 bytes of base64 raises `BYOK_ENCRYPTION_KEY must be 32 bytes of base64`; changing it later leaves existing ciphertext undecryptable and existing digests unmatchable. |
| `INHERIT_UPLOAD_SIGNING_JWK` | The server-only private key the upload route signs Storage bearers with, as one line of JSON — see *Generating the upload signing key* below. Unset or malformed, `POST /api/files/upload-session` answers 503 and nothing can be uploaded at all. Never give it a name beginning NEXT_PUBLIC and never reuse `BYOK_ENCRYPTION_KEY` for it. |
| `EMAIL_FROM` | The sender for application mail. In a production build the mailer throws `EMAIL_FROM must use a verified sender in production` when it is unset; outside production it falls back to `Inherit <onboarding@resend.dev>`. |
| `DATABASE_URL` | The direct Postgres connection string. Under `src/` only the direct-completion path below opens it; the Tier-3 worker reads its own copy from `worker/.env`. Local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. |

### Mail delivery and scheduled jobs

| Variable | What to set, and what a missing or wrong value does |
| --- | --- |
| `RESEND_API_KEY` | The Resend key. Without it the report-ready and research-digest senders no-op with a console warning, and anything that must send mail reports the provider as unavailable. Local runs can leave it unset: sign-up mail goes to Mailpit, which is Supabase's own sender, not this one. |
| `RESEND_WEBHOOK_SECRET` | The signing secret of the Resend webhook you point at `/api/webhooks/resend`. Unset, that route answers 503 and no delivery, bounce or complaint status is ever recorded. A wrong value answers 401 for every delivery. |
| `JOBS_SECRET` | `openssl rand -hex 32`. The bearer an operator or scheduler presents to `/api/jobs/*`. The template ships the literal `GENERATE-ME`, and that string is accepted as a bearer exactly as written, so a copy you never edited is a job token anyone can guess. |
| `CRON_SECRET` | `openssl rand -hex 32`, set in Vercel so its Cron can call the scheduled jobs. It ships as the literal `GENERATE-ME` too, with the same hazard. `/api/jobs/*` accepts either this or `JOBS_SECRET`; `/api/cron/retention` accepts only this one. With neither set, every one of those endpoints refuses every request. |

### Upload, normalization and prepared-WGS switches

| Variable | What to set, and what a missing or wrong value does |
| --- | --- |
| `INHERIT_CANONICAL_UPLOADS_PAUSED` | `false`. Only the exact string `true` pauses the issuing of new upload leases; uploads already issued and existing file controls continue. It is a switch for a deployment transition, not a setting to leave on. |
| `INHERIT_NORMALIZATION_DIRECT_DATABASE` | `false` unless you have deliberately accepted the atomic-completion path on a hosted deployment. Only `true` and `false` are accepted — any other value makes normalization completion unavailable. When `true`, `DATABASE_URL` must be that same project's own direct host (`db.<ref>.supabase.co`, user `postgres`) or its shared pooler (user `postgres.<ref>`) on port 5432 or 6543, carrying at most the one query parameter `sslmode=verify-full`, and `NEXT_PUBLIC_SUPABASE_URL` must be `https://<ref>.supabase.co`. A plaintext local connection is accepted only for the two registered end-to-end test projects, so on an ordinary local install leave this `false`. |
| `INHERIT_NORMALIZATION_DATABASE_CA_CERT` | Usually unset. If your provider requires its own trust anchor, set it to that provider's public certificate-authority certificate in PEM, BEGIN/END lines and real newlines included, under 16384 characters. It is read only for a hosted direct connection, it must parse as a certificate authority, and it adds a trust anchor — it never relaxes verification. A malformed or non-authority value makes the connection unavailable. |
| `INHERIT_PREPARED_WGS_ENABLED` | `false` for an ordinary self-host. The prepared-object path needs this flag *and* the database's own `own_preparation_config.enabled` gate; the operator-started preparation worker (`pnpm worker:prepared`, see `worker/README.md`) refuses to run without the flag. Setting it alone enables nothing. |
| `INHERIT_PREPARED_R2_ORIGIN` | Empty unless the flag above is on. Then: the HTTPS origin of the signed artifact gateway — scheme and host only, no path, no trailing slash, no query, no credentials. Anything else makes the transport unavailable. |
| `INHERIT_PREPARED_R2_BUCKET` | Empty unless the flag above is on. Then: the exact private bucket bound to that gateway and selected in the database configuration. A bucket that does not match this value is refused. |

### Upload size caps

Ceilings in bytes for the self-host upload surfaces (`src/lib/limits.ts`).
Unset, empty or not a positive number falls back to the demo cap shown. Keep
each at or below the maximum object size your storage provider enforces — on
Supabase that is *Storage → Settings → file size limit*. The own-upload path
reads its ceilings from the database instead of from these.

| Variable | Falls back to |
| --- | --- |
| `NEXT_PUBLIC_MAX_ARRAY_BYTES` | 104857600 (100 MB), Tier-1 array text/CSV |
| `NEXT_PUBLIC_MAX_VCF_BYTES` | 209715200 (200 MB), Tier-1 VCF/gVCF |
| `NEXT_PUBLIC_MAX_BAM_BYTES` | 5368709120 (5 GB), Tier-2 BAM/CRAM |

### Copilot model access

| Variable | What to set, and what a missing or wrong value does |
| --- | --- |
| `ALLOW_PRIVATE_LLM_ENDPOINTS` | `true` only when self-hosting, so the copilot's ordinary server-side provider fetch may reach a loopback or RFC-1918 address (the Ollama setup in section 2). Left unset, those addresses are refused; cloud-metadata and link-local addresses are refused either way. |
| `INHERIT_DEPLOYMENT_KIND` | Exactly `self-hosted-development`. Any other value, unset included, reads as unattested and leaves the local model transport off. |
| `ALLOW_LOCAL_MODEL_ENDPOINTS` | Exactly `1`. |
| `INHERIT_LOCAL_MODEL_HOST_ATTESTATION` | Exactly `same-host-egress-isolated-v1`. It records your claim that a same-host, egress-isolated network already exists; it neither builds nor verifies one. |
| `INHERIT_LOCAL_MODEL_ORIGINS` | A JSON array of at most 16 exact origins — scheme, host and port only, no path and no trailing slash, e.g. `["http://127.0.0.1:11434"]`. A malformed array, or one entry that is not exactly an origin, leaves the transport off. |

Those last four are the own-copilot local transport and they only work
together: all four must hold, both Vercel markers must be absent, and a local
destination must resolve to loopback — a private LAN address is a remote
disclosure, not a same-host model. See `docs/own-copilot-authority.md`.

### Never set these

They are read under `src/`, they are deliberately absent from
`.env.example`, and `scripts/env-gate.ts` records each one with its reason.

| Variable | Who sets it |
| --- | --- |
| `NODE_ENV` | Node, and `next build` / `next start`. Overriding it fights the framework. |
| `VERCEL` | Vercel, as the hosted marker. Setting it by hand asserts a platform you are not on and turns off local-only behaviour. |
| `VERCEL_ENV` | Vercel, as production/preview/development. |
| `VERCEL_URL` | Vercel, as the deployment host. Your operator-set URLs are `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL`. |
| `CI` | The CI runner. |
| `INHERIT_TEST_JURISDICTION` | The acceptance fixtures. `next.config.ts` throws at startup if it is `1` in a production deployment. |
| `INHERIT_LOCAL_E2E_PROJECT` | The browser suite, to pick which local test stack it targets. |

### Generating the upload signing key

`INHERIT_UPLOAD_SIGNING_JWK` is a P-256 private key in JWK form, on one line.
Generate one:

```bash
node -e 'const c = require("node:crypto");
const k = c.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
console.log(JSON.stringify({ ...k.privateKey.export({ format: "jwk" }), kid: c.randomUUID() }));'
```

Paste that single line into `.env.local` (or into your hosting platform's
secret store). The route re-derives the public half from the private scalar
and refuses the key if they disagree, so a truncated or edited paste fails
closed instead of signing.

Supabase Storage then has to accept what the key signs. The upload bearer is
issued for your `NEXT_PUBLIC_SUPABASE_URL` plus `/auth/v1`, so the project
must verify tokens signed by this key's public half: locally that is the
`signing_keys_path` entry `supabase/config.toml` ships commented out, and on
a hosted project it is that project's own signing-key configuration. This
guide does not automate either, and the one local browser upload recorded in
this repository (`docs/local-upload-browser-verification.md`) ran a dedicated
Storage instance that trusted a run-specific public key rather than the stock
`pnpm supabase start` stack. Treat browser upload on a fresh self-host as
unproven until you have registered the public half yourself and watched an
object land.

## Troubleshooting

- **Supabase start fails**: Docker must be running; `pnpm supabase stop
  --no-backup` resets a wedged stack.
- **Sign-up email never arrives locally**: it's in Mailpit
  (http://127.0.0.1:54324), not your real inbox.
- **Verification link goes to `localhost:3000/?code=…` on a hosted
  deployment**: the project's auth Site URL / redirect allowlist is unset
  (see *Authentication → URL Configuration* in step 1 above). The email
  itself is already confirmed when this happens — verification occurs on
  Supabase's domain before the redirect — so sign in directly at your
  production URL, then fix the URL configuration for future emails.
- **`BYOK_ENCRYPTION_KEY must be 32 bytes of base64`**: regenerate with
  `openssl rand -base64 32` (the value includes a trailing `=` — keep it).
- **Upload rejected as unrecognized**: the sniffer reads the first bytes;
  make sure the file is a raw vendor export (not a PDF report) or a VCF.
- **Every upload fails before any bytes move**: the upload session route
  answers 503 when `INHERIT_UPLOAD_SIGNING_JWK` is unset or is not a valid
  P-256 private key. If the session succeeds and the browser's own upload to
  Storage is refused instead, the key is fine but the project does not yet
  accept tokens signed with it (see section 5).
