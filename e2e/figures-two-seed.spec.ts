import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { JOBS_SECRET, adminClient, createConfirmedUser, signIn } from "./helpers";
import {
  generateOwnFileWithChosenReports,
  uploadOwnFilePrepared,
  uploadOwnFileWithChosenReports,
} from "./own-report-helpers";
import { collectFigures, keyed, type CollectedFigure } from "./figure-collector";
import { assertEveryFigureMoved } from "./figure-differencing";
import { PERMISSION_ROWS } from "../src/copy/family/permissions";
import { GATE_BUTTON } from "../src/copy/family/person";
import type { OwnReportPurpose } from "../src/lib/uploads/own-report-purpose";

/**
 * G8.3: every number is seeded, proved by differencing.
 *
 * The brief calls this the detection for its first anti-pattern — a beautiful
 * surface over an unimplemented pipeline — and says plainly that one pinned
 * value per surface does not satisfy it. A surface rendering constants or
 * placeholders passes any single-seed assertion and fails here.
 *
 * Each surface is rendered from two synthetic genomes that describe different
 * people, and every figure must move. Figures are paired by what they are —
 * kind, class, basis, provenance and the nearest identifying ancestor — never
 * by their value, so a figure that failed to move is caught rather than
 * quietly matched to a different one.
 */
const RUN_ID = randomUUID();
const ANCESTRY = "/genome/me/ancestry";
const CAFFEINE = "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551";
const REPORTS = "/genome/me/reports";
const DATA = "/genome/me/data";
/** The browser answers nothing without a search, so this one names a position
 * both seeds carry and call differently. */
const BROWSER = "/genome/me/data/browser?q=rs762551";

/**
 * Sign a fresh account in, prepare its genome, choose its reports, and read
 * every named surface. One upload serves several surfaces: a seed is a person
 * here, and that person's whole account is what the surfaces render.
 */
async function figuresFor(page: Page, label: string, fixture: string,
  purposes: [OwnReportPurpose, ...OwnReportPurpose[]], surfaces: readonly string[]) {
  const user = { email: `figures-${label}-${RUN_ID}@e2e.local`, password: `e2e-figures-${label}-pw` };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  const fileId = await uploadOwnFilePrepared(page, path.join(process.cwd(), fixture), { fileType: "vcf" });
  await generateOwnFileWithChosenReports(page, fileId, purposes);
  const collected = new Map<string, Map<string, CollectedFigure>>();
  for (const surface of surfaces) {
    await page.goto(surface);
    collected.set(surface, keyed(await page.evaluate(collectFigures)));
  }
  return collected;
}

/** Two isolated accounts, because a seed is a person here and not a parameter. */
async function bothSeeds(browser: Browser, surfaces: readonly string[],
  purposes: [OwnReportPurpose, ...OwnReportPurpose[]],
  seedA: { label: string; fixture: string },
  seedB: { label: string; fixture: string }) {
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    const a = await figuresFor(await contexts[0]!.newPage(), seedA.label, seedA.fixture, purposes, surfaces);
    const b = await figuresFor(await contexts[1]!.newPage(), seedB.label, seedB.fixture, purposes, surfaces);
    return { a, b };
  } finally {
    for (const context of contexts) await context.close();
  }
}

test("every figure on the ancestry surface moves between two seeds", async ({ browser }) => {
  test.setTimeout(300_000);
  const { a, b } = await bothSeeds(browser, [ANCESTRY], ["ancestry"],
    { label: "ancestry-a", fixture: "e2e/fixtures/aims-mixed-grch38.vcf" },
    { label: "ancestry-b", fixture: "e2e/fixtures/aims-mixed-b-grch38.vcf" });
  assertEveryFigureMoved(ANCESTRY, a.get(ANCESTRY)!, b.get(ANCESTRY)!);
});

