/**
 * The artifacts of the register's Path B for another adult's DNA (G2.6 adult
 * half, G5.3), as the owner decided on 2026-09-28 (docs/protocol/decisions.md):
 *
 *   - `consent.upload-other-adult` v1, approved in the morning. It describes
 *     the declined account-based flow and nobody has signed it, so it is kept
 *     as the earlier approved version and superseded;
 *   - `consent.upload-other-adult` v2, approved in the evening for Path B:
 *     the same seven statements, statement 6 reading "until they say yes to
 *     the file". Path B signs v2;
 *   - `consent.subject-adult-esignature` v1, the person's own signature,
 *     approved as written under its own key.
 *
 * Like every approved artifact, no file carries a draft status, and
 * `20260928150000_other_adult_held_upload.sql` seeds exactly each file's
 * text. The database's hard-coded statement keys must match the file and
 * `src/lib/uploads/other-adult-upload.ts`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fleschKincaidGrade } from "../../scripts/readability";
import { seededArtifacts } from "../../scripts/consent-statement-screen";
import { parseArtifactFile } from "@/lib/legal/artifact-file";
import {
  OTHER_ADULT_UPLOAD_ARTIFACT_KEY,
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  SUBJECT_ESIGNATURE_ARTIFACT_KEY,
  SUBJECT_ESIGNATURE_STATEMENT_KEYS,
  artifactStatements,
} from "@/lib/uploads/other-adult-upload";

const ROOT = process.cwd();
const MIGRATION_NAME = "20260928150000_other_adult_held_upload.sql";
const MIGRATION = path.join(ROOT, "supabase/migrations", MIGRATION_NAME);

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

function read(key: string, version = 1) {
  const source = fs.readFileSync(path.join(ROOT, "content/legal", key, `v${version}.md`), "utf8");
  const parsed = parseArtifactFile(source);
  if (!parsed) throw new Error(`${key} v${version}: malformed file`);
  return { source, ...parsed };
}

/** The exact insert the migration makes for one approved file (v1 shape). */
function seedSql(key: string, version: number) {
  const { meta, summary, body } = read(key, version);
  return "insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on)\n"
    + `values('${key}',${version},'${sha256(body)}',\n$artifact$${body}$artifact$,\n`
    + `'${summary.replace(/'/g, "''")}',\ndate '${meta.effective_on}');`;
}

