import { validSourceReadDate } from "./report-evidence";

export const STUDY_CONTEXT_FIELDS = ["measured", "population", "comparison", "limitation"] as const;
export type StudyContextField = (typeof STUDY_CONTEXT_FIELDS)[number];
export type StudyContext = Record<StudyContextField, { text: string; locator: string } | null>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Optional, source-bound editorial context; never a personal result or evidence upgrade. */
export function studyContextFindings(citation: unknown): string[] {
  if (!record(citation) || citation.studyContext === undefined) return [];
  const findings: string[] = [];
  const validPmid = typeof citation.pmid === "string" && /^\d{6,9}$/.test(citation.pmid);
  const validDoi = typeof citation.doi === "string" && /^10\.\d{4,9}\/\S+$/.test(citation.doi);
  // The citation renderer prefers PMID. A valid fallback must not admit a
  // malformed supplied identifier and attach context to an invalid source link.
  if ((!validPmid && !validDoi) ||
      (citation.pmid !== undefined && !validPmid) ||
      (citation.doi !== undefined && !validDoi))
    findings.push("studyContext needs a valid source identifier");
  if (typeof citation.accessedOn !== "string" || !validSourceReadDate(citation.accessedOn))
    findings.push("studyContext needs a valid source-read date");
  const context = citation.studyContext;
  if (!record(context)) return [...findings, "studyContext must be an object"];
  for (const field of STUDY_CONTEXT_FIELDS) {
    const entry = context[field];
    if (entry === null) continue;
    if (!record(entry) || typeof entry.text !== "string" || !entry.text.trim() ||
        typeof entry.locator !== "string" || !entry.locator.trim())
      findings.push(`studyContext.${field} needs text and a paper location, or explicit null`);
  }
  return findings;
}

/** Unknown/malformed stored JSON is withheld, not filled from another report or today's date. */
export function readStudyContext(citation: unknown): StudyContext | null {
  if (!record(citation) || citation.studyContext === undefined || studyContextFindings(citation).length) return null;
  return Object.fromEntries(STUDY_CONTEXT_FIELDS.map((field) => [field, (citation.studyContext as StudyContext)[field]])) as StudyContext;
}

/** Same validation used by the seed writer and gate, preserving citation JSON through storage. */
export function seedCitations<T>(citations: T[]): T[] {
  for (const citation of citations) {
    const findings = studyContextFindings(citation);
    if (findings.length) throw new Error(findings.join("; "));
  }
  return citations;
}
