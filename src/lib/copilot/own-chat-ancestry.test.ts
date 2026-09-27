import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), collision: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.collision }) }) }) }) }) }));
import { readOwnChatAncestry } from "./own-chat-ancestry";
import { capturedAncestryResult, ownChatAncestryReceiptSchema, OWN_ANCESTRY_HREF } from "./own-chat-ancestry-content";
import { capturedChatCitations, ownChatCitationSchema, type OwnChatProjection } from "./own-chat-content";
import type { OwnCopilotAuthority } from "./own-provider-authority";
import { computeOwnAncestryContentV3, SEVEN_OWN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content-v3";
import { computeOwnAncestryContent, CURRENT_OWN_ANCESTRY_PANEL, type OwnAncestryCall } from "../uploads/own-ancestry-content";
import { parseVcf } from "../genome/parsers/vcf";
import { presentRegionalShares } from "../ancestry/regional-present";
import { presentShares } from "../ancestry/present";
import { REGIONAL_AIMS } from "../genome/regional-admixture";
import { checkResponse, type AllowedNumerals } from "./guard";
import allowed from "../../../config/allowed-numerals.json";

const fileId = "81000000-0000-4000-8000-000000000001", subjectId = "81000000-0000-4000-8000-000000000002";
const source = { fileId, subjectId, sourceRevision: 1, sourceSha256: "a".repeat(64), normalizedAt: "2026-09-15T00:00:00Z",
  normalizedBuild: "GRCh38" as const, callEncoding: "vcf-literal" as const };
const authority = { accountId: "81000000-0000-4000-8000-000000000003", sessionId: "81000000-0000-4000-8000-000000000004", subjectId } as OwnCopilotAuthority;
const content = computeOwnAncestryContentV3({ source, panel: SEVEN_OWN_ANCESTRY_PANEL, calls: [] });
const receipt = { fileId, runId: "81000000-0000-4000-8000-000000000005", resultHash: "c".repeat(64), completedAt: "2026-09-15T00:01:00Z", content };
const projection: OwnChatProjection = { sources: [{ id: fileId, revision: 1, sha256: source.sourceSha256,
  decodedSha256: "b".repeat(64), objectId: "81000000-0000-4000-8000-000000000006", normalizedAt: source.normalizedAt, build: "GRCh38",
  completed: [{ purpose: "ancestry", authority: { grantId: "81000000-0000-4000-8000-000000000007", grantRevision: 1 },
    runId: receipt.runId, completedAt: receipt.completedAt, resultHash: receipt.resultHash }] }], legacySources: [], unavailableSources: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.collision.mockResolvedValue({ data: null, error: null });
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
});

