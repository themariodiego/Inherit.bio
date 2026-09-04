/**
 * The Copilot guard (brief line 2262; §5.7 line 366, §6.4 line 402; register
 * `copilot-intent-gate-v1` and `copilot-output-guard-v1`).
 *
 * Three deterministic checks and no model call anywhere:
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
 * 3. `checkCitations` holds every PMID, DOI, URL and "Author et al. YEAR"
 *    mention to the citations the tools returned that turn
 *    (`report_templates.citations`, `prs_scores.citation`).
 *
 * A failing response is replaced whole; nothing is redacted in place.
 */

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

/** A "do I have …" that names a file fact is a lookup, not a diagnosis. */
const FILE_FACT_WORDS =
  "variant|variants|gene|genes|allele|alleles|marker|markers|genotype|genotypes|mutation|mutations|copy|copies|snp|snps|file|files|report|reports|result|results|data|version|versions|coverage|carrier|score|scores|reads?";

const CONDITION_WORDS =
  "cancer|tumou?r|diabetes|alzheimer'?s|parkinson'?s|huntington'?s|dementia|arthritis|asthma|coeliac|celiac|ha?emochromatosis|thalassa?emia|ana?emia|autism|adhd|depression|schizophrenia|bipolar|infection|disease|disorder|syndrome|condition|illness";

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
  // A prediction about one actual child (brief line 366).
  {
    id: "portrait.singular-child",
    intent: "prohibited-portrait",
    pattern: re(
      `\\b(will|would|might|could|is going to|are going to|going to) (my|our|the|a) (${CHILD_WORDS})\\b|\\b(is|are) (my|our|the|a) (${CHILD_WORDS}) going to\\b|\\b(my|our) (${CHILD_WORDS}) (will|would|is going to)\\b|\\bwhat will (my|our) (${CHILD_WORDS})\\b`,
    ),
  },
  // Treatment, dose, supplement and diet advice.
  {
    id: "treatment.should-i-take",
    intent: "treatment",
    pattern: re(
      "\\b(should|shall|can|could|do|would|ought|must) (i|we) (take|start|stop|try|use|add|increase|reduce|cut|quit|switch|avoid|eat|drink|supplement|go on|come off|adjust|change|double|skip|exercise)\\b",
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
    pattern: re("\\b(dose|doses|dosage|dosages|dosing|mg|milligrams?|micrograms?|mcg|iu|international units)\\b"),
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
  // Diagnosis.
  {
    id: "diagnosis.do-i-have",
    intent: "diagnosis",
    pattern: re(`\\b(do|does|did) (${PERSONS}) (have|got|suffer from)\\b|\\bhave (${PERSONS}) got\\b`),
    unless: re(`\\b(${FILE_FACT_WORDS})\\b`),
  },
  {
    id: "diagnosis.does-this-mean",
    intent: "diagnosis",
    pattern: re(`\\b(does|would|could) (this|that|it) mean (${PERSONS}) (have|has|got|am|is|are)\\b|\\b(if|whether) (${PERSONS}) (have|has|got|am|is|are)\\b`),
    unless: re(`\\b(${FILE_FACT_WORDS})\\b`),
  },
  {
    id: "diagnosis.am-i",
    intent: "diagnosis",
    pattern: re(
      "\\bam i (sick|ill|unwell|diabetic|ana?emic|coeliac|celiac|lactose intolerant|autistic|depressed|infertile|allergic to)\\b",
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
    pattern: re(`\\bis (it|this) (a |an )?(${CONDITION_WORDS})\\b`),
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
    pattern: re(`\\b(my|our) (${RELATIVES})('s|s'|s)? (${DATA_WORDS})\\b`),
    notScopes: ["family", "cohort"],
  },
  {
    id: "cross-subject.relative-data.family",
    intent: "cross-subject",
    pattern: re(`\\b(my|our) (?!(?:${PAIR_RELATIVES})\\b)(${RELATIVES})('s|s'|s)? (${DATA_WORDS})\\b`),
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
  return message
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/gu, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/-/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function classifyIntent(message: string, scope: GuardScope): IntentVerdict {
  const text = normalizeMessage(message);
  const embryoContext = scope.kind === "cohort" || EMBRYO_MENTION.test(text);
  for (const rule of INTENT_RULES) {
    if (rule.embryoContext && !embryoContext) continue;
    if (rule.scopes && !rule.scopes.includes(scope.kind)) continue;
    if (rule.notScopes && rule.notScopes.includes(scope.kind)) continue;
    if (!rule.pattern.test(text)) continue;
    if (rule.unless && rule.unless.test(text)) continue;
    return { intent: rule.intent, rule: rule.id };
  }
  return { intent: "allowed", rule: null };
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
const AUTHOR_YEAR_IN_TEXT = /\b(\p{Lu}[\p{L}'’-]+) et al\.?,? \(?(\d{4})\)?/gu;

function trimCitationToken(value: string): string {
  return value.replace(/[.,;:]+$/u, "");
}

/**
 * The citations the tools returned this turn: every object carrying `pmid`,
 * `doi`, `url` or `label` under a `citation` or `citations` key
 * (`report_templates.citations`, `prs_scores.citation`).
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
  for (const match of text.matchAll(AUTHOR_YEAR_IN_TEXT)) {
    const surname = match[1].toLowerCase();
    const year = match[2];
    const known = permitted.labels.some((label) => {
      const lower = label.toLowerCase();
      return lower.includes(surname) && lower.includes(year);
    });
    if (!known) unsupported.push(match[0]);
  }
  return { ok: unsupported.length === 0, unsupported };
}

// ---------------------------------------------------------------------------
// The output check the route runs on a finished model answer.
// ---------------------------------------------------------------------------

export type OutputViolation = "unsupported-number" | "unsupported-citation";

export type OutputVerdict =
  | { ok: true }
  | { ok: false; violation: OutputViolation; unsupported: string[] };

export function checkResponse(
  text: string,
  toolJson: unknown,
  allowed: AllowedNumerals,
  context: { cohortSize?: number } = {},
): OutputVerdict {
  const numerals = checkResponseNumerals(text, toolJson, allowed, context);
  if (!numerals.ok) return { ok: false, violation: "unsupported-number", unsupported: numerals.unsupported };
  const citations = checkCitations(text, permittedCitationsFromToolJson(toolJson));
  if (!citations.ok) return { ok: false, violation: "unsupported-citation", unsupported: citations.unsupported };
  return { ok: true };
}
