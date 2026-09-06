import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inventoryTemplateSources } from "./inventory";

// Synthetic metadata tests. These are not scientific claims or source receipts.
const citation = { pmid: "12345678", doi: "10.1234/synthetic", label: "Synthetic test source" };
const template = { slug: "synthetic", title: "Synthetic heading", summary: "Synthetic summary.",
  citations: [citation], variants: [{ interpretations: { "A/G": "Synthetic interpretation." } }] };

describe("template-source review inventory", () => {
  it("preserves every text slot and citation relationship without certifying support", () => {
    const output = inventoryTemplateSources([{ path: "data/templates/test.json", templates: [template] }]);
    expect(output.templates).toBe(1);
    expect(output.claims.map((c) => c.kind)).toEqual(["title", "summary", "interpretation"]);
    expect(output.claims.at(-1)).toMatchObject({ pointer: "/0/variants/0/interpretations/A~1G",
      text: "Synthetic interpretation.", candidateSourceKeys: ["pmid:12345678"] });
    expect(output.sources[0].occurrences[0]).toMatchObject({ declaredAccessDate: null, identifiers: citationIdentifiers() });
    expect(output.issues.map((i) => i.code)).toEqual(["missing-or-invalid-declared-access-date"]);
  });
  it("deduplicates source keys without losing repeated template occurrences or alternate identifiers", () => {
    const output = inventoryTemplateSources([{ path: "b.json", templates: [template] },
      { path: "a.json", templates: [{ ...template, slug: "second" }] }]);
    expect(output.sources).toHaveLength(1);
    expect(output.sources[0].occurrences.map((o) => o.path)).toEqual(["a.json", "b.json"]);
    expect(output.claims).toHaveLength(6);
  });
  it("keeps each editorial study context bound only to its own citation", () => {
    const output = inventoryTemplateSources([{ path: "test.json", templates: [{ ...template, citations: [
      { ...citation, studyContext: { measured: { text: "Synthetic measured context.", locator: "fixture" }, population: null } },
      { pmid: "23456789", label: "Another synthetic test source" },
    ] }] }]);
    expect(output.claims.find((c) => c.kind === "study-context")?.candidateSourceKeys).toEqual(["pmid:12345678"]);
    expect(output.claims.find((c) => c.kind === "summary")?.candidateSourceKeys).toEqual(["pmid:12345678", "pmid:23456789"]);
  });
  it.each([undefined, "2026-02-30", "2026-9-6", "yesterday"])("does not turn invalid or missing declared dates into review dates: %s", (accessedOn) => {
    const output = inventoryTemplateSources([{ path: "test.json", templates: [{ ...template, citations: [{ ...citation, accessedOn }] }] }]);
    expect(output.sources[0].occurrences[0].declaredAccessDate).toBeNull();
  });
  it("retains a valid existing date as declared, not independently verified", () => {
    const output = inventoryTemplateSources([{ path: "test.json", templates: [{ ...template, citations: [{ ...citation, accessedOn: "2024-02-29" }] }] }]);
    expect(output.sources[0].occurrences[0].declaredAccessDate).toBe("2024-02-29");
    expect(output.issues).toEqual([]);
  });
  it("reports malformed preferred identifiers even when a fallback URL exists", () => {
    const output = inventoryTemplateSources([{ path: "test.json", templates: [{ ...template, citations: [{ ...citation, pmid: "broken" }] }] }]);
    expect(output.issues.some((i) => i.code === "malformed-source-identifier")).toBe(true);
    expect(output.sources[0].key).toBe("doi:10.1234/synthetic");
  });
  it("does not silently lose malformed templates, claims, citations or interpretations", () => {
    const output = inventoryTemplateSources([{ path: "bad.json", templates: {} }, { path: "test.json", templates: [null,
      { ...template, summary: null, citations: [{}], variants: [{}] }, template] }]);
    expect(output.issues.map((i) => i.code)).toEqual(expect.arrayContaining([
      "template-file-not-array", "invalid-template", "unresolvable-source-identifier", "invalid-claim-text", "invalid-interpretations", "duplicate-template-slug",
    ]));
  });
  it("accounts for the complete current catalog and retains all interpretation strings", () => {
    const directory = path.resolve("data/templates");
    const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json"));
    const output = inventoryTemplateSources(files.map((file) => ({ path: `data/templates/${file}`, templates: JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")) })));
    expect(output.templates).toBe(162);
    expect(output.claims.filter((c) => c.kind === "interpretation")).toHaveLength(510);
    expect(output.sources).toHaveLength(186);
    expect(output.sources.reduce((sum, s) => sum + s.occurrences.length, 0)).toBe(218);
    expect(output.issues.every((i) => i.code === "missing-or-invalid-declared-access-date")).toBe(true);
    expect(output.issues).toHaveLength(198);
  });
});

function citationIdentifiers() { return { pmid: "12345678", doi: "10.1234/synthetic" }; }
