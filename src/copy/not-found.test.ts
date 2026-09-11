import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NOT_FOUND_HEADING,
  NOT_FOUND_LEAD,
  NOT_FOUND_LINKS,
  NOT_FOUND_NEXT,
  NOT_FOUND_WITHHELD,
} from "./not-found";

/**
 * Brief line 477 makes a 404 a privacy mechanism: after revocation, `GET` on
 * the family, portrait, export and Copilot-history surfaces must return 404
 * from every account that previously had access. So this copy is read by
 * someone whose access was withdrawn a moment ago, and the thing it must never
 * do is tell them apart from someone who mistyped a URL.
 */
const ALL = [NOT_FOUND_HEADING, NOT_FOUND_LEAD, NOT_FOUND_WITHHELD, NOT_FOUND_NEXT].join(" ");

describe("the not-found surface", () => {
  it("never confirms that the thing behind the link exists, or existed", () => {
    // Each of these would answer the question the 404 is there to refuse:
    // that there is a record, that it was someone's, or that it was removed.
    for (const leak of [
      "deleted", "revoked", "withdrew", "withdrawn", "removed", "no longer have",
      "used to", "previously", "your genome", "this person", "this subject",
      "access was", "permission was", "shared with you",
    ]) {
      expect(ALL.toLowerCase(), `"${leak}" would confirm what the 404 withholds`)
        .not.toContain(leak);
    }
  });

  it("names all three reasons together, so none of them is the answer", () => {
    // The refusal is only honest if the alternatives are stated as alternatives.
    expect(NOT_FOUND_LEAD).toMatch(/\bwrong\b/);
    expect(NOT_FOUND_LEAD).toMatch(/out of date/);
    expect(NOT_FOUND_LEAD).toMatch(/no longer be open to you/);
    expect(NOT_FOUND_WITHHELD).toMatch(/does not say which/);
  });

  it("keeps the first heading short and free of jargon", () => {
    expect(NOT_FOUND_HEADING.split(/\s+/)).toHaveLength(4);
    const jargon = JSON.parse(readFileSync("data/jargon.json", "utf8")) as
      | string[]
      | { terms?: string[]; words?: string[] };
    const terms = Array.isArray(jargon) ? jargon : (jargon.terms ?? jargon.words ?? []);
    expect(terms.length, "the jargon list must actually load, or this asserts nothing")
      .toBeGreaterThan(0);
    for (const term of terms) {
      expect(NOT_FOUND_HEADING.toLowerCase()).not.toContain(String(term).toLowerCase());
    }
  });

  it("links only to routes the register keeps, so this page cannot cause a 404 of its own", () => {
    // This is the assertion that earned its place: the first draft linked
    // `/legal/privacy`, which does not exist. The route is `/privacy`.
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
      routes: { path: string; kind: string; disposition: string }[];
    };
    const kept = new Set(
      register.routes
        .filter(route => route.kind === "page" && route.disposition === "kept")
        .map(route => route.path),
    );
    expect(kept.size, "the register must actually load").toBeGreaterThan(20);
    expect(NOT_FOUND_LINKS.length).toBeGreaterThan(0);
    for (const link of NOT_FOUND_LINKS) {
      expect(kept.has(link.href), `${link.href} (${link.label}) is not a kept page`).toBe(true);
    }
  });

  it("uses typographic apostrophes, never the straight kind", () => {
    expect(ALL).not.toContain("'");
  });
});
