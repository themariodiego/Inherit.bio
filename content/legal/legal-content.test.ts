/**
 * Drift test for the six embryo legal artifacts (E0 PR-1 contract §2–§3).
 *
 * The files under `content/legal/<key>/v1.md` are the source of truth. This
 * test checks that each file is well formed and carries the sentences the
 * contract mandates, that the migration `*_embryo_cohort_runtime.sql` seeds
 * `consent_artifacts` with exactly the file's body and summary, and that the
 * statement-key arrays hard-coded in that migration equal the constants in
 * `src/lib/embryos/basis.ts`. The seed checks are red, with the message
 * "migration not found", until the migration lands.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS,
  EMBRYO_ARTIFACT_STATEMENT_KEYS,
  EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS,
} from "@/lib/embryos/basis";

const ROOT = process.cwd();
const CONTENT_ROOT = path.join(ROOT, "content/legal");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const MIGRATION_SUFFIX = "_embryo_cohort_runtime.sql";
const EFFECTIVE_ON = "2026-09-05";

const ARTIFACT_KEYS = [
  "consent.upload-embryo",
  "attestation.embryo-parentage",
  "attestation.embryo-disposition-rights",
  "attestation.embryo-single-parent-basis",
  "charter.future-person",
  "disclosure.insurance-and-discrimination",
] as const;
type ArtifactKey = (typeof ARTIFACT_KEYS)[number];

/** Contract §2, in the server-published order. */
const CONTRACT_STATEMENT_KEYS: Record<ArtifactKey, readonly string[]> = {
  "consent.upload-embryo": [
    "genetic-parent-or-authority",
    "no-outcome-data",
    "future-person-charter",
    "withdraw-any-time",
  ],
  "attestation.embryo-parentage": [
    "genetic-parent-of-these-embryos",
    "other-parent-named-truthfully",
    "false-statement-warning-read",
  ],
  "attestation.embryo-disposition-rights": [
    "right-to-decide-disposition",
    "no-dispute-or-proceeding",
    "objection-stops-and-deletes",
  ],
  "attestation.embryo-single-parent-basis": ["basis-is-true", "evidence-is-genuine", "objection-stops-analysis"],
  "charter.future-person": ["read-in-full", "rights-are-enforceable"],
  "disclosure.insurance-and-discrimination": ["understood"],
};
const CONTRACT_UPLOADER_STATEMENT_KEYS = [
  "uploader-right-to-files",
  "not-a-genetic-parent",
  "parents-permission-held",
  "withdraw-any-time",
] as const;
const CONTRACT_GRANT_STATEMENT_KEYS = ["one-purpose", "every-parent-must-agree", "pause-or-stop-any-time"] as const;

const TIER2_WARNING =
  "Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.";
const GOVERNING_SENTENCE =
  "No child anywhere has been born and followed up after embryos were compared this way. There is no outcome data. Every number on this page is a simulation.";
const ANONYMOUS_DONOR_STATEMENT =
  "A gamete donor cannot consent here and has not. Inherit will not attempt to identify a donor, and will not report on relatives found in your data.";
const FAMILY_DISPUTE_SENTENCE =
  "Inherit is not able to judge a family dispute. If the other genetic parent tells us they object, we stop and delete.";
const THIRD_PARTIES_ACT_SENTENCE =
  "For England and Wales, the Contracts (Rights of Third Parties) Act 1999 applies to this clause and is not excluded.";

