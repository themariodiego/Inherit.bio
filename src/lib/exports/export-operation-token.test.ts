import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ExportOperationContext } from "./export-operation-token";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
const { mintExportOperation, verifyExportOperation, EXPORT_OPERATION_LIFETIME_MS, EXPORT_OPERATION_TOKEN_MAX_LENGTH } = await import("./export-operation-token");
const { hmacSecret } = await import("@/lib/crypto");
const { readEmbryoOperation, readPublicFormToken } = await import("@/lib/embryos/operation-token");
afterAll(() => vi.unstubAllEnvs());

const NOW = 1_800_000_000_000;
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CREATE = Object.freeze({
  routeId: "api.export", origin: "authenticated", principalId: ID,
  targetKind: "account", targetId: OTHER, exportContract: "account-export-v1",
  originBinding: "a".repeat(64), authorityReceipt: "b".repeat(64), csrfBinding: "c".repeat(64), operation: "create",
}) satisfies ExportOperationContext;
const READY = Object.freeze({ ...CREATE, operation: "open-ready", exportId: ID, exportRevision: 3 }) satisfies ExportOperationContext;
const validContexts: ExportOperationContext[] = [
  CREATE, READY,
  { ...CREATE, routeId: "api.subject-export", targetKind: "subject", exportContract: "subject-export-v1" },
  { ...CREATE, routeId: "api.subject-export", targetKind: "subject", exportContract: "approved-future-person-export-v1" },
  { ...CREATE, routeId: "api.future-person-export", origin: "independent-rights", targetKind: "subject", exportContract: "approved-future-person-export-v1" },
  { ...CREATE, routeId: "api.third-party-subject-export", origin: "independent-rights", targetKind: "subject", exportContract: "token-target-export-v1" },
  { ...CREATE, routeId: "api.third-party-subject-export", origin: "independent-rights", targetKind: "cohort", exportContract: "token-target-export-v1" },
];
function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
}
function sealText(text: string, domain = "export-operation-v1"): string {
  const payload = Buffer.from(text, "utf8").toString("base64url");
  return `${payload}.${hmacSecret(payload, domain)}`;
}
function seal(value: unknown, domain?: string): string { return sealText(JSON.stringify(value), domain); }
function asContext(value: unknown): ExportOperationContext { return value as ExportOperationContext; }

