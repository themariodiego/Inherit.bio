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
  it("reconciles explicit publication aliases across files and DOI case without losing context bindings", () => {
    const output = inventoryTemplateSources([
      { path: "a.json", templates: [{ ...template, citations: [{ doi: "10.1234/SYNTHETIC", label: citation.label,
        studyContext: { measured: { text: "Synthetic DOI context." } } }] }] },
      { path: "b.json", templates: [{ ...template, slug: "paired", citations: [citation] }] },
      { path: "c.json", templates: [{ ...template, slug: "pmid-only", citations: [{ pmid: citation.pmid, label: citation.label }] }] },
    ]);
    expect(output.sources.map((source) => source.key)).toEqual(["pmid:12345678"]);
    expect(output.sources[0].occurrences.map((o) => [o.path, o.pointer, o.identifiers])).toEqual([
      ["a.json", "/0/citations/0", { doi: "10.1234/SYNTHETIC" }],
      ["b.json", "/0/citations/0", citationIdentifiers()],
      ["c.json", "/0/citations/0", { pmid: citation.pmid }],
    ]);
    expect(output.claims).toHaveLength(10);
    expect(output.claims.every((claim) => claim.candidateSourceKeys.join() === "pmid:12345678")).toBe(true);
    expect(output.claims.find((claim) => claim.kind === "study-context")).toMatchObject({
      path: "a.json", pointer: "/0/citations/0/studyContext/measured/text", text: "Synthetic DOI context.",
    });
  });
  it("normalizes DOI-only keys but does not invent an unrecorded PMID alias", () => {
    const output = inventoryTemplateSources([{ path: "test.json", templates: [{ ...template, citations: [
      { doi: "10.1234/SYNTHETIC", label: citation.label }, { doi: "10.1234/synthetic", label: citation.label },
      { pmid: citation.pmid, label: citation.label },
    ] }] }]);
    expect(output.sources.map((s) => [s.key, s.occurrences.length])).toEqual([
      ["doi:10.1234/synthetic", 2], ["pmid:12345678", 1],
    ]);
    expect(output.claims[0].candidateSourceKeys).toEqual(["doi:10.1234/synthetic", "pmid:12345678"]);
  });
  it.each([
    [{ ...citation, pmid: "23456789" }, ["doi:10.1234/synthetic", "pmid:12345678", "pmid:23456789"]],
    [{ ...citation, doi: "10.1234/other" }, ["doi:10.1234/synthetic", "pmid:12345678"]],
  ])("flags conflicting explicit alias maps without merging through them: %j", (conflict, expectedKeys) => {
    const output = inventoryTemplateSources([{ path: "test.json", templates: [{ ...template, citations: [
      citation, conflict, { doi: citation.doi, label: citation.label },
    ] }] }]);
    expect(output.sources.map((s) => s.key)).toEqual(expectedKeys);
    expect(output.sources.reduce((sum, s) => sum + s.occurrences.length, 0)).toBe(3);
    expect(output.issues.filter((i) => i.code === "conflicting-source-alias").map((i) => i.pointer)).toEqual(
      conflict.pmid !== citation.pmid ? ["/0/citations/0", "/0/citations/1", "/0/citations/2"] : ["/0/citations/0", "/0/citations/1"],
    );
    expect(output.claims[0].candidateSourceKeys).toContain("doi:10.1234/synthetic");
  });
  it("keeps each editorial study context bound only to its own citation", () => {
    const output = inventoryTemplateSources([{ path: "test.json", templates: [{ ...template, citations: [
      { ...citation, studyContext: { measured: { text: "Synthetic measured context.", locator: "fixture" }, population: null } },
      { pmid: "23456789", label: "Another synthetic test source" },
    ] }] }]);
    expect(output.claims.find((c) => c.kind === "study-context")?.candidateSourceKeys).toEqual(["pmid:12345678"]);
    expect(output.claims.find((c) => c.kind === "summary")?.candidateSourceKeys).toEqual(["pmid:12345678", "pmid:23456789"]);
  });
  it.each([undefined, "0000-01-01", "2026-02-30", "2026-9-6", "yesterday"])("does not turn invalid or missing declared dates into review dates: %s", (accessedOn) => {
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
  it("preserves study prose with no candidate key when a source identifier is broken", () => {
    const output = inventoryTemplateSources([{ path: "test.json", templates: [{ ...template, citations: [{
      pmid: "broken", studyContext: { measured: { text: "Synthetic context that still needs review.", locator: "fixture" } },
    }] }] }]);
    expect(output.claims.find((c) => c.kind === "study-context")).toMatchObject({
      text: "Synthetic context that still needs review.", candidateSourceKeys: [], pointer: "/0/citations/0/studyContext/measured/text",
    });
    expect(output.issues.map((i) => i.code)).toContain("unresolvable-source-identifier");
  });
  it("accounts for the complete current catalog and retains all interpretation strings", () => {
    const directory = path.resolve("data/templates");
    const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json"));
    interface RawCitation { pmid?: string; doi?: string; label: string; accessedOn?: string;
      studyContext?: Record<string, { text: string } | null> }
    interface RawTemplate { slug: string; title: string; summary: string; citations: RawCitation[];
      variants: { interpretations: Record<string, string> }[] }
    const inputs = files.sort().map((file) => ({ path: `data/templates/${file}`,
      templates: JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")) as RawTemplate[] }));
    const output = inventoryTemplateSources(inputs);
    const rawCitations = inputs.flatMap((input) => input.templates.flatMap((t, ti) => t.citations.map((c, ci) => ({
      ...c, path: input.path, pointer: `/${ti}/citations/${ci}`, slug: t.slug,
    }))));
    // Independent expectations from raw data, not counts returned by the inventory.
    const paired = rawCitations.filter((c) => c.pmid && c.doi);
    const keyFor = (c: RawCitation) => c.pmid ? `pmid:${c.pmid}` : (() => {
      const matches = paired.filter((p) => p.doi!.toLowerCase() === c.doi!.toLowerCase());
      const pmids = [...new Set(matches.map((p) => p.pmid!))];
      const unambiguous = pmids.length === 1 && new Set(paired.filter((p) => p.pmid === pmids[0]).map((p) => p.doi!.toLowerCase())).size === 1;
      return unambiguous ? `pmid:${pmids[0]}` : `doi:${c.doi!.toLowerCase()}`;
    })();
    const escaped = (s: string) => s.replaceAll("~", "~0").replaceAll("/", "~1");
    const expectedClaims = inputs.flatMap((input) => input.templates.flatMap((t, ti) => {
      const keys = [...new Set(t.citations.map(keyFor))];
      const slot = (pointer: string, kind: string, text: string, candidateSourceKeys = keys) => ({
        path: input.path, pointer, slug: t.slug, kind, text, candidateSourceKeys,
      });
      return [
        ...t.citations.flatMap((c, ci) => Object.entries(c.studyContext ?? {}).filter(([, value]) => value !== null)
          .map(([field, value]) => slot(`/${ti}/citations/${ci}/studyContext/${escaped(field)}/text`, "study-context", value!.text, [keyFor(c)]))),
        slot(`/${ti}/title`, "title", t.title), slot(`/${ti}/summary`, "summary", t.summary),
        ...t.variants.flatMap((v, vi) => Object.entries(v.interpretations)
          .map(([gt, text]) => slot(`/${ti}/variants/${vi}/interpretations/${escaped(gt)}`, "interpretation", text))),
      ];
    }));
    expect(output.templates).toBe(162);
    expect(output.claims.filter((c) => c.kind === "interpretation")).toHaveLength(510);
    expect(output.claims).toEqual(expectedClaims);
    expect(output.sources.map((s) => s.key)).toEqual([...new Set(rawCitations.map(keyFor))].sort());
    const byPointer = (a: { path: string; pointer: string }, b: { path: string; pointer: string }) =>
      `${a.path}:${a.pointer}`.localeCompare(`${b.path}:${b.pointer}`);
    const validRawDate = (date: string | undefined) => !!date && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    expect(output.sources.flatMap((s) => s.occurrences.map((o) => ({ ...o, key: s.key }))).sort(byPointer)).toEqual(
      rawCitations.map((c) => ({ path: c.path, pointer: c.pointer, slug: c.slug, label: c.label,
        declaredAccessDate: validRawDate(c.accessedOn) ? c.accessedOn : null,
        identifiers: { ...(c.pmid ? { pmid: c.pmid } : {}), ...(c.doi ? { doi: c.doi } : {}) }, key: keyFor(c),
      })).sort(byPointer),
    );
    expect(output.issues.every((i) => i.code === "missing-or-invalid-declared-access-date")).toBe(true);
    expect(output.issues.map(({ path, pointer }) => ({ path, pointer })).sort(byPointer)).toEqual(
      rawCitations.filter((c) => !validRawDate(c.accessedOn)).map(({ path, pointer }) => ({ path, pointer })).sort(byPointer),
    );
  });
});

function citationIdentifiers() { return { pmid: "12345678", doi: "10.1234/synthetic" }; }