/**
 * The My Genome surfaces, on the same rule.
 *
 * `tiny-b-grch38.vcf` carries the same four positions as `tiny-grch38.vcf`
 * with different calls, so the genotype each page reads out has to change:
 * rs762551 is 0/1 under seed A and 1/1 under seed B. It carries a fifth
 * position, rs182549, that seed A does not: that one row moves both the
 * file's own record count and the lactase report's coverage figure, which
 * reads 1 of the 2 positions it needs under seed A and 2 of the 2 here.
 *
 * Seed B also carries twelve positions drawn from the three shipped PGS
 * panels, which seed A carries none of, so each panel's coverage figure on
 * `/genome/me/data` moves. Without them all three read "read 0 of the N
 * positions this needs" under either genome, and no honest register entry
 * covers that: the number can move, these two files just never made it.
 *
 * rs671 stays 0/0 in both. The position is read rather than dropped — these
 * surfaces read the canonical prepared source, which keeps reference calls,
 * so both seeds read G/G — and it renders the one figure here that cannot
 * move: a one-position report's coverage is "read 1 of the 1 positions this
 * needs" whenever it renders at all, because an unread position removes that
 * preview and its figure rather than lowering the number. It is registered
 * with that reason rather than papered over by calling rs671 under one seed
 * only, which would change the preview's prose and move no figure.
 */
test("every figure on the My Genome surfaces moves between two seeds", async ({ browser }) => {
  test.setTimeout(300_000);
  const surfaces = [CAFFEINE, REPORTS, DATA, BROWSER];
  const { a, b } = await bothSeeds(browser, surfaces, ["reports.polygenic"],
    { label: "report-a", fixture: "e2e/fixtures/tiny-grch38.vcf" },
    { label: "report-b", fixture: "e2e/fixtures/tiny-b-grch38.vcf" });
  // Reported together rather than one surface per test: the assertions are
  // soft, so a run names every surface that carries a constant instead of
  // stopping at the first.
  for (const surface of surfaces) assertEveryFigureMoved(surface, a.get(surface)!, b.get(surface)!);
});

/* ────────────────────────────────────────────────────────────────────────
 * The Family side-by-side surface.
 *
 * `/family/health-picture` is not one person's page: it is rendered from two
 * adults' prepared files, under a joint grant each of them signed from their
 * own account, behind the domain's one Tier-2 gate. A seed here is therefore a
 * *pair* — both members of pair A read `carrier-pair-grch38.vcf`, both members
 * of pair B read `carrier-pair-b-grch38.vcf` — and the journey below is the
 * real one: two uploads, a real invitation through the mail worker, a real
 * acceptance, six signed permissions, and the gate.
 * ──────────────────────────────────────────────────────────────────────── */

const HEALTH_PICTURE = "/family/health-picture";
const FAMILY_PURPOSES = ["reports.monogenic", "reports.polygenic"] as const;
/** The joint grant that opens a column, plus the two layer grants that open its cells. */
const GRANTED_PURPOSES = ["family.heritability", "reports.monogenic", "reports.polygenic"] as const;
type GrantedPurpose = (typeof GRANTED_PURPOSES)[number];

/**
 * G8.3's shape-level register, read here rather than in
 * `e2e/figure-differencing.ts`, because it is a different record answering a
 * different question — see `seedInvariantShapeValues` in
 * `docs/figures-register.json`.
 */
interface ShapeInvariant {
  surface: string;
  shape: string;
  figures: number;
  values: Record<string, number>;
  name: string;
  reason: string;
}
const SHAPE_REGISTER: ShapeInvariant[] =
  (JSON.parse(fs.readFileSync("docs/figures-register.json", "utf8")) as
    { seedInvariantShapeValues?: ShapeInvariant[] }).seedInvariantShapeValues ?? [];

/** What a figure is, with the cell or region it belongs to dropped: `kind|class|basis|provenance`. */
function shapeOfFigure(key: string): string {
  return key.split("|").slice(0, 4).join("|");
}