describe("export operation envelope", () => {
  it.each(validContexts)("binds the exact supported route/origin/scope: $routeId $targetKind $operation $exportContract", (context) => {
    const minted = mintExportOperation(context, NOW);
    const result = verifyExportOperation(minted.token, context, NOW);
    expect(result).toEqual({ ...context, nonceHash: minted.nonceHash, issuedAt: NOW, expiresAt: NOW + 300_000 });
    expect(Object.isFrozen(minted)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(minted.token.length).toBeLessThan(EXPORT_OPERATION_TOKEN_MAX_LENGTH);
    expect(payloadOf(minted.token).nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(minted.nonceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result).not.toHaveProperty("nonce");
    expect(result).not.toHaveProperty("sessionHash");
  });

  it("uses fresh random nonce material, stores only its separately scoped HMAC, and does not mutate a frozen context", () => {
    const first = mintExportOperation(CREATE, NOW), second = mintExportOperation(CREATE, NOW);
    const nonce = payloadOf(first.token).nonce as string;
    expect(first.token).not.toBe(second.token);
    expect(first.nonceHash).not.toBe(second.nonceHash);
    expect(Buffer.from(nonce, "base64url")).toHaveLength(32);
    expect(Buffer.from(nonce, "base64url").toString("base64url")).toBe(nonce);
    expect(first.nonceHash).toBe(hmacSecret(nonce, "export-operation-nonce-v1"));
    expect(first.nonceHash).not.toBe(hmacSecret(nonce, "export-operation-v1"));
    expect(CREATE).not.toHaveProperty("nonce");
  });

  it("requests exactly 32 CSPRNG bytes under the token issuance contract", () => {
    const random = vi.spyOn(crypto, "randomBytes");
    try {
      mintExportOperation(CREATE, NOW);
      expect(random).toHaveBeenCalledExactlyOnceWith(32);
    } finally { random.mockRestore(); }
  });

  it.each([1, 2, 3])("rejects signed nonce pad-bit alias +%s without normalizing it", (padBits) => {
    const claims = payloadOf(mintExportOperation(CREATE, NOW).token);
    const canonical = claims.nonce as string;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const alias = canonical.slice(0, -1) + alphabet[alphabet.indexOf(canonical.at(-1)!) + padBits];
    expect(alias).toHaveLength(43);
    expect(Buffer.from(alias, "base64url")).toEqual(Buffer.from(canonical, "base64url"));
    expect(verifyExportOperation(seal({ ...claims, nonce: alias }), CREATE, NOW)).toBeNull();
  });

  it("requires external atomic consumption: repeated cryptographic verification alone is not single use", () => {
    const minted = mintExportOperation(READY, NOW);
    expect(verifyExportOperation(minted.token, READY, NOW)).toEqual(verifyExportOperation(minted.token, READY, NOW + 1));
  });

  it.each([
    ["principal", { principalId: OTHER }], ["target", { targetId: ID }],
    ["origin/session binding", { originBinding: "d".repeat(64) }],
    ["authority revision", { authorityReceipt: "e".repeat(64) }],
    ["separate CSRF binding", { csrfBinding: "f".repeat(64) }],
  ])("refuses a current expected context with a different %s", (_name, delta) => {
    expect(verifyExportOperation(mintExportOperation(CREATE, NOW).token, { ...CREATE, ...delta }, NOW)).toBeNull();
  });

  it("refuses every cross-route replay even with identical IDs, session binding and current receipt", () => {
    for (const source of validContexts.filter((v) => v.operation === "create")) {
      const minted = mintExportOperation(source, NOW);
      for (const expected of validContexts.filter((v) => v.operation === "create" && v.routeId !== source.routeId)) {
        expect(verifyExportOperation(minted.token, expected, NOW)).toBeNull();
      }
    }
  });

  it("binds operation, exact ready export and ready revision rather than accepting client retargeting", () => {
    const create = mintExportOperation(CREATE, NOW), ready = mintExportOperation(READY, NOW);
    expect(verifyExportOperation(create.token, READY, NOW)).toBeNull();
    expect(verifyExportOperation(ready.token, CREATE, NOW)).toBeNull();
    expect(verifyExportOperation(ready.token, { ...READY, exportId: OTHER }, NOW)).toBeNull();
    expect(verifyExportOperation(ready.token, { ...READY, exportRevision: 4 }, NOW)).toBeNull();
    const alternateScope = validContexts[3];
    expect(verifyExportOperation(mintExportOperation(validContexts[2], NOW).token, alternateScope, NOW)).toBeNull();
  });

  it.each([
    ["reviewer origin", { origin: "reviewer" }], ["unknown origin", { origin: "uploader" }],
    ["account/rights mismatch", { origin: "independent-rights" }],
    ["foreign route", { routeId: "/api/export" }], ["unknown scope", { exportContract: "everything" }],
    ["wrong target kind", { targetKind: "subject" }], ["unknown operation", { operation: "download" }],
    ["injected ready ID on create", { exportId: ID }], ["raw rights credential", { sessionHash: "a".repeat(64) }],
    ["URL target", { targetId: "https://example.invalid/export" }], ["uppercase ID", { principalId: ID.toUpperCase() }],
    ["short receipt", { authorityReceipt: "a".repeat(63) }], ["uppercase digest", { csrfBinding: "A".repeat(64) }],
    ["unknown field", { include: ["all"] }], ["missing field", { originBinding: undefined }],
  ])("refuses malformed trusted context and signed claims: %s", (_name, delta) => {
    const context = asContext({ ...CREATE, ...delta });
    expect(() => mintExportOperation(context, NOW)).toThrow("export_operation_context_invalid");
    expect(verifyExportOperation(mintExportOperation(CREATE, NOW).token, context, NOW)).toBeNull();
    const malformed = { ...payloadOf(mintExportOperation(CREATE, NOW).token), ...delta };
    expect(verifyExportOperation(seal(malformed), CREATE, NOW)).toBeNull();
  });

  it.each(validContexts)("does not authorize reviewer origin for registered $routeId", (context) => {
    expect(() => mintExportOperation({ ...context, origin: "reviewer" }, NOW)).toThrow("export_operation_context_invalid");
  });

  it.each([undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3"])("refuses invalid open-ready revision %s", (exportRevision) => {
    const context = asContext({ ...READY, exportRevision });
    expect(() => mintExportOperation(context, NOW)).toThrow("export_operation_context_invalid");
    expect(verifyExportOperation(seal({ ...payloadOf(mintExportOperation(READY, NOW).token), exportRevision }), READY, NOW)).toBeNull();
  });

  it("refuses a missing ready export ID and rejects rights origins on either authenticated route", () => {
    const missing: Record<string, unknown> = { ...READY };
    delete missing.exportId;
    expect(() => mintExportOperation(asContext(missing), NOW)).toThrow();
    expect(() => mintExportOperation({ ...validContexts[2], origin: "independent-rights" }, NOW)).toThrow();
    expect(() => mintExportOperation({ ...validContexts[4], origin: "authenticated" }, NOW)).toThrow();
  });

  it("accepts exact issue time through one millisecond before expiry, but no future issue or expiry boundary", () => {
    const minted = mintExportOperation(CREATE, NOW);
    expect(EXPORT_OPERATION_LIFETIME_MS).toBe(300_000);
    expect(verifyExportOperation(minted.token, CREATE, NOW - 1)).toBeNull();
    expect(verifyExportOperation(minted.token, CREATE, NOW)).not.toBeNull();
    expect(verifyExportOperation(minted.token, CREATE, NOW + 299_999)).not.toBeNull();
    expect(verifyExportOperation(minted.token, CREATE, NOW + 300_000)).toBeNull();
  });

  it.each([
    { issuedAt: NOW + 1 }, { issuedAt: -1 }, { issuedAt: NOW + 0.5 },
    { issuedAt: String(NOW) }, { expiresAt: NOW + 300_001 }, { expiresAt: NOW + 299_999 },
    { expiresAt: Number.MAX_SAFE_INTEGER + 1 }, { expiresAt: null },
    { version: "export-operation-v2" }, { nonce: "n".repeat(32) }, { nonce: "n".repeat(42) }, { nonce: "n".repeat(44) }, { nonce: " ".repeat(43) },
  ])("refuses signed noncanonical lifetime/version/nonce $issuedAt $expiresAt $version $nonce", (delta) => {
    expect(verifyExportOperation(seal({ ...payloadOf(mintExportOperation(CREATE, NOW).token), ...delta }), CREATE, NOW)).toBeNull();
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER])("refuses invalid mint clocks %s", (now) => {
    expect(() => mintExportOperation(CREATE, now)).toThrow("export_operation_context_invalid");
    expect(verifyExportOperation(mintExportOperation(CREATE, NOW).token, CREATE, now)).toBeNull();
  });

  it("does not accept the operation token as existing CSRF/form envelopes, or signatures from their domains", () => {
    const minted = mintExportOperation(CREATE, NOW);
    expect(readEmbryoOperation(minted.token, NOW)).toBeNull();
    expect(readPublicFormToken(minted.token, "rights-activate", NOW)).toBeNull();
    for (const context of ["embryo-operation-v1", "public-form-v1", "family-sharing-operation-v1", "export-operation-nonce-v1"]) {
      expect(verifyExportOperation(seal(payloadOf(minted.token), context), CREATE, NOW)).toBeNull();
    }
  });

  it("rejects invalid or oversized token shapes", () => {
    for (const token of [undefined, null, 12, {}, "", "x".repeat(EXPORT_OPERATION_TOKEN_MAX_LENGTH + 1)]) {
      expect(verifyExportOperation(token, CREATE, NOW)).toBeNull();
    }
    const [payload, signature] = mintExportOperation(CREATE, NOW).token.split(".");
    for (const wrong of ["", signature.slice(1), signature.toUpperCase(), "é".repeat(64), "0".repeat(64)]) {
      expect(verifyExportOperation(`${payload}.${wrong}`, CREATE, NOW)).toBeNull();
    }
    expect(verifyExportOperation(`${payload}..${signature}`, CREATE, NOW)).toBeNull();
    expect(verifyExportOperation(`${payload}.${signature}\n`, CREATE, NOW)).toBeNull();
    const tampered = { ...payloadOf(`${payload}.${signature}`), targetId: ID };
    expect(verifyExportOperation(`${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${signature}`, CREATE, NOW)).toBeNull();
  });

  it("rejects signed duplicate keys, whitespace, reordered/escaped JSON, nonobjects and noncanonical base64", () => {
    const text = JSON.stringify(payloadOf(mintExportOperation(CREATE, NOW).token));
    const reversed = Object.fromEntries(Object.entries(JSON.parse(text)).reverse());
    for (const raw of [text + " ", text.replace("{", '{"operation":"create",'), JSON.stringify(reversed),
      text.replace("api.export", "api.\\u0065xport"), "null", "[]", '"text"', "{"]) {
      expect(verifyExportOperation(sealText(raw), CREATE, NOW)).toBeNull();
    }
    const payload = Buffer.from(text).toString("base64url") + "=";
    expect(verifyExportOperation(`${payload}.${hmacSecret(payload, "export-operation-v1")}`, CREATE, NOW)).toBeNull();
  });

  it("refuses accessor, hidden, symbol or inherited fields without invoking them", () => {
    const getter = vi.fn(() => CREATE.targetId);
    const withGetter = { ...CREATE };
    Object.defineProperty(withGetter, "targetId", { enumerable: true, get: getter });
    const hidden = { ...CREATE };
    Object.defineProperty(hidden, "extra", { value: true });
    for (const context of [withGetter, hidden, { ...CREATE, [Symbol("extra")]: true }, Object.create(CREATE)]) {
      expect(() => mintExportOperation(context, NOW)).toThrow("export_operation_context_invalid");
      expect(verifyExportOperation(mintExportOperation(CREATE, NOW).token, context, NOW)).toBeNull();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("refuses correctly signed invalid UTF-8 and alternate base64 pad bits", () => {
    const text = JSON.stringify(payloadOf(mintExportOperation(CREATE, NOW).token));
    const bytes = Buffer.from(text);
    bytes[text.indexOf("api.export")] = 255;
    const invalid = bytes.toString("base64url");
    expect(verifyExportOperation(`${invalid}.${hmacSecret(invalid, "export-operation-v1")}`, CREATE, NOW)).toBeNull();
    const payload = Buffer.from(text).toString("base64url");
    // Pick an otherwise valid route whose JSON length has partial base64 bits.
    const candidate = validContexts.map((context) => mintExportOperation(context, NOW)).find((value) => value.token.split(".")[0].length % 4 !== 0)!;
    const partial = candidate.token.split(".")[0];
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const changed = partial.slice(0, -1) + alphabet[alphabet.indexOf(partial.at(-1)!) + 1];
    expect(Buffer.from(changed, "base64url")).toEqual(Buffer.from(partial, "base64url"));
    const context = validContexts.find((value) => verifyExportOperation(candidate.token, value, NOW) !== null)!;
    expect(verifyExportOperation(`${changed}.${hmacSecret(changed, "export-operation-v1")}`, context, NOW)).toBeNull();
    expect(payload.length).toBeLessThan(EXPORT_OPERATION_TOKEN_MAX_LENGTH);
  });

  it("refuses a token after the configured HMAC key changes", () => {
    const minted = mintExportOperation(CREATE, NOW);
    const previous = process.env.BYOK_ENCRYPTION_KEY!;
    try {
      vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
      expect(verifyExportOperation(minted.token, CREATE, NOW)).toBeNull();
    } finally { vi.stubEnv("BYOK_ENCRYPTION_KEY", previous); }
  });
});
