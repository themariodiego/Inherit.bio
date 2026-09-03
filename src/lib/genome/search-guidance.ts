// Layperson search guidance for the genome browser. Two honesty problems
// this solves:
//
// 1. People search hereditary-risk genes (BRCA1, MLH1, ...) that the
//    reference store deliberately does not cover. An empty result there
//    reads as reassurance — it must instead say that consumer array data
//    cannot assess those genes at all.
// 2. People search plain-English traits ("eye color", "caffeine") that the
//    variant search cannot parse. Those queries should land on the report
//    library, not a dead end.
//
// Pure data + matching so the server page can use it directly. Nothing here
// is user-facing: the topic words live in src/copy/genome/data.ts
// (TRAIT_TOPICS) and the report titles are read from `report_templates` at
// render, so a retitled template never leaves a stale link text here.

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

/** Topic ids, each labelled by a plain-English phrase in the copy module. */
export const TRAIT_TOPIC_IDS = [
  "eye-color",
  "alcohol",
  "caffeine",
  "sleep",
  "memory",
  "lactose",
  "cilantro",
  "earwax",
  "hair",
  "body-weight",
  "vitamins",
  "nicotine",
  "taste",
  "muscle",
] as const;

export type TraitTopic = (typeof TRAIT_TOPIC_IDS)[number];

export interface TraitSuggestion {
  /** The topic recognised in the query. */
  topic: TraitTopic;
  /** Slugs of the reports in the library that cover the topic, in display order. */
  slugs: readonly string[];
}

interface TraitEntry extends TraitSuggestion {
  keywords: readonly string[];
}

// Slugs mirror data/templates/*.json (the seeded report library); the unit
// test reads that directory and fails on any slug that no template carries.
const TRAIT_MAP: readonly TraitEntry[] = [
  {
    topic: "eye-color",
    keywords: ["eye color", "eye colour", "eyes", "eye"],
    slugs: ["eye-color-herc2-rs12913832"],
  },
  {
    topic: "alcohol",
    keywords: ["alcohol", "drinking", "flush"],
    slugs: ["alcohol-flush-aldh2-rs671", "alcohol-metabolism-adh1b-rs1229984"],
  },
  {
    topic: "caffeine",
    keywords: ["caffeine", "coffee"],
    slugs: ["caffeine-metabolism-cyp1a2-rs762551", "caffeine-sleep-adora2a-rs5751876"],
  },
  {
    topic: "sleep",
    keywords: ["sleep", "insomnia", "chronotype", "night owl", "morning person"],
    slugs: [
      "sleep-duration-abcc9-rs11046205",
      "chronotype-clock-rs1801260",
      "morning-chronotype-rgs16-rs516134",
    ],
  },
  {
    topic: "memory",
    keywords: ["memory", "forgetful"],
    slugs: ["memory-plasticity-bdnf-rs6265", "episodic-memory-kibra-rs17070145"],
  },
  {
    topic: "lactose",
    keywords: ["lactose", "lactase", "milk", "dairy"],
    slugs: ["lactase-persistence-lct-rs4988235"],
  },
  {
    topic: "cilantro",
    keywords: ["cilantro", "coriander"],
    slugs: ["cilantro-soapy-taste-or6a2"],
  },
  {
    topic: "earwax",
    keywords: ["earwax", "ear wax"],
    slugs: ["earwax-type-abcc11", "earwax-body-odor-abcc11-rs17822931"],
  },
  {
    topic: "hair",
    keywords: ["hair", "baldness", "bald"],
    slugs: [
      "hair-curl-tchh-rs11803731",
      "male-pattern-baldness-ar-rs6152",
      "red-hair-fair-skin-mc1r-rs1805007",
    ],
  },
  {
    topic: "body-weight",
    keywords: ["weight", "obesity", "bmi"],
    slugs: ["obesity-fto-rs9939609", "obesity-mc4r-rs17782313"],
  },
  {
    topic: "vitamins",
    keywords: ["vitamin d", "vitamin b12", "vitamin c", "vitamin"],
    slugs: [
      "vitamin-d-cyp2r1-rs10741657",
      "vitamin-b12-fut2-rs602662",
      "vitamin-c-slc23a1-rs33972313",
    ],
  },
  {
    topic: "nicotine",
    keywords: ["smoking", "nicotine", "cigarette"],
    slugs: ["nicotine-dependence-chrna5-rs16969968", "smoking-initiation-bdnf-rs6265"],
  },
  {
    topic: "taste",
    keywords: ["bitter", "taste", "sweet"],
    slugs: ["bitter-taste-tas2r38", "sweet-taste-sensitivity-tas1r3"],
  },
  {
    topic: "muscle",
    keywords: ["muscle", "sprint", "athletic", "endurance"],
    slugs: ["muscle-composition-actn3-rs1815739", "endurance-trainability-ppargc1a-rs8192678"],
  },
];

/** Every slug the map can suggest, for the test that checks them against the seeded library. */
export const TRAIT_SLUGS: readonly string[] = TRAIT_MAP.flatMap((entry) => entry.slugs);

/** Maps a plain-English query to reports in the library, or null. A match
 * requires the query to contain a keyword, or (for partial typing like
 * "caffein") a keyword to contain the whole query. */
export function matchTraitSuggestion(query: string): TraitSuggestion | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  for (const entry of TRAIT_MAP) {
    for (const keyword of entry.keywords) {
      if (q.includes(keyword) || (q.length >= 4 && keyword.includes(q))) {
        return { topic: entry.topic, slugs: entry.slugs };
      }
    }
  }
  return null;
}
