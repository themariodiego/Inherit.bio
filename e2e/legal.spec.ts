import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { expect, test, type Page } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { NOT_FOUND_HEADING } from "../src/copy/not-found";
import path from "node:path";
import { randomUUID } from "node:crypto";

// A15 — legal pages complete; placeholder-grep gate passes (run separately as
// pnpm gate:legal); disclaimers verified present on report SURFACES by E2E
// (not only in ToS). Also checks the eight required legal sections exist and
// the Plus Bio separate-service disclosure is present and accurate.

const REQUIRED = [
  { route: "/privacy", must: [/children/i, /genetic data/i, /change of control|change-of-control/i, /deletion/i, /export/i] },
  { route: "/terms", must: [/18|eighteen/i, /not medical advice|informational/i, /export/i, /AGPL/i] },
  {
    route: "/legal/research-consent",
    must: [
      /conducts no research with customer or subject data/i,
      /specific purpose and each recipient class needs its own opt-in/i,
      /names every recipient/i,
      /institutional review board, or an equal independent body/i,
      /publish its name, decision, and protocol reference/i,
      /may never use embryo data/i,
      /may never use data about another adult/i,
      /withdrawal stops new transfers/i,
      /exactly what cannot be recalled after withdrawal/i,
      /research consent never permits internal model development or model training/i,
    ],
  },
  {
    route: "/legal/law-enforcement",
    must: [
      /law enforcement/i,
      /search warrant or an equal judicial order/i,
      /subpoena alone is not enough/i,
      /resist subpoenas for genetic data/i,
      /notify each affected person before we comply/i,
      /notice as soon as that bar ends/i,
      /another adult subject/i,
      /future-person records/i,
      /forensic genealogy database/i,
      /requests received[\s\S]{0,80}all jurisdictions\s+0/i,
      /requests resisted[\s\S]{0,80}all jurisdictions\s+0/i,
      /requests complied with[\s\S]{0,80}all jurisdictions\s+0/i,
    ],
  },
  {
    route: "/legal/deceased",
    must: [
      /deceased|next of kin|next-of-kin/i,
      /death certificate/i,
      /does not accept a new upload.*died/i,
      /other adult who later dies/i,
      /embryo record after a genetic parent dies/i,
      /future-person record/i,
      /human reviewer/i,
      /30 days’ notice/i,
      /recorded choice comes first/i,
      /living relative’s genotype unless that relative consents/i,
    ],
  },
  {
    route: "/legal/appeals",
    must: [
      /do not need an Inherit account to object or appeal/i,
      /genome uploaded to Inherit is yours and you did not consent/i,
      /genetic relative may also object/i,
      /turns off every page and result that others can see about that relative/i,
      /does not match relatives and does not compute shared DNA/i,
      /across every account within 60 seconds/i,
      /confirmation that names exactly what we switched off/i,
      /named human reviews every identity or legal decision/i,
      /automated system cannot approve or reject/i,
      /within five business days/i,
      /final response within 30 days/i,
      /does not restart either clock/i,
      /Genetic values never appear in a public response/i,
    ],
  },
  {
    route: "/legal/future-person",
    must: [
      /The record is yours/i,
      /When you turn 18, you can ask us for everything we hold/i,
      /full record of who agreed to what/i,
      /parents’ own DNA results unless they agree separately/i,
      /deleted completely.*within 30 days/i,
      /Nobody, including your parents, can stop you/i,
      /never to analyse it again/i,
      /never share it with an insurer, an employer, or a school/i,
      /never send it to an outside AI company/i,
      /court order that we first tried to resist/i,
      /For anyone’s genome but your own, Copilot only runs on a model you host yourself/i,
      /We keep the record until you are 20/i,
      /If no one has claimed it by then, we delete it/i,
      /intended beneficiary of rights one through six/i,
      /Contracts \(Rights of Third Parties\) Act 1999 applies/i,
      /is not excluded/i,
      /cannot include another subject’s variant rows/i,
      /Family features, embryo storage, and embryo analysis are off/i,
      /named lawyer.*each operating jurisdiction/i,
    ],
  },
  {
    route: "/legal/gdpr",
    must: [
      /special-category data under Article 9/i,
      /Article 6\(1\)\(a\).*Article 9\(2\)\(a\)/i,
      /every registered purpose_key/i,
      /reports\.monogenic/i,
      /copilot\.cloud/i,
      /family\.portrait/i,
      /embryo\.analysis/i,
      /not offered to people in the EU or UK/i,
      /controller.*legal identity and postal contact have not been published/i,
      /data protection officer has not been appointed/i,
      /EU Article 27 representative nor a UK representative has been appointed/i,
      /within one month/i,
      /up to two more months/i,
      /each actual destination country/i,
      /impact-assessment summaries/i,
    ],
  },
  {
    route: "/legal/incident-response",
    must: [
      /security@inherit.bio/i,
      /do not include genome data, passwords, access keys/i,
      /does not yet name an encryption key/i,
      /credible report starts an assessment within four hours/i,
      /stop unsafe access/i,
      /document confirmed incidents even when no data loss is found/i,
      /GDPR Article 33/i,
      /within 72 hours/i,
      /late notice must explain the delay/i,
      /GDPR Article 34/i,
      /notify affected people without undue delay/i,
      /US state attorneys general/i,
      /not only the account holder/i,
      /another adult whose genome was uploaded/i,
      /genetic parent.*embryo record/i,
      /future-person record/i,
      /notify the claimant/i,
      /September 1, 2026.*No incidents to report/i,
    ],
  },
  { route: "/legal/gina", must: [/GINA/i, /life insurance/i, /disability/i, /long[- ]term[- ]care/i] },
  { route: "/about", must: [/Plus Bio/i, /separate|independent/i, /no.*(personal|health|genetic).*data.*flow|data.*(does not|never).*flow/i] },
  { route: "/legal", must: [/Legal and policy library/i, /privacy/i] },
  { route: "/legal/consents", must: [/Granular grants/i, /Revocation/i, /Versioned evidence/i] },
  {
    route: "/legal/insurance-and-discrimination",
    must: [/Protection has gaps/i, /Not legal advice/i],
  },
  { route: "/legal/self-hosting", must: [/Operator responsibility/i, /Open source is not approval/i] },
  { route: "/legal/state-genetic-privacy", must: [/Rule source/i, /Correcting location/i] },
  {
    route: "/science/limits",
    must: [/Coverage is not absence/i, /Association is not destiny/i, /Clinical confirmation/i],
  },
  { route: "/science/positions", must: [/Canonical build/i, /Strand handling/i, /Source fidelity/i] },
  {
    // X15 declared gaps, published once with their reason.
    route: "/science",
    must: [
      /What Inherit does not do/,
      /does not match you with relatives/i,
      /does not work out how much DNA two people share/i,
      /does not offer prenatal or newborn screening/i,
    ],
  },
];

