import { describe, expect, it } from "vitest";
import { EMPTY_REPORT_FILTER_SNAPSHOT, MAX_REPORT_QUERY_LENGTH, REPORT_FILTER_HISTORY_KEY,
  reportFilterSnapshot, withReportFilters } from "./report-filter-history";

const subject = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const preferences = { query: "MCM6", withResults: true };
describe("report filter navigation preferences", () => {
  it("preserves opaque Next history keys without mutating the old entry", () => {
    const next = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["opaque"] };
    const saved = withReportFilters(next, subject, "estimate", preferences);
    expect(saved.__NA).toBe(true); expect(saved.__PRIVATE_NEXTJS_INTERNALS_TREE).toBe(next.__PRIVATE_NEXTJS_INTERNALS_TREE);
    expect(next).not.toHaveProperty(REPORT_FILTER_HISTORY_KEY);
    expect(reportFilterSnapshot(saved, subject, "estimate")).toBe(JSON.stringify(preferences));
  });
  it("never reuses another subject's or another layer's preferences", () => {
    const saved = withReportFilters(null, subject, "estimate", preferences);
    expect(reportFilterSnapshot(saved, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "estimate")).toBe(EMPTY_REPORT_FILTER_SNAPSHOT);
    expect(reportFilterSnapshot(saved, subject, "variant-call")).toBe(EMPTY_REPORT_FILTER_SNAPSHOT);
  });
  it("clear replaces preferences instead of accumulating a new history record", () => {
    const saved = withReportFilters(null, subject, "estimate", preferences);
    const cleared = withReportFilters(saved, subject, "estimate", { query: "", withResults: false });
    expect(reportFilterSnapshot(cleared, subject, "estimate")).toBe(EMPTY_REPORT_FILTER_SNAPSHOT);
    expect(Object.keys(cleared)).toEqual([REPORT_FILTER_HISTORY_KEY]);
  });
  it.each([null, [], "text", {}, { [REPORT_FILTER_HISTORY_KEY]: null },
    { [REPORT_FILTER_HISTORY_KEY]: { subjectId: subject, layer: "estimate", query: "x", withResults: "true" } },
    { [REPORT_FILTER_HISTORY_KEY]: { subjectId: subject, layer: "estimate", query: "x", withResults: true, result: "not allowed" } },
    { [REPORT_FILTER_HISTORY_KEY]: { subjectId: subject, layer: "estimate", query: "x".repeat(201), withResults: true } },
  ])("uses safe defaults for malformed or overlong state", state => {
    expect(reportFilterSnapshot(state, subject, "estimate")).toBe(EMPTY_REPORT_FILTER_SNAPSHOT);
  });
  it("allows exactly the input length cap and rejects unbounded writes", () => {
    const saved = withReportFilters({}, subject, "estimate", { query: "x".repeat(MAX_REPORT_QUERY_LENGTH), withResults: false });
    expect(JSON.parse(reportFilterSnapshot(saved, subject, "estimate")).query).toHaveLength(MAX_REPORT_QUERY_LENGTH);
    expect(() => withReportFilters({}, subject, "estimate", { query: "x".repeat(201), withResults: false })).toThrow("too long");
  });
});
