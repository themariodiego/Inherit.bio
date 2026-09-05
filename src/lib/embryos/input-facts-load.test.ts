import { describe, expect, it, vi } from "vitest";
import { loadEmbryoInputFacts } from "./input-facts-load";
import { emptyReadCounts, INPUT_PROVENANCE_VERSION } from "@/lib/genome/input-provenance";
import type { Db } from "@/lib/genome/load";

describe("embryo source facts are exact and complete", () => {
  it.each(["missing", "error", "old", "complete"])("keeps upstream facts unknown with %s metadata", async (mode) => {
    const digest = "a".repeat(64), date = "2026-09-06T00:00:00.000Z";
    const filters: unknown[][] = [];
    const record = (id: string) => ({ id, file_type: "vcf", status: "annotated", processing_finished_at: date, input_source_sha256: digest,
      input_provenance: { version: INPUT_PROVENANCE_VERSION, sourceSha256: digest, completedAt: date, sourceBuild: "GRCh37", targetBuild: "GRCh38", buildBasis: "source-declared", chainSha256: "b".repeat(64), variantRowsMapped: 1, variantRowsUnmapped: 0, counts: emptyReadCounts() } });
    const db = { from: () => {
      let select = "";
      const q = { select: (value: string) => { select = value; return q; }, eq: (...args: unknown[]) => { filters.push(args); return q; }, in: () => q, order: () => q, limit: () => q,
        then: (resolve: (result: unknown) => void) => resolve(select === "id" ? { data: [{ id: "a" }, { id: "b" }] } : {
          data: mode === "missing" ? [record("a")] : [record("a"), { ...record("b"), status: mode === "old" ? "failed" : "annotated" }],
          error: mode === "error" ? { code: "unavailable" } : null,
        }),
      }; return q;
    } } as unknown as Db;
    expect(await loadEmbryoInputFacts(db, "cohort", "ordinal-subject")).toEqual({ coordinate_conversion: mode === "complete" ? "converted" : "not-recorded", source_origin: "external-unverified", source_imputation: "not-recorded", call_observation: "not-recorded" });
    expect(filters).toContainEqual(["cohort_id", "cohort"]);
    expect(filters).toContainEqual(["subject_id", "ordinal-subject"]);
    expect(filters).toContainEqual(["source_publication_state", "published"]);
  });
  it("reads nothing from another ordinal when no published source is found", async () => {
    const from = vi.fn(() => {
      const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [], error: null }) }; return q;
    });
    expect((await loadEmbryoInputFacts({ from } as unknown as Db, "cohort", "subject")).coordinate_conversion).toBe("not-recorded");
    expect(from).toHaveBeenCalledTimes(1);
  });
});
