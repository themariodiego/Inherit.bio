import { beforeEach, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
const mocks = vi.hoisted(() => ({ prepared: false, variantReads: 0, fail: false, count: 2, pauseOriginal: null as Promise<void> | null, reportReads: 0,
  pauseSecondAncestry: null as Promise<void> | null, secondAncestryStarted: false, ancestryFailure: false, legacyRows: [] as Array<{ file_id: string; result: string }> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: { id: "12345678-1234-4234-8234-000000000001", email: "synthetic@e2e.local" } } }),
  getClaims: async () => ({ data: { claims: { sub: "12345678-1234-4234-8234-000000000001", session_id: "12345678-1234-4234-8234-000000000002" } } }),
} }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const from = (table: string) => {
    const builder = { select: () => builder, eq: () => builder, is: () => builder, order: () => builder, range: () => builder,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "ancestry_results" ? mocks.legacyRows : [], error: null }).then(resolve) };
    return builder;
  };
  return { from, rpc: () => {}, storage: { from: () => ({ download: () => {} }) } };
} }));
vi.mock("@/lib/genome/load", () => ({ getProcessedFiles: async () => [], getPublishedTemplates: async () => [],
  getGenotypesByRsid: vi.fn(), templateRsids: vi.fn() }));
vi.mock("@/lib/genome/prs-output", () => ({ loadPrsForExport: async () => [] }));
vi.mock("@/lib/exports/own-subject-content", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/exports/own-subject-content")>();
  return { ...original, ownSubjectExportContent: () => ({
    list: async () => Array.from({ length: mocks.count }, (_, i) => ({ file: { id: `file-${i}`, subject_id: "subject", original_name: "Genome file", variant_count: 1 }, ...(mocks.prepared && i === 0 ? { preparedSource: { backend: "prepared-object-v1" } } : {}) })),
    check: async () => {},
    original: async (s: { file: { id: string } }) => { await mocks.pauseOriginal; return new Blob([`original-${s.file.id}`]); },
    preparedRecords: async (_: unknown, consume: (records: unknown[], signal: AbortSignal, header: unknown) => Promise<void>) => {
      const records = [{ version: "prepared-canonical-v1", event: { type: "observed", line: 9 }, normalization: { status: "unmapped" } },
        { version: "prepared-canonical-v1", event: { type: "variant", line: 10 }, normalization: { status: "normalized", record: { genotype: "A/C" } } }];
      await consume(records, new AbortController().signal, { type: "prepared-export-source", version: "own-prepared-export-v1", binding: { source: { sourceBuild: "GRCh37" }, targetBuild: "GRCh38" } });
      if (mocks.fail) throw new Error("export unavailable");
      return { recordCount: records.length, variantCount: 1 };
    },
    variants: async function* () { mocks.variantReads++; yield [{ rsid: 1, chrom: 1, pos: 100, ref: "A", alt: "G", genotype: "A/G" }]; if (mocks.fail) throw new Error("private source detail"); },
    observed: async function* () { yield [{ source_line: 9, genotype: "--", usable: false }]; },
    reports: async (s: { file: { id: string } }) => { mocks.reportReads++; return ({ file_id: s.file.id, original_name: "Genome file", source_revision: 1, source_sha256: "hash",
      report_count: 1, reports: [{ slug: "saved-finding", purpose: "reports.polygenic", completed_at: "2026-09-06", provenance_note: "No catalog snapshot was captured.", covered: true, conflictingRsids: [],
        variants: [{ rsid: "rs1", status: "genotyped", genotype: "AG", interpretation: "Stored interpretation", strand_flipped: false }] }] }); },
    prs: async () => [],
    ancestry: async (s: { file: { id: string } }) => {
      if (mocks.ancestryFailure) throw new Error("export unavailable");
      if (s.file.id === "file-1") { mocks.secondAncestryStarted = true; await mocks.pauseSecondAncestry; }
      return s.file.id === "file-0" ? [{ file_id: s.file.id, purpose: "ancestry", result: { support_note: "Checked stored content" } }] : [];
    },
  }) };
});
import { GET } from "./route";
beforeEach(() => { mocks.prepared = false; mocks.variantReads = 0; mocks.fail = false; mocks.count = 2; mocks.pauseOriginal = null; mocks.reportReads = 0; mocks.ancestryFailure = false; mocks.legacyRows = []; mocks.pauseSecondAncestry = null; mocks.secondAncestryStarted = false; });
describe("canonical export ZIP integration", () => {
  it("keeps two same-label originals distinct and prints the identical captured findings", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
    for (const id of ["file-0", "file-1"]) {
      expect(zip.readAsText(`originals/${id}`)).toBe(`original-${id}`);
      expect(zip.readAsText(`variants/${id}.csv`)).toBe("rsid,chrom,pos_grch38,ref,alt,genotype\nrs1,1,100,A,G,A/G\n");
      expect(JSON.parse(zip.readAsText(`observed/${id}.json`))).toEqual([{ source_line: 9, genotype: "--", usable: false }]);
    }
    const json = JSON.parse(zip.readAsText("reports.json"));
    expect(json).toHaveLength(2);
    expect(json[0].reports[0]).not.toHaveProperty("evidence");
    expect(zip.readAsText("reports.txt")).toContain(json[0].reports[0].variants[0].interpretation);
    expect(zip.readAsText("reports.txt")).toContain("No catalog snapshot was captured.");
    expect(JSON.parse(zip.readAsText("manifest.json")).files.map((f: { row_count: number }) => f.row_count)).toEqual([1, 1]);
  });
  it("terminates the response when a page fails with an open archive member", async () => {
    mocks.fail = true; mocks.count = 1;
    const response = await GET();
    await expect(response.arrayBuffer()).rejects.toThrow("export unavailable");
  }, 1500);
  it("uses checked canonical ancestry only and excludes canonical or unattributed legacy-table rows", async () => {
    mocks.legacyRows = [{ file_id: "file-0", result: "Unchecked canonical row" }, { file_id: "unknown", result: "Unattributed row" }];
    const zip = new AdmZip(Buffer.from(await (await GET()).arrayBuffer()));
    expect(JSON.parse(zip.readAsText("ancestry.json"))).toEqual([
      { file_id: "file-0", purpose: "ancestry", result: { support_note: "Checked stored content" } },
    ]);
    expect(JSON.parse(zip.readAsText("manifest.json")).contents.find((entry: { path: string }) => entry.path === "ancestry.json").count).toBe(1);
  });
  it("emits a checked ancestry source before awaiting the next source", async () => {
    let release!: () => void;
    mocks.pauseSecondAncestry = new Promise<void>(resolve => { release = resolve; });
    const response = await GET();
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let streamed = "";
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); streamed += Buffer.from(value).toString();
      }
    })();
    try {
      await vi.waitFor(() => expect(mocks.secondAncestryStarted).toBe(true));
      // Native ZIP uses store mode: this proves A's bytes were emitted while
      // B is still pending, before a withdrawal during B could stale cached A.
      await vi.waitFor(() => expect(streamed).toContain("Checked stored content"));
    } finally { release(); }
    await reading;
    expect(JSON.parse(new AdmZip(Buffer.concat(chunks)).readAsText("ancestry.json")))
      .toEqual([{ file_id: "file-0", purpose: "ancestry", result: { support_note: "Checked stored content" } }]);
  });
  it("terminates the ZIP when ancestry authority fails after originals were read", async () => {
    mocks.ancestryFailure = true;
    await expect((await GET()).arrayBuffer()).rejects.toThrow("export unavailable");
  });
  it("does not resume report/page work after cancellation during an awaited original", async () => {
    let release!: () => void;
    mocks.pauseOriginal = new Promise<void>(resolve => { release = resolve; });
    const response = await GET();
    await response.body!.cancel();
    release();
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(mocks.reportReads).toBe(0);
  });

});

