import type {} from "./keyboard-traversal";

/** Self-contained for page.evaluate; use the same composed tree as Tab. */
export function auditTextAlternatives() {
  const probe = window.__keyboardAudit;
  if (!probe) throw new Error("composed element probe not installed");
  const elements = probe.elements();
  const parent = (element: Element): Element | null => {
    if (element.assignedSlot) return element.assignedSlot;
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const within = (root: Element, selector: string) => elements.filter(element =>
    element !== root && element.matches(selector) && probe.contains(root, element));
  const hidden = (element: Element) => probe.closest(element, '[aria-hidden="true"]') !== null;
  const reference = (element: Element, id: string) => {
    const root = element.getRootNode();
    // ARIA IDREFs cannot name an element across a shadow boundary.
    return root instanceof Document || root instanceof ShadowRoot ? root.getElementById(id) : null;
  };
  const named = (element: Element) => Boolean(element.getAttribute("aria-label")?.trim())
    || (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean)
      .some(id => Boolean(reference(element, id)?.textContent?.trim()))
    || Boolean(element.querySelector(":scope > title")?.textContent?.trim());
  const candidates = new Set<Element>();
  let canvases = 0;
  let genomeCanvases = 0;
  for (const element of elements) {
    if (hidden(element) || !probe.rendered(element)
      || probe.closest(element, "details:not([open])")) continue;
    if (element.matches("figure")) candidates.add(element);
    if (!element.matches("canvas,svg")) continue;
    // An unnamed canvas can still draw data. Counting only named graphics
    // silently omitted the native genome track, whose canvases are unnamed.
    if (element.matches("canvas")) {
      canvases++;
      if (probe.closest(element, '[data-testid="genome-browser"]')) genomeCanvases++;
    } else if (!named(element) && element.getAttribute("role") !== "img") continue;
    candidates.add(probe.closest(element, "figure") ?? element);
  }
  const findings: string[] = [];
  const disclosures: { index: number; name: string }[] = [];
  const marked = new Set<Element>();
  for (const candidate of candidates) {
    const name = probe.describe(candidate);
    if (!(named(candidate)
      || within(candidate, "figcaption").some(caption => !hidden(caption) && caption.textContent?.trim())
      || within(candidate, "svg").some(named))) {
      findings.push(`${name}: no caption and no accessible name`);
    }
    const parts = within(candidate,
      '[tabindex]:not([tabindex="-1"]),[role="button"],[role="img"],[role="graphics-symbol"],[aria-label]')
      .filter(part => !hidden(part) && !part.matches("svg,canvas"));
    const hasCanvas = candidate.matches("canvas") || within(candidate, "canvas")
      .some(canvas => !hidden(canvas) && probe.rendered(canvas));
    const scopes = [candidate];
    const container = parent(candidate);
    // A page-wide landmark's unrelated navigation or search results cannot
    // stand in for a chart. A local figure/container can hold both views.
    if (container && !container.matches("html,body,main,nav,header,footer")) scopes.push(container);
    for (const attribute of ["aria-describedby", "aria-details"]) {
      for (const id of (candidate.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean)) {
        const target = reference(candidate, id);
        if (target) scopes.push(target);
      }
    }
    const lists = new Set<Element>();
    for (const region of scopes) {
      if (region.matches("table,ul,ol,dl")) lists.add(region);
      for (const list of within(region, "table,ul,ol,dl")) lists.add(list);
    }
    const eligible = [...lists].filter(list => {
      if (hidden(list) || probe.closest(list, "nav,header,footer")) return false;
      const figure = probe.closest(list, "figure");
      return !figure || figure === candidate || scopes.includes(list);
    });
    // Prefer an already visible equivalent to an unrelated hidden list.
    const equivalent = eligible.find(list => probe.rendered(list)
      && !probe.closest(list, "details:not([open])")) ?? eligible[0];
    if ((parts.length > 0 || hasCanvas) && !equivalent) {
      findings.push(`${name}: the picture exposes ${hasCanvas ? "a canvas" : `${parts.length} parts`}`
        + " and no list or table restates them");
    }
    if (parts.length === 0 && !hasCanvas && !equivalent) {
      // A grey figure may state nothing; its explanation must be outside
      // the picture, not merely the caption that gives the picture a name.
      let beside = "";
      if (container) {
        for (const element of elements) {
          if (!probe.contains(container, element) || probe.contains(candidate, element)
            || hidden(element) || !probe.rendered(element)) continue;
          for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) beside += node.nodeValue ?? "";
          }
        }
      }
      if (!/[a-z]{2,}/i.test(beside)) findings.push(`${name}: no list, no table and no sentence beside it`);
    }
    if (!equivalent) continue;
    const closed: Element[] = [];
    for (let current: Element | null = equivalent; current; current = parent(current)) {
      if (current.matches("details:not([open])")) closed.unshift(current);
    }
    for (const details of closed) {
      const summary = details.querySelector(":scope > summary");
      if (!summary || hidden(summary) || summary.getAttribute("tabindex") === "-1") {
        findings.push(`${name}: its list is inside a closed <details> with no keyboard-reachable <summary>`);
      } else if (!marked.has(summary)) {
        marked.add(summary);
        summary.setAttribute("data-g113b-disclosure", String(disclosures.length));
        disclosures.push({ index: disclosures.length, name });
      }
    }
    if (!closed.length && !probe.rendered(equivalent)) {
      findings.push(`${name}: ${probe.describe(equivalent)} is in the DOM but is not rendered`);
    }
  }
  return { checked: candidates.size, findings, disclosures, canvases, genomeCanvases };
}
