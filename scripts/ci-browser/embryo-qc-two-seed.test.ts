import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkedQcSeed, fixtureHash, QC_SEEDS, verifyQcSeedPublications, type EmbryoQcSeedReceipt } from "./embryo-qc-two-seed";
import { embryoVcfChunks, validateEmbryoVcfChunk } from "../../src/lib/embryos/vcf-transport";
import { analyseEmbryoFragment, embryoOrdinalOutcome } from "../../src/lib/embryos/split-analysis";
import { syntheticQc } from "../../src/lib/embryos/synthetic";
import { figureText } from "../../src/lib/figures/figure-text";
import { coverageSpec, rateSpec } from "../../src/components/embryo/qc-figures";
import { EMBRYO_QC_CROSS_SURFACE } from "../../e2e/embryo-qc-cross-surface";
import { QC_FIELD_LABELS } from "../../src/copy/embryos/qc";
import { POSITIONS_READ_TH } from "../../src/copy/embryos/compare";
import type { CiBrowserShardReceipt } from "../ci-browser-shards";

const source = { head: "a".repeat(40), runId: "123", runAttempt: "2" };
const uuid = (n: number) => `07000000-0000-4000-8000-${n.toString().padStart(12,"0")}`;
const binding = { challenge: "s".repeat(43), revision: 1, build: "GRCh38" as const, sampleCount: 2, handles: ["h".repeat(43), "k".repeat(43)] };
async function outcomes(file: string) {
  const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([readFileSync(file)]), binding));expect(chunks).toHaveLength(1);
  const fragments = validateEmbryoVcfChunk(chunks[0], { ...binding, resolveHandle: handle => binding.handles.indexOf(handle) });
  return Promise.all(fragments.map(async fragment => {
    const measure = await analyseEmbryoFragment(new TextEncoder().encode(fragment.vcf), fragment.ordinal, "GRCh38", () => {});
    return embryoOrdinalOutcome(measure);
  }));
}
async function syntheticReceipt(seed: "a" | "b"): Promise<EmbryoQcSeedReceipt> {
  const result = await outcomes(QC_SEEDS[seed].fixture), offset = seed === "a" ? 0 : 10;
  const sources = result.map((row, ordinal) => ({ ordinal, subjectId: uuid(offset+ordinal+1), qc: syntheticQc({ ...row.qc,
    parent_a_concordance: null, parent_b_concordance: null, allelic_dropout_estimate: null, contamination_estimate: null }) }));
  const makeFigures = (surface: "compare" | "detail", only: typeof sources) => only.flatMap(row => EMBRYO_QC_CROSS_SURFACE.repeated.flatMap(field => {
    const spec = field.field === "coverage" ? coverageSpec(row.qc)! : rateSpec(row.qc,"autosomal_het_rate")!;
    const text = figureText(spec);
    return field[surface].flatMap(place => Array.from({length:place.count},()=>({ kind: spec.kind, figureClass: "quality" as const,
      basis: "observed" as const, provenance: "computed:embryos/split-analysis" as const, context: null, value: text.value,
      field: field.field, subjectId: row.subjectId, location: place.location, unit: text.unit,
      caption: place.caption === "positions-read" ? POSITIONS_READ_TH : QC_FIELD_LABELS[place.caption], modelledMarkers: [], exactMarkers: [] })));
  }));
  return checkedQcSeed({ schemaVersion: 1, ...source, seed, index: seed === "a" ? 6 : 5, total: 6,
    caseId: `${(seed === "a" ? "1" : "2").repeat(20)}-${"3".repeat(20)}:${QC_SEEDS[seed].project}`,
    ...QC_SEEDS[seed], fixtureSha256: fixtureHash(QC_SEEDS[seed].fixture), runtimeOwner: uuid(offset+3), cohortId: uuid(offset+4), publicationRevision: 1,
    sources, surfaces: [{ route: "/embryos/compare", ordinal: null, figures: makeFigures("compare",sources) },
      ...sources.map(row=>({ route: "/embryos/[embryoId]", ordinal: row.ordinal, figures: makeFigures("detail",[row]) }))] });
}
function syntheticCoverage(receipts: EmbryoQcSeedReceipt[]): CiBrowserShardReceipt[] {
  return receipts.map(row=>({ schemaVersion: 1, ...source, index: row.index, total: 6, fullCases: receipts.map(r=>r.caseId),
    assignedCases: [row.caseId], executedCases: [row.caseId], providerUploads: 1, fullFiles: receipts.map(r=>`e2e/${r.spec}`),
    timings: { setupMs: 1, buildMs: 1, bootstrapMs: 1, browserMs: 1 }, files: [{ file: row.spec, project: row.project, cases: [row.caseId], durationMs: 1 }] }));
}

