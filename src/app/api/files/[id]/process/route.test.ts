import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const state = vi.hoisted(() => ({
  updates: [] as { table: string; value: Record<string, unknown> }[],
  inserts: [] as { table: string; rows: Record<string, unknown>[] }[],
  deletes: [] as string[],
  deleteError: null as string | null,
  updateError: null as string | null,
  fileOwner: "test-user",
  insertError: null as string | null,
  persistedFile: { status: "annotated", build: "GRCh38" } as Record<string, unknown>,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "test-user", email: null } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
    id: "test-file", user_id: state.fileOwner, subject_id: "test-subject", tier: 1, file_type: "vcf", bucket_path: "test-user/file.vcf",
  } }) }) }) }),
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => ({
  update: (value: Record<string, unknown>) => ({ eq: async () => {
    state.updates.push({ table, value });
    if (value.status === state.updateError) return { error: { code: "unavailable", message: "private database detail" } };
    if (table === "genome_files") Object.assign(state.persistedFile, value);
    return { error: null };
  } }),
  delete: () => ({ eq: async () => { state.deletes.push(table); return { error: state.deleteError === table ? { code: "unavailable" } : null }; } }),
  insert: async (rows: Record<string, unknown>[]) => { state.inserts.push({ table, rows }); return { error: state.insertError === table ? { code: "unavailable" } : null }; },
  select: () => ({ eq: async () => ({ count: 0, error: null }) }),
}) }) }));
import { POST } from "./route";

beforeEach(() => {
  state.updates = []; state.inserts = []; state.deletes = []; state.deleteError = null;
  state.fileOwner = "test-user"; state.insertError = null;
  state.updateError = null; state.persistedFile = { status: "annotated", build: "GRCh38" };
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
});

