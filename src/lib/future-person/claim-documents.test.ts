import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const { encryptSecret } = await import("@/lib/crypto");
const { claimDataKey, openDocumentBytes, sealDocumentBytes } = await import("./document-envelope");
const { sniffDocumentType } = await import("./document-sniff");
const { composeClaimDocument } = await import("./document-compose");
const { scanNextClaimDocument, runClaimDocumentScanLoop } = await import("./document-scan-worker");
const { EICAR_TEST_STRING, testDoubleScanner } = await import("@/lib/scan/test-double-scanner");
type ClaimObjectStore = import("./claim-objects").ClaimObjectStore;
type MalwareScanner = import("@/lib/scan/malware-scanner").MalwareScanner;

afterAll(() => vi.unstubAllEnvs());

const sha = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
const INTAKE = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const key = (name: string) => `${INTAKE}/${DOCUMENT}/${name}`;
const FINAL = key("33333333-3333-4333-8333-333333333333");

function newDataKey() {
  const raw = crypto.randomBytes(32);
  return { raw, wrappedHex: encryptSecret(raw.toString("base64")).toString("hex") };
}

/** An in-memory, create-only bucket. */
function memoryStore(): ClaimObjectStore & { objects: Map<string, Uint8Array>; failCreate?: boolean; failRemove?: boolean } {
  const objects = new Map<string, Uint8Array>();
  const store = {
    objects,
    failCreate: false,
    failRemove: false,
    async create(objectKey: string, sealed: Uint8Array) {
      if (store.failCreate || objects.has(objectKey)) throw new Error("create");
      objects.set(objectKey, new Uint8Array(sealed));
    },
    async read(objectKey: string) {
      const value = objects.get(objectKey);
      if (!value) throw new Error("read");
      return new Uint8Array(value);
    },
    async remove(keys: readonly string[]) {
      if (store.failRemove) throw new Error("remove");
      for (const k of keys) objects.delete(k);
    },
  };
  return store;
}

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(9_000)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(100)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(100)]);

describe("the document envelope", () => {
  it("opens only under the same independent document key and the same object key", () => {
    const { raw, wrappedHex } = newDataKey();
    const unwrapped = claimDataKey(wrappedHex);
    expect(unwrapped.equals(raw)).toBe(true);
    const sealed = sealDocumentBytes(unwrapped, key("a"), PDF);
    expect(sealed.includes(PDF.subarray(0, 64))).toBe(false);
    expect(openDocumentBytes(unwrapped, key("a"), sealed)?.equals(PDF)).toBe(true);
    expect(openDocumentBytes(unwrapped, key("b"), sealed), "moved to another key").toBeNull();
    expect(openDocumentBytes(crypto.randomBytes(32), key("a"), sealed), "another document's key").toBeNull();
    const identity = newDataKey();
    const sibling = newDataKey();
    expect(openDocumentBytes(identity.raw, key("a"), sealed), "intake identity key").toBeNull();
    expect(openDocumentBytes(sibling.raw, key("a"), sealed), "same claim's other document key").toBeNull();
    identity.raw.fill(0);sibling.raw.fill(0);
    const tampered = Buffer.from(sealed);
    tampered[40] = tampered[40]! ^ 1;
    expect(openDocumentBytes(unwrapped, key("a"), tampered), "altered").toBeNull();
  });

  it("refuses a wrapped key that is not one", () => {
    expect(() => claimDataKey("zz")).toThrow();
    expect(() => claimDataKey(encryptSecret("short").toString("hex"))).toThrow("claim_key_invalid");
  });
});

describe("the type sniff", () => {
  it.each([[PDF, "application/pdf"], [PNG, "image/png"], [JPEG, "image/jpeg"]] as const)(
    "reads the type from the bytes",
    (bytes, type) => {
      expect(sniffDocumentType(bytes)).toBe(type);
    },
  );

  it.each([Buffer.from("GIF89a"), Buffer.from("<html>"), Buffer.from("%PD"), Buffer.alloc(0)])(
    "allows nothing else",
    (bytes) => {
      expect(sniffDocumentType(bytes)).toBeNull();
    },
  );
});

