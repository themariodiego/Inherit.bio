import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyReferenceWindows,
  checkConditionsAgainstClinGen,
  clinvarDate,
  extractText,
  importPayload,
  importStatements,
  isConflicting,
  namesCondition,
  parseClinGenCsv,
  parseVariantSummaryLine,
  pathogenicClass,
  readExtract,
  reviewStars,
  selectAssertions,
  validateConditions,
  variantSummaryIndex,
  verifyAssertions,
  verifyCommitted,
  type ConditionsFile,
  type Manifest,
  type StarterCondition,
} from "./build-carrier-assertions";
import { alleleShape, isLeftAligned, rightShiftedKeys } from "../src/lib/family/allele-key";

/**
 * The importer against a small pinned extract: 21 real lines of ClinVar's
 * 2026-09 monthly release (ten CFTR variations, both assemblies), the ClinGen
 * snapshot's own preamble with three curations, and two 101-base GRCh38
 * windows cut from the NCBI reference window the build read. See
 * scripts/fixtures/carrier/.
 */
const FIXTURES = path.join(process.cwd(), "scripts/fixtures/carrier");
const summary = readFileSync(path.join(FIXTURES, "variant_summary.sample.tsv"), "utf8").trimEnd().split("\n");
const index = variantSummaryIndex(summary[0]);
const rows = summary.slice(1).map((line) => parseVariantSummaryLine(index, line));
const windows = JSON.parse(readFileSync(path.join(FIXTURES, "reference-windows.json"), "utf8")) as {
  windows: { start: number; sequence: string }[];
};

const CF: StarterCondition = {
  conditionId: "MONDO:0009061",
  displayName: "Cystic fibrosis",
  gene: "CFTR",
  inheritanceMode: "autosomal_recessive",
  acmgTable: "Table 1",
  clingen: {
    diseaseLabel: "cystic fibrosis",
    classification: "Definitive",
    moi: "AR",
    classifiedOn: "2022-06-01",
    gcep: "General Gene Curation Expert Panel",
    url: "https://search.clinicalgenome.org/kb/gene-validity/CGGV:assertion_eb5b2eb1-e354-4e5a-ad5a-d0ee02805590-2022-06-01T040000.000Z",
  },
};

describe("exact allele keys", () => {
  it("keys single-letter changes and anchored insertions and deletions only", () => {
    expect(alleleShape("G", "T")).toBe("snv");
    expect(alleleShape("ATCT", "A")).toBe("deletion");
    expect(alleleShape("A", "ATC")).toBe("insertion");
    // A substitution of two letters, a complex change and a symbolic allele have
    // more than one spelling and are never keyed.
    expect(alleleShape("AA", "G")).toBeNull();
    expect(alleleShape("AG", "TC")).toBeNull();
    expect(alleleShape("A", "<DEL>")).toBeNull();
    expect(alleleShape("A", "A")).toBeNull();
  });

  it("tells a left-aligned indel from a right-shifted spelling of the same change", () => {
    // CFTR F508del: ClinVar's key and the spelling one base to the right.
    expect(isLeftAligned("ATCT", "A")).toBe(true);
    expect(isLeftAligned("TCTT", "T")).toBe(false);
    expect(isLeftAligned("A", "ATC")).toBe(true);
    expect(isLeftAligned("T", "TCT")).toBe(false);
  });

  it("lists every right-shifted spelling inside the repeat from the reference letters", () => {
    const [f508, dup] = windows.windows;
    expect(rightShiftedKeys({ chrom: 7, pos: 117_559_590, ref: "ATCT", alt: "A" }, f508)).toEqual([
      { chrom: 7, pos: 117_559_591, ref: "TCTT", alt: "T" },
    ]);
    expect(rightShiftedKeys({ chrom: 7, pos: 117_540_248, ref: "A", alt: "ATC" }, dup)).toEqual([
      { chrom: 7, pos: 117_540_249, ref: "T", alt: "TCT" },
      { chrom: 7, pos: 117_540_250, ref: "C", alt: "CTC" },
      { chrom: 7, pos: 117_540_251, ref: "T", alt: "TCT" },
      { chrom: 7, pos: 117_540_252, ref: "C", alt: "CTC" },
    ]);
    expect(rightShiftedKeys({ chrom: 7, pos: 117_559_594, ref: "T", alt: "G" }, f508)).toEqual([]);
    // Reference letters that disagree with the window are refused, never shifted.
    expect(() => rightShiftedKeys({ chrom: 7, pos: 117_559_590, ref: "GTCT", alt: "G" }, f508)).toThrow();
    // A key outside the window is an error, never a shorter answer.
    expect(() => rightShiftedKeys({ chrom: 7, pos: 117_559_700, ref: "A", alt: "G" }, f508)).toThrow();
  });
});

