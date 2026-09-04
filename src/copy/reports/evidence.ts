/**
 * Evidence labels and their plain definitions (brief X5.3, §4 §8.1).
 * The five public labels are defined once, in src/lib/genome/taxonomy.ts;
 * this module re-exports them and adds the ≤20-word definition each chip
 * renders inline. Definitions are user copy: plain English, grade ≤ 9.
 */
import { EVIDENCE_PUBLIC_LABELS, type EvidenceLevel, type FindingLayer } from "@/lib/genome/taxonomy";

export { EVIDENCE_PUBLIC_LABELS };

export const EVIDENCE_DEFINITIONS: Record<EvidenceLevel, string> = {
  clinical:
    "The kind of result a clinic would act on, checked against a clinical classification.",
  established:
    "Seen in more than one study and checked by comparing brothers and sisters.",
  emerging:
    "Seen in more than one study, but not yet checked by comparing brothers and sisters.",
  preliminary: "Seen in only one study, or in studies that do not yet agree.",
  insufficient: "Not enough evidence to publish. Inherit does not ship reports at this level.",
};

export function evidenceLabel(level: EvidenceLevel): string {
  return EVIDENCE_PUBLIC_LABELS[level];
}

export function evidenceDefinition(level: EvidenceLevel): string {
  return EVIDENCE_DEFINITIONS[level];
}

/**
 * The definition a `variant_call` report's chip renders. The five levels
 * describe replication and sibling checks, which say nothing true about a
 * reading of letters at one position a guideline names (every variant_call
 * template today is a Medicines position, ADR 0021); the chip says what the
 * evidence is instead.
 */
export const VARIANT_CALL_EVIDENCE_DEFINITION =
  "This position is named by a published prescribing guideline. Inherit reads the letters only.";

export function evidenceDefinitionFor(level: EvidenceLevel, layer: FindingLayer): string {
  return layer === "variant_call" ? VARIANT_CALL_EVIDENCE_DEFINITION : EVIDENCE_DEFINITIONS[level];
}

/** The levels that carry the confirmation block (X5.3: clinical and established). */
export const CONFIRMATION_LEVELS: ReadonlySet<EvidenceLevel> = new Set<EvidenceLevel>([
  "clinical",
  "established",
]);
