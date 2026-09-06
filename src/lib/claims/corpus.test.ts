import { describe, expect, it } from "vitest";
import type { Citation, Claim } from "./registry";
import { auditClaimCorpus, CHROME_KINDS, CORPUS_CHANNELS, type CorpusInput, type ObservedText } from "./corpus";

// Synthetic records only: these do not assert published scientific facts or source review.
const source = (id: string): Citation => ({ id, type: "doi", identifier: `10.1234/${id}`,
  url: `https://doi.org/10.1234/${id}`, archived_path: null, access_date: "2026-09-06",
  quote: "Synthetic quote.", claim: "Synthetic support scope." });
function fixture(): CorpusInput {
  const citations = [source("fixture.a"), source("fixture.b"), source("fixture.other")];
  const claim: Claim = { claim_id: "fixture.claim", text_verbatim: "Synthetic finding in 25% of the fixture.",
    surfaces: CORPUS_CHANNELS.map((name) => `fixture/${name}`), claim_type: "objective",
    evidence: citations.slice(0, 2).map((c) => ({ citation: c.id, doi_or_url: c.url, accessed_on: c.access_date, what_it_supports: "Synthetic scope." })),
    net_impression_note: "Fixture only.", reviewed_on: "2026-09-06", reviewer: "Synthetic reviewer" };
  return {
    contentCommitSha: "a".repeat(40),
    requiredSurfaces: CORPUS_CHANNELS.map((channel) => ({ channel, surface: `fixture/${channel}`, requiresClaimWrapping: true, requiredClaimRegions: [] })),
    observations: CORPUS_CHANNELS.map((channel) => ({ channel, surface: `fixture/${channel}`,
      contentCommitSha: "a".repeat(40), payloadSha256: "b".repeat(64),
      claimRegions: [],
      claims: [{ nodeId: "finding", claimId: claim.claim_id, text: claim.text_verbatim,
        citationIds: ["fixture.a", "fixture.b"], provenance: "citation:fixture.a" }],
      figures: [{ nodeId: "plot", provenance: "computed:fixture/results" }],
      texts: [{ nodeId: "finding", text: claim.text_verbatim, kind: "content", chromeKind: null,
        claimId: claim.claim_id, provenance: "citation:fixture.a", regionIds: [] }],
    })),
    registry: {
      resolveCitation: (id) => citations.find((c) => c.id === id),
      resolveClaim: (id) => id === claim.claim_id ? { claim, citations: citations.slice(0, 2) } : undefined,
    },
    resolveSeed: (table, id) => table === "fixture_rows" && id === "row-1",
    resolveComputed: (module) => module === "fixture/results",
  };
}
const codes = (input: CorpusInput) => auditClaimCorpus(input).issues.map((issue) => issue.code);
const plainText = (changes: Partial<ObservedText> = {}): ObservedText => ({ nodeId: "extra", text: "Synthetic plain text.",
  kind: "content", chromeKind: null, claimId: null, provenance: null, regionIds: [], ...changes });

