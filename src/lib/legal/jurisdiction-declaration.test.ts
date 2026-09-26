import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import jurisdictionsJson from "../../../data/jurisdictions.json";
import {
  declarableCode,
  declarationChoices,
  isHostedDeployment,
  jurisdictionChoices,
  jurisdictionName,
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
