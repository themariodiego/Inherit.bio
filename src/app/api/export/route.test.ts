import { beforeEach, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
const mocks = vi.hoisted(() => ({ fail: false, count: 2, pauseOriginal: null as Promise<void> | null, reportReads: 0 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: { id: "12345678-1234-4234-8234-000000000001", email: "synthetic@e2e.local" } } }),
  getClaims: async () => ({ data: { claims: { sub: "12345678-1234-4234-8234-000000000001", session_id: "12345678-1234-4234-8234-000000000002" } } }),
} }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const builder = { select: () => builder, eq: () => builder, is: () => builder, order: () => builder, range: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
  return { from: () => builder, rpc: () => {}, storage: { from: () => ({ download: () => {} }) } };
} }));
vi.mock("@/lib/genome/load", () => ({ getProcessedFiles: async () => [], getPublishedTemplates: async () => [],
  getGenotypesByRsid: vi.fn(), templateRsids: vi.fn() }));
vi.mock("@/lib/genome/prs-output", () => ({ loadPrsForExport: async () => [] }));
vi.mock("@/lib/exports/own-subject-content", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/exports/own-subject-content")>();
  return { ...original, ownSubjectExportContent: () => ({
    list: async () => Array.from({ length: mocks.count }, (_, i) => ({ file: { id: `file-${i}`, subject_id: "subject", original_name: "Genome file", variant_count: 1 } })),
    check: async () => {},
    original: async (s: { file: { id: string } }) => { await mocks.pauseOriginal; return new Blob([`original-${s.file.id}`]); },
    variants: async function* () { yield [{ rsid: 1, chrom: 1, pos: 100, ref: "A", alt: "G", genotype: "A/G" }]; if (mocks.fail) throw new Error("private source detail"); },
    observed: async function* () { yield [{ source_line: 9, genotype: "--", usable: false }]; },
    reports: async (s: { file: { id: string } }) => { mocks.reportReads++; return ({ file_id: s.file.id, original_name: "Genome file", source_revision: 1, source_sha256: "hash",
      report_count: 1, reports: [{ slug: "saved-finding", purpose: "reports.polygenic", completed_at: "2026-09-06", provenance_note: "No catalog snapshot was captured.", covered: true, conflictingRsids: [],
        variants: [{ rsid: "rs1", status: "genotyped", genotype: "AG", interpretation: "Stored interpretation", strand_flipped: false }] }] }); },
    prs: async () => [],
  }) };
});
import { GET } from "./route";
beforeEach(() => { mocks.fail = false; mocks.count = 2; mocks.pauseOriginal = null; mocks.reportReads = 0; });
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
