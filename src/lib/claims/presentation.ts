import citations from "../../../data/citations.json";
import claims from "../../../data/claims.json";

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
  const claim = presentationClaim(`report.${slug}.study.${pmid}.${field}`);
  return claim?.text_verbatim === text ? claim : undefined;
}

export function reportSummarySourceIds(slug: string, text: string, existingIds: readonly string[]): string[] {
  const claim = registeredReportSummary(slug, text);
  if (!claim) return [];
  const required = claimSourceIds([claim.claim_id]);
  return [...new Set([...existingIds.filter((id) => required.includes(id)), ...required])];
}

export function legacySourceId(citation: { pmid?: string; doi?: string }): string {
  return citation.pmid ? `pmid:${citation.pmid}` : `doi:${citation.doi?.toLowerCase() ?? ""}`;
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