/** Contract §3 mandatory sentences, verbatim, per artifact body. */
const MANDATORY_SENTENCES: Record<ArtifactKey, readonly string[]> = {
  "consent.upload-embryo": [
    GOVERNING_SENTENCE,
    "The person who may be born from any of these embryos is an intended beneficiary of rights 1 to 6 of the Charter.",
    THIRD_PARTIES_ACT_SENTENCE,
    ANONYMOUS_DONOR_STATEMENT,
    TIER2_WARNING,
  ],
  "attestation.embryo-parentage": [TIER2_WARNING],
  "attestation.embryo-disposition-rights": [TIER2_WARNING],
  "attestation.embryo-single-parent-basis": [FAMILY_DISPUTE_SENTENCE, TIER2_WARNING],
  "charter.future-person": [
    "Right 1. The record is yours. When you turn 18, you can ask us for everything we hold about the embryo you came from. This includes every result and the full record of who agreed to what. It is free. We give it in a format you can read and one a scientist can read. We will not include your parents' own DNA results unless they agree separately. Those results are also about them.",
    "Right 2. You can have it corrected.",
    "Right 3. You can have it deleted completely, and we will do it within 30 days. You do not have to give a reason. Nobody, including your parents, can stop you. We keep one line saying a deletion happened. It has no name or identifier that points back to you.",
    "Right 4. You can tell us never to analyse it again and keep the copy you have.",
    "Right 5. We will never sell it. We will never share it with an insurer, an employer, or a school. We will never send it to an outside AI company. We will never hand it to anyone without a court order that we first tried to resist. For anyone's genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit.",
    "Right 6. We keep the record until you are 20. You can claim it for free at /future-person/claim any time before then. If no one has claimed it by then, we delete it. Keeping a genetic record about someone who never asked for it is worse than losing it.",
    "The person who may be born from the embryo is an intended beneficiary of rights one through six. That person may enforce these rights.",
    "For England and Wales, our upload consent and terms state that the Contracts (Rights of Third Parties) Act 1999 applies to this promise and is not excluded.",
  ],
  "disclosure.insurance-and-discrimination": [
    "A genetic result can be used against you. GINA stops health insurers, and employers with 15 or more staff, from using it. It does not cover smaller employers, and it does not stop life insurance, disability insurance or long-term care insurance companies. No federal law does.",
    "Your result is also information about your parents, your siblings, your children and people you have never met. They did not agree to this. If one of them wants us to stop, they can tell us at /legal/appeals without an account, and we will.",
    "Asking for a genetic test is itself genetic information under US employment law. Taking part can matter, not just the answer.",
    "If you are thinking about life, disability or long-term care cover, get advice about the order in which to do things before you look at your results.",
    "Some countries and some US states protect you more than others. See the list.",
    "A result about an embryo becomes, if a child is born, a fact about a living person who could not agree to it.",
  ],
};

interface ParsedArtifact {
  source: string;
  meta: Record<string, string>;
  summary: string;
  body: string;
}

/** Contract §3 file shape: front-matter, `<section data-legal-summary>`, then the body, trimmed. */
function parseArtifactFile(key: ArtifactKey): ParsedArtifact {
  const source = fs.readFileSync(path.join(CONTENT_ROOT, key, "v1.md"), "utf8");
  const front = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!front) throw new Error(`${key}: front-matter missing`);
  const meta: Record<string, string> = {};
  for (const line of front[1].split("\n")) {
    const index = line.indexOf(":");
    if (index < 0) throw new Error(`${key}: malformed front-matter line "${line}"`);
    meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const rest = source.slice(front[0].length);
  const section = rest.match(/^<section data-legal-summary>\n([\s\S]*?)\n<\/section>\n/);
  if (!section) throw new Error(`${key}: summary section missing`);
  return { source, meta, summary: section[1].trim(), body: rest.slice(section[0].length).trim() };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Sentences for the ≤ 40-word legal cap: split on terminal punctuation or a line break, so a heading line stands alone. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[A-Za-z]/.test(sentence));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unescapeSqlLiteral(value: string): string {
  return value.replace(/''/g, "'");
}

function findMigration(): string | null {
  if (!fs.existsSync(MIGRATIONS_DIR)) return null;
  const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX)).sort();
  return names.length > 0 ? path.join(MIGRATIONS_DIR, names[names.length - 1]) : null;
}

