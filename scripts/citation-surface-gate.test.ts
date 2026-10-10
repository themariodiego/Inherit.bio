import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  CLAIM_MARKERS, OPEN_BACKLOG, SURFACE_TYPES, candidates, claimMarkers, normalizeSentence,
  readRepositoryInputs, rebuildBacklog, registeredSentences, runCitationSurfaceGate, runRepositoryGate,
  sentenceHash, splitSentences, type Backlog, type BacklogEntry, type SurfaceFile,
} from "./citation-surface-gate";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TODAY = "2026-09-30";
const CLAIM = "A synthetic study found that this variant changes the measured trait.";
const files: SurfaceFile[] = [{ type: "report-copy", path: "src/copy/reports/planted.ts",
  source: `export const copy = ${JSON.stringify(CLAIM)};` }];
const entry = (): BacklogEntry => ({ text: CLAIM, sha256: sentenceHash(CLAIM), verdict: null });
const backlog = (entries: BacklogEntry[] = []): Backlog => ({ version: 1, purpose: "Synthetic gate fixture",
  surfaces: entries.length ? { "report-copy": { "src/copy/reports/planted.ts": entries } } : {} });
const registeredClaim = (evidence = [{ citation: "pmid:12345678", accessed_on: "2026-09-29" }]) =>
  ({ claim_id: "synthetic.gate-fixture", text_verbatim: CLAIM, evidence });
const citation = { id: "pmid:12345678", access_date: "2026-09-29" };
type Input = Parameters<typeof runCitationSurfaceGate>[0];
const run = (overrides: Partial<Input> = {}) => runCitationSurfaceGate({ files, claims: [], citations: [],
  backlog: backlog(), openBacklog: 0, today: TODAY, ...overrides });
const temporaryRoots: string[] = [];
afterAll(() => temporaryRoots.forEach(root => rmSync(root, { recursive: true, force: true })));

/** Read the real registered tree; only the planted module or ledger is different. */
function plant(modules: Record<string, string> = {}, reviseBacklog?: (value: Backlog) => void): string {
  const root = mkdtempSync(path.join(tmpdir(), "citation-surface-gate-"));
  temporaryRoots.push(root);
  const mirror = (relative: string) => {
    mkdirSync(path.join(root, relative), { recursive: true });
    for (const item of readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
      const target = `${relative}/${item.name}`;
      if (item.isDirectory()) mirror(target);
      else if (!(target in modules)) symlinkSync(path.join(ROOT, target), path.join(root, target));
    }
  };
  mirror("src");
  for (const [relative, source] of Object.entries(modules)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), source);
  }
  for (const relative of ["data/gates/claim-surfaces.json", "data/claims.json", "data/citations.json",
    "docs/claim-surface-backlog.json"]) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    if (relative === "docs/claim-surface-backlog.json" && reviseBacklog) {
      const value = JSON.parse(readFileSync(path.join(ROOT, relative), "utf8")) as Backlog;
      reviseBacklog(value);
      writeFileSync(path.join(root, relative), JSON.stringify(value));
    } else symlinkSync(path.join(ROOT, relative), path.join(root, relative));
  }
  return root;
}

function reviseSurfaces(root: string, revise: (value: { version: number;
  surfaces: { type: string; paths: string[] }[] }) => void) {
  const target = path.join(root, "data/gates/claim-surfaces.json");
  const value = JSON.parse(readFileSync(target, "utf8"));
  revise(value);
  // Replace the fixture link; never write through to the actual register.
  rmSync(target);
  writeFileSync(target, JSON.stringify(value));
}

