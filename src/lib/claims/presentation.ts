import citations from "../../../data/citations.json";
import claims from "../../../data/claims.json";
import type { ReportTemplate } from "../genome/reports";

// This is the presentation index of the single canonical files, not a second
// registry or a substitute for commit-clock, source-review and corpus checks.
export const presentationCitations = citations;
const sourceById = new Map(citations.map((source) => [source.id, source]));
const claimById = new Map(claims.map((claim) => [claim.claim_id, claim]));
if (sourceById.size !== citations.length || claimById.size !== claims.length) {
  throw new Error("Duplicate canonical claim/source id");
}

export function presentationClaim(id: string) {
  return claimById.get(id);
}

export function presentationSource(id: string) {
  const source = sourceById.get(id);
  if (!source) throw new Error(`Unknown canonical source: ${id}`);
  return source;
}

export function claimSourceIds(claimIds: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const id of claimIds) {
    const claim = presentationClaim(id);
    if (!claim || !claim.evidence.length) throw new Error(`Unsupported canonical claim: ${id}`);
    for (const evidence of claim.evidence) {
      presentationSource(evidence.citation);
      ids.add(evidence.citation);
    }
  }
  return [...ids];
}

export function claimSourceAnchor(id: string): string {
  presentationSource(id);
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(id)) throw new Error("Invalid canonical source id");
  return `claim-source-${id}`;
}

export function registeredReportSummary(slug: string, text: string) {
  const claim = presentationClaim(`report.${slug}.summary`);
  // Transitional registration never lends a verified reference to changed
  // hosted prose. Unregistered text remains observable to the corpus audit.
  return claim?.text_verbatim === text ? claim : undefined;
}

export function registeredStudyContext(slug: string, pmid: string | undefined, field: string, text: string) {
  if (!pmid) return undefined;
  const claim = presentationClaim(`report.${slug}.study.${pmid.toLowerCase().replaceAll("/", "-")}.${field}`);
  return claim?.text_verbatim === text ? claim : undefined;
}

/** Identity and exact prose must both match; a changed result cannot borrow a citation. */
export function registeredReportInterpretation(slug: string, rsid: number, genotype: string, text: string) {
  if (!Number.isSafeInteger(rsid) || rsid <= 0 || !/^[ACGT]{2}$/.test(genotype)) return undefined;
  const key = genotype.split("").sort().join("").toLowerCase();
  const claim = presentationClaim(`report.${slug}.interpretation.rs${rsid}.${key}`);
  return claim?.text_verbatim === text ? claim : undefined;
}

export function reportSummarySourceIds(slug: string, text: string, existingIds: readonly string[]): string[] {
  const claim = registeredReportSummary(slug, text);
  if (!claim) return [];
  const required = claimSourceIds([claim.claim_id]);
  return [...new Set([...existingIds.filter((id) => required.includes(id)), ...required])];
}

/** Collect only exact registered prose, independently of summary rollout state. */
export function reportSourceIds(template: ReportTemplate): string[] {
  const ids: string[] = [];
  const summary = registeredReportSummary(template.slug, template.summary);
  if (summary) ids.push(summary.claim_id);
  for (const variant of template.variants) {
    for (const [genotype, text] of Object.entries(variant.interpretations)) {
      const claim = registeredReportInterpretation(template.slug, variant.rsid, genotype, text);
      if (claim) ids.push(claim.claim_id);
    }
  }
  for (const citation of template.citations) {
    for (const [field, value] of Object.entries(citation.studyContext ?? {})) {
      if (!value) continue;
      const claim = registeredStudyContext(template.slug, citation.pmid ?? citation.doi, field, value.text);
      if (claim) ids.push(claim.claim_id);
    }
  }
  const required = claimSourceIds(ids);
  return [...new Set([...template.citations.map(legacySourceId).filter((id) => required.includes(id)), ...required])];
}

export function legacySourceId(citation: { pmid?: string; doi?: string }): string {
  if (citation.pmid) return `pmid:${citation.pmid}`;
  const doi = citation.doi?.toLowerCase() ?? "";
  return presentationCitations.find((source) => source.type === "doi" && source.identifier.toLowerCase() === doi)?.id ?? `doi:${doi}`;
}

export function annotateReportSources<T extends { pmid?: string; doi?: string }>(sourceIds: readonly string[], citations: readonly T[]) {
  const seen = new Set<string>();
  return citations.map((citation) => {
    const id = legacySourceId(citation);
    const index = sourceIds.indexOf(id);
    const first = index >= 0 && !seen.has(id);
    seen.add(id);
    return { citation, anchor: first ? claimSourceAnchor(id) : undefined, number: first ? index + 1 : undefined };
  });
}
