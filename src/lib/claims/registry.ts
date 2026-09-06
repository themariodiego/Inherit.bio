/** Canonical metadata only. Passing validation does not certify scientific or legal support. */
export const CITATION_TYPES = ["pmid", "doi", "statute", "registry", "regulator", "dataset"] as const;
export type CitationType = (typeof CITATION_TYPES)[number];
export interface Citation {
  id: string;
  type: CitationType;
  identifier: string;
  url: string;
  archived_path: string | null;
  access_date: string;
  quote: string;
  /** The source's supporting scope in words, not an inferred claim-id edge. */
  claim: string;
}
export interface ClaimEvidence {
  citation: string;
  doi_or_url: string;
  accessed_on: string;
  what_it_supports: string;
}
export interface Claim {
  claim_id: string;
  text_verbatim: string;
  surfaces: readonly string[];
  claim_type: "objective" | "descriptive";
  evidence: readonly Readonly<ClaimEvidence>[];
  net_impression_note: string;
  reviewed_on: string;
  reviewer: string;
}
export interface ClaimOccurrence { claimId: string; text: string; surface: string }
export interface RegistryInput {
  citations: unknown;
  claims: unknown;
  /** UTC calendar date of the content commit; deliberately no wall-clock default. */
  commitDate: string;
  corpus: readonly ClaimOccurrence[];
  /** Explicit source-policy classification supplied by the inventory, never guessed from prose. */
  refusalClaimIds: readonly string[];
  societyPositionClaimIds: readonly string[];
  /** Must check a real file, within the repository, not just an existing directory or escaping symlink. */
  archiveExists: (repoRelativePath: string) => boolean;
}
export type IssueCode = "invalid-shape" | "invalid-field" | "invalid-id" | "duplicate-id" | "duplicate-source" |
  "invalid-date" | "future-date" | "invalid-identifier" | "invalid-url" | "identifier-url-mismatch" |
  "invalid-archive-path" | "archive-required" | "archive-missing" | "archive-check-failed" |
  "quote-too-long" | "zero-support" | "unknown-citation" | "duplicate-evidence" |
  "evidence-url-mismatch" | "evidence-date-mismatch" | "stale-citation" |
  "unknown-claim" | "orphan-claim" | "orphan-citation" | "corpus-text-mismatch" |
  "corpus-surface-mismatch" | "unused-surface" | "society-source-type";
export interface RegistryIssue { code: IssueCode; path: string; message: string }
export interface ResolvedClaim { claim: Readonly<Claim>; citations: readonly Readonly<Citation>[] }
export interface ClaimRegistry {
  resolveCitation(id: string): Readonly<Citation> | undefined;
  resolveClaim(id: string): Readonly<ResolvedClaim> | undefined;
}
export type RegistryValidation = { ok: false; issues: RegistryIssue[] } |
  { ok: true; issues: []; registry: ClaimRegistry };

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const PMID = /^[1-9]\d{0,7}$/;
const DOI = /^10\.\d{4,9}\/\S+$/;
const DAY = 86_400_000;
const CITATION_KEYS = ["id", "type", "identifier", "url", "archived_path", "access_date", "quote", "claim"];
const CLAIM_KEYS = ["claim_id", "text_verbatim", "surfaces", "claim_type", "evidence", "net_impression_note", "reviewed_on", "reviewer"];
const EVIDENCE_KEYS = ["citation", "doi_or_url", "accessed_on", "what_it_supports"];
type Row = Record<string, unknown>;

