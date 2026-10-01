/** One operator-started synthetic Path B job. No timer or production runner. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import register from "../docs/route-register.json";
import { buildLiftover } from "../src/lib/genome/liftover";
import { createAdminClient } from "../src/lib/supabase/admin";
import { runPathBNormalizationWorker, type PathBNormalizationRpc } from "../src/lib/uploads/path-b-normalization-worker";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  if (process.env.INHERIT_TEST_JURISDICTION !== "1" || process.argv.length !== 2) throw new Error("worker_closed");
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== "http:"
    || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("worker_closed");
  const admin = createAdminClient();
  type Call = (name: "path_b_normalization_v1" | "register_path_b_normalization_positions_v1", args: unknown) =>
    PromiseLike<{ data: unknown; error: unknown | null }>;
  const call = admin.rpc.bind(admin) as unknown as Call;
  const rpc: PathBNormalizationRpc = { operation: args => call("path_b_normalization_v1", args),
    register: args => call("register_path_b_normalization_positions_v1", args) };
  let lift: ReturnType<typeof buildLiftover> | undefined;
  let liftoverSha256: string | undefined;
  try {
    const chain = await readFile(path.join(process.cwd(), "data/ref/chain/GRCh37_to_GRCh38.chain.gz"));
    // Reference identity is computed locally, never accepted from a job URL.
    liftoverSha256 = createHash("sha256").update(chain).digest("hex");
    lift = buildLiftover(chain);
  } catch { /* A GRCh37 source fails closed when its public reference is absent. */ }
  const result = await runPathBNormalizationWorker({ rpc, testJurisdiction: true, signal: controller.signal,
    maximumUnmappedFraction: register.policyContracts["genome-liftover-v1"].maximumUnmappedFraction,
    ...(lift && liftoverSha256 ? { lift, liftoverSha256 } : {}),
    readRange: async (source, start, end, signal) => fetch(new URL(`/storage/v1/object/authenticated/genomes/${source.objectKey}`, url), {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, Range: `bytes=${start}-${end}` },
      cache: "no-store", redirect: "error", signal,
    }),
  });
  process.stdout.write(`path_b_normalization_${result.status}\n`);
} catch {
  process.stderr.write("path_b_normalization_unavailable\n"); process.exitCode = 1;
} finally {
  controller.abort(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
}
