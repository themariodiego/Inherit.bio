import assert from "node:assert/strict";
import { settingsOperationNonce } from "./operation-nonce";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { acceptAdultInvitation, adminClient, adultInvitationToken, adultInvitationUrl,
  createConfirmedUser, drainMailUntil, signIn, uploadOwnFileThroughUi } from "../helpers";
import { ownRunCompletions, uploadOwnFileWithChosenReports } from "../own-report-helpers";
import { densityCapturePlan, type DensityStateCase } from "../../scripts/density-capture-plan";
import { familyDensityRecipe, type FamilyDensityRecipe } from "../../scripts/density-family-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import { OWN_UPLOAD_COPY } from "../../src/copy/upload/consent";
import { PERMISSION_ROWS } from "../../src/copy/family/permissions";
import { BASELINE_ABSENT, GATE_BUTTON, GATE_CHECKBOX_LABEL, noneCovered, notShared } from "../../src/copy/family/person";
import { ADD_ANOTHER_ADULT_BUTTON, CARD_READY_STATUS, FAMILY_H1, HUB_TILES, NOT_DIAGNOSTIC,
  SELF_PLACEHOLDER_LABEL, UNNAMED_PERSON_LABEL } from "../../src/copy/family/index";
import { DENSITY_TEST_DENY_SENTENCE } from "../../scripts/density-jurisdiction-states";
import { HEALTH_PICTURE_H1, OPEN_PERMISSIONS_LINK, pausedWith } from "../../src/copy/family/health-picture";
import { ACKNOWLEDGE_BUTTON, ACKNOWLEDGE_CHECKBOX_LABEL, BLOCKING_BODY, HEADER_SENTENCE, PORTRAIT_H1,
  VIEWER_NO_FILE_YET, VIEWER_PORTRAIT_STEPS, PORTRAIT_STEPS, viewerMissingStep, missingStep, noFileYet } from "../../src/copy/family/portrait";
import nothingReceipt from "../fixtures/synthetic-browser-grch38.receipt.json";
import { accountCsrf, signOut } from "./session-csrf";

interface ActualEmail { to: string[] | string; subject: string; html?: string }
type Facts = Record<string, Record<string, unknown>[]>;
const layers = ["reports.monogenic", "reports.polygenic"] as const;
const slugs = ["muscle-composition-actn3-rs1815739", "sprint-power-actn3",
  "caffeine-metabolism-cyp1a2-rs762551", "lactase-persistence-lct-rs4988235"];

async function fullPair(accountIds: [string, string]): Promise<Facts> {
  assert(accountIds.every(id => /^[a-f0-9-]{36}$/.test(id)), "Actual pair accounts required");
  const admin = adminClient(), facts: Facts = {};
  for (const [name, query] of [
    ["profiles", admin.from("profiles").select("*", { count: "exact" }).in("id", accountIds)],
    ["subjects", admin.from("subjects").select("*", { count: "exact" })
      .or(accountIds.flatMap(id => [`owner_account_id.eq.${id}`, `subject_account_id.eq.${id}`]).join(","))],
    ["principals", admin.from("subject_principals").select("*", { count: "exact" }).in("account_id", accountIds)],
    ["files", admin.from("genome_files").select("*", { count: "exact" }).in("user_id", accountIds)],
    ["pauses", admin.from("family_sharing_pauses").select("*", { count: "exact" })
      .or(accountIds.flatMap(id => [`account_low_id.eq.${id}`, `account_high_id.eq.${id}`]).join(","))],
  ] as const) {
    const rows = await query;
    expect(rows.error, `complete native Family ${name}`).toBeNull();
    expect(rows.count).not.toBeNull(); expect(rows.data!.length).toBe(rows.count);
    facts[name] = rows.data!;
  }
  expect(facts.profiles).toHaveLength(2);
  const principalIds = facts.principals.map(row => row.id as string);
  assert(principalIds.length >= 2, "Both native principals required");
  for (const [name, query] of [
    ["invitations", admin.from("subject_invitations").select("*", { count: "exact" }).in("inviter_principal_id", principalIds)],
    ["grants", admin.from("purpose_grants").select("*", { count: "exact" }).in("data_subject_principal_id", principalIds)],
  ] as const) {
    const rows = await query;
    expect(rows.error, `complete native Family ${name}`).toBeNull();
    expect(rows.count).not.toBeNull(); expect(rows.data!.length).toBe(rows.count); facts[name] = rows.data!;
  }
  const grantIds = facts.grants.map(row => row.grant_id as string);
  const subjectIds = facts.subjects.map(row => row.id as string);
  const pairs = await admin.from("family_pairs").select("*", { count: "exact" })
    .or(subjectIds.flatMap(id => [`subject_a_id.eq.${id}`, `subject_b_id.eq.${id}`]).join(","));
  expect(pairs.error, "complete native Family pair rows").toBeNull();
  expect(pairs.count).not.toBeNull(); expect(pairs.data!.length).toBe(pairs.count);
  facts.family_pairs = pairs.data!;
  const directions = grantIds.length ? await admin.from("directional_grants").select("*", { count: "exact" })
    .in("grant_id", grantIds) : null;
  if (directions) {
    expect(directions.error).toBeNull(); expect(directions.count).not.toBeNull();
    expect(directions.data!.length).toBe(directions.count);
  }
  facts.directions = directions?.data ?? [];
  const fileIds = facts.files.map(row => row.id as string);
  for (const table of ["user_prs", "user_variants", "report_observed_calls", "ancestry_results"]) {
    const rows = fileIds.length ? await admin.from(table).select("*", { count: "exact" }).in("file_id", fileIds) : null;
    if (rows) {
      expect(rows.error, `complete native Family ${table}`).toBeNull();
      expect(rows.count).not.toBeNull(); expect(rows.data!.length).toBe(rows.count);
    }
    facts[table] = rows?.data ?? [];
  }
  facts.own_completions = [];
  for (const file of facts.files.filter(file => file.status === "stored" && file.normalization_completed_at !== null)) {
    const runs = await ownRunCompletions(file.id as string);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.complete, "exact live-grant/source native completion").toBe(true);
      expect(run.completed_at).not.toBeNull();
      facts.own_completions.push({ fileId: file.id, ...run });
    }
  }
  for (const rows of Object.values(facts)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return facts;
}