interface Seed {
  digestBody: string;
  body: string;
  summary: string;
  effectiveOn: string;
}

const LITERAL = String.raw`'((?:''|[^'])*)'`;

/** The contract §3 seed pattern for one key: single-quoted literals, apostrophes doubled, whitespace free. */
function extractSeed(sql: string, key: ArtifactKey): Seed | null {
  const k = escapeRegExp(key);
  const pattern = new RegExp(
    String.raw`insert into public\.consent_artifacts\s*\(\s*artifact_key,\s*version,\s*body_sha256,\s*body_markdown,\s*summary_markdown,\s*effective_on\s*\)\s*select\s*'${k}'\s*,\s*1\s*,\s*encode\(\s*extensions\.digest\(\s*convert_to\(\s*${LITERAL}\s*,\s*'UTF8'\s*\)\s*,\s*'sha256'\s*\)\s*,\s*'hex'\s*\)\s*,\s*${LITERAL}\s*,\s*${LITERAL}\s*,\s*date\s*'(\d{4}-\d{2}-\d{2})'\s*where not exists\s*\(\s*select 1 from public\.consent_artifacts\s*where artifact_key = '${k}' and version = 1\s*\)`,
    "i",
  );
  const match = sql.match(pattern);
  if (!match) return null;
  return {
    digestBody: unescapeSqlLiteral(match[1]),
    body: unescapeSqlLiteral(match[2]),
    summary: unescapeSqlLiteral(match[3]),
    effectiveOn: match[4],
  };
}

/**
 * The migration marks each hard-coded array with `-- statement-keys:<key>[:<form>]`
 * on the line before it; the array literal may wrap across lines.
 */
function extractStatementKeys(sql: string, key: ArtifactKey, form?: "parent" | "uploader" | "grant"): string[] | null {
  const marker =
    form === "parent"
      ? String.raw`-- statement-keys:${escapeRegExp(key)}(?::parent)?[ \t]*\r?\n`
      : String.raw`-- statement-keys:${escapeRegExp(key)}${form ? `:${form}` : ""}[ \t]*\r?\n`;
  const match = sql.match(new RegExp(String.raw`${marker}[^\n]*?array\s*\[\s*((?:'[^']*'\s*,?\s*)+)\]`, "i"));
  if (!match) return null;
  return [...match[1].matchAll(/'([^']*)'/g)].map((item) => item[1]);
}

function distinctStatementKeyCount(key: ArtifactKey): number {
  const keys = new Set(CONTRACT_STATEMENT_KEYS[key]);
  if (key === "consent.upload-embryo") {
    for (const item of [...CONTRACT_UPLOADER_STATEMENT_KEYS, ...CONTRACT_GRANT_STATEMENT_KEYS]) keys.add(item);
  }
  return keys.size;
}

