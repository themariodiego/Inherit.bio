import { describe, expect, it } from "vitest";
import path from "node:path";
import corrections from "../data/report-scientific-corrections.json";
import { CATALOG_FIELDS, catalogFindings, expectedCatalog, type CatalogRow } from "./catalog-drift-gate";

/**
 * D-134's regression test. Production served corrected code over a catalog
 * that still held the eight reviewed pre-correction texts, and nothing saw it
 * because CI seeds the catalog from the files it would be compared with.
 * These fixtures drive the comparison directly, so the logic is proven
 * without a database.
 */

const root = path.resolve(".");
const expected = expectedCatalog(root);
const clone = <T>(value: T): T => structuredClone(value);
const deployedFrom = (rows: Iterable<CatalogRow>) => [...rows].map(clone);

/** What `jsonb` does to an object: same members, different key order. */
function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, member]) => [key, reorderKeys(member)]));
  }
  return value;
}

/** The deployed row for one reviewed correction, before it was corrected. */
function preCorrection(batch: (typeof corrections)[number]): CatalogRow {
  const row = clone(expected.get(batch.slug)!);
  const variants = row.variants as { rsid: number; interpretations: Record<string, string> }[];
  for (const entry of batch.fields) {
    if (entry.field === "title") row.title = entry.oldText;
    else if (entry.field === "summary") row.summary = entry.oldText;
    else variants.find((variant) => variant.rsid === entry.rsid)!.interpretations[entry.genotype!] = entry.oldText;
  }
  return row;
}

describe("report catalog drift between the repository and a deployed database", () => {
  it("passes when the deployment publishes exactly the repository's catalog", () => {
    expect(catalogFindings(expected, deployedFrom(expected.values()))).toEqual([]);
  });

  it("compares structure, not text, because jsonb reorders object keys", () => {
    const deployed = deployedFrom(expected.values()).map((row) => ({
      ...row,
      variants: reorderKeys(row.variants),
      citations: reorderKeys(row.citations),
    }));
    expect(catalogFindings(expected, deployed)).toEqual([]);
  });

  it("reports the 25 September production shape: every reviewed correction still deployed as superseded text", () => {
    const bySlug = new Map([...expected].map(([slug, row]) => [slug, clone(row)]));
    for (const batch of corrections) bySlug.set(batch.slug, preCorrection(batch));
    const findings = catalogFindings(expected, [...bySlug.values()]);

    expect(findings).toHaveLength(corrections.length);
    for (const batch of corrections) {
      const finding = findings.find((line) => line.startsWith(`${batch.slug}: `));
      expect(finding, batch.slug).toBeDefined();
      expect(finding).toContain(`${batch.fields.length} deployed field(s) are wording`);
      expect(finding).toContain("historical-wording notice");
    }
    // ALDH2 is the one batch that also corrected a title.
    expect(findings.find((line) => line.startsWith("alcohol-dependence-aldh2-rs671: "))).toMatch(/^[^;]*title/);
  });

  it("reports an unregistered difference as drift without calling it superseded", () => {
    const [slug, row] = [...expected][0];
    const changed = { ...clone(row), summary: `${row.summary as string} An unreviewed sentence.` };
    const findings = catalogFindings(expected, deployedFrom(expected.values()).map((item) => (item.slug === slug ? changed : item)));
    expect(findings).toEqual([`${slug}: summary differ from data/templates`]);
  });

  it("names fields and slugs but never prints report text", () => {
    const [slug, row] = [...expected][0];
    const secretish = "A sentence that must not reach a terminal log.";
    const findings = catalogFindings(expected, deployedFrom(expected.values()).map((item) =>
      item.slug === slug ? { ...clone(row), title: secretish, citations: [] } : item));
    expect(findings).toEqual([`${slug}: title, citations differ from data/templates`]);
    expect(findings.join("\n")).not.toContain(secretish);
  });

  it("checks every column a completed report captures", () => {
    // The capture trigger snapshots exactly these ten keys (slug included).
    expect([...CATALOG_FIELDS].sort()).toEqual(
      ["category", "citations", "estimate_kind", "evidence", "layer", "pgs_id", "summary", "title", "variants"],
    );
    const [slug, row] = [...expected][0];
    for (const field of CATALOG_FIELDS) {
      const changed = { ...clone(row), [field]: field === "variants" || field === "citations" ? [] : "changed" };
      const findings = catalogFindings(expected, deployedFrom(expected.values()).map((item) => (item.slug === slug ? changed : item)));
      expect(findings, field).toEqual([`${slug}: ${field} differ from data/templates`]);
    }
  });

  it("reports a template the deployment does not publish, and one it publishes without a file", () => {
    const [first, second] = [...expected.keys()];
    const deployed = deployedFrom(expected.values()).filter((row) => row.slug !== first);
    deployed.push({ ...clone(expected.get(second)!), slug: "published-without-a-file" });
    const findings = catalogFindings(expected, deployed);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain("does not publish 1 template(s)");
    expect(findings[0]).toContain(first);
    expect(findings[1]).toContain("cannot account for");
    expect(findings[1]).toContain("published-without-a-file");
  });

  it("reports a slug published twice", () => {
    const rows = deployedFrom(expected.values());
    rows.push(clone(rows[0]));
    expect(catalogFindings(expected, rows)).toEqual([`the deployment publishes ${rows[0].slug} more than once`]);
  });

  it("refuses to pass when either side read nothing", () => {
    // An empty read must never look like a clean deployment.
    expect(catalogFindings(new Map(), [])).toEqual([
      "no templates were read from data/templates",
      "the deployment publishes no templates at all",
    ]);
    expect(catalogFindings(expected, [])).toContain("the deployment publishes no templates at all");
  });

  it("reads this repository's catalog the way the seed writes it", () => {
    expect(expected.size).toBeGreaterThan(150);
    for (const row of expected.values()) {
      if (row.layer === "variant_call") expect(row.estimate_kind, row.slug).toBeNull();
      else expect(["single_locus", "polygenic_score"], row.slug).toContain(row.estimate_kind);
    }
    for (const batch of corrections) expect(expected.has(batch.slug), batch.slug).toBe(true);
  });
});
