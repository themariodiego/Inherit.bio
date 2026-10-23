import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { expect } from "../audited-test";
import { acceptAdultInvitation, adminClient, adultInvitationToken, adultInvitationUrl,
  createConfirmedUser, drainMailUntil, signIn, uploadOwnFileThroughUi } from "../helpers";
import { ownRunCompletions, uploadOwnFileWithChosenReports } from "../own-report-helpers";
import { buildCarrierPairVcf, verify } from "../fixtures/carrier-pair-fixture";
import { PERMISSION_ROWS } from "../../src/copy/family/permissions";
import { OWN_UPLOAD_COPY } from "../../src/copy/upload/consent";
import { CELL_FILE_PREPARING, CELL_NO_PREPARED_FILE, CELL_NO_FILE } from "../../src/copy/family/health-picture";
import { GATE_CHECKBOX_LABEL } from "../../src/copy/family/person";
import { subjectProcessingReceipt } from "../../src/lib/uploads/subject-upload-contract";
import { localE2eProject } from "../../scripts/local-e2e-project";
import { remainingDensityRecipe } from "../../scripts/density-remaining-real-states";
import { checkedAppEnvironment } from "../../scripts/ci-browser-config";
import { healthPictureDensityRecipe, checkedHealthPictureLayerWithdrawal,
  checkedHealthPicturePreparationHold, HEALTH_PICTURE_DENSITY_NATIVE_SOURCES } from "../../scripts/density-health-picture-states";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import { signOut } from "./session-csrf";

type Facts = Record<string, Record<string, unknown>[]>;
type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
interface ActualEmail { to: string[] | string; html?: string }

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

async function boundaryFacts(accountIds: [string, string]): Promise<Facts> {
  const facts = await fullPair(accountIds), admin = adminClient();
  const subjectIds = facts.subjects.map(row => row.id as string);
  for (const [name, query] of [
    ["bindings", admin.from("subject_account_bindings").select("*", { count: "exact" }).in("subject_id", subjectIds)],
    ["relationships", admin.from("subject_relationships").select("*", { count: "exact" }).in("subject_id", subjectIds)],
    ["signatures", admin.from("consent_signatures").select("*", { count: "exact" }).in("signer_account_id", accountIds)],
    ["subject_consents", admin.from("subject_consents").select("*", { count: "exact" }).in("subject_id", subjectIds)],
  ] as const) {
    const result = await query; expect(result.error).toBeNull(); expect(result.count).not.toBeNull();
    expect(result.data!.length).toBe(result.count); facts[name] = result.data!;
  }
  const artifactIds = [...new Set(facts.signatures.map(row => row.artifact_key as string))];
  const artifacts = artifactIds.length ? await admin.from("consent_artifacts").select("*", { count: "exact" }).in("artifact_key", artifactIds) : null;
  if (artifacts) { expect(artifacts.error).toBeNull(); expect(artifacts.count).not.toBeNull(); expect(artifacts.data!.length).toBe(artifacts.count); }
  facts.artifacts = artifacts?.data ?? [];
  const fileIds = facts.files.map(row => row.id as string), grantIds = facts.grants.map(row => row.grant_id as string);
  assert(fileIds.every(id => /^[a-f0-9-]{36}$/.test(id)) && grantIds.every(id => /^[a-f0-9-]{36}$/.test(id)), "Only exact owned native identifiers may enter the readonly proof");
  const fileSet = fileIds.map(id => `'${id}'::uuid`).join(","), grantSet = grantIds.map(id => `'${id}'::uuid`).join(",");
  assert(fileSet && grantSet, "Actual source and sharing records required");
  // Entire private rows are hashed before transport; no field, duplicate or
  // NULL is omitted. These read-only native checks neither publish nor adopt.
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)("docker", ["exec", localE2eProject(process.env).dbContainer, "psql", "-U", "postgres",
      "-d", "postgres", "-XqAt", "--set=ON_ERROR_STOP=1", "--command", `
      begin read only; set local statement_timeout='10s';
      select json_build_object(
        'private_own_runs',(select coalesce(json_agg(hash order by hash),'[]'::json) from
          (select encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex') hash from private.own_analysis_runs r where file_id in (${fileSet})) rows),
        'private_normalization_runs',(select coalesce(json_agg(hash order by hash),'[]'::json) from
          (select encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex') hash from private.own_normalization_runs r where file_id in (${fileSet})) rows),
        'private_normalization_batches',(select coalesce(json_agg(hash order by hash),'[]'::json) from
          (select encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex') hash from private.own_normalization_batches r where file_id in (${fileSet})) rows),
        'private_joint_snapshots',(select coalesce(json_agg(hash order by hash),'[]'::json) from
          (select encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex') hash from private.health_picture_grant_snapshots r where grant_id in (${grantSet})) rows));
      rollback;`], { timeout: 10_000, maxBuffer: 8192 }));
  } catch { throw new Error("Complete Health Picture readonly native proof unavailable"); }
  const privateRows: unknown = JSON.parse(stdout.trim());
  assert(privateRows && typeof privateRows === "object" && !Array.isArray(privateRows), "Exact whole-row native hash bags required");
  const keys = ["private_own_runs", "private_normalization_runs", "private_normalization_batches", "private_joint_snapshots"];
  assert.deepEqual(Object.keys(privateRows).sort(), [...keys].sort());
  for (const name of keys) {
    const rows: unknown = (privateRows as Record<string, unknown>)[name];
    assert(Array.isArray(rows) && rows.every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)), "Only full native row hashes may be transported");
    facts[name] = rows.map(rowSha256 => ({ rowSha256 }));
  }
  for (const rows of Object.values(facts)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return facts;
}

async function holdPreparation(page: Page) {
  let release!: () => void, intercepted = 0, continuation: Promise<void> | undefined, fileId: string | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const routeHandler = async (route: Route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    assert(++intercepted === 1, "Exactly one original Health Picture preparation POST required");
    const matched = new URL(route.request().url()).pathname.match(/^\/api\/files\/([a-f0-9-]{36})\/process$/);
    assert(matched, "Exact real own-file preparation route required"); fileId = matched[1];
    continuation = (async () => {
      await pending; await route.continue();
      const response = await route.request().response();
      assert(response && await response.finished() === null && response.status() === 200, "Actual preparation must settle successfully");
      assert(subjectProcessingReceipt.parse(await response.json()).fileId === fileId, "Original preparation response must name the held source");
    })();
    void continuation.catch(() => {}); await continuation;
  };
  await page.route("**/api/files/*/process", routeHandler);
  return { assertHeld: async (expectedFileId: string) => {
    await expect.poll(() => intercepted).toBe(1); assert(fileId === expectedFileId, "Only the exact uploaded source is held");
  }, settle: async () => { release(); if (continuation) await continuation;
    await page.unroute("**/api/files/*/process", routeHandler); } };
}

