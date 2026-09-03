import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWLIST_STATUS,
  CARRIER_ARITHMETIC_KEY,
  DENIED_KEY_PATTERNS,
  PORTRAIT_RESULT_TRAIT_KEY_FORBIDDEN,
  TRAIT_KEYS,
  isDeniedTraitKey,
  isTraitKey,
  listTraitEntries,
  readTraitAllowlist,
  traitEntry,
  traitStatus,
} from "./traits";

/**
 * The gate the brief names `traits.test.ts` (line 2304): the Portrait config
 * fails the build on any key outside the five (X10.1, line 2480), on any
 * denied key (line 1014), and on a registered entry without its citations
 * (line 1351). It reads the JSON file itself, not only the reader, so the
 * two cannot drift apart.
 */

const FILE = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data/family-trait-allowlist.json"), "utf8"),
) as {
  status: string;
  denied_key_patterns: string[];
  classes: Record<string, { kind: string; patterns: string[] }>;
  traits: Record<string, Record<string, unknown>>;
};

/** The brief's denied list (line 1014) and X10.1's two exclusions, as keys a config might try. */
const DENIED_KEYS = [
  "cognitive_ability",
  "intelligence",
  "iq",
  "educational_attainment",
  "height",
  "bmi",
  "weight",
  "personality",
  "temperament",
  "mental_health",
  "depression",
  "anxiety",
  "schizophrenia",
  "bipolar_disorder",
  "appearance_ranking",
  "attractiveness",
  "sex",
  "gender",
  "longevity",
  "lifespan",
  "athletic_ability",
  "eye_colour",
  "eye_color",
  "hair_colour",
  "hair_color",
  "success",
];

function withTrait(key: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    ...FILE,
    traits: {
      ...FILE.traits,
      [key]: { ...FILE.traits.abo, ...overrides },
    },
  };
}

describe("family trait allowlist", () => {
  it("is closed to exactly the five X10.1 keys, in the brief's order", () => {
    expect(Object.keys(FILE.traits)).toEqual([
      "abo",
      "rh",
      "red_hair",
      "lactase_persistence",
      "earwax",
    ]);
    expect([...TRAIT_KEYS]).toEqual(Object.keys(FILE.traits));
    for (const key of TRAIT_KEYS) expect(isTraitKey(key)).toBe(true);
    expect(isTraitKey("eye_colour")).toBe(false);
    expect(isTraitKey(CARRIER_ARITHMETIC_KEY)).toBe(false);
  });

  it("admits carrier arithmetic as a class, not a trait", () => {
    expect(FILE.classes[CARRIER_ARITHMETIC_KEY]).toMatchObject({
      kind: "arithmetic_not_trait",
      patterns: ["autosomal_recessive", "x_linked"],
    });
    expect(Object.keys(FILE.classes)).toEqual([CARRIER_ARITHMETIC_KEY]);
  });

  it("ships as a withheld registry: every trait unregistered, every source null", () => {
    expect(FILE.status).toBe("withheld_until_genotype_phenotype_tables_are_registered");
    expect(ALLOWLIST_STATUS).toBe(FILE.status);
    for (const key of TRAIT_KEYS) {
      expect(traitStatus(key)).toBe("unregistered");
      const entry = traitEntry(key);
      expect(entry.layer).toBe("variant_call");
      expect(entry.evidence).toBeNull();
      expect(entry.genotypePhenotypeTableCitationId).toBeNull();
      expect(entry.accuracyCitationId).toBeNull();
    }
    expect(listTraitEntries().map((entry) => entry.key)).toEqual([...TRAIT_KEYS]);
  });

  it("renders ABO and Rh as exact fractions and the other three as bands (X10.1)", () => {
    expect(traitEntry("abo").rendering).toBe("exact-fraction");
    expect(traitEntry("rh").rendering).toBe("exact-fraction");
    expect(traitEntry("red_hair").rendering).toBe("band-with-interval");
    expect(traitEntry("lactase_persistence").rendering).toBe("band-with-interval");
    expect(traitEntry("earwax").rendering).toBe("band-with-interval");
  });

  it("fails on any key outside the five", () => {
    expect(() => readTraitAllowlist(withTrait("bitter_taste"))).toThrow(/outside the closed list/);
    expect(() => readTraitAllowlist(withTrait("freckling"))).toThrow(/outside the closed list/);
  });

  it("fails on a missing key", () => {
    const traits = { ...FILE.traits } as Record<string, unknown>;
    delete traits.earwax;
    expect(() => readTraitAllowlist({ ...FILE, traits })).toThrow(/"earwax" is missing/);
  });

  it("fails on every denied key (brief line 1014; X10.1's eye and hair colour)", () => {
    for (const key of DENIED_KEYS) {
      expect(isDeniedTraitKey(key), key).toBe(true);
      expect(() => readTraitAllowlist(withTrait(key)), key).toThrow(/denied class|outside the closed list/);
    }
    for (const key of TRAIT_KEYS) expect(isDeniedTraitKey(key), key).toBe(false);
    expect(DENIED_KEY_PATTERNS).toEqual(FILE.denied_key_patterns);
    expect(DENIED_KEY_PATTERNS.length).toBeGreaterThanOrEqual(DENIED_KEYS.length - 6);
  });

  it("mirrors the portrait_results.trait_key check so no allowed key would be rejected by the table", () => {
    for (const key of TRAIT_KEYS) expect(PORTRAIT_RESULT_TRAIT_KEY_FORBIDDEN.test(key), key).toBe(false);
    expect(PORTRAIT_RESULT_TRAIT_KEY_FORBIDDEN.test(CARRIER_ARITHMETIC_KEY)).toBe(false);
    for (const word of ["intelligence", "cognitive", "iq", "education", "success"]) {
      expect(PORTRAIT_RESULT_TRAIT_KEY_FORBIDDEN.test(`child_${word}_score`)).toBe(true);
    }
  });

  it("fails on a registered entry lacking any citation or an evidence level", () => {
    const registered = {
      status: "registered",
      evidence: "established",
      genotype_phenotype_table_citation_id: "cit-table",
      accuracy_citation_id: "cit-accuracy",
    };
    expect(() => readTraitAllowlist(withTrait("abo", registered))).not.toThrow();
    expect(() =>
      readTraitAllowlist(withTrait("abo", { ...registered, genotype_phenotype_table_citation_id: null })),
    ).toThrow(/lacks a citation/);
    expect(() =>
      readTraitAllowlist(withTrait("abo", { ...registered, accuracy_citation_id: null })),
    ).toThrow(/lacks a citation/);
    expect(() => readTraitAllowlist(withTrait("abo", { ...registered, evidence: null }))).toThrow(
      /lacks a citation or an evidence level/,
    );
    expect(() =>
      readTraitAllowlist(withTrait("abo", { ...registered, genotype_phenotype_table_citation_id: "" })),
    ).toThrow(/non-empty citation id/);
  });

  it("refuses an entry that is not a variant call or claims an unknown status or rendering", () => {
    expect(() => readTraitAllowlist(withTrait("abo", { layer: "estimate" }))).toThrow(/variant_call/);
    expect(() => readTraitAllowlist(withTrait("abo", { status: "pending" }))).toThrow(/status/);
    expect(() => readTraitAllowlist(withTrait("abo", { rendering: "single-value" }))).toThrow(/rendering/);
    expect(() => readTraitAllowlist(withTrait("abo", { evidence: "anecdotal" }))).toThrow(/evidence/);
  });
});
