import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { buildLiftover } from "../src/lib/genome/liftover";

/**
 * Builds `data/ref/neanderthal/sites.json` from the published Sprime results
 * of Browning et al. 2018 (Mendeley Data, doi:10.17632/y7hyt83vxr.1, CC BY 4.0),
 * and checks the committed copy offline.
 *
 *   --build /absolute/dir   read the three population tarballs from that
 *                           directory (downloaded by a person, never fetched
 *                           here), verify each against the SHA-256 the
 *                           repository published, and rewrite the panel and
 *                           its manifest.
 *   --check                 recompute every committed hash and every GRCh38
 *                           position through the bundled chain, with no
 *                           network.
 *
 * The selection is written out in `data/ref/neanderthal/PROVENANCE.md`; this
 * file is the executable copy of it. Nothing here is a scientific review of
 * the source: it is the engineering record of what was taken and how.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data/ref/neanderthal");
const CHAIN = path.join(ROOT, "data/ref/chain/GRCh37_to_GRCh38.chain.gz");
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

/** The repository's own published hashes (Mendeley Data public API, read 2026-10-22). */
export const SOURCE_FILES = {
  CEU: { file: "CEU_sprime_results.tar.gz", sha256: "f695e484db15d1974d0fb6bd15a3e8d769a872f2a3803908d9197a057b9472f0" },
  CHB: { file: "CHB_sprime_results.tar.gz", sha256: "345885d49379477ec48bb470bb8489bb339f24898db09676fcc10840e7337c05" },
  GIH: { file: "GIH_sprime_results.tar.gz", sha256: "e1c26d457bf04cab9e548b28446b7733d7ad7a61e690761ccc3ee39b1e701e48" },
} as const;
export type SourcePopulation = keyof typeof SOURCE_FILES;
export const POPULATIONS = Object.keys(SOURCE_FILES) as SourcePopulation[];

export const PANEL_ID = "neanderthal-sprime-1kg-v1";
export const PANEL_VERSION = "browning2018-sprime-ceu-chb-gih-grch38-2026-10-22";

/** One committed site: autosome, GRCh37 and GRCh38 positions, rsID, the Neanderthal-matching letter and the other letter. */
export type Site = [chrom: number, pos37: number, pos38: number, rsid: string, archaic: string, other: string];

const BASES = new Set(["A", "C", "G", "T"]);
const PALINDROMIC = new Set(["AT", "TA", "CG", "GC"]);

/** Minimal ustar reader: regular files only, names from prefix + name. */
export function untar(bytes: Uint8Array): Map<string, string> {
  const files = new Map<string, string>();
  const text = (start: number, length: number) =>
    Buffer.from(bytes.subarray(start, start + length)).toString("latin1").replace(/\0[\s\S]*$/, "");
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const name = text(offset, 100);
    if (!name) break;
    const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8);
    const type = text(offset + 156, 1);
    const prefix = text(offset + 345, 155);
    assert(Number.isSafeInteger(size) && size >= 0, "tar entry size");
    const body = offset + 512;
    if (type === "0" || type === "") {
      files.set(prefix ? `${prefix}/${name}` : name, Buffer.from(bytes.subarray(body, body + size)).toString("utf8"));
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  return files;
}

interface Candidate { chrom: number; pos37: number; rsid: string; archaic: string; other: string }

/**
 * One population's Sprime output → one site per introgressed segment.
 *
 * A row qualifies when the putatively archaic allele matches the Altai
 * Neanderthal and not the Altai Denisovan (NMATCH=match, DMATCH=mismatch),
 * both alleles are single A/C/G/T letters, the pair is not strand-ambiguous
 * (A/T, C/G), and the variant carries an rs identifier. Of a segment's
 * qualifying rows, the lower median by position is kept, so a segment is
 * counted once however many rows it has.
 */
