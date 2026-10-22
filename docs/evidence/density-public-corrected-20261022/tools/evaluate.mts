// Evaluate one capture directory from tools/capture.mjs against every budget,
// under the contract rules and under the owner's corrected rules of
// 2026-10-22, with the one evaluator the census uses:
// `evaluateDensityCapture` in scripts/density-current.ts.
//
// usage: node --import tsx evaluate.mts <predecessors.json> <capture dir>
//   <predecessors.json>  docs/evidence/density-public-20261022/measurements.json,
//                        whose `baseline` holds the frozen baseline re-captured
//                        on the same machine and browser build
//   <capture dir>        computed-measurements.json and floor-computed.json from
//                        the unchanged compute.mjs, plus capture-manifest.json
//                        and corrected-readings.json from tools/capture.mjs
// Writes <capture dir>/evaluation.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDensityCapture, requiredDensityCaptures, TEXT_ONLY_FLOOR_VARIANT_SHA256,
  type DensityContract, type DensityCurrentPacket, type DensityRegister } from "../../../../scripts/density-current";

type Capture = DensityCurrentPacket["captures"][number];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const [predecessorsFile, directory] = process.argv.slice(2);
if (!predecessorsFile || !directory) throw new Error("usage: evaluate.mts <predecessors.json> <capture dir>");
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const register = read(path.join(ROOT, "docs/route-register.json")) as DensityRegister;
const contract = read(path.join(ROOT, "docs/density-baseline.json")) as DensityContract;
const product = read(path.join(directory, "computed-measurements.json"));
const floor = read(path.join(directory, "floor-computed.json"));
const manifest = read(path.join(directory, "capture-manifest.json"));
const readings = read(path.join(directory, "corrected-readings.json"));
if (readings.variantSha256 !== TEXT_ONLY_FLOOR_VARIANT_SHA256) throw new Error("Foreign text-only floor variant");
const baseline = new Map<string, { inkCoverageRatio: number; screenshotSha256: string }>(
  read(predecessorsFile).baseline.map((row: { baselineRoute: string; viewport: string; inkCoverageRatio: number; screenshotSha256: string }) =>
    [`${row.baselineRoute}|${row.viewport}`, row]));
const environment: DensityCurrentPacket["captureEnvironment"] = { browserName: "chromium",
  browserVersion: manifest.captureEnvironment.browserVersion, platform: "same machine as the predecessors",
  fontManifestSha256: "0".repeat(64), theme: "light", devicePixelRatio: 1, locale: "en-US", timezone: "UTC" };
const required = requiredDensityCaptures(register);
const floors = new Map<string, Record<string, number | string>>(floor.routes.flatMap((route: { measurementPath: string; measurements: Record<string, Record<string, number | string>> }) =>
  Object.entries(route.measurements).map(([viewport, value]) => [`${route.measurementPath}|${viewport}`, value])));
