/**
 * What does a region-level estimate actually SAY about a person?
 *
 * measure-region-weighting.mts asks only whether the largest share lands on the
 * right region. That question flatters the model twice over. It ignores how big
 * the wrong shares are — a reader is not shown an argmax, they are shown numbers
 * — and it is not even a fair question for the admixed-American cohorts, whose
 * label denotes admixture rather than a place, so a correct answer for PUR may
 * well put most of its weight on EUR and AFR.
 *
 * This measures the whole vector: for each reference population, the mean
 * estimated mixture over simulated people drawn from that population's own
 * allele frequencies. The interesting number is not the diagonal, it is the
 * largest OFF-diagonal share, because that is the size of the figure the panel
 * would print next to a region the reader has no established connection to.
 *
 * Two models are measured, because it turns out the confusion is mostly the
 * model's fault rather than the panel's:
 *
 *   region   fit a mixture of the 7 REGION average frequencies directly
 *   rollup   fit a mixture of the 78 POPULATION frequencies, then add each
 *            population's share into its own region
 *
 * A 7-component mixture over region averages cannot represent a population that
 * sits inside a region but far from its average — Europe's average is dominated
 * by CEU, GBR, FIN, IBS and TSI, and a Sardinian is genuinely distant from it —
 * so the fit explains that real within-region distance by borrowing from a
 * neighbouring region. Fitting fine and reporting coarse removes most of it.
 *
 * Two statistics are reported, and they must not be mixed:
 *
 *   max-of-mean   the largest wrong entry of the AVERAGE mixture. What a
 *                 typical reader is shown, IF the wrong region is the same one
 *                 every time.
 *   mean-of-max   the average, over people, of that person's largest wrong
 *                 entry. How much weight lands somewhere wrong per person, even
 *                 when it lands in different places. Never smaller than the
 *                 other, and much larger when the error is unstable.
 *
 *     node --import tsx scripts/ancestry-resolution/measure-region-confusion.mts
 *
 * RULE=pooled|unweighted|capped (default capped), MODEL=region|rollup (default
 * region), SEEDS (default 20), ITERS (default 2000), HOLD_OUT=1.
 *
 * HOLD_OUT=1 removes each simulated person's OWN population from the reference
 * tables before fitting them. That is the real-world case: the set holds 78
 * populations and the world holds far more, so most readers are somebody the
 * reference set does not contain. Without it every measurement here is the
 * panel's ceiling rather than its expectation.
 *
 * Reference data is fetched at run time by fetch-callset-frequencies.py and is
 * not committed. NOTHING HERE READS A REAL PERSON'S FILE; every "person" is
 * drawn from published population frequencies.
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
const CAP = Number(process.env.SAMPLE_CAP ?? 30);
const RULE = (process.env.RULE ?? "capped") as "pooled" | "unweighted" | "capped";
const MODEL = (process.env.MODEL ?? "region") as "region" | "rollup";
const ITERS = Number(process.env.ITERS ?? 2000);

function regionTable(exclude?: string) {
  return markers.map((m) => {
  const pops = freqs[m]!.pops;
  return REGIONS.map((region) => {
    const names = POPS_IN.get(region)!.filter((p) => p !== exclude && pops[p] && pops[p].an > 0);
    if (!names.length) return clamp(0);
    if (RULE === "pooled") {
      let ac = 0, an = 0;
      for (const p of names) { ac += pops[p].ac; an += pops[p].an; }
      return clamp(ac / an);
    }
    if (RULE === "unweighted") {
      return clamp(names.reduce((sum, p) => sum + pops[p].ac / pops[p].an, 0) / names.length);
    }
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

const popFreq = (pop: string) => markers.map((m) => {
  const p = freqs[m]!.pops[pop];
  return p && p.an > 0 ? clamp(p.ac / p.an) : clamp(0.5);
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

function fit(rows: readonly number[][], dosages: readonly number[]): number[] {
  const K = rows[0].length;
  let q = new Array<number>(K).fill(1 / K);
  for (let iter = 0; iter < ITERS; iter++) {
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
const POPS = Object.keys(meta).sort();

/** The population-level table, used when MODEL=rollup. */
function popTableFor(exclude?: string) {
  const kept = POPS.filter((p) => p !== exclude);
  return {
    rows: markers.map((m) => kept.map((p) => {
      const e = freqs[m]!.pops[p];
      return e && e.an > 0 ? clamp(e.ac / e.an) : clamp(0.5);
    })),
    region: kept.map((p) => REGIONS.indexOf(meta[p].region)),
  };
}

