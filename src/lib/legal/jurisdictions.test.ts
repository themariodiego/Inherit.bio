import { describe, expect, it } from "vitest";
import jurisdictionsJson from "../../../data/jurisdictions.json";
import {
  CAPABILITY_STATUSES,
  JURISDICTION_CAPABILITIES,
  TEST_JURISDICTION_CODE,
  accountCapability,
  familyCapability,
  familyCapabilityFromCodes,
  isTestJurisdictionEnabled,
  normaliseJurisdictionCode,
  resolveCapability,
  strictestDecision,
  type CapabilityDecision,
  type JurisdictionsFile,
} from "./jurisdictions";

const FILE = jurisdictionsJson as unknown as JurisdictionsFile;
const DEFAULT_COPY = FILE.defaultRealJurisdiction.capabilities.family_portrait!.userFacingCopy;
const TEST_COPY = FILE.testJurisdictions[TEST_JURISDICTION_CODE]!.capabilities.family_portrait!.userFacingCopy;
const off = { testJurisdiction: false } as const;
const on = { testJurisdiction: true } as const;

/**
 * A synthetic register for the branches the committed file cannot reach yet
 * (it commits no real jurisdiction): one country with a signed decision, one
 * without its review, and one committed subdivision. The review object is a
 * placeholder for the runtime presence check only; the release gate, not
 * this module, validates the signed record.
 */
function synthetic(): JurisdictionsFile {
  const data = structuredClone(FILE);
  const permitted = (copy: string, review: unknown) => ({
    status: "permitted",
    governingInstruments: [],
    accessedOn: "2026-09-03",
    review,
    reason: "synthetic",
    userFacingCopy: copy,
  });
  const prohibited = (copy: string) => ({
    status: "prohibited",
    governingInstruments: [],
    accessedOn: "2026-09-03",
    review: { outcome: "approved" },
    reason: "synthetic",
    userFacingCopy: copy,
  });
  data.realJurisdictions = {
    GB: {
      capabilities: {
        family_portrait: permitted("GB permitted copy", { outcome: "approved" }),
        family_heritability: permitted("GB unsigned copy", null),
        carrier_match: prohibited("GB prohibited copy"),
      },
    },
    "GB-ENG": {
      displayName: "England",
      capabilities: {
        family_portrait: prohibited("England prohibited copy"),
      },
    },
  };
  return data;
}

describe("jurisdiction vocabulary", () => {
  it("mirrors the capabilities and statuses the register commits", () => {
    expect([...JURISDICTION_CAPABILITIES]).toEqual(FILE.capabilities);
    expect([...CAPABILITY_STATUSES].sort()).toEqual([...FILE.statusValues].sort());
    expect(TEST_JURISDICTION_CODE).toBe("TEST-LOCAL");
  });

  it("reads the test flag only as the exact string 1", () => {
    expect(isTestJurisdictionEnabled({ INHERIT_TEST_JURISDICTION: "1" })).toBe(true);
    expect(isTestJurisdictionEnabled({ INHERIT_TEST_JURISDICTION: "true" })).toBe(false);
    expect(isTestJurisdictionEnabled({})).toBe(false);
  });

  it("normalises codes by trimming and upper-casing, and reads blank as unset", () => {
    expect(normaliseJurisdictionCode(" gb ")).toBe("GB");
    expect(normaliseJurisdictionCode("")).toBeNull();
    expect(normaliseJurisdictionCode("   ")).toBeNull();
    expect(normaliseJurisdictionCode(null)).toBeNull();
    expect(normaliseJurisdictionCode(undefined)).toBeNull();
  });
});