function directionalPurposes(facts: Facts, subjectId: string, recipient: string): string[] {
  const directions = facts.directions.filter(row => row.direction === "subject_to_recipient"
    && row.recipient_account_id === recipient && row.status === "current");
  return facts.grants.filter(row => row.target_kind === "subject" && row.target_id === subjectId
    && row.revoked_at === null && (row.expires_at === null || Date.parse(row.expires_at as string) > Date.now())
    && directions.some(direction => direction.grant_id === row.grant_id && direction.grant_revision === row.grant_revision))
    .map(row => row.purpose as string).sort();
}

async function currentJurisdictionAttestations() {
  const rows = await adminClient().from("consent_artifacts").select("*", { count: "exact" })
    .eq("artifact_key", "attestation.jurisdiction").is("superseded_at", null);
  expect(rows.error).toBeNull(); expect(rows.count).not.toBeNull(); expect(rows.data!.length).toBe(rows.count);
  expect(rows.data).toHaveLength(1);
  const artifact = rows.data![0];
  assert(Number.isSafeInteger(artifact.version) && artifact.version > 0
    && typeof artifact.body_sha256 === "string" && /^[a-f0-9]{64}$/.test(artifact.body_sha256)
    && typeof artifact.body_markdown === "string"
    && createHash("sha256").update(artifact.body_markdown).digest("hex") === artifact.body_sha256,
  "Complete current native jurisdiction attestation required");
  return rows.data!;
}

function assertDeclaredPair(before: Facts, after: Facts, viewer: string, subjectId: string) {
  expect(directionalPurposes(before, subjectId, viewer)).toEqual([...layers].sort());
  expect(directionalPurposes(after, subjectId, viewer)).toEqual([]);
  const changed = before.directions.filter(row => row.direction === "subject_to_recipient"
    && row.recipient_account_id === viewer && row.status === "current");
  expect(changed).toHaveLength(2);
  const ids = new Set(changed.map(row => row.grant_id));
  expect(before.grants.length).toBe(after.grants.length);
  for (const original of before.grants) {
    const revoked = after.grants.find(row => row.grant_id === original.grant_id);
    assert(revoked, "A jurisdiction change retains each complete native grant");
    if (ids.has(original.grant_id)) {
      expect(typeof revoked.revoked_at).toBe("string");
      expect(Number.isFinite(Date.parse(revoked.revoked_at as string))).toBe(true);
      expect(revoked, "the same whole grant retains only its native revocation fields")
        .toEqual({ ...original, revoked_at: revoked.revoked_at, revocation_reason: "jurisdiction_changed" });
    } else expect(revoked).toEqual(original);
  }
  expect(before.directions.length).toBe(after.directions.length);
  for (const original of before.directions) {
    const revoked = after.directions.find(row => row.grant_id === original.grant_id);
    assert(revoked, "Each original whole direction remains recorded");
    if (ids.has(original.grant_id)) {
      expect(typeof revoked.ended_at).toBe("string");
      expect(Number.isFinite(Date.parse(revoked.ended_at as string))).toBe(true);
      expect(revoked).toEqual({ ...original, status: "revoked", ended_at: revoked.ended_at });
    } else expect(revoked).toEqual(original);
  }
  const profile = after.profiles.find(row => row.id === viewer);
  assert(profile, "Actual signed-in viewer profile required");
  expect(profile).toMatchObject({ jurisdiction_code: "XX", jurisdiction_subdivision: null });
  expect(typeof profile.jurisdiction_declared_at).toBe("string");
  expect(Number.isFinite(Date.parse(profile.jurisdiction_declared_at as string))).toBe(true);
  const originalProfile = before.profiles.find(row => row.id === viewer);
  assert(originalProfile, "The same original viewer must declare the change");
  expect(profile).toEqual({ ...originalProfile, jurisdiction_code: "XX", jurisdiction_subdivision: null,
    jurisdiction_declared_at: profile.jurisdiction_declared_at,
    jurisdiction_attestation_version: profile.jurisdiction_attestation_version,
    jurisdiction_attestation_sha256: profile.jurisdiction_attestation_sha256 });
  for (const other of before.profiles.filter(row => row.id !== viewer))
    expect(after.profiles.find(row => row.id === other.id)).toEqual(other);
  for (const name of Object.keys(before).filter(name => !["profiles", "grants", "directions"].includes(name)))
    expect(after[name], "a legal refusal preserves the native source and unrelated outputs").toEqual(before[name]);
}

