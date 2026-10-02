import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import citations from "../../../data/citations.json";
import claims from "../../../data/claims.json";
import tranche from "../../../docs/sources/reviews/primary-source-tranche-20261002.json";
import { registeredReportInterpretation, registeredReportSummary, registeredStudyContext, reportSummarySourceIds } from "./presentation";
import { validateClaimRegistry } from "./registry";
import { readStudyContext } from "../genome/study-context";

type Template = { slug: string; summary: string; variants: { rsid: number; interpretations: Record<string, string> }[];
  citations: { pmid?: string; accessedOn?: string; studyContext?: Record<string, { text: string; locator: string } | null> }[] };
const sourceIds = ["17952075", "18509540", "18711365", "28198005", "41618934", "12595690",
  "12879365", "18193043", "18199861", "19934046", "20541252", "23535734"].map((id) => `pmid:${id}`);
const summaryBindings = {
  "blond-hair-kitlg-rs12821256": "pmid:17952075",
  "celiac-hla-dq2-tag-rs2187668": "pmid:18509540",
  "bipolar-association-ank3-rs10994336": "pmid:18711365",
  "bitter-taste-tas2r38-rs713598": "pmid:12595690",
  "sprint-power-actn3": "pmid:12879365",
  "ldl-cholesterol-sort1-rs599839": "pmid:18193043",
  "hemochromatosis-hfe-c282y-rs1800562": "pmid:18199861",
  "social-sensitivity-oxtr-rs53576": "pmid:19934046",
  "vitamin-d-cyp2r1-rs10741657": "pmid:20541252",
  "longevity-telomere-terc-rs10936599": "pmid:23535734",
};
const contextBindings = {
  "vkorc1-rs9923231-one-position": "28198005",
  "nudt15-rs116855232-one-position": "41618934",
};
const claimIds = [
  ...Object.keys(summaryBindings).map((slug) => `report.${slug}.summary`),
  ...Object.entries(contextBindings).flatMap(([slug, pmid]) => ["measured", "limitation"].map((field) => `report.${slug}.study.${pmid}.${field}`)),
];
const sources = citations.filter((source) => sourceIds.includes(source.id));
const added = claims.filter((claim) => claimIds.includes(claim.claim_id));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const templates = tranche.changes.flatMap((change) => (JSON.parse(readFileSync(change.file, "utf8")) as Template[])
  .filter((template) => template.slug === change.slug));
// Seed occurrences check exact transcription/declared channels only. They are
// not a rendered browser/export/mail corpus or scientific/human approval.
const corpus = added.flatMap((claim) => claim.surfaces.map((surface) => ({ claimId: claim.claim_id, text: claim.text_verbatim, surface })));
const input = { citations: sources, claims: added, commitDate: "2026-10-02", corpus,
  refusalClaimIds: [], societyPositionClaimIds: [], archiveExists: () => false };

