import { describe, expect, it } from "vitest";
import { REGIONAL_AIMS } from "../genome/regional-admixture";
import { computeOwnAncestryContentV3, SEVEN_OWN_ANCESTRY_PANEL } from "./own-ancestry-content-v3";
import { computeOwnAncestryContentV4, ownAncestryContentV4Schema } from "./own-ancestry-content-v4";
import { ownAncestryCapturedContentSchema } from "./own-ancestry-captured-content";
import { capturedAncestryRows } from "../ancestry/captured-rows";

// Every call is invented from public panel positions, never a participant genome.
const fileId = "78840000-0000-4000-8000-000000000001";
const input = { source: { fileId, subjectId: "78840000-0000-4000-8000-000000000002",
  normalizedBuild: "GRCh38" as const, callEncoding: "vcf-literal" as const,
  sourceRevision: 1, sourceSha256: "a".repeat(64), normalizedAt: "2026-09-30T00:00:00Z" },
  calls: REGIONAL_AIMS.map(marker => ({ file_id: fileId, chrom: marker.chrom, pos: marker.pos38,
    ref: marker.ref, alt: marker.alt, genotype: `${marker.ref}/${marker.ref}`, usable: true })),
  panel: SEVEN_OWN_ANCESTRY_PANEL };

describe("classified ancestry capture", () => {
  it("captures the unchanged real computation and reads the saved basis", () => {
    const prior = computeOwnAncestryContentV3(input), current = computeOwnAncestryContentV4(input);
    expect(current.admixture).toEqual(prior.admixture);
    expect(current.panelPositions).toEqual(prior.panelPositions);
    expect(current.lineages).toEqual(prior.lineages);
    const saved = ownAncestryCapturedContentSchema.parse(JSON.parse(JSON.stringify(current)));
    expect(capturedAncestryRows(saved, "2026-09-30T01:00:00Z")[0]).toMatchObject({
      basis: current.figureBasis.shares.basis, coverageBasis: current.figureBasis.coverage.basis,
      result: current.admixture.result,
    });
  });
  it("keeps historical revision 3 and its already saved label unchanged", () => {
    const historical = computeOwnAncestryContentV3(input);
    const saved = ownAncestryCapturedContentSchema.parse(JSON.parse(JSON.stringify(historical)));
    expect(saved).toEqual(historical);
    expect(saved).not.toHaveProperty("figureBasis");
    const row = capturedAncestryRows(saved, "2026-09-30T01:00:00Z")[0];
    expect(row.basis).toBe(historical.admixture.basis);
    expect(row).not.toHaveProperty("coverageBasis");
  });
  it.each(["missing", "unknown_version", "shares_observed", "shares_exact", "coverage_modelled", "extra", "changed_old_basis"])("refuses %s instead of restoring a display literal", fault => {
    const saved = JSON.parse(JSON.stringify(computeOwnAncestryContentV4(input)));
    if (fault === "missing") delete saved.figureBasis;
    if (fault === "unknown_version") saved.figureBasis.shares.version = 2;
    if (fault === "shares_observed") saved.figureBasis.shares.basis = "observed";
    if (fault === "shares_exact") saved.figureBasis.shares.basis = "exact";
    if (fault === "coverage_modelled") saved.figureBasis.coverage.basis = "modelled";
    if (fault === "extra") saved.figureBasis.guess = "observed";
    if (fault === "changed_old_basis") saved.admixture.basis = "observed";
    expect(ownAncestryContentV4Schema.safeParse(saved).success).toBe(false);
    expect(ownAncestryCapturedContentSchema.safeParse(saved).success).toBe(false);
  });
});
