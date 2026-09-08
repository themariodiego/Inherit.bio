import { describe, expect, it } from "vitest";
import type { PreparedReportCallPage } from "./report-call-pages";
import { createPreparedReportEvidenceBudget, PREPARED_REPORT_MAX_ROWS, PREPARED_REPORT_MAX_BYTES,
  PREPARED_REPORT_MAX_PAGES, PreparedReportEvidenceLimitError } from "./report-evidence-budget";

type Evidence = PreparedReportCallPage["variants"][number];
const row = (sourceLine = 1, genotype = "A/C"): Evidence => ({ sourceLine, call: {
  file_id: "11111111-1111-4111-8111-111111111111", rsid: 762551, chrom: 15,
  pos: 74749576, ref: "A", alt: "C", genotype,
} });
const page = (variants: Evidence[] = [], observations: Evidence[] = []): PreparedReportCallPage => ({ variants, observations });
const size = (value: Evidence) => Buffer.byteLength(JSON.stringify(value), "utf8");
function sizedRow(bytes: number): Evidence {
  const value = row(1, ""), overhead = size(value);
  if (bytes < overhead) throw new Error("synthetic_size_too_small");
  value.call.genotype = "A".repeat(bytes - overhead);
  expect(size(value)).toBe(bytes); return value;
}

describe("whole-purpose prepared report evidence budget", () => {
  it("leaves ordinary evidence and original array identities unchanged", () => {
    const budget = createPreparedReportEvidenceBudget(), input = page([row()], [row(2, "--")]);
    const before = structuredClone(input), variants = input.variants, observations = input.observations;
    expect(() => budget.consume(input)).not.toThrow();
    expect(input).toEqual(before); expect(input.variants).toBe(variants); expect(input.observations).toBe(observations);
    expect(Object.keys(budget)).toEqual(["consume"]);
  });
  it("shares row totals across pages and both streams, accepting8192 then refusing the8193rd", () => {
    const budget = createPreparedReportEvidenceBudget();
    for (let i = 0; i < 8; i++) budget.consume(page(Array.from({ length: 500 }, () => row()), Array.from({ length: 500 }, () => row())));
    expect(() => budget.consume(page([], Array.from({ length: PREPARED_REPORT_MAX_ROWS - 8000 }, () => row())))).not.toThrow();
    expect(() => budget.consume(page([row()]))).toThrow(expect.objectContaining({ code: "selected_evidence_limit", limit: "rows" }));
  });
  it("refuses a whole page when its combined streams exceed remaining rows", () => {
    const budget = createPreparedReportEvidenceBudget();
    for (let i = 0; i < 8; i++) budget.consume(page(Array.from({ length: 1000 }, () => row())));
    const last = page(Array.from({ length: 96 }, () => row()), Array.from({ length: 97 }, () => row()));
    const before = structuredClone(last);
    expect(() => budget.consume(last)).toThrow(expect.objectContaining({ limit: "rows" }));
    expect(last).toEqual(before);
    expect(() => budget.consume(page())).toThrow(expect.objectContaining({ limit: "rows" }));
  });
  it("accepts exactly8MiB of real serialized bytes across two pages and both streams", () => {
    const budget = createPreparedReportEvidenceBudget(), first = sizedRow(4_000_000), last = sizedRow(PREPARED_REPORT_MAX_BYTES - size(first));
    budget.consume(page([first]));
    expect(() => budget.consume(page([], [last]))).not.toThrow();
    expect(() => budget.consume(page([row()]))).toThrow(expect.objectContaining({ limit: "bytes" }));
  });
  it("refuses crossing the cumulative serialized byte boundary by exactly one byte", () => {
    const budget = createPreparedReportEvidenceBudget(), first = sizedRow(4_000_000);
    budget.consume(page([], [first]));
    const last = sizedRow(PREPARED_REPORT_MAX_BYTES - size(first) + 1);
    expect(() => budget.consume(page([last]))).toThrow(expect.objectContaining({ limit: "bytes" }));
    expect(() => budget.consume(page([row()]))).toThrow(expect.objectContaining({ limit: "bytes" }));
  });
  it("counts UTF-8 bytes and the sourceLine/call envelope rather than genotype characters", () => {
    const budget = createPreparedReportEvidenceBudget(), last = row(37, "é");
    const utf16Length = JSON.stringify(last).length;
    expect(size(last)).toBe(utf16Length + 1);
    budget.consume(page([sizedRow(PREPARED_REPORT_MAX_BYTES - utf16Length)]));
    expect(() => budget.consume(page([], [last]))).toThrow(expect.objectContaining({ limit: "bytes" }));
  });
  it("caps repeated empty progress at64 pages across all locus chunks", () => {
    const budget = createPreparedReportEvidenceBudget();
    for (let i = 0; i < PREPARED_REPORT_MAX_PAGES; i++) expect(() => budget.consume(page())).not.toThrow();
    expect(() => budget.consume(page())).toThrow(expect.objectContaining({ limit: "pages" }));
  });
  it("counts nonempty and empty pages toward the same limit", () => {
    const budget = createPreparedReportEvidenceBudget();
    for (let i = 0; i < PREPARED_REPORT_MAX_PAGES; i++) budget.consume(i % 2 ? page() : page([row()]));
    expect(() => budget.consume(page([], [row()]))).toThrow(expect.objectContaining({ limit: "pages" }));
  });
  it("separates purpose budgets while retaining no caller references", () => {
    const first = createPreparedReportEvidenceBudget(), second = createPreparedReportEvidenceBudget(), input = page([row()]);
    first.consume(input); input.variants.length = 0;
    for (let i = 1; i < PREPARED_REPORT_MAX_PAGES; i++) first.consume(input);
    expect(() => first.consume(input)).toThrow(PreparedReportEvidenceLimitError);
    expect(() => second.consume(input)).not.toThrow();
  });
});