describe("the citation marker vocabulary", () => {
  it("pins every marker and its detector, so removing a marker cannot improve the baseline", () => {
    expect(CLAIM_MARKERS.map(({ name, pattern }) => [name, pattern.toString()])).toEqual([
      ["percentage", /\b\d+(?:[.,]\d+)?\s?(?:%|per ?cent\b)/i.toString()],
      ["multiplier", /\b\d+(?:\.\d+)?[- ]?(?:fold\b|times\b|x\b)/i.toString()],
      ["natural-frequency", /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:in|out of)\s+(?:\d+|ten|a hundred|a thousand)\b/i.toString()],
      ["rsid", /\brs\d{3,}\b/i.toString()],
      ["effect-measure", /\b(?:risk|odds|hazard|heritab\w*|penetran\w*|prevalen\w*|incidence|predispos\w*|susceptib\w*)\b/i.toString()],
      ["association", /\b(?:associated with|association|linked to|correlat\w*|causes?|caused by)\b/i.toString()],
      ["evidence", /\b(?:stud(?:y|ies)|trials?|meta-analys\w*|researchers?|research shows|evidence shows|was found|were found|found that)\b/i.toString()],
    ]);
  });
  it.each([
    ["percentage", "The measured value was 12.5%."],
    ["multiplier", "The measured value rose three times, then 2-fold."],
    ["natural-frequency", "This occurs in one in a hundred samples."],
    ["rsid", "The synthetic file includes rs123456."],
    ["effect-measure", "The measured prevalence differs between samples."],
    ["association", "This trait is associated with the variant."],
    ["evidence", "The trial found that the measure changed."],
  ])("detects the %s marker in copy", (marker, text) => expect(claimMarkers(text)).toContain(marker));
  it("excludes short tokens and plain product instructions", () => {
    expect(claimMarkers("rs123456")).toEqual([]);
    expect(claimMarkers("Choose a saved report to read.")).toEqual([]);
  });
  it("normalizes Unicode and spaces while retaining scientific wording", () => {
    expect(normalizeSentence("  A\u00a0synthetic   study. ")).toBe("A synthetic study.");
    expect(sentenceHash("Ａ synthetic study.")).toBe(sentenceHash("A synthetic study."));
    expect(sentenceHash("A synthetic study.")).not.toBe(sentenceHash("A synthetic trial."));
    expect(splitSentences("A synthetic study. Another trial? It changed!")).toEqual([
      "A synthetic study.", "Another trial?", "It changed!",
    ]);
  });
  it("keeps the extraction placeholder visible without pretending to evaluate expressions", () => {
    expect(candidates([{ ...files[0], source: "export const copy = `The study found ${count} samples.`;" }])
      .map(value => value.text)).toEqual(["The study found fact samples."]);
  });
});

describe("registered sentences require resolving, matching access dates", () => {
  it("accepts an exact registered sentence with dated evidence", () => {
    const result = run({ claims: [registeredClaim()], citations: [citation] });
    expect(result.failures).toEqual([]);
    expect(result.sourced).toBe(1);
    expect(result.open).toBe(0);
  });
  it.each([
    { access_date: null }, { access_date: "" }, { access_date: "yesterday" },
    { access_date: "2026-02-30" }, { access_date: "2026-10-01" }, { access_date: "2026-09-28" },
  ])("refuses a missing, invalid, future or mismatching citation date: %j", dates => {
    const result = run({ claims: [registeredClaim()], citations: [{ ...citation, ...dates }] });
    expect(result.failures).toContainEqual(expect.stringContaining("evidence without a dated citation"));
    expect(result.sourced).toBe(0);
  });
  it("requires every piece of evidence and refuses a claim without evidence", () => {
    for (const evidence of [[], [{ citation: "pmid:missing", accessed_on: citation.access_date }],
      [{ citation: citation.id, accessed_on: "2026-09-28" }],
      [{ citation: citation.id, accessed_on: citation.access_date }, { citation: "pmid:missing", accessed_on: citation.access_date }]]) {
      expect(run({ claims: [registeredClaim(evidence)], citations: [citation] }).sourced).toBe(0);
    }
  });
  it("cannot borrow a nearby registered sentence or a citation alone", () => {
    expect(run({ citations: [citation] }).sourced).toBe(0);
    expect(run({ claims: [{ ...registeredClaim(), text_verbatim: "A different synthetic study." }],
      citations: [citation] }).sourced).toBe(0);
  });
  it("does not let an unresolved duplicate override a sourced registration", () => {
    const result = registeredSentences([registeredClaim(), registeredClaim([])], [citation], TODAY);
    expect(result.sourced.has(sentenceHash(CLAIM))).toBe(true);
    expect(result.unresolved.size).toBe(0);
  });
});