describe("composing a document", () => {
  function planFor(bytes: Buffer, mediaType: "application/pdf" | "image/png" | "image/jpeg", store: ReturnType<typeof memoryStore>) {
    const { raw, wrappedHex } = newDataKey();
    const cuts = [0, Math.floor(bytes.length / 2), bytes.length];
    const fragments = [0, 1].map((sequence) => {
      const part = bytes.subarray(cuts[sequence], cuts[sequence + 1]);
      const objectKey = key(`fragment-${sequence}`);
      store.objects.set(objectKey, sealDocumentBytes(raw, objectKey, part));
      return { sequence, objectKey, byteCount: part.length, sha256: sha(part) };
    });
    return {
      status: "compose" as const, documentId: DOCUMENT, documentKind: "future-birth-record" as const, mediaType,
      sizeBytes: bytes.length, sha256: sha(bytes), objectKey: FINAL, wrappedDataKey: wrappedHex, fragments, raw,
    };
  }

  it("writes one sealed object with exactly the declared bytes", async () => {
    const store = memoryStore();
    const { raw, ...plan } = planFor(PDF, "application/pdf", store);
    expect(await composeClaimDocument(plan, store)).toBe("composed");
    expect(openDocumentBytes(raw, FINAL, store.objects.get(FINAL)!)?.equals(PDF)).toBe(true);
  });

  it("refuses a declared SHA-256 the bytes do not have", async () => {
    const store = memoryStore();
    const plan = planFor(PDF, "application/pdf", store);
    expect(await composeClaimDocument({ ...plan, sha256: sha(Buffer.from("other")) }, store)).toBe("integrity");
    expect(store.objects.has(FINAL)).toBe(false);
  });

  it("refuses a fragment altered after it arrived", async () => {
    const store = memoryStore();
    const plan = planFor(PDF, "application/pdf", store);
    const sealed = Buffer.from(store.objects.get(plan.fragments[1]!.objectKey)!);
    sealed[sealed.length - 1] = sealed[sealed.length - 1]! ^ 1;
    store.objects.set(plan.fragments[1]!.objectKey, sealed);
    expect(await composeClaimDocument(plan, store)).toBe("integrity");
  });

  it("refuses bytes that are not the declared type", async () => {
    const store = memoryStore();
    const plan = planFor(PNG, "application/pdf", store);
    expect(await composeClaimDocument(plan, store)).toBe("type");
    expect(store.objects.has(FINAL)).toBe(false);
  });

  it("reports storage when a fragment is missing or the object cannot be written", async () => {
    const store = memoryStore();
    const plan = planFor(JPEG, "image/jpeg", store);
    store.failCreate = true;
    expect(await composeClaimDocument(plan, store)).toBe("storage");
    store.failCreate = false;
    store.objects.delete(plan.fragments[0]!.objectKey);
    expect(await composeClaimDocument(plan, store)).toBe("storage");
  });
});

