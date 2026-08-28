// Tier-3 self-host worker: polls public.worker_jobs over a direct Postgres
// connection and runs annotate_vcf jobs. See worker/README.md.

import pg from "pg";
import { runAnnotateJob, type AnnotatePayload, type StorageEnv } from "./annotate";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

const POLL_MS = Number(process.env.WORKER_POLL_MS) > 0 ? Number(process.env.WORKER_POLL_MS) : 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parsePayload(raw: unknown): AnnotatePayload {
  const p = raw as Partial<AnnotatePayload> | null;
  if (
    !p ||
    typeof p.file_id !== "string" ||
    typeof p.user_id !== "string" ||
    typeof p.bucket_path !== "string"
  ) {
    throw new Error("invalid annotate_vcf payload: expected { file_id, user_id, bucket_path }");
  }
  return { file_id: p.file_id, user_id: p.user_id, bucket_path: p.bucket_path };
}

/** Claims the oldest queued annotate_vcf job with FOR UPDATE SKIP LOCKED. */
async function claimJob(client: pg.Client): Promise<{ id: string; payload: unknown } | null> {
  await client.query("begin");
  try {
    const { rows } = await client.query<{ id: string; payload: unknown }>(
      `select id, payload from public.worker_jobs
       where status = 'queued' and kind = 'annotate_vcf'
       order by created_at
       limit 1
       for update skip locked`,
    );
    const job = rows[0];
    if (!job) {
      await client.query("commit");
      return null;
    }
    await client.query(
      "update public.worker_jobs set status = 'running', started_at = now() where id = $1",
      [job.id],
    );
    await client.query("commit");
    return job;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  }
}

async function main(): Promise<void> {
  const env: StorageEnv = {
    SUPABASE_URL: requireEnv("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
  const client = new pg.Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();

  let stop = false;
  const onSignal = (sig: string) => {
    console.log(`received ${sig}, finishing current job then exiting`);
    stop = true;
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  console.log(`worker started, polling every ${POLL_MS}ms`);
  while (!stop) {
    let job: { id: string; payload: unknown } | null;
    try {
      job = await claimJob(client);
    } catch (err) {
      console.error("failed to claim job:", err);
      await sleep(POLL_MS);
      continue;
    }
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    console.log(`processing job ${job.id}`);
    try {
      const result = await runAnnotateJob(client, parsePayload(job.payload), env);
      await client.query(
        "update public.worker_jobs set status = 'done', result = $2, finished_at = now() where id = $1",
        [job.id, result],
      );
      console.log(`job ${job.id} done: ${result.annotated}/${result.total} variants annotated`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`job ${job.id} failed: ${message}`);
      await client.query(
        "update public.worker_jobs set status = 'failed', error = $2, finished_at = now() where id = $1",
        [job.id, message],
      );
    }
  }
  await client.end();
  console.log("worker stopped");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
