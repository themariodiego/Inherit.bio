import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REVOKE_ALL_CONFIRMATION,
  REVOKE_ALL_CONTROL,
  REVOKE_ALL_FAILED,
  REVOKE_ALL_WORKING,
} from "./consents";

/**
 * The revoke-all control on /settings/consents (owner decision 2026-10-22,
 * "Revoke-all control"). Its text is the owner's exactly, and it posts the
 * closed body the built route accepts. No other wording is introduced: the
 * pending and failure lines are strings the product already shows.
 */
const route = readFileSync("src/app/api/consents/revoke-all/route.ts", "utf8");
const page = readFileSync("src/app/(app)/settings/consents/page.tsx", "utf8");
const control = readFileSync("src/components/settings/revoke-all-consents.tsx", "utf8");
const dangerZone = readFileSync("src/components/settings/danger-zone.tsx", "utf8");
const consentList = readFileSync("src/components/settings/consent-list.tsx", "utf8");

describe("the revoke-all control", () => {
  it("carries exactly the owner's text", () => {
    expect(REVOKE_ALL_CONTROL).toBe(
      "Turn off every permission you have given. Results made under them are deleted. Your files stay.");
  });

  it("introduces no new words for its pending and failure states", () => {
    expect(consentList).toContain(`"${REVOKE_ALL_WORKING}"`);
    expect(dangerZone).toContain(`"${REVOKE_ALL_FAILED}"`);
  });

  it("posts the route's resolved confirmation id and the rendered nonce, nothing else", () => {
    expect(route).toContain(`const CONFIRMATION = "${REVOKE_ALL_CONFIRMATION}";`);
    expect(control).toContain('fetch("/api/consents/revoke-all"');
    expect(control).toContain("JSON.stringify({ confirmation: REVOKE_ALL_CONFIRMATION, nonce })");
    expect(control).toContain("{busy ? REVOKE_ALL_WORKING : REVOKE_ALL_CONTROL}");
  });

  it("is rendered on /settings/consents with a consents_revoke_all nonce", () => {
    expect(page).toContain("<RevokeAllConsents nonce={revokeAllNonce} />");
    const helper = readFileSync("src/lib/consents-revoke-all-control.ts", "utf8");
    expect(helper).toContain('operation: "consents_revoke_all"');
  });
});
