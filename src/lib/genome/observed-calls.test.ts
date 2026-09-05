import { describe, expect, it } from "vitest";
import { observedVcfCall } from "./observed-calls";
import { parseVcf } from "./parsers/vcf";

const fields = "12\t111803962\trs671\tG\tA\t.\tPASS\t.\tGT:GQ:DP\t0/0:42:18".split("\t");
describe("literal observed calls", () => {
  it("retains direct reference evidence and source quality", () => {
    expect(observedVcfCall(fields, 12, 111803962, 7)).toMatchObject({
      rsid: 671, genotype: "G/G", sourceGt: "0/0", ref: "G", alt: "A", line: 7,
      genotypeQuality: 42, depth: 18, filter: "PASS", sampleFilter: null, quality: "pass", usable: true,
    });
  });
  it("missing optional quality stays unknown, not an invented threshold", () => {
    const f = [...fields]; f[6] = "."; f[8] = "GT"; f[9] = "0|0";
    expect(observedVcfCall(f, 12, 1, 1)).toMatchObject({ genotype: "G/G", quality: "unknown", genotypeQuality: null, depth: null, usable: true });
  });
  it.each(["./.", "0/.", "0", "0/0/0", "0//0", "0e0/0", "2/2"])("keeps unusable GT evidence without a finding: %s", (gt) => {
    const f = [...fields]; f[9] = gt;
    expect(observedVcfCall(f, 12, 1, 1)).toMatchObject({ genotype: "--", sourceGt: gt, usable: false });
  });
  it.each(["site", "sample"])("does not use explicitly failed %s quality", (kind) => {
    const f = [...fields];
    if (kind === "site") f[6] = "LowQual";
    else { f[8] = "GT:FT"; f[9] = "0/0:LowGQ"; }
    expect(observedVcfCall(f, 12, 1, 1)).toMatchObject({ quality: "failed", usable: false });
  });
  it.each(["<NON_REF>", "<*>", "A,<NON_REF>", "A,C", ".", "*", "AA"])("does not turn unsupported ALT %s into a reference finding", (alt) => {
    const f = [...fields]; f[4] = alt;
    expect(observedVcfCall(f, 12, 1, 1)).toBeNull();
  });
  it.each(["END=111803963", "SVLEN=2"])("does not infer a result from interval %s", (info) => {
    const f = [...fields]; f[7] = info;
    expect(observedVcfCall(f, 12, 1, 1)).toBeNull();
  });
  it("keeps variant and ROH arrays unchanged, with no observations from multi-sample input", async () => {
    async function* lines(samples: string) {
      yield "##reference=GRCh38";
      yield `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${samples}`;
      yield fields.join("\t");
    }
    const single = await parseVcf(lines("SAMPLE"));
    expect(single.records).toEqual([]);
    expect(single.referenceCalls).toEqual([{ chrom: 12, pos: 111803962, ref: "G", genotype: "G/G" }]);
    expect(single.observedCalls).toHaveLength(1);
    const multi = await parseVcf(lines("FIRST\tSECOND"));
    expect(multi.observedCalls).toEqual([]);
  });
});