describe("legal content files", () => {
  for (const key of ARTIFACT_KEYS) {
    it(`${key}: is well formed and its body_sha256 matches the body`, () => {
      const { source, meta, summary, body } = parseArtifactFile(key);
      expect(meta).toEqual({
        artifact_key: key,
        version: "1",
        effective_on: EFFECTIVE_ON,
        body_sha256: sha256(body),
      });
      expect(source).not.toMatch(/\r/);
      expect(source).not.toMatch(/[‘’“”]/);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary).not.toMatch(/\n/);
      expect(words(summary).length).toBeLessThanOrEqual(120);
      expect(body.length).toBeGreaterThan(0);
      expect(body).not.toMatch(/\n{3,}/);
      expect(body).not.toMatch(/<[^>]+>/);
      expect(body).not.toMatch(/[*_`#]/);
    });

    it(`${key}: keeps every sentence at or under 40 words`, () => {
      const { summary, body } = parseArtifactFile(key);
      for (const sentence of [...sentences(summary), ...sentences(body)]) {
        expect(words(sentence).length, sentence).toBeLessThanOrEqual(40);
      }
    });

    it(`${key}: carries the mandatory sentences verbatim`, () => {
      const { body } = parseArtifactFile(key);
      for (const sentence of MANDATORY_SENTENCES[key]) {
        expect(body, sentence).toContain(sentence);
      }
    });

    it(`${key}: numbers one statement per statement key, in order`, () => {
      const { body } = parseArtifactFile(key);
      const numbers = [...body.matchAll(/^(\d+)\. \S/gm)].map((match) => Number(match[1]));
      const expected = Array.from({ length: distinctStatementKeyCount(key) }, (_, index) => index + 1);
      expect(numbers).toEqual(expected);
    });
  }

  it("disclosure.insurance-and-discrimination stays within 300 words", () => {
    const { summary, body } = parseArtifactFile("disclosure.insurance-and-discrimination");
    expect(words(summary).length + words(body).length).toBeLessThanOrEqual(300);
  });
});

describe("statement keys", () => {
  it("src/lib/embryos/basis.ts publishes the contract §2 arrays", () => {
    for (const key of ARTIFACT_KEYS) {
      expect([...EMBRYO_ARTIFACT_STATEMENT_KEYS[key]], key).toEqual([...CONTRACT_STATEMENT_KEYS[key]]);
    }
    expect([...EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS]).toEqual([...CONTRACT_UPLOADER_STATEMENT_KEYS]);
    expect([...EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS]).toEqual([...CONTRACT_GRANT_STATEMENT_KEYS]);
  });
});

describe("embryo cohort runtime migration", () => {
  const migration = findMigration();

  for (const key of ARTIFACT_KEYS) {
    it(`${key}: the seed equals the content file`, () => {
      if (!migration) expect.fail("migration not found");
      const sql = fs.readFileSync(migration, "utf8");
      const seed = extractSeed(sql, key);
      expect(seed, `seed for ${key} in ${path.basename(migration)}`).not.toBeNull();
      const file = parseArtifactFile(key);
      expect(seed?.digestBody).toBe(file.body);
      expect(seed?.body).toBe(file.body);
      expect(seed?.summary).toBe(file.summary);
      expect(seed?.effectiveOn).toBe(EFFECTIVE_ON);
    });
  }

  it("hard-codes the same statement-key arrays as src/lib/embryos/basis.ts", () => {
    if (!migration) expect.fail("migration not found");
    const sql = fs.readFileSync(migration, "utf8");
    const cases: Array<[ArtifactKey, "parent" | "uploader" | "grant" | undefined, readonly string[]]> = [
      ["consent.upload-embryo", "parent", EMBRYO_ARTIFACT_STATEMENT_KEYS["consent.upload-embryo"]],
      ["consent.upload-embryo", "uploader", EMBRYO_UPLOAD_UPLOADER_STATEMENT_KEYS],
      ["consent.upload-embryo", "grant", EMBRYO_ANALYSIS_GRANT_STATEMENT_KEYS],
      ["attestation.embryo-parentage", undefined, EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-parentage"]],
      [
        "attestation.embryo-disposition-rights",
        undefined,
        EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-disposition-rights"],
      ],
      [
        "attestation.embryo-single-parent-basis",
        undefined,
        EMBRYO_ARTIFACT_STATEMENT_KEYS["attestation.embryo-single-parent-basis"],
      ],
      ["charter.future-person", undefined, EMBRYO_ARTIFACT_STATEMENT_KEYS["charter.future-person"]],
      [
        "disclosure.insurance-and-discrimination",
        undefined,
        EMBRYO_ARTIFACT_STATEMENT_KEYS["disclosure.insurance-and-discrimination"],
      ],
    ];
    for (const [key, form, expected] of cases) {
      const marker = `-- statement-keys:${key}${form ? `:${form}` : ""}`;
      expect(extractStatementKeys(sql, key, form), marker).toEqual([...expected]);
    }
  });
});
