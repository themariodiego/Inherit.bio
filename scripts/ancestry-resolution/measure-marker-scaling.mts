/**
 * Is the region confusion a MARKER limit or a MODEL limit?
 *
 * measure-region-confusion.mts shows the panel putting large shares on the
 * wrong region. Before disclosing that as a limitation, it is worth knowing
 * whether it is removable: a limit that more markers would lift is a build
 * task, not a disclosure.
 *
 * This subsamples the 168 markers and watches the confusion shrink. Still
 * falling steeply at 168 means more markers of the same kind would help;
 * flattening means the panel size is not what is binding.
 *
 * Extrapolating past 168 is an extrapolation, and the caveat is real: these
 * 168 were CHOSEN to be ancestry-informative, so a random subsample of them is
 * not the same thing as a smaller panel someone would have designed. The curve
 * bounds the question, it does not settle it.
 *
 *     node --import tsx scripts/ancestry-resolution/measure-marker-scaling.mts
 *
 * HOLD_OUT=1 (default) removes each simulated person's own population from the
 * reference tables, which is the real-world case. SEEDS (default 20).
 *
 * NOTHING HERE READS A REAL PERSON'S FILE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const freqs = JSON.parse(fs.readFileSync(path.join(HERE, "hgdp-tgp-freqs.json"), "utf8")) as
  Record<string, null | { pops: Record<string, { ac: number; an: number }> }>;
const meta = JSON.parse(fs.readFileSync(path.join(HERE, "hgdp-tgp-populations.json"), "utf8")) as
  Record<string, { region: string; samples: number }>;

const ALL = Object.keys(freqs).filter((k) => freqs[k]);
const REGIONS = [...new Set(Object.values(meta).map((m) => m.region))].sort();
const POPS = Object.keys(meta).sort();
const POPS_IN = new Map(REGIONS.map((r) => [r, POPS.filter((p) => meta[p].region === r)]));
const LO = 0.001, HI = 0.999, clamp = (v: number) => Math.min(HI, Math.max(LO, v));
const CAP = 30;
const HOLD_OUT = process.env.HOLD_OUT !== "0";
const SEEDS = Number(process.env.SEEDS ?? 20);

const regionTable = (markers: string[], exclude?: string) => markers.map((m) => {
  const pops = freqs[m]!.pops;
  return REGIONS.map((region) => {
    const names = POPS_IN.get(region)!.filter((p) => p !== exclude && pops[p] && pops[p].an > 0);
    if (!names.length) return clamp(0);
    let w = 0, tw = 0;
    for (const p of names) {
      const people = Math.min(CAP, pops[p].an / 2);
      w += people * (pops[p].ac / pops[p].an);
      tw += people;
    }
    return clamp(w / tw);
  });
});
const popFreq = (pop: string, markers: string[]) => markers.map((m) => {
  const e = freqs[m]!.pops[pop];
  return e && e.an > 0 ? clamp(e.ac / e.an) : clamp(0.5);
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fit(rows: number[][], d: readonly number[]): number[] {
  const K = rows[0].length;
  let q = new Array<number>(K).fill(1 / K);
  for (let i = 0; i < 2000; i++) {
    const n = new Array<number>(K).fill(0);
    for (let m = 0; m < rows.length; m++) {
      const fr = rows[m];
      let pa = 0;
      for (let k = 0; k < K; k++) pa += q[k] * fr[k];
      const pr = 1 - pa;
      for (let k = 0; k < K; k++) n[k] += d[m] * ((q[k] * fr[k]) / pa) + (2 - d[m]) * ((q[k] * (1 - fr[k])) / pr);
    }
    const t = n.reduce((a, b) => a + b, 0);
    let dl = 0;
    for (let k = 0; k < K; k++) { n[k] /= t; dl = Math.max(dl, Math.abs(n[k] - q[k])); }
    q = n;
    if (dl < 1e-7) break;
  }
  return q;
}

// One fixed shuffle, so each size is a prefix of the next and the curve is not
// three unrelated draws.
const shuffled = [...ALL];
{
  const r = mulberry32(99);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
}

const SIZES = [21, 42, 84, 126, 168];
console.log(`region model, capped rule (cap ${CAP}), ${SEEDS} simulated people per cohort`
  + `, own population ${HOLD_OUT ? "HELD OUT of" : "present in"} the reference set\n`);
console.log(`Counting the ${POPS.filter((p) => meta[p].region !== "AMR").length} non-AMR cohorts by how far the worst wrong-region share reaches.`);
console.log(`Statistic: max-of-mean (the largest wrong entry of the average mixture).\n`);
console.log("markers".padEnd(9) + ">=0.10".padStart(8) + ">=0.20".padStart(8) + ">=0.30".padStart(8) + "   mean worst   Sardinian   Druze");

for (const size of SIZES) {
  const markers = shuffled.slice(0, size);
  const shared = HOLD_OUT ? null : regionTable(markers);
  const worsts: { pop: string; worst: number }[] = [];
  for (const pop of POPS) {
    const rows = shared ?? regionTable(markers, pop);
    const truth = popFreq(pop, markers);
    const want = REGIONS.indexOf(meta[pop].region);
    const acc = new Array<number>(REGIONS.length).fill(0);
    for (let s = 0; s < SEEDS; s++) {
      const r = mulberry32(0x5eed + s * 7919 + pop.length * 104_729 + pop.charCodeAt(0) * 31);
      const q = fit(rows, truth.map((f) => (r() < f ? 1 : 0) + (r() < f ? 1 : 0)));
      for (let k = 0; k < q.length; k++) acc[k] += q[k] / SEEDS;
    }
    worsts.push({ pop, worst: Math.max(...acc.filter((_, k) => k !== want)) });
  }
  const notAmr = worsts.filter((w) => meta[w.pop].region !== "AMR");
  const over = (t: number) => notAmr.filter((w) => w.worst >= t).length;
  const mean = notAmr.reduce((a, w) => a + w.worst, 0) / notAmr.length;
  const pick = (p: string) => worsts.find((w) => w.pop === p)!.worst.toFixed(3);
  console.log(String(size).padEnd(9) + String(over(0.1)).padStart(8) + String(over(0.2)).padStart(8)
    + String(over(0.3)).padStart(8) + mean.toFixed(3).padStart(12) + pick("Sardinian").padStart(12) + pick("Druze").padStart(8));
}
