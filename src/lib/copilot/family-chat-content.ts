import { z } from 'zod';
import { isFixtureSlug } from '@/components/reports/library';
import { sharedByLabel, sharedReportLabel } from '@/copy/copilot/group-scopes';
import { reportScientificCorrections, reportOutcomeScientificCorrections } from '@/lib/genome/report-scientific-corrections';
import type { FindingLayer } from '@/lib/genome/taxonomy';
import type { SharedReportPurpose, SharedReportResult } from '@/lib/family/shared-report-results';

/**
 * The Family group scope's model-facing content, as pure functions: what one
 * turn's tools may return, how each returned row is attributed to one named
 * person, which people and sources a turn actually used, and the closed set
 * of links an answer may carry. Nothing here reads the database; the chat
 * route supplies rows it read under the member authority it rechecks.
 */
const uuid = z.uuid();
const revision = z.number().int().positive().safe();
const layerPurpose = z.enum(['reports.monogenic', 'reports.polygenic']);
const grant = z.object({ purpose: z.string(), grantId: uuid, grantRevision: revision }).strict();

/** Exactly what `family_copilot_scope_v1` returns for one adult, compared whole on every recheck. */
export const familyMemberAuthoritySchema = z.object({
  subjectId: uuid, accountId: uuid, lifecycleRevision: revision,
  relationship: z.object({ id: uuid, revision }).strict(),
  copilot: grant.refine(g => g.purpose === 'copilot.local'),
  heritability: grant.refine(g => g.purpose === 'family.heritability'),
  layers: z.array(z.object({ purpose: layerPurpose, grantId: uuid, grantRevision: revision }).strict()).min(1).max(2),
}).strict();
export type FamilyMemberAuthority = z.infer<typeof familyMemberAuthoritySchema>;
export const familyScopeSchema = z.array(familyMemberAuthoritySchema).max(100);

export const LAYER_FOR_PURPOSE: Record<SharedReportPurpose, FindingLayer> = {
  'reports.monogenic': 'variant_call',
  'reports.polygenic': 'estimate',
};

/** One adult as this turn may name them: an opaque per-turn reference, never an id. */
export interface FamilyScopeMember {
  authority: FamilyMemberAuthority;
  /** `person-1`, `person-2`, … in name order; what the model uses to ask for one person. */
  ref: string;
  displayLabel: string;
  /** The Family route segment that names this person for the asker (`s-{uuid}`). */
  handleSegment: string;
  layers: FindingLayer[];
}

/** Rows read for one member under their current authority, with their layer purposes. */
export type FamilyMemberRows = ReadonlyMap<string, readonly SharedReportResult[]>;

/** Whose data one turn's tools returned: subject → the layers and exact sources used. */
export class FamilyUseLedger {
  private readonly used = new Map<string, { purposes: Set<SharedReportPurpose>; files: Map<string, SharedReportPurpose> }>();
  record(member: FamilyScopeMember, row: SharedReportResult) {
    const entry = this.used.get(member.authority.subjectId) ?? { purposes: new Set(), files: new Map() };
    entry.purposes.add(row.purpose);
    entry.files.set(`${row.fileId}|${row.purpose}`, row.purpose);
    this.used.set(member.authority.subjectId, entry);
  }
  /** Members whose data this turn used, in the order given. */
  members(members: readonly FamilyScopeMember[]): FamilyScopeMember[] {
    return members.filter(member => this.used.has(member.authority.subjectId));
  }
  /** The commit payload's `used` array: each member's exact authority, layers and sources. */
  commitPayload(members: readonly FamilyScopeMember[]) {
    return this.members(members).map(member => {
      const entry = this.used.get(member.authority.subjectId)!;
      return { authority: member.authority, purposes: [...entry.purposes].sort(),
        files: [...entry.files.keys()].sort().map(key => { const [fileId, purpose] = key.split('|'); return { fileId, purpose }; }) };
    });
  }
}

function corrected(row: SharedReportResult): boolean {
  return reportScientificCorrections(row.report.catalogSnapshot.template).length > 0
    || reportOutcomeScientificCorrections(row.report.slug, row.report.variants).length > 0;
}

function readable(member: FamilyScopeMember, rows: FamilyMemberRows): SharedReportResult[] {
  const layers = new Set(member.authority.layers.map(layer => layer.purpose));
  // Only a layer this member granted for Copilot this turn, never a row the
  // reader returned under any other purpose.
  return (rows.get(member.authority.subjectId) ?? []).filter(row => layers.has(row.purpose)
    && row.subjectId === member.authority.subjectId && !isFixtureSlug(row.report.slug));
}

const NOT_SHARED_NOTE = 'A report type a person did not share is absent here. That is not a result about them.';

