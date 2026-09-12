import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, createConfirmedUser, signIn, uploadOwnFileThroughUi } from "./helpers";
import {
  BROWSER_NO_FILE,
  BROWSER_PREPARING,
  SCORE_COVERAGE_NO_FILE,
  SCORE_COVERAGE_PREPARING,
} from "../src/copy/genome/data";
import {
  ANCESTRY_PREPARING,
  HUB_PREPARING,
  REPORTS_PREPARING,
} from "../src/copy/genome/preparation";

/**
 * `processing` on the five My Genome routes — and until today none had it.
 *
 * WHAT WAS WRONG. Corrections item 9 read all thirteen remaining
 * `product-result · processing` routes. Six render, while a file is being
 * prepared, exactly what they render for an account that has uploaded
 * nothing. Five of those six are My Genome pages — the owner's own record,
 * the one place where "your file is on its way" is worth saying — and two of
 * the five did worse than say nothing: they told the reader to ADD A FILE
 * THEY HAD ALREADY ADDED, at the same moment `/overview` was telling them it
 * was in flight. All five now say what is happening, and these titles are the
 * proof it renders.
 *
 * The sixth, `/family/portrait/[pairId]`, is deliberately left alone. It
 * reports a preparing file as an absent one, which is wrong the same way —
 * but it shows no file count, so a sentence there would tell one adult
 * something new about another's record. That is the owner's call, and item 9
 * keeps it open rather than settling it here.
 *
 * ONE DEFINITION OF "IN FLIGHT". The status list lived only in `/overview`,
 * which is why two pages had no notion of it. It now lives in
 * `@/lib/genome/load` as `PREPARATION_STEP_FOR_STATUS`, and
 * `hasFileInPreparation` asks the same question of the database. That helper
 * deliberately does NOT mean "the record has a file": a rejected or retired
 * file is no reason to promise a reader that results are coming.
 *
 * HOW THE STATE IS HELD, borrowed intact from `e2e/overview-processing.spec.ts`
 * because it took reading to find. The obvious window, `status: "parsing"`,
 * opens and closes inside one server request and cannot be held from a
 * browser. But `uploaded` — finalized and stored, preparation not yet asked
 * for — is real, server-side and durable. Holding the preparation request
 * keeps the account genuinely in it. Nothing here seeds a row or writes a
 * status; the test waits inside a state the product defines.
 *
 * The hold is built once, in `beforeAll`, and released in `afterAll`: two
 * pages read the same held account rather than each paying for an upload.
 */

test.describe.configure({ mode: "serial" });

const PASSWORD = "synthetic-genome-data-processing-password";
const email = `genome-data-processing-${randomUUID()}@e2e.local`;

let context: BrowserContext;
/** Keeps the preparation request open for as long as the two tests need. */
let holder: Page;
/** Reads the pages under test, in the same session, while the hold stands. */
let view: Page;
let release: () => void = () => {};

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  await createConfirmedUser(email, PASSWORD);
  context = await browser.newContext();
  holder = await context.newPage();
  await signIn(holder, email, PASSWORD);

  const held = new Promise<void>((resolve) => { release = resolve; });
  await holder.route("**/api/files/*/process", async (route) => {
    await held;
    await route.continue();
  }, { times: 1 });

  const fileId = await uploadOwnFileThroughUi(holder, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"));
  const stored = await adminClient().from("genome_files").select("status").eq("id", fileId).single();
  expect(stored.error).toBeNull();
  expect(stored.data!.status, "the state these tests wait inside is the server's, not the test's").toBe("uploaded");

  view = await context.newPage();
});

test.afterAll(async () => {
  release();
  await context?.close();
});

test("/genome/[subject] processing: the hub says a file is being prepared", async () => {
  await view.goto("/genome/me");

  await expect(view.getByText(HUB_PREPARING, { exact: true })).toBeVisible();
  // The tiles are permission-driven and stay put; the sentence is additional
  // information, not a replacement for the page.
  await expect(view.getByRole("link", { name: "Open Reports" })).toBeVisible();
});

test("/genome/[subject]/reports processing: the library says a file is being prepared", async () => {
  await view.goto("/genome/me/reports");

  await expect(view.getByText(REPORTS_PREPARING, { exact: true })).toBeVisible();
});

test("/genome/[subject]/ancestry processing: the ancestry page says a file is being prepared", async () => {
  await view.goto("/genome/me/ancestry");

  await expect(view.getByText(ANCESTRY_PREPARING, { exact: true })).toBeVisible();
});

test("/genome/[subject]/data processing: coverage says the file is being prepared, not that none was added", async () => {
  await view.goto("/genome/me/data");

  await expect(view.getByText(SCORE_COVERAGE_PREPARING, { exact: true })).toBeVisible();
  // The regression, stated as its own assertion because it is the whole
  // point: this page used to answer a reader with a file in flight by
  // telling them to add one.
  await expect(view.getByText(SCORE_COVERAGE_NO_FILE, { exact: true }),
    "no instruction to add a file that is already here").toHaveCount(0);
});

test("/genome/[subject]/data/browser processing: the browser says the file is being prepared, not that none was added", async () => {
  await view.goto("/genome/me/data/browser");

  await expect(view.getByText(BROWSER_PREPARING, { exact: true })).toBeVisible();
  await expect(view.getByText(BROWSER_NO_FILE, { exact: true }),
    "no instruction to add a file that is already here").toHaveCount(0);
  // There is nothing prepared to search yet, so the search box is absent
  // rather than offered and empty-handed. That is the page's own existing
  // rule and this state must not quietly break it.
  await expect(view.getByRole("searchbox")).toHaveCount(0);
});
