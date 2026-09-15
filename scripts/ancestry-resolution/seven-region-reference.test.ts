import { describe, expect, it } from "vitest";
import { buildReference, canonicalJson, markerKey, REGION_CODES, validateInputs, type Counts, type Marker, type Population } from "./seven-region-reference";

function fixture() {
  const aims: Marker[] = Array.from({ length: 168 }, (_, i) => ({ rsid: `rs${i + 1}`, chrom: 1, pos38: 100 + i, ref: "A", alt: "C" }));
  const populations: Record<string, Population> = {};
  for (const region of REGION_CODES) {
    populations[`${region}-large`] = { region, samples: 100 };
    populations[`${region}-small`] = { region, samples: 10 };
  }
  const frequencies: Record<string, { rsid: string; ref: string; alt: string; pops: Record<string, Counts> }> = {};
  for (const marker of aims) frequencies[markerKey(marker)] = {
    rsid: marker.rsid, ref: marker.ref, alt: marker.alt,
    pops: Object.fromEntries(Object.keys(populations).map((name) => [name, name.endsWith("large") ? { ac: 200, an: 200 } : { ac: 0, an: 20 }])),
  };
  return { aims, frequencies, populations };
}

describe("seven-region reference generation", () => {
  it("caps the weight of called people at 30 and preserves marker order and alleles", () => {
    const f = fixture(), out = buildReference(validateInputs(f.aims, f.frequencies, f.populations));
    expect(out.map(({ rsid, chrom, pos38, ref, alt }) => ({ rsid, chrom, pos38, ref, alt }))).toEqual(f.aims);
    expect(out[0].freqs).toEqual(Object.fromEntries(REGION_CODES.map((r) => [r, 0.75])));
    // With only 10 called people in the large cohort, both cohorts weigh 10.
    f.frequencies[markerKey(f.aims[0])].pops["EUR-large"] = { ac: 20, an: 20 };
    expect(buildReference(validateInputs(f.aims, f.frequencies, f.populations))[0].freqs.EUR).toBe(0.5);
  });
  it("holds a population out before pooling and does not clip measured frequencies", () => {
    const f = fixture(), input = validateInputs(f.aims, f.frequencies, f.populations);
    expect(buildReference(input, "EUR-large")[0].freqs.EUR).toBe(0);
    expect(buildReference(input, "EUR-small")[0].freqs.EUR).toBe(1);
    expect(() => buildReference(input, "absent")).toThrow("Unknown held-out");
  });
  it("rejects missing records, population counts and uncalled populations instead of filling them", () => {
    const f = fixture(), key = markerKey(f.aims[0]);
    delete f.frequencies[key].pops["EUR-large"];
    expect(() => validateInputs(f.aims, f.frequencies, f.populations)).toThrow("missing or unexpected keys");
    f.frequencies[key].pops["EUR-large"] = { ac: 0, an: 0 };
    expect(() => validateInputs(f.aims, f.frequencies, f.populations)).toThrow(".an:");
    delete f.frequencies[key];
    expect(() => validateInputs(f.aims, f.frequencies, f.populations)).toThrow("missing or unexpected keys");
  });
  it.each([
    ["impossible copies", { ac: 201, an: 200 }],
    ["too many people", { ac: 0, an: 202 }],
    ["fractional copies", { ac: 0.5, an: 200 }],
    ["non-finite copies", { ac: Number.NaN, an: 200 }],
  ])("rejects %s", (_, counts) => {
    const f = fixture();
    f.frequencies[markerKey(f.aims[0])].pops["EUR-large"] = counts;
    expect(() => validateInputs(f.aims, f.frequencies, f.populations)).toThrow("expected an integer");
  });
  it("rejects allele swaps, duplicate markers and unrecognised population regions", () => {
    const f = fixture(), key = markerKey(f.aims[0]);
    f.frequencies[key].ref = "C";
    expect(() => validateInputs(f.aims, f.frequencies, f.populations)).toThrow("marker identity differs");
    f.frequencies[key].ref = "A";
    f.aims[1] = { ...f.aims[0] };
    expect(() => validateInputs(f.aims, f.frequencies, f.populations)).toThrow("duplicate marker");
    f.aims[1] = { rsid: "rs2", chrom: 1, pos38: 101, ref: "A", alt: "C" };
    expect(() => validateInputs(f.aims, f.frequencies, { ...f.populations, invalid: { region: "SAS", samples: 1 } })).toThrow("unknown region");
  });
  it("fails if a hold-out would leave a region without observations", () => {
    const f = fixture();
    delete f.populations["OCE-small"];
    for (const row of Object.values(f.frequencies)) delete row.pops["OCE-small"];
    const input = validateInputs(f.aims, f.frequencies, f.populations);
    expect(() => buildReference(input, "OCE-large")).toThrow("no observed counts for region OCE");
  });
  it("produces identical tables and source hashes after population object reordering", () => {
    const f = fixture();
    const reversed = Object.fromEntries(Object.entries(f.populations).reverse());
    expect(buildReference(validateInputs(f.aims, f.frequencies, reversed))).toEqual(buildReference(validateInputs(f.aims, f.frequencies, f.populations)));
    expect(canonicalJson({ b: [1, { z: 2, a: 3 }], a: 2 })).toBe(canonicalJson({ a: 2, b: [1, { a: 3, z: 2 }] }));
  });
});
