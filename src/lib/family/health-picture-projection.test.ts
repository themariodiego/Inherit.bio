import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthPictureCell } from '../../components/family/health-picture-cell';
import { InputProvenance } from '../../components/reports/input-provenance';
import { healthPictureAvailability, projectHealthPicture } from './health-picture-projection';
import type { HealthPictureColumn, HealthPictureState } from './health-picture-results';
import type { SharedReportResult } from './shared-report-results';
const source = (fileId: string) => ({ fileId, fileType: 'vcf', processedAt: '2026-09-07T10:00:00.000Z', snapshot: null });
function stored(subjectId = 'A', fileId = 'file-a', hash = 'a'): SharedReportResult {
  return { fileId, subjectId, purpose: 'reports.polygenic', completedAt: '2026-09-07T10:00:00.000Z', report: {
    slug: 'caffeine', covered: true, conflictingRsids: [],
    variants: [{ rsid: 762551, outcome: { status: 'genotyped', genotype: 'AC', interpretation: 'Captured explanation.', strandFlipped: false } }],
    catalogSnapshot: { schemaVersion: 1, templateSha256: hash.repeat(64), template: {
      slug: 'caffeine', title: `Captured ${hash}`, category: 'basic-traits', summary: 'Captured summary.', evidence: 'preliminary',
      layer: 'estimate', estimate_kind: 'single_locus', pgs_id: null, citations: [], variants: [{ rsid: 762551, chrom: 15,
        pos38: 74749576, gene: 'CYP1A2', ref: 'A', alt: 'C', interpretations: { AC: 'Captured explanation.' } }],
    } },
  } };
}
function column(subjectId: string, reports = [stored(subjectId, `file-${subjectId}`)]): HealthPictureColumn {
  return { subjectId, kind: subjectId === 'A' ? 'own' : 'shared', access: [
    { purpose: 'reports.monogenic', kind: 'not-shared', hasPreparedSource: false, hasCompletedSource: false },
    { purpose: 'reports.polygenic', kind: 'canonical', hasPreparedSource: true, hasCompletedSource: true },
  ], reports, sources: reports.map(item => source(item.fileId)), legacyFileIds: [], unavailableReports: [] };
}
const routes = [{ subjectId: 'A', segment: 'me' }, { subjectId: 'B', segment: 's-invited-B' }];
function rows(columns: HealthPictureColumn[]) { return projectHealthPicture({ authorized: true, columns }, routes).rows.find(group => group.layer === 'estimate')!; }

