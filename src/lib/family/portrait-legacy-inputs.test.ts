import { describe, expect, it } from "vitest";
import { getSubjectGenotypesByRsid, type Db } from "@/lib/genome/load";
import { resolveCarrierPair, type CarrierRefVariant } from "./carrier-pair";
import { readSubjectRuns } from "./roh";

type Row = Record<string, unknown>;
function file(id: string, subject = "a", marker: string | null = null): Row {
  return { id, subject_id: subject, status: "annotated", single_logical_sample_verified_at: marker,
    structural_validator_version: marker, source_sha256: marker,
    roh_status: "measured", roh_reason: null, roh_total_bases: 0, roh_covered_bases: 150000000, roh_fraction: 0 };
}
function database(files: Row[]) {
  const reads: { table: string; columns: string; ids: string[] }[] = [];
  const variants: Row[] = files.map(f => ({ file_id: f.id, subject_id: f.subject_id, rsid: 1,
    genotype: String(f.id).startsWith("legacy") ? "A/G" : "G/G" }));
  const db = { from: (table: string) => {
    let columns = "";
    const filters: ((row: Row) => boolean)[] = [];
    const query = {
      select: (value: string) => { columns = value; return query; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        const rows = (table === "genome_files" ? files : variants).filter(row => filters.every(filter => filter(row)));
        reads.push({ table, columns, ids: rows.map(row => String(row.id ?? row.file_id)) });
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return query;
  } } as unknown as Db;
  return { db, reads };
}
const reference: CarrierRefVariant[] = [{ rsid: 1, geneSymbol: "SYNTHETIC", alt: "G", clinvarSignificance: "Pathogenic" }];
const condition = [{ conditionId: "synthetic", conditionName: "Synthetic", geneSymbols: ["SYNTHETIC"], inheritanceMode: "autosomal_recessive" }];
const sides = [{ dataSubjectId: "a", displayLabel: "A" }, { dataSubjectId: "b", displayLabel: "B" }] as const;
const selection = { a: ["legacy-a"], b: ["legacy-b"] };

describe("Portrait exact legacy inputs", () => {
  it.each(["one", "both"])("keeps the same complete legacy result with canonical sources on %s sides", async count => {
    const legacy = [file("legacy-a"), file("legacy-b", "b")];
    const baseline = await resolveCarrierPair(database(legacy).db, ...sides, reference, condition, selection);
    const mixed = database([...legacy, file("canonical-a", "a", "verified"), ...(count === "both" ? [file("canonical-b", "b", "verified")] : [])]);
    expect(await resolveCarrierPair(mixed.db, ...sides, reference, condition, selection)).toEqual(baseline);
    expect(baseline.inputFileIds).toEqual({ a: ["legacy-a"], b: ["legacy-b"] });
    expect(baseline.runsInputFileIds).toEqual({ a: ["legacy-a"], b: ["legacy-b"] });
    expect(mixed.reads.flatMap(read => read.ids)).not.toContain("canonical-a");
    expect(mixed.reads.flatMap(read => read.ids)).not.toContain("canonical-b");
  });
  it("an explicit empty selection makes zero database reads for genotypes and ROH", async () => {
    const { db, reads } = database([file("legacy-a")]);
    expect((await getSubjectGenotypesByRsid(db, "a", [1], [])).genotypes.size).toBe(0);
    expect(await readSubjectRuns(db, "a", undefined, [])).toEqual([]);
    expect(reads).toEqual([]);
  });
  it.each(["foreign", "canonical", "partial-marker", "stored", "missing"])("rejects a selected %s file at the read boundary", async bad => {
    const row = file(bad, bad === "foreign" ? "b" : "a", bad === "canonical" ? "verified" : null);
    if (bad === "partial-marker") row.source_sha256 = "not-legacy";
    if (bad === "stored") row.status = "stored";
    const { db, reads } = database(bad === "missing" ? [] : [row]);
    const calls = await getSubjectGenotypesByRsid(db, "a", [1], [bad]);
    expect(calls.genotypes.size).toBe(0); expect(calls.checkedFileIds).toEqual([]);
    expect(await readSubjectRuns(db, "a", undefined, [bad])).toEqual([]);
    expect(reads.filter(read => read.table === "user_variants")).toEqual([]);
  });
  it("does not substitute another valid legacy file outside the captured selection", async () => {
    const { db } = database([file("legacy-a"), file("unselected")]);
    expect((await getSubjectGenotypesByRsid(db, "a", [1], ["legacy-a"])).checkedFileIds).toEqual(["legacy-a"]);
    const inputs = new Set<string>(); await readSubjectRuns(db, "a", inputs, ["legacy-a"]);
    expect([...inputs]).toEqual(["legacy-a"]);
  });
  it("retains the existing unrestricted annotated-file behavior when no selection is supplied", async () => {
    const { db } = database([file("legacy-a"), file("canonical", "a", "verified")]);
    expect((await getSubjectGenotypesByRsid(db, "a", [1])).checkedFileIds).toEqual(["legacy-a", "canonical"]);
    const inputs = new Set<string>(); await readSubjectRuns(db, "a", inputs);
    expect([...inputs]).toEqual(["legacy-a", "canonical"]);
  });
});
