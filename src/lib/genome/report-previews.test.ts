import { describe, expect, it, vi } from "vitest";
import basic from "../../../data/templates/basic-traits.json";
import gut from "../../../data/templates/gastrointestinal.json";
import lifestyle from "../../../data/templates/lifestyle-wellness.json";
import { PERSONAL_PREVIEW_TRAITS } from "@/copy/reports/personal-previews";
import type { ReportTemplate } from "./reports";
import type { Db } from "./load";
import { loadPersonalPreviews, resolvePersonalPreview, type PreviewAudience, type PreviewCall } from "./report-previews";

/**
 * Since D-099 a preview built from a LEGACY source answers to the same live
 * `reports.polygenic` grant as a modern one, so these reads now need a
 * session and a grant answer. Both are mocked here rather than stubbed away:
 * the grant RPC is what the last test in this file revokes.
 */
const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/uploads/own-upload-context", () => ({ currentOwnUploadAccount: mocks.actor }));
mocks.actor.mockResolvedValue({ accountId: "owner", sessionId: "session" });

const audience: PreviewAudience = {
  viewerAccountId: "owner", ownerAccountId: "owner", subjectClass: "self", subjectId: "subject", isFamily: false,
};
const templates = [...basic, ...gut].map((template) => ({ ...template, layer: "estimate", pgs_id: null })) as ReportTemplate[];
const templateFor = (slug: string) => templates.find((template) => template.slug === slug)!;
const trait = PERSONAL_PREVIEW_TRAITS.find((item) => item.rsid === 17822931)!;
const template = templateFor(trait.slug);
const call: PreviewCall = { rsid: trait.rsid, chrom: trait.chrom, pos: trait.pos38, ref: trait.ref, alt: trait.alt, genotype: "T/T" };

describe("reviewed personal previews", () => {
  it("covers seven source-bound traits and all twenty-one diploid calls", () => {
    expect(PERSONAL_PREVIEW_TRAITS).toHaveLength(7);
    for (const item of PERSONAL_PREVIEW_TRAITS) {
      const report = templateFor(item.slug);
      expect(report.citations.some((source) => "pmid" in item.source
        ? source.pmid === item.source.pmid : source.doi === item.source.doi)).toBe(true);
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

  it("requires both alcohol sources and never turns the caffeine association into a speed preview", () => {
    const alcohol = templateFor("alcohol-flush-aldh2-rs671");
    const alcoholCall = { rsid: 671, chrom: 12, pos: 111803962, ref: "G", alt: "A", genotype: "A/A" };
    for (const pmid of ["39075523", "2024727"]) {
      expect(resolvePersonalPreview(audience, {
        ...alcohol, citations: alcohol.citations.filter((source) => source.pmid !== pmid),
      }, [alcoholCall], new Set())).toBeNull();
    }
    expect(resolvePersonalPreview(audience, alcohol, [alcoholCall], new Set([671]))).toBeNull();
    expect(resolvePersonalPreview({ ...audience, isFamily: true }, alcohol, [alcoholCall], new Set())).toBeNull();
    const caffeine = { ...lifestyle[0], layer: "estimate" } as ReportTemplate;
    expect(resolvePersonalPreview(audience, caffeine, [{
      rsid: 762551, chrom: 15, pos: 74749576, ref: "C", alt: "A", genotype: "A/A",
    }], new Set())).toBeNull();
  });

  it("does not interpret third alleles from the mapping records as the reviewed common calls", () => {
    for (const [rsid, extra] of [[4481887, "T"], [17822931, "G"]] as const) {
      const item = PERSONAL_PREVIEW_TRAITS.find((entry) => entry.rsid === rsid)!;
      const report = templateFor(item.slug);
      for (const genotype of [`${extra}/${extra}`, `${item.ref}/${extra}`, `${item.alt}/${extra}`]) {
        expect(resolvePersonalPreview(audience, report, [{
          rsid, chrom: item.chrom, pos: item.pos38, ref: item.ref, alt: item.alt, genotype,
        }], new Set())).toBeNull();
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
      in: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => void) => resolve({ data: [{ ...call, file_id: "known" }], error: null }),
    };
    const fileQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: async () => ({ data: [{ id: "known", status: "annotated", single_logical_sample_verified_at: null, build: "GRCh37" }] }) };
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const db = { rpc, from: vi.fn((table: string) => table === "genome_files" ? fileQuery : query) } as unknown as Db;
    const result = await loadPersonalPreviews(db, audience, templates, [{ id: "known", build: "GRCh37" }, { id: "unknown", build: null }], new Set());
    // The legacy source is readable because the purpose is granted, and the
    // question asked is the subject-level one D-097 established.
    expect(rpc).toHaveBeenCalledWith("own_subject_purpose_granted_v1", {
      p_account_id: "owner", p_session_id: "session", p_subject_id: "subject", p_purpose: "reports.polygenic",
    });
    expect(query.eq.mock.calls).toEqual([["subject_id", "subject"], ["user_id", "owner"], ["subject_id", "subject"], ["user_id", "owner"]]);
    expect(query.in.mock.calls[0]).toEqual(["file_id", ["known"]]);
    expect(result.get(trait.slug)?.text).toBe(trait.statements.TT);
    query.then = (resolve) => resolve({ data: [call], error: { message: "unavailable" } });
    expect((await loadPersonalPreviews(db, audience, templates, [{ id: "known", build: "GRCh38" }], new Set())).size).toBe(0);
  });

  it("withholds a legacy-derived preview once the polygenic purpose is revoked (D-099)", async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => void) => resolve({ data: [{ ...call, file_id: "known" }], error: null }),
    };
    const fileQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: async () => ({ data: [{ id: "known", status: "annotated", single_logical_sample_verified_at: null, build: "GRCh37" }] }) };
    const from = vi.fn((table: string) => table === "genome_files" ? fileQuery : query);
    // The one difference from the test above: the grant is gone. The rows are
    // still there and still readable by the raw query; the preview is not.
    const revoked = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }), from } as unknown as Db;
    expect((await loadPersonalPreviews(revoked, audience, templates, [{ id: "known", build: "GRCh37" }], new Set())).size).toBe(0);
    // Fail closed rather than open: an unreadable grant answer withholds too.
    const unreadable = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "down" } }), from } as unknown as Db;
    expect((await loadPersonalPreviews(unreadable, audience, templates, [{ id: "known", build: "GRCh37" }], new Set())).size).toBe(0);
  });
});