describe("resolveCapability", () => {
  it("reads an unset code as unreviewed with the default copy", () => {
    for (const code of [null, undefined, "", "  "]) {
      expect(resolveCapability(code, "family_portrait", off)).toEqual({
        capability: "family_portrait",
        status: "unreviewed",
        userFacingCopy: DEFAULT_COPY,
        jurisdictionCode: null,
        source: "unset",
      });
    }
  });

  it("resolves a real country without an override to the default row", () => {
    const decision = resolveCapability("gb", "family_heritability", off);
    expect(decision.status).toBe("unreviewed");
    expect(decision.source).toBe("default");
    expect(decision.jurisdictionCode).toBe("GB");
    expect(decision.userFacingCopy).toBe(DEFAULT_COPY);
  });

  it("reads an unregistered or malformed code as unreviewed, never a nearby jurisdiction", () => {
    for (const code of ["XX", "GBR", "G1", "GB-", "US-CA"]) {
      const decision = resolveCapability(code, "family_portrait", off);
      expect(decision.status, code).toBe("unreviewed");
      expect(decision.source, code).toBe("unregistered");
    }
  });

  it("never reaches TEST-LOCAL through a stored code", () => {
    const decision = resolveCapability(TEST_JURISDICTION_CODE, "family_portrait", off);
    expect(decision.status).toBe("unreviewed");
    expect(decision.source).toBe("unregistered");
  });

  it("resolves every account to the TEST-LOCAL row under the flag", () => {
    for (const capability of JURISDICTION_CAPABILITIES) {
      const decision = resolveCapability("GB", capability, on);
      expect(decision, capability).toEqual({
        capability,
        status: "permitted",
        userFacingCopy: TEST_COPY,
        jurisdictionCode: TEST_JURISDICTION_CODE,
        source: "test-local",
      });
    }
    expect(resolveCapability(null, "carrier_match", on).status).toBe("permitted");
  });

  it("refuses an unknown capability", () => {
    expect(() =>
      resolveCapability("GB", "family_portrait_eye_colour" as never, off),
    ).toThrow(/Unknown jurisdiction capability/);
  });

  describe("against a synthetic register", () => {
    const data = synthetic();

    it("uses a signed country override", () => {
      const decision = resolveCapability("GB", "family_portrait", { ...off, data });
      expect(decision).toEqual({
        capability: "family_portrait",
        status: "permitted",
        userFacingCopy: "GB permitted copy",
        jurisdictionCode: "GB",
        source: "country",
      });
      expect(resolveCapability("GB", "carrier_match", { ...off, data }).status).toBe("prohibited");
    });

    it("reads a permitted decision without its signed review as unreviewed", () => {
      const decision = resolveCapability("GB", "family_heritability", { ...off, data });
      expect(decision.status).toBe("unreviewed");
      expect(decision.userFacingCopy).toBe(DEFAULT_COPY);
      expect(decision.source).toBe("country");
    });

    it("falls back to the default row for a capability the override omits", () => {
      const decision = resolveCapability("GB", "embryo_analysis", { ...off, data });
      expect(decision.status).toBe("unreviewed");
      expect(decision.source).toBe("default");
    });

    it("answers a committed subdivision from its own entry and never inherits", () => {
      const england = resolveCapability("gb-eng", "family_portrait", { ...off, data });
      expect(england.status).toBe("prohibited");
      expect(england.source).toBe("subdivision");
      expect(england.jurisdictionCode).toBe("GB-ENG");
      // GB permits family_heritability-less; England's entry lacks it, so it is unreviewed, not GB's answer.
      expect(resolveCapability("GB-ENG", "carrier_match", { ...off, data }).status).toBe("unreviewed");
      // An uncommitted subdivision of a committed country is unregistered.
      expect(resolveCapability("GB-SCT", "family_portrait", { ...off, data }).source).toBe("unregistered");
    });
  });
});

