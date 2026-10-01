import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { installKeyboardAudit, type TabExit } from "./keyboard-traversal";

/**
 * G2.7 asks that every new route render in both themes under unmodified
 * assertions. A hand-kept list cannot honour "every": this one held four
 * routes while the register carried 29 static public pages, so 25 — every
 * legal page among them — were never checked in either theme.
 *
 * Derived from the register instead, so a new public page is covered the day
 * it lands. Dynamic segments are skipped: they have no fetchable URL without
 * valid parameter values, and inventing one would test a 404 rather than a
 * page. Authenticated routes stay with the signed-in test below.
 */
export function publicRoutes(): string[] {
  const register = JSON.parse(fs.readFileSync("docs/route-register.json", "utf8")) as {
    routes: { kind: string; auth: string; path: string }[];
  };
  const routes = register.routes
    .filter(route => route.kind === "page" && route.auth === "public" && !route.path.includes("["))
    .map(route => route.path)
    .sort();
  // A broken filter must fail loudly rather than quietly check four pages.
  if (routes.length < 20) throw new Error(`route register yielded only ${routes.length} public pages`);
  return routes;
}

export const PUBLIC_ROUTES = publicRoutes();
export const TINY_FIXTURE = "e2e/fixtures/tiny-grch38.vcf";

/**
 * The URL each registered authenticated page is visited at. A path listed here
 * with a query renders a populated state the bare path does not: the variant
 * browser answers nothing without a search, so checking it bare would check a
 * form rather than a results table.
 */
export const VISIT: Record<string, string> = {
  "/overview": "/overview",
  "/files": "/files",
  "/files/upload": "/files/upload",
  "/settings": "/settings",
  "/settings/data": "/settings/data",
  "/settings/copilot": "/settings/copilot",
  "/settings/people": "/settings/people",
  "/settings/consents": "/settings/consents",
  "/family/invite": "/family/invite",
  "/family/health-picture": "/family/health-picture",
  "/embryos": "/embryos",
  "/embryos/upload": "/embryos/upload",
  "/embryos/request-data": "/embryos/request-data",
  "/embryos/compare": "/embryos/compare",
  "/genome/[subject]": "/genome/me",
  "/genome/[subject]/reports": "/genome/me/reports",
  "/genome/[subject]/reports/[slug]": "/genome/me/reports/caffeine-metabolism-cyp1a2-rs762551",
  "/genome/[subject]/ancestry": "/genome/me/ancestry",
  "/genome/[subject]/data": "/genome/me/data",
  "/genome/[subject]/data/browser": "/genome/me/data/browser?q=rs762551",
  "/copilot/[scope]": "/copilot/me",
};

/**
 * The registered document pages, which are public but carry dynamic segments,
 * so the sweep above skips them for want of a URL. Their parameters are not
 * invented here: `consent.own-polygenic` is shipped by
 * `supabase/migrations/20260906135854_own_report_layer_language.sql` at
 * version 2 with version 1 superseded, so every one of these six URLs
 * resolves to a real document in any database the migrations built — the diff
 * routes included, which need two versions to be anything but a 404.
 *
 * They were audited by nothing until the coverage assertion below went
 * looking: the public sweep skips dynamic segments and the authenticated
 * sweep never saw them, so seventeen legal documents were checked by the
 * rendered legal gate for placeholder text and by no one for accessibility.
 */
export const CONSENT_KEY = "consent.own-polygenic";
export const DOCUMENTS: Record<string, string> = {
  "/legal/[artifact]": `/legal/${CONSENT_KEY}`,
  "/legal/[artifact]/versions/[version]": `/legal/${CONSENT_KEY}/versions/1`,
  "/legal/[artifact]/diff/[from]/[to]": `/legal/${CONSENT_KEY}/diff/1/2`,
  "/legal/consent/[key]": `/legal/consent/${CONSENT_KEY}`,
  "/legal/consent/[key]/v/[version]": `/legal/consent/${CONSENT_KEY}/v/1`,
  "/legal/consent/[key]/diff/[from]/[to]": `/legal/consent/${CONSENT_KEY}/diff/1/2`,
};