const PLACEHOLDERS = /\bTODO\b|\bTBD\b|\bFIXME\b|lorem ipsum|\bN\/A\b|\[[^\]]*specify[^\]]*\]|\bPLACEHOLDER\b/i;

/**
 * One document page in its `complete` state: the committed content rendered,
 * on-topic, free of placeholder text and of real length.
 *
 * The assertions are exactly the ones this file has always made. What changed
 * is that each route now has its own statically-titled test instead of one
 * interpolated `test(\`legal page ${route} …\`)` loop. That loop drove all
 * eleven `complete` states and named none of them that a reader could see:
 * `scripts/route-gate.ts` reads titles **statically** out of the source, so
 * `${route}` reached it as the literal five characters and proved nothing —
 * the gate says so itself, counting these among the titles "built by
 * interpolation, which this static reader cannot resolve and does not guess
 * at".
 *
 * This is the one honest use of the title convention, and it is worth being
 * precise about why, because the convention is otherwise exactly how this
 * ratchet gets faked: nothing here is being renamed into a proof it does not
 * earn. Each of these tests already navigated to its route and already
 * asserted that route's committed content; the state was driven and the proof
 * was merely unreadable. Retitling a test that drives nothing would be the
 * abuse. Resolving an interpolation the reader cannot evaluate is not.
 */
const REQUIRED_CONTENT = new Map(REQUIRED.map(entry => [entry.route, entry.must]));

async function assertDocumentComplete(page: Page, route: string): Promise<void> {
  const must = REQUIRED_CONTENT.get(route);
  if (!must) throw new Error(`${route} has no required-content list in REQUIRED`);
  const res = await page.goto(route);
  expect(res?.status(), `${route} must render`).toBeLessThan(400);
  const body = await page.locator("main, body").first().innerText();
  for (const re of must) {
    expect(body, `${route} must contain ${re}`).toMatch(re);
  }
  expect(body, `${route} must not contain placeholders`).not.toMatch(PLACEHOLDERS);
  expect(body.length, `${route} must have substantial content`).toBeGreaterThan(800);
}

test("/privacy complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/privacy");
});

test("/terms complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/terms");
});

test("/legal/research-consent complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/research-consent");
});

