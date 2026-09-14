/**
 * If seven regions is more than the panel can hold, what can it hold?
 *
 * D-122 leaves two honest routes: print seven regions with a disclosure, or
 * print fewer regions and claim only what separates. The second was a
 * hand-wave until this measured it, and it is not free — merging EUR and MID
 * does not only hide their confusion, it also takes the Middle East away from
 * a reader whose ancestry the panel CAN place there.
 *
 * So both sides are reported: how much confusion each grouping removes, and how
 * much resolution it costs. Everything is held out — each simulated person's own
 * population is removed from the reference set before fitting — because that is
 * the case a real reader is in, and the population-present figures flatter every
 * variant that memorises the set.
 *
 *     node --import tsx scripts/ancestry-resolution/measure-region-merges.mts
 *
 * MERGES="EUR+MID,EAS+OCE" measures one extra grouping beyond the built-ins.
 * SEEDS (default 20).
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
const BASE = [...new Set(Object.values(meta).map((m) => m.region))].sort();
const LO = 0.001, HI = 0.999, clamp = (v: number) => Math.min(HI, Math.max(LO, v));
const CAP = 30, SEEDS = Number(process.env.SEEDS ?? 20);

/** A grouping is a list of groups; each group is a list of base regions. */
type Grouping = { name: string; groups: string[][] };
const single = (r: string) => [r];
function grouping(name: string, ...merged: string[][]): Grouping {
  const taken = new Set(merged.flat());
  return { name, groups: [...merged, ...BASE.filter((r) => !taken.has(r)).map(single)] };
}
const GROUPINGS: Grouping[] = [
  grouping("seven regions, as measured"),
  grouping("EUR+MID", ["EUR", "MID"]),
  grouping("EUR+MID+CSA", ["EUR", "MID", "CSA"]),
  grouping("EAS+OCE", ["EAS", "OCE"]),
  grouping("EUR+MID, EAS+OCE", ["EUR", "MID"], ["EAS", "OCE"]),
  grouping("EUR+MID+CSA, EAS+OCE", ["EUR", "MID", "CSA"], ["EAS", "OCE"]),
];
if (process.env.MERGES) {
  GROUPINGS.push(grouping(process.env.MERGES, ...process.env.MERGES.split(",").map((g) => g.split("+"))));
}

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
const popFreq = (pop: string) => markers.map((m) => {
  const e = freqs[m]!.pops[pop];
  return e && e.an > 0 ? clamp(e.ac / e.an) : clamp(0.5);
});

console.log(`held out (each person's own population removed from the reference set), capped rule (cap ${CAP}),`);
console.log(`${markers.length} markers, ${POPS.length} populations, ${SEEDS} simulated people each.\n`);
console.log(`Counted over the non-AMR cohorts, by the largest wrong-GROUP entry of the average mixture.\n`);
console.log("grouping".padEnd(24) + "groups" + ">=0.10".padStart(8) + ">=0.20".padStart(8) + ">=0.30".padStart(8)
  + "  mean worst   worst cohort");

for (const g of GROUPINGS) {
  const names = g.groups.map((rs) => rs.join("+"));
  const groupOf = new Map(POPS.map((p) => [p, g.groups.findIndex((rs) => rs.includes(meta[p].region))]));
  const popsInGroup = g.groups.map((_, i) => POPS.filter((p) => groupOf.get(p) === i));

  const table = (exclude: string) => markers.map((m) => {
    const pops = freqs[m]!.pops;
    return popsInGroup.map((members) => {
      const kept = members.filter((p) => p !== exclude && pops[p] && pops[p].an > 0);
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

  const worsts: { pop: string; worst: number; into: string }[] = [];
  for (const pop of POPS) {
    const rows = table(pop), truth = popFreq(pop), want = groupOf.get(pop)!;
    const acc = new Array<number>(names.length).fill(0);
    for (let s = 0; s < SEEDS; s++) {
      const r = mulberry32(0x5eed + s * 7919 + pop.length * 104_729 + pop.charCodeAt(0) * 31);
      const q = fit(rows, truth.map((f) => (r() < f ? 1 : 0) + (r() < f ? 1 : 0)));
      for (let k = 0; k < q.length; k++) acc[k] += q[k] / SEEDS;
    }
    let wk = -1;
    acc.forEach((v, k) => { if (k !== want && (wk < 0 || v > acc[wk])) wk = k; });
    worsts.push({ pop, worst: acc[wk], into: names[wk] });
  }
  const notAmr = worsts.filter((w) => meta[w.pop].region !== "AMR");
  const over = (t: number) => notAmr.filter((w) => w.worst >= t).length;
  const mean = notAmr.reduce((a, w) => a + w.worst, 0) / notAmr.length;
  const top = [...notAmr].sort((a, b) => b.worst - a.worst)[0];
  console.log(g.name.padEnd(24) + String(names.length).padStart(6) + String(over(0.1)).padStart(8)
    + String(over(0.2)).padStart(8) + String(over(0.3)).padStart(8) + mean.toFixed(3).padStart(12)
    + `   ${top.pop} → ${top.into} ${top.worst.toFixed(3)}`);
}

console.log(`\nResolution cost is the "groups" column: a merge that removes confusion also removes`);
console.log(`the ability to place anyone IN the merged regions separately. Read both columns.`);
