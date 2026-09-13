import { beforeEach, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
const mocks = vi.hoisted(() => ({ prepared: false, retired: false, stateInvalid: false, stateError: false, authorityFail: false, changedSource: false,
  stateRead: false, failAfterState: false, failFinalStreamCheck: false, originalReads: [] as string[], streamReads: 0, authChecks: 0, failStreamCheck: false,
  preparedId: "12345678-1234-4234-8234-000000000003", manifestId: "12345678-1234-4234-8234-000000000004",
  variantReads: 0, fail: false, count: 2, pauseOriginal: null as Promise<void> | null, reportReads: 0,
  pauseSecondAncestry: null as Promise<void> | null, secondAncestryStarted: false, ancestryFailure: false, legacyRows: [] as Array<{ file_id: string; result: string }>,
  // D-099 fixture: the LEGACY half of the archive, which until 2026-09-13
  // carried no report-purpose check at all.
  legacyFiles: [] as Array<Record<string, unknown>>, processed: [] as Array<Record<string, unknown>>,
  templates: [] as Array<Record<string, unknown>>, grants: new Set<string>(), genotypeReads: [] as string[],
  revokeAfterBuild: false, reportGrantChecks: 0 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: { id: "12345678-1234-4234-8234-000000000001", email: "synthetic@e2e.local" } } }),
  getClaims: async () => ({ data: { claims: { sub: "12345678-1234-4234-8234-000000000001", session_id: "12345678-1234-4234-8234-000000000002" } } }),
} }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const from = (table: string) => {
    const rows = table === "ancestry_results" ? mocks.legacyRows : table === "genome_files" ? mocks.legacyFiles : [];
    // The genome_files read is paged by `fetchAllRows`, which stops on the
    // first empty page. Answer the offset honestly or it never terminates.
    let offset = 0;
    const builder = { select: () => builder, eq: () => builder, is: () => builder, order: () => builder,
      range: (start: number) => { offset = start; return builder; },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows.slice(offset), error: null }).then(resolve) };
    return builder;
  };
  return { from, rpc: (name: string, args: { p_expected?: Record<string, unknown>; p_subject_id?: string; p_purpose?: string }) => {
    // The grant question is awaited directly, not through `abortSignal()`.
    if (name === "own_subject_purpose_granted_v1") {
      const granted = mocks.grants.has(`${args.p_subject_id} ${args.p_purpose}`);
      // `revokeAfterBuild` withdraws AFTER the first pass over the report
      // purposes has answered, which is the race the second check exists for:
      // the archive has been built and not yet written.
      if (mocks.revokeAfterBuild && args.p_purpose?.startsWith("reports.")
        && ++mocks.reportGrantChecks === 2) mocks.grants.clear();
      return Promise.resolve({ data: granted, error: null }) as never;
    }
    return ({ abortSignal: async () => {
    if (name === "own_original_download_state_v1") { mocks.stateRead = true; return { data: { version: "own-original-download-state-v1", fileId: mocks.preparedId,
      prepared: !mocks.stateInvalid, retired: mocks.retired, expiresAt: null }, error: mocks.stateError ? {} : null }; }
    mocks.authChecks++;
    const source = args.p_expected ?? { version: "prepared-original-download-v1", fileId: mocks.preparedId, manifestId: mocks.manifestId,
      sourceRevision: 1, rawSha256: "a".repeat(64), bucket: "genomes", objectId: "12345678-1234-4234-8234-000000000005",
      objectKey: "12345678-1234-4234-8234-000000000006", storageVersion: "12345678-1234-4234-8234-000000000007",
      sizeBytes: 15, expiresAt: "2099-01-01T00:00:00Z" };
    return { data: { source: { ...source, ...(mocks.changedSource ? { manifestId: "12345678-1234-4234-8234-000000000009" } : {}) }, originalName: "Genome file" },
      error: (mocks.failStreamCheck && mocks.authChecks > 1) || (mocks.failFinalStreamCheck && mocks.authChecks > 2) ? {} : null };
  } });
  }, storage: { from: () => ({
    // A legacy file's original is fetched from Storage; the canonical half
    // never reaches here (it streams through the prepared-original mock).
    download: async () => ({ data: new Blob(["legacy-original"]) }),
  }) } };
} }));
vi.mock("@/lib/genome/load", () => ({
  getProcessedFiles: async () => mocks.processed,
  getPublishedTemplates: async () => mocks.templates,
  getGenotypesByRsid: async (_db: unknown, fileId: string) => {
    mocks.genotypeReads.push(fileId);
    return new Map([[1, "A/G"], [2, "A/G"]]);
  },
  templateRsids: (templates: Array<{ variants: Array<{ rsid: number }> }>) =>
    templates.flatMap(template => template.variants.map(variant => variant.rsid)),
}));
vi.mock("@/lib/genome/prs-output", () => ({ loadPrsForExport: async () => [] }));
vi.mock("@/lib/exports/own-subject-content", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/exports/own-subject-content")>();
  return { ...original, ownSubjectExportContent: () => ({
    list: async () => Array.from({ length: mocks.count }, (_, i) => ({ file: { id: mocks.prepared && i === 0 ? mocks.preparedId : `file-${i}`, upload_revision: 1, sha256: "a".repeat(64), size_bytes: 15, storage_object_id: "12345678-1234-4234-8234-000000000005", bucket_path: "12345678-1234-4234-8234-000000000006", subject_id: "subject", original_name: "Genome file", variant_count: 1 }, ...(mocks.prepared && i === 0 ? { preparedSource: { backend: "prepared-object-v1", manifestId: mocks.manifestId } } : {}) })),
    check: async () => { if (mocks.authorityFail || (mocks.failAfterState && mocks.stateRead)) throw new Error("export unavailable"); },
    original: async (s: { file: { id: string } }) => { mocks.originalReads.push(s.file.id); await mocks.pauseOriginal; return new Blob([`original-${s.file.id}`]); },
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
// The range helper has its own real transport/hash tests. Here its authority
// callbacks and yielded bytes pass through the actual ZIP assembler.
vi.mock("@/lib/uploads/prepared-original-download", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/uploads/prepared-original-download")>();
  return { ...actual, streamPreparedOriginalDownload: async function* (options: Parameters<typeof actual.streamPreparedOriginalDownload>[0]) {
    mocks.streamReads++;
    await options.check(options.source, options.signal);
    yield Buffer.from("prepared-original");
    await options.check(options.source, options.signal);
  } };
});
import { GET } from "./route";
beforeEach(() => { mocks.prepared = false; mocks.stateRead = false; mocks.failAfterState = false; mocks.failFinalStreamCheck = false; mocks.retired = false; mocks.stateInvalid = false; mocks.stateError = false; mocks.authorityFail = false; mocks.changedSource = false; mocks.originalReads = []; mocks.streamReads = 0; mocks.authChecks = 0; mocks.failStreamCheck = false; mocks.variantReads = 0; mocks.fail = false; mocks.count = 2; mocks.pauseOriginal = null; mocks.reportReads = 0; mocks.ancestryFailure = false; mocks.legacyRows = []; mocks.pauseSecondAncestry = null; mocks.secondAncestryStarted = false;
  mocks.legacyFiles = []; mocks.processed = []; mocks.templates = []; mocks.grants = new Set(); mocks.genotypeReads = []; mocks.revokeAfterBuild = false; mocks.reportGrantChecks = 0; });
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
    // Every file says whose data it is, so an account holding more than its
    // own subject can tell the archive's files apart.
    expect(JSON.parse(zip.readAsText("manifest.json")).files
      .map((f: { subject_id: string }) => f.subject_id)).toEqual(["subject", "subject"]);
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
  const records = zip.readAsText(`canonical/${mocks.preparedId}.jsonl`).trim().split("\n").map(line => JSON.parse(line));
  expect(records).toHaveLength(3);
  expect(records[0].binding.source.sourceBuild).toBe("GRCh37");
  expect(records[1].normalization.status).toBe("unmapped");
  expect(zip.getEntry(`variants/${mocks.preparedId}.csv`)).toBeNull();
  expect(zip.getEntry(`observed/${mocks.preparedId}.json`)).toBeNull();
  expect(zip.readAsText("variants/file-1.csv")).toContain("A/G");
  expect(zip.readAsText(`originals/${mocks.preparedId}`)).toBe("prepared-original");
  expect(mocks.variantReads).toBe(1);
  expect(JSON.parse(zip.readAsText("manifest.json")).contents.find((e: { path: string }) => e.path === `canonical/${mocks.preparedId}.jsonl`).count).toBe(2);
});
it("refuses a complete ZIP after prepared stream failure rather than falling back to database calls", async () => {
  mocks.prepared = true; mocks.fail = true;
  await expect((await GET()).arrayBuffer()).rejects.toBeDefined();
  expect(mocks.variantReads).toBe(0);
});

it("omits only a confirmed retired prepared original while preserving records, reports and the other original", async () => {
  mocks.prepared = true; mocks.retired = true;
  const zip = new AdmZip(Buffer.from(await (await GET()).arrayBuffer()));
  expect(zip.getEntry(`originals/${mocks.preparedId}`)).toBeNull();
  expect(zip.getEntry(`canonical/${mocks.preparedId}.jsonl`)).not.toBeNull();
  expect(zip.readAsText("reports.json")).toContain("Stored interpretation");
  expect(zip.readAsText("originals/file-1")).toBe("original-file-1");
  const manifest = JSON.parse(zip.readAsText("manifest.json"));
  expect(manifest.note).toContain("your available original uploaded files (expired originals are identified in warnings)");
  expect(manifest.warnings).toEqual([`originals/${mocks.preparedId} omitted: the original retention period has ended. Prepared records and saved reports remain included.`]);
  expect(manifest.contents.some((entry: { path: string }) => entry.path === `originals/${mocks.preparedId}`)).toBe(false);
  expect(mocks.originalReads).toEqual(["file-1"]); expect(mocks.streamReads).toBe(0); expect(mocks.authChecks).toBe(0);
});
it("uses live authority throughout prepared-original streaming without the Blob download", async () => {
  mocks.prepared = true; mocks.count = 1;
  const zip = new AdmZip(Buffer.from(await (await GET()).arrayBuffer()));
  expect(zip.readAsText(`originals/${mocks.preparedId}`)).toBe("prepared-original");
  expect(mocks.originalReads).toEqual([]); expect(mocks.streamReads).toBe(1); expect(mocks.authChecks).toBe(3);
});
it.each(["stateInvalid", "stateError", "authorityFail", "changedSource", "failStreamCheck", "failAfterState", "failFinalStreamCheck"] as const)("refuses prepared export on %s, without original fallback", async key => {
  mocks.prepared = true; mocks.count = 1; mocks[key] = true;
  if (key === "authorityFail" || key === "failAfterState") mocks.retired = true;
  await expect((await GET()).arrayBuffer()).rejects.toThrow("export unavailable");
  expect(mocks.originalReads).toEqual([]);
});

/**
 * D-099, closed 2026-09-13. The LEGACY half of `reports.json` used to run on
 * `raw.export` alone: revoking `reports.monogenic` or `reports.polygenic`
 * left results derived from a legacy source in the archive, exactly the gap
 * D-097 closed for `ancestry`.
 *
 * The fixture is two published templates on one legacy file, one per layer,
 * so the two purposes can be revoked independently — they are two selections,
 * and a reader who kept estimates and dropped variant calls must receive
 * estimates only.
 */
describe("legacy report purposes in the export", () => {
  const variant = (rsid: number) => ({ rsid, chrom: 1, pos38: 100 + rsid, ref: "A", alt: "G",
    gene: "GENE", interpretations: { AG: `Interpretation ${rsid}` } });
  const template = (slug: string, layer: string, rsid: number) => ({
    slug, title: `Title ${slug}`, category: "basic-traits", evidence: "established",
    summary: "Public description", pgs_id: null, layer, citations: [], variants: [variant(rsid)],
  });
  beforeEach(() => {
    mocks.count = 0; // no canonical snapshots; this is about the legacy half
    mocks.legacyFiles = [{ id: "legacy-0", subject_id: "subject", user_id: "u", original_name: "Legacy file",
      variant_count: 1, single_logical_sample_verified_at: null }];
    mocks.processed = [{ id: "legacy-0", original_name: "Legacy file" }];
    mocks.templates = [template("estimate-report", "estimate", 1), template("variant-report", "variant_call", 2)];
  });
  const reportsFor = async () => {
    const zip = new AdmZip(Buffer.from(await (await GET()).arrayBuffer()));
    return JSON.parse(zip.readAsText("reports.json")) as Array<{ file_id: string; report_count: number; reports: Array<{ slug: string }> }>;
  };

  it("ships both layers while both purposes are granted", async () => {
    mocks.grants = new Set(["subject reports.monogenic", "subject reports.polygenic"]);
    const json = await reportsFor();
    expect(json.map(file => file.reports.map(report => report.slug)))
      .toEqual([["estimate-report", "variant-report"]]);
  });

  it("ships only the layer whose purpose is live", async () => {
    mocks.grants = new Set(["subject reports.polygenic"]);
    const json = await reportsFor();
    expect(json[0].reports.map(report => report.slug)).toEqual(["estimate-report"]);
    expect(json[0].report_count).toBe(1);
  });

  it("reads no genotypes at all once both purposes are revoked, and still names the file", async () => {
    mocks.grants = new Set();
    const json = await reportsFor();
    // The file is still listed, because the archive's file list is not a
    // result — but nothing derived from it is read or written.
    expect(json).toEqual([{ file_id: "legacy-0", original_name: "Legacy file", report_count: 0, reports: [] }]);
    expect(mocks.genotypeReads, "no genetic read for a file with no live purpose").toEqual([]);
  });

  it("aborts rather than shipping a buffered result when a purpose is revoked mid-export", async () => {
    mocks.grants = new Set(["subject reports.monogenic", "subject reports.polygenic"]);
    mocks.revokeAfterBuild = true;
    await expect((await GET()).arrayBuffer()).rejects.toThrow();
  });
});
