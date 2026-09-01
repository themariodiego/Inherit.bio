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
| `BYOK_ENCRYPTION_KEY` | output of `openssl rand -base64 32` |
| `JOBS_SECRET` | output of `openssl rand -hex 32` |
| `RESEND_API_KEY` | leave unset locally — auth emails land in Mailpit (http://127.0.0.1:54324); app emails no-op with a console note |
| `EMAIL_FROM` | anything locally, e.g. `Inherit <inherit@localhost>` |

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

### Tests

```bash
pnpm test        # unit
pnpm e2e         # Playwright: RLS proof, network audit, flows (needs the
                 # local stack running and a production build; see
                 # playwright.config.ts)
pnpm gate:legal  # placeholder gate over legal pages
```

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

3. **Vercel**: import the repo, framework Next.js. Set the environment
   variables from `.env.example` (production values; generate fresh
   `BYOK_ENCRYPTION_KEY` and `JOBS_SECRET`, and set `CRON_SECRET` so Vercel
   Cron can call the scheduled jobs). `vercel.json` schedules the research
   and annotation jobs daily.

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
  `NEXT_PUBLIC_MAX_*_BYTES` accordingly (see `src/lib/limits.ts`).
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

The worker polls `worker_jobs` and runs the annotation stage against files
in your storage. Alignment/variant calling are documented extension points
— they need real CPU/RAM that no serverless platform provides (ADR-0001).

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
