import { describe, expect, it } from "vitest";
import { PANEL, SOURCES } from "@/lib/ancestry/panel";
import { REGIONAL_SOURCES } from "@/lib/ancestry/regional-panel";
import * as copy from "./ancestry";
import { ANCESTRY_NOT_GENERATED, ANCESTRY_OFF, ANCESTRY_REPORTS_LINK, NOTHING_READ, subContinental } from "./ancestry";
import * as regional from "./regional-ancestry";

/**
 * The ancestry page was seen in production, on 26 September 2026, telling a
 * person whose file HAD been processed that there was nothing to show until
 * one was — they had turned Ancestry off — above a caption naming five
 * regions, when every current result has seven. These pin both halves.
 */
const FIVE = /\bfive\b/i;

describe("the ancestry page's reasons for showing nothing", () => {
  it("keeps the no-file sentence for the case it is true of", () => {
    expect(NOTHING_READ).toBe("Nothing to show until a file has been processed.");
  });

  it("says Ancestry is off, and where it is turned on, in the Reports page's own words", () => {
    expect(ANCESTRY_OFF).toBe("Ancestry is off. You can turn it on under Reports, in Choose your reports.");
    expect(ANCESTRY_REPORTS_LINK).toBe("Open Reports");
    // Not a variant of the no-file sentence: a file has been processed here.
    expect(ANCESTRY_OFF).not.toContain("processed");
    expect(ANCESTRY_OFF).not.toContain("Nothing to show");
  });

  it("says Ancestry is on and that the result comes from the generate step, without promising it is under way", () => {
    expect(ANCESTRY_NOT_GENERATED).toBe(
      "Ancestry is on. Your result appears here after you generate your selected reports under Reports.");
    // The step it names is the Reports section's own button, "Generate selected reports".
    expect(ANCESTRY_NOT_GENERATED).toMatch(/generate your selected reports/);
    // Nothing is running, so no word of progress or time.
    expect(ANCESTRY_NOT_GENERATED).not.toMatch(/prepar|progress|soon|minute|wait|being/i);
    expect(ANCESTRY_NOT_GENERATED).not.toContain("Nothing to show");
  });

  it("puts no region count in any of the sentences", () => {
    for (const sentence of [NOTHING_READ, ANCESTRY_OFF, ANCESTRY_NOT_GENERATED, ANCESTRY_REPORTS_LINK]) {
      expect(sentence).not.toMatch(/\b(five|seven|\d+)\b/i);
    }
  });
});

describe("which ancestry words may name five regions", () => {
  it("is exactly the historical five-region result's words, and nothing a new result or an empty page shows", () => {
    const named = Object.entries(copy)
      .filter(([, value]) => typeof value === "string" && FIVE.test(value))
      .map(([name]) => name)
      .sort();
    // Each renders only inside <AncestryRegions>, which the page uses for a
    // stored result captured under the historical five-region panel.
    expect(named).toEqual(["MAP_CAPTION", "MAP_LABEL", "RANGE_TEST_LIMIT", "RESOLUTION_LIMIT"]);
    expect(subContinental({ markers: PANEL.markers, version: PANEL.version })).toMatch(FIVE);
  });

  it("gives the seven-region surface, and the sources a page with no result lists, no five-region count", () => {
    for (const [name, value] of Object.entries(regional)) {
      if (typeof value === "string") expect(value, name).not.toMatch(FIVE);
    }
    for (const source of REGIONAL_SOURCES) expect(source.detail, source.id).not.toMatch(FIVE);
    // The historical list keeps its five-region map source; it is shown only beside a historical result.
    expect(SOURCES.some(source => FIVE.test(source.detail))).toBe(true);
  });
});