function sharedDeniedPath(routeId: string, handle: string) {
  if (routeId === "family.person") return `/family/s-${handle}`;
  if (routeId === "family.permissions") return `/family/s-${handle}/permissions`;
  const suffixes: Readonly<Record<string, string>> = {
    "genome.subject": "", "genome.reports": "/reports", "genome.report": "/reports/lactase-persistence-lct-rs4988235",
    "genome.ancestry": "/ancestry", "genome.data": "/data", "genome.browser": "/data/browser",
  };
  const suffix = suffixes[routeId];
  assert(suffix !== undefined, "Only the exact registered shared-subject refusal routes are admitted");
  return `/genome/s-${handle}${suffix}`;
}

async function adulthood(page: Page) {
  await page.goto("/files/upload");
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true })).toBeVisible();
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
  const completed = page.waitForResponse(response => response.url().endsWith("/api/account/completion")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await completed).status()).toBe(200);
  await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.insuranceHeading, exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: OWN_UPLOAD_COPY.insuranceCheckbox, exact: true })).not.toBeChecked();
}

async function turnOn(page: Page, handle: string, purpose: typeof layers[number] | "family.heritability" | "family.portrait") {
  await page.goto(`/family/s-${handle}/permissions`);
  const label = PERMISSION_ROWS.find(row => row.id === purpose)!.label;
  const permission = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: new RegExp(`^${label}$`) }) });
  await expect(permission.locator('[data-slot="permission-state"]')).toHaveText("Off");
  const signed = page.waitForResponse(response => response.url().endsWith("/api/consents") && response.request().method() === "POST");
  await permission.getByRole("button", { name: /^Turn on / }).click();
  const response = await signed; expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ recordKind: "purpose_grant", purposeKey: purpose });
  await expect(permission.locator('[data-slot="permission-state"]')).toHaveText("On");
}

function isPermissionBoundary(recipe: FamilyDensityRecipe) {
  return ["health-paused", "portrait-missing", "portrait-empty"].includes(recipe);
}

function actualPortraitPair(facts: Facts, subjectA: string, subjectB: string) {
  const pairs = facts.family_pairs.filter(row => ["pending", "current"].includes(row.status as string)
    && ((row.subject_a_id === subjectA && row.subject_b_id === subjectB)
      || (row.subject_a_id === subjectB && row.subject_b_id === subjectA)));
  expect(pairs, "Only the exact native pair created by this real Portrait grant").toHaveLength(1);
  assert(typeof pairs[0].id === "string" && /^[a-f0-9-]{36}$/.test(pairs[0].id), "Actual native pair key required");
  return pairs[0];
}

async function acknowledgeOwnPortrait(page: Page, pairId: string, subjectId: string) {
  expect((await page.goto(`/family/portrait/${pairId}`))?.status()).toBe(200);
  const form = page.locator('[data-slot="portrait-acknowledge"]');
  await expect(form.getByRole("checkbox", { name: ACKNOWLEDGE_CHECKBOX_LABEL, exact: true })).not.toBeChecked();
  await form.getByRole("checkbox", { name: ACKNOWLEDGE_CHECKBOX_LABEL, exact: true }).check();
  const stamped = page.waitForResponse(response => response.request().method() === "POST"
    && response.url().endsWith("/api/family/acknowledge"));
  await form.getByRole("button", { name: ACKNOWLEDGE_BUTTON, exact: true }).click();
  const response = await stamped;
  expect(response.request().postDataJSON()).toEqual({ acknowledgement: "portrait", subjectId, affirmed: true });
  expect(response.ok()).toBe(true); expect(await response.finished()).toBeNull();
  await expect(form).toHaveCount(0);
}

async function boundaryFacts(accountIds: [string, string]): Promise<Facts> {
  const facts = await fullPair(accountIds), admin = adminClient();
  const signatures = await admin.from("consent_signatures").select("*", { count: "exact" }).in("signer_account_id", accountIds);
  expect(signatures.error).toBeNull(); expect(signatures.count).not.toBeNull();
  expect(signatures.data!.length).toBe(signatures.count); facts.signatures = signatures.data!;
  const pairIds = facts.family_pairs.map(row => row.id as string);
  const results = pairIds.length ? await admin.from("portrait_results").select("*", { count: "exact" }).in("family_pair_id", pairIds) : null;
  if (results) { expect(results.error).toBeNull(); expect(results.count).not.toBeNull(); expect(results.data!.length).toBe(results.count); }
  facts.portrait_results = results?.data ?? [];
  for (const rows of Object.values(facts)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return facts;
}

async function hold(page: Page, pattern: string) {
  let release!: () => void, intercepted = 0, continuation: Promise<void> | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(pattern, async (route: Route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    assert(++intercepted === 1, "Exactly one original Family write required");
    continuation = (async () => {
      await pending; await route.continue();
      const response = await route.request().response();
      assert(response && await response.finished() === null, "Actual Family write must settle");
      assert(response.ok(), "Actual Family write must succeed");
    })();
    void continuation.catch(() => {}); await continuation;
  });
  return { assertHeld: async () => { await expect.poll(() => intercepted).toBe(1); },
    settle: async () => { release(); if (continuation) await continuation; } };
}

async function passGate(page: Page) {
  await expect(page.getByText(GATE_CHECKBOX_LABEL, { exact: true })).toBeVisible();
  await expect(page.locator("[data-figure-kind], [data-claim-block]")).toHaveCount(0);
  const stored = await page.evaluate(() => ({ local: JSON.stringify(window.localStorage), session: JSON.stringify(window.sessionStorage) }));
  expect(stored.local).not.toMatch(/tier2|family/i); expect(stored.session).not.toMatch(/tier2|family/i);
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator('[data-layer="estimate"]')).toBeVisible();
}