describe("ClinVar fields", () => {
  it("reads classifications, review stars, conflicts, dates and MONDO names exactly", () => {
    expect(pathogenicClass("Pathogenic")).toBe("Pathogenic");
    expect(pathogenicClass("Pathogenic/Likely pathogenic")).toBe("Pathogenic/Likely pathogenic");
    expect(pathogenicClass("Pathogenic; drug response")).toBe("Pathogenic");
    expect(pathogenicClass("Pathogenic; risk factor")).toBeNull();
    expect(pathogenicClass("Uncertain significance")).toBeNull();
    expect(pathogenicClass("Conflicting classifications of pathogenicity")).toBeNull();
    expect(reviewStars("practice guideline")).toBe(4);
    expect(reviewStars("reviewed by expert panel")).toBe(3);
    expect(reviewStars("criteria provided, multiple submitters, no conflicts")).toBe(2);
    expect(reviewStars("criteria provided, single submitter")).toBe(1);
    expect(() => reviewStars("criteria provided, many submitters")).toThrow(/unknown ClinVar review status/);
    expect(isConflicting({ classificationText: "Pathogenic", reviewStatus: "criteria provided, conflicting classifications" })).toBe(true);
    expect(clinvarDate("Mar 03, 2004")).toBe("2004-03-03");
    expect(clinvarDate("-")).toBeNull();
    expect(namesCondition("MONDO:MONDO:0009061,MedGen:C0010674|MONDO:MONDO:0008185", "MONDO:0009061")).toBe(true);
    expect(namesCondition("MONDO:MONDO:00090610,MedGen:C0010674", "MONDO:0009061")).toBe(false);
  });
});

describe("selection from the pinned extract", () => {
  const selected = selectAssertions([CF], rows);

  it("keeps exactly the assertions that meet the brief's bar, with both builds", () => {
    expect(selected.assertions.map((assertion) => assertion.variationId).sort((a, b) => a - b)).toEqual([7105, 7108, 7115, 7134]);
    const f508 = selected.assertions.find((assertion) => assertion.variationId === 7105)!;
    expect(f508).toMatchObject({
      conditionId: "MONDO:0009061",
      gene: "CFTR",
      name: "NM_000492.3(CFTR):c.1521_1523del (p.Phe508del)",
      classification: "Pathogenic",
      reviewStatus: "practice guideline",
      stars: 4,
      lastEvaluated: "2004-03-03",
      rsid: 113993960,
      grch38: { chrom: 7, pos: 117_559_590, ref: "ATCT", alt: "A" },
      grch37: { chrom: 7, pos: 117_199_644, ref: "ATCT", alt: "A" },
    });
  });

  it("counts every row it leaves out, by the first reason", () => {
    expect(selected.counts["MONDO:0009061"]).toEqual({
      grch38Rows: 10,
      imported: 4,
      excluded: {
        "not-pathogenic": 2,
        "not-germline": 2,
        "below-two-stars": 0,
        conflicting: 0,
        "condition-not-named": 1,
        "no-grch38-key": 0,
        "not-simple": 1,
        "not-left-aligned": 0,
        "assembly-disagreement": 0,
        "reference-mismatch": 0,
      },
    });
  });

  it("refuses a one-star label, whatever else it says", () => {
    const oneStar = rows.filter((row) => row.variationId === 983867).map((row) => ({ ...row, originSimple: "germline" }));
    const result = selectAssertions([CF], oneStar);
    expect(result.assertions).toEqual([]);
    expect(result.counts["MONDO:0009061"].excluded["below-two-stars"]).toBe(1);
  });

  it("round-trips through the committed extract format and its checks", () => {
    // A key on a build with no reference window stops the build; it is never
    // passed through unchecked.
    expect(() => applyReferenceWindows(selected.assertions.filter((assertion) => assertion.variationId === 7105),
      new Map([["CFTR:GRCh38", windows.windows[0]]]), structuredClone(selected.counts))).toThrow(/GRCh37 window/);
    // Only GRCh38 windows are pinned here (the full build checks both builds),
    // so the GRCh37 keys are dropped for the rest of this test.
    const assertions = selected.assertions.map((assertion) => ({ ...assertion, grch37: null, grch37Accession: null }));
    const windowed = applyReferenceWindows(assertions.filter((assertion) => assertion.variationId === 7105),
      new Map([["CFTR:GRCh38", windows.windows[0]]]), structuredClone(selected.counts));
    expect(windowed[0].grch38Equivalents).toEqual([{ chrom: 7, pos: 117_559_591, ref: "TCTT", alt: "T" }]);
    const text = extractText(windowed);
    const back = readExtract(JSON.parse(text));
    expect(back[0]).toMatchObject({ variationId: 7105, grch38Equivalents: windowed[0].grch38Equivalents });
    expect(() => verifyAssertions(back, [CF])).not.toThrow();
    expect(() => verifyAssertions([{ ...back[0], stars: 1, reviewStatus: "criteria provided, single submitter" }], [CF]))
      .toThrow();
  });
});

