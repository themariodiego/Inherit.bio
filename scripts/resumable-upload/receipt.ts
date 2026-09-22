import { z } from "zod";
import { DECLARED_BYTES, PREVIEW_PROJECT } from "./contract";

export const stages = ["issuance", "create-empty", "head-live-grant", "head-no-bearer",
  "head-anonymous-bearer", "terminate-empty-live-grant", "head-after-termination"] as const;
export type ProbeStage = (typeof stages)[number];
const safeHeaders = z.object({
  status: z.number().int().min(100).max(599),
  offset: z.number().int().nonnegative().safe().nullable(),
  length: z.number().int().nonnegative().safe().nullable(),
  tusVersion: z.literal("1.0.0").nullable(),
}).strict();
export type SafeHeaders = z.infer<typeof safeHeaders>;
export const receiptSchema = z.object({
  schemaVersion: z.literal(1), previewProject: z.literal(PREVIEW_PROJECT),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
  declaredBytes: z.literal(DECLARED_BYTES), sourceBytesSent: z.literal(0), patchRequests: z.literal(0),
  issuedUploadId: z.uuid().regex(/^[0-9a-f-]+$/).nullable(),
  appIssuanceRequests: z.number().int().min(0).max(1), providerRequests: z.number().int().min(0).max(6),
  events: z.array(z.object({ stage: z.enum(stages), at: z.iso.datetime(), response: safeHeaders }).strict()).max(7),
  conclusion: z.enum(["running", "probe-stopped", "offset-readable-without-upload-authority", "no-offset-read-demonstrated"]),
  cleanup: z.enum(["not-created", "creation-outcome-uncertain", "unconfirmed", "protocol-termination-acknowledged"]),
  failurePhase: z.enum(stages).nullable(),
  physicalFragmentCleanupProven: z.literal(false),
  appIntegrationProven: z.literal(false), capacityProven: z.literal(false),
}).strict();
export type ProbeReceipt = z.infer<typeof receiptSchema>;

function safeInteger(header: string | null): number | null {
  if (header === null || !/^(0|[1-9][0-9]{0,15})$/.test(header)) return null;
  const value = Number(header);
  return Number.isSafeInteger(value) ? value : null;
}

/** Response bodies, Location and arbitrary headers never enter a receipt. */
export function responseReceipt(response: Response): SafeHeaders {
  return safeHeaders.parse({ status: response.status,
    offset: safeInteger(response.headers.get("upload-offset")),
    length: safeInteger(response.headers.get("upload-length")),
    tusVersion: response.headers.get("tus-resumable") === "1.0.0" ? "1.0.0" : null });
}

export function serializeReceipt(receipt: ProbeReceipt): string {
  return JSON.stringify(receiptSchema.parse(receipt), null, 2) + "\n";
}

/** A diagnostic that executed successfully can still expose a failed boundary. */
export function probeExitStatus(receipt: ProbeReceipt): 0 | 1 | 2 {
  if (!receipt.finishedAt || receipt.cleanup !== "protocol-termination-acknowledged"
    || receipt.conclusion === "probe-stopped" || receipt.conclusion === "running") return 1;
  return receipt.conclusion === "offset-readable-without-upload-authority" ? 2 : 0;
}
