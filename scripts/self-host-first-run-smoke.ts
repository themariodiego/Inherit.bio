/** Remote clean-clone proof of the documented local flow. No admin client or result seeding. */
import { chromium, expect as baseExpect, type Browser, type Page, type Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";
import { RAW_NUMBERS_SUMMARY } from "../src/copy/ancestry";
import { regionalBelowMinimum } from "../src/copy/regional-ancestry";
import { presentRegionalShares } from "../src/lib/ancestry/regional-present";
import { estimateRegionalAdmixture, REGIONAL_AIMS } from "../src/lib/genome/regional-admixture";
import { SEVEN_ANCESTRY_PANEL } from "../src/lib/uploads/own-ancestry-content-v3";
import { directUploadReceipt, subjectFinalizationReceipt, subjectNormalizationReceipt,
  subjectSynchronousReportReceipt } from "../src/lib/uploads/subject-upload-contract";
import { checkedConfig, isRecord, LOCAL } from "./self-host-local-contract";

const SAMPLE = "data/samples/synthetic-pipeline-grch38.vcf.gz";
const SAMPLE_SHA = "46c46da43500f3b1ad5f01524c4ac9bcb52b2bd9a1dcc5b3c33aa8dbbc6a2b44";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OBSERVER_MS = 60_000;
const expect = baseExpect.configure({ timeout: OBSERVER_MS });
const STEPS = ["preflight", "signup", "emailConfirmation", "jurisdictionDeclaration", "accountCompletion", "uploadConsent",
  "stockStorageUpload", "normalization", "reportChoices", "reportGeneration", "coveredReport",
  "absentReport", "storedAncestryFallback", "copilotWithoutProvider"] as const;
type Step = typeof STEPS[number];
type StepState = "pending" | "running" | "passed" | "failed";
type Receipt = { version: 1; outcome: "running" | "passed" | "failed"; startedAt: string; finishedAt?: string;
  commit?: string; guideSha256?: string; configSha256?: string; configuredReceiptSha256?: string; fixtureSha256?: string;
  steps: Record<Step, StepState>; checks: Record<string, boolean>; continuationRejections: number;
  scope: "stock-local-signup-upload-and-result-surfaces"; paidInference: false; shutdownVerified: false };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function requireProof(value: unknown): asserts value { if (!value) throw new Error("first_run_proof_failed"); }
function json(value: string): unknown { try { return JSON.parse(value); } catch { throw new Error("first_run_invalid_json"); } }

export function requireRemoteRunner(env: Readonly<Record<string, string | undefined>>, platform: string, version: string, args: string[]): void {
  requireProof(platform === "linux" && version === "v22.17.0" && args.length === 0
    && env.CI === "true" && env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted");
  requireProof(["INHERIT_TEST_JURISDICTION", "INHERIT_DISPOSABLE_LOCAL_E2E", "INHERIT_LOCAL_E2E_PROJECT",
    "INHERIT_PREPARED_WGS_ENABLED", "VERCEL", "VERCEL_ENV", "NODE_OPTIONS"].every(key => !env[key]));
}

export function checkConfigured(value: unknown, commit: string, configSha: string, guideSha: string): void {
  requireProof(isRecord(value) && Object.keys(value).sort().join(",") ===
    "apiOrigin,appOrigin,authKid,configSha256,configuredAt,guideSha256,mailOrigin,project,sourceRevision,uploadKid,version");
  requireProof(value.version === 1 && value.project === LOCAL.project && value.apiOrigin === LOCAL.origin
    && value.appOrigin === LOCAL.app && value.mailOrigin === LOCAL.mail && value.sourceRevision === commit
    && value.configSha256 === configSha && value.guideSha256 === guideSha
    && typeof value.configuredAt === "string" && Number.isFinite(Date.parse(value.configuredAt))
    && typeof value.authKid === "string" && typeof value.uploadKid === "string" && value.authKid !== value.uploadKid);
}

/** Counts are admitted requests, never a claim that the transport reached a server. */
export function requestFence() {
  const counts: Record<string, number> = {};
  function once(name: string, maximum: number) {
    counts[name] = (counts[name] ?? 0) + 1; requireProof(counts[name] <= maximum);
  }
  return { counts, admit(raw: string, method: string) {
    const url = new URL(raw);
    requireProof(!url.username && !url.password && !url.hash && [LOCAL.app, LOCAL.origin].includes(url.origin as typeof LOCAL.app));
    if (url.origin === LOCAL.app) {
      if (method === "GET" || method === "HEAD") {
        requireProof(!url.pathname.startsWith("/api/") || new RegExp(`^/api/files/${UUID}/status$`).test(url.pathname));
        return;
      }
      // The first sign-in declares where the person lives once (G5.1a).
      if (method === "PUT" && url.pathname === "/api/settings/jurisdiction" && !url.search) return once("jurisdiction", 1);
      requireProof(method === "POST" && !url.search);
      if (url.pathname === "/api/account/completion") return once("completion", 1);
      if (url.pathname === "/api/consents") return once("consents", 4);
      if (url.pathname === "/api/files/upload-session") return once("issuance", 1);
      if (new RegExp(`^/api/files/${UUID}/finalize$`).test(url.pathname)) return once("finalize", 1);
      if (new RegExp(`^/api/files/${UUID}/process$`).test(url.pathname)) return once("process", 2);
      throw new Error("first_run_mutation_refused");
    }
    if (url.pathname === "/auth/v1/signup" && ["OPTIONS", "POST"].includes(method)) {
      requireProof([...url.searchParams.keys()].join(",") === "redirect_to"
        && url.searchParams.get("redirect_to") === `${LOCAL.app}/auth/callback?next=/overview&flow=signup`);
      if (method === "OPTIONS") return;
      return once("signup", 1);
    }
    if (url.pathname === "/auth/v1/token" && ["OPTIONS", "POST"].includes(method)) {
      requireProof([...url.searchParams.keys()].join(",") === "grant_type"
        && ["pkce", "refresh_token"].includes(url.searchParams.get("grant_type") ?? ""));
      if (method === "OPTIONS") return;
      return once("authToken", 4);
    }
    if (url.pathname === "/auth/v1/user" && ["OPTIONS", "GET"].includes(method) && !url.search) return;
    if (url.pathname === "/auth/v1/verify" && method === "GET") return once("verify", 1);
    if (new RegExp(`^/storage/v1/object/genomes/${UUID}$`).test(url.pathname) && !url.search) {
      if (method === "OPTIONS") return;
      if (method === "POST") return once("storage", 1);
    }
    throw new Error("first_run_backend_refused");
  } };
}

export function confirmationLink(body: unknown): string {
  requireProof(isRecord(body));
  const text = typeof body.Text === "string" ? body.Text : body.HTML;
  requireProof(typeof text === "string" && text.length <= 524_288);
  const matches = text.match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]*/g) ?? [];
  const first = matches[0]; requireProof(typeof first === "string");
  const url = new URL(first.replaceAll("&amp;", "&"));
  requireProof(url.origin === LOCAL.origin && url.pathname === "/auth/v1/verify" && !url.username && !url.password
    && !url.hash && url.searchParams.get("type") === "signup"
    && url.searchParams.get("redirect_to") === `${LOCAL.app}/auth/callback?next=/overview&flow=signup`
    && Boolean(url.searchParams.get("token") || url.searchParams.get("token_hash")));
  return url.href;
}

