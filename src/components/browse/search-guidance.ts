// Layperson search guidance for /browse. Two honesty problems this solves:
//
// 1. People search hereditary-risk genes (BRCA1, MLH1, ...) that the
//    reference store deliberately does not cover. An empty result there
//    reads as reassurance — it must instead say that consumer array data
//    cannot assess those genes at all.
// 2. People search plain-English traits ("eye color", "caffeine") that the
//    variant search cannot parse. Those queries should land on the report
//    library, not a dead end.
//
// Pure data + matching so the server page can use it directly.

/** Well-known clinical genes people search by name. The reference store has
 * no rows for them, and a consumer array file could not reliably assess
 * them even if it did — the page must say so explicitly. */
export const CLINICAL_GENES = new Set([
  "BRCA1",
  "BRCA2",
  "TP53",
  "MLH1",
  "MSH2",
  "APC",
  "PTEN",
  "PALB2",
  "ATM",
  "CHEK2",
]);

export interface TraitSuggestion {
  /** Plain-English topic recognized in the query, e.g. "eye color". */
  topic: string;
  /** Reports in the library that cover the topic. */
  reports: { slug: string; title: string }[];
}

interface TraitEntry extends TraitSuggestion {
  keywords: string[];
}

// Slugs and titles mirror data/templates/*.json (the seeded report library).
const TRAIT_MAP: TraitEntry[] = [
  {
    topic: "eye color",
    keywords: ["eye color", "eye colour", "eyes", "eye"],
    reports: [
      {
        slug: "eye-color-herc2-rs12913832",
        title: "Blue vs. brown eye color · HERC2/OCA2",
      },
    ],
  },
  {
    topic: "alcohol response",
    keywords: ["alcohol", "drinking", "flush"],
    reports: [
      {
        slug: "alcohol-flush-aldh2-rs671",
        title: "Alcohol flush reaction · ALDH2",
      },
      {
        slug: "alcohol-metabolism-adh1b-rs1229984",
        title: "Alcohol metabolism speed · ADH1B",
      },
    ],
  },
  {
    topic: "caffeine",
    keywords: ["caffeine", "coffee"],
    reports: [
      {
        slug: "caffeine-metabolism-cyp1a2-rs762551",
        title: "Caffeine metabolism · CYP1A2",
      },
      {
        slug: "caffeine-sleep-adora2a-rs5751876",
        title: "Caffeine, anxiety & sleep · ADORA2A",
      },
    ],
  },
  {
    topic: "sleep",
    keywords: ["sleep", "insomnia", "chronotype", "night owl", "morning person"],
    reports: [
      {
        slug: "sleep-duration-abcc9-rs11046205",
        title: "Sleep duration · ABCC9",
      },
      {
        slug: "chronotype-clock-rs1801260",
        title: "Chronotype · CLOCK 3111T/C",
      },
      {
        slug: "morning-chronotype-rgs16-rs516134",
        title: "Morning chronotype · RGS16",
      },
    ],
  },
  {
    topic: "memory",
    keywords: ["memory", "forgetful"],
    reports: [
      {
        slug: "memory-plasticity-bdnf-rs6265",
        title: "Memory & brain plasticity · BDNF",
      },
      {
        slug: "episodic-memory-kibra-rs17070145",
        title: "Episodic memory · KIBRA",
      },
    ],
  },
  {
    topic: "lactose tolerance",
    keywords: ["lactose", "lactase", "milk", "dairy"],
    reports: [
      {
        slug: "lactase-persistence-lct-rs4988235",
        title: "Lactose tolerance · LCT/MCM6",
      },
    ],
  },
  {
    topic: "cilantro taste",
    keywords: ["cilantro", "coriander"],
    reports: [
      {
        slug: "cilantro-soapy-taste-or6a2",
        title: "Cilantro soapy taste · OR6A2 region",
      },
    ],
  },
  {
    topic: "earwax",
    keywords: ["earwax", "ear wax"],
    reports: [
      {
        slug: "earwax-type-abcc11",
        title: "Wet or dry earwax · ABCC11",
      },
      {
        slug: "earwax-body-odor-abcc11-rs17822931",
        title: "Earwax type and body odor · ABCC11",
      },
    ],
  },
  {
    topic: "hair",
    keywords: ["hair", "baldness", "bald"],
    reports: [
      {
        slug: "hair-curl-tchh-rs11803731",
        title: "Straight vs. curly hair · TCHH",
      },
      {
        slug: "male-pattern-baldness-ar-rs6152",
        title: "Male-pattern hair loss · AR (X chromosome)",
      },
      {
        slug: "red-hair-fair-skin-mc1r-rs1805007",
        title: "Red hair and fair skin · MC1R (R151C)",
      },
    ],
  },
  {
    topic: "body weight",
    keywords: ["weight", "obesity", "bmi"],
    reports: [
      {
        slug: "obesity-fto-rs9939609",
        title: "Body weight tendency · FTO",
      },
      {
        slug: "obesity-mc4r-rs17782313",
        title: "Body weight tendency · MC4R region",
      },
    ],
  },
  {
    topic: "vitamin levels",
    keywords: ["vitamin d", "vitamin b12", "vitamin c", "vitamin"],
    reports: [
      {
        slug: "vitamin-d-cyp2r1-rs10741657",
        title: "Vitamin D levels · CYP2R1",
      },
      {
        slug: "vitamin-b12-fut2-rs602662",
        title: "Vitamin B12 levels · FUT2",
      },
      {
        slug: "vitamin-c-slc23a1-rs33972313",
        title: "Vitamin C levels · SLC23A1",
      },
    ],
  },
  {
    topic: "smoking and nicotine",
    keywords: ["smoking", "nicotine", "cigarette"],
    reports: [
      {
        slug: "nicotine-dependence-chrna5-rs16969968",
        title: "Nicotine dependence · CHRNA5",
      },
      {
        slug: "smoking-initiation-bdnf-rs6265",
        title: "Smoking initiation · BDNF",
      },
    ],
  },
  {
    topic: "taste perception",
    keywords: ["bitter", "taste", "sweet"],
    reports: [
      {
        slug: "bitter-taste-tas2r38",
        title: "Bitter taste perception (PTC/PROP) · TAS2R38",
      },
      {
        slug: "sweet-taste-sensitivity-tas1r3",
        title: "Sweet taste sensitivity · TAS1R3 promoter",
      },
    ],
  },
  {
    topic: "muscle and endurance",
    keywords: ["muscle", "sprint", "athletic", "endurance"],
    reports: [
      {
        slug: "muscle-composition-actn3-rs1815739",
        title: "Muscle composition · ACTN3 R577X",
      },
      {
        slug: "endurance-trainability-ppargc1a-rs8192678",
        title: "Endurance trainability · PPARGC1A Gly482Ser",
      },
    ],
  },
];

/** Maps a plain-English query to reports in the library, or null. A match
 * requires the query to contain a keyword, or (for partial typing like
 * "caffein") a keyword to contain the whole query. */
export function matchTraitSuggestion(query: string): TraitSuggestion | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  for (const entry of TRAIT_MAP) {
    for (const keyword of entry.keywords) {
      if (q.includes(keyword) || (q.length >= 4 && keyword.includes(q))) {
        return { topic: entry.topic, reports: entry.reports };
      }
    }
  }
  return null;
}

/** Example searches rendered as chips under the search box. */
export const SEARCH_EXAMPLES: { q: string; hint: string }[] = [
  { q: "rs671", hint: "alcohol flush" },
  { q: "CYP1A2", hint: "caffeine" },
  { q: "chr20:1000000-1100000", hint: "a region" },
];
