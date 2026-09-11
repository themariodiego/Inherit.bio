import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MIN_MARKERS, PANEL } from "../ancestry/panel";
import {
  LINEAGE_CHROM, LINEAGE_KINDS, LINEAGE_TREE_SHA256,
  lineageMarkerPositions, treeOf, type LineageKind,
} from "../ancestry/lineage-panel";
import { AIMS, estimateAdmixture } from "../genome/admixture";
import { loadTree } from "../genome/haplogroups";
import { parseVcf } from "../genome/parsers/vcf";
import { computeOwnAncestryContent, ownAncestryContentSchema, CURRENT_OWN_ANCESTRY_PANEL, type OwnAncestryCall, type OwnAncestrySource } from "./own-ancestry-content";

const fileId = "77900000-0000-4000-8000-000000000040";
const source: OwnAncestrySource = { fileId, subjectId: "77900000-0000-4000-8000-000000000041",
  normalizedBuild: "GRCh38", callEncoding: "vcf-literal", sourceRevision: 1, sourceSha256: "a".repeat(64), normalizedAt: "2026-09-07T12:00:00.000Z" };
const panel = CURRENT_OWN_ANCESTRY_PANEL;
const compute = (calls: readonly OwnAncestryCall[]) => computeOwnAncestryContent({ source, panel, calls });
function call(index = 0, genotype = `${AIMS[index].ref}/${AIMS[index].alt}`): OwnAncestryCall {
  const m = AIMS[index];
  return { file_id: fileId, chrom: m.chrom, pos: m.pos38, ref: m.ref, alt: m.alt, genotype, usable: true };
}
/** A row as the lineage read returns it: at a real defining position of that
 * tree, on that tree's chromosome. */
function lineageRow(kind: LineageKind, index: number, genotype: string): OwnAncestryCall {
  return { file_id: fileId, chrom: LINEAGE_CHROM[kind], pos: lineageMarkerPositions(kind)[index],
    ref: "A", alt: "G", genotype, usable: true };
}
/** A defining position, and a base that is NEITHER of its tree alleles — so a
 * row carrying it is readable and still cannot enter the branch. Computed from
 * the shipped tree rather than written down, so an allele edit cannot make it
 * silently wrong. */
function foreignAllele(kind: LineageKind): { position: number; foreign: string } {
  for (const node of loadTree(kind === "mtdna" ? "mtDNA" : "Y")) {
    for (const marker of node.markers) {
      const foreign = ["A", "C", "G", "T"].find(base => base !== marker.anc && base !== marker.der);
      if (foreign) return { position: marker.pos, foreign };
    }
  }
  throw new Error("no tree marker leaves a third base free");
}
/** The state of a lineage nothing was read for. */
function unread(kind: LineageKind) {
  return { kind, state: "unavailable", reason: "no_supplied_positions", call: null,
    observedPositions: 0, readablePositions: 0, markerPositions: lineageMarkerPositions(kind).length,
    tree: { id: treeOf(kind).id, version: treeOf(kind).version, sha256: LINEAGE_TREE_SHA256[kind] } };
}
async function fixture(name: string) {
  const bytes = await readFile(`e2e/fixtures/${name}`);
  async function* lines() { yield* bytes.toString("utf8").split(/\r?\n/); }
  const parsed = await parseVcf(lines());
  expect(parsed.build).toBe("GRCh38");
  const calls: OwnAncestryCall[] = (parsed.observedCalls ?? []).map(row => ({ file_id: fileId, chrom: row.chrom,
    pos: row.pos, ref: row.ref, alt: row.alt, genotype: row.genotype, usable: row.usable }));
  return { calls, parsed, source: { ...source, sourceSha256: createHash("sha256").update(bytes).digest("hex") } };
}

