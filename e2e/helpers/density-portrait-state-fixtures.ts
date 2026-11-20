import { type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { expect } from "../audited-test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  acceptAdultInvitation,
  adminClient,
  adultInvitationToken,
  adultInvitationUrl,
  createConfirmedUser,
  drainMailUntil,
  expectAxeClean,
  signIn,
} from "../helpers";
import { uploadOwnFilePrepared } from "../own-report-helpers";
import { buildCarrierPairVcf, verify, verifyAgainst } from "../fixtures/carrier-pair-fixture";
import { buildCarrierPairBVcf, CARRIER_B_POSITIONS } from "../fixtures/carrier-pair-b-fixture";
import {
  ACKNOWLEDGE_BUTTON,
  CHANCE_NOT_PREDICTION,
  DELETE_BUTTON,
  HEADER_SENTENCE,
  NO_CLASSIFIED_POSITIONS,
  NO_POSITIONS_BOTH_COVER,
  OUTCOME_LEGEND,
  PORTRAIT_H1,
  POSITIONS_NOT_COVERED_READING,
  REFUSALS,
  RUNS_CHECKED_STATEMENT,
  SEGREGATION_SENTENCE,
  TRAIT_NAMES,
  cannotCalculate,
  knownChangesCovered,
  oneSidedWhatWouldChange,
  unregisteredCard,
} from "@/copy/family/portrait";
import {
  LAB_CONFIRMATION_LINE,
  PENETRANCE_NOT_ESTABLISHED,
  assertionSourceLine,
  reviewedVariantLine,
} from "@/copy/family/carrier-evidence";
import { EXACT_MARKER } from "@/lib/figures/contract";
import { TRAIT_KEYS } from "@/lib/family/traits";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ownRunCompletions } from "../own-report-helpers";
import { uploadOwnFileThroughUi } from "../helpers";
import { settingsOperationNonce } from "./operation-nonce";
import { DISTINGUISHING_PRINCIPLE, filePreparingFor } from "../../src/copy/family/portrait";
import { portraitDensityRecipe, checkedPortraitJurisdictionTransition, PORTRAIT_DENSITY_NATIVE_SOURCES } from "../../scripts/density-portrait-states";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import type { DensityRegister } from "../../scripts/density-current";
import type { DensityStateFixture } from "./density-current-capture";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import { accountCsrf, signOut } from "./session-csrf";

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
  const ownIds = new Set(facts.subjects.filter(subject => subject.subject_class === "self").map(subject => subject.id));
  expect(facts.grants.filter(grant => ownIds.has(grant.target_id) && grant.revoked_at === null
    && ["reports.monogenic", "reports.polygenic", "ancestry"].includes(grant.purpose as string)),
    "The original Portrait flow did not select independent reports").toEqual([]);
  for (const file of facts.files.filter(file => file.status === "stored" && file.normalization_completed_at !== null)) {
    const runs = await ownRunCompletions(file.id as string);
    // The unchanged Portrait producer prepares a source without choosing
    // independent reports. Do not fabricate a report grant/journal to make
    // the unrelated Family report fixture's positive-run premise true.
    expect(runs, "Unselected own-analysis journals remain genuinely absent").toEqual([]);
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


/** All five added Portrait states use a fresh admitted native runtime. The
 * original reviewed-carrier spec is unchanged; its whole scientific and harm
 * audit bodies below are reused verbatim. No provider response or completed
 * source/result is injected. Root owns actual mail, preparation and cleanup. */
export function realPortraitDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  findActualInvitation: (recipient: string) => ActualEmail | undefined;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountIds: [string, string]; nativeSnapshot: Facts }) => Promise<unknown>;
}): DensityStateFixture[] {
  const origin = new URL(input.origin);
  assert(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
    && origin.pathname === "/" && !origin.username && !origin.password && !origin.search && !origin.hash,
    "Existing disposable served app required");
  if (PORTRAIT_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-portrait-state-fixtures.ts";
  const sourceSha256 = createHash("sha256").update(fs.readFileSync(path.join(input.root, sourcePath))).digest("hex");
  const sources = [sourcePath, "scripts/density-portrait-states.ts", ...PORTRAIT_DENSITY_NATIVE_SOURCES]
    .map(name => ({ name, sha256: createHash("sha256").update(fs.readFileSync(path.join(input.root, name))).digest("hex") }));
  const assertSource = () => { for (const source of sources)
    assert(createHash("sha256").update(fs.readFileSync(path.join(input.root, source.name))).digest("hex") === source.sha256,
      "Complete reviewed Portrait source changed"); };
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    const recipe = portraitDensityRecipe(row); if (!recipe) return [];
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
          const options = { baseURL: origin.origin, viewport, deviceScaleFactor: 1, colorScheme: "light" as const,
            reducedMotion: "reduce" as const, locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" as const };
          const context = await input.browser.newContext(options), page = await context.newPage();
          let viewingContext: BrowserContext | undefined, held: Awaited<ReturnType<typeof hold>> | undefined;
          let capturedPage = page;
          const privateReads: string[] = [];
const RUN_ID = randomUUID();
const A = { email: `portrait-reviewed-a-${RUN_ID}@e2e.local`, password: "e2e-portrait-reviewed-pw" };
const B = { email: `portrait-reviewed-b-${RUN_ID}@e2e.local`, password: "e2e-portrait-reviewed-pw" };
const FIXTURE_A = path.join(process.cwd(), "e2e/fixtures/carrier-pair-grch38.vcf");
const FIXTURE_B = path.join(process.cwd(), "e2e/fixtures/carrier-pair-b-grch38.vcf");

/** A sees B through the invitation's handle; B sees A as the unnamed self. */
const INVITEE_LABEL = "Invited adult";
const INVITER_LABEL = "Another adult";
const GATE_CHECKBOX = "I understand this can tell me something I can’t un-know.";
const GATE_BUTTON = "Show what’s shared";
const DERIVATION = "1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%) neither";
/** G5.9(d): a second-person possessive about a child, in any spelling the brief names or implies. */
const SECOND_PERSON_CHILD = /\byour (?:future |unborn |own )?(?:child|baby|son|daughter|kid)\b|\byour (?:child|baby)(?:’|')s\b/i;
/** G5.9(a): nothing pictorial in the result region, and no figure-role svg anywhere in main. */
const RESULT_MEDIA = '[data-slot="portrait-outputs"] :is(img, canvas, svg, picture, video)';
const MAIN_FIGURE_MEDIA = "main img, main canvas, main svg[role=img]";

// ---------------------------------------------------------------------------
// The synthetic reviewed release
// ---------------------------------------------------------------------------

const RELEASE_ID = `synthetic-e2e-portrait-${RUN_ID.slice(0, 8)}`;
const REVIEWER = { name: "Synthetic test reviewer", role: "Browser test fixture", reference: "e2e/portrait-reviewed-carrier.spec.ts" };

interface SyntheticAssertion {
  variationId: number;
  variantName: string;
  reviewStatus: string;
  reviewStars: number;
  lastEvaluated: string | null;
  pos: number;
  ref: string;
  alt: string;
}

interface SyntheticCondition {
  conditionId: string;
  conditionName: string;
  gene: string;
  assertions: SyntheticAssertion[];
}

/** Both files carry one changed copy at the first change; both read A/T, not the reviewed G, at the second. */
const BOTH_COVER: SyntheticCondition = {
  conditionId: "SYNTHETIC:8801",
  conditionName: "Synthetic recessive condition A",
  gene: "SYNPORTA",
  assertions: [
    { variationId: 880101, variantName: "Synthetic change A1", reviewStatus: "reviewed by expert panel", reviewStars: 3,
      lastEvaluated: "2024-01-01", pos: 61_000_000, ref: "A", alt: "G" },
    { variationId: 880102, variantName: "Synthetic change A2", reviewStatus: "criteria provided, multiple submitters, no conflicts",
      reviewStars: 2, lastEvaluated: null, pos: 141_000_000, ref: "A", alt: "G" },
  ],
};

/** A's file carries one changed copy; B's file does not report the position. */
const ONE_SIDE_COVERS: SyntheticCondition = {
  conditionId: "SYNTHETIC:8802",
  conditionName: "Synthetic recessive condition B",
  gene: "SYNPORTB",
  assertions: [
    { variationId: 880201, variantName: "Synthetic change B1", reviewStatus: "practice guideline", reviewStars: 4,
      lastEvaluated: "2023-06-15", pos: 10_000_000, ref: "C", alt: "T" },
  ],
};

const CONDITIONS = [BOTH_COVER, ONE_SIDE_COVERS];

function releasePayload() {
  return {
    release: {
      releaseId: RELEASE_ID, source: "synthetic", sourceUrl: "https://example.invalid/synthetic-portrait-release",
      sourceSha256: "a".repeat(64), sourceBytes: 1, sourcePublishedOn: "2026-09-03", retrievedAt: "2026-09-28T08:40:57Z",
      extractSha256: "b".repeat(64), geneValidityUrl: "https://example.invalid/synthetic-gene-validity",
      geneValiditySha256: "c".repeat(64), geneValidityCreatedOn: "2026-09-28",
    },
    conditions: CONDITIONS.map((condition) => ({
      conditionId: condition.conditionId, conditionName: condition.conditionName, geneSymbol: condition.gene,
      inheritanceMode: "autosomal_recessive", geneValidityClassification: "Definitive", geneValidityClassifiedOn: "2022-06-01",
      geneValidityUrl: `https://example.invalid/synthetic-validity-${condition.gene.toLowerCase()}`,
    })),
    assertions: CONDITIONS.flatMap((condition) => condition.assertions.map((assertion) => ({
      variationId: assertion.variationId, conditionId: condition.conditionId, geneSymbol: condition.gene,
      variantName: assertion.variantName, classification: "Pathogenic", reviewStatus: assertion.reviewStatus,
      reviewStars: assertion.reviewStars, conflict: false, lastEvaluated: assertion.lastEvaluated,
      grch38: [1, assertion.pos, assertion.ref, assertion.alt], grch37: null, grch38Equivalents: [],
    }))),
  };
}

async function registryRevision(conditionId: string): Promise<{ revision: number; active: boolean }> {
  const { data, error } = await adminClient().from("carrier_conditions")
    .select("registry_revision, active").eq("condition_id", conditionId).single();
  expect(error).toBeNull();
  return { revision: Number(data!.registry_revision), active: Boolean(data!.active) };
}

/** A named reviewer's decision, through the one door that may change a condition's state. */
async function review(condition: SyntheticCondition, decision: "activate" | "deactivate") {
  const { revision } = await registryRevision(condition.conditionId);
  const { data, error } = await adminClient().rpc("review_carrier_condition_v1", {
    p_condition_id: condition.conditionId, p_registry_revision: revision, p_decision: decision,
    p_reviewer_name: REVIEWER.name, p_reviewer_role: REVIEWER.role, p_review_reference: REVIEWER.reference,
    p_severity_class: decision === "activate" ? "not_serious" : null,
  });
  expect(error).toBeNull();
  expect(Number(data)).toBeGreaterThan(0);
  expect((await registryRevision(condition.conditionId)).active).toBe(decision === "activate");
}

/** The rule's rows, as every carrier surface reads them. */
async function ruleGenes(): Promise<string[]> {
  const { data, error } = await adminClient().rpc("carrier_assertions_v1");
  expect(error).toBeNull();
  return [...new Set((data as { gene_symbol: string }[]).map((row) => row.gene_symbol))].sort();
}

let accountA = "";
let accountB = "";
let selfSubjectA = "";
let selfSubjectB = "";
let invitedSubjectB = "";
let pairId = "";
const fileIds: { a: string; b: string } = { a: "", b: "" };

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** A fresh server presentation and a real permission POST from the signed-in account. */
async function grantPortrait(page: Page, recipientHandle: string) {
  await page.goto(`/family/s-${recipientHandle}/permissions`);
  const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: /^Portrait$/ }) });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("Off");
  const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/consents") && candidate.request().method() === "POST");
  await row.getByRole("button", { name: /Turn on/ }).click();
  expect((await response).status()).toBe(201);
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("On");
}