/**
 * Registered endpoints that answer with an HTML document a person reads, and
 * so would be audited by nobody: the registered-page sweep above enumerates
 * pages.
 *
 * Today that is `/withdraw/request`, registered since 2026-09-28 as
 * `rights.withdraw-request`, an endpoint whose success contract
 * (`rights-interstitial-v1`) is `text/html`. It is a `route.ts` that builds its
 * document as a template string and returns it with its own nonce,
 * Content-Security-Policy and Set-Cookie, because it mints a rights-activation
 * candidate before any markup, which a React page cannot do in the same
 * response. That puts it outside the app layout and `pageAuthContract`, on a
 * surface every withdrawal and invitation mail links a person straight to, so
 * its headings, landmarks, contrast and focus order are held here at the same
 * bar as every other public page.
 *
 * The list is read from the register, so a second HTML endpoint is audited the
 * day it is registered rather than the day someone remembers it.
 */
export const ENDPOINT_RENDERED_PAGES: Record<string, string> = (() => {
  const register = JSON.parse(fs.readFileSync("docs/route-register.json", "utf8")) as {
    routes: { kind: string; path: string; successResponseContract?: string }[];
    responseContracts: Record<string, { contentType?: string }>;
  };
  const html = register.routes.filter(route => route.kind === "endpoint" && !route.path.includes("[")
    && (register.responseContracts[route.successResponseContract ?? ""]?.contentType ?? "").startsWith("text/html"));
  const pages = Object.fromEntries(html.map(route => [route.path, route.path]));
  if (!("/withdraw/request" in pages)) throw new Error("the register no longer names /withdraw/request as an HTML endpoint");
  return pages;
})();

/**
 * The 404 surface. It is not a registered route, so it cannot come from the
 * register walk — and until this change no sweep could have seen it at all,
 * because the app had no `not-found.tsx`: all 72 `notFound()` call sites across
 * 19 route files rendered the framework's own built-in page.
 *
 * It is a privacy surface as much as a wayfinding one. Brief line 477 requires
 * that after revocation, `GET` on `/family/[person]`,
 * `/family/health-picture`, `/family/portrait/[pairId]`, `/api/export` and the
 * Copilot history endpoint return 404 to every account that previously had
 * access — so this page is what a person sees at the moment their access ends,
 * and it is audited at the same bar as every public page in both themes.
 */
/**
 * Both shapes, because they are different documents and only one of them was
 * audited at first. An unmatched URL renders under the bare root layout; a
 * `notFound()` thrown inside a route group renders inside that group's layout,
 * which already supplies the one `<main>`. Auditing only the first is how a
 * two-landmark, duplicate-id page passed its own accessibility check.
 */
export const NOT_FOUND_URLS: Record<string, string> = {
  "an unmatched URL": "/this-route-does-not-exist-and-never-will",
  "a notFound() inside a layout": "/legal/definitely-not-a-committed-artifact",
};

/**
 * The registered pages audited by another spec instead, because reaching them
 * needs state this spec has no business building — a second confirmed account
 * and an accepted invitation, a granted portrait pair, an ingested cohort.
 *
 * They are audited at exactly the bar used here: `expectAxeClean` in
 * `e2e/helpers.ts` is the one definition of the audit, in both themes, zero
 * WCAG 2.1 A/AA violations of any impact. Four of those specs used to hold
 * their own copy of it filtered to `serious` and `critical`, which is not a
 * smaller version of the same check — a `moderate` violation is still a WCAG
 * failure — so the Family, Portrait and Embryo surfaces were held to a lower
 * bar than every marketing page, silently, because the bar lived in each spec.
 *
 * Listed rather than filtered out, and asserted to be exactly the set with no
 * entry in VISIT, so neither list can drift from the register: a new page
 * lands here loudly, and a page that gains a visit has to leave.
 */
