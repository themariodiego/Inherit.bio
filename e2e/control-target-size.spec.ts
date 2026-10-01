import path from "node:path";
import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { TINY_FIXTURE, MIN_SWEPT_ROUTES, MIN_MEASURED_TARGETS, TARGET_SIZE, ACCESSIBILITY_LEDGER, UndersizedControl, UNDERSIZED_CONTROL_OCCURRENCES, undersizedControlFinding, accessibilityLedger, compareToLedger, howToRecord, installProbes, createAccessibilitySweep } from "./accessibility-sweeps";

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
   * Target size at 390×844, against TARGET_SIZE above.
   *
   * Because the bar is stricter, SC 2.5.8's *spacing* exception (a 24px target
   * with a 24px undisturbed circle around it) does not apply and is not
   * implemented. One exception is: **Inline** — "the target is in a sentence,
   * or its size is otherwise constrained by the line-height of non-target
   * text" — applied by rule below (an inline-level control whose block carries
   * words of its own outside it), never by naming ids.
   *
   * Three of SC 2.5.8's other exceptions — Equivalent, Essential, and User
   * agent control — cannot be decided from the DOM: no attribute says that a
   * second control does the same job, that the size is legally required, or
   * that the author never touched it. None is applied. A control that
   * genuinely needs one has to earn it in the brief rather than in a test.
   *
   * Not measured: a hit area enlarged by an absolutely positioned
   * pseudo-element. `getComputedStyle(element, "::after")` returns styles, not
   * a box, and no DOM API returns a pseudo-element's rectangle, so such a
   * control measures as its own box here and would be reported.
   *
   * Recorded, not asserted, against `targetSize` in the ledger, because the
   * finding is one design decision and not a list of bugs: the size scale in
   * `src/components/ui/button.tsx` has no 44px step, and adding one changes
   * the height of every control in the product. Nothing here is weakened to
   * accommodate that — the bar is still 44, every control is still measured,
   * every undersized one is still counted, and the comparison runs in both
   * directions so the recorded set can only shrink.
   */
  test("target size: every control is at least 44x44 CSS px at 390x844", async ({ page }) => {
    test.setTimeout(900_000);
    await installProbes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    let measured = 0;
    /** Every undersized control, gathered by component rather than by page. */
    const components = new Map<string, {
      smallestWidth: number;
      smallestHeight: number;
      routes: Set<string>;
      occurrences: number;
      examples: string[];
    }>();
    let occurrences = 0;
    const visited = await sweepPages(page, async ({ route }) => {
      const result = await page.evaluate((minimum) => {
        const probe = window.__g113b;
        if (!probe) throw new Error("element probe not installed");
        const inlineDisplays = new Set(["inline", "contents", "ruby", "ruby-text"]);
        const interactive = probe.interactive;
        /** SC 2.5.8's Inline exception, as a rule rather than a list. */
        function inSentence(element: Element): boolean {
          // A flex or grid child is blockified by CSS, so its computed
          // display is never `inline`: a control laid out as a box beside a
          // paragraph is not "in a sentence", and this is what tells them
          // apart without naming either.
          if (getComputedStyle(element).display !== "inline") return false;
          let block: Element | null = element.parentElement;
          while (block && inlineDisplays.has(getComputedStyle(block).display)) block = block.parentElement;
          if (!block) return false;
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          let outside = "";
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (!parent || element.contains(node)) continue;
            // Another control's own label is not the sentence this one sits
            // in: a row of links separated by dots is a row of targets.
            if (parent.closest(interactive)) continue;
            outside += node.nodeValue ?? "";
          }
          // Two adjacent letters: a word, not a separator or a bullet.
          return /[a-z]{2,}/i.test(outside);
        }
        const undersized: { component: string; element: string; width: number; height: number }[] = [];
        const round = (value: number) => Math.round(value * 10) / 10;
        let counted = 0;
        const keyboard = window.__keyboardAudit;
        if (!keyboard) throw new Error("composed DOM probe not installed");
        for (const element of keyboard.elements().filter(element => element.matches(probe.interactive))) {
          if (!probe.rendered(element)) continue;
          // An inactive control accepts no pointer action, so it is not a
          // target; it becomes one when it is enabled, in the state a test
          // that enables it measures.
          if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") continue;
          // Neither in the accessibility tree nor in the tab order: plumbing
          // driven by a control of its own — the sr-only file input behind
          // "Choose file" — and that control is measured on its own account.
          if (element.getAttribute("tabindex") === "-1" && element.closest('[aria-hidden="true"]')) continue;
          let rect = element.getBoundingClientRect();
          let state = "";
          // A control that is visually hidden until it takes focus (the skip
          // link) is measured in the state a person can see and hit. Skipping
          // it would measure nothing; measuring its parked 1×1 clipped box
          // would measure the wrong thing.
          if (rect.width <= 1 && rect.height <= 1
            && (element instanceof HTMLElement || element instanceof SVGElement)) {
            const previous = document.activeElement;
            element.focus();
            rect = element.getBoundingClientRect();
            state = " (focused)";
            element.blur();
            if (previous instanceof HTMLElement || previous instanceof SVGElement) previous.focus();
          }
          let { left, right, top, bottom } = rect;
          // A labelled control is activated by its label too, so the target
          // is the area of both — the checkbox plus the words that toggle it.
          // A 1×1 label is the sr-only kind, which is a name, not an area.
          const labelled = element instanceof HTMLInputElement || element instanceof HTMLSelectElement
            || element instanceof HTMLTextAreaElement || element instanceof HTMLButtonElement;
          if (labelled && element.labels) {
            for (const label of element.labels) {
              if (!probe.rendered(label)) continue;
              const box = label.getBoundingClientRect();
              if (box.width <= 1 || box.height <= 1) continue;
              left = Math.min(left, box.left); right = Math.max(right, box.right);
              top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom);
            }
          }
          // A "stretched" link is activated anywhere on the card it sits in:
          // its own ::before or ::after is absolutely positioned with every
          // inset at or past the edge, so the pseudo covers the nearest
          // positioned ancestor and that ancestor is the region a pointer
          // action reaches. Same principle as the label union above - the
          // target is what accepts the pointer, not the text box - and read
          // from the CSS that governs it, exactly as the Inline exemption
          // reads `display`. Hit-testing would be stronger and is not
          // available here: elementFromPoint sees only the visible viewport,
          // and most of a swept page is below the fold.
          for (const pseudo of ["::before", "::after"]) {
            const style = getComputedStyle(element, pseudo);
            if (style.content === "none" || style.position !== "absolute") continue;
            const insets = [style.top, style.right, style.bottom, style.left];
            if (!insets.every(value => /^-?\d+(\.\d+)?px$/.test(value) && parseFloat(value) <= 0)) continue;
            const host = element instanceof HTMLElement ? element.offsetParent : null;
            if (!(host instanceof HTMLElement)) continue;
            const box = host.getBoundingClientRect();
            left = Math.min(left, box.left); right = Math.max(right, box.right);
            top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom);
          }
          counted++;
          const width = right - left;
          const height = bottom - top;
          if (width >= minimum && height >= minimum) continue;
          if (inSentence(element)) continue;
          undersized.push({
            component: probe.signature(element),
            element: `${probe.describe(element)}${state}`,
            width: round(width),
            height: round(height),
          });
        }
        return { counted, undersized };
      }, TARGET_SIZE);
      measured += result.counted;
      for (const finding of result.undersized) {
        occurrences++;
        const seen = components.get(finding.component) ?? {
          smallestWidth: Number.POSITIVE_INFINITY,
          smallestHeight: Number.POSITIVE_INFINITY,
          routes: new Set<string>(),
          occurrences: 0,
          examples: [],
        };
        seen.smallestWidth = Math.min(seen.smallestWidth, finding.width);
        seen.smallestHeight = Math.min(seen.smallestHeight, finding.height);
        seen.routes.add(route);
        seen.occurrences++;
        // Enough of the evidence to act on, not all of it: the same component
        // on the fiftieth page says nothing the first three did not.
        if (seen.examples.length < 3) {
          seen.examples.push(`      ${route} → ${finding.element} — ${finding.width}x${finding.height}`);
        }
        components.set(finding.component, seen);
      }
    });
    // Floors first: an empty or half-broken scan must fail as itself rather
    // than as a ledger full of findings that "no longer occur".
    expect(visited, "the target-size sweep visited every reachable page").toBeGreaterThan(MIN_SWEPT_ROUTES);
    expect(measured, "the target-size sweep measured controls rather than an empty selector")
      .toBeGreaterThan(MIN_MEASURED_TARGETS);

    const present = new Map<string, string>();
    for (const [component, seen] of components) {
      const entry: UndersizedControl = {
        component,
        smallestWidth: Math.round(seen.smallestWidth),
        smallestHeight: Math.round(seen.smallestHeight),
      };
      present.set(undersizedControlFinding(entry),
        `    undersized ${seen.occurrences} times on ${seen.routes.size} of the ${visited} swept routes`
        + `; first ${seen.examples.length}:\n${seen.examples.join("\n")}\n`
        + howToRecord("targetSize", entry));
    }
    const failures = compareToLedger("target size", present, accessibilityLedger().targetSize);
    if (UNDERSIZED_CONTROL_OCCURRENCES < 0) {
      failures.push(`target size: the sweep reports ${occurrences} undersized (page, control) pairs`
        + ` across ${components.size} components, and UNDERSIZED_CONTROL_OCCURRENCES in`
        + ` e2e/a11y.spec.ts has never been measured. Write ${occurrences} there — it is the`
        + ` volume the per-component ledger collapses, and it is a ratchet, not a ceiling.`);
    } else if (occurrences !== UNDERSIZED_CONTROL_OCCURRENCES) {
      failures.push(`target size: the sweep reports ${occurrences} undersized (page, control) pairs`
        + ` and UNDERSIZED_CONTROL_OCCURRENCES in e2e/a11y.spec.ts says`
        + ` ${UNDERSIZED_CONTROL_OCCURRENCES}. Fixing a control lowers that number in the same`
        + ` change; a rise means a control shrank or a page arrived carrying one.`);
    }
    expect(failures.join("\n\n"),
      `target size: the sweep and ${ACCESSIBILITY_LEDGER} must say the same thing, in both directions`)
      .toBe("");
  });
});
