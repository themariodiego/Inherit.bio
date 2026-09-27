import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import reference from "../../../data/ref/build-discriminating-sites.json";
import register from "../../../docs/route-register.json";
import { inferEmbryoTableBuild, type BuildPosition } from "./build-inference";
import { EMBRYO_INGEST_SESSION_LIMITS } from "./ingest-limits";

// Artificial coordinate sets assembled from reference metadata. No individual
// genome, public benchmark genotype or biological trait enters these tests.
const sites = reference.sites;
const points = (build: 37 | 38, selected = sites) => selected.map(site => ({ chrom: site[1], pos: site[build === 37 ? 2 : 3] }));
const contract = register.policyContracts["genome-build-inference-v1"];

describe("embryo laboratory-table build inference", () => {
  it("uses the registered bounds and accepts each complete reference coordinate set", () => {
    expect(contract.minimumDiscriminatingPositions).toBe(1000);
    expect(contract.acceptAgreementAtLeast).toBe(0.99);
    expect(inferEmbryoTableBuild(points(37))).toBe("GRCh37");
    expect(inferEmbryoTableBuild(points(38))).toBe("GRCh38");
  });

  it("requires 1,000 distinct compared positions and cannot inflate evidence with repeated embryo rows", () => {
    const short = points(37, sites.slice(0, 999));
    expect(inferEmbryoTableBuild(short)).toBe("decision-required");
    expect(inferEmbryoTableBuild([...short, ...short, ...short])).toBe("decision-required");
    expect(inferEmbryoTableBuild(points(37, sites.slice(0, 1000)))).toBe("GRCh37");
    expect(inferEmbryoTableBuild([])).toBe("decision-required");
    expect(Reflect.apply(inferEmbryoTableBuild, null, [short, { minimumDiscriminatingPositions: 1, acceptAgreementAtLeast: 0.1 }]))
      .toBe("decision-required");
  });

  it("accepts exactly 99% and refuses the position just below the threshold, for both builds", () => {
    for (const build of [37, 38] as const) {
      const other = build === 37 ? 38 : 37;
      const agreed = points(build, sites.slice(0, 990));
      const disagreed = points(other, sites.slice(990, 1000));
      expect(inferEmbryoTableBuild([...agreed, ...disagreed])).toBe(`GRCh${build}`);
      expect(inferEmbryoTableBuild([...points(build, sites.slice(0, 989)), ...points(other, sites.slice(989, 1000))]))
        .toBe("decision-required");
    }
  });

  it("does not stop on a convincing prefix before contradictory positions later in the input", () => {
    const mixed = [...points(37, sites.slice(0, 1000)), ...points(38, sites.slice(1000, 1020))];
    expect(inferEmbryoTableBuild(mixed)).toBe("decision-required");
    expect(inferEmbryoTableBuild(mixed.reverse())).toBe("decision-required");
    expect(inferEmbryoTableBuild([...points(37, sites.slice(0, 1000)), ...points(38, sites.slice(0, 1000))]))
      .toBe("decision-required");
  });

  it("treats out-of-reference coordinates as no evidence and never reads genetic values", () => {
    const unknown = Array.from({ length: 1100 }, (_, index) => ({ chrom: 1, pos: index + 1 }));
    expect(inferEmbryoTableBuild(unknown)).toBe("decision-required");
    const known = points(38, sites.slice(0, 1000)).map(point => Object.defineProperty(point, "genotype", {
      get() { throw new Error("The inference must not read a genotype"); },
    }));
    expect(inferEmbryoTableBuild([...unknown, ...known])).toBe("GRCh38");
  });

  it("excludes X, Y and mitochondrial rows from the autosomal comparison", () => {
    const excluded = [23, 24, 25].flatMap(chrom => Array.from({ length: 1000 }, (_, index) => ({ chrom, pos: index + 1 })));
    expect(inferEmbryoTableBuild(excluded)).toBe("decision-required");
    expect(inferEmbryoTableBuild([...points(37, sites.slice(0, 999)), ...excluded])).toBe("decision-required");
    expect(inferEmbryoTableBuild([...points(37, sites.slice(0, 1000)), ...excluded])).toBe("GRCh37");
  });

  it.each([{ chrom: 0, pos: 1 }, { chrom: 26, pos: 1 }, { chrom: 1.5, pos: 1 },
    { chrom: 1, pos: 0 }, { chrom: 1, pos: 1.5 }, { chrom: 1, pos: Number.MAX_SAFE_INTEGER + 1 }])(
    "fails closed on invalid canonical input %j", invalid => {
      expect(inferEmbryoTableBuild([...points(38, sites.slice(0, 1000)), invalid])).toBe("decision-required");
    },
  );

  it("bounds an endless stream even when none of its positions match", () => {
    let visits = 0;
    const endless: Iterable<BuildPosition> = { *[Symbol.iterator]() {
      for (;;) { visits++; yield { chrom: 1, pos: 1 }; }
    } };
    expect(inferEmbryoTableBuild(endless)).toBe("decision-required");
    expect(visits).toBe(EMBRYO_INGEST_SESSION_LIMITS.maximumLogicalRecords + 1);
  });
});
