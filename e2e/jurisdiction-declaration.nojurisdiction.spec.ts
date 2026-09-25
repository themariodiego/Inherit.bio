import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { adminClient, createConfirmedUser, signIn } from "./helpers";

/**
 * G5.1a declared-unreviewed, on the flag-off server (Playwright project
 * `jurisdiction-off`, port 3101). ADR 0032.
 *
 * With the acceptance flag unset the resolver reads each account's real
 * declaration, and `data/jurisdictions.json` commits no reviewed
 * jurisdiction, so a declared country resolves to `unreviewed` and every
 * restricted capability refuses with the register's own sentence. The
 * declaration itself still works here, and the block-only test code cannot be
 * declared at all: it exists only where the flag is on.
 *
 * Every other `*.nojurisdiction.spec.ts` now runs on accounts declared as GB
 * by `createConfirmedUser`, so the refusals they prove are declared-unreviewed
 * refusals too; this file proves the declaration is what they read.
 */

const runId = randomUUID();
const USER = { email: `jurisdiction-off-${runId}@e2e.local`, password: "e2e-jurisdiction-off-pw" };
const OFF = "http://localhost:3101";
const REGISTER_SENTENCE = "This part of Inherit is not available here because its legal review is not complete.";

async function attestation(): Promise<{ version: number; body_sha256: string }> {
  const { data, error } = await adminClient().from("consent_artifacts").select("version, body_sha256")
    .eq("artifact_key", "attestation.jurisdiction").is("superseded_at", null).single();
  expect(error).toBeNull();
  return data as { version: number; body_sha256: string };
}

test("/family/health-picture jurisdiction-unavailable: a declared country with no signed review refuses, and the block-only code cannot be declared without the flag", async ({ page }) => {
  const accountId = await createConfirmedUser(USER.email, USER.password);
  await signIn(page, USER.email, USER.password);
  const { version, body_sha256 } = await attestation();
  const put = (code: string) => page.request.put("/api/settings/jurisdiction", {
    headers: { origin: OFF, "content-type": "application/json" },
    data: { code, attestationVersion: version, attestationHash: body_sha256, affirmed: true },
  });

  const refused = await put("XX");
  expect(refused.status()).toBe(422);
  expect(await refused.json()).toEqual({ error: "invalid_request", issues: ["code"] });

  const declared = await put("FR");
  expect(declared.status()).toBe(200);
  expect(await declared.json()).toEqual({ status: "updated", jurisdiction: "FR", capabilityReevaluation: "complete" });
  const { data: profile } = await adminClient().from("profiles").select("jurisdiction_code").eq("id", accountId).single();
  expect(profile).toEqual({ jurisdiction_code: "FR" });

  await page.goto("/family/health-picture");
  await expect(page.getByRole("status").filter({ hasText: REGISTER_SENTENCE })).toHaveCount(1);
  await expect(page.locator("[data-claim-block], [data-figure-kind], main table")).toHaveCount(0);

  await page.goto("/family/invite");
  await expect(page.getByRole("heading", { name: "Not available in this jurisdiction yet" })).toBeVisible();
  await expect(page.getByLabel("Their email address")).toHaveCount(0);

  await page.goto("/genome/me");
  await expect(page.getByRole("heading", { name: "My Genome", exact: true })).toBeVisible();
});