function sampleLines(bytes: Buffer): string[] {
  requireProof(sha(bytes) === SAMPLE_SHA);
  return gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 }).toString("utf8").split("\n");
}
export function sampleGenotype(bytes: Buffer): string {
  const lines = sampleLines(bytes);
  requireProof(!lines.some(line => line.split("\t")[2] === "rs762551"));
  const matches = lines.filter(line => line.split("\t")[2] === "rs72921001");
  requireProof(matches.length === 1);
  const columns = matches[0].split("\t");
  const index = columns[8].split(":").indexOf("GT");
  const alleles = [columns[3], ...columns[4].split(",")];
  const calls = columns[9].split(":")[index]?.split(/[|/]/).map(value => alleles[Number(value)]);
  requireProof(index >= 0 && calls?.length === 2 && calls.every(value => /^[ACGT]$/.test(value)));
  return calls.sort().join("/");
}

/** Reproduce only the committed synthetic fixture's partial-result contract. */
export function sampleAncestry(bytes: Buffer) {
  const panel = new Map(REGIONAL_AIMS.map(marker => [`${marker.chrom}:${marker.pos38}`, marker]));
  const calls = new Map<string, string>();
  for (const line of sampleLines(bytes)) {
    if (!line || line.startsWith("#")) continue;
    const columns = line.split("\t"), key = `${columns[0].replace(/^chr/, "")}:${columns[1]}`;
    if (!panel.has(key)) continue;
    const index = columns[8].split(":").indexOf("GT"), alleles = [columns[3], ...columns[4].split(",")];
    const genotype = columns[9].split(":")[index]?.split(/[|/]/).map(value => alleles[Number(value)]);
    requireProof(index >= 0 && genotype?.length === 2 && genotype.every(value => /^[ACGT]$/.test(value)) && !calls.has(key));
    calls.set(key, genotype.join("/"));
  }
  const result = estimateRegionalAdmixture((chrom, pos) => calls.get(`${chrom}:${pos}`) ?? null);
  requireProof(calls.size === 3 && result.markersUsed === 3 && result.proportions !== null
    && result.markersUsed < SEVEN_ANCESTRY_PANEL.minimumMarkers);
  return { calls: [...calls], result, ...presentRegionalShares(result) };
}

