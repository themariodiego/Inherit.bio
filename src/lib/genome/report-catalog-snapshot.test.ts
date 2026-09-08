import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { seedLayerAndKind } from "../../../scripts/seed-layer";
import { reportCatalogSnapshotSchema, reportCatalogTemplateSchema } from "./report-catalog-snapshot";
import type { ReportTemplate } from "./reports";

describe("captured report references", () => {
  it("preserves every published seed template's selected fields without transformation", () => {
    const folder = join(process.cwd(), "data/templates");
    for (const name of readdirSync(folder).filter(name => name.endsWith(".json"))) {
      const templates = JSON.parse(readFileSync(join(folder, name), "utf8")) as ReportTemplate[];
      for (const template of templates) {
        const { slug, category, title, summary, evidence, variants, pgs_id, citations } = template;
        const selected = { slug, category, title, summary, evidence, variants, pgs_id, citations, ...seedLayerAndKind(template) };
        expect(reportCatalogTemplateSchema.parse(selected), slug).toEqual(selected);
      }
    }
  });
  it("does not fill missing historical metadata or accept caller-defined snapshot revisions", () => {
    expect(reportCatalogSnapshotSchema.safeParse(undefined).success).toBe(false);
    expect(reportCatalogSnapshotSchema.safeParse({ schemaVersion: 1, templateSha256: "invalid", template: {} }).success).toBe(false);
    expect(reportCatalogTemplateSchema.safeParse({ slug: "test", citations: [] }).success).toBe(false);
  });
});
