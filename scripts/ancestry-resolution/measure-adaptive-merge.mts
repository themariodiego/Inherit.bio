/**
 * Merge the regions the panel cannot separate — but only for the readers whose
 * own result is actually ambiguous.
 *
 * A global merge (measure-region-merges.mts) trades everyone's resolution for
 * the confused readers' honesty: a Finnish reader loses the Europe/South Asia
 * split to protect a Sardinian one. An adaptive merge asks the question per
 * person instead. Fit the seven regions as usual; then, among the regions this
 * panel is known to confuse, if TWO OR MORE carry a non-trivial share for THIS
 * reader, report them as a single combined row for this reader only.
 *
 * A clean Finnish result never triggers it and keeps seven regions. A Sardinian
 * result triggers it and is told "Europe, the Middle East and Central/South
 * Asia" as one figure, which is what the panel actually knows.
 *
 * Measured held out, because the population-present case flatters everything.
 *
 *     node --import tsx scripts/ancestry-resolution/measure-adaptive-merge.mts
 *
 * CONFUSABLE="EUR,MID,CSA" (default), SEEDS (default 20).
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

const markers = Object.keys(freqs).filter((k) => freqs[k]);
const POPS = Object.keys(meta).sort();
const REGIONS = [...new Set(Object.values(meta).map((m) => m.region))].sort();
const POPS_IN = new Map(REGIONS.map((r) => [r, POPS.filter((p) => meta[p].region === r)]));
const LO = 0.001, HI = 0.999, clamp = (v: number) => Math.min(HI, Math.max(LO, v));
const CAP = 30, SEEDS = Number(process.env.SEEDS ?? 20);
const CONFUSABLE = (process.env.CONFUSABLE ?? "EUR,MID,CSA").split(",");
const CONF_IDX = CONFUSABLE.map((r) => REGIONS.indexOf(r));

const regionTable = (exclude: string) => markers.map((m) => {
  const pops = freqs[m]!.pops;
  return REGIONS.map((region) => {
    const kept = POPS_IN.get(region)!.filter((p) => p !== exclude && pops[p] && pops[p].an > 0);
    if (!kept.length) return clamp(0);
    let w = 0, tw = 0;
    for (const p of kept) {
      const people = Math.min(CAP, pops[p].an / 2);
      w += people * (pops[p].ac / pops[p].an);
      tw += people;
    }
    return clamp(w / tw);
  });
});
const popFreq = (pop: string) => markers.map((m) => {
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

/** Every simulated person's fitted 7-vector, computed once and reused per threshold. */
const fitted: { pop: string; want: number; draws: number[][] }[] = [];
for (const pop of POPS) {
  const rows = regionTable(pop), truth = popFreq(pop);
  const draws: number[][] = [];
  for (let s = 0; s < SEEDS; s++) {
    const r = mulberry32(0x5eed + s * 7919 + pop.length * 104_729 + pop.charCodeAt(0) * 31);
    draws.push(fit(rows, truth.map((f) => (r() < f ? 1 : 0) + (r() < f ? 1 : 0))));
  }
  fitted.push({ pop, want: REGIONS.indexOf(meta[pop].region), draws });
}

/** Apply the adaptive rule to one fitted vector; returns the REPORTED rows. */
function report(q: number[], threshold: number): { members: number[]; share: number }[] {
  const hot = CONF_IDX.filter((k) => q[k] >= threshold);
  const rows: { members: number[]; share: number }[] = [];
  if (hot.length >= 2) {
    rows.push({ members: hot, share: hot.reduce((a, k) => a + q[k], 0) });
  }
  const merged = new Set(hot.length >= 2 ? hot : []);
  q.forEach((v, k) => { if (!merged.has(k)) rows.push({ members: [k], share: v }); });
  return rows;
}

console.log(`held out, capped rule (cap ${CAP}), ${markers.length} markers, ${POPS.length} populations,`);
console.log(`${SEEDS} simulated people each. Confusable set: ${CONFUSABLE.join(", ")}.\n`);
console.log(`A reported row counts as RIGHT if it contains the person's own region. Counting the`);
console.log(`non-AMR cohorts by the largest wrong reported-row share, averaged over their draws.\n`);
console.log("threshold".padEnd(11) + ">=0.10".padStart(8) + ">=0.20".padStart(8) + ">=0.30".padStart(8)
  + "  mean worst   merged   rows   worst cohort");

for (const threshold of [1.01, 0.30, 0.20, 0.15, 0.10, 0.05, 0.0]) {
  const per: { pop: string; worst: number; into: string }[] = [];
  let mergedDraws = 0, totalDraws = 0, rowSum = 0;
  for (const { pop, want, draws } of fitted) {
    let worst = 0; let into = "";
    for (const q of draws) {
      const rows = report(q, threshold);
      totalDraws++;
      if (rows.some((r) => r.members.length > 1)) mergedDraws++;
      rowSum += rows.filter((r) => r.share >= 0.01).length;
      let w = 0, wi = "";
      for (const r of rows) {
        if (r.members.includes(want)) continue;
        if (r.share > w) { w = r.share; wi = r.members.map((k) => REGIONS[k]).join("+"); }
      }
      worst += w / draws.length;
      if (wi && w >= worst) into = wi;
    }
    per.push({ pop, worst, into });
  }
  const notAmr = per.filter((x) => meta[x.pop].region !== "AMR");
  const over = (t: number) => notAmr.filter((x) => x.worst >= t).length;
  const mean = notAmr.reduce((a, x) => a + x.worst, 0) / notAmr.length;
  const top = [...notAmr].sort((a, b) => b.worst - a.worst)[0];
  const label = threshold > 1 ? "never" : threshold === 0 ? "always" : threshold.toFixed(2);
  console.log(label.padEnd(11) + String(over(0.1)).padStart(8) + String(over(0.2)).padStart(8)
    + String(over(0.3)).padStart(8) + mean.toFixed(3).padStart(12)
    + `${(100 * mergedDraws / totalDraws).toFixed(0)}%`.padStart(9)
    + (rowSum / totalDraws).toFixed(1).padStart(7)
    + `   ${top.pop} → ${top.into || "-"} ${top.worst.toFixed(3)}`);
}
console.log(`\n"merged" is the share of simulated readers who would see a combined row at all;`);
console.log(`"rows" is the mean number of regions reported above 1%. "never" is today's seven-region`);
console.log(`behaviour and "always" is the global EUR+MID+CSA merge, for comparison on one scale.`);
