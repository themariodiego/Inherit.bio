import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimBlock } from "@/components/figures/claim-block";
import { InputProvenance, type CoverageModule } from "@/components/reports/input-provenance";
import { provenanceAttribute } from "@/lib/figures/contract";
import type { FigureSpec } from "@/lib/figures/spec";
import type { InputSourceView } from "./input-sources";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), sources: vi.fn(), genotypes: vi.fn(), subject: vi.fn(),
  files: vi.fn(), user: vi.fn(), queries: [] as { table: string; filters: unknown[][] }[],
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, from: mocks.from }) }));
// Both pages moved from `resolveSubjectForAccount` to `resolveSubjectRoute`
// on 2026-09-12, so a relative resolves under `raw.browse`. These tests are
// about provenance rather than authority, so the resolver is mocked to the
// own-subject answer it used to give: `person: null`, the My Genome domain,
// and the same subject id the reads are asserted against.
vi.mock("@/lib/family/subject-route", () => ({ resolveSubjectRoute: mocks.subject }));
// `hasFileInPreparation` is false throughout: every case here supplies
// PREPARED files, so nothing is in flight and the two pages take exactly the
// branches they took before the preparing state existed.
vi.mock("@/lib/genome/load", () => ({ getSubjectProcessedFiles: mocks.files, getSubjectFileCount: async () => 2, getSubjectGenotypesByRsid: mocks.genotypes, hasFileInPreparation: async () => false }));
vi.mock("@/lib/genome/prepared-sources", () => ({ getPreparedSourceFiles: mocks.files, getPreparedSourceGenotypes: mocks.genotypes }));
vi.mock("@/lib/genome/input-sources", () => ({ loadInputSources: mocks.sources }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/components/browse/genome-browser", () => ({ GenomeBrowser: () => null }));

import GenomeDataPage from "@/app/(app)/genome/[subject]/data/page";
import BrowserPage from "@/app/(app)/genome/[subject]/data/browser/page";

type ProvenanceProps = {
  sources: InputSourceView[];
  state?: string;
  coverage?: { read: number; needed: number; module?: CoverageModule };
};
function provenance(node: ReactNode): ProvenanceProps[] {
  if (Array.isArray(node)) return node.flatMap(provenance);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  if (node.type === InputProvenance) return [node.props as ProvenanceProps];
  return provenance(node.props.children);
}
/** Every figure the page hands to a <ClaimBlock>, in render order. */
function figures(node: ReactNode): FigureSpec[] {
  if (Array.isArray(node)) return node.flatMap(figures);
  if (!isValidElement<{ children?: ReactNode; figures?: FigureSpec[] }>(node)) return [];
  const own = node.type === ClaimBlock ? (node.props.figures ?? []) : [];
  return [...own, ...figures(node.props.children)];
}
function scoreLabels(node: ReactNode): ReactNode[] {
  if (Array.isArray(node)) return node.flatMap(scoreLabels);
  if (!isValidElement<{ children?: ReactNode; "data-slot"?: string }>(node)) return [];
  return node.props["data-slot"] === "score-input-label" ? [node.props.children] : scoreLabels(node.props.children);
}

function rowsFor(table: string, data: unknown) {
  const call = { table, filters: [] as unknown[][] };
  mocks.queries.push(call);
  const response = { data, error: null };
  const builder = {
    select: (...args: unknown[]) => { call.filters.push(["select", ...args]); return builder; },
    eq: (...args: unknown[]) => { call.filters.push(["eq", ...args]); return builder; },
    in: (...args: unknown[]) => { call.filters.push(["in", ...args]); return builder; },
    ilike: (...args: unknown[]) => { call.filters.push(["ilike", ...args]); return builder; },
    gte: (...args: unknown[]) => { call.filters.push(["gte", ...args]); return builder; },
    lte: (...args: unknown[]) => { call.filters.push(["lte", ...args]); return builder; },
    order: () => builder, limit: () => builder,
    maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] ?? null : data, error: null }),
    then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
  };
  return builder;
}