describe("two genuine-input QC producer contracts; synthetic receipt-validation boundary", () => {
  it("measures both fixed call sets through the real sanitiser and parser, with every QC value moving and no invented lab metric", async () => {
    const a = await outcomes(QC_SEEDS.a.fixture), b = await outcomes(QC_SEEDS.b.fixture);
    expect(a.map(row=>row.qc.sites_called)).toEqual([1200,1188]);expect(b.map(row=>row.qc.sites_called)).toEqual([1188,1184]);
    for (let i=0;i<2;i++) {
      expect(a[i].outcome).toBe("passed");expect(b[i].outcome).toBe("passed");
      expect(b[i].qc.call_rate).not.toBe(a[i].qc.call_rate);expect(b[i].qc.autosomal_het_rate).not.toBe(a[i].qc.autosomal_het_rate);
      expect(b[i].qc.mean_depth).toBeNull();expect(b[i].qc.figure_basis.producer).toBe("embryo-split-calls-v1");
    }
    let ordinal = 0;
    const derived = readFileSync(QC_SEEDS.a.fixture,"utf8").split("\n").map(line => {
      if (line.startsWith("##source=")) return "##source=Inherit deterministic synthetic fixture; no real person; independent QC seed B; two synthetic embryos; fixed same GRCh38 loci";
      if (!line || line.startsWith("#")) return line;
      const columns = line.split("\t"), index = ordinal++;
      columns[9] = index % 100 === 0 ? "./." : index % 2 === 0 ? "0/1" : "0/0";
      columns[10] = index % 75 === 0 ? "./." : index % 4 === 0 ? "0/1" : "1/1";
      return columns.join("\t");
    }).join("\n");
    expect(readFileSync(QC_SEEDS.b.fixture,"utf8")).toBe(derived);
    const rows = (file: string) => readFileSync(file,"utf8").split("\n").filter(line=>line&&!line.startsWith("#")).map(line=>line.split("\t").slice(0,9));
    expect(rows(QC_SEEDS.b.fixture)).toEqual(rows(QC_SEEDS.a.fixture));
  });
  it("accepts only the complete saved-source/figure census bound to distinct passed native jobs", async () => {
    const receipts = await Promise.all([syntheticReceipt("a"),syntheticReceipt("b")]);
    expect(verifyQcSeedPublications(receipts,syntheticCoverage(receipts),source)).toMatchObject({ comparedFigures:16, comparedSurfaces:3, skips:0, retries:0 });
    for (const field of ["head","runId","runAttempt","runtimeOwner","cohortId","fixtureSha256","index"] as const) {
      const changed=structuredClone(receipts);Object.assign(changed[1],{[field]:field==="head"?"b".repeat(40):field==="runId"?"124":field==="runAttempt"?"1":changed[0][field]});
      expect(()=>verifyQcSeedPublications(changed,syntheticCoverage(receipts),source),field).toThrow();
    }
    for (const mutate of [(r: EmbryoQcSeedReceipt[])=>r.pop(), (r: EmbryoQcSeedReceipt[])=>r.push(r[0]),
      (r: EmbryoQcSeedReceipt[])=>{r[1].sources[0].subjectId=r[0].sources[0].subjectId;},
      (r: EmbryoQcSeedReceipt[])=>{r[1].surfaces[0].figures.pop();},
      (r: EmbryoQcSeedReceipt[])=>{r[1].surfaces[0].figures[0].value=r[0].surfaces[0].figures[0].value;},
      (r: EmbryoQcSeedReceipt[])=>{r[1].surfaces[0].figures[0].caption="wrong";},
      (r: EmbryoQcSeedReceipt[])=>{r[1].surfaces[0].figures[0].unit="wrong";}]) {
      const changed=structuredClone(receipts);mutate(changed);expect(()=>verifyQcSeedPublications(changed,syntheticCoverage(receipts),source)).toThrow();
    }
    for (const field of ["executedCases","assignedCases"] as const) {
      const coverage=syntheticCoverage(receipts);coverage[1][field]=[];
      expect(()=>verifyQcSeedPublications(receipts,coverage,source)).toThrow();
    }
    const coverage=syntheticCoverage(receipts);coverage[1].files[0].cases=[];
    expect(()=>verifyQcSeedPublications(receipts,coverage,source)).toThrow();
    expect(()=>checkedQcSeed({...receipts[0],rawCalls:"never copied"})).toThrow();
  });
  it("pins native saved receipts before revocation and the aggregate after full passed-case validation", () => {
    const original=readFileSync("e2e/embryo-ingest-journey.spec.ts","utf8");
    expect(original.indexOf('saveQcSeedReceipt("a"')).toBeLessThan(original.indexOf("await proveNativeDispositionAndProfile("));
    const second=readFileSync("e2e/embryo-qc-second-seed-journey.spec.ts","utf8");
    expect(second).toContain('from "./audited-test"');expect(second).toContain('await seedParticipantC(');
    expect(second).toContain('await withEmbryoJourney(');expect(second).toContain('saveQcSeedReceipt("b"');expect(second).toContain("test.setTimeout(300_000)");
    const aggregate=readFileSync("scripts/ci-browser-shards.run.mts","utf8");
    expect(aggregate).toContain("assert.equal(receipt.index, job.index");
    expect(aggregate.indexOf("verifyQcSeedPublications(seedReceipts, clean, source)")).toBeGreaterThan(aggregate.indexOf("verifyBrowserShards(manifest, receipts, source)"));
    expect(readFileSync(".github/workflows/ci.yml","utf8")).toContain("test-results/embryo-qc-seed.json");
  });
});
