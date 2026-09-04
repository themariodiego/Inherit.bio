/**
 * Copilot refusals (brief lines 402, 1036, 1038, 2262; §6.4). One string per
 * gated intent and one per output check, served by `src/lib/copilot/guard.ts`
 * as the whole assistant turn: no model is called for a gated intent, and a
 * model answer that fails the numeral or citation check is replaced with the
 * matching string here, never partly redacted.
 *
 * House rules: typographic apostrophes (U+2019), sentence case, second
 * person, grade ≤ 9, no sentence over 25 words. Each string says what
 * Inherit does not do and, where it is true, what it does instead. Strings
 * the brief quotes ship character-for-character; the three it quotes with a
 * straight apostrophe are spelled here with the typographic one every other
 * registry string uses.
 *
 * The §6.4 blocklist rows (`we recommend you take`, `dosage`, `supplement`)
 * apply outside a refusal string; scripts/validate-templates.ts scans only
 * template prose, so a refusal may name what it refuses.
 */
import type { GatedIntent, OutputViolation } from "@/lib/copilot/guard";

export type RefusalId = GatedIntent | OutputViolation;

/** Treatment, dose, supplement or diet advice (brief line 1036, verbatim). */
export const REFUSAL_TREATMENT =
  "I can’t tell you what to take or what to do about this. I can explain what your file says and what it doesn’t. For advice about your health, speak to a doctor or a genetic counsellor.";

/** A request to say whether the person has a condition. */
export const REFUSAL_DIAGNOSIS =
  "I can’t tell you whether you have a condition. Your file shows links between DNA and health across many people, not a diagnosis. I can explain what your reports say. A doctor can tell you what they mean for you.";

/** A request to say what will happen to the person’s health. */
export const REFUSAL_PROGNOSIS =
  "I can’t tell you what will happen to your health. Your file shows chances across many people, not a forecast for one person. I can explain what any result means.";

/** Which embryo to choose, keep, discard or rank (brief line 402, verbatim). */
export const REFUSAL_SELECTION_ADVICE =
  "Inherit does not recommend which embryo to choose. That decision belongs to you and your clinical team. I can explain what any number on this page means.";

/** The sex of an embryo, or a proxy for it. */
export const REFUSAL_SEX_DISCLOSURE =
  "Inherit does not predict or reveal the sex of an embryo, and I won’t guess at it. I can explain what any result on this page means.";

/** A prediction about one actual child (brief line 366; §5.6). */
export const REFUSAL_PROHIBITED_PORTRAIT =
  "Inherit can’t say what any one child will be like. Portrait shows chances across many possible children, never a result about one child. I can explain what a range on that page means.";

/** A question about a person or embryo outside this thread’s scope (brief line 1038). */
export function crossSubjectRefusal(subject: string): string {
  return `This thread is about ${subject}. Start a new thread to ask about a different file.`;
}

/** A model answer carrying a number absent from that turn’s tool results (brief line 2262). */
export const REFUSAL_UNSUPPORTED_NUMBER =
  "I can’t answer that from your data without guessing, so I won’t.";

/** A model answer citing a source outside the report and score citations Inherit holds. */
export const REFUSAL_UNSUPPORTED_CITATION =
  "I can’t point to a source Inherit holds for that, so I won’t say it. I can explain what your reports say and which studies they rest on.";

/** The refusal served for one id; `subject` fills the cross-subject slot. */
export function refusalFor(id: RefusalId, subject: string): string {
  switch (id) {
    case "treatment":
      return REFUSAL_TREATMENT;
    case "diagnosis":
      return REFUSAL_DIAGNOSIS;
    case "prognosis":
      return REFUSAL_PROGNOSIS;
    case "selection-advice":
      return REFUSAL_SELECTION_ADVICE;
    case "sex-disclosure":
      return REFUSAL_SEX_DISCLOSURE;
    case "prohibited-portrait":
      return REFUSAL_PROHIBITED_PORTRAIT;
    case "cross-subject":
      return crossSubjectRefusal(subject);
    case "unsupported-number":
      return REFUSAL_UNSUPPORTED_NUMBER;
    case "unsupported-citation":
      return REFUSAL_UNSUPPORTED_CITATION;
  }
}

/** Every refusal id, in guard priority order, for the tests and the register. */
export const REFUSAL_IDS: readonly RefusalId[] = [
  "selection-advice",
  "sex-disclosure",
  "prohibited-portrait",
  "treatment",
  "diagnosis",
  "prognosis",
  "cross-subject",
  "unsupported-number",
  "unsupported-citation",
];
