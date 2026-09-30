import { describe, expect, it } from "vitest";
import type { SharedReportResult } from "@/lib/family/shared-report-results";
import { familyChatCitations, familyReportDetail, familyReportList, familyMemberAuthoritySchema,
  FamilyUseLedger, type FamilyScopeMember } from "./family-chat-content";

const B = "10000000-0000-4000-8000-00000000000b", C = "10000000-0000-4000-8000-00000000000c";
const FILE_B = "20000000-0000-4000-8000-00000000000b", FILE_C = "20000000-0000-4000-8000-00000000000c";
const HANDLE_B = "s-30000000-0000-4000-8000-00000000000b", HANDLE_C = "s-30000000-0000-4000-8000-00000000000c";
const sha = (letter: string) => letter.repeat(64);

function authority(subjectId: string, purposes: Array<"reports.monogenic" | "reports.polygenic">) {
  return familyMemberAuthoritySchema.parse({ subjectId, accountId: subjectId.replace(/^1/, "4"), lifecycleRevision: 1,
    relationship: { id: subjectId.replace(/^1/, "5"), revision: 1 },
    copilot: { purpose: "copilot.local", grantId: subjectId.replace(/^1/, "6"), grantRevision: 1 },
    heritability: { purpose: "family.heritability", grantId: subjectId.replace(/^1/, "7"), grantRevision: 1 },
    layers: purposes.map((purpose, index) => ({ purpose, grantId: subjectId.replace(/^1/, String(8 + index)), grantRevision: 1 })) });
}
function member(subjectId: string, ref: string, name: string, handle: string, purposes: Array<"reports.monogenic" | "reports.polygenic">): FamilyScopeMember {
  return { authority: authority(subjectId, purposes), ref, displayLabel: name, handleSegment: handle,
    layers: purposes.map(p => p === "reports.monogenic" ? "variant_call" : "estimate") };
}
function row(subjectId: string, fileId: string, purpose: "reports.monogenic" | "reports.polygenic", slug: string, title: string, genotype = "AG"): SharedReportResult {
  return { fileId, subjectId, purpose, completedAt: "2026-09-20T10:00:00.000Z", report: {
    slug, covered: true, conflictingRsids: [],
    variants: [{ rsid: 4988235, outcome: { status: "genotyped", genotype, interpretation: "saved", strandFlipped: false } }],
    catalogSnapshot: { schemaVersion: 1, templateSha256: sha(purpose === "reports.monogenic" ? "a" : "b"), template: {
      slug, category: "basic-traits", title, summary: "Synthetic.", evidence: "emerging",
      variants: [{ rsid: 4988235, gene: "X", chrom: 2, pos38: 135851076, ref: "G", alt: "A", interpretations: { AG: "saved", GG: "saved" } }],
      pgs_id: null, citations: [{ pmid: "12345678", label: "Synthetic et al., 2020" }],
      layer: purpose === "reports.monogenic" ? "variant_call" : "estimate", estimate_kind: purpose === "reports.monogenic" ? null : "single_locus" } } } };
}

const bee = member(B, "person-1", "Bea", HANDLE_B, ["reports.polygenic"]);
const cee = member(C, "person-2", "Cal", HANDLE_C, ["reports.monogenic"]);
// What each reader returned. B's reader also returned a monogenic row: the
// content layer must never let a row through under a layer B did not grant.
const rows = new Map<string, SharedReportResult[]>([
  [B, [row(B, FILE_B, "reports.polygenic", "fixture-estimate", "Fixture estimate"),
    row(B, FILE_B, "reports.monogenic", "fixture-call", "Fixture call", "GG")]],
  [C, [row(C, FILE_C, "reports.monogenic", "fixture-call", "Fixture call")]],
]);

