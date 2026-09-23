import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";

const DATA = "data/jurisdictions.json";
const RECORDS = "docs/reviews/jurisdictions";
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0" } }).trimEnd();
}

/** RFC 6901 tokens are decoded once; inherited keys and noncanonical array
 * indices are not pointers into a JSON document. Missing is never null. */
export function jsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) throw new Error("invalid pointer");
  let value = document;
  for (const token of pointer.slice(1).split("/")) {
    if (/~(?![01])/.test(token)) throw new Error("invalid pointer escape");
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if ((!object(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)
      || (Array.isArray(value) && !/^(?:0|[1-9][0-9]*)$/.test(key))) throw new Error("missing pointer");
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function withoutReview(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "review"));
}

/** Run only with the containing decision's computed scope. A real commit
 * history is required even in tests; no missing-history fallback can pass. */
export function reviewHistoryFailures(root: string, sha: string, scope: string,
  candidate: Record<string, unknown>): string[] {
  const at = `${scope}: review history`;
  if (!/^[0-9a-f]{40}$/.test(sha)) return [`${at}: gitSha must name a full commit`];
  try {
    if (git(root, "cat-file", "-t", sha) !== "commit") return [`${at}: gitSha is not a commit object`];
  } catch { return [`${at}: gitSha commit is unavailable; complete repository history is required`]; }
  try { git(root, "merge-base", "--is-ancestor", sha, "HEAD"); }
  catch { return [`${at}: gitSha is not a verified ancestor of the candidate HEAD`]; }
  let reviewed: unknown;
  try { reviewed = jsonPointer(JSON.parse(git(root, "show", `${sha}:${DATA}`)), scope); }
  catch { return [`${at}: reviewed file or exact JSON Pointer is missing or invalid at gitSha`]; }
  if (!object(reviewed)) return [`${at}: reviewed decision must be an object`];
  if (!isDeepStrictEqual(withoutReview(reviewed), withoutReview(candidate))) {
    return [`${at}: candidate decision differs from gitSha after removing only review`];
  }
  return [];
}

/** An untracked file or a symlink in any parent is not a candidate review.
 * The normal gate separately checks the contents and final signature. */
export function trackedReviewFailure(root: string, relative: string): string | null {
  const prefix = `${RECORDS}/`;
  if (!relative.startsWith(prefix) || !/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?\/[a-z][a-z0-9_]*\.md$/.test(relative.slice(prefix.length))) {
    return `${relative}: signed record path is outside the review directory`;
  }
  try {
    let current = root;
    const parts = relative.split("/");
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
        return `${relative}: signed record path must contain only regular directories and a regular file`;
      }
    }
    const entries = git(root, "ls-files", "--stage", "-z", "--", `:(literal)${relative}`).split("\0").filter(Boolean);
    if (entries.length !== 1 || !/^100(?:644|755) [0-9a-f]{40} 0\t/.test(entries[0])
      || entries[0].slice(entries[0].indexOf("\t") + 1) !== relative) {
      return `${relative}: signed record must be tracked as one regular file without merge conflicts`;
    }
  } catch { return `${relative}: no signed record at the required tracked regular-file path`; }
  return null;
}