describe('Health Picture captured projection', () => {
  it('uses A own and B stored outcomes, exact Family handle/source links and captured title', () => {
    const result = rows([column('B'), column('A')]);
    expect(result.rows).toHaveLength(1); expect(result.rows[0].title).toBe('Captured a');
    expect(result.rows[0].cells[0]).toMatchObject({ kind: 'sources', entries: [{ fileId: 'file-A', state: { kind: 'letters', genotypes: ['A/C'] }, href: '/genome/me/reports/caffeine?source=file-A' }] });
    expect(result.rows[0].cells[1]).toMatchObject({ kind: 'sources', entries: [{ href: '/genome/s-invited-B/reports/caffeine?source=file-B' }] });
  });
  it('retains distinct catalog versions and every source instead of merging interpretations', () => {
    const a = column('A', [stored('A', 'one'), stored('A', 'two'), stored('A', 'three', 'b')]);
    const result = rows([a, column('B')]);
    expect(result.rows.map(row => row.title)).toEqual(['Captured a', 'Captured b']);
    expect(result.rows[0].cells[0]).toMatchObject({ entries: [{ fileId: 'one' }, { fileId: 'two' }] });
    expect(result.rows[1].cells[1]).toEqual({ kind: 'version-unavailable' });
  });
  it.each(['own', 'shared'] as const)('not-shared precedes source absence for %s and hides injected outcomes', kind => {
    const a = column('A'); a.kind = kind; a.access[1] = { ...a.access[1], kind: 'not-shared', hasPreparedSource: false };
    expect(healthPictureAvailability(a, 'reports.polygenic')).toEqual({ kind: 'not-shared' });
    expect(rows([a, column('B')]).rows[0].cells[0]).toEqual({ kind: 'not-shared' });
  });
  it.each([
    [false, false, 'no-prepared-file'], [true, false, 'not-generated'], [true, true, 'no-report'],
  ] as const)('distinguishes prepared=%s/completed=%s without a negative result', (prepared, completed, kind) => {
    const a = column('A', []); a.access[1].hasPreparedSource = prepared; a.access[1].hasCompletedSource = completed;
    expect(healthPictureAvailability(a, 'reports.polygenic')).toEqual({ kind });
  });
  it('does not borrow current catalog metadata for historical incomplete captures', () => {
    const a = column('A', []); a.unavailableReports = [{ fileId: 'old', purpose: 'reports.polygenic', slug: 'caffeine' }];
    expect(healthPictureAvailability(a, 'reports.polygenic')).toEqual({ kind: 'catalog-unavailable' });
    expect(rows([a, column('B')]).rows[0].cells[0]).toEqual({ kind: 'version-unavailable' });
  });
  it.each(['no-call', 'not-covered'] as const)('preserves captured %s without inventing genotype', status => {
    const report = stored('A', 'file-A'); report.report.variants[0].outcome = { status }; report.report.covered = false;
    expect(rows([column('A', [report]), column('B')]).rows[0].cells[0]).toMatchObject({ entries: [{ state: { kind: status }, coverage: { read: 0, needed: 1 } }] });
  });
  it('counts a stored uninterpretable call as observed without displaying its letters', () => {
    const report = stored('A', 'file-A'); report.report.variants[0].outcome = { status: 'unrecognized', genotype: 'XY' };
    expect(rows([column('A', [report]), column('B')]).rows[0].cells[0]).toMatchObject({ entries: [{ state: { kind: 'unrecognized' }, coverage: { read: 1, needed: 1 } }] });
  });
  it('renders distinct stable authorized-source labels and link names for two stored files', () => {
    const a = column('A', [stored('A', 'two'), stored('A', 'one')]);
    const cell = rows([a, column('B')]).rows[0].cells[0];
    const html = renderToStaticMarkup(createElement(HealthPictureCell, { state: cell, dataSubjectId: 'A', personName: 'You', reportTitle: 'Captured a', layer: 'estimate', href: null, captionId: 'caption' }));
    expect(html).toContain('Saved source 1 ·'); expect(html).toContain('Saved source 2 ·');
    expect(html).toMatch(/aria-label="[^"]+Saved source 1"/); expect(html).toMatch(/aria-label="[^"]+Saved source 2"/);
    expect(html).not.toContain('File 1'); expect(html).not.toContain('File 0');
    const fallback = renderToStaticMarkup(createElement(InputProvenance, { sources: [source('one')], sourceLabels: { unrelated: 'Do not render' }, subject: { subjectId: 'A' } }));
    expect(fallback).toContain('File 1'); expect(fallback).not.toContain('Do not render');
  });
  it('withholds conflicting calls and does not claim two different files caused the conflict', () => {
    const report = stored('A', 'file-A'); report.report.conflictingRsids = [762551];
    expect(rows([column('A', [report]), column('B')]).rows[0].cells[0]).toMatchObject({ entries: [{ state: { kind: 'conflicting-calls' }, conflictingCalls: true, coverage: { read: 0, needed: 1 } }] });
  });
  it('preserves A plus multiple independent B columns without using one column as authority for another', () => {
    const third = column('C'); third.access[1].kind = 'not-shared';
    const result = projectHealthPicture({ authorized: true, columns: [third, column('B'), column('A')] },
      [...routes, { subjectId: 'C', segment: 's-invited-C' }]).rows.find(group => group.layer === 'estimate')!;
    expect(result.rows[0].cells).toHaveLength(3);
    expect(result.rows[0].cells[0]).toMatchObject({ kind: 'sources', entries: [{ fileId: 'file-A' }] });
    expect(result.rows[0].cells[1]).toMatchObject({ kind: 'sources', entries: [{ fileId: 'file-B' }] });
    expect(result.rows[0].cells[2]).toEqual({ kind: 'not-shared' });
  });
  it('retains captured output whose old category is no longer recognized, without inventing a new category', () => {
    const report = stored(); report.report.catalogSnapshot.template.category = 'historical-unknown-category';
    const result = rows([column('A', [report]), column('B', [])]);
    expect(result.rows[0].category).toBeNull(); expect(result.rows[0].title).toBe('Captured a');
  });
  it('does not confuse another stored version with legacy resolver output', () => {
    const a = column('A', []); a.access[1].kind = 'legacy-only'; a.legacyFileIds = ['exact-old'];
    expect(rows([a, column('B')]).rows[0].cells[0]).toEqual({ kind: 'legacy' });
  });
  it('withholds every column on final capture denial or mismatched route membership', () => {
    const state: HealthPictureState = { authorized: false, columns: [column('A'), column('B')] };
    expect(projectHealthPicture(state, routes).rows).toEqual([]);
    expect(projectHealthPicture({ ...state, authorized: true }, [routes[0]]).rows).toEqual([]);
  });
});
