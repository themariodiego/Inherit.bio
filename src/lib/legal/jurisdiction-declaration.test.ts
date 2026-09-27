import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import jurisdictionsJson from "../../../data/jurisdictions.json";
import {
  countriesWithSubdivisions,
  declarableCode,
  declarableSubdivision,
  declarationChoices,
  isHostedDeployment,
  jurisdictionChoices,
  jurisdictionName,
  subdivisionChoices,
  subdivisionName,
} from "./jurisdiction-declaration";
import type { JurisdictionsFile } from "./jurisdictions";
import { EMBARGOED_COUNTRY_CODES, PAUSED_COUNTRY_CODES } from "./service-restrictions";

const FILE = jurisdictionsJson as unknown as JurisdictionsFile;
const FLAG = { INHERIT_TEST_JURISDICTION: "1" } as const;

describe("jurisdiction choices", () => {
  const choices = jurisdictionChoices();

  it("offers exactly the catalogue, once each, named for reading", () => {
    expect(choices.map((choice) => choice.code).sort()).toEqual([...FILE.realJurisdictionCatalog.codes].sort());
    expect(new Set(choices.map((choice) => choice.code)).size).toBe(choices.length);
    expect(choices.find((choice) => choice.code === "GB")?.name).toBe("United Kingdom");
    expect(jurisdictionName("DE")).toBe("Germany");
  });

  it("is sorted by name, so no country is the first or default by position", () => {
    const names = choices.map((choice) => choice.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("never offers a test value, even with the acceptance flag on", () => {
    const codes = choices.map((choice) => choice.code);
    for (const value of FILE.productionPolicy.testPseudoJurisdictionValues) expect(codes).not.toContain(value);
  });
});

describe("declaration choices", () => {
  const codes = (current: string | null, pausesApply = true) =>
    declarationChoices(current, pausesApply).map((choice) => choice.code);
  const withheld = new Set([...EMBARGOED_COUNTRY_CODES, ...PAUSED_COUNTRY_CODES]);

  it("offers a new account on the hosted service the catalogue without embargoed or paused countries, still sorted", () => {
    expect(codes(null).sort()).toEqual(FILE.realJurisdictionCatalog.codes.filter((code) => !withheld.has(code)).sort());
    expect(codes(null)).toEqual(jurisdictionChoices().map((choice) => choice.code).filter((code) => !withheld.has(code)));
  });

  it("keeps a paused country only for the account that already declared it", () => {
    expect(codes("FR")).toContain("FR");
    expect(codes("FR")).not.toContain("DE");
    expect(codes("GB")).toContain("GB");
    expect(codes("US")).not.toContain("GB");
  });

  it("never offers an embargoed country, even to an account that declared it or off the hosted service", () => {
    for (const code of EMBARGOED_COUNTRY_CODES) {
      expect(codes(code)).not.toContain(code);
      expect(codes(code, false)).not.toContain(code);
    }
  });

  it("offers every other catalogue country where the paused list does not apply", () => {
    expect(codes(null, false).sort()).toEqual(
      FILE.realJurisdictionCatalog.codes.filter((code) => !EMBARGOED_COUNTRY_CODES.includes(code)).sort(),
    );
  });

  it("names a withheld country an account already declared", () => {
    expect(jurisdictionName("CU")).toBe("Cuba");
    expect(jurisdictionName("FR")).toBe("France");
  });
});

describe("isHostedDeployment", () => {
  it("is the platform's own marker, never an operator setting", () => {
    expect(isHostedDeployment({ VERCEL: "1" })).toBe(true);
    expect(isHostedDeployment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isHostedDeployment({})).toBe(false);
    expect(isHostedDeployment({ NEXT_PUBLIC_SITE_URL: "https://inherit.bio" })).toBe(false);
  });
});

describe("declarableCode", () => {
  it("accepts a catalogue country, normalised", () => {
    expect(declarableCode("GB", {})).toBe("GB");
    expect(declarableCode("  fr ", {})).toBe("FR");
  });

  it.each(["", "  ", "GBR", "G", "ZZ", "GB-ENG", "TEST-LOCAL", "TEST-DENY"])("refuses %j", (value) => {
    expect(declarableCode(value, {})).toBeNull();
    expect(declarableCode(value, FLAG)).toBeNull();
  });

  it("accepts the block-only fixture's stored code only under the acceptance flag", () => {
    expect(declarableCode("XX", {})).toBeNull();
    expect(declarableCode("XX", { INHERIT_TEST_JURISDICTION: "true" })).toBeNull();
    expect(declarableCode("xx", FLAG)).toBe("XX");
  });
});

describe("the attestation text", () => {
  const source = fs.readFileSync("content/legal/attestation.jurisdiction/v1.md", "utf8");
  const body = source.split("</section>")[1].trim();
  const summary = source.match(/<section data-legal-summary>\n([\s\S]*?)\n<\/section>/)?.[1].trim();

  it("binds the legal file body, its hash and the migration seed without a second copy", () => {
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    expect(source).toContain(`body_sha256: ${hash}`);
    const migration = fs.readFileSync("supabase/migrations/20260925140000_jurisdiction_declaration.sql", "utf8");
    expect(migration).toContain(`$artifact$${body}$artifact$`);
    expect(migration).toContain(`'${hash}'`);
    expect(migration).toContain(`'${summary}'`);
  });

  it("states the one thing confirmed and says the answer is never inferred", () => {
    expect(body).toContain("1. The country I chose is the country I live in.");
    expect(body).toMatch(/does not use your internet address, your browser language or your time zone/);
    expect(body).toMatch(/Your own DNA results do not depend on it/);
  });
});

describe("the United States state (ADR 0032, 27 Sep 2026)", () => {
  it("asks for a state in the United States only", () => {
    expect(countriesWithSubdivisions()).toEqual(["US"]);
    expect(subdivisionChoices("GB")).toEqual([]);
  });

  it("offers the 50 states and DC, named and sorted for reading", () => {
    const states = subdivisionChoices("US");
    expect(states).toHaveLength(51);
    expect(states.every((state) => /^US-[A-Z]{2}$/.test(state.code))).toBe(true);
    expect(states.map((state) => state.name)).toEqual([...states.map((state) => state.name)].sort((a, b) => a.localeCompare(b, "en")));
    expect(states.find((state) => state.code === "US-NY")?.name).toBe("New York");
    expect(states.find((state) => state.code === "US-DC")?.name).toBe("District of Columbia");
    expect(subdivisionName("US-CA")).toBe("California");
  });

  it("requires one committed state for the United States, normalised", () => {
    expect(declarableSubdivision("US", " us-ny ")).toEqual({ subdivision: "US-NY" });
    for (const raw of [undefined, null, "", "US-ZZ", "US-PR", "CA-ON", "NY", "US"]) {
      expect(declarableSubdivision("US", raw), String(raw)).toBe("invalid");
    }
  });

  it("refuses any state for a country that asks for none", () => {
    expect(declarableSubdivision("GB", undefined)).toEqual({ subdivision: null });
    expect(declarableSubdivision("GB", "")).toEqual({ subdivision: null });
    expect(declarableSubdivision("GB", "GB-ENG")).toBe("invalid");
    expect(declarableSubdivision("CA", "US-NY")).toBe("invalid");
  });
});

describe("the attestation text, version 2", () => {
  const source = fs.readFileSync("content/legal/attestation.jurisdiction/v2.md", "utf8");
  const body = source.split("</section>")[1].trim();
  const summary = source.match(/<section data-legal-summary>\n([\s\S]*?)\n<\/section>/)?.[1].trim();

  it("binds the legal file body, its hash and the migration seed without a second copy", () => {
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    expect(source).toContain(`body_sha256: ${hash}`);
    expect(source).toContain("version: 2");
    const migration = fs.readFileSync("supabase/migrations/20260927100000_jurisdiction_subdivision.sql", "utf8");
    expect(migration).toContain(`$artifact$${body}$artifact$`);
    expect(migration).toContain(`'${hash}'`);
    expect(migration).toContain(`'${summary}'`);
  });

  it("asks for the state in the United States and still says the answer is never inferred", () => {
    expect(body).toContain("If you live in the United States, you also tell Inherit which state.");
    expect(body).toContain("1. The place I chose is where I live.");
    expect(body).toMatch(/does not use your internet address, your browser language or your time zone/);
    expect(body).toMatch(/Your own DNA results do not depend on it/);
  });
});