describe("ClinGen gene-disease validity", () => {
  const clingen = parseClinGenCsv(readFileSync(path.join(FIXTURES, "clingen.sample.csv"), "utf8"));

  it("reads the snapshot and its date", () => {
    expect(clingen.created).toBe("2026-09-28");
    expect(clingen.rows.map((row) => `${row.gene} ${row.moi} ${row.classification}`)).toEqual([
      "GJB2 AD Definitive",
      "ELP1 AR Moderate",
      "CFTR AR Definitive",
    ]);
  });

  it("accepts a starter condition only when the snapshot rates it Definitive or Strong for AR", () => {
    expect(() => checkConditionsAgainstClinGen([CF], clingen.rows)).not.toThrow();
    const elp1: StarterCondition = { ...CF, conditionId: "MONDO:0009131", gene: "ELP1", displayName: "Familial dysautonomia",
      clingen: { ...CF.clingen, diseaseLabel: "Riley-Day syndrome", classifiedOn: "2025-05-29",
        url: clingen.rows[1].url } };
    expect(() => checkConditionsAgainstClinGen([elp1], clingen.rows)).toThrow(/classification/);
    // A dominant curation is never read as the recessive one.
    const gjb2: StarterCondition = { ...CF, conditionId: "MONDO:0005365", gene: "GJB2" };
    expect(() => checkConditionsAgainstClinGen([gjb2], clingen.rows)).toThrow(/one autosomal recessive ClinGen curation/);
  });

  it("refuses a starter list that is not autosomal recessive or not at the bar", () => {
    const file = (conditions: unknown[]) => ({ schemaVersion: 1, status: "proposed", conditions } as ConditionsFile);
    expect(() => validateConditions(file([CF]))).not.toThrow();
    expect(() => validateConditions(file([{ ...CF, inheritanceMode: "x_linked" }]))).toThrow();
    expect(() => validateConditions(file([{ ...CF, clingen: { ...CF.clingen, classification: "Moderate" } }]))).toThrow();
    expect(() => validateConditions(file([CF, { ...CF, conditionId: "MONDO:0000001" }]))).toThrow(/one condition per gene/);
  });
});

describe("the committed extract", () => {
  it("matches its manifest and every offline invariant", async () => {
    await expect(verifyCommitted()).resolves.toEqual({ assertions: expect.any(Number), conditions: 8 });
  });

  it("emits one guarded import statement whose dry run differs only in its last line", () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "data/ref/carrier/manifest.json"), "utf8")) as Manifest;
    const conditions = JSON.parse(readFileSync(path.join(process.cwd(), "data/ref/carrier/conditions.json"), "utf8")) as ConditionsFile;
    const payload = importPayload(manifest, conditions.conditions, selectAssertions([CF], rows).assertions);
    expect(payload.release).toMatchObject({ releaseId: "clinvar-2026-09", source: "clinvar", sourcePublishedOn: "2026-09-03" });
    expect(payload.assertions.every((assertion) => assertion.conflict === false && assertion.reviewStars >= 2)).toBe(true);
    const { commit, dryRun } = importStatements(payload);
    expect(commit).toContain("public.import_clinical_assertion_release_v1(");
    const differ = commit.split("\n").filter((line, index) => line !== dryRun.split("\n")[index]);
    expect(differ).toEqual(["  -- Commit."]);
  });
});
