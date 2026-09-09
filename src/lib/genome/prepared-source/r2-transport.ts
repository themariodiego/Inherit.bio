import "server-only";
import { z } from "zod";
import { preparedObjectKeySchema } from "./storage-common";
import { mintPreparedObjectCapability } from "@/lib/uploads/storage-upload-token";
import { preparedArtifactReceiptSchema, preparedStoredArtifactSchema, type PreparedArtifactReceipt,
  type PreparedStoredArtifact } from "./artifact-identity";

function config(bucket: string): string {
  const url = new URL(process.env.INHERIT_PREPARED_R2_ORIGIN ?? "");
  if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash
    || bucket !== process.env.INHERIT_PREPARED_R2_BUCKET) throw new Error("unavailable");
  return url.origin;
}

const cleanupLocatorSchema = z.object({ provider: z.literal("r2"),
  bucket: z.string().regex(/^inherit-prepared-[a-z0-9-]{1,40}$/), objectKey: preparedObjectKeySchema,
  byteCount: z.number().int().min(1).max(8388608), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  providerVersion: z.string().regex(/^[0-9a-f]{32}$/).nullable(), etag: z.string().regex(/^[0-9a-f]{32}$/).nullable(),
}).strict();
const tombstoneSchema = z.object({ disposition: z.literal("payload-tombstoned"),
  providerVersion: z.string().regex(/^[0-9a-f]{32}$/), etag: z.literal("d41d8cd98f00b204e9800998ecf8427e"),
  byteCount: z.literal(0), sha256: z.literal("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
}).strict();

/** Only an irrevocable cleanup disposition may supply this exact registered
 * locator. The gateway completes PUT + independent exact-version GET/EOF.
 * Markers are permanent: this does not claim key absence or physical erasure. */
export async function tombstonePreparedR2(rawLocator: unknown, deadline: string, external: AbortSignal) {
  const locator = cleanupLocatorSchema.parse(rawLocator), origin = config(locator.bucket);
  const expiresAt = z.iso.datetime({ offset: true }).parse(deadline);
  const signal = AbortSignal.any([external, AbortSignal.timeout(30_000)]);
  const token = mintPreparedObjectCapability({ operation: "tombstone", bucket: locator.bucket,
    objectKey: locator.objectKey, byteCount: locator.byteCount, sha256: locator.sha256, expiresAt });
  const response = await fetch(`${origin}/artifact`, { method: "PUT", signal, cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity" } });
  if (response.status !== 200 || !response.body) { void response.body?.cancel(); throw new Error("unavailable"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length; if (size > 4096) throw new Error("integrity_mismatch"); chunks.push(next.value);
    }
    return tombstoneSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Single operation. Current authority is checked by writer/reader/cleanup
 * immediately around this call. Capabilities stay in server memory only. */
export function fetchPreparedR2(input: {
  receipt: PreparedArtifactReceipt; operation: "put" | "get" | "tombstone";
  stored?: PreparedStoredArtifact; bytes?: Uint8Array; start?: number; end?: number;
  expiresAt?: string; signal: AbortSignal;
}): Promise<Response> {
  const receipt = preparedArtifactReceiptSchema.parse(input.receipt);
  if (receipt.version !== "own-preparation-artifact-v2") throw new Error("invalid_artifact");
  const origin = config(receipt.bucket);
  const stored = input.stored && preparedStoredArtifactSchema.parse(input.stored);
  if (input.operation === "get" && (!stored || "storageObjectId" in stored
    || JSON.stringify(stored.receipt) !== JSON.stringify(receipt))) throw new Error("invalid_artifact");
  const expiresAt = input.operation === "put" ? receipt.writeExpiresAt
    : input.expiresAt ?? new Date(Date.now() + 30_000).toISOString();
  const token = mintPreparedObjectCapability({ operation: input.operation,
    bucket: receipt.bucket, objectKey: receipt.objectKey, byteCount: receipt.byteCount,
    sha256: receipt.sha256, expiresAt,
    ...(stored && !("storageObjectId" in stored) ? { providerVersion: stored.providerVersion, etag: stored.etag } : {}),
    ...(input.start !== undefined ? { start: input.start, end: input.end } : {}),
  });
  return fetch(`${origin}/artifact`, { method: input.operation === "get" ? "GET" : "PUT",
    signal: input.signal, cache: "no-store", redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity",
      ...(input.operation === "put" ? { "Content-Type": "application/octet-stream", "Content-Length": String(receipt.byteCount) } : {}) },
    ...(input.operation === "put" ? { body: input.bytes as BodyInit } : {}),
  });
}
