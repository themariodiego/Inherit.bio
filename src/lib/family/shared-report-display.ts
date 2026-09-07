import type { z } from "zod";
import type { reportCatalogSnapshotSchema } from "@/lib/genome/report-catalog-snapshot";
import type { ResolvedReport, VariantOutcome } from "@/lib/genome/reports";

/** A display projection of a previously authorized, captured result. This
 * module neither authorizes a read nor interprets a genotype. */
export interface StoredSharedReport {
  fileId: string;
  subjectId: string;
  completedAt: string;
  report: {
    slug: string;
    covered: boolean;
    variants: { rsid: number; outcome: VariantOutcome }[];
    conflictingRsids: number[];
    catalogSnapshot: z.infer<typeof reportCatalogSnapshotSchema>;
  };
}

export function resolveStoredSharedReport(row: StoredSharedReport): ResolvedReport | null {
  const template = row.report.catalogSnapshot.template;
  if (!Number.isFinite(Date.parse(row.completedAt)) || template.slug !== row.report.slug || template.variants.length !== row.report.variants.length
    || new Set(template.variants.map(v => v.rsid)).size !== template.variants.length) return null;
  const variants: ResolvedReport["variants"] = [];
  for (let i = 0; i < template.variants.length; i++) {
    const variant = template.variants[i], stored = row.report.variants[i];
    if (stored.rsid !== variant.rsid) return null;
    if (stored.outcome.status === "genotyped"
      && variant.interpretations[stored.outcome.genotype] !== stored.outcome.interpretation) return null;
    variants.push({ variant, outcome: stored.outcome });
  }
  return { template, variants, covered: row.report.covered };
}

/** Keep every source addressable. The default is the newest completed result;
 * an explicitly requested source must match rather than fall back to another. */
export function sharedReportsForSlug<T extends StoredSharedReport>(rows: readonly T[], slug: string): T[] {
  return rows.filter(row => row.report.slug === slug && resolveStoredSharedReport(row) !== null)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || a.fileId.localeCompare(b.fileId));
}

export function selectSharedReport<T extends StoredSharedReport>(rows: readonly T[], slug: string, source?: string): T | null {
  const matches = sharedReportsForSlug(rows, slug);
  return (source === undefined ? matches[0] : matches.find(row => row.fileId === source)) ?? null;
}
