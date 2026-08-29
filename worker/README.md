# Inherit Worker (Tier 3 self-host)

A single-process queue consumer for compute jobs that cannot run inside the
web app. It connects directly to your Supabase Postgres database, polls
`public.worker_jobs` (claiming jobs with `SELECT ... FOR UPDATE SKIP LOCKED`),
and processes them one at a time.

Implemented today:

- **`annotate_vcf`** — downloads a VCF (plain or `.gz`) from the private
  `genomes` Storage bucket, parses it line by line (streaming, so ~200MB files
  work with bounded memory), joins each variant against `public.ref_variants`
  by `(chrom, pos38)`, and writes a summary into `worker_jobs.result`:
  `{ total, annotated, clinvar_hits: [...] }`. `clinvar_hits` lists
  Pathogenic/Likely pathogenic matches (capped at 200 entries).

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string for your Supabase project (Dashboard → Settings → Database; direct connection or session pooler). |
| `SUPABASE_URL` | yes | Project URL, e.g. `https://abcd1234.supabase.co`. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key, used to download objects from the private `genomes` bucket. Keep it on this machine only. |
| `WORKER_POLL_MS` | no | Queue poll interval in ms. Default `5000`. |

## Running against a Supabase project

```sh
cd worker
cat > .env <<'EOF'
DATABASE_URL=postgresql://postgres:...@db.abcd1234.supabase.co:5432/postgres
SUPABASE_URL=https://abcd1234.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
EOF
docker compose --env-file .env up --build
```

Or without Docker: `npm install && npm start` (Node 22+).

Enqueue a job by inserting a row (the web app does this for you):

```sql
insert into public.worker_jobs (user_id, file_id, kind, payload)
values ('<user uuid>', '<file uuid>', 'annotate_vcf',
        '{"file_id": "<file uuid>", "user_id": "<user uuid>", "bucket_path": "<user uuid>/sample.vcf.gz"}');
```

`bucket_path` is the object path inside the `genomes` bucket. The worker marks
the job `running`, then `done` (with `result`) or `failed` (with `error`).
`SIGTERM`/`SIGINT` stop the loop after the current job finishes.

## Why this can't run on Vercel or Supabase Edge Functions

Serverless functions are built for short request/response cycles: execution is
capped at seconds-to-minutes, instances have small memory and ephemeral disk,
and there is no long-lived process to hold a Postgres connection and poll a
queue. Streaming a multi-hundred-MB VCF is at the edge of what they allow, and
the real endgame (below) needs CPU-hours and tens of GB of scratch space.
A boring long-running container on hardware you control is the honest fit —
and your genome never has to transit a third party's compute.

## Extension path: FASTQ alignment and variant calling (not implemented)

This worker is the intended home for bring-your-own-compute pipelines. The
queue schema already reserves `kind = 'align_fastq'` and
`kind = 'call_variants'`; no handler exists yet. The sketch:

1. `align_fastq`: download FASTQ pairs from Storage, run
   `bwa-mem2 mem GRCh38.fa r1.fq.gz r2.fq.gz | samtools sort -o sample.bam`,
   index, upload the BAM back to Storage. Needs the ~10GB GRCh38 reference +
   index on local disk and hours of CPU for a 30x genome.
2. `call_variants`: run GATK HaplotypeCaller (or DeepVariant) on the BAM to
   produce a gVCF/VCF, upload it, then enqueue an `annotate_vcf` job on the
   result.

These tools would be baked into the image (they are not in the current
Dockerfile) and are exactly why Tier 3 exists: alignment is not feasible — or
private — on shared serverless infrastructure.

## Tests

Pure parsing/join logic is covered by `src/annotate.test.ts`, run from the
repo root: `pnpm vitest run worker/src/annotate.test.ts`.
