import type { HealthPictureColumn as CapturedColumn, HealthPictureState } from './health-picture-results';
import type { HealthPictureRow } from '../../components/family/health-picture-table';
import type { HealthPictureCellState, HealthPictureSimpleState } from '../../components/family/health-picture-cell';
import type { SharedReportPurpose } from './shared-report-results';
import { resolveStoredSharedReport } from './shared-report-display';
import { categoryFor, CATEGORY_TAXONOMY, type FindingLayer, type CategoryId } from '../genome/taxonomy';
import { route } from '../primary-routes';
export const HEALTH_PICTURE_LAYERS = [
  { layer: 'variant_call', purpose: 'reports.monogenic' },
  { layer: 'estimate', purpose: 'reports.polygenic' },
] as const;
export interface HealthPictureRoute { subjectId: string; segment: string }
export interface HealthPictureProjection { rows: { layer: FindingLayer; rows: HealthPictureRow[]; states: HealthPictureCellState[] }[] }
/** Access precedes source state: a withheld layer never reveals file absence. */
export function healthPictureAvailability(column: CapturedColumn, purpose: SharedReportPurpose): HealthPictureSimpleState {
  const access = column.access.find(item => item.purpose === purpose);
  if (!access || access.kind === 'not-shared') return { kind: 'not-shared' };
  if (access.kind === 'legacy-only') return column.legacyFileIds.length ? { kind: 'legacy' } : { kind: 'no-prepared-file' };
  if (!access.hasPreparedSource) return { kind: 'no-prepared-file' };
  if (!access.hasCompletedSource) return { kind: 'not-generated' };
  if (column.unavailableReports.some(item => item.purpose === purpose)) return { kind: 'catalog-unavailable' };
  return column.reports.some(item => item.purpose === purpose) ? { kind: 'saved' } : { kind: 'no-report' };
}
/** Pure display of final confirmed state. Captured hashes define versions;
 * files remain separate. No current catalog or genotype resolution is used. */
export function projectHealthPicture(state: HealthPictureState, routes: readonly HealthPictureRoute[]): HealthPictureProjection {
  if (!state.authorized || routes.length !== state.columns.length || new Set(routes.map(item => item.subjectId)).size !== routes.length) return { rows: [] };
  const columns = routes.map(item => state.columns.find(column => column.subjectId === item.subjectId));
  if (columns.some(column => !column)) return { rows: [] };
  const rank = new Map<CategoryId | null, number>(CATEGORY_TAXONOMY.map((entry, index) => [entry.id, index]));
  return { rows: HEALTH_PICTURE_LAYERS.map(({ layer, purpose }) => {
    const rows = new Map<string, HealthPictureRow>();
    for (const [index, column] of columns.entries()) {
      const access = column?.access.find(item => item.purpose === purpose);
      if (!column || access?.kind !== 'canonical' || !access.hasPreparedSource || !access.hasCompletedSource) continue;
      for (const stored of column.reports.filter(item => item.purpose === purpose)) {
        const resolved = resolveStoredSharedReport(stored), source = column.sources.find(item => item.fileId === stored.fileId);
        if (!resolved || !source || (resolved.template.layer ?? 'estimate') !== layer) continue;
        let category: CategoryId | null = null;
        try { category = categoryFor(resolved.template); } catch { /* Keep captured output without inventing a category. */ }
        const key = `${purpose}:${stored.report.slug}:${stored.report.catalogSnapshot.templateSha256}`;
        let row = rows.get(key);
        if (!row) {
          row = { key, slug: stored.report.slug, title: resolved.template.title, category,
            cells: columns.map(other => { const availability = healthPictureAvailability(other!, purpose);
              return availability.kind === 'saved' || availability.kind === 'catalog-unavailable' ? { kind: 'version-unavailable' } : availability; }),
            hrefs: columns.map(() => null) };
          rows.set(key, row);
        }
        const conflicts = new Set(stored.report.conflictingRsids);
        const genotypes = resolved.variants.flatMap(({ variant, outcome }) => !conflicts.has(variant.rsid) && outcome.status === 'genotyped' ? [outcome.genotype.length === 2 ? `${outcome.genotype[0]}/${outcome.genotype[1]}` : outcome.genotype] : []);
        const resultState: HealthPictureSimpleState = genotypes.length ? { kind: 'letters', genotypes }
          : conflicts.size ? { kind: 'conflicting-calls' } : resolved.variants.some(item => item.outcome.status === 'no-call') ? { kind: 'no-call' }
          : resolved.variants.some(item => item.outcome.status === 'unrecognized') ? { kind: 'unrecognized' } : { kind: 'not-covered' };
        const cell = row.cells[index], entries = cell.kind === 'sources' ? [...cell.entries] : [];
        entries.push({ fileId: stored.fileId, state: resultState, source, conflictingCalls: conflicts.size > 0,
          href: route('genome.report', { subject: routes[index].segment, slug: stored.report.slug }, { query: { source: stored.fileId } }),
          sourceLabel: `Saved source ${[...new Set(column.sources.map(item => item.fileId))].sort().indexOf(stored.fileId) + 1}`,
          coverage: { read: resolved.variants.filter(({ variant, outcome }) => !conflicts.has(variant.rsid) && (outcome.status === 'genotyped' || outcome.status === 'unrecognized')).length, needed: resolved.variants.length } });
        row.cells = row.cells.map((value, at) => at === index ? { kind: 'sources', entries } : value);
      }
    }
    return { layer, states: columns.map(column => healthPictureAvailability(column!, purpose)), rows: [...rows.values()].sort((a, b) =>
      (rank.get(a.category) ?? 0) - (rank.get(b.category) ?? 0) || a.title.localeCompare(b.title, 'en') || a.key!.localeCompare(b.key!)) };
  }) };
}