async function acknowledgePortrait(page: Page) {
  await page.goto(url());
  const form = page.locator('[data-slot="portrait-acknowledge"]');
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: ACKNOWLEDGE_BUTTON }).click();
  await expect(form).toHaveCount(0);
}

async function pairOf(): Promise<{ id: string; status: string }> {
  const { data } = await adminClient().from("family_pairs").select("id, status, subject_a_id, subject_b_id")
    .or(`subject_a_id.eq.${selfSubjectA},subject_b_id.eq.${selfSubjectA}`);
  const pair = (data as { id: string; status: string; subject_a_id: string; subject_b_id: string }[] | null ?? []).find(
    (row) => row.subject_a_id === selfSubjectB || row.subject_b_id === selfSubjectB);
  if (!pair) throw new Error("no pair between A and B");
  return pair;
}

const url = () => `/family/portrait/${pairId}`;

/** The domain's one Tier-2 gate, passed in this browser context after `signIn`. */
async function passGate(page: Page) {
  await page.goto(url());
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator('[data-slot="portrait-header-sentence"]')).toHaveText(HEADER_SENTENCE);
}

/** The finding texts of the page: every `[data-finding]` node inside a claim block, in document order. */
async function findingTexts(page: Page): Promise<string[]> {
  return page.locator("[data-claim-block] [data-finding]").evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()));
}

