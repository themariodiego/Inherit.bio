/**
 * Operator-started only, TEST-LOCAL only. Scans the signed-permission documents
 * of the reviewed-document Path B (20261016190000) with the same pass as the
 * appeal documents; it refuses to start unless INHERIT_TEST_JURISDICTION=1.
 *
 *     node --conditions=react-server --import ./scripts/server-only-shim.mjs --import tsx scripts/permission-document-scan-worker.run.mts --once
 */
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const { permissionDocumentsOpen } = await import("../src/lib/uploads/permission-document-open");
  if (!permissionDocumentsOpen()) throw new Error("unavailable");
  const once = process.argv.slice(2).includes("--once");
  const { claimScannerFrom } = await import("../src/lib/scan/test-double-scanner");
  const scanner = claimScannerFrom(process.env);
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { supabasePermissionObjectStore } = await import("../src/lib/future-person/claim-objects");
  const { runPermissionDocumentScanLoop } = await import("../src/lib/future-person/appeal-document-scan-worker");
  const admin = createAdminClient();
  const result = await runPermissionDocumentScanLoop({
    rpc: (name, args) => admin.rpc(name as never, args as never).retry(false).abortSignal(controller.signal),
    store: supabasePermissionObjectStore(admin),
    scanner,
    signal: controller.signal,
    ...(once ? { maximumIterations: 1 } : {}),
    emit: (event) => { process.stdout.write(`${event}\n`); },
  });
  if (result.hadFailure) process.exitCode = 1;
} catch {
  // No configuration, key, byte, provider response or stack in the output.
  process.stderr.write("permission_document_scan_worker_unavailable\n");
  process.exitCode = 1;
} finally {
  controller.abort();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
