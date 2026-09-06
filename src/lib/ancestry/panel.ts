/**
 * The shipped ancestry reference panel, named once (brief §4.6, G4.4, X16.5).
 * The page copy, the region set and any row stamping import these constants
 * and never retype them; the values derive from `src/lib/genome/admixture.ts`
 * and `data/ref/AIMS_PROVENANCE.md`.
 */
import { AIMS, RELIABLE_FRACTION } from "@/lib/genome/admixture";

export const PANEL = {
  id: "aims-kidd-seldin-168",
  /** The day the panel was built (`data/ref/AIMS_PROVENANCE.md`). */
  version: "2026-08-28",
  markers: AIMS.length,
  provenance: "data/ref/AIMS_PROVENANCE.md",
} as const;

/**
 * The fewest usable markers a map needs: ceil(RELIABLE_FRACTION × panel
 * size), 42 for the shipped panel. Below it the estimate is noise and the
 * map renders grey (brief §4.6). Applies to the shipped panel only.
 */
export const MIN_MARKERS = Math.ceil(RELIABLE_FRACTION * AIMS.length);

/**
 * The reference trees a haplogroup call is read against, named once (G4.4:
 * every quantity derived from a reference panel names its panel and version
 * on the surface). The facts come from `data/ref/haplogroups/PROVENANCE.md`;
 * the trees themselves carry no version field, so it is stated here and
 * nowhere else.
 */
export interface LineageTree {
  /** Stable identity of this shipped subset, not a clinical validation claim. */
  id: string;
  /** The published tree the topology and defining positions were taken from. */
  name: string;
  /** Its build, as the publisher names it. */
  version: string;
  /** The day the shipped subset was curated. */
  curated: string;
  provenance: string;
}

export const LINEAGE_TREES: Readonly<Record<"mother" | "father", LineageTree>> = {
  mother: {
    id: "inherit-mtdna-curated-subset",
    name: "PhyloTree",
    version: "Build 17, Forensic Update 1a",
    curated: "2026-08-28",
    provenance: "data/ref/haplogroups/PROVENANCE.md",
  },
  father: {
    id: "inherit-ydna-curated-subset",
    name: "the ISOGG Y-SNP index",
    version: "2016 index (4 January 2016)",
    curated: "2026-08-28",
    provenance: "data/ref/haplogroups/PROVENANCE.md",
  },
} as const;

export interface PanelSource {
  /** A citation id in the repository's `doi:` form, or a dataset id. */
  id: string;
  title: string;
  detail: string;
}

/** What the surface is built from, in the order "Where this comes from" lists them. */
export const SOURCES: readonly PanelSource[] = [
  {
    id: "doi:10.1016/j.fsigen.2014.01.002",
    title: "Kidd and colleagues, 2014",
    detail: "The 55-marker ancestry panel.",
  },
  {
    id: "doi:10.1002/humu.20822",
    title: "Kosoy and colleagues, 2009",
    detail: "The 128-marker ancestry panel.",
  },
  {
    id: "doi:10.1038/s41598-019-55175-x",
    title: "Pakstis and colleagues, 2019",
    detail: "The combined list of the two panels the shipped markers were taken from.",
  },
  {
    id: "doi:10.1038/nature15393",
    title: "The 1000 Genomes Project Consortium, 2015",
    detail: "Phase 3: the 26 reference populations, where and how many people were sampled, and the allele frequencies.",
  },
  {
    id: "natural-earth:110m-physical",
    title: "Natural Earth 1:110m physical, public domain",
    detail: "The land and the named physical features the five regions are drawn from; no border data is used.",
  },
];
