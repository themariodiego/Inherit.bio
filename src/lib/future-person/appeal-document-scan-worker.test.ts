import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encryptSecret } from "@/lib/crypto";
import { sealDocumentBytes } from "./document-envelope";
import { scanNextAppealDocument } from "./appeal-document-scan-worker";
import type { ScanVerdict } from "@/lib/scan/malware-scanner";
const digest = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64")));
afterEach(() => vi.unstubAllEnvs());
function fixture() {
 const key = crypto.randomBytes(32), bytes = Buffer.from("%PDF-1.4\nSynthetic appeal evidence only.\n");
 const objectKey = "synthetic-case/synthetic-document/sealed";
 const row = { documentId: "44444444-4444-4444-8444-444444444441", objectKey, sha256: digest(bytes), byteCount: bytes.length,
  mediaType: "application/pdf", wrappedDataKey: encryptSecret(key.toString("base64")).toString("hex") };
 const sealed = sealDocumentBytes(key, objectKey, bytes); key.fill(0);bytes.fill(0);
 const rpc = vi.fn(async (name: string) => name === "claim_next_appeal_document_scan_v1"
  ? { data: row, error: null } : { data: name === "record_appeal_document_scan_v1" ? "clean" : null, error: null });
 const store = { create: vi.fn(), read: vi.fn(async () => new Uint8Array(sealed)), remove: vi.fn(async () => {}) };
 let scanned: Uint8Array | null = null;
 const scan = vi.fn(async (plain: Uint8Array): Promise<ScanVerdict> => {
  scanned = plain;return { verdict: "OK", sha256: digest(plain), signatures: { engine: "synthetic-no-provider-proof", version: 1, publishedAt: new Date() } };
 });
 return { row, sealed, rpc, store, scanner: { scan }, scanned: () => scanned };
}
describe("appeal evidence scanner native door", () => {
 it("binds a complete opened object and positive verdict to the appeal-only native lease, then clears plaintext", async () => {
  const f = fixture();expect(await scanNextAppealDocument(f)).toBe("clean");
  expect(f.store.read).toHaveBeenCalledWith(f.row.objectKey);expect(f.scanner.scan).toHaveBeenCalledOnce();
  expect(f.rpc).toHaveBeenLastCalledWith("record_appeal_document_scan_v1", expect.objectContaining({
   p_document_id: f.row.documentId, p_outcome: "OK", p_scanned_sha256: f.row.sha256, p_scan_engine: "synthetic-no-provider-proof",
  }));
  expect(f.scanned()!.every(byte => byte === 0)).toBe(true);expect(f.store.remove).not.toHaveBeenCalled();
 });
 it("refuses a truncated envelope without invoking the scanner", async () => {
  const f = fixture();f.store.read.mockResolvedValue(new Uint8Array(f.sealed.subarray(0, -1)));
  f.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_next_appeal_document_scan_v1" ? f.row : "delete", error: null }));
  expect(await scanNextAppealDocument(f)).toBe("refused");expect(f.scanner.scan).not.toHaveBeenCalled();
  expect(f.store.remove).toHaveBeenCalledWith([f.row.objectKey]);
  expect(f.rpc).toHaveBeenLastCalledWith("confirm_appeal_document_objects_deleted_v1", { p_object_keys: [f.row.objectKey], p_route_id: "jobs.claim-document-scan" });
 });
 it("keeps a whole-object hash mismatch refused and never calls the scanner", async () => {
  const f = fixture();f.row.sha256 = "0".repeat(64);
  f.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_next_appeal_document_scan_v1" ? f.row : "delete", error: null }));
  expect(await scanNextAppealDocument(f)).toBe("refused");expect(f.scanner.scan).not.toHaveBeenCalled();
 });
 it("does not turn an unavailable scanner into a clean native record", async () => {
  const f = fixture();f.scanner.scan.mockResolvedValue({ verdict: "UNAVAILABLE", reason: "stale-signatures" });
  f.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_next_appeal_document_scan_v1" ? f.row : "retry", error: null }));
  expect(await scanNextAppealDocument(f)).toBe("retry");expect(f.store.remove).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenLastCalledWith("record_appeal_document_scan_v1", expect.objectContaining({ p_outcome: "UNAVAILABLE", p_scanned_sha256: null }));
  expect(f.scanned()).toBeNull();
 });
 it("retains physical cleanup as pending when object removal fails, without a false native ACK", async () => {
  const f = fixture();f.scanner.scan.mockResolvedValue({ verdict: "FOUND", sha256: f.row.sha256,
   signatures: { engine: "synthetic-no-provider-proof", version: 1, publishedAt: new Date() } });
  f.rpc.mockImplementation(async (name: string) => ({ data: name === "claim_next_appeal_document_scan_v1" ? f.row : "delete", error: null }));
  f.store.remove.mockRejectedValue(new Error("synthetic store unavailable"));
  expect(await scanNextAppealDocument(f)).toBe("refused");
  expect(f.rpc.mock.calls.map(([name]) => name)).not.toContain("confirm_appeal_document_objects_deleted_v1");
  expect(f.scanned()).toBeNull();
 });
});
