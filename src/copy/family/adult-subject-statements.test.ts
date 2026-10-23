import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fleschKincaidGrade, readabilitySentences, wordCount } from "../../../scripts/readability";
import {
  collectReadabilityBlocks,
  extractCopyRegistryBlocksFromSource,
  runReadabilityGate,
  vocabularyWords,
} from "../../../scripts/readability-gate";
import { ADULT_SUBJECT_STATEMENTS, ADULT_SUBJECT_STATEMENTS_HEADING } from "./adult-subject-statements";

/**
 * D-103: the five statements an invited adult ticks before accepting through
 * their own account. They are signed copy (docs/protocol/copy-for-signature.md
 * and docs/protocol/decisions.md, 23 October 2026), so this suite pins every
 * byte, holds the module to the signed record and to the keys the database
 * records, and proves the readability gate measures them where they live.
 */

const ROOT = process.cwd();
const MODULE = "src/copy/family/adult-subject-statements.ts";

/** The signed text, spelled out here once more so a change to the module alone cannot pass. */
const SIGNED: readonly (readonly [string, string])[] = [
  ["age-18-plus", "I am 18 or older."],
  ["mailbox-control", "This email address is mine, and I am the only person who reads it."],
  ["no-inviter-access",
    "The person who invited me cannot make this decision for me, and cannot see what I choose until I choose it."],
  ["identity-not-verified", "Inherit has not checked who I am. It knows only that I can read this mailbox."],
  ["revocable",
    "I can take this back at any time. Inherit then deletes what was built from my file, on the deadlines it publishes."],
];

/** The 14 September draft of `revocable`, one sentence at grade 9.08: approved then, replaced by the split. */
const UNSPLIT_REVOCABLE =
  "I can take this back at any time, and Inherit deletes what was built from my file on the deadlines it publishes.";

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

