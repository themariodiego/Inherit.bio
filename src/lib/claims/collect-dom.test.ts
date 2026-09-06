import { createHash } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectDomSurface } from "./collect-dom";
import { auditClaimCorpus, CORPUS_CHANNELS, type ObservedSurface } from "./corpus";
import type { Citation, Claim } from "./registry";

// Real Chromium DOM, synthetic HTML and metadata only. No app/server or network.
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });
const marker = (id: string, number = 1) => `<sup data-citation-id="${id}"><a href="#source-${id}">${number}</a></sup>`;
const wrapped = (text = "Synthetic finding.", references = marker("fixture.a")) =>
  `<p data-claim data-claim-id="fixture.claim" data-citation-id="fixture.a" data-provenance="citation:fixture.a">${text}${references}</p>`;
async function collect(html: string) {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
  try {
    await page.setContent(html);
    const payload = await page.content();
    return await page.evaluate(collectDomSurface, { surface: "fixture/static-build", channel: "static-build" as const,
      contentCommitSha: "a".repeat(40), payloadSha256: createHash("sha256").update(payload).digest("hex") });
  } finally { await page.close(); }
}
function audit(observation: ObservedSurface, text = "Synthetic finding.", evidence = ["fixture.a"],
  scope = { requiresClaimWrapping: true, requiredClaimRegions: [] as string[] }) {
  const citations: Citation[] = ["fixture.a", "fixture.b"].map((id) => ({ id, type: "doi", identifier: `10.1234/${id}`,
    url: `https://doi.org/10.1234/${id}`, archived_path: null, access_date: "2026-09-06", quote: "Synthetic quote.", claim: "Synthetic support." }));
  const claim: Claim = { claim_id: "fixture.claim", text_verbatim: text, surfaces: CORPUS_CHANNELS.map((channel) => `fixture/${channel}`),
    claim_type: "objective", evidence: evidence.map((id) => ({ citation: id, doi_or_url: `https://doi.org/10.1234/${id}`,
      accessed_on: "2026-09-06", what_it_supports: "Synthetic scope." })), net_impression_note: "Synthetic only.", reviewed_on: "2026-09-06", reviewer: "Synthetic reviewer" };
  return auditClaimCorpus({ contentCommitSha: observation.contentCommitSha,
    requiredSurfaces: CORPUS_CHANNELS.map((channel) => ({ channel, surface: `fixture/${channel}`, ...scope })),
    observations: CORPUS_CHANNELS.map((channel) => ({ ...observation, channel, surface: `fixture/${channel}` })),
    registry: { resolveCitation: (id) => citations.find((c) => c.id === id), resolveClaim: (id) => id === claim.claim_id ? { claim, citations } : undefined },
    resolveSeed: () => false, resolveComputed: (module) => module === "fixture/results",
  });
}