describe("strictestDecision", () => {
  const decision = (status: CapabilityDecision["status"], copy: string): CapabilityDecision => ({
    capability: "family_portrait",
    status,
    userFacingCopy: copy,
    jurisdictionCode: "GB",
    source: "country",
  });

  it("orders prohibited above unreviewed above permitted", () => {
    expect(strictestDecision([decision("permitted", "a"), decision("unreviewed", "b")]).status).toBe("unreviewed");
    expect(strictestDecision([decision("unreviewed", "a"), decision("prohibited", "b")]).status).toBe("prohibited");
    expect(strictestDecision([decision("prohibited", "a"), decision("permitted", "b")]).status).toBe("prohibited");
    expect(strictestDecision([decision("permitted", "a"), decision("permitted", "b")]).status).toBe("permitted");
  });

  it("keeps the first decision on a tie so the acting account's copy leads", () => {
    expect(strictestDecision([decision("unreviewed", "viewer"), decision("unreviewed", "other")]).userFacingCopy).toBe("viewer");
  });

  it("needs at least one decision", () => {
    expect(() => strictestDecision([])).toThrow(/at least one/);
  });
});

describe("familyCapabilityFromCodes (G5.1b)", () => {
  const data = synthetic();

  it("blocks a permitted actor when any contributor is unreviewed", () => {
    const decision = familyCapabilityFromCodes("GB", [null], "family_portrait", { ...off, data });
    expect(decision.status).toBe("unreviewed");
    expect(decision.source).toBe("unset");
    expect(decision.userFacingCopy).toBe(DEFAULT_COPY);
  });

  it("blocks a permitted actor when any contributor is prohibited", () => {
    const decision = familyCapabilityFromCodes("GB", ["GB", "GB-ENG"], "family_portrait", { ...off, data });
    expect(decision.status).toBe("prohibited");
    expect(decision.userFacingCopy).toBe("England prohibited copy");
  });

  it("permits only when the actor and every contributor are permitted", () => {
    expect(familyCapabilityFromCodes("GB", ["GB", "GB"], "family_portrait", { ...off, data }).status).toBe("permitted");
    expect(familyCapabilityFromCodes("GB", [], "family_portrait", { ...off, data }).status).toBe("permitted");
  });

  it("is permitted for everyone under the TEST-LOCAL flag", () => {
    expect(familyCapabilityFromCodes(null, [null, "XX"], "family_heritability", on).status).toBe("permitted");
  });
});

describe("familyCapability over accounts", () => {
  const codes = new Map<string, string | null>([
    ["viewer", "GB"],
    ["signed", "GB"],
    ["unset", null],
  ]);
  const calls: string[][] = [];
  const readJurisdictionCodes = async (ids: readonly string[]) => {
    calls.push([...ids]);
    return codes;
  };
  const data = synthetic();

  it("reads every account once and applies the strictest answer", async () => {
    calls.length = 0;
    const decision = await familyCapability("viewer", ["signed", "unset"], "family_portrait", {
      ...off,
      data,
      readJurisdictionCodes,
    });
    expect(calls).toEqual([["viewer", "signed", "unset"]]);
    expect(decision.status).toBe("unreviewed");
    expect(decision.source).toBe("unset");
  });

  it("permits when every account resolves permitted", async () => {
    const decision = await familyCapability("viewer", ["signed"], "family_portrait", {
      ...off,
      data,
      readJurisdictionCodes,
    });
    expect(decision.status).toBe("permitted");
    expect(decision.userFacingCopy).toBe("GB permitted copy");
  });

  it("reads a missing profile as unset", async () => {
    const decision = await accountCapability("nobody", "family_portrait", { ...off, data, readJurisdictionCodes });
    expect(decision).toMatchObject({ status: "unreviewed", source: "unset", jurisdictionCode: null });
  });

  it("resolves to TEST-LOCAL under the flag whatever the profiles say", async () => {
    const decision = await familyCapability("viewer", ["unset"], "family_portrait", {
      ...on,
      data,
      readJurisdictionCodes,
    });
    expect(decision.status).toBe("permitted");
    expect(decision.jurisdictionCode).toBe(TEST_JURISDICTION_CODE);
  });
});
