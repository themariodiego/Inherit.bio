import type { ObservedSurface, ObservedText } from "./corpus";

export type DomSurfaceMetadata = Pick<ObservedSurface, "surface" | "channel" | "contentCommitSha" | "payloadSha256">;

/**
 * Browser-realm collector: pass directly to Playwright page.evaluate with metadata.
 * Caller binds payloadSha256 to captured renderer bytes and checks the independent
 * route/state inventory. This function neither generates nor verifies that digest.
 *
 * Claims use data-claim-id (data-claim alone is collected but fails the audit).
 * A primary data-citation-id and optional space-separated data-citation-ids must
 * have matching actual reference markers: sup[data-citation-id] containing a link,
 * or sup containing a[data-citation-id][href]. Only numeric reference-marker text
 * is excluded from prose. A citation-looking attribute never exempts normal text.
 *
 * All body DOM text is included, even collapsed/hidden disclosure, except script,
 * style and inert template contents. Inline text is joined before auditing numbers;
 * rendered HTML whitespace collapses but words, punctuation and NBSP are preserved.
 * Claim ownership excludes nested claim text, never silently duplicates it.
 * Chrome requires data-ui-chrome-kind; values require data-user-value. Neither a
 * class name nor the existing figure-layout data-claim-block proves a claim/chrome.
 * data-claim-region marks an explicitly inventoried prose scope. Text inherits
 * every enclosing region; unwrapped inline scopes split their containing block.
 * Ordinary outside navigation is still collected, never relabelled as chrome.
 *
 * Throws collect-dom:<reason>:<nodeId> on unsupported content or contradictory
 * contracts. Collectors must propagate this failure, not skip the surface. Frames,
 * shadow roots and CSS-generated text require separate adapters; canvas/image
 * meaning still requires the figure/text alternatives checked elsewhere.
 */