export const CHECKED_ELSEWHERE: Record<string, string> = {
  "/family": "e2e/family.spec.ts, the signed-in hub",
  "/withdraw/[token]": "e2e/family.spec.ts, the pinned /withdraw/session entry for its invitation",
  "/family/[person]": "e2e/family.spec.ts, past the Tier-2 gate with a shared layer showing",
  "/family/[person]/permissions": "e2e/family.spec.ts, with both columns populated",
  "/family/portrait/[pairId]": "e2e/portrait.spec.ts, past the portrait gate",
  "/embryos/[embryoId]": "e2e/embryos.spec.ts",
};

export type RegisteredPage = { kind: string; auth: string; path: string; disposition: unknown };

export function registeredPages(): RegisteredPage[] {
  const register = JSON.parse(fs.readFileSync("docs/route-register.json", "utf8")) as {
    routes: RegisteredPage[];
  };
  return register.routes.filter(route => route.kind === "page" && route.disposition === "kept");
}

export function authenticatedRoutes(): string[] {
  const routes = registeredPages()
    .filter(route => route.auth === "authenticated")
    .map(route => route.path)
    .sort();
  // A broken filter must fail loudly rather than quietly check three pages.
  if (routes.length < 20) throw new Error(`route register yielded only ${routes.length} authenticated pages`);
  return routes;
}

/* ------------------------------------------------------------------------- *
 * G1.13b — the four measurements axe cannot make.
 *
 * axe reads the rendered accessibility tree of one layout; none of these four
 * is in it. Reflow is a comparison of two lengths at one viewport width;
 * target size is a box measurement; tab order is a sequence only a real Tab
 * press produces; and whether a picture has an equivalent in words is a
 * question about two DOM subtrees saying the same thing. Each is written as
 * its own named test, sweeping every page this spec can reach — the same set
 * the axe sweeps above cover, derived from the same register, so a new page
 * joins all four the day it lands.
 * ------------------------------------------------------------------------- */

/** One page to visit: its registered path (for messages) and its URL. */
export type SweepTarget = { route: string; url: string; auth: boolean };

/**
 * Today's register yields 57 reachable pages (29 public + 6 documents + 22
 * authenticated). The floor is what makes an empty or half-broken scan fail
 * loudly instead of passing four measurements over nothing.
 */
export const MIN_SWEPT_ROUTES = 50;
/** Interactive elements the target-size sweep must actually have measured. */
export const MIN_MEASURED_TARGETS = 100;
/** Tab stops the keyboard sweep must actually have reached. */
export const MIN_TAB_STOPS = 200;
/** The route whose map G1.13b names by hand; asserted to still be registered. */
export const ANCESTRY_ROUTE = "/genome/[subject]/ancestry";
/**
 * The one control size, in CSS px: brief §1.1 line 553 (`--size-control:
 * 44px`, "every button, input, switch, tap target", with the 36px size
 * deleted rather than carved out) and §9 line 706 ("Minimum target 44×44 CSS
 * px"). Deliberately stricter than WCAG 2.2 AA's SC 2.5.8 minimum of 24×24.
 */
export const TARGET_SIZE = 44;

/* ------------------------------------------------------------------------- *
 * The recorded half: docs/accessibility-divergence.json.
 *
 * Two of the four measurements below find things that cannot be closed from
 * this file and were not closed by weakening it. Target size is a product-wide
 * design fact — `src/components/ui/button.tsx` has no 44px step in its size
 * scale at all, while the brief pins `--size-control: 44px` and deletes the
 * 36px size rather than carving it out — so raising it is an owner decision
 * across every surface, not a test's to make. The keyboard trap on the variant
 * browser is a WCAG 2.1 SC 2.1.2 Level A defect inside igv.js 3.8.5, whose
 * subtree (shadow root included) we post-process and do not own.
 *
 * So those two are ratchets rather than assertions, in the shape this
 * repository already uses three times — `docs/route-divergence.json` with
 * `scripts/route-gate.ts`, `docs/claims-divergence.json` with
 * `scripts/claims-gate.ts`, and `UNPROVEN_ROUTE_STATE_PAIRS` in the first of
 * those. The ledger holds fields, the sentence is rebuilt from them here
 * through the same function the measurement uses, and the comparison runs in
 * BOTH directions: an unrecorded finding fails, and a recorded finding the
 * sweep no longer produces fails too. A control that grows to 44px therefore
 * forces its entry down in the same change, and nothing can quietly be added.
 *
 * Reflow and the text alternatives are NOT ratcheted and have no group in the
 * ledger. Reflow's number is zero and the causes were fixed; the text
 * alternatives pass.
 * ------------------------------------------------------------------------- */