/** Four additional source providers, each in a newly admitted disposable
 * native runtime for one viewport. The old Family, Portrait and Health Picture
 * specifications remain unchanged. This does not supply a runtime admission,
 * screenshot, density comparison or clinical/scientific acceptance. */
export interface HealthPictureDensityInput {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  findActualInvitation: (recipient: string) => ActualEmail | undefined;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountIds: [string, string]; nativeSnapshot: Facts }) => Promise<unknown>;
}
function healthPictureFixtures(input: HealthPictureDensityInput, projection: "health-picture" | "overview-jurisdiction",
  readActualAppEnvironment?: (origin: string) => Promise<unknown>): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
    "Existing disposable served app required");
  if (HEALTH_PICTURE_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-health-picture-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  const sources = [sourcePath, "scripts/density-health-picture-states.ts", "scripts/density-remaining-real-states.ts",
    "scripts/ci-browser-config.ts", "src/app/(app)/overview/page.tsx", ...HEALTH_PICTURE_DENSITY_NATIVE_SOURCES]
    .map(name => ({ name, sha256: createHash("sha256").update(fs.readFileSync(path.join(input.root, name))).digest("hex") }));
  const assertSource = () => { for (const source of sources)
    assert(createHash("sha256").update(fs.readFileSync(path.join(input.root, source.name))).digest("hex") === source.sha256,
      "Complete reviewed Health Picture source changed"); };
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = projection === "health-picture" ? healthPictureDensityRecipe(row)
      : remainingDensityRecipe(row) === "overview-jurisdiction" ? "overview-jurisdiction" : null;
    if (!recipe) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
      withState: async ({ viewport }, capture) => {
        assertSource();
        await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
          assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "Exact composed source required");
          for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
            "INHERIT_UPLOAD_SIGNING_JWK", "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID",
            "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "JOBS_SECRET"])
            assert(environment[name] === process.env[name], "Actual app, native source and selected mail worker must match");
          assert(typeof environment.JOBS_SECRET === "string" && environment.JOBS_SECRET.length > 0, "Selected actual mail job authorization required");
          if (operator) {
            const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
            for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
              assert(process.env[name] === value, "Actual Root-owned daemon and scratch must match");
          }
          const { localE2eProject } = await import("../../scripts/local-e2e-project");
          assert(localE2eProject(environment).projectId === "sequence", "Fresh disposable native project required");

          if (recipe === "overview-jurisdiction") {
            assert(origin.origin === "http://localhost:3100" && readActualAppEnvironment, "Original main/OFF runtime pair required");
            const main = checkedAppEnvironment(await readActualAppEnvironment(origin.origin), 3100);
            const off = checkedAppEnvironment(await readActualAppEnvironment("http://localhost:3101"), 3101);
            for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "INHERIT_UPLOAD_SIGNING_JWK", "JOBS_SECRET"])
              assert(main[name] === off[name] && main[name] === environment[name], "Same actual native database, signing authority and job caller required");
          }
          const options = { baseURL: origin.origin, viewport, deviceScaleFactor: 1, colorScheme: "light" as const,
            reducedMotion: "reduce" as const, locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" as const };
          const context = await input.browser.newContext(options), page = await context.newPage();
          let viewingContext: BrowserContext | undefined, held: Awaited<ReturnType<typeof holdPreparation>> | undefined;
          let capturedPage = page;
          const A = { email: `density-hp-a-${randomUUID()}@e2e.local`, password: "e2e-family-hp-pw" };
          const B = { email: `density-hp-b-${randomUUID()}@e2e.local`, password: "e2e-family-hp-pw" };
          const FIXTURE = path.join(input.root, "e2e/fixtures/carrier-pair-grch38.vcf");
          const TINY_FIXTURE = path.join(input.root, "e2e/fixtures/tiny-grch38.vcf");
          let accountA = "", accountB = "", selfSubjectA = "", selfSubjectB = "", invitedSubjectB = "", heldFileId = "";
          const sourceFileIds: string[] = [], grantsFromB = new Map<GrantedPurpose, string>();
          let sourceBefore: unknown, ownGrantsBefore: unknown;
          const facts = () => boundaryFacts([accountA, accountB]);
const BANNER =
  "These are different people compared against different baselines. A bigger number in one column does not mean that person is worse off.";
const NO_RANKING = "Inherit does not rank embryos and does not recommend one.";
const NOTHING_PICKS =
  "Nothing here picks between people. A lower chance on one row for one person says nothing about any other row or person.";
const AVAILABILITY =
  "This page shows 2 people because 2 people have agreed to be seen side by side. It shows nothing about anyone who has not.";
const BASELINE_ABSENT =
  "No baseline: Inherit does not know this person’s sex and age band.";
const GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";
const GATE_BUTTON = "Show what’s shared";
const NO_CLASSIFIED_POSITIONS =
  "This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.";
const NOT_SHARED_CELL = "Not shared with you";

/** The three purposes each account grants the other: the joint one and the two report layers. */
const GRANTED_PURPOSES = ["family.heritability", "reports.monogenic", "reports.polygenic"] as const;
type GrantedPurpose = (typeof GRANTED_PURPOSES)[number];

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return data!.id;
}

async function declareAdulthood(page: Page) {
  await page.goto("/files/upload");
  const account = page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true });
  const insurance = page.getByRole("heading", { name: OWN_UPLOAD_COPY.insuranceHeading, exact: true });
  await expect(account.or(insurance).first()).toBeVisible();
  if (!(await account.isVisible())) return;
  await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
  const completed = page.waitForResponse((response) => response.url().endsWith("/api/account/completion")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
  expect((await completed).status()).toBe(200);
  await expect(insurance).toBeVisible();
}

