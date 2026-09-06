import { describe, expect, it, vi } from "vitest";
import { validateClaimRegistry, type Citation, type Claim, type RegistryInput, type IssueCode } from "./registry";

/** All records are synthetic validator fixtures, never published source claims. */
function fixture(type: Citation["type"] = "pmid"): RegistryInput & { citations: Citation[]; claims: Claim[] } {
  const identifier = type === "pmid" ? "12345678" : type === "doi" ? "10.1234/synthetic-validator" : "SYNTHETIC-RECORD-1";
  const url = type === "pmid" ? `https://pubmed.ncbi.nlm.nih.gov/${identifier}/` : type === "doi" ? `https://doi.org/${identifier}` : "https://example.invalid/synthetic-record";
  const citation: Citation = { id: "fixture.source", type, identifier, url,
    archived_path: ["pmid", "doi"].includes(type) ? null : "docs/sources/synthetic-record.txt",
    access_date: "2026-09-01", quote: "This quotation is only synthetic validator test data.", claim: "A synthetic source-scope description, not scientific evidence." };
  const claim: Claim = { claim_id: "fixture.claim", text_verbatim: "This sentence is a synthetic validator fixture.",
    surfaces: ["fixture.surface"], claim_type: "descriptive", evidence: [{ citation: citation.id, doi_or_url: url, accessed_on: citation.access_date, what_it_supports: "The synthetic fixture sentence, not a real product claim." }],
    net_impression_note: "Synthetic metadata validation only, not a support judgment.", reviewed_on: "2026-09-02", reviewer: "Synthetic reviewer fixture; not a sign-off" };
  return { citations: [citation], claims: [claim], commitDate: "2026-09-06", corpus: [{ claimId: claim.claim_id, text: claim.text_verbatim, surface: claim.surfaces[0] }],
    refusalClaimIds: [], societyPositionClaimIds: [], archiveExists: vi.fn(() => true) };
}
function codes(input: RegistryInput): { code: IssueCode; path: string }[] {
  const result = validateClaimRegistry(input);
  expect(result.ok).toBe(false);
  return result.issues.map(({ code, path }) => ({ code, path }));
}
function accessed(input: ReturnType<typeof fixture>, value: string) {
  input.citations[0].access_date = value;
  input.claims[0] = { ...input.claims[0], evidence: [{ ...input.claims[0].evidence[0], accessed_on: value }] };
  return input;
}

