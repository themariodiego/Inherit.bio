import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  elementTags,
  hasAttribute,
  isCalendarDate,
  pathMatchesRoute,
  provenanceLiterals,
  quoteWordCount,
  readClaimsLedger,
  reportProseBlocks,
  runClaimsGate,
  withoutComments,
} from "./claims-gate";

/**
 * The gate is only worth having if a planted defect fails it, so every check
 * is tested against a repository that is real except for the one thing the
 * test breaks. The big inputs — the source tree, the templates, the archived
 * sources, the migrations — are symlinked from this repository so the floor
 * guards see their true size, and only the input under test is rewritten.
 *
 * Every divergence this repository carries today is recorded in
 * `docs/claims-divergence.json`, so a planted repository starts from a real
 * ledger and the one defect the test plants is the only unrecorded finding.
 * The ledger is compared in both directions, which is itself planted below:
 * a divergence missing from the ledger fails, and a ledger entry whose
 * divergence no longer exists fails too — including when only one of its
 * counts has moved.
 */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = "docs/claims-divergence.json";
const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

type Citation = Record<string, unknown> & { id: string; type: string };
type Claim = Record<string, unknown> & {
  claim_id: string;
  text_verbatim: string;
  surfaces: string[];
  evidence: { citation: string; accessed_on?: string }[];
};
type Template = { slug: string; summary?: string; citations?: { pmid?: string; doi?: string }[] };

interface Overrides {
  citations?: (citations: Citation[]) => void;
  claims?: (claims: Claim[]) => void;
  register?: (register: Record<string, unknown>) => void;
  /** Receives a writable copy of `data/templates` at `<root>/data/templates`. */
  templates?: (templatesRoot: string) => void;
  /** Receives a writable copy of `src` at `<root>/src`. */
  source?: (sourceRoot: string) => void;
  /** Receives the parsed `docs/claims-divergence.json` before it is written. */
  ledger?: (ledger: LedgerFile) => void;
}

/** Only the two groups the tests plant into are named; the rest travel as they are. */
type LedgerFile = Record<string, unknown> & {
  reportBodyRegistration: { file: string; unregisteredBlocks: number }[];
  designatedSurface: { surface: string; kind: string }[];
};

const realCitations = () =>
  JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "data/citations.json"), "utf8")) as Citation[];
const realClaims = () =>
  JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "data/claims.json"), "utf8")) as Claim[];

/** A repository whose unchanged parts point back at the real ones. */
function plant(overrides: Overrides): string {
  const root = mkdtempSync(path.join(tmpdir(), "claims-gate-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "docs"));
  mkdirSync(path.join(root, "data"));
  mkdirSync(path.join(root, "supabase"));
  symlinkSync(path.join(REPOSITORY_ROOT, "docs/sources"), path.join(root, "docs/sources"));
  symlinkSync(path.join(REPOSITORY_ROOT, "supabase/migrations"), path.join(root, "supabase/migrations"));

  if (overrides.source) {
    cpSync(path.join(REPOSITORY_ROOT, "src"), path.join(root, "src"), { recursive: true });
    overrides.source(path.join(root, "src"));
  } else {
    symlinkSync(path.join(REPOSITORY_ROOT, "src"), path.join(root, "src"));
  }

  if (overrides.templates) {
    cpSync(path.join(REPOSITORY_ROOT, "data/templates"), path.join(root, "data/templates"), {
      recursive: true,
    });
    overrides.templates(path.join(root, "data/templates"));
  } else {
    symlinkSync(path.join(REPOSITORY_ROOT, "data/templates"), path.join(root, "data/templates"));
  }

  const citations = realCitations();
  overrides.citations?.(citations);
  writeFileSync(path.join(root, "data/citations.json"), JSON.stringify(citations));

  const claims = realClaims();
  overrides.claims?.(claims);
  writeFileSync(path.join(root, "data/claims.json"), JSON.stringify(claims));

  const register = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, "docs/route-register.json"), "utf8"),
  ) as Record<string, unknown>;
  overrides.register?.(register);
  writeFileSync(path.join(root, "docs/route-register.json"), JSON.stringify(register));

  const ledger = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, LEDGER), "utf8"),
  ) as LedgerFile;
  overrides.ledger?.(ledger);
  writeFileSync(path.join(root, LEDGER), JSON.stringify(ledger));
  return root;
}

