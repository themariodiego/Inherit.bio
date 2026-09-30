import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { signaturesFresh } from "./malware-scanner";
import { EICAR_TEST_STRING, claimScannerFrom, testDoubleScanner } from "./test-double-scanner";

describe("the test-double scanner", () => {
  it("finds the EICAR test string anywhere in the bytes", async () => {
    const bytes = Buffer.concat([crypto.randomBytes(1000), Buffer.from(EICAR_TEST_STRING, "ascii"), crypto.randomBytes(10)]);
    const verdict = await testDoubleScanner().scan(bytes);
    expect(verdict.verdict).toBe("FOUND");
    expect(verdict).toMatchObject({ sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  });

  it("clears other bytes under fresh signatures, bound to their SHA-256", async () => {
    const bytes = Buffer.from("%PDF-1.4 synthetic");
    const verdict = await testDoubleScanner(() => 1_800_000_000_000).scan(bytes);
    expect(verdict).toEqual({
      verdict: "OK",
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      signatures: { engine: "test-double", version: 1, publishedAt: new Date(1_800_000_000_000) },
    });
  });

  it("is the standard 68-byte EICAR string", () => {
    expect(EICAR_TEST_STRING).toHaveLength(68);
    expect(crypto.createHash("sha256").update(EICAR_TEST_STRING).digest("hex"))
      .toBe("275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f");
  });
});

describe("choosing the scanner", () => {
  it("uses a clamd socket when one is named", () => {
    expect(() => claimScannerFrom({ INHERIT_CLAMD_ADDRESS: "unix:/run/clamav/clamd.ctl" })).not.toThrow();
    expect(() => claimScannerFrom({ INHERIT_CLAMD_ADDRESS: "tcp:127.0.0.1:3310" })).not.toThrow();
  });

  it("allows the test double only on a TEST-LOCAL, non-production build", () => {
    expect(() => claimScannerFrom({ INHERIT_CLAMD_ADDRESS: "test-double", INHERIT_TEST_JURISDICTION: "1" })).not.toThrow();
    expect(() => claimScannerFrom({ INHERIT_CLAMD_ADDRESS: "test-double" })).toThrow("scanner_unconfigured");
    expect(() => claimScannerFrom({ INHERIT_CLAMD_ADDRESS: "test-double", INHERIT_TEST_JURISDICTION: "1", NODE_ENV: "production" }))
      .toThrow("scanner_unconfigured");
    expect(() => claimScannerFrom({ INHERIT_CLAMD_ADDRESS: "test-double", INHERIT_TEST_JURISDICTION: "1", VERCEL_ENV: "production" }))
      .toThrow("scanner_unconfigured");
  });

  it.each([undefined, "", "none", "clamd"])("refuses to start with %s", (value) => {
    expect(() => claimScannerFrom({ INHERIT_CLAMD_ADDRESS: value })).toThrow("scanner_unconfigured");
  });
});

describe("signature freshness", () => {
  const now = Date.UTC(2026, 8, 28, 12);
  it("holds a day, no more, and nothing from the future", () => {
    expect(signaturesFresh(new Date(now - 24 * 3600 * 1000), now)).toBe(true);
    expect(signaturesFresh(new Date(now - 24 * 3600 * 1000 - 1), now)).toBe(false);
    expect(signaturesFresh(new Date(now + 6 * 60 * 1000), now)).toBe(false);
    expect(signaturesFresh(new Date(Number.NaN), now)).toBe(false);
  });
});