export function collectDomSurface(metadata: DomSurfaceMetadata): ObservedSurface {
  const root = document.body ?? document.documentElement;
  const result: ObservedSurface = { ...metadata, claims: [], figures: [], texts: [], claimRegions: [] };
  const claimSelector = "[data-claim],[data-claim-id]";
  const chromeKinds = ["item-count", "step", "pagination", "date", "file-size", "version"];
  const blockTags = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BUTTON", "CAPTION", "DD", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "LABEL", "LEGEND", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TD", "TH", "TR", "UL"]);
  const ignoredTags = new Set(["SCRIPT", "STYLE", "TEMPLATE"]);
  const elements: Element[] = [];
  const ids = new Map<Node, string>();
  const normalized = (value: string) => value.replace(/[ \t\r\n\f]+/g, " ").trim();
  const fail = (reason: string, node: Node): never => { throw new Error(`collect-dom:${reason}:${ids.get(node) ?? "root"}`); };
  const claimFor = (element: Element | null) => element?.closest(claimSelector) ?? null;
  const isReference = (element: Element): boolean => {
    if (element.tagName !== "SUP" || !/^\s*\[?\d+(?:\s*[,–-]\s*\d+)*\]?\s*$/.test(element.textContent ?? "")) return false;
    return (element.hasAttribute("data-citation-id") && !!element.querySelector("a[href]")) || !!element.querySelector("a[data-citation-id][href]");
  };
  const visit = (node: Node, path: string) => {
    ids.set(node, path);
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (ignoredTags.has(element.tagName)) return;
      if (element.tagName === "IFRAME" || element.tagName === "FRAME") fail("unsupported-frame", element);
      if (element.shadowRoot) fail("unsupported-shadow-root", element);
      for (const pseudo of ["::before", "::after"]) {
        const content = getComputedStyle(element, pseudo).content;
        if (content && !["none", "normal", '""', "''"].includes(content)) fail("unsupported-generated-text", element);
      }
      elements.push(element);
    }
    [...node.childNodes].forEach((child, index) => visit(child, `${path}.${index}`));
  };
  visit(root, "dom");
  for (const element of elements) if (element.hasAttribute("data-claim-region")) {
    const regionId = element.getAttribute("data-claim-region")!;
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(regionId)) fail("invalid-region", element);
    result.claimRegions.push({ regionId, nodeId: ids.get(element)! });
  }
  const regionsFor = (element: Element): string[] => {
    const regions: string[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (current.hasAttribute("data-claim-region")) regions.unshift(current.getAttribute("data-claim-region")!);
      if (current === root) break;
    }
    return [...new Set(regions)];
  };
  const references = new Set(elements.filter(isReference));
  const ownedText = (element: Element, owner: Element): string => {
    if (element !== owner && (element.matches(claimSelector) || element.hasAttribute("data-ui-chrome-kind") || element.hasAttribute("data-user-value"))) return "";
    if (ignoredTags.has(element.tagName) || references.has(element)) return "";
    if (element.tagName === "BR") return "\n";
    return [...element.childNodes].map((node) => node.nodeType === Node.TEXT_NODE ? node.textContent ?? "" :
      node.nodeType === Node.ELEMENT_NODE ? `${blockTags.has((node as Element).tagName) ? "\n" : ""}${ownedText(node as Element, owner)}${blockTags.has((node as Element).tagName) ? "\n" : ""}` : "").join("");
  };
  for (const element of elements) {
    const nodeId = ids.get(element)!;
    if (element.matches(claimSelector)) {
      const declared = [element.getAttribute("data-citation-id"), ...(element.getAttribute("data-citation-ids")?.split(/\s+/) ?? [])].filter((value): value is string => !!value);
      const actual: string[] = [];
      for (const ref of references) {
        if (claimFor(ref.parentElement) !== element) continue;
        const primary = ref.getAttribute("data-citation-id");
        if (primary) actual.push(primary);
        for (const link of ref.querySelectorAll("a[data-citation-id][href]")) actual.push(link.getAttribute("data-citation-id")!);
      }
      const citationIds = [...new Set(actual)];
      if (declared.some((value) => !citationIds.includes(value))) fail("missing-citation-reference", element);
      result.claims.push({ nodeId, claimId: element.getAttribute("data-claim-id") ?? "", text: normalized(ownedText(element, element)),
        citationIds, provenance: element.getAttribute("data-provenance") ?? "" });
    }
    if (element.hasAttribute("data-figure-kind")) result.figures.push({ nodeId, provenance: element.getAttribute("data-provenance") ?? "" });
  }
  const groups = new Map<string, { element: Element; parts: string[]; regionIds: string[]; nodeId: string }>();
  const ownerGroupCounts = new Map<Element, number>();
  const ownerFor = (element: Element): Element => {
    const boundary = element.closest(`${claimSelector},[data-ui-chrome-kind],[data-user-value],[data-figure-kind]`);
    if (boundary) return boundary.hasAttribute("data-figure-kind") ? claimFor(boundary) ?? boundary : boundary;
    for (let current: Element | null = element; current && current !== root; current = current.parentElement) if (blockTags.has(current.tagName)) return current;
    return root;
  };
  const append = (element: Element, value: string) => {
    const owner = ownerFor(element), regionIds = regionsFor(element);
    // A claim already binds one complete verbatim block. Its region set is the
    // union of the text it really owns, not an invented duplicate claim per span.
    const key = JSON.stringify([ids.get(owner), owner.matches(claimSelector) ? null : regionIds]);
    let group = groups.get(key);
    if (!group) {
      const index = ownerGroupCounts.get(owner) ?? 0;
      group = { element: owner, parts: [], regionIds: [], nodeId: `${ids.get(owner)}${index ? `:text:${index}` : ""}` };
      groups.set(key, group); ownerGroupCounts.set(owner, index + 1);
    }
    if (normalized(value)) group.regionIds = [...new Set([...group.regionIds, ...regionIds])];
    group.parts.push(value);
  };
  const collectText = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (ignoredTags.has(element.tagName) || references.has(element)) return;
      if (element.tagName === "BR") {
        append(element, "\n"); return;
      }
    }
    if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
      append(node.parentElement, node.textContent ?? "");
    }
    for (const child of node.childNodes) collectText(child);
  };
  collectText(root);
  // Use the same owned text for wrappers so nested markup never changes the
  // verbatim text binding between claim and complete-text observations.
  for (const element of elements.filter((e) => e.matches(claimSelector))) append(element, "");
  for (const { element, parts, regionIds, nodeId } of groups.values()) {
    const ownClaim = element.matches(claimSelector);
    const ancestorClaim = claimFor(element);
    const chrome = element.closest("[data-ui-chrome-kind]");
    const chromeKind = chrome?.getAttribute("data-ui-chrome-kind") ?? null;
    if (chrome && !chromeKinds.includes(chromeKind!)) fail("invalid-chrome-kind", chrome);
    const origin = element.getAttribute("data-provenance");
    const userValue = element.hasAttribute("data-user-value") || (element.hasAttribute("data-figure-kind") && /^(seed:|computed:)/.test(origin ?? ""));
    const value = normalized(ownClaim ? ownedText(element, element) : parts.join(""));
    if (!value && !ownClaim) continue;
    result.texts.push({ nodeId, text: value, regionIds,
      kind: chrome ? "ui-chrome" : userValue ? "user-value" : "content",
      chromeKind: chromeKind as ObservedText["chromeKind"],
      claimId: ownClaim || chrome ? ancestorClaim?.getAttribute("data-claim-id") ?? (ancestorClaim ? "" : null) : null, provenance: origin });
  }
  return result;
}