describe("canonical claim metadata and resolver", () => {
  it.each(["pmid", "doi", "statute", "registry", "regulator", "dataset"] as const)("accepts a fully bound synthetic %s source", (type) => {
    const input = fixture(type);
    const result = validateClaimRegistry(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.resolveClaim("fixture.claim")).toEqual({ claim: input.claims[0], citations: input.citations });
    expect(result.registry.resolveCitation("fixture.source")).toEqual(input.citations[0]);
    expect(result.registry.resolveClaim("missing")).toBeUndefined();
    expect(result.registry.resolveCitation("12345678")).toBeUndefined();
    expect(input.archiveExists).toHaveBeenCalledTimes(["pmid", "doi"].includes(type) ? 0 : 1);
  });
  it("does not mutate input or let subsequent mutation alter a validated resolution", () => {
    const input = fixture();
    const result = validateClaimRegistry(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    input.citations[0].quote = "Changed after validation";
    input.claims[0] = { ...input.claims[0], text_verbatim: "Changed after validation" };
    const resolved = result.registry.resolveClaim("fixture.claim")!;
    expect(resolved.claim.text_verbatim).toBe("This sentence is a synthetic validator fixture.");
    expect(resolved.citations[0].quote).not.toBe(input.citations[0].quote);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.claim.evidence[0])).toBe(true);
    expect(Object.isFrozen(resolved.claim.surfaces)).toBe(true);
    expect(Object.isFrozen(resolved.citations[0])).toBe(true);
  });
  it("accepts a bare DOI only when it is exactly the canonical DOI", () => {
    const input = fixture("doi");
    input.claims[0] = { ...input.claims[0], evidence: [{ ...input.claims[0].evidence[0], doi_or_url: input.citations[0].identifier }] };
    expect(validateClaimRegistry(input).ok).toBe(true);
    input.claims[0] = { ...input.claims[0], evidence: [{ ...input.claims[0].evidence[0], doi_or_url: "10.9999/other" }] };
    expect(codes(input)).toContainEqual({ code: "evidence-url-mismatch", path: "claims[0].evidence[0].doi_or_url" });
  });
  it.each([null, {}, "legacy", 1])("rejects a non-array registry: %j", (value) => {
    const input = fixture();
    input.citations = value as never;
    expect(codes(input)).toContainEqual({ code: "invalid-shape", path: "citations" });
    input.citations = fixture().citations; input.claims = value as never;
    expect(codes(input)).toContainEqual({ code: "invalid-shape", path: "claims" });
  });
  it("rejects legacy aliases, unexpected keys, duplicates and blank review metadata", () => {
    const input = fixture();
    input.citations.push({ ...input.citations[0], identifier_type: "pmid" } as Citation);
    input.claims.push({ ...input.claims[0], reviewer: " ", statement: "legacy" } as Claim);
    expect(codes(input)).toEqual(expect.arrayContaining([
      { code: "duplicate-id", path: "citations[1].id" }, { code: "duplicate-id", path: "claims[1].claim_id" },
      { code: "invalid-field", path: "citations[1].identifier_type" }, { code: "invalid-field", path: "claims[1].statement" },
      { code: "invalid-field", path: "claims[1].reviewer" },
    ]));
  });
  it.each(["bad id", "", "UPPERCASE", "../escape"])("rejects malformed canonical ids: %s", (id) => {
    const input = fixture(); input.citations[0].id = id;
    expect(codes(input)).toContainEqual({ code: "invalid-id", path: "citations[0].id" });
  });
  it("rejects a boxed enum rather than silently stringifying it", () => {
    const input = fixture(); input.claims[0] = { ...input.claims[0], claim_type: Object("objective") as never };
    expect(codes(input)).toContainEqual({ code: "invalid-field", path: "claims[0].claim_type" });
  });
  it("requires explicit corpus, policy classification and archive checking inputs", () => {
    const input = fixture(); input.archiveExists = undefined as never;
    expect(codes(input)).toContainEqual({ code: "invalid-field", path: "archiveExists" });
    input.archiveExists = () => true; input.corpus = undefined as never;
    expect(codes(input)).toContainEqual({ code: "invalid-shape", path: "corpus" });
    input.corpus = fixture().corpus; input.refusalClaimIds = undefined as never;
    expect(codes(input)).toContainEqual({ code: "invalid-shape", path: "refusalClaimIds" });
    input.refusalClaimIds = []; input.societyPositionClaimIds = undefined as never;
    expect(codes(input)).toContainEqual({ code: "invalid-shape", path: "societyPositionClaimIds" });
  });
});

