import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));

const {
  CSRF_HEADER,
  OPERATION_HEADER,
  mintEmbryoOperation,
  mintPublicFormToken,
  readEmbryoOperation,
  readPublicFormToken,
  verifyEmbryoOperation,
} = await import("./operation-token");
const { hmacSecret } = await import("@/lib/crypto");

afterAll(() => {
  vi.unstubAllEnvs();
});

const NOW = 1_800_000_000_000;
const TEN_MINUTES = 10 * 60 * 1000;

const EXPECTED = {
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  operation: "cohort_restrict" as const,
  targetKind: "cohort" as const,
  targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

/** The same envelope the module seals, so a forged payload can be signed correctly and still refused on its content. */
function sealAs(claims: unknown, context: string): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${hmacSecret(payload, context)}`;
}

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.slice(0, token.lastIndexOf(".")), "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

/**
 * The embryo operation token (contract §5.1, §6.0; decision §11.1): sealed
 * server-side, bound to the acting account, session, operation and target,
 * ten minutes long, with a fresh nonce the RPC consumes. A route verifies
 * every binding against what it knows and never trusts the token's own
 * view of who is acting.
 */
describe("embryo operation token", () => {
  it("names its headers in lowercase, as the runtime reads them", () => {
    expect(CSRF_HEADER).toBe("x-inherit-csrf");
    expect(OPERATION_HEADER).toBe("x-inherit-operation-nonce");
  });

  it("round-trips exactly the claims it was minted for, with a fresh nonce and a ten-minute expiry", () => {
    const token = mintEmbryoOperation(EXPECTED, NOW);
    const claims = readEmbryoOperation(token, NOW);
    expect(claims).toMatchObject(EXPECTED);
    expect(claims!.expiresAt).toBe(NOW + TEN_MINUTES);
    expect(claims!.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Object.keys(claims!).sort()).toEqual(
      ["accountId", "sessionId", "operation", "targetKind", "targetId", "nonce", "expiresAt"].sort(),
    );
  });

  it("mints a different nonce every time, so no token is replayable as another", () => {
    const first = readEmbryoOperation(mintEmbryoOperation(EXPECTED, NOW), NOW)!;
    const second = readEmbryoOperation(mintEmbryoOperation(EXPECTED, NOW), NOW)!;
    expect(first.nonce).not.toBe(second.nonce);
  });

  it("refuses a tampered payload, a foreign signature, a token with no signature and an empty string", () => {
    const token = mintEmbryoOperation(EXPECTED, NOW);
    const [payload, signature] = token.split(".");
    const swapped = Buffer.from(
      JSON.stringify({ ...payloadOf(token), operation: "cohort_finalize" }),
      "utf8",
    ).toString("base64url");
    expect(readEmbryoOperation(`${swapped}.${signature}`, NOW)).toBeNull();
    expect(readEmbryoOperation(`${payload}.${"0".repeat(signature.length)}`, NOW)).toBeNull();
    expect(readEmbryoOperation(`${payload}.`, NOW)).toBeNull();
    expect(readEmbryoOperation(payload, NOW)).toBeNull();
    expect(readEmbryoOperation("", NOW)).toBeNull();
  });

  it("refuses a signature of the digest's character length but another byte length, without throwing", () => {
    const token = mintEmbryoOperation(EXPECTED, NOW);
    const payload = token.slice(0, token.lastIndexOf("."));
    const wide = `${payload}.${"é".repeat(64)}`;
    expect(() => readEmbryoOperation(wide, NOW)).not.toThrow();
    expect(readEmbryoOperation(wide, NOW)).toBeNull();
    expect(readEmbryoOperation(`abcdefghijklmnopqrstuvwxyz.${"é".repeat(64)}`, NOW)).toBeNull();
    // Uppercase hex is not the shape the digest has either.
    const signature = token.slice(token.lastIndexOf(".") + 1);
    expect(readEmbryoOperation(`${payload}.${signature.toUpperCase()}`, NOW)).toBeNull();
    expect(verifyEmbryoOperation(wide, EXPECTED, NOW)).toBeNull();
  });

  it("is stale at its expiry and fresh one millisecond before", () => {
    const token = mintEmbryoOperation(EXPECTED, NOW);
    expect(readEmbryoOperation(token, NOW + TEN_MINUTES - 1)).not.toBeNull();
    expect(readEmbryoOperation(token, NOW + TEN_MINUTES)).toBeNull();
    expect(readEmbryoOperation(token, NOW + 11 * 60 * 1000)).toBeNull();
  });

  it("refuses a correctly signed payload whose content is not an operation claim", () => {
    const context = "embryo-operation-v1";
    const base = { ...EXPECTED, nonce: "n".repeat(32), expiresAt: NOW + 1000 };
    expect(readEmbryoOperation(sealAs(base, context), NOW)).not.toBeNull();
    expect(readEmbryoOperation(sealAs({ ...base, operation: "delete_everything" }, context), NOW)).toBeNull();
    expect(readEmbryoOperation(sealAs({ ...base, targetKind: "subject" }, context), NOW)).toBeNull();
    expect(readEmbryoOperation(sealAs({ ...base, sessionId: undefined }, context), NOW)).toBeNull();
    expect(readEmbryoOperation(sealAs({ ...base, targetId: 7 }, context), NOW)).toBeNull();
    expect(readEmbryoOperation(sealAs({ ...base, nonce: null }, context), NOW)).toBeNull();
    expect(readEmbryoOperation(sealAs({ ...base, expiresAt: String(NOW + 1000) }, context), NOW)).toBeNull();
    expect(readEmbryoOperation(sealAs("a string", context), NOW)).toBeNull();
    expect(readEmbryoOperation(sealAs(null, context), NOW)).toBeNull();
  });

  it("verifies every binding against what the route knows and returns the claims only on an exact match", () => {
    const token = mintEmbryoOperation(EXPECTED, NOW);
    const claims = verifyEmbryoOperation(token, EXPECTED, NOW);
    expect(claims).toMatchObject(EXPECTED);
    expect(claims!.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    expect(verifyEmbryoOperation(token, { ...EXPECTED, accountId: other }, NOW)).toBeNull();
    expect(verifyEmbryoOperation(token, { ...EXPECTED, sessionId: other }, NOW)).toBeNull();
    expect(verifyEmbryoOperation(token, { ...EXPECTED, operation: "cohort_finalize" }, NOW)).toBeNull();
    expect(verifyEmbryoOperation(token, { ...EXPECTED, targetKind: "embryo" }, NOW)).toBeNull();
    expect(verifyEmbryoOperation(token, { ...EXPECTED, targetId: other }, NOW)).toBeNull();
  });

  it("verifies nothing from a missing, empty, stale or foreign token", () => {
    const token = mintEmbryoOperation(EXPECTED, NOW);
    expect(verifyEmbryoOperation(null, EXPECTED, NOW)).toBeNull();
    expect(verifyEmbryoOperation(undefined, EXPECTED, NOW)).toBeNull();
    expect(verifyEmbryoOperation("", EXPECTED, NOW)).toBeNull();
    expect(verifyEmbryoOperation(token, EXPECTED, NOW + TEN_MINUTES)).toBeNull();
    expect(verifyEmbryoOperation(mintPublicFormToken("rights-activate", NOW), EXPECTED, NOW)).toBeNull();
  });

  it("binds the rights-session target the invitation-accept route passes: the session hash, not an id", () => {
    const hash = crypto.createHash("sha256").update("session", "utf8").digest("hex");
    const expected = { ...EXPECTED, operation: "invitation_accept" as const, targetKind: "rights_session" as const, targetId: hash };
    const token = mintEmbryoOperation(expected, NOW);
    expect(verifyEmbryoOperation(token, expected, NOW)?.targetId).toBe(hash);
    expect(verifyEmbryoOperation(token, { ...expected, targetId: hash.toUpperCase() }, NOW)).toBeNull();
  });
});

/**
 * The public-form token (contract §5.1, §6.4): the same envelope with no
 * account in it, proving only that this deployment served the form
 * recently. It is not one-time; activation is made one-time by consuming
 * the invitation token hash in the database.
 */
describe("public form token", () => {
  it("round-trips a nonce for the form it was minted for and carries no account", () => {
    const token = mintPublicFormToken("rights-activate", NOW);
    const read = readPublicFormToken(token, "rights-activate", NOW);
    expect(read).not.toBeNull();
    expect(read!.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Object.keys(read!)).toEqual(["nonce"]);
    expect(Object.keys(payloadOf(token)).sort()).toEqual(["expiresAt", "form", "nonce"]);
  });

  it("is stale at its expiry and refuses a tampered or empty token", () => {
    const token = mintPublicFormToken("rights-activate", NOW);
    expect(readPublicFormToken(token, "rights-activate", NOW + TEN_MINUTES - 1)).not.toBeNull();
    expect(readPublicFormToken(token, "rights-activate", NOW + TEN_MINUTES)).toBeNull();
    const [payload, signature] = token.split(".");
    expect(readPublicFormToken(`${payload}.${"0".repeat(signature.length)}`, "rights-activate", NOW)).toBeNull();
    expect(readPublicFormToken("", "rights-activate", NOW)).toBeNull();
  });

  it("refuses a signature whose byte length differs from its character length, without throwing", () => {
    const wide = `abcdefghijklmnopqrstuvwxyz.${"é".repeat(64)}`;
    expect(() => readPublicFormToken(wide, "rights-activate", NOW)).not.toThrow();
    expect(readPublicFormToken(wide, "rights-activate", NOW)).toBeNull();
  });

  it("refuses a correctly signed token for another form or with a malformed nonce", () => {
    const context = "public-form-v1";
    expect(
      readPublicFormToken(sealAs({ form: "other-form", nonce: "n".repeat(32), expiresAt: NOW + 1000 }, context), "rights-activate", NOW),
    ).toBeNull();
    expect(
      readPublicFormToken(sealAs({ form: "rights-activate", nonce: 12, expiresAt: NOW + 1000 }, context), "rights-activate", NOW),
    ).toBeNull();
    expect(readPublicFormToken(sealAs(null, context), "rights-activate", NOW)).toBeNull();
  });

  it("keeps the two envelopes apart: neither token reads as the other", () => {
    const operation = mintEmbryoOperation(EXPECTED, NOW);
    const form = mintPublicFormToken("rights-activate", NOW);
    expect(readPublicFormToken(operation, "rights-activate", NOW)).toBeNull();
    expect(readEmbryoOperation(form, NOW)).toBeNull();
  });
});