/** `list_reports`: each person's shared reports by title, attributed to that person. */
export function familyReportList(members: readonly FamilyScopeMember[], rows: FamilyMemberRows,
  ledger: FamilyUseLedger, category?: string | null) {
  return {
    people: members.map(member => {
      const reports = readable(member, rows).filter(row => !category || row.report.catalogSnapshot.template.category === category);
      for (const row of reports) ledger.record(member, row);
      return { person: member.displayLabel, person_ref: member.ref,
        shared_report_types: member.layers,
        reports: reports.map(row => corrected(row)
          ? { slug: row.report.slug, status: 'corrected', note: 'This saved report was written before a correction. It is not available here.' }
          : { slug: row.report.slug, title: row.report.catalogSnapshot.template.title,
            category: row.report.catalogSnapshot.template.category, layer: LAYER_FOR_PURPOSE[row.purpose],
            covered: row.report.covered, completed_at: row.completedAt }) };
    }),
    note: NOT_SHARED_NOTE,
  };
}

/** `get_report`: one report's saved outcome for each person who shared it, or for one person. */
export function familyReportDetail(members: readonly FamilyScopeMember[], rows: FamilyMemberRows,
  ledger: FamilyUseLedger, slug: string, personRef?: string | null) {
  const chosen = personRef ? members.filter(member => member.ref === personRef) : members;
  if (personRef && !chosen.length) return { slug, error: 'unknown_person', note: 'Ask with a person_ref from list_reports.' };
  const sources = chosen.flatMap(member => readable(member, rows).filter(row => row.report.slug === slug).map(row => {
    if (corrected(row)) return { person: member.displayLabel, person_ref: member.ref, status: 'corrected',
      note: 'This saved report was written before a correction. It is not available here.' };
    ledger.record(member, row);
    const template = row.report.catalogSnapshot.template;
    const conflicts = new Set(row.report.conflictingRsids);
    return { person: member.displayLabel, person_ref: member.ref, purpose: row.purpose, layer: LAYER_FOR_PURPOSE[row.purpose],
      title: template.title, summary: template.summary, evidence: template.evidence, citations: template.citations,
      catalogSnapshot: row.report.catalogSnapshot, completed_at: row.completedAt, covered: row.report.covered,
      variants: row.report.variants.map(variant => ({ rsid: `rs${variant.rsid}`, outcome: conflicts.has(variant.rsid)
        ? { status: 'conflict', note: 'This person’s files disagree at this position.' } : variant.outcome })) };
  }));
  if (!sources.length) return { slug, error: 'report_not_shared',
    note: 'No person in this view has shared a saved report on this topic with you. That is not a result about anyone.' };
  return { slug, sources };
}

export const familyCitationSchema = z.object({ id: z.string().min(1).max(2000), label: z.string().min(1).max(1000),
  href: z.string().max(4000).refine(href => /^\/family\/s-[0-9a-f-]{36}$/.test(href)
    || /^\/genome\/s-[0-9a-f-]{36}\/reports\/[^/?#]+$/.test(href)
    || /^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov\/\d{6,9}\/|doi\.org\/[^\s]+)$/.test(href)) }).strict();
export type FamilyCitation = z.infer<typeof familyCitationSchema>;

/**
 * An answer's sources: first one line per person whose data the turn used
 * ("Shared by …"), then each shared report the tools returned, named with
 * its person, then each publication those reports cite. The model supplies
 * none of these links.
 */
export function familyChatCitations(members: readonly FamilyScopeMember[], rows: FamilyMemberRows, ledger: FamilyUseLedger,
  toolJson: unknown): FamilyCitation[] {
  const used = ledger.members(members);
  const citations = new Map<string, FamilyCitation>();
  for (const member of used) {
    citations.set(`person:${member.handleSegment}`, { id: `person:${member.handleSegment}`,
      label: sharedByLabel(member.displayLabel), href: `/family/${member.handleSegment}` });
  }
  const returned = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.person_ref === 'string' && record.catalogSnapshot && typeof record.catalogSnapshot === 'object') {
      const sha = (record.catalogSnapshot as { templateSha256?: unknown }).templateSha256;
      if (typeof sha === 'string') returned.add(`${record.person_ref}|${sha}`);
    }
    Object.values(record).forEach(visit);
  };
  visit(toolJson);
  for (const member of used) {
    for (const row of readable(member, rows)) {
      const { template, templateSha256 } = row.report.catalogSnapshot;
      if (!returned.has(`${member.ref}|${templateSha256}`) || corrected(row)) continue;
      const id = `report:${template.slug}:${templateSha256}:${member.handleSegment}`;
      citations.set(id, { id, label: sharedReportLabel(template.title, member.displayLabel),
        href: `/genome/${member.handleSegment}/reports/${encodeURIComponent(template.slug)}` });
      for (const source of template.citations) {
        if (source.pmid) citations.set(`pmid:${source.pmid}`, { id: `pmid:${source.pmid}`, label: source.label,
          href: `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/` });
        else if (source.doi) citations.set(`doi:${source.doi}`, { id: `doi:${source.doi}`, label: source.label,
          href: `https://doi.org/${encodeURIComponent(source.doi)}` });
      }
    }
  }
  return z.array(familyCitationSchema).max(100).parse([...citations.values()].slice(0, 100));
}
