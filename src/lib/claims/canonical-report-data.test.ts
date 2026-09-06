import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import citations from "../../../data/citations.json";
import claims from "../../../data/claims.json";
import mental from "../../../data/templates/mental-health.json";
import addiction from "../../../data/templates/addiction.json";
import environmental from "../../../data/templates/environmental-sensitivity.json";
import { validateClaimRegistry, type ClaimOccurrence } from "./registry";
import { readStudyContext } from "../genome/study-context";

// This is an independent seed-text binding fixture, NOT a rendered corpus.
// No complete-channel or G1.11/G4.7 acceptance is claimed by this test.
const reviewed = {
  "stress-anxiety-comt-rs4680": "1cc7d055d21a9e9520e9892f133d8f9c19fbe0cd3f20e03e17e11c12efe3490a",
  "mood-stress-resilience-bdnf-rs6265": "f005cd05fb0f576f35b3cbd1858db24cc185befef3ad5d62b8d979e7f3ad5638",
  "problem-substance-use-faah-rs324420": "debc18bc119dfc8a2a10ac6046f61250ca24bc540556d0aeb1b1d858e5b56abf",
  "skin-uv-sensitivity-slc45a2": "b16d453f7e716a188e107ee1b865c662de570e5d9be507b079afd805f717c6ba",
};
const templates = [...mental, ...addiction, ...environmental].filter((t) => Object.hasOwn(reviewed, t.slug));
const expected = templates.flatMap((t) => [
  { id: `report.${t.slug}.summary`, text: t.summary, slug: t.slug, summary: true },
  ...t.citations.flatMap((citation) => Object.entries(readStudyContext(citation) ?? {}).flatMap(([field, value]) =>
    value ? [{ id: `report.${t.slug}.study.${citation.pmid}.${field}`, text: value.text, slug: t.slug, summary: false }] : [])),
]);
const intended = (item: typeof expected[number]) => [
  `/genome/[subject]/reports/${item.slug}#state=complete`,
  "export:account-export-v1",
  ...(item.summary ? ["email:src/emails/research-digest.tsx#fixture=research-digest--public-catalog"] : []),
];
const seedOccurrences: ClaimOccurrence[] = expected.flatMap((item) => intended(item).map((surface) =>
  ({ claimId: item.id, text: item.text, surface })));
const validate = (overrides = {}) => validateClaimRegistry({
  citations, claims, commitDate: "2026-09-06", corpus: seedOccurrences,
  refusalClaimIds: [], societyPositionClaimIds: [],
  archiveExists: (path) => path.startsWith("docs/sources/") && existsSync(path) && statSync(path).isFile(),
  ...overrides,
});

describe("initial canonical report content, not full corpus acceptance", () => {
  it("binds the exact four independently reviewed objects", () => {
    expect(templates).toHaveLength(4);
    for (const template of templates) {
      expect(createHash("sha256").update(JSON.stringify(template)).digest("hex"))
        .toBe(reviewed[template.slug as keyof typeof reviewed]);
    }
  });
  it("registers every reviewed summary and non-null context, and no unreviewed genotype prose", () => {
    expect(claims).toHaveLength(39);
    expect(citations).toHaveLength(11);
    expect(claims.map((c) => c.claim_id).sort()).toEqual(expected.map((item) => item.id).sort());
    for (const item of expected) {
      const claim = claims.find((c) => c.claim_id === item.id)!;
      expect(claim.text_verbatim).toBe(item.text);
      expect(claim.surfaces).toEqual(intended(item));
      expect(claim.reviewer).toContain("Codex agent");
      expect(claim.reviewer).toContain("not human signoff");
      expect(claim.reviewed_on).toBe("2026-09-06");
    }
    expect(claims.some((c) => c.claim_id.includes("interpretation"))).toBe(false);
  });
  it("validates canonical shape, exact references and source archival paths against the seed fixture", () => {
    const result = validate();
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
  it("fails closed on prose drift, unknown references and empty actual-corpus input", () => {
    const changed = structuredClone(claims);
    changed[0].text_verbatim += " Added unsupported prediction.";
    expect(validate({ claims: changed }).issues.some((i) => i.code === "corpus-text-mismatch")).toBe(true);
    changed[0].evidence[0].citation = "pmid:99999999";
    expect(validate({ claims: changed }).issues.some((i) => i.code === "unknown-citation")).toBe(true);
    expect(validate({ corpus: [] }).issues.some((i) => i.code === "orphan-claim")).toBe(true);
  });
  it("does not invent legacy redirects, single-entry email or study-context email surfaces", () => {
    for (const claim of claims) {
      expect(claim.surfaces.some((s) => s.startsWith("/reports/") || s.endsWith("--single") || s.endsWith("--empty"))).toBe(false);
      if (claim.claim_id.includes(".study.")) expect(claim.surfaces.some((s) => s.startsWith("email:"))).toBe(false);
    }
  });
  it("preserves opposing BDNF evidence and separate allele mapping edges", () => {
    const summary = (slug: string) => claims.find((c) => c.claim_id === `report.${slug}.summary`)!;
    expect(summary("mood-stress-resilience-bdnf-rs6265").evidence.map((e) => e.citation))
      .toEqual(["pmid:24433458", "pmid:30845820", "pmid:12553913"]);
    for (const [slug, rsid] of [["skin-uv-sensitivity-slc45a2", "rs16891982"], ["problem-substance-use-faah-rs324420", "rs324420"]]) {
      expect(summary(slug).evidence.some((e) => e.citation === `dataset:ensembl-vep-${rsid}`)).toBe(true);
      const citation = citations.find((c) => c.id === `dataset:ensembl-vep-${rsid}`)!;
      const snapshot = JSON.parse(readFileSync(citation.archived_path!, "utf8"));
      expect(snapshot.httpStatus).toBe(200);
      expect(snapshot.readAt.startsWith(citation.access_date)).toBe(true);
      expect(snapshot.record.id).toBe(rsid);
      expect(snapshot.record.assembly_name).toBe("GRCh38");
      expect(snapshot.url).toBe(citation.url);
      expect(JSON.stringify(snapshot)).toContain(citation.quote);
    }
  });
  it("keeps aggregate publication quotations within the existing receipt allocations", () => {
    // Counts include committed prior excerpts and the pending batch-04 Han excerpt.
    // Canonical snippets are shorter subsets when reusing those publications.
    const priorWords: Record<string, number> = { "11381111": 12, "12060782": 12, "12553913": 9, "15956988": 5, "18483556": 16 };
    for (const citation of citations.filter((c) => c.type === "pmid")) {
      expect(citation.quote.trim().split(/\s+/u).length + (priorWords[citation.identifier] ?? 0)).toBeLessThanOrEqual(25);
    }
  });
});