describe("the human review backlog is an exact ratchet", () => {
  it("accepts the unchanged unresolved sentence without claiming it is registered", () => {
    const result = run({ backlog: backlog([entry()]), openBacklog: 1 });
    expect(result.failures).toEqual([]);
    expect(result).toMatchObject({ sourced: 0, open: 1, classified: 0 });
  });
  it("fails when open coverage grows", () => {
    expect(run({ backlog: backlog([entry()]) }).failures).toContainEqual(expect.stringContaining("up from 0"));
  });
  it("fails when open coverage shrinks without lowering the pin", () => {
    expect(run({ files: [], openBacklog: 1 }).failures).toContainEqual(expect.stringContaining("down from 1"));
  });
  it("fails a stale ledger entry even when the open count still matches", () => {
    expect(run({ files: [], backlog: backlog([entry()]), openBacklog: 1 }).failures)
      .toContainEqual(expect.stringContaining("no surface file states any more"));
  });
  it("requires removing a newly registered sentence from the ledger", () => {
    expect(run({ backlog: backlog([entry()]), openBacklog: 1, claims: [registeredClaim()], citations: [citation] })
      .failures).toContainEqual(expect.stringContaining("is now registered"));
  });
  it("refuses tampered text and duplicate entries", () => {
    expect(run({ backlog: backlog([{ ...entry(), text: "Different words." }]), openBacklog: 1 }).failures)
      .toContainEqual(expect.stringContaining("does not hash its own text"));
    expect(run({ backlog: backlog([entry(), entry()]), openBacklog: 2 }).failures)
      .toContainEqual(expect.stringContaining("lists"));
    expect(run({ backlog: backlog([entry(), entry()]), openBacklog: 2 }).failures)
      .toContainEqual(expect.stringContaining("twice"));
  });
  it.each([
    { verdict: "product-wording" as const },
    { verdict: "product-wording" as const, reviewedBy: " ", reviewedOn: TODAY },
    { verdict: "product-wording" as const, reviewedBy: "Synthetic reviewer", reviewedOn: "2026-02-30" },
    { verdict: "product-wording" as const, reviewedBy: "Synthetic reviewer", reviewedOn: "2026-10-01" },
  ])("refuses a verdict without a named, dated review: %j", review => {
    expect(run({ backlog: backlog([{ ...entry(), ...review }]) }).failures)
      .toContainEqual(expect.stringContaining("needs reviewedBy"));
  });
  it("refuses review metadata without a verdict", () => {
    expect(run({ backlog: backlog([{ ...entry(), reviewedBy: "Synthetic reviewer", reviewedOn: TODAY }]),
      openBacklog: 1 }).failures).toContainEqual(expect.stringContaining("reviewer but no verdict"));
  });
  it("keeps claim-to-register open and closes product wording only with an explicit review", () => {
    const reviewed = { ...entry(), reviewedBy: "Synthetic reviewer", reviewedOn: TODAY };
    expect(run({ backlog: backlog([{ ...reviewed, verdict: "claim-to-register" }]), openBacklog: 1 }))
      .toMatchObject({ failures: [], open: 1, classified: 0, sourced: 0 });
    expect(run({ backlog: backlog([{ ...reviewed, verdict: "product-wording" }]) }))
      .toMatchObject({ failures: [], open: 0, classified: 1, sourced: 0 });
  });
});

