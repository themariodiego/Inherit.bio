import { describe, expect, it } from "vitest";
import { checkedDensityNativeObservation, densityNativeObservationSql, type DensityNativeObservation } from "./density-root-native-observers";

const H = "a".repeat(64), A = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-10-11T00:00:00.000Z");
function observation(): DensityNativeObservation {
  const bag = () => ({ count: 0, sha256: H });
  return { version: 1, complete: true,
    context: { systemIdentifier: "12345", databaseOid: 5, databaseName: "postgres", readOnly: true,
      isolation: "repeatable read", encoding: "UTF8", statementTimeout: "45s", lockTimeout: "250ms", backendPid: 42,
      observedAt: new Date(now).toISOString() },
    tableCount: 4, fieldCount: 4, tables: { count: 4, fieldCount: 4, sha256: H,
      kinds: { ordinary: 4, partitioned: 0, sequences: 0 },
      schemas: ["auth", "private", "public", "storage"].map(name => ({
        name: name as "auth" | "private" | "public" | "storage", count: 1, fieldCount: 1, sha256: H,
      })) }, authorization: { roles: { count: 1, sha256: H }, memberships: bag(), relations: { count: 4, sha256: H },
      attributes: { count: 4, sha256: H }, routines: { count: 1, sha256: H }, namespaces: { count: 4, sha256: H },
      policies: bag(), defaults: bag(), constraints: bag(), triggers: bag(), rewrites: bag(),
      types: bag(), indexes: bag(), inheritances: bag() }, actors: [], authSession: null, rightsSession: null };
}
const expected = { systemIdentifier: "12345", databaseOid: 5, actorIds: [], now };
const read = (value: unknown) => checkedDensityNativeObservation(value, expected);