export const ACCESSIBILITY_LEDGER = "docs/accessibility-divergence.json";

/**
 * One component measured under `TARGET_SIZE` wherever it renders. `component`
 * is what `probe.signature` builds from the element's own attributes; the two
 * lengths are the smallest box that component was measured at anywhere in the
 * sweep, to the nearest CSS pixel — nearest rather than exact so sub-pixel
 * jitter cannot churn the ledger, and the smallest rather than an average
 * because a ratchet holds the worst case.
 */
export type UndersizedControl = {
  component: string;
  smallestWidth: number;
  smallestHeight: number;
};

/** One (route, viewport, assertion) the keyboard traversal reports. */
export type KeyboardDivergence =
  | { kind: "stops"; route: string; viewport: string; reached: number; expected: number }
  | { kind: "order"; route: string; viewport: string; violations: number }
  | { kind: "exit"; route: string; viewport: string; last: string; outcome: TabExit };

/**
 * How many (page, control) pairs the target-size sweep reports: the volume the
 * per-component ledger collapses, held as an exact ratchet so the collapse can
 * never hide growth. A component fixed lowers it; a control shrunk or a page
 * added raises it; either has to be written down in the same change.
 *
 * MEASURE IT, NEVER GUESS IT. This number cannot be read off a stylesheet —
 * a class says what a control was asked to be, the sweep says what it turned
 * out to be — so it is -1 until a full sweep has printed it, and a count can
 * never be negative, which is what makes -1 impossible to mistake for a
 * measurement. Run this one test and write the number it names here. Until
 * then the test fails saying so, which is the honest state: a guessed number
 * that happened to pass would be a ratchet holding nothing.
 */
export const UNDERSIZED_CONTROL_OCCURRENCES = 0;

/** One component's finding sentence, built in one place for both sides. */
export function undersizedControlFinding(entry: UndersizedControl): string {
  return `${entry.component}: smallest box ${entry.smallestWidth}x${entry.smallestHeight} CSS px`
    + `, under ${TARGET_SIZE}x${TARGET_SIZE}`;
}

/** One keyboard finding's sentence, in the one of three shapes its `kind` names. */
/**
 * The compared key deliberately carries no counts for the two kinds whose
 * counts move between runs on the same code.
 *
 * A stop shortfall is measured against how many elements are certainly
 * tabbable on the page, and that depends on what the swept account holds - a
 * report list is as long as the reports chosen for it. Two consecutive runs
 * reported 13-of-14 on one route and 117-of-125 on another. An order break
 * count moves for the same reason, and it moved 3 to 1 when a scroll container
 * was added on that page. Keying the ledger on a number that shifts without
 * the product changing would make this ratchet fail on its own noise, and a
 * ratchet that cries wolf gets deleted.
 *
 * So the key is the fact - this route, at this width, loses tab stops, or
 * breaks tab order - and the numbers ride along in the ledger as evidence and
 * in the failure message as detail. Both directions still hold: a route that
 * develops a shortfall is unrecorded and fails, and a route that stops having
 * one leaves the ledger stale and fails. The exit kind keeps its detail,
 * because "trapped" is a state and not a count.
 */
export function keyboardFinding(entry: KeyboardDivergence): string {
  const where = `${entry.route} at ${entry.viewport}`;
  if (entry.kind === "stops") {
    return `${where}: Tab reaches fewer stops than the elements that are certainly tabbable`;
  }
  if (entry.kind === "order") {
    return `${where}: tab order breaks instead of following DOM order and never returning`;
  }
  return `${where}: Tab past the last control (${entry.last}) ${entry.outcome} instead of`
    + ` leaving the page`;
}

