/**
 * How should a region's allele frequency be built from its populations?
 *
 * The callset gives per-POPULATION counts; a region-level estimate needs one
 * frequency per region per marker, and there are two honest ways to get it:
 *
 *   pooled     region AF = sum(ac) / sum(an)  — every SAMPLED PERSON counts once
 *   unweighted region AF = mean of the population AFs — every POPULATION counts once
 *
 * They are not close. 1kGP cohorts carry ~100 people each and HGDP populations
 * ~20, so pooling lets the 1kGP cohorts speak for their whole region: Europe
 * pooled is mostly CEU, IBS, TSI, FIN and GBR, and Basque, Sardinian, Orcadian
 * and Adygei barely register. Unweighted gives a 13-person Melanesian sample
 * the same voice as a 176-person CEU one, which is generous to small cohorts
 * and noisy in proportion.
 *
 * The operator's rule is "give what the data supports and disclose the gap",
 * so this is not a matter of taste: it is measured, per region, on both.
 *
 *     node --import tsx scripts/ancestry-resolution/measure-region-weighting.mts
 *
 * Reference data is fetched at run time by fetch-callset-frequencies.py and is
 * not committed by this script. NOTHING HERE READS A REAL PERSON'S FILE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const freqs = JSON.parse(fs.readFileSync(path.join(HERE, "hgdp-tgp-freqs.json"), "utf8")) as
  Record<string, null | { rsid: string; pops: Record<string, { ac: number; an: number }> }>;
const meta = JSON.parse(fs.readFileSync(path.join(HERE, "hgdp-tgp-populations.json"), "utf8")) as
  Record<string, { region: string; samples: number }>;

const markers = Object.keys(freqs).filter((k) => freqs[k]);
const REGIONS = [...new Set(Object.values(meta).map((m) => m.region))].sort();
const POPS_IN = new Map(REGIONS.map((r) => [r, Object.keys(meta).filter((p) => meta[p].region === r).sort()]));

const LO = 0.001, HI = 0.999;
const clamp = (v: number) => Math.min(HI, Math.max(LO, v));

/** [marker][region] under each rule. */
const CAP = Number(process.env.SAMPLE_CAP ?? 30);
function build(rule: "pooled" | "unweighted" | "capped"): number[][] {
  return markers.map((m) => {
    const pops = freqs[m]!.pops;
    return REGIONS.map((region) => {
      const names = POPS_IN.get(region)!.filter((p) => pops[p] && pops[p].an > 0);
      if (!names.length) return clamp(0);
      if (rule === "pooled") {
        let ac = 0, an = 0;
        for (const p of names) { ac += pops[p].ac; an += pops[p].an; }
        return clamp(ac / an);
      }
      if (rule === "unweighted") {
        return clamp(names.reduce((sum, p) => sum + pops[p].ac / pops[p].an, 0) / names.length);
      }
      // Capped: weight by sampled people up to CAP. Pooling lets a 176-person
      // cohort speak for its whole region; unweighted gives a 13-person one the
      // same voice as it. A cap keeps small cohorts audible without pretending
      // they are as well measured as large ones.
      let weighted = 0, weight = 0;
      for (const p of names) {
        const people = Math.min(CAP, pops[p].an / 2);
        weighted += people * (pops[p].ac / pops[p].an);
        weight += people;
      }
      return clamp(weighted / weight);
    });
  });
}

/** Per-population ALT frequency, the truth a simulated person is drawn from. */
const POP_FREQ = new Map<string, number[]>();
for (const pop of Object.keys(meta)) {
  const column = markers.map((m) => {
    const p = freqs[m]!.pops[pop];
    return p && p.an > 0 ? clamp(p.ac / p.an) : clamp(0.5);
  });
  POP_FREQ.set(pop, column);
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

function fit(rows: readonly number[][], dosages: readonly number[]): number[] {
  const K = rows[0].length;
  let q = new Array<number>(K).fill(1 / K);
  for (let iter = 0; iter < 1000; iter++) {
    const next = new Array<number>(K).fill(0);
    for (let m = 0; m < rows.length; m++) {
      const fr = rows[m], d = dosages[m];
      let pAlt = 0;
      for (let k = 0; k < K; k++) pAlt += q[k] * fr[k];
      const pRef = 1 - pAlt;
      for (let k = 0; k < K; k++) {
        next[k] += d * ((q[k] * fr[k]) / pAlt) + (2 - d) * ((q[k] * (1 - fr[k])) / pRef);
      }
    }
    const total = next.reduce((a, b) => a + b, 0);
    let delta = 0;
    for (let k = 0; k < K; k++) { next[k] /= total; delta = Math.max(delta, Math.abs(next[k] - q[k])); }
    q = next;
    if (delta < 1e-7) break;
  }
  return q;
}

const SEEDS = Number(process.env.SEEDS ?? 20);
const RULES = ["pooled", "unweighted", "capped"] as const;
const TABLES = Object.fromEntries(RULES.map((r) => [r, build(r)])) as Record<typeof RULES[number], number[][]>;

interface Score { right: number; total: number; share: number[] }
const scores: Record<string, Map<string, Score>> = Object.fromEntries(RULES.map((r) => [r, new Map()]));

for (const pop of Object.keys(meta).sort()) {
  const truth = POP_FREQ.get(pop)!;
  const want = REGIONS.indexOf(meta[pop].region);
  for (let s = 0; s < SEEDS; s++) {
    const rnd = mulberry32(0x5eed + s * 7919 + pop.length * 104_729 + pop.charCodeAt(0) * 31);
    const dosages = truth.map((f) => (rnd() < f ? 1 : 0) + (rnd() < f ? 1 : 0));
    for (const rule of RULES) {
      const q = fit(TABLES[rule], dosages);
      let top = 0;
      for (let k = 1; k < q.length; k++) if (q[k] > q[top]) top = k;
      const entry = scores[rule].get(pop) ?? { right: 0, total: 0, share: [] };
      entry.right += top === want ? 1 : 0;
      entry.total += 1;
      entry.share.push(q[want]);
      scores[rule].set(pop, entry);
    }
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`markers ${markers.length}, regions ${REGIONS.join(", ")}, populations ${Object.keys(meta).length}, seeds ${SEEDS}, cap ${CAP}`);
for (const rule of RULES) {
  const all = [...scores[rule].values()];
  console.log(`\n${rule.toUpperCase()}: top region right ${all.reduce((n, s) => n + s.right, 0)} of ${all.reduce((n, s) => n + s.total, 0)}`
    + ` (${(100 * all.reduce((n, s) => n + s.right, 0) / all.reduce((n, s) => n + s.total, 0)).toFixed(1)}%),`
    + ` mean share on the right region ${mean(all.flatMap((s) => s.share)).toFixed(3)}`);
  for (const region of REGIONS) {
    const pops = POPS_IN.get(region)!;
    const right = pops.reduce((n, p) => n + (scores[rule].get(p)?.right ?? 0), 0);
    const total = pops.reduce((n, p) => n + (scores[rule].get(p)?.total ?? 0), 0);
    const worst = pops
      .map((p) => [p, (scores[rule].get(p)!.right / scores[rule].get(p)!.total)] as const)
      .sort((a, b) => a[1] - b[1]).slice(0, 3)
      .filter(([, rate]) => rate < 1);
    console.log(`  ${region.padEnd(4)} ${String(right).padStart(4)}/${String(total).padEnd(4)} ${(100 * right / total).toFixed(0).padStart(3)}%`
      + (worst.length ? `   weakest: ${worst.map(([p, r]) => `${p} ${(100 * r).toFixed(0)}%`).join(", ")}` : ""));
  }
}
