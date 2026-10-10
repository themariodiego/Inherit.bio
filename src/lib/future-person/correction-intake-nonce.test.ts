import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintCorrectionIntakeNonce, readCorrectionIntakeNonce } from "./correction-intake-nonce";
import { newCaseHmac } from "./new-case-envelope-crypto";
const session = "a".repeat(64), now = 1_800_000_000_000;
beforeEach(() => vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 71).toString("base64")));
afterEach(() => vi.unstubAllEnvs());
// SOURCE ONLY / UNRUN. Synthetic keys and clocks confer no native authority.
describe("correction intake nonce has one operation and claimant session", () => {
  it("mints distinct stateless tokens and reads the original random nonce", () => {
    const first = mintCorrectionIntakeNonce(session, now), second = mintCorrectionIntakeNonce(session, now);
    expect(first).not.toBe(second); expect(first.length).toBeLessThanOrEqual(2048);
    expect(readCorrectionIntakeNonce(first, session, now)).toMatch(/^[A-Za-z0-9_-]{32}$/u);
  });
  it("refuses another session, changed signature and a noncanonical payload", () => {
    const token = mintCorrectionIntakeNonce(session, now), [payload, signature] = token.split(".");
    expect(readCorrectionIntakeNonce(token, "b".repeat(64), now)).toBeNull();
    expect(readCorrectionIntakeNonce(`${payload}.${signature![0] === "0" ? "1" : "0"}${signature!.slice(1)}`, session, now)).toBeNull();
    expect(readCorrectionIntakeNonce(`${payload}=.${signature}`, session, now)).toBeNull();
  });
  it("refuses exact expiry, a clock beyond the lifetime and invalid clocks", () => {
    const token = mintCorrectionIntakeNonce(session, now);
    expect(readCorrectionIntakeNonce(token, session, now + 600_000)).toBeNull();
    expect(readCorrectionIntakeNonce(token, session, now - 1)).toBeNull();
    expect(readCorrectionIntakeNonce(token, session, Number.NaN)).toBeNull();
    expect(() => mintCorrectionIntakeNonce(session, Number.MAX_SAFE_INTEGER)).toThrow("correction_unavailable");
  });
  it("refuses signed wrong-operation and unknown claims instead of granting authority", () => {
    const token = mintCorrectionIntakeNonce(session, now), original = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
    for (const claims of [{ ...original, operation: "future-person-recovery-key" }, { ...original, subjectId: "forbidden" }]) {
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      expect(readCorrectionIntakeNonce(`${payload}.${newCaseHmac(payload, "new-future-person-correction-intake-nonce-v1")}`, session, now)).toBeNull();
    }
  });
});
