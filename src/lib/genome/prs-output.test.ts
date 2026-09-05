import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Db } from "./load";
import { loadPrsForChat, loadPrsForExport, serializePrsCoverage } from "./prs-output";

const META = { pgs_id: "PGS000011", name: "Panel", trait: "Trait", n_variants: 50, ancestry_note: "Source cohort", citation: { pmid: "123" } };
const ROW = { pgs_id: META.pgs_id, file_id: "file-a", matched: 25, computed_at: "2026-09-05T10:00:00Z", raw_score: 7.12345, zscore: 3.87654, percentile: 99.87654, risk: 0.12345 };
type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; operation: string; args: unknown[] };

function mockDb(results: Result[]) {
  const calls: Call[] = [];
  const take = () => {
    const result = results.shift();
    if (!result) throw new Error("unexpected query");
    return Promise.resolve(result);
  };
  const db = {
    from(table: string) {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      for (const operation of ["select", "eq", "in", "order", "range", "maybeSingle", "limit"]) {
        chain[operation] = (...args) => {
          calls.push({ table, operation, args });
          if (["range", "maybeSingle", "limit"].includes(operation)) return take();
          if (operation === "in") return take();
          return chain;
        };
      }
      return chain;
    },
  } as unknown as Db;
  return { db, calls };
}
const ok = (data: unknown): Result => ({ data, error: null });
const failed = (): Result => ({ data: null, error: { message: "private database details" } });

function expectNoScores(value: unknown) {
  const json = JSON.stringify(value);
  expect(json).not.toMatch(/"(?:raw_score|raw|zscore|percentile|risk)"/);
  for (const number of [ROW.raw_score, ROW.zscore, ROW.percentile, ROW.risk]) expect(json).not.toContain(String(number));
}

describe("PRS output eligibility", () => {
  it.each([0, 25, 50])("withholds personal score quantities even with %i matched positions", (matched) => {
    const output = serializePrsCoverage({ ...ROW, matched }, 50);
    expect(output).toMatchObject({ status: "unavailable", reason: "no_validated_reference", coverage: { matched, required: 50 } });
    expectNoScores(output);
  });
  it.each([-1, 51, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid matched count %s", (matched) => {
    expect(serializePrsCoverage({ matched }, 50).coverage).toBeNull();
  });
  it.each([undefined, null, 0, -1, 2.5, NaN, Infinity])("does not invent missing or invalid panel size %s", (needed) => {
    expect(serializePrsCoverage(ROW, needed).coverage).toBeNull();
  });
  it("does not turn absent data into zero coverage", () => {
    expect(serializePrsCoverage(null, 50).coverage).toBeNull();
  });
});

describe("chat PRS query boundary", () => {
  it("selects only coverage, scopes the subject, and drops unexpected legacy quantities", async () => {
    const { db, calls } = mockDb([ok({ ...META, percentile: 99.87654 }), ok([ROW])]);
    const output = await loadPrsForChat(db, "subject-a", META.pgs_id, true);
    expect(output).toMatchObject({ pgs_id: META.pgs_id, result: { coverage: { matched: 25, required: 50 }, status: "unavailable" } });
    expectNoScores(output);
    expect(calls).toContainEqual({ table: "user_prs", operation: "select", args: ["matched"] });
    expect(calls).toContainEqual({ table: "user_prs", operation: "eq", args: ["subject_id", "subject-a"] });
    expect(calls).toContainEqual({ table: "user_prs", operation: "eq", args: ["pgs_id", META.pgs_id] });
  });
  it("does not query a result when no processed file exists", async () => {
    const { db, calls } = mockDb([ok(META)]);
    expect(await loadPrsForChat(db, "subject-a", META.pgs_id, false)).toMatchObject({ result: { coverage: null, status: "unavailable" } });
    expect(calls.some((call) => call.table === "user_prs")).toBe(false);
  });
  it("keeps an absent result distinct from zero matched positions", async () => {
    const { db } = mockDb([ok(META), ok([])]);
    expect(await loadPrsForChat(db, "subject-a", META.pgs_id, true)).toMatchObject({ result: { coverage: null } });
  });
  it.each([null, undefined, "50", -1, NaN])("withholds coverage for malformed reference panel size %s", async (n_variants) => {
    const { db } = mockDb([ok({ ...META, n_variants }), ok([ROW])]);
    const output = await loadPrsForChat(db, "subject-a", META.pgs_id, true);
    expect(output).toMatchObject({ result: { status: "unavailable", coverage: null } });
    expectNoScores(output);
  });
  it("rejects an invalid identifier before querying", async () => {
    const { db, calls } = mockDb([]);
    expect(await loadPrsForChat(db, "subject-a", "not-a-score", true)).toEqual({ error: "unknown score id" });
    expect(calls).toHaveLength(0);
  });
  it.each([[failed()], [ok(null)], [ok(META), failed()]])("fails closed on unavailable metadata or result", async (...results) => {
    const { db } = mockDb(results as Result[]);
    const output = await loadPrsForChat(db, "subject-a", META.pgs_id, true);
    expect(output).toHaveProperty("error");
    expect(JSON.stringify(output)).not.toContain("private database");
  });
});

