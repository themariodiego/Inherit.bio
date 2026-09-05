import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  updates: [] as { table: string; value: Record<string, unknown> }[],
  inserts: [] as { table: string; rows: Record<string, unknown>[] }[],
  deletes: [] as string[],
  deleteError: null as string | null,
  updateError: null as string | null,
  persistedFile: { status: "annotated", build: "GRCh38" } as Record<string, unknown>,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "test-user", email: null } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
    id: "test-file", subject_id: "test-subject", tier: 1, file_type: "vcf", bucket_path: "test-user/file.vcf",
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
  insert: async (rows: Record<string, unknown>[]) => { state.inserts.push({ table, rows }); return { error: null }; },
  select: () => ({ eq: async () => ({ count: 0, error: null }) }),
}) }) }));
import { POST } from "./route";

beforeEach(() => {
  state.updates = []; state.inserts = []; state.deletes = []; state.deleteError = null;
  state.updateError = null; state.persistedFile = { status: "annotated", build: "GRCh38" };
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");
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
    expect(state.deletes).toEqual(["user_variants", "ancestry_results", "user_prs"]);
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