describe("complete public density native observation boundary", () => {
  it("retains the whole closed observation without calling a native producer", () => {
    expect(read(observation())).toEqual(observation());
    expect(Buffer.byteLength(JSON.stringify(observation()))).toBeLessThan(32_768);
  });
  it("does not reinterpret absent authenticated session as a current session", () => {
    expect(() => checkedDensityNativeObservation(observation(), { ...expected, actorIds: [A], auth: { userId: A, sessionId: S } })).toThrow();
  });
  it("requires actual API actor and the exact live native session row", () => {
    const x = observation(); x.actors = [{ id: A, row: H }];
    x.authSession = { userId: A, sessionId: S, live: true, user: { count: 1, sha256: H }, session: { count: 1, sha256: H } };
    const e = { ...expected, actorIds: [A], auth: { userId: A, sessionId: S } };
    expect(checkedDensityNativeObservation(x, e)).toEqual(x);
    expect(() => checkedDensityNativeObservation({ ...x, authSession: { ...x.authSession, sessionId: A } }, e)).toThrow();
    expect(() => checkedDensityNativeObservation({ ...x, authSession: { ...x.authSession, live: false } }, e)).toThrow();
  });
  it("rejects the wrong database system identity and OID", () => {
    for (const context of [{ ...observation().context, systemIdentifier: "6789" }, { ...observation().context, databaseOid: 6 }])
      expect(() => read({ ...observation(), context })).toThrow();
  });
  it("refuses every omitted table, column and schema rather than reducing the census", () => {
    const x = observation();
    for (const value of [{ ...x, tables: { ...x.tables, schemas: x.tables.schemas.slice(1) } }, { ...x, fieldCount: 3 },
      { ...x, tableCount: 3 }, { ...x, tables: { ...x.tables, schemas: x.tables.schemas.map((r, i) => i === 0 ? { ...r, fieldCount: 0 } : r) } }])
      expect(() => read(value)).toThrow();
  });
  it("refuses duplicate schema identities and unsorted complete vectors", () => {
    const x = observation();
    for (const schemas of [[...x.tables.schemas].reverse(), x.tables.schemas.map((r, i) => i === 1 ? { ...x.tables.schemas[0] } : r)])
      expect(() => read({ ...x, tables: { ...x.tables, schemas } })).toThrow();
  });
  it("refuses inconsistent field or relation-kind totals", () => {
    const x = observation();
    for (const tables of [{ ...x.tables, fieldCount: 5 }, { ...x.tables, kinds: { ...x.tables.kinds, sequences: 1 } },
      { ...x.tables, schemas: x.tables.schemas.map((r, i) => i === 0 ? { ...r, count: 0 } : r) }])
      expect(() => read({ ...x, tables })).toThrow();
  });
  it("does not accept a row-only SHA label, missing authorization family or extra output", () => {
    const x = observation(), authorization = { ...x.authorization };
    Reflect.deleteProperty(authorization, "defaults");
    expect(() => read({ ...x, authorization })).toThrow();
    expect(() => read({ ...x, complete: false })).toThrow();
    expect(() => read({ ...x, rawError: "private value" })).toThrow();
    expect(() => read({ ...x, tables: { ...x.tables, sha256: "label" } })).toThrow();
  });
  it("rejects clock/connection facts that were not freshly observed", () => {
    for (const context of [{ ...observation().context, backendPid: 0 },
      { ...observation().context, observedAt: new Date(now - 60_001).toISOString() },
      { ...observation().context, observedAt: new Date(now + 5_001).toISOString() }]) expect(() => read({ ...observation(), context })).toThrow();
  });
  it("refuses writable, wrong-isolation or raised-cap native observations", () => {
    for (const context of [{ ...observation().context, readOnly: false },
      { ...observation().context, isolation: "read committed" }, { ...observation().context, statementTimeout: "900s" },
      { ...observation().context, lockTimeout: "1s" }]) expect(() => read({ ...observation(), context })).toThrow();
  });
  it("does not invoke an accessor, proxy or toJSON while parsing a native vector", () => {
    let calls = 0;
    expect(() => read(Object.defineProperty(observation(), "context", { enumerable: true, get() { calls++; return observation().context; } }))).toThrow();
    expect(() => read(new Proxy(observation(), { get() { calls++; return null; } }))).toThrow();
    expect(() => read({ ...observation(), toJSON() { calls++; return observation(); } })).toThrow();
    expect(calls).toBe(0);
  });
  it("retains empty/null/duplicate whole rows through native ordered jsonb aggregation", () => {
    const sql = densityNativeObservationSql({ actorIds: [] });
    expect(sql).toContain("begin isolation level repeatable read read only");
    expect(sql).toContain("set local statement_timeout='45s';set local lock_timeout='250ms'");
    expect(sql).toContain("coalesce(jsonb_agg(row order by row::text collate \"C\"),'[]'::jsonb)");
    expect(sql).toContain("select to_jsonb(r) row from %I.%I r offset 0");
    expect(sql).toContain("c.relkind in ('r','p','S')"); expect(sql.trim().endsWith("rollback;")).toBe(true);
    expect(sql).toContain("order by nspname collate \"C\",relname collate \"C\"");
    expect(sql).toContain("'columns',d.columns,'rows',x.vector::jsonb");
    expect(sql).toContain("'fieldCount',sum(field_count)");
    for (const catalog of ["pg_constraint", "pg_trigger", "pg_rewrite", "pg_type", "pg_index", "pg_inherits"])
      expect(sql).toContain(`pg_catalog.${catalog}`);
    for (const token of ["distinct row", "limit ", "create ", "insert ", "update ", "delete ", "pg_authid"])
      expect(sql.toLowerCase()).not.toContain(token);
  });
  it("rejects unregistered SQL selectors rather than interpolating source labels", () => {
    for (const actorIds of [["label"], [A, A], [A, S, A]]) expect(() => densityNativeObservationSql({ actorIds })).toThrow();
    expect(() => densityNativeObservationSql({ actorIds: [], rightsHash: "label" })).toThrow();
    expect(() => densityNativeObservationSql({ actorIds: [], auth: { userId: A, sessionId: "label" } })).toThrow();
  });
});
