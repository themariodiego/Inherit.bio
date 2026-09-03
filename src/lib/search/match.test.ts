import { describe, expect, it } from "vitest";
import {
  GROUP_ORDER,
  MAX_GROUPS,
  MAX_RESULTS_PER_GROUP,
  matchRank,
  normalise,
  rankCandidate,
  search,
  type SearchCandidate,
  type SearchGroupId,
} from "./match";

const LABELS: Record<SearchGroupId, string> = {
  people: "People and embryos",
  reports: "Reports",
  ancestry: "Ancestry regions",
  settings: "Settings",
};

function candidate(overrides: Partial<SearchCandidate> & { label: string }): SearchCandidate {
  return { group: "reports", href: `/genome/me/reports/${overrides.label}`, ...overrides };
}

describe("normalise", () => {
  it("lower-cases, strips accents and collapses whitespace", () => {
    expect(normalise("  Café   Au-Lait ")).toBe("cafe au-lait");
    expect(normalise("MAYA")).toBe("maya");
    expect(normalise("\tHeart\nand  circulation")).toBe("heart and circulation");
    expect(normalise("   ")).toBe("");
  });
});

describe("matchRank", () => {
  it("ranks whole, start, word-start and inside matches in that order", () => {
    expect(matchRank("caffeine", "caffeine")).toBe(0);
    expect(matchRank("caf", "caffeine metabolism")).toBe(1);
    expect(matchRank("meta", "caffeine metabolism")).toBe(2);
    expect(matchRank("tabol", "caffeine metabolism")).toBe(3);
  });

  it("returns null for no match and for empty input", () => {
    expect(matchRank("zzz", "caffeine")).toBeNull();
    expect(matchRank("", "caffeine")).toBeNull();
    expect(matchRank("caffeine", "")).toBeNull();
  });
});

describe("rankCandidate", () => {
  it("matches on the label and on hidden terms, preferring the label", () => {
    const byLabel = candidate({ label: "Caffeine metabolism", terms: ["CYP1A2"] });
    const byTerm = candidate({ label: "Coffee and sleep", terms: ["caffeine"] });
    expect(rankCandidate(byLabel, "caffeine")).toBe(1);
    expect(rankCandidate(byTerm, "caffeine")).toBe(0.5);
    expect(rankCandidate(byLabel, "cyp1a2")).toBe(0.5);
    expect(rankCandidate(byLabel, "food, drink")).toBeNull();
  });

  it("accepts a multi-word query whose words all appear somewhere", () => {
    const item = candidate({ label: "High blood pressure", terms: ["Heart and circulation"] });
    expect(rankCandidate(item, "heart pressure")).toBe(4);
    expect(rankCandidate(item, "heart lungs")).toBeNull();
  });
});

describe("search", () => {
  const people: SearchCandidate[] = [
    { group: "people", label: "Maya", href: "/genome/s-1", chip: "Shared with you" },
    { group: "people", label: "You", href: "/genome/me", chip: "You" },
    { group: "people", label: "Embryo 1", href: "/genome/s-2", chip: "Embryo" },
  ];
  const settings: SearchCandidate[] = [
    { group: "settings", label: "Settings", href: "/settings", terms: ["Settings"] },
    { group: "settings", label: "Your data", href: "/settings/data", terms: ["Settings", "Data"] },
  ];
  const reports: SearchCandidate[] = [
    candidate({ label: "Caffeine metabolism", chip: "You", terms: ["CYP1A2", "Food, drink and metabolism"] }),
    candidate({ label: "Lactase persistence", chip: "You", terms: ["LCT", "Food, drink and metabolism"] }),
  ];

  it("returns nothing for an empty or whitespace query", () => {
    expect(search([...people, ...reports], "", LABELS)).toEqual([]);
    expect(search([...people, ...reports], "   ", LABELS)).toEqual([]);
  });

  it("keeps the mandated group order and omits empty groups", () => {
    const groups = search([...settings, ...reports, ...people], "e", LABELS);
    expect(groups.map((group) => group.id)).toEqual(["people", "reports", "settings"]);
    expect(groups.map((group) => group.label)).toEqual([
      "People and embryos",
      "Reports",
      "Settings",
    ]);
    expect(search([...settings, ...reports, ...people], "settings", LABELS).map((g) => g.id)).toEqual([
      "settings",
    ]);
  });

  it("never returns more than eight results per group or more than four groups", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      candidate({ label: `Report ${index}`, chip: "You" }),
    );
    const groups = search(many, "report", LABELS);
    expect(groups).toHaveLength(1);
    expect(groups[0].results).toHaveLength(MAX_RESULTS_PER_GROUP);
    expect(MAX_RESULTS_PER_GROUP).toBe(8);
    expect(MAX_GROUPS).toBe(4);
    expect(GROUP_ORDER).toEqual(["people", "reports", "ancestry", "settings"]);
    expect(GROUP_ORDER).not.toContain("help");
  });

  it("ranks the better match first and keeps input order on ties", () => {
    const groups = search(
      [
        candidate({ label: "Sprint power", terms: ["ACTN3"] }),
        candidate({ label: "Muscle composition", terms: ["ACTN3"] }),
        candidate({ label: "ACTN3 and muscle" }),
      ],
      "actn3",
      LABELS,
    );
    expect(groups[0].results.map((result) => result.label)).toEqual([
      "Sprint power",
      "Muscle composition",
      "ACTN3 and muscle",
    ]);
  });

  it("carries the chip on subject-derived rows and omits it elsewhere", () => {
    const groups = search([...people, ...settings], "you", LABELS);
    const peopleGroup = groups.find((group) => group.id === "people")!;
    // The chip is never a match field: "Shared with you" does not surface Maya.
    expect(peopleGroup.results).toEqual([{ label: "You", href: "/genome/me", chip: "You" }]);
    expect(search(people, "maya", LABELS)[0].results).toEqual([
      { label: "Maya", href: "/genome/s-1", chip: "Shared with you" },
    ]);
    expect(search(people, "shared", LABELS)).toEqual([]);
    const settingsGroup = groups.find((group) => group.id === "settings")!;
    expect(settingsGroup.results).toEqual([{ label: "Your data", href: "/settings/data" }]);
    expect(Object.keys(settingsGroup.results[0])).toEqual(["label", "href"]);
  });

  it("returns destinations only: label, href and chip, never the hidden terms", () => {
    const groups = search(reports, "cyp1a2", LABELS);
    expect(groups).toHaveLength(1);
    for (const result of groups[0].results) {
      expect(Object.keys(result).sort()).toEqual(["chip", "href", "label"]);
      expect(result).not.toHaveProperty("terms");
    }
  });

  it("matches accented and differently cased input the same way", () => {
    const groups = search([{ group: "people", label: "Zoë", href: "/genome/s-3", chip: "Embryo" }], "ZOE", LABELS);
    expect(groups[0].results[0].label).toBe("Zoë");
  });
});
