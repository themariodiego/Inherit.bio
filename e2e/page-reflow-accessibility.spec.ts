import path from "node:path";
import { expect, test } from "@playwright/test";
import { createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { TINY_FIXTURE, MIN_SWEPT_ROUTES, ACCESSIBILITY_LEDGER, reflowLedger, installProbes, createAccessibilitySweep } from "./accessibility-sweeps";

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
   * WCAG 2.1 SC 1.4.10 Reflow, at the width the success criterion is written
   * in: 320 CSS px of viewport, which is a different measurement from 200%
   * zoom (that is SC 1.4.4 Resize Text) and is not satisfied by testing one
   * of them for the other. 320 is also the brief's support floor (line 1063).
   *
   * The rule is the document's own: `scrollWidth <= clientWidth`. Brief line
   * 1063 permits exactly one element to scroll horizontally at 320 — the
   * embryo chip strip — and that permission needs no exemption list here,
   * because an element inside its own horizontal scroller never widens the
   * document: the scroller clips it. A strip that did widen the document
   * would be scrolling the page rather than itself, which is the failure the
   * line forbids for everything.
   */
  test("reflow: no page scrolls horizontally at a 320 CSS px viewport", async ({ page }) => {
    test.setTimeout(900_000);
    await installProbes(page);
    await page.setViewportSize({ width: 320, height: 568 });
    const sweptRoutes: string[] = [];
    const visited = await sweepPages(page, async ({ route }) => {
      sweptRoutes.push(route);
      const overflow = await page.evaluate(() => {
        const probe = window.__g113b;
        if (!probe) throw new Error("element probe not installed");
        const root = document.documentElement;
        if (root.scrollWidth <= root.clientWidth) return null;
        const limit = root.clientWidth;
        // Captured before any reader runs and before the causal walk below
        // touches the page, and it is this number the verdict compares. The
        // walk hides and restores subtrees; a diagnostic must not be able to
        // move a verdict, even by a rounding, so the width that is asserted
        // on is the one measured while the page was untouched.
        const scrollWidthBefore = root.scrollWidth;
        // The properties that make an element the containing block of its
        // `fixed` descendants, and of `absolute` ones through a `static`
        // ancestor. Kept in one place so the walk below reads as the rule.
        const holdsOutOfFlow = (style: CSSStyleDeclaration) =>
          style.transform !== "none" || style.perspective !== "none" || style.filter !== "none"
          || style.backdropFilter !== "none" || /transform|perspective|filter/.test(style.willChange)
          || /paint|layout|strict|content/.test(style.contain);
        const wide: Element[] = [];
        const caught: Element[] = [];
        for (const element of document.querySelectorAll("*")) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          // Only right-hand overflow widens the document in a left-to-right
          // page; content pushed past the left edge is unreachable, but it is
          // not something the reader can scroll to.
          if (rect.right <= limit) continue;
          // An overflow-x other than `visible` clips an IN-FLOW child, but an
          // out-of-flow box is only clipped by an ancestor that is also in its
          // containing-block chain. A `fixed` box is laid out against the
          // viewport, so an `overflow-x: hidden` ancestor does not clip it at
          // all unless that ancestor establishes a containing block for fixed
          // descendants; an `absolute` box skips every `static` ancestor the
          // same way. Reading the walk without that rule files a node that
          // really is escaping as one that was caught, and then `widest` comes
          // back empty with nothing to name — which is what this sweep
          // reported on the variant browser.
          const own = getComputedStyle(element);
          let clipped = false;
          for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.overflowX === "visible") continue;
            if (own.position === "fixed" && !holdsOutOfFlow(style)) continue;
            if (own.position === "absolute" && style.position === "static" && !holdsOutOfFlow(style)) continue;
            clipped = true; break;
          }
          if (clipped) { caught.push(element); continue; }
          wide.push(element);
        }
        // The outermost element of each subtree: a too-wide child of a
        // too-wide row is the symptom, the row is the cause.
        const causes = wide.filter(element =>
          !wide.some(other => other !== element && other.contains(element)));
        // When every candidate sits inside something that scrolls, `causes` is
        // empty and the report says nothing useful — which is exactly what
        // happened on the variant browser. What actually carries width upward
        // is an element wider than itself that does not clip, so name those
        // too: overflow-x visible, content wider than the box. The outermost
        // one is where the width escapes.
        const leaking: Element[] = [];
        for (const element of document.querySelectorAll("*")) {
          if (element.scrollWidth <= element.clientWidth + 1) continue;
          if (getComputedStyle(element).overflowX !== "visible") continue;
          if (element.clientWidth === 0) continue;
          leaking.push(element);
        }
        const escapes = leaking.filter(element =>
          !leaking.some(other => other !== element && other.contains(element)));
        // Every reader above answers one question: what has a box past the
        // edge. On the variant browser all of them come back empty, and the
        // divergence entry names why - the width is coming from something
        // with no box of its own, which leaves a margin, a pseudo-element, a
        // fixed-width rule in igv's injected stylesheet, or a positioned node
        // whose containing block is outside its scroll container. Reading
        // cannot separate those four. Removing can, and that is what the
        // entry's closing asks for: bisect it rather than read it. Hide a
        // subtree, ask the document how wide it is, put it back. The
        // narrowest node whose removal resolves the overflow is the cause
        // whatever the mechanism, and a node that is the cause while none of
        // its children is answers for the three mechanisms `querySelectorAll`
        // can never return.
        //
        // Runs ONLY when `causes` is empty, so the routes that already name
        // their cause pay nothing for it.
        const bisect: string[] = [];
        if (causes.length === 0) {
          const PROBE_LIMIT = 600;
          let probes = 0;
          const styled = (element: Element): HTMLElement | SVGElement | null =>
            element instanceof HTMLElement || element instanceof SVGElement ? element : null;
          // `!important` so a stylesheet rule cannot win, and the previous
          // inline value is put back exactly - including being absent, which
          // `removeProperty` and not an empty string restores.
          const resolvesWhenHidden = (element: Element) => {
            const box = styled(element);
            if (!box) return false;
            probes += 1;
            const had = box.style.getPropertyValue("display");
            const priority = box.style.getPropertyPriority("display");
            box.style.setProperty("display", "none", "important");
            const width = root.scrollWidth;
            if (had) box.style.setProperty("display", had, priority);
            else box.style.removeProperty("display");
            return width <= root.clientWidth;
          };
          // The four mechanisms, read off the node the bisection lands on, so
          // the finding says which one it is rather than only where it is.
          const describeCause = (element: Element) => {
            const style = getComputedStyle(element);
            const parts = [
              `width ${style.width}`, `min-width ${style.minWidth}`,
              `margin ${style.marginLeft}/${style.marginRight}`,
              `padding ${style.paddingLeft}/${style.paddingRight}`,
              `border ${style.borderLeftWidth}/${style.borderRightWidth}`,
              `position ${style.position}`, `transform ${style.transform}`,
              `overflow-x ${style.overflowX}`,
              `holds ${element.scrollWidth}px in ${element.clientWidth}px`,
            ];
            for (const part of ["::before", "::after"] as const) {
              const pseudo = getComputedStyle(element, part);
              if (pseudo.content === "none") continue;
              parts.push(`${part} content ${pseudo.content}, width ${pseudo.width}`
                + `, margin ${pseudo.marginLeft}/${pseudo.marginRight}`
                + `, position ${pseudo.position}`);
            }
            return `${probe.describe(element)} - ${parts.join(", ")}`;
          };
          const DEPTH_LIMIT = 40;
          let node: Element = document.body;
          const path: string[] = [probe.describe(node)];
          let named = false;
          for (let depth = 0; depth < DEPTH_LIMIT && probes < PROBE_LIMIT; depth += 1) {
            // Snapshot: `children` is live, and hiding a node can make igv's
            // own resize observers add or remove siblings while the walk is
            // still reading them.
            const kids = Array.from(node.children);
            const guilty: Element[] = [];
            for (const child of kids) {
              if (probes >= PROBE_LIMIT) break;
              if (resolvesWhenHidden(child)) guilty.push(child);
            }
            // One child accounts for the whole overflow: the cause is inside
            // it, so go in. Nothing does: the cause is this node's own box,
            // which is the answer for a margin, a pseudo-element or a width
            // floor. Several do: each is independently sufficient, so name
            // them all rather than picking one.
            if (guilty.length === 1 && probes < PROBE_LIMIT) {
              node = guilty[0];
              path.push(probe.describe(node));
              continue;
            }
            if (guilty.length === 0) {
              // "No child is individually sufficient" is not yet "the node
              // itself". Two children that each overflow alone would both
              // fail the single-child test and blame their parent, which
              // would be a wrong answer stated confidently. Hiding every
              // child at once decides it: if that resolves the overflow the
              // cause is collective and below this node, and if it does not,
              // the width really is the node's own - which is the margin, the
              // pseudo-element or the width floor this walk exists to find.
              const restore = kids.map(child => {
                const box = styled(child);
                if (!box) return null;
                const had = box.style.getPropertyValue("display");
                const priority = box.style.getPropertyPriority("display");
                box.style.setProperty("display", "none", "important");
                return { box, had, priority };
              });
              probes += 1;
              const withoutChildren = root.scrollWidth;
              for (const saved of restore) {
                if (!saved) continue;
                if (saved.had) saved.box.style.setProperty("display", saved.had, saved.priority);
                else saved.box.style.removeProperty("display");
              }
              if (withoutChildren <= root.clientWidth) {
                bisect.push(`no child accounts for it alone, but hiding all `
                  + `${kids.length} together resolves it, so the cause is several `
                  + `children of ${probe.describe(node)} acting jointly - widest first: `
                  + [...kids]
                    .sort((a, b) => b.scrollWidth - a.scrollWidth)
                    .slice(0, 4).map(child => describeCause(child)).join(" | "));
              } else {
                bisect.push(`no child accounts for it and hiding all `
                  + `${kids.length} together does not either, so the cause is the `
                  + `node's own box: ${describeCause(node)}`);
              }
            } else if (guilty.length > 1) {
              bisect.push(`${guilty.length} independently sufficient causes under `
                + `${probe.describe(node)}: `
                + guilty.slice(0, 4).map(child => describeCause(child)).join(" | "));
            }
            // Reached a decision point: either branch above pushed a
            // finding, or the probe bound stopped a single-child descent and
            // the bound's own message below says so.
            named = true;
            break;
          }
          // Three ways to finish without an answer, each said out loud rather
          // than left as an empty list a reader would mistake for "nothing
          // found": the probe bound, the depth bound, and a walk that never
          // reached either but never named a node.
          if (probes >= PROBE_LIMIT) {
            bisect.push(`bisection stopped at its ${PROBE_LIMIT}-probe bound at `
              + `${probe.describe(node)} - incomplete, raise the bound to finish it`);
          } else if (!named) {
            bisect.push(`bisection stopped at its ${DEPTH_LIMIT}-level depth bound at `
              + `${probe.describe(node)} - incomplete, raise the bound to finish it`);
          }
          bisect.push(`descent: ${path.join(" > ")}`);
          // The walk mutates the page and restores it. Say whether that
          // worked rather than trusting it: a botched restore would corrupt
          // every assertion after this one on this page, and silently.
          bisect.push(root.scrollWidth === scrollWidthBefore
            ? `document restored to ${scrollWidthBefore}px after ${probes} probes`
            : `RESTORE FAILED: ${scrollWidthBefore}px before, `
              + `${root.scrollWidth}px after ${probes} probes`);
        }
        return {
          // What has a box past the edge and what was supposed to be clipping
          // it. When `widest` is empty this is the only thing that says why.
          escaped: caught.slice(0, 6).map(element => {
            let clipper: Element | null = element.parentElement;
            while (clipper && getComputedStyle(clipper).overflowX === "visible") {
              clipper = clipper.parentElement;
            }
            return `${probe.describe(element)} reaches ${Math.round(element.getBoundingClientRect().right)}px`
              + `, inside ${clipper ? probe.describe(clipper) : "(nothing)"}`
              + ` which is ${clipper ? Math.round(clipper.getBoundingClientRect().width) : 0}px wide`;
          }),
          leaks: escapes.slice(0, 6).map(element =>
            `${probe.describe(element)} holds ${element.scrollWidth}px in a ${element.clientWidth}px box`),
          scrollWidth: scrollWidthBefore,
          clientWidth: root.clientWidth,
          // Width with no element of its own to name: a floor set on the root
          // or the body, and pseudo-elements, which `querySelectorAll` cannot
          // return. Bounded to the nodes already in hand plus the two roots,
          // so this costs no second walk of the document.
          floors: [root, document.body].filter(Boolean).map(element => {
            const style = getComputedStyle(element);
            return `${probe.describe(element)} min-width ${style.minWidth}, width ${style.width}`;
          }),
          pseudo: [root, document.body, ...caught, ...wide].slice(0, 40).flatMap(element =>
            (["::before", "::after"] as const).flatMap(part => {
              const style = getComputedStyle(element, part);
              if (style.content === "none") return [];
              const offEdge = style.position === "fixed" || style.position === "absolute";
              if (style.width === "auto" && !offEdge && style.marginRight === "0px") return [];
              return [`${probe.describe(element)}${part} width ${style.width}`
                + `, position ${style.position}, right ${style.right}, margin-right ${style.marginRight}`];
            })).slice(0, 8),
          // What the causal walk found when every reader above came back
          // empty, and empty itself when one of them named a cause.
          bisect,
          // Empty when nothing has a box past the edge — a margin, a
          // pseudo-element or a fixed-width table can widen the document with
          // no element of its own to name — so the two lengths are reported
          // either way rather than a failure with nothing in it.
          widest: causes.slice(0, 5).map(element =>
            `${probe.describe(element)} → right edge at ${Math.round(element.getBoundingClientRect().right)}px`),
        };
      });
      // Soft, so one run names every page that fails rather than the first.
      // One route is recorded rather than asserted, and only one. The ledger
      // carries its measured width, so the page can get narrower and never
      // wider, and a second route joining it fails as an unrecorded finding
      // rather than sliding in under the first.
      const recorded = reflowLedger().find(known => known.route === route);
      if (recorded) {
        // The probe gathers its whole diagnosis for this route and the
        // assertion below then compares two numbers, so on a passing run every
        // word of it was discarded: an assertion that passes never prints its
        // message. That is why the ledger says this route's cause is
        // unidentified while the sweep measures it on every run. Attach it, so
        // each run carries what it found without changing any verdict.
        if (overflow) {
          await test.info().attach(`reflow${route.replace(/[^a-z0-9]+/gi, "-")}`,
            { body: JSON.stringify(overflow, null, 2), contentType: "application/json" });
        }
        // That attachment only survives a FAILING run: CI uploads
        // test-results and playwright-report under `if: failure()`. This route
        // is recorded, so the assertion below passes, the suite is green, and
        // the attachment is discarded with it. A diagnostic that answers only
        // when something else is already broken is not a diagnostic at all -
        // measured on run 35629058688, which was green and produced no
        // artifact. The job log is kept either way, so the findings go there.
        //
        // THE FIRST FIX SENT ONLY THE WALK'S FINDINGS, on the reasoning that
        // the geometric readers "say nothing on this route". Run 35635733111
        // disproved that, and in the way that mattered: it printed no walk
        // line at all, because the walk is gated on `causes.length === 0` and
        // `causes` was NOT empty. The readers had named a cause, the walk
        // correctly stood down, and the answer this route has been waiting for
        // was computed and then dropped with the attachment - the same bug one
        // level up from the one that fix closed. So everything the probe
        // found goes to the log now, readers included. All of it is bounded
        // (at most 6, 6, 5, 2 and 8 entries), so this costs a handful of lines
        // on one route and nothing anywhere else.
        for (const line of overflow ? [
          `${overflow.scrollWidth}px in a ${overflow.clientWidth}px viewport`,
          ...overflow.widest.map(entry => `widest: ${entry}`),
          ...overflow.leaks.map(entry => `leak: ${entry}`),
          ...overflow.escaped.map(entry => `escaped: ${entry}`),
          ...overflow.floors.map(entry => `floor: ${entry}`),
          ...overflow.pseudo.map(entry => `pseudo: ${entry}`),
          ...overflow.bisect.map(entry => `bisect: ${entry}`),
        ] : []) {
          console.log(`reflow ${route}: ${line}`);
        }
        expect.soft(overflow?.scrollWidth ?? 0,
          `${route} is recorded at ${recorded.scrollWidth} CSS px; a wider page is a regression, `
          + `and one that reflows must leave ${ACCESSIBILITY_LEDGER}`)
          .toBe(recorded.scrollWidth);
        return;
      }
      expect.soft(overflow, `${route} must reflow at 320 CSS px, not scroll sideways`).toBeNull();
    });
    // Both directions: a recorded route that now reflows has to leave the
    // ledger, or this fails naming it.
    for (const known of reflowLedger()) {
      expect.soft(sweptRoutes, `${known.route} is recorded in ${ACCESSIBILITY_LEDGER} but was not swept`)
        .toContain(known.route);
    }
    expect(visited, "the 320px sweep visited every reachable page").toBeGreaterThan(MIN_SWEPT_ROUTES);
  });
});
