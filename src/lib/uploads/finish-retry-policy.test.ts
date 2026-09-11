import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTO_FINISH_DELAYS_MS } from "./finish-retry-policy";

const leaseSeconds = Number(
  /FINALIZATION_LEASE_SECONDS = (\d+)/.exec(
    readFileSync(path.join(process.cwd(), "src/lib/uploads/subject-finalization.ts"), "utf8"),
  )?.[1],
);

describe("the page's automatic attempts at finishing a staged upload", () => {
  it("reads a real lease out of the finalizer, so this test cannot pass vacuously", () => {
    expect(leaseSeconds).toBeGreaterThan(0);
  });

  it("gives up after three, so a real refusal is not hidden behind motion", () => {
    expect(AUTO_FINISH_DELAYS_MS.length).toBe(3);
  });

  it("waits past the finalization lease before the last attempt", () => {
    // Until the lease lapses the server refuses a second request on purpose.
    // An attempt after it is the first that can take over a stalled holder.
    const last = AUTO_FINISH_DELAYS_MS[AUTO_FINISH_DELAYS_MS.length - 1];
    expect(last).toBeGreaterThan(leaseSeconds * 1000);
  });

  it("still tries early, because a failure that never reached the server holds no lease", () => {
    expect(AUTO_FINISH_DELAYS_MS[0]).toBeLessThan(leaseSeconds * 1000);
  });

  it("is strictly increasing, so the attempts back off rather than drum", () => {
    for (let at = 1; at < AUTO_FINISH_DELAYS_MS.length; at++) {
      expect(AUTO_FINISH_DELAYS_MS[at]).toBeGreaterThan(AUTO_FINISH_DELAYS_MS[at - 1]);
    }
  });

  it("spends its whole budget inside the window a person has to retry at all", () => {
    // The upload session lives 1800 s from issuance (measured 2026-09-11), and
    // the retry window is that session's. A schedule whose last attempt landed
    // outside it would be offering something that cannot work.
    const total = AUTO_FINISH_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeLessThan(1800 * 1000);
  });
});
