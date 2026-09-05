import { describe, expect, it } from "vitest";
import { countText } from "@/components/reports/count";
import {
  DOMAIN_SECTIONS,
  ENTRY_BOXES,
  ESTIMATE_DEFINITION,
  EXAMPLE_ROUTES_AVAILABLE,
  NOT_DIAGNOSTIC,
  OVERVIEW_H1,
  PRIMARY,
  SPLIT_NOTE,
  START_HERE,
  STARTER,
  STATE_A_LEDE,
  STATE_B,
  STATE_C,
  STATE_D,
  STATE_E,
  startHereItems,
} from "./overview";
import { NAV_ITEMS, NAV_LABELS } from "./navigation";
import { ADD_A_FILE, KIND_CHIPS, LAYER_DEFINITIONS } from "./reports/strings";

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => allStrings(v, out));
  return out;
}

describe("navigation copy", () => {
  it("has exactly five items with the mandated labels and routes", () => {
    expect(NAV_ITEMS.map((item) => [item.label, item.href])).toEqual([
      ["Overview", "/overview"],
      ["My Genome", "/genome/me"],
      ["Family", "/family"],
      ["Embryos", "/embryos"],
      ["Settings", "/settings"],
    ]);
  });

  it("uses the nav label as the Overview h1 and the domain h2s", () => {
    expect(OVERVIEW_H1).toBe(NAV_LABELS.overview);
    expect(DOMAIN_SECTIONS.map((s) => s.heading)).toEqual(["My Genome", "Family", "Embryos"]);
  });
});

