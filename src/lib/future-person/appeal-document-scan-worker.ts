import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import type { MalwareScanner } from "@/lib/scan/malware-scanner";
import type { ClaimObjectStore } from "./claim-objects";
import { ENVELOPE_OVERHEAD, claimDataKey, openDocumentBytes } from "./document-envelope";

/**
 * One pass of the claim document scan worker (jobs.claim-document-scan).
 *
 * It leases the oldest quarantined document, reads its sealed object, opens
 * it under the claim key, checks the plaintext is exactly the recorded size
 * and SHA-256, and hands those bytes to the scanner. The verdict goes back to
 * the database with the SHA-256 the scanner computed over what it scanned;
 * the database marks the document clean only for a literal OK bound to the
 * document's own SHA-256 under fresh signatures.
 *
 * - Infected, oversize, or bytes that cannot be opened or do not match: the
 *   database refuses the document at once (it is unreadable from that
 *   moment), then this deletes the object and confirms, and the ledger
 *   records why. If the delete fails, the retention job finishes it.
 * - The scanner down or its signatures stale: nothing is decided. The lease
 *   is released and the document is tried again, until the last attempt
 *   refuses it as unscannable. A fault never reads as clean.
 *
 * Only coded outcomes are returned; no key, byte, hash or signature name.
 */

export type ScanPassOutcome = "idle" | "clean" | "refused" | "retry" | "failed";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;

const job = z.object({
  documentId: z.uuid(),
  objectKey: z.string().min(1).max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  byteCount: z.number().int().min(1).max(20_000_000),
  mediaType: z.string(),
  wrappedDataKey: z.string().regex(/^[0-9a-f]+$/u),
}).strict();

export interface ScanPassDependencies {
  rpc: Rpc;
  store: ClaimObjectStore;
  scanner: MalwareScanner;
  signal?: AbortSignal;
}

export async function scanNextAppealDocument(deps: ScanPassDependencies): Promise<ScanPassOutcome> {
  const lease = crypto.randomBytes(32).toString("hex");
  const leaseHash = crypto.createHash("sha256").update(lease).digest("hex");
  const claimed = await deps.rpc("claim_next_appeal_document_scan_v1", { p_lease_hash: leaseHash });
  if (claimed.error) return "failed";
  if (claimed.data === null) return "idle";
  const parsed = job.safeParse(claimed.data);
  if (!parsed.success) return "failed";
  const document = parsed.data;

  const record = async (outcome: string, verdict?: { sha256: string; engine: string; version: number; publishedAt: Date }) =>
    deps.rpc("record_appeal_document_scan_v1", {
      p_document_id: document.documentId,
      p_lease_hash: leaseHash,
      p_outcome: outcome,
      p_scanned_sha256: verdict?.sha256 ?? null,
      p_scan_engine: verdict?.engine ?? null,
      p_signature_version: verdict?.version ?? null,
      p_signature_at: verdict?.publishedAt.toISOString() ?? null,
    });

  const refuse = async (outcome: "FOUND" | "OVERSIZE" | "UNSCANNABLE"): Promise<ScanPassOutcome> => {
    const recorded = await record(outcome);
    if (recorded.error || recorded.data !== "delete") return "failed";
    try {
      await deps.store.remove([document.objectKey]);
      await deps.rpc("confirm_appeal_document_objects_deleted_v1", {
        p_object_keys: [document.objectKey], p_route_id: "jobs.claim-document-scan",
      });
    } catch {
      // The document is already refused and unreadable; jobs.retention deletes it.
    }
    return "refused";
  };

  const unavailable = async (): Promise<ScanPassOutcome> => {
    const recorded = await record("UNAVAILABLE");
    if (recorded.error) return "failed";
    if (recorded.data === "delete") {
      try {
        await deps.store.remove([document.objectKey]);
        await deps.rpc("confirm_appeal_document_objects_deleted_v1", {
          p_object_keys: [document.objectKey], p_route_id: "jobs.claim-document-scan",
        });
      } catch {
        // Left for jobs.retention.
      }
      return "refused";
    }
    return "retry";
  };

  let sealed: Uint8Array;
  try {
    sealed = await deps.store.read(document.objectKey);
  } catch {
    return unavailable();
  }
  if (sealed.length > document.byteCount + ENVELOPE_OVERHEAD) return refuse("OVERSIZE");

  let key: Buffer;
  try {
    key = claimDataKey(document.wrappedDataKey);
  } catch {
    return refuse("UNSCANNABLE");
  }
  const bytes = openDocumentBytes(key, document.objectKey, sealed);
  key.fill(0);
  try {
    if (!bytes || bytes.length !== document.byteCount
      || crypto.createHash("sha256").update(bytes).digest("hex") !== document.sha256) {
      return await refuse("UNSCANNABLE");
    }
    const verdict = await deps.scanner.scan(bytes, deps.signal);
    switch (verdict.verdict) {
      case "OK": {
        const recorded = await record("OK", { sha256: verdict.sha256, ...verdict.signatures });
        if (!recorded.error && recorded.data === "clean") return "clean";
        // The database refused the OK (another SHA-256, stale signatures): decide nothing.
        return recorded.error?.code === "22023" ? await unavailable() : "failed";
      }
      case "FOUND":
        return await refuse("FOUND");
      case "OVERSIZE":
        return await refuse("OVERSIZE");
      default:
        return await unavailable();
    }
  } finally {
    bytes?.fill(0);
  }
}

export interface ScanLoopOptions extends ScanPassDependencies {
  emit?: (event: string) => void;
  maximumIterations?: number;
  idleMs?: number;
}

/** Scan until aborted (or for `maximumIterations` passes), waiting while idle or after a failure. */
export async function runAppealDocumentScanLoop(options: ScanLoopOptions): Promise<{ hadFailure: boolean }> {
  let hadFailure = false;
  const idleMs = options.idleMs ?? 5000;
  for (let pass = 0; options.maximumIterations === undefined || pass < options.maximumIterations; pass++) {
    if (options.signal?.aborted) break;
    let outcome: ScanPassOutcome;
    try {
      outcome = await scanNextAppealDocument(options);
    } catch {
      outcome = "failed";
    }
    if (outcome === "failed") hadFailure = true;
    options.emit?.(`appeal_document_scan_${outcome}`);
    if (outcome === "idle" || outcome === "failed" || outcome === "retry") {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, idleMs);
        options.signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  }
  return { hadFailure };
}
