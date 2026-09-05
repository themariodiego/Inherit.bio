import { describe, expect, it, vi } from "vitest";
import { loadInputSources } from "./input-sources";
import { INPUT_PROVENANCE_VERSION, type InputProvenanceSnapshot } from "./input-provenance";
import type { Db } from "./load";

const SUBJECT = "authorized-subject";
const DIGEST = "a".repeat(64);
const FINISHED = "2026-09-06T00:00:00.000Z";
const SNAPSHOT: InputProvenanceSnapshot = {
  version: INPUT_PROVENANCE_VERSION,
  sourceSha256: DIGEST,
  completedAt: FINISHED,
  sourceBuild: "GRCh38",
  buildBasis: "source-declared",
  targetBuild: "GRCh38",
  chainSha256: null,
  variantRowsMapped: 12,
  variantRowsUnmapped: 2,
  counts: { called: 15, noCall: 3, unsupported: 2, failedFilter: 1, blocks: 4, singleSample: true, buildClaim: true },
};

function file(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, file_type: "vcf", status: "annotated", processing_finished_at: FINISHED,
    input_provenance: SNAPSHOT, input_source_sha256: DIGEST, ...overrides,
  };
}

function unknown(fileId: string) {
  return { fileId, fileType: "unknown", processedAt: null, snapshot: null };
}

type Response = { data: ReturnType<typeof file>[] | null; error?: { code: string } | null };
function database(respond: (ids: string[], page: number) => Response) {
  const queries: {
    table: string;
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
  }[] = [];
  const from = vi.fn((table: string) => {
    const page = queries.length;
    let selected: string[] = [];
    const query = {
      table,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn((_field: string, ids: string[]) => { selected = ids; return query; }),
      order: vi.fn().mockReturnThis(),
      then: (resolve: (response: Response) => void) => resolve(respond(selected, page)),
    };
    queries.push(query);
    return query;
  });
  return { db: { from } as unknown as Db, from, queries };
}

