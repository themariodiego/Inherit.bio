import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CarrierAssertionRow } from "./carrier-assertions";

/**
 * The read order of `/genome/[subject]/carrier` (src/lib/family/own-carrier-read.ts).
 * The database is a recording fake: every table query is captured with its
 * filters, so the test can say what was read, for whom, and that nothing of
 * the person's was read when the rule held nothing this build may show.
 */
const m = vi.hoisted(() => ({ count: vi.fn(), preparing: vi.fn(), candidates: vi.fn(), filter: vi.fn() }));
vi.mock("@/lib/genome/load", () => ({ getSubjectFileCount: m.count, hasFileInPreparation: m.preparing }));
vi.mock("@/lib/genome/own-analysis-access", () => ({ loadOwnAnalysisCandidateFiles: m.candidates, filterOwnAnalysisFiles: m.filter }));

import { readOwnCarrierRows, readOwnCarrierView } from "./own-carrier-read";

const SUBJECT = "88110000-0000-4000-8000-000000000001";
const ACCOUNT = "88110000-0000-4000-8000-000000000002";
const FILE = "88110000-0000-4000-8000-000000000003";
const LEGACY = "88110000-0000-4000-8000-000000000004";
const SHA = "a".repeat(64);
const TEST_LOCAL = true;
const PRODUCTION = false;

const assertion = (overrides: Partial<CarrierAssertionRow> = {}): CarrierAssertionRow => ({
  assertion_id: 11, release_id: "synthetic-unit-own-read", gene_validity_read_on: "2026-09-28", variation_id: 881101,
  condition_id: "SYNTHETIC:8811", condition_name: "Synthetic recessive condition one", gene_symbol: "SYNOWNA",
  inheritance_mode: "autosomal_recessive", penetrance_class: "unestablished", penetrance_citation: null,
  variant_name: "Synthetic change one", classification: "Pathogenic", review_status: "reviewed by expert panel",
  review_stars: 3, last_evaluated: "2024-01-01", chrom: 1, pos: 21_000_000, ref: "A", alt: "G", equivalents: [],
  ...overrides,
});

interface Query { table: string; filters: [string, string, unknown][] }

function fakeDb(tables: Record<string, Record<string, unknown>[]>, rule: unknown, ruleError: unknown = null) {
  const queries: Query[] = [];
  const rpc = vi.fn(async () => ({ data: rule, error: ruleError }));
  const from = (table: string) => {
    const query: Query = { table, filters: [] };
    queries.push(query);
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { query.filters.push(["eq", column, value]); return builder; },
      in: (column: string, value: unknown) => { query.filters.push(["in", column, value]); return builder; },
      order: () => builder,
      range: () => builder,
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        const rows = (tables[table] ?? []).filter((row) => query.filters.every(([kind, column, value]) =>
          kind === "eq" ? row[column] === value : (value as unknown[]).includes(row[column])));
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  };
  return { db: { rpc, from } as never, queries, rpc };
}

const prepared = { id: FILE, status: "stored", single_logical_sample_verified_at: "2026-10-01T00:00:00Z" };
const legacy = { id: LEGACY, status: "annotated", single_logical_sample_verified_at: null };
const files = [
  { id: FILE, build: "GRCh38", sha256: SHA, observed_call_sha256: null, observed_call_version: null,
    single_logical_sample_verified_at: "2026-10-01T00:00:00Z", subject_id: SUBJECT, user_id: ACCOUNT },
  { id: LEGACY, build: "GRCh38", sha256: "b".repeat(64), observed_call_sha256: "c".repeat(64),
    observed_call_version: "vcf-literal-diploid-snp-v1", single_logical_sample_verified_at: null, subject_id: SUBJECT, user_id: ACCOUNT },
];
const variant = (fileId: string, pos: number, genotype: string, extra: Record<string, unknown> = {}) =>
  ({ id: pos, file_id: fileId, chrom: 1, pos, ref: "A", alt: "G", genotype, subject_id: SUBJECT, user_id: ACCOUNT, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  m.count.mockResolvedValue(1);
  m.preparing.mockResolvedValue(false);
  m.candidates.mockResolvedValue([prepared]);
  m.filter.mockImplementation(async (_db, _subject, _purpose, candidates) => candidates);
});