describe("export PRS query boundary", () => {
  it("preserves provenance and paginates short pages without serializing legacy scores", async () => {
    const { db, calls } = mockDb([ok([ROW]), ok([{ ...ROW, file_id: "file-b", matched: 50 }]), ok([]), ok([META])]);
    const output = await loadPrsForExport(db, "account-a");
    expect(output).toHaveLength(2);
    expect(output[1]).toMatchObject({ file_id: "file-b", computed_at: ROW.computed_at, coverage: { matched: 50, required: 50 }, status: "unavailable" });
    expectNoScores(output);
    expect(calls.filter((call) => call.operation === "range").map((call) => call.args)).toEqual([[0, 999], [1, 1000], [2, 1001]]);
    expect(calls.filter((call) => call.operation === "eq")).toEqual(Array(3).fill({ table: "user_prs", operation: "eq", args: ["user_id", "account-a"] }));
    for (const call of calls.filter((call) => call.operation === "select")) expect(String(call.args[0])).not.toMatch(/raw_score|zscore|percentile/);
  });
  it("does not invent a denominator if score metadata is unavailable", async () => {
    const { db } = mockDb([ok([ROW]), ok([]), ok([])]);
    expect(await loadPrsForExport(db, "account-a")).toMatchObject([{ pgs_id: META.pgs_id, coverage: null, status: "unavailable" }]);
  });
  it("returns an empty list without metadata lookup for no results", async () => {
    const { db, calls } = mockDb([ok([])]);
    expect(await loadPrsForExport(db, "account-a")).toEqual([]);
    expect(calls.some((call) => call.table === "prs_scores")).toBe(false);
  });
  it.each([[failed()], [ok([ROW]), ok([]), failed()]])("does not silently export partial results after a query error", async (...results) => {
    const { db } = mockDb(results as Result[]);
    await expect(loadPrsForExport(db, "account-a")).rejects.toThrow(/export unavailable/);
  });
});

describe("application wiring", () => {
  it("keeps both route boundaries on the shared coverage-only loaders", () => {
    const chat = readFileSync("src/app/api/chat/route.ts", "utf8");
    const exportRoute = readFileSync("src/app/api/export/route.ts", "utf8");
    expect(chat).toContain("loadPrsForChat(admin, subject.id, score_id, files.length > 0)");
    expect(exportRoute).toContain("loadPrsForExport(admin, user.id)");
    expect(chat).not.toContain('.from("user_prs")');
    expect(exportRoute).not.toContain('.from("user_prs")');
    expect(exportRoute).toContain('prs_format: "coverage-only-v1"');
    expect(chat).not.toContain("clinvar_significance");
    expect(chat).not.toContain("gnomad_af");
  });
});