describe("exact captured ancestry read", () => {
  it("passes the same immutable authority, projection and selected file to the narrow reader", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    expect(await readOwnChatAncestry(authority, projection, check)).toEqual([receipt]);
    expect(mocks.rpc.mock.calls).toEqual([["own_copilot_ancestry_v1", { p_account_id: authority.accountId,
      p_session_id: authority.sessionId, p_subject_id: subjectId, p_authority: authority, p_projection: projection, p_file_id: fileId }]]);
    expect(check).toHaveBeenCalledTimes(5);
  });
  it("never reads an unselected or incomplete ancestry purpose", async () => {
    const noAncestry = { ...projection, sources: [{ ...projection.sources[0], completed: [] }] };
    expect(await readOwnChatAncestry(authority, noAncestry, async () => {})).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["fileId", "runId", "resultHash", "completedAt"] as const)("rejects a changed captured %s", async field => {
    const changed = field === "resultHash" ? "d".repeat(64) : field === "completedAt" ? "2026-09-15T00:02:00Z" : subjectId;
    mocks.rpc.mockResolvedValue({ data: { ...receipt, [field]: changed }, error: null });
    await expect(readOwnChatAncestry(authority, projection, async () => {})).rejects.toThrow();
  });
  it.each(["fileId", "subjectId", "sourceRevision", "sourceSha256", "normalizedAt"] as const)("rejects mismatched content source %s", async field => {
    const changed = field === "sourceRevision" ? 2 : field === "sourceSha256" ? "d".repeat(64)
      : field === "normalizedAt" ? "2026-09-15T00:02:00Z" : "81000000-0000-4000-8000-000000000099";
    mocks.rpc.mockResolvedValue({ data: { ...receipt, content: { ...content, source: { ...source, [field]: changed } } }, error: null });
    await expect(readOwnChatAncestry(authority, projection, async () => {})).rejects.toThrow();
  });
  it.each(["purpose withdrawn", "purpose regranted", "source changed", "original retired", "capture replaced", "provider changed"])("discards a returned capture after %s", async cause => {
    let changed = false;
    mocks.rpc.mockImplementation(async () => { changed = true; return { data: receipt, error: null }; });
    await expect(readOwnChatAncestry(authority, projection, async () => { if (changed) throw new Error(cause); })).rejects.toThrow(cause);
  });
  it("does not read a capture when the initial live check is refused", async () => {
    await expect(readOwnChatAncestry(authority, projection, async () => { throw new Error("not_found"); })).rejects.toThrow();
    expect(mocks.collision).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: { slug: "inherit:ancestry" }, error: null }, { data: null, error: new Error("unavailable") }])("refuses a current catalog collision or failed collision read", async response => {
    mocks.collision.mockResolvedValue(response);
    await expect(readOwnChatAncestry(authority, projection, async () => {})).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("never accepts content alongside a database refusal", async () => {
    mocks.rpc.mockResolvedValue({ data: receipt, error: new Error("not_found") });
    await expect(readOwnChatAncestry(authority, projection, async () => {})).rejects.toThrow();
  });
});

async function fixtureCalls(name: string): Promise<OwnAncestryCall[]> {
  const text = await readFile(`e2e/fixtures/${name}`, "utf8");
  async function* lines() { yield* text.split(/\r?\n/); }
  const parsed = await parseVcf(lines());
  return [...(parsed.observedCalls ?? []).map(r => ({ file_id: fileId, chrom: r.chrom, pos: r.pos,
    ref: r.ref, alt: r.alt, genotype: r.genotype, usable: r.usable })),
    ...parsed.records.filter(r => r.chrom >= 24).map(r => ({ file_id: fileId, chrom: r.chrom, pos: r.pos,
      ref: r.ref, alt: r.alt, genotype: r.genotype, usable: true }))];
}

describe("ancestry page and Copilot display agreement", () => {
  it.each(["merged", "separate"])("retains the %s seven-region page values and recorded decision", async kind => {
    const saved = computeOwnAncestryContentV3({ source, panel: SEVEN_OWN_ANCESTRY_PANEL,
      calls: await fixtureCalls(`aims-regional-${kind}-grch38.vcf`) });
    const before = JSON.stringify(saved), result = capturedAncestryResult({ ...receipt, content: saved });
    const page = presentRegionalShares(saved.admixture.result);
    expect(result.status).toBe("available");
    expect(result.merged).toBe(kind === "merged");
    expect(result.regions.map(r => [r.code, r.percent])).toEqual(page.rows.map(r => [r.code, Math.round(r.share * 1000) / 10]));
    expect(result.split.map(r => [r.code, r.percent])).toEqual(page.split.map(r => [r.code, Math.round(r.share * 1000) / 10]));
    expect(result.regions.every(r => "unavailable" in r.range && r.range.unavailable)).toBe(true);
    expect(result.reportingCaveat).toBe(saved.admixture.result.reporting.caveat);
    expect(result.note).toBe(saved.admixture.support_note);
    expect(JSON.stringify(saved)).toBe(before);
    const { name, percent } = result.regions[0];
    expect(checkResponse(`${name}: ${percent}%.`, [result], allowed as AllowedNumerals, { scope: "self" })).toEqual({ ok: true });
    expect(checkResponse("The estimate is 97.531729%.", [result], allowed as AllowedNumerals, { scope: "self" })).toMatchObject({ ok: false, violation: "unsupported-number" });
  });
  it("withholds partial shares even though the captured fit has numeric estimates", () => {
    const marker = REGIONAL_AIMS[0];
    const partial = computeOwnAncestryContentV3({ source, panel: SEVEN_OWN_ANCESTRY_PANEL,
      calls: [{ file_id: fileId, chrom: marker.chrom, pos: marker.pos38, ref: marker.ref, alt: marker.alt,
        genotype: `${marker.ref}/${marker.alt}`, usable: true }] });
    expect(partial.admixture.result.proportions).not.toBeNull();
    expect(capturedAncestryResult({ ...receipt, content: partial })).toMatchObject({ status: "partial", regions: [], split: [], markersRead: 1, markersRequired: 168 });
    expect(capturedAncestryResult(receipt)).toMatchObject({ status: "not_covered", regions: [], split: [] });
  });
  it("keeps available historical five-region results at their original resolution", async () => {
    const saved = computeOwnAncestryContent({ source, panel: CURRENT_OWN_ANCESTRY_PANEL, calls: await fixtureCalls("aims-mixed-grch38.vcf") });
    const result = capturedAncestryResult({ ...receipt, content: saved });
    expect(result.status).toBe("available");
    expect(result.resolution).toBe("five-broad-regions");
    expect(result.regions.map(r => [r.code, r.percent])).toEqual(presentShares(saved.admixture.result).rows.map(r => [r.region.code, r.tenths / 10]));
    expect(result).not.toHaveProperty("reportingCaveat");
  });
  it("retains captured lineages without inventing a revision-one call", async () => {
    const saved = computeOwnAncestryContentV3({ source, panel: SEVEN_OWN_ANCESTRY_PANEL, calls: [],
      lineageCalls: (await fixtureCalls("lineage-grch38.vcf")).filter(r => r.chrom >= 24) });
    const lineages = capturedAncestryResult({ ...receipt, content: saved }).lineages;
    expect(lineages.map(r => (r.result as { haplogroup: string }).haplogroup)).toEqual(["K1", "I2"]);
    const historical = computeOwnAncestryContent({ source, panel: CURRENT_OWN_ANCESTRY_PANEL, calls: [] });
    const oldest = ownChatAncestryReceiptSchema.parse({ ...receipt, content: { ...historical, schemaVersion: 1, computationRevision: "own-ancestry-content-v1",
      lineages: ["mtdna", "ydna"].map(kind => ({ kind, state: "unavailable", reason: "no_supplied_positions", observedPositions: 0 })) } });
    expect(capturedAncestryResult(oldest).lineages.every(r => r.result === null && r.note === "Lineage has not been computed from this file.")).toBe(true);
  });
  it("allows only the exact ancestry route from a validated captured citation", () => {
    const result = capturedAncestryResult(receipt);
    expect(capturedChatCitations([result])).toEqual([{ id: `ancestry:${fileId}:${receipt.runId}:${receipt.resultHash}`, label: result.title, href: OWN_ANCESTRY_HREF }]);
    expect(capturedChatCitations([{ citations: [{ label: "Invented result", url: OWN_ANCESTRY_HREF }] }])).toEqual([]);
    expect(capturedChatCitations([{ ancestrySnapshot: { ...result.ancestrySnapshot, resultHash: "wrong" } }])).toEqual([]);
    for (const href of ["/genome/another/ancestry", "/genome/me/ancestry?file=other", "/genome/me/ancestry/raw", "https://invented.invalid/ancestry"]) {
      expect(ownChatCitationSchema.safeParse({ id: "capture", label: "Ancestry", href }).success).toBe(false);
    }
    expect(checkResponse("According to https://invented.invalid/paper, this is certain.", [result], allowed as AllowedNumerals)).toMatchObject({ ok: false, violation: "unsupported-citation" });
  });
});
