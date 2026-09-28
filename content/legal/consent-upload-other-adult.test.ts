/**
 * The two artifacts of the register's Path B for another adult's DNA
 * (G2.6 adult half, G5.3).
 *
 *   - `consent.upload-other-adult` v1, the uploader's Tier-2 consent. The
 *     owner approved it as written on 2026-09-28 (docs/protocol/decisions.md),
 *     so, like every approved artifact, its file carries no draft status and
 *     `20260928150000_other_adult_held_upload.sql` seeds exactly its text.
 *   - `consent.subject-adult-esignature` v1, the person's own signature. The
 *     owner has not approved it: its file is marked as a draft, no migration
 *     seeds it, and the one TEST-LOCAL installer pins its text by hash.
 *
 * For both, the database's hard-coded statement keys and the pgTAP suite's
 * copy of the text must match the file and `src/lib/uploads/other-adult-upload.ts`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fleschKincaidGrade } from "../../scripts/readability";
import { seededArtifacts } from "../../scripts/consent-statement-screen";
import { parseArtifactFile } from "@/lib/legal/artifact-file";
import {
  ARTIFACT_DRAFT_STATUS,
  OTHER_ADULT_UPLOAD_ARTIFACT_KEY,
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  SUBJECT_ESIGNATURE_ARTIFACT_KEY,
  SUBJECT_ESIGNATURE_STATEMENT_KEYS,
  artifactStatements,
} from "@/lib/uploads/other-adult-upload";

const ROOT = process.cwd();
const MIGRATION_NAME = "20260928150000_other_adult_held_upload.sql";
const MIGRATION = path.join(ROOT, "supabase/migrations", MIGRATION_NAME);
const SUITE = path.join(ROOT, "supabase/tests/other_adult_held_upload.sql");

/** Brief §3, verbatim, required in the uploader's artifact. */
const UPLOADER_MANDATORY = [
  "We cannot verify who you are or whose DNA this is. What we can do is make it impossible to do this by accident, keep a permanent record of exactly what you told us, and give the other person a real way to stop it.",
  "We cannot check that the person accepting this invitation is the person whose DNA this is.",
  "Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.",
];
const SUBJECT_MANDATORY = [
  "We cannot check that the person accepting this invitation is the person whose DNA this is.",
];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => /[A-Za-z]/.test(sentence));
}

function read(key: string) {
  const source = fs.readFileSync(path.join(ROOT, "content/legal", key, "v1.md"), "utf8");
  const parsed = parseArtifactFile(source);
  if (!parsed) throw new Error(`${key}: malformed file`);
  return { source, ...parsed };
}

