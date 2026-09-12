import { existsSync, readFileSync } from "node:fs";
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
    // Renderable is no longer the same set as `plain`. Since 2026-09-12 a
    // `cited` term also renders once its definition resolves to a real entry
    // in data/glossary-citations.json, which is what sourcing the 42 is for:
    // without it, sourcing them would have changed nothing on screen.
    //
    // Derived from the register rather than pinned, so deleting a citation
    // returns its term to invisible and this still holds. What it still
    // catches is what it was written for — a term reclassified from cited to
    // plain to make it render.
    const withEvidence = glossaryEntries()
      .filter((entry) => entry.citationClass === "cited" && entry.citationId !== null);
    expect(renderableGlossaryEntries().length).toBe(classes.counts.plain + withEvidence.length);
    const renderable = renderableGlossaryEntries().map((entry) => entry.term);
    for (const entry of withEvidence) expect(renderable).toContain(entry.term);
  });

  it("renders each named risk, disease and statistical term only once it is sourced", () => {
    // Named rather than derived: a rule that recomputed the classification
    // would agree with itself and prove nothing.
    //
    // Written on 2026-09-11 as "none of these renders", which was true then
    // because none of them was sourced. Sourcing `penetrance`, `prevalence`
    // and the rest on 2026-09-12 is exactly the change the register was built
    // to allow, so the assertion is now the biconditional it always meant:
    // each of these terms renders IF AND ONLY IF a citation carries it.
    //
    // That is stronger than the original, not weaker. Reclassifying any of
    // them from `cited` to `plain` to make it render still fails here, because
    // reclassifying does not give it a `citationId`; and deleting a citation
    // from the register now has to return its term to invisible too.
    const renderable = new Set(renderableGlossaryEntries().map((entry) => entry.term));
    for (const term of ["absolute risk", "relative risk", "odds ratio", "hazard ratio", "confidence interval",
      "heritability", "penetrance", "polygenic", "risk allele", "susceptibility", "z-score", "percentile",
      "pathogenic", "diagnosis", "condition", "autoimmune", "medication", "clinical"]) {
      const sourced = glossaryEntry(term)?.citationId != null;
      expect(renderable.has(term), sourced
        ? `${term} is sourced and must render`
        : `${term} must not render uncited`).toBe(sourced);
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


/**
 * The half that matters more than the rendering half: a reference resolving to
 * nothing must not let a clinical definition onto a page. Built 2026-09-12
 * with the operator's condition that anything unreachable stays invisible.
 */
describe("a cited definition renders only on evidence that resolves", () => {
  const REGISTER = JSON.parse(
    readFileSync(path.join(ROOT, "data/glossary-citations.json"), "utf8"),
  ) as { citations: { id: string; quote: string; archived_path: string; access_date: string }[] };
  const IDS = new Set(REGISTER.citations.map((citation) => citation.id));

  it("resolves every citationId a definition carries", () => {
    // READ THE RAW FILE, not glossaryEntries(). `index.ts` already nulls an id
    // that resolves to nothing, so asserting over its output would agree with
    // itself: a typo would be silently dropped and this would pass. Written
    // that way first, and it proved nothing — pointing a definition at a
    // dangling id changed no result at all.
    const raw = JSON.parse(readFileSync(path.join(ROOT, "data/jargon.json"), "utf8")) as {
      terms: { term: string; citationId?: string }[];
    };
    const carried = raw.terms.filter((entry) => entry.citationId);
    expect(carried.length, "the sourcing has started").toBeGreaterThan(0);
    for (const entry of carried) {
      expect(IDS.has(entry.citationId!), `${entry.term}: ${entry.citationId} is in no register`).toBe(true);
      expect(glossaryEntry(entry.term)?.citationId, entry.term).toBe(entry.citationId);
    }
  });

  it("leaves no citation in the register that no definition uses", () => {
    // The corpus register's orphan rule, kept for this one rather than
    // inherited: a source nobody cites is a source nobody checks.
    const used = new Set((JSON.parse(readFileSync(path.join(ROOT, "data/jargon.json"), "utf8")) as {
      terms: { citationId?: string }[];
    }).terms.map((entry) => entry.citationId).filter(Boolean));
    for (const citation of REGISTER.citations) {
      expect(used.has(citation.id), `${citation.id} is used by no definition`).toBe(true);
    }
  });

  it("keeps every citation checkable: a snapshot, a date, and a quote inside the limit", () => {
    for (const citation of REGISTER.citations) {
      expect(citation.archived_path.startsWith("docs/sources/"), citation.id).toBe(true);
      expect(existsSync(path.join(ROOT, citation.archived_path)), citation.archived_path).toBe(true);
      expect(citation.access_date, citation.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const words = citation.quote.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token));
      expect(words.length, `${citation.id} quote length`).toBeLessThanOrEqual(25);
      // The quote must be the one the fetch verified against the page bytes.
      const snapshot = JSON.parse(readFileSync(path.join(ROOT, citation.archived_path), "utf8")) as { quote: string | null };
      expect(snapshot.quote, `${citation.id} quote must match its snapshot`).toBe(citation.quote);
    }
  });

  it("still hides every cited term with no evidence yet", () => {
    const renderable = new Set(renderableGlossaryEntries().map((entry) => entry.term));
    const uncited = glossaryEntries()
      .filter((entry) => entry.citationClass === "cited" && entry.citationId === null);
    // A non-vacuity guard, not a target. This read `toBeGreaterThan(30)` when
    // two of the 42 were sourced, which made it fail the moment sourcing
    // worked - a test that turns red on progress is measuring the wrong thing.
    // What has to hold is that no uncited term renders; the count is whatever
    // the register happens to hold. Delete this line when the last one is
    // sourced and the loop is empty for the right reason.
    expect(uncited.length, "there is still something to hide").toBeGreaterThan(0);
    for (const entry of uncited) {
      expect(renderable.has(entry.term), `${entry.term} must not render uncited`).toBe(false);
    }
  });
});
