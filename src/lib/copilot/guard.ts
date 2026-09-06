/**
 * The Copilot guard (brief line 2262; §5.7 line 366, §6.4 line 402; register
 * `copilot-intent-gate-v1` and `copilot-output-guard-v1`).
 *
 * Four deterministic checks and no model call anywhere:
 *
 * 1. `classifyIntent` reads the user's latest message against the fixed rule
 *    table `INTENT_RULES` (word lists and patterns, nothing learned) and
 *    returns one gated intent or `allowed`. The chat route runs it after
 *    scope authorization and before any provider, consent, retrieval or
 *    model step; a gated intent is answered with the matching string from
 *    `src/copy/copilot/refusals.ts` and nothing else happens.
 * 2. `checkResponseNumerals` is brief line 2262 exactly: every
 *    `/-?\d+(\.\d+)?%?/` token in the model's text must, after rounding to
 *    the token's own number of decimal places, equal a value present in that
 *    turn's tool JSON, or fall in a range of `config/allowed-numerals.json`.
 * 3. `checkCitations` holds every PMID, DOI, URL, "Author et al.", "a study
 *    by X", "according to X" and "published in X" mention to the citations
 *    the tools returned that turn (`report_templates.citations`,
 *    `prs_scores.citation`) and to the report and score names they carried,
 *    matching whole tokens only.
 * 4. `checkResponsePolicy` checks model-authored assertions and directives,
 *    separately from the user's intent, while retaining file explanations.
 *
 * Two helpers keep the route honest about what it checks: `foldStreamChunks`
 * turns the buffered model stream into the one string the checks read (text,
 * reasoning, tool inputs, sources, provider-run tool outputs: everything the
 * model authored), and `dropGatedTurns` classifies every earlier user turn a
 * client resends so a refused message never reaches the model on a later
 * request.
 *
 * A failing response is replaced whole; nothing is redacted in place.
 */
import type { UIMessage, UIMessageChunk } from "ai";

/** The scope kinds the register's `copilotScope` names. */
export type CopilotScopeKind = "self" | "subject" | "family" | "cohort" | "report";

export interface GuardScope {
  kind: CopilotScopeKind;
  /** The thread header's subject, filled into the cross-subject refusal. */
  displayLabel: string;
  /** Present for a cohort: the largest embryo count a response may state. */
  cohortSize?: number;
}

export type GatedIntent =
  | "selection-advice"
  | "sex-disclosure"
  | "prohibited-portrait"
  | "treatment"
  | "diagnosis"
  | "prognosis"
  | "cross-subject";

export type IntentClass = GatedIntent | "allowed";

export interface IntentVerdict {
  intent: IntentClass;
  /** The id of the first rule that matched, or null when allowed. */
  rule: string | null;
}

export interface IntentRule {
  id: string;
  intent: GatedIntent;
  pattern: RegExp;
  /** A message that also matches this is not gated by this rule. */
  unless?: RegExp;
  /**
   * As `unless`, tested against the case-preserving normalization, for
   * shapes only capitals reveal (a gene symbol such as MTHFR or CYP1A2).
   */
  unlessRaw?: RegExp;
  /** Apply only when the message names an embryo, or the scope is a cohort. */
  embryoContext?: boolean;
  /** Apply only in these scope kinds. */
  scopes?: readonly CopilotScopeKind[];
  /** Skip in these scope kinds. */
  notScopes?: readonly CopilotScopeKind[];
}

// ---------------------------------------------------------------------------
// Word lists. Every list the rules use is here, once.
// ---------------------------------------------------------------------------

/** People a message can name who are never the thread's subject. */
const RELATIVES =
  "mother|mum|mom|father|dad|parents?|sister|brother|siblings?|son|daughter|children|child|kids?|wife|husband|partner|spouse|boyfriend|girlfriend|fiancee?|cousins?|aunt|uncle|grandmother|grandfather|grandma|grandpa|grandparents?|nephew|niece|friend|twin|baby";

/** The two adults a family or cohort scope already covers. */
const PAIR_RELATIVES = "wife|husband|partner|spouse|boyfriend|girlfriend|fiancee?";

/** What a person's genetic record is called. */
const DATA_WORDS =
  "file|files|dna|genome|genotype|genotypes|result|results|report|reports|variant|variants|risk|risks|data|ancestry|score|scores|gene|genes|marker|markers|chance|chances|carrier status|raw data|test|tests";

/** A "do I have …" whose object is a file fact is a lookup, not a diagnosis. */
const FILE_FACT_WORDS =
  "variant|variants|gene|genes|allele|alleles|marker|markers|genotype|genotypes|mutation|mutations|copy|copies|snp|snps|file|files|report|reports|result|results|data|version|versions|coverage|carrier|score|scores|reads?|dna|genome|genomes|ancestry|haplogroup|haplogroups|neanderthal|array|arrays|position|positions|rs\\d+";

/**
 * The object of "have" or "got": an optional determiner, up to two qualifying
 * words, then a file-fact word ("the lactase persistence variant",
 * "Neanderthal DNA", "rs762551"). The exemption reaches no further.
 */
const DETERMINERS = "a|an|the|any|some|this|that|these|those|my|our|his|her|their|its";
/** A qualifying word inside the object: never a pronoun or determiner, so the object cannot run into the next clause. */
const QUALIFIER = `(?!(?:${DETERMINERS}|i|we|you|he|she|it|they|me|us|him|them)\\b)\\w+ `;
const FILE_FACT_OBJECT = `(?:(?:${DETERMINERS}) )?(?:${QUALIFIER}){0,2}(?:${FILE_FACT_WORDS})\\b`;

/** The same object, on the case-preserving text: a gene symbol such as MTHFR, APOE or CYP1A2. */
const GENE_SYMBOL_OBJECT = `(?:(?:${DETERMINERS}) )?(?:${QUALIFIER}){0,2}[A-Z][A-Z0-9]{1,7}\\b`;

