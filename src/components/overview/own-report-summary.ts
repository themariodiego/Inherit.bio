import "server-only";
import { isFixtureSlug } from "@/components/reports/library";
import { filterOwnAnalysisFiles, loadOwnAnalysisCandidateFiles } from "@/lib/genome/own-analysis-access";
import { getPublishedTemplates, type Db } from "@/lib/genome/load";
import { getSubjectReportCalls } from "@/lib/genome/report-calls";
import { resolveTemplate } from "@/lib/genome/reports";
import { isStarterCandidate, selectStarterReports } from "./starter";

const PURPOSES = { estimate: "reports.polygenic", variant_call: "reports.monogenic" } as const;

/** Overview-only composition. No source-browser or Copilot permission is inferred. */
export async function loadOwnOverviewReports(db: Db, subjectId: string) {
  const [files, published] = await Promise.all([
    loadOwnAnalysisCandidateFiles(db, subjectId), getPublishedTemplates(db),
  ]);
  const templates = published.filter(template => !isFixtureSlug(template.slug));
  const reads = await Promise.all((["estimate", "variant_call"] as const).map(async layer => {
    // D-099: own record, so a revoked report purpose must also withdraw
    // results derived from a legacy source. Every read on this path is the
    // account's own subject (`/overview` passes `self.id`).
    const authorized = await filterOwnAnalysisFiles(db, subjectId, PURPOSES[layer], files, { gateLegacy: true });
    const candidates = templates.filter(template => (template.layer ?? "estimate") === layer && isStarterCandidate(template));
    const calls = authorized.length && candidates.length
      ? await getSubjectReportCalls(db, subjectId, candidates, { gateLegacy: true }) : null;
    return { layer, authorized, candidates, calls };
  }));
  // Recheck both purposes after all starter reads, including layers whose
  // candidates are deliberately excluded (for example Medicines).
  const layers = await Promise.all(reads.map(async ({ layer, authorized, candidates, calls }) => {
    const current = authorized.length ? await filterOwnAnalysisFiles(db, subjectId, PURPOSES[layer], authorized, { gateLegacy: true }) : [];
    const currentIds = new Set(current.map(file => file.id));
    const stableInputs = calls !== null && calls.fileCount > 0 && calls.checkedFileIds.every(id => currentIds.has(id));
    return {
      layer, ready: current.length > 0, showStarter: stableInputs,
      resolved: stableInputs && calls ? candidates.map(template => resolveTemplate(template, rsid => calls.genotypes.get(rsid))) : [],
    };
  }));
  return {
    hasReports: layers.some(layer => layer.ready),
    // Metadata only: this does not unlock any report or read genetic calls.
    hasPreparedSource: files.some(file => file.single_logical_sample_verified_at != null),
    // Preserve catalog sizes/labels, but show a layer only once its results
    // are live: the existing notes refer to the reader's own DNA.
    estimateCount: layers.some(layer => layer.layer === "estimate" && layer.ready)
      ? templates.filter(template => (template.layer ?? "estimate") === "estimate").length : 0,
    variantCallCount: layers.some(layer => layer.layer === "variant_call" && layer.ready)
      ? templates.filter(template => template.layer === "variant_call").length : 0,
    showStarter: layers.some(layer => layer.showStarter),
    starter: selectStarterReports(layers.flatMap(layer => layer.resolved)),
  };
}
