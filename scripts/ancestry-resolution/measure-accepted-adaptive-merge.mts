/** Re-measure the accepted rule, preserving the earlier simulation and fit settings.
 * Public reference frequencies generate synthetic diploid people. No person file is read.
 * Run: node --import tsx scripts/ancestry-resolution/measure-accepted-adaptive-merge.mts
 * SEEDS defaults to 20. Add --include-ceiling for population-present figures.
 * Add --marker-sweep for paired held-out results at 42, 84, 126 and 168 markers.
 * Add --convergence-sensitivity for 2,000→10,000→50,000 iteration comparisons.
 * Add --output=PATH to save a deterministic measurement record.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { reportedRows, type ReportingRule } from "./adaptive-reporting";
import { buildReference, canonicalJson, markerKey, REFERENCE_VERSION, REGION_CODES, SAMPLE_CAP, validateInputs } from "./seven-region-reference";
import { fitRegionalMixtureDetailed as fit, REGIONAL_FIT_LIMIT, REGIONAL_FIT_TOLERANCE, REGIONAL_POPS, REGIONAL_CONFUSABLE, REGIONAL_MERGE_THRESHOLD, regionalReporting, type RegionalProportions, type RegionalFit } from "../../src/lib/genome/regional-admixture";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const source = {
  markers: JSON.parse(fs.readFileSync(path.join(ROOT, "data/ref/aims.json"), "utf8")),
  frequencies: JSON.parse(fs.readFileSync(path.join(HERE, "hgdp-tgp-freqs.json"), "utf8")),
  populations: JSON.parse(fs.readFileSync(path.join(HERE, "hgdp-tgp-populations.json"), "utf8")),
};
const input = validateInputs(source.markers, source.frequencies, source.populations);
if (JSON.stringify(REGIONAL_POPS) !== JSON.stringify(REGION_CODES) || JSON.stringify(REGIONAL_CONFUSABLE) !== JSON.stringify(["EUR", "MID", "CSA"]) || REGIONAL_MERGE_THRESHOLD !== 0.10) throw new Error("Production reporting policy differs from the measured rule");
const SEEDS = Number(process.env.SEEDS ?? 20);
if (!Number.isSafeInteger(SEEDS) || SEEDS < 1) throw new Error("SEEDS must be a positive integer");
const clamp = (v: number) => Math.min(0.999, Math.max(0.001, v));
const productionLimit = Number(REGIONAL_FIT_LIMIT);
const RULES: ReportingRule[] = ["seven-regions", "earlier-hot-only", "accepted-all-three", "global-all-three"];
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
interface PopulationScore {
  population: string;
  region: string;
  meanWorstWrongRow: number;
  mergedDraws: number;
  meanRowsAboveOnePercent: number;
  topReportedRowCorrectDraws: number;
}
const scenarios = process.argv.includes("--include-ceiling") ? ["held-out", "population-present-ceiling"] as const : ["held-out"] as const;
const markerCounts = process.argv.includes("--marker-sweep") ? [42, 84, 126, 168] : [168];
const shuffledIndices = input.markers.map((_, i) => i);
{
  const random = mulberry32(99);
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
  }
}
const runs = [];
interface SensitivityCase { population: string; draw: number; maxComponentChange: number; extendedConverged: boolean; extendedIterations: number; acceptedTriggerChanged: boolean; reportedPercentagesChangedAtOneDecimal: boolean; baselineShares: number[]; extendedShares: number[] }
const sensitivity: SensitivityCase[] = [], residualSensitivity: SensitivityCase[] = [];
function compareFits(population: string, draw: number, baseline: RegionalFit, extended: RegionalFit): SensitivityCase {
  const rows = reportedRows(baseline.q, "accepted-all-three"), extendedRows = reportedRows(extended.q, "accepted-all-three");
  const signature = (rows: ReturnType<typeof reportedRows>) => JSON.stringify(rows.map((r) => ({ members: r.members, percent: (r.share * 100).toFixed(1) })));
  return { population, draw, maxComponentChange: Math.max(...baseline.q.map((v, k) => Math.abs(v - extended.q[k]))), extendedConverged: extended.converged, extendedIterations: extended.iterations, acceptedTriggerChanged: rows.length !== extendedRows.length, reportedPercentagesChangedAtOneDecimal: signature(rows) !== signature(extendedRows), baselineShares: baseline.q, extendedShares: extended.q };
}
function summarizeSensitivity(cases: SensitivityCase[], baselineMaximumIterations: number, extendedMaximumIterations: number) {
  return cases.length ? {
    scenario: "held-out, all 168 markers, only draws reaching the baseline iteration limit",
    baselineMaximumIterations, extendedMaximumIterations,
    testedDraws: cases.length, stillUnconverged: cases.filter((s) => !s.extendedConverged).length,
    maximumExtendedIterationsObserved: Math.max(...cases.map((s) => s.extendedIterations)),
    acceptedTriggerChanges: cases.filter((s) => s.acceptedTriggerChanged).length,
    reportsChangingAtOneDecimalPercent: cases.filter((s) => s.reportedPercentagesChangedAtOneDecimal).length,
    maxComponentChangeQuantiles: Object.fromEntries([0.5, 0.9, 0.95, 0.99, 1].map((quantile) => [quantile, cases.map((s) => s.maxComponentChange).sort((a, b) => a - b)[Math.min(cases.length - 1, Math.ceil(quantile * cases.length) - 1)]])),
    triggerChangeCases: cases.filter((s) => s.acceptedTriggerChanged),
    largestChanges: [...cases].sort((a, b) => b.maxComponentChange - a.maxComponentChange).slice(0, 10),
    interpretation: "Iteration sensitivity measures numerical stability, not ancestry accuracy or uncertainty calibration. A changed trigger can remove or restore two separate region rows even when the component changes are small.",
  } : null;
}
const runConfigs = markerCounts.flatMap((markerCount) => scenarios.filter((scenario) => scenario === "held-out" || markerCount === 168).map((scenario) => ({ scenario, markerCount })));
for (const { markerCount, scenario } of runConfigs) {
  const indices = shuffledIndices.slice(0, markerCount).sort((a, b) => a - b);
  const perRule = Object.fromEntries(RULES.map((r) => [r, [] as PopulationScore[]])) as Record<ReportingRule, PopulationScore[]>;
  let unconvergedDraws = 0, reportDifferences = 0;
  for (const pop of Object.keys(input.populations).sort()) {
    const fullRows = buildReference(input, scenario === "held-out" ? pop : undefined).map((m) => REGION_CODES.map((r) => clamp(m.freqs[r])));
    const rows = indices.map((i) => fullRows[i]);
    const truth = input.markers.map((m) => { const c = input.counts[markerKey(m)][pop]; return clamp(c.ac / c.an); });
    const want = REGION_CODES.indexOf(input.populations[pop].region);
    const scores = Object.fromEntries(RULES.map((r) => [r, { population: pop, region: input.populations[pop].region, meanWorstWrongRow: 0, mergedDraws: 0, meanRowsAboveOnePercent: 0, topReportedRowCorrectDraws: 0 }])) as Record<ReportingRule, PopulationScore>;
    for (let s = 0; s < SEEDS; s++) {
      const random = mulberry32(0x5eed + s * 7919 + pop.length * 104_729 + pop.charCodeAt(0) * 31);
      const fullDosages = truth.map((f) => (random() < f ? 1 : 0) + (random() < f ? 1 : 0));
      const fitted = fit(rows, indices.map((i) => fullDosages[i]));
      if (!fitted.converged) unconvergedDraws++;
      const accepted = reportedRows(fitted.q, "accepted-all-three");
      const actual = regionalReporting(Object.fromEntries(REGION_CODES.map((r, k) => [r, fitted.q[k]])) as RegionalProportions);
      if (actual.merged !== accepted.some((r) => r.members.length > 1)) throw new Error("Production adaptive trigger differs from measurement");
      if (process.argv.includes("--convergence-sensitivity") && scenario === "held-out" && markerCount === 168) {
        const baseline = productionLimit === 2000 ? fitted : fit(rows, fullDosages, { maxIterations: 2000 });
        if (!baseline.converged) {
          const extended = productionLimit === 10000 ? fitted : fit(rows, fullDosages, { maxIterations: 10000 });
          sensitivity.push(compareFits(pop, s, baseline, extended));
          if (!extended.converged) {
            const further = productionLimit === 50000 ? fitted : fit(rows, fullDosages, { maxIterations: 50000 });
            residualSensitivity.push(compareFits(pop, s, extended, further));
          }
        }
      }
      if (canonicalJson(reportedRows(fitted.q, "earlier-hot-only")) !== canonicalJson(reportedRows(fitted.q, "accepted-all-three"))) reportDifferences++;
      for (const rule of RULES) {
        const reported = reportedRows(fitted.q, rule), score = scores[rule];
        score.meanWorstWrongRow += Math.max(0, ...reported.filter((r) => !r.members.includes(want)).map((r) => r.share)) / SEEDS;
        score.mergedDraws += Number(reported.some((r) => r.members.length > 1));
        score.meanRowsAboveOnePercent += reported.filter((r) => r.share >= 0.01).length / SEEDS;
        const top = reported.reduce((best, row) => row.share > best.share ? row : best);
        score.topReportedRowCorrectDraws += Number(top.members.includes(want));
      }
    }
    for (const rule of RULES) perRule[rule].push(scores[rule]);
  }
  const totalDraws = Object.keys(input.populations).length * SEEDS;
  const rules = RULES.map((rule) => {
    const perPopulation = perRule[rule], nonAmr = perPopulation.filter((p) => p.region !== "AMR");
    const mergedDraws = perPopulation.reduce((n, p) => n + p.mergedDraws, 0);
    return {
      rule, mergedDraws, totalDraws, mergedFraction: mergedDraws / totalDraws,
      topReportedRowCorrectDraws: perPopulation.reduce((n, p) => n + p.topReportedRowCorrectDraws, 0),
      topReportedRowCorrectFraction: perPopulation.reduce((n, p) => n + p.topReportedRowCorrectDraws, 0) / totalDraws,
      meanRowsAboveOnePercent: perPopulation.reduce((n, p) => n + p.meanRowsAboveOnePercent, 0) / perPopulation.length,
      nonAmrPopulationCount: nonAmr.length,
      nonAmrCohortsWithMeanWorstWrongRowAtLeast: Object.fromEntries([0.1, 0.2, 0.3].map((t) => [t.toFixed(2), nonAmr.filter((p) => p.meanWorstWrongRow >= t).length])),
      nonAmrMeanWorstWrongRow: nonAmr.reduce((n, p) => n + p.meanWorstWrongRow, 0) / nonAmr.length,
      worstNonAmrPopulation: [...nonAmr].sort((a, b) => b.meanWorstWrongRow - a.meanWorstWrongRow)[0],
      regionSubgroups: REGION_CODES.map((region) => {
        const members = perPopulation.filter((p) => p.region === region);
        const correct = members.reduce((n, p) => n + p.topReportedRowCorrectDraws, 0);
        return { region, populationCount: members.length, draws: members.length * SEEDS, topReportedRowCorrectDraws: correct, topReportedRowCorrectFraction: correct / (members.length * SEEDS), worstPopulation: [...members].sort((a, b) => b.meanWorstWrongRow - a.meanWorstWrongRow)[0] };
      }),
      perPopulation,
    };
  });
  runs.push({ scenario, markerCount, markerKeys: indices.map((i) => markerKey(input.markers[i])), unconvergedDraws, totalDraws, reportsDifferingFromEarlierRule: reportDifferences, rules });
  console.log(`${scenario}, ${markerCount} markers: ${totalDraws} synthetic draws, ${unconvergedDraws} reached the iteration limit; ${reportDifferences} reports differ between adaptive rules.`);
  for (const r of rules) console.log(`${r.rule}: top row correct ${(100 * r.topReportedRowCorrectFraction).toFixed(2)}%; non-AMR >=10/20/30% ${Object.values(r.nonAmrCohortsWithMeanWorstWrongRowAtLeast).join("/")}; merged ${r.mergedDraws}/${r.totalDraws} (${(100 * r.mergedFraction).toFixed(2)}%); mean wrong row ${r.nonAmrMeanWorstWrongRow.toFixed(4)}.`);
}
const result = {
  referenceVersion: REFERENCE_VERSION,
  sourceCanonicalSha256: Object.fromEntries(Object.entries(source).map(([name, value]) => [name, createHash("sha256").update(canonicalJson(value)).digest("hex")])),
  markerCount: input.markers.length, populationCount: Object.keys(input.populations).length, seedsPerPopulation: SEEDS, cap: SAMPLE_CAP,
  fit: { implementation: "src/lib/genome/regional-admixture.ts:fitRegionalMixtureDetailed", maximumIterations: REGIONAL_FIT_LIMIT, convergenceMaxShareDelta: REGIONAL_FIT_TOLERANCE, likelihoodFrequencyBounds: [0.001, 0.999], initialShares: "uniform" },
  simulation: "Independent diploid Bernoulli draws from each public population's ALT frequencies, clipped to [0.001, 0.999] to preserve the earlier experiment. Seed = 0x5eed + drawIndex*7919 + populationName.length*104729 + populationName.charCodeAt(0)*31. No real person file is read.",
  heldOut: "Each synthetic person's entire source population is removed before calculating capped regional frequencies. This is the expected measurement; population-present figures, when included, are the ceiling.",
  markerSubsets: "Nested subsets from a Fisher-Yates shuffle of the original 168 marker indices using mulberry32 seed99, then sorted back to original order. Each draw first generates the full168-marker synthetic genotype in original order; the same person's dosages are reused for every subset. One deterministic missing-marker pattern per count is tested, not every file's pattern or a redesigned panel.",
  scoring: "A row is counted as right when it contains the source population's region. For each population, average the largest wrong reported row over draws. Count non-AMR populations above each error threshold. All 78 populations remain in fitting and simulation; AMR is excluded only from this error tally because its cohort label combines admixed and Indigenous American references.",
  interpretation: "The merged fraction describes these equally sampled reference cohorts, not the proportion of real readers. A broad combined row is easier to count as right because it covers three regions; lower wrong-row counts are not validation of the internal split. Independent marker draws omit linkage and do not establish clinical validity or individual confidence interval calibration.",
  adaptiveLimitation: "The adaptive rule cannot distinguish genuine mixed ancestry from this panel's confusion. It merges both, and people with mixed ancestry disproportionately lose separate region detail.",
  convergenceSensitivity: summarizeSensitivity(sensitivity, 2000, 10000),
  residualConvergenceSensitivity: summarizeSensitivity(residualSensitivity, 10000, 50000),
  runs,
};
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(result, null, 2) + "\n");