type Verdict = ReturnType<typeof evaluateDensityCapture>;
interface EvaluatedRow {
  routeId: string; state: string; viewport: string; measurementPath: string;
  screenshotSha256: string; floorScreenshotSha256: string; ink: number; floorInk: number;
  predecessorInk: number | null; ratio: number | null; floorRatio: number | null;
  readings: Capture["correctedReadings"]; frozen: Record<string, number | null>;
  contract: { misses: string[]; relative: Verdict["relative"] }; corrected: { misses: string[]; relative: Verdict["relative"] };
}
const rows: EvaluatedRow[] = [];
for (const route of product.routes) {
  const routeId = manifest.routeIds[route.measurementPath];
  for (const [viewport, m] of Object.entries(route.measurements) as [Capture["viewport"], Capture["metrics"]][]) {
    const state = routeId.startsWith("auth.") ? "initial-form" : routeId === "marketing.embryo-analysis" ? "jurisdiction-unavailable" : "complete";
    const row = required.find(entry => entry.route.id === routeId && entry.state === state && entry.viewport === viewport);
    if (!row) throw new Error(`Unregistered capture ${routeId} ${state} ${viewport}`);
    const predecessor = contract.relativeComparison.routes.find(entry => entry.successorRouteId === routeId);
    const baselineState = contract.routes.find(entry => entry.route === predecessor?.baselineRoute)?.state;
    const before = predecessor && !["/ancestry", "/reports", "/dashboard"].includes(predecessor.baselineRoute)
      ? baseline.get(`${predecessor.baselineRoute}|${viewport}`) : undefined;
    const f = floors.get(`${route.measurementPath}|${viewport}`)!;
    const capture: Capture = { routeId, state, viewport, measurementPath: route.measurementPath, metrics: m,
      predecessor: before ? { baselineCommit: "864736979c92a08ba77e8580d61946eba6864918", baselineRoute: predecessor!.baselineRoute,
        state: baselineState!, captureEnvironment: { ...environment }, screenshotSha256: before.screenshotSha256,
        inkCoverageRatio: before.inkCoverageRatio } : null,
      textOnlyFloor: { variantSha256: readings.variantSha256, screenshotSha256: f.screenshotSha256 as string,
        screenshotWidthPx: f.screenshotWidthPx as number, screenshotHeightPx: f.screenshotHeightPx as number,
        includedPixelCount: f.includedPixelCount as number, excludedPixelCount: f.excludedPixelCount as number,
        inkPixelCount: f.inkPixelCount as number, inkCoverageRatio: f.inkCoverageRatio as number },
      correctedReadings: { moduleSha256: readings.moduleSha256, ...readings.routes[route.measurementPath][viewport] } };
    const contractVerdict = evaluateDensityCapture(row, capture, contract, environment, "contract");
    const correctedVerdict = evaluateDensityCapture(row, capture, contract, environment, "corrected-2026-10-22");
    const misses = (verdict: Verdict) => [...verdict.budgetBreaches,
      ...(verdict.predecessorError ? [verdict.predecessorError] : []), ...(verdict.relative && !verdict.relative.within ? ["relative"] : [])];
    rows.push({ routeId, state, viewport, measurementPath: route.measurementPath,
      screenshotSha256: m.screenshotSha256, floorScreenshotSha256: f.screenshotSha256 as string,
      ink: m.inkCoverageRatio, floorInk: f.inkCoverageRatio as number,
      predecessorInk: before?.inkCoverageRatio ?? null,
      ratio: before ? m.inkCoverageRatio / before.inkCoverageRatio : null,
      floorRatio: before ? (f.inkCoverageRatio as number) / before.inkCoverageRatio : null,
      readings: capture.correctedReadings,
      frozen: { visibleTextCharacterCount: m.visibleTextCharacterCount, minProseMeasureCh: m.minProseMeasureCh,
        minimumAdjacentSectionGapPx: m.minimumAdjacentSectionGapPx, interactiveElementCount: m.interactiveElementCount },
      contract: { misses: misses(contractVerdict), relative: contractVerdict.relative },
      corrected: { misses: misses(correctedVerdict), relative: correctedVerdict.relative } });
  }
}
fs.writeFileSync(path.join(directory, "evaluation.json"), JSON.stringify(rows, null, 1) + "\n");
const pass = (key: "contract" | "corrected") => rows.filter(row => row[key].misses.length === 0).length;
console.log(`captures ${rows.length}; every budget met: contract ${pass("contract")}, corrected ${pass("corrected")}`);
for (const row of rows) {
  const ratio = row.ratio === null ? "" : ` ratio ${row.ratio.toFixed(3)} floor ${row.floorRatio!.toFixed(3)}`;
  console.log(`${row.routeId.padEnd(35)} ${row.viewport.padEnd(9)}${ratio} | contract: ${row.contract.misses.join(", ") || "PASS"} | corrected: ${row.corrected.misses.join(", ") || "PASS"}`);
}