/**
 * Hold a surface's registered shapes to their record, in both directions, and
 * return the keys the record exempts.
 *
 * Both directions, as `docs/route-divergence.json` and its two siblings do it:
 * the measured histogram of "what every figure of this shape reads under both
 * seeds" must equal the register's, so an entry that lists a value no figure
 * reads any more fails exactly as loudly as a figure reading a value no entry
 * lists. Removing the reason forces the record to be updated; it cannot rot
 * into a blanket exemption.
 *
 * The declared total is the over-breadth detector. An entry has to say how
 * many figures of its shape the surface renders, so its own record reads "298
 * of 324" or "324 of 324" and a reader can see at once how much of a surface
 * it excuses. Nothing here is exempted by shape alone: a figure is exempt only
 * if it reads one of the exact strings the entry lists, under both seeds.
 */
function registeredShapeKeys(surface: string,
  a: Map<string, CollectedFigure>, b: Map<string, CollectedFigure>): Set<string> {
  const exempt = new Set<string>();
  for (const entry of SHAPE_REGISTER.filter(row => row.surface === surface)) {
    const keys = [...a.keys()].filter(key => shapeOfFigure(key) === entry.shape);
    expect.soft(keys.length,
      `${surface}: the register says ${entry.shape} renders ${entry.figures} figures here (${entry.name})`)
      .toBe(entry.figures);
    const unchanged: Record<string, number> = {};
    for (const key of keys) {
      const other = b.get(key);
      if (!other || other.value !== a.get(key)!.value) continue;
      unchanged[other.value] = (unchanged[other.value] ?? 0) + 1;
    }
    expect.soft(unchanged,
      `${surface}: what ${entry.shape} reads under both seeds must be exactly what the register records `
      + `(${entry.name}); a value the register does not list is an unregistered constant, and a value `
      + "no figure reads any more is a stale entry that must be removed")
      .toEqual(entry.values);
    for (const key of keys) {
      const other = b.get(key);
      if (other && other.value === a.get(key)!.value && entry.values[other.value] !== undefined) exempt.add(key);
    }
  }
  return exempt;
}

function without(map: Map<string, CollectedFigure>, keys: ReadonlySet<string>) {
  return new Map([...map].filter(([key]) => !keys.has(key)));
}

interface MailMessage { to: string[] | string; html?: string }

