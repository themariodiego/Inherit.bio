import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fleschKincaidGrade, readabilitySentences, wordCount } from "../../../scripts/readability";
import { QC_REASON_IDS } from "@/lib/embryos/qc-policy";
import {
  EMBRYO_QC_REFUSAL_CODES,
  EMBRYO_REASON_PARTS,
  INGEST_REFUSAL_CODES,
  INGEST_REFUSALS,
  SUBJECT_TARGET_REFUSALS,
  UPLOAD_COPY_IDS,
  ingestRefusal,
  isIngestRefusalCode,
  type IngestRefusalCode,
} from "./errors";

/**
 * Brief A.6 (line 2196): every code has a message, no message contains an
 * allele, genotype or variant identifier, and none exceeds 240 characters.
 * Beyond that: the codes and sentences are the brief's own table
 * character-for-character (with the typographic apostrophe brief line 511
 * mandates), every sentence is within the 25-word cap, every long block
 * within grade 9, and the three per-embryo reasons are the quality
 * reasons the register names.
 */

const BRIEF = fs.readFileSync(path.join(process.cwd(), "docs/inherit-v2-brief.md"), "utf8").split("\n");

/** The A.6 table rows: | `code` | trigger | "message" |. */
function briefTable(): Map<string, string> {
  const rows = new Map<string, string>();
  const start = BRIEF.findIndex((line) => line.trim() === "| Code | Trigger | Message |");
  expect(start).toBeGreaterThan(0);
  for (const line of BRIEF.slice(start + 2)) {
    const match = /^\| `([a-z_]+)` \| [^|]+ \| "(.+)" \|$/.exec(line.trim());
    if (!match) break;
    rows.set(match[1], match[2].replace(/'/g, "’"));
  }
  return rows;
}

const SAMPLE_SLOTS = { label: "Embryo 8", pct: 60, megabytes: 200 };

function rendered(code: IngestRefusalCode): string {
  return ingestRefusal(code, SAMPLE_SLOTS);
}

const JARGON = (
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/jargon.json"), "utf8")) as {
    terms: { term: string; aliases?: string[] }[];
  }
).terms.flatMap((entry) => [entry.term, ...(entry.aliases ?? [])]);

function withTermsReplaced(text: string): string {
  let result = text;
  for (const term of [...JARGON].sort((left, right) => right.length - left.length)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi"), "fact");
  }
  return result;
}

describe("the A.6 refusals", () => {
  it("define exactly the brief's ten codes, in its order", () => {
    const table = briefTable();
    expect([...table.keys()]).toEqual([...INGEST_REFUSAL_CODES]);
    expect(INGEST_REFUSAL_CODES).toHaveLength(10);
    for (const code of INGEST_REFUSAL_CODES) expect(isIngestRefusalCode(code)).toBe(true);
    expect(isIngestRefusalCode("file_too_large")).toBe(false);
    expect(isIngestRefusalCode(null)).toBe(false);
  });

  it("ship each sentence character-for-character, with the brief's slots filled", () => {
    const table = briefTable();
    const filled = (template: string) =>
      template.replace("{n}", String(SAMPLE_SLOTS.megabytes)).replace("{label}", SAMPLE_SLOTS.label).replace("{pct}", String(SAMPLE_SLOTS.pct));
    for (const code of INGEST_REFUSAL_CODES) {
      expect(rendered(code), code).toBe(filled(table.get(code)!));
    }
  });

  it("keep every rendered message within 240 characters", () => {
    for (const code of INGEST_REFUSAL_CODES) {
      expect(rendered(code).length, code).toBeLessThanOrEqual(240);
    }
    expect(ingestRefusal("embryo_call_rate", { label: "Embryo 64", pct: 84 }).length).toBeLessThanOrEqual(240);
  });

  it("name no allele, genotype or variant identifier", () => {
    for (const code of INGEST_REFUSAL_CODES) {
      const text = ingestRefusal(code, { label: "Embryo 1", pct: 60, megabytes: 200 });
      expect(text, code).not.toMatch(/\brs\d+\b/i);
      expect(text, code).not.toMatch(/\b[ACGT]\/[ACGT]\b/);
      expect(text, code).not.toMatch(/\b[ACGT]{2}\b/);
      expect(text, code).not.toMatch(/\bchr\w*:\d+\b/i);
      expect(text, code).not.toMatch(/\b\d+:\d+\b/);
    }
  });

  it("use the typographic apostrophe and dash, and stay within the sentence cap and grade 9", () => {
    for (const code of INGEST_REFUSAL_CODES) {
      const text = rendered(code);
      expect(text, code).not.toContain("'");
      expect(text, code).not.toContain(" - ");
      for (const sentence of readabilitySentences(text)) {
        expect(wordCount(sentence), `${code}: ${sentence}`).toBeLessThanOrEqual(25);
      }
      if (wordCount(text) >= 15) {
        expect(fleschKincaidGrade(withTermsReplaced(text)), `${code}: ${text}`).toBeLessThanOrEqual(9);
      }
    }
  });

  it("render a missing slot as nothing rather than a guessed value", () => {
    expect(ingestRefusal("embryo_parent_discordant")).toBe(`: ${EMBRYO_REASON_PARTS.embryo_parent_discordant.after}`);
    expect(ingestRefusal("too_large")).toBe(INGEST_REFUSALS.too_large(0));
  });

  it("carry the per-embryo reasons the quality policy names, split around the one measured number", () => {
    for (const code of EMBRYO_QC_REFUSAL_CODES) {
      expect(QC_REASON_IDS).toContain(code);
      expect(INGEST_REFUSAL_CODES).toContain(code);
    }
    expect(EMBRYO_REASON_PARTS.embryo_call_rate.before).toBe("we could read only");
    expect(EMBRYO_REASON_PARTS.embryo_parent_discordant.before).toBe("");
    expect(EMBRYO_REASON_PARTS.contamination.before).toBe("");
    expect(INGEST_REFUSALS.embryo_call_rate("Embryo 2", 60)).toContain("Embryo 2: we could read only 60 in 100 of the markers");
  });

  it("name the subject target's refusal of a cohort-shaped source under the register's code and copy id", () => {
    const register = fs.readFileSync(path.join(process.cwd(), "docs/route-register.json"), "utf8");
    expect(register).toContain('"const": "subject_source_not_single_sample"');
    expect(register).toContain('"const": "upload.subject.single-sample-required"');
    const text = SUBJECT_TARGET_REFUSALS.subject_source_not_single_sample;
    expect(UPLOAD_COPY_IDS["upload.subject.single-sample-required"]).toBe(text);
    expect(text.length).toBeLessThanOrEqual(240);
    expect(text).not.toContain("'");
    expect(text).not.toMatch(/\brs\d+\b|\b[ACGT]\/[ACGT]\b|\b[ACGT]{2}\b/);
    for (const sentence of readabilitySentences(text)) expect(wordCount(sentence)).toBeLessThanOrEqual(25);
    expect(fleschKincaidGrade(withTermsReplaced(text))).toBeLessThanOrEqual(9);
  });
});
