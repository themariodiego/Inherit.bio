/** Closed bootstrap metadata only. No command, key, identifier or output is
 * admitted. These records supplement failure; they cannot authorize recovery. */
import { z } from "zod";
import { CI_RUNTIME_SETUP_STAGES } from "../ci-browser-runtime-failure";

export const HOSTED_BOOTSTRAP_PREFIX = "OWNED_BOOTSTRAP_FAILURE_V1|";
const stages = ["host-admission", "source-attestation", "source-copy", "migration-copy",
  "native-start", "native-inventory", "native-ledger", "native-keys", "bootstrap-stack-acquisition", "bootstrap-keys",
  "production-build", "bootstrap-cleanup", "session-stack-acquisition", "session-bootstrap-keys",
  "session-reference-seed", "session-upload-capacity", "session-runtime-preflight", "session-storage-proxy",
  "session-app-configuration", "session-mail-capture", "session-main-app-ready", "session-embryo-app-ready",
  "session-chromium-launch", "session-build-jurisdiction", "session-native-embryo-publication",
  "bridge-ready", "bridge-input", "bridge-forward", "bridge-wait", "bridge-whole", "bridge-inner-terminal", "bridge-setup",
  "stack-runtime-guard", "stack-owner-binding", "stack-scratch-identity", "stack-lock-acquisition",
  "session-binding", "session-exclusivity", "session-cancellation", "session-acquisition",
  "session-publication-binding", "session-read-open", "session-read-identity", "session-cleanup",
  "read-browser-context", "read-browser-route", "read-browser-prepare", "read-browser-prepare-close", "read-browser-init-script", "read-browser-page-open", "read-browser-start-page", "read-browser-context-cleanup", "read-cohort-query", "read-embryos-query", "read-cohort-result", "read-embryos-result", "read-files-query", "read-worker-proof", "read-native-publication", "read-publication-contract", "read-sign-in", "read-comparison-navigation", "read-permission", "read-result-gate", "read-no-model-surface", "read-no-model-visible", "read-no-model-text", "read-no-model-dom", "read-no-model-notices", "read-no-model-condition-rows", "read-no-model-figures", "read-no-model-shape", "read-no-model-page-auth", "read-no-model-page-jurisdiction", "read-no-model-page-empty", "read-no-model-page-processing", "read-no-model-page-consent", "read-no-model-page-gated", "read-no-model-page-read-error", "read-no-model-page-shape-error", "read-no-model-page-error", "read-no-model-page-not-found"] as const;
const densityStages = ["density-bootstrap-keys", "density-reference-seed", "density-upload-capacity",
  "density-storage-proxy", "density-runtime-preflight", "density-runtime-environment", "density-mail-capture",
  "density-app-launch", "density-service-observers", "density-app-readiness", "density-chromium-launch",
  "density-acquisition-cleanup", ...CI_RUNTIME_SETUP_STAGES.map(stage => `density-runtime-${stage}` as const)] as const;
const schema = z.object({ stage: z.enum([...stages, ...densityStages] as const),
  classification: z.enum(["spawn-refused", "exit-nonzero", "signal", "timeout", "output-limit", "setup-refused"]),
  exitCode: z.number().int().min(0).max(255).nullable(),
  signal: z.enum(["SIGABRT", "SIGALRM", "SIGBUS", "SIGHUP", "SIGINT", "SIGKILL", "SIGPIPE",
    "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGXCPU", "SIGXFSZ"]).nullable(),
  cleanup: z.enum(["not-started", "retained", "unreturned", "uncertain", "complete"]),
}).strict();
export type HostedBootstrapDiagnostic = z.infer<typeof schema>;
export function hostedBootstrapDiagnosticLine(value: unknown): string | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  const line = HOSTED_BOOTSTRAP_PREFIX + JSON.stringify(parsed.data);
  return Buffer.byteLength(line) <= 512 ? line : null;
}
export function emitHostedBootstrapFailure(stage: HostedBootstrapDiagnostic["stage"],
  metadata: { classification: string; exitCode: number | null; signal: string | null },
  cleanup: HostedBootstrapDiagnostic["cleanup"], emit = (line: string) => { process.stderr.write("\n" + line + "\n"); }) {
  // A diagnostic I/O failure must never replace the original refusal or its
  // independently required cleanup result.
  try {
    // The real runtime classifier also carries registered inner-stage metadata.
    // Select only own data fields; no accessor or unrelated value is evaluated.
    const field = (key: string): unknown => Object.getOwnPropertyDescriptor(metadata, key)?.value;
    const classification = field("classification");
    const line = hostedBootstrapDiagnosticLine({ stage,
      classification: classification === "guard-refused" || classification === "invalid-response"
        ? "setup-refused" : classification,
      exitCode: field("exitCode"), signal: field("signal"), cleanup });
    if (line) emit(line);
  } catch { /* Original error remains. */ }
}
export function createHostedBootstrapDiagnostics() {
  const records: HostedBootstrapDiagnostic[] = [];
  let pending: number[] = [], dropping = false, closed = false;
  return {
    push(chunk: Uint8Array) {
      if (closed) return;
      for (const byte of chunk) {
        if (byte === 10) {
          if (!dropping && records.length < 16) {
            const line = Buffer.from(pending).toString("ascii");
            if (line.startsWith(HOSTED_BOOTSTRAP_PREFIX)) try {
              const parsed = schema.safeParse(JSON.parse(line.slice(HOSTED_BOOTSTRAP_PREFIX.length)));
              if (parsed.success) records.push(parsed.data);
            } catch { /* Unknown output is discarded. */ }
          }
          pending = []; dropping = false;
        } else if (!dropping) {
          if (byte > 127 || pending.length >= 512) { pending = []; dropping = true; }
          else pending.push(byte);
        }
      }
    },
    finish() { pending = []; dropping = true; closed = true; return structuredClone(records); },
  };
}