/** What the product itself is called; a bare verb on one of these is not a treatment question. */
const PRODUCT_WORDS =
  "file|files|data|raw data|genome|genomes|model|models|account|accounts|key|keys|upload|uploads|provider|providers|copilot|thread|threads|report|reports|export|exports|backup|backups|vcf|browser|settings|plan";

const CONDITION_WORDS =
  "cancer|tumou?r|diabetes|alzheimer'?s|parkinson'?s|huntington'?s|dementia|arthritis|asthma|coeliac|celiac|ha?emochromatosis|thalassa?emia|ana?emia|autism|adhd|depression|schizophrenia|bipolar|infection|disease|disorder|syndrome|condition|illness";

/** A state a person asks to be told they are in. */
const SELF_STATE_WORDS =
  "sick|ill|unwell|diabetic|ana?emic|coeliac|celiac|lactose intolerant|autistic|depressed|infertile|allergic to|immunocompromised";

/** A comparative about embryos, which is a ranking by another name. */
const COMPARATIVES =
  "better|best|healthier|healthiest|stronger|strongest|worse|worst|weaker|weakest|fitter|fittest|superior|inferior|more promising|less risky|least risky|riskier|riskiest|more viable|most viable";

/** A prediction verb about one child, which Portrait never makes. */
const CHILD_TRAIT_VERBS = "be|have|get|look|grow|become|turn out|end up";

/** Dose units, with or without a space after the number. */
const DOSE_UNITS = "mg|mcg|µg|μg|ug|iu|ml|units?|milligrams?|micrograms?|grams?";

const EMBRYO_VERBS =
  "pick|choose|select|transfer|implant|keep|discard|use|freeze|donate|destroy|go with|prefer|recommend";

const SUPERLATIVES =
  "best|better|worst|healthiest|strongest|top|safest|highest|lowest|lowest risk|highest risk|most promising|least risky";

const SEX_WORDS =
  "sex|gender|boy|boys|girl|girls|male|males|female|females|son|sons|daughter|daughters|xx|xy|x or y|y chromosome|x chromosome";

const CHILD_WORDS = "child|baby|kid|kids|children|son|daughter|future child|first child|next child|future baby";

const INTAKE_WORDS =
  "supplements?|vitamins?|diet|foods?|medication|medications|medicine|medicines|drugs?|pills?|dose|treatment|treatments|remedy|remedies|exercise|lifestyle|iron|folate|folic acid|omega|probiotics?|creatine|melatonin|magnesium|zinc";

const DIET_WORDS =
  "keto|paleo|vegan|vegetarian|fasting|gluten free|dairy free|low carb|diet";

const PERSONS = "i|we|he|she|they|my \\w+|our \\w+";

const re = (source: string) => new RegExp(source, "u");

// ---------------------------------------------------------------------------
// The rule table, in priority order. The first matching rule wins.
// ---------------------------------------------------------------------------

