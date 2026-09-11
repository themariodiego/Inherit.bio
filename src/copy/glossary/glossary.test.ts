import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { glossaryEntries, glossaryEntry } from "./index";

/**
 * The glossary reads the register the readability gate already enforces, so
 * these hold the join rather than re-testing the data: if the two ever stop
 * being the same list, a reader and a gate would disagree about what a word
 * means, which is worse than either being wrong alone.
 */
describe("the glossary a reader sees", () => {
  it("is exactly the register the readability gate scores against", () => {
    const jargon = JSON.parse(
      readFileSync(path.join(process.cwd(), "data/jargon.json"), "utf8"),
    ) as { terms: { term: string; definition: string }[] };

    expect(glossaryEntries()).toHaveLength(jargon.terms.length);
    expect(glossaryEntries().map((entry) => entry.term)).toEqual(
      jargon.terms.map((entry) => entry.term),
    );
    for (const entry of glossaryEntries()) {
      // The gate already requires 1-25 words; a reader needs it non-empty.
      expect(entry.definition.trim().length, entry.term).toBeGreaterThan(0);
    }
  });

  it("finds a term however the copy happened to capitalise it", () => {
    // Copy writes "Variant" to open a sentence and "variant" inside one. A
    // gloss that matched only one would explain a word in one place and leave
    // it bare in the next, which reads as an oversight to the person who needs
    // it most.
    const lower = glossaryEntry("variant");
    expect(lower).not.toBeNull();
    expect(glossaryEntry("Variant")).toBe(lower);
    expect(glossaryEntry("  VARIANT  ")).toBe(lower);
  });

  it("resolves an alias to the entry that defines it", () => {
    const withAlias = glossaryEntries().find((entry) => entry.aliases.length > 0);
    expect(withAlias, "the register carries aliases at all").toBeDefined();
    expect(glossaryEntry(withAlias!.aliases[0])).toBe(withAlias);
  });

  it("returns null for a word it does not define, rather than guessing", () => {
    expect(glossaryEntry("kwyjibo")).toBeNull();
    expect(glossaryEntry("")).toBeNull();
  });
});
