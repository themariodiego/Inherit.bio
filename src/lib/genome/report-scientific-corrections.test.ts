import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import registry from "../../../data/report-scientific-corrections.json";
import brain from "../../../data/templates/brain-health.json";
import cancer from "../../../data/templates/cancer-risk.json";
import addiction from "../../../data/templates/addiction.json";
import neurodegenerative from "../../../data/templates/neurodegenerative.json";
import {
  REPORT_SCIENTIFIC_CORRECTION_NOTICE,
  reportOutcomeScientificCorrections,
  reportScientificCorrections,
  type ScientificCorrectionOutcome,
  type ScientificCorrectionTemplate,
} from "./report-scientific-corrections";
import { resolveVariant, type ReportTemplate } from "./reports";

const current = [...brain, ...cancer, ...addiction, ...neurodegenerative] as ReportTemplate[];
const expectedCounts = [
  ["caffeine-sleep-adora2a-rs5751876", 4], ["colorectal-apc-i1307k", 4],
  ["breast-cancer-fgfr2-rs2981582", 4], ["alcohol-dependence-aldh2-rs671", 5],
  ["trem2-r47h-alzheimers", 4], ["apoe-e4-alzheimers-risk", 7],
] as const;

function historical(slug: string) {
  const template = structuredClone(current.find((item) => item.slug === slug)!);
  const batch = registry.find((item) => item.slug === slug)!;
  for (const entry of batch.fields) {
    if (entry.field === "title" || entry.field === "summary") template[entry.field] = entry.oldText;
    else template.variants.find((variant) => variant.rsid === entry.rsid)!.interpretations[entry.genotype!] = entry.oldText;
  }
  return template;
}

