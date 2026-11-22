import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { untar, selectFromPopulation, verifyPanel } from "./build-neanderthal-sites";

const ROOT = path.resolve(__dirname, "..");

describe("Neanderthal panel build and provenance", () => {
  it("verifies every committed site and both input hashes offline, with no network", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network permitted"));
    try {
      const { siteCount, sitesSha256 } = await verifyPanel();
      expect(siteCount).toBeGreaterThan(0);
      // Pin the conversion output's hash: the committed GRCh38 panel must be
      // exactly the one the manifest records (built from the GRCh37 source
      // through the bundled Ensembl chain). A silent change to either the
      // source subset or the liftover moves this and fails here.
      expect(sitesSha256).toBe("21f0862ed04f21ddd3fc338b599088e8f5d24b1f928547b4b79030a1b4709e93");
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it("the manifest records the exact dataset, licence, counts and conversion", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "data/ref/neanderthal/manifest.json"), "utf8"));
    expect(manifest.sourceDoi).toBe("10.17632/y7hyt83vxr.1");
    expect(Object.keys(manifest.sourceFiles).sort()).toEqual(["CEU", "CHB", "GIH"]);
    expect(manifest.panelId).toBe("neanderthal-sprime-1kg-v1");
    // Every conversion outcome is recorded, so the number dropped or ambiguous
    // is auditable: selected across populations, merged unique GRCh37 sites,
    // conflicting, unmapped by liftover, and collisions after lifting.
    for (const key of ["selected", "merged", "conflicting", "unmapped", "collisions"]) {
      expect(typeof manifest.counts[key]).toBe("number");
    }
    expect(manifest.siteCount).toBe(manifest.counts.merged - manifest.counts.conflicting - manifest.counts.unmapped - manifest.counts.collisions);
  });

  it("the sites file ships the CC BY 4.0 attribution text", () => {
    const panel = JSON.parse(readFileSync(path.join(ROOT, "data/ref/neanderthal/sites.json"), "utf8"));
    expect(panel.licence).toContain("CC BY 4.0");
    expect(panel.licence).toContain("10.17632/y7hyt83vxr.1");
    expect(panel.licence).toContain("Browning");
  });

  it("untar reads a minimal ustar archive", () => {
    // A one-file archive built by hand: name, octal size, type '0', body.
    const name = Buffer.alloc(100); name.write("mendeley_data/x.ND_match");
    const header = Buffer.alloc(512);
    name.copy(header, 0);
    header.write("000000644\0", 100);
    header.write("0", 156);
    const body = "CHROM\tPOS\n1\t2\n";
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
    padded.write(body);
    const files = untar(Buffer.concat([header, padded, Buffer.alloc(1024)]));
    expect(files.get("mendeley_data/x.ND_match")).toBe(body);
  });

  it("selectFromPopulation keeps NMATCH=match/DMATCH=mismatch biallelic rs rows, one per segment", () => {
    const body = [
      "CHROM\tPOS\tID\tREF\tALT\tSEGMENT\tALLELE\tSCORE\tNMATCH\tDMATCH",
      "1\t100\trs1\tA\tG\t5\t1\t200000\tmatch\tmismatch",     // kept: archaic=ALT=G
      "1\t200\trs2\tC\tT\t5\t0\t200000\tmatch\tmismatch",     // same segment: median keeps one
      "1\t300\trs3\tA\tT\t6\t1\t200000\tmatch\tmismatch",     // dropped: A/T strand-ambiguous
      "1\t400\trs4\tA\tG\t7\t1\t200000\tmatch\tmatch",        // dropped: Denisovan also matches
      "1\t500\t.\tA\tG\t8\t1\t200000\tmatch\tmismatch",       // dropped: no rsID
    ].join("\n");
    const files = new Map<string, string>();
    files.set("mendeley_data/CEU.chr1.ND_match", body);
    for (let chrom = 2; chrom <= 22; chrom++) files.set(`mendeley_data/CEU.chr${chrom}.ND_match`, "CHROM\tPOS\tID\tREF\tALT\tSEGMENT\tALLELE\tSCORE\tNMATCH\tDMATCH");
    const selected = selectFromPopulation(files, "CEU");
    // One site for segment 5, nothing for 6/7/8.
    expect(selected).toHaveLength(1);
    expect(selected[0].chrom).toBe(1);
    expect(["A", "C", "G", "T"]).toContain(selected[0].archaic);
  });
});
