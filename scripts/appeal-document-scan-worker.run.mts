/** Operator-started only. Run with the installed Node argv in docs/public-appeal-evidence.md. */
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const { testAppealIntakeOpen } = await import("../src/lib/future-person/appeals-open");
  if (!testAppealIntakeOpen()) throw new Error("unavailable");
  const once = process.argv.slice(2).includes("--once");
  const { claimScannerFrom } = await import("../src/lib/scan/test-double-scanner");
  const scanner = claimScannerFrom(process.env);
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { supabaseAppealObjectStore } = await import("../src/lib/future-person/claim-objects");
  const { runAppealDocumentScanLoop } = await import("../src/lib/future-person/appeal-document-scan-worker");
  const admin = createAdminClient();
  const result = await runAppealDocumentScanLoop({
    rpc: (name, args) => admin.rpc(name as never, args as never).retry(false).abortSignal(controller.signal),
    store: supabaseAppealObjectStore(admin),
    scanner,
    signal: controller.signal,
    ...(once ? { maximumIterations: 1 } : {}),
    emit: (event) => { process.stdout.write(`${event}\n`); },
  });
  if (result.hadFailure) process.exitCode = 1;
} catch {
  // No configuration, key, byte, provider response or stack in the output.
  process.stderr.write("appeal_document_scan_worker_unavailable\n");
  process.exitCode = 1;
} finally {
  controller.abort();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