describe("identifiers, URLs and supporting snapshots", () => {
  it.each(["pmid", "doi"] as const)("rejects source duplicates with new ids and split quote budgets: %s", (type) => {
    const input = fixture(type);
    input.citations[0].quote = Array(25).fill("first").join(" ");
    const second = { ...input.citations[0], id: "fixture.second", quote: Array(25).fill("second").join(" ") };
    if (type === "doi") {
      second.identifier = second.identifier.toUpperCase();
      second.url = `https://doi.org/${second.identifier}`;
    }
    input.citations.push(second);
    input.claims[0] = { ...input.claims[0], evidence: [...input.claims[0].evidence,
      { ...input.claims[0].evidence[0], citation: second.id, doi_or_url: second.url }] };
    expect(codes(input)).toContainEqual({ code: "duplicate-source", path: "citations[1].identifier" });
  });
  it.each(["0", "123456789", "PMID:12345678", "12e5", " 12345678"])("rejects malformed PMID %s", (identifier) => {
    const input = fixture(); input.citations[0].identifier = identifier;
    expect(codes(input)).toContainEqual({ code: "invalid-identifier", path: "citations[0].identifier" });
  });
  it.each(["10.123/a", "10.1234567890/a", "doi:10.1234/a", "10.1234/has space"])("rejects malformed DOI %s", (identifier) => {
    const input = fixture("doi"); input.citations[0].identifier = identifier;
    expect(codes(input)).toContainEqual({ code: "invalid-identifier", path: "citations[0].identifier" });
  });
  it("checks the recognized clinical registry identifier grammar without relabelling it", () => {
    const input = fixture("registry"); input.citations[0].identifier = "NCT12345678";
    expect(validateClaimRegistry(input).ok).toBe(true);
    input.citations[0].identifier = "NCT123";
    expect(codes(input)).toContainEqual({ code: "invalid-identifier", path: "citations[0].identifier" });
  });
  it.each(["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "/relative", "https://example.invalid/has space"])("rejects unsafe URL %s", (url) => {
    const input = fixture(); input.citations[0].url = url;
    expect(codes(input)).toContainEqual({ code: "invalid-url", path: "citations[0].url" });
  });
  it("rejects URL credentials even on a synthetic reserved host", () => {
    const url = new URL("https://example.invalid/synthetic-record");
    url.username = "synthetic-reader"; url.password = "synthetic-password";
    const input = fixture(); input.citations[0].url = url.href;
    expect(codes(input)).toContainEqual({ code: "invalid-url", path: "citations[0].url" });
  });
  it.each(["https://example.invalid/12345678/", "https://pubmed.ncbi.nlm.nih.gov/87654321/", "https://pubmed.ncbi.nlm.nih.gov/12345678/?redirect=1"])("rejects a permanent URL that fails exact identity: %s", (url) => {
    const input = fixture(); input.citations[0].url = url;
    expect(codes(input)).toContainEqual({ code: "identifier-url-mismatch", path: "citations[0].url" });
  });
  it.each(["/docs/sources/a.txt", "docs/sources/../a.txt", "docs/sources/%2e%2e/a.txt", "docs/sources/a\\b.txt", "docs/sources/", "other/a.txt", "docs/sources/./a.txt", "docs/sources//a.txt"])("refuses unsafe archive path %s before calling the checker", (path) => {
    const input = fixture("dataset"); input.citations[0].archived_path = path;
    expect(codes(input)).toContainEqual({ code: "invalid-archive-path", path: "citations[0].archived_path" });
    expect(input.archiveExists).not.toHaveBeenCalled();
  });
  it.each(["statute", "registry", "regulator", "dataset"] as const)("requires an archive for %s", (type) => {
    const input = fixture(type); input.citations[0].archived_path = null;
    expect(codes(input)).toContainEqual({ code: "archive-required", path: "citations[0].archived_path" });
  });
  it("checks an optional PMID archive when supplied, and handles checker errors explicitly", () => {
    const input = fixture(); input.citations[0].archived_path = "docs/sources/fixture.txt";
    input.archiveExists = () => false;
    expect(codes(input)).toContainEqual({ code: "archive-missing", path: "citations[0].archived_path" });
    input.archiveExists = () => { throw new Error("private filesystem detail"); };
    const result = validateClaimRegistry(input);
    expect(result.issues).toContainEqual({ code: "archive-check-failed", path: "citations[0].archived_path", message: "The source snapshot could not be checked." });
    expect(JSON.stringify(result)).not.toContain("private filesystem");
  });
  it("requires actual quote and support text and caps a quotation at 25 whitespace-separated words", () => {
    const input = fixture(); input.citations[0].quote = Array(25).fill("fixture").join("\n");
    expect(validateClaimRegistry(input).ok).toBe(true);
    input.citations[0].quote += " extra";
    expect(codes(input)).toContainEqual({ code: "quote-too-long", path: "citations[0].quote" });
    input.citations[0].quote = " "; input.citations[0].claim = "";
    expect(codes(input)).toContainEqual({ code: "invalid-field", path: "citations[0].quote" });
    expect(codes(input)).toContainEqual({ code: "invalid-field", path: "citations[0].claim" });
  });
});

