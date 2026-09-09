import { describe, expect, it } from "vitest";
import { preparationRecordBytes } from "./own-preparation-artifacts";
describe("prepared event byte bound", () => {
  it.each(["A".repeat(1_000_000), "\"\\\b\t\n\f\r\u0000", "é😀\ud800", "A/C"])("counts exact serialized bytes without first building whole JSON", text => {
    const value = { type: "variant", line: 1, record: { genotype: text, ref: null, alt: "C", pos: 42, chrom: 1, rsid: 762551 } };
    expect(preparationRecordBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value)));
  });
  it("refuses an oversized allele before JSON serialization", () => {
    expect(() => preparationRecordBytes({ allele: "A".repeat(1001) }, 1000)).toThrow("too_large");
  });
  it("does not invoke accessors", () => {
    let called = false; const value = { get genotype() { called = true; return "A/C"; } };
    expect(() => preparationRecordBytes(value)).toThrow("integrity_mismatch"); expect(called).toBe(false);
  });
});