const HOLD_OUT = process.env.HOLD_OUT === "1";
const sharedRegion = HOLD_OUT ? null : regionTable();
const sharedPop = HOLD_OUT ? null : popTableFor();

/** One person's estimated REGION mixture, under whichever model is selected. */
function estimator(pop: string) {
  const rTable = sharedRegion ?? regionTable(pop);
  const pTable = sharedPop ?? popTableFor(pop);
  return (dosages: readonly number[]): number[] => {
    if (MODEL === "region") return fit(rTable, dosages);
    const q = fit(pTable.rows, dosages);
    const rolled = new Array<number>(REGIONS.length).fill(0);
    q.forEach((v, i) => { rolled[pTable.region[i]] += v; });
    return rolled;
  };
}

const rows: { pop: string; region: string; mixture: number[]; meanOfMax: number }[] = [];
for (const pop of POPS) {
  const truth = popFreq(pop);
  const acc = new Array<number>(REGIONS.length).fill(0);
  const want = REGIONS.indexOf(meta[pop].region);
  const estimate = estimator(pop);
  let meanOfMax = 0;
  for (let s = 0; s < SEEDS; s++) {
    const rnd = mulberry32(0x5eed + s * 7919 + pop.length * 104_729 + pop.charCodeAt(0) * 31);
    const dosages = truth.map((f) => (rnd() < f ? 1 : 0) + (rnd() < f ? 1 : 0));
    const q = estimate(dosages);
    for (let k = 0; k < q.length; k++) acc[k] += q[k] / SEEDS;
    meanOfMax += Math.max(...q.filter((_, k) => k !== want)) / SEEDS;
  }
  rows.push({ pop, region: meta[pop].region, mixture: acc, meanOfMax });
}

console.log(`model ${MODEL}${HOLD_OUT ? " (own population HELD OUT of the reference set)" : ""}, rule ${RULE}${RULE === "capped" ? ` (cap ${CAP})` : ""}, markers ${markers.length}, populations ${rows.length}, ${SEEDS} simulated people each, EM capped at ${ITERS} iterations`);
console.log(`mean estimated mixture; the reference population's OWN region is bracketed\n`);
console.log("cohort".padEnd(14) + REGIONS.map((r) => r.padStart(8)).join("") + "   own");
for (const region of REGIONS) {
  for (const row of rows.filter((r) => r.region === region)) {
    console.log(
      row.pop.padEnd(14)
      + row.mixture.map((v, k) => (REGIONS[k] === row.region ? `[${v.toFixed(3)}]` : ` ${v.toFixed(3)} `).padStart(8)).join("")
      + `   ${row.region}`,
    );
  }
}

// The headline: how large does a wrong-region share get?
const offDiagonal = rows.map((row) => {
  let worst = 0, worstRegion = "";
  row.mixture.forEach((v, k) => {
    if (REGIONS[k] !== row.region && v > worst) { worst = v; worstRegion = REGIONS[k]; }
  });
  return {
    pop: row.pop, region: row.region, worst, worstRegion,
    own: row.mixture[REGIONS.indexOf(row.region)], meanOfMax: row.meanOfMax,
  };
}).sort((a, b) => b.worst - a.worst);

console.log(`\nLargest share landing on a region that is NOT the cohort's own:`);
console.log(`  ${"cohort".padEnd(14)} own → wrong   max-of-mean   mean-of-max`);
for (const row of offDiagonal.slice(0, 20)) {
  console.log(`  ${row.pop.padEnd(14)} ${row.region} → ${row.worstRegion}`
    + `${row.worst.toFixed(3).padStart(14)}${row.meanOfMax.toFixed(3).padStart(14)}`
    + `   (own ${row.own.toFixed(3)})`);
}
const notAmr = offDiagonal.filter((r) => r.region !== "AMR");
for (const [label, pick] of [["max-of-mean", (r: typeof offDiagonal[number]) => r.worst],
                             ["mean-of-max", (r: typeof offDiagonal[number]) => r.meanOfMax]] as const) {
  const over = (set: typeof offDiagonal, t: number) => set.filter((r) => pick(r) >= t).length;
  console.log(`\n  ${label}: ${over(offDiagonal, 0.1)} of ${rows.length} cohorts at >=0.10,`
    + ` ${over(offDiagonal, 0.2)} at >=0.20, ${over(offDiagonal, 0.3)} at >=0.30.`);
  console.log(`  ${" ".repeat(label.length)}  excluding AMR, whose label denotes admixture rather than a place:`
    + ` ${over(notAmr, 0.1)} of ${notAmr.length} at >=0.10, ${over(notAmr, 0.2)} at >=0.20, ${over(notAmr, 0.3)} at >=0.30.`);
}
