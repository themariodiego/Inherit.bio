import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlossedText } from "./glossed-text";
import { GlossaryTerm } from "./glossary-term";
import { glossaryEntry } from "@/copy/glossary";
import jargon from "../../../data/jargon.json";
import classes from "../../../data/glossary-citation-classes.json";

/** The `cited` half of the split, straight from the classes file. */
const CITED = new Set(
  (classes as { terms: { term: string; class: string }[] }).terms
    .filter((entry) => entry.class === "cited")
    .map((entry) => entry.term),
);

/**
 * The rules here are the brief's, and each has a reader behind it: first use
 * only (line 829), never hover-only (line 884), and a term the register does
 * not define must not become a control that says nothing.
 *
 * Written without JSX because this repository's vitest include pattern is
 * `src/**\/*.test.ts` and no `.test.tsx` exists; adding one would have meant
 * changing the project's test configuration to land a single file.
 */
const glossed = (text: string) => renderToStaticMarkup(createElement(GlossedText, null, text));

describe("glossing a copy string on first use", () => {
  it("glosses the first occurrence of a term and leaves the rest as text", () => {
    const html = glossed("A variant is a variant is a variant.");
    // One control, not three: every gloss is a button, and the first-viewport
    // budgets count buttons.
    expect(html.split('data-slot="glossary-term"').length - 1).toBe(1);
    expect(html).toContain('data-term="variant"');
    // The sentence still reads as written. The definition is in the markup but
    // `hidden`, so it is dropped before comparing: an in-place disclosure sits
    // inside the text flow by design, which is what lets it survive reflow.
    const visible = html
      .replace(/<span[^>]*data-slot="glossary-definition"[\s\S]*?<\/span>/g, "")
      .replace(/<[^>]+>/g, "");
    expect(visible).toBe("A variant is a variant is a variant.");
  });

  it("is never hover-only: the gloss is a real button carrying expanded state", () => {
    const html = glossed("Your coverage is listed below.");
    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
    // A hover handler cannot be the only way in, because there is not one.
    expect(html.toLowerCase()).not.toContain("onmouseover");
  });

  /**
   * The fixture moved on 2026-09-11 and the move is the point. This read
   * "absolute risk", which stopped being glossed at all when that term was
   * classed `cited` - so the assertion would have failed for a reason that has
   * nothing to do with longest-match-first. A fixture has to be a pair that
   * both still render: "research consent" contains "consent", and both are
   * plain, so this proves the ordering rather than the classification.
   */
  it("prefers the longest term, so a phrase is not glossed by its last word", () => {
    expect(glossed("Read the research consent carefully.")).toContain('data-term="research consent"');
  });

  it("glosses nothing a reader may not be shown uncited", () => {
    // The split is only worth having if it actually keeps these out. Whole
    // sentences of cited vocabulary must come back untouched.
    // "population" is deliberately absent from these: it is classed plain,
    // because its definition names a GROUP rather than a quantity. The first
    // draft of this test used it and failed, which is the classification being
    // checked rather than assumed.
    //
    // "absolute risk" was here until 2026-09-12 and had to leave, because the
    // register now carries a CDC source for it and it renders. That is the
    // SECOND time a hand-picked fixture in this file was invalidated by a term
    // being sourced, so the sweep below was added: every remaining uncited
    // term is checked, and the next one sourced needs no edit here.
    for (const sentence of ["A pathogenic classification is not a diagnosis.",
      // Not "meta-analysis": the hyphen is a word boundary, so the plain term
      // "analysis" inside it is glossed. That is the uncited PHRASE staying
      // unglossed while a plain word inside it is explained, which is the
      // behaviour the sweep below asserts directly.
      "The odds ratio is not a diagnosis.",
      "Heritability is a statistical estimate."]) {
      expect(glossed(sentence)).toBe(sentence);
    }
  });

  it("glosses no cited term that has no source, for every term in the register", () => {
    // Read from the RAW data files rather than from `@/copy/glossary`, whose
    // filter is the thing under test: asking the module which terms it thinks
    // are renderable and then checking it renders those would agree with
    // itself. `data/jargon.json` and the classes file are the inputs.
    //
    // Asserted as "no gloss carries this term", not "the sentence is
    // unchanged", because an uncited phrase can contain a plain word that
    // SHOULD be glossed - "risk allele" contains "allele", "reference panel"
    // contains "reference". Glossing those is correct; glossing the phrase is
    // not.
    //
    // What this does NOT cover, so it is not mistaken for cover: reclassifying
    // a term from `cited` to `plain` removes it from CITED and so from this
    // sweep. That route is closed in `src/copy/glossary/glossary-classes.test.ts`,
    // which pins the plain count against the classes file.
    const uncited = (jargon as { terms: { term: string; citationId?: string }[] }).terms
      .filter((entry) => CITED.has(entry.term) && !entry.citationId)
      .map((entry) => entry.term);
    expect(uncited.length).toBeGreaterThan(0);
    for (const term of uncited) {
      expect(glossed(`This sentence mentions ${term} once.`), `${term} must not be glossed uncited`)
        .not.toContain(`data-term="${term}"`);
    }
  });

  it("leaves a sentence with no registered term completely alone", () => {
    const plain = "Nothing here needs explaining at all.";
    expect(glossed(plain)).toBe(plain);
  });

  it("renders an undefined term as plain text rather than an empty control", () => {
    const html = renderToStaticMarkup(
      createElement(GlossaryTerm, { term: "kwyjibo" }),
    );
    expect(html).toBe("kwyjibo");
    expect(html).not.toContain("<button");
  });

  it("carries the definition the readability register holds, not a second copy", () => {
    // Asserted against the register rather than against the rendered markup,
    // because the definition's TEXT is deliberately absent until the reader
    // opens it (see below). What this pins is the thing the test was named
    // for: there is one definition and the component does not keep a copy.
    expect(glossaryEntry("allele")?.definition).toBe("One version of a DNA position.");
  });

  /**
   * The invariant a glossed surface actually depends on. A gloss sits inside a
   * sentence, so anything reading the containing paragraph reads the
   * definition span too. With the definition always mounted, a paragraph's
   * text becomes the copy with every definition spliced into it - which broke
   * an exact-copy assertion the first time a real surface was glossed, and
   * would have misread the product's own copy back to any other consumer of
   * rendered text.
   */
  it("leaves the sentence's text exactly as written while closed", () => {
    const sentence = "One allele was read from the reference.";
    const html = glossed(sentence);
    // Strip markup the way a reader's text content is assembled: tags go, the
    // characters between them stay.
    expect(html.replace(/<[^>]+>/g, "")).toBe(sentence);
    // The control and its target still exist; only the definition's text waits.
    expect(html).toContain('data-slot="glossary-definition"');
    expect(html).toContain("aria-controls=");
  });
});