describe("the gate scans the real non-template surfaces", () => {
  it("pins all surface types and passes with the original 59-sentence backlog", () => {
    expect(SURFACE_TYPES).toEqual(["report-copy", "copilot-context", "email", "portrait", "embryo-card"]);
    expect(OPEN_BACKLOG).toBe(59);
    const result = runRepositoryGate(ROOT, TODAY);
    expect(result.failures).toEqual([]);
    expect(result.fileCount).toBeGreaterThanOrEqual(103);
    expect(result).toMatchObject({ sourced: 0, open: 59, classified: 0 });
    expect(result.candidates).toHaveLength(59);
  });
  it("pins the source coverage so deleting a registered path cannot hide copy", () => {
    expect(JSON.parse(readFileSync(path.join(ROOT, "data/gates/claim-surfaces.json"), "utf8")).surfaces)
      .toEqual([
        { type: "report-copy", paths: ["src/copy/reports", "src/copy/genome", "src/copy/ancestry.ts",
          "src/copy/regional-ancestry.ts", "src/copy/figures", "src/components/reports", "src/components/results"] },
        { type: "copilot-context", paths: ["src/copy/copilot", "src/app/api/chat/route.ts",
          "src/lib/copilot/own-chat-route.ts", "src/lib/copilot/own-chat-content.ts",
          "src/lib/copilot/own-chat-report-context.ts", "src/lib/copilot/own-chat-ancestry-content.ts",
          "src/lib/copilot/family-chat-route.ts", "src/lib/copilot/family-chat-content.ts"] },
        { type: "email", paths: ["src/emails"] },
        { type: "portrait", paths: ["src/copy/family/portrait.ts", "src/copy/family/health-picture.ts",
          "src/components/family/portrait"] },
        { type: "embryo-card", paths: ["src/copy/embryos", "src/components/embryo",
          "src/lib/embryos/record-key-cards.ts"] },
      ]);
  });
  it.each([
    ["report-copy", "src/copy/reports/citation-gate-planted.ts"],
    ["copilot-context", "src/copy/copilot/citation-gate-planted.ts"],
    ["email", "src/emails/citation-gate-planted.tsx"],
    ["portrait", "src/components/family/portrait/citation-gate-planted.tsx"],
    ["embryo-card", "src/components/embryo/citation-gate-planted.tsx"],
  ])("fails a planted uncited claim on the %s surface", (type, relative) => {
    const source = relative.endsWith(".tsx") ? `export function Copy() { return <p>${CLAIM}</p>; }`
      : `export const copy = ${JSON.stringify(CLAIM)};`;
    const result = runRepositoryGate(plant({ [relative]: source }), TODAY);
    expect(result.candidates).toHaveLength(60);
    expect(result.failures).toEqual([expect.stringContaining(`${relative}: unsourced ${type} claim`)]);
  });
  it("fails a sentence removed from the real ledger", () => {
    const root = plant({}, value => value.surfaces["copilot-context"]["src/app/api/chat/route.ts"].shift());
    const result = runRepositoryGate(root, TODAY);
    expect(result.failures).toContainEqual(expect.stringContaining("unsourced copilot-context claim"));
    expect(result.failures).toContainEqual(expect.stringContaining("down from 59"));
  });
  it("does not scan test fixtures as product copy", () => {
    const root = plant({ "src/copy/reports/citation-gate-planted.test.ts": files[0].source,
      "src/copy/reports/citation-gate-planted.d.ts": files[0].source });
    expect(runRepositoryGate(root, TODAY).failures).toEqual([]);
  });
  it("fails an empty or incomplete surface register instead of claiming clean coverage", () => {
    const root = plant();
    reviseSurfaces(root, value => { value.surfaces = []; });
    expect(runRepositoryGate(root, TODAY).failures)
      .toContainEqual(expect.stringContaining("must list exactly the surface types"));
  });
  it("fails a missing path, an empty path and duplicate surface ownership", () => {
    const root = plant();
    mkdirSync(path.join(root, "src/empty-surface"));
    reviseSurfaces(root, value => {
      value.surfaces[0].paths.push("src/missing-surface", "src/empty-surface");
      value.surfaces[1].paths.push("src/copy/reports");
    });
    const result = runRepositoryGate(root, TODAY);
    expect(result.failures).toContainEqual(expect.stringContaining("path src/missing-surface does not exist"));
    expect(result.failures).toContainEqual(expect.stringContaining("path src/empty-surface holds no source file"));
    expect(result.failures).toContainEqual(expect.stringContaining("listed under more than one surface"));
  });
  it("retains every existing review verdict when rebuilding the worklist", () => {
    const root = plant({}, value => {
      const reviewed = value.surfaces["copilot-context"]["src/app/api/chat/route.ts"][0];
      Object.assign(reviewed, { verdict: "claim-to-register", reviewedBy: "Synthetic reviewer", reviewedOn: TODAY });
    });
    expect(rebuildBacklog(root)).toEqual(readRepositoryInputs(root).backlog);
  });
  it("wires the runnable gate into CI beside the claims gate", () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
    expect(scripts["gate:citations"]).toBe("tsx scripts/citation-surface-gate.ts");
    for (const file of ["scripts/citation-surface-gate.test.ts", "scripts/figures-census.test.ts"])
      expect(scripts["test:source-inventories"].split(" ").filter((argument: string) => argument === file)).toHaveLength(1);
    expect(scripts["test:source-inventories"]).toMatch(/ --maxWorkers=1 --testTimeout=5000$/);
    expect(readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"))
      .toMatch(/name: Claims and provenance gate\s+run: pnpm gate:claims\s+- name: Non-template citation surface gate\s+run: pnpm gate:citations/);
  });
});