async function originalSetSharingPurpose(page: Page, recipientHandle: string, purpose: GrantedPurpose, enabled: boolean) {
  await page.goto(`/family/s-${recipientHandle}/permissions`);
  const label = PERMISSION_ROWS.find(row => row.id === purpose)!.label;
  const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: new RegExp(`^${label}$`) }) });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText(enabled ? "Off" : "On");
  const response = page.waitForResponse(response => response.request().method() === "POST"
    && (enabled ? response.url().endsWith("/api/consents")
      : response.url().endsWith(`/api/consents/${grantsFromB.get(purpose)}/revoke`)));
  await row.getByRole("button", { name: enabled ? /^Turn on / : /^Turn off / }).click();
  const result = await response;
  expect(result.status()).toBe(enabled ? 201 : 200);
  const receipt = await result.json();
  expect(receipt).toMatchObject(enabled ? { recordKind: "purpose_grant", purposeKey: purpose,
    artifactKey: "consent.share-with-adult" } : { revoked: true });
  if (enabled) expect(receipt.recordId).toMatch(/^[0-9a-f-]{36}$/);
  else expect(Number.isFinite(Date.parse(receipt.effectiveAt))).toBe(true);
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText(enabled ? "On" : "Off");
  return enabled ? receipt.recordId as string : null;
}

          async function setSharingPurpose(page: Page, recipientHandle: string, purpose: GrantedPurpose, enabled: boolean) {
            if (enabled) return originalSetSharingPurpose(page, recipientHandle, purpose, enabled);
            assert(purpose === "reports.polygenic" && recipientHandle === selfSubjectA, "Only B's real estimates withdrawal is prepared");
            const before = await facts(), id = grantsFromB.get(purpose); assert(id, "Actual prior native grant receipt required");
            const result = await originalSetSharingPurpose(page, recipientHandle, purpose, enabled);
            checkedHealthPictureLayerWithdrawal(before, await facts(), id); return result;
          }
async function sourceReceipt() {
  const result = await adminClient().from("genome_files")
    .select("id,user_id,subject_id,sha256,source_sha256,storage_object_id,size_bytes,status,upload_revision,normalization_source_revision,normalization_completed_at")
    .in("id", sourceFileIds).order("id");
  expect(result.error).toBeNull(); expect(result.data).toHaveLength(2);
  return result.data;
}

async function ownGrantReceipt() {
  const result = await adminClient().from("purpose_grants")
    .select("grant_id,grant_revision,target_id,purpose,revoked_at")
    .in("target_id", [selfSubjectA, selfSubjectB])
    .in("artifact_key", ["consent.own-monogenic", "consent.own-polygenic"]).order("grant_id");
  expect(result.error).toBeNull(); expect(result.data).toHaveLength(4);
  expect(result.data!.every(row => row.revoked_at === null)).toBe(true);
  return result.data;
}

async function expectSourcesAndOwnPermissionsPreserved() {
  expect(await sourceReceipt()).toEqual(sourceBefore);
  expect(await ownGrantReceipt()).toEqual(ownGrantsBefore);
}

