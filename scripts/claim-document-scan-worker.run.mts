/** Operator-started only: pnpm worker:claim-scan [--once]. See docs/claim-document-scanning.md. */
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const once = process.argv.slice(2).includes("--once");
  const { claimScannerFrom } = await import("../src/lib/scan/test-double-scanner");
  const scanner = claimScannerFrom(process.env);
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { supabaseClaimObjectStore } = await import("../src/lib/future-person/claim-objects");
  const { runClaimDocumentScanLoop } = await import("../src/lib/future-person/document-scan-worker");
  const admin = createAdminClient();
  const result = await runClaimDocumentScanLoop({
    rpc: (name, args) => admin.rpc(name as never, args as never),
    store: supabaseClaimObjectStore(admin),
    scanner,
    signal: controller.signal,
    ...(once ? { maximumIterations: 1 } : {}),
    emit: (event) => { process.stdout.write(`${event}\n`); },
  });
  if (result.hadFailure) process.exitCode = 1;
} catch {
  // No configuration, key, byte, provider response or stack in the output.
  process.stderr.write("claim_document_scan_worker_unavailable\n");
  process.exitCode = 1;
} finally {
  controller.abort();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
