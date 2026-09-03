/**
 * `/family/portrait/[pairId]` — every user-visible string of the Portrait
 * surface (design §2.5; brief §2 §5.6 lines 352-364, §3 §8.4 line 1016,
 * §4 §5.1-5.4 lines 1343-1368, A.7 line 2238, G5.9 line 2650, X10.1).
 *
 * The strings the brief quotes ship character-for-character, with U+2019
 * apostrophes and U+2014 dashes (line 511). Export names carry the
 * readability role (scripts/readability-gate.ts): `*_HEADING` reads as a
 * heading, `*_LABEL` as a label, `*_BUTTON` as a button, `*_STATUS` as a
 * status. Strings shared with another surface are re-exported from their
 * one home rather than respelled.
 *
 * Nothing here is about one child. Every sentence describes many possible
 * children, and no sentence names a pair, a relationship, a sex prediction,
 * a ranking or an image (lines 1016, 1343, 2238).
 */
import { REPORT_HEADINGS } from "@/copy/reports/headings";
import { COUNSELLOR_NO_ROUTE, NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { EXACT_MARKER } from "@/lib/figures/contract";
import type {
  AutosomalOutcome,
  CrossOutcome,
  MendelAssumption,
  MendelOutcome,
  MendelPattern,
} from "@/lib/family/mendel";
import type { TraitKey } from "@/lib/family/traits";
import { GATE_ERROR_STATUS } from "./person";

/** The h1 and the document title: the same word as the Overview box and the hub tile. */
export const PORTRAIT_H1 = "Portrait";

// ---------------------------------------------------------------------------
// The persistent banner (line 364) and the header sentence (line 1016).
// ---------------------------------------------------------------------------

/** Character-for-character (line 364). On every Portrait screen, the blocking screen included. */
export const BANNER_FIRST =
  "Portrait describes chances across many possible children. It cannot tell you anything about any actual child. It is not a pregnancy test and not a medical assessment.";

/** Character-for-character (line 364). Beneath the first. */
export const BANNER_SECOND = "Both of you can see this page, and either of you can delete it.";

/** Character-for-character (line 1016). Never "the two of you": no relationship is established. */
export const HEADER_SENTENCE =
  "This shows what a child could inherit from the two files you have added. It is not a picture of any particular child.";

/** Character-for-character (line 1016): the `both-genomes-required` state. */
export const BOTH_GENOMES_REQUIRED =
  "Add a second genome to see what a child could inherit from these two files.";

/** Character-for-character (line 1353), with U+2014. */
export const DISTINGUISHING_PRINCIPLE =
  "Portrait describes the range of children a couple could have. Embryo Analysis helps choose between embryos that already exist — so no appearance trait appears there at all.";

// ---------------------------------------------------------------------------
// The blocking screen (line 352; register `portrait-grant-denial-v1`).
// ---------------------------------------------------------------------------

/**
 * `family.portrait.consent-required.heading`. Written in registered plain
 * words; the design's draft ("Portrait needs one more step from {names}")
 * used two words the vocabulary does not hold.
 */
export function blockingHeading(names: string): string {
  return `Portrait is waiting for ${names}`;
}

/**
 * `family.portrait.consent-required.body`. The design's one-sentence draft
 * graded 9.8, so it is two sentences here with the same three conditions.
 */
export const BLOCKING_BODY =
  "Portrait shows only when both people have their own account. Each must turn on Portrait from their own account, and read what it can and cannot show.";

/** One line per missing step, server-derived (design §2.5). */
export function missingStep(name: string, step: string): string {
  return `${name} has not: ${step}`;
}

/** The four steps a person can have left undone, as the line above names them. */
export const PORTRAIT_STEPS = {
  account: "opened their own Inherit account",
  grant: "turned on Portrait from their own account",
  acknowledged: "read what Portrait will and will not show",
  independentLogin: "signed in to Inherit on their own",
} as const;
export type PortraitStep = keyof typeof PORTRAIT_STEPS;

/** `family.portrait.consent-required.action` → `settings.consents`. */
export const OPEN_CONSENTS_BUTTON = "Open your consents";

/** The acknowledgement checkbox (design §2.5), stamped on the viewer's own subject only. */
export const ACKNOWLEDGE_CHECKBOX_LABEL = "I have read what Portrait will and will not show.";

export const ACKNOWLEDGE_BUTTON = "Continue";

/** The acknowledgement did not save; the same words as the Tier-2 gate's own failure. */
export const ACKNOWLEDGE_ERROR_STATUS = GATE_ERROR_STATUS;

// ---------------------------------------------------------------------------
// Outputs: headings, the per-output sentences and the derivation.
// ---------------------------------------------------------------------------

export const OUTPUTS_HEADING = "What a child could inherit";

/** Character-for-character (line 1345); once per output. */
export const SEGREGATION_SENTENCE =
  "Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.";

/** Character-for-character (line 2650, G5.9(b)); in every claim block. */
export const CHANCE_NOT_PREDICTION = "This is a chance, not a prediction about a particular child.";

/** The exactness label (line 1254), rendered by the claim block from its one home. */
export const EXACTNESS_LABEL = EXACT_MARKER;

/** The three words of the mandated derivation (line 1349). */
export const DERIVATION_WORDS: Record<AutosomalOutcome, string> = {
  affected: "affected",
  carrier: "carriers",
  neither: "neither",
};

/**
 * The derivation line, character-for-character for the recessive cross
 * (line 1349): "1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%)
 * neither". Only outcomes that occur are passed in, so no part reads zero.
 */
export function derivationLine(outcomes: readonly CrossOutcome[]): string {
  return outcomes
    .map((part) => {
      const word = DERIVATION_WORDS[part.outcome as AutosomalOutcome];
      if (word === undefined) throw new Error(`derivationLine: ${part.outcome} has no derivation word`);
      return `${part.fraction.numerator} in ${part.fraction.denominator} (${part.inHundred}%) ${word}`;
    })
    .join(" · ");
}

/** The outcome clause of "…about {n} would {outcome}." for each outcome the crosses name. */
export const OUTCOME_PHRASES: Record<MendelOutcome, string> = {
  affected: "have the condition",
  carrier: "carry one copy of the change",
  neither: "have no copy of the change",
  boy_affected: "be boys with the condition",
  boy_neither: "be boys without it",
  girl_affected: "be girls with the condition",
  girl_carrier: "be girls who carry it",
  girl_neither: "be girls without it",
};

/** The mandated distribution sentence (line 360; open decision 6, the §2 form). */
export function outOfHundredSentence(count: number, outcome: string): string {
  return `Out of 100 possible children, about ${count} would ${outcome}.`;
}

/** Below 1 in 100 (line 360), character-for-character with U+2014 and U+2019. */
export function belowOneInHundredSentence(perThousand: number): string {
  return `Fewer than 1 in 100 — but not zero. Inherit’s estimate is about ${perThousand} in 1,000.`;
}

/** Character-for-character (line 354): the X-linked split, both sexes, no prediction of either. */
export function xLinkedSentence(boysWithCondition: number, girlsWhoCarry: number): string {
  return `Out of 100 possible pregnancies, about ${boysWithCondition} would be boys with the condition and about ${girlsWhoCarry} girls who carry it.`;
}

/** Character-for-character (line 2238): one parent shows one copy, the other's covered positions show none. */
export function noSecondCopy(parent: string): string {
  return `Based on the variants your files cover, we found no second copy in ${parent}. This is not zero risk: your files do not cover every variant known to cause this condition.`;
}

/** The covered count against the registry's known count (line 2238), on every carrier-pair result. */
export function knownChangesCovered(covered: number, known: number): string {
  return `Both files cover ${covered} of the ${known} changes known to cause this condition.`;
}

/** Character-for-character (line 1349): the runs-of-homozygosity refusal. */
export const RUNS_REFUSAL =
  "These two files look more genetically similar than usual. That changes the maths in ways we cannot show you honestly here. Please talk to a genetic counsellor.";

/** Character-for-character (line 1349): a position one file does not cover. Never imputed. */
export function cannotCalculate(label: string, rsid: string): string {
  return `We cannot do this calculation. ${label}’s file does not cover ${rsid}.`;
}

/** Character-for-character (line 354): the Rh card's clinical relevance. */
export const RH_ANTI_D =
  "If the pregnant parent is RhD negative and the other is RhD positive, a pregnancy may need an injection called anti-D. This is routine care, not a risk to the pregnancy.";

/** Character-for-character (line 354): the file cannot determine RhD. */
export const RHD_UNKNOWN =
  "Your file cannot tell whether you are RhD positive or negative. A blood test at any clinic can.";

/**
 * Line 1350, character-for-character. A claim about inheritance in general,
 * not about the files: it renders as a claim with a citation id once one
 * exists in data/citations.json, and not at all until then (C5; open
 * decision 7). Kept here so the wording has one home when that day comes.
 */
export const CHROMOSOMAL_SEX_EXPECTATION =
  "Each conception is equally likely to get an X or a Y from the father. That is the expectation from inheritance, not an observed birth ratio.";

// ---------------------------------------------------------------------------
// Trait cards (X10.1). Every card states the registry's status today.
// ---------------------------------------------------------------------------

/**
 * The card headings for the five keys. "Blood type" names the ABO card in
 * plain words (its body says ABO); "Lactose tolerance" is the plain name of
 * what lactase persistence shows. Rh has no plain word.
 */
export const TRAIT_HEADINGS: Record<TraitKey, string> = {
  abo: "Blood type",
  rh: "Rh type",
  red_hair: "Red hair",
  lactase_persistence: "Lactose tolerance",
  earwax: "Earwax type",
};

/** Design §2.5: "yet" is permitted because registering a cited table is within the operator's control (line 2680). */
export function unregisteredCard(trait: string): string {
  return `Inherit has not registered a sourced table for ${trait} yet, so this card shows nothing.`;
}

// ---------------------------------------------------------------------------
// The distribution (line 360; brief line 801 for the caption and the table).
// ---------------------------------------------------------------------------

/** The accessible name of the dot grid. */
export const DOTS_LABEL = "100 children that could be born";

/** The figcaption naming the quantity (line 801). */
export const DOTS_CAPTION =
  "100 possible children, one dot each. No dot is a real child; together they show the spread of chances.";

/** The accessible name of the stacked bar beneath the dots. */
export const BAR_LABEL = "100 children as one line";

/** Character-for-character (line 801): the Disclosure that opens the table fallback. */
export const SEE_AS_TABLE_BUTTON = "See these numbers as a table";

/** The table fallback's column headers. */
export const DOTS_TABLE_LABELS = {
  outcome: "What a child could inherit",
  count: "Out of 100",
} as const;

// ---------------------------------------------------------------------------
// "How sure we are" (line 360): non-collapsible, on every output card.
// ---------------------------------------------------------------------------

/** The heading, from the one home of the six report headings. */
export const HOW_SURE_HEADING = REPORT_HEADINGS[3];

/** The four named fields of the block, in order (line 360). */
export const HOW_SURE_LABELS = {
  pattern: "The pattern",
  assumption: "What we do not check",
  coverage: "What both files covered",
  change: "What would change this",
} as const;

/** The inheritance pattern each cross follows, in words. */
export const PATTERN_DESCRIPTIONS: Record<MendelPattern, string> = {
  autosomal_recessive:
    "A change that only shows when a child gets a copy of it from both parents.",
  autosomal_dominant: "A change that shows when a child gets one copy of it from either parent.",
  x_linked:
    "A change on the X chromosome. A boy gets his one X from his mother; a girl gets one X from each parent.",
};

/** Each assumption the arithmetic rests on (line 1349), stated as an assumption. */
export const ASSUMPTION_STATEMENTS: Record<MendelAssumption, string> = {
  independent_assortment:
    "Which copy a child gets is decided at random, one position at a time.",
  no_new_mutation: "No new change appears in a child that neither parent carries.",
  no_imprinting:
    "It makes no difference which parent a copy came from, because this gene is not registered as one where it does.",
  runs_below_threshold:
    "Inherit checked each file on its own for long runs of matching letters. Neither file was above the limit.",
  equal_x_y_transmission:
    "This split takes an X and a Y from the father as equally likely. That is an assumption of the pattern, not a count of births.",
};

/** Both files cover the positions the arithmetic uses. */
export const BOTH_FILES_COVERED = "Both files cover the positions this uses.";

/** What would change the answer for a carrier-pair block. */
export const CARRIER_WHAT_WOULD_CHANGE =
  "A different classification of this change by outside reviewers, or a file that covers positions these two do not.";

// ---------------------------------------------------------------------------
// The refusals screen `#not-shown` (lines 358, 1357-1368).
// ---------------------------------------------------------------------------

/** Character-for-character (line 358; open decision 10). */
export const REFUSALS_HEADING = "What Portrait will not tell you, and why";

export const NOT_SHOWN_ID = "not-shown";

/** The link every card carries; the route is the science page until `/science/limits` exists. */
export const REFUSALS_LINK = "Read more about these limits";

export interface Refusal {
  refusalId: string;
  /** The item, one line (line 1357), in the brief's own words. */
  line: string;
  /** One sentence. Two are the brief's, verbatim (line 358); one is line 1365. */
  reason: string;
}

export const REFUSALS: readonly Refusal[] = [
  {
    refusalId: "cognitive-ability",
    line: "Intelligence, IQ, cognitive ability, educational attainment and academic performance.",
    reason:
      "No model can estimate a future child’s cognitive ability in a way that holds up between brothers and sisters. Inherit will not print a number that cannot be checked.",
  },
  {
    refusalId: "body-measures",
    line: "Height, weight, BMI and other body measures, as a child prediction.",
    reason:
      "A height estimate for a child who doesn’t exist carries the parents’ population differences with no way to check them, so the number would look precise and mean little.",
  },
  {
    refusalId: "personality-mental-health",
    line: "Personality, temperament, behaviour and mental health.",
    reason:
      "The evidence is as weak as for intelligence. It would also label a person who cannot agree to it.",
  },
  {
    refusalId: "orientation-identity",
    line: "Sexual orientation and gender identity.",
    reason: "No valid model for this exists, and the attempt itself would be the harm.",
  },
  {
    refusalId: "behaviour-labels",
    line: "Aggression, criminality, resilience, leadership and success.",
    reason: "These are labels, not things anyone can measure in a valid way, so there is nothing to compute.",
  },
  {
    refusalId: "longevity",
    line: "Longevity, lifespan and biological age.",
    reason:
      "No number about how long a child who does not exist would live could be checked against anything.",
  },
  {
    refusalId: "polygenic-disease-risk",
    line: "Disease risk for a hypothetical child from polygenic scores.",
    reason:
      "Family shows each parent’s own risks and the carrier arithmetic above; it does not project a score onto an unconceived person.",
  },
  {
    refusalId: "appearance",
    line: "Appearance beyond the five-trait list, including eye colour and hair colour beyond MC1R red hair.",
    reason:
      "Eye and hair colour come from many positions at once, which makes them a model rather than a reading of the files.",
  },
  {
    refusalId: "sex",
    line: "A child’s sex.",
    reason: "Inherit neither predicts nor selects sex, so every split shows both sexes side by side.",
  },
  {
    refusalId: "ranking",
    line: "Any ranking, score or best combination.",
    reason:
      "Ranking children who do not exist would turn a spread of chances into a choice, and Portrait shows the spread only.",
  },
  {
    refusalId: "image",
    line: "Any image, avatar or face of a hypothetical child.",
    reason: "A picture would show one child. Portrait can only ever describe many possible children.",
  },
];

// ---------------------------------------------------------------------------
// Shared lines, from their one home.
// ---------------------------------------------------------------------------

/** Rendered under every carrier-pair block until a counsellor directory exists (X16.2). */
export { COUNSELLOR_NO_ROUTE };

export { NOT_DIAGNOSTIC };