/** A reviewed variant line as the viewer reads it: "You" for the viewer, the column's name for the other person. */
function variantLine(name: string, assertion: SyntheticAssertion, gene: string): string {
  return reviewedVariantLine(name, { ...assertion, releaseId: RELEASE_ID }, gene, "Pathogenic");
}

/**
 * G5.9 on the page as it stands, whatever the state: (a) no pictorial element
 * in the result region, (b) the chance line in every claim block and every
 * figure a count of 100 possible children, (c) the trait allowlist, (d) no
 * second-person possessive about a child.
 */
async function expectBoundedHarm(page: Page) {
  // (a)
  await expect(page.locator('[data-slot="portrait-outputs"]')).toHaveCount(1);
  await expect(page.locator(RESULT_MEDIA)).toHaveCount(0);
  await expect(page.locator(MAIN_FIGURE_MEDIA)).toHaveCount(0);
  // (b)
  const blocks = page.locator('[data-slot="portrait-outputs"] [data-claim-block]');
  const count = await blocks.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await expect(blocks.nth(index).locator('[data-slot="chance-not-prediction"]')).toHaveText(CHANCE_NOT_PREDICTION);
    await expect(blocks.nth(index).locator('[data-slot="segregation"]')).toHaveText(SEGREGATION_SENTENCE);
  }
  for (const sentence of await page.locator('[data-slot="outcome-sentence"]').allTextContents()) {
    expect(sentence).toMatch(/^Out of 100 possible children, about \d+ would [a-z ]+\.$/);
  }
  // (c)
  const allowlist = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/family-trait-allowlist.json"), "utf8")) as {
    traits: Record<string, unknown>; denied_key_patterns: string[];
  };
  const rendered = await page.locator('[data-slot="trait-card"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-trait") ?? ""));
  expect(rendered.sort()).toEqual(Object.keys(allowlist.traits).sort());
  expect([...TRAIT_KEYS].sort()).toEqual(Object.keys(allowlist.traits).sort());
  for (const key of rendered) {
    expect(allowlist.denied_key_patterns.some((pattern) => key.includes(pattern)), key).toBe(false);
    const card = page.locator(`[data-slot="trait-card"][data-trait="${key}"]`);
    await expect(card.locator('[data-slot="trait-status"]')).toHaveText(unregisteredCard(TRAIT_NAMES[key as keyof typeof TRAIT_NAMES]));
    await expect(card.locator("[data-figure-kind], [data-claim-block]")).toHaveCount(0);
  }
  await expect(page.locator("#not-shown [data-refusal-id]")).toHaveCount(REFUSALS.length);
  // (d)
  expect(await page.locator("main").innerText()).not.toMatch(SECOND_PERSON_CHILD);
  expect(await page.content()).not.toMatch(SECOND_PERSON_CHILD);
  // Line 2238: never a monogenic zero; nothing about relatedness.
  const mainText = await page.locator("main").innerText();
  expect(mainText).not.toMatch(/(^|[^\d])0%/);
  expect(mainText).not.toMatch(/\b0 in 100\b/);
  expect(mainText).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);
}