describe("readOwnCarrierRows", () => {
  it("drops every synthetic row unless the build runs the TEST-LOCAL fixture, and reads a refusal or a malformed answer as nothing", async () => {
    const clinvar = assertion({ assertion_id: 99, release_id: "clinvar-2026-09", condition_id: "MONDO:0009061", gene_symbol: "CFTR" });
    expect(await readOwnCarrierRows(fakeDb({}, [assertion(), clinvar]).db, PRODUCTION)).toEqual([clinvar]);
    expect(await readOwnCarrierRows(fakeDb({}, [assertion(), clinvar]).db, TEST_LOCAL)).toHaveLength(2);
    expect(await readOwnCarrierRows(fakeDb({}, [assertion()], { message: "denied" }).db, TEST_LOCAL)).toEqual([]);
    expect(await readOwnCarrierRows(fakeDb({}, [{ ...assertion(), review_stars: 1 }]).db, TEST_LOCAL)).toEqual([]);
    expect(await readOwnCarrierRows(fakeDb({}, "not rows").db, TEST_LOCAL)).toEqual([]);
  });
});

describe("the build flag", () => {
  it("reads the TEST-LOCAL flag the build was started with when the caller passes none", async () => {
    try {
      vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
      expect(await readOwnCarrierRows(fakeDb({}, [assertion()]).db)).toEqual([]);
      vi.stubEnv("INHERIT_TEST_JURISDICTION", "true");
      expect(await readOwnCarrierRows(fakeDb({}, [assertion()]).db), "only the exact value 1 enables it").toEqual([]);
      vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
      expect(await readOwnCarrierRows(fakeDb({}, [assertion()]).db)).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("readOwnCarrierView", () => {
  it("production: a synthetic activation is unavailable, and nothing about the person's files or calls is read", async () => {
    const { db, queries } = fakeDb({ genome_files: files, user_variants: [variant(FILE, 21_000_000, "A/G")] }, [assertion()]);
    expect(await readOwnCarrierView(db, SUBJECT, ACCOUNT, PRODUCTION)).toEqual({ kind: "unavailable", fileCount: 1 });
    expect(m.candidates).not.toHaveBeenCalled();
    expect(m.filter).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("an empty rule is unavailable under TEST-LOCAL too", async () => {
    const { db, queries } = fakeDb({}, []);
    expect(await readOwnCarrierView(db, SUBJECT, ACCOUNT, TEST_LOCAL)).toEqual({ kind: "unavailable", fileCount: 1 });
    expect(queries).toEqual([]);
  });

  it("states the record before reading it: no file, a file in flight, or the choice off", async () => {
    m.candidates.mockResolvedValue([]);
    m.count.mockResolvedValue(0);
    expect(await readOwnCarrierView(fakeDb({}, [assertion()]).db, SUBJECT, ACCOUNT, TEST_LOCAL)).toEqual({ kind: "no-file", fileCount: 0 });
    m.count.mockResolvedValue(1);
    m.preparing.mockResolvedValue(true);
    expect(await readOwnCarrierView(fakeDb({}, [assertion()]).db, SUBJECT, ACCOUNT, TEST_LOCAL)).toEqual({ kind: "preparing", fileCount: 1 });
    m.preparing.mockResolvedValue(false);
    m.candidates.mockResolvedValue([prepared]);
    m.filter.mockResolvedValue([]);
    const off = fakeDb({ genome_files: files }, [assertion()]);
    expect(await readOwnCarrierView(off.db, SUBJECT, ACCOUNT, TEST_LOCAL)).toEqual({ kind: "off", fileCount: 1 });
    expect(off.queries).toEqual([]);
    // The one choice this page needs, under the live grant, legacy files included.
    expect(m.filter).toHaveBeenCalledWith(off.db, SUBJECT, "reports.monogenic", [prepared], { storedResult: false, gateLegacy: true });
  });

  it("reads only the admitted files, only the account's own rows, only at the rule's loci, and checks the grant again after", async () => {
    m.candidates.mockResolvedValue([prepared, legacy]);
    const observedRows = [
      // A prepared source's certified observation, by its own SHA-256.
      { file_id: FILE, source_line: 7, chrom: 1, pos: 21_000_000, ref: "A", alt: "G", genotype: "A/G", usable: true,
        source_sha256: SHA, extraction_version: "vcf-literal-diploid-snp-v1", source_build: "GRCh38", subject_id: SUBJECT, user_id: ACCOUNT },
      // Not certified for this source: never read.
      { file_id: FILE, source_line: 8, chrom: 1, pos: 21_000_000, ref: "A", alt: "G", genotype: "G/G", usable: true,
        source_sha256: "d".repeat(64), extraction_version: "vcf-literal-diploid-snp-v1", source_build: "GRCh38", subject_id: SUBJECT, user_id: ACCOUNT },
    ];
    const { db, queries } = fakeDb({ genome_files: files, user_variants: [variant(FILE, 21_000_000, "A/G"),
      variant(LEGACY, 21_000_000, "A/G"), variant(FILE, 21_000_000, "G/G", { user_id: "someone-else" })],
    report_observed_calls: observedRows }, [assertion()]);
    const view = await readOwnCarrierView(db, SUBJECT, ACCOUNT, TEST_LOCAL);
    expect(view.kind).toBe("result");
    if (view.kind !== "result") return;
    expect(view.conditions).toHaveLength(1);
    expect(view.conditions[0]).toMatchObject({ requiredPositions: 1, checkedPositions: 1,
      finding: { copies: "one copy", genotype: "A/G", assertionId: 11 } });
    for (const query of queries.filter((entry) => entry.table !== "genome_files")) {
      expect(query.filters).toContainEqual(["eq", "subject_id", SUBJECT]);
      expect(query.filters).toContainEqual(["eq", "user_id", ACCOUNT]);
      expect(query.filters).toContainEqual(["in", "file_id", [FILE, LEGACY]]);
      expect(query.filters).toContainEqual(["in", "pos", [21_000_000]]);
      expect(query.filters).toContainEqual(["in", "chrom", [1]]);
    }
    expect(m.filter).toHaveBeenCalledTimes(2);
  });

  it("a grant withdrawn during the read is never a result: off when nothing is left, the narrower set otherwise", async () => {
    m.candidates.mockResolvedValue([prepared, legacy]);
    const tables = { genome_files: files, user_variants: [variant(FILE, 21_000_000, "A/G"), variant(LEGACY, 21_000_000, "G/G")] };
    m.filter.mockResolvedValueOnce([prepared, legacy]).mockResolvedValueOnce([]);
    expect(await readOwnCarrierView(fakeDb(tables, [assertion()]).db, SUBJECT, ACCOUNT, TEST_LOCAL)).toEqual({ kind: "off", fileCount: 1 });

    m.filter.mockReset();
    m.filter.mockResolvedValueOnce([prepared, legacy]).mockResolvedValueOnce([prepared]).mockResolvedValueOnce([prepared]);
    const narrowed = await readOwnCarrierView(fakeDb(tables, [assertion()]).db, SUBJECT, ACCOUNT, TEST_LOCAL);
    // The legacy file's two changed copies were read under authority that ended; only the prepared file counts.
    expect(narrowed).toMatchObject({ kind: "result", conditions: [{ finding: { copies: "one copy" } }] });
  });
});
