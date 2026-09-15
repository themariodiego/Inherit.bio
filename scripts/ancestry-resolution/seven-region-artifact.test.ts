import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { REFERENCE_VERSION, REGION_CODES, type Marker, type ReferenceMarker } from "./seven-region-reference";
import { REGIONAL_REFERENCE_JSON } from "../../src/lib/genome/regional-reference-json";
import { REGIONAL_AIMS } from "../../src/lib/genome/regional-admixture";

describe("committed seven-region reference", () => {
  it("binds every exact original marker and its frequencies to both manifest hashes", () => {
    const data = path.join(process.cwd(), "data/ref");
    const aims = JSON.parse(fs.readFileSync(path.join(data, "aims.json"), "utf8")) as Marker[];
    const bytes = fs.readFileSync(path.join(data, "aims-seven-region.json"), "utf8");
    const markers = JSON.parse(bytes) as ReferenceMarker[];
    const manifest = JSON.parse(fs.readFileSync(path.join(data, "aims-seven-region-manifest.json"), "utf8"));
    const identity = ({ rsid, chrom, pos38, ref, alt }: Marker) => ({ rsid, chrom, pos38, ref, alt });
    expect(markers).toHaveLength(168);
    expect(markers.map(identity)).toEqual(aims.map(identity));
    for (const marker of markers) {
      expect(Object.keys(marker)).toEqual(["rsid", "chrom", "pos38", "ref", "alt", "freqs"]);
      expect(Object.keys(marker.freqs)).toEqual(REGION_CODES);
      for (const value of Object.values(marker.freqs)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
    expect(manifest.markerSha256).toBe(sha256(JSON.stringify(markers)));
    expect(manifest.tableSha256).toBe(sha256(bytes));
    // The runtime string must retain every scalar and its original key/row order,
    // rather than accepting a bundler's slightly different floating-point values.
    expect(REGIONAL_REFERENCE_JSON).toBe(JSON.stringify(markers));
    expect(JSON.stringify(REGIONAL_AIMS)).toBe(REGIONAL_REFERENCE_JSON);
    expect(REGIONAL_AIMS).toEqual(markers);
    expect(manifest.panelId).toBe("aims-hgdp-tgp-168");
    expect(manifest.referenceVersion).toBe(REFERENCE_VERSION);
    expect(manifest.markerCount).toBe(168);
    expect(manifest.populationCount).toBe(78);
    expect(manifest.referenceSampleCount).toBe(4097);
  });
});
