import { describe, expect, it } from "vitest";
import * as carrier from "./carrier";
import * as healthPicture from "@/copy/family/health-picture";
import * as library from "@/copy/embryos/carrier-library";
import * as reports from "@/copy/reports/strings";
import { ANCESTRY_OFF, ANCESTRY_REPORTS_LINK } from "@/copy/ancestry";
import { REPORT_PREPARING } from "@/copy/genome/preparation";

/**
 * The own carrier page invents four plain sentences and reuses everything
 * else. The four are pinned here, and so is the reuse: a string re-exported
 * from its approved home is that string, not a respelling of it.
 */
describe("own carrier page copy", () => {
  it("pins the four new strings, each worded as the existing My Genome sentence for the same state", () => {
    expect(carrier.CARRIER_STATUS_H1).toBe("A change you carry");
    expect(carrier.CARRIER_STATUS_PREPARING_STATUS).toBe("A file is still being prepared. This check says what it covers once it is ready.");
    expect(carrier.CARRIER_STATUS_PREPARING_STATUS.replace("This check", "This report")).toBe(REPORT_PREPARING);
    expect(carrier.CARRIER_STATUS_OFF_STATUS).toBe(
      "The Observed genetic variants choice is off. You can turn it on under Reports, in Choose your reports.");
    expect(ANCESTRY_OFF.endsWith(" is off. You can turn it on under Reports, in Choose your reports.")).toBe(true);
    expect(carrier.CARRIER_STATUS_REPORTS_LINK).toBe(ANCESTRY_REPORTS_LINK);
  });

  it("reuses the approved carrier wording rather than respelling it", () => {
    expect(carrier.NO_CLASSIFIED_POSITIONS).toBe(healthPicture.NO_CLASSIFIED_POSITIONS);
    expect(carrier.CARRIER_LIMITS_HEADING).toBe(healthPicture.CARRIER_LIMITS_HEADING);
    expect(carrier.CARRIER_STATUS_READER).toBe(healthPicture.carrierPersonPrefix("You"));
    expect(carrier.CARRIER_LIBRARY_NOT_NEGATIVE).toBe(library.CARRIER_LIBRARY_NOT_NEGATIVE);
    expect(carrier.CARRIER_LIBRARY_REASONS).toBe(library.CARRIER_LIBRARY_REASONS);
    expect(carrier.NO_FILE_YET).toBe(reports.NO_FILE_YET);
    expect(carrier.NOT_DIAGNOSTIC).toBe(reports.NOT_DIAGNOSTIC);
    // Every own limit is one of the Family panel's, unchanged; only the one
    // about a change two people share is left out.
    expect(carrier.OWN_CARRIER_LIMITS.every(limit => healthPicture.CARRIER_LIMITS.includes(limit))).toBe(true);
    expect(healthPicture.CARRIER_LIMITS.filter(limit => !carrier.OWN_CARRIER_LIMITS.includes(limit)))
      .toEqual(["It reads only some positions in each gene. No shared change does not rule out that a child could be affected."]);
  });

  it("says nothing clinical: no chance, no pregnancy arithmetic, no advice", () => {
    const own = [carrier.CARRIER_STATUS_H1, carrier.CARRIER_STATUS_PREPARING_STATUS, carrier.CARRIER_STATUS_OFF_STATUS,
      carrier.CARRIER_STATUS_REPORTS_LINK].join(" ");
    expect(own).not.toMatch(/carrier|chance|risk|pregnan|child|%|\d/i);
  });
});
