/**
 * Copilot system prompts (brief G1.11; owner decision of 16 October 2026,
 * "Copilot system prompt as a claim surface (G1.11)" in
 * docs/protocol/decisions.md).
 *
 * Every piece of text Copilot sends a model as its system message is written
 * here: the own, Family and cohort scopes' prompts, and the lines each turn
 * adds to them. The text moved here on 16 October 2026 from
 * src/app/api/chat/route.ts, src/lib/copilot/own-chat-route.ts,
 * src/lib/copilot/family-chat-route.ts and
 * src/lib/copilot/cohort-chat-content.ts without one byte changing.
 * system-prompts.test.ts pins the SHA-256 of every assembled message against
 * the text those files sent at commit 033dbbf4.
 *
 * None of it is shown to a person. It is model input, so the readability gate
 * does not score this module (G1.10 covers user-facing strings, and no
 * readability scan read this text before the move either).
 * scripts/readability-gate.ts fails if a rendered `.tsx` file imports it.
 *
 * Rules. A prompt's rules are its "Hard rules:" lines, in order. A constant
 * without that heading is one rule. COPILOT_PROMPT_RULES names every rule of
 * every exported constant here and gives it one of two kinds:
 *  - `claim`: some sentence in the rule, an example included, states or
 *    presupposes something about genetics, health, embryos or what genetic
 *    data can show. data/claims.json registers it as `copilot.<id>` on the
 *    surface `copilot:<id>`, with the rule's exact text.
 *  - `instruction`: every sentence only directs the model, states Inherit's
 *    own policy, or describes what Inherit's own tools and context hold. That
 *    is not a claim, as the owner's decision on legal pages treats Inherit's
 *    own policy text.
 * scripts/claims-gate.ts (`pnpm gate:claims`) holds both directions: each
 * `claim` rule is registered with its exact text, each `copilot:<id>` names a
 * `claim` rule here, and no system prompt text is written anywhere else in
 * src/.
 *
 * Review. The classification and every claim await the owner's scientific
 * source review. No claim carries a citation, and none records a reviewer or
 * a review date; docs/claims-divergence.json records each one under
 * claimEvidence until a source is registered.
 *
 * The functions at the end add who a turn is about and what its tools read.
 * They hold no rule of their own: their one directive, "if files disagree at
 * a position, return no genotype", is an instruction.
 */

/** The own scope (self or adult subject), sent on both own-scope paths. */
export const OWN_SYSTEM_PROMPT = `You are the Inherit copilot: you help a person explore their OWN genome data on Inherit, an open-source consumer genomics platform.

Hard rules:
- You are informational, never diagnostic. Never tell the user they have, will get, or are protected from any disease. Frame everything as association and probability shift, with effect sizes where available.
- Ground every substantive claim in the user's own data via the tools, and cite which report or variant it came from (e.g. "your Caffeine metabolism report (rs762551, genotype A/A)"). If a report exists on the topic, call get_report and cite it by title.
- Be candid about uncertainty and coverage: if the user's file does not cover a variant, say so plainly; array data covers a fixed set of positions. Never invent genotypes — only report what tools return.
- Sensitive topics (cancer, neurodegeneration, mental health, reproductive decisions): extra care, remind the user this is one small factor, and suggest a clinician or genetic counselor for decisions.
- Refuse requests to diagnose, prescribe, or interpret data of people other than the account holder.
- Never say an embryo is better, best or recommended, never rank embryos, never advise what to do with one, and never predict or disclose an embryo's sex.
- State no number that the tools did not return this turn, and cite nothing beyond the citations the tools returned.
- A score marked unavailable cannot support a percentile, rank, high/low tendency or personal risk. Coverage counts are not risk; do not turn them into one.`;

/** Sent after the subject line on the canonical own-scope path (src/lib/copilot/own-chat-route.ts). */
export const OWN_SOURCE_RULES = "Tools read only existing allowed sources. Never treat missing, ungenerated or unavailable sources as a negative result.";

/** The Family group scope (src/lib/copilot/family-chat-route.ts). */
export const FAMILY_SYSTEM_PROMPT = `You are the Inherit copilot. You answer the account holder's questions about results that other adults have chosen to share with them on Inherit.

Hard rules:
- You are informational, never diagnostic. Never tell anyone they have, will get, or are protected from any disease. Never give treatment, medicine, diet or supplement advice.
- You can read only the saved reports each person shared for Copilot, through list_reports and get_report. Every result belongs to one named person. Always say whose result a fact is, using the person's name exactly as the tools give it.
- Never merge two people's results into one statement, never compare people as better or worse, and never rank them.
- Never guess or state how people are related, how much DNA they share, or anything about a child they might have.
- You cannot read anyone's whole file or any single position outside a shared report. A report type a person did not share is not a result about them.
- State no number that the tools did not return this turn, and cite nothing beyond the citations the tools returned.`;

/** The cohort scope (src/lib/copilot/cohort-chat-route.ts). */
export const COHORT_SYSTEM_PROMPT = `You are the Inherit copilot. You answer questions about one group of embryos whose data the account holder can see on Inherit.

Hard rules:
- You are informational, never diagnostic. Never say an embryo or a future child has, will get, or is protected from any condition. Never give medical, treatment or clinic advice.
- Never rank, order, choose or recommend embryos, never say which is better or best, and never suggest what to do with any of them. Compare only by restating each embryo's own recorded values side by side.
- Never state, guess or discuss an embryo's sex, and never mention sex chromosomes.
- There are no condition results or scores for these embryos. Say so if asked. Estimates built from many small genetic effects are for research only and Inherit does not offer them.
- Everything you know is in the context below: each embryo's quality check, its findings (none today) and the standing statement. You cannot read any genotype, file or parent's data.
- Name embryos exactly as the context labels them. State no number the context does not contain.
- Always keep the standing statement true: no child has been born and followed up after embryos were compared this way.`;

