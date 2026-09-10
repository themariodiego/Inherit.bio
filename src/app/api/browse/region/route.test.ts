import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "12345678-1234-4234-8234-000000000001" } as { id: string } | null,
  filters: [] as Array<[string, unknown]>,
  limit: 0,
  rows: [] as unknown[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user } }) },
  from: () => {
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { mocks.filters.push([column, value]); return builder; },
      gte: (column: string, value: unknown) => { mocks.filters.push([column, value]); return builder; },
      lte: (column: string, value: unknown) => { mocks.filters.push([column, value]); return builder; },
      order: () => builder,
      limit: (rows: number) => { mocks.limit = rows; return Promise.resolve({ data: mocks.rows, error: null }); },
    };
    return builder;
  },
}) }));

const { POST } = await import("./route");

const FILE = "12345678-1234-4234-8234-00000000000a";
const ORIGIN = "https://inherit.bio";
const BODY = { file: FILE, chromosome: "chr20", start: 1_000_000, end: 1_100_000 };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/browse/region`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * The region read the embedded genome browser makes.
 *
 * This route used to be a GET whose query string carried the file identifier
 * and the exact stretch of genome being read, which reaches server logs,
 * referrers and traces. `docs/route-register.json#api.browse-region` registers
 * it as a POST whose parameters are body-only, with two bounds this code was
 * ten times wider than. These cases pin all three.
 */
describe("browse region", () => {
  beforeEach(() => {
    mocks.user = { id: "12345678-1234-4234-8234-000000000001" };
    mocks.filters = [];
    mocks.limit = 0;
    mocks.rows = [];
  });

  it("reads the requested window and pages at the registered 500 rows", async () => {
    mocks.rows = [{ rsid: 1, chrom: 20, pos: 1_000_500, ref: "A", alt: "G", genotype: "A/G" }];
    const response = await POST(post(BODY));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ variants: mocks.rows, truncated: false });
    expect(mocks.limit).toBe(500);
    expect(mocks.filters).toEqual([["file_id", FILE], ["chrom", 20], ["pos", 1_000_000], ["pos", 1_100_000]]);
  });

  it("refuses a span wider than the registered one megabase", async () => {
    const response = await POST(post({ ...BODY, end: BODY.start + 1_000_001 }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "region_too_large" });
    expect(mocks.limit, "no read is made once the span is refused").toBe(0);
  });

  it.each([
    ["a cross-origin request", { origin: "https://elsewhere.invalid" }],
    ["a request that is not same-site", { "sec-fetch-site": "cross-site" }],
  ])("refuses %s before reading anything", async (_label, headers) => {
    const response = await POST(post(BODY, headers));
    expect(response.status).toBe(403);
    expect(mocks.limit).toBe(0);
  });

  it("refuses an unknown field rather than ignoring it", async () => {
    const response = await POST(post({ ...BODY, accountId: "someone-else" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(mocks.limit).toBe(0);
  });

  it("answers 401 without a session, and never reads", async () => {
    mocks.user = null;
    const response = await POST(post(BODY));
    expect(response.status).toBe(401);
    expect(mocks.limit).toBe(0);
  });

  it("carries the registered no-store, no-referrer headers on a result", async () => {
    const response = await POST(post(BODY));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("exports no GET, so no parameter can travel in a URL", async () => {
    const handlers = await import("./route");
    expect(Object.keys(handlers).sort()).toEqual(["POST"]);
  });
});