// Actual ZIP assembly; source transport semantics are verified separately.
it("exports prepared records as complete JSONL and leaves another database source in its existing format", async () => {
  mocks.prepared = true;
  const zip = new AdmZip(Buffer.from(await (await GET()).arrayBuffer()));
  const records = zip.readAsText("canonical/file-0.jsonl").trim().split("\n").map(line => JSON.parse(line));
  expect(records).toHaveLength(3);
  expect(records[0].binding.source.sourceBuild).toBe("GRCh37");
  expect(records[1].normalization.status).toBe("unmapped");
  expect(zip.getEntry("variants/file-0.csv")).toBeNull();
  expect(zip.getEntry("observed/file-0.json")).toBeNull();
  expect(zip.readAsText("variants/file-1.csv")).toContain("A/G");
  expect(zip.readAsText("originals/file-0")).toBe("original-file-0");
  expect(mocks.variantReads).toBe(1);
  expect(JSON.parse(zip.readAsText("manifest.json")).contents.find((e: { path: string }) => e.path === "canonical/file-0.jsonl").count).toBe(2);
});
it("refuses a complete ZIP after prepared stream failure rather than falling back to database calls", async () => {
  mocks.prepared = true; mocks.fail = true;
  await expect((await GET()).arrayBuffer()).rejects.toBeDefined();
  expect(mocks.variantReads).toBe(0);
});
