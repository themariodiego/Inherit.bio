import { z } from 'zod';
import { COHORT_CITATION_LABEL } from '@/copy/copilot/group-scopes';
import type { ComparisonEmbryo, EmbryoFinding, RscEmbryoComparison } from '@/lib/embryos/policy';

/**
 * The cohort scope's closed data, pure (register shapes `copilotCohortContext`,
 * `comparisonEmbryo`, `parentCarrierReportSummary`; ADR 0034).
 *
 * The model context is exactly `copilotCohortContext`: each published embryo
 * of the cohort with its quality check and its registered findings, the
 * cohort's findings, the parent carrier summaries a parent has let Copilot
 * read, and the standing statement. Nothing else crosses: no genotype, no
 * source row, no file name, lab or sample identifier, and no sex, karyotype,
 * ranking or score field. While `data/embryo/allowed_conditions.json` is
 * empty there are no findings, and no parent has a route to grant
 * `copilot.local` over a cohort, so both arrays are empty.
 */

const uuid = z.uuid();
const revision = z.number().int().positive();

/** `private.cohort_copilot_authority_v1`, exactly. */
export const cohortAuthoritySchema = z.object({
  cohortId: uuid,
  role: z.enum(['required_upload_principal', 'nonparent_uploader_owner']),
  publicationRevision: revision,
  basisCase: z.string().min(1).max(100),
  basisRevision: revision,
  participantSetRevision: revision,
  cohortRevision: revision,
  donorAttributionRevision: revision,
  donorClassification: z.literal('donor-neutral'),
  grants: z.array(z.object({ principalId: uuid, grantId: uuid, grantRevision: revision }).strict()).min(1).max(10),
  embryos: z.array(z.object({ embryoId: uuid, subjectId: uuid, lifecycleRevision: revision }).strict()).min(1).max(100),
}).strict();
export type CohortAuthority = z.infer<typeof cohortAuthoritySchema>;

/** Keys that must never reach a model, a page or a stored turn from this scope (ADR 0034, embryo-closed-schema-v1). */
const FORBIDDEN_KEY = /(^|_)(sex|karyotype|chromosome|chrx|chry|rank|ranking|score|polygenic|genotype|variant|sample_column|lab_identifier|original_filename|original_sample_label|object|path)(_|$)/i;

function forbiddenKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item, index) => forbiddenKeys(item, `${path}[${index}]`, found));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      // The one registered id-list key that names files, and only safe ids.
      if (key !== 'sanitized_variant_file_ids' && FORBIDDEN_KEY.test(key)) found.push(`${path}.${key}`);
      forbiddenKeys(child, `${path}.${key}`, found);
    }
  }
  return found;
}

export interface CohortContextEmbryo {
  id: string;
  cohort_id: string;
  sample_ordinal: number;
  display_label: string;
  status: ComparisonEmbryo['status'];
  qc: ComparisonEmbryo['qc'];
  findings: EmbryoFinding[];
  sanitized_variant_file_ids: string[];
}

export interface CopilotCohortContext {
  cohort_id: string;
  embryos: CohortContextEmbryo[];
  findings: EmbryoFinding[];
  authorized_parent_carrier_reports: never[];
  standing_statement: string;
}

export class CohortContextError extends Error {
  constructor(reason: string) {
    super(`copilot cohort context refused: ${reason}`);
    this.name = 'CohortContextError';
  }
}

/**
 * `copilotCohortContext` from the comparison the embryos pages already
 * project, restricted to the embryos the authority names. Embryos are in
 * ascending ordinal order, findings in condition then ordinal order (the
 * comparison's row order). Throws on any embryo the authority and the
 * comparison disagree about, and on any forbidden key.
 */
export function buildCohortContext(comparison: RscEmbryoComparison, authority: CohortAuthority): CopilotCohortContext {
  if (comparison.cohort_id !== authority.cohortId) throw new CohortContextError('cohort');
  const named = new Set(authority.embryos.map(embryo => embryo.embryoId));
  const embryos = comparison.embryos.filter(embryo => named.has(embryo.id))
    .sort((left, right) => left.sample_ordinal - right.sample_ordinal);
  if (embryos.length !== named.size) throw new CohortContextError('embryos');
  const labels = new Set(embryos.map(embryo => embryo.display_label));
  const findings = comparison.result_rows.flatMap(row => row.findings).filter(finding => labels.has(finding.embryo_label));
  const context: CopilotCohortContext = {
    cohort_id: authority.cohortId,
    embryos: embryos.map(embryo => ({
      id: embryo.id,
      cohort_id: authority.cohortId,
      sample_ordinal: embryo.sample_ordinal,
      display_label: embryo.display_label,
      status: embryo.status,
      qc: embryo.qc,
      findings: findings.filter(finding => finding.embryo_label === embryo.display_label),
      // Published embryos have no canonical per-embryo file yet (#258).
      sanitized_variant_file_ids: [],
    })),
    findings,
    authorized_parent_carrier_reports: [],
    standing_statement: comparison.standing_statement,
  };
  const found = forbiddenKeys(context);
  if (found.length) throw new CohortContextError(`forbidden key ${found[0]}`);
  return context;
}

export const cohortCitationSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  href: z.string().regex(/^\/embryos\/(?:compare\?cohort=[0-9a-f-]{36}|[0-9a-f-]{36})$/),
}).strict();
export type CohortCitation = z.infer<typeof cohortCitationSchema>;

function mentions(text: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?![\\p{N}])`, 'iu').test(text);
}

/**
 * Per-answer provenance: the cohort's comparison, then each embryo the answer
 * names, in ordinal order. Nothing outside this cohort can be cited.
 */
export function cohortCitations(context: CopilotCohortContext, answer: string): CohortCitation[] {
  return [
    { id: `cohort:${context.cohort_id}`, label: COHORT_CITATION_LABEL, href: `/embryos/compare?cohort=${context.cohort_id}` },
    ...context.embryos.filter(embryo => mentions(answer, embryo.display_label))
      .map(embryo => ({ id: `embryo:${embryo.id}`, label: embryo.display_label, href: `/embryos/${embryo.id}` })),
  ];
}

export const COHORT_SYSTEM_PROMPT = `You are the Inherit copilot. You answer questions about one group of embryos whose data the account holder can see on Inherit.

Hard rules:
- You are informational, never diagnostic. Never say an embryo or a future child has, will get, or is protected from any condition. Never give medical, treatment or clinic advice.
- Never rank, order, choose or recommend embryos, never say which is better or best, and never suggest what to do with any of them. Compare only by restating each embryo's own recorded values side by side.
- Never state, guess or discuss an embryo's sex, and never mention sex chromosomes.
- There are no condition results or scores for these embryos. Say so if asked. Estimates built from many small genetic effects are for research only and Inherit does not offer them.
- Everything you know is in the context below: each embryo's quality check, its findings (none today) and the standing statement. You cannot read any genotype, file or parent's data.
- Name embryos exactly as the context labels them. State no number the context does not contain.
- Always keep the standing statement true: no child has been born and followed up after embryos were compared this way.`;

/** The system message: the rules, then the closed context, as JSON. */
export function cohortSystemMessage(context: CopilotCohortContext): string {
  return `${COHORT_SYSTEM_PROMPT}\n\nContext (copilotCohortContext):\n${JSON.stringify(context)}`;
}