describe("renderer-supplied claim corpus audit", () => {
  it("audits all four independently required channels and returns exact claim occurrences", () => {
    const input = fixture();
    const result = auditClaimCorpus(input);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.claimOccurrences).toEqual(input.observations.map((s) => ({ surface: s.surface,
      claimId: s.claims[0].claimId, text: s.claims[0].text })));
  });
  it.each(CORPUS_CHANNELS)("refuses missing observed channel %s", (channel) => {
    const input = fixture(); input.observations = input.observations.filter((o) => o.channel !== channel);
    expect(codes(input)).toEqual(expect.arrayContaining(["missing-channel", "missing-surface"]));
  });
  it("refuses an incomplete inventory even when it matches all supplied observations", () => {
    const input = fixture(); input.requiredSurfaces = input.requiredSurfaces.slice(1); input.observations = input.observations.slice(1);
    expect(codes(input)).toContain("missing-channel");
  });
  it("checks every additional route/state surface, not only channel presence", () => {
    const input = fixture(); input.requiredSurfaces = [...input.requiredSurfaces,
      { channel: "email", surface: "fixture/another-template", requiresClaimWrapping: true, requiredClaimRegions: [] }];
    expect(codes(input)).toEqual(["missing-surface"]);
  });
  it("refuses empty inventories and empty observations", () => {
    const input = fixture(); input.requiredSurfaces = []; input.observations = [];
    expect(codes(input)).toContain("empty-corpus");
    expect(auditClaimCorpus(input).ok).toBe(false);
  });
  it("allows a truly empty individual payload but not an all-empty graph", () => {
    const input = fixture(); const last = input.observations[3];
    last.claims = []; last.figures = []; last.texts = [];
    expect(auditClaimCorpus(input).ok).toBe(true);
    for (const o of input.observations) { o.claims = []; o.figures = []; o.texts = []; }
    expect(codes(input)).toContain("empty-corpus");
  });
  it("requires a payload receipt even for a genuinely empty export", () => {
    const input = fixture(); input.observations[3].payloadSha256 = "";
    expect(auditClaimCorpus(input).issues).toContainEqual({ code: "invalid-field", path: "observations[3].payloadSha256" });
  });
  it("does not mistake chrome-only payloads for a populated claim graph", () => {
    const input = fixture();
    for (const o of input.observations) {
      o.claims = []; o.figures = [];
      o.texts = [plainText({ kind: "ui-chrome", chromeKind: "item-count", text: "25" })];
    }
    expect(auditClaimCorpus(input).issues).toContainEqual({ code: "empty-corpus", path: "observations.claims" });
  });
  it("refuses unknown channels and unregistered observed surfaces", () => {
    const input = fixture(); Object.assign(input.observations[0], { channel: "other", surface: "fixture/unknown" });
    expect(codes(input)).toEqual(expect.arrayContaining(["unknown-channel", "unknown-surface", "missing-surface"]));
  });
  it("refuses duplicate inventory and observed surfaces", () => {
    const input = fixture(); input.requiredSurfaces = [...input.requiredSurfaces, input.requiredSurfaces[0]];
    input.observations = [...input.observations, input.observations[0]];
    expect(codes(input).filter((c) => c === "duplicate-surface")).toHaveLength(2);
  });
  it("requires an explicit wrapping policy, not a false default", () => {
    const input = fixture(); Reflect.deleteProperty(input.requiredSurfaces[0], "requiresClaimWrapping");
    expect(codes(input)).toContain("invalid-field");
  });
  it.each(["", "today", "abc123", "A".repeat(40)])("refuses malformed content commit %s", (value) => {
    const input = fixture(); input.contentCommitSha = value;
    expect(codes(input)).toContain("invalid-commit");
  });
  it("rejects stale observations against the supplied content commit, without a clock", () => {
    const input = fixture(); input.observations[1].contentCommitSha = "c".repeat(40);
    expect(auditClaimCorpus(input).issues).toContainEqual({ code: "stale-commit", path: "observations[1].contentCommitSha" });
  });
  it.each(["claims", "figures"] as const)("checks omitted provenance on every %s node", (kind) => {
    const input = fixture(); Reflect.deleteProperty(input.observations[0][kind][0], "provenance");
    expect(codes(input)).toContain("missing-provenance");
  });
  it.each(["fixture.a", "citation:", "seed:fixture_rows", "computed:../escape", " computed:fixture/results", "citation:fixture.a computed:fixture/results"])("rejects nonliteral provenance %s", (value) => {
    const input = fixture(); input.observations[0].figures[0].provenance = value;
    expect(codes(input)).toContain("invalid-provenance");
  });
  it.each([
    ["citation:fixture.missing", "unknown-citation"], ["seed:fixture_rows/missing", "unknown-seed"],
    ["computed:fixture/unknown", "unknown-module"],
  ])("resolves actual provenance targets: %s", (value, code) => {
    const input = fixture(); input.observations[0].figures[0].provenance = value;
    expect(codes(input)).toContain(code);
  });
  it("accepts an actual seeded row and calls resolvers with exact unprefixed identifiers", () => {
    const input = fixture(); const calls: string[][] = [];
    input.resolveSeed = (table, id) => { calls.push([table, id]); return true; };
    input.observations[0].figures[0].provenance = "seed:fixture_rows/row-1";
    expect(auditClaimCorpus(input).ok).toBe(true);
    expect(calls).toEqual([["fixture_rows", "row-1"]]);
  });
  it("fails closed when a resolver throws without exposing exception contents", () => {
    const input = fixture(); input.resolveComputed = () => { throw new Error("Private diagnostic details"); };
    const result = auditClaimCorpus(input);
    expect(result.issues.some((i) => i.code === "resolver-failed")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Private diagnostic details");
  });
  it("requires a strict true seed/module existence answer, not a truthy promise", () => {
    const input = fixture(); input.resolveComputed = (() => Promise.resolve(true)) as unknown as CorpusInput["resolveComputed"];
    expect(codes(input)).toContain("unknown-module");
  });
  it("rejects unknown claims and non-verbatim claim text", () => {
    const input = fixture(); input.observations[0].claims[0].claimId = "fixture.unknown";
    input.observations[1].claims[0].text = "Different synthetic text.";
    expect(codes(input)).toEqual(expect.arrayContaining(["unknown-claim", "wrong-claim-text"]));
  });
  it("requires the claim to be registered for the observed surface", () => {
    const input = fixture(); input.requiredSurfaces = input.requiredSurfaces.map((s, i) => i ? s : { ...s, surface: "fixture/new" });
    input.observations[0].surface = "fixture/new";
    expect(codes(input)).toContain("wrong-claim-surface");
  });
  it.each([[], ["fixture.a"], ["fixture.a", "fixture.other"], ["fixture.a", "fixture.a", "fixture.b"], ["fixture.a", "fixture.missing"]].map((ids) => ({ ids })))("requires the full exact registered citation set $ids", ({ ids }) => {
    const input = fixture(); input.observations[0].claims[0].citationIds = ids;
    expect(auditClaimCorpus(input).ok).toBe(false);
    expect(codes(input)).toContain("wrong-citation");
  });
  it("binds citation provenance to the claim, not merely any resolvable citation", () => {
    const input = fixture(); input.observations[0].claims[0].provenance = "citation:fixture.other";
    expect(codes(input)).toContain("wrong-citation");
  });
  it("requires a complete text observation for every claim block", () => {
    const input = fixture(); input.observations[0].texts = [];
    expect(codes(input)).toContain("missing-claim-text");
  });
  it("rejects text pretending to belong to an unobserved claim", () => {
    const input = fixture(); input.observations[0].texts.push(plainText({ claimId: "fixture.claim" }));
    expect(codes(input)).toContain("wrong-text-binding");
  });
  it("checks figure and claim provenance agree when they describe the same node", () => {
    const input = fixture(); input.observations[0].figures[0].nodeId = "finding";
    expect(codes(input)).toContain("wrong-text-binding");
  });
  it("rejects unwrapped designated prose even without a number", () => {
    const input = fixture(); input.observations[0].texts.push(plainText());
    expect(codes(input)).toContain("unwrapped-text");
  });
  it.each(["25%", "25 percent", "2x", "2×", "2-fold", "1 in 20"])("detects unwrapped numeric claims outside designated prose too: %s", (number) => {
    const input = fixture(); input.requiredSurfaces = input.requiredSurfaces.map((s) => ({ ...s, requiresClaimWrapping: false }));
    input.observations[0].texts.push(plainText({ text: `Synthetic ${number} finding.` }));
    expect(codes(input)).toContain("unwrapped-number");
  });
  it.each(CHROME_KINDS)("allows only explicit non-claim chrome numerals: %s", (chromeKind) => {
    const input = fixture(); input.observations[0].texts.push(plainText({ kind: "ui-chrome", chromeKind, text: "25" }));
    expect(auditClaimCorpus(input).ok).toBe(true);
  });
  it("rejects arbitrary UI-chrome exemptions and chrome carrying a claim", () => {
    const input = fixture(); Object.assign(input.observations[0].texts[0], { kind: "ui-chrome", chromeKind: "other" });
    expect(codes(input)).toEqual(expect.arrayContaining(["invalid-field", "chrome-claim"]));
  });
  it.each(["computed:fixture/results", "seed:fixture_rows/row-1"])("allows direct user values with resolved provenance: %s", (provenance) => {
    const input = fixture(); input.observations[0].texts.push(plainText({ kind: "user-value", text: "25%", provenance }));
    expect(auditClaimCorpus(input).ok).toBe(true);
  });
  it.each([null, "citation:fixture.a", "computed:fixture/unknown"])("refuses falsely exempt user values: %s", (provenance) => {
    const input = fixture(); input.observations[0].texts.push(plainText({ kind: "user-value", text: "25%", provenance }));
    expect(auditClaimCorpus(input).ok).toBe(false);
  });
  it("rejects duplicate text, claim and figure IDs within their observation lists", () => {
    const input = fixture(); const o = input.observations[0];
    o.texts.push({ ...o.texts[0] }); o.claims.push({ ...o.claims[0] }); o.figures.push({ ...o.figures[0] });
    expect(codes(input).filter((c) => c === "duplicate-node")).toHaveLength(3);
  });
  it.each([null, undefined, [], {}])("reports malformed supplied options: %j", (value) => {
    expect(auditClaimCorpus(value as unknown as CorpusInput).ok).toBe(false);
  });
  it("does not mutate caller observations or depend on the wall clock", () => {
    const input = fixture(); const before = JSON.stringify(input.observations);
    expect(auditClaimCorpus(input)).toEqual(auditClaimCorpus(input));
    expect(JSON.stringify(input.observations)).toBe(before);
  });

  function regionalFixture(): CorpusInput {
    const input = fixture();
    input.requiredSurfaces = input.requiredSurfaces.map((s) => ({ ...s, requiresClaimWrapping: false, requiredClaimRegions: ["report-body"] }));
    for (const surface of input.observations) {
      surface.claimRegions = [{ regionId: "report-body", nodeId: "body" }];
      surface.texts[0].regionIds = ["report-body"];
      surface.texts.push(plainText({ text: "Go to settings" }));
    }
    return input;
  }
  it("scopes prose wrapping to independently required bodies without citing ordinary navigation", () => {
    expect(auditClaimCorpus(regionalFixture()).ok).toBe(true);
  });
  it("still rejects numeric claims in navigation outside designated regions", () => {
    const input = regionalFixture(); input.observations[0].texts[1].text = "Synthetic 25% finding";
    expect(codes(input)).toContain("unwrapped-number");
  });
  it("requires prose wrappers inside a required region even with no number", () => {
    const input = regionalFixture(); input.observations[0].texts.push(plainText({ nodeId: "uncited", regionIds: ["report-body"] }));
    expect(codes(input)).toContain("unwrapped-text");
  });
  it("refuses a missing required region instead of accepting an incomplete capture", () => {
    const input = regionalFixture(); input.observations[0].claimRegions = [];
    expect(codes(input)).toEqual(expect.arrayContaining(["missing-region", "unknown-region"]));
  });
  it("refuses an empty placeholder for the required region", () => {
    const input = regionalFixture(); input.observations[0].texts[0].regionIds = [];
    expect(codes(input)).toContain("empty-region");
  });
  it("refuses an undeclared region even if its prose is fully cited", () => {
    const input = regionalFixture(); input.observations[0].claimRegions.push({ regionId: "extra", nodeId: "extra" });
    input.observations[0].texts[0].regionIds.push("extra");
    expect(codes(input)).toContain("unknown-region");
  });
  it("supports declared nested regions and validates every membership", () => {
    const input = regionalFixture(); input.requiredSurfaces[0].requiredClaimRegions.push("nested");
    input.observations[0].claimRegions.push({ regionId: "nested", nodeId: "inner" });
    input.observations[0].texts[0].regionIds.push("nested");
    expect(auditClaimCorpus(input).ok).toBe(true);
    input.observations[0].texts[0].regionIds.push("absent");
    expect(codes(input)).toContain("unknown-region");
  });
  it("refuses duplicate region definitions, node aliases and memberships", () => {
    const input = regionalFixture(); input.requiredSurfaces[0].requiredClaimRegions.push("report-body");
    input.observations[0].claimRegions.push({ regionId: "report-body", nodeId: "other" });
    input.observations[0].claimRegions.push({ regionId: "alias", nodeId: "body" });
    input.observations[0].texts[0].regionIds.push("report-body");
    expect(codes(input).filter((c) => c === "duplicate-region")).toHaveLength(4);
  });
  it("requires explicit region arrays instead of treating omissions as out-of-scope", () => {
    const input = regionalFixture(); Reflect.deleteProperty(input.requiredSurfaces[0], "requiredClaimRegions");
    Reflect.deleteProperty(input.observations[1], "claimRegions"); Reflect.deleteProperty(input.observations[2].texts[0], "regionIds");
    expect(codes(input).filter((c) => c === "invalid-shape")).toHaveLength(3);
  });
});