describe("commit-relative freshness and strict dates", () => {
  it.each(["2026-02-29", "2025-04-31", "2026-9-01", "2026-09-01T00:00:00Z", "0000-01-01", "not a date"])("rejects non-calendar access date %s", (value) => {
    expect(codes(accessed(fixture(), value))).toContainEqual({ code: "invalid-date", path: "citations[0].access_date" });
  });
  it("uses only the supplied commit date, accepts leap dates and rejects future access or review", () => {
    const input = accessed(fixture(), "2024-02-29"); input.commitDate = "2024-03-01";
    input.claims[0] = { ...input.claims[0], reviewed_on: "2024-03-01" };
    vi.useFakeTimers(); vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    try { expect(validateClaimRegistry(input).ok).toBe(true); } finally { vi.useRealTimers(); }
    input.commitDate = "2024-02-28";
    expect(codes(input)).toContainEqual({ code: "future-date", path: "citations[0].access_date" });
    expect(codes(input)).toContainEqual({ code: "future-date", path: "claims[0].reviewed_on" });
    input.commitDate = "2024-02-30";
    expect(codes(input)).toContainEqual({ code: "invalid-date", path: "commitDate" });
  });
  it.each(["registry", "statute"] as const)("expires %s at exactly365 days, not on the rebuild date", (type) => {
    const input = accessed(fixture(type), "2025-09-07"); expect(validateClaimRegistry(input).ok).toBe(true);
    accessed(input, "2025-09-06");
    expect(codes(input)).toContainEqual({ code: "stale-citation", path: "citations[0].access_date" });
  });
  it.each(["pmid", "doi", "regulator", "dataset"] as const)("expires ordinary %s at exactly730 days", (type) => {
    const input = accessed(fixture(type), "2024-09-07"); expect(validateClaimRegistry(input).ok).toBe(true);
    accessed(input, "2024-09-06");
    expect(codes(input)).toContainEqual({ code: "stale-citation", path: "citations[0].access_date" });
  });
  it.each(["refusalClaimIds", "societyPositionClaimIds"] as const)("uses explicit %s classification for365-day freshness", (key) => {
    const input = accessed(fixture(), "2025-09-06"); expect(validateClaimRegistry(input).ok).toBe(true);
    input[key] = ["fixture.claim"];
    expect(codes(input)).toContainEqual({ code: "stale-citation", path: "citations[0].access_date" });
    input[key] = ["unknown"];
    expect(codes(input)).toContainEqual({ code: "unknown-claim", path: `${key}[0]` });
  });
  it("does not mislabel society literature as a statute", () => {
    const input = fixture("statute"); input.societyPositionClaimIds = ["fixture.claim"];
    expect(codes(input)).toContainEqual({ code: "society-source-type", path: "claims[0].evidence" });
  });
});

describe("evidence and rendered corpus closure", () => {
  it("rejects zero support, missing support detail, repeated or unresolved citations", () => {
    const input = fixture(); input.claims[0] = { ...input.claims[0], evidence: [] };
    expect(codes(input)).toContainEqual({ code: "zero-support", path: "claims[0].evidence" });
    const evidence = fixture().claims[0].evidence[0];
    input.claims[0] = { ...input.claims[0], evidence: [evidence, evidence, { ...evidence, citation: "missing", what_it_supports: "" }] };
    expect(codes(input)).toContainEqual({ code: "duplicate-evidence", path: "claims[0].evidence[1].citation" });
    expect(codes(input)).toContainEqual({ code: "unknown-citation", path: "claims[0].evidence[2].citation" });
    expect(codes(input)).toContainEqual({ code: "invalid-field", path: "claims[0].evidence[2].what_it_supports" });
  });
  it("checks evidence URL and exact access-date parity", () => {
    const input = fixture(); input.claims[0] = { ...input.claims[0], evidence: [{ ...input.claims[0].evidence[0], doi_or_url: "https://example.invalid/other", accessed_on: "2026-09-02" }] };
    expect(codes(input)).toContainEqual({ code: "evidence-url-mismatch", path: "claims[0].evidence[0].doi_or_url" });
    expect(codes(input)).toContainEqual({ code: "evidence-date-mismatch", path: "claims[0].evidence[0].accessed_on" });
  });
  it("rejects unused citations and claims, and unresolved rendered ids", () => {
    const input = fixture(); input.citations.push({ ...input.citations[0], id: "fixture.unused" }); input.corpus = [{ claimId: "missing", text: "missing", surface: "fixture.surface" }];
    expect(codes(input)).toContainEqual({ code: "orphan-citation", path: "citations[1].id" });
    expect(codes(input)).toContainEqual({ code: "orphan-claim", path: "claims[0].claim_id" });
    expect(codes(input)).toContainEqual({ code: "unknown-claim", path: "corpus[0].claimId" });
  });
  it("requires exact text and declared surfaces, including every stated surface", () => {
    const input = fixture(); input.claims[0] = { ...input.claims[0], surfaces: ["fixture.surface", "fixture.email"] };
    input.corpus = [{ claimId: "fixture.claim", text: "A paraphrase does not pass.", surface: "fixture.undeclared" }];
    expect(codes(input)).toContainEqual({ code: "corpus-text-mismatch", path: "corpus[0].text" });
    expect(codes(input)).toContainEqual({ code: "corpus-surface-mismatch", path: "corpus[0].surface" });
    expect(codes(input)).toContainEqual({ code: "unused-surface", path: "claims[0].surfaces[1]" });
  });
  it("permits the identical claim on multiple declared surfaces without duplicate records", () => {
    const input = fixture(); input.claims[0] = { ...input.claims[0], surfaces: ["fixture.surface", "fixture.email"] };
    input.corpus = [...input.corpus, { ...input.corpus[0], surface: "fixture.email" }];
    expect(validateClaimRegistry(input).ok).toBe(true);
  });
});
