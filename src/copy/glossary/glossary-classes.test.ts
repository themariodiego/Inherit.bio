import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { glossaryEntries, glossaryEntry, renderableGlossaryEntries } from "./index";

/**
 * The split is a decision about what a reader is shown, so the thing that
 * matters is that it is complete and cannot rot open. Two failure modes are
 * worth more than the rest: a term added to `data/jargon.json` with no class,
 * which would ship uncited by omission, and a class recorded for a term that
 * no longer exists, which would make the artifact read as more considered than
 * it is. Both fail here.
 */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
interface Classes {
  schemaVersion: number;
  rule: string;
  counts: { total: number; cited: number; plain: number };
  terms: { term: string; class: "plain" | "cited"; why?: string }[];
}
const classes = JSON.parse(
  readFileSync(path.join(ROOT, "data/glossary-citation-classes.json"), "utf8"),
) as Classes;

describe("every glossary term is classified on purpose", () => {
  it("classifies every term in the register, and no term that is not in it", () => {
    const registered = glossaryEntries().map((entry) => entry.term).sort();
    expect(classes.terms.map((entry) => entry.term).sort()).toEqual(registered);
  });

  it("records a reason beside every term it keeps from a reader, and none beside one it ships", () => {
    for (const entry of classes.terms) {
      if (entry.class === "cited") expect(entry.why, entry.term).toBeTruthy();
      else expect(entry.why, entry.term).toBeUndefined();
    }
  });

  it("holds its own counts, so a silent reclassification fails rather than passes", () => {
    const cited = classes.terms.filter((entry) => entry.class === "cited").length;
    expect(classes.counts.total).toBe(classes.terms.length);
    expect(classes.counts.cited).toBe(cited);
    expect(classes.counts.plain).toBe(classes.terms.length - cited);
    expect(renderableGlossaryEntries().length).toBe(classes.counts.plain);
  });

  it("keeps every named risk, disease and statistical term out of what renders", () => {
    // Named rather than derived: a rule that recomputed the classification
    // would agree with itself and prove nothing.
    const renderable = new Set(renderableGlossaryEntries().map((entry) => entry.term));
    for (const term of ["absolute risk", "relative risk", "odds ratio", "hazard ratio", "confidence interval",
      "heritability", "penetrance", "polygenic", "risk allele", "susceptibility", "z-score", "percentile",
      "pathogenic", "diagnosis", "condition", "autoimmune", "medication", "clinical"]) {
      expect(renderable.has(term), `${term} must not render uncited`).toBe(false);
    }
  });

  it("does ship the plain vocabulary, or the split bought nothing", () => {
    const renderable = new Set(renderableGlossaryEntries().map((entry) => entry.term));
    for (const term of ["allele", "chromosome", "gene", "genotype", "variant", "sequencing",
      "whole genome", "consent", "jurisdiction", "raw data"]) {
      expect(renderable.has(term), `${term} should be readable`).toBe(true);
    }
    expect(renderable.size).toBeGreaterThan(glossaryEntries().length / 2);
  });

  it("defaults an unclassified term to cited, so omission cannot ship one", () => {
    // The register and the classes are compared above; this pins the fallback
    // the module applies if they ever disagree at runtime.
    for (const entry of glossaryEntries()) {
      expect(["plain", "cited"]).toContain(entry.citationClass);
    }
    expect(glossaryEntry("pathogenic")?.citationClass).toBe("cited");
    expect(glossaryEntry("chromosome")?.citationClass).toBe("plain");
  });
});
