import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fleschKincaidGrade, readabilitySentences, wordCount } from "../../../scripts/readability";
import { inferCopyRole, vocabularyWords } from "../../../scripts/readability-gate";
import { GATE_CHECKBOX_LABEL, GATE_SESSION_NOTE } from "../family/person";
import { NAV_LABELS } from "../navigation";
import { ENTRY_BOXES, STATE_E } from "../overview";
import { REPORT_HEADINGS } from "../reports/headings";
import { KIND_CHIPS, NOT_DIAGNOSTIC } from "../reports/strings";
import * as compare from "./compare";
import * as detail from "./detail";
import * as gate from "./gate";
import { COPY_IDS } from "./ids";
import * as index from "./index";
import * as qc from "./qc";
import * as requestData from "./request-data";
import * as tradeoffs from "./tradeoffs";
import * as upload from "./upload";
import { INGEST_REFUSALS } from "../upload/errors";

/**
 * The Embryo copy registry (design §4). Mandated strings ship
 * character-for-character with U+2019 and U+2014; everything written for
 * these surfaces is graded, capped and checked word by word in its short
 * role, exactly as the readability gate will check it; no short role carries
 * a jargon term; the banned ranking phrases appear nowhere; and every copy
 * id the register names resolves here.
 */

const MODULES = { index, requestData, gate, qc, compare, detail, tradeoffs, upload };

/** Every exported string, including those the exported functions produce. */
function corpus(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (name: string, value: unknown) => {
    if (typeof value === "string") out.push([name, value]);
    else if (Array.isArray(value)) value.forEach((item, index) => walk(`${name}[${index}]`, item));
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) walk(`${name}.${key}`, item);
    }
  };
  for (const [module, registry] of Object.entries(MODULES)) {
    for (const [name, value] of Object.entries(registry)) {
      const key = `${module}.${name}`;
      if (typeof value === "function") {
        const fn = value as (...args: unknown[]) => string;
        walk(key, fn("fact", "fact", "fact"));
        walk(key, fn(3, 3, 3));
        walk(key, fn(1));
      } else walk(key, value);
    }
  }
  return out;
}

const SHORT_SUFFIXES = /(_LINK|_TH|_CHIP)$/;

/** The strings the gate checks word by word, plus the link, table-header and chip roles this registry adds. */
function shortRoleStrings(): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, text] of corpus()) {
    const exportName = name.split(".")[1] ?? name;
    const role = inferCopyRole([name.split(".").slice(1).join(".")]);
    const short =
      ["heading", "label", "button", "status"].includes(role) ||
      SHORT_SUFFIXES.test(exportName) ||
      exportName === "EMBRYO_STATUS" ||
      exportName === "HUB_TILES" && name.endsWith(".label") ||
      ["TESTED_OPTIONS", "SENT_OPTIONS", "SITUATION_OPTIONS", "BASIS_OPTIONS"].includes(exportName) && name.endsWith(".label") ||
      exportName === "CELL_WORDS" ||
      exportName === "CARRIER_WORDS" ||
      exportName === "QC_REASON_WORDS";
    if (short) out.push([name, text]);
  }
  return out;
}

const VOCABULARY = new Set(
  (JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/plain-vocabulary.json"), "utf8")) as { words: string[] }).words,
);

const JARGON = (
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/jargon.json"), "utf8")) as {
    terms: { term: string; aliases?: string[] }[];
  }
).terms.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])]);

/**
 * X7.3 keeps registered terms out of short roles. The exemptions are the
 * mandated strings whose wording a governing text fixes:
 *   - the layer labels a caption repeats are X5.1's (not short here);
 *   - "population" sits in a cell word the design fixes ("No population figure");
 *   - the QC words name the source laboratory's own fields.
 */
const TERM_EXEMPTIONS = new Map<string, string>([
  ["compare.CELL_WORDS.noPopulationFigure", "design §2.4 cell word"],
  ["qc.NOT_STATED_BY_SOURCE", "brief line 1398, verbatim"],
  ["upload.TESTED_QUESTION_HEADING", "brief line 375, verbatim"],
  ["upload.SITUATION_OPTIONS[1].label", "brief line 983, verbatim"],
]);

function withTermsReplaced(text: string): string {
  let result = text;
  for (const term of [...JARGON].sort((left, right) => right.length - left.length)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi"), "fact");
  }
  return result;
}

