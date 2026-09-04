import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import gatedBaseline from "./__fixtures__/gated-template-slugs.json";
import {
  CATEGORY_TAXONOMY,
  CLINICAL_CONFIRMATION_RE,
  ESTIMATE_KINDS,
  EVIDENCE_LEVELS,
  EVIDENCE_PUBLIC_LABELS,
  LAYERS,
  LEGACY_CATEGORY_DEFAULTS,
  LEGACY_CATEGORY_SLUGS,
  TEMPLATE_CATEGORY_EXCEPTIONS,
  categoryFor,
  categoryLabel,
  isEvidenceLevel,
  isGatedTemplate,
  type CategoryId,
} from "./taxonomy";

interface SeedTemplate {
  slug: string;
  category: string;
  evidence: string;
  layer?: string;
  pgs_id: string | null;
  variants: { interpretations: Record<string, string> }[];
}

const TEMPLATE_DIR = fileURLToPath(new URL("../../../data/templates", import.meta.url));

function loadTemplates(): SeedTemplate[] {
  const files = readdirSync(TEMPLATE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.flatMap(
    (name) =>
      JSON.parse(readFileSync(path.join(TEMPLATE_DIR, name), "utf8")) as SeedTemplate[],
  );
}

const templates = loadTemplates();

describe("category taxonomy", () => {
  it("names the nine categories, character-exact and in order", () => {
    expect(CATEGORY_TAXONOMY.map((c) => c.label)).toEqual([
      "Everyday traits",
      "Food, drink and metabolism",
      "Heart and circulation",
      "Immune system and allergies",
      "Medicines",
      "Brain, memory and mood",
      "Cancer",
      "Having children",
      "Ageing and longevity",
    ]);
    expect(CATEGORY_TAXONOMY.map((c) => c.id)).toEqual([
      "everyday-traits",
      "food-drink-metabolism",
      "heart-circulation",
      "immune-allergies",
      "medicines",
      "brain-memory-mood",
      "cancer",
      "having-children",
      "ageing-longevity",
    ]);
    expect(categoryLabel("medicines")).toBe("Medicines");
  });

  it("maps every legacy slug to a taxonomy category", () => {
    const ids = new Set<string>(CATEGORY_TAXONOMY.map((c) => c.id));
    expect(Object.keys(LEGACY_CATEGORY_DEFAULTS).sort()).toEqual(
      [...LEGACY_CATEGORY_SLUGS].sort(),
    );
    for (const target of Object.values(LEGACY_CATEGORY_DEFAULTS)) {
      expect(ids.has(target)).toBe(true);
    }
    for (const target of Object.values(TEMPLATE_CATEGORY_EXCEPTIONS)) {
      expect(ids.has(target)).toBe(true);
    }
  });

  it("loads exactly 162 seed templates: 151 estimates and the 11 Medicines variant calls", () => {
    expect(templates).toHaveLength(162);
    expect(templates.filter((t) => (t.layer ?? "estimate") === "estimate")).toHaveLength(151);
    expect(templates.filter((t) => t.layer === "variant_call")).toHaveLength(11);
  });

  it("resolves every template slug (total function) and categorises all of them", () => {
    const counts = new Map<CategoryId, number>();
    for (const template of templates) {
      const id = categoryFor(template);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const categorised = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(categorised).toBe(templates.length);
  });

  it("has eleven templates under Medicines, every one a variant call from the pharmacogenomics slug (ADR 0021)", () => {
    const medicines = templates.filter((t) => categoryFor(t) === "medicines");
    expect(medicines).toHaveLength(11);
    for (const template of medicines) {
      expect(template.category, template.slug).toBe("pharmacogenomics");
      expect(template.layer, template.slug).toBe("variant_call");
    }
    expect(LEGACY_CATEGORY_DEFAULTS.pharmacogenomics).toBe("medicines");
    // Nothing else reaches the category: no exception and no other default.
    expect(Object.values(TEMPLATE_CATEGORY_EXCEPTIONS)).not.toContain("medicines");
    expect(
      Object.entries(LEGACY_CATEGORY_DEFAULTS).filter(([, id]) => id === "medicines").map(([slug]) => slug),
    ).toEqual(["pharmacogenomics"]);
  });

  it("applies the six named exceptions", () => {
    const expected: Record<string, CategoryId> = {
      "muscle-composition-actn3-rs1815739": "everyday-traits",
      "endurance-trainability-ppargc1a-rs8192678": "everyday-traits",
      "sleep-duration-abcc9-rs11046205": "everyday-traits",
      "morning-chronotype-rgs16-rs516134": "everyday-traits",
      "allergic-sensitization-il13": "immune-allergies",
      "vitamin-d-sunlight-gc": "food-drink-metabolism",
    };
    expect(Object.keys(TEMPLATE_CATEGORY_EXCEPTIONS).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [slug, id] of Object.entries(expected)) {
      const template = templates.find((t) => t.slug === slug);
      expect(template, `${slug} exists in the seed data`).toBeDefined();
      expect(categoryFor(template!)).toBe(id);
      // Each exception differs from what the legacy default would have given.
      expect(
        LEGACY_CATEGORY_DEFAULTS[
          template!.category as keyof typeof LEGACY_CATEGORY_DEFAULTS
        ],
      ).not.toBe(id);
    }
  });

  it("throws on an unknown legacy category slug", () => {
    expect(() => categoryFor({ slug: "x", category: "not-a-category" })).toThrow(
      /Unknown legacy category/,
    );
  });
});

describe("evidence rubric", () => {
  it("lists the five levels in rubric order", () => {
    expect([...EVIDENCE_LEVELS]).toEqual([
      "clinical",
      "established",
      "emerging",
      "preliminary",
      "insufficient",
    ]);
    expect(EVIDENCE_PUBLIC_LABELS).toEqual({
      clinical: "Clinical-grade",
      established: "Established",
      emerging: "Emerging",
      preliminary: "Preliminary",
      insufficient: "Not shipped",
    });
    expect([...LAYERS]).toEqual(["variant_call", "estimate"]);
    expect([...ESTIMATE_KINDS]).toEqual(["single_locus", "polygenic_score"]);
  });

  it("seed data carries only remapped levels", () => {
    for (const template of templates) {
      expect(isEvidenceLevel(template.evidence), `${template.slug}: ${template.evidence}`).toBe(true);
      expect(template.evidence, template.slug).not.toBe("moderate");
      // The remap never upgrades: nothing sits at established or clinical
      // until a review puts it there.
      expect(template.evidence, template.slug).not.toBe("established");
      expect(template.evidence, template.slug).not.toBe("clinical");
      expect(template.evidence, template.slug).not.toBe("insufficient");
    }
    const emerging = templates.filter((t) => t.evidence === "emerging").length;
    const preliminary = templates.filter((t) => t.evidence === "preliminary").length;
    // 119 remapped estimates plus the 11 Medicines variant calls (ADR 0021).
    expect(emerging).toBe(130);
    expect(preliminary).toBe(32);
  });
});

describe("gating preservation", () => {
  it("matches the committed byte-identical baseline", () => {
    const gated = templates
      .filter((t) => isGatedTemplate(t))
      .map((t) => t.slug)
      .sort();
    expect(gated.length).toBeGreaterThan(0);
    expect(gated).toEqual([...gatedBaseline].sort());
    expect(gatedBaseline).toEqual([...gatedBaseline].sort());
  });

  it("gates on the clinical-confirmation content rule as well as category", () => {
    const template = {
      category: "basic-traits",
      variants: [
        {
          interpretations: {
            AA: "A result like this deserves confirmation in a clinical laboratory.",
          },
        },
      ],
    };
    expect(CLINICAL_CONFIRMATION_RE.test(template.variants[0].interpretations.AA)).toBe(true);
    expect(isGatedTemplate(template)).toBe(true);
    expect(
      isGatedTemplate({ category: "basic-traits", variants: [{ interpretations: { AA: "x" } }] }),
    ).toBe(false);
    expect(
      isGatedTemplate({ category: "cancer-risk", variants: [{ interpretations: { AA: "x" } }] }),
    ).toBe(true);
  });
});