const reference = { rsid: 762551, chrom: 15, pos38: 74749576, ref: "C", alt: "A", gene_symbol: "CYP1A2" };
const source = (fileId: string): InputSourceView => ({ fileId, fileType: "vcf", processedAt: null, snapshot: null });
const browser = (q: string) => BrowserPage({ params: Promise.resolve({ subject: "me" }), searchParams: Promise.resolve({ q }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queries.length = 0;
  mocks.user.mockResolvedValue({ data: { user: { id: "account" } } });
  mocks.subject.mockResolvedValue({
    kind: "ok", user: { id: "account" },
    subject: { id: "subject", routeSegment: "me", displayLabel: "Self" },
    dataSubjectId: "subject", person: null,
    domain: { label: "My Genome", href: "/genome/me" }, displayLabel: "Self",
  });
  mocks.files.mockResolvedValue([{ id: "newest" }, { id: "older" }]);
  mocks.sources.mockImplementation(async (_db, _subject, ids: string[]) => [...new Set(ids)].map(source));
  mocks.genotypes.mockResolvedValue({ genotypes: new Map([[762551, "A/C"]]), conflicts: new Set(), inputFileIds: ["older"], checkedFileIds: ["newest", "older"], fileCount: 2 });
  mocks.from.mockImplementation((table: string) => rowsFor(table, table === "ref_variants" ? [reference] : [{ chrom: 15, pos: 74749576, ref: "C", alt: "A" }]));
});

describe("expert result input composition", () => {
  it("binds each score's input to its own file instead of borrowing the newest file", async () => {
    mocks.from.mockImplementation((table: string) => rowsFor(table, table === "user_prs"
      ? [{ pgs_id: "PGS1", matched: 2, file_id: "older" }, { pgs_id: "PGS1", matched: 3, file_id: "newest" }]
      : [{ pgs_id: "PGS1", name: "Panel", trait: "Trait", n_variants: 10, ancestry_note: "Panel limits" }]));
    const tree = await GenomeDataPage({ params: Promise.resolve({ subject: "me" }), searchParams: Promise.resolve({}) });
    expect(provenance(tree).map((item) => item.sources.map((s) => s.fileId))).toEqual([["older", "newest"]]);
    expect(scoreLabels(tree)).toEqual(["File 1", "File 2"]);
    const query = mocks.queries.find((item) => item.table === "user_prs");
    expect(query?.filters).toContainEqual(["eq", "subject_id", "subject"]);
    expect(query?.filters).toContainEqual(["in", "file_id", ["newest", "older"]]);
  });

  it("distinguishes rsID table contributors, checked files and the newest-file track", async () => {
    const [table, track] = provenance(await browser("rs762551"));
    expect(table.sources.map((s) => [s.fileId, s.hasResultRecord])).toEqual([["newest", false], ["older", true]]);
    expect(table.state).toBe("recorded");
    expect(table.coverage).toEqual({ read: 1, needed: 1, module: "genome/browser" });
    expect(track.sources.map((s) => s.fileId)).toEqual(["newest"]);
    expect(mocks.sources.mock.calls[0][1]).toBe("subject");
  });

  // src/lib/genome/browser.ts resolves the letters of all three searches and
  // counts the coverage pair; both figures name it, and it exists.
  it("names the module that produced the letters on the genotype and coverage figures", async () => {
    const tree = await browser("rs762551");
    expect(figures(tree).map((spec) => [spec.kind, provenanceAttribute(spec.provenance)])).toEqual([
      ["genotype", "computed:genome/browser"],
    ]);
    const [table] = provenance(tree);
    const html = renderToStaticMarkup(createElement(InputProvenance, {
      subject: { subjectId: "subject" }, sources: table.sources, coverage: table.coverage,
    }));
    expect(html).toContain('data-figure-kind="coverage"');
    expect(html).toContain('data-provenance="computed:genome/browser"');

    mocks.from.mockImplementation((table_: string) => rowsFor(table_, [{ ...reference, pos: 74749576, genotype: "A/C" }]));
    const region = figures(await browser("chr15:74749500-74749600"));
    expect(region.map((spec) => provenanceAttribute(spec.provenance))).toEqual(["computed:genome/browser"]);
  });

  it("keeps file-quality context when a requested rsID is absent", async () => {
    mocks.genotypes.mockResolvedValue({ genotypes: new Map(), conflicts: new Set(), inputFileIds: [], checkedFileIds: ["newest", "older"], fileCount: 2 });
    const [table] = provenance(await browser("rs762551"));
    expect(table.state).toBe("absent");
    expect(table.sources).toHaveLength(2);
    expect(table.sources.every((s) => s.hasResultRecord === false)).toBe(true);
    expect(table.coverage).toBeUndefined();
  });

  it("reports conflicting inputs without treating their letters as covered", async () => {
    mocks.genotypes.mockResolvedValue({ genotypes: new Map(), conflicts: new Set([762551]), inputFileIds: ["newest", "older"], checkedFileIds: ["newest", "older"], fileCount: 2 });
    const [table] = provenance(await browser("rs762551"));
    expect(table.state).toBe("conflict");
    expect(table.coverage).toEqual({ read: 0, needed: 1, module: "genome/browser" });
  });

  it("gene coverage denominator is the returned reference positions, not the whole gene", async () => {
    mocks.from.mockImplementation((table: string) => rowsFor(table, table === "ref_variants" ? [reference, { ...reference, rsid: 1, pos38: 74749577 }] : []));
    const [table] = provenance(await browser("CYP1A2"));
    expect(table.coverage).toEqual({ read: 1, needed: 2, module: "genome/browser" });
    expect(table.sources.find((s) => s.fileId === "older")?.hasResultRecord).toBe(true);
  });

  it("a locus search and track use only the active file, without borrowing another file", async () => {
    mocks.from.mockImplementation((table: string) => rowsFor(table, [{ ...reference, pos: 74749576, genotype: "A/C" }]));
    const blocks = provenance(await browser("chr15:74749500-74749600"));
    expect(blocks.map((item) => item.sources.map((s) => s.fileId))).toEqual([["newest"], ["newest"]]);
    expect(mocks.queries[0].filters).toContainEqual(["eq", "file_id", "newest"]);
    expect(mocks.genotypes).not.toHaveBeenCalled();
  });

  it("an empty locus does not fabricate a coverage denominator or a contributing call", async () => {
    mocks.from.mockImplementation((table: string) => rowsFor(table, []));
    const [table] = provenance(await browser("chr15:74749500-74749600"));
    expect(table.state).toBe("absent");
    expect(table.coverage).toBeUndefined();
    expect(table.sources).toMatchObject([{ fileId: "newest", hasResultRecord: false }]);
  });

  it("does not read input metadata before subject authorization", async () => {
    // `null` became `{ kind: "not-found" }` when this page moved to
    // `resolveSubjectRoute`. The guarantee is unchanged and is the one that
    // matters most on this page: an unresolved subject reads no genetic data
    // at all, rather than reading it and then declining to render it.
    mocks.subject.mockResolvedValue({ kind: "not-found" });
    await expect(browser("rs762551")).rejects.toThrow("not-found");
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reads nothing when the jurisdiction refuses the record", async () => {
    // The refusal branch is new here, and it must behave like the not-found
    // one: refuse before a single genetic read, not after.
    mocks.subject.mockResolvedValue({ kind: "jurisdiction",
      decision: { capability: "third_party_adult_analysis", status: "unreviewed",
        userFacingCopy: "not available", jurisdictionCode: null, source: "unset" } });
    await browser("rs762551");
    expect(mocks.sources).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(["rs762551", "CYP1A2"])("%s labels the search's actual file set when it differs from the outer track snapshot", async (query) => {
    mocks.files.mockResolvedValueOnce([{ id: "newest" }, { id: "older" }])
      .mockResolvedValue([{ id: "just-finished" }, { id: "newest" }, { id: "older" }]);
    mocks.genotypes.mockResolvedValue({ genotypes: new Map([[762551, "A/C"]]), conflicts: new Set(), inputFileIds: ["just-finished"], checkedFileIds: ["just-finished", "older"], fileCount: 2 });
    const [table, track] = provenance(await browser(query));
    expect(table.sources.map((s) => [s.fileId, s.hasResultRecord])).toEqual([["just-finished", true], ["older", false]]);
    expect(track.sources.map((s) => s.fileId)).toEqual(["newest"]);
    expect(table.coverage).toEqual({ read: 1, needed: 1, module: "genome/browser" });
  });
});