describe("canonical own ancestry content prerequisite", () => {
  it("computes the existing shown fixture from actual literal observations, including reference calls", async () => {
    const input = await fixture("aims-mixed-grch38.vcf");
    expect(input.calls).toHaveLength(168);
    expect(input.parsed.records.length).toBeLessThan(input.calls.length);
    const result = computeOwnAncestryContent({ source: input.source, panel, calls: input.calls });
    expect(result.source).toEqual(input.source);
    expect(result.admixture).toMatchObject({ kind: "admixture", result_state: "available", coverage: 1,
      model_id: PANEL.id, model_version: PANEL.version, range: { unavailable: true }, basis: "modelled", resolution: "five-broad-regions" });
    expect(result.panelPositions).toEqual({ called: 168, missing: 0, noCall: 0, filtered: 0, conflicting: 0, unsupported: 0 });
    const lookup = new Map(input.calls.map(row => [`${row.chrom}:${row.pos}`, row.genotype]));
    expect(result.admixture.result).toEqual(estimateAdmixture((chrom, pos) => lookup.get(`${chrom}:${pos}`) ?? null));
    expect(result.admixture.result.proportions).toMatchInlineSnapshot(`
      {
        "AFR": 0.337,
        "AMR": 0.01,
        "EAS": 0.12,
        "EUR": 0.533,
        "SAS": 0,
      }
    `);
    expect(Object.values(result.admixture.result.proportions).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(computeOwnAncestryContent({ source: input.source, panel, calls: [...input.calls].reverse() })).toEqual(result);
  });

  it("keeps the existing grey fixture below threshold while retaining its one observed reference marker", async () => {
    const input = await fixture("tiny-grch38.vcf");
    expect(input.calls.length).toBeGreaterThan(0);
    const result = compute(input.calls);
    // rs671 at 12:111803962 is an explicit 0/0. The old process's variant-only
    // lookup omitted it; canonical observed calls correctly count it as 1/168.
    expect(input.calls.find(row => row.chrom === 12 && row.pos === 111803962)?.genotype).toBe("G/G");
    expect(result.admixture).toMatchObject({ result_state: "partial", coverage: 1 / 168, result: { markersUsed: 1 } });
    expect(result.panelPositions).toEqual({ called: 1, missing: 167, noCall: 0, filtered: 0, conflicting: 0, unsupported: 0 });
    expect(result.lineages).toEqual([unread("mtdna"), unread("ydna")]);
  });

  it("pins the exact current panel, threshold and a deterministic marker-content fingerprint", () => {
    const result = compute([]);
    expect(result.panel).toMatchObject({ id: "aims-kidd-seldin-168", version: "2026-08-28",
      provenance: "data/ref/AIMS_PROVENANCE.md", markerCount: 168, minimumMarkers: 42 });
    expect(result.panel.markerSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(compute([]).panel).toEqual(result.panel);
    expect(result.source).toEqual(source);
    expect(result.admixture).toMatchObject({ result_state: "not_covered", coverage: 0, result: { markersUsed: 0 } });
    expect(result.panelPositions.missing).toBe(168);
  });

  it.each([MIN_MARKERS - 1, MIN_MARKERS])("retains the current reliability boundary with %i usable markers", n => {
    const result = compute(AIMS.slice(0, n).map((_, i) => call(i)));
    expect(result.admixture.result_state).toBe(n < MIN_MARKERS ? "partial" : "available");
    expect(result.admixture.coverage).toBe(n / AIMS.length);
    expect(result.admixture.result.markersUsed).toBe(n);
  });

  it("does not count duplicate agreeing records twice or depend on allele order", () => {
    const first = call();
    const reversed = { ...first, genotype: first.genotype.split("/").reverse().join("|") };
    expect(compute([first, reversed])).toEqual(compute([first]));
  });

  it("excludes a conflict even when a later record would otherwise win", () => {
    const rows = [call(), call(0, `${AIMS[0].ref}/${AIMS[0].ref}`)];
    const result = compute(rows);
    expect(result.panelPositions).toMatchObject({ called: 0, conflicting: 1, missing: 167 });
    expect(result.admixture.result.markersUsed).toBe(0);
    expect(compute([...rows].reverse())).toEqual(result);
  });

  it("keeps an explicit no-call distinct from both missing and filtered positions", () => {
    const result = compute([{ ...call(), genotype: "--", usable: false }, { ...call(1), usable: false }]);
    expect(result.panelPositions).toEqual({ called: 0, missing: 166, noCall: 1, filtered: 1, conflicting: 0, unsupported: 0 });
    expect(result.admixture.coverage).toBe(0);
  });

  it("never lets a good duplicate erase no-call or filtered evidence", () => {
    expect(compute([call(), { ...call(), genotype: "--", usable: false }]).panelPositions.noCall).toBe(1);
    expect(compute([call(), { ...call(), usable: false }]).panelPositions.filtered).toBe(1);
  });

  it.each(["A", "0/0", "<NON_REF>", "A/A/A"])("does not reinterpret unsupported genotype %s", genotype => {
    const result = compute([{ ...call(), genotype }]);
    expect(result.panelPositions.unsupported).toBe(1);
    expect(result.admixture.result.markersUsed).toBe(0);
  });

  it("does not accept symbolic alleles or a genotype that disagrees with its literal REF/ALT", () => {
    expect(compute([{ ...call(), alt: "<NON_REF>" }]).panelPositions.unsupported).toBe(1);
    expect(compute([{ ...call(), genotype: "A/A" }]).panelPositions.unsupported).toBe(1); // first marker T/C
    const row = { ...call(), ref: null, alt: null, genotype: "A/C" };
    expect(computeOwnAncestryContent({ source: { ...source, callEncoding: "array-genotype" }, panel, calls: [row] })
      .panelPositions.unsupported).toBe(1); // neither direct nor complemented T/C pair
  });

  it("rejects a forward-reference third allele instead of complementing it into a panel signal", () => {
    expect(AIMS[0]).toMatchObject({ rsid: "rs2986742", chrom: 1, pos38: 6490316, ref: "T", alt: "C" });
    const result = compute([{ ...call(), ref: "T", alt: "G", genotype: "G/G" }]);
    expect(result.panelPositions).toMatchObject({ called: 0, unsupported: 1, missing: 167 });
    expect(result.admixture).toMatchObject({ result_state: "not_covered", coverage: 0, result: { markersUsed: 0 } });
  });

  it.each(["T/T", "T/C", "C/C"])("retains literal T/C-panel positive control %s", genotype => {
    const result = compute([call(0, genotype)]);
    expect(result.panelPositions).toMatchObject({ called: 1, unsupported: 0 });
    expect(result.admixture.result.markersUsed).toBe(1);
    expect(result.admixture.result).toEqual(estimateAdmixture((chrom, pos) => chrom === 1 && pos === 6490316 ? genotype : null));
  });

  it("refuses unknown or absent source encodings rather than guessing orientation", () => {
    for (const callEncoding of [undefined, "unknown"]) {
      const invalidSource = { ...source, callEncoding } as OwnAncestrySource;
      expect(() => computeOwnAncestryContent({ source: invalidSource, panel, calls: [call()] })).toThrow("ancestry_input_invalid");
    }
    expect(() => compute([{ ...call(), ref: null }])).toThrow("ancestry_call_encoding_mismatch");
    expect(() => compute([{ ...call(), alt: null }])).toThrow("ancestry_call_encoding_mismatch");
    expect(compute([{ ...call(), ref: "TT" }]).panelPositions.unsupported).toBe(1);
  });

  it("retains the old complement behavior only for explicitly identified array calls", () => {
    const array = computeOwnAncestryContent({ source: { ...source, callEncoding: "array-genotype" }, panel,
      calls: [{ ...call(), ref: null, alt: null, genotype: "G/G" }] });
    expect(array.admixture.result).toEqual(compute([call(0, "C/C")]).admixture.result);
    expect(array.panelPositions.called).toBe(1);
    expect(() => compute([{ ...call(), ref: null, alt: null, genotype: "G/G" }])).toThrow("ancestry_call_encoding_mismatch");
    expect(() => computeOwnAncestryContent({ source: { ...source, callEncoding: "array-genotype" }, panel,
      calls: [call()] })).toThrow("ancestry_call_encoding_mismatch");
  });

  it.each(LINEAGE_KINDS)("reads no lineage from %s rows that arrived on the admixture read", kind => {
    // The two reads are separate arguments on purpose. A lineage row that came
    // back from the AIMs read is not a lineage read, and counting it as one
    // would report positions the lineage panel never asked for.
    for (const genotype of ["A", "A/G", "A/A", "--"]) {
      const result = compute([{ ...call(), chrom: LINEAGE_CHROM[kind], pos: lineageMarkerPositions(kind)[0], genotype }]);
      expect(result.lineages.find(row => row.kind === kind)).toEqual(unread(kind));
      expect(JSON.stringify(result.lineages)).not.toContain("haplogroup");
    }
  });

  it.each(LINEAGE_KINDS)("tells %s positions it could not read apart from positions it never got", kind => {
    // A heterozygous or unreadable genotype on a haploid chromosome is a
    // position the file HAS. Reporting that as "no positions supplied" would
    // state something false about the person's file, so it has its own reason.
    for (const genotype of ["A/G", "--", "", "N", "A/", "AA", "./."]) {
      const result = computeOwnAncestryContent({ source, panel, calls: [],
        lineageCalls: [lineageRow(kind, 0, genotype)] });
      expect(result.lineages.find(row => row.kind === kind)).toMatchObject({
        state: "unavailable", reason: "no_readable_genotypes", observedPositions: 1, readablePositions: 0, call: null,
      });
    }
  });

  it.each(LINEAGE_KINDS)("reads %s bases but enters no branch on an allele the tree does not define", kind => {
    // Readable and matching nothing is a third fact, distinct from both of the
    // above: the walk needs positive derived evidence, so an allele that is
    // neither ancestral nor derived must not enter a branch.
    const { position, foreign } = foreignAllele(kind);
    for (const genotype of [foreign, `${foreign}/${foreign}`]) {
      const result = computeOwnAncestryContent({ source, panel, calls: [],
        lineageCalls: [{ ...lineageRow(kind, 0, genotype), pos: position }] });
      expect(result.lineages.find(row => row.kind === kind)).toMatchObject({
        state: "unavailable", reason: "no_branch_matched", observedPositions: 1, readablePositions: 1, call: null,
      });
    }
  });

  it.each(LINEAGE_KINDS)("refuses a %s row read at a position the tree does not define", kind => {
    const undefinedPosition = Math.max(...lineageMarkerPositions(kind)) + 1;
    expect(() => computeOwnAncestryContent({ source, panel, calls: [],
      lineageCalls: [{ ...lineageRow(kind, 0, "A"), pos: undefinedPosition }] })).toThrow("ancestry_lineage_locus_unexpected");
    expect(() => computeOwnAncestryContent({ source, panel, calls: [],
      lineageCalls: [{ ...lineageRow(kind, 0, "A"), chrom: 1, pos: AIMS[0].pos38 }] })).toThrow("ancestry_lineage_locus_unexpected");
  });

  it("does not let one lineage's rows decide the other's", () => {
    const result = computeOwnAncestryContent({ source, panel, calls: [], lineageCalls: [lineageRow("mtdna", 0, "A")] });
    expect(result.lineages.find(row => row.kind === "ydna")).toEqual(unread("ydna"));
    expect(result.lineages.find(row => row.kind === "mtdna")?.observedPositions).toBe(1);
  });

  it("drops a position two rows disagree at rather than picking one of them", () => {
    const { position, foreign } = foreignAllele("mtdna");
    const both = [{ ...lineageRow("mtdna", 0, foreign), pos: position },
      { ...lineageRow("mtdna", 0, foreign === "A" ? "C" : "A"), pos: position }];
    expect(computeOwnAncestryContent({ source, panel, calls: [], lineageCalls: both })
      .lineages.find(row => row.kind === "mtdna")).toMatchObject({
      observedPositions: 1, readablePositions: 0, reason: "no_readable_genotypes",
    });
  });

  it("refuses another file even if the foreign row is not a panel marker", () => {
    expect(() => compute([{ ...call(), file_id: "77900000-0000-4000-8000-000000000099", pos: 1 }])).toThrow("ancestry_source_mismatch");
  });

  it("rejects malformed source identity without echoing source data", () => {
    expect(() => computeOwnAncestryContent({ source: { ...source, sourceRevision: 0 }, panel, calls: [] })).toThrow("ancestry_input_invalid");
    expect(() => computeOwnAncestryContent({ source: { ...source, sourceSha256: "invalid" }, panel, calls: [] })).toThrow("ancestry_input_invalid");
  });

  it("refuses changed panel metadata, threshold, order or allele frequencies", () => {
    const changedMarkers = panel.markers.map((marker, i) => i ? marker : { ...marker, freqs: { ...marker.freqs, AFR: 0.99 } });
    for (const changed of [{ ...panel, id: "different" }, { ...panel, version: "later" },
      { ...panel, minimumMarkers: 1 }, { ...panel, markers: changedMarkers }, { ...panel, markers: [...panel.markers].reverse() }]) {
      expect(() => computeOwnAncestryContent({ source, panel: changed, calls: [] })).toThrow("ancestry_panel_mismatch");
    }
  });
});

describe("closed captured ancestry schema", () => {
  it("round trips zero, partial and full fixture results", async () => {
    const input = await fixture("aims-mixed-grch38.vcf");
    for (const content of [compute([]), compute([call()]), compute(input.calls)])
      expect(ownAncestryContentSchema.parse(content)).toEqual(content);
  });
  it("rejects panel drift, invented resolution and inconsistent coverage or lineage claims", () => {
    const content = compute([call()]);
    const mutations = [
      { ...content, panel: { ...content.panel, markerSha256: "b".repeat(64) } },
      { ...content, admixture: { ...content.admixture, resolution: "fine-regions" } },
      { ...content, admixture: { ...content.admixture, coverage: 1 } },
      { ...content, panelPositions: { ...content.panelPositions, called: 2 } },
      { ...content, lineages: [{ ...content.lineages[0], observedPositions: 1 }, content.lineages[1]] },
      { ...content, lineages: [{ ...content.lineages[0], haplogroup: "H" }, content.lineages[1]] },
    ];
    for (const mutation of mutations) expect(ownAncestryContentSchema.safeParse(mutation).success).toBe(false);
  });
});

/**
 * The whole point of the capability, proved from committed bytes rather than
 * from a hand-built genotype map: a real file, through the real parser, into
 * the real builder, produces the haplogroup the fixture was constructed to
 * carry. Before this change the canonical path could not reach a call at all,
 * so an assertion like this had nothing to assert against.
 */
describe("canonical lineage calls from the committed fixture", () => {
  async function lineageFixture() {
    const bytes = await readFile("e2e/fixtures/lineage-grch38.vcf");
    async function* lines() { yield* bytes.toString("utf8").split(/\r?\n/); }
    const parsed = await parseVcf(lines());
    expect(parsed.build).toBe("GRCh38");
    // The lineage read returns VARIANT rows, which is what carries the haploid
    // genotype. Mapped exactly as src/lib/uploads/own-report-execution.ts does.
    const lineageCalls: OwnAncestryCall[] = parsed.records
      .filter(row => row.chrom === 24 || row.chrom === 25)
      .map(row => ({ file_id: fileId, chrom: row.chrom, pos: row.pos, ref: row.ref, alt: row.alt,
        genotype: row.genotype, usable: true }));
    return { lineageCalls, source: { ...source, sourceSha256: createHash("sha256").update(bytes).digest("hex") } };
  }

  it("calls both lines, names the tree it read them against, and keeps the admixture half honest", async () => {
    const input = await lineageFixture();
    expect(input.lineageCalls.length).toBeGreaterThan(0);
    const result = computeOwnAncestryContent({ source: input.source, panel, calls: [], lineageCalls: input.lineageCalls });
    expect(result.schemaVersion).toBe(2);
    expect(result.computationRevision).toBe("own-ancestry-content-v2");

    // The expected calls are written out rather than imported from the
    // generator, so this fails if the fixture stops classifying.
    expect(result.lineages.map(row => row.kind)).toEqual(["mtdna", "ydna"]);
    expect(result.lineages[0]).toMatchObject({ state: "available", reason: null,
      tree: { id: "inherit-mtdna-curated-subset", version: "Build 17, Forensic Update 1a" },
      call: { haplogroup: "K1", path: ["L3", "N", "R", "U", "K", "K1"], matched: 17, tested: 17, support: "strong" } });
    expect(result.lineages[1]).toMatchObject({ state: "available", reason: null,
      tree: { id: "inherit-ydna-curated-subset", version: "2016 index (4 January 2016)" },
      call: { haplogroup: "I2", path: ["I", "I2"], matched: 4, tested: 4, support: "strong" } });

    // A file of lineage markers covers no AIMs, and the admixture half says so
    // rather than borrowing confidence from the lineage half.
    expect(result.admixture).toMatchObject({ result_state: "not_covered", coverage: 0, result: { markersUsed: 0 } });
    expect(ownAncestryContentSchema.parse(result)).toEqual(result);
  });

  it("reads no more positions than the file was asked for, and never more than the trees define", async () => {
    const input = await lineageFixture();
    const result = computeOwnAncestryContent({ source: input.source, panel, calls: [], lineageCalls: input.lineageCalls });
    for (const lineage of result.lineages) {
      expect(lineage.readablePositions).toBeLessThanOrEqual(lineage.observedPositions);
      expect(lineage.observedPositions).toBeLessThanOrEqual(lineage.markerPositions);
      expect(lineage.call?.tested).toBeLessThanOrEqual(lineage.readablePositions);
    }
  });

  it("loses the call, and says which line lost it, when the tree beneath it moves", async () => {
    // The digest is the protection a stored haplogroup cannot get from looking
    // wrong. Content pinned to one tree must not validate against another.
    const input = await lineageFixture();
    const result = computeOwnAncestryContent({ source: input.source, panel, calls: [], lineageCalls: input.lineageCalls });
    const moved = { ...result, lineages: [{ ...result.lineages[0],
      tree: { ...result.lineages[0].tree, sha256: "0".repeat(64) } }, result.lineages[1]] };
    expect(ownAncestryContentSchema.safeParse(moved).success).toBe(false);
  });
});