function safeRead(filename: string, maximum: number): Buffer {
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd); requireProof(stat.isFile() && stat.size <= maximum);
    const value = readFileSync(fd); requireProof(value.length <= maximum); return value;
  } finally { closeSync(fd); }
}
async function bounded<T>(promise: Promise<T>, ms = OBSERVER_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("first_run_observation_timeout")), ms);
  })]); } finally { clearTimeout(timer); }
}
async function responseJson(response: Response): Promise<unknown> {
  const body = await bounded(response.body()); requireProof(body.length <= 65_536); return json(body.toString());
}
async function mailJson(endpoint: string): Promise<unknown> {
  const response = await fetch(`${LOCAL.mail}${endpoint}`, { redirect: "error", signal: AbortSignal.timeout(5_000) });
  requireProof(response.status === 200 && response.body);
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.length; requireProof(length <= 524_288); parts.push(next.value);
    }
    return json(Buffer.concat(parts).toString());
  } finally { void reader.cancel().catch(() => {}); }
}
async function confirmation(address: string): Promise<string> {
  const deadline = Date.now() + OBSERVER_MS;
  while (Date.now() < deadline) {
    const result = await mailJson(`/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
    requireProof(isRecord(result) && Array.isArray(result.messages));
    const messages = result.messages.filter(message => isRecord(message) && Array.isArray(message.To)
      && message.To.some(recipient => isRecord(recipient) && recipient.Address === address));
    requireProof(messages.length <= 1);
    if (messages.length) {
      const id = messages[0].ID; requireProof(typeof id === "string" && /^[A-Za-z0-9-]{1,128}$/.test(id));
      return confirmationLink(await mailJson(`/api/v1/message/${id}`));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("first_run_confirmation_timeout");
}
function observe(page: Page, endpoint: string | RegExp, timeout = OBSERVER_MS, method = "POST"): Promise<Response> {
  const promise = page.waitForResponse(response => response.request().method() === method
    && (typeof endpoint === "string" ? response.url() === endpoint : endpoint.test(response.url())), { timeout });
  void promise.catch(() => {}); return promise;
}

export async function runFirstRunSmoke(): Promise<void> {
  requireRemoteRunner(process.env, process.platform, process.version, process.argv.slice(2));
  const root = process.cwd();
  const receipt: Receipt = { version: 1, outcome: "running", startedAt: new Date().toISOString(),
    steps: Object.fromEntries(STEPS.map(step => [step, "pending"])) as Record<Step, StepState>, checks: {},
    continuationRejections: 0, scope: "stock-local-signup-upload-and-result-surfaces", paidInference: false, shutdownVerified: false };
  mkdirSync(path.join(root, "test-results"), { recursive: true });
  const output = path.join(root, "test-results/self-host-first-run.json");
  writeFileSync(output, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
  const save = () => { const pending = `${output}.pending`; writeFileSync(pending, JSON.stringify(receipt, null, 2),
    { flag: "wx", mode: 0o600 }); renameSync(pending, output); };
  let browser: Browser | undefined; let current: Step = "preflight"; let fenceFailed = false; let pageErrors = 0;
  async function step(name: Step, action: () => Promise<void>) {
    current = name; receipt.steps[name] = "running"; save(); await action();
    requireProof(!fenceFailed && pageErrors === 0); receipt.steps[name] = "passed"; save();
  }
  // Observer deadline only; it neither changes upload limits nor retries mutations.
  const deadline = setTimeout(() => { fenceFailed = true; void browser?.close(); }, 15 * 60_000);
  try {
    let genotype = ""; let ancestry: ReturnType<typeof sampleAncestry> | undefined;
    await step("preflight", async () => {
      const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000,
        stdio: ["ignore", "pipe", "pipe"] }).trim(); requireProof(/^[0-9a-f]{40}$/.test(commit));
      requireProof(process.env.GITHUB_SHA === commit);
      const config = safeRead(path.join(root, "supabase/config.toml"), 131_072).toString(); checkedConfig(config, true);
      const guide = safeRead(path.join(root, "docs/self-hosting.md"), 131_072);
      const configured = safeRead(path.join(root, ".inherit-local/configured.json"), 4_096);
      checkConfigured(json(configured.toString()), commit, sha(config), sha(guide));
      const sample = safeRead(path.join(root, SAMPLE), 1_048_576); genotype = sampleGenotype(sample); ancestry = sampleAncestry(sample);
      Object.assign(receipt, { commit, configSha256: sha(config), guideSha256: sha(guide),
        configuredReceiptSha256: sha(configured), fixtureSha256: sha(sample) });
      receipt.checks.stockLocalConfiguration = true;
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(OBSERVER_MS); page.setDefaultNavigationTimeout(OBSERVER_MS);
    page.on("pageerror", () => { pageErrors++; });
    const fence = requestFence(); const cdp = await context.newCDPSession(page);
    cdp.on("Fetch.requestPaused", async event => {
      try { requireProof(!fenceFailed); fence.admit(event.request.url, event.request.method); }
      catch { fenceFailed = true; await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => {}); return; }
      try { await cdp.send("Fetch.continueRequest", { requestId: event.requestId }); }
      catch { receipt.continuationRejections++; await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" }).catch(() => {}); }
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    const address = `self-host-${randomUUID()}@e2e.local`; const password = randomBytes(24).toString("base64url");
    await step("signup", async () => {
      await page.goto(`${LOCAL.app}/auth/sign-up`);
      await page.getByLabel("Email", { exact: true }).fill(address); await page.getByLabel("Password", { exact: true }).fill(password);
      const signed = observe(page, /^http:\/\/127\.0\.0\.1:54321\/auth\/v1\/signup(?:\?|$)/);
      await page.getByRole("button", { name: "Sign up", exact: true }).click(); requireProof((await signed).status() === 200);
      await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
    });
    await step("emailConfirmation", async () => {
      // The first product page asks where the person lives before anything else (G5.1a).
      await page.goto(await confirmation(address)); await expect(page).toHaveURL(`${LOCAL.app}/settings?next=%2Foverview`);
      await expect(page.getByText(address, { exact: true }).first()).toBeVisible();
      receipt.checks.confirmationRequired = true;
    });
    await step("jurisdictionDeclaration", async () => {
      // A wrapping label also names the select by its chosen option, so match the prefix.
      const country = page.getByRole("combobox", { name: /^Country you live in\b/ });
      await expect(country).toHaveValue(""); await country.selectOption("GB");
      await page.getByLabel("The country I chose is the country I live in.", { exact: true }).check();
      const declared = observe(page, `${LOCAL.app}/api/settings/jurisdiction`, OBSERVER_MS, "PUT");
      await page.getByRole("button", { name: "Save country", exact: true }).click();
      requireProof((await declared).status() === 200);
      await expect(page).toHaveURL(`${LOCAL.app}/overview`);
      receipt.checks.jurisdictionDeclaredAtFirstSignIn = true;
    });
    await step("accountCompletion", async () => {
      await page.getByRole("link", { name: "I have a DNA file", exact: true }).click();
      await expect(page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading })).toBeVisible();
      await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel, { exact: true }).fill("1990-01-01");
      const saved = observe(page, `${LOCAL.app}/api/account/completion`);
      await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
      requireProof((await saved).status() === 200);
    });
    await step("uploadConsent", async () => {
      const disclosure = page.getByRole("checkbox", { name: OWN_UPLOAD_COPY.insuranceCheckbox, exact: true });
      await expect(disclosure).not.toBeChecked(); await disclosure.check();
      const insurance = observe(page, `${LOCAL.app}/api/consents`);
      await page.getByRole("button", { name: OWN_UPLOAD_COPY.insuranceContinue, exact: true }).click();
      requireProof((await insurance).status() === 201);
      const own = page.getByRole("checkbox", { name: OWN_UPLOAD_COPY.ownCheckbox, exact: true });
      await expect(own).not.toBeChecked(); const signed = observe(page, `${LOCAL.app}/api/consents`);
      await own.check(); requireProof((await signed).status() === 201);
      await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
      receipt.checks.separateExplicitUploadConsent = true;
    });
    let fileId = "";
    const finalized = observe(page, new RegExp(`^${LOCAL.app}/api/files/${UUID}/finalize$`), 180_000);
    const normalized = observe(page, new RegExp(`^${LOCAL.app}/api/files/${UUID}/process$`), 180_000);
    await step("stockStorageUpload", async () => {
      const issued = observe(page, `${LOCAL.app}/api/files/upload-session`);
      const stored = observe(page, new RegExp(`^${LOCAL.origin}/storage/v1/object/genomes/${UUID}$`), 180_000);
      await page.locator('input[type="file"]').setInputFiles(path.join(root, SAMPLE));
      const issueResponse = await issued; requireProof(issueResponse.status() === 201);
      const issuance = directUploadReceipt.parse(await responseJson(issueResponse));
      const storage = await stored; requireProof(storage.status() === 200
        && storage.url() === `${LOCAL.origin}/storage/v1/object/genomes/${issuance.stagingKey}`);
      const final = await finalized; requireProof(final.status() === 200
        && final.url() === `${LOCAL.app}/api/files/${issuance.uploadId}/finalize`);
      fileId = subjectFinalizationReceipt.parse(await responseJson(final)).fileId;
      receipt.checks.stockStorageAcknowledged = true;
    });
    await step("normalization", async () => {
      const response = await normalized; requireProof(response.status() === 200
        && response.url() === `${LOCAL.app}/api/files/${fileId}/process`);
      requireProof(subjectNormalizationReceipt.parse(await responseJson(response)).fileId === fileId);
      await expect(page.getByText("Your file is stored and prepared. Reports have not been generated yet.", { exact: false })).toBeVisible();
    });
    const openTool = async (tool: "Reports" | "Ancestry" | "Copilot") => {
      await page.goto(`${LOCAL.app}/genome/me`); await expect(page.locator('[data-slot="subject-files"]')).toHaveText("1 file");
      await page.getByRole("link", { name: `Open ${tool}`, exact: true }).click();
    };
    await step("reportChoices", async () => {
      await openTool("Reports"); const choices = page.getByRole("region", { name: "Choose your reports", exact: true });
      for (const label of ["Observed genetic variants", "Trait reports and estimates", "Ancestry"])
        await expect(choices.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
      for (const [label, purpose] of [["Trait reports and estimates", "reports.polygenic"], ["Ancestry", "ancestry"]]) {
        await choices.getByRole("checkbox", { name: label, exact: true }).check();
        const signed = observe(page, `${LOCAL.app}/api/consents`);
        const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/genome/me/reports"
          && response.request().method() === "GET" && response.request().headers().rsc === "1");
        void refreshed.catch(() => {});
        await choices.getByRole("button", { name: `Enable ${label}`, exact: true }).click();
        const signature = await signed; requireProof(signature.status() === 201);
        const body = await responseJson(signature);
        requireProof(isRecord(body) && body.recordKind === "purpose_grant" && body.purposeKey === purpose);
        requireProof((await refreshed).status() === 200);
        await expect(choices.getByRole("button", { name: `Turn off ${label}`, exact: true })).toBeVisible();
      }
      await expect(choices.getByRole("checkbox", { name: "Observed genetic variants", exact: true })).not.toBeChecked();
      receipt.checks.onlyChosenReportPurposes = true;
    });
    await step("reportGeneration", async () => {
      const select = page.getByRole("combobox", { name: /^File to use\b/ });
      if (await select.count()) { await select.selectOption(fileId); await expect(select).toHaveValue(fileId); }
      const generated = observe(page, `${LOCAL.app}/api/files/${fileId}/process`, 180_000);
      await page.getByRole("button", { name: "Generate selected reports", exact: true }).click();
      const response = await generated; requireProof(response.status() === 200
        && subjectSynchronousReportReceipt.parse(await responseJson(response)).fileId === fileId);
    });
    await step("coveredReport", async () => {
      await openTool("Reports");
      await page.locator('a[href="/genome/me/reports/cilantro-soapy-taste-or6a2"]').click();
      await expect(page.locator('[data-variant-result="72921001"] [data-figure-kind="genotype"] [data-slot="figure-value"]')).toHaveText(genotype);
      receipt.checks.coveredCallMatchesCommittedSample = true;
    });
    await step("absentReport", async () => {
      await openTool("Reports");
      await page.locator('a[href="/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551"]').click();
      const result = page.locator('[data-variant-result="762551"]');
      await expect(result.locator('[data-outcome="not-covered"]')).toContainText("Your file does not cover this variant.");
      await expect(result).toContainText("This is a limit of your file, not a result about you.");
      await expect(result.locator('[data-figure-kind="genotype"]')).toHaveCount(0);
      receipt.checks.absenceIsNotAResult = true;
    });
    await step("storedAncestryFallback", async () => {
      requireProof(ancestry);
      await openTool("Ancestry"); const region = page.locator('[data-slot="regional-ancestry"]');
      await expect(region.locator('[data-slot="grey-state"]')).toHaveText(regionalBelowMinimum(ancestry.result.markersUsed, SEVEN_ANCESTRY_PANEL.minimumMarkers));
      await expect(region.locator('[data-slot="stored-support-note"]')).toBeVisible();
      await expect(region.locator('[data-slot="stored-support-note"]')).toHaveText(ancestry.result.note);
      await expect(region.locator('[data-slot="ancestry-map"]')).toHaveAttribute("data-mode", "grey");
      await expect(region.locator('[data-slot="ancestry-map"] [role="button"], [data-slot="ancestry-chip"], [data-slot="well-supported-toggle"], [data-slot="region-row"]')).toHaveCount(0);
      const raw = region.locator('details[data-slot="raw-numbers"]');
      await expect(raw).toHaveCount(1); await expect(raw).toHaveJSProperty("open", false);
      await expect(raw.locator("summary").first()).toHaveText(RAW_NUMBERS_SUMMARY);
      await expect(raw.locator("summary").first()).toBeVisible();
      await expect(raw).toContainText(`Only 3 of the required ${SEVEN_ANCESTRY_PANEL.minimumMarkers} usable markers were read. These raw estimates are unreliable. They may change greatly with the missing markers.`);
      await expect(raw.locator('[data-slot="regional-caveat"]')).toHaveText(ancestry.result.reporting.caveat);
      const figures = '[data-figure-kind="ancestry-share"]';
      const count = ancestry.rows.length + ancestry.split.length;
      await expect(raw.locator(figures)).toHaveCount(count);
      await expect(region.locator(figures)).toHaveCount(count);
      await expect(region.locator(`${figures}:visible`)).toHaveCount(0);
      await expect(raw.locator('[data-slot="raw-numbers-list"] [data-region]')).toHaveCount(ancestry.rows.length);
      await expect(raw.locator('[data-split-region]')).toHaveCount(ancestry.split.length);
      for (const [attribute, rows] of [["data-region", ancestry.rows], ["data-split-region", ancestry.split]] as const) {
        for (const row of rows) {
          const figure = raw.locator(`[${attribute}="${row.code}"] ${figures}`);
          await expect(figure).toHaveCount(1); await expect(figure).not.toBeVisible();
          await expect(figure).toHaveAttribute("data-figure-basis", "modelled");
          await expect(figure.locator('[data-slot="figure-value"]')).toHaveText(`${(row.share * 100).toFixed(1)}%`);
          await expect(figure.locator('[data-slot="figure-unit"]')).toHaveText("no range yet");
        }
      }
      receipt.checks.storedInsufficientMarkerResult = true;
    });
    await step("copilotWithoutProvider", async () => {
      await openTool("Copilot"); await expect(page).toHaveURL(`${LOCAL.app}/copilot/me`);
      await expect(page.getByTestId("local-mode-instructions")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Message the copilot", exact: true })).toHaveCount(0);
      await page.getByRole("link", { name: "Open Settings →", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Copilot model", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Copilot permission", exact: true })).toContainText(
        "Save an available model and complete your own-file permission before enabling Copilot.");
      receipt.checks.providerAbsentNoInference = true;
    });
    requireProof(!fenceFailed && pageErrors === 0 && fence.counts.signup === 1 && fence.counts.completion === 1
      && fence.counts.consents === 4 && fence.counts.issuance === 1 && fence.counts.storage === 1
      && fence.counts.finalize === 1 && fence.counts.process === 2);
    receipt.checks.noUnexpectedBrowserRequests = true; receipt.checks.noPageErrors = true;
    receipt.outcome = "passed";
  } catch {
    receipt.steps[current] = "failed"; receipt.outcome = "failed";
    throw new Error("self_host_first_run_failed");
  } finally {
    clearTimeout(deadline); if (browser) await bounded(browser.close(), 10_000).catch(() => {});
    receipt.finishedAt = new Date().toISOString(); save();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runFirstRunSmoke().then(() => { process.stdout.write("Local first-run smoke passed. See the sanitized receipt.\n"); })
    .catch(() => { process.stderr.write("Local first-run smoke failed; no mutation was retried. See the sanitized receipt if created.\n"); process.exitCode = 1; });
}