export const INTENT_RULES: readonly IntentRule[] = [
  // (i) which embryo to transfer, select, keep or discard; (ii) any ranking.
  {
    id: "selection.which-to-pick",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re(`\\b(which|what) (embryo|embryos|one|ones|of (them|these|those))\\b.*\\b(${EMBRYO_VERBS})\\b`),
  },
  {
    id: "selection.should-we-pick",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re(`\\b(should|shall|do|can|could|would) (we|i|you) (${EMBRYO_VERBS})\\b`),
  },
  {
    id: "selection.superlative",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re(`\\b(${SUPERLATIVES}) (embryo|embryos|one|ones|option|choice)\\b`),
  },
  {
    id: "selection.which-is-best",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re(`\\b(which|what) (embryo|one) (is|has|looks|seems|would be) (the )?(${SUPERLATIVES}|most|least)\\b`),
  },
  {
    id: "selection.ranking",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re("\\b(rank|ranks|ranked|ranking|order them|sort them|best to worst|from best|top to bottom)\\b"),
  },
  {
    id: "selection.versus",
    intent: "selection-advice",
    pattern: re("\\bembryo \\w+ (or|vs|versus) embryo \\w+\\b"),
  },
  {
    id: "selection.recommend",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re("\\b(recommend|recommendation|suggest|advise) (an |the |one |which |a )?(embryo|embryos|one)\\b"),
  },
  {
    id: "selection.disposition",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re(
      "\\b(what (should|do|can|could) we do with|discard|destroy|donate|dispose of|disposition|get rid of|throw away|keep or)\\b",
    ),
  },
  // The sex of an embryo, or a proxy for it.
  {
    id: "sex.embryo",
    intent: "sex-disclosure",
    embryoContext: true,
    pattern: re(`\\b(${SEX_WORDS})\\b`),
  },
  // A comparative about embryos is a ranking by another name; a sex question
  // that also compares keeps the sex refusal, which is why that rule sits first.
  {
    id: "selection.comparative",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re(`\\b(${COMPARATIVES})\\b`),
  },
  {
    id: "selection.which-of-them",
    intent: "selection-advice",
    embryoContext: true,
    pattern: re("\\bwhich (one|ones|of the two|of them|of these|of those)\\b"),
  },
  {
    id: "selection.compare-embryos",
    intent: "selection-advice",
    pattern: re(
      "\\bcompare (the |these |those |our |my )?embryos\\b|\\bcompare embryo \\w+ (to|with|and|against)\\b|\\bis embryo \\w+ (better|worse|healthier|stronger|weaker) than\\b",
    ),
  },
  // A trait prediction about one actual child (brief line 366). Inheritance
  // and carrier questions are Portrait's permitted outputs and stay allowed.
  {
    id: "portrait.singular-child",
    intent: "prohibited-portrait",
    pattern: re(
      `\\b(will|would|might|could|is going to|are going to|going to) (my|our|the|a) (${CHILD_WORDS}) (${CHILD_TRAIT_VERBS})\\b|\\b(is|are) (my|our|the|a) (${CHILD_WORDS}) going to (${CHILD_TRAIT_VERBS})\\b|\\b(my|our) (${CHILD_WORDS}) (will|would|is going to|are going to) (${CHILD_TRAIT_VERBS})\\b|\\bwhat will (my|our) (${CHILD_WORDS}) (look|be)\\b|\\bhow (tall|short|smart|clever|bright|big|strong|fast|pretty|beautiful|athletic|healthy) (will|would|might|could|is|are) (my|our|the|a) (${CHILD_WORDS})\\b`,
    ),
    unless: re("\\b(be|is|are|being) (a |an )?carriers?\\b|\\binherit(s|ed|ing)?\\b|\\bcarry\\b|\\bpass(es|ed|ing)? (it|this|that|them) (on|down)\\b"),
  },
  // Treatment, dose, supplement and diet advice.
  {
    id: "treatment.should-i-take",
    intent: "treatment",
    pattern: re(
      "\\b(should|shall|can|could|do|would|ought|must) (i|we) (take|start|stop|try|use|add|increase|reduce|cut|quit|switch|avoid|eat|drink|supplement|go on|come off|adjust|change|double|skip|exercise|be taking|be eating|be drinking|be avoiding|be using)\\b",
    ),
    // A bare verb whose object is the product ("add a second genome",
    // "switch to a local model") is a question about Inherit, not a body.
    unless: re(
      `\\b(should|shall|can|could|do|would|ought|must) (i|we) (take|start|stop|try|use|add|switch|change|remove|delete|upload|keep|download|adjust) (\\w+ ){0,3}(${PRODUCT_WORDS})\\b`,
    ),
  },
  {
    id: "treatment.do-i-need",
    intent: "treatment",
    pattern: re(
      `\\bdo (i|we) need (a|an|any|more|extra|some|to take|to start|to stop|to eat|to avoid|to cut|to supplement|${INTAKE_WORDS})\\b`,
    ),
  },
  {
    id: "treatment.what-should-i-take",
    intent: "treatment",
    pattern: re(
      "\\bwhat (should|can|could|do|shall|would) (i|we) (take|eat|drink|do about|do for|do with|use|try|avoid|cut|start|stop)\\b",
    ),
  },
  {
    id: "treatment.how-much",
    intent: "treatment",
    pattern: re(
      "\\bhow (much|many|often|long) (\\w+ ){0,3}(should|can|could|do|would) (i|we) (take|eat|drink|use|need|supplement)\\b",
    ),
  },
  {
    id: "treatment.dose",
    intent: "treatment",
    pattern: re(
      `\\b(dose|doses|dosage|dosages|dosing|mg|milligrams?|micrograms?|mcg|iu|international units)\\b|\\d+\\s*(${DOSE_UNITS})\\b`,
    ),
  },
  {
    id: "treatment.too-much",
    intent: "treatment",
    pattern: re(
      `\\b(am i|are we) (\\w+ )?too (much|little|many|few)\\b|^(?=.*\\b(${INTAKE_WORDS})\\b).*\\bis (this|that|it) too (much|little)\\b|\\btoo (much|little) (${INTAKE_WORDS})\\b|\\b(taking|eating|drinking|having) too (much|little|many|few)\\b`,
    ),
  },
  {
    id: "treatment.adjust-intake",
    intent: "treatment",
    pattern: re(
      `\\b(double|halve|half|triple|increase|decrease|lower|raise|up|reduce|cut) (my|our|the) (\\w+ )?(${INTAKE_WORDS}|intake)\\b`,
    ),
  },
  {
    id: "treatment.which-supplement",
    intent: "treatment",
    pattern: re(
      "\\bany (supplements?|vitamins?|medications?|medicines?|diets?) (recommendations?|suggestions?|i should|we should|you'd recommend|you would recommend|you recommend|you suggest|that would help|that helps?)\\b|\\bwhat (supplements?|vitamins?|medications?|medicines?|foods?|diets?) (should|can|could|would|do|might)\\b|\\bwhat supplements?\\b|\\bshould (i|we) be (taking|eating|drinking|avoiding|using)\\b",
    ),
  },
  {
    id: "treatment.recommend-intake",
    intent: "treatment",
    pattern: re(
      `\\b(recommend|suggest|prescribe|advise)\\b.*\\b(${INTAKE_WORDS})\\b|\\b(${INTAKE_WORDS})\\b.*\\b(recommend|suggest|prescribe|advise|should i|for me|help me|would help|to take|to help|to lower|to reduce|to fix|to improve|to boost|do i need)\\b`,
    ),
  },
  {
    id: "treatment.how-to-lower",
    intent: "treatment",
    pattern: re(
      "\\b(how|what) (do|can|should|could|would) (i|we) (treat|cure|fix|manage|prevent|lower|reduce|improve|boost|counter|offset|protect)\\b",
    ),
  },
  {
    id: "treatment.diet",
    intent: "treatment",
    pattern: re(`\\b(${DIET_WORDS})\\b.*\\b(should|best|help|follow|go|try|good|right|suit)\\b|\\b(should|best|help|follow|go|try|good|right|suit)\\b.*\\b(${DIET_WORDS})\\b`),
  },
  // Diagnosis. The file-fact exemption reaches only the object of "have":
  // "Do I have the lactase persistence variant?" is a lookup, "Do I have
  // haemochromatosis?" is not, whatever else the message says.
  {
    id: "diagnosis.do-i-have",
    intent: "diagnosis",
    pattern: re(`\\b(do|does|did) (${PERSONS}) (have|got|suffer from)\\b|\\bhave (${PERSONS}) got\\b`),
    unless: re(`\\b(do|does|did) (${PERSONS}) (have|got) ${FILE_FACT_OBJECT}|\\bhave (${PERSONS}) got ${FILE_FACT_OBJECT}`),
    unlessRaw: new RegExp(`\\b(do|does|did|Do|Does|Did) (${PERSONS}|I) (have|got) ${GENE_SYMBOL_OBJECT}`, "u"),
  },
  {
    id: "diagnosis.does-this-mean",
    intent: "diagnosis",
    pattern: re(`\\b(does|would|could) (this|that|it) mean (${PERSONS}) (have|has|got|am|is|are)\\b|\\b(if|whether) (${PERSONS}) (have|has|got|am|is|are)\\b`),
    unless: re(`\\b(mean|if|whether) (${PERSONS}) (have|has|got|am|is|are) ${FILE_FACT_OBJECT}`),
    unlessRaw: new RegExp(`\\b(mean|if|whether) (${PERSONS}|I) (have|has|got|am|is|are) ${GENE_SYMBOL_OBJECT}`, "u"),
  },
  {
    id: "diagnosis.file-says-i-have",
    intent: "diagnosis",
    pattern: re(
      `\\b(does|do|can|could|would) (my|the|this) (genome|file|files|report|reports|data|dna|results?|test|tests) (say|show|mean|prove|confirm|indicate|suggest|tell you) (that )?(${PERSONS}) (have|has|got|am|is|are)\\b`,
    ),
    unless: re(`\\b(say|show|mean|prove|confirm|indicate|suggest|tell you) (that )?(${PERSONS}) (have|has|got|am|is|are) ${FILE_FACT_OBJECT}`),
    unlessRaw: new RegExp(`\\b(say|show|mean|prove|confirm|indicate|suggest|tell you) (that )?(${PERSONS}|I) (have|has|got|am|is|are) ${GENE_SYMBOL_OBJECT}`, "u"),
  },
  {
    id: "diagnosis.so-i-have",
    intent: "diagnosis",
    pattern: re(`\\bso (${PERSONS}) (have|has|got|am|is|are)\\b`),
    unless: re(`\\bso (${PERSONS}) (have|has|got|am|is|are) ${FILE_FACT_OBJECT}`),
    unlessRaw: new RegExp(`\\b(so|So) (${PERSONS}|I) (have|has|got|am|is|are) ${GENE_SYMBOL_OBJECT}`, "u"),
  },
  {
    id: "diagnosis.am-i",
    intent: "diagnosis",
    pattern: re(
      `\\bam i (a |an )?(${SELF_STATE_WORDS}|${CONDITION_WORDS})\\b|\\b(so )?(i'm|i am) (a |an )?(${SELF_STATE_WORDS}) then\\b|\\bso (i'm|i am) (a |an )?(${SELF_STATE_WORDS}|${CONDITION_WORDS})\\b|\\b(does|would|could) (this|that|it) mean (i'm|i am) (a |an )?(${SELF_STATE_WORDS}|${CONDITION_WORDS})\\b`,
    ),
  },
  {
    id: "diagnosis.word",
    intent: "diagnosis",
    pattern: re("\\b(diagnose|diagnosis|diagnosed|diagnostic)\\b|\\bwhat('s| is) wrong with me\\b"),
  },
  {
    id: "diagnosis.is-it",
    intent: "diagnosis",
    pattern: re(`\\bis (it|this|that) (a |an )?(${CONDITION_WORDS})\\b`),
  },
  // Prognosis.
  {
    id: "prognosis.will-i",
    intent: "prognosis",
    pattern: re(
      `\\bwill (${PERSONS}) (ever |definitely |probably |likely |eventually |actually )?(get|develop|have|catch|die|go bald|go blind|go deaf|become|suffer|need|lose|end up|be ok|be okay|be fine|survive|live|make it)\\b`,
    ),
  },
  {
    id: "prognosis.going-to",
    intent: "prognosis",
    pattern: re(
      `\\b(am|are|is) (${PERSONS}) going to (get|develop|die|become|lose|go|have|end up|be)\\b`,
    ),
  },
  {
    id: "prognosis.how-long",
    intent: "prognosis",
    pattern: re(
      `\\bhow long (will|do|have) (${PERSONS}) (live|have|got)\\b|\\blife expectancy\\b|\\bwhen will (${PERSONS}) (get|develop|die|go|lose|start)\\b|\\bwhat will happen to (me|us|him|her|them|my \\w+)\\b`,
    ),
  },
  {
    id: "prognosis.word",
    intent: "prognosis",
    pattern: re("\\b(prognosis|prognoses)\\b|\\bwill (it|this) (kill|get worse|progress|spread|come back|shorten)\\b"),
  },
  // Cross-subject: a person or embryo outside the thread's scope.
  {
    id: "cross-subject.relative-data",
    intent: "cross-subject",
    pattern: re(`\\b(my|our) (${RELATIVES})('s|s'|s)? (\\w+ )?(${DATA_WORDS})\\b`),
    notScopes: ["family", "cohort"],
  },
  {
    id: "cross-subject.relative-data.family",
    intent: "cross-subject",
    pattern: re(`\\b(my|our) (?!(?:${PAIR_RELATIVES})\\b)(${RELATIVES})('s|s'|s)? (\\w+ )?(${DATA_WORDS})\\b`),
    scopes: ["family", "cohort"],
  },
  {
    id: "cross-subject.third-person-data",
    intent: "cross-subject",
    pattern: re(`\\b(his|her|someone else's|somebody else's|another person's|a friend's) (${DATA_WORDS})\\b`),
  },
  {
    id: "cross-subject.compare-with-relative",
    intent: "cross-subject",
    pattern: re(`\\b(compare|comparing|versus|vs|against) (\\w+ ){0,3}(my|our) (${RELATIVES})\\b`),
    notScopes: ["family", "cohort"],
  },
  {
    id: "cross-subject.embryo-outside-cohort",
    intent: "cross-subject",
    pattern: re(`\\bembryos?\\b.*\\b(${DATA_WORDS})\\b|\\b(${DATA_WORDS})\\b.*\\bembryos?\\b`),
    notScopes: ["cohort"],
  },
  {
    id: "cross-subject.own-file-in-another-thread",
    intent: "cross-subject",
    pattern: re("\\bmy own (file|files|dna|genome|result|results|report|reports|data)\\b"),
    scopes: ["subject", "family", "cohort", "report"],
  },
];

