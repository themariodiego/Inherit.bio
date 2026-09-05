/** Browser-side G4.3 detector. Deliberately independent of Count's implementation. */
export function inspectReportCounts(definitions: Record<string, string>): string[] {
  const issues: string[] = [];
  const roots = Array.from(document.querySelectorAll("main, dialog[open]"));
  // "One report at a time" describes reading order, not a report quantity.
  const pattern = /\b(?:\d[\d,]*|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:specific[- ]variant\s+)?reports?\b(?!\s+at a time)|statistical\s+estimates?\b|of these reports\b)|\bshow all\s+\d[\d,]*\b/ig;
  const text = (node: Element) => (node.textContent ?? "").replace(/\s+/g, " ").trim();
  const matches = (node: Element) => Array.from(text(node).matchAll(pattern));
  const visible = (node: Element) => node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none";
  for (const root of roots) {
    if (root.querySelector("[data-count-class]")) issues.push("legacy-count-attribute");
    const counts = Array.from(root.querySelectorAll('[data-slot="count"]'));
    for (const count of counts) {
      const layer = count.getAttribute("data-figure-class") ?? "";
      if (layer !== "estimate" && layer !== "variant-call") issues.push("missing-or-mixed-count-class");
      const raw = count.getAttribute("data-metric-value") ?? "";
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) issues.push("invalid-count-value");
      if (count.querySelector('[data-slot="count"]') || matches(count).length !== 1) issues.push("mixed-or-missing-count-token");
      const actual = matches(count)[0]?.[0] ?? "";
      if ((layer === "estimate" && /specific[- ]variant/i.test(actual)) ||
        (layer === "variant-call" && /statistical|of these reports/i.test(actual))) issues.push("count-noun-layer-mismatch");
      const id = count.getAttribute("aria-describedby") ?? "";
      const definition = document.getElementById(id);
      if (!definition || document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length !== 1 ||
        text(definition) !== definitions[layer]) {
        issues.push("missing-or-wrong-count-definition");
      } else if (!visible(definition)) {
        const disclosure = definition.closest("details");
        const summary = disclosure?.querySelector(":scope > summary");
        if (!summary || !visible(summary) || disclosure?.hasAttribute("open")) issues.push("unreachable-count-definition");
      }
    }
    // A count split over nested spans must still be detected. Inspect each
    // smallest matching element, not just direct text nodes or known slots.
    for (const element of root.querySelectorAll("*")) {
      if (/^(SCRIPT|STYLE)$/.test(element.tagName) || !matches(element).length) continue;
      if (Array.from(element.children).some((child) => matches(child).length)) continue;
      if (!element.closest('[data-slot="count"]')) issues.push("unclassified-report-count");
    }
    for (const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],[id^="starter-title"]')) {
      const layers = new Set(Array.from(heading.querySelectorAll('[data-slot="count"]'))
        .map((count) => count.getAttribute("data-figure-class")));
      if (layers.size > 1) issues.push("mixed-count-headline");
    }
  }
  return [...new Set(issues)];
}
