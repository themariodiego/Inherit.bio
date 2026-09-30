import path from "node:path";
import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { auditTextAlternatives } from "./text-alternatives";
import { TINY_FIXTURE, VISIT, MIN_SWEPT_ROUTES, ANCESTRY_ROUTE, installProbes, createAccessibilitySweep } from "./accessibility-sweeps";

const { G113B_ACCOUNT, sweepPages } = createAccessibilitySweep();
test.describe("G1.13b: the accessibility measurements axe cannot make", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    await createConfirmedUser(G113B_ACCOUNT.email, G113B_ACCOUNT.password);
    // `browser.newContext()` does not inherit the project's `use`, so the
    // baseURL is handed over explicitly; without it `signIn`'s relative
    // navigation has nothing to resolve against.
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const page = await context.newPage();
    try {
      await signIn(page, G113B_ACCOUNT.email, G113B_ACCOUNT.password);
      await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), TINY_FIXTURE),
        { fileType: "vcf", purposes: ["reports.polygenic"] });
    } finally {
      await context.close();
    }
  });

  /**
   * The text alternatives: the interactive ancestry map and every chart.
   *
   * The brief asks for each to be "reachable as an equivalent list-and-text
   * route". The shipped design answers with something stricter than a route:
   * the map's table (`src/components/results/ancestry/region-list.tsx`) is on
   * the page beside it in zero activations, and the grey state's raw numbers
   * are one keyboard-operable `<summary>` away. This test holds that stronger
   * form — an equivalent inside the figure, referenced by it, or beside it in
   * its own container — because no separate list route exists in
   * `docs/route-register.json` to hold the literal one.
   *
   * "Reachable without a pointer" is measured, not assumed: an equivalent
   * behind a closed `<details>` is opened here by focusing its summary and
   * pressing Enter. That the summary is itself reachable by Tab is the
   * keyboard test above.
   */
  test("text alternatives: the ancestry map and every chart have an equivalent list and text", async ({ page }) => {
    test.setTimeout(900_000);
    await installProbes(page);
    expect(Object.keys(VISIT), "the ancestry route this test names is still the registered one")
      .toContain(ANCESTRY_ROUTE);
    let figures = 0;
    let genomeCanvases = 0;
    let mapSeen = false;
    const visited = await sweepPages(page, async ({ route }) => {
      const found = await page.evaluate(auditTextAlternatives);
      genomeCanvases += found.genomeCanvases;
      figures += found.checked;
      expect.soft(found.findings,
        `${route}: every chart needs an equivalent list and text`).toEqual([]);
      for (const disclosure of found.disclosures) {
        const summary = page.locator(`[data-g113b-disclosure="${disclosure.index}"]`);
        await expect.soft(summary,
          `${route}: the disclosure for ${disclosure.name} is rendered`).toBeVisible();
        await summary.focus();
        await page.keyboard.press("Enter");
        expect.soft(
          await summary.evaluate(element =>
            element.parentElement instanceof HTMLDetailsElement && element.parentElement.open),
          `${route}: the list behind ${disclosure.name} opens without a pointer`).toBe(true);
      }
      if (found.disclosures.length) {
        const opened = await page.evaluate(auditTextAlternatives);
        expect.soft(opened.findings,
          `${route}: opening a disclosure must expose its actual text equivalent`).toEqual([]);
        expect.soft(opened.disclosures,
          `${route}: no equivalent remains behind a closed disclosure`).toEqual([]);
      }
      if (route !== ANCESTRY_ROUTE) return;
      mapSeen = true;
      const map = page.locator('[data-slot="ancestry-map"]');
      const maps = await map.count();
      // Softly, and then out: a hard failure here would stop the sweep at
      // this page instead of reporting it with the rest.
      expect.soft(maps, "the ancestry page draws its map").toBe(1);
      if (maps !== 1) return;
      if (await map.getAttribute("data-mode") === "shown") {
        const drawn = await page.locator('[data-slot="ancestry-map"] path[data-region]').count();
        const focusable = await page.locator('[data-slot="ancestry-map"] path[data-region][tabindex="0"]').count();
        const rows = await page.locator('[data-slot="region-row"]:not([hidden])').count();
        await expect.soft(page.locator('[data-slot="region-table"]'),
          "the map's equivalent table is on the page, in no activations").toBeVisible();
        expect.soft(focusable, "every region drawn on the map is reachable without a pointer").toBe(drawn);
        expect.soft(rows, "every region drawn on the map has a row of its own in the table").toBe(drawn);
      } else {
        // A grey map states nothing — too few markers were read, nothing has
        // been processed, (this sweep's account, which chose trait reports
        // only) Ancestry is off, or it is on with nothing generated yet — so
        // there is nothing for a list to restate;
        // what has to be there is the sentence saying which, and (in the grey
        // state) the raw numbers behind a summary, which the sweep above
        // opened from the keyboard.
        expect.soft(await page.locator('[data-slot="ancestry-map"] path[tabindex="0"]').count(),
          "a grey map states nothing, so it offers nothing to focus").toBe(0);
        await expect.soft(page.locator('[data-slot="grey-state"], [data-slot="nothing-read"], [data-slot="ancestry-off"], [data-slot="ancestry-not-generated"]').first(),
          "a grey map says in words why it is grey").toBeVisible();
      }
    });
    expect(visited, "the text-alternative sweep visited every reachable page").toBeGreaterThan(MIN_SWEPT_ROUTES);
    // An empty scan is the silent way to pass this one: no figure found, no
    // alternative demanded. The ancestry map renders in every state, so the
    // sweep has seen at least it.
    expect(figures, "the sweep found charts to check rather than none").toBeGreaterThan(0);
    expect(mapSeen, "the sweep reached the ancestry map's own route").toBe(true);
    expect(genomeCanvases,
      "the text-alternative sweep inspected the real genome canvases inside their shadow root")
      .toBeGreaterThan(0);
  });
});
