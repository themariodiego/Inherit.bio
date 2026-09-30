import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../genome/load";
import type { CarrierAssertionRow } from "./carrier-assertions";
import { resolveCanonicalCarrierPair } from "./carrier-canonical";

/**
 * The Portrait carrier read over two prepared sources
 * (docs/carrier-importer-design.md, point 8). Everything that decides what
 * may be read sits in `family_portrait_carrier_calls_v1`; this module must
 * pass only the page's own session and receipt, refuse any answer that is not
 * exactly for the pair it asked about, and read each file by exact allele.
 */
const m = vi.hoisted(() => ({ actor: vi.fn(), rpc: vi.fn(), sex: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: m.actor }));
vi.mock("../uploads/own-upload-context", () => ({ currentOwnUploadAccount: m.actor }));

const ACTOR = { accountId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" };
const A = "33333333-3333-4333-8333-333333333333", B = "44444444-4444-4444-8444-444444444444";
const FILE_A = "55555555-5555-4555-8555-555555555555", FILE_B = "66666666-6666-4666-8666-666666666666";
const RECEIPT = "a".repeat(64);
const request = { pairId: "77777777-7777-4777-8777-777777777777", counterpartAccountId: B, receipt: RECEIPT };
const db = { rpc: (...args: unknown[]) => m.rpc(...args) } as unknown as Db;

const F508: CarrierAssertionRow = {
  assertion_id: 11, release_id: "clinvar-2026-09", gene_validity_read_on: "2026-09-28", variation_id: 7105,
  condition_id: "MONDO:0009061", condition_name: "Cystic fibrosis", gene_symbol: "CFTR", inheritance_mode: "autosomal_recessive",
  penetrance_class: "unestablished", penetrance_citation: null,
  variant_name: "NM_000492.3(CFTR):c.1521_1523del (p.Phe508del)", classification: "Pathogenic",
  review_status: "practice guideline", review_stars: 4, last_evaluated: "2004-03-03",
  chrom: 7, pos: 117_559_590, ref: "ATCT", alt: "A", equivalents: [[117_559_591, "TCTT", "T"]],
};
const measured = { status: "measured", reason: null, totalBases: 1_000_000, coveredBases: 2_800_000_000, fraction: 0.0004 };
const side = (subjectId: string, fileId: string, variants: unknown[], runs: unknown = measured) =>
  ({ subjectId, source: { fileId, runs, variants, observed: [] } });
const answer = (overrides: Record<string, unknown> = {}) => ({
  receipt: RECEIPT,
  assertions: [F508],
  a: side(A, FILE_A, [{ chrom: 7, pos: 117_559_590, ref: "ATCT", alt: "A", genotype: "A/ATCT" }]),
  // The other person's file writes the same deletion at its right-shifted spelling.
  b: side(B, FILE_B, [{ chrom: 7, pos: 117_559_591, ref: "TCTT", alt: "T", genotype: "T/TCTT" }]),
  ...overrides,
});
const read = () => resolveCanonicalCarrierPair(db, request, { dataSubjectId: A, displayLabel: "You" },
  { dataSubjectId: B, displayLabel: "Another adult" }, m.sex);

beforeEach(() => {
  vi.clearAllMocks();
  m.actor.mockResolvedValue(ACTOR);
  m.rpc.mockResolvedValue({ data: answer(), error: null });
  m.sex.mockResolvedValue(new Map());
});

describe("resolveCanonicalCarrierPair", () => {
  it("passes only the page's session, pair and receipt, and reads a shared carrier state by exact allele", async () => {
    const result = await read();
    expect(m.rpc).toHaveBeenCalledOnce();
    expect(m.rpc).toHaveBeenCalledWith("family_portrait_carrier_calls_v1", { p_account_id: ACTOR.accountId,
      p_session_id: ACTOR.sessionId, p_pair_id: request.pairId, p_counterpart_account_id: B, p_expected: RECEIPT });
    expect(result?.summary).toMatchObject({ classifiedPositions: 1, positionsBothCover: 1,
      checkedFileIds: { a: [FILE_A], b: [FILE_B] }, runsInputFileIds: { a: [FILE_A], b: [FILE_B] } });
    expect(result?.summary.genotypes.a.get(11)).toBe("A/ATCT");
    expect(result?.summary.genotypes.b.get(11)).toBe("A/ATCT");
    expect(result?.summary.matches).toEqual([expect.objectContaining({ kind: "probability", probability: 0.25 })]);
    expect(result?.refVariants[0].evidence).toMatchObject({ releaseId: "clinvar-2026-09", reviewStars: 4 });
    expect(m.sex).toHaveBeenCalledWith([A, B]);
  });

  it("never answers without the signed-in session", async () => {
    m.actor.mockResolvedValue(null);
    expect(await read()).toBeNull();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a refused read", { data: null, error: { message: "family_portrait_source_changed" } }],
    ["an answer for another receipt", { data: answer({ receipt: "b".repeat(64) }), error: null }],
    ["an answer about other people", { data: answer({ a: side(B, FILE_B, []), b: side(A, FILE_A, []) }), error: null }],
    ["an answer with a field this module does not know", { data: { ...answer(), extra: true }, error: null }],
    ["an assertion below the bar", { data: answer({ assertions: [{ ...F508, review_stars: 1 }] }), error: null }],
    ["an assertion that is not pathogenic", { data: answer({ assertions: [{ ...F508, classification: "Uncertain significance" }] }), error: null }],
  ])("returns null, never an empty result, for %s", async (_name, response) => {
    m.rpc.mockResolvedValue(response);
    expect(await read()).toBeNull();
    expect(m.sex).not.toHaveBeenCalled();
  });

  it("states no reviewed position, without reading anyone's sex, when the rule holds nothing", async () => {
    m.rpc.mockResolvedValue({ data: answer({ assertions: [] }), error: null });
    const result = await read();
    expect(result?.summary).toMatchObject({ classifiedPositions: 0, matches: [] });
    expect(m.sex).not.toHaveBeenCalled();
  });

  it("gives no chance when either file's runs were never measured", async () => {
    m.rpc.mockResolvedValue({ data: answer({ b: side(B, FILE_B,
      [{ chrom: 7, pos: 117_559_590, ref: "ATCT", alt: "A", genotype: "A/ATCT" }],
      { status: null, reason: null, totalBases: null, coveredBases: null, fraction: null }) }), error: null });
    const result = await read();
    expect(result?.summary.matches).toEqual([expect.objectContaining({ kind: "no-probability", reason: "runs-unchecked" })]);
  });

  it("gives no chance when a file does not report the reviewed position", async () => {
    m.rpc.mockResolvedValue({ data: answer({ b: side(B, FILE_B, []) }), error: null });
    const result = await read();
    expect(result?.summary.positionsBothCover).toBe(0);
    expect(result?.summary.matches.every((match) => match.kind !== "probability")).toBe(true);
  });
});
