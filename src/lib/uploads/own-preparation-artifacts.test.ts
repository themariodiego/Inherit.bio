import { describe, expect, it } from "vitest";
import { preparationCheckpointJson, preparationJson, preparationRecordBytes } from "./own-preparation-artifacts";
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

describe("original locator checkpoint bounds", () => {
  const key = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/original-44444444-4444-4444-8444-444444444444.vcf";
  it("permits the exact original locator only in checkpoint metadata", () => {
    const value = { sourceScan: { source: { objectKey: key } } };
    expect(Buffer.from(preparationCheckpointJson(value)).toString()).toBe(JSON.stringify(value));
    expect(() => preparationJson(value)).toThrow("invalid_manifest");
  });
  it.each([key + "/foreign", key + "?token=synthetic", key.replace(".vcf", ".part")])(
    "refuses a non-original locator without increasing the field limit", invalid => {
      expect(() => preparationCheckpointJson({ objectKey: invalid })).toThrow("invalid_manifest");
    });
  it("keeps non-locator string and total byte bounds", () => {
    expect(() => preparationCheckpointJson({ note: key })).toThrow("invalid_manifest");
    const value = { objectKey: key };
    expect(() => preparationCheckpointJson(value, Buffer.byteLength(JSON.stringify(value)) - 1)).toThrow("too_large");
  });
  it("refuses accessors before reading a source locator", () => {
    let read = false;
    const value = { get objectKey() { read = true; return key; } };
    expect(() => preparationCheckpointJson(value)).toThrow("invalid_manifest");
    expect(read).toBe(false);
  });
});