function statementKeyArrays(key: string): string[][] {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const marker = new RegExp(`-- statement-keys:${key.replace(/\./g, "\\.")}\\n[^\\n]*?array\\[((?:'[^']*',?)+)\\]`, "g");
  return [...sql.matchAll(marker)].map((match) => [...match[1]!.matchAll(/'([^']*)'/g)].map((item) => item[1]!));
}

for (const [key, keys, mandatory] of [
  [OTHER_ADULT_UPLOAD_ARTIFACT_KEY, OTHER_ADULT_UPLOAD_STATEMENT_KEYS, UPLOADER_MANDATORY],
  [SUBJECT_ESIGNATURE_ARTIFACT_KEY, SUBJECT_ESIGNATURE_STATEMENT_KEYS, SUBJECT_MANDATORY],
] as const) {
  describe(`${key} text`, () => {
    it("is well formed and hashed", () => {
      const { source, meta, summary, body } = read(key);
      expect(meta.artifact_key).toBe(key);
      expect(meta.version).toBe("1");
      expect(meta.effective_on).toBe("2026-09-28");
      expect(meta.body_sha256).toBe(sha256(body));
      expect(source).not.toMatch(/\r/);
      expect(source).not.toMatch(/[‘’“”]/);
      expect(summary).not.toMatch(/\n/);
      expect(words(summary).length).toBeLessThanOrEqual(120);
      expect(body).not.toMatch(/\n{3,}/);
      expect(body).not.toMatch(/<[^>]+>/);
      expect(body).not.toMatch(/[*_`#]/);
    });

    it("keeps every sentence at or under 40 words and reads plainly", () => {
      const { summary, body } = read(key);
      for (const sentence of [...sentences(summary), ...sentences(body)]) {
        expect(words(sentence).length, sentence).toBeLessThanOrEqual(40);
      }
      // The readability gate's thresholds for an artifact: 9 for the summary, 11 for legal text.
      expect(fleschKincaidGrade(summary)).toBeLessThanOrEqual(9);
      expect(fleschKincaidGrade(body)).toBeLessThanOrEqual(11);
    });

    it("carries the brief's mandatory sentences verbatim", () => {
      const { body } = read(key);
      for (const sentence of mandatory) expect(body, sentence).toContain(sentence);
    });

    it("numbers one statement per published statement key, in order", () => {
      const { body } = read(key);
      expect([...body.matchAll(/^(\d+)\. \S/gm)].map((match) => Number(match[1])))
        .toEqual(keys.map((_, index) => index + 1));
      expect(artifactStatements(body)).toHaveLength(keys.length);
    });

    it("hard-codes the same statement keys in every database check", () => {
      const arrays = statementKeyArrays(key);
      expect(arrays.length).toBeGreaterThanOrEqual(1);
      for (const found of arrays) expect(found).toEqual([...keys]);
    });
  });
}

describe("consent.upload-other-adult v1, approved", () => {
  it("carries no draft status, as every approved artifact", () => {
    expect(read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY).meta.status).toBeUndefined();
  });

  it("is seeded exactly once, by the Path B migration, with the file's own text", () => {
    const { meta, summary, body } = read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY);
    const seeded = seededArtifacts(ROOT).filter((artifact) => artifact.artifactKey === OTHER_ADULT_UPLOAD_ARTIFACT_KEY);
    expect(seeded.map((artifact) => [artifact.version, artifact.body])).toEqual([[1, body]]);
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql).toContain(`values('consent.upload-other-adult',1,'${sha256(body)}',\n$artifact$${body}$artifact$,\n`
      + `'${summary.replace(/'/g, "''")}',\ndate '${meta.effective_on}');`);
  });

  it("is signed twice over in the database: at signing and at every upload step", () => {
    expect(statementKeyArrays(OTHER_ADULT_UPLOAD_ARTIFACT_KEY)).toHaveLength(2);
  });
});

describe("consent.subject-adult-esignature v1, a draft", () => {
  it("is marked as awaiting the owner's approval", () => {
    expect(read(SUBJECT_ESIGNATURE_ARTIFACT_KEY).meta.status).toBe(ARTIFACT_DRAFT_STATUS);
  });

  it("is seeded by no migration, so no deployment publishes it", () => {
    expect(seededArtifacts(ROOT).filter((artifact) => artifact.artifactKey === SUBJECT_ESIGNATURE_ARTIFACT_KEY)).toEqual([]);
  });

  it("is pinned, by hash, in the TEST-LOCAL installer", () => {
    const { meta, summary, body } = read(SUBJECT_ESIGNATURE_ARTIFACT_KEY);
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql.match(/-- pinned-body-sha256:consent\.subject-adult-esignature\n[^\n]*<>'([0-9a-f]{64})'/)?.[1]).toBe(sha256(body));
    expect(sql.match(/-- pinned-summary-sha256:consent\.subject-adult-esignature\n[^\n]*<>'([0-9a-f]{64})'/)?.[1]).toBe(sha256(summary));
    expect(sql).toContain(`p_effective_on is distinct from date '${meta.effective_on}'`);
    expect(sql).toContain(`values('consent.subject-adult-esignature',1,'${sha256(body)}',`);
  });

  it("is the exact text the pgTAP suite installs", () => {
    const { summary, body } = read(SUBJECT_ESIGNATURE_ARTIFACT_KEY);
    const suite = fs.readFileSync(SUITE, "utf8");
    expect(suite).toContain(`$artifact$${body}$artifact$`);
    expect(suite).toContain(`$summary$${summary}$summary$`);
  });
});
