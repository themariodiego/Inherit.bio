import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADULT_SUBJECT_STATEMENTS, ADULT_SUBJECT_STATEMENTS_HEADING } from "@/copy/family/adult-subject-statements";
import type { AdultSubjectReview } from "@/lib/embryos/adult-subject-review";

/**
 * D-103 in a real browser: the actual client component, bundled for the
 * browser and rendered with a review the server would publish. Each of the
 * five signed statements is a checkbox named by its sentence; Accept stays
 * disabled while any one is unticked; and the request names exactly the
 * published keys with the served presentation. The browser graph may not
 * reach a server-only module. The full journey against the database is
 * `e2e/adult-subject-invitation.spec.ts`.
 */

const localRequire = createRequire(import.meta.url);
const tsxRequire = createRequire(localRequire.resolve("tsx"));
const { build } = tsxRequire("esbuild") as { build(options: unknown): Promise<{ outputFiles: { text: string }[] }> };

const ORIGIN = "http://adult-confirm.test";
const KEYS = ADULT_SUBJECT_STATEMENTS.map(statement => statement.key);
const PRESENTATION = "synthetic-presentation-token-for-this-page";
const NONCE = "synthetic-form-nonce";

const artifact = { version: 1, effectiveOn: "2026-09-01", summaryMarkdown: "Summary.", bodyMarkdown: "Body.",
  bodySha256: "a".repeat(64) };
const ACCEPTING: AdultSubjectReview = {
  nonce: NONCE, acceptanceBlockedBy: null, artifact,
  confirmation: { presentationToken: PRESENTATION,
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

/** The page with this review, and every request body the form posts to api.withdraw. */
async function open(review: AdultSubjectReview, receipt?: { operation: string }) {
  // A context of its own: the accessibility audit needs one, and nothing is shared between cases.
  const page = await (await browser.newContext()).newPage();
  const posted: Record<string, unknown>[] = [];
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
        body: JSON.stringify({ status: "accepted", operation: receipt?.operation ?? "confirm" }) });
      return;
    }
    await route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}/`);
  await expect.poll(() => page.getByRole("heading", { level: 1 }).count()).toBe(1);
  return { page, posted };
}

const statementBox = (page: Page, text: string) => page.getByRole("checkbox", { name: text, exact: true });
const accept = (page: Page) => page.getByRole("button", { name: "Accept through my account", exact: true });

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

  it("keeps Accept disabled while any one of the five is unticked", async () => {
    const { page, posted } = await open(ACCEPTING);
    try {
      expect(await accept(page).isDisabled()).toBe(true);
      for (const missing of ADULT_SUBJECT_STATEMENTS) {
        for (const statement of ADULT_SUBJECT_STATEMENTS) {
          await statementBox(page, statement.text).setChecked(statement.key !== missing.key);
        }
        expect(await accept(page).isDisabled(), `${missing.key} unticked`).toBe(true);
        await accept(page).click({ force: true });
      }
      expect(posted).toEqual([]);
    } finally { await page.context().close(); }
  });

  it("enables Accept only once all five are ticked, and sends exactly the published keys with the served presentation", async () => {
    const { page, posted } = await open(ACCEPTING);
    try {
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
      expect(posted).toEqual([{ operation: "confirm", nonce: NONCE, subjectArtifact: {
        artifactVersion: 1, artifactPresentationToken: PRESENTATION, affirmed: true, statementKeys: KEYS } }]);
    } finally { await page.context().close(); }
  });

  it("shows no statement to a reader who cannot accept, and refuses with the operation and nonce alone", async () => {
    const { page, posted } = await open(SIGNED_OUT, { operation: "refuse" });
    try {
      expect(await page.getByRole("checkbox").count()).toBe(0);
      expect(await accept(page).count()).toBe(0);
      expect(await page.getByRole("link", { name: "Sign in to accept", exact: true }).count()).toBe(1);
      await page.getByRole("button", { name: "Refuse", exact: true }).click();
      await expect.poll(() => page.getByRole("heading", { name: "Invitation refused", exact: true }).count()).toBe(1);
      expect(posted).toEqual([{ operation: "refuse", nonce: NONCE }]);
    } finally { await page.context().close(); }
  });
});
