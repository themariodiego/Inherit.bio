import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRAIT_TOPICS } from "@/copy/genome/data";
import {
  CLINICAL_GENES,
  TRAIT_SLUGS,
  TRAIT_TOPIC_IDS,
  matchTraitSuggestion,
} from "./search-guidance";

/** Every slug in the seeded report library, read from data/templates. */
function seededSlugs(): Set<string> {
  const dir = path.join(process.cwd(), "data/templates");
  const slugs = new Set<string>();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const templates = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as {
      slug: string;
    }[];
    for (const template of templates) slugs.add(template.slug);
  }
  return slugs;
}

describe("CLINICAL_GENES", () => {
  it("covers the well-known hereditary-risk genes", () => {
    for (const gene of [
      "BRCA1",
      "BRCA2",
      "TP53",
      "MLH1",
      "MSH2",
      "APC",
      "PTEN",
      "PALB2",
      "ATM",
      "CHEK2",
    ]) {
      expect(CLINICAL_GENES.has(gene)).toBe(true);
    }
  });
});

describe("matchTraitSuggestion", () => {
  it("maps plain-English trait queries to report slugs", () => {
    const cases: [string, string][] = [
      ["eye color", "eye-color-herc2-rs12913832"],
      ["eyes", "eye-color-herc2-rs12913832"],
      ["alcohol", "alcohol-flush-aldh2-rs671"],
      ["caffeine", "caffeine-metabolism-cyp1a2-rs762551"],
      ["coffee", "caffeine-metabolism-cyp1a2-rs762551"],
      ["sleep", "sleep-duration-abcc9-rs11046205"],
      ["memory", "memory-plasticity-bdnf-rs6265"],
      ["lactose intolerance", "lactase-persistence-lct-rs4988235"],
      ["milk", "lactase-persistence-lct-rs4988235"],
      ["cilantro", "cilantro-soapy-taste-or6a2"],
      ["earwax", "earwax-type-abcc11"],
    ];
    for (const [query, slug] of cases) {
      const suggestion = matchTraitSuggestion(query);
      expect(suggestion, `query: ${query}`).not.toBeNull();
      expect(suggestion!.slugs, `query: ${query}`).toContain(slug);
    }
  });

  it("matches partial typing of a keyword", () => {
    expect(matchTraitSuggestion("caffein")?.topic).toBe("caffeine");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(matchTraitSuggestion("  Eye Color ")?.topic).toBe("eye-color");
  });

  it("returns null for gene-like and unknown queries", () => {
    expect(matchTraitSuggestion("PRODH")).toBeNull();
    expect(matchTraitSuggestion("CYP1A2")).toBeNull();
    expect(matchTraitSuggestion("zzzz-not-a-trait")).toBeNull();
    expect(matchTraitSuggestion("zzz")).toBeNull();
    expect(matchTraitSuggestion("")).toBeNull();
    expect(matchTraitSuggestion("ab")).toBeNull();
  });

  it("carries no title: every suggested slug exists in the seeded library", () => {
    const seeded = seededSlugs();
    expect(TRAIT_SLUGS.length).toBeGreaterThan(20);
    for (const slug of TRAIT_SLUGS) expect(seeded.has(slug), slug).toBe(true);
  });

  it("labels every topic id in the copy module", () => {
    for (const topic of TRAIT_TOPIC_IDS) {
      expect(TRAIT_TOPICS[topic], topic).toMatch(/^[a-z][a-z ]+$/);
    }
    expect(Object.keys(TRAIT_TOPICS).sort()).toEqual([...TRAIT_TOPIC_IDS].sort());
  });
});