/** The recessive block for the gene both files cover, identical in `complete` and `partial-coverage`. */
async function expectRecessiveBlock(page: Page, viewer: "a" | "b") {
  const exact = page.locator(`[data-claim-block]:has([data-output-kind="carrier-pair"][data-gene="${BOTH_COVER.gene}"])`);
  await expect(exact).toHaveCount(1);
  // Attributed to the pair, in the pair's own order, because the arithmetic used both records.
  const pair = await exact.getAttribute("data-subject-pair");
  expect(new Set(pair?.split(":"))).toEqual(new Set([selfSubjectA, selfSubjectB]));
  await expect(exact.locator('[data-slot="portrait-output-title"]')).toHaveText(`A change in ${BOTH_COVER.gene}`);
  // The mandated derivation, three exact figures at 100, and 100 dots as spans.
  await expect(exact.locator('[data-slot="portrait-derivation"]')).toHaveText(DERIVATION);
  await expect(exact.locator("[data-exact-marker]")).toHaveText(EXACT_MARKER);
  await expect(exact.locator('[data-figure-basis="exact"]')).toHaveCount(3);
  await expect(exact.locator('[data-figure-kind="carrier-status"]')).toHaveCount(2);
  const dots = exact.locator('[data-slot="outcome-dot"]');
  await expect(dots).toHaveCount(100);
  expect(await dots.evaluateAll((nodes) => nodes.every((node) => node.tagName === "SPAN"))).toBe(true);
  await expect(exact.locator('[data-slot="outcome-dot"][data-outcome="affected"]')).toHaveCount(25);
  await expect(exact.locator('[data-slot="outcome-dot"][data-outcome="carrier"]')).toHaveCount(50);
  await expect(exact.locator('[data-slot="outcome-dot"][data-outcome="neither"]')).toHaveCount(25);
  for (const outcome of ["affected", "carrier", "neither"] as const) {
    await expect(exact.locator(`[data-slot="outcome-legend-item"][data-outcome="${outcome}"]`)).toContainText(OUTCOME_LEGEND[outcome]);
  }
  await expect(exact.locator('[data-slot="outcome-sentence"]')).toHaveText([
    "Out of 100 possible children, about 25 would have the condition.",
    "Out of 100 possible children, about 50 would carry one copy of the change.",
    "Out of 100 possible children, about 25 would have no copy of the change.",
  ]);
  // Both of the condition's known changes are covered by both files.
  await expect(exact.locator('[data-slot="known-covered"]')).toHaveText(knownChangesCovered(2, 2));
  // The runs measure was taken for both files at preparation, and is below the limit.
  await expect(exact.locator('[data-slot="how-sure"]')).toContainText(RUNS_CHECKED_STATEMENT);
  await expect(page.locator('details [data-slot="how-sure"]')).toHaveCount(0);
  // Each person's variant line names the reviewed change, its classification,
  // its review status and its date as text, and never calls a test release ClinVar.
  const [first] = BOTH_COVER.assertions;
  const lines = exact.locator('[data-slot="carrier-variant"]');
  await expect(lines).toHaveCount(2);
  const other = viewer === "a" ? INVITEE_LABEL : INVITER_LABEL;
  const texts = await lines.allTextContents();
  expect(new Set(texts)).toEqual(new Set([variantLine("You", first, BOTH_COVER.gene), variantLine(other, first, BOTH_COVER.gene)]));
  for (const text of texts) {
    expect(text).toContain("(review status: reviewed by expert panel; last evaluated 1 January 2024).");
    expect(text).not.toContain("ClinVar classifies");
  }
  const notes = exact.locator('[data-slot="assertion-notes"]');
  await expect(notes.locator('[data-slot="lab-confirmation"]')).toHaveText(LAB_CONFIRMATION_LINE);
  await expect(notes.locator('[data-slot="penetrance"]')).toHaveText(PENETRANCE_NOT_ESTABLISHED);
  await expect(notes.locator('[data-slot="assertion-source"]')).toHaveText(assertionSourceLine(RELEASE_ID, "2026-09-28"));
  await expect(notes.locator('[data-slot="assertion-source"]')).toHaveText("Classifications from a test release, not from ClinVar.");
}

