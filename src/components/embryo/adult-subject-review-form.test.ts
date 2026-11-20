import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADULT_SUBJECT_STATEMENTS, ADULT_SUBJECT_STATEMENTS_HEADING } from "@/copy/family/adult-subject-statements";
import { PATH_B_REQUEST_COPY } from "@/copy/upload/other-adult";
import type { AdultSubjectReview } from "@/lib/embryos/adult-subject-review";

/**
 * D-103 in a real browser: the actual client component, bundled for the
 * browser and rendered with a review the server would publish. Each of the
 * five signed statements is a checkbox named by its sentence, and the
 * person's typed name has its own labelled field (owner decision of 23
 * October 2026); Accept stays disabled while any one statement is unticked
 * or the name is not two parts of two characters; and the request goes to
 * api.invitation-accept, naming exactly the published keys with the served
 * presentation, the accept nonce and the trimmed name. Refusing stays on
 * api.withdraw. The browser graph may not reach a server-only module. The
 * full journey against the database is `e2e/adult-subject-invitation.spec.ts`.
 */

const localRequire = createRequire(import.meta.url);
const tsxRequire = createRequire(localRequire.resolve("tsx"));
const { build } = tsxRequire("esbuild") as { build(options: unknown): Promise<{ outputFiles: { text: string }[] }> };

const ORIGIN = "http://adult-confirm.test";
const KEYS = ADULT_SUBJECT_STATEMENTS.map(statement => statement.key);
const PRESENTATION = "synthetic-presentation-token-for-this-page";
const NONCE = "synthetic-form-nonce";
const ACCEPT_NONCE = "synthetic-accept-nonce";
/** A synthetic name, typed with the spaces a person might leave around it. */
const NAME = "Synthetic Invitee";

const artifact = { version: 1, effectiveOn: "2026-09-01", summaryMarkdown: "Summary.", bodyMarkdown: "Body.",
  bodySha256: "a".repeat(64) };
const ACCEPTING: AdultSubjectReview = {
  nonce: NONCE, acceptanceBlockedBy: null, artifact,
  confirmation: { nonce: ACCEPT_NONCE, presentationToken: PRESENTATION,
    statements: ADULT_SUBJECT_STATEMENTS.map(statement => ({ key: statement.key, text: statement.text })) },
};
const SIGNED_OUT: AdultSubjectReview = { nonce: NONCE, acceptanceBlockedBy: "sign-in", artifact, confirmation: null };

let browser: Browser;
let script = "";

beforeAll(async () => {
  const result = await build({
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: "browser", format: "iife",
    jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": "\"production\"" },
    stdin: {
      loader: "tsx", resolveDir: path.join(process.cwd(), "src/components/embryo"), sourcefile: "entry.tsx",
      contents: [
        'import { createRoot } from "react-dom/client";',
        'import { AdultSubjectReviewForm } from "./adult-subject-review-form";',
        'const review = JSON.parse(document.getElementById("review")!.textContent!);',
        "createRoot(document.getElementById(\"root\")!).render(<AdultSubjectReviewForm review={review} />);",
      ].join("\n"),
    },
    plugins: [{ name: "browser-graph", setup(api: {
      onResolve(options: { filter: RegExp }, run: (args: { path: string }) => unknown): void;
      onLoad(options: { filter: RegExp; namespace: string }, run: () => unknown): void;
    }) {
      api.onResolve({ filter: /^server-only$/ }, () => { throw new Error("server-only is forbidden in the browser graph"); });
      // Outside the Next runtime a link is its anchor; nothing here navigates.
      api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next-link", namespace: "shim" }));
      api.onLoad({ filter: /^next-link$/, namespace: "shim" }, () => ({ loader: "tsx", resolveDir: process.cwd(),
        contents: "export default function Link({ href, children, ...rest }: any) { return <a href={href} {...rest}>{children}</a>; }" }));
    } }],
  });
  script = result.outputFiles.map(file => file.text).join("\n");
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => { await browser?.close(); });

