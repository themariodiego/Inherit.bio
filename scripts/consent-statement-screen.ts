import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * G5.8's activation-point half: which protective statements the consent
 * documents actually carry.
 *
 * The brief requires the eight protective statements on the terms page AND on
 * each consent document shown at the activation point, keyed by anchor id.
 * A consent document here is a signed artifact: its body is the markdown the
 * migrations seed into `public.consent_artifacts`, hashed and immutable, so it
 * carries no anchor and cannot be asserted by id without a new version — and
 * a new version is a legal act, not engineering. What engineering can do is
 * measure: read every seeded body, screen it for each statement class by
 * keyword, and hold a record of the reading in both directions so the gap is
 * a written, checked fact rather than "unmeasured".
 *
 * A screen is not a reading. A body with no keyword for a class cannot carry
 * that statement; a body with a keyword is a candidate, and the record says
 * what a person found the words to be about. The test compares the keyword
 * hits, not the reading, so a body edit that adds or drops a candidate fails
 * until the record is re-read.
 */
export const STATEMENT_CLASSES: Record<string, RegExp> = {
  eligibility: /\b18\b|eighteen|of age|documented permission/i,
  indemnity: /indemnif|hold (?:us|inherit) harmless/i,
  "not-medical": /medical advice|not a diagnosis|diagnos/i,
  "no-reproductive-reliance": /reproductiv|\bIVF\b|conception|family[- ]planning|embryo transfer|which embryo|implant/i,
  liability: /liabilit|liable/i,
  "no-warranty": /warrant|\bas is\b|no guarantee|accuracy|complete|uncertain|wrong/i,
  "governing-law": /governing law|laws of|court|venue|forum/i,
  "no-payment": /\bfree\b|no fee|no charge|payment|sell|sold|charge/i,
};

export interface SeededArtifact { artifactKey: string; version: number; migration: string; body: string }

const SELECT_SHAPE =
  /insert into public\.consent_artifacts\s*\([^)]*\)\s*select\s*'([a-z.-]+)',\s*(\d+),[\s\S]*?convert_to\(\s*'((?:[^']|'')*)'/g;
const VALUES_SHAPE = /values\s*\(\s*'([a-z.-]+)'\s*,\s*(\d+)\s*,\s*'[0-9a-f]{64}'\s*,\s*\$artifact\$([\s\S]*?)\$artifact\$/g;
const PAIR_SHAPE = /\(\s*'([a-z.-]+)'\s*,\s*'((?:[^']|'')*)'\s*\)/g;

/** Every consent artifact body the migrations seed, in migration order. */
export function seededArtifacts(root: string, migrations = "supabase/migrations"): SeededArtifact[] {
  const found: SeededArtifact[] = [];
  const directory = path.join(root, migrations);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
    const source = readFileSync(path.join(directory, file), "utf8");
    for (const match of source.matchAll(SELECT_SHAPE)) {
      found.push({ artifactKey: match[1]!, version: Number(match[2]), migration: file, body: match[3]!.replace(/''/g, "'") });
    }
    for (const match of source.matchAll(VALUES_SHAPE)) {
      found.push({ artifactKey: match[1]!, version: Number(match[2]), migration: file, body: match[3]! });
    }
    // `insert ... select key,1,... from (values ('key','body'), ...) a(key,body)`.
    const start = source.indexOf("from (values");
    const end = source.indexOf("a(key,body)");
    if (source.includes("consent_artifacts") && start !== -1 && end > start) {
      for (const match of source.slice(start, end).matchAll(PAIR_SHAPE)) {
        found.push({ artifactKey: match[1]!, version: 1, migration: file, body: match[2]!.replace(/''/g, "'") });
      }
    }
  }
  return found;
}

/** The latest version of each key: the document a person is shown today. */
export function currentArtifacts(artifacts: readonly SeededArtifact[]): SeededArtifact[] {
  const latest = new Map<string, SeededArtifact>();
  for (const artifact of artifacts) {
    const held = latest.get(artifact.artifactKey);
    if (!held || artifact.version > held.version) latest.set(artifact.artifactKey, artifact);
  }
  return [...latest.values()].sort((a, b) => a.artifactKey.localeCompare(b.artifactKey));
}

/** The statement classes whose keywords a body carries, sorted. */
export function candidateClasses(body: string, classes: Record<string, RegExp> = STATEMENT_CLASSES): string[] {
  return Object.entries(classes).filter(([, pattern]) => pattern.test(body)).map(([name]) => name).sort();
}