describe("actual rendered DOM collection", () => {
  it("collects canonical singular-citation claims and excludes only genuine reference numerals", async () => {
    const result = await collect(wrapped());
    expect(result.claims).toEqual([{ nodeId: "dom.0", claimId: "fixture.claim", text: "Synthetic finding.",
      citationIds: ["fixture.a"], provenance: "citation:fixture.a" }]);
    expect(result.texts).toEqual([{ nodeId: "dom.0", text: "Synthetic finding.", kind: "content", chromeKind: null,
      claimId: "fixture.claim", provenance: "citation:fixture.a", regionIds: [] }]);
    expect(audit(result).ok).toBe(true);
    expect(result.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("joins nested inline links and emphasis without changing source words or punctuation", async () => {
    const result = await collect(wrapped("Synthetic <a href='#detail'>finding</a> with <strong>25</strong><span>%</span>."));
    expect(result.claims[0].text).toBe("Synthetic finding with 25%.");
    expect(audit(result, "Synthetic finding with 25%.").ok).toBe(true);
  });
  it("finds unwrapped prose and inline-split numeric claims outside wrappers", async () => {
    const result = await collect(`${wrapped()}<p>Unwrapped prose.</p><p>Risk: <span>25</span><b>%</b>.</p>`);
    expect(result.texts.map((t) => t.text)).toEqual(["Synthetic finding.", "Unwrapped prose.", "Risk: 25%."]);
    expect(audit(result).issues.map((i) => i.code)).toEqual(expect.arrayContaining(["unwrapped-text", "unwrapped-number"]));
  });
  it("does not treat the existing figure ClaimBlock container as a canonical source claim", async () => {
    const result = await collect(`${wrapped()}<section data-claim-block='true'><p>Unwrapped finding.</p></section>`);
    expect(result.claims).toHaveLength(1);
    expect(result.texts[1].claimId).toBeNull();
    expect(audit(result).issues.some((i) => i.code === "unwrapped-text")).toBe(true);
  });
  it("collects every figure and rejects its missing provenance", async () => {
    const result = await collect(`${wrapped()}<span data-figure-kind='absolute'>25%</span>`);
    expect(result.figures).toEqual([{ nodeId: "dom.1", provenance: "" }]);
    expect(audit(result).issues.some((i) => i.code === "missing-provenance")).toBe(true);
  });
  it("binds actual computed Figure markup to its own value without guessing from appearance", async () => {
    const result = await collect(`${wrapped()}<span data-figure-kind='absolute' data-provenance='computed:fixture/results'><span data-slot='figure-value'>25</span><span data-slot='figure-unit'>%</span></span>`);
    expect(result.texts[1]).toMatchObject({ text: "25%", kind: "user-value", claimId: null, provenance: "computed:fixture/results" });
    expect(audit(result).ok).toBe(true);
  });
  it("keeps nested canonical claims separate without duplicating child claim text or citations", async () => {
    const result = await collect(`<div data-claim-id='fixture.claim' data-citation-id='fixture.a' data-provenance='citation:fixture.a'>Outer <span>text.</span>${marker("fixture.a")}<p data-claim-id='fixture.child' data-citation-id='fixture.b' data-provenance='citation:fixture.b'>Inner text.${marker("fixture.b", 2)}</p></div>`);
    expect(result.claims.map((c) => [c.text, c.citationIds])).toEqual([["Outer text.", ["fixture.a"]], ["Inner text.", ["fixture.b"]]]);
    expect(result.texts.map((t) => t.text)).toEqual(["Outer text.", "Inner text."]);
  });
  it("supports all additional reference IDs and detects a dropped registered source", async () => {
    const complete = await collect(wrapped("Synthetic finding.", `${marker("fixture.a")}${marker("fixture.b", 2)}`));
    expect(audit(complete, "Synthetic finding.", ["fixture.a", "fixture.b"]).ok).toBe(true);
    expect(audit(await collect(wrapped()), "Synthetic finding.", ["fixture.a", "fixture.b"]).issues.some((i) => i.code === "wrong-citation")).toBe(true);
  });
  it("fails when a declared plural or primary citation has no actual reference", async () => {
    await expect(collect(wrapped("Synthetic finding.", ""))).rejects.toThrow("collect-dom:missing-citation-reference:dom.0");
    await expect(collect(wrapped().replace("data-claim ", "data-citation-ids='fixture.a fixture.b' data-claim "))).rejects.toThrow("missing-citation-reference");
  });
  it("supports the link-carried citation ID inside an actual superscript", async () => {
    const result = await collect(wrapped("Synthetic finding.", "<sup><a data-citation-id='fixture.a' href='#source'>1</a></sup>"));
    expect(audit(result).ok).toBe(true);
  });
  it("does not exempt citation-looking prose, even inside superscript markup", async () => {
    const result = await collect(`${wrapped()}<p data-citation-id='fixture.a'>Unwrapped 25% claim.</p><sup data-citation-id='fixture.a'><a href='#source'>Unwrapped 40% claim.</a></sup>`);
    expect(result.texts.map((t) => t.text)).toEqual(expect.arrayContaining(["Unwrapped 25% claim.", "Unwrapped 40% claim."]));
    expect(audit(result).issues.some((i) => i.code === "unwrapped-number")).toBe(true);
  });
  it("allows genuine explicitly contracted chrome but not visual count styling", async () => {
    const result = await collect(`${wrapped()}<span data-ui-chrome-kind='item-count'>3</span><span data-slot='count' class='tabular-nums'>4</span>`);
    expect(result.texts[1]).toMatchObject({ kind: "ui-chrome", chromeKind: "item-count", text: "3" });
    expect(result.texts[2]).toMatchObject({ kind: "content", chromeKind: null, text: "4" });
    expect(audit(result).issues.some((i) => i.code === "unwrapped-text")).toBe(true);
  });
  it("does not permit a chrome exemption on or inside a claim", async () => {
    const result = await collect(wrapped().replace("data-claim ", "data-ui-chrome-kind='version' data-claim "));
    expect(audit(result).issues.some((i) => i.code === "chrome-claim")).toBe(true);
    const nested = await collect(wrapped("Synthetic finding.<span data-ui-chrome-kind='version'>25%</span>"));
    expect(audit(nested).issues.some((i) => i.code === "chrome-claim")).toBe(true);
  });
  it("rejects arbitrary chrome kinds rather than silently granting an exemption", async () => {
    await expect(collect(`${wrapped()}<span data-ui-chrome-kind='scientific'>25%</span>`)).rejects.toThrow("invalid-chrome-kind");
  });
  it("includes hidden disclosure and accessible screen-reader text while excluding inert program text", async () => {
    const result = await collect(`${wrapped()}<p hidden>Hidden disclosure.</p><span class='sr-only'>Accessible words.</span><script>const number=25;</script><style>.thing {color:red}</style><template>Inert content.</template>`);
    expect(result.texts.map((t) => t.text)).toEqual(["Synthetic finding.", "Hidden disclosure.", "Accessible words."]);
  });
  it("keeps deterministic node IDs and caller receipts without manufacturing digest evidence", async () => {
    const first = await collect(wrapped()), second = await collect(wrapped());
    expect(first).toEqual(second);
    const page = await browser.newPage();
    try {
      await page.setContent(wrapped());
      const result = await page.evaluate(collectDomSurface, { surface: "fixture/static-build", channel: "static-build" as const, contentCommitSha: "a".repeat(40), payloadSha256: "caller-value" });
      expect(result.payloadSha256).toBe("caller-value");
      expect(audit(result).ok).toBe(false);
    } finally { await page.close(); }
  });
  it("fails explicitly for iframe and CSS-generated text instead of claiming complete coverage", async () => {
    await expect(collect(`${wrapped()}<iframe></iframe>`)).rejects.toThrow("unsupported-frame");
    await expect(collect(`${wrapped()}<style>p::after {content:'25%'}</style>`)).rejects.toThrow("unsupported-generated-text");
  });
  it("audits actual claim regions while leaving ordinary outside navigation as non-claim content", async () => {
    const result = await collect(`<nav><a href='#home'>Home</a><button>Open menu</button></nav><main data-claim-region='report-body'>${wrapped()}</main>`);
    expect(result.claimRegions).toEqual([{ regionId: "report-body", nodeId: "dom.1" }]);
    expect(result.texts.filter((t) => t.claimId === null).map((t) => [t.text, t.kind, t.regionIds])).toEqual([
      ["Home", "content", []], ["Open menu", "content", []],
    ]);
    expect(result.texts.find((t) => t.claimId)?.regionIds).toEqual(["report-body"]);
    expect(audit(result, "Synthetic finding.", ["fixture.a"], { requiresClaimWrapping: false, requiredClaimRegions: ["report-body"] }).ok).toBe(true);
  });
  it("fails if independently required prose scope is missing, even with valid claims elsewhere", async () => {
    const result = await collect(`<nav>Home</nav>${wrapped()}`);
    expect(audit(result, "Synthetic finding.", ["fixture.a"], { requiresClaimWrapping: false, requiredClaimRegions: ["report-body"] }).issues.some((i) => i.code === "missing-region")).toBe(true);
  });
  it("still audits numeric prose outside every required region", async () => {
    const result = await collect(`<nav>Unwrapped 25% assertion.</nav><main data-claim-region='report-body'>${wrapped()}</main>`);
    expect(audit(result, "Synthetic finding.", ["fixture.a"], { requiresClaimWrapping: false, requiredClaimRegions: ["report-body"] }).issues.some((i) => i.code === "unwrapped-number")).toBe(true);
  });
  it("splits inline prose scopes so inside text cannot inherit an outside exemption", async () => {
    const result = await collect(`${wrapped()}<p>Outside text. <span data-claim-region='report-body'>Inside unwrapped prose.</span> Outside tail.</p>`);
    expect(result.texts.filter((t) => t.claimId === null).map((t) => [t.text, t.regionIds])).toEqual([
      ["Outside text. Outside tail.", []], ["Inside unwrapped prose.", ["report-body"]],
    ]);
    expect(new Set(result.texts.map((t) => t.nodeId)).size).toBe(result.texts.length);
    expect(audit(result, "Synthetic finding.", ["fixture.a"], { requiresClaimWrapping: false, requiredClaimRegions: ["report-body"] }).issues.some((i) => i.code === "unwrapped-text")).toBe(true);
  });
  it("binds bare canonical claims to inherited nested region IDs", async () => {
    const result = await collect(`<main data-claim-region='outer'><section data-claim-region='inner'>${wrapped().replace("data-claim ", "")}</section></main>`);
    expect(result.texts[0].regionIds).toEqual(["outer", "inner"]);
    expect(audit(result, "Synthetic finding.", ["fixture.a"], { requiresClaimWrapping: false, requiredClaimRegions: ["outer", "inner"] }).ok).toBe(true);
  });
  it("rejects duplicate and empty declared regions through the independent audit", async () => {
    const duplicate = await collect(`<main data-claim-region='report-body'>${wrapped()}</main><div data-claim-region='report-body'>Other text.</div>`);
    const scope = { requiresClaimWrapping: false, requiredClaimRegions: ["report-body"] };
    expect(audit(duplicate, "Synthetic finding.", ["fixture.a"], scope).issues.some((i) => i.code === "duplicate-region")).toBe(true);
    const empty = await collect(`${wrapped()}<main data-claim-region='report-body'>  </main>`);
    expect(audit(empty, "Synthetic finding.", ["fixture.a"], scope).issues.some((i) => i.code === "empty-region")).toBe(true);
  });
  it("does not invent nonempty region evidence from a claim's empty descendant scope", async () => {
    const result = await collect(wrapped("Synthetic finding.<span data-claim-region='report-body'> </span>"));
    expect(result.texts[0].regionIds).toEqual([]);
    expect(audit(result, "Synthetic finding.", ["fixture.a"], { requiresClaimWrapping: false, requiredClaimRegions: ["report-body"] }).issues.some((i) => i.code === "empty-region")).toBe(true);
  });
  it.each(["", " report-body", "report body", "../escape"])("refuses malformed DOM region identifiers: %s", async (region) => {
    await expect(collect(`<main data-claim-region='${region}'>${wrapped()}</main>`)).rejects.toThrow("collect-dom:invalid-region");
  });
});
