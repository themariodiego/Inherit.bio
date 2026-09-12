import { describe, expect, it } from "vitest";
import jurisdictions from "../../../../data/jurisdictions.json";
import { resolveCapability } from "@/lib/legal/jurisdictions";

/**
 * `/embryo-analysis` is a public page that states a fact about the catalog:
 * "Not available in any production jurisdiction yet". The sentence is
 * committed prose, not a value read at render time, and that is the right
 * design for this page — it has no account to resolve, its register profile
 * forbids reading one (`zeroUserDataRule`), and under
 * `INHERIT_TEST_JURISDICTION=1` a resolver call would answer with the
 * TEST-LOCAL fixture row, which permits embryo analysis and is not a
 * production jurisdiction at all.
 *
 * What committed prose cannot do is stay true on its own. The moment a real
 * jurisdiction is signed off as permitting embryo analysis, the page keeps
 * saying it is available nowhere, and nothing else in the build notices —
 * exactly the failure `/settings/people` shipped for months, where a page
 * asserted a jurisdiction fact that no code was checking.
 *
 * So the claim is held here instead of being trusted. This is deliberately a
 * test rather than a runtime branch: a branch for a state no catalog can
 * currently produce would be unreachable code dressed as coverage, and G4.4
 * was opened by precisely that mistake elsewhere in this repository.
 */
describe("the public embryo-analysis page's jurisdiction claim", () => {
  const file = jurisdictions as unknown as {
    realJurisdictionCatalog: { codes: readonly string[] };
    realJurisdictions: Record<string, { capabilities: Record<string, { status: string }> } | undefined>;
  };

  /** Every production code the resolver can be asked about, plus "unset". */
  const productionCodes = [
    null,
    ...new Set([...file.realJurisdictionCatalog.codes, ...Object.keys(file.realJurisdictions)]),
  ];

  it("covers every committed real jurisdiction, not a sample", () => {
    // A floor guard: if the catalog were ever emptied or renamed, the loop
    // below would pass vacuously and the page's claim would go unchecked.
    expect(productionCodes.length).toBeGreaterThan(1);
    expect(file.realJurisdictionCatalog.codes.length).toBeGreaterThan(0);
  });

  it("holds the page's sentence: no production jurisdiction permits embryo analysis", () => {
    const permitted = productionCodes.filter(
      (code) => resolveCapability(code, "embryo_analysis", { testJurisdiction: false }).status === "permitted",
    );
    expect(
      permitted,
      "A production jurisdiction now permits embryo analysis, so /embryo-analysis must stop " +
        "saying it is available in none of them. Change the page's copy in the same commit " +
        "as the determination that permits it.",
    ).toEqual([]);
  });

  it("is asking about production, and the TEST-LOCAL fixture is deliberately excluded", () => {
    // Stated as an assertion rather than a comment, because it is the reason
    // the page does not call the resolver: with the acceptance flag on, the
    // fixture row answers `permitted` for any code at all.
    expect(resolveCapability(null, "embryo_analysis", { testJurisdiction: true }).status).toBe("permitted");
    expect(resolveCapability(null, "embryo_analysis", { testJurisdiction: true }).jurisdictionCode)
      .toBe("TEST-LOCAL");
  });
});
