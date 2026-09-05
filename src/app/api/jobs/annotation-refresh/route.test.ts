import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  readError: null as { code: string } | null,
  writeError: null as { code: string } | null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({
    select: () => ({ lt: () => ({ order: () => ({ limit: async () => ({ data: state.rows, error: state.readError }) }) }) }),
    update: (value: Record<string, unknown>) => ({ eq: async () => {
      state.updates.push(value);
      return { error: state.writeError };
    } }),
  }) }),
}));
import { GET } from "./route";

beforeEach(() => {
  state.rows = [{ rsid: 1, chrom: 1, pos38: 100, ref: "A", alt: "G", sources: { existing: "provenance" } }];
  state.updates = [];
  state.readError = null;
  state.writeError = null;
  vi.stubEnv("JOBS_SECRET", "test-job-secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = () => new Request("https://example.test/api/jobs/annotation-refresh", { headers: { authorization: "Bearer test-job-secret" } });

describe("reference refresh binding", () => {
  it("clears unbound clinical labels and preserves independent provenance", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ rs1: {
      name: "rs1", clinical_significance: ["pathogenic"],
      mappings: [{ assembly_name: "GRCh38", seq_region_name: "1", start: 100, end: 100, strand: 1, allele_string: "A/G" }],
      populations: [{ population: "gnomADg:ALL", allele: "A", frequency: 0.9 }, { population: "gnomADg:ALL", allele: "G", frequency: 0.1 }],
    } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request())).status).toBe(200);
    expect(state.updates[0]).toMatchObject({ clinvar_significance: null, clinvar_review_status: null, gnomad_af: 0.1,
      sources: { existing: "provenance", clinical_binding: "unavailable-rsid-only", frequency_binding: { alt: "G", assembly: "GRCh38" } } });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({ ids: ["rs1"] });
  });

  it("clears stale evidence when the reference response lacks the rsID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    expect((await GET(request())).status).toBe(200);
    expect(state.updates[0]).toMatchObject({ clinvar_significance: null, gnomad_af: null, gnomad_af_by_pop: null });
  });

  it("does not report a failed database read as a fresh store", async () => {
    state.readError = { code: "unavailable" };
    expect((await GET(request())).status).toBe(503);
    expect(state.updates).toEqual([]);
  });

  it("does not report a failed update as enrichment", async () => {
    state.writeError = { code: "unavailable" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    expect((await GET(request())).status).toBe(503);
  });
});