/** The page with this review, and every request the form posts, with the route it went to. */
async function open(review: AdultSubjectReview, receipt?: { operation: string }) {
  // A context of its own: the accessibility audit needs one, and nothing is shared between cases.
  const page = await (await browser.newContext()).newPage();
  const posted: Record<string, unknown>[] = [];
  const accepted: Record<string, unknown>[] = [];
  const html = `<!doctype html><html lang="en"><head><title>Review your request</title></head><body><main id="root"></main>`
    + `<script type="application/json" id="review">${JSON.stringify(review)}</script><script>${script.replace(/<\/script/g, "<\\/script")}</script></body></html>`;
  await page.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/" && route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
      return;
    }
    if (url.pathname === "/api/withdraw/session" && route.request().method() === "POST") {
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 202, contentType: "application/json",
        body: JSON.stringify({ status: "accepted", operation: receipt?.operation ?? "refuse" }) });
      return;
    }
    if (url.pathname === "/api/invitations/accept" && route.request().method() === "POST") {
      accepted.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        invitationKind: "adult_subject", status: "accepted", subjectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        subjectAccountBound: true, accountOrigin: "existing_account", activationBlock: "pending_exact_purpose" }) });
      return;
    }
    await route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}/`);
  await expect.poll(() => page.getByRole("heading", { level: 1 }).count()).toBe(1);
  return { page, posted, accepted };
}

const statementBox = (page: Page, text: string) => page.getByRole("checkbox", { name: text, exact: true });
const accept = (page: Page) => page.getByRole("button", { name: "Accept through my account", exact: true });
const nameField = (page: Page) => page.getByRole("textbox", { name: PATH_B_REQUEST_COPY.typedNameLabel, exact: true });

describe("the Path A review renders the five signed statements as separate checkboxes (D-103)", () => {
  it("names each checkbox by its own sentence, in the published order, inside one labelled group", async () => {
    const { page } = await open(ACCEPTING);
    try {
      const group = page.getByRole("group", { name: ADULT_SUBJECT_STATEMENTS_HEADING, exact: true });
      expect(await group.count()).toBe(1);
      const boxes = group.getByRole("checkbox");
      expect(await boxes.count()).toBe(5);
      for (const [index, statement] of ADULT_SUBJECT_STATEMENTS.entries()) {
        expect(await boxes.nth(index).getAttribute("name")).toBe(statement.key);
        expect(await statementBox(page, statement.text).count()).toBe(1);
        expect(await statementBox(page, statement.text).isChecked()).toBe(false);
      }
      const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .disableRules(["color-contrast"]).analyze()).violations;
      expect(violations.map(violation => violation.id)).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("asks for the typed name in its own labelled field, beside the five statements", async () => {
    const { page } = await open(ACCEPTING);
    try {
      expect(await nameField(page).count()).toBe(1);
      expect(await nameField(page).inputValue()).toBe("");
      expect(await nameField(page).getAttribute("autocomplete")).toBe("name");
      // The rule is stated beside the field, as Path B's signature states it.
      const described = await nameField(page).getAttribute("aria-describedby");
      expect(await page.locator(`#${described}`).textContent()).toBe(PATH_B_REQUEST_COPY.typedNameError);
    } finally { await page.context().close(); }
  });

  it("keeps Accept disabled while any one of the five is unticked, even with a valid name", async () => {
    const { page, posted, accepted } = await open(ACCEPTING);
    try {
      expect(await accept(page).isDisabled()).toBe(true);
      await nameField(page).fill(NAME);
      for (const missing of ADULT_SUBJECT_STATEMENTS) {
        for (const statement of ADULT_SUBJECT_STATEMENTS) {
          await statementBox(page, statement.text).setChecked(statement.key !== missing.key);
        }
        expect(await accept(page).isDisabled(), `${missing.key} unticked`).toBe(true);
        await accept(page).click({ force: true });
      }
      expect(posted).toEqual([]);
      expect(accepted).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("keeps Accept disabled with all five ticked until the name has two parts of two characters", async () => {
    const { page, accepted } = await open(ACCEPTING);
    try {
      for (const statement of ADULT_SUBJECT_STATEMENTS) await statementBox(page, statement.text).check();
      expect(await accept(page).isDisabled(), "no name").toBe(true);
      for (const name of ["   ", "Synthetic", "Synthetic I", "S I"]) {
        await nameField(page).fill(name);
        expect(await accept(page).isDisabled(), JSON.stringify(name)).toBe(true);
        expect(await nameField(page).getAttribute("aria-invalid"), JSON.stringify(name)).toBe(name.trim() ? "true" : "false");
        await accept(page).click({ force: true });
      }
      await nameField(page).fill(NAME);
      expect(await accept(page).isEnabled()).toBe(true);
      expect(await nameField(page).getAttribute("aria-invalid")).toBe("false");
      await nameField(page).fill("");
      expect(await accept(page).isDisabled()).toBe(true);
      expect(accepted).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("enables Accept once all five are ticked and a name is typed, and sends the registered body to api.invitation-accept", async () => {
    const { page, posted, accepted } = await open(ACCEPTING);
    try {
      await nameField(page).fill(`  ${NAME} `);
      for (const [index, statement] of ADULT_SUBJECT_STATEMENTS.entries()) {
        expect(await accept(page).isDisabled(), `before ${statement.key}`).toBe(true);
        await statementBox(page, statement.text).check();
        expect(await accept(page).isEnabled()).toBe(index === ADULT_SUBJECT_STATEMENTS.length - 1);
      }
      await statementBox(page, ADULT_SUBJECT_STATEMENTS[2].text).uncheck();
      expect(await accept(page).isDisabled()).toBe(true);
      await statementBox(page, ADULT_SUBJECT_STATEMENTS[2].text).check();
      await accept(page).click();
      await expect.poll(() => page.getByRole("heading", { name: "Invitation accepted", exact: true }).count()).toBe(1);
      expect(accepted).toEqual([{ nonce: ACCEPT_NONCE, subjectArtifact: {
        artifactKey: "consent.subject-adult", artifactVersion: 1, artifactPresentationToken: PRESENTATION, affirmed: true,
        statementKeys: KEYS, typedName: NAME } }]);
      expect(posted).toEqual([]);
      // The receipt shows nothing of the name.
      expect(await page.locator("main").innerText()).not.toContain(NAME);
      expect(await page.locator("main input").count()).toBe(0);
    } finally { await page.context().close(); }
  });

  it("shows no statement to a reader who cannot accept, and refuses with the operation and nonce alone", async () => {
    const { page, posted } = await open(SIGNED_OUT, { operation: "refuse" });
    try {
      expect(await page.getByRole("checkbox").count()).toBe(0);
      expect(await nameField(page).count()).toBe(0);
      expect(await accept(page).count()).toBe(0);
      expect(await page.getByRole("link", { name: "Sign in to accept", exact: true }).count()).toBe(1);
      await page.getByRole("button", { name: "Refuse", exact: true }).click();
      await expect.poll(() => page.getByRole("heading", { name: "Invitation refused", exact: true }).count()).toBe(1);
      expect(posted).toEqual([{ operation: "refuse", nonce: NONCE }]);
    } finally { await page.context().close(); }
  });
});
