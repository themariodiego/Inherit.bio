import { describe, expect, it } from "vitest";
import jurisdictionsJson from "../../../data/jurisdictions.json";
import type { JurisdictionsFile } from "./jurisdictions";
import {
  EMBARGOED_COUNTRY_CODES,
  EU_EEA_COUNTRY_CODES,
  PAUSED_COUNTRY_CODES,
  declarationRestriction,
  isEmbargoedLocation,
} from "./service-restrictions";

const FILE = jurisdictionsJson as unknown as JurisdictionsFile;

describe("the service restriction lists", () => {
  it("name only catalogue countries, once each, and never one country twice", () => {
    const all = [...EMBARGOED_COUNTRY_CODES, ...PAUSED_COUNTRY_CODES];
    for (const code of all) expect(FILE.realJurisdictionCatalog.codes).toContain(code);
    expect(new Set(all).size).toBe(all.length);
  });

  it("hold the three embargoed countries", () => {
    expect([...EMBARGOED_COUNTRY_CODES].sort()).toEqual(["CU", "IR", "KP"]);
  });

  it("pause the 29 high-risk countries and the EU, EEA, UK and Swiss launch gate: 57 in all", () => {
    expect(EU_EEA_COUNTRY_CODES).toHaveLength(37);
    expect(new Set(EU_EEA_COUNTRY_CODES).size).toBe(37);
    for (const code of [...EU_EEA_COUNTRY_CODES, "GB", "CH", "RU", "CN", "IL", "AE", "AR", "CR"]) {
      expect(PAUSED_COUNTRY_CODES).toContain(code);
    }
    expect(PAUSED_COUNTRY_CODES).toHaveLength(57);
    for (const code of ["US", "CA", "JP", "BR", "IN", "GG", "JE", "GL", "FO", "AW"]) {
      expect(PAUSED_COUNTRY_CODES).not.toContain(code);
    }
  });
});

describe("isEmbargoedLocation", () => {
  it.each([
    ["CU", null], ["IR", ""], ["kp", null], ["UA", "43"], ["UA", "40"], ["ua", "14"], ["UA", "09"],
  ])("refuses a connection reported in %s / %s", (country, region) => {
    expect(isEmbargoedLocation(country, region)).toBe(true);
  });

  it.each([
    [null, null], ["", "43"], ["UA", null], ["UA", "30"], ["UA", "9"], ["RU", "43"], ["GB", "ENG"], ["US", "CA"],
  ])("serves a connection reported in %s / %s", (country, region) => {
    expect(isEmbargoedLocation(country, region)).toBe(false);
  });
});

describe("declarationRestriction", () => {
  it("never allows an embargoed country, even as the current answer, on any deployment", () => {
    for (const pausesApply of [true, false]) {
      expect(declarationRestriction("IR", null, pausesApply)).toBe("embargoed");
      expect(declarationRestriction("IR", "IR", pausesApply)).toBe("embargoed");
    }
  });

  it("allows keeping a paused country but not newly choosing one", () => {
    expect(declarationRestriction("RU", "RU", true)).toBeNull();
    expect(declarationRestriction("RU", null, true)).toBe("paused");
    expect(declarationRestriction("DE", "GB", true)).toBe("paused");
  });

  it("leaves the paused list to a deployment where it does not apply", () => {
    expect(declarationRestriction("RU", null, false)).toBeNull();
    expect(declarationRestriction("DE", "GB", false)).toBeNull();
  });

  it("allows any other catalogue country", () => {
    expect(declarationRestriction("US", null, true)).toBeNull();
    expect(declarationRestriction("JP", "FR", true)).toBeNull();
  });
});
