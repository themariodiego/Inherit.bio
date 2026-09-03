import { describe, expect, it } from "vitest";
import allowedNames from "../../../data/allowed-external-names.json";
import denylist from "../../../data/ref/regions/label-denylist.json";
import regionsJson from "../../../data/ref/regions/regions.json";
import committed from "../../../public/geo/regions.topo.json";
import { AIMS, POPS, RELIABLE_FRACTION } from "@/lib/genome/admixture";
import { bboxCentre, pathBBox, unproject } from "@/lib/geo/project";
import { polygonsOf, type Topology } from "@/lib/geo/topojson";
import { MIN_MARKERS, PANEL, SOURCES } from "./panel";
import { regionAccessibleName } from "./present";
import { REGIONS, REGION_RELEASE, qualifies, regionForPop, tierQualifies } from "./regions";

/** supabase/migrations/20260831224117_ancestry_regions.sql */
const REGION_CODE = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const RELEASE_ID = /^ancestry-regions-v[0-9]+$/;

/** The denylist's stated matching rule: whole-word, case-insensitive, after NFKD fold. */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function deniedWordIn(label: string): string | null {
  const folded = fold(label);
  for (const word of denylist.words) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${fold(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
    if (pattern.test(folded)) return word;
  }
  return null;
}

describe("the region release", () => {
  it("has a release id and region codes that satisfy the ref_regions constraints", () => {
    expect(REGION_RELEASE.release_id).toMatch(RELEASE_ID);
    expect(REGION_RELEASE.release_id).toBe("ancestry-regions-v1");
    const codes = REGIONS.map((region) => region.code);
    for (const code of codes) expect(code).toMatch(REGION_CODE);
    expect(new Set(codes).size).toBe(codes.length);
    for (const region of REGIONS) expect(region.sort_order).toBeGreaterThanOrEqual(0);
  });

  it("names the shipped panel, never retyped", () => {
    expect(REGION_RELEASE.panel).toEqual({
      id: PANEL.id,
      version: PANEL.version,
      markers: AIMS.length,
      provenance: PANEL.provenance,
    });
    expect(AIMS.length).toBe(168);
  });

  it("derives min_markers from RELIABLE_FRACTION × the panel size (42 for the shipped panel)", () => {
    expect(MIN_MARKERS).toBe(Math.ceil(RELIABLE_FRACTION * AIMS.length));
    expect(MIN_MARKERS).toBe(42);
    for (const region of REGIONS) expect(region.min_markers).toBe(MIN_MARKERS);
  });

  it("maps POPS to regions as a bijection", () => {
    expect([...REGIONS.map((region) => region.superpop)].sort()).toEqual([...POPS].sort());
    for (const pop of POPS) {
      const region = regionForPop(pop);
      expect(region.superpop).toBe(pop);
      expect(REGIONS.filter((candidate) => candidate.superpop === pop)).toHaveLength(1);
    }
    for (const region of REGIONS) expect(region.tier).toBe("continental");
  });

  it("counts every population once, with the sizes counted from the phase 3 sample panel", () => {
    const codes = REGIONS.flatMap((region) => region.population_codes);
    expect(new Set(codes).size).toBe(26);
    const totals: Record<string, number> = {};
    for (const region of REGIONS) {
      expect(region.population_codes).toEqual(region.populations.map((population) => population.code));
      expect(region.n_total).toBe(region.populations.reduce((sum, population) => sum + population.n, 0));
      expect(region.populations.length).toBeGreaterThan(0);
      totals[region.superpop] = region.n_total;
      for (const population of region.populations) {
        expect(population.code).toMatch(/^[A-Z]{3}$/);
        expect(population.n).toBeGreaterThan(0);
        expect(population.sampled_in.length).toBeGreaterThan(0);
        expect(typeof population.diaspora).toBe("boolean");
      }
    }
    // data/ref/regions/PROVENANCE.md: integrated_call_samples_v3.20130502.ALL.panel, 2,504 samples.
    expect(totals).toEqual({ AFR: 661, AMR: 347, EAS: 504, EUR: 503, SAS: 489 });
    expect(Object.values(totals).reduce((sum, n) => sum + n, 0)).toBe(2504);
  });

  it("orders regions by sort_order and keeps the raw file's regions in the same set", () => {
    expect(REGIONS.map((region) => region.sort_order)).toEqual([0, 1, 2, 3, 4]);
    expect([...regionsJson.regions.map((region) => region.code)].sort()).toEqual(
      [...REGIONS.map((region) => region.code)].sort(),
    );
  });

  it("records label anchors that match the committed geometry's projected bbox centre", () => {
    const topology = committed as unknown as Topology;
    for (const region of REGIONS) {
      const bbox = pathBBox(polygonsOf(topology, region.code));
      expect(bbox, region.code).not.toBeNull();
      const [x, y] = bboxCentre(bbox!);
      const [lon, lat] = unproject(x, y);
      expect(region.centroid_lon).toBe(Math.round(lon * 100) / 100);
      expect(region.centroid_lat).toBe(Math.round(lat * 100) / 100);
    }
  });

  it("cites the 1000 Genomes phase 3 paper for every region and lists the panel sources once each", () => {
    for (const region of REGIONS) expect(region.citation_ids).toContain("doi:10.1038/nature15393");
    const ids = SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("doi:10.1038/nature15393");
  });
});

describe("qualification", () => {
  it("qualifies a region at 42 markers and not at 41", () => {
    for (const region of REGIONS) {
      expect(qualifies(region, 41)).toBe(false);
      expect(qualifies(region, 42)).toBe(true);
      expect(qualifies(region, 0)).toBe(false);
      expect(qualifies(region, AIMS.length)).toBe(true);
    }
  });

  it("renders a tier's control only when at least one region in it qualifies", () => {
    expect(tierQualifies("continental", 0)).toBe(false);
    expect(tierQualifies("continental", 41)).toBe(false);
    expect(tierQualifies("continental", 42)).toBe(true);
    expect(tierQualifies("sub-continental", AIMS.length)).toBe(false);
  });
});

describe("the label denylist", () => {
  it("has the stated schema and unique words", () => {
    expect(denylist.schemaVersion).toBe(1);
    expect(denylist.matching).toBe("whole-word, case-insensitive, after NFKD fold");
    expect(denylist.words.length).toBeGreaterThanOrEqual(40);
    expect(new Set(denylist.words.map(fold)).size).toBe(denylist.words.length);
    expect(deniedWordIn("Admixed American")).toBe("American");
    expect(deniedWordIn("the Iberian Peninsula and southwest France")).toBeNull();
    expect(deniedWordIn("Puerto Rico")).toBeNull();
  });

  it("bites on the demonyms the old page used", () => {
    for (const label of ["African", "Admixed American", "East Asian", "European", "South Asian"]) {
      expect(deniedWordIn(label), label).not.toBeNull();
    }
  });

  it("matches no region display name, and no accessible name built from one", () => {
    for (const region of REGIONS) {
      expect(deniedWordIn(region.display_name), region.display_name).toBeNull();
      const withRange = regionAccessibleName(region.display_name, { point: 0.432, range: { low: 0.38, high: 0.48 } });
      const withoutRange = regionAccessibleName(region.display_name, { point: 0.432 });
      expect(deniedWordIn(withRange)).toBeNull();
      expect(deniedWordIn(withoutRange)).toBeNull();
    }
  });

  it("contains no entry from data/allowed-external-names.json", () => {
    const allowed = new Set<string>();
    for (const entry of allowedNames.entries) {
      allowed.add(fold(entry.name));
      for (const alias of entry.aliases) allowed.add(fold(alias));
    }
    for (const provider of allowedNames.providerEntries) allowed.add(fold(provider.slug));
    for (const word of denylist.words) {
      expect(allowed.has(fold(word)), word).toBe(false);
    }
  });
});
