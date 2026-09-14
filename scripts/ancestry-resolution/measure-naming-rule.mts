/**
 * Does the interval know when it is wrong?
 *
 * `docs/ancestry-resolution.md` recorded the finding that decides whether a
 * sub-continental model can ship: draw a person from a population, remove that
 * population from the reference set, and the model returns a CONFIDENT,
 * SPECIFIC, UNSTABLE answer. It then proposed a rule — print a specific
 * population name only when its interval supports it — and asserted that "the
 * instability above is exactly what they measure".
 *
 * THAT ASSERTION IS THE THING THIS SCRIPT TESTS, because it may well be false.
 * The instability in that table is across simulated PEOPLE. The interval
 * resamples MARKERS within one person. They are different sources of variance,
 * and a bootstrap over markers has no way to see that the model is missing the
 * person's own population — the misfit is in the reference set, not in the
 * sample. If the interval cannot separate the two cases, the naming rule the
 * document proposes does not work and nothing should be built on it.
 *
 * So a second candidate is measured in the same run, chosen because it CAN see
 * the thing the bootstrap cannot: the fitted log-likelihood per marker. A
 * person the reference set does not contain should fit worse than one it does,
 * and that is a property of the fit rather than of the resample.
 *
 *     SEEDS=8 node --import tsx scripts/ancestry-resolution/measure-naming-rule.mts
 *
 * Reference data is fetched at run time by `fetch-reference.py` and is not
 * committed: no marker enters `data/ref/` without a licence-audit row
 * (docs/dataset-licenses.md, D-022). NOTHING HERE READS A REAL PERSON'S FILE —
 * every simulated person is drawn from published population frequencies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  fs.readFileSync(path.join(HERE, "gnomad-pops.json"), "utf8"),
) as Record<string, { id: string; ac: number; an: number }[]>;

const variants = Object.keys(raw);
const isNamed = (id: string) =>
  (id.startsWith("hgdp:") || id.startsWith("1kg:")) && !/(_XX|_XY|:XX|:XY)$/.test(id);

// A population qualifies only if it is present at EVERY marker: a reference
// column with holes is a different model at different markers.
const seen = new Map<string, number>();
for (const v of variants) {
  for (const p of raw[v]) if (isNamed(p.id)) seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
}
let POPS = [...seen].filter(([, n]) => n === variants.length).map(([id]) => id).sort();
// The sample-size floor the earlier measurement used. Every population below it
// is someone the result cannot name, which is the equal-granularity question in
// its concrete form and is recorded rather than hidden.
const minAn = (id: string) =>
  Math.min(...variants.map((v) => raw[v].find((p) => p.id === id)!.an));
const DROPPED = POPS.filter((id) => minAn(id) < 20);
POPS = POPS.filter((id) => minAn(id) >= 20);

const LO = 0.001, HI = 0.999;
const FREQ: number[][] = variants.map((v) => {
  const by = new Map(raw[v].map((p) => [p.id, p]));
  return POPS.map((id) => {
    const p = by.get(id)!;
    return Math.min(HI, Math.max(LO, p.ac / p.an));
  });
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

/** The shipped estimator's EM, over an arbitrary number of populations. */
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
    for (let k = 0; k < K; k++) {
      next[k] /= total;
      delta = Math.max(delta, Math.abs(next[k] - q[k]));
    }
    q = next;
    if (delta < 1e-7) break;
  }
  return q;
}

/** Mean log-likelihood per marker of the genotypes under the fitted mixture. */
function logLikPerMarker(rows: readonly number[][], dosages: readonly number[], q: readonly number[]): number {
  let total = 0;
  for (let m = 0; m < rows.length; m++) {
    const fr = rows[m];
    let pAlt = 0;
    for (let k = 0; k < q.length; k++) pAlt += q[k] * fr[k];
    const d = dosages[m];
    // HWE at the pooled frequency, which is the estimator's own assumption.
    const p = d === 2 ? pAlt * pAlt : d === 1 ? 2 * pAlt * (1 - pAlt) : (1 - pAlt) * (1 - pAlt);
    total += Math.log(Math.max(1e-12, p));
  }
  return total / rows.length;
}

const quantile = (asc: readonly number[], p: number) =>
  asc[Math.min(asc.length - 1, Math.max(0, Math.round(p * (asc.length - 1))))];

/**
 * The third candidate, and the one the first two leave room for. A bootstrap
 * over markers cannot see that the reference set is missing the person's own
 * population, because the misfit is in the set rather than in the sample — so
 * an interval on a SHARE may stay narrow while the answer is wrong. What can
 * still move is WHICH population wins. Under leave-one-out the fit is genuinely
 * torn between neighbours, and a resample that re-runs the fit should land on
 * different neighbours. So: how often does the top label survive a resample?
 */

