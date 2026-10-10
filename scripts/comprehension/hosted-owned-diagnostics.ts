/** Closed bootstrap metadata only. No command, key, identifier or output is
 * admitted. These records supplement failure; they cannot authorize recovery. */
import { z } from "zod";

export const HOSTED_BOOTSTRAP_PREFIX = "OWNED_BOOTSTRAP_FAILURE_V1|";
const stages = ["host-admission", "source-attestation", "source-copy", "migration-copy",
  "native-start", "native-inventory", "native-ledger", "native-keys", "bootstrap-keys",
  "production-build", "bootstrap-cleanup"] as const;
const schema = z.object({ stage: z.enum(stages),
  classification: z.enum(["spawn-refused", "exit-nonzero", "signal", "timeout", "output-limit", "setup-refused"]),
  exitCode: z.number().int().min(0).max(255).nullable(),
  signal: z.enum(["SIGABRT", "SIGALRM", "SIGBUS", "SIGHUP", "SIGINT", "SIGKILL", "SIGPIPE",
    "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGXCPU", "SIGXFSZ"]).nullable(),
  cleanup: z.enum(["not-started", "retained", "unreturned", "uncertain"]),
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
  cleanup: HostedBootstrapDiagnostic["cleanup"], emit = (line: string) => { process.stderr.write(line + "\n"); }) {
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
