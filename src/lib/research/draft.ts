// Turns upstream associations into report-template DRAFTS for the review
// queue. Drafts are never auto-published: a human reviews, then the publish
// job moves them to 'published', writes the changelog, and sends the digest.

export interface AssociationInput {
  rsid: number;
  trait: string;
  gene: string;
  chrom: number;
  pos38: number;
  ref: string;
  alt: string;
  /** Risk/effect allele as reported upstream; must equal ref or alt. */
  effect_allele: string;
  pmid: string;
  study_label: string;
  /** e.g. "OR 1.12" or "beta 0.05 SD" — plain text, shown verbatim. */
  effect_size: string;
}

const CATEGORY_BY_KEYWORD: [RegExp, string][] = [
  [/coronary|cardiac|heart|blood pressure|hypertension|atrial|lipid|cholesterol/i, "heart-cardiovascular"],
  [/cancer|carcinoma|melanoma|lymphoma|leukemia/i, "cancer-risk"],
  [/alzheimer|parkinson|dementia|amyotrophic/i, "neurodegenerative"],
  [/depress|anxiety|schizophren|bipolar|adhd|autis/i, "mental-health"],
  [/diabetes|obesity|body mass|glucose|insulin|metabol/i, "metabolic-obesity"],
  [/crohn|colitis|celiac|coeliac|bowel|gastro/i, "gastrointestinal"],
  [/rheumatoid|lupus|psoriasis|sclerosis|autoimmun|thyroiditis/i, "autoimmune"],
  [/memory|cognit|sleep|chronotype|brain/i, "brain-health"],
  [/longevity|lifespan|aging|ageing/i, "longevity"],
  [/smoking|nicotine|alcohol|cannabis|opioid|addict/i, "addiction"],
  [/fertility|menopause|menarche|pregnancy|reproduct/i, "reproductive-family"],
  [/hair|skin|pigment|baldness|freckl/i, "aesthetic-cosmetic"],
];

export function categoryForTrait(trait: string): string {
  for (const [re, cat] of CATEGORY_BY_KEYWORD) {
    if (re.test(trait)) return cat;
  }
  return "lifestyle-wellness";
}

export interface TemplateDraft {
  slug: string;
  category: string;
  title: string;
  summary: string;
  status: "review";
  evidence: "preliminary";
  variants: unknown[];
  pgs_id: null;
  citations: { pmid: string; label: string }[];
}

export function draftFromAssociation(
  a: AssociationInput,
  releaseKey: string,
): TemplateDraft {
  const other = a.effect_allele === a.alt ? a.ref : a.alt;
  const e = a.effect_allele;
  const interpretations: Record<string, string> = {};
  const pairs: [string, number][] = [
    [[other, other].sort().join(""), 0],
    [[other, e].sort().join(""), 1],
    [[e, e].sort().join(""), 2],
  ];
  for (const [key, count] of pairs) {
    interpretations[key] =
      count === 0
        ? `You carry no copies of the ${e} allele at rs${a.rsid}. In the cited study this genotype was the reference group for ${a.trait.toLowerCase()} (${a.effect_size} per allele). This is a single, recently reported association — one small factor among many.`
        : `You carry ${count === 1 ? "one copy" : "two copies"} of the ${e} allele at rs${a.rsid}, associated in the cited study with ${a.trait.toLowerCase()} (${a.effect_size} per allele). This is a single, recently reported association — one small factor among many, and it may not replicate.`;
  }

  return {
    slug: `auto-${a.trait.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-rs${a.rsid}`,
    category: categoryForTrait(a.trait),
    title: `${a.trait} · ${a.gene}`,
    summary: `A recently published association between ${a.gene} variant rs${a.rsid} and ${a.trait.toLowerCase()} (${a.effect_size}). Drafted automatically from ${releaseKey} and reviewed by a human before publication; treated as preliminary evidence.`,
    status: "review",
    evidence: "preliminary",
    variants: [
      {
        rsid: a.rsid,
        gene: a.gene,
        chrom: a.chrom,
        pos38: a.pos38,
        ref: a.ref,
        alt: a.alt,
        interpretations,
      },
    ],
    pgs_id: null,
    citations: [{ pmid: a.pmid, label: a.study_label }],
  };
}
