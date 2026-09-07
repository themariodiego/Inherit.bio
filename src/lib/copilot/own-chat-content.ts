import 'server-only';
import { z } from 'zod';
import { genotypeKey } from '@/lib/genome/reports';
import { serializePrsCoverage } from '@/lib/genome/prs-output';
import { isFixtureSlug } from '@/components/reports/library';
import { reportCatalogSnapshotSchema } from '@/lib/genome/report-catalog-snapshot';
const uuid = z.uuid(), hash = z.string().regex(/^[0-9a-f]{64}$/);
const revision = z.number().int().positive().safe();
export const ownChatProjectionSchema = z.object({
    sources: z.array(z.object({ id: uuid, revision, sha256: hash, decodedSha256: hash, objectId: uuid,
        normalizedAt: z.string(), build: z.enum(['GRCh37', 'GRCh38']), completed: z.array(z.object({
            purpose: z.enum(['reports.monogenic', 'reports.polygenic']), authority: z.record(z.string(), z.unknown()),
            runId: uuid, completedAt: z.string(), resultHash: hash,
        }).strict()).max(2),
    }).strict()).max(1000),
    legacySources: z.array(z.object({ id: uuid, sha256: hash, build: z.enum(['GRCh37', 'GRCh38']), createdAt: z.string() }).strict()).max(1000),
    unavailableSources: z.array(z.object({ id: uuid, reason: z.literal('source_unavailable') }).strict()).max(1000),
}).strict();
export type OwnChatProjection = z.infer<typeof ownChatProjectionSchema>;
export const ownChatCallSchema = z.object({ file_id: uuid, rsid: z.number().int().positive().safe(), chrom: z.number().int().min(1).max(25),
    pos: z.number().int().positive().safe(), ref: z.string().nullable(), alt: z.string().nullable(), genotype: z.string().max(64), usable: z.boolean() }).strict();
export type OwnChatCall = z.infer<typeof ownChatCallSchema>;
export interface ReferenceLocus {
    rsid: number;
    chrom: number;
    pos38: number | null;
    ref: string | null;
    alt: string | null;
    gene_symbol?: string | null;
}
const outcome = z.discriminatedUnion('status', [
    z.object({ status: z.literal('genotyped'), genotype: z.string(), interpretation: z.string(), strandFlipped: z.boolean() }).strict(),
    z.object({ status: z.literal('unrecognized'), genotype: z.string() }).strict(),
    z.object({ status: z.literal('no-call') }).strict(), z.object({ status: z.literal('not-covered') }).strict(),
]);
export const ownChatReportSchema = z.object({ file_id: uuid, purpose: z.enum(['reports.monogenic', 'reports.polygenic']), completed_at: z.string(),
    report: z.object({ slug: z.string(), covered: z.boolean(), conflictingRsids: z.array(z.number().int().positive()), catalogSnapshot: reportCatalogSnapshotSchema.optional(),
        variants: z.array(z.object({ rsid: z.number().int().positive(), outcome }).strict()) }).strict().refine(r => !r.catalogSnapshot || r.catalogSnapshot.template.slug === r.slug) }).strict();
export type OwnChatReport = z.infer<typeof ownChatReportSchema>;
export const ownChatPrsSchema = z.object({ file_id: uuid, pgs_id: z.string(), matched: z.number().int().nonnegative(), computed_at: z.string(),
    n_variants: z.number().int().positive().nullable() }).strict();
