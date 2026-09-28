/**
 * The draft `consent.upload-other-adult` artifact (G2.6 adult half, G5.3).
 *
 * The owner has not approved this text, so it must never reach production.
 * This test holds the three places that carry it equal and keeps it out of
 * every seed:
 *   - the file `content/legal/consent.upload-other-adult/v1.md` is the
 *     source and is marked as a draft awaiting approval;
 *   - no migration seeds it into `public.consent_artifacts`; the only way in
 *     is the TEST-LOCAL installer, which pins this exact body, summary and
 *     date by hash in `20260928150000_other_adult_held_upload.sql`;
 *   - the database's hard-coded statement keys and the pgTAP suite's copy of
 *     the text match the file and `src/lib/uploads/other-adult-upload.ts`.
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
  OTHER_ADULT_UPLOAD_DRAFT_STATUS,
  OTHER_ADULT_UPLOAD_STATEMENT_KEYS,
  artifactStatements,
} from "@/lib/uploads/other-adult-upload";

const ROOT = process.cwd();
const FILE = path.join(ROOT, "content/legal", OTHER_ADULT_UPLOAD_ARTIFACT_KEY, "v1.md");
const MIGRATION = path.join(ROOT, "supabase/migrations/20260928150000_other_adult_held_upload.sql");
const SUITE = path.join(ROOT, "supabase/tests/other_adult_held_upload.sql");

/** Brief §3, verbatim, required in this artifact. */
const MANDATORY = [
  "We cannot verify who you are or whose DNA this is. What we can do is make it impossible to do this by accident, keep a permanent record of exactly what you told us, and give the other person a real way to stop it.",
  "We cannot check that the person accepting this invitation is the person whose DNA this is.",
  "Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.",
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

function read() {
  const source = fs.readFileSync(FILE, "utf8");
  const parsed = parseArtifactFile(source);
  if (!parsed) throw new Error("consent.upload-other-adult: malformed file");
  return { source, ...parsed };
}

describe("consent.upload-other-adult draft", () => {
  it("is well formed, hashed, and marked as awaiting owner approval", () => {
    const { source, meta, summary, body } = read();
    expect(meta).toEqual({
      artifact_key: OTHER_ADULT_UPLOAD_ARTIFACT_KEY,
      version: "1",
      effective_on: "2026-09-28",
      body_sha256: sha256(body),
      status: OTHER_ADULT_UPLOAD_DRAFT_STATUS,
    });
    expect(source).not.toMatch(/\r/);
    expect(source).not.toMatch(/[‘’“”]/);
    expect(summary).not.toMatch(/\n/);
    expect(words(summary).length).toBeLessThanOrEqual(120);
    expect(body).not.toMatch(/\n{3,}/);
    expect(body).not.toMatch(/<[^>]+>/);
    expect(body).not.toMatch(/[*_`#]/);
  });

  it("keeps every sentence at or under 40 words and reads plainly", () => {
    const { summary, body } = read();
    for (const sentence of [...sentences(summary), ...sentences(body)]) {
      expect(words(sentence).length, sentence).toBeLessThanOrEqual(40);
    }
    // The readability gate's thresholds for a seeded artifact: 9 for the
    // summary, 11 for legal text. This file is not seeded, so it is held here.
    expect(fleschKincaidGrade(summary)).toBeLessThanOrEqual(9);
    expect(fleschKincaidGrade(body)).toBeLessThanOrEqual(11);
  });

  it("carries the brief's mandatory sentences verbatim", () => {
    const { body } = read();
    for (const sentence of MANDATORY) expect(body, sentence).toContain(sentence);
  });

  it("numbers one statement per published statement key, in order", () => {
    const { body } = read();
    expect([...body.matchAll(/^(\d+)\. \S/gm)].map((match) => Number(match[1])))
      .toEqual(OTHER_ADULT_UPLOAD_STATEMENT_KEYS.map((_, index) => index + 1));
    expect(artifactStatements(body)).toHaveLength(OTHER_ADULT_UPLOAD_STATEMENT_KEYS.length);
  });

  it("is seeded by no migration, so no deployment publishes it", () => {
    expect(seededArtifacts(ROOT).filter((artifact) => artifact.artifactKey === OTHER_ADULT_UPLOAD_ARTIFACT_KEY)).toEqual([]);
  });

  it("is pinned, by hash, in the TEST-LOCAL installer", () => {
    const { meta, summary, body } = read();
    const sql = fs.readFileSync(MIGRATION, "utf8");
    expect(sql.match(/-- pinned-body-sha256:consent\.upload-other-adult\n[^\n]*<>'([0-9a-f]{64})'/)?.[1]).toBe(sha256(body));
    expect(sql.match(/-- pinned-summary-sha256:consent\.upload-other-adult\n[^\n]*<>'([0-9a-f]{64})'/)?.[1]).toBe(sha256(summary));
    expect(sql).toContain(`p_effective_on is distinct from date '${meta.effective_on}'`);
    expect(sql).toContain(`values('consent.upload-other-adult',1,'${sha256(body)}',`);
  });

  it("hard-codes the same statement keys in every database check", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const arrays = [...sql.matchAll(/-- statement-keys:consent\.upload-other-adult\n[^\n]*?array\[((?:'[^']*',?)+)\]/g)]
      .map((match) => [...match[1].matchAll(/'([^']*)'/g)].map((item) => item[1]));
    expect(arrays).toHaveLength(2);
    for (const keys of arrays) expect(keys).toEqual([...OTHER_ADULT_UPLOAD_STATEMENT_KEYS]);
  });

  it("is the exact text the pgTAP suite installs", () => {
    const { summary, body } = read();
    const suite = fs.readFileSync(SUITE, "utf8");
    expect(suite).toContain(`$artifact$${body}$artifact$`);
    expect(suite).toContain(`$summary$${summary}$summary$`);
  });
});