const unrecorded = (label: string, finding: string) =>
  `${label}: not recorded in ${LEDGER}: ${finding}`;

const stale = (label: string, finding: string) =>
  `${label}: recorded in ${LEDGER} but no longer present: ${finding}`;

describe("the claims gate holds the registers to the product", () => {
  it("reads every input on this repository, and no floor guard fires", () => {
    const result = runClaimsGate(REPOSITORY_ROOT);
    expect(result.citationCount).toBe(19);
    expect(result.archivedSourceCount).toBe(7);
    expect(result.claimCount).toBe(71);
    expect(result.claimEvidenceCount).toBeGreaterThan(50);
    expect(result.reportTemplateCount).toBe(162);
    expect(result.reportProseCount).toBe(746);
    expect(result.registeredProseCount).toBe(71);
    expect(result.templateCitationCount).toBe(221);
    expect(result.registeredTemplateCitationCount).toBe(20);
    expect(result.provenanceLiteralCount).toBeGreaterThan(10);
    // Exactly three components emit a claim or figure marker in this
    // repository: <Claim>, <Figure> and <RelativeFigure>.
    expect(result.markedElementCount).toBe(3);
    expect(result.chromeElementCount).toBeGreaterThan(3);
    expect(result.scannedMarkupFileCount).toBeGreaterThan(200);
    expect(result.designatedSurfaceCount).toBe(7);
    // Every failure is a finding about the product, never a floor guard
    // reporting that the gate read nothing.
    expect(result.failures.filter((line) => /expected over/.test(line))).toEqual([]);
  });

  it("runs green against the committed ledger, outside the provenance defects being fixed", () => {
    // The whole point of the ledger: every divergence this repository carries
    // is recorded, in both directions, so nothing but a real regression can
    // fail this gate. Figure provenance is excluded deliberately — the
    // findings there are correctness bugs under repair in src/, not accepted
    // divergences, and docs/claims-divergence.json says so and lists none.
    const { failures } = runClaimsGate(REPOSITORY_ROOT);
    expect(failures.filter((line) => !line.startsWith("figure provenance:"))).toEqual([]);
    expect(readClaimsLedger(REPOSITORY_ROOT)["figure provenance"]).toEqual([]);
  });

  it("records every divergence the ten checks report, and nothing else", () => {
    const ledger = readClaimsLedger(REPOSITORY_ROOT);
    // 675 unregistered prose blocks are 16 entries, one per template file
    // carrying its counts; 201 unregistered template citations are 16 more.
    expect(ledger["report body registration"]).toHaveLength(16);
    expect(ledger["template citation registration"]).toHaveLength(16);
    expect(ledger["designated surface"]).toHaveLength(10);
    // The seven checks with nothing to record are recorded as having nothing,
    // which is what makes a regression in them fail.
    for (const label of ["citation schema", "source snapshot", "claim evidence", "claim surface", "claim attribute", "exempt numeral"]) {
      expect(ledger[label]).toEqual([]);
    }
  });

  it("fails when a citation quote runs past the 25-word limit", () => {
    const root = plant({
      citations: (citations) => {
        citations[0].quote = Array.from({ length: 30 }, (_, index) => `word${index}`).join(" ");
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded("citation schema", "dataset:ensembl-vep-rs16891982 quote is 30 words, over the 25-word limit"),
    );
  });

  it("fails on a citation type outside the schema, a missing field and an impossible access date", () => {
    const root = plant({
      citations: (citations) => {
        citations[0].type = "preprint";
        citations[1].access_date = "2026-02-30";
        delete citations[2].claim;
        citations[3].url = "pubmed";
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures.join("\n")).toContain("type=preprint is outside pmid|doi|statute|registry|regulator|dataset");
    expect(failures.join("\n")).toContain("access_date=2026-02-30 is not a calendar date");
    expect(failures.join("\n")).toContain("is missing claim");
    expect(failures.join("\n")).toContain("url is not resolvable by an independent reader: pubmed");
  });

  it("fails when a duplicate citation id would make a provenance ambiguous", () => {
    const root = plant({ citations: (citations) => citations.push({ ...citations[0] }) });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded("citation schema", "dataset:ensembl-vep-rs16891982 is a duplicate id"),
    );
  });

  it("fails when a non-permanent web source has no local snapshot", () => {
    const root = plant({
      citations: (citations) => {
        const dataset = citations.find((citation) => citation.type === "dataset")!;
        dataset.archived_path = null;
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "source snapshot",
        "dataset:ensembl-vep-rs16891982 is a dataset web source with no local snapshot under docs/sources/",
      ),
    );
    // A PMID is a permanent identifier, so the eleven with no snapshot are
    // not reported: the check is reading the type, not the null.
    expect(failures.join("\n")).not.toContain("pmid:11381111 is a pmid web source");
  });

  it("fails when a recorded snapshot is not on disk", () => {
    const root = plant({
      citations: (citations) => {
        citations.find((citation) => citation.type === "dataset")!.archived_path =
          "docs/sources/ensembl/deleted-2026-09-06.json";
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "source snapshot",
        "dataset:ensembl-vep-rs16891982 archived_path does not exist: docs/sources/ensembl/deleted-2026-09-06.json",
      ),
    );
  });

  it("fails when a claim cites a source the register does not hold", () => {
    const root = plant({ claims: (claims) => (claims[0].evidence[0].citation = "pmid:99999999") });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "claim evidence",
        "report.mood-stress-resilience-bdnf-rs6265.study.12553913.comparison cites pmid:99999999, " +
          "which is not in data/citations.json",
      ),
    );
  });

  it("fails when a claim's access date contradicts the date the source was read", () => {
    const root = plant({ claims: (claims) => (claims[0].evidence[0].accessed_on = "2026-01-02") });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "claim evidence",
        "report.mood-stress-resilience-bdnf-rs6265.study.12553913.comparison cites pmid:12553913 " +
          "accessed_on=2026-01-02 while data/citations.json records access_date=2026-09-06",
      ),
    );
  });

  it("fails when a claim carries no citation at all", () => {
    const root = plant({ claims: (claims) => (claims[0].evidence = []) });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded("claim evidence", "report.mood-stress-resilience-bdnf-rs6265.study.12553913.comparison carries no citation"),
    );
  });

  it("fails when a claim names a surface the route register does not have", () => {
    const root = plant({ claims: (claims) => (claims[0].surfaces = ["/genome/[subject]/invented"]) });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "claim surface",
        "report.mood-stress-resilience-bdnf-rs6265.study.12553913.comparison names " +
          "/genome/[subject]/invented, which is no page route in docs/route-register.json",
      ),
    );
  });

  it("fails when a claim is bound to a report no template publishes, or a state no register declares", () => {
    const root = plant({
      claims: (claims) => {
        claims[0].surfaces = ["/genome/[subject]/reports/not-a-report#state=complete"];
        claims[1].surfaces = ["/genome/[subject]/reports/earwax-type-abcc11#state=invented"];
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures.join("\n")).toContain(
      "names report not-a-report, which no template in data/templates publishes",
    );
    expect(failures.join("\n")).toContain(
      "names surface state state=invented, which docs/route-register.json does not declare",
    );
  });

  it("fails when a figure claims provenance from a module that does not exist", () => {
    const root = plant({
      source: (sourceRoot) => {
        writeFileSync(
          path.join(sourceRoot, "components/figures/planted-figure.tsx"),
          'export const spec = { kind: "computed", module: "genome/invented" };\n',
        );
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "figure provenance",
        "src/components/figures/planted-figure.tsx claims provenance computed:genome/invented, " +
          "and no module of that name exists",
      ),
    );
  });

  it("fails when a computed module exists but no unit test covers it", () => {
    const root = plant({
      source: (sourceRoot) => {
        writeFileSync(path.join(sourceRoot, "lib/genome/untested-module.ts"), "export const x = 1;\n");
        writeFileSync(
          path.join(sourceRoot, "components/figures/planted-figure.tsx"),
          'export const spec = { kind: "computed", module: "genome/untested-module" };\n',
        );
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "figure provenance",
        "src/components/figures/planted-figure.tsx claims provenance computed:genome/untested-module, " +
          "and src/lib/genome/untested-module.ts has no unit test",
      ),
    );
  });

  it("fails when a figure claims a citation or a seeded table that does not exist", () => {
    const root = plant({
      source: (sourceRoot) => {
        writeFileSync(
          path.join(sourceRoot, "components/figures/planted-figure.tsx"),
          'export const a = { kind: "citation", id: "pmid:99999999" };\n' +
            'export const b = { kind: "seed", table: "invented_table", id: rowId };\n',
        );
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "figure provenance",
        "src/components/figures/planted-figure.tsx claims provenance citation:pmid:99999999, " +
          "which is not in data/citations.json",
      ),
    );
    expect(failures).toContain(
      unrecorded(
        "figure provenance",
        "src/components/figures/planted-figure.tsx claims provenance seed:invented_table, " +
          "and no migration creates that table",
      ),
    );
  });

  it("fails when a claim or figure element carries no provenance", () => {
    const root = plant({
      source: (sourceRoot) => {
        writeFileSync(
          path.join(sourceRoot, "components/figures/planted-element.tsx"),
          "export function Planted() {\n" +
            '  return <p data-claim-id="report.invented">Two in a hundred people carry this.</p>;\n' +
            "}\n",
        );
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "claim attribute",
        "src/components/figures/planted-element.tsx <p> carries data-claim-id without data-provenance",
      ),
    );
  });

  it("fails when a numeral claims an exemption outside the six chrome kinds", () => {
    const root = plant({
      source: (sourceRoot) => {
        writeFileSync(
          path.join(sourceRoot, "components/figures/planted-chrome.tsx"),
          'export const A = <span data-ui-chrome-kind="scientific">25%</span>;\n',
        );
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "exempt numeral",
        "src/components/figures/planted-chrome.tsx <span> claims exemption as scientific, " +
          "outside item-count|step|pagination|date|file-size|version",
      ),
    );
  });

  it("fails when an exempt numeral also carries a claim", () => {
    const root = plant({
      source: (sourceRoot) => {
        writeFileSync(
          path.join(sourceRoot, "components/figures/planted-chrome.tsx"),
          'export const A = <span data-ui-chrome-kind="version" data-claim="x" data-provenance="citation:pmid:12553913">3</span>;\n',
        );
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "exempt numeral",
        "src/components/figures/planted-chrome.tsx <span> is exempt chrome and carries data-claim",
      ),
    );
  });

  it("fails a report body harder when one more of its prose blocks loses its registration", () => {
    // The ledger records 31 of 63 for this file. Losing one registration
    // makes it 32, and the gate fails twice for the one change: the 32 is
    // unrecorded, and the recorded 31 is no longer true. A count cannot go
    // stale in either direction.
    const root = plant({
      claims: (claims) => {
        const at = claims.findIndex((claim) => claim.claim_id === "report.earwax-type-abcc11.summary");
        claims.splice(at, 1);
      },
    });
    const { failures, registeredProseCount } = runClaimsGate(root);
    const joined = failures.join("\n");
    expect(joined).toContain(
      unrecorded("report body registration", "data/templates/basic-traits.json: 32 of 63 report-body prose blocks"),
    );
    expect(joined).toContain(
      stale("report body registration", "data/templates/basic-traits.json: 31 of 63 report-body prose blocks"),
    );
    expect(registeredProseCount).toBe(70);
  });

  it("fails when a report body's registered prose no longer matches the template text", () => {
    const root = plant({
      claims: (claims) => {
        const claim = claims.find((entry) => entry.claim_id === "report.earwax-type-abcc11.summary")!;
        claim.text_verbatim = `${claim.text_verbatim} And one more sentence nobody reviewed.`;
      },
    });
    const { failures } = runClaimsGate(root);
    // Changed prose cannot borrow the citation of the text that was reviewed.
    expect(failures.join("\n")).toContain("data/templates/basic-traits.json: 32 of 63 report-body prose blocks");
  });

  it("fails when a template cites a source the citation register does not hold", () => {
    const root = plant({
      templates: (templatesRoot) => {
        const file = path.join(templatesRoot, "basic-traits.json");
        const templates = JSON.parse(readFileSync(file, "utf8")) as Template[];
        templates[0].citations = [...(templates[0].citations ?? []), { pmid: "99999999" }];
        writeFileSync(file, JSON.stringify(templates));
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures.join("\n")).toContain("data/templates/basic-traits.json: 12 of 16 cited sources are absent");
  });

  it("fails when a designated surface renders its prose outside the shared claim component", () => {
    const label = "designated surface";
    const ledger = readClaimsLedger(REPOSITORY_ROOT);
    expect(ledger[label]).toContain(
      "legal pages: 22 of 22 page modules never reach the shared claim component " +
        "(src/components/claims/claim.tsx), so their prose is rendered outside it",
    );
    // Report bodies are the one designated surface that does reach it today,
    // so the ledger records nothing about them and losing that is a failure.
    expect(ledger[label].join("\n")).not.toContain("report bodies:");
    const root = plant({
      source: (sourceRoot) => {
        for (const name of ["report-summary.tsx", "report-evidence.tsx"]) {
          const file = path.join(sourceRoot, "components/reports", name);
          writeFileSync(
            file,
            readFileSync(file, "utf8").replaceAll("@/components/claims/claim", "@/components/claims/sources"),
          );
        }
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        label,
        "report bodies: 1 of 1 page modules never reach the shared claim component " +
          "(src/components/claims/claim.tsx), so their prose is rendered outside it",
      ),
    );
  });

  it("fails when a divergence is fixed and its ledger entry is left behind", () => {
    // Binding a claim to the embryo comparison closes a recorded divergence.
    // The gate then fails on the stale entry, so the fix cannot land without
    // taking its line out of docs/claims-divergence.json.
    const unbound = "the embryo comparison: no claim in data/claims.json is bound to it";
    expect(readClaimsLedger(REPOSITORY_ROOT)["designated surface"]).toContain(unbound);
    const root = plant({
      claims: (claims) => {
        claims.push({ ...claims[0], claim_id: "embryo.compare.planted", surfaces: ["/embryos/compare#state=complete"] });
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(stale("designated surface", unbound));
    expect(failures.join("\n")).not.toContain(unrecorded("designated surface", unbound));
  });

  it("fails when a divergence the checks report is missing from the ledger", () => {
    const finding =
      "glossary definitions: no page route in docs/route-register.json and none of src/copy/glossary " +
      "exists, so this gate is checking nothing on a surface the brief designates";
    // Recorded today, because the brief designates a glossary surface that
    // this repository does not have anywhere.
    expect(readClaimsLedger(REPOSITORY_ROOT)["designated surface"]).toContain(finding);
    const root = plant({
      ledger: (ledger) => {
        ledger.designatedSurface = ledger.designatedSurface.filter(
          (entry) => !(entry.surface === "glossary definitions" && entry.kind === "unlocatable"),
        );
      },
    });
    expect(runClaimsGate(root).failures).toContain(unrecorded("designated surface", finding));
  });

  it("fails on a ledger entry whose counts no longer match the divergence it records", () => {
    // The sharpest half of the both-directions rule: the entry still names a
    // real file and a real divergence, and one number in it has gone stale.
    const root = plant({
      ledger: (ledger) => {
        const entry = ledger.reportBodyRegistration.find(
          (recorded) => recorded.file === "data/templates/gastrointestinal.json",
        )!;
        entry.unregisteredBlocks = 57;
      },
    });
    const { failures } = runClaimsGate(root);
    expect(failures).toContain(
      unrecorded(
        "report body registration",
        "data/templates/gastrointestinal.json: 58 of 58 report-body prose blocks across 10 reports are not " +
          "registered canonical claims (10 summaries, 33 genotype interpretations, 15 study contexts)",
      ),
    );
    expect(failures).toContain(
      stale(
        "report body registration",
        "data/templates/gastrointestinal.json: 57 of 58 report-body prose blocks across 10 reports are not " +
          "registered canonical claims (10 summaries, 33 genotype interpretations, 15 study contexts)",
      ),
    );
  });

  it("fails when a finding recorded in the ledger no longer holds", () => {
    const { failures } = runClaimsGate(REPOSITORY_ROOT, {
      "citation schema": ["pmid:12553913 quote is 40 words, over the 25-word limit"],
    });
    expect(failures).toContain(
      stale("citation schema", "pmid:12553913 quote is 40 words, over the 25-word limit"),
    );
  });

  it("fails loudly rather than passing when the readers find nothing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "claims-gate-empty-"));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, "docs/sources"), { recursive: true });
    mkdirSync(path.join(root, "data/templates"), { recursive: true });
    mkdirSync(path.join(root, "src/app"), { recursive: true });
    mkdirSync(path.join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(path.join(root, "data/citations.json"), "[]");
    writeFileSync(path.join(root, "data/claims.json"), "[]");
    writeFileSync(
      path.join(root, "docs/route-register.json"),
      JSON.stringify({ routes: [], stateIds: [], exportContracts: {} }),
    );
    // A ledger recording nothing, which is what an empty repository would
    // honestly have: the floor guards are what must fail here, not the read.
    writeFileSync(path.join(root, LEDGER), "{}");
    const { failures } = runClaimsGate(root);
    // An empty scan reports nothing wrong with the product, which is exactly
    // the failure mode the floor guards exist to catch.
    expect(failures.join("\n")).toContain("citation register holds 0 sources");
    expect(failures.join("\n")).toContain("claim register holds 0 claims");
    expect(failures.join("\n")).toContain("template reader found 0 reports");
    expect(failures.join("\n")).toContain("template reader found 0 report-body prose blocks");
    expect(failures.join("\n")).toContain("source walker found 0 modules");
    expect(failures.join("\n")).toContain("page walker found 0 page modules");
    expect(failures.join("\n")).toContain("migration reader found 0 tables");
    expect(failures.join("\n")).toContain("the shared claim component src/components/claims/claim.tsx does not exist");
    expect(failures.filter((line) => /expected over|does not exist/.test(line)).length).toBeGreaterThanOrEqual(13);
  });
});

describe("the detectors the gate is built from", () => {
  it("counts the words of a quote, not its punctuation", () => {
    expect(quoteWordCount('"amino_acids":"L/F"')).toBe(1);
    expect(quoteWordCount("  low-activity   Met allele  ")).toBe(3);
    expect(quoteWordCount(Array.from({ length: 26 }, () => "word").join(" "))).toBe(26);
  });

  it("refuses a date the calendar does not have", () => {
    expect(isCalendarDate("2026-09-06")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-9-6")).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
  });

  it("does not read an element out of a comment that documents one", () => {
    const documented = "/**\n * renders `<p data-figure-kind=\"relative\">`\n */\nexport const x = 1;\n";
    expect(elementTags(documented)).toEqual([]);
    expect(withoutComments('const url = "https://a.example/b";').trim()).toBe(
      'const url = "https://a.example/b";',
    );
    expect(withoutComments('const glob = "**/*.ts";').trim()).toBe('const glob = "**/*.ts";');
  });

  it("reads an element whose attributes span lines and carry expressions", () => {
    const tags = elementTags(
      '<span\n  data-figure-kind={spec.kind}\n  onClick={() => (a > b ? c : d)}\n  data-provenance={f(x)}\n>\n{v}\n</span>',
    );
    // A closing tag is not an element.
    expect(tags).toHaveLength(1);
    expect(hasAttribute(tags[0].attributes, "data-figure-kind")).toBe(true);
    expect(hasAttribute(tags[0].attributes, "data-provenance")).toBe(true);
  });

  it("refuses a longer attribute name that merely starts with the one being checked", () => {
    expect(hasAttribute('data-claim-block="true"', "data-claim")).toBe(false);
    expect(hasAttribute('data-claim-region="body"', "data-claim")).toBe(false);
    expect(hasAttribute('data-claim="x"', "data-claim")).toBe(true);
    expect(hasAttribute('data-claim-id="x"', "data-claim-id")).toBe(true);
  });

  it("serialises every provenance a module builds, and marks the ones it cannot resolve", () => {
    expect(provenanceLiterals('const P = { kind: "computed", module: "family/portrait" };')).toEqual([
      "computed:family/portrait",
    ]);
    expect(
      provenanceLiterals('const M = "src/lib/genome/admixture.ts";\nconst P = { kind: "computed", module: M };'),
    ).toEqual(["computed:src/lib/genome/admixture.ts"]);
    expect(provenanceLiterals('x({ kind: "computed", module: coverage.module ?? "genome/reports" })')).toEqual([
      'computed:?coverage.module ?? "genome/reports"',
    ]);
    expect(provenanceLiterals('{ kind: "seed", table: "risk_models", id: model.id }')).toEqual([
      "seed:risk_models",
    ]);
    expect(provenanceLiterals('<span data-provenance="citation:pmid:12553913" />')).toEqual([
      "citation:pmid:12553913",
    ]);
    // The discriminated union that declares the shape is not a provenance.
    expect(provenanceLiterals('type P = { kind: "citation"; id: string };')).toEqual([]);
  });

  it("keys a report's prose exactly as the presentation index keys it", () => {
    const blocks = reportProseBlocks({
      slug: "earwax-type-abcc11",
      summary: "A summary.",
      variants: [{ rsid: 17822931, interpretations: { TC: "One copy.", "": "" } }],
      citations: [{ pmid: "16444273", studyContext: { comparison: { text: "A comparison." }, empty: null } }],
    });
    expect(blocks).toEqual([
      { key: "report.earwax-type-abcc11.summary", kind: "summary", text: "A summary." },
      {
        key: "report.earwax-type-abcc11.interpretation.rs17822931.ct",
        kind: "interpretation",
        text: "One copy.",
      },
      {
        key: "report.earwax-type-abcc11.study.16444273.comparison",
        kind: "study-context",
        text: "A comparison.",
      },
    ]);
  });

  it("matches a concrete surface to a parameterised route, one segment at a time", () => {
    expect(pathMatchesRoute("/genome/[subject]/reports/earwax-type-abcc11", "/genome/[subject]/reports/[slug]")).toBe(true);
    expect(pathMatchesRoute("/genome/[subject]/reports", "/genome/[subject]/reports/[slug]")).toBe(false);
    expect(pathMatchesRoute("/embryos/compare", "/embryos/compare")).toBe(true);
    expect(pathMatchesRoute("/embryos/compare/extra", "/embryos/compare")).toBe(false);
  });
});
