import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { localE2eProject } from "../scripts/local-e2e-project";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";
import { subjectFinalizationReceipt, subjectNormalizationReceipt } from "../src/lib/uploads/subject-upload-contract";

const localProject = localE2eProject(process.env);
export const SUPABASE_URL = localProject.apiOrigin;
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? (localProject.projectId === "sequence" ?
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0" : "");
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? (localProject.projectId === "sequence" ?
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU" : "");
export const MAILPIT_URL = localProject.mailpitOrigin;
export const JOBS_SECRET = "e2e-jobs-secret";

export function adminClient(): SupabaseClient {
  assert(SERVICE_KEY, "Selected local project service key requires the provider bootstrap");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export function anonClient(): SupabaseClient {
  assert(ANON_KEY, "Selected local project public key requires the provider bootstrap");
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
}

/** Create a confirmed user directly (bypasses the email flow — auth.spec
 * covers that flow itself). Returns the user id. */
/**
 * `listUsers` is paginated and returns the first 50 by default, so a lookup
 * that reads page one only finds a leftover fixture while the database is
 * nearly empty. That is always true in CI, which starts fresh, and stops
 * being true on a second local run: with 130 users present, `a11y@e2e.local`
 * sat past page one, the caller concluded it did not exist, and `createUser`
 * refused it as already registered — an "idempotent" helper failing on the
 * one case idempotence is for. Pages until it finds the address or runs out.
 */
async function findUserByEmail(admin: SupabaseClient, email: string) {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data?.users.find((u) => u.email === email);
    if (found) return found;
    if (!data?.users.length || data.users.length < perPage) return null;
  }
  return null;
}

export async function createConfirmedUser(
  email: string,
  password: string,
): Promise<string> {
  const admin = adminClient();
  // Idempotent: reuse any leftover user with this email.
  const existing = await findUserByEmail(admin, email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`updateUser: ${error.message}`);
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

/** Sign the browser session in through the UI. */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(?:dashboard|overview)/);
}

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

/** Latest Mailpit message to an address, with its HTML+text body. */
export async function latestEmailTo(
  address: string,
  { timeoutMs = 30_000 } = {},
): Promise<{ subject: string; body: string } | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { messages: MailpitMessage[] };
      const msg = json.messages?.[0];
      if (msg) {
        const bodyRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`);
        const body = (await bodyRes.json()) as {
          Text: string;
          HTML: string;
          Subject: string;
        };
        return { subject: body.Subject, body: `${body.Text}\n${body.HTML}` };
      }
    }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function clearMailbox() {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}

/** Complete current own-upload decisions through the real account screens.
 * Repeated calls retain current signatures; no database consent fixture is
 * manufactured to bypass a user action or the server's presentation nonce.
 */
export async function completeOwnUploadConsent(page: Page): Promise<void> {
  await page.goto("/files/upload");
  const account = page.getByRole("heading", { name: OWN_UPLOAD_COPY.accountHeading, exact: true });
  const insurance = page.getByRole("heading", { name: OWN_UPLOAD_COPY.insuranceHeading, exact: true });
  const own = page.getByRole("heading", { name: OWN_UPLOAD_COPY.ownHeading, exact: true });
  const choose = page.getByRole("button", { name: "Choose file", exact: true });
  await expect(account.or(insurance).or(own).or(choose).first()).toBeVisible();
  if (await account.isVisible()) {
    await page.getByLabel(OWN_UPLOAD_COPY.birthDateLabel).fill("1990-01-01");
    const saved = page.waitForResponse(response => response.url().endsWith("/api/account/completion")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: OWN_UPLOAD_COPY.accountContinue, exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(insurance).toBeVisible();
  }
  if (await insurance.isVisible()) {
    await page.getByRole("checkbox", { name: OWN_UPLOAD_COPY.insuranceCheckbox, exact: true }).check();
    const signed = page.waitForResponse(response => response.url().endsWith("/api/consents")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: OWN_UPLOAD_COPY.insuranceContinue, exact: true }).click();
    expect((await signed).status()).toBe(201);
    await expect(own).toBeVisible();
  }
  const affirmation = page.getByRole("checkbox", { name: OWN_UPLOAD_COPY.ownCheckbox, exact: true });
  if (await affirmation.isVisible()) {
    const signed = page.waitForResponse(response => response.url().endsWith("/api/consents")
      && response.request().method() === "POST");
    await affirmation.check();
    expect((await signed).status()).toBe(201);
  }
  await expect(choose).toBeEnabled();
}

/** Real file picker → restricted Storage bearer → bodyless finalization.
 * The app computes its own hash/format declaration. Browser fixtures never
 * substitute the old ordinary login token or insert a genome_files row.
 * Resolves at finalization; normalization/report completion is separate.
 */
export async function uploadOwnFileThroughUi(page: Page, filePath: string): Promise<string> {
  await completeOwnUploadConsent(page);
  const completed = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/finalize$/.test(response.url())
    && response.request().method() === "POST");
  const failure = page.getByRole("alert").filter({ hasText: /\S/ }).waitFor({ state: "visible", timeout: 30_000 })
    .then(async () => { throw new Error(`Upload stopped before finalization: ${await page.getByRole("alert").filter({ hasText: /\S/ }).innerText()}`); });
  await page.locator('input[type="file"]').setInputFiles(filePath);
  const response = await Promise.race([completed, failure]);
  expect(response.status(), "canonical file finalization").toBe(200);
  return subjectFinalizationReceipt.parse(await response.json()).fileId;
}

/** Existing result suites require actual analytic readiness, not merely a
 * stored or normalized source. The canonical uploader now handles transport.
 * Purpose-specific report generation must be connected before these legacy
 * result-precondition callers can pass again; never seed an annotated row.
 */
export async function ingestFileAs(
  page: Page,
  _email: string,
  _password: string,
  filePath: string,
  fileType: string,
): Promise<string> {
  const prepared = page.waitForResponse(response => /\/api\/files\/[0-9a-f-]{36}\/process$/.test(response.url())
    && response.request().method() === "POST");
  const fileId = await uploadOwnFileThroughUi(page, filePath);
  const response = await prepared;
  expect(response.status(), "canonical source normalization").toBe(200);
  expect(subjectNormalizationReceipt.parse(await response.json()).fileId).toBe(fileId);
  const file = await adminClient().from("genome_files").select("status,file_type").eq("id", fileId).single();
  expect(file.data?.file_type, "server inferred source format").toBe(fileType);
  if (file.error || file.data?.status !== "annotated") {
    throw new Error("The file is normalized, but this result fixture still needs explicit purposes and real report generation.");
  }
  return fileId;
}

/**
 * Seeded, non-fixture report templates in data/templates for ONE layer — the
 * only library counts a product surface may show, and never summed across
 * layers (brief §4 §1.4). Read from disk so no spec hard-codes the number;
 * the layer is derived as scripts/seed.ts derives it (absent → estimate);
 * fixture templates (auto-e2e-*) published by the research spec are excluded
 * by isFixtureSlug on every surface.
 */
export function seededTemplateCount(layer: "estimate" | "variant_call"): number {
  const dir = path.join(process.cwd(), "data/templates");
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const templates = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as {
      slug: string;
      layer?: string;
    }[];
    count += templates.filter(
      (t) => !t.slug.startsWith("auto-e2e-") && (t.layer ?? "estimate") === layer,
    ).length;
  }
  return count;
}

/**
 * X6.1 basis, identical to scripts/density-baseline/capture.mjs: rendered
 * interactive elements whose top edge is inside the first viewport, excluding
 * persistent navigation (anything inside a `nav`), the skip link and the
 * Copilot entry control. Shared by the specs that pin the first-viewport
 * budget (`overview.spec.ts`, `genome-data.spec.ts`).
 */
export async function firstViewportInteractives(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.matches('a[href="#main"]')) continue;
      if (element.closest("nav,[data-copilot-entry]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (element.getClientRects().length === 0) continue;
      if (rect.top >= window.innerHeight) continue;
      found.push(
        `${element.tagName.toLowerCase()}:${(element.textContent ?? "").trim().slice(0, 40)}`,
      );
    }
    return found;
  });
}

export type AxeTheme = "light" | "dark";

/**
 * Every WCAG 2.1 A/AA violation on the page as it stands, in the shape the
 * assertions print.
 *
 * One definition, because five specs each carried their own copy of the audit
 * and four of them filtered it down to `serious` and `critical`. That filter
 * is not a smaller version of the same check: a `moderate` violation is still
 * a WCAG failure, and the public-route sweep in `e2e/a11y.spec.ts` has always
 * required zero of any impact. So the Family, Portrait, Embryo and Copilot
 * surfaces were held to a lower bar than every marketing page, silently,
 * because the bar lived in each spec rather than in one place.
 */

/**
 * The first-party origin audit, lifted out of `e2e/network-audit.spec.ts` so
 * more than that file's eight surfaces can run it.
 *
 * "No third-party origin is contacted by a page carrying genome data" is one of
 * the product's load-bearing promises, and it was proven on the landing page,
 * the providers page, the dashboard, a report and the genome browser - eight
 * surfaces of the register's 62 kept pages. G1.7 asks for every registered
 * route. The population is 62 pages, not 113 routes: 88 register entries are
 * endpoints, which render nothing and contact nothing. The a11y sweep already
 * navigates all 62 in both themes under a coverage assertion, so the audit can
 * ride on navigations that are already paid for rather than doubling them.
 *
 * Fonts are self-hosted through next/font, so not even Google Fonts appears at
 * runtime, which is why the allowlist is two entries and not a policy.
 */
export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "http://localhost:3100", // the app itself
  "http://127.0.0.1:54321", // this deployment's own Supabase API
]);

/** Hosts whose mere appearance is the finding, whatever the request was for. */
export const TRACKER_HOST_FRAGMENTS: readonly string[] = [
  "facebook", "fbcdn", "doubleclick", "google-analytics", "googletagmanager",
  "googleadservices", "googlesyndication", "clarity.ms", "hotjar", "segment",
  "mixpanel", "amplitude", "sentry", "datadog", "fullstory", "intercom",
  "hubspot", "linkedin", "tiktok", "snapchat", "pinterest", "criteo",
  "adsrvr", "taboola", "outbrain", "quantserve", "scorecardresearch",
];

export type ObservedRequests = { origins: Set<string>; urls: string[] };

/** Attach before the navigation whose requests are being judged. */
export function watchRequests(page: Page): ObservedRequests {
  const origins = new Set<string>();
  const urls: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    // data: and blob: are the page's own bytes; they reach no network.
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    origins.add(url.origin);
    urls.push(request.url());
  });
  return { origins, urls };
}

/**
 * Three things the brief names, in one place so no caller can check two of
 * them: the origin set, the tracker hosts, and the three globals a tag manager
 * arrives through. `dataLayer` is the one that appears without a visible script
 * tag, pushed by an inlined snippet before anything else loads.
 */
export async function assertNoThirdParty(
  page: Page,
  observed: ObservedRequests,
  label: string,
): Promise<void> {
  const offenders = [...observed.origins].filter(origin => !ALLOWED_ORIGINS.has(origin));
  expect(offenders, `${label}: unexpected third-party origins: ${offenders.join(", ")}\nURLs: `
    + observed.urls.filter(url => offenders.some(origin => url.startsWith(origin))).slice(0, 10).join("\n"))
    .toHaveLength(0);

  for (const url of observed.urls) {
    const host = new URL(url).hostname;
    for (const fragment of TRACKER_HOST_FRAGMENTS) {
      expect(host.includes(fragment), `${label}: tracker-like host ${host}`).toBe(false);
    }
  }

  for (const global of ["fbq", "gtag", "dataLayer"] as const) {
    const seen = await page.evaluate(
      name => typeof (window as never as Record<string, unknown>)[name], global);
    expect(seen, `${label}: window.${global} must be undefined`).toBe("undefined");
  }
}

/**
 * The tag matrix `docs/inherit-v2-brief.md` pins for the accessibility gate:
 * "axe with tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice".
 * It used to read `["wcag2a", "wcag2aa"]`, two of the six, so WCAG 2.1 and 2.2
 * additions and every best-practice rule went unchecked everywhere. Widening
 * it found the four auth pages carrying no landmarks at all.
 */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] as const;

/**
 * The three viewports the same paragraph pins. A single desktop audit cannot
 * stand for them: the phone widths are where a layout reflows, a control
 * shrinks below its target size and a disclosure collapses, so a rule that
 * passes at 1280 can fail at 320 on the same markup.
 */
export const AXE_VIEWPORTS = [
  { label: "320x568", width: 320, height: 568 },
  { label: "390x844", width: 390, height: 844 },
  { label: "1280x800", width: 1280, height: 800 },
] as const;

export type AxeFinding = {
  id: string; theme: AxeTheme; viewport: string; motion: "no-preference" | "reduce";
  nodes: number; help: string;
};

async function analyze(page: Page, theme: AxeTheme, viewport: string,
  motion: AxeFinding["motion"]): Promise<AxeFinding[]> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  return results.violations.map(violation => ({
    id: violation.id, theme, viewport, motion, nodes: violation.nodes.length, help: violation.help,
  }));
}

/**
 * One loaded page, audited across the pinned viewport matrix and once under
 * reduced-motion emulation. Resizing rather than reloading is deliberate: the
 * navigation dominates the cost, and a resize exercises the same rendered
 * document the reader would resize. Reduced motion is audited once, at the
 * desktop width, because it changes which animations run rather than how the
 * page lays out. Leaves the page at the last pinned viewport with motion
 * unset, which is how Playwright found it.
 */
export async function axeViolations(page: Page, theme: AxeTheme): Promise<AxeFinding[]> {
  const findings: AxeFinding[] = [];
  const original = page.viewportSize();
  for (const viewport of AXE_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // Resizing is not instant: audit the layout the width produced, not the
    // one it is leaving.
    await page.waitForFunction(width => window.innerWidth === width, viewport.width);
    findings.push(...await analyze(page, theme, viewport.label, "no-preference"));
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  findings.push(...await analyze(page, theme, "1280x800", "reduce"));
  await page.emulateMedia({ reducedMotion: null });
  if (original) await page.setViewportSize(original);
  return findings;
}

/**
 * Axe in both themes, each on a fresh load in that theme: the theme provider
 * flips the class on the live page and the chrome animates its colours, so an
 * audit taken on a page loaded in the other theme samples mid-transition
 * colours. Leaves the page in light, as it found it.
 */
export async function expectAxeClean(page: Page) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(await axeViolations(page, theme), `${new URL(page.url()).pathname} (${theme})`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}
