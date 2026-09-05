import { describe, expect, it, vi } from "vitest";
import basic from "../../../data/templates/basic-traits.json";
import gut from "../../../data/templates/gastrointestinal.json";
import { PERSONAL_PREVIEW_TRAITS } from "@/copy/reports/personal-previews";
import type { ReportTemplate } from "./reports";
import type { Db } from "./load";
import { loadPersonalPreviews, resolvePersonalPreview, type PreviewAudience, type PreviewCall } from "./report-previews";

const audience: PreviewAudience = {
  viewerAccountId: "owner", ownerAccountId: "owner", subjectClass: "self", subjectId: "subject", isFamily: false,
};
const templates = [...basic, ...gut].map((template) => ({ ...template, layer: "estimate", pgs_id: null })) as ReportTemplate[];
const templateFor = (slug: string) => templates.find((template) => template.slug === slug)!;
const trait = PERSONAL_PREVIEW_TRAITS[0];
const template = templateFor(trait.slug);
const call: PreviewCall = { rsid: trait.rsid, chrom: trait.chrom, pos: trait.pos38, ref: trait.ref, alt: trait.alt, genotype: "T/T" };

describe("reviewed personal previews", () => {
  it("covers exactly three source-bound traits and all nine diploid calls", () => {
    expect(PERSONAL_PREVIEW_TRAITS).toHaveLength(3);
    for (const item of PERSONAL_PREVIEW_TRAITS) {
      const report = templateFor(item.slug);
      expect(report.citations.some((source) => source.pmid === item.source.pmid)).toBe(true);
      for (const [key, text] of Object.entries(item.statements)) {
        const result = resolvePersonalPreview(audience, report, [{
          rsid: item.rsid, chrom: item.chrom, pos: item.pos38, ref: item.ref, alt: item.alt,
          genotype: `${key[0]}/${key[1]}`,
        }], new Set());
        expect(result).toEqual({ text, qualifier: item.qualifier });
        expect(Object.keys(result!)).toEqual(["text", "qualifier"]);
      }
    }
  });

  it.each([
    { isFamily: true }, { subjectClass: "other_adult" }, { subjectClass: "embryo" },
    { subjectClass: "minor" }, { ownerAccountId: "other" }, { viewerAccountId: "" },
  ])("never produces a preview outside own self: %j", (override) => {
    expect(resolvePersonalPreview({ ...audience, ...override }, template, [call], new Set())).toBeNull();
  });

  it.each([
    { chrom: 1 }, { pos: 48224288 }, { ref: "G" }, { alt: "A" },
    { genotype: "--" }, { genotype: "N/N" }, { genotype: "T" }, { genotype: "TT" },
    { genotype: "A/A" }, { genotype: "T|T" }, { rsid: 1 },
  ])("withholds a mismatched locus, allele or unusable call: %j", (override) => {
    expect(resolvePersonalPreview(audience, template, [{ ...call, ...override }], new Set())).toBeNull();
  });

  it("needs a call and gives conflict priority over either matching row", () => {
    expect(resolvePersonalPreview(audience, template, [], new Set())).toBeNull();
    expect(resolvePersonalPreview(audience, template, [call], new Set([trait.rsid]))).toBeNull();
    expect(resolvePersonalPreview(audience, template, [call, { ...call, genotype: "C/T" }], new Set())).toBeNull();
    expect(resolvePersonalPreview(audience, template, [call, { ...call, pos: 1 }], new Set())).toBeNull();
  });

  it("allows matching array calls without REF/ALT and equivalent unphased order", () => {
    expect(resolvePersonalPreview(audience, template, [{ ...call, ref: null, alt: null }], new Set())).not.toBeNull();
    expect(resolvePersonalPreview(audience, template, [{ ...call, genotype: "C/T" }, { ...call, genotype: "T/C" }], new Set())).not.toBeNull();
  });

  it.each([
    { slug: "unreviewed" }, { category: "cancer-risk" }, { layer: "variant_call" },
    { pgs_id: "PGS000001" }, { citations: [] },
  ])("does not reuse a preview for changed scope or missing source: %j", (override) => {
    expect(resolvePersonalPreview(audience, { ...template, ...override } as ReportTemplate, [call], new Set())).toBeNull();
  });

  it("withholds if the published template changes its position, allele or clinical gate", () => {
    for (const override of [{ pos38: 1 }, { ref: "G" }, { interpretations: { TT: "Confirm with a clinical laboratory." } }]) {
      const changed = { ...template, variants: [{ ...template.variants[0], ...override }] };
      expect(resolvePersonalPreview(audience, changed, [call], new Set())).toBeNull();
    }
  });

  it("does not query private calls for another subject or unknown build", async () => {
    const from = vi.fn();
    const db = { from } as unknown as Db;
    for (const target of [{ ...audience, isFamily: true }, { ...audience, subjectClass: "other_adult" }]) {
      expect((await loadPersonalPreviews(db, target, templates, [{ id: "file", build: "GRCh38" }], new Set())).size).toBe(0);
    }
    for (const build of [null, "unknown", "GRCh36"]) {
      expect((await loadPersonalPreviews(db, audience, templates, [{ id: "file", build }], new Set())).size).toBe(0);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("binds the query to owner, subject and processed known-build file IDs, withholds on errors", async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => void) => resolve({ data: [call], error: null }),
    };
    const fileQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: async () => ({ data: [{ id: "known", build: "GRCh37" }] }) };
    const db = { from: vi.fn((table: string) => table === "genome_files" ? fileQuery : query) } as unknown as Db;
    const result = await loadPersonalPreviews(db, audience, templates, [{ id: "known", build: "GRCh37" }, { id: "unknown", build: null }], new Set());
    expect(query.eq.mock.calls).toEqual([["subject_id", "subject"], ["user_id", "owner"], ["subject_id", "subject"], ["user_id", "owner"]]);
    expect(query.in.mock.calls[0]).toEqual(["file_id", ["known"]]);
    expect(result.get(trait.slug)?.text).toBe(trait.statements.TT);
    query.then = (resolve) => resolve({ data: [call], error: { message: "unavailable" } });
    expect((await loadPersonalPreviews(db, audience, templates, [{ id: "known", build: "GRCh38" }], new Set())).size).toBe(0);
  });
});