function oldOutcome(slug = "trem2-r47h-alzheimers", rsid = 75932628, genotype = "CT", strandFlipped = false): ScientificCorrectionOutcome {
  const template = historical(slug);
  return { rsid, outcome: { status: "genotyped", genotype, strandFlipped,
    interpretation: template.variants.find((variant) => variant.rsid === rsid)!.interpretations[genotype] } };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("known scientific correction registry", () => {
  it("pins the exact 28 old fields extracted from six reviewed Git changes", () => {
    expect(registry.map((batch) => [batch.slug, batch.fields.length])).toEqual(expectedCounts);
    const fields = registry.flatMap((batch) => batch.fields.map((entry) =>
      [batch.slug, entry.field, entry.rsid ?? null, entry.genotype ?? null, entry.oldText]));
    expect(fields).toHaveLength(28);
    expect(createHash("sha256").update(JSON.stringify(fields)).digest("hex"))
      .toBe("0074b093e0876bec6e5afb41411b8e30d6a399fdc655ce7399039bc4901bc05d");
    expect(new Set(registry.flatMap((batch) => batch.fields.map((entry) => entry.id))).size).toBe(28);
    for (const batch of registry) {
      expect(batch.correctedOn).toBe("2026-09-23");
      expect(existsSync(batch.reviewPath)).toBe(true);
      expect(batch.source.previousCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(batch.source.correctedCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(batch.source.previousCommit).not.toBe(batch.source.correctedCommit);
      const present = current.find((template) => template.slug === batch.slug)!;
      expect(batch.variants).toEqual(present.variants.map((variant) => Object.fromEntries(
        Object.entries(variant).filter(([key]) => key !== "interpretations"))));
    }
  });

  it.each(expectedCounts)("matches known superseded %s wording only, with %i exact descriptors", (slug, count) => {
    const batch = registry.find((item) => item.slug === slug)!;
    const old = historical(slug);
    const matched = reportScientificCorrections(old);
    expect(matched).toHaveLength(count);
    expect(matched.map((entry) => entry.id)).toEqual(batch.fields.map((entry) => entry.id));
    for (const entry of matched) {
      expect(entry.correctedOn).toBe(batch.correctedOn);
      expect(entry.reviewPath).toBe(batch.reviewPath);
      expect(Object.keys(entry).sort()).toEqual((entry.field === "interpretation"
        ? ["id", "correctedOn", "reviewPath", "field", "rsid", "genotype"]
        : ["id", "correctedOn", "reviewPath", "field"]).sort());
    }
    expect(reportScientificCorrections(current.find((template) => template.slug === slug)!)).toEqual([]);
  });

  it("does not flag unknown or unregistered content, whitespace changes, swapped fields or wrong identity", () => {
    const slug = "trem2-r47h-alzheimers", old = historical(slug), present = current.find((item) => item.slug === slug)!;
    const one = { ...structuredClone(present), variants: [{ ...structuredClone(present.variants[0]),
      interpretations: { CT: old.variants[0].interpretations.CT } }] };
    expect(reportScientificCorrections(one)).toHaveLength(1);
    for (const template of [
      { ...one, slug: "unreviewed-report" },
      { ...one, variants: [{ ...one.variants[0], rsid: 75932629 }] },
      { ...one, variants: [{ ...one.variants[0], interpretations: { TC: old.variants[0].interpretations.CT } }] },
      { ...one, variants: [{ ...one.variants[0], interpretations: { CT: `${old.variants[0].interpretations.CT} ` } }] },
      { ...present, summary: old.variants[0].interpretations.CT },
      { ...one, variants: [{ ...one.variants[0], interpretations: { CT: old.summary } }] },
      { ...present, summary: "An unregistered explanation is not automatically a known scientific error." },
    ]) expect(reportScientificCorrections(template)).toEqual([]);
    const inherited = Object.create({ CT: old.variants[0].interpretations.CT }) as Record<string, string>;
    expect(reportScientificCorrections({ ...one, variants: [{ ...one.variants[0], interpretations: inherited }] })).toEqual([]);
  });

  it("recognizes the exact old ALDH2 title without requiring a title for other matches", () => {
    const present = current.find((item) => item.slug === "alcohol-dependence-aldh2-rs671")!;
    const titleOnly = { ...present, title: "Alcohol dependence protection · ALDH2" };
    expect(reportScientificCorrections(titleOnly).map((entry) => entry.field)).toEqual(["title"]);
    const { slug, summary, variants } = historical(present.slug);
    const withoutTitle = { slug, summary, variants };
    expect(reportScientificCorrections(withoutTitle)).toHaveLength(4);
    expect(reportScientificCorrections({ ...present, title: `${titleOnly.title} ` })).toEqual([]);
  });

  it("ignores unrelated metadata, preserves frozen input and returns immutable descriptors", () => {
    const old = historical("apoe-e4-alzheimers-risk");
    const frozen = freeze({ ...old, evidence: "unrelated metadata", published_at: "2001-01-01", hash: "unchanged" });
    const before = JSON.stringify(frozen);
    const matched = reportScientificCorrections(frozen);
    expect(matched).toEqual(reportScientificCorrections(old));
    expect(JSON.stringify(frozen)).toBe(before);
    expect(Object.isFrozen(matched)).toBe(true);
    expect(matched.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(reportScientificCorrections({ slug: "unknown", summary: "unknown", variants: [] }))).toBe(true);
    expect(REPORT_SCIENTIFIC_CORRECTION_NOTICE).toBe("This report contains wording that was later corrected. The original DNA calls are unchanged. This wording is historical and should not be treated as the current interpretation.");
  });
});

describe("known no-catalog outcome corrections", () => {
  it("matches each of the 21 actual old genotype explanations and no current explanation", () => {
    let matched = 0;
    for (const batch of registry) {
      const present = current.find((item) => item.slug === batch.slug)!;
      for (const entry of batch.fields) {
        if (entry.field !== "interpretation") continue;
        const saved = oldOutcome(batch.slug, entry.rsid!, entry.genotype!);
        expect(reportOutcomeScientificCorrections(batch.slug, [saved]).map((item) => item.id)).toEqual([entry.id]);
        expect(reportOutcomeScientificCorrections(batch.slug, [{ ...saved, outcome: { ...saved.outcome,
          interpretation: present.variants.find((variant) => variant.rsid === entry.rsid)!.interpretations[entry.genotype!] } }])).toEqual([]);
        matched++;
      }
    }
    expect(matched).toBe(21);
  });

  it("uses resolver-canonical output and permits only a genuinely possible flipped pair", () => {
    const slug = "trem2-r47h-alzheimers", template = historical(slug), variant = template.variants[0];
    const flipped = resolveVariant(variant, "A/G");
    expect(flipped).toMatchObject({ status: "genotyped", genotype: "CT", strandFlipped: true });
    expect(reportOutcomeScientificCorrections(slug, [{ rsid: variant.rsid, outcome: flipped }])).toHaveLength(1);
    // Captured output is canonical CT, not raw A/G or AG; do not repair it.
    for (const genotype of ["AG", "A/G", "C/T", "TC", "ct", "C", "CT "]) {
      expect(reportOutcomeScientificCorrections(slug, [{ ...oldOutcome(), outcome: { ...oldOutcome().outcome,
        genotype, strandFlipped: true } }])).toEqual([]);
    }
    const palindromic = oldOutcome("colorectal-apc-i1307k", 1801155, "AT", true);
    expect(reportOutcomeScientificCorrections("colorectal-apc-i1307k", [palindromic])).toEqual([]);
    expect(reportOutcomeScientificCorrections("colorectal-apc-i1307k", [{ ...palindromic,
      outcome: { ...palindromic.outcome, strandFlipped: false } }])).toHaveLength(1);
  });

  it("refuses unknown, missing, non-genotyped, mismatched and malformed saved identities", () => {
    const saved = oldOutcome(), slug = "trem2-r47h-alzheimers";
    expect(reportOutcomeScientificCorrections("unknown", [saved])).toEqual([]);
    expect(reportOutcomeScientificCorrections(slug, [{ ...saved, rsid: 75932629 }])).toEqual([]);
    for (const changed of [
      { status: "no-call" }, { status: "unrecognized" }, { status: "not-covered" },
      { genotype: undefined }, { interpretation: undefined }, { strandFlipped: undefined },
      { genotype: "CC" }, { interpretation: `${saved.outcome.interpretation} ` },
    ]) expect(reportOutcomeScientificCorrections(slug, [{ ...saved, outcome: { ...saved.outcome, ...changed } }])).toEqual([]);
    const malformed = { ...saved, outcome: { ...saved.outcome, strandFlipped: "false" } };
    expect(reportOutcomeScientificCorrections(slug, [malformed as unknown as ScientificCorrectionOutcome])).toEqual([]);
  });

  it("does not mutate frozen results or duplicate descriptors for repeated observations", () => {
    const input = freeze([oldOutcome(), oldOutcome()]);
    const before = JSON.stringify(input);
    const matched = reportOutcomeScientificCorrections("trem2-r47h-alzheimers", input);
    expect(matched).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(matched)).toBe(true);
    expect(Object.isFrozen(matched[0])).toBe(true);
    expect(reportScientificCorrections({ slug: "unknown", summary: "", variants: [] } satisfies ScientificCorrectionTemplate)).toEqual([]);
  });
});