describe("the scan worker", () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let store: ReturnType<typeof memoryStore>;
  let recordAnswer: (args: Record<string, unknown>) => { data: unknown; error: { code?: string } | null };

  function queue(bytes: Buffer, overrides: Partial<{ sha256: string; byteCount: number }> = {}) {
    const { raw, wrappedHex } = newDataKey();
    store.objects.set(FINAL, sealDocumentBytes(raw, FINAL, bytes));
    return {
      documentId: DOCUMENT, objectKey: FINAL, sha256: overrides.sha256 ?? sha(bytes),
      byteCount: overrides.byteCount ?? bytes.length, mediaType: "application/pdf", wrappedDataKey: wrappedHex,
    };
  }

  function rpcFor(job: unknown) {
    return async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_next_claim_document_scan_v1") return { data: job, error: null };
      if (name === "record_claim_document_scan_v1") return recordAnswer(args);
      return { data: 1, error: null };
    };
  }

  beforeEach(() => {
    calls.length = 0;
    store = memoryStore();
    recordAnswer = (args) => ({
      data: args.p_outcome === "OK" ? "clean" : args.p_outcome === "UNAVAILABLE" ? "retry" : "delete", error: null,
    });
  });

  const recorded = () => calls.filter((call) => call.name === "record_claim_document_scan_v1").map((call) => call.args);

  it("is idle when nothing is quarantined", async () => {
    expect(await scanNextClaimDocument({ rpc: rpcFor(null), store, scanner: testDoubleScanner() })).toBe("idle");
    expect(recorded()).toEqual([]);
  });

  it("records OK with the SHA-256 the scanner computed over the bytes, and its signatures", async () => {
    const job = queue(PDF);
    expect(await scanNextClaimDocument({ rpc: rpcFor(job), store, scanner: testDoubleScanner(() => 1_800_000_000_000) }))
      .toBe("clean");
    const lease = calls[0]!.args.p_lease_hash;
    expect(lease).toMatch(/^[0-9a-f]{64}$/u);
    expect(recorded()).toEqual([{
      p_document_id: DOCUMENT, p_lease_hash: lease, p_outcome: "OK", p_scanned_sha256: sha(PDF),
      p_scan_engine: "test-double", p_signature_version: 1, p_signature_at: new Date(1_800_000_000_000).toISOString(),
    }]);
    expect(store.objects.has(FINAL), "a clean document is kept").toBe(true);
  });

  it("refuses the EICAR test file, deletes its object and confirms the deletion", async () => {
    const infected = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(EICAR_TEST_STRING, "ascii")]);
    const job = queue(infected);
    expect(await scanNextClaimDocument({ rpc: rpcFor(job), store, scanner: testDoubleScanner() })).toBe("refused");
    expect(recorded().map((args) => args.p_outcome)).toEqual(["FOUND"]);
    expect(store.objects.has(FINAL)).toBe(false);
    expect(calls.at(-1)).toEqual({ name: "confirm_claim_document_objects_deleted_v1",
      args: { p_object_keys: [FINAL], p_route_id: "jobs.claim-document-scan" } });
  });

  it("never records OK for bytes other than the document's", async () => {
    const job = queue(PDF, { sha256: sha(Buffer.from("something else")) });
    const scan = vi.fn();
    expect(await scanNextClaimDocument({ rpc: rpcFor(job), store, scanner: { scan } })).toBe("refused");
    expect(scan).not.toHaveBeenCalled();
    expect(recorded().map((args) => args.p_outcome)).toEqual(["UNSCANNABLE"]);
  });

  it("refuses an object that will not open under the document key", async () => {
    const job = queue(PDF);
    store.objects.set(FINAL, crypto.randomBytes(PDF.length + 28));
    expect(await scanNextClaimDocument({ rpc: rpcFor(job), store, scanner: testDoubleScanner() })).toBe("refused");
    expect(recorded().map((args) => args.p_outcome)).toEqual(["UNSCANNABLE"]);
  });

  it("refuses an object larger than its document as oversize without scanning it", async () => {
    const job = queue(PDF, { byteCount: 100 });
    const scan = vi.fn();
    expect(await scanNextClaimDocument({ rpc: rpcFor(job), store, scanner: { scan } })).toBe("refused");
    expect(scan).not.toHaveBeenCalled();
    expect(recorded().map((args) => args.p_outcome)).toEqual(["OVERSIZE"]);
  });

  it.each(["unreachable", "stale-signatures", "protocol", "timeout"] as const)(
    "decides nothing when the scanner is %s",
    async (reason) => {
      const job = queue(PDF);
      const scanner: MalwareScanner = { scan: async () => ({ verdict: "UNAVAILABLE", reason }) };
      expect(await scanNextClaimDocument({ rpc: rpcFor(job), store, scanner })).toBe("retry");
      expect(recorded().map((args) => args.p_outcome)).toEqual(["UNAVAILABLE"]);
      expect(recorded()[0]!.p_scanned_sha256).toBeNull();
      expect(store.objects.has(FINAL)).toBe(true);
    },
  );

  it("releases the document when the database refuses an OK (stale or mismatched)", async () => {
    const job = queue(PDF);
    recordAnswer = (args) => args.p_outcome === "OK"
      ? { data: null, error: { code: "22023" } }
      : { data: "retry", error: null };
    expect(await scanNextClaimDocument({ rpc: rpcFor(job), store, scanner: testDoubleScanner() })).toBe("retry");
    expect(recorded().map((args) => args.p_outcome)).toEqual(["OK", "UNAVAILABLE"]);
  });

  it("leaves a failed delete for the retention job, the document already refused", async () => {
    const job = queue(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(EICAR_TEST_STRING, "ascii")]));
    store.failRemove = true;
    expect(await scanNextClaimDocument({ rpc: rpcFor(job), store, scanner: testDoubleScanner() })).toBe("refused");
    expect(calls.some((call) => call.name === "confirm_claim_document_objects_deleted_v1")).toBe(false);
  });

  it("runs passes until told to stop, emitting only coded outcomes", async () => {
    const events: string[] = [];
    const result = await runClaimDocumentScanLoop({
      rpc: rpcFor(null), store, scanner: testDoubleScanner(), maximumIterations: 2, idleMs: 1, emit: (event) => events.push(event),
    });
    expect(result).toEqual({ hadFailure: false });
    expect(events).toEqual(["claim_document_scan_idle", "claim_document_scan_idle"]);
  });
});