/**
 * The committed ledger, as the finding lists the comparisons read. A group the
 * file omits is an empty group, which fails on its first finding rather than
 * passing silently.
 */
/**
 * The one route recorded as still scrolling sideways at 320 CSS px, with the
 * width it measured. Reflow is otherwise a hard assertion and stays one: 32 of
 * the 33 routes that failed when this sweep was written were fixed rather than
 * recorded. This route is the remainder, and it is recorded by exact width so
 * it can only get narrower.
 */
export function reflowLedger(): { route: string; scrollWidth: number }[] {
  const file = JSON.parse(fs.readFileSync(ACCESSIBILITY_LEDGER, "utf8")) as {
    reflow?: { route: string; scrollWidth: number }[];
  };
  return file.reflow ?? [];
}

export function accessibilityLedger(): { targetSize: string[]; keyboard: string[] } {
  const file = JSON.parse(fs.readFileSync(ACCESSIBILITY_LEDGER, "utf8")) as {
    targetSize?: UndersizedControl[];
    keyboardTraversal?: KeyboardDivergence[];
  };
  return {
    targetSize: (file.targetSize ?? []).map(undersizedControlFinding),
    keyboard: (file.keyboardTraversal ?? []).map(keyboardFinding),
  };
}

/**
 * Both directions at once: what the sweep found, against what is recorded.
 *
 * `present` maps each finding to the evidence a person reading a CI failure
 * needs and the ledger deliberately does not keep — which route, which
 * element, the box it measured — plus the paste-ready object. So a failure
 * here is as informative as the per-page assertion it replaced, and the
 * ledger stays a document about components rather than about pages.
 */
export function compareToLedger(label: string, present: Map<string, string>, recorded: string[]): string[] {
  const failures: string[] = [];
  for (const finding of [...present.keys()].sort()) {
    if (!recorded.includes(finding)) {
      failures.push(`${label}: not recorded in ${ACCESSIBILITY_LEDGER}: ${finding}\n${present.get(finding)}`);
    }
  }
  for (const finding of [...recorded].sort()) {
    if (!present.has(finding)) {
      failures.push(`${label}: recorded in ${ACCESSIBILITY_LEDGER} but no longer present: ${finding}`
        + `\n    the measurement no longer produces it, so the entry comes down in the same change.`);
    }
  }
  return failures;
}

/** How a failure tells a person to record what it just measured. */
export function howToRecord(group: string, entry: UndersizedControl | KeyboardDivergence): string {
  return `    to record it, paste this into "${group}" in ${ACCESSIBILITY_LEDGER} and write its`
    + ` why, closing and blocker by hand:\n      ${JSON.stringify(entry)}`;
}

export function sweepTargets(): SweepTarget[] {
  // Public pages first, and measured signed OUT: `/auth/sign-in` redirects a
  // signed-in account to `/overview`, so a sweep that signed in first would
  // measure the overview twice and the sign-in form never.
  const targets: SweepTarget[] = [
    ...PUBLIC_ROUTES.map(route => ({ route, url: route, auth: false })),
    ...Object.entries(DOCUMENTS).map(([route, url]) => ({ route, url, auth: false })),
    ...authenticatedRoutes().filter(route => route in VISIT)
      .map(route => ({ route, url: VISIT[route], auth: true })),
  ];
  if (targets.length <= MIN_SWEPT_ROUTES) {
    throw new Error(`route register yielded only ${targets.length} reachable pages`);
  }
  return targets;
}

/** Names an element inside the page; shared by the three in-page measurements. */
export type ElementProbe = {
  /** How every failure message below names an element. */
  describe: (element: Element) => string;
  /** How a recorded finding names the component an element is an instance of. */
  signature: (element: Element) => string;
  /** Rendered at all — a box to measure and a box a pointer could reach. */
  rendered: (element: Element) => boolean;
  /** Everything a person can operate: `e2e/helpers.ts`'s list plus the widget roles. */
  interactive: string;
};

