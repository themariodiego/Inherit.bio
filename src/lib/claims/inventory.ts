/**
 * A lossless review inventory of the current template source relationships.
 * Existing citations are candidates, never proof that their claims are supported.
 * This does not substitute for the rendered, email, export or prompt corpus.
 */
export interface TemplateInput {
  path: string;
  templates: unknown;
}

export interface ClaimSlot {
  path: string;
  pointer: string;
  slug: string;
  kind: "title" | "summary" | "interpretation" | "study-context";
  text: string;
  candidateSourceKeys: string[];
}

export interface SourceOccurrence {
  path: string;
  pointer: string;
  slug: string;
  label: string;
  /** These are existing assertions of access, not newly verified dates. */
  declaredAccessDate: string | null;
  identifiers: { pmid?: string; doi?: string };
}

export interface SourceCandidate {
  key: string;
  occurrences: SourceOccurrence[];
}

export interface TemplateSourceInventory {
  templates: number;
  claims: ClaimSlot[];
  sources: SourceCandidate[];
  issues: { path: string; pointer: string; code: string }[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointerPart(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Strict real calendar date; validity alone does not demonstrate a source read. */
function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

export function inventoryTemplateSources(inputs: readonly TemplateInput[]): TemplateSourceInventory {
  const result: TemplateSourceInventory = { templates: 0, claims: [], sources: [], issues: [] };
  const sources = new Map<string, SourceCandidate>();
  const slugs = new Set<string>();
  const paths = new Set<string>();
  const issue = (path: string, pointer: string, code: string) => result.issues.push({ path, pointer, code });

  for (const input of [...inputs].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    if (paths.has(input.path)) issue(input.path, "", "duplicate-template-file");
    paths.add(input.path);
    if (!Array.isArray(input.templates)) {
      issue(input.path, "", "template-file-not-array");
      continue;
    }
    input.templates.forEach((template: unknown, index: number) => {
      const base = `/${index}`;
      if (!record(template) || typeof template.slug !== "string" || !template.slug.trim()) {
        issue(input.path, base, "invalid-template");
        return;
      }
      result.templates++;
      const slug = template.slug;
      if (slugs.has(slug)) issue(input.path, `${base}/slug`, "duplicate-template-slug");
      slugs.add(slug);
      const sourceKeys: string[] = [];
      const addClaim = (pointer: string, kind: ClaimSlot["kind"], text: unknown, keys = sourceKeys) => {
        if (typeof text !== "string" || !text.trim()) {
          issue(input.path, pointer, "invalid-claim-text");
          return;
        }
        result.claims.push({ path: input.path, pointer, slug, kind, text,
          candidateSourceKeys: [...new Set(keys)] });
      };
      if (!Array.isArray(template.citations) || template.citations.length === 0) {
        issue(input.path, `${base}/citations`, "no-template-citations");
      } else {
        template.citations.forEach((citation: unknown, citationIndex: number) => {
          const pointer = `${base}/citations/${citationIndex}`;
          if (!record(citation)) { issue(input.path, pointer, "invalid-citation"); return; }
          const validPmid = typeof citation.pmid === "string" && /^[1-9]\d{0,7}$/.test(citation.pmid);
          const validDoi = typeof citation.doi === "string" && /^10\.\d{4,9}\/\S+$/.test(citation.doi);
          if ((citation.pmid !== undefined && !validPmid) || (citation.doi !== undefined && !validDoi)) {
            issue(input.path, pointer, "malformed-source-identifier");
          }
          // Preserve declared identifiers in occurrences; keys normalize DOI
          // case and are reconciled only from explicit, unambiguous pairs below.
          const key = validPmid ? `pmid:${citation.pmid}` : validDoi ? `doi:${(citation.doi as string).toLowerCase()}` : null;
          // Keep prose even when its source id is malformed. Losing the text
          // would make a broken citation shrink the scope of the review.
          if (citation.studyContext !== undefined) {
            if (!record(citation.studyContext)) issue(input.path, `${pointer}/studyContext`, "invalid-study-context");
            else for (const [field, value] of Object.entries(citation.studyContext)) {
              if (value === null) continue;
              const textPointer = `${pointer}/studyContext/${pointerPart(field)}/text`;
              addClaim(textPointer, "study-context", record(value) ? value.text : undefined, key ? [key] : []);
            }
          }
          if (!key) { issue(input.path, pointer, "unresolvable-source-identifier"); return; }
          sourceKeys.push(key);
          if (!calendarDate(citation.accessedOn)) issue(input.path, pointer, "missing-or-invalid-declared-access-date");
          if (typeof citation.label !== "string" || !citation.label.trim()) issue(input.path, pointer, "missing-source-label");
          const source = sources.get(key) ?? { key, occurrences: [] };
          source.occurrences.push({ path: input.path, pointer, slug,
            label: typeof citation.label === "string" ? citation.label : "",
            declaredAccessDate: calendarDate(citation.accessedOn) ? citation.accessedOn : null,
            identifiers: { ...(validPmid ? { pmid: citation.pmid as string } : {}),
              ...(validDoi ? { doi: citation.doi as string } : {}) } });
          sources.set(key, source);
        });
      }
      addClaim(`${base}/title`, "title", template.title);
      addClaim(`${base}/summary`, "summary", template.summary);
      if (!Array.isArray(template.variants)) issue(input.path, `${base}/variants`, "invalid-variants");
      else template.variants.forEach((variant: unknown, variantIndex: number) => {
        const pointer = `${base}/variants/${variantIndex}/interpretations`;
        if (!record(variant) || !record(variant.interpretations)) {
          issue(input.path, pointer, "invalid-interpretations"); return;
        }
        for (const [genotype, text] of Object.entries(variant.interpretations)) {
          addClaim(`${pointer}/${pointerPart(genotype)}`, "interpretation", text);
        }
      });
    });
  }
  const doiPmids = new Map<string, Set<string>>();
  const pmidDois = new Map<string, Set<string>>();
  for (const source of sources.values()) for (const { identifiers } of source.occurrences) {
    if (!identifiers.pmid || !identifiers.doi) continue;
    const doi = identifiers.doi.toLowerCase();
    const pmids = doiPmids.get(doi) ?? new Set<string>();
    pmids.add(identifiers.pmid); doiPmids.set(doi, pmids);
    const dois = pmidDois.get(identifiers.pmid) ?? new Set<string>();
    dois.add(doi); pmidDois.set(identifiers.pmid, dois);
  }
  const aliases = new Map<string, string>();
  for (const [doi, pmids] of doiPmids) {
    const [pmid] = pmids;
    if (pmids.size === 1 && pmidDois.get(pmid)?.size === 1) aliases.set(`doi:${doi}`, `pmid:${pmid}`);
  }
  const reconciled = new Map<string, SourceCandidate>();
  for (const source of sources.values()) {
    const key = aliases.get(source.key) ?? source.key;
    const target = reconciled.get(key) ?? { key, occurrences: [] };
    for (const occurrence of source.occurrences) {
      const { pmid, doi } = occurrence.identifiers;
      if ((pmid && (pmidDois.get(pmid)?.size ?? 0) > 1) ||
          (doi && (doiPmids.get(doi.toLowerCase())?.size ?? 0) > 1)) {
        issue(occurrence.path, occurrence.pointer, "conflicting-source-alias");
      }
      target.occurrences.push(occurrence);
    }
    reconciled.set(key, target);
  }
  for (const claim of result.claims) {
    claim.candidateSourceKeys = [...new Set(claim.candidateSourceKeys.map((key) => aliases.get(key) ?? key))];
  }
  result.sources = [...reconciled.keys()].sort().map((key) => reconciled.get(key)!);
  return result;
}