async function originalPassGate(page: Page) {
  await page.goto("/family/health-picture");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();
}

          async function passGate(page: Page) {
            expect(GATE_CHECKBOX).toBe(GATE_CHECKBOX_LABEL);
            const acknowledged = page.waitForResponse(response => response.request().method() === "POST"
              && new URL(response.url()).pathname === "/api/family/acknowledge");
            void acknowledged.catch(() => {}); await originalPassGate(page);
            const response = await acknowledged; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
            expect(response.request().postDataJSON()).toEqual({ acknowledgement: "tier2-result-gate", affirmed: true });
            const cookies = (await page.context().cookies()).filter(cookie => cookie.name === "inherit_family_gate");
            expect(cookies).toHaveLength(1); expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
          }
          async function prepareBoth(page: Page, fixtureCheck: Awaited<ReturnType<typeof verify>>) {
  const fixture = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");
  const measure = fixtureCheck.measure;
  if (measure.status !== "measured") throw new Error("the fixture calculator must remain measurable");
  expect(measure.aboveThreshold).toBe(false);
  expect(measure.runCount).toBeGreaterThanOrEqual(1);
  expect(measure.totalRunBases).toBeGreaterThan(0);
  expect(measure.coveredSpanBases).toBeGreaterThan(0);
  expect(measure.fRoh).toBeCloseTo(measure.totalRunBases / measure.coveredSpanBases, 6);
  for (const account of [A, B]) {
    await signIn(page, account.email, account.password);
    sourceFileIds.push(await uploadOwnFileWithChosenReports(page, fixture, { fileType: "vcf",
      purposes: ["reports.monogenic", "reports.polygenic"] }));
    await signOut(page);
  }
  sourceBefore = await sourceReceipt();
  ownGrantsBefore = await ownGrantReceipt();
  // Canonical preparation measures runs of homozygosity from the verified
  // bytes as they stream past (record_own_normalization_runs_v1, #256), so
  // each prepared source holds exactly the measure the real calculator gives
  // this fixture: never a stamped or guessed row.
  const roh = await adminClient().from("genome_files")
    .select("roh_status,roh_reason,roh_total_bases,roh_covered_bases,roh_fraction,roh_measured_at").in("id", sourceFileIds);
  expect(roh.error).toBeNull(); expect(roh.data).toHaveLength(2);
  for (const row of roh.data!) {
    expect(row.roh_status).toBe("measured");
    expect(row.roh_reason).toBeNull();
    expect(Number(row.roh_total_bases)).toBe(measure.totalRunBases);
    expect(Number(row.roh_covered_bases)).toBe(measure.coveredSpanBases);
    expect(Number(row.roh_fraction)).toBeCloseTo(measure.fRoh, 6);
    expect(row.roh_measured_at).not.toBeNull();
  }

          }
          async function establishPair(page: Page) {
  // Acceptance links real accounts; it does not share their existing own reports.
  await signIn(page, A.email, A.password);
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");
  const token = await drainMailUntil(page.request, () => adultInvitationToken(input.findActualInvitation(B.email)?.html),
    "the invitation", environment.JOBS_SECRET);
  await signOut(page);
  await acceptAdultInvitation({
    page, invitationUrl: adultInvitationUrl(token, origin.origin), email: B.email, password: B.password, origin: input.origin,
  });
  // This was B's actual acceptance session. A's Family route names the invited
  // representative, while every source assertion still names B's own self.
  const admin = adminClient();
  const inviter = await admin.from("subject_principals").select("id")
    .eq("account_id", accountA).eq("subject_id", selfSubjectA)
    .eq("principal_kind", "account_subject").eq("status", "active").single();
  expect(inviter.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id,invitee_principal_id,accepted_at")
    .eq("inviter_principal_id", inviter.data!.id).eq("invitation_kind", "adult_subject")
    .eq("target_kind", "subject").eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  expect(invitation.data!.accepted_at).not.toBeNull();
  expect(invitation.data!.invitee_principal_id).not.toBeNull();
  invitedSubjectB = invitation.data!.target_id;
  expect(invitedSubjectB).not.toBe(selfSubjectB);
  const representative = await admin.from("subjects")
    .select("id,subject_class,subject_account_id,owner_account_id,lifecycle").eq("id", invitedSubjectB).single();
  expect(representative.error).toBeNull();
  expect(representative.data).toEqual({ id: invitedSubjectB, subject_class: "other_adult",
    subject_account_id: accountB, owner_account_id: null, lifecycle: "active" });
  const invitee = await admin.from("subject_principals").select("account_id,subject_id,principal_kind,status")
    .eq("id", invitation.data!.invitee_principal_id!).single();
  expect(invitee.error).toBeNull();
  expect(invitee.data).toEqual({ account_id: accountB, subject_id: invitedSubjectB, principal_kind: "account_subject", status: "active" });
  const binding = await admin.from("subject_account_bindings").select("account_principal_id")
    .eq("subject_id", invitedSubjectB).eq("subject_principal_id", invitation.data!.invitee_principal_id!)
    .eq("account_id", accountB).eq("binding_kind", "adult_claim").eq("status", "current").is("ended_at", null).single();
  expect(binding.error).toBeNull();
  const boundSelf = await admin.from("subject_principals").select("account_id,subject_id,principal_kind,status")
    .eq("id", binding.data!.account_principal_id).single();
  expect(boundSelf.error).toBeNull();
  expect(boundSelf.data).toEqual({ account_id: accountB, subject_id: selfSubjectB, principal_kind: "account_subject", status: "active" });
  await signOut(page);
  // B signs in independently and only reads the permission presentation.
  await signIn(page, B.email, B.password);
  await page.goto(`/family/s-${selfSubjectA}/permissions`);
  await expect(page.getByRole("heading", { name: "Permissions", exact: true })).toBeVisible();
  const grants = await adminClient().from("directional_grants").select("grant_id")
    .in("recipient_account_id", [accountA, accountB]).eq("direction", "subject_to_recipient").eq("status", "current");
  expect(grants.error).toBeNull(); expect(grants.data).toEqual([]);
          }
          async function auditComplete(page: Page) {
  await signIn(page, A.email, A.password);
  await passGate(page);

  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText(
    "Family / Family health picture",
  );
  const headings = page.locator("main :is(h1, h2, h3, h4, h5, h6)");
  expect(await headings.count()).toBeLessThanOrEqual(6);

  await expect(page.locator('[data-slot="comparison-banner"]')).toHaveText(BANNER);
  await expect(page.locator("details", { hasText: BANNER })).toHaveCount(0);

  // The trade-off panel: a statement, never a computation, and never hidden.
  const panel = page.locator("[data-trade-off-panel]");
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText(NOTHING_PICKS);
  await expect(panel).toContainText(NO_RANKING);
  await expect(panel).toContainText(AVAILABILITY);
  await expect(page.locator("details [data-trade-off-panel]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="trade-off-row"]')).toHaveCount(2);

  // One table per layer, and no table mixes two layers.
  const tables = page.locator("[data-compare-surface]");
  const tableCount = await tables.count();
  expect(tableCount).toBe(2);
  const layers = await tables.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-layer")),
  );
  expect(new Set(layers)).toEqual(new Set(["variant_call", "estimate"]));
  for (let index = 0; index < tableCount; index++) {
    await expect(tables.nth(index).locator("caption")).toHaveCount(1);
  }

  // Every cell is its own attributed claim block, and it names one subject.
  const cellBlocks = page.locator('[data-slot="health-picture-cell"] [data-claim-block]');
  expect(await cellBlocks.count()).toBeGreaterThan(0);
  const attributions = await cellBlocks.evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-subject-id"),
      pair: node.getAttribute("data-subject-pair"),
    })),
  );
  for (const attribution of attributions) {
    expect(attribution.id).toBeTruthy();
    expect(attribution.pair).toBeNull();
  }
  expect(new Set(attributions.map((attribution) => attribution.id))).toEqual(
    new Set([selfSubjectA, selfSubjectB]),
  );

  // With both report layers granted, the other adult's covered cells carry their
  // letters as observed genotype figures, and no cell says "not shared".
  const lettersOfB = page.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfB.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-slot="cell-absence"]', { hasText: NOT_SHARED_CELL })).toHaveCount(0);
  // Nor is any cell missing a SOURCE. These two absences mean the page is not
  // showing everything it could; a coverage absence does not, which is why
  // only these two are asserted to zero.
  await expect(page.getByText(CELL_NO_PREPARED_FILE, { exact: true }),
    "no column is waiting on a file to be prepared").toHaveCount(0);
  await expect(page.getByText(CELL_NO_FILE, { exact: true }),
    "and none is waiting on a file at all").toHaveCount(0);

  // These are actual fixture calls rendered from each separately completed
  // stored report, not synthetic clinical labels or a shared genotype map.
  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  for (const [index, subjectId, segment] of [[0, selfSubjectA, "me"], [1, selfSubjectB, `s-${invitedSubjectB}`]] as const) {
    for (const [slug, genotype] of [["caffeine-metabolism-cyp1a2-rs762551", "A/C"], ["lactase-persistence-lct-rs4988235", "A/A"]]) {
      const row = estimates.locator(`[data-report-slug="${slug}"]`);
      const source = row.locator(`[data-source-file-id="${sourceFileIds[index]}"]`);
      await expect(source).toHaveCount(1);
      await expect(source.locator(`[data-claim-block][data-subject-id="${subjectId}"] [data-figure-kind="genotype"]`)).toContainText(genotype);
      await expect(source.getByRole("link", { name: /Open/ })).toHaveAttribute("href",
        `/genome/${segment}/reports/${slug}?source=${sourceFileIds[index]}`);
    }
  }
  await expect(page.locator('[data-slot="subject-files"]')).toHaveCount(0);

  // Nothing sorts, ranks or sums.
  await expect(page.locator("[aria-sort]")).toHaveCount(0);
  await expect(page.locator("th button")).toHaveCount(0);
  await expect(page.locator("[data-compare-surface] button")).toHaveCount(0);
  const content = await page.content();
  expect(content).not.toMatch(/aria-sort/);

  // The mandated footer appears once per column in EACH rendered layer table.
  const footers = page.locator('[data-slot="column-footer"]');
  await expect(footers).toHaveCount(2 * tableCount);
  for (let index = 0; index < 2 * tableCount; index++) {
    await expect(footers.nth(index)).toHaveText(BASELINE_ABSENT);
  }

  // Acceptance 20: nothing on this page says how these two people are related.
  expect(content).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);

  // Follow each real saved-source link: the own route and recipient route must
  // both show the captured call with source provenance, not just a valid href.
  const slug = "caffeine-metabolism-cyp1a2-rs762551";
  for (const [index, subjectId, segment] of [[0, selfSubjectA, "me"], [1, selfSubjectB, `s-${invitedSubjectB}`]] as const) {
    const sourceLink = page.locator(`[data-compare-surface][data-layer="estimate"] [data-report-slug="${slug}"] [data-source-file-id="${sourceFileIds[index]}"]`)
      .getByRole("link", { name: /Open/ });
    const expectedPath = `/genome/${segment}/reports/${slug}?source=${sourceFileIds[index]}`;
    await sourceLink.click();
    await expect(page).toHaveURL(new URL(expectedPath, page.url()).toString());
    await expect(page.locator(`[data-claim-block][data-subject-id="${subjectId}"] [data-figure-kind="genotype"]`)).toContainText("A/C");
    const provenance = page.locator('[data-slot="input-provenance"]');
    await expect(provenance).toBeVisible();
    await expect(provenance.locator('[data-slot="input-source"]')).toHaveCount(1);
    await expect(provenance).toContainText("No change of genome coordinates was needed.");
    // The same session already acknowledged Tier-2 before opening the report.
    await page.goto("/family/health-picture");
    await expect(page.locator('[data-compare-surface][data-layer="estimate"]')).toBeVisible();
  }
          }
          async function assertComplete(page: Page) {
  await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveText(
    "Family / Family health picture",
  );
  const headings = page.locator("main :is(h1, h2, h3, h4, h5, h6)");
  expect(await headings.count()).toBeLessThanOrEqual(6);

  await expect(page.locator('[data-slot="comparison-banner"]')).toHaveText(BANNER);
  await expect(page.locator("details", { hasText: BANNER })).toHaveCount(0);

  // The trade-off panel: a statement, never a computation, and never hidden.
  const panel = page.locator("[data-trade-off-panel]");
  await expect(panel).toHaveCount(1);
  await expect(panel).toContainText(NOTHING_PICKS);
  await expect(panel).toContainText(NO_RANKING);
  await expect(panel).toContainText(AVAILABILITY);
  await expect(page.locator("details [data-trade-off-panel]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="trade-off-row"]')).toHaveCount(2);

  // One table per layer, and no table mixes two layers.
  const tables = page.locator("[data-compare-surface]");
  const tableCount = await tables.count();
  expect(tableCount).toBe(2);
  const layers = await tables.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-layer")),
  );
  expect(new Set(layers)).toEqual(new Set(["variant_call", "estimate"]));
  for (let index = 0; index < tableCount; index++) {
    await expect(tables.nth(index).locator("caption")).toHaveCount(1);
  }

  // Every cell is its own attributed claim block, and it names one subject.
  const cellBlocks = page.locator('[data-slot="health-picture-cell"] [data-claim-block]');
  expect(await cellBlocks.count()).toBeGreaterThan(0);
  const attributions = await cellBlocks.evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-subject-id"),
      pair: node.getAttribute("data-subject-pair"),
    })),
  );
  for (const attribution of attributions) {
    expect(attribution.id).toBeTruthy();
    expect(attribution.pair).toBeNull();
  }
  expect(new Set(attributions.map((attribution) => attribution.id))).toEqual(
    new Set([selfSubjectA, selfSubjectB]),
  );

  // With both report layers granted, the other adult's covered cells carry their
  // letters as observed genotype figures, and no cell says "not shared".
  const lettersOfB = page.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfB.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-slot="cell-absence"]', { hasText: NOT_SHARED_CELL })).toHaveCount(0);
  // Nor is any cell missing a SOURCE. These two absences mean the page is not
  // showing everything it could; a coverage absence does not, which is why
  // only these two are asserted to zero.
  await expect(page.getByText(CELL_NO_PREPARED_FILE, { exact: true }),
    "no column is waiting on a file to be prepared").toHaveCount(0);
  await expect(page.getByText(CELL_NO_FILE, { exact: true }),
    "and none is waiting on a file at all").toHaveCount(0);

  // These are actual fixture calls rendered from each separately completed
  // stored report, not synthetic clinical labels or a shared genotype map.
  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  for (const [index, subjectId, segment] of [[0, selfSubjectA, "me"], [1, selfSubjectB, `s-${invitedSubjectB}`]] as const) {
    for (const [slug, genotype] of [["caffeine-metabolism-cyp1a2-rs762551", "A/C"], ["lactase-persistence-lct-rs4988235", "A/A"]]) {
      const row = estimates.locator(`[data-report-slug="${slug}"]`);
      const source = row.locator(`[data-source-file-id="${sourceFileIds[index]}"]`);
      await expect(source).toHaveCount(1);
      await expect(source.locator(`[data-claim-block][data-subject-id="${subjectId}"] [data-figure-kind="genotype"]`)).toContainText(genotype);
      await expect(source.getByRole("link", { name: /Open/ })).toHaveAttribute("href",
        `/genome/${segment}/reports/${slug}?source=${sourceFileIds[index]}`);
    }
  }
  await expect(page.locator('[data-slot="subject-files"]')).toHaveCount(0);

  // Nothing sorts, ranks or sums.
  await expect(page.locator("[aria-sort]")).toHaveCount(0);
  await expect(page.locator("th button")).toHaveCount(0);
  await expect(page.locator("[data-compare-surface] button")).toHaveCount(0);
  const content = await page.content();
  expect(content).not.toMatch(/aria-sort/);

  // The mandated footer appears once per column in EACH rendered layer table.
  const footers = page.locator('[data-slot="column-footer"]');
  await expect(footers).toHaveCount(2 * tableCount);
  for (let index = 0; index < 2 * tableCount; index++) {
    await expect(footers.nth(index)).toHaveText(BASELINE_ABSENT);
  }

  // Acceptance 20: nothing on this page says how these two people are related.
  expect(content).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);

          }
          async function auditPartial(page: Page) {
  // B withdraws the estimates layer toward A; the joint grant and the
  // variant layer stay. The column still opens on the joint grant, and so
  // does the carrier panel; the cells of that layer do not (D-038).
  await signIn(page, B.email, B.password);
  await setSharingPurpose(page, selfSubjectA, "reports.polygenic", false);
  await expectSourcesAndOwnPermissionsPreserved();
  const remaining = await adminClient().from("purpose_grants").select("grant_id,revoked_at")
    .in("grant_id", [grantsFromB.get("reports.monogenic")!, grantsFromB.get("family.heritability")!]);
  expect(remaining.error).toBeNull(); expect(remaining.data).toHaveLength(2);
  expect(remaining.data!.every(row => row.revoked_at === null)).toBe(true);
  await signOut(page);

  await signIn(page, A.email, A.password);
  await passGate(page);

  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  await expect(estimates).toHaveCount(1);
  await expect(estimates.locator(`th[data-subject-id="${selfSubjectB}"]`)).toHaveCount(1);

  const cellsOfB = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"]`,
  );
  const count = await cellsOfB.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await expect(cellsOfB.nth(index).locator('[data-slot="cell-absence"]')).toHaveText(NOT_SHARED_CELL);
    await expect(cellsOfB.nth(index).locator("[data-figure-kind]")).toHaveCount(0);
    await expect(cellsOfB.nth(index).locator("a")).toHaveCount(0);
  }

  // The viewer's own cells are untouched.
  const lettersOfA = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectA}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfA.count()).toBeGreaterThan(0);

  // B's independently shared variant-call layer remains available. Its
  // current catalog may have no covered report in this fixture; do not invent
  // a positive call or require a nonexistent report link to prove permission.
  const variantStatusOfB = page.locator(`[data-compare-surface][data-layer="variant_call"] [data-slot="health-picture-column-status"] [data-claim-block][data-subject-id="${selfSubjectB}"]`);
  await expect(variantStatusOfB).toHaveCount(1);
  await expect(variantStatusOfB).not.toContainText(NOT_SHARED_CELL);

  // The joint section stays, with the same unavailable clinical state.
  await expect(page.locator('[data-slot="carrier-panel"] [data-claim-block]')).toHaveCount(
    0,
  );
  await expect(page.locator('[data-slot="carrier-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(page.locator('[data-slot="column-footer"]')).toHaveCount(4);
          }
          async function assertPartial(page: Page) {
  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  await expect(estimates).toHaveCount(1);
  await expect(estimates.locator(`th[data-subject-id="${selfSubjectB}"]`)).toHaveCount(1);

  const cellsOfB = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"]`,
  );
  const count = await cellsOfB.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await expect(cellsOfB.nth(index).locator('[data-slot="cell-absence"]')).toHaveText(NOT_SHARED_CELL);
    await expect(cellsOfB.nth(index).locator("[data-figure-kind]")).toHaveCount(0);
    await expect(cellsOfB.nth(index).locator("a")).toHaveCount(0);
  }

  // The viewer's own cells are untouched.
  const lettersOfA = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectA}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfA.count()).toBeGreaterThan(0);

  // B's independently shared variant-call layer remains available. Its
  // current catalog may have no covered report in this fixture; do not invent
  // a positive call or require a nonexistent report link to prove permission.
  const variantStatusOfB = page.locator(`[data-compare-surface][data-layer="variant_call"] [data-slot="health-picture-column-status"] [data-claim-block][data-subject-id="${selfSubjectB}"]`);
  await expect(variantStatusOfB).toHaveCount(1);
  await expect(variantStatusOfB).not.toContainText(NOT_SHARED_CELL);

  // The joint section stays, with the same unavailable clinical state.
  await expect(page.locator('[data-slot="carrier-panel"] [data-claim-block]')).toHaveCount(
    0,
  );
  await expect(page.locator('[data-slot="carrier-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(page.locator('[data-slot="column-footer"]')).toHaveCount(4);

          }
          async function auditUncovered(page: Page) {
  await signIn(page, A.email, A.password);
  await passGate(page);
  const panel = page.locator('[data-slot="carrier-panel"]');
  await expect(panel).toHaveCount(1);
  await expect(panel.locator("[data-claim-block]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="carrier-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(panel).not.toContainText("checked the");
  await expect(panel).not.toContainText("0 positions");
  // The independently generated report table remains available. Its presence,
  // with the panel above, is what separates this from `empty`: that state
  // renders neither.
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();
          }
          async function assertUncovered(page: Page) {
  const panel = page.locator('[data-slot="carrier-panel"]');
  await expect(panel).toHaveCount(1);
  await expect(panel.locator("[data-claim-block]")).toHaveCount(0);
  await expect(panel.locator('[data-slot="carrier-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(panel).not.toContainText("checked the");
  await expect(panel).not.toContainText("0 positions");
  // The independently generated report table remains available. Its presence,
  // with the panel above, is what separates this from `empty`: that state
  // renders neither.
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();
          }
          async function auditProcessing(page: Page) {
  await signIn(page, B.email, B.password);
  await page.goto("/family/health-picture");

  // The domain's one Tier-2 gate stands in front of the record.
  await expect(page.getByText(GATE_CHECKBOX_LABEL, { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();

  // A's column is on the page under the joint grant, and its status is the
  // in-flight sentence: not the absent-file sentence, and no result.
  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  await expect(estimates).toHaveCount(1);
  await expect(estimates.locator(`th[data-subject-id="${selfSubjectA}"]`)).toHaveCount(1);
  const statusOfA = estimates.locator(
    `[data-slot="health-picture-column-status"] [data-claim-block][data-subject-id="${selfSubjectA}"]`,
  );
  await expect(statusOfA).toHaveCount(1);
  await expect(statusOfA.locator('[data-slot="cell-absence"]')).toHaveText(CELL_FILE_PREPARING);
  await expect(statusOfA.locator("[data-figure-kind]")).toHaveCount(0);

  // Every one of A's cells in B's rows reads the same sentence and carries
  // nothing else: no letters, no link, no coverage figure.
  const cellsOfA = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectA}"]`,
  );
  const count = await cellsOfA.count();
  expect(count, "B's own results give the table rows for A's cells to appear in").toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await expect(cellsOfA.nth(index).locator('[data-slot="cell-absence"]')).toHaveText(CELL_FILE_PREPARING);
    await expect(cellsOfA.nth(index).locator("[data-figure-kind]")).toHaveCount(0);
    await expect(cellsOfA.nth(index).locator("a")).toHaveCount(0);
  }

  // The absent-file sentence is nowhere on the page, and B's own column is
  // untouched: B's letters are still B's.
  await expect(page.getByText(CELL_NO_PREPARED_FILE, { exact: true })).toHaveCount(0);
  const lettersOfB = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfB.count()).toBeGreaterThan(0);

  // The hold still stands: the state read above is the server's.
  const stored = await adminClient().from("genome_files").select("status").eq("id", heldFileId).single();
  expect(stored.error).toBeNull();
  expect(stored.data!.status).toBe("uploaded");
          }
          async function assertProcessing(page: Page) {
  // A's column is on the page under the joint grant, and its status is the
  // in-flight sentence: not the absent-file sentence, and no result.
  const estimates = page.locator('[data-compare-surface][data-layer="estimate"]');
  await expect(estimates).toHaveCount(1);
  await expect(estimates.locator(`th[data-subject-id="${selfSubjectA}"]`)).toHaveCount(1);
  const statusOfA = estimates.locator(
    `[data-slot="health-picture-column-status"] [data-claim-block][data-subject-id="${selfSubjectA}"]`,
  );
  await expect(statusOfA).toHaveCount(1);
  await expect(statusOfA.locator('[data-slot="cell-absence"]')).toHaveText(CELL_FILE_PREPARING);
  await expect(statusOfA.locator("[data-figure-kind]")).toHaveCount(0);

  // Every one of A's cells in B's rows reads the same sentence and carries
  // nothing else: no letters, no link, no coverage figure.
  const cellsOfA = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectA}"]`,
  );
  const count = await cellsOfA.count();
  expect(count, "B's own results give the table rows for A's cells to appear in").toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await expect(cellsOfA.nth(index).locator('[data-slot="cell-absence"]')).toHaveText(CELL_FILE_PREPARING);
    await expect(cellsOfA.nth(index).locator("[data-figure-kind]")).toHaveCount(0);
    await expect(cellsOfA.nth(index).locator("a")).toHaveCount(0);
  }

  // The absent-file sentence is nowhere on the page, and B's own column is
  // untouched: B's letters are still B's.
  await expect(page.getByText(CELL_NO_PREPARED_FILE, { exact: true })).toHaveCount(0);
  const lettersOfB = estimates.locator(
    `[data-slot="health-picture-cell"] [data-claim-block][data-subject-id="${selfSubjectB}"] [data-figure-kind="genotype"]`,
  );
  expect(await lettersOfB.count()).toBeGreaterThan(0);

  // The hold still stands: the state read above is the server's.
  const stored = await adminClient().from("genome_files").select("status").eq("id", heldFileId).single();
  expect(stored.error).toBeNull();
  expect(stored.data!.status).toBe("uploaded");
          }

          async function assertOverviewJurisdiction(page: Page) {
            expect(new URL(page.url()).origin).toBe("http://localhost:3101");
            expect(new URL(page.url()).pathname).toBe("/overview");
            const refusal=page.locator('[data-slot="carrier-jurisdiction"]');
            await expect(refusal).toHaveCount(1);
            await expect(refusal).toContainText("Inherit cannot show carrier matches for your family here.");
            await expect(refusal).not.toContainText(/\d/);
            await expect(page.locator("[data-subject-pair]")).toHaveCount(0);
            await expect(page.getByRole("link",{name:/carrier match to look at/})).toHaveCount(0);
            await expect(page.locator("main")).not.toContainText("Two people carry a change in the same gene.");
            await expect(page.getByRole("heading",{level:1})).toBeVisible();
            await expect(page.locator("main a[href^='/genome/']").first()).toBeVisible();
          }
          async function auditOverviewJurisdiction(page: Page) {
  const OFF = "http://localhost:3101";

  // The control first: on THIS server the same account, same session and same
  // grants reach the carrier line's own surface. Without it, a refusal on the
  // other server could be an unreached state rather than a refused one.
  await page.goto("/overview");
  await expect(page.locator('[data-slot="carrier-jurisdiction"]')).toHaveCount(0);

  const response = await page.goto(`${OFF}/overview`);
  expect(response?.status()).toBe(200);
  const refusal = page.locator('[data-slot="carrier-jurisdiction"]');
  await expect(refusal).toHaveCount(1);
  await expect(refusal).toContainText("Inherit cannot show carrier matches for your family here.");

  // The refusal says THAT it cannot show them, never HOW MANY there were.
  // Whether two people in a family carry a change in the same gene is a fact
  // about their DNA, and a refusal that leaked it in either direction would be
  // worse than the analysis. So the sentence carries no number at all - the
  // first draft of this test asserted the refusal did not contain "carrier
  // match", which its own copy says, and caught nothing.
  await expect(refusal).not.toContainText(/\d/);
  await expect(page.locator("[data-subject-pair]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /carrier match to look at/ })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Two people carry a change in the same gene.");

  // And the rest of the Overview is untouched. This is the point of the
  // shape: one restricted capability is refused, not the account's own genome.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main a[href^='/genome/']").first()).toBeVisible();
          }
          try {
            accountA = await createConfirmedUser(A.email, A.password); accountB = await createConfirmedUser(B.email, B.password);
            selfSubjectA = await selfSubjectOf(accountA); selfSubjectB = await selfSubjectOf(accountB);
            const lines = buildCarrierPairVcf();
            expect(fs.readFileSync(FIXTURE, "utf8")).toBe(`${lines.join("\n")}\n`);
            const fixtureCheck = await verify(lines); expect(fixtureCheck.reasons).toEqual([]); expect(fixtureCheck.measure.status).toBe("measured");
            if (recipe !== "processing") await prepareBoth(page, fixtureCheck);
            else {
              await signIn(page, B.email, B.password);
              const ready = await uploadOwnFileWithChosenReports(page, TINY_FIXTURE, { fileType: "vcf", purposes: ["reports.polygenic"] });
              sourceFileIds.push("", ready); await signOut(page);
              await signIn(page, A.email, A.password); await declareAdulthood(page); await signOut(page);
            }
            await establishPair(page);
            await signOut(page);
            await signIn(page, A.email, A.password);
            for (const purpose of GRANTED_PURPOSES) await setSharingPurpose(page, invitedSubjectB, purpose, true);
            await signOut(page); await signIn(page, B.email, B.password);
            for (const purpose of GRANTED_PURPOSES) grantsFromB.set(purpose, (await setSharingPurpose(page, selfSubjectA, purpose, true))!);
            await signOut(page);
            if (recipe === "processing") {
              await signIn(page, A.email, A.password); held = await holdPreparation(page);
              heldFileId = await uploadOwnFileThroughUi(page, TINY_FIXTURE); sourceFileIds[0] = heldFileId; await held.assertHeld(heldFileId);
              viewingContext = await input.browser.newContext(options); capturedPage = await viewingContext.newPage();
              const acknowledged = capturedPage.waitForResponse(response => response.request().method() === "POST"
                && new URL(response.url()).pathname === "/api/family/acknowledge");
              void acknowledged.catch(() => {}); await auditProcessing(capturedPage);
              const response = await acknowledged; expect(response.status()).toBe(200); expect(await response.finished()).toBeNull();
              expect(response.request().postDataJSON()).toEqual({ acknowledgement: "tier2-result-gate", affirmed: true });
              const cookies = (await capturedPage.context().cookies()).filter(cookie => cookie.name === "inherit_family_gate");
              expect(cookies).toHaveLength(1); expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
            } else {
              // Full real saved-link and attribution audit before freezing the
              // native bags. No completed capture or simplified DOM is reused.
              await auditComplete(capturedPage);
              if (recipe === "overview-jurisdiction") await auditOverviewJurisdiction(capturedPage);
              if (recipe === "partial" || recipe === "uncovered") await signOut(capturedPage);
              if (recipe === "partial") await auditPartial(capturedPage);
              else if (recipe === "uncovered") await auditUncovered(capturedPage);
            }
            const assertState = async () => {
              if (recipe === "processing") { assert(held); await held.assertHeld(heldFileId); await assertProcessing(capturedPage); }
              else if (recipe === "partial") await assertPartial(capturedPage);
              else if (recipe === "uncovered") await assertUncovered(capturedPage);
              else if (recipe === "overview-jurisdiction") await assertOverviewJurisdiction(capturedPage);
              else await assertComplete(capturedPage);
            };
            await assertState(); const fixed = await facts();
            const observe = async () => {
              assertSource(); await assertState();
              const nativeSnapshot = await facts(); expect(nativeSnapshot, "Every complete actual Health Picture protected row remains current around capture").toEqual(fixed);
              expect(new URL(capturedPage.url()).pathname).toBe(recipe === "overview-jurisdiction" ? "/overview" : "/family/health-picture");
              expect(directionalPurposes(nativeSnapshot, selfSubjectA, accountB)).toEqual([...GRANTED_PURPOSES].sort());
              expect(directionalPurposes(nativeSnapshot, selfSubjectB, accountA)).toEqual(
                recipe === "partial" ? ["family.heritability", "reports.monogenic"] : [...GRANTED_PURPOSES].sort());
              for (const subjectId of [selfSubjectA, selfSubjectB]) {
                const subject = nativeSnapshot.subjects.find(row => row.id === subjectId); assert(subject);
                assert(typeof subject.independent_login_at === "string" && Number.isFinite(Date.parse(subject.independent_login_at)),
                  "Both actual independent adult sessions are required");
              }
              if (recipe === "processing") checkedHealthPicturePreparationHold(nativeSnapshot, heldFileId, selfSubjectA,
                sourceFileIds[1], selfSubjectB, { heldSha256: createHash("sha256").update(fs.readFileSync(TINY_FIXTURE)).digest("hex"),
                  readySha256: createHash("sha256").update(fs.readFileSync(TINY_FIXTURE)).digest("hex") });
              else {
                expect(nativeSnapshot.files).toHaveLength(2);
                for (const [index, subjectId] of [[0, selfSubjectA], [1, selfSubjectB]] as const) {
                  const source = nativeSnapshot.files.find(file => file.id === sourceFileIds[index]); assert(source);
                  expect(source).toMatchObject({ subject_id: subjectId, status: "stored", sha256: createHash("sha256").update(fs.readFileSync(FIXTURE)).digest("hex") });
                  expect(source.normalization_source_revision).toBe(source.upload_revision); expect(source.normalization_completed_at).not.toBeNull();
                  expect(source.single_logical_sample_verified_at).not.toBeNull();
                  expect(nativeSnapshot.own_completions.filter(run => run.fileId === source.id).map(run => run.purpose).sort())
                    .toEqual(["reports.monogenic", "reports.polygenic"]);
                }
              }
              return input.observeState(row, capturedPage, sourceSha256, { accountIds: [accountA, accountB], nativeSnapshot });
            };
            await observe(); await capture({ page: capturedPage, observe }); await observe();
          } finally {
            try {
              if (held) {
                // Release the same original POST and qualify its actual strict
                // receipt before either browser context is closed.
                await held.settle();
                const completed = await adminClient().from("genome_files").select("*", { count: "exact" }).eq("id", heldFileId);
                expect(completed.error).toBeNull(); expect(completed.count).toBe(1); expect(completed.data).toHaveLength(1);
                const actual = completed.data![0];
                expect(actual).toMatchObject({ status: "stored", subject_id: selfSubjectA,
                  sha256: createHash("sha256").update(fs.readFileSync(TINY_FIXTURE)).digest("hex") });
                expect(actual.normalization_source_revision).toBe(actual.upload_revision);
                expect(actual.normalization_completed_at).not.toBeNull(); expect(actual.single_logical_sample_verified_at).not.toBeNull();
                expect(await ownRunCompletions(heldFileId), "Preparation did not invent an unchosen report").toEqual([]);
              }
            } finally { try { await viewingContext?.close(); } finally { await context.close(); } }
            // Root's fresh-native-runtime callback owns full account, object,
            // queue and source disposal; a failure cannot be accepted as cleanup.
          }
        });
      } } satisfies DensityStateFixture];
  });
}

/** Existing four Health Picture providers keep the exact old projection. */
export function realHealthPictureDensityFixtures(input: HealthPictureDensityInput): DensityStateFixture[] {
  return healthPictureFixtures(input, "health-picture");
}
/** Original State D carrier-refusal journey, keeping both literal app origins.
 * Root must supply current actual environment observations for both servers;
 * neither this source proposal nor the same-origin cookie fact supplies them. */
export function realOverviewJurisdictionDensityFixtures(input: HealthPictureDensityInput & {
  readActualAppEnvironment: (origin: string) => Promise<unknown>;
}): DensityStateFixture[] {
  return healthPictureFixtures(input, "overview-jurisdiction", input.readActualAppEnvironment);
}