async function selfSubjectOf(accountId: string): Promise<string> {
  const { data, error } = await adminClient().from("subjects").select("id")
    .eq("subject_account_id", accountId).eq("subject_class", "self").eq("lifecycle", "active").single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** One signed purpose grant toward one person, through the real permission UI. */
async function grantPurpose(page: Page, recipientSubjectId: string, purpose: GrantedPurpose) {
  await page.goto(`/family/s-${recipientSubjectId}/permissions`);
  const label = PERMISSION_ROWS.find(row => row.id === purpose)!.label;
  const row = page.locator('[data-slot="permission-column"][data-settable="true"] [data-slot="permission-row"]')
    .filter({ has: page.locator('[data-slot="permission-label"]', { hasText: new RegExp(`^${label}$`) }) });
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("Off");
  const signed = page.waitForResponse(response => response.request().method() === "POST"
    && response.url().endsWith("/api/consents"));
  await row.getByRole("button", { name: /^Turn on / }).click();
  expect((await signed).status()).toBe(201);
  await expect(row.locator('[data-slot="permission-state"]')).toHaveText("On");
}

/**
 * One pair, walked end to end, returning every figure their side-by-side
 * surface renders. Nothing here is inserted straight into the database: both
 * files go through the real upload and preparation, the link between the two
 * accounts is a real invitation delivered by the real mail worker and accepted
 * in the invitee's own session, and all six grants are signed in the
 * permission UI.
 */
async function healthPictureFigures(page: Page, label: string, fixture: string, captured: MailMessage[]) {
  const password = `e2e-figures-${label}-pw`;
  const one = { email: `figures-${label}-1-${RUN_ID}@e2e.local`, password };
  const two = { email: `figures-${label}-2-${RUN_ID}@e2e.local`, password };
  const accountOne = await createConfirmedUser(one.email, one.password);
  const accountTwo = await createConfirmedUser(two.email, two.password);
  const file = path.join(process.cwd(), fixture);

  for (const account of [one, two]) {
    await signIn(page, account.email, account.password);
    await uploadOwnFileWithChosenReports(page, file, { fileType: "vcf", purposes: FAMILY_PURPOSES });
    await page.request.post("/auth/sign-out");
  }

  await signIn(page, one.email, one.password);
  await page.goto("/family/invite");
  await page.getByLabel("Their email address").fill(two.email);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation requested");
  // The mail worker is a batch worker: one POST claims a bounded number of due
  // rows, oldest first. On a shared database that already holds a queue from
  // other runs, one drain never reaches the row this journey just wrote, so
  // this drains until the provider has the invitation or the queue is empty —
  // no row is skipped or written by hand to get there.
  const link = /http:\/\/localhost:3100\/withdraw\/[A-Za-z0-9_-]{43}/;
  const invitationOf = () => captured.find(message =>
    (Array.isArray(message.to) ? message.to : [message.to]).includes(two.email)
    && link.test(message.html ?? ""))?.html?.match(link)?.[0];
  let invitationUrl = invitationOf();
  const drains: string[] = [];
  for (let attempt = 0; attempt < 40 && !invitationUrl; attempt++) {
    const drain = await page.request.post("/api/jobs/mail", { headers: { authorization: `Bearer ${JOBS_SECRET}` } });
    expect(drain.status(), `mail drain ${attempt + 1}`).toBe(200);
    const receipt = await drain.json() as { processed: number; failed: number; pending: number };
    drains.push(JSON.stringify(receipt));
    invitationUrl = invitationOf();
    if (!invitationUrl && receipt.processed === 0 && receipt.pending === 0) break;
  }
  expect(invitationUrl,
    `the invitation must reach the configured mail provider; drains: ${drains.join(" ")}`).toBeTruthy();
  await page.request.post("/auth/sign-out");

  // The invitee accepts in their own session, from the link they were sent.
  await page.goto(invitationUrl!);
  await page.getByRole("link", { name: "Sign in to accept" }).click();
  await page.getByLabel("Email").fill(two.email);
  await page.getByLabel("Password").fill(two.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(invitationUrl!);
  await page.getByRole("button", { name: "Accept through my account" }).click();
  await expect(page.getByRole("heading", { name: "Invitation accepted" })).toBeVisible();

  const admin = adminClient();
  const selfOne = await selfSubjectOf(accountOne);
  const inviter = await admin.from("subject_principals").select("id")
    .eq("account_id", accountOne).eq("subject_id", selfOne)
    .eq("principal_kind", "account_subject").eq("status", "active").single();
  expect(inviter.error).toBeNull();
  const accepted = await admin.from("subject_invitations").select("target_id")
    .eq("inviter_principal_id", inviter.data!.id).eq("invitation_kind", "adult_subject")
    .eq("target_kind", "subject").eq("status", "accepted").single();
  expect(accepted.error).toBeNull();
  const representativeTwo = (accepted.data as { target_id: string }).target_id;
  // The second column is the invitee's own record, reached through their
  // acceptance — not a handle this journey created on the inviter's side.
  const representative = await admin.from("subjects")
    .select("subject_class,subject_account_id").eq("id", representativeTwo).single();
  expect(representative.error).toBeNull();
  expect(representative.data).toEqual({ subject_class: "other_adult", subject_account_id: accountTwo });

  // Still the invitee's session: they grant toward the inviter's own self.
  for (const purpose of GRANTED_PURPOSES) await grantPurpose(page, selfOne, purpose);
  await page.request.post("/auth/sign-out");
  await signIn(page, one.email, one.password);
  for (const purpose of GRANTED_PURPOSES) await grantPurpose(page, representativeTwo, purpose);

  await page.goto(HEALTH_PICTURE);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: GATE_BUTTON }).click();
  await expect(page.locator("[data-compare-surface]").first()).toBeVisible();

  const figures = await page.evaluate(collectFigures);
  // Every figure has to say which cell it belongs to before it is differenced,
  // and no two cells may claim the same identity: 660 figures of three shapes
  // paired by document order is the failure that made the first ancestry run
  // compare one region against a different one and call both unchanged.
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-cell]")].map(node => node.getAttribute("data-cell") ?? ""));
  const duplicated = cells.filter((cell, index) => cells.indexOf(cell) !== index);
  expect.soft([...new Set(duplicated)],
    `${HEALTH_PICTURE}: two cells carrying one identity cannot be told apart by a reader or by this gate`)
    .toEqual([]);
  expect.soft(figures.filter(figure => figure.context === null).map(figure => `${figure.kind}:${figure.value}`),
    `${HEALTH_PICTURE}: every figure must name what it is a claim about before it is paired across two seeds`)
    .toEqual([]);
  await page.request.post("/auth/sign-out");
  return { figures, keyed: keyed(figures) };
}

