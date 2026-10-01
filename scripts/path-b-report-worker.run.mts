/** One operator-started queued report in an isolated TEST-LOCAL database. */
import { createAdminClient } from "../src/lib/supabase/admin";
import { runPathBReportWorker, type PathBReportRpc } from "../src/lib/uploads/path-b-report-worker";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  if (process.env.INHERIT_TEST_JURISDICTION !== "1" || process.argv.length !== 2) throw new Error("worker_closed");
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:"
    || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("worker_closed");
  const admin = createAdminClient();
  type Pending = PromiseLike<{ data: unknown; error: unknown }> & { abortSignal(signal: AbortSignal): Pending };
  const invoke = admin.rpc.bind(admin) as unknown as (name: "path_b_report_v1", args: unknown) => Pending;
  const rpc: PathBReportRpc = (args, signal) => invoke("path_b_report_v1", args).abortSignal(signal);
  const result = await runPathBReportWorker({ testJurisdiction: true, signal: controller.signal, rpc,
    loadTemplates: async signal => {
      if (signal.aborted) throw new Error("worker_closed");
      const response = await admin.from("report_templates")
        .select("slug, category, title, summary, evidence, variants, pgs_id, citations, layer, estimate_kind")
        .eq("status", "published").order("category").order("title").abortSignal(signal);
      if (signal.aborted || response.error) throw new Error("worker_closed");
      return response.data;
    },
  });
  process.stdout.write(`path_b_report_${result.status}\n`);
} catch {
  process.stderr.write("path_b_report_unavailable\n"); process.exitCode = 1;
} finally {
  controller.abort(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
}