describe("observed reference processing", () => {
  const row = "12\t111803962\trs671\tG\tA\t.\tPASS\t.\tGT:GQ:DP\t0/0:42:18";
  it("refuses mismatched ownership before reading the source or writing", async () => {
    state.fileOwner = "another-owner";
    expect((await processVcf("##reference=GRCh38", row)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.updates).toEqual([]);
  });
  it("hashes actual original compressed bytes and binds source plus canonical evidence", async () => {
    const bytes = gzipSync(`##reference=GRCh38\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE\n${row}\n`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    const response = await POST(new Request("https://example.test", { method: "POST" }), { params: Promise.resolve({ id: "test-file" }) });
    expect(response.status).toBe(200);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(state.inserts.find((entry) => entry.table === "report_observed_calls")?.rows).toEqual([expect.objectContaining({
      file_id: "test-file", user_id: "test-user", subject_id: "test-subject", source_sha256: digest,
      source_build: "GRCh38", source_chrom: 12, source_pos: 111803962, source_ref: "G", source_alt: "A", source_gt: "0/0",
      chrom: 12, pos: 111803962, ref: "G", alt: "A", genotype: "G/G", usable: true, genotype_quality: 42, read_depth: 18,
    })]);
    expect(state.inserts.find((entry) => entry.table === "user_variants")).toBeUndefined();
    expect(state.updates[0].value).toMatchObject({ observed_call_sha256: null, observed_call_version: null });
    expect(state.updates.at(-1)?.value).toMatchObject({ status: "annotated", observed_call_sha256: digest, observed_call_version: "vcf-literal-diploid-snp-v1" });
  });
  it("replaces the exact file projection on rerun, retaining an identical extraction identity", async () => {
    expect((await processVcf("##reference=GRCh38", row)).status).toBe(200);
    const first = state.inserts.find((entry) => entry.table === "report_observed_calls")?.rows;
    state.inserts = []; state.deletes = [];
    expect((await processVcf("##reference=GRCh38", row)).status).toBe(200);
    expect(state.deletes.filter((table) => table === "report_observed_calls")).toHaveLength(1);
    expect(state.inserts.find((entry) => entry.table === "report_observed_calls")?.rows).toEqual(first);
  });
  it("does not certify a failed or partial projection", async () => {
    state.insertError = "report_observed_calls";
    expect((await processVcf("##reference=GRCh38", row)).status).toBe(500);
    expect(state.persistedFile.observed_call_sha256).toBeNull();
    expect(state.persistedFile.observed_call_version).toBeNull();
    expect(state.persistedFile.status).toBe("failed");
  });
  it("normalizes reversed reference calls without adding them to variant inputs", async () => {
    expect((await processVcf("##reference=GRCh37", "1\t400568\trs1642149602\tT\tG\t.\tPASS\t.\tGT\t0/0")).status).toBe(200);
    expect(state.inserts.find((entry) => entry.table === "report_observed_calls")?.rows[0]).toMatchObject({ source_ref: "T", source_alt: "G", source_gt: "0/0", pos: 418769, ref: "A", alt: "C", genotype: "A/A" });
    expect(state.inserts.find((entry) => entry.table === "user_variants")).toBeUndefined();
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function processVcf(header: string, row: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(`##fileformat=VCFv4.2\n${header}\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE\n${row}\n`)));
  return POST(new Request("https://example.test/api/files/test-file/process", { method: "POST" }), { params: Promise.resolve({ id: "test-file" }) });
}

describe("source build processing boundary", () => {
  it("stops before source fetch or derivative work when the parsing state cannot be persisted", async () => {
    state.updateError = "parsing";
    state.deleteError = "user_variants";
    const response = await processVcf("", "1\t100\trs1\tA\tG\t.\tPASS\t.\tGT\t0/1");
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("File processing could not start. Please try again.");
    expect(fetch).not.toHaveBeenCalled();
    expect(state.deletes).toEqual([]);
    expect(state.inserts).toEqual([]);
    expect(state.updates).toHaveLength(1);
    expect(state.persistedFile).toEqual({ status: "annotated", build: "GRCh38" });
  });

  it("keeps a rerun out of annotated reads when both cleanup and the final failed-state update fail", async () => {
    state.deleteError = "ancestry_results";
    state.updateError = "failed";
    const response = await processVcf("", "1\t100\trs1\tA\tG\t.\tPASS\t.\tGT\t0/1");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Unknown-build derivative cleanup failed: ancestry_results");
    expect(state.persistedFile).toMatchObject({ status: "parsing", build: null });
    expect(state.deletes).toEqual(["user_variants", "ancestry_results"]);
    expect(state.inserts).toEqual([]);
    expect(state.updates.at(-1)?.value.status).toBe("failed");
  });

  it.each(["", "##reference=GRCh380", "##reference=GRCh38\n##reference=GRCh37"])("invalidates old derivatives and refuses new results for unknown/unsupported/conflicting build: %s", async (header) => {
    const response = await processVcf(header, "1\t100\trs1\tA\tG\t.\tPASS\t.\tGT\t0/1");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Genome build is unknown or conflicting");
    expect(state.inserts).toEqual([]);
    expect(state.deletes).toEqual(["user_variants", "ancestry_results", "user_prs", "report_observed_calls"]);
    expect(state.updates[0].value.build).toBeNull();
    expect(state.updates.at(-1)?.value.status).toBe("failed");
    expect(state.updates.some((u) => u.value.build === "GRCh38")).toBe(false);
  });

  it("reports failed derivative cleanup explicitly and never reports success", async () => {
    state.deleteError = "ancestry_results";
    const response = await processVcf("", "1\t100\trs1\tA\tG\t.\tPASS\t.\tGT\t0/1");
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Unknown-build derivative cleanup failed: ancestry_results");
    expect(state.inserts).toEqual([]);
    expect(state.updates.at(-1)?.value.status).toBe("failed");
  });

  it("keeps the original GRCh37 build and complements a reversed SNP before canonical storage", async () => {
    const response = await processVcf("##reference=GRCh37", "1\t400568\trs1642149602\tT\tG\t.\tPASS\t.\tGT\t0/1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sourceBuild: "GRCh37", normalizedBuild: "GRCh38", variants: 1 });
    expect(state.inserts.find((i) => i.table === "user_variants")?.rows).toEqual([{
      user_id: "test-user", subject_id: "test-subject", file_id: "test-file", rsid: 1642149602,
      chrom: 1, pos: 418769, ref: "A", alt: "C", genotype: "A/C",
    }]);
    expect(state.updates.at(-1)?.value.build).toBe("GRCh37");
  });
});