declare global {
  interface Window {
    __g113b?: ElementProbe;
  }
}

/**
 * Installed before any navigation, so the in-page measurements share one
 * definition of "interactive", "rendered" and "how an element is named" — an
 * `evaluate` callback runs in the browser and cannot close over this file's
 * functions, and three divergent copies of a selector is exactly how the axe
 * bar drifted between five specs before `helpers.ts` held it in one place.
 */
export async function installProbes(page: Page) {
  await page.addInitScript(installKeyboardAudit);
  await page.addInitScript(() => {
    window.__g113b = {
      interactive: 'a[href],button,input:not([type="hidden"]),select,textarea,summary,'
        + '[role="button"],[role="link"],[role="switch"],[role="checkbox"],[role="radio"],'
        + '[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],'
        + '[role="option"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])',
      describe(element: Element) {
        const slot = element.getAttribute("data-slot");
        const name = element.getAttribute("aria-label")
          ?? (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        return element.tagName.toLowerCase()
          + (element.id ? `#${element.id}` : "")
          + (slot ? `[data-slot=${slot}]` : "")
          + (name ? ` "${name}"` : "");
      },
      /**
       * How a recorded finding names the COMPONENT an element is an instance
       * of, where `describe` above names the instance. Built from the
       * element's own attributes and nothing else: `data-slot` is what this
       * codebase already puts on a component root, `data-variant` and
       * `data-size` are what `src/components/ui/button.tsx` puts on the one
       * component carrying a size scale, and an element with none of them is
       * placed by the nearest ancestor that has a slot.
       *
       * Never the accessible name: "Save" and "Delete" are two labels on one
       * component, and grouping by label would be a per-instance ledger with
       * extra steps. Where the nearest slotted ancestor differs between pages
       * one logical control lands in two signatures rather than one — the
       * grouping errs toward more rows, never toward a row that swallows a
       * finding.
       */
      signature(element: Element) {
        let bits = "";
        for (const attribute of ["data-variant", "data-size", "role"]) {
          const value = element.getAttribute(attribute);
          if (value) bits += `[${attribute}=${value}]`;
        }
        // The one distinction the tag name loses: a checkbox, a range and a
        // text field are three components wearing one element.
        if (element instanceof HTMLInputElement) bits = `[type=${element.type}]${bits}`;
        const tag = element.tagName.toLowerCase();
        const own = element.getAttribute("data-slot");
        if (own) return `${tag}[data-slot=${own}]${bits}`;
        const host = element.closest("[data-slot]")?.getAttribute("data-slot");
        return host ? `${tag}${bits} inside [data-slot=${host}]` : `${tag}${bits}`;
      },
      rendered(element: Element) {
        if (element.getClientRects().length === 0) return false;
        const style = getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none";
      },
    };
  });
}

/** A fresh account for this complete measurement spec; no cross-spec fixture state. */
export function createAccessibilitySweep() {
  const G113B_ACCOUNT = {
    email: `a11y-g113b-${randomUUID()}@e2e.local`,
    password: "e2e-a11y-g113b-pw",
  };
  async function sweepPages(
    page: Page,
    measure: (target: SweepTarget) => Promise<void>,
  ): Promise<number> {
    let signedIn = false;
    let visited = 0;
    for (const target of sweepTargets()) {
      if (target.auth && !signedIn) {
        await signIn(page, G113B_ACCOUNT.email, G113B_ACCOUNT.password);
        signedIn = true;
      }
      const response = await page.goto(target.url);
      // A 404 would make every measurement below meaningless, and quietly: a
      // not-found page reflows, has no undersized control and traps nobody.
      expect.soft(response?.status(), `${target.url} resolves to a page`).toBe(200);
      await page.waitForLoadState("networkidle");
      await measure(target);
      visited++;
    }
    return visited;
  }
  return { G113B_ACCOUNT, sweepPages };
}
