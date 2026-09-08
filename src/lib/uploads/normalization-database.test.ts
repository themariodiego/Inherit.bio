import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ postgres: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.postgres }));
import { normalizationDatabaseCompletion, normalizationDatabaseConfig } from "./normalization-database";

const ref = "abcdefghijklmnopqrst";
// Build reserved synthetic configuration in memory; never use a real credential.
const exampleDatabaseUrl = (host = `db.${ref}.supabase.co`, user = "postgres", port = 5432) => {
  const url = new URL(`postgresql://${host}:${port}/postgres`);
  url.username = user; url.password = "synthetic"; return url.href;
};
const env = () => ({ INHERIT_NORMALIZATION_DIRECT_DATABASE: "true",
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, DATABASE_URL: exampleDatabaseUrl() });
const identity = { p_account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  p_session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", p_file_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  p_claim: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
const receipt = { fileId: identity.p_file_id, status: "normalization_complete", analysisState: "not_generated" };
const payload = { rawSha256: "a".repeat(64), variantCount: 1, provenance: { sourceBuild: "GRCh38" } };
let queries: { text: string; values: unknown[] }[], events: string[], response: unknown;
let queryFailure: unknown, commitFailure: unknown, commitWait: Promise<void> | undefined;
let end: ReturnType<typeof vi.fn>;
let json: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {});
  queries = []; events = []; response = [{ receipt }];
  queryFailure = undefined; commitFailure = undefined; commitWait = undefined;
  end = vi.fn(async () => { events.push("end"); });
  json = vi.fn(value => ({ type: 114, value }));
  mocks.postgres.mockImplementation(() => ({ end, begin: async (callback: (tx: unknown) => Promise<unknown>) => {
    events.push("begin");
    try {
      const value = await callback(Object.assign(async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const text = parts.join("?"); queries.push({ text, values });
        if (text.includes("own_upload_normalization_v1")) {
          if (queryFailure) throw queryFailure;
          return response;
        }
        return [];
      }, { json }));
      events.push("commit-sent"); await commitWait;
      if (commitFailure) throw commitFailure;
      events.push("commit-ack"); return value;
    } catch (error) { events.push("rollback"); throw error; }
  } }));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("completion database destination", () => {
  it.each([undefined, "false"])("keeps REST for %s without inspecting DATABASE_URL", flag => {
    expect(normalizationDatabaseCompletion({ INHERIT_NORMALIZATION_DIRECT_DATABASE: flag, DATABASE_URL: "EXAMPLE-bad" })).toBeNull();
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
  it("accepts the exact direct project with verified TLS", () => {
    expect(normalizationDatabaseConfig(env())).toMatchObject({ host: `db.${ref}.supabase.co`, port: 5432,
      ssl: { rejectUnauthorized: true, servername: `db.${ref}.supabase.co` } });
  });
  it.each([5432, 6543])("accepts project-bound Supavisor on %i with verified TLS", port => {
    const configured = normalizationDatabaseConfig({ ...env(), DATABASE_URL: exampleDatabaseUrl("aws-0-eu-west-1.pooler.supabase.com", `postgres.${ref}`, port) });
    expect(configured?.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(configured?.username).toBe(`postgres.${ref}`);
  });
  it.each([
    { INHERIT_NORMALIZATION_DIRECT_DATABASE: "1" }, { DATABASE_URL: undefined },
    { DATABASE_URL: "EXAMPLE-invalid" }, { DATABASE_URL: exampleDatabaseUrl("db.zyxwvutsrqponmlkjihg.supabase.co") },
    { DATABASE_URL: exampleDatabaseUrl("aws-0-eu-west-1.pooler.supabase.com", "postgres.wrong") },
    { DATABASE_URL: exampleDatabaseUrl("db.abcdefghijklmnopqrst.supabase.co.example.invalid") },
    { DATABASE_URL: exampleDatabaseUrl("127.0.0.1") }, { DATABASE_URL: exampleDatabaseUrl("[::1]") },
    { DATABASE_URL: exampleDatabaseUrl(undefined, "service_role") }, { DATABASE_URL: exampleDatabaseUrl(undefined, undefined, 80) },
    { DATABASE_URL: exampleDatabaseUrl()+"?sslmode=disable" }, { DATABASE_URL: exampleDatabaseUrl()+"?sslmode=require" },
    { DATABASE_URL: exampleDatabaseUrl()+"?host=127.0.0.1" }, { DATABASE_URL: exampleDatabaseUrl()+"#ignored" },
    { DATABASE_URL: exampleDatabaseUrl().replace("/postgres", "/other") },
    { NEXT_PUBLIC_SUPABASE_URL: `http://${ref}.supabase.co` },
    { NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co/other` },
  ])("refuses malformed or cross-project settings %# before connecting", override => {
    expect(() => normalizationDatabaseCompletion({ ...env(), ...override })).toThrow("normalization_database_unavailable");
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
  it.each([["sequence", 54321, 54322], ["inherit-family-20260907", 55321, 55322]] as const)(
    "allows only explicitly paired %s local ports", (project, apiPort, dbPort) => {
      const local = { ...env(), INHERIT_LOCAL_E2E_PROJECT: project,
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${apiPort}`, DATABASE_URL: exampleDatabaseUrl("127.0.0.1", "postgres", dbPort) };
      expect(normalizationDatabaseConfig(local)?.ssl).toBe(false);
      for (const override of [{ VERCEL: "1" }, { VERCEL_ENV: "preview" }, { VERCEL_URL: "app.example.test" },
        { INHERIT_LOCAL_E2E_PROJECT: undefined }, { NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${apiPort}` },
        { DATABASE_URL: exampleDatabaseUrl("127.0.0.1", "postgres", dbPort + 1) }]) {
        expect(() => normalizationDatabaseConfig({ ...local, ...override })).toThrow("normalization_database_unavailable");
      }
    });
});

describe("one atomic completion transaction", () => {
  const complete = (deadline = performance.now() + 270_000) => normalizationDatabaseCompletion(env())!(identity, payload, deadline);
  it("binds identity/payload, sets local role/timeouts BEFORE completion and waits for COMMIT", async () => {
    const result = await complete();
    expect(result).toEqual({ data: receipt, error: null });
    expect(events).toEqual(["begin", "commit-sent", "commit-ack", "end"]);
    expect(queries).toHaveLength(3);
    expect(queries[0].text).toMatch(/set local role service_role/);
    expect(queries[1].text).toContain("set_config('statement_timeout'");
    expect(queries[1].text).toContain("set_config('lock_timeout', '5000', true)");
    expect(queries[1].text).toContain("set_config('idle_in_transaction_session_timeout', '5000', true)");
    expect(queries[1].values).toEqual(["180000"]);
    expect(queries[2].text).toContain("p_operation => 'complete'");
    expect(json).toHaveBeenCalledExactlyOnceWith(payload);
    expect(queries[2].values).toEqual([...Object.values(identity), { type: 114, value: payload }]);
    expect(queries[2].text).not.toContain(identity.p_account_id);
    expect(mocks.postgres).toHaveBeenCalledOnce();
    expect(mocks.postgres.mock.calls[0][0]).toMatchObject({ max: 1, prepare: false, fetch_types: false,
      connect_timeout: 5, idle_timeout: 5, connection: { application_name: "inherit-normalization-complete" } });
    expect(end).toHaveBeenCalledWith({ timeout: 0 });
  });
  it("does not return a callback receipt until COMMIT acknowledgement", async () => {
    let ack!: () => void; commitWait = new Promise(resolve => { ack = resolve; });
    let finished = false; const pending = complete().then(value => { finished = true; return value; });
    await vi.waitFor(() => expect(events).toContain("commit-sent"));
    expect(finished).toBe(false); expect(end).not.toHaveBeenCalled();
    ack(); expect((await pending).data).toEqual(receipt);
  });
  it.each(["query", "commit"])("refuses %s failure without retry or leaking provider details", async phase => {
    const secretError = new Error("private connection and payload must never escape");
    if (phase === "query") queryFailure = secretError; else commitFailure = secretError;
    await expect(complete()).rejects.toThrow(/^normalization_database_unavailable$/);
    expect(events).toContain("rollback"); expect(events).not.toContain("commit-ack");
    expect(mocks.postgres).toHaveBeenCalledOnce();
    expect(queries.filter(query => query.text.includes("own_upload_normalization_v1"))).toHaveLength(1);
    expect(end).toHaveBeenCalledWith({ timeout: 0 });
  });
  it.each([{ rows: [] }, { rows: [{ receipt: { ...receipt, fileId: identity.p_account_id } }] },
    { rows: [{ receipt: { ...receipt, analysisState: "active" } }] }])(
    "rolls back malformed or cross-source receipts %#", async ({ rows }) => {
      response = rows; await expect(complete()).rejects.toThrow("normalization_database_unavailable");
      expect(events).toEqual(["begin", "rollback", "end"]);
    });
  it("shrinks the statement budget to the actual remaining route budget", async () => {
    vi.spyOn(performance, "now").mockReturnValue(100_000);
    await complete(130_000); expect(queries[1].values).toEqual(["20000"]);
  });
  it.each([0, 14_999, Number.NaN, Number.POSITIVE_INFINITY])("refuses insufficient or invalid budget %s without connection", async budget => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    await expect(complete(budget)).rejects.toThrow("normalization_database_unavailable");
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
  it("force-closes a stuck COMMIT at the whole-call deadline and never reports success", async () => {
    vi.useFakeTimers(); vi.spyOn(performance, "now").mockReturnValue(0);
    commitWait = new Promise(() => {});
    const pending = complete(20_000); const rejected = expect(pending).rejects.toThrow("normalization_database_unavailable");
    await vi.advanceTimersByTimeAsync(20_000); await rejected;
    expect(events).toContain("commit-sent"); expect(events).not.toContain("commit-ack");
    expect(end).toHaveBeenCalledWith({ timeout: 0 }); expect(mocks.postgres).toHaveBeenCalledOnce();
  });
  it("sanitizes driver construction failure without a retry", async () => {
    mocks.postgres.mockImplementation(() => { throw new Error("private startup config"); });
    await expect(complete()).rejects.toThrow(/^normalization_database_unavailable$/);
    expect(mocks.postgres).toHaveBeenCalledOnce();
  });
  it("closes a connection that never finishes startup at the remaining route deadline", async () => {
    vi.useFakeTimers(); vi.spyOn(performance, "now").mockReturnValue(0);
    mocks.postgres.mockReturnValue({ begin: () => new Promise(() => {}), end });
    const rejected = expect(complete(15_000)).rejects.toThrow("normalization_database_unavailable");
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    expect(end).toHaveBeenCalledWith({ timeout: 0 }); expect(queries).toHaveLength(0);
  });
  it.each(["22023", "57014", "28P01", "CONNECT_TIMEOUT", "ENETUNREACH", "ERR_TLS_CERT_ALTNAME_INVALID"])(
    "logs only the fixed phase and allowed code %s", async code => {
      queryFailure = Object.assign(new Error("secret message with query and identity"), { code,
        query: "private query", parameters: ["private payload"], url: exampleDatabaseUrl() });
      await expect(complete()).rejects.toThrow(/^normalization_database_unavailable$/);
      expect(console.warn).toHaveBeenCalledExactlyOnceWith("normalization_database_failed", { phase: "complete", code });
    });
  it("does not log unknown codes, messages, identity, payload or credential strings", async () => {
    queryFailure = Object.assign(new Error("private message"), { code: "private credential", stack: "private stack",
      query: "private query", parameters: [payload, identity], url: exampleDatabaseUrl() });
    await expect(complete()).rejects.toThrow(/^normalization_database_unavailable$/);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("normalization_database_failed",
      { phase: "complete", code: "unavailable" });
  });
  it.each([{ invalid: "already encoded" }, { invalid: [] }, { invalid: null },
    { invalid: { value: undefined } }, { invalid: { value: BigInt(1) } }])(
    "refuses a non-object/non-JSON payload before connecting %#", async ({ invalid }) => {
      await expect(normalizationDatabaseCompletion(env())!(identity, invalid, performance.now()+60_000))
        .rejects.toThrow("normalization_database_unavailable");
      expect(mocks.postgres).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith("normalization_database_failed", { phase: "payload", code: "unavailable" });
    });
  it("refuses missing identity before opening a connection", async () => {
    await expect(normalizationDatabaseCompletion(env())!({ ...identity, p_claim: "" }, payload, performance.now()+60_000))
      .rejects.toThrow("normalization_database_unavailable");
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
});
