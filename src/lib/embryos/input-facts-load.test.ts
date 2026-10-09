import { describe, expect, it } from "vitest";
import { loadEmbryoInputFacts } from "./input-facts-load";
import { emptyReadCounts, INPUT_PROVENANCE_VERSION } from "@/lib/genome/input-provenance";
import type { Db } from "@/lib/genome/load";

type Rows = { data: unknown[] | null; error?: unknown };

/** A table-aware PostgREST double that records every filter per table. */
function fakeDb(answer: (table: string, select: string) => Rows) {
  const filters: Array<[string, ...unknown[]]> = [];
  const tables: string[] = [];
  const db = { from: (table: string) => {
    tables.push(table);
    let select = "";
    const q = {
      select: (value: string) => { select = value; return q; },
      eq: (...args: unknown[]) => { filters.push([table, ...args]); return q; },
      in: () => q, order: () => q, limit: () => q,
      then: (resolve: (result: unknown) => void) => resolve({ error: null, ...answer(table, select) }),
    };
    return q;
  } } as unknown as Db;
  return { db, filters, tables };
}
const theSubject = (table: string) => table === "subjects" ? { data: [{ id: "ordinal-subject" }] } : null;

describe("embryo source facts are exact and complete", () => {
  it.each(["missing", "error", "old", "complete"])("keeps upstream facts unknown with %s metadata", async (mode) => {
    const digest = "a".repeat(64), date = "2026-09-06T00:00:00.000Z";
    const record = (id: string) => ({ id, file_type: "vcf", status: "annotated", single_logical_sample_verified_at: null, processing_finished_at: date, input_source_sha256: digest,
      input_provenance: { version: INPUT_PROVENANCE_VERSION, sourceSha256: digest, completedAt: date, sourceBuild: "GRCh37", targetBuild: "GRCh38", buildBasis: "source-declared", chainSha256: "b".repeat(64), variantRowsMapped: 1, variantRowsUnmapped: 0, counts: emptyReadCounts() } });
    const { db, filters } = fakeDb((table, select) => theSubject(table) ?? (select.startsWith("id,build")
      ? { data: [{ id: "a", build: "GRCh37", canonical_build: null, structural_validator_version: null },
        { id: "b", build: "GRCh37", canonical_build: null, structural_validator_version: null }] }
      : { data: mode === "missing" ? [record("a")] : [record("a"), { ...record("b"), status: mode === "old" ? "failed" : "annotated" }],
        error: mode === "error" ? { code: "unavailable" } : null }));
    expect(await loadEmbryoInputFacts(db, "cohort", "ordinal-subject")).toEqual({ coordinate_conversion: mode === "complete" ? "converted" : "not-recorded", source_origin: "external-unverified", source_imputation: "not-recorded", call_observation: "not-recorded" });
    // The cohort is checked on the embryo's own subject; a file row names a
    // subject or a cohort, never both, so it is never filtered on both.
    expect(filters).toContainEqual(["subjects", "id", "ordinal-subject"]);
    expect(filters).toContainEqual(["subjects", "cohort_id", "cohort"]);
    expect(filters).toContainEqual(["genome_files", "subject_id", "ordinal-subject"]);
    expect(filters).toContainEqual(["genome_files", "source_publication_state", "published"]);
    expect(filters).not.toContainEqual(["genome_files", "cohort_id", "cohort"]);
  });

  it("reads nothing from another ordinal when no published source is found", async () => {
    const { db, tables } = fakeDb((table) => theSubject(table) ?? { data: [] });
    expect((await loadEmbryoInputFacts(db, "cohort", "ordinal-subject")).coordinate_conversion).toBe("not-recorded");
    expect(tables).toEqual(["subjects", "genome_files"]);
  });

  it("reads no file for a subject outside the cohort", async () => {
    const { db, tables } = fakeDb((table) => table === "subjects" ? { data: [] } : { data: [{ id: "a" }] });
    expect(await loadEmbryoInputFacts(db, "cohort", "another-cohorts-subject")).toEqual({ coordinate_conversion: "not-recorded",
      source_origin: "external-unverified", source_imputation: "not-recorded", call_observation: "not-recorded" });
    expect(tables).toEqual(["subjects"]);
  });

  it.each([
    ["GRCh38", "GRCh38", "not-needed"],
    ["GRCh37", "GRCh37", "not-recorded"],
  ])("finds a published %s canonical source and says only what it knows", async (build, canonical, expected) => {
    const { db, tables } = fakeDb((table) => theSubject(table) ?? { data: [{ id: "a", build, canonical_build: canonical,
      structural_validator_version: "embryo-ordinal-fragment-v1" }] });
    expect(await loadEmbryoInputFacts(db, "cohort", "ordinal-subject")).toEqual({ coordinate_conversion: expected,
      source_origin: "external-unverified", source_imputation: "not-recorded", call_observation: "not-recorded" });
    // Nothing reads processing provenance a canonical source never has.
    expect(tables).toEqual(["subjects", "genome_files"]);
  });

  it("claims nothing when a canonical source sits beside another kind of row", async () => {
    const { db } = fakeDb((table) => theSubject(table) ?? { data: [
      { id: "a", build: "GRCh38", canonical_build: "GRCh38", structural_validator_version: "embryo-ordinal-fragment-v1" },
      { id: "b", build: "GRCh38", canonical_build: null, structural_validator_version: null }] });
    expect((await loadEmbryoInputFacts(db, "cohort", "ordinal-subject")).coordinate_conversion).toBe("not-recorded");
  });
});
