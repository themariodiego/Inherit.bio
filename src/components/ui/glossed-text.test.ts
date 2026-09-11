import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlossedText } from "./glossed-text";
import { GlossaryTerm } from "./glossary-term";

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

  it("prefers the longest term, so a phrase is not glossed by its last word", () => {
    expect(glossed("Read the absolute risk carefully.")).toContain('data-term="absolute risk"');
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
    expect(glossed("One allele was read.")).toContain("One version of a DNA position.");
  });
});
