import { describe, expect, it } from "vitest";
import {
  CLINICAL_GENES,
  matchTraitSuggestion,
  SEARCH_EXAMPLES,
} from "./search-guidance";

describe("CLINICAL_GENES", () => {
  it("covers the well-known hereditary-risk genes", () => {
    for (const gene of [
      "BRCA1",
      "BRCA2",
      "TP53",
      "MLH1",
      "MSH2",
      "APC",
      "PTEN",
      "PALB2",
      "ATM",
      "CHEK2",
    ]) {
      expect(CLINICAL_GENES.has(gene)).toBe(true);
    }
  });
});

describe("matchTraitSuggestion", () => {
  it("maps plain-English trait queries to report links", () => {
    const cases: [string, string][] = [
      ["eye color", "eye-color-herc2-rs12913832"],
      ["eyes", "eye-color-herc2-rs12913832"],
      ["alcohol", "alcohol-flush-aldh2-rs671"],
      ["caffeine", "caffeine-metabolism-cyp1a2-rs762551"],
      ["coffee", "caffeine-metabolism-cyp1a2-rs762551"],
      ["sleep", "sleep-duration-abcc9-rs11046205"],
      ["memory", "memory-plasticity-bdnf-rs6265"],
      ["lactose intolerance", "lactase-persistence-lct-rs4988235"],
      ["milk", "lactase-persistence-lct-rs4988235"],
      ["cilantro", "cilantro-soapy-taste-or6a2"],
      ["earwax", "earwax-type-abcc11"],
    ];
    for (const [query, slug] of cases) {
      const suggestion = matchTraitSuggestion(query);
      expect(suggestion, `query: ${query}`).not.toBeNull();
      expect(
        suggestion!.reports.map((r) => r.slug),
        `query: ${query}`,
      ).toContain(slug);
    }
  });

  it("matches partial typing of a keyword", () => {
    expect(matchTraitSuggestion("caffein")?.topic).toBe("caffeine");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(matchTraitSuggestion("  Eye Color ")?.topic).toBe("eye color");
  });

  it("returns null for gene-like and unknown queries", () => {
    expect(matchTraitSuggestion("PRODH")).toBeNull();
    expect(matchTraitSuggestion("CYP1A2")).toBeNull();
    expect(matchTraitSuggestion("zzzz-not-a-trait")).toBeNull();
    expect(matchTraitSuggestion("")).toBeNull();
    expect(matchTraitSuggestion("ab")).toBeNull();
  });
});

describe("SEARCH_EXAMPLES", () => {
  it("offers 2-3 example searches", () => {
    expect(SEARCH_EXAMPLES.length).toBeGreaterThanOrEqual(2);
    expect(SEARCH_EXAMPLES.length).toBeLessThanOrEqual(3);
  });
});