describe("bounded primary-source tranche", () => {
  it("retains the complete original reviewed population and permits only the exact additions", () => {
    expect(tranche.addedSourceIds.slice().sort()).toEqual(sourceIds.slice().sort());
    expect(tranche.addedClaimIds.slice().sort()).toEqual(claimIds.slice().sort());
    expect(sources).toHaveLength(12);
    expect(added).toHaveLength(14);
    expect(digest(sources)).toBe("d14d8c6fb69bbe021cf26b07ee71c4a3754e2c4030191c254db7c6710d97c41d");
    expect(digest(added)).toBe("2753d8d00b15830f800d49a2139f08cb779dc97c52d0ee97df76af324f941434");
    expect(citations).toHaveLength(53);
    expect(claims).toHaveLength(120);
    const previousSources = citations.filter((source) => !sourceIds.includes(source.id));
    const previousClaims = claims.filter((claim) => !claimIds.includes(claim.claim_id));
    expect(previousSources).toHaveLength(41);
    expect(previousClaims).toHaveLength(106);
    expect(digest(previousSources)).toBe("f8092137d11696a5774a8cdd6216c7541717ff2dcd5d56950aab51f8db318fbe");
    expect(digest(previousClaims)).toBe("eaaef0ef1178c915bb2b9ae97f074b2b375ff9bfad3bbdc91271d04b25e93e56");
    expect(validateClaimRegistry(input).ok).toBe(true);
  });
  it("pins the source identity, actual date, short anchors and abstract-only scope", () => {
    for (const source of sources) {
      const receipt = tranche.sources.find((item) => item.citationId === source.id)!;
      expect(source.type).toBe("pmid");
      expect(source.url).toBe(`https://pubmed.ncbi.nlm.nih.gov/${source.identifier}/`);
      expect(source.id).toBe(`pmid:${source.identifier}`);
      expect(source.archived_path).toBeNull();
      expect(source.access_date).toBe("2026-10-02");
      expect(source.quote.trim().split(/\s+/u).length).toBeLessThanOrEqual(10);
      expect(receipt.accessScope).toContain("publisher full text not read");
      expect(receipt.retrievedAt.startsWith("2026-10-02")).toBe(true);
      expect(receipt.responseSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(receipt.abstractSha256).toMatch(/^[a-f0-9]{64}$/u);
      const allocation = tranche.quoteAllocation.find((item) => item.citationId === source.id)!;
      expect(allocation.newCanonicalWords).toBe(source.quote.trim().split(/\s+/u).length);
      expect(allocation.totalMarkedExcerptWords).toBe(allocation.newCanonicalWords + allocation.existingMarkedReviewExcerptWords);
      expect(allocation.totalMarkedExcerptWords).toBeLessThanOrEqual(25);
    }
  });
  it("binds actual summary/context bytes to the intended source without certifying genotype prose", () => {
    expect(templates).toHaveLength(12);
    for (const template of templates) {
      const freeze = tranche.changes.find((change) => change.slug === template.slug)!;
      expect(digest(template)).toBe(freeze.afterObjectSha256);
      expect(freeze.genotypeInterpretationsUnchanged).toBe(true);
      const summarySource = summaryBindings[template.slug as keyof typeof summaryBindings];
      if (summarySource) {
        const claim = registeredReportSummary(template.slug, template.summary)!;
        expect(claim.evidence.map((edge) => edge.citation)).toEqual([summarySource]);
        expect(claim.surfaces).toEqual([`/genome/[subject]/reports/${template.slug}#state=complete`,
          "export:account-export-v1", "email:src/emails/research-digest.tsx#fixture=research-digest--public-catalog"]);
        expect(registeredReportSummary(template.slug, `${template.summary} Different finding.`)).toBeUndefined();
        expect(reportSummarySourceIds(template.slug, `${template.summary} Different finding.`, sourceIds)).toEqual([]);
      } else {
        const pmid = contextBindings[template.slug as keyof typeof contextBindings];
        const citation = template.citations.find((value) => value.pmid === pmid)!;
        const context = readStudyContext(citation)!;
        expect(context.population).toBeNull();
        expect(context.comparison).toBeNull();
        for (const field of ["measured", "limitation"] as const) {
          const text = context[field]!.text;
          const claim = registeredStudyContext(template.slug, pmid, field, text)!;
          expect(claim.evidence.map((edge) => edge.citation)).toEqual([`pmid:${pmid}`]);
          expect(claim.surfaces).toEqual([`/genome/[subject]/reports/${template.slug}#state=complete`, "export:account-export-v1"]);
          expect(registeredStudyContext(template.slug, pmid, field, `${text} Different finding.`)).toBeUndefined();
        }
      }
      for (const variant of template.variants) {
        for (const [genotype, text] of Object.entries(variant.interpretations)) {
          expect(registeredReportInterpretation(template.slug, variant.rsid, genotype, text)).toBeUndefined();
        }
      }
    }
  });
  it("refuses future/access-date drift, mismatched source URLs and orphaned evidence", () => {
    const copied = structuredClone(added);
    copied[0].evidence[0].accessed_on = "2026-10-03";
    expect(validateClaimRegistry({ ...input, claims: copied }).ok).toBe(false);
    const substituted = structuredClone(added);
    substituted[0].evidence[0].citation = sourceIds.find((id) => id !== substituted[0].evidence[0].citation)!;
    expect(validateClaimRegistry({ ...input, claims: substituted }).ok).toBe(false);
    expect(validateClaimRegistry({ ...input, corpus: [] }).ok).toBe(false);
  });
});