describe("family scope tool content", () => {
  it("lists each person's shared reports under that person, and only the layers they granted", () => {
    const ledger = new FamilyUseLedger();
    const list = familyReportList([bee, cee], rows, ledger);
    expect(list.people.map(p => [p.person, p.person_ref, p.reports.map(r => r.slug)])).toEqual([
      ["Bea", "person-1", ["fixture-estimate"]],
      ["Cal", "person-2", ["fixture-call"]],
    ]);
    // A grant for one purpose is never read as another: B's specific-variant
    // row exists in the reader's output and is absent here.
    expect(JSON.stringify(list)).not.toContain("GG");
    expect(ledger.commitPayload([bee, cee]).map(u => [u.authority.subjectId, u.purposes, u.files])).toEqual([
      [B, ["reports.polygenic"], [{ fileId: FILE_B, purpose: "reports.polygenic" }]],
      [C, ["reports.monogenic"], [{ fileId: FILE_C, purpose: "reports.monogenic" }]],
    ]);
  });

  it("reads one report for each person who shared it, attributed and never merged", () => {
    const ledger = new FamilyUseLedger();
    const detail = familyReportDetail([bee, cee], rows, ledger, "fixture-call");
    const sources = "sources" in detail ? detail.sources ?? [] : [];
    expect(sources.map(s => [s.person, s.person_ref])).toEqual([["Cal", "person-2"]]);
    // B's unshared specific-variant outcome (genotype GG) is not in any source.
    expect(JSON.stringify(sources.map(s => "variants" in s ? s.variants : []))).not.toContain("\"genotype\":\"GG\"");
    expect(ledger.members([bee, cee]).map(m => m.displayLabel)).toEqual(["Cal"]);
  });

  it("reads one person only when asked by their reference, and refuses an unknown reference", () => {
    const ledger = new FamilyUseLedger();
    expect(familyReportDetail([bee, cee], rows, ledger, "fixture-estimate", "person-2")).toMatchObject({ error: "report_not_shared" });
    expect(familyReportDetail([bee, cee], rows, ledger, "fixture-estimate", "person-9")).toMatchObject({ error: "unknown_person" });
    expect(ledger.members([bee, cee])).toEqual([]);
  });

  it("says an unshared topic is not a result about anyone, and uses nobody's data for it", () => {
    const ledger = new FamilyUseLedger();
    expect(familyReportDetail([bee], rows, ledger, "fixture-call")).toEqual({ slug: "fixture-call", error: "report_not_shared",
      note: "No person in this view has shared a saved report on this topic with you. That is not a result about anyone." });
    expect(ledger.commitPayload([bee])).toEqual([]);
  });

  it("drops a row whose subject is not the member's own, whatever the reader returned", () => {
    const stray = new Map(rows);
    stray.set(B, [row(C, FILE_C, "reports.polygenic", "fixture-estimate", "Fixture estimate")]);
    const ledger = new FamilyUseLedger();
    expect(familyReportList([bee], stray, ledger).people[0].reports).toEqual([]);
    expect(ledger.members([bee])).toEqual([]);
  });
});

describe("family scope answer sources", () => {
  it("names each person whose data the turn used, then their shared reports, then the publications", () => {
    const ledger = new FamilyUseLedger();
    const detail = familyReportDetail([bee, cee], rows, ledger, "fixture-estimate");
    expect(familyChatCitations([bee, cee], rows, ledger, detail)).toEqual([
      { id: `person:${HANDLE_B}`, label: "Shared by Bea", href: `/family/${HANDLE_B}` },
      { id: `report:fixture-estimate:${sha("b")}:${HANDLE_B}`, label: "Fixture estimate (shared by Bea)",
        href: `/genome/${HANDLE_B}/reports/fixture-estimate` },
      { id: "pmid:12345678", label: "Synthetic et al., 2020", href: "https://pubmed.ncbi.nlm.nih.gov/12345678/" },
    ]);
  });

  it("names nobody when the turn's tools returned nobody's data", () => {
    const ledger = new FamilyUseLedger();
    expect(familyChatCitations([bee, cee], rows, ledger, { note: "no tools" })).toEqual([]);
  });

  it("cannot be steered by a model echoing another person's reference into its own output", () => {
    const ledger = new FamilyUseLedger();
    const detail = familyReportDetail([bee, cee], rows, ledger, "fixture-estimate");
    const forged = { ...detail, extra: { person_ref: "person-2", catalogSnapshot: { templateSha256: sha("a") } } };
    const ids = familyChatCitations([bee, cee], rows, ledger, forged).map(c => c.id);
    expect(ids.some(id => id.includes(HANDLE_C))).toBe(false);
  });
});