describe("the five D-103 statements are the signed text, byte for byte", () => {
  it("ships the five keys in the order the transaction records them, each with its signed sentence", () => {
    expect(ADULT_SUBJECT_STATEMENTS.map(statement => statement.key)).toEqual(SIGNED.map(([key]) => key));
    for (const [index, [key, text]] of SIGNED.entries()) {
      const shipped = ADULT_SUBJECT_STATEMENTS[index]!;
      expect(shipped.key).toBe(key);
      expect(hex(shipped.text), key).toBe(hex(text));
      // Printable ASCII only: no typographic quote, no-break space or other
      // look-alike that would read the same and sign something else.
      expect(shipped.text, key).toMatch(/^[\x20-\x7e]+$/);
      expect(shipped.text, key).toBe(shipped.text.trim());
      expect(shipped.text, key).not.toMatch(/ {2}/);
    }
  });

  it("ships the split revocable sentence the owner signed on 23 October, not the 14 September draft", () => {
    const revocable = ADULT_SUBJECT_STATEMENTS.find(statement => statement.key === "revocable")!.text;
    expect(revocable).toBe(
      "I can take this back at any time. Inherit then deletes what was built from my file, on the deadlines it publishes.");
    expect(revocable).not.toBe(UNSPLIT_REVOCABLE);
    expect(readabilitySentences(revocable)).toEqual([
      "I can take this back at any time.",
      "Inherit then deletes what was built from my file, on the deadlines it publishes.",
    ]);
  });

  it("matches the signed record: the four 14 September rows, and the 23 October quotation", () => {
    const record = fs.readFileSync(path.join(ROOT, "docs/protocol/copy-for-signature.md"), "utf8");
    const rows = new Map([...record.matchAll(/^\| `([a-z0-9-]+)` \| (.+?) \|$/gm)].map(match => [match[1]!, match[2]!]));
    for (const statement of ADULT_SUBJECT_STATEMENTS.filter(statement => statement.key !== "revocable")) {
      expect(rows.get(statement.key), statement.key).toBe(statement.text);
    }
    // The table keeps the draft as it was approved; the shipped sentence is the signed split.
    expect(rows.get("revocable")).toBe(UNSPLIT_REVOCABLE);

    const decisions = fs.readFileSync(path.join(ROOT, "docs/protocol/decisions.md"), "utf8");
    const heading = "## 2026-10-23 — D-103: the owner signs the split `revocable` sentence";
    expect(decisions.split("\n").filter(line => line === heading)).toHaveLength(1);
    const entry = decisions.slice(decisions.indexOf(heading)).split(/\n## /)[0]!;
    const quoted = entry.split("\n").filter(line => line.startsWith("> ")).map(line => line.slice(2)).join(" ");
    expect(quoted).toBe(ADULT_SUBJECT_STATEMENTS.find(statement => statement.key === "revocable")!.text);
  });

  it("publishes exactly the keys every migration records or reads for an adult acceptance", () => {
    const keys = ADULT_SUBJECT_STATEMENTS.map(statement => statement.key);
    const directory = path.join(ROOT, "supabase/migrations");
    const files = fs.readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
    const literals = files.flatMap(name => [...fs.readFileSync(path.join(directory, name), "utf8")
      .matchAll(/array\[\s*'age-18-plus'[^\]]*\]/g)].map(match => ({ name, literal: match[0] })));
    // Seven migrations write or read the array; each carries this exact list.
    expect(literals.length).toBeGreaterThanOrEqual(7);
    for (const { name, literal } of literals) {
      expect([...literal.matchAll(/'([^']*)'/g)].map(match => match[1]), name).toEqual(keys);
    }
    // The body that records them today is the last migration to define the
    // acceptance, and no later migration patches it in place.
    const mentions = files.filter(name =>
      fs.readFileSync(path.join(directory, name), "utf8").includes("adult_subject_invitation_response_v1"));
    const current = mentions.at(-1)!;
    expect(current).toBe("20260928150000_other_adult_held_upload.sql");
    const source = fs.readFileSync(path.join(directory, current), "utf8");
    const body = source.slice(source.lastIndexOf("create or replace function private.adult_subject_invitation_response_v1("));
    const recorded = /'adult-subject-account-acceptance',\s*(array\[[^\]]*\])/.exec(body)?.[1];
    expect([...(recorded ?? "").matchAll(/'([^']*)'/g)].map(match => match[1])).toEqual(keys);
  });
});

describe("the readability gate measures the five statements where they live", () => {
  const source = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
  const fixtures: string[] = [];
  afterAll(() => { for (const root of fixtures) fs.rmSync(root, { recursive: true, force: true }); });

  it("reads each sentence from the copy registry as an ordinary block, not as legal copy", () => {
    const blocks = extractCopyRegistryBlocksFromSource(MODULE, source);
    const statements = blocks.filter(block => ADULT_SUBJECT_STATEMENTS.some(statement => statement.text === block.text));
    expect(statements.map(({ text, role, legal, legalSummary }) => ({ text, role, legal, legalSummary })))
      .toEqual(ADULT_SUBJECT_STATEMENTS.map(statement => ({ text: statement.text, role: "block", legal: false, legalSummary: false })));
    // The keys are identifiers, not copy; the legend is a heading.
    expect(blocks.map(block => block.text).sort())
      .toEqual([...ADULT_SUBJECT_STATEMENTS.map(statement => statement.text), ADULT_SUBJECT_STATEMENTS_HEADING].sort());
    expect(blocks.find(block => block.text === ADULT_SUBJECT_STATEMENTS_HEADING)?.role).toBe("heading");
    // And the whole-repository scan the gate runs finds them at this path.
    const scanned = collectReadabilityBlocks(ROOT).filter(block => block.path === MODULE);
    expect(scanned.map(block => block.text).sort()).toEqual(blocks.map(block => block.text).sort());
  });

  it("holds every statement of 15 words or more to grade 9, and the gate passes the module", () => {
    const graded = ADULT_SUBJECT_STATEMENTS.filter(statement => wordCount(statement.text) >= 15)
      .map(statement => statement.key);
    expect(graded).toEqual(["no-inviter-access", "identity-not-verified", "revocable"]);
    for (const statement of ADULT_SUBJECT_STATEMENTS) {
      for (const sentence of readabilitySentences(statement.text)) expect(wordCount(sentence)).toBeLessThanOrEqual(25);
      if (wordCount(statement.text) >= 15) expect(fleschKincaidGrade(statement.text), statement.key).toBeLessThanOrEqual(9);
    }
    const vocabulary = JSON.parse(fs.readFileSync(path.join(ROOT, "data/plain-vocabulary.json"), "utf8")) as { words: string[] };
    for (const word of vocabularyWords(ADULT_SUBJECT_STATEMENTS_HEADING)) expect(vocabulary.words, word).toContain(word);
    expect(runReadabilityGate(ROOT).failures.filter(failure => failure.startsWith(`${MODULE}:`))).toEqual([]);
  });

  /** A throwaway tree with the real scorer pins, vocabulary and jargon, and only this module as copy. */
  function fixtureRepository(moduleSource: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "adult-subject-statements-"));
    fixtures.push(root);
    for (const directory of ["data/templates", "data/providers", "supabase/migrations", "docs", path.dirname(MODULE)]) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    for (const file of ["package.json", "data/plain-vocabulary.json", "data/jargon.json", "data/glossary-citations.json"]) {
      fs.copyFileSync(path.join(ROOT, file), path.join(root, file));
    }
    fs.symlinkSync(path.join(ROOT, "docs/sources"), path.join(root, "docs/sources"));
    fs.writeFileSync(path.join(root, "data/providers/providers.json"), "[]\n");
    // The gate requires its listed model-facing module to exist; it never scores it.
    fs.mkdirSync(path.join(root, "src/copy/copilot"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/copy/copilot/system-prompts.ts"), "export {};\n");
    fs.writeFileSync(path.join(root, MODULE), moduleSource);
    return root;
  }

  it("passes the signed module alone, and fails it at grade 9 with the 14 September sentence in place", () => {
    expect(runReadabilityGate(fixtureRepository(source)).failures).toEqual([]);
    const signed = SIGNED.find(([key]) => key === "revocable")![1];
    expect(source.split(signed)).toHaveLength(2);
    const planted = runReadabilityGate(fixtureRepository(source.replace(signed, UNSPLIT_REVOCABLE))).failures;
    expect(planted).toEqual([expect.stringMatching(
      new RegExp(`^${MODULE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}:\\d+: grade 9\\.1 exceeds 9 \\(I can take this back at any time, and Inherit`))]);
  });
});