describe("overview copy", () => {
  it("ships the exact State A strings", () => {
    expect(STATE_A_LEDE).toBe(
      "Inherit is free to use and sells nothing. Sequencing, if you need it, is bought from a provider directly.",
    );
    expect(START_HERE.heading).toBe("Start here");
    expect(START_HERE.items.map((i) => [i.label, i.href])).toEqual([
      ["I have a DNA file", "/files/upload"],
      ["I don’t have one yet", "/providers"],
      ["Show me what this looks like first", "/example/report"],
    ]);
  });

  it("renders the example item only once its route exists", () => {
    const rendered = startHereItems();
    expect(rendered.some((i) => i.href === "/example/report")).toBe(EXAMPLE_ROUTES_AVAILABLE);
    expect(rendered.length).toBe(EXAMPLE_ROUTES_AVAILABLE ? 3 : 2);
  });

  it("defines nine boxes, three per domain, with one-line plain descriptions", () => {
    expect(ENTRY_BOXES).toHaveLength(9);
    for (const domain of ["my-genome", "family", "embryos"] as const) {
      expect(ENTRY_BOXES.filter((b) => b.domain === domain)).toHaveLength(3);
    }
    expect(ENTRY_BOXES.map((b) => b.label)).toEqual([
      "Reports",
      "Ancestry",
      "Copilot",
      "Individual risks",
      "Portrait",
      "Copilot",
      "Upload",
      "Compare your embryos",
      "Copilot",
    ]);
    for (const box of ENTRY_BOXES) {
      expect(words(box.description)).toBeLessThanOrEqual(12);
      expect(box.description).not.toMatch(/\n/);
      expect(box.description).toMatch(/\.$/);
    }
  });

  it("every domain lede is at least 80 characters of non-heading content", () => {
    for (const section of DOMAIN_SECTIONS) {
      expect(section.lede.length).toBeGreaterThanOrEqual(80);
    }
  });

  it("pluralises with explicit singular forms", () => {
    expect(STATE_E.filesAdded(1)).toBe("1 embryo file added");
    expect(STATE_E.filesAdded(4)).toBe("4 embryo files added");
    expect(STATE_E.passed(0)).toBe("0 passed the quality check");
    expect(STATE_E.notMeasured(2)).toBe("2 could not be measured");
    expect(STATE_D.more(2)).toBe("+2 more");
    // The split halves come from their one home, src/components/reports/count.tsx.
    expect(countText(151, "estimate")).toBe("151 statistical estimates");
    expect(countText(1, "estimate")).toBe("1 statistical estimate");
    expect(countText(1, "variant-call")).toBe("1 specific-variant report");
    expect(countText(12, "variant-call")).toBe("12 specific-variant reports");
    expect(STARTER.some(1)).toBe(
      "1 report to read first. It’s the clearest one your file supports.",
    );
    expect(STARTER.some(4)).toBe(
      "4 reports to read first. They’re the clearest ones your file supports.",
    );
    expect(STARTER.five).toBe(
      "Five reports to read first. They’re the clearest ones your file supports.",
    );
    expect(STARTER.none).toBe(
      "Your file doesn’t cover any of the starter reports. Browse the full library.",
    );
  });

  it("keeps the State B and C strings exact", () => {
    expect(STATE_B.processing("me.vcf")).toBe("Processing me.vcf");
    expect(STATE_B.timing("2 minutes", "9 minutes")).toBe(
      "Most files like this finish in about 2 minutes. Nine in ten finish within 9 minutes.",
    );
    expect(STATE_B.steps).toEqual([
      "Checking the file",
      "Reading your DNA spots",
      "Matching to the current map",
      "Building your reports",
      "Done",
    ]);
    expect(STATE_C.justYou).toBe("Just you so far.");
    expect(STATE_C.noEmbryoFiles).toBe("No embryo files added.");
    expect(STATE_C.ancestryTooFew).toBe(
      "Ancestry: your file covers too few markers to estimate regions.",
    );
    expect(STATE_C).not.toHaveProperty("ancestryFound");
    expect(SPLIT_NOTE).toBe("What studies found about DNA and traits.");
    expect(words(SPLIT_NOTE)).toBeLessThanOrEqual(12);
    expect(ESTIMATE_DEFINITION).toBe(LAYER_DEFINITIONS.estimate);
    expect(NOT_DIAGNOSTIC).toBe(
      "This is not a diagnosis. Inherit is not a doctor and no clinician has reviewed this. Talk to a qualified professional before acting on anything here.",
    );
  });

  it("reads every shared label from its one home", () => {
    expect(PRIMARY.haveFile).toBe("I have a DNA file");
    expect(PRIMARY.addFile).toBe("Add a file");
    expect(PRIMARY.addFile).toBe(ADD_A_FILE);
    expect(PRIMARY.openReports).toBe("Open my reports");
    expect(PRIMARY.compareEmbryos).toBe("Compare your embryos");
    expect(PRIMARY.compareEmbryos).toBe(
      ENTRY_BOXES.find((box) => box.id === "embryos.compare")?.label,
    );
    expect(STATE_E.compareEmbryos).toBe(PRIMARY.compareEmbryos);
    // The people list's kind chips are the subject bar's, not a second copy.
    expect(STATE_D).not.toHaveProperty("sharedWithYou");
    expect(KIND_CHIPS.adult_shared).toBe("Shared with you");
    expect(KIND_CHIPS.adult_uploaded).toBe("Uploaded with their permission");
  });

  it("uses typographic apostrophes and no placeholder tokens anywhere", () => {
    const strings = allStrings({
      STATE_A_LEDE,
      START_HERE,
      DOMAIN_SECTIONS,
      ENTRY_BOXES,
      STATE_B,
      STATE_C,
      STATE_D,
      STATE_E,
      STARTER,
      SPLIT_NOTE,
      NOT_DIAGNOSTIC,
    });
    expect(strings.length).toBeGreaterThan(30);
    for (const text of strings) {
      expect(text, text).not.toMatch(/'/);
      expect(text, text).not.toMatch(/\bN\/A\b|\bTBD\b|Coming soon|—$/);
    }
  });
});

describe("split-count notes", () => {
  it("keeps both metric notes within twelve words and the definitions adjacent from their home", async () => {
    const { SPLIT_NOTE, SPLIT_NOTE_VARIANT_CALL, ESTIMATE_DEFINITION, VARIANT_CALL_DEFINITION } = await import("./overview");
    const { LAYER_DEFINITIONS } = await import("./reports/strings");
    for (const note of [SPLIT_NOTE, SPLIT_NOTE_VARIANT_CALL]) {
      expect(note.split(/\s+/).length).toBeLessThanOrEqual(12);
      expect(note.split(/\s+/).length).toBeGreaterThanOrEqual(1);
    }
    expect(ESTIMATE_DEFINITION).toBe(LAYER_DEFINITIONS.estimate);
    expect(VARIANT_CALL_DEFINITION).toBe(LAYER_DEFINITIONS.variant_call);
  });
});