export const LEGACY_SOURCE_LIMIT = 'Older files have no captured report-purpose completion or scientific catalog snapshot. Their historical reports and score results are unavailable here; this is not a negative finding.';
export const LEGACY_RAW_NOTE = 'Includes observations from older processed files. Their historical normalization version was not recorded; these observations are not newly processed or interpreted.';
export const CAPTURED_REPORT_NOTE = 'These are stored outcomes. Generation did not capture the catalog revision, report description, evidence level or citations.';
export const ownChatCitationSchema = z.object({ id: z.string().min(1).max(2000), label: z.string().min(1).max(100000), href: z.string().max(4000)
        .refine(h => /^\/genome\/me\/reports\/[^/?#]+$/.test(h) || /^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov\/\d{6,9}\/|doi\.org\/[^\s]+)$/.test(h)) }).strict();
/** Only verified snapshots returned by this turn's tools supply reply sources.
 * The model cannot supply its own link, label or a mutable catalog lookup. */
export function capturedChatCitations(toolJson: unknown) {
    const citations = new Map<string, z.infer<typeof ownChatCitationSchema>>();
    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (!value || typeof value !== 'object')
            return;
        for (const [key, child] of Object.entries(value)) {
            if (key === 'catalogSnapshot') {
                const parsed = reportCatalogSnapshotSchema.safeParse(child);
                if (!parsed.success)
                    continue;
                const { template, templateSha256 } = parsed.data;
                const report = { id: `report:${template.slug}:${templateSha256}`, label: template.title, href: `/genome/me/reports/${encodeURIComponent(template.slug)}` };
                citations.set(report.id, report);
                for (const source of template.citations) {
                    if (source.pmid) {
                        const id = `pmid:${source.pmid}`;
                        citations.set(id, { id, label: source.label, href: `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/` });
                    }
                    else if (source.doi) {
                        const id = `doi:${source.doi}`;
                        citations.set(id, { id, label: source.label, href: `https://doi.org/${encodeURIComponent(source.doi)}` });
                    }
                }
            }
            else
                visit(child);
        }
    };
    visit(toolJson);
    return z.array(ownChatCitationSchema).max(100).parse([...citations.values()]);
}
/** A locus mismatch or any disagreement removes the genotype. Unusable calls
 * are explicit and never turn a VCF omission into a reference observation. */
export function ownGenotypeResult(rsid: number, calls: OwnChatCall[], reference: ReferenceLocus | null) {
    const rows = calls.filter(c => c.rsid === rsid);
    const base = { rsid: `rs${rsid}` };
    if (!rows.length)
        return { ...base, covered: false, status: 'not-covered' as const, note: 'Your files do not cover this position. This is a limit of the files, not a result about you.' };
    const usable = rows.filter(c => c.usable && c.genotype !== '--');
    const genotypes = new Set(usable.map(c => genotypeKey(c.genotype)));
    const mismatch = reference && rows.some(c => c.chrom !== reference.chrom || (reference.pos38 !== null && c.pos !== reference.pos38) ||
        (c.ref !== null && reference.ref !== null && c.ref !== reference.ref) || (c.alt !== null && reference.alt !== null && c.alt !== reference.alt));
    // Array rows omit alleles; compare coordinates and known alleles separately.
    const coords = new Set(rows.map(c => `${c.chrom}:${c.pos}`));
    const refs = new Set(rows.map(c => c.ref).filter(v => v !== null));
    const alts = new Set(rows.map(c => c.alt).filter(v => v !== null));
    if (mismatch || coords.size > 1 || refs.size > 1 || alts.size > 1 || genotypes.size > 1 || genotypes.has(null)) {
        return { ...base, covered: false, status: 'conflict' as const, conflict: true, note: 'The source calls disagree at this position, so no genotype is shown.' };
    }
    if (usable.length < rows.length)
        return { ...base, covered: false, status: 'no-call' as const, note: 'Your file includes this position but could not read it confidently.' };
    return { ...base, covered: true, status: 'called' as const, genotype: usable[0].genotype };
}
/** Never decorate old outcomes with today's scientific description/citations. */
export function capturedReportResult(rows: OwnChatReport[], slug: string, publishedSlug?: string) {
    const selected = rows.filter(r => r.report.slug === slug && !isFixtureSlug(slug));
    if (!selected.length)
        return { ...(publishedSlug === slug && !isFixtureSlug(slug) ? { slug } : {}), error: 'report_not_generated', note: 'No completed report for this topic is currently available under your selected purposes.' };
    return { slug, sources: selected.map(r => ({ file_id: r.file_id, purpose: r.purpose,
            ...(r.report.catalogSnapshot ? { title: r.report.catalogSnapshot.template.title, summary: r.report.catalogSnapshot.template.summary,
                evidence: r.report.catalogSnapshot.template.evidence, citations: r.report.catalogSnapshot.template.citations, catalogSnapshot: r.report.catalogSnapshot,
                provenance_note: 'Scientific metadata was captured from the exact published template used for this completed report.' }
                : { title: slug, provenance_note: CAPTURED_REPORT_NOTE }),
            completed_at: r.completed_at, covered: r.report.covered, conflictingRsids: r.report.conflictingRsids,
            variants: r.report.variants.map(v => ({ rsid: `rs${v.rsid}`, outcome: r.report.conflictingRsids.includes(v.rsid)
                    ? { status: 'conflict', note: 'The source calls disagree at this position.' } : v.outcome })) })) };
}
export function capturedPrsResult(rows: z.infer<typeof ownChatPrsSchema>[], scoreId: string) {
    return { pgs_id: scoreId, sources: rows.filter(r => r.pgs_id === scoreId).map(r => ({ file_id: r.file_id, computed_at: r.computed_at,
            result: serializePrsCoverage(r, r.n_variants) })), ...serializePrsCoverage(null, null) };
}