/**
 * Fewer resamples than the shipped estimator's 200, and the reason is stated
 * rather than hidden: this run asks whether two DISTRIBUTIONS separate, not
 * what one person's published interval is, and 200 resamples over 51
 * populations put the whole measurement past an hour. 100 keeps the tail
 * quantiles usable at half the cost. Anything this script concludes about a
 * threshold must be re-measured at 200 before it becomes a rule.
 */
const RESAMPLES = Number(process.env.RESAMPLES ?? 100);
/** The shipped pivotal interval, per population. */
function intervals(rows: readonly number[][], dosages: readonly number[], point: readonly number[], rnd: () => number) {
  const reps: number[][] = [];
  for (let b = 0; b < RESAMPLES; b++) {
    const r: number[][] = new Array(rows.length);
    const d: number[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const j = Math.floor(rnd() * rows.length);
      r[i] = rows[j]; d[i] = dosages[j];
    }
    reps.push(fit(r, d));
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const argmax = (xs: readonly number[]) => xs.reduce((best, v, i) => (v > xs[best] ? i : best), 0);
  const top = argmax(point);
  return {
    ranges: point.map((_, k) => {
      const col = reps.map((rep) => rep[k]).sort((a, b) => a - b);
      return {
        low: clamp(2 * point[k] - quantile(col, 0.975)),
        high: clamp(2 * point[k] - quantile(col, 0.025)),
      };
    }),
    /** Fraction of resamples whose winner is the point estimate's winner. */
    labelAgreement: reps.filter((rep) => argmax(rep) === top).length / reps.length,
    /** How many DIFFERENT populations win across the resamples. */
    distinctWinners: new Set(reps.map((rep) => argmax(rep))).size,
  };
}

/** A simulated person: two allele draws per marker from one population. */
function draw(column: number, rnd: () => number): number[] {
  return FREQ.map((fr) => {
    let d = 0;
    for (let c = 0; c < 2; c++) if (rnd() < fr[column]) d++;
    return d;
  });
}

const SEEDS = Number(process.env.SEEDS ?? 6);
/**
 * Eight populations, chosen to span the regions the leave-one-out measurement
 * found behaving differently: Europe (two, one of which that measurement
 * scattered), North Africa and the Middle East (where it scattered worst),
 * the Americas and East Asia (where it degraded sensibly), South Asia, and
 * sub-Saharan Africa.
 */
const TARGETS = (process.env.TARGETS?.split(",") ?? [
  "1kg:ibs", "hgdp:french", "hgdp:mozabite", "hgdp:bedouin",
  "1kg:pel", "hgdp:han", "1kg:gih", "1kg:yri",
]).filter((t) => POPS.includes(t));

const OUTPUT = process.env.NAMING_RULE_OUTPUT ?? path.join(HERE, "naming-rule-rows.jsonl");
fs.writeFileSync(OUTPUT, "");

interface Row {
  target: string; represented: boolean; seed: number;
  topPop: string; topShare: number; low: number; high: number; width: number;
  correct: boolean; logLik: number;
  labelAgreement: number; distinctWinners: number;
}
const rows: Row[] = [];

for (const target of TARGETS) {
  const src = POPS.indexOf(target);
  for (const represented of [true, false]) {
    const keep = POPS.map((_, i) => i).filter((i) => represented || i !== src);
    const names = keep.map((i) => POPS[i]);
    const sub = FREQ.map((fr) => keep.map((i) => fr[i]));
    for (let s = 0; s < SEEDS; s++) {
      const dosages = draw(src, mulberry32(90_210 + src * 7919 + s * 13));
      const q = fit(sub, dosages);
      const iv = intervals(sub, dosages, q, mulberry32(51_437 + src * 104_729 + s * 31));
      let top = 0;
      for (let k = 1; k < q.length; k++) if (q[k] > q[top]) top = k;
      rows.push({
        target, represented, seed: s,
        topPop: names[top], topShare: q[top],
        low: iv.ranges[top].low, high: iv.ranges[top].high,
        width: iv.ranges[top].high - iv.ranges[top].low,
        correct: names[top] === target,
        logLik: logLikPerMarker(sub, dosages, q),
        labelAgreement: iv.labelAgreement,
        distinctWinners: iv.distinctWinners,
      });
    }
  }
  const done = rows.filter((r) => r.target === target);
  // Written as the run goes rather than at the end: the first attempt at this
  // measurement was killed after 13 minutes of CPU and left nothing at all.
  fs.appendFileSync(OUTPUT, done.map((r) => JSON.stringify(r)).join("\n") + "\n");
  process.stdout.write(`# ${target} done (${done.length} rows)\n`);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const inSet = rows.filter((r) => r.represented);
const outSet = rows.filter((r) => !r.represented);

console.log(`populations ${POPS.length} (dropped below an>=20: ${DROPPED.length}), markers ${FREQ.length}, targets ${TARGETS.length}, seeds ${SEEDS}`);
console.log(`\nPER TARGET  (represented -> unrepresented)`);
console.log(`${"target".padEnd(16)} ${"correct".padEnd(8)} ${"share".padEnd(13)} ${"low".padEnd(13)} ${"width".padEnd(13)} logLik/marker`);
for (const target of TARGETS) {
  const a = inSet.filter((r) => r.target === target), b = outSet.filter((r) => r.target === target);
  const f = (xs: number[]) => median(xs).toFixed(3);
  console.log(
    `${target.padEnd(16)} ${`${a.filter((r) => r.correct).length}/${a.length}`.padEnd(8)} ` +
    `${`${f(a.map((r) => r.topShare))}->${f(b.map((r) => r.topShare))}`.padEnd(13)} ` +
    `${`${f(a.map((r) => r.low))}->${f(b.map((r) => r.low))}`.padEnd(13)} ` +
    `${`${f(a.map((r) => r.width))}->${f(b.map((r) => r.width))}`.padEnd(13)} ` +
    `${mean(a.map((r) => r.logLik)).toFixed(4)} -> ${mean(b.map((r) => r.logLik)).toFixed(4)}`,
  );
}

console.log(`\nCANDIDATE RULE 1 — print a name only when its interval's LOW bound is at or above t.`);
console.log(`${"t".padEnd(6)} ${"named correctly (represented)".padEnd(32)} ${"named at all (unrepresented)".padEnd(32)} separation`);
for (const t of [0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70]) {
  const tp = inSet.filter((r) => r.low >= t && r.correct).length / inSet.length;
  const fp = outSet.filter((r) => r.low >= t).length / outSet.length;
  console.log(`${t.toFixed(2).padEnd(6)} ${(tp * 100).toFixed(1).padStart(5)}%${"".padEnd(26)} ${(fp * 100).toFixed(1).padStart(5)}%${"".padEnd(26)} ${(tp - fp >= 0 ? "+" : "") + (tp - fp).toFixed(3)}`);
}

console.log(`\nCANDIDATE RULE 2 — print a name only when the fit is at least as good as t (log-likelihood per marker).`);
const lls = [...rows.map((r) => r.logLik)].sort((a, b) => a - b);
const grid = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map((p) => quantile(lls, p));
console.log(`${"t".padEnd(10)} ${"named correctly (represented)".padEnd(32)} ${"named at all (unrepresented)".padEnd(32)} separation`);
for (const t of grid) {
  const tp = inSet.filter((r) => r.logLik >= t && r.correct).length / inSet.length;
  const fp = outSet.filter((r) => r.logLik >= t).length / outSet.length;
  console.log(`${t.toFixed(4).padEnd(10)} ${(tp * 100).toFixed(1).padStart(5)}%${"".padEnd(26)} ${(fp * 100).toFixed(1).padStart(5)}%${"".padEnd(26)} ${(tp - fp >= 0 ? "+" : "") + (tp - fp).toFixed(3)}`);
}

console.log(`\nCANDIDATE RULE 3 — print a name only when at least t of the resamples pick the same winner.`);
console.log(`${"t".padEnd(6)} ${"named correctly (represented)".padEnd(32)} ${"named at all (unrepresented)".padEnd(32)} separation`);
for (const t of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
  const tp = inSet.filter((r) => r.labelAgreement >= t && r.correct).length / inSet.length;
  const fp = outSet.filter((r) => r.labelAgreement >= t).length / outSet.length;
  console.log(`${t.toFixed(2).padEnd(6)} ${(tp * 100).toFixed(1).padStart(5)}%${"".padEnd(26)} ${(fp * 100).toFixed(1).padStart(5)}%${"".padEnd(26)} ${(tp - fp >= 0 ? "+" : "") + (tp - fp).toFixed(3)}`);
}

console.log(`\nOVERLAP — if the two distributions overlap, no threshold on that measure can separate them.`);
for (const [label, pick] of [["interval low bound", (r: Row) => r.low], ["log-likelihood/marker", (r: Row) => r.logLik],
  ["label agreement", (r: Row) => r.labelAgreement],
  ["distinct winners", (r: Row) => r.distinctWinners]] as const) {
  const a = inSet.map(pick), b = outSet.map(pick);
  console.log(`${label.padEnd(24)} represented median ${median(a).toFixed(4)} [${Math.min(...a).toFixed(4)}, ${Math.max(...a).toFixed(4)}]`);
  console.log(`${"".padEnd(24)} unrepresented median ${median(b).toFixed(4)} [${Math.min(...b).toFixed(4)}, ${Math.max(...b).toFixed(4)}]`);
}
