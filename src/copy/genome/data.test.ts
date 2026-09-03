import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fleschKincaidGrade,
  readabilitySentences,
  readabilityWords,
  wordCount,
} from "../../../scripts/readability";
import { DATA_AND_METHODS } from "../reports/strings";
import * as copy from "./data";

/** Every exported string, including those the exported functions produce. */
function corpus(): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const value of Object.values(copy)) {
    if (typeof value === "function") {
      walk((value as (...args: unknown[]) => string)("rs762551", "CYP1A2"));
      walk((value as (...args: unknown[]) => string)(762551, null));
    } else walk(value);
  }
  return out;
}

/** The strings the readability gate checks word by word against the plain vocabulary. */
function shortRoleStrings(): [string, string][] {
  return [
    ["DATA_H1", copy.DATA_H1],
    ["BROWSER_H1", copy.BROWSER_H1],
    ["SCORE_COVERAGE_HEADING", copy.SCORE_COVERAGE_HEADING],
    ["RESULTS_HEADING", copy.RESULTS_HEADING],
    ["REGION_HEADING", copy.REGION_HEADING],
    ["SEARCH_LABEL", copy.SEARCH_LABEL],
    ["SEARCH_BUTTON", copy.SEARCH_BUTTON],
    ["resultsLabel", copy.resultsLabel("rs762551")],
    ...Object.entries(copy.TABLE_HEADINGS).map(
      ([key, value]): [string, string] => [`TABLE_HEADINGS.${key}`, value],
    ),
    ...Object.entries(copy.IGV_CONTROL_LABELS).map(
      ([key, value]): [string, string] => [`IGV_CONTROL_LABELS.${key}`, value],
    ),
  ];
}

const VOCABULARY = new Set(
  (
    JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data/plain-vocabulary.json"), "utf8"),
    ) as { words: string[] }
  ).words,
);

describe("expert-path copy", () => {
  it("titles the data page with the words on the three entry links", () => {
    expect(copy.DATA_H1).toBe("Data and methods");
    expect(copy.DATA_H1).toBe(DATA_AND_METHODS);
    expect(copy.DATA_CRUMB).toBe("Data");
  });

  it("ships the browser headings and the pinned first-party sentence character-for-character", () => {
    expect(copy.BROWSER_H1).toBe("Genome browser");
    expect(copy.RESULTS_HEADING).toBe("Results");
    expect(copy.REGION_HEADING).toBe("Region");
    expect(copy.SEARCH_LABEL).toBe("Search variants");
    expect(copy.SEARCH_BUTTON).toBe("Search");
    expect(copy.FIRST_PARTY_NOTE).toBe(
      "This view uses only the DNA data stored in Inherit. It does not contact an outside genome service. The list of positions comes from this Inherit site.",
    );
    expect(copy.POSITIONS_BUILD).toBe("Positions are on GRCh38.");
    expect(Object.keys(copy.TABLE_HEADINGS)).toEqual(["variant", "position", "gene", "genotype"]);
  });

  it("builds the search states from their arguments", () => {
    expect(copy.resultsLabel("rs762551")).toBe("Results for rs762551");
    expect(copy.rsidNotCovered(762551, "CYP1A2")).toBe("Your file does not cover rs762551 (CYP1A2).");
    expect(copy.rsidNotCovered(1, null)).toBe("Your file does not cover rs1.");
    expect(copy.rsidUnknown(1)).toBe("rs1 is not in your file and not in the reference store.");
    expect(copy.noReferenceMatch("zzz").startsWith("No reference variants known for “zzz”.")).toBe(true);
    expect(
      copy.clinicalGeneStatus("BRCA1").startsWith("Inherit’s reference has no clinical variants for BRCA1. "),
    ).toBe(true);
    expect(copy.clinicalGeneStatus("BRCA1")).toMatch(/does not mean you are safe\.$/);
    expect(copy.lookingFor(copy.TRAIT_TOPICS.caffeine)).toBe(
      "Looking for caffeine? These reports cover it.",
    );
    expect(copy.resultsTruncated(200)).toBe("Only the first 200 positions are shown. Narrow the region to see the rest.");
  });

  it("names the track's controls without title tooltips and keeps the region's name", () => {
    expect(copy.IGV_CONTROL_LABELS.region).toBe("Interactive genome browser");
    expect(copy.IGV_CONTROL_LABELS.zoomIn).toBe("Zoom in");
    expect(copy.IGV_CONTROL_LABELS.zoomOut).toBe("Zoom out");
    expect(new Set(Object.values(copy.IGV_CONTROL_LABELS)).size).toBe(
      Object.keys(copy.IGV_CONTROL_LABELS).length,
    );
  });

  it("keeps every short-role string to registered plain words and never a forbidden term", () => {
    for (const [name, text] of shortRoleStrings()) {
      expect(text.toLowerCase(), name).not.toMatch(
        /allele|call rate|coverage fraction|liftover status|percentile/,
      );
      for (const word of readabilityWords(text).map((word) => word.toLowerCase())) {
        // The gate's placeholder for a `${…}` slot, and the rsID stem of the
        // argument: neither is copy.
        if (word === "fact" || word === "rs") continue;
        expect(VOCABULARY.has(word), `${name}: ${word}`).toBe(true);
      }
    }
  });

  it("uses typographic apostrophes, no sentence over 25 words and grade 9 or under", () => {
    for (const text of corpus()) {
      expect(text, text).not.toMatch(/[A-Za-z]'[A-Za-z]/);
      expect(text, text).not.toMatch(/\bN\/A\b|\bTBD\b|Coming soon/);
      for (const sentence of readabilitySentences(text)) {
        expect(wordCount(sentence), sentence).toBeLessThanOrEqual(25);
      }
      if (wordCount(text) >= 15) {
        expect(fleschKincaidGrade(text), text).toBeLessThanOrEqual(9);
      }
    }
  });
});
