import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Db } from "./load";
import { loadPrsForExport, serializePrsCoverage } from "./prs-output";

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
      for (const operation of ["select", "eq", "in", "is", "order", "range", "maybeSingle", "limit"]) {
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

// "chat PRS query boundary" (6 tests, 12 cases, over loadPrsForChat) left with that
// loader on 24 October 2026 (G8.5): only the retired compatibility chat branch
// called it. The own chat reads coverage from its server projection; see the
// wiring test below and docs/test-diff-register.md.

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
    // G8.5 (24 October 2026): the chat route reads no score itself. Its own
    // branch reads coverage only from the server's authorized projection and
    // serializes it through the captured coverage result.
    const chat = readFileSync("src/app/api/chat/route.ts", "utf8") + readFileSync("src/lib/copilot/own-chat-route.ts", "utf8");
    const exportRoute = readFileSync("src/app/api/export/route.ts", "utf8");
    expect(chat).toContain("await pages('prs', ownChatPrsSchema)");
    expect(chat).toContain("capturedPrsResult(rows, score_id)");
    expect(chat).not.toContain("loadPrsForChat");
    expect(exportRoute).toContain("loadPrsForExport(admin, user.id)");
    expect(chat).not.toContain('.from("user_prs")');
    expect(chat).not.toContain(".from('user_prs')");
    expect(exportRoute).not.toContain('.from("user_prs")');
    expect(exportRoute).toContain('prs_format: "coverage-only-v1"');
    expect(chat).not.toContain("clinvar_significance");
    expect(chat).not.toContain("gnomad_af");
  });
});
