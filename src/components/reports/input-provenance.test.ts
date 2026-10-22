import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COVERAGE_PROVENANCE, InputProvenance, type CoverageModule } from "./input-provenance";
import { EmbryoInputProvenance } from "../embryo/input-provenance";
import { UNKNOWN_EMBRYO_INPUT } from "@/lib/embryos/input-facts";
import { provenanceAttribute } from "@/lib/figures/contract";
import { emptyReadCounts } from "@/lib/genome/input-provenance";

describe("always-visible input provenance", () => {
  it("shows separate mixed-source facts without serialising hashes, file paths or IDs", () => {
    const html = renderToStaticMarkup(h(InputProvenance, { subject: { subjectId: "subject" }, sources: [
      { fileId: "private-file-a", fileType: "vcf", processedAt: null, snapshot: { sourceBuild: "GRCh37", targetBuild: "GRCh38", buildBasis: "source-declared", variantRowsMapped: 10, variantRowsUnmapped: 1, counts: { ...emptyReadCounts(), called: 9, noCall: 1, singleSample: true } } },
      { fileId: "private-file-b", fileType: "array_23andme", processedAt: null, snapshot: null, hasResultRecord: false },
    ], coverage: { read: 1, needed: 2 } }));
    expect(html).toContain('data-slot="input-provenance"');
    expect(html.match(/data-slot="input-source"/g)).toHaveLength(2);
    expect(html).toContain("changed genome coordinates");
    expect(html).toContain("were not recorded");
    expect(html).toContain("supplied no record");
    expect(html).toContain('data-provenance="computed:genome/input-provenance"');
    expect(html).toContain("read 1 of the 2 positions this needs");
    expect(html).toContain("calls in 9 of 10 listed, supported records");
    expect(html).not.toContain("read 9 of the 10 positions this needs");
    expect(html).toContain("not the share of your genome tested");
    expect(html.match(/data-figure-kind="coverage"/g)).toHaveLength(2);
    expect(html).not.toMatch(/<details|<summary|private-file|sha256|bucket_path/);
  });
  // `module` is a registered module name, not free text: the attribute can
  // only ever name a module that exists, whoever renders the coverage pair.
  it("resolves the coverage figure's module to the report's own, or to the caller's registered one", () => {
    const render = (coverage: { read: number; needed: number; module?: CoverageModule }) =>
      renderToStaticMarkup(h(InputProvenance, {
        subject: { subjectId: "subject" },
        sources: [{ fileId: "file", fileType: "vcf", processedAt: null, snapshot: null }],
        coverage,
      }));
    expect(render({ read: 1, needed: 2 })).toContain('data-provenance="computed:genome/reports"');
    expect(render({ read: 1, needed: 2, module: "genome/browser" })).toContain('data-provenance="computed:genome/browser"');
    // Exhaustive: every provenance the component can emit names a module.
    for (const [name, provenance] of Object.entries(COVERAGE_PROVENANCE)) {
      expect(render({ read: 1, needed: 2, module: name as CoverageModule }))
        .toContain(`data-provenance="${provenanceAttribute(provenance)}"`);
      expect(provenanceAttribute(provenance)).toBe(`computed:${name}`);
    }
  });

  it.each(["absent", "noCall", "conflict"] as const)("shows the honest %s state and does not hide it", (state) => {
    const html = renderToStaticMarkup(h(InputProvenance, { subject: { subjectId: "subject" }, state, sources: [{ fileId: "input", fileType: "vcf", processedAt: null, snapshot: null }] }));
    expect(html).not.toContain("<details");
    expect(html).toContain(state === "absent" ? "An absent call is not a negative result" : state === "noCall" ? "no usable call" : "records disagree");
  });
  it("does not fabricate laboratory history from the embryo no-imputation policy", () => {
    const html = renderToStaticMarkup(h(EmbryoInputProvenance, { facts: UNKNOWN_EMBRYO_INPUT }));
    expect(html).toContain("Whether the source did so is not known");
    expect(html).toContain("does not say if genome coordinates were changed");
    expect(html).not.toContain("<details");
  });
});

// G7.4, ADR 0038: a TEST-LOCAL source Inherit called from reads.
describe("input provenance for a source called from reads", () => {
  const readCalls = { version: "inherit-read-calls-v1", input: "BAM", minimumDepth: 10, minimumBaseQuality: 20,
    minimumMappingQuality: 20, heterozygousLow: 0.25, heterozygousHigh: 0.75, homozygousMinimum: 0.9, reviewed: false } as const;
  const snapshot = { sourceBuild: "GRCh38", targetBuild: "GRCh38", buildBasis: "source-declared", variantRowsMapped: 2,
    variantRowsUnmapped: 0, counts: { ...emptyReadCounts(), called: 3, noCall: 1, singleSample: true, buildClaim: true } } as const;
  const render = (sources: Parameters<typeof InputProvenance>[0]["sources"]) =>
    renderToStaticMarkup(h(InputProvenance, { subject: { subjectId: "subject" }, sources }));

  it("says plainly that Inherit called it from reads it did not create, with the thresholds, unreviewed", () => {
    const html = render([{ fileId: "read-called", fileType: "vcf", processedAt: null, snapshot: { ...snapshot, readCalls } }]);
    expect(html).toContain('data-slot="read-called-provenance"');
    expect(html).toContain("Inherit called these genotypes on your device from sequencing reads it did not create.");
    expect(html).toContain("VCF file · made by Inherit from BAM sequencing data");
    expect(html).toContain("Each position needed at least 10 counted reads. A read counted only with base quality 20 and mapping quality 20 or more.");
    expect(html).toContain("One changed copy needed 25 to 75 percent of the counted reads. Two changed copies, or none, needed 90 percent.");
    expect(html).toContain("These thresholds are engineering defaults. No scientist has reviewed them yet.");
    expect(html).not.toContain("Inherit did not create these files");
  });

  it("keeps the ordinary sentence for every other source beside it, and adds nothing to an ordinary source alone", () => {
    const mixed = render([{ fileId: "read-called", fileType: "vcf", processedAt: null, snapshot: { ...snapshot, readCalls } },
      { fileId: "ordinary", fileType: "vcf", processedAt: null, snapshot }]);
    expect(mixed).toContain("Inherit did not create these files");
    expect(mixed).toContain("Inherit called these genotypes on your device");
    expect(mixed.match(/data-slot="read-called-thresholds"/g)).toHaveLength(1);
    const ordinary = render([{ fileId: "ordinary", fileType: "vcf", processedAt: null, snapshot }]);
    expect(ordinary).toContain("Inherit did not create these files");
    expect(ordinary).not.toMatch(/read-called|made by Inherit|engineering defaults/);
  });
});