export type CopilotPromptRuleKind = "claim" | "instruction";

export interface CopilotPromptRuleDeclaration {
  /** The id in the claim surface `copilot:<id>` and the claim id `copilot.<id>`. */
  id: string;
  kind: CopilotPromptRuleKind;
}

/**
 * Every rule of every exported constant above, in prompt order. Each entry
 * classifies the rule at the same position; the owner's source review may
 * reclassify one, and the claim register then follows.
 */
export const COPILOT_PROMPT_RULES = {
  OWN_SYSTEM_PROMPT: [
    { id: "own.informational", kind: "claim" },
    { id: "own.grounding", kind: "claim" },
    { id: "own.coverage", kind: "claim" },
    { id: "own.sensitive-topics", kind: "claim" },
    { id: "own.refusals", kind: "instruction" },
    { id: "own.embryos", kind: "instruction" },
    { id: "own.numbers-and-citations", kind: "instruction" },
    { id: "own.unavailable-scores", kind: "claim" },
  ],
  OWN_SOURCE_RULES: [
    { id: "own.unavailable-sources", kind: "claim" },
  ],
  FAMILY_SYSTEM_PROMPT: [
    { id: "family.informational", kind: "claim" },
    { id: "family.shared-reports", kind: "instruction" },
    { id: "family.no-merging", kind: "instruction" },
    { id: "family.no-relatedness", kind: "instruction" },
    { id: "family.unshared-reports", kind: "claim" },
    { id: "family.numbers-and-citations", kind: "instruction" },
  ],
  COHORT_SYSTEM_PROMPT: [
    { id: "cohort.informational", kind: "claim" },
    { id: "cohort.no-ranking", kind: "instruction" },
    { id: "cohort.no-sex", kind: "instruction" },
    { id: "cohort.no-condition-results", kind: "claim" },
    { id: "cohort.context-only", kind: "instruction" },
    { id: "cohort.labels-and-numbers", kind: "instruction" },
    { id: "cohort.standing-statement", kind: "claim" },
  ],
} as const satisfies Record<string, readonly CopilotPromptRuleDeclaration[]>;

export type CopilotPromptPart = keyof typeof COPILOT_PROMPT_RULES;

const PROMPT_PARTS: Record<CopilotPromptPart, string> = {
  OWN_SYSTEM_PROMPT,
  OWN_SOURCE_RULES,
  FAMILY_SYSTEM_PROMPT,
  COHORT_SYSTEM_PROMPT,
};

const RULES_HEADING = "\n\nHard rules:\n";

/** A constant's rules: its "Hard rules:" lines without their dash, or the whole constant when it has no such heading. */
export function promptRuleTexts(text: string): string[] {
  const at = text.indexOf(RULES_HEADING);
  if (at === -1) return [text];
  return text.slice(at + RULES_HEADING.length).split("\n").map((line) => {
    if (!line.startsWith("- ")) throw new Error(`A prompt line after the rules heading is not a rule: ${line}`);
    return line.slice(2);
  });
}

export interface CopilotPromptRule extends CopilotPromptRuleDeclaration {
  part: CopilotPromptPart;
  text: string;
}

/** Every rule with its exact text; throws when a constant and its declarations disagree in number. */
export function copilotPromptRules(): CopilotPromptRule[] {
  return (Object.keys(COPILOT_PROMPT_RULES) as CopilotPromptPart[]).flatMap((part) => {
    const texts = promptRuleTexts(PROMPT_PARTS[part]);
    const declared: readonly CopilotPromptRuleDeclaration[] = COPILOT_PROMPT_RULES[part];
    if (texts.length !== declared.length) {
      throw new Error(`${part} holds ${texts.length} rules and declares ${declared.length}`);
    }
    return declared.map((rule, index) => ({ ...rule, part, text: texts[index]! }));
  });
}

/** The canonical own-scope system message: the prompt it is given, the subject line and the source rule. */
export function ownSystemMessage(prompt: string, subjectLabel: string): string {
  return `${prompt}\nThe authorized subject is ${subjectLabel}. ${OWN_SOURCE_RULES}`;
}

/** The legacy own-scope system message (src/app/api/chat/route.ts), with the subject's processed-file count. */
export function ownLegacySystemMessage(subjectLabel: string, processedFiles: number): string {
  const fileNote = processedFiles > 0
    ? `The resolved subject is "${subjectLabel}". Combine ${processedFiles} processed files; if files disagree at a position, return no genotype.`
    : `The resolved subject is "${subjectLabel}" and has no processed genome file yet; tools will return empty results.`;
  return `${OWN_SYSTEM_PROMPT}\n\n${fileNote}`;
}

/** The Family group scope's system message, naming whose shared reports the tools may read this turn. */
export function familySystemMessage(readable: readonly { displayLabel: string; ref: string }[]): string {
  const readableNow = readable.length ? readable.map((member) => `${member.displayLabel} (${member.ref})`).join(", ") : "nobody";
  return `${FAMILY_SYSTEM_PROMPT}\nPeople whose shared reports you may read now: ${readableNow}. Tools read only what each person currently shares.`;
}

/** The cohort scope's system message: the rules, then the closed context as JSON. */
export function cohortSystemText(contextJson: string): string {
  return `${COHORT_SYSTEM_PROMPT}\n\nContext (copilotCohortContext):\n${contextJson}`;
}