describe("the 2 October release integration preserves measured debt", () => {
  it("reads the current source without assigning a human review", () => {
    const result = runRepositoryGate(ROOT, "2026-10-02");
    expect(result.failures).toEqual([]);
    expect(result.fileCount).toBe(117);
    expect(result.candidates).toHaveLength(59);
    expect(result).toMatchObject({ sourced: 0, open: 59, classified: 0 });
    const inputs = readRepositoryInputs(ROOT);
    expect(inputs.citations).toHaveLength(53);
    expect(inputs.claims).toHaveLength(120);
  });
  it("keeps the exact original unreviewed worklist and debt pin", () => {
    const value = readFileSync(path.join(ROOT, "docs/claim-surface-backlog.json"));
    expect(createHash("sha256").update(value).digest("hex"))
      .toBe("01e5a1f87ba048359400849793cd0aedcfa0819ecc8e6e7f72df821b2975159d");
    expect(OPEN_BACKLOG).toBe(59);
    const entries = Object.values(readRepositoryInputs(ROOT).backlog.surfaces)
      .flatMap(surface => Object.values(surface).flat());
    expect(entries).toHaveLength(59);
    for (const entry of entries) {
      expect(entry.verdict).toBeNull();
      expect(entry.reviewedBy).toBeUndefined();
      expect(entry.reviewedOn).toBeUndefined();
    }
  });
  const newlyReachableSourceFiles = [
    "src/emails/account-deletion-affected.tsx",
    "src/emails/adult-upload-notice.tsx",
    "src/emails/future-person-more-information.tsx",
    "src/emails/future-person-owner-notice.tsx",
    "src/emails/future-person-release.tsx",
    "src/copy/embryos/signing.ts",
    "src/components/embryo/cohort-permission.tsx",
    "src/components/embryo/embryo-withdrawal-form.tsx",
    "src/components/embryo/upload/draft-form.tsx",
    "src/components/embryo/upload/signing-form.tsx",
    "src/components/embryo/upload/upload-stage.tsx"
] as const;
  it("keeps each added mail and embryo source inside the existing scan", () => {
    const scanned = new Set(readRepositoryInputs(ROOT).files.map(file => file.path));
    for (const file of newlyReachableSourceFiles) expect(scanned.has(file)).toBe(true);
  });
  it.each(newlyReachableSourceFiles)("refuses new uncited wording in %s", relative => {
    const source = relative.endsWith(".tsx") ? `export function Copy() { return <p>${CLAIM}</p>; }`
      : `export const copy = ${JSON.stringify(CLAIM)};`;
    const result = runRepositoryGate(plant({ [relative]: source }), "2026-10-02");
    expect(result.candidates).toHaveLength(60);
    expect(result.failures).toEqual([expect.stringContaining(`${relative}: unsourced`)]);
    expect(result.open).toBe(59);
    expect(result.classified).toBe(0);
  });
});