/** Root supplies the already owned isolated mail capture, never a canned
 * invitation or an adopted relay. The actual worker and acceptance helpers
 * create the relationship. Every actor/state/viewport gets a new pair. */
export function realPairedFamilyDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  findActualInvitation: (recipient: string) => ActualEmail | undefined;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountIds: [string, string]; nativeSnapshot: Facts }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
  "Existing disposable app required");
  const sourcePath = "e2e/helpers/density-family-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = familyDensityRecipe(row); if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        const context = await input.browser.newContext({ baseURL: origin.origin, viewport,
          deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), run = randomUUID(), password = "synthetic-density-family-password";
        const aEmail = `density-family-a-${run}@e2e.local`, bEmail = `density-family-b-${run}@e2e.local`;
        let held: Awaited<ReturnType<typeof hold>> | undefined, capturedPage = page;
        let viewingContext: BrowserContext | undefined;
        let ancestry: ReturnType<Page["locator"]> | undefined;
        let fixedDenialFacts: Facts | undefined;
        let fixedBoundaryFacts: Facts | undefined;
        const privateReads: string[] = [];
        try {
          const accountIds: [string, string] = [await createConfirmedUser(aEmail, password), await createConfirmedUser(bEmail, password)];
          await signIn(page, aEmail, password); await adulthood(page); await page.goto("/family/invite");
          await page.getByLabel("Their email address").fill(bEmail); await page.getByRole("checkbox").check();
          await page.getByRole("button", { name: "Send invitation" }).click();
          await expect(page.getByRole("status")).toContainText("Invitation requested");
          const message = await drainMailUntil(page.request, () => input.findActualInvitation(bEmail), "this pair's actual invitation");
          expect((Array.isArray(message.to) ? message.to : [message.to])).toContain(bEmail);
          const token = adultInvitationToken(message.html); assert(token, "Native invitation link required");
          await signOut(page);
          await acceptAdultInvitation({ page, invitationUrl: adultInvitationUrl(token), email: bEmail, password, origin: origin.origin });
          let facts = await fullPair(accountIds);
          const selfA = facts.subjects.find(subject => subject.subject_account_id === accountIds[0]
            && subject.subject_class === "self" && subject.lifecycle === "active");
          const selfB = facts.subjects.find(subject => subject.subject_account_id === accountIds[1]
            && subject.subject_class === "self" && subject.lifecycle === "active");
          assert(selfA && selfB, "Actual independent self subjects required");
          const invitation = facts.invitations.filter(item => item.status === "accepted" && item.invitation_kind === "adult_subject");
          expect(invitation).toHaveLength(1);
          const handle = invitation[0].target_id as string;
          expect(facts.subjects.find(subject => subject.id === handle)).toMatchObject({
            subject_class: "other_adult", subject_account_id: accountIds[1], lifecycle: "active",
          });
          expect(handle).not.toBe(selfB.id); expect(facts.files).toEqual([]);
          expect(directionalPurposes(facts, selfB.id as string, accountIds[0])).toEqual([]);
          expect(directionalPurposes(facts, selfA.id as string, accountIds[1])).toEqual([]);

          if (isPermissionBoundary(recipe)) {
            // A real independent sign-in is a prerequisite, not a seeded
            // mitigation timestamp from the invitation acceptance session.
            await signOut(page); await signIn(page, bEmail, password);
            await turnOn(page, selfA.id as string, recipe === "health-paused" ? "family.heritability" : "family.portrait");
            if (recipe === "portrait-empty") {
              const pair = actualPortraitPair(await fullPair(accountIds), selfA.id as string, selfB.id as string);
              await acknowledgeOwnPortrait(page, pair.id as string, selfB.id as string);
            }
          } else if (!["unshared", "permissions", "grant-pending"].includes(recipe)) {
            if (recipe !== "preparing") await uploadOwnFileWithChosenReports(page,
              path.join(input.root, recipe === "no-coverage" ? nothingReceipt.fixture.path : "e2e/fixtures/tiny-grch38.vcf"),
              { fileType: "vcf", purposes: ["reports.monogenic", "reports.polygenic"] });
            for (const purpose of recipe === "one-layer" || recipe === "preparing" ? ["reports.polygenic"] as const : layers)
              await turnOn(page, selfA.id as string, purpose);
          }
          if (recipe === "preparing") {
            held = await hold(page, "**/api/files/*/process");
            const file = await uploadOwnFileThroughUi(page, path.join(input.root, "e2e/fixtures/tiny-grch38.vcf"));
            await held.assertHeld(); facts = await fullPair(accountIds);
            expect(facts.files).toHaveLength(1); expect(facts.files[0]).toMatchObject({ id: file, status: "uploaded", user_id: accountIds[1], subject_id: selfB.id });
            // Independent sessions: a viewer sign-in must not replace the
            // uploader's cookies before its held original request continues.
            viewingContext = await input.browser.newContext({ baseURL: origin.origin, viewport,
              deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
            capturedPage = await viewingContext.newPage();
          }
          if (recipe === "permissions" || recipe === "grant-pending") {
            await page.goto(`/family/s-${selfA.id}/permissions`);
            if (recipe === "grant-pending") {
              ancestry = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
                .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Ancestry$/ }) });
              held = await hold(page, "**/api/consents");
              await ancestry.getByRole("button", { name: "Turn on" }).click(); await held.assertHeld();
            }
          } else {
            if (recipe !== "preparing") {
              await signOut(page); await signIn(page, aEmail, password);
            } else await signIn(capturedPage, aEmail, password);
            if (isPermissionBoundary(recipe)) {
              if (recipe !== "portrait-missing")
                await turnOn(capturedPage, handle, recipe === "health-paused" ? "family.heritability" : "family.portrait");
              if (recipe === "portrait-empty") {
                const pair = actualPortraitPair(await fullPair(accountIds), selfA.id as string, selfB.id as string);
                await acknowledgeOwnPortrait(capturedPage, pair.id as string, selfA.id as string);
              }
            }
            if (recipe === "paused" || recipe === "health-paused") {
              await capturedPage.goto(`/family/s-${handle}/permissions`);
              await capturedPage.getByRole("button", { name: "Pause sharing", exact: true }).click();
              await expect(capturedPage.getByRole("button", { name: "Resume sharing", exact: true })).toBeVisible();
            }
            if (recipe === "jurisdiction") {
              // First prove the genuine shared result and session gate; then
              // use the native country declaration to end restricted sharing.
              expect((await capturedPage.goto(`/family/s-${handle}`))?.status()).toBe(200);
              await passGate(capturedPage);
              for (const slug of slugs) await expect(capturedPage.locator(`a[href$="/reports/${slug}"]`)).toHaveCount(1);
              const before = await fullPair(accountIds), attestations = await currentJurisdictionAttestations();
              const artifact = attestations[0];
              const declared = await page.request.put("/api/settings/jurisdiction", {
                headers: { origin: origin.origin, "content-type": "application/json",
                  "x-inherit-operation-nonce": await settingsOperationNonce(page.request, "jurisdiction"), "x-inherit-csrf": await accountCsrf(page, "api.jurisdiction") },
                data: { code: "XX", attestationVersion: artifact.version, attestationHash: artifact.body_sha256, affirmed: true },
              });
              expect(declared.status(), "Actual current TEST jurisdiction admission is mandatory").toBe(200);
              expect(JSON.parse((await declared.body()).toString("utf8"))).toEqual({ status: "updated", jurisdiction: "XX", capabilityReevaluation: "complete" });
              const after = await fullPair(accountIds);
              assertDeclaredPair(before, after, accountIds[0], selfB.id as string);
              expect(after.profiles.find(item => item.id === accountIds[0])).toMatchObject({
                jurisdiction_attestation_version: artifact.version, jurisdiction_attestation_sha256: artifact.body_sha256,
              });
              expect(await currentJurisdictionAttestations()).toEqual(attestations);
              // The permissions page may perform its original idempotent
              // independent-login observation. Freeze after that navigation.
              capturedPage.on("request", request => {
                const url = new URL(request.url());
                if (url.origin === origin.origin && url.pathname.startsWith("/api/")
                  && (url.pathname.includes("browser") || url.pathname.includes("variants"))) privateReads.push(url.pathname);
              });
            }
            const target = recipe === "jurisdiction" ? sharedDeniedPath(row.route.id, handle)
              : recipe === "health-paused" ? "/family/health-picture"
              : recipe === "portrait-missing" || recipe === "portrait-empty"
                ? `/family/portrait/${actualPortraitPair(await fullPair(accountIds), selfA.id as string, selfB.id as string).id}`
                : row.route.id === "family.index" ? "/family" : `/family/s-${handle}`;
            const response = await capturedPage.goto(target);
            expect(response?.status()).toBe(200);
            if (recipe === "jurisdiction") {
              fixedDenialFacts = await fullPair(accountIds);
              fixedDenialFacts.jurisdiction_attestations = await currentJurisdictionAttestations();
            }
            if (["one-layer", "both-layers", "no-coverage", "preparing"].includes(recipe) && row.route.id === "family.person")
              await passGate(capturedPage);
            if (recipe === "portrait-empty") {
              const gate = capturedPage.locator('[data-slot="result-gate"]');
              await expect(gate.getByRole("checkbox", { name: GATE_CHECKBOX_LABEL, exact: true })).not.toBeChecked();
              await expect(capturedPage.locator('[data-slot="portrait-header-sentence"], [data-figure-kind]')).toHaveCount(0);
              const stamped = capturedPage.waitForResponse(response => response.request().method() === "POST"
                && response.url().endsWith("/api/family/acknowledge"));
              await gate.getByRole("checkbox", { name: GATE_CHECKBOX_LABEL, exact: true }).check();
              await gate.getByRole("button", { name: GATE_BUTTON, exact: true }).click();
              const result = await stamped;
              expect(result.request().postDataJSON()).toEqual({ acknowledgement: "tier2-result-gate", affirmed: true });
              expect(result.ok()).toBe(true); expect(await result.finished()).toBeNull();
              await expect(gate).toHaveCount(0);
            }
            if (isPermissionBoundary(recipe)) fixedBoundaryFacts = await boundaryFacts(accountIds);
          }
          const observe = async () => {
            const actual = isPermissionBoundary(recipe) ? await boundaryFacts(accountIds) : await fullPair(accountIds);
            if (isPermissionBoundary(recipe))
              expect(actual, "Every complete native boundary row remains current around capture").toEqual(fixedBoundaryFacts);
            if (recipe === "jurisdiction") {
              actual.jurisdiction_attestations = await currentJurisdictionAttestations();
              expect(actual, "the complete declared refusal remains current around capture").toEqual(fixedDenialFacts);
              expect(privateReads, "no browser or variant request starts after the refusal").toEqual([]);
            }
            await assertState(capturedPage, row, recipe, actual, selfB.id as string, accountIds[0]);
            if (held) await held.assertHeld();
            return input.observeState(row, capturedPage, sourceSha256, { accountIds, nativeSnapshot: actual });
          };
          await observe(); await capture({ page: capturedPage, observe });
        } finally {
          try {
            if (held) await held.settle();
            if (ancestry) {
              await expect(ancestry.locator('[data-slot="permission-state"]')).toHaveText("On");
              await ancestry.getByRole("button", { name: "Turn off" }).click();
              await expect(ancestry.locator('[data-slot="permission-state"]')).toHaveText("Off");
            }
          } finally { try { await viewingContext?.close(); } finally { await context.close(); } }
        }
      } } satisfies DensityStateFixture];
  });
}

