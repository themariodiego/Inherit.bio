import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which secret may supply fixture input.
 *
 * The refresh job takes an optional fixture body so the E2E suite drives the
 * live path rather than a copy of it (brief G8.2(b), recorded in
 * `docs/fixture-paths.md`). That input is an operator's, so it takes the
 * operator secret; the cron secret drives the scheduled live path and nothing
 * else. Both are server-side and neither reaches a browser, so this narrows an
 * unnecessary credential path rather than closing an open one.
 */
const state = vi.hoisted(() => ({ refreshes: [] as unknown[] }));
// The route's query shape is not this file's subject: any builder call chains,
// and every terminal awaits to an empty, error-free result.
const chain: unknown = new Proxy(function () {} as unknown as object, {
  get: (_target, key) => (key === "then" ? undefined : () => chain),
  apply: () => chain,
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => chain }),
}));
vi.mock("@/lib/research/sources", () => ({
  RELEASE_FETCHERS: { gwas_catalog: async () => { state.refreshes.push("live"); return null; } },
}));
vi.mock("@/lib/research/draft", () => ({ draftFromAssociation: async () => ({ drafted: false }) }));
import { POST } from "./route";

const FIXTURE = { source: "gwas_catalog", release_key: "r1", associations: [] };
function post(secret: string | undefined, body: unknown) {
  return new Request("https://example.test/api/jobs/research-refresh", {
    method: "POST", body: JSON.stringify(body),
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}
beforeEach(() => {
  state.refreshes = [];
  vi.stubEnv("JOBS_SECRET", "operator-secret");
  vi.stubEnv("CRON_SECRET", "schedule-secret");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("fixture input takes the operator secret", () => {
  it("refuses a fixture body presented with the schedule's secret", async () => {
    const response = await POST(post("schedule-secret", { fixture: FIXTURE }));
    expect(response.status).toBe(401);
  });
  it("accepts a fixture body from the operator secret", async () => {
    const response = await POST(post("operator-secret", { fixture: FIXTURE }));
    expect(response.status).not.toBe(401);
  });
  it("still lets the schedule's secret drive the live path", async () => {
    const response = await POST(post("schedule-secret", {}));
    expect(response.status).not.toBe(401);
  });
  it("refuses an unknown secret, and a missing one, before any body matters", async () => {
    expect((await POST(post("neither", { fixture: FIXTURE }))).status).toBe(401);
    expect((await POST(post(undefined, { fixture: FIXTURE }))).status).toBe(401);
  });
});
