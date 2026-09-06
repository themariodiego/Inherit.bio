export const PERSONAL_RESULT_LABEL = "Your result";
export const WITH_RESULTS_LABEL = "With results";
export const NO_RESULT_MATCHES = "No reports with results match this search. Clear the filter to browse the full library.";

/** Reviewed position-specific paraphrases; source locations are recorded for every trait. */
export const PERSONAL_PREVIEW_TRAITS = [
  {
    slug: "cilantro-soapy-taste-or6a2", rsid: 72921001, chrom: 11, pos38: 6868417, ref: "C", alt: "A",
    source: { doi: "10.1186/2044-7248-1-22", accessedOn: "2026-09-06", locator: "Table 2 and Methods: per-A association with self-reported soapiness" },
    statements: {
      CC: "Your file shows two copies of a form linked to noticing a soapy taste in cilantro.",
      AC: "Your file shows one copy of a form linked to less frequent reports of soapy-tasting cilantro.",
      AA: "Your file shows two copies of a form linked to less frequent reports of soapy-tasting cilantro.",
    } as Record<string, string>,
    qualifier: "The link was small and studied in people with European ancestry. It does not test whether you like cilantro.",
  },
  {
    slug: "asparagus-odor-detection-or2m7", rsid: 4481887, chrom: 1, pos38: 248333561, ref: "A", alt: "G",
    source: { pmid: "20585627", accessedOn: "2026-09-06", locator: "Table 9: odor detection by genotype; one and two A copies were similar" },
    statements: {
      AA: "Your file shows a form linked to noticing an odor after asparagus. The study asked about urine.",
      AG: "Your file shows a form linked to noticing an odor after asparagus. The study asked about urine.",
      GG: "Your file shows a form linked to noticing the asparagus odor less often. Most people with it in the study still noticed the odor.",
    } as Record<string, string>,
    qualifier: "This is a survey link, not a separate test of making or smelling an odor.",
  },
  {
    slug: "photic-sneeze-reflex-2q22", rsid: 10427255, chrom: 2, pos38: 145367955, ref: "C", alt: "T",
    source: { pmid: "20585627", accessedOn: "2026-09-06", locator: "Tables 2 and 10: bright-light sneeze reports by genotype" },
    statements: {
      CC: "Your file shows two copies of a form linked to more reports of sneezing in bright light.",
      CT: "Your file shows one copy of a form linked to more reports of sneezing in bright light.",
      TT: "Your file shows the form linked to fewer reports of sneezing in bright light.",
    } as Record<string, string>,
    qualifier: "People in every group reported the reflex. Your own response may differ.",
  },
  {
    slug: "earwax-type-abcc11", rsid: 17822931, chrom: 16, pos38: 48224287, ref: "C", alt: "T",
    source: { pmid: "16444273", accessedOn: "2026-09-05", locator: "Abstract: dry earwax association and dominance of the wet type" },
    statements: {
      CC: "Your file shows a form linked to wet, sticky earwax.",
      CT: "Your file shows a form linked to wet, sticky earwax.",
      TT: "Your file shows a form linked to dry, flaky earwax.",
    } as Record<string, string>,
    qualifier: "This describes earwax type, not a measure of body odor.",
  },
  {
    slug: "alcohol-flush-aldh2-rs671", rsid: 671, chrom: 12, pos38: 111803962, ref: "G", alt: "A",
    source: {
      pmid: "39075523", supportingPmids: ["2024727"], accessedOn: "2026-09-05",
      locator: "Rwere 2024, Figure 3: AG/GG response. Enomoto 1991, abstract: AA liver and blood tests.",
    },
    statements: {
      GG: "Your file does not show the common ALDH2 change linked to alcohol flushing.",
      AG: "Your file shows one copy of a form that slows the breakdown of an alcohol by-product called acetaldehyde. This can help explain flushing.",
      AA: "Your file shows two copies of a form linked to very low ALDH2 activity. This enzyme clears acetaldehyde, a by-product of alcohol.",
    } as Record<string, string>,
    qualifier: "This explains one route to flushing, not your overall alcohol tolerance.",
  },
  {
    slug: "lactase-persistence-lct-rs4988235", rsid: 4988235, chrom: 2, pos38: 135851076, ref: "G", alt: "A",
    source: { pmid: "11788828", accessedOn: "2026-09-05", locator: "Abstract: association with biochemically verified lactase activity" },
    statements: {
      GG: "Your file shows a form linked to lower activity of the enzyme that breaks down milk sugar after childhood.",
      AG: "Your file shows a form linked to keeping the enzyme that breaks down milk sugar active in adulthood.",
      AA: "Your file shows a form linked to keeping the enzyme that breaks down milk sugar active in adulthood.",
    } as Record<string, string>,
    qualifier: "This link is best studied in European groups. It does not tell you whether dairy causes symptoms.",
  },
  {
    slug: "bitter-taste-tas2r38", rsid: 1726866, chrom: 7, pos38: 141972905, ref: "G", alt: "A",
    source: { pmid: "12595690", accessedOn: "2026-09-05", locator: "Page 1223, Tables 2 and 3: Ala262/Val262 and three-position patterns" },
    statements: {
      GG: "Your file shows the form found in a DNA pattern linked to tasting a bitter test chemical more strongly.",
      AG: "Your file shows one copy of each form found in the common bitter-taste DNA patterns.",
      AA: "Your file shows the form found in a DNA pattern linked to tasting a bitter test chemical less strongly.",
    } as Record<string, string>,
    qualifier: "One position does not show the full pattern. A bitter taste test is not a measure of food preference.",
  },
] as const;