async function assertState(page: Page, row: DensityStateCase, recipe: FamilyDensityRecipe, facts: Facts, subjectId: string, recipient: string) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (isPermissionBoundary(recipe)) {
    await assertPermissionBoundary(page, recipe, facts, subjectId, recipient);
    return;
  }
  const expectedPurposes = recipe === "one-layer" || recipe === "preparing" ? ["reports.polygenic"]
    : ["both-layers", "no-coverage", "paused"].includes(recipe) ? [...layers].sort() : [];
  expect(directionalPurposes(facts, subjectId, recipient)).toEqual(expectedPurposes);
  if (recipe === "jurisdiction") {
    expect(facts.files).toHaveLength(1); expect(facts.files[0].subject_id).toBe(subjectId);
    expect(facts.files[0].status).toBe("stored"); expect(facts.own_completions).toHaveLength(2);
    await expect(page.locator('[data-claim-block], [data-figure-kind], [data-slot="haplogroup"], [data-slot="ancestry-map"], [data-slot="report-skeleton"]')).toHaveCount(0);
    if (row.route.id === "family.permissions") {
      await expect(page.getByRole("status").filter({ hasText: DENSITY_TEST_DENY_SENTENCE })).toHaveCount(1);
      await expect(page.locator('[data-slot="permission-control"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="permission-row"]').first()).toBeVisible();
      await expect(page.locator('[data-slot="permission-locked"]').first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Pause sharing", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Stop sharing", exact: true })).toBeVisible();
    } else if (row.route.id === "family.person") {
      await expect(page.getByRole("status").filter({ hasText: DENSITY_TEST_DENY_SENTENCE })).toHaveCount(1);
      await expect(page.locator('main a[href*="/reports"], [data-layer], [data-slot="subject-files"]')).toHaveCount(0);
      await expect(page.getByText(GATE_CHECKBOX_LABEL, { exact: true })).toHaveCount(0);
    } else {
      const refusal = page.getByRole("status").filter({ hasText: "Not available in this jurisdiction yet" });
      await expect(refusal).toHaveCount(1); await expect(refusal).toContainText("We create no analysis or consent record.");
      await expect(refusal).toContainText("It says nothing about you or anyone else.");
      await expect(refusal).toContainText("When the law is unclear, Inherit keeps the feature off.");
      await expect(page.locator('[data-slot="subject-name"]')).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Genome tools", exact: true })).toHaveCount(0);
      await expect(page.locator('main a[href*="/reports/"], main a[href*="/ancestry"], [data-slot="score-panel-result"], [data-slot="score-input-provenance"], [data-slot="input-provenance"], [data-slot="table-input-provenance"], [data-slot="track-input-provenance"]')).toHaveCount(0);
      await expect(page.getByTestId("genome-browser")).toHaveCount(0);
    }
  } else if (recipe === "unshared") {
    expect(facts.files).toEqual([]);
    await expect(page.getByRole("status")).toHaveText("Invited adult has not shared anything with you yet. You will see nothing here until they do.");
    await expect(page.locator('[data-slot="subject-files"], [data-claim-block], [data-figure-kind]')).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/\b\d+ file/);
  } else if (recipe === "permissions" || recipe === "grant-pending") {
    await expect(page.locator('[data-slot="permission-column"]')).toHaveCount(2);
    const theirs = page.locator('[data-slot="permission-column"][data-settable="false"]');
    await expect(theirs.locator('[data-slot="permission-control"]')).toHaveCount(0);
    const yours = page.locator('[data-slot="permission-column"][data-settable="true"]');
    await expect(yours.locator('[data-slot="permission-row"]')).toHaveCount(PERMISSION_ROWS.length);
    const ancestry = yours.locator('[data-slot="permission-row"]').filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Ancestry$/ }) });
    await expect(ancestry.locator('[data-slot="permission-state"]')).toHaveText("Off");
    await expect(ancestry.getByRole("alert")).toHaveCount(0);
    if (recipe === "grant-pending") await expect(ancestry.getByRole("button", { name: "Turn on" })).toBeDisabled();
  } else if (recipe === "paused") {
    expect(facts.pauses.filter(item => item.ended_at === null)).toHaveLength(1);
    await expect(page.getByText("Sharing with this person is paused. Nothing about them shows here until one of you resumes it.", { exact: true })).toBeVisible();
    await expect(page.locator('[data-claim-block], [data-figure-kind], main a[href*="/reports"]')).toHaveCount(0);
  } else if (recipe === "preparing") {
    expect(facts.files).toHaveLength(1); expect(facts.files[0].status).toBe("uploaded");
    expect(facts.files[0].normalization_completed_at).toBeNull();
    if (row.route.id === "family.index") await expect(page.locator('[data-slot="person-card"] [data-slot="person-state"]')).toHaveText("No shared results yet");
    else {
      await expect(page.getByText("No completed result is shared yet.", { exact: true })).toBeVisible();
      await expect(page.getByText(/file yet/i)).toHaveCount(0);
      await expect(page.locator('[data-figure-kind], [data-claim-block]')).toHaveCount(0);
    }
  } else {
    expect(facts.files).toHaveLength(1); expect(facts.files[0].subject_id).toBe(subjectId);
    expect(facts.files[0].status).toBe("stored"); expect(facts.files[0].single_logical_sample_verified_at).not.toBeNull();
    if (row.route.id === "family.index") {
      // A populated hub reports readiness, never another adult's quantity
      // or a made-up Portrait result. Each tile retains its real disclosure.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(FAMILY_H1);
      const invitation = facts.invitations.filter(item => item.status === "accepted" && item.invitation_kind === "adult_subject");
      expect(invitation).toHaveLength(1);
      const handle = invitation[0].target_id as string;
      const card = page.locator('[data-slot="person-card"]');
      await expect(card).toHaveCount(1); await expect(card).toHaveAttribute("data-subject-id", handle);
      await expect(card.locator('[data-slot="person-state"]')).toHaveText(CARD_READY_STATUS);
      await expect(card.getByRole("link")).toHaveAttribute("href", `/family/s-${handle}`);
      await expect(page.locator('[data-slot="family-tile"]')).toHaveCount(HUB_TILES.length);
      const risks = page.locator('[data-tile="individual-risks"]');
      await expect(risks.getByRole("link")).toHaveAttribute("href", `/family/s-${handle}`);
      await expect(risks.locator('[data-slot="tile-blocked"]')).toHaveCount(0);
      // This pair chose only reports; it did not grant Portrait.
      expect(facts.family_pairs).toEqual([]);
      const portrait = page.locator('[data-tile="portrait"]');
      await expect(portrait.getByRole("link")).toHaveCount(0);
      await expect(portrait.locator('[data-slot="tile-blocked"]')).toHaveText(HUB_TILES.find(tile => tile.id === "portrait")!.blocked);
      const copilot = page.locator('[data-tile="copilot"]');
      await expect(copilot.getByRole("link")).toHaveAttribute("href", "/copilot/family");
      await expect(copilot.locator('[data-slot="tile-blocked"]')).toHaveCount(0);
      for (const tile of HUB_TILES) await expect(page.locator(`[data-tile="${tile.id}"]`)).toContainText(tile.description);
      await expect(page.getByRole("link", { name: ADD_ANOTHER_ADULT_BUTTON, exact: true })).toBeVisible();
      await expect(page.getByText(NOT_DIAGNOSTIC, { exact: true })).toBeVisible();
      await expect(page.locator('[data-figure-kind], [data-claim-block], [aria-sort]')).toHaveCount(0);
      return;
    }
    const name = (await page.locator('[data-subject-bar] [data-slot="subject-name"]').textContent())!.trim();
    await expect(page.getByText(BASELINE_ABSENT, { exact: true })).toHaveCount(1);
    if (recipe === "no-coverage") {
      expect(facts.user_prs.length).toBeGreaterThan(0);
      for (const panel of facts.user_prs) expect(panel.matched).toBe(0);
      for (const layer of ["estimate", "variant_call"] as const) {
        const section = page.locator(`[data-layer="${layer}"]`);
        await expect(section.getByText(noneCovered(name, layer), { exact: true })).toBeVisible();
        await expect(section.locator("a[href]")).toHaveCount(0);
        await expect(page.getByText(notShared(name, layer), { exact: true })).toHaveCount(0);
      }
      await expect(page.locator('[data-figure-kind], [data-claim-block]')).toHaveCount(0);
    } else {
      for (const slug of slugs) await expect(page.locator(`a[href$="/reports/${slug}"]`)).toHaveCount(1);
      if (recipe === "one-layer") await expect(page.getByText(`${name} has not shared Specific variants with you.`, { exact: true })).toBeVisible();
      else for (const layer of ["estimate", "variant_call"] as const)
        await expect(page.getByText(notShared(name, layer), { exact: true })).toHaveCount(0);
    }
  }
}