test.describe("the Family side-by-side surface, under two carrier pairs", () => {
  // One mail provider socket and one shared database: these three run in order.
  test.describe.configure({ mode: "serial" });
  let mail: http.Server;
  const captured: MailMessage[] = [];
  let pairA: Awaited<ReturnType<typeof healthPictureFigures>> | null = null;
  let pairB: Awaited<ReturnType<typeof healthPictureFigures>> | null = null;

  test.beforeAll(async () => {
    mail = http.createServer((request, response) => {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        if (request.method === "POST" && request.url?.includes("/emails")) {
          captured.push(JSON.parse(body) as MailMessage);
          response.writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ id: `figures-family-${captured.length}` }));
        } else response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      mail.once("error", reject);
      mail.listen(8124, "127.0.0.1", resolve);
    });
  });

  test.afterAll(async () => {
    if (mail) await new Promise<void>(resolve => mail.close(() => resolve()));
  });

  test("pair A reaches the side-by-side surface through the real journey", async ({ page }) => {
    test.setTimeout(900_000);
    pairA = await healthPictureFigures(page, "family-a", "e2e/fixtures/carrier-pair-grch38.vcf", captured);
    expect(pairA.figures.length).toBeGreaterThan(0);
  });

  test("pair B reaches it the same way, from a different pair of files", async ({ page }) => {
    test.setTimeout(900_000);
    pairB = await healthPictureFigures(page, "family-b", "e2e/fixtures/carrier-pair-b-grch38.vcf", captured);
    expect(pairB.figures.length).toBeGreaterThan(0);
  });

  /**
   * The comparison. Two things carry this surface's figures: what each file
   * recorded, and what it says at the positions a report reads. Both move
   * between the pairs. The third — a report's own position coverage — is the
   * one this surface cannot move, and `docs/figures-register.json` says why at
   * shape level rather than 324 times.
   */
  test("every figure the Family surface renders moves between the two pairs", async () => {
    expect(pairA, "pair A must have been collected").not.toBeNull();
    expect(pairB, "pair B must have been collected").not.toBeNull();
    const a = pairA!.keyed;
    const b = pairB!.keyed;
    expect.soft([...b.keys()].sort(),
      `${HEALTH_PICTURE}: both pairs must render the same figures, or the seeds differ by surface and not by value`)
      .toEqual([...a.keys()].sort());
    const registered = registeredShapeKeys(HEALTH_PICTURE, a, b);
    assertEveryFigureMoved(HEALTH_PICTURE, without(a, registered), without(b, registered));
  });
});