export function selectFromPopulation(files: Map<string, string>, population: SourcePopulation): Candidate[] {
  const chosen: Candidate[] = [];
  for (let chrom = 1; chrom <= 22; chrom++) {
    const name = `mendeley_data/${population}.chr${chrom}.ND_match`;
    const body = files.get(name);
    assert(body !== undefined, `missing ${name}`);
    const lines = body.split("\n").filter(line => line.length > 0);
    assert.equal(lines[0], "CHROM\tPOS\tID\tREF\tALT\tSEGMENT\tALLELE\tSCORE\tNMATCH\tDMATCH", `${name} header`);
    const segments = new Map<string, Candidate[]>();
    for (const line of lines.slice(1)) {
      const [c, pos, id, ref, alt, segment, allele, , nmatch, dmatch] = line.split("\t");
      assert.equal(Number(c), chrom, `${name} chromosome`);
      if (nmatch !== "match" || dmatch !== "mismatch") continue;
      if (!/^rs[1-9][0-9]*$/.test(id) || !BASES.has(ref) || !BASES.has(alt) || PALINDROMIC.has(ref + alt)) continue;
      assert(allele === "0" || allele === "1", `${name} allele column`);
      const archaic = allele === "1" ? alt : ref;
      const other = allele === "1" ? ref : alt;
      const group = segments.get(segment) ?? [];
      group.push({ chrom, pos37: Number(pos), rsid: id, archaic, other });
      segments.set(segment, group);
    }
    for (const group of segments.values()) {
      group.sort((a, b) => a.pos37 - b.pos37);
      chosen.push(group[Math.floor((group.length - 1) / 2)]);
    }
  }
  return chosen;
}

/** Merge populations, lift to GRCh38 and refuse every collision. */
export function assemble(perPopulation: Candidate[][], lift: ReturnType<typeof buildLiftover>) {
  const byPos37 = new Map<string, Candidate | null>();
  for (const candidates of perPopulation) for (const candidate of candidates) {
    const key = `${candidate.chrom}:${candidate.pos37}`;
    const seen = byPos37.get(key);
    if (seen === undefined) byPos37.set(key, candidate);
    else if (seen !== null && (seen.archaic !== candidate.archaic || seen.other !== candidate.other || seen.rsid !== candidate.rsid)) {
      byPos37.set(key, null);
    }
  }
  const counts = { selected: 0, merged: 0, conflicting: 0, unmapped: 0, collisions: 0 };
  counts.selected = perPopulation.reduce((sum, list) => sum + list.length, 0);
  const lifted: Site[] = [];
  for (const candidate of byPos37.values()) {
    if (candidate === null) { counts.conflicting++; continue; }
    const mapped = lift(candidate.chrom, candidate.pos37);
    if (!mapped || mapped.chrom !== candidate.chrom || mapped.strand !== 1) { counts.unmapped++; continue; }
    lifted.push([candidate.chrom, candidate.pos37, mapped.pos, candidate.rsid, candidate.archaic, candidate.other]);
  }
  counts.merged = byPos37.size;
  const pos38Count = new Map<string, number>(), rsidCount = new Map<string, number>();
  for (const site of lifted) {
    pos38Count.set(`${site[0]}:${site[2]}`, (pos38Count.get(`${site[0]}:${site[2]}`) ?? 0) + 1);
    rsidCount.set(site[3], (rsidCount.get(site[3]) ?? 0) + 1);
  }
  const sites = lifted.filter(site => pos38Count.get(`${site[0]}:${site[2]}`) === 1 && rsidCount.get(site[3]) === 1);
  counts.collisions = lifted.length - sites.length;
  sites.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  return { sites, counts };
}

/** The canonical serialisation the manifest's hash and the stored result's `markerSha256` cover. */
export function canonicalSites(sites: readonly Site[]): string {
  return JSON.stringify(sites);
}

