/**
 * The reproducible half of prohibited-answer detection (G3.3).
 *
 * The rubric and a blind grader are the other half. This one exists so that at
 * least one detection path runs without a model in the loop: the same code
 * grades a simulated run and a human round, and its own worked examples in
 * `prohibited-patterns.json` are executed as fixtures by `bindings.test.ts`,
 * so a pattern that stops matching the answer it was written for fails CI
 * rather than quietly passing everything.
 *
 * A miss here is not an acquittal. A grader who reads a prohibited answer this
 * file does not match still fails it, and the answer is added to the list.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface ProhibitedClass {
  id: string;
  definition: string;
  patterns?: string[];
  relativePatterns?: string[];
  absolutePatterns?: string[];
  notProhibited?: string[];
  prohibitedExamples?: string[];
}

export interface PatternFile {
  schemaVersion: number;
  rule: string;
  matching: { appliesTo: string; flags: string; engine: string };
  classes: ProhibitedClass[];
}

export function loadPatterns(root = path.join(HERE, "..", "..")): PatternFile {
  return JSON.parse(
    readFileSync(path.join(root, "scripts/comprehension/prohibited-patterns.json"), "utf8"),
  ) as PatternFile;
}

/** Exactly the normalisation the pattern file declares, and nothing else. */
export function normalise(answer: string): string {
  return answer.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

const compiled = new Map<string, RegExp>();
function regex(pattern: string): RegExp {
  let value = compiled.get(pattern);
  if (!value) {
    value = new RegExp(pattern, "i");
    compiled.set(pattern, value);
  }
  return value;
}

/**
 * The pattern that fired, or null. T7 is the two-step case: it is defined by
 * an absence, so a relative expression alone is the hit and any absolute
 * expression clears it.
 */
export function prohibitedHit(klass: ProhibitedClass, answer: string): string | null {
  const text = normalise(answer);
  if (klass.relativePatterns) {
    if (klass.absolutePatterns?.some((p) => regex(p).test(text))) return null;
    return klass.relativePatterns.find((p) => regex(p).test(text)) ?? null;
  }
  return (klass.patterns ?? []).find((p) => regex(p).test(text)) ?? null;
}