function record(value: unknown): value is Row { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value); }
function dateDay(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return null;
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value ? instant / DAY : null;
}
function safeUrl(value: unknown): URL | null {
  if (!text(value) || value !== value.trim() || /[\s\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function archivePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("docs/sources/") &&
    value.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(part) && part.trim() === part);
}
function identifierValid(type: unknown, value: unknown): boolean {
  if (!text(value) || value !== value.trim()) return false;
  if (type === "pmid") return PMID.test(value);
  if (type === "doi") return DOI.test(value);
  if (type === "registry" && /^NCT/i.test(value)) return /^NCT\d{8}$/.test(value);
  // Other official identifier grammars vary by authority. Require a concrete
  // identifier, without pretending this syntax check proves a record exists.
  return value.length <= 512 && /^[A-Za-z0-9][A-Za-z0-9 ._:()/+-]*$/.test(value);
}
function permanentUrlMatches(citation: Row, url: URL): boolean {
  if (citation.type !== "pmid" && citation.type !== "doi") return true;
  if (url.protocol !== "https:" || url.port || url.search || url.hash) return false;
  let identifier: string;
  try { identifier = decodeURIComponent(url.pathname.slice(1)); } catch { return false; }
  if (citation.type === "pmid") return url.hostname === "pubmed.ncbi.nlm.nih.gov" && identifier.replace(/\/$/, "") === citation.identifier;
  return ["doi.org", "dx.doi.org"].includes(url.hostname) && identifier.toLowerCase() === String(citation.identifier).toLowerCase();
}

/** Validate the canonical shape and injected corpus; never fetch, coerce legacy data, or invent support. */
export function validateClaimRegistry(input: RegistryInput): RegistryValidation {
  const issues: RegistryIssue[] = [];
  const add = (code: IssueCode, path: string, message: string) => { issues.push({ code, path, message }); };
  if (typeof input.archiveExists !== "function") add("invalid-field", "archiveExists", "An explicit archive-file checker is required.");
  const shape = (value: unknown, keys: readonly string[], path: string): value is Row => {
    if (!record(value)) { add("invalid-shape", path, "Expected a canonical object."); return false; }
    for (const key of keys) if (!Object.hasOwn(value, key)) add("invalid-field", `${path}.${key}`, "Required field is missing.");
    for (const key of Object.keys(value)) if (!keys.includes(key)) add("invalid-field", `${path}.${key}`, "Unknown field; legacy aliases are not accepted.");
    return true;
  };
  const requiredText = (value: unknown, path: string) => { if (!text(value)) add("invalid-field", path, "Expected nonempty text without control characters."); };
  const commit = dateDay(input.commitDate);
  if (commit === null) add("invalid-date", "commitDate", "Expected a real UTC calendar date in YYYY-MM-DD form.");
  const date = (value: unknown, path: string) => {
    const day = dateDay(value);
    if (day === null) add("invalid-date", path, "Expected a real UTC calendar date in YYYY-MM-DD form.");
    else if (commit !== null && day > commit) add("future-date", path, "Date is after the content commit.");
    return day;
  };
  const citations = new Map<string, { row: Row; index: number; day: number | null }>();
  // One canonical entry per publication/official record. Reusing a source
  // means adding claim edges, not splitting quotations across new source ids.
  const sourceIdentities = new Set<string>();
  const claims = new Map<string, { row: Row; index: number }>();
  if (!Array.isArray(input.citations)) add("invalid-shape", "citations", "Expected the canonical citation array.");
  for (const [index, row] of (Array.isArray(input.citations) ? input.citations : []).entries()) {
    const path = `citations[${index}]`;
    if (!shape(row, CITATION_KEYS, path)) continue;
    if (typeof row.id !== "string" || !ID.test(row.id)) add("invalid-id", `${path}.id`, "Expected a stable canonical id.");
    else if (citations.has(row.id)) add("duplicate-id", `${path}.id`, "Citation id is duplicated.");
    else citations.set(row.id, { row, index, day: dateDay(row.access_date) });
    if (!CITATION_TYPES.includes(row.type as CitationType)) add("invalid-field", `${path}.type`, "Unknown citation type.");
    if (!identifierValid(row.type, row.identifier)) add("invalid-identifier", `${path}.identifier`, "Identifier does not match the citation type.");
    else if (CITATION_TYPES.includes(row.type as CitationType)) {
      const identifier = row.type === "doi" ? String(row.identifier).toLowerCase() : row.identifier;
      const sourceIdentity = `${row.type}:${identifier}`;
      if (sourceIdentities.has(sourceIdentity)) add("duplicate-source", `${path}.identifier`, "Reuse the existing source id instead of duplicating its record or quote budget.");
      sourceIdentities.add(sourceIdentity);
    }
    const url = safeUrl(row.url);
    if (!url) add("invalid-url", `${path}.url`, "Expected an absolute HTTP(S) URL without credentials.");
    else if (!permanentUrlMatches(row, url)) add("identifier-url-mismatch", `${path}.url`, "Permanent source URL does not identify this PMID or DOI.");
    date(row.access_date, `${path}.access_date`);
    requiredText(row.quote, `${path}.quote`); requiredText(row.claim, `${path}.claim`);
    if (text(row.quote) && row.quote.trim().split(/\s+/u).length > 25) add("quote-too-long", `${path}.quote`, "A supporting quotation must not exceed 25 words.");
    if (row.archived_path === null) {
      if (row.type !== "pmid" && row.type !== "doi") add("archive-required", `${path}.archived_path`, "A non-permanent source requires a local snapshot.");
    } else if (!archivePath(row.archived_path)) add("invalid-archive-path", `${path}.archived_path`, "Expected a safe repository-relative file under docs/sources.");
    else {
      try { if (input.archiveExists(row.archived_path) !== true) add("archive-missing", `${path}.archived_path`, "The source snapshot is missing."); }
      catch { add("archive-check-failed", `${path}.archived_path`, "The source snapshot could not be checked."); }
    }
  }
  if (!Array.isArray(input.claims)) add("invalid-shape", "claims", "Expected the canonical claim array.");
  const usedCitations = new Set<string>();
  for (const [index, row] of (Array.isArray(input.claims) ? input.claims : []).entries()) {
    const path = `claims[${index}]`;
    if (!shape(row, CLAIM_KEYS, path)) continue;
    if (typeof row.claim_id !== "string" || !ID.test(row.claim_id)) add("invalid-id", `${path}.claim_id`, "Expected a stable canonical id.");
    else if (claims.has(row.claim_id)) add("duplicate-id", `${path}.claim_id`, "Claim id is duplicated.");
    else claims.set(row.claim_id, { row, index });
    for (const key of ["text_verbatim", "net_impression_note", "reviewer"]) requiredText(row[key], `${path}.${key}`);
    if (typeof row.claim_type !== "string" || !["objective", "descriptive"].includes(row.claim_type)) add("invalid-field", `${path}.claim_type`, "Expected objective or descriptive.");
    date(row.reviewed_on, `${path}.reviewed_on`);
    if (!Array.isArray(row.surfaces) || !row.surfaces.length || row.surfaces.some((surface) => !text(surface)) || new Set(row.surfaces).size !== row.surfaces.length) add("invalid-field", `${path}.surfaces`, "Expected a nonempty, unique surface list.");
    if (!Array.isArray(row.evidence) || !row.evidence.length) add("zero-support", `${path}.evidence`, "Every claim requires evidence; a hedge is not evidence.");
    const seen = new Set<string>();
    for (const [evidenceIndex, item] of (Array.isArray(row.evidence) ? row.evidence : []).entries()) {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      if (!shape(item, EVIDENCE_KEYS, evidencePath)) continue;
      requiredText(item.what_it_supports, `${evidencePath}.what_it_supports`);
      date(item.accessed_on, `${evidencePath}.accessed_on`);
      const citation = typeof item.citation === "string" ? citations.get(item.citation) : undefined;
      if (!citation) { add("unknown-citation", `${evidencePath}.citation`, "Citation id does not resolve."); continue; }
      usedCitations.add(item.citation as string);
      if (seen.has(item.citation as string)) add("duplicate-evidence", `${evidencePath}.citation`, "Citation is repeated for this claim.");
      seen.add(item.citation as string);
      const evidenceUrl = safeUrl(item.doi_or_url), canonicalUrl = safeUrl(citation.row.url);
      const bareDoi = citation.row.type === "doi" && typeof item.doi_or_url === "string" && item.doi_or_url.toLowerCase() === String(citation.row.identifier).toLowerCase();
      if (!bareDoi && (!evidenceUrl || !canonicalUrl || evidenceUrl.href !== canonicalUrl.href)) add("evidence-url-mismatch", `${evidencePath}.doi_or_url`, "Evidence must identify the canonical citation URL or its exact DOI.");
      if (item.accessed_on !== citation.row.access_date) add("evidence-date-mismatch", `${evidencePath}.accessed_on`, "Evidence date must equal the canonical source access date.");
    }
  }
  const shortLived = new Set<string>();
  for (const key of ["refusalClaimIds", "societyPositionClaimIds"] as const) {
    if (!Array.isArray(input[key])) { add("invalid-shape", key, "Explicit claim-policy ids are required."); continue; }
    for (const [index, id] of input[key].entries()) {
      const claim = claims.get(id);
      if (!claim) { add("unknown-claim", `${key}[${index}]`, "Policy claim id does not resolve."); continue; }
      for (const evidence of Array.isArray(claim.row.evidence) ? claim.row.evidence : []) {
        if (!record(evidence) || typeof evidence.citation !== "string") continue;
        shortLived.add(evidence.citation);
        const citation = citations.get(evidence.citation);
        if (key === "societyPositionClaimIds" && citation && !["doi", "pmid"].includes(String(citation.row.type))) add("society-source-type", `claims[${claim.index}].evidence`, "Society positions require a PMID or DOI source.");
      }
    }
  }
  for (const [id, citation] of citations) {
    if (!usedCitations.has(id)) add("orphan-citation", `citations[${citation.index}].id`, "Citation has no claim using it.");
    const maximum = ["registry", "statute"].includes(String(citation.row.type)) || shortLived.has(id) ? 365 : 730;
    if (commit !== null && citation.day !== null && commit - citation.day >= maximum) add("stale-citation", `citations[${citation.index}].access_date`, `Source requires re-verification at ${maximum} days from the content commit.`);
  }
  const appearances = new Map<string, Set<string>>();
  if (!Array.isArray(input.corpus)) add("invalid-shape", "corpus", "An explicit rendered claim corpus is required.");
  for (const [index, occurrence] of (Array.isArray(input.corpus) ? input.corpus : []).entries()) {
    const path = `corpus[${index}]`;
    if (!shape(occurrence, ["claimId", "text", "surface"], path)) continue;
    const claim = typeof occurrence.claimId === "string" ? claims.get(occurrence.claimId) : undefined;
    if (!claim) { add("unknown-claim", `${path}.claimId`, "Rendered claim id does not resolve."); continue; }
    if (occurrence.text !== claim.row.text_verbatim) add("corpus-text-mismatch", `${path}.text`, "Rendered text must equal the registered claim verbatim.");
    if (!Array.isArray(claim.row.surfaces) || !claim.row.surfaces.includes(occurrence.surface)) add("corpus-surface-mismatch", `${path}.surface`, "Rendered surface is not declared for this claim.");
    const used = appearances.get(occurrence.claimId as string) ?? new Set<string>();
    if (typeof occurrence.surface === "string") used.add(occurrence.surface);
    appearances.set(occurrence.claimId as string, used);
  }
  for (const [id, claim] of claims) {
    const used = appearances.get(id);
    if (!used) add("orphan-claim", `claims[${claim.index}].claim_id`, "Claim does not appear in the supplied corpus.");
    for (const [index, surface] of (Array.isArray(claim.row.surfaces) ? claim.row.surfaces : []).entries()) if (!used?.has(surface)) add("unused-surface", `claims[${claim.index}].surfaces[${index}]`, "Declared surface has no rendered occurrence.");
  }
  if (issues.length) return { ok: false, issues };
  // Copy and freeze returned values so neither caller input mutation nor a
  // renderer can silently change the already-validated registry.
  const frozenCitations = new Map([...citations].map(([id, { row }]) => [id, Object.freeze({ ...row }) as unknown as Readonly<Citation>]));
  const resolved = new Map([...claims].map(([id, { row }]) => {
    const claim = Object.freeze({ ...row, surfaces: Object.freeze([...(row.surfaces as string[])]), evidence: Object.freeze((row.evidence as ClaimEvidence[]).map((item) => Object.freeze({ ...item }))) }) as unknown as Readonly<Claim>;
    return [id, Object.freeze({ claim, citations: Object.freeze(claim.evidence.map((item) => frozenCitations.get(item.citation)!)) })] as const;
  }));
  return { ok: true, issues: [], registry: Object.freeze({ resolveCitation: (id: string) => frozenCitations.get(id), resolveClaim: (id: string) => resolved.get(id) }) };
}
