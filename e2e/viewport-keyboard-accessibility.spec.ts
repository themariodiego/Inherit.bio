import path from "node:path";
import { expect, test } from "@playwright/test";
import { AXE_VIEWPORTS, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { tabThrough, escapeLeavesTheTrap } from "./keyboard-traversal";
import { TINY_FIXTURE, MIN_SWEPT_ROUTES, MIN_TAB_STOPS, ACCESSIBILITY_LEDGER, KeyboardDivergence, keyboardFinding, accessibilityLedger, compareToLedger, howToRecord, installProbes, createAccessibilitySweep } from "./accessibility-sweeps";

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
   * Keyboard traversal of every page: tab order equal to DOM order, and no
   * trap.
   *
   * Order is checked pair by pair in the current composed DOM, including
   * shadow roots and slots, rather than a snapshot before the first Tab. A
   * snapshot goes stale when focus changes the page — the ancestry map opens
   * its region panel on focus, and a tooltip with a focus equivalent adds a
   * node — and the property under test is a relation between consecutive
   * stops, not a fixed list.
   *
   * What cannot be measured here: Playwright cannot see the browser's own
   * chrome, so "Tab from the last control returns to the browser" is observed
   * as the two states that are visible from inside the document — focus
   * leaving it altogether (`document.activeElement` back to the body, which
   * is what a browser with chrome does as it hands focus to the address bar),
   * or the cycle restarting at the document's first tab stop, which is what a
   * headless browser with no chrome to hand focus to does instead. A trap
   * looks like neither: focus returns to something that is not the first stop,
   * or it never stops arriving somewhere new at all. Those are the failures.
   * A trap that wrapped the *entire* page would be indistinguishable from the
   * headless wrap and is the one case this cannot separate.
   *
   * The ledger is compared in both directions. Focus inside an open shadow
   * root is the actual control, not document.activeElement's host: successive
   * controls can otherwise look like a repeated stop. The same three
   * properties hold on every page at both widths, including those controls.
   */
  test("keyboard traversal: tab order is DOM order, and no page traps focus", async ({ page }) => {
    test.setTimeout(1_500_000);
    await installProbes(page);
    // 320 and 390 render the same chrome, so the phone tab order is measured
    // once; the desktop width is the one where `app-nav` shows its sidebar
    // instead of the bottom bar, which is a different order over the same DOM.
    const viewports = AXE_VIEWPORTS.filter(viewport => viewport.width !== 320);
    let stops = 0;
    // Traps that ship no working, advertised escape. Not a ledger: SC 2.1.2
    // has no honest interim for one, so it fails outright.
    const unescapable: string[] = [];
    let escapesProven = 0;
    const present = new Map<string, string>();
    const record = (entry: KeyboardDivergence, evidence: string) =>
      present.set(keyboardFinding(entry), `${evidence}\n${howToRecord("keyboardTraversal", entry)}`);
    const visited = await sweepPages(page, async ({ route }) => {
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Resizing is not instant: traverse the layout the width produced.
        await page.waitForFunction(width => window.innerWidth === width, viewport.width);
        const pass = await tabThrough(page);
        stops += pass.stops;
        const at = { route, viewport: viewport.label };
        if (pass.violations.length > 0) {
          record({ kind: "order", ...at, violations: pass.violations.length },
            `    tab order must follow DOM order and never return; it did neither:\n`
            + pass.violations.map(violation => `      ${violation}`).join("\n"));
        }
        if (pass.exit !== "left-document" && pass.exit !== "wrapped") {
          record({ kind: "exit", ...at, last: pass.last, outcome: pass.exit },
            `    Tab past the last control (${pass.last}) must leave the page, not loop inside it;`
            + ` the traversal ended ${pass.exit} after ${pass.stops} stops`);
          // A trap is recorded above as the tab-order defect it is, and
          // separately required to be escapable here. The two are different
          // claims: the first is about Tab, the second is what SC 2.1.2
          // actually demands, and only the second has no acceptable interim.
          if (pass.exit === "trapped") {
            const unescaped = await escapeLeavesTheTrap(page);
            if (unescaped) unescapable.push(`  ${route} at ${viewport.label}\n${unescaped}`);
            else escapesProven++;
          }
        }
        if (pass.unreached.length > 0) {
          record({ kind: "stops", ...at, reached: pass.stops, expected: pass.expected },
            `    never reached: ${pass.unreached.slice(0, 12).join(", ") || "(none named)"}\n`
            + `    ${pass.unreached.length} of this page's certainly-tabbable elements were never`
            + ` reached (${pass.stops} of ${pass.expected}); the traversal ended ${pass.exit} at`
            + ` ${pass.last}`);
        }
        // The advertised escape remains a contract even when ordinary Tab
        // leaves correctly. Exercise it directly from inside the real widget.
        const search = page.locator('[data-testid="genome-browser"] input.igv-search-input');
        if (await search.isVisible()) {
          await search.focus();
          const unescaped = await escapeLeavesTheTrap(page);
          if (unescaped) unescapable.push(`  ${route} at ${viewport.label}\n${unescaped}`);
          else escapesProven++;
        }
      }
    });
    // Floors first: an empty or half-broken scan must fail as itself rather
    // than as a ledger full of findings that "no longer occur".
    expect(visited, "the keyboard sweep visited every reachable page").toBeGreaterThan(MIN_SWEPT_ROUTES);
    expect(stops, "the keyboard sweep reached tab stops rather than nothing").toBeGreaterThan(MIN_TAB_STOPS);
    expect(unescapable.join("\n\n"),
      "WCAG 2.1 SC 2.1.2: focus that Tab cannot carry out of a component must be movable out by a"
      + " key the component's own description names")
      .toBe("");
    // A floor on the escape check itself, independent of any trap finding.
    // The widget promises Escape, so the full sweep must actually exercise it.
    expect(escapesProven,
      "the advertised escape was exercised inside the genome browser")
      .toBeGreaterThan(0);
    expect(compareToLedger("keyboard traversal", present, accessibilityLedger().keyboard).join("\n\n"),
      `keyboard traversal: the sweep and ${ACCESSIBILITY_LEDGER} must say the same thing, in both directions`)
      .toBe("");
  });
});