const REGISTER = fs.readFileSync(path.join(process.cwd(), "docs/route-register.json"), "utf8");

describe("embryo copy", () => {
  it("ships the brief's Embryo strings character-for-character", () => {
    expect(compare.STANDING_STATEMENT).toBe(
      "No child anywhere has been born and followed up after embryos were compared this way. There is no outcome data. Every number on this page is a simulation.",
    );
    expect(tradeoffs.NO_RANKING_STATEMENT).toBe("Inherit does not rank embryos and does not recommend one.");
    expect(tradeoffs.TRADEOFF_LINE_ONE).toBe(
      "The embryo with the lowest estimate for one condition often does not have the lowest estimate for another.",
    );
    expect(tradeoffs.TRADEOFFS_EXISTS).toBe("No embryo is first on every row.");
    expect(tradeoffs.conflictLine("Embryo 2", "heart", "cancer")).toBe(
      "Embryo 2 has the lowest heart risk and the highest cancer risk.",
    );
    expect(tradeoffs.CANNOT_HAVE_BEST_OF_EACH).toBe(
      "If you care about more than one condition, you cannot have the best of each. Choosing for one moves the others.",
    );
    expect(compare.CELL_WORDS.notMeasurable).toBe("Not measurable");
    expect(qc.QC_FAILED_CHIP).toBe("Quality check not passed");
    expect(compare.CELL_WORDS.tooCloseToTellApart).toBe("Too close to tell apart");
    expect(compare.WITHIN_FAMILY_NOT_TESTED).toBe(
      "No one has measured whether this estimate holds up between brothers and sisters. It is a population estimate used where it has not been tested.",
    );
    expect(qc.NOT_STATED_BY_SOURCE).toBe("Not stated by the source laboratory");
    expect(qc.DROPOUT_NOT_MEASURED).toBe("Not measured — the ranges below are wider because of this.");
    expect(qc.QC_MARGINAL_QUALIFIER).toBe("The data for this embryo is thinner than we would like.");
    expect(qc.NOT_MEASURABLE_FROM_FILE).toBe("not measurable from this file");
    expect(compare.nnsSentence(40)).toBe("About 40 couples would need to choose this way for one case to be avoided.");
    expect(compare.PERCENTAGE_POINTS_GLOSS).toBe("(percentage points, not percent)");
    expect(compare.COMPARED_WITH_RANDOM).toBe("compared with picking one of these embryos at random.");
    expect(compare.OTHER_WAYS_LABEL).toBe("Other ways of comparing");
    expect(compare.OTHER_WAYS_INTRO).toBe(
      "These four numbers describe the same embryo. They differ because they compare it with different things.",
    );
    expect(compare.NOT_DISTINGUISHABLE).toBe("These embryos are not distinguishable for this trait using this data.");
    expect(compare.NOT_MEASURED_COMPARISON).toBe(
      "This comparison is between people who share most of their DNA. This score has never been tested that way, so the difference below may be smaller than it looks — possibly much smaller.",
    );
    expect(detail.NOTHING_SETS_APART).toBe("There is nothing here that sets this embryo apart from the others.");
    expect(detail.LIMIT_OF_FILE_EMBRYO).toBe(
      "This is a limit of the file the laboratory sent, not a result about this embryo.",
    );
    expect(detail.populationBaseline("3", "100", "a source")).toBe(
      "About 3 in 100 people in the general population. Source: a source.",
    );
    expect(detail.NO_POPULATION_FIGURE).toBe("Inherit has no population figure to compare this against.");
    expect(index.EMPTY_HEADING).toBe("No embryo files added yet.");
    expect(index.REQUEST_DATA_BUTTON).toBe("How to get your embryo files");
    expect(requestData.LETTER).toBe(
      "Please could you send me the genetic data files from the preimplantation genetic testing (PGT) on my embryos — the genotype or sequence files behind the report, not the report itself. Labs usually call these VCF files, genotype call files, or ‘the raw data’. I would like one file per embryo, or one file with a column per embryo.",
    );
    expect(gate.GATE_CHECKBOX_LABEL).toBe("I understand this can tell me something I can’t un-know.");
    expect(gate.GATE_SESSION_NOTE).toBe("You won’t be asked again until you sign out.");
    expect(gate.GATE_BUTTON).toBe("Show my embryos");
    expect(index.HUB_TILES.find((tile) => tile.id === "copilot")!.blocked).toBe(
      "Copilot for embryos runs only on a model you host yourself. It is not connected on this site yet.",
    );
    expect(compare.NO_ROWS_SENTENCE).toBe(
      "Inherit has no calibrated model registered for embryos yet, so no condition row can be shown. What you see is the quality check for each file.",
    );
    expect(detail.NO_RESULTS_SENTENCE).toBe(
      "Inherit has no calibrated model registered for embryos yet, so it shows no result for any condition. The quality check below is real; the results are not built.",
    );
    expect(tradeoffs.TRADEOFFS_NONE_MEASURABLE).toBe(
      "There is no trade-off to show: too little could be measured to set one row against another.",
    );
    expect(tradeoffs.availabilityStatement(8)).toBe(
      "This page shows 8 embryos because the laboratory sent 8 files. Inherit shows nothing about any embryo it has no file for.",
    );
    expect(index.RETENTION_DONATED_OR_DISCARDED).toBe("Donated or discarded: deleted 90 days after that was recorded.");
    expect(index.RETENTION_TRANSFERRED).toBe(
      "Transferred: kept for the future person until the date on the Record Key Card.",
    );
    expect(index.RETENTION_SENTENCE).toMatch(/^Inherit deletes these files 24 months after they were added or last analysed, whichever is later\./);
    expect(compare.COMPARE_H1).toBe("Compare embryos");
    expect(index.EMBRYO_STATUS).toEqual({
      pending: "Checking the file",
      qc_pass: "Ready",
      qc_marginal: "Ready, with a thinner file",
      qc_fail: "Quality check not passed",
      excluded: "Not included",
      stored: "Stored",
      transferred: "Transferred",
      donated: "Donated",
      discarded: "Discarded",
      claimed_bound: "Claimed",
    });
  });

  it("ships the brief's upload strings character-for-character", () => {
    expect(upload.TESTED_QUESTION_HEADING).toBe("Did your clinic do genetic testing on your embryos?");
    expect(upload.TESTED_OPTIONS.map((option) => option.label)).toEqual(["Yes", "No", "I’m not sure"]);
    expect(upload.NO_TESTING_END).toBe(
      "Inherit needs data from a genetic test the laboratory already ran. Without it there is nothing to read.",
    );
    expect(upload.WHO_QUESTION_HEADING).toBe("Who did the testing?");
    expect(upload.WHO_NOT_KEPT_NOTE).toBe("Inherit does not keep this name.");
    expect(upload.SENT_QUESTION_HEADING).toBe("What did they send you?");
    expect(upload.SENT_OPTIONS.map((option) => option.label)).toEqual([
      "A spreadsheet or text file per embryo",
      "One file with a column per embryo",
      "A PDF report only",
      "A zip folder",
    ]);
    expect(upload.SENT_UNKNOWN_LINK).toBe("I don’t know — let me upload it and you tell me");
    expect(upload.PDF_REFUSAL).toBe(INGEST_REFUSALS.pdf_not_data);
    expect(upload.SITUATION_OPTIONS.map((option) => option.label)).toEqual([
      "My embryos",
      "Embryos, with both genetic parents’ permission",
    ]);
    expect(upload.SITUATION_OPTIONS.map((option) => option.attestation)).toEqual([
      "These are my own embryos and I am a genetic parent.",
      "Both genetic parents have given me permission to upload these embryos to Inherit. I can show that permission if asked.",
    ]);
    expect(upload.BASIS_OPTIONS.map((option) => option.id)).toEqual([
      "two-evidenced-parents",
      "donor-gamete-anonymous",
      "parent-deceased",
      "sole-legal-disposition-authority",
    ]);
    expect(upload.BASIS_OPTIONS[1].sentence).toBe(
      "A gamete donor cannot consent here and has not. Inherit will not attempt to identify a donor, and will not report on relatives found in your data.",
    );
    expect(upload.BASIS_OPTIONS[3].sentence).toBe(
      "Inherit is not able to judge a family dispute. If the other genetic parent tells us they object, we stop and delete.",
    );
    expect(upload.INGEST_UNAVAILABLE_SENTENCE).toBe("Inherit cannot take embryo files on this site yet.");
    expect(upload.UPLOAD_H1).toBe("Add embryo files");
    expect(upload.stepStatus(1)).toBe("Step 1 of 5");
    expect(upload.STEP_TOTAL).toBe(5);
    expect(upload.EMBRYO_INGEST_AVAILABLE).toBe(false);
    // The option ids are the register's request-body enums.
    expect(REGISTER).toContain('"const": "own-embryos"');
    expect(REGISTER).toContain('"const": "with-genetic-parents-permission"');
    for (const option of upload.BASIS_OPTIONS) expect(REGISTER).toContain(`"${option.id}"`);
  });

  it("reads shared strings from their one home instead of respelling them", () => {
    expect(index.EMBRYOS_H1).toBe(NAV_LABELS.embryos);
    expect(index.EMBRYO_KIND_CHIP).toBe(KIND_CHIPS.embryo);
    expect(index.NOT_DIAGNOSTIC).toBe(NOT_DIAGNOSTIC);
    expect(compare.NOT_DIAGNOSTIC).toBe(NOT_DIAGNOSTIC);
    expect(gate.GATE_CHECKBOX_LABEL).toBe(GATE_CHECKBOX_LABEL);
    expect(gate.GATE_SESSION_NOTE).toBe(GATE_SESSION_NOTE);
    expect(compare.HOW_SURE_HEADING).toBe(REPORT_HEADINGS[3]);
    expect(compare.WHERE_FROM_HEADING).toBe(REPORT_HEADINGS[5]);
    expect(compare.contextPassed(6)).toBe(STATE_E.passed(6));
    expect(index.HUB_TILES.find((tile) => tile.id === "upload")!.label).toBe(
      ENTRY_BOXES.find((box) => box.id === "embryos.upload")!.label,
    );
    expect(index.HUB_TILES.find((tile) => tile.id === "compare")!.label).toBe(
      ENTRY_BOXES.find((box) => box.id === "embryos.compare")!.label,
    );
    expect(requestData.REQUEST_DATA_H1).toBe(index.REQUEST_DATA_BUTTON);
    expect(upload.REQUEST_DATA_BUTTON).toBe(index.REQUEST_DATA_BUTTON);
    expect(upload.BACK_TO_EMBRYOS_LINK).toBe(requestData.BACK_TO_EMBRYOS_LINK);
  });

  it("resolves every copy id the register names to one string", () => {
    for (const id of Object.keys(COPY_IDS)) {
      if (id === "embryo.tradeoffs.conflict") continue;
      expect(REGISTER, id).toContain(id);
    }
    for (const value of Object.values(COPY_IDS)) {
      expect(typeof value === "string" ? value.length : value.length).toBeGreaterThan(0);
    }
    expect(COPY_IDS["embryo.standing-statement"]).toBe(compare.STANDING_STATEMENT);
    expect(COPY_IDS["embryo.qc.quality-check-not-passed"]).toBe(qc.QC_FAILED_CHIP);
  });

  it("uses only registered plain words in every short role, and no jargon", () => {
    const strings = shortRoleStrings();
    expect(strings.length).toBeGreaterThan(40);
    for (const [name, text] of strings) {
      for (const word of vocabularyWords(text)) {
        if (word === "fact") continue;
        expect(VOCABULARY.has(word), `${name}: '${word}' in "${text}"`).toBe(true);
      }
      if (TERM_EXEMPTIONS.has(name)) continue;
      for (const term of JARGON) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(text, `${name}: jargon '${term}' in "${text}"`).not.toMatch(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i"));
      }
    }
  });

  it("uses typographic apostrophes and stays within grade 9 and the sentence caps", () => {
    for (const [name, text] of corpus()) {
      expect(text, name).not.toContain("'");
      for (const sentence of readabilitySentences(text)) {
        expect(wordCount(sentence), `${name}: ${sentence}`).toBeLessThanOrEqual(32);
      }
      if (wordCount(text) >= 15) {
        expect(fleschKincaidGrade(withTermsReplaced(text)), `${name}: ${text}`).toBeLessThanOrEqual(9);
      }
    }
    for (const [name, text] of shortRoleStrings()) {
      for (const sentence of readabilitySentences(text)) {
        expect(wordCount(sentence), `${name}: ${sentence}`).toBeLessThanOrEqual(25);
      }
    }
  });

  it("never names a best, a top, a winner, a rank or a sex", () => {
    for (const [name, text] of corpus()) {
      expect(text, name).not.toMatch(/\bthe best embryo\b|\btop embryo\b|\bwinner\b|\branked\b/i);
      expect(text, name).not.toMatch(/\b(sex|male|female|XX|XY|karyotype)\b/i);
    }
  });
});
