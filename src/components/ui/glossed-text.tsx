"use client";

import * as React from "react";

import { glossaryEntries } from "@/copy/glossary";
import { GlossaryTerm } from "@/components/ui/glossary-term";

/**
 * A copy string with its technical terms glossed on first use.
 *
 * This exists because of how the product is built, not as a convenience. Brief
 * line 2452 requires that "every user-visible string is exported from
 * `src/copy/**`", so the text a reader sees arrives as an opaque sentence, and
 * a gloss has to wrap a span INSIDE that sentence. Hand-wrapping would mean
 * breaking every copy constant into fragments, which would defeat the rule
 * that made the copy reviewable in one place.
 *
 * Line 829 says the gloss "shows inline **on first use**", and that phrase is
 * the design: first use is something a renderer can find and a copy author
 * cannot, because whether a term has already appeared depends on what else is
 * on the page. So the splitting happens here, once, against the same register
 * the readability gate scores with.
 *
 * ONLY THE FIRST OCCURRENCE IS GLOSSED, per that line, and the reason is not
 * only fidelity: every gloss is a `<button>`, and the first-viewport
 * interactive budgets in `e2e/overview.spec.ts` count buttons. Glossing every
 * occurrence of "variant" in a report body would push a page over a budget
 * written to keep it readable, so the brief's rule and the product's budget
 * happen to want the same thing.
 *
 * Longest terms match first, so "absolute risk" is glossed as one phrase
 * rather than having "risk" glossed inside it.
 */

const TERMS: readonly string[] = glossaryEntries()
  .flatMap((entry) => [entry.term, ...entry.aliases])
  .sort((left, right) => right.length - left.length);

const PATTERN = new RegExp(
  `(?<![A-Za-z0-9])(${TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`,
  "gi",
);

export function GlossedText({ children }: { children: string }) {
  const parts: React.ReactNode[] = [];
  const glossed = new Set<string>();
  let cursor = 0;

  for (const match of children.matchAll(PATTERN)) {
    const found = match[0];
    const key = found.toLowerCase();
    if (glossed.has(key)) continue;
    glossed.add(key);
    const at = match.index ?? 0;
    if (at > cursor) parts.push(children.slice(cursor, at));
    parts.push(
      <GlossaryTerm key={`${key}-${at}`} term={found}>
        {found}
      </GlossaryTerm>,
    );
    cursor = at + found.length;
  }
  if (cursor < children.length) parts.push(children.slice(cursor));

  return <>{parts}</>;
}