function statementKeyArrays(key: string): string[][] {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const marker = new RegExp(`-- statement-keys:${key.replace(/\./g, "\\.")}\\n[^\\n]*?array\\[((?:'[^']*',?)+)\\]`, "g");
  return [...sql.matchAll(marker)].map((match) => [...match[1]!.matchAll(/'([^']*)'/g)].map((item) => item[1]!));
}

for (const [key, version, keys, mandatory] of [
  [OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 1, OTHER_ADULT_UPLOAD_STATEMENT_KEYS, UPLOADER_MANDATORY],
  [OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 2, OTHER_ADULT_UPLOAD_STATEMENT_KEYS, UPLOADER_MANDATORY],
  [SUBJECT_ESIGNATURE_ARTIFACT_KEY, 1, SUBJECT_ESIGNATURE_STATEMENT_KEYS, SUBJECT_MANDATORY],
] as const) {
  describe(`${key} v${version} text`, () => {
    it("is approved, well formed and hashed", () => {
      const { source, meta, summary, body } = read(key, version);
      expect(meta.artifact_key).toBe(key);
      expect(meta.version).toBe(String(version));
      expect(meta.status).toBeUndefined();
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
      const { summary, body } = read(key, version);
      for (const sentence of [...sentences(summary), ...sentences(body)]) {
        expect(words(sentence).length, sentence).toBeLessThanOrEqual(40);
      }
      // The readability gate's thresholds for an artifact: 9 for the summary, 11 for legal text.
      expect(fleschKincaidGrade(summary)).toBeLessThanOrEqual(9);
      expect(fleschKincaidGrade(body)).toBeLessThanOrEqual(11);
    });

    it("carries the brief's mandatory sentences verbatim", () => {
      const { body } = read(key, version);
      for (const sentence of mandatory) expect(body, sentence).toContain(sentence);
    });

    it("numbers one statement per published statement key, in order", () => {
      const { body } = read(key, version);
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

describe("consent.upload-other-adult: v1 kept and superseded, v2 signed", () => {
  it("seeds both versions, each exactly once, with its file's own text", () => {
    const seeded = seededArtifacts(ROOT).filter((artifact) => artifact.artifactKey === OTHER_ADULT_UPLOAD_ARTIFACT_KEY);
    expect(seeded.map((artifact) => [artifact.version, artifact.migration, artifact.body])).toEqual([
      [1, MIGRATION_NAME, read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 1).body],
      [2, MIGRATION_NAME, read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 2).body],
    ]);
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql).toContain(seedSql(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 1));
    const { meta, summary, body } = read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 2);
    expect(sql).toContain("insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown,"
      + "summary_markdown,effective_on,summary_of_changes)\n"
      + `values('${OTHER_ADULT_UPLOAD_ARTIFACT_KEY}',2,'${sha256(body)}',\n$artifact$${body}$artifact$,\n`
      + `'${summary.replace(/'/g, "''")}',\ndate '${meta.effective_on}',\n'For Path B.`);
  });

  it("supersedes v1 by its exact hash, before v2 is inserted, and deletes nothing", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const supersede = sql.indexOf("update public.consent_artifacts set superseded_at=clock_timestamp()\n"
      + " where artifact_key='consent.upload-other-adult' and version=1 and superseded_at is null\n"
      + `  and body_sha256='${sha256(read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 1).body)}';`);
    expect(supersede).toBeGreaterThan(sql.indexOf(seedSql(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 1)));
    expect(supersede).toBeLessThan(sql.indexOf(`values('${OTHER_ADULT_UPLOAD_ARTIFACT_KEY}',2,`));
    expect(sql).not.toMatch(/delete from public\.consent_artifacts/);
  });

  it("changes only what the owner approved: statement 6 reads until they say yes to the file", () => {
    const v1 = artifactStatements(read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 1).body);
    const v2 = artifactStatements(read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 2).body);
    expect(v2).toHaveLength(v1.length);
    v2.forEach((statement, index) => { if (index !== 5) expect(statement).toBe(v1[index]); });
    expect(v2[5]).toContain("until they say yes to the file");
    expect(v2[5]).not.toBe(v1[5]);
    expect(read(OTHER_ADULT_UPLOAD_ARTIFACT_KEY, 2).body).not.toMatch(/their own account|moves to their account/);
  });

  it("is signed twice over in the database: at signing and at every upload step", () => {
    expect(statementKeyArrays(OTHER_ADULT_UPLOAD_ARTIFACT_KEY)).toHaveLength(2);
  });
});

describe("consent.subject-adult-esignature v1, approved", () => {
  it("is seeded exactly once, by the Path B migration, with the file's own text", () => {
    const seeded = seededArtifacts(ROOT).filter((artifact) => artifact.artifactKey === SUBJECT_ESIGNATURE_ARTIFACT_KEY);
    expect(seeded.map((artifact) => [artifact.version, artifact.migration, artifact.body]))
      .toEqual([[1, MIGRATION_NAME, read(SUBJECT_ESIGNATURE_ARTIFACT_KEY).body]]);
    expect(fs.readFileSync(MIGRATION, "utf8")).toContain(seedSql(SUBJECT_ESIGNATURE_ARTIFACT_KEY, 1));
  });

  it("has no installer left: no text reaches the database outside a migration", () => {
    expect(fs.readFileSync(MIGRATION, "utf8")).not.toMatch(/install_test_local_subject_esignature_artifact/);
  });
});