async function assertPermissionBoundary(page: Page, recipe: FamilyDensityRecipe, facts: Facts, subjectId: string, viewer: string) {
  const mine = facts.subjects.find(row => row.subject_account_id === viewer && row.subject_class === "self" && row.lifecycle === "active");
  const other = facts.subjects.find(row => row.id === subjectId && row.subject_class === "self" && row.lifecycle === "active");
  assert(mine && other && mine.id !== other.id && typeof other.subject_account_id === "string", "The two exact independent native adults are required");
  const invitations = facts.invitations.filter(row => row.invitation_kind === "adult_subject" && row.status === "accepted");
  expect(invitations).toHaveLength(1);
  const handle = facts.subjects.find(row => row.id === invitations[0].target_id);
  assert(handle && handle.subject_account_id === other.subject_account_id, "The accepted invitation must bind the same native counterpart");
  const name = other.display_label !== SELF_PLACEHOLDER_LABEL ? other.display_label
    : handle.display_label !== SELF_PLACEHOLDER_LABEL ? handle.display_label : UNNAMED_PERSON_LABEL;
  assert(typeof name === "string" && name.length > 0, "Actual counterpart label required");
  for (const table of ["files", "user_prs", "user_variants", "report_observed_calls", "ancestry_results", "own_completions", "portrait_results"])
    expect(facts[table], "This real permission state has no prepared or invented results").toEqual([]);
  expect(facts.signatures.length, "Genuine current native signed choices are required").toBeGreaterThan(0);
  await expect(page.locator('[data-figure-kind], [data-claim-block], [aria-sort], [data-slot="portrait-output"], [data-finding="true"]')).toHaveCount(0);
  if (recipe === "health-paused") {
    expect(directionalPurposes(facts, subjectId, viewer)).toEqual(["family.heritability"]);
    expect(directionalPurposes(facts, mine.id as string, other.subject_account_id)).toEqual(["family.heritability"]);
    expect(facts.pauses.filter(row => row.ended_at === null)).toHaveLength(1);
    expect(facts.family_pairs).toEqual([]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(HEALTH_PICTURE_H1);
    const blocked = page.locator('[data-slot="health-picture-blocking"]');
    await expect(blocked).toHaveAttribute("data-state", "consent-required");
    await expect(blocked).toContainText(pausedWith(name));
    await expect(blocked.getByRole("link", { name: OPEN_PERMISSIONS_LINK, exact: true }))
      .toHaveAttribute("href", `/family/s-${handle.id}/permissions`);
    await expect(page.locator('[data-slot="result-gate"], [data-slot="comparison-banner"], [data-slot="family-result-inputs"], table')).toHaveCount(0);
    return;
  }
  const pair = actualPortraitPair(facts, mine.id as string, subjectId);
  expect(directionalPurposes(facts, subjectId, viewer)).toEqual(["family.portrait"]);
  expect(facts.pauses.filter(row => row.ended_at === null)).toEqual([]);
  for (const person of [mine, other])
    assert(typeof person.independent_login_at === "string" && Number.isFinite(Date.parse(person.independent_login_at)), "Actual independent native logins required");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(PORTRAIT_H1);
  await expect(page.locator('[data-slot="pair-person"]')).toHaveCount(2);
  for (const person of [mine, other])
    await expect(page.locator(`[data-slot="pair-person"][data-subject-id="${person.id}"]`)).toHaveCount(1);
  if (recipe === "portrait-missing") {
    expect(pair.status).toBe("pending");
    expect(directionalPurposes(facts, mine.id as string, other.subject_account_id)).toEqual([]);
    expect(mine.portrait_acknowledged_at).toBeNull(); expect(other.portrait_acknowledged_at).toBeNull();
    const blocked = page.locator('[data-slot="portrait-blocking"]');
    await expect(blocked).toHaveAttribute("data-state", "consent-required"); await expect(blocked).toContainText(BLOCKING_BODY);
    await expect(blocked.locator(`[data-slot="portrait-missing-step"][data-subject-id="${mine.id}"][data-step="grant"]`))
      .toHaveText(viewerMissingStep(VIEWER_PORTRAIT_STEPS.grant));
    await expect(blocked.locator(`[data-slot="portrait-missing-step"][data-subject-id="${mine.id}"][data-step="acknowledged"]`))
      .toHaveText(viewerMissingStep(VIEWER_PORTRAIT_STEPS.acknowledged));
    await expect(blocked.locator(`[data-slot="portrait-missing-step"][data-subject-id="${other.id}"][data-step="acknowledged"]`))
      .toHaveText(missingStep(name, PORTRAIT_STEPS.acknowledged));
    await expect(blocked.locator('[data-slot="portrait-missing-step"]')).toHaveCount(3);
    await expect(blocked.locator('[data-step="account"], [data-step="independentLogin"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="portrait-acknowledge"], [data-slot="portrait-header-sentence"], [data-slot="result-gate"]')).toHaveCount(0);
  } else {
    assert(recipe === "portrait-empty", "Exact no-file Portrait branch required");
    expect(pair.status).toBe("current");
    expect(directionalPurposes(facts, mine.id as string, other.subject_account_id)).toEqual(["family.portrait"]);
    for (const person of [mine, other])
      assert(typeof person.portrait_acknowledged_at === "string" && Number.isFinite(Date.parse(person.portrait_acknowledged_at)), "Each actual adult must acknowledge independently");
    await expect(page.locator('[data-slot="portrait-blocking"], [data-slot="portrait-acknowledge"], [data-slot="result-gate"], [data-state="processing"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="portrait-header-sentence"]')).toHaveText(HEADER_SENTENCE);
    const empty = page.locator('[role="status"][data-state="empty"]'); await expect(empty).toHaveCount(1);
    await expect(empty).toContainText(VIEWER_NO_FILE_YET); await expect(empty).toContainText(noFileYet(name));
    await expect(empty.locator("p")).toHaveCount(2);
  }
}