async function setupReviewedSource() {
  accountA = await createConfirmedUser(A.email, A.password);
  accountB = await createConfirmedUser(B.email, B.password);
  selfSubjectA = await selfSubjectOf(accountA);
  selfSubjectB = await selfSubjectOf(accountB);

  // The committed fixtures are what their generators build, and the real
  // parser and runs measure read them as this spec depends on.
  expect(fs.readFileSync(FIXTURE_A, "utf8")).toBe(`${buildCarrierPairVcf().join("\n")}\n`);
  expect(fs.readFileSync(FIXTURE_B, "utf8")).toBe(`${buildCarrierPairBVcf().join("\n")}\n`);
  const checkA = await verify(buildCarrierPairVcf());
  const checkB = await verifyAgainst(buildCarrierPairBVcf(), CARRIER_B_POSITIONS);
  expect(checkA.reasons).toEqual([]);
  expect(checkB.reasons).toEqual([]);
  const rows = (lines: string[]) => new Map(lines.filter((line) => !line.startsWith("#"))
    .map((line) => line.split("\t")).map((fields) => [`${fields[0]}:${fields[1]}`, fields]));
  const a = rows(buildCarrierPairVcf());
  const b = rows(buildCarrierPairBVcf());
  expect(a.get("chr1:61000000")?.slice(3)).toEqual(["A", "G", "50", "PASS", ".", "GT", "0/1"]);
  expect(b.get("chr1:61000000")?.slice(3)).toEqual(["A", "G", "50", "PASS", ".", "GT", "0/1"]);
  expect(a.get("chr1:141000000")?.slice(3, 5)).toEqual(["A", "G,T"]);
  expect(a.get("chr1:141000000")?.[9]).toBe("0/2");
  expect(b.get("chr1:141000000")?.slice(3, 5)).toEqual(["A", "G,T"]);
  expect(b.get("chr1:141000000")?.[9]).toBe("0/2");
  expect(a.get("chr1:10000000")?.slice(3)).toEqual(["C", "T", "50", "PASS", ".", "GT", "0/1"]);
  expect(b.has("chr1:10000000")).toBe(false);

  // The synthetic release, imported inactive; a reviewer activates each
  // condition in the test that needs it.
  const imported = await adminClient().rpc("import_clinical_assertion_release_v1", { p_payload: releasePayload() });
  expect(imported.error).toBeNull();
  expect(imported.data).toMatchObject({ releaseId: RELEASE_ID, conditions: 2, assertions: 3 });
  for (const condition of CONDITIONS) {
    if ((await registryRevision(condition.conditionId)).active) await review(condition, "deactivate");
  }
  expect(await ruleGenes()).toEqual([]);
}
async function prepareBothFiles(page: Page) {
  for (const [side, account, fixture] of [["a", A, FIXTURE_A], ["b", B, FIXTURE_B]] as const) {
    await signIn(page, account.email, account.password);
    fileIds[side] = await uploadOwnFilePrepared(page, fixture, { fileType: "vcf" });
    await signOut(page);
  }
  const { data, error } = await adminClient().from("genome_files")
    .select("id, roh_status, roh_reason, roh_total_bases, roh_covered_bases, roh_fraction, roh_measured_at")
    .in("id", [fileIds.a, fileIds.b]);
  expect(error).toBeNull();
  expect(data).toHaveLength(2);
  for (const row of data!) {
    // Measured from the verified bytes, never assumed: a file with no measure
    // is "not checked" and the rule would refuse the arithmetic.
    expect(row).toMatchObject({ roh_status: "measured", roh_reason: null });
    expect(Number(row.roh_total_bases)).toBeGreaterThan(0);
    expect(Number(row.roh_covered_bases)).toBeGreaterThan(Number(row.roh_total_bases));
    expect(Number(row.roh_fraction)).toBeLessThan(0.0156);
    expect(row.roh_measured_at).not.toBeNull();
  }
}
async function establishPair(page: Page) {
  await signIn(page, A.email, A.password);
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(B.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");
  const token = await drainMailUntil(page.request, () => adultInvitationToken(input.findActualInvitation(B.email)?.html), "the invitation", environment.JOBS_SECRET);
  await signOut(page);
  await acceptAdultInvitation({ page, invitationUrl: adultInvitationUrl(token), email: B.email, password: B.password, origin: input.origin });
  await signOut(page);

  const admin = adminClient();
  const inviter = await admin.from("subject_principals").select("id")
    .eq("account_id", accountA).eq("subject_id", selfSubjectA)
    .eq("principal_kind", "account_subject").eq("status", "active").single();
  expect(inviter.error).toBeNull();
  const invitation = await admin.from("subject_invitations").select("target_id")
    .eq("inviter_principal_id", inviter.data!.id).eq("invitation_kind", "adult_subject")
    .eq("target_kind", "subject").eq("status", "accepted").single();
  expect(invitation.error).toBeNull();
  invitedSubjectB = invitation.data!.target_id;

  await signIn(page, A.email, A.password);
  await grantPortrait(page, invitedSubjectB);
  pairId = (await pairOf()).id;
  await acknowledgePortrait(page);
  await signOut(page);

  await signIn(page, B.email, B.password);
  await grantPortrait(page, selfSubjectA);
  await acknowledgePortrait(page);
  await expect(page.getByText(GATE_CHECKBOX, { exact: true })).toBeVisible();
  await signOut(page);
  expect((await pairOf()).status).toBe("current");
}
async function assertComplete(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: PORTRAIT_H1 })).toBeVisible();

  // Exactly one output, and it is the exact block; nothing is refused,
  // one-sided, unavailable or "not available yet".
  await expect(page.locator('[data-slot="portrait-output"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="portrait-outputs"] [data-claim-block]')).toHaveCount(1);
  await expect(page.locator('[data-output-kind="carrier-pair-refused"], [data-output-kind="one-sided"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="portrait-empty"], [data-slot="portrait-preparing"]')).toHaveCount(0);
  await expect(page.locator('main [role="status"][data-state="empty"], main [role="status"][data-state="unavailable"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(NO_CLASSIFIED_POSITIONS);
  await expect(page.locator("main")).not.toContainText(NO_POSITIONS_BOTH_COVER);
  await expect(page.locator("main")).not.toContainText("not available yet");
  await expect(page.locator("main")).not.toContainText(ONE_SIDE_COVERS.gene);
  await expect(page.locator("[data-exact-marker]")).toHaveCount(1);
  await expect(page.locator('[data-slot="outcome-dot"]')).toHaveCount(100);
  await expect(page.locator("[data-modelled-marker]")).toHaveCount(0);

  await expectRecessiveBlock(page, "a");
  await expectBoundedHarm(page);
  await expect(page.getByRole("button", { name: DELETE_BUTTON })).toBeVisible();
  await expectAxeClean(page);
}
async function assertPartialA(page: Page) {
  const [change] = ONE_SIDE_COVERS.assertions;
  await expect(page.locator('[data-slot="portrait-output"]')).toHaveCount(2);
  await expectRecessiveBlock(page, "a");

  // Which part is missing and why: B's file does not cover the reviewed change.
  const missing = page.locator(`[data-claim-block]:has([data-output-kind="one-sided"][data-gene="${ONE_SIDE_COVERS.gene}"])`);
  await expect(missing).toHaveCount(1);
  await expect(missing.locator('[data-one-sided="not-covered"]')).toHaveCount(1);
  await expect(missing.locator('[data-slot="portrait-output-title"]')).toHaveText(`A change in ${ONE_SIDE_COVERS.gene}`);
  await expect(missing.locator('[data-slot="carrier-sentence"]')).toHaveText(cannotCalculate(INVITEE_LABEL, change.variantName));
  await expect(missing.locator('[data-slot="how-sure"]')).toContainText(oneSidedWhatWouldChange(INVITEE_LABEL));
  await expect(missing.locator('[data-slot="carrier-variant"]')).toHaveText(variantLine("You", change, ONE_SIDE_COVERS.gene));
  await expect(missing.locator('[data-figure-kind="carrier-status"]')).toHaveCount(2);
  await expect(missing).toContainText(POSITIONS_NOT_COVERED_READING);
  await expect(missing.locator('[data-slot="assertion-notes"] [data-slot="lab-confirmation"]')).toHaveText(LAB_CONFIRMATION_LINE);
  // No fraction, no dots and no exact figure where the calculation cannot be done.
  await expect(missing.locator('[data-slot="outcome-dot"], [data-figure-basis="exact"], [data-exact-marker]')).toHaveCount(0);
  await expect(missing).not.toContainText("in 100");
  await expect(missing).not.toContainText("1 in 4");
  await expect(page.locator('[data-slot="outcome-dot"]')).toHaveCount(100);
  await expectBoundedHarm(page);
}
async function assertPartialB(page: Page, fromA: string[]) {
  const [change] = ONE_SIDE_COVERS.assertions;
  await expectRecessiveBlock(page, "b");
  const mirror = page.locator(`[data-claim-block]:has([data-output-kind="one-sided"][data-gene="${ONE_SIDE_COVERS.gene}"])`);
  await expect(mirror.locator('[data-slot="carrier-sentence"]')).toHaveText(
    `We cannot do this calculation. Your file does not cover ${change.variantName}.`);
  await expect(mirror.locator('[data-slot="how-sure"]')).toContainText(oneSidedWhatWouldChange("you"));
  await expect(mirror.locator('[data-slot="carrier-variant"]')).toHaveText(variantLine(INVITER_LABEL, change, ONE_SIDE_COVERS.gene));
  await expectBoundedHarm(page);
  // Brief line 1337: both sessions render byte-equal finding text.
  expect(await findingTexts(page)).toEqual(fromA);
}
async function assertNotCovered(page: Page) {
  await expect(page.locator('[data-slot="portrait-header-sentence"]')).toHaveText(HEADER_SENTENCE);
  await expect(page.locator('[data-slot="distinguishing-principle"]')).toHaveText(DISTINGUISHING_PRINCIPLE);
  const headings = page.locator("main :is(h1, h2, h3, h4, h5, h6)");
  expect(await headings.count()).toBeLessThanOrEqual(6);
  await expect(page.getByRole("heading", { name: "What a child could inherit" })).toBeVisible();

  // Legacy labels are intentionally present in the database. They lack
  // reviewed allele/condition/assertion provenance and cannot activate output.
  await expect(page.locator('[data-slot="portrait-output"]')).toHaveCount(0);
  await expect(page.locator("[data-claim-block]")).toHaveCount(0);
  await expect(page.locator('[data-slot="portrait-empty"]')).toHaveText(NO_CLASSIFIED_POSITIONS);
  await expect(page.locator('[data-slot="portrait-empty"]')).toHaveAttribute("data-state", "unavailable");
  // Neither empty branch: not "a person has no processed file" (which carries
  // no data-slot), and not "no position both files cover".
  await expect(page.locator('main [role="status"][data-state="empty"]')).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(NO_POSITIONS_BOTH_COVER);
  await expect(page.locator("[data-exact-marker], [data-modelled-marker], [data-figure-basis=exact], [data-slot=outcome-dot]")).toHaveCount(0);
  for (const entry of CONDITIONS) await expect(page.locator("main")).not.toContainText(entry.gene);
  await expect(page.locator("main")).not.toContainText("No change to show that you both carry");

  // G5.9(a): no image, avatar or face anywhere in the result region; the
  // dots are spans. Line 2238: no monogenic zero.
  await expect(page.locator(RESULT_MEDIA)).toHaveCount(0);
  const mainText = await page.locator("main").innerText();
  expect(mainText).not.toMatch(/(^|[^\d])0%/);
  expect(mainText).not.toMatch(/\b0 in 100\b/);
  expect(mainText).not.toMatch(/centimorgan|\bcM\b|kinship|shared DNA|related to/i);

  // Every trait card states the registry's state; none carries a figure.
  const traitCards = page.locator('[data-slot="trait-card"]');
  await expect(traitCards).toHaveCount(TRAIT_KEYS.length);
  for (const key of TRAIT_KEYS) {
    const card = page.locator(`[data-slot="trait-card"][data-trait="${key}"]`);
    await expect(card.locator('[data-slot="trait-status"]')).toHaveText(unregisteredCard(TRAIT_NAMES[key]));
    await expect(card.locator("[data-figure-kind]")).toHaveCount(0);
    await expect(card.locator("[data-claim-block]")).toHaveCount(0);
  }

  // The delete control is real: one destructive action, no dialog until asked.
  await expect(page.getByRole("button", { name: DELETE_BUTTON })).toBeVisible();
  await expect(page.locator('[data-slot="portrait-delete-dialog"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Data and methods" })).toHaveAttribute("href", "/genome/me/data");
}
async function facts(): Promise<Facts> {
  const value = await boundaryFacts([accountA, accountB]), admin = adminClient();
  for (const [name, query] of [
    ["clinical_assertion_releases", admin.from("clinical_assertion_releases").select("*", { count: "exact" })],
    ["carrier_conditions", admin.from("carrier_conditions").select("*", { count: "exact" })],
    ["carrier_condition_reviews", admin.from("carrier_condition_reviews").select("*", { count: "exact" })],
    ["clinical_assertions", admin.from("clinical_assertions").select("*", { count: "exact" })],
  ] as const) {
    const result = await query; expect(result.error).toBeNull(); expect(result.count).not.toBeNull();
    expect(result.data!.length).toBe(result.count); value[name] = result.data!;
  }
  const assertions = await admin.rpc("carrier_assertions_v1"); expect(assertions.error).toBeNull();
  assert(Array.isArray(assertions.data), "Actual complete reviewed assertion rows required"); value.current_carrier_assertions = assertions.data;
  for (const rows of Object.values(value)) rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return value;
}
          try {
            if (recipe !== "jurisdiction") {
              await setupReviewedSource();
              if (recipe !== "processing") await prepareBothFiles(page);
            } else {
              accountA = await createConfirmedUser(A.email, A.password); accountB = await createConfirmedUser(B.email, B.password);
              selfSubjectA = await selfSubjectOf(accountA); selfSubjectB = await selfSubjectOf(accountB);
            }
            await establishPair(page);
            if (recipe === "processing") {
              await signIn(page, A.email, A.password);
              fileIds.a = await uploadOwnFilePrepared(page, FIXTURE_A, { fileType: "vcf" });
              await signOut(page); await signIn(page, B.email, B.password);
              held = await hold(page, "**/api/files/*/process");
              fileIds.b = await uploadOwnFileThroughUi(page, FIXTURE_B); await held.assertHeld();
              viewingContext = await input.browser.newContext(options); capturedPage = await viewingContext.newPage();
            }
            if (recipe === "complete" || recipe === "partial") {
              await review(BOTH_COVER, "activate"); expect(await ruleGenes()).toEqual([BOTH_COVER.gene]);
              await signIn(capturedPage, A.email, A.password); await passGate(capturedPage); await assertComplete(capturedPage);
              if (recipe === "partial") {
                await review(ONE_SIDE_COVERS, "activate"); expect(await ruleGenes()).toEqual([BOTH_COVER.gene, ONE_SIDE_COVERS.gene]);
                await capturedPage.goto(url()); await assertPartialA(capturedPage);
                const fromA = await findingTexts(capturedPage); await signOut(capturedPage);
                await signIn(capturedPage, B.email, B.password); await passGate(capturedPage); await assertPartialB(capturedPage, fromA);
                await signOut(capturedPage);
              } else await signOut(capturedPage);
            }
            await signIn(capturedPage, A.email, A.password); await passGate(capturedPage);
            let denied: Facts | undefined;
            if (recipe === "jurisdiction") {
              const before = await facts(), artifacts = await currentJurisdictionAttestations(), artifact = artifacts[0];
              expect(before.files).toEqual([]); expect(before.portrait_results).toEqual([]);
              const declaration = await capturedPage.request.put("/api/settings/jurisdiction", {
                headers: { origin: origin.origin, "content-type": "application/json",
                  "x-inherit-operation-nonce": await settingsOperationNonce(capturedPage.request, "jurisdiction"), "x-inherit-csrf": await accountCsrf(capturedPage, "api.jurisdiction") },
                data: { code: "XX", attestationVersion: artifact.version, attestationHash: artifact.body_sha256, affirmed: true },
              });
              expect(declaration.status()).toBe(200);
              expect(JSON.parse((await declaration.body()).toString("utf8"))).toEqual({ status: "updated", jurisdiction: "XX", capabilityReevaluation: "complete" });
              const after = await facts(); checkedPortraitJurisdictionTransition(before, after, accountA, pairId);
              expect(after.profiles.find(profile => profile.id === accountA)).toMatchObject({
                jurisdiction_attestation_version: artifact.version, jurisdiction_attestation_sha256: artifact.body_sha256 });
              expect(await currentJurisdictionAttestations()).toEqual(artifacts);
              capturedPage.on("request", request => {
                const requestUrl = new URL(request.url());
                if (requestUrl.origin === origin.origin && requestUrl.pathname.startsWith("/api/")
                  && (requestUrl.pathname.includes("browser") || requestUrl.pathname.includes("variants"))) privateReads.push(requestUrl.pathname);
              });
              expect((await capturedPage.goto(url()))?.status()).toBe(200); denied = await facts();
            }
            const assertState = async () => {
              if (recipe === "complete") await assertComplete(capturedPage);
              else if (recipe === "partial") await assertPartialA(capturedPage);
              else if (recipe === "uncovered") {
                expect(await ruleGenes()).toEqual([]); await assertNotCovered(capturedPage);
              } else if (recipe === "processing") {
                assert(held, "Exactly one real uploader POST required"); await held.assertHeld();
                const state = await facts(); expect(state.files).toHaveLength(2);
                expect(state.files.find(file => file.id === fileIds.a)).toMatchObject({ status: "stored", subject_id: selfSubjectA });
                expect(state.files.find(file => file.id === fileIds.b)).toMatchObject({ status: "uploaded", subject_id: selfSubjectB, normalization_completed_at: null });
                expect(state.portrait_results).toEqual([]);
                await expect(capturedPage.locator('[data-slot="portrait-preparing"]')).toHaveText(filePreparingFor({ name: INVITEE_LABEL, isViewer: false }));
                await expect(capturedPage.locator('[data-slot="portrait-output"], [data-claim-block], [data-figure-kind], [data-slot="outcome-dot"], [data-exact-marker], [data-modelled-marker]')).toHaveCount(0);
                await expect(capturedPage.locator('main [role="status"][data-state="empty"]')).toHaveCount(0);
              } else {
                assert(denied, "Actual closed jurisdiction transition required");
                expect(await facts()).toEqual(denied); expect(privateReads).toEqual([]);
                await expect(capturedPage.getByRole("status")).toContainText("Not available in this jurisdiction yet");
                await expect(capturedPage.locator('[data-claim-block], [data-figure-kind], [data-slot="portrait-header-sentence"], [data-slot="portrait-preparing"], [data-slot="portrait-empty"], [data-slot="result-gate"], [data-slot="portrait-acknowledge"]')).toHaveCount(0);
              }
            };
            await assertState(); const fixed = await facts();
            const observe = async () => {
              assertSource(); await assertState();
              const nativeSnapshot = await facts(); expect(nativeSnapshot, "Complete actual Portrait rows remain identical around every capture").toEqual(fixed);
              expect((new URL(capturedPage.url())).pathname).toBe(url());
              const pair = nativeSnapshot.family_pairs.filter(pair => pair.id === pairId); expect(pair).toHaveLength(1);
              const subjectA = nativeSnapshot.subjects.find(subject => subject.id === selfSubjectA), subjectB = nativeSnapshot.subjects.find(subject => subject.id === selfSubjectB);
              assert(subjectA && subjectB, "Both actual independent subjects must remain present");
              for (const subject of [subjectA, subjectB]) for (const field of ["portrait_acknowledged_at", "independent_login_at"])
                assert(typeof subject[field] === "string" && Number.isFinite(Date.parse(subject[field] as string)), "Actual personal native acknowledgement/login required");
              if (recipe !== "jurisdiction") {
                expect(pair[0].status).toBe("current");
                expect(directionalPurposes(nativeSnapshot, selfSubjectA, accountB)).toEqual(["family.portrait"]);
                expect(directionalPurposes(nativeSnapshot, selfSubjectB, accountA)).toEqual(["family.portrait"]);
              } else expect(pair[0].status).toBe("pending");
              return input.observeState(row, capturedPage, sourceSha256, { accountIds: [accountA, accountB], nativeSnapshot });
            };
            await observe(); await capture({ page: capturedPage, observe }); await observe();
          } finally {
            try {
              if (held) {
                await held.settle();
                const prepared = await adminClient().from("genome_files").select("*", { count: "exact" }).eq("id", fileIds.b);
                expect(prepared.error).toBeNull(); expect(prepared.count).toBe(1); expect(prepared.data).toHaveLength(1);
                const actual = prepared.data![0];
                expect(actual).toMatchObject({ status: "stored", subject_id: selfSubjectB, roh_status: "measured", roh_reason: null });
                expect(actual.normalization_source_revision).toBe(actual.upload_revision);
                expect(actual.normalization_completed_at).not.toBeNull(); expect(actual.single_logical_sample_verified_at).not.toBeNull();
                expect(actual.sha256).toBe(createHash("sha256").update(fs.readFileSync(FIXTURE_B)).digest("hex"));
                expect(Number(actual.roh_total_bases)).toBeGreaterThan(0);
                expect(Number(actual.roh_covered_bases)).toBeGreaterThan(Number(actual.roh_total_bases));
                expect(Number(actual.roh_fraction)).toBeLessThan(0.0156); expect(actual.roh_measured_at).not.toBeNull();
                expect(await ownRunCompletions(fileIds.b)).toEqual([]);
              }
            } finally {
              try {
                if (recipe !== "jurisdiction") for (const condition of CONDITIONS) {
                  const current = await registryRevision(condition.conditionId).catch(() => null);
                  if (current?.active) await review(condition, "deactivate");
                }
              } finally { try { await viewingContext?.close(); } finally { await context.close(); } }
            }
          }
        });
      } } satisfies DensityStateFixture];
  });
}