const EMBRYO_MENTION = /\bembryos?\b/u;

/**
 * Lowercase NFKC text with typographic apostrophes straightened, every other
 * punctuation mark turned into a space, and whitespace collapsed.
 */
export function normalizeMessage(message: string): string {
  return normalizeKeepingCase(message).toLowerCase();
}

/** `normalizeMessage` without the lowercasing, for the shapes only capitals reveal. */
function normalizeKeepingCase(message: string): string {
  return message
    .normalize("NFKC")
    .replace(/[’‘`]/gu, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/-/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function classifyIntent(message: string, scope: GuardScope): IntentVerdict {
  const raw = normalizeKeepingCase(message);
  const text = raw.toLowerCase();
  const embryoContext = scope.kind === "cohort" || EMBRYO_MENTION.test(text);
  for (const rule of INTENT_RULES) {
    if (rule.embryoContext && !embryoContext) continue;
    if (rule.scopes && !rule.scopes.includes(scope.kind)) continue;
    if (rule.notScopes && rule.notScopes.includes(scope.kind)) continue;
    if (!rule.pattern.test(text)) continue;
    if (rule.unless && rule.unless.test(text)) continue;
    if (rule.unlessRaw && rule.unlessRaw.test(raw)) continue;
    return { intent: rule.intent, rule: rule.id };
  }
  return { intent: "allowed", rule: null };
}

// ---------------------------------------------------------------------------
// Who may reach the chat route, and what the client may resend.
// ---------------------------------------------------------------------------

export type ChatSubjectClass = "self" | "other_adult" | "minor" | "embryo";

/**
 * The guard scope for a resolved subject, or null when no chat scope exists
 * for that class yet: a minor or an embryo answers 404 from the route until
 * its own scope ships, so no rule table is ever asked about them by accident.
 */
export function guardScopeKindFor(subjectClass: ChatSubjectClass): "self" | "subject" | null {
  if (subjectClass === "self") return "self";
  if (subjectClass === "other_adult") return "subject";
  return null;
}

/** The text of one user turn, as the classifier reads it. */
export function userTurnText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

/**
 * The history the model may see: every user turn is classified again, and a
 * gated one is dropped together with the assistant turn that answered it
 * (the refusal the client rendered), so a refused message never reaches the
 * model through a later request's resend of the thread.
 */
export function dropGatedTurns(messages: readonly UIMessage[], scope: GuardScope): UIMessage[] {
  const kept: UIMessage[] = [];
  let dropNextAssistant = false;
  for (const message of messages) {
    if (message.role === "user") {
      const gated = classifyIntent(userTurnText(message), scope).intent !== "allowed";
      dropNextAssistant = gated;
      if (gated) continue;
    } else if (message.role === "assistant" && dropNextAssistant) {
      dropNextAssistant = false;
      continue;
    }
    kept.push(message);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// The buffered stream, folded into the one string the output checks read.
// ---------------------------------------------------------------------------

export interface FoldedStream {
  /** Everything the model authored: text, reasoning, tool inputs, sources, provider-run tool outputs. */
  text: string;
  /** Every output an Inherit tool returned this turn: the permitted numbers and citations. */
  toolJson: unknown[];
}

/**
 * Nothing the model wrote reaches the client unchecked: a fabricated number
 * inside a reasoning part or a model-authored rsID inside a tool input is
 * held to the same tool JSON as the visible text. Outputs of Inherit's own
 * tools are the permitted set, not a claim, and are not folded in; an output
 * the provider executed itself is the model's and is.
 */
export function foldStreamChunks(chunks: readonly UIMessageChunk[]): FoldedStream {
  const parts: string[] = [];
  const streamingParts = new Map<string, number>();
  const partIndex = (kind: string, id: string): number => {
    const key = `${kind}:${id}`;
    let index = streamingParts.get(key);
    if (index === undefined) {
      index = parts.length;
      streamingParts.set(key, index);
      parts.push("");
    }
    return index;
  };
  const toolJson: unknown[] = [];
  for (const chunk of chunks) {
    switch (chunk.type) {
      case "text-start":
      case "reasoning-start":
        // UIMessage parts are inserted on start, not on their first delta.
        partIndex(chunk.type.replace("-start", ""), chunk.id);
        break;
      case "text-delta":
      case "reasoning-delta": {
        // The client appends deltas within one part without adding whitespace.
        // Inserting separators here splits words, citations and numeric tokens
        // and makes the checked answer differ from the answer being replayed.
        const index = partIndex(chunk.type.replace("-delta", ""), chunk.id);
        parts[index] += chunk.delta;
        break;
      }
      case "tool-input-available":
      case "tool-input-error":
        parts.push(JSON.stringify(chunk.input) ?? "");
        break;
      case "source-url":
        parts.push([chunk.title, chunk.url].filter(Boolean).join(" "));
        break;
      case "source-document":
        parts.push([chunk.title, chunk.filename].filter(Boolean).join(" "));
        break;
      case "file":
      case "reasoning-file":
        parts.push(chunk.url);
        break;
      case "tool-output-available":
        if (chunk.providerExecuted) parts.push(JSON.stringify(chunk.output) ?? "");
        else toolJson.push(chunk.output);
        break;
      default:
        break;
    }
  }
  return { text: parts.join("\n"), toolJson };
}

// ---------------------------------------------------------------------------
// The numeral check (brief line 2262).
// ---------------------------------------------------------------------------

export interface AllowedNumeralRange {
  id: string;
  min: number;
  max?: number;
  /** The range's upper bound comes from the scope, not the file. */
  maxFrom?: "cohortSize";
}

export interface AllowedNumerals {
  schemaVersion: number;
  ranges: readonly AllowedNumeralRange[];
}

export interface NumeralVerdict {
  ok: boolean;
  /** Every token that matched neither the tool JSON nor an allowed range. */
  unsupported: string[];
}

/** The brief's token pattern, verbatim, applied globally. */
const NUMERAL_PATTERN = /-?\d+(\.\d+)?%?/g;

export function numeralTokens(text: string): string[] {
  return text.match(NUMERAL_PATTERN) ?? [];
}

/**
 * Every number a tool returned this turn: numeric leaves as they are, plus
 * every numeral token inside a string leaf (an rsID such as `rs762551`, a
 * label such as `Hum Mol Genet 2011`), so a response may repeat what the
 * tools said and nothing more.
 */
export function toolJsonNumbers(toolJson: unknown): number[] {
  const found: number[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "number") {
      if (Number.isFinite(value)) found.push(value);
    } else if (typeof value === "string") {
      for (const token of numeralTokens(value)) found.push(Number(token.replace("%", "")));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(toolJson);
  return found;
}

/** Digits after the point in the token; none for an integer token. */
function decimalPlaces(token: string): number {
  const point = token.indexOf(".");
  return point === -1 ? 0 : token.replace("%", "").length - point - 1;
}

/** Round half away from zero to `places` decimals, matching how a person reads the token. */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  // The scaled epsilon lets a decimal that binary stores just under its
  // half (1.005 → 1.00499…) round the way a person reading it would.
  const rounded = Math.round(Math.abs(value) * factor * (1 + Number.EPSILON)) / factor;
  return value < 0 ? -rounded : rounded;
}

function matchesToolJson(token: string, values: readonly number[]): boolean {
  const target = Number(token.replace("%", ""));
  const places = decimalPlaces(token);
  return values.some((value) => roundTo(value, places) === target);
}

function matchesAllowedRange(
  token: string,
  allowed: AllowedNumerals,
  cohortSize: number | undefined,
): boolean {
  if (token.endsWith("%") || token.includes(".")) return false;
  const value = Number(token);
  return allowed.ranges.some((range) => {
    const max = range.maxFrom === "cohortSize" ? cohortSize : range.max;
    if (max === undefined) return false;
    return value >= range.min && value <= max;
  });
}

export function checkResponseNumerals(
  text: string,
  toolJson: unknown,
  allowed: AllowedNumerals,
  context: { cohortSize?: number } = {},
): NumeralVerdict {
  const values = toolJsonNumbers(toolJson);
  const unsupported = numeralTokens(text).filter(
    (token) => !matchesToolJson(token, values) && !matchesAllowedRange(token, allowed, context.cohortSize),
  );
  return { ok: unsupported.length === 0, unsupported };
}

// ---------------------------------------------------------------------------
// The citation check.
// ---------------------------------------------------------------------------

export interface PermittedCitations {
  pmids: Set<string>;
  dois: Set<string>;
  urls: Set<string>;
  /** Free-text labels such as "Sulem et al., Hum Mol Genet 2011". */
  labels: string[];
}

export interface CitationVerdict {
  ok: boolean;
  unsupported: string[];
}

const PMID_IN_TEXT = /\bpmid:?\s*(\d{4,9})\b/giu;
const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>)\]]+/giu;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)\]]+/giu;
/** "Sulem et al. (2011)", "Sulem et al., 2011" or a bare "Sulem et al." */
const AUTHOR_ET_AL_IN_TEXT = /\b(\p{Lu}[\p{L}'’-]+) et al\b\.?,?(?: \(?(\d{4})\)?)?/gu;
/** "a study by Smith", "the 2019 trial from Harvard". */
const STUDY_BY_IN_TEXT =
  /\b(?:[Aa]|[Aa]n|[Oo]ne|[Tt]he|[Aa]nother|[Tt]his|[Tt]hat|[Rr]ecent) (?:\d{4} )?(?:\w+ )?(?:study|studies|paper|papers|trial|trials|review|reviews|meta-analysis|analysis|report|survey|cohort) (?:by|from) ((?:\p{Lu}[\p{L}'’-]*(?: |$)){1,5})/gu;
/** "According to Nature Genetics", "published in The Lancet". The capitalised run is the name; "your report" starts none. */
const NAMED_SOURCE_IN_TEXT =
  /\b(?:[Aa]ccording to|[Pp]ublished in|[Rr]eported in|[Aa]s reported by|[Aa]s shown in|[Aa]s found by|[Aa]s described in) ((?:\p{Lu}[\p{L}'’-]*(?: |$)){1,6})/gu;
/** Product names that follow "according to" without citing anything. */
const PRODUCT_NAMES = new Set(["inherit", "portrait", "copilot", "overview", "family", "embryos", "medicines", "ancestry"]);

function trimCitationToken(value: string): string {
  return value.replace(/[.,;:]+$/u, "");
}

/** The whole tokens of a label, lowercased: `Sulem et al., Hum Mol Genet 2011` → sulem, et, al, hum, mol, genet, 2011. */
function labelTokens(label: string): Set<string> {
  return new Set(label.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

/** True when every word appears as a whole token of one permitted label. */
function labelsCarry(labels: readonly string[], words: readonly string[]): boolean {
  const needed = words.map((word) => word.toLowerCase()).filter(Boolean);
  if (needed.length === 0) return true;
  return labels.some((label) => {
    const tokens = labelTokens(label);
    return needed.every((word) => tokens.has(word));
  });
}

/** The capitalised words of a "study by" or "according to" run, without trailing product names. */
function sourceWords(run: string): string[] {
  return run
    .trim()
    .split(/\s+/u)
    .map((word) => word.replace(/[’']s$/u, "").replace(/[^\p{L}\p{N}'’-]/gu, ""))
    .filter((word) => word.length > 0 && !PRODUCT_NAMES.has(word.toLowerCase()));
}

/**
 * The citations the tools returned this turn: every object carrying `pmid`,
 * `doi`, `url` or `label` under a `citation` or `citations` key
 * (`report_templates.citations`, `prs_scores.citation`), plus every `title`
 * and `name` the tools carried, so an answer may name the report or score it
 * read from ("your Caffeine metabolism report") and nothing else.
 */
export function permittedCitationsFromToolJson(toolJson: unknown): PermittedCitations {
  const permitted: PermittedCitations = { pmids: new Set(), dois: new Set(), urls: new Set(), labels: [] };
  const fromText = (value: string) => {
    for (const doi of value.match(DOI_IN_TEXT) ?? []) permitted.dois.add(trimCitationToken(doi).toLowerCase());
    for (const url of value.match(URL_IN_TEXT) ?? []) permitted.urls.add(trimCitationToken(url).toLowerCase());
    for (const match of value.matchAll(PMID_IN_TEXT)) permitted.pmids.add(match[1]);
  };
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value === "string") {
      fromText(value);
      permitted.labels.push(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "pmid" && (typeof child === "string" || typeof child === "number")) permitted.pmids.add(String(child));
      else if (key === "doi" && typeof child === "string") permitted.dois.add(trimCitationToken(child).toLowerCase());
      else if (key === "url" && typeof child === "string") permitted.urls.add(trimCitationToken(child).toLowerCase());
      else if ((key === "label" || key === "title") && typeof child === "string") permitted.labels.push(child);
      else if (child && typeof child === "object") collect(child);
    }
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key === "citation" || key === "citations") collect(child);
        else if ((key === "title" || key === "name") && typeof child === "string") permitted.labels.push(child);
        else visit(child);
      }
    }
  };
  visit(toolJson);
  return permitted;
}

export function checkCitations(text: string, permitted: PermittedCitations): CitationVerdict {
  const unsupported: string[] = [];
  for (const match of text.matchAll(PMID_IN_TEXT)) {
    if (!permitted.pmids.has(match[1])) unsupported.push(match[0]);
  }
  for (const doi of text.match(DOI_IN_TEXT) ?? []) {
    if (!permitted.dois.has(trimCitationToken(doi).toLowerCase())) unsupported.push(doi);
  }
  for (const url of text.match(URL_IN_TEXT) ?? []) {
    if (!permitted.urls.has(trimCitationToken(url).toLowerCase())) unsupported.push(url);
  }
  for (const match of text.matchAll(AUTHOR_ET_AL_IN_TEXT)) {
    const words = match[2] ? [match[1], match[2]] : [match[1]];
    if (!labelsCarry(permitted.labels, words)) unsupported.push(match[0].trim());
  }
  for (const pattern of [STUDY_BY_IN_TEXT, NAMED_SOURCE_IN_TEXT]) {
    for (const match of text.matchAll(pattern)) {
      const words = sourceWords(match[1]);
      if (words.length === 0) continue;
      if (!labelsCarry(permitted.labels, words)) unsupported.push(match[0].trim());
    }
  }
  return { ok: unsupported.length === 0, unsupported };
}

// ---------------------------------------------------------------------------
// The output check the route runs on a finished model answer.
// ---------------------------------------------------------------------------

export type OutputViolation = GatedIntent | "unsupported-number" | "unsupported-citation";

/**
 * Output assertions differ from input questions. A refusal may explain that
 * the file cannot diagnose disease; an affirmative (including a negative
 * diagnosis) or a directive is not made safe by appending that disclaimer.
 * These deterministic rules are regression-tested defenses, not a claim to
 * recognize every possible paraphrase of natural language.
 */
export function checkResponsePolicy(text: string, scope: CopilotScopeKind = "self"): IntentVerdict {
  const normalized = text.normalize("NFKC").replace(/\p{Cf}/gu, "");
  const embryoContext = scope === "cohort" || /\bembryos?\b/iu.test(normalized);
  const outputProductWords = `${PRODUCT_WORDS}|results?|sources?|links?|filters?|pages?|sections?`;
  const person = `(?:you|your (?:${RELATIVES}))`;
  const action = "take|taking|start|starting|stop|stopping|try|use|using|add|increase|reduce|cut|quit|switch|avoid|eat|drink|supplement|adjust|change|double|skip|exercise|follow";
  const factObject = new RegExp(`^(?:(?:${DETERMINERS}) )?(?:(?!(?:and|but|or|because|so|yet)\\b)${QUALIFIER}){0,2}(?:${FILE_FACT_WORDS})\\b`, "u");
  const productObject = new RegExp(`^(?:(?:to|from|a|an|the|this|that|your|my|our) )?(?:(?!(?:and|but|or|because|so|yet)\\b)\\w+ ){0,2}(?:${outputProductWords})\\b`, "u");
  const clinicalConversation = /^(?:speaking|talking|asking|consulting|seeing|contacting|discussing|speak|talk|ask|consult|see|contact|discuss)\b(?:(?!\b(?:and|but|then)\b).)*\b(?:doctor|clinician|counsellor|counselor|clinical team)\b/u;
  const productTreatmentPurpose = /\b(?:to|for) (?:choos(?:e|ing)|adjust(?:ing)?|chang(?:e|ing)|select(?:ing)?|start(?:ing)?|stop(?:ping)?) (?:your |a |the )?(?:treatment|medication|medicine|dose|dosage|diet|supplements?)\b/u;
  const safeFrame = /\b(?:(?:cannot|can't|can not|does not|doesn't|do not|don't|will not|won't) (?:tell|say|show|prove|confirm|predict|establish|mean|determine)(?: you)?(?: that| whether| if)?|not (?:evidence|proof|a claim|a prediction) that) $/u;
  const rules: Array<{ id: string; intent: GatedIntent; pattern: RegExp; object?: "fact" | "product" }> = [
    { id: "output.diagnosis.have", intent: "diagnosis", pattern: new RegExp(`\\b${person} (?:definitely |certainly |already |clearly )?(?:(?:do|does) not |don't |doesn't )?(?:have|has|have got|suffer from|are suffering from) `, "gu"), object: "fact" },
    { id: "output.diagnosis.state", intent: "diagnosis", pattern: new RegExp(`\\b${person} (?:are|is|aren't|isn't|are not|is not) (?:definitely |certainly |clearly )?(?:a |an )?(?:${SELF_STATE_WORDS}|${CONDITION_WORDS})\\b`, "gu") },
    { id: "output.diagnosis.confirmed", intent: "diagnosis", pattern: new RegExp(`\\b(?:${CONDITION_WORDS}) (?:is|has been) (?:confirmed|ruled out|present|absent)\\b|\\b(?:i|we) (?:diagnose|have diagnosed)\\b`, "gu") },
    { id: "output.prognosis", intent: "prognosis", pattern: new RegExp(`\\b${person} (?:will|won't|will not|are going to|are not going to|is going to) (?:definitely |certainly |eventually |never )?(?:get|develop|have|die|survive|live|become|lose|suffer|need) `, "gu"), object: "fact" },
    { id: "output.prognosis.assurance", intent: "prognosis", pattern: /\byou (?:are|will be) (?:protected|safe|immune) from\b|\byour life expectancy is\b/gu },
    { id: "output.treatment.directive", intent: "treatment", pattern: new RegExp(`(?:^|\\b(?:then|and|so) )(?:(?:please|do not|don't) )?(?:${action}) |\\byou (?:should|shouldn't|must|mustn't|need to|ought to|can|could|would benefit from)(?: not)? (?:${action}|be taking|be eating|be drinking|be avoiding|be using) `, "gu"), object: "product" },
    { id: "output.treatment.recommendation", intent: "treatment", pattern: /\b(?:i|we) (?:recommend|suggest|advise|prescribe) (?:that you )?/gu, object: "product" },
    { id: "output.treatment.dose", intent: "treatment", pattern: /\byour (?:dose|dosage|treatment|diet) (?:is|should be|needs to be)\b/gu },
  ];
  if (embryoContext) rules.unshift(
    { id: "output.selection.directive", intent: "selection-advice", pattern: new RegExp(`(?:^|\\b(?:then|and|so) )(?:please )?(?:${EMBRYO_VERBS}) (?:the |your |an? |this |that )?(?:(?:first|second|third|next) )?embryo\\b|\\b(?:i|we) (?:recommend|prefer|would choose|would pick)\\b|\\b(?:you|we) should (?:${EMBRYO_VERBS})\\b`, "gu") },
    { id: "output.selection.comparative", intent: "selection-advice", pattern: new RegExp(`\\b(?:is|are|looks|seems|would be) (?:the )?(?:${COMPARATIVES})\\b|\\b(?:${COMPARATIVES}) (?:embryo|choice|option)\\b|\\b(?:i|we) (?:rank|ranked|have ranked)\\b`, "gu") },
    { id: "output.sex", intent: "sex-disclosure", pattern: new RegExp(`\\b(?:embryo(?: \\w+){0,2}|it|this one|that one) (?:is|has|will be) (?:a |an )?(?:${SEX_WORDS})\\b|\\b(?:sex|gender) (?:of (?:this |the )?embryo(?: \\w+)? )?is (?:${SEX_WORDS})\\b`, "gu") },
  );
  rules.push({ id: "output.portrait", intent: "prohibited-portrait", pattern: new RegExp(`\\byour (?:${CHILD_WORDS}) (?:will|is going to) (?:be|have|become|look|grow)\\b`, "gu") });
  if (scope === "self" || scope === "subject" || scope === "report") {
    rules.push({ id: "output.cross-subject", intent: "cross-subject", pattern: new RegExp(`\\byour (?:${RELATIVES})(?:'s|s')? (?:${DATA_WORDS}) (?:is|are|shows?|says?|contains?|means?)\\b`, "gu") });
  }
  for (const sentence of normalized.split(/(?:[.!?;]\s+|\n+)/u)) {
    const plain = normalizeMessage(sentence).replace(/\byou're\b/gu, "you are");
    for (const rule of rules) {
      for (const match of plain.matchAll(rule.pattern)) {
        if (safeFrame.test(plain.slice(0, match.index))) continue;
        const object = plain.slice(match.index + match[0].length);
        if (rule.id === "output.selection.directive" && clinicalConversation.test(object.trim())) continue;
        if (rule.object === "fact" && (factObject.test(object) || /^(?:(?:a|an|the|any|some|more|further) )?(?:questions?|options?|access|control|time|choice|choices|response|responses)\b/u.test(object))) continue;
        if (rule.object === "product" && (
          (productObject.test(object) && !productTreatmentPurpose.test(object))
          || /^(?:a look|your time|note)\b/u.test(object)
          || clinicalConversation.test(object)
        )) continue;
        return { intent: rule.intent, rule: rule.id };
      }
    }
  }
  return { intent: "allowed", rule: null };
}

export type OutputVerdict =
  | { ok: true }
  | { ok: false; violation: OutputViolation; unsupported: string[] };

export function checkResponse(
  text: string,
  toolJson: unknown,
  allowed: AllowedNumerals,
  context: { cohortSize?: number; scope?: CopilotScopeKind } = {},
): OutputVerdict {
  const policy = checkResponsePolicy(text, context.scope);
  if (policy.intent !== "allowed") return { ok: false, violation: policy.intent, unsupported: [policy.rule!] };
  const numerals = checkResponseNumerals(text, toolJson, allowed, context);
  if (!numerals.ok) return { ok: false, violation: "unsupported-number", unsupported: numerals.unsupported };
  const citations = checkCitations(text, permittedCitationsFromToolJson(toolJson));
  if (!citations.ok) return { ok: false, violation: "unsupported-citation", unsupported: citations.unsupported };
  return { ok: true };
}
