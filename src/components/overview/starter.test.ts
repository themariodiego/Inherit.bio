import { describe, expect, it } from "vitest";
import type { ReportTemplate, ResolvedReport } from "@/lib/genome/reports";
import {
  isStarterCandidate,
  isStarterLayer,
  selectStarterReports,
  STARTER_LIMIT,
  STARTER_EXCLUDED_CATEGORIES,
} from "./starter";

function template(
  slug: string,
  category: string,
  evidence: ReportTemplate["evidence"] = "emerging",
  extra: Partial<ReportTemplate> = {},
): ReportTemplate {
  return {
    slug,
    category,
    title: slug,
    summary: "",
    evidence,
    variants: [],
    pgs_id: null,
    citations: [],
    ...extra,
  };
}

function resolved(t: ReportTemplate, covered = true): ResolvedReport {
  return { template: t, variants: [], covered };
}

describe("starter reading list", () => {
  it("treats rows without layer columns as single-locus estimates (seed derivation)", () => {
    expect(isStarterLayer(template("a", "basic-traits"))).toBe(true);
    expect(isStarterLayer(template("b", "basic-traits", "emerging", { layer: "variant_call" }))).toBe(true);
    expect(
      isStarterLayer(template("c", "basic-traits", "emerging", { layer: "estimate", estimate_kind: "polygenic_score" })),
    ).toBe(false);
    expect(isStarterLayer(template("d", "basic-traits", "emerging", { pgs_id: "PGS000011" }))).toBe(false);
  });

  it("keeps the three-level evidence set and excludes brain/mood and cancer", () => {
    expect(isStarterCandidate(template("a", "basic-traits", "clinical"))).toBe(true);
    expect(isStarterCandidate(template("a", "basic-traits", "established"))).toBe(true);
    expect(isStarterCandidate(template("a", "basic-traits", "emerging"))).toBe(true);
    expect(isStarterCandidate(template("a", "basic-traits", "preliminary"))).toBe(false);
    expect(isStarterCandidate(template("a", "basic-traits", "insufficient"))).toBe(false);
    expect(isStarterCandidate(template("a", "cancer-risk"))).toBe(false);
    expect(isStarterCandidate(template("a", "neurodegenerative"))).toBe(false);
    expect(isStarterCandidate(template("a", "mental-health"))).toBe(false);
    expect(isStarterCandidate(template("a", "addiction"))).toBe(false);
    expect(isStarterCandidate(template("a", "brain-health"))).toBe(false);
    // Per-slug exception: this lifestyle-wellness slug maps to everyday traits.
    expect(isStarterCandidate(template("muscle-composition-actn3-rs1815739", "lifestyle-wellness"))).toBe(true);
  });

  it("orders covered candidates by category rank then slug and caps at five", () => {
    const list = selectStarterReports([
      resolved(template("z-heart", "heart-cardiovascular")),
      resolved(template("b-food", "gastrointestinal")),
      resolved(template("a-food", "lifestyle-wellness")),
      resolved(template("c-food", "metabolic-obesity"), false),
      resolved(template("m-trait", "basic-traits")),
      resolved(template("k-trait", "aesthetic-cosmetic")),
      resolved(template("q-cancer", "cancer-risk")),
      resolved(template("p-prelim", "basic-traits", "preliminary")),
      resolved(template("y-immune", "autoimmune")),
      resolved(template("x-medicine", "environmental-sensitivity")),
    ]);
    expect(list.map((t) => t.slug)).toEqual([
      "k-trait",
      "m-trait",
      "x-medicine",
      "a-food",
      "b-food",
    ]);
    expect(list).toHaveLength(STARTER_LIMIT);
  });

  it("never pads with uncovered reports", () => {
    const list = selectStarterReports([
      resolved(template("a", "basic-traits"), false),
      resolved(template("b", "basic-traits"), false),
    ]);
    expect(list).toEqual([]);
  });
});

describe("starter exclusions", () => {
  it("never offers a Medicines report as a first read (ADR 0021)", () => {
    expect(STARTER_EXCLUDED_CATEGORIES.has("medicines")).toBe(true);
  });
});