test("/legal/law-enforcement complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/law-enforcement");
});

test("/legal/deceased complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/deceased");
});

test("/legal/appeals complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/appeals");
});

test("/legal/future-person complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/future-person");
});

test("/legal/gdpr complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/gdpr");
});

test("/legal/incident-response complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/incident-response");
});

test("/legal/gina complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/gina");
});

test("/about complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/about");
});

test("/science complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/science");
});

test("/legal complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal");
});

test("/legal/consents complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/consents");
});

test("/legal/insurance-and-discrimination complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/insurance-and-discrimination");
});

test("/legal/self-hosting complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/self-hosting");
});

test("/legal/state-genetic-privacy complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/legal/state-genetic-privacy");
});

test("/science/limits complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/science/limits");
});

test("/science/positions complete: the committed document renders on-topic and placeholder-free", async ({ page }) => {
  await assertDocumentComplete(page, "/science/positions");
});

/**
 * An unknown artifact is one of 72 `notFound()` call sites across 19 route
 * files. Until this change every one of them rendered the framework's built-in
 * page, because the app had no `not-found.tsx`; this asserts that a real call
 * site now reaches Inherit's own, not just an unmatched URL.
 *
 * Deliberately not titled as a proven route state. The register declares
 * `empty` supported for `versioned-document` while `static-document` says "a
 * versioned public document always has committed content", so whether a 404 is
 * this route's `empty` state is a contradiction in the register itself and an
 * owner's to settle. Claiming the pair here would be exactly the kind of proof
 * this repository refuses to manufacture.
 */
test("an unknown legal artifact reaches Inherit's own not-found page, not the framework's", async ({
  page,
}) => {
  const res = await page.goto("/legal/definitely-not-a-committed-artifact");
  expect(res?.status(), "an unknown artifact is a 404").toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NOT_FOUND_HEADING);

  // The regression this test was written badly enough to find. Next renders the
  // nearest not-found boundary *inside* the layouts above it, and this group's
  // layout already supplies the one `<main id="main">`. A boundary that brought
  // its own produced two `main` landmarks and two `id="main"` elements here -
  // a `landmark-one-main` failure, a duplicate id, and a skip link aimed at an
  // ambiguous target - while passing an audit that only ever visited an
  // unmatched URL, which renders under the bare root layout.
  await expect(page.locator("main"), "exactly one main landmark").toHaveCount(1);
  await expect(page.locator("#main"), "exactly one skip-link target").toHaveCount(1);

  // The page must not distinguish "no such document" from "not yours any more"
  // (brief line 477 makes a 404 the response to a revoked request).
  const body = await page.locator("main").innerText();
  for (const leak of ["revoked", "deleted", "no longer have", "removed"]) {
    expect(body.toLowerCase(), `"${leak}" would confirm what the 404 withholds`).not.toContain(leak);
  }
});

test("Plus Bio disclosure is accurate (created by, legally separate, no data flow)", async ({
  page,
}) => {
  await page.goto("/about");
  const body = (await page.locator("main").innerText()).toLowerCase();
  expect(body).toContain("plus bio");
  // The relationship must state both halves: created by Plus Bio AND legally
  // separate — creation without separation or vice versa misstates it.
  expect(body).toMatch(/created by plus bio/);
  expect(body).toMatch(/legally separate/);
  expect(body).toMatch(/public good/);
  expect(body).toMatch(/no.*data.*flow|data.*(does not|never|doesn't).*(flow|pass|move)/);
});

test("the creation attribution renders in the site chrome", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText(/created by plus bio for the public good/i).first(),
  ).toBeVisible();
});

test("disclaimers appear on the report SURFACE, not only in ToS", async ({
  page,
}) => {
  const user = { email: `legal-report-${randomUUID()}@e2e.local`, password: "e2e-legal-pw" };
  await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"), { fileType: "vcf", purposes: ["reports.polygenic"] });

  await page.goto("/genome/me/reports");
  await page.getByRole("link", { name: /^Caffeine metabolism · CYP1A2,/ }).click();
  await expect(page.locator("main h1")).toHaveText("Caffeine metabolism");
  await expect(page.locator('[data-figure-kind="genotype"]')).toHaveCount(1);
  await expect(page.getByTestId("report-disclaimer")).toBeVisible();
  // The one not-diagnostic line (§5 §6.1), character-for-character.
  await expect(page.getByTestId("report-disclaimer")).toHaveText(
    "This is not a diagnosis. Inherit is not a doctor and no clinician has reviewed this. Talk to a qualified professional before acting on anything here.",
  );
});
