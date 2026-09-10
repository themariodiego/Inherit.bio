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