async function build(directory: string) {
  assert(path.isAbsolute(directory), "Pass the absolute directory holding the downloaded tarballs");
  const chain = await fs.readFile(CHAIN);
  const lift = buildLiftover(chain);
  const perPopulation: Candidate[][] = [];
  const perPopulationCounts: Record<string, number> = {};
  for (const population of POPULATIONS) {
    const { file, sha256 } = SOURCE_FILES[population];
    const bytes = await fs.readFile(path.join(directory, file));
    assert.equal(sha(bytes), sha256, `${file} differs from the published SHA-256`);
    const selected = selectFromPopulation(untar(gunzipSync(bytes)), population);
    perPopulation.push(selected);
    perPopulationCounts[population] = selected.length;
  }
  const { sites, counts } = assemble(perPopulation, lift);
  const sitesJson = canonicalSites(sites);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "sites.json"), `${JSON.stringify({
    schemaVersion: 1, id: PANEL_ID, version: PANEL_VERSION,
    columns: ["chrom", "pos37", "pos38", "rsid", "archaic", "other"],
    licence: "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Derived from Browning, Sharon (2018), Sprime results for 1000 Genomes non-African populations and SGDP Papuans, Mendeley Data, V1, doi:10.17632/y7hyt83vxr.1. Changed: subset, one site per segment, lifted to GRCh38. See PROVENANCE.md.",
    sites,
  }, null, 0).replace(/\[\[/, "[\n[").replace(/\],\[/g, "],\n[")}\n`);
  await fs.writeFile(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1, panelId: PANEL_ID, panelVersion: PANEL_VERSION,
    sourceDoi: "10.17632/y7hyt83vxr.1", sourceFiles: SOURCE_FILES,
    chainSha256: sha(chain), perPopulationSelected: perPopulationCounts, counts,
    siteCount: sites.length, sitesSha256: sha(sitesJson),
  }, null, 2)}\n`);
  console.log(`Wrote ${sites.length} sites (${JSON.stringify(counts)})`);
}

/** Offline: the committed panel matches its manifest, and every GRCh38 position is the bundled chain's. */
export async function verifyPanel(root = ROOT): Promise<{ siteCount: number; sitesSha256: string }> {
  const panel = JSON.parse(await fs.readFile(path.join(root, "data/ref/neanderthal/sites.json"), "utf8")) as {
    id: string; version: string; sites: Site[];
  };
  const manifest = JSON.parse(await fs.readFile(path.join(root, "data/ref/neanderthal/manifest.json"), "utf8")) as {
    panelId: string; panelVersion: string; siteCount: number; sitesSha256: string; chainSha256: string;
  };
  const chain = await fs.readFile(path.join(root, "data/ref/chain/GRCh37_to_GRCh38.chain.gz"));
  assert.equal(panel.id, manifest.panelId);
  assert.equal(panel.version, manifest.panelVersion);
  assert.equal(panel.sites.length, manifest.siteCount);
  assert.equal(sha(canonicalSites(panel.sites)), manifest.sitesSha256);
  assert.equal(sha(chain), manifest.chainSha256);
  const lift = buildLiftover(chain);
  const positions = new Set<string>(), rsids = new Set<string>();
  let previous: Site | null = null;
  for (const site of panel.sites) {
    const [chrom, pos37, pos38, rsid, archaic, other] = site;
    assert(Number.isInteger(chrom) && chrom >= 1 && chrom <= 22, `chromosome ${chrom}`);
    assert(/^rs[1-9][0-9]*$/.test(rsid), `rsid ${rsid}`);
    assert(BASES.has(archaic) && BASES.has(other) && archaic !== other && !PALINDROMIC.has(archaic + other), `${rsid} alleles`);
    const mapped = lift(chrom, pos37);
    assert(mapped && mapped.chrom === chrom && mapped.pos === pos38 && mapped.strand === 1, `${rsid} liftover`);
    assert(!positions.has(`${chrom}:${pos38}`) && !rsids.has(rsid), `${rsid} collides`);
    positions.add(`${chrom}:${pos38}`); rsids.add(rsid);
    if (previous) assert(previous[0] < chrom || (previous[0] === chrom && previous[2] < pos38), "sites are sorted");
    previous = site;
  }
  return { siteCount: panel.sites.length, sitesSha256: manifest.sitesSha256 };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const check = process.argv.length === 3 && process.argv[2] === "--check";
  assert(check || (process.argv.length === 4 && process.argv[2] === "--build"), "Usage: --check | --build /absolute/download/dir");
  void (check
    ? verifyPanel().then(({ siteCount }) => console.log(`Neanderthal panel verified: ${siteCount} sites`))
    : build(process.argv[3])
  ).catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
