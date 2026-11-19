import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encryptSecret } from "@/lib/crypto";
import { sealDocumentBytes } from "./document-envelope";
import { runPermissionDocumentScanLoop, scanNextPermissionDocument } from "./appeal-document-scan-worker";
import type { ScanVerdict } from "@/lib/scan/malware-scanner";

const digest = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64")));
afterEach(() => vi.unstubAllEnvs());

function fixture() {
 const key = crypto.randomBytes(32), bytes = Buffer.from("%PDF-1.4\nSynthetic signed permission only.\n");
 const objectKey = "permission/synthetic-subject/synthetic-document/sealed";
 const row = { documentId: "55555555-5555-4555-8555-555555555551", objectKey, sha256: digest(bytes), byteCount: bytes.length,
  mediaType: "application/pdf", wrappedDataKey: encryptSecret(key.toString("base64")).toString("hex") };
 const sealed = sealDocumentBytes(key, objectKey, bytes); key.fill(0); bytes.fill(0);
 const rpc = vi.fn(async (name: string): Promise<{ data: unknown; error: { code?: string } | null }> =>
  name === "claim_next_permission_document_scan_v1" ? { data: row, error: null }
   : { data: name === "record_permission_document_scan_v1" ? "clean" : null, error: null });
 const store = { create: vi.fn(), read: vi.fn(async () => new Uint8Array(sealed)), remove: vi.fn(async () => {}) };
 let scanned: Uint8Array | null = null;
 const scan = vi.fn(async (plain: Uint8Array): Promise<ScanVerdict> => {
  scanned = plain;
  return { verdict: "OK", sha256: digest(plain), signatures: { engine: "synthetic-no-provider-proof", version: 1, publishedAt: new Date() } };
 });
 return { row, sealed, rpc, store, scanner: { scan }, scanned: () => scanned };
}

describe("signed-permission document scanner", () => {
 it("uses only the permission ledger and records a bound positive verdict, then clears plaintext", async () => {
  const f = fixture();
  expect(await scanNextPermissionDocument(f)).toBe("clean");
  const names = f.rpc.mock.calls.map(([name]) => name);
  expect(names).toEqual(["claim_next_permission_document_scan_v1", "record_permission_document_scan_v1"]);
  expect(names.some((name) => name.includes("appeal"))).toBe(false);
  expect(f.rpc).toHaveBeenLastCalledWith("record_permission_document_scan_v1", expect.objectContaining({
   p_document_id: f.row.documentId, p_outcome: "OK", p_scanned_sha256: f.row.sha256,
  }));
  expect(f.scanned()!.every((byte) => byte === 0)).toBe(true);
  expect(f.store.remove).not.toHaveBeenCalled();
 });

 it("refuses infected bytes, deletes the object and confirms on the permission ledger", async () => {
  const f = fixture();
  f.scanner.scan.mockResolvedValue({ verdict: "FOUND", sha256: f.row.sha256,
   signatures: { engine: "synthetic-no-provider-proof", version: 1, publishedAt: new Date() } });
  f.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_next_permission_document_scan_v1" ? f.row : "delete", error: null }));
  expect(await scanNextPermissionDocument(f)).toBe("refused");
  expect(f.store.remove).toHaveBeenCalledWith([f.row.objectKey]);
  expect(f.rpc).toHaveBeenLastCalledWith("confirm_permission_document_objects_deleted_v1",
   { p_object_keys: [f.row.objectKey], p_route_id: "jobs.claim-document-scan" });
 });

 it("never reads an unavailable scanner as clean", async () => {
  const f = fixture();
  f.scanner.scan.mockResolvedValue({ verdict: "UNAVAILABLE", reason: "stale-signatures" });
  f.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_next_permission_document_scan_v1" ? f.row : "retry", error: null }));
  expect(await scanNextPermissionDocument(f)).toBe("retry");
  expect(f.rpc).toHaveBeenLastCalledWith("record_permission_document_scan_v1",
   expect.objectContaining({ p_outcome: "UNAVAILABLE", p_scanned_sha256: null }));
  expect(f.store.remove).not.toHaveBeenCalled();
 });

 it("refuses a whole-object hash mismatch without calling the scanner", async () => {
  const f = fixture(); f.row.sha256 = "0".repeat(64);
  f.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_next_permission_document_scan_v1" ? f.row : "delete", error: null }));
  expect(await scanNextPermissionDocument(f)).toBe("refused");
  expect(f.scanner.scan).not.toHaveBeenCalled();
 });

 it("emits permission events from the loop and reports idle", async () => {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const events: string[] = [];
  const result = await runPermissionDocumentScanLoop({
   rpc, store: { create: vi.fn(), read: vi.fn(), remove: vi.fn() }, scanner: { scan: vi.fn() },
   maximumIterations: 1, idleMs: 0, emit: (event) => events.push(event),
  });
  expect(events).toEqual(["permission_document_scan_idle"]);
  expect(result.hadFailure).toBe(false);
 });
});