describe("authorized result input-source metadata", () => {
  it("does not query metadata when no result source IDs were requested", async () => {
    const { db, from } = database(() => ({ data: [] }));
    expect(await loadInputSources(db, SUBJECT, [])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("deduplicates and sorts requested IDs in exact subject-bound chunks of at most 100", async () => {
    const ids = Array.from({ length: 251 }, (_, i) => `source-${String(i).padStart(3, "0")}`);
    const { db, queries } = database((selected) => ({ data: selected.map((id) => file(id)) }));
    const result = await loadInputSources(db, SUBJECT, [...ids].reverse().concat(ids[0], ids[100]));
    expect(result.map((entry) => entry.fileId)).toEqual(ids);
    expect(queries).toHaveLength(3);
    for (const [page, query] of queries.entries()) {
      expect(query.table).toBe("genome_files");
      expect(query.select.mock.calls).toEqual([["id,file_type,status,processing_finished_at,input_provenance,input_source_sha256"]]);
      expect(query.eq.mock.calls).toEqual([["subject_id", SUBJECT]]);
      expect(query.in.mock.calls).toEqual([["id", ids.slice(page * 100, (page + 1) * 100)]]);
      expect(query.order.mock.calls).toEqual([["id"]]);
    }
  });

  it("retains every requested source as unknown when metadata retrieval fails", async () => {
    const { db } = database(() => ({ data: [file("a")], error: { code: "unavailable" } }));
    expect(await loadInputSources(db, SUBJECT, ["b", "a", "a"]))
      .toEqual([unknown("a"), unknown("b")]);
  });

  it("does not discard successful earlier chunks when the later metadata chunk fails", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `source-${String(i).padStart(3, "0")}`);
    const { db } = database((selected, page) => page === 0
      ? { data: selected.map((id) => file(id)) }
      : { data: null, error: { code: "unavailable" } });
    const result = await loadInputSources(db, SUBJECT, ids);
    expect(result).toHaveLength(101);
    expect(result.slice(0, 100).every((entry) => entry.snapshot !== null)).toBe(true);
    expect(result[100]).toEqual(unknown(ids[100]));
  });

  it.each([null, []])("preserves explicit unknown entries for successful missing metadata: %j", async (data) => {
    const { db } = database(() => ({ data }));
    expect(await loadInputSources(db, SUBJECT, ["source-b", "source-a"]))
      .toEqual([unknown("source-a"), unknown("source-b")]);
  });

  it("fills partial metadata by requested ID without hiding missing sources or adding unrequested rows", async () => {
    const { db } = database(() => ({ data: [file("source-c"), file("not-requested"), file("source-a")] }));
    const result = await loadInputSources(db, SUBJECT, ["source-c", "source-b", "source-a"]);
    expect(result.map((entry) => entry.fileId)).toEqual(["source-a", "source-b", "source-c"]);
    expect(result[1]).toEqual(unknown("source-b"));
    expect(result[0].snapshot?.counts).toEqual(SNAPSHOT.counts);
    expect(result[2].snapshot?.counts).toEqual(SNAPSHOT.counts);
  });

  it("projects only display facts from an exact source-hash and completed processing snapshot", async () => {
    const { db } = database(() => ({ data: [file("source", {
      bucket_path: "private/source/path", original_filename: "private-input.vcf", raw_header: "private header",
      input_provenance: { ...SNAPSHOT, rawHeader: "private header" },
    })] }));
    expect(await loadInputSources(db, SUBJECT, ["source"])).toEqual([{
      fileId: "source", fileType: "vcf", processedAt: FINISHED,
      snapshot: {
        sourceBuild: "GRCh38", buildBasis: "source-declared", targetBuild: "GRCh38",
        variantRowsMapped: 12, variantRowsUnmapped: 2, counts: SNAPSHOT.counts,
      },
    }]);
  });

  it("accepts equivalent completion timestamp syntax and records mapped GRCh37 context without exposing chain hashes", async () => {
    const { db } = database(() => ({ data: [file("source", {
      processing_finished_at: "2026-09-06T00:00:00+00:00",
      input_provenance: { ...SNAPSHOT, sourceBuild: "GRCh37", buildBasis: "format-assumption", chainSha256: "b".repeat(64) },
    })] }));
    const [result] = await loadInputSources(db, SUBJECT, ["source"]);
    expect(result.snapshot).toEqual({
      sourceBuild: "GRCh37", buildBasis: "format-assumption", targetBuild: "GRCh38",
      variantRowsMapped: 12, variantRowsUnmapped: 2, counts: SNAPSHOT.counts,
    });
    expect(result.processedAt).toBe("2026-09-06T00:00:00+00:00");
  });

  it.each([
    ["absent legacy snapshot", { input_provenance: null }],
    ["empty legacy snapshot", { input_provenance: {} }],
    ["old snapshot version", { input_provenance: { ...SNAPSHOT, version: "old" } }],
    ["missing count fields", { input_provenance: { ...SNAPSHOT, counts: { called: 15 } } }],
    ["invalid count", { input_provenance: { ...SNAPSHOT, counts: { ...SNAPSHOT.counts, noCall: -1 } } }],
    ["unknown source build", { input_provenance: { ...SNAPSHOT, sourceBuild: "unknown" } }],
    ["missing liftover identity", { input_provenance: { ...SNAPSHOT, sourceBuild: "GRCh37" } }],
    ["different source hash", { input_source_sha256: "b".repeat(64) }],
    ["missing source hash", { input_source_sha256: null }],
    ["different completion", { processing_finished_at: "2026-09-06T00:00:01Z" }],
    ["missing completion", { processing_finished_at: null }],
    ["in-flight processing", { status: "parsing" }],
    ["failed processing", { status: "failed" }],
  ])("keeps the source visible but its quality unknown for %s", async (_label, overrides) => {
    const row = file("historical-source", overrides);
    const { db } = database(() => ({ data: [row] }));
    expect(await loadInputSources(db, SUBJECT, ["historical-source"])).toEqual([{
      fileId: "historical-source", fileType: "vcf", processedAt: row.processing_finished_at, snapshot: null,
    }]);
  });
});
