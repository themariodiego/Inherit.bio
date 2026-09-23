import type { Page } from "@playwright/test";

type KeyboardAudit = {
  active(): Element | null;
  elements(): Element[];
  before(first: Element, second: Element): boolean;
  closest(element: Element, selector: string): Element | null;
  contains(ancestor: Element, element: Element): boolean;
  describe(element: Element): string;
  rendered(element: Element): boolean;
  tab: { elements: Element[]; names: string[]; violations: string[]; counted: Element[] };
};

declare global {
  interface Window {
    __keyboardAudit?: KeyboardAudit;
    __keyboardTrap?: Element;
  }
}

/** Self-contained for addInitScript: follow the same shadow/slot tree as Tab. */
export function installKeyboardAudit() {
  const parent = (element: Element): Element | null => {
    if (element.assignedSlot) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const elements = (): Element[] => {
    const ordered: Element[] = [];
    const visit = (element: Element) => {
      ordered.push(element);
      const assigned = element instanceof HTMLSlotElement ? element.assignedElements({ flatten: true }) : [];
      const children = assigned.length ? assigned : (element.shadowRoot ?? element).children;
      for (const child of children) visit(child);
    };
    visit(document.documentElement);
    return ordered;
  };
  const closest = (element: Element, selector: string): Element | null => {
    for (let current: Element | null = element; current; current = parent(current)) {
      if (current.matches(selector)) return current;
    }
    return null;
  };
  window.__keyboardAudit = {
    active() {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active;
    },
    elements,
    before(first, second) {
      const ordered = elements();
      const start = ordered.indexOf(first);
      return start >= 0 && ordered.indexOf(second) > start;
    },
    closest,
    contains(ancestor, element) {
      for (let current: Element | null = element; current; current = parent(current)) {
        if (current === ancestor) return true;
      }
      return false;
    },
    describe(element) {
      const name = element.getAttribute("aria-label")
        ?? (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      return element.tagName.toLowerCase() + (element.id ? `#${element.id}` : "")
        + (name ? ` "${name}"` : "");
    },
    rendered(element) {
      if (!element.getClientRects().length || closest(element, "[inert]")) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    },
    tab: { elements: [], names: [], violations: [], counted: [] },
  };
}

/** How one traversal ended, as seen from inside the document. */
export type TabExit = "left-document" | "wrapped" | "trapped" | "exhausted";
type TabPass = { stops: number; expected: number; exit: TabExit; violations: string[]; last: string;
  unreached: string[] };

/**
 * A hang guard, not a measurement: a traversal ends by itself at the body or
 * at the first element it reaches twice, so this cap is only ever reached by a
 * page that keeps handing focus to something new. Reaching it is reported as
 * `exhausted`, which fails.
 */
const TAB_PRESS_CAP = 500;

export async function tabThrough(page: Page): Promise<TabPass> {
  const expected = await page.evaluate(() => {
    const probe = window.__keyboardAudit;
    if (!probe) throw new Error("element probe not installed");
    probe.tab = { elements: [], names: [], violations: [], counted: [] };
    // A floor, not a census. Radio inputs are left out (exactly one of a group
    // is tabbable and which one depends on which is checked), so is anything
    // carrying tabindex="-1" (the roving chip strip parks its other chips
    // there), and so is every ARIA-role widget that is not natively focusable.
    // The count can only come out lower than the truth, which is what a "did
    // the traversal actually reach this page" assertion needs.
    let count = 0;
    for (const element of probe.elements().filter(element => element.matches(
      'a[href],button,input,select,textarea,summary,[tabindex="0"]'))) {
      if (!probe.rendered(element)) continue;
      if (element.getAttribute("tabindex") === "-1") continue;
      if (element.matches(":disabled")) continue;
      if (element.matches('input[type="hidden"],input[type="radio"]')) continue;
      // Only the first summary of a <details> is a tab stop.
      if (element.tagName === "SUMMARY" && !(element.parentElement?.tagName === "DETAILS"
        && element.parentElement.firstElementChild === element)) continue;
      // A control inside a closed <details> is correctly not a tab stop: the
      // summary that opens it is one, and it is counted and reached. Chromium
      // still hands these descendants client rects, so `rendered` says yes and
      // the count came out eight too high on the report library, whose eight
      // category jump links live behind exactly such a disclosure. That read as
      // eight controls a keyboard could not reach; they are reachable, one Tab
      // and one Enter away. Counting them was the bug, not the page.
      const closed = probe.closest(element, "details:not([open])");
      if (closed && !(element.tagName === "SUMMARY" && element.parentElement === closed)) continue;
      count++;
      probe.tab.counted.push(element);
    }
    // Where the next Tab starts from. tabindex="-1" adds no tab stop, but
    // focusing the root resets Chromium's sequential-navigation starting
    // point, so the second pass over a page starts at the top rather than
    // continuing from wherever the first one ended.
    document.documentElement.tabIndex = -1;
    document.documentElement.focus();
    return count;
  });
  let exit: TabExit = "exhausted";
  for (let press = 0; press < TAB_PRESS_CAP; press++) {
    await page.keyboard.press("Tab");
    const step = await page.evaluate(() => {
      const probe = window.__keyboardAudit;
      if (!probe) throw new Error("element probe not installed");
      const log = probe.tab;
      const active = probe.active();
      // Nothing in the page holds focus any more: in a browser with chrome
      // this is the Tab that hands focus to the address bar.
      if (!active || active === document.body || active === document.documentElement) return "left-document";
      const seen = log.elements.indexOf(active);
      if (seen === 0) return "wrapped";
      if (seen > 0) {
        log.violations.push(`focus returned to ${log.names[seen]}`
          + ` (stop ${seen + 1} of ${log.elements.length}) instead of leaving the page`);
        return "trapped";
      }
      const name = probe.describe(active);
      const previous = log.elements[log.elements.length - 1];
      if (previous && previous.isConnected) {
        if (!probe.before(previous, active)) {
          log.violations.push(`${log.names[log.names.length - 1]} → ${name} moves backwards in the DOM`);
        }
      } else if (previous) {
        // A detached node answers `compareDocumentPosition` with an
        // implementation-specific order, so this is reported, not judged.
        log.violations.push(`${log.names[log.names.length - 1]} left the DOM while it held focus`);
      }
      log.elements.push(active);
      log.names.push(name);
      return "advancing";
    });
    if (step !== "advancing") { exit = step; break; }
  }
  const log = await page.evaluate(() => {
    const probe = window.__keyboardAudit;
    if (!probe) throw new Error("element probe not installed");
    return {
      stops: probe.tab.elements.length,
      violations: probe.tab.violations,
      last: probe.tab.names[probe.tab.names.length - 1] ?? "(no tab stop at all)",
      // A shortfall is only worth recording if it can be acted on, and "eight
      // stops missing" cannot. These are the counted elements Tab never landed
      // on, named, so the next person reads which controls a keyboard cannot
      // reach rather than how many.
      unreached: probe.tab.counted
        .filter(element => !probe.tab.elements.includes(element))
        .map(element => probe.describe(element)),
    };
  });
  return { ...log, expected, exit };
}

/**
 * WCAG 2.1 SC 2.1.2 in the half that the Tab traversal above cannot see.
 *
 * The criterion is not "Tab always leaves". It is that focus can be moved
 * away using only the keyboard, and that if the key is not an unmodified
 * arrow or Tab, the reader is told which key it is. So a page whose Tab order
 * loops inside a widget still conforms — but only if it ships a working
 * escape AND says so on the page. This checks both, on whatever page the
 * traversal ended trapped, and it is a plain failure rather than a ledger
 * entry: an unescapable trap is a Level A failure with no honest interim.
 *
 * "Told which key" is read from the accessible description of the component
 * focus is stuck in, because that is what a reader arriving by Tab actually
 * hears; a sentence rendered somewhere on the page that the component does
 * not reference would pass a text search and help nobody.
 */
export async function escapeLeavesTheTrap(page: Page): Promise<string | null> {
  const trapped = await page.evaluate(() => {
    const probe = window.__keyboardAudit;
    if (!probe) throw new Error("element probe not installed");
    const active = probe.active();
    if (!active || active === document.body) return null;
    // The component, not the control: the region, dialog or application the
    // stuck control sits in, which is the thing SC 2.1.2 talks about.
    const region = probe.closest(active, '[role="region"],[role="application"],[role="dialog"],[role="group"]')
      ?? active;
    window.__keyboardTrap = region;
    const described = (region.getAttribute("aria-describedby") ?? "")
      .split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    return { region: probe.describe(region), described };
  });
  if (!trapped) return null;
  // Named, not inferred from a key list: if the page advertises a different
  // key this reads it and presses that instead, so the check follows the
  // page's own statement rather than assuming Escape.
  const advertised = /\b(Escape|Esc)\b/i.test(trapped.described) ? "Escape" : null;
  if (!advertised) {
    return `    ${trapped.region} traps focus and its accessible description does not name a key`
      + ` that moves focus out of it. WCAG 2.1 SC 2.1.2 needs both: a working escape, and the`
      + ` reader told which key it is.\n      described as: ${trapped.described || "(nothing)"}`;
  }
  await page.keyboard.press(advertised);
  const left = await page.evaluate(() => {
    const probe = window.__keyboardAudit;
    const region = window.__keyboardTrap;
    if (!probe || !region) throw new Error("trap probe not installed");
    const active = probe.active();
    if (!active || active === document.body || active === document.documentElement) {
      return { out: true, where: "(left the page)" };
    }
    return {
      out: !probe.contains(region, active),
      where: probe.describe(active),
      // Moving focus BACKWARDS out of the trap would satisfy the letter and
      // strand the reader before the widget they just left, so where it lands
      // is reported rather than only whether it left.
      forward: probe.before(region, active),
    };
  });
  if (!left.out) {
    return `    ${trapped.region} advertises ${advertised} as its escape and pressing it left focus`
      + ` inside the trap, at ${left.where}`;
  }
  if (left.forward === false) {
    return `    ${trapped.region} advertises ${advertised} as its escape and pressing it moved focus`
      + ` BACKWARDS, to ${left.where}, stranding the reader before the widget they left`;
  }
  return null;
}
