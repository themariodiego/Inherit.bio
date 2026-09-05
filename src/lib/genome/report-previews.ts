import "server-only";

import { PERSONAL_PREVIEW_TRAITS } from "@/copy/reports/personal-previews";
import { isGatedTemplate } from "./taxonomy";
import { genotypeKey, type ReportTemplate } from "./reports";
import type { Db } from "./load";

export interface PersonalPreview {
  text: string;
  qualifier: string;
}

export interface PreviewAudience {
  viewerAccountId: string;
  ownerAccountId: string | null;
  subjectClass: string;
  subjectId: string;
  isFamily: boolean;
}

export interface PreviewCall {
  rsid: number | null;
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  genotype: string;
}

export function isOwnPreviewAudience(audience: PreviewAudience): boolean {
  return audience.subjectClass === "self" && !audience.isFamily &&
    audience.viewerAccountId !== "" && audience.ownerAccountId === audience.viewerAccountId;
}

/** Only the selected two prose fields cross the client boundary, never the call rows or full interpretations. */
export function resolvePersonalPreview(
  audience: PreviewAudience,
  template: ReportTemplate,
  calls: readonly PreviewCall[],
  conflicts: ReadonlySet<number>,
): PersonalPreview | null {
  if (!isOwnPreviewAudience(audience) || isGatedTemplate(template) ||
      template.layer !== "estimate" || template.pgs_id) return null;
  const trait = PERSONAL_PREVIEW_TRAITS.find((item) => item.slug === template.slug);
  if (!trait || conflicts.has(trait.rsid) ||
      !template.citations.some((citation) => citation.pmid === trait.source.pmid)) return null;
  if ("supportingPmids" in trait.source && trait.source.supportingPmids.some((pmid) =>
    !template.citations.some((citation) => citation.pmid === pmid))) return null;
  const variants = template.variants.filter((variant) => variant.rsid === trait.rsid);
  if (variants.length !== 1) return null;
  const variant = variants[0];
  if (variant.chrom !== trait.chrom || variant.pos38 !== trait.pos38 ||
      variant.ref !== trait.ref || variant.alt !== trait.alt) return null;
  const matches = calls.filter((call) => call.rsid === trait.rsid);
  if (matches.length === 0) return null;
  let genotype: string | null = null;
  for (const call of matches) {
    // user_variants coordinates are canonical GRCh38. Array calls can lack
    // REF/ALT, but any recorded allele must agree; no strand guessing here.
    if (call.chrom !== trait.chrom || call.pos !== trait.pos38 ||
        (call.ref !== null && call.ref !== trait.ref) ||
        (call.alt !== null && call.alt !== trait.alt) ||
        !/^[ACGT]\/[ACGT]$/.test(call.genotype)) return null;
    const key = genotypeKey(call.genotype);
    if (!key || !Object.hasOwn(trait.statements, key) ||
        !Object.hasOwn(variant.interpretations, key) ||
        (genotype !== null && genotype !== key)) return null;
    genotype = key;
  }
  return genotype ? { text: trait.statements[genotype], qualifier: trait.qualifier } : null;
}

/** Called only after the subject route authorizes the reader. No third-party calls are fetched for previews. */
export async function loadPersonalPreviews(
  db: Db,
  audience: PreviewAudience,
  templates: readonly ReportTemplate[],
  files: readonly { id: string; build: string | null }[],
  conflicts: ReadonlySet<number>,
): Promise<Map<string, PersonalPreview>> {
  const previews = new Map<string, PersonalPreview>();
  if (!isOwnPreviewAudience(audience)) return previews;
  const knownFiles = files.filter((file) => file.build === "GRCh37" || file.build === "GRCh38");
  if (knownFiles.length === 0) return previews;
  const { data, error } = await db.from("user_variants")
    .select("rsid,chrom,pos,ref,alt,genotype")
    .eq("user_id", audience.viewerAccountId)
    .eq("subject_id", audience.subjectId)
    .in("file_id", knownFiles.map((file) => file.id))
    .in("rsid", PERSONAL_PREVIEW_TRAITS.map((trait) => trait.rsid));
  if (error || !data) return previews;
  for (const template of templates) {
    const preview = resolvePersonalPreview(audience, template, data, conflicts);
    if (preview) previews.set(template.slug, preview);
  }
  return previews;
}
