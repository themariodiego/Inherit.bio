import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { jsonPointer, reviewHistoryFailures, trackedReviewFailure } from "./jurisdiction-review-history";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const scope = "/realJurisdictions/ZZ/capabilities/carrier_match";
const record = "docs/reviews/jurisdictions/ZZ/carrier_match.md";
const decision = { status: "permitted", accessedOn: "2026-09-01", instruments: ["First", "Second"], nested: { a: 1, b: "Two " }, review: null };
function git(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
}
function commit(root: string) {
  git(root, "add", ".");
  git(root, "-c", "user.name=Synthetic fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "-qm", "Synthetic history fixture");
  return git(root, "rev-parse", "HEAD");
}
function repository(source: unknown = decision) {
  const root = mkdtempSync(path.join(tmpdir(), "review-history-")); roots.push(root);
  git(root, "init", "-q"); mkdirSync(path.join(root, "data"));
  writeFileSync(path.join(root, "data/jurisdictions.json"), JSON.stringify({ realJurisdictions: { ZZ: { capabilities: { carrier_match: source } } } }));
  return { root, sha: commit(root) };
}

describe("reviewed decision's real Git history", () => {
  it("accepts an exact ancestor decision, ignoring only review and object-key order", () => {
    const { root, sha } = repository();
    writeFileSync(path.join(root, "later.txt"), "unrelated change"); commit(root);
    const candidate = { nested: { b: "Two ", a: 1 }, instruments: ["First", "Second"],
      accessedOn: "2026-09-01", status: "permitted", review: { gitSha: sha } };
    expect(reviewHistoryFailures(root, sha, scope, candidate)).toEqual([]);
  });
  it.each([
    { status: "prohibited" }, { instruments: ["Second", "First"] }, { nested: { a: 1, b: "Two" } },
    { accessedOn: "2026-09-02" }, { extra: null }, { nested: { a: 1, b: "Two ", review: "changed" } },
  ])("rejects an unreviewed change without normalizing it away: %j", change => {
    const { root, sha } = repository();
    expect(reviewHistoryFailures(root, sha, scope, { ...decision, ...change }).join("\n")).toContain("candidate decision differs");
  });
  it("refuses a missing, abbreviated, tree, blob or annotated-tag object", () => {
    const { root, sha } = repository();
    git(root, "-c", "user.name=Synthetic fixture", "-c", "user.email=fixture@example.invalid", "tag", "-a", "reviewed-tag", "-m", "Synthetic tag");
    for (const value of ["a".repeat(40), sha.slice(0, 8), git(root, "rev-parse", "HEAD^{tree}"),
      git(root, "rev-parse", "HEAD:data/jurisdictions.json"), git(root, "rev-parse", "reviewed-tag")]) {
      expect(reviewHistoryFailures(root, value, scope, decision).length).toBeGreaterThan(0);
    }
  });
  it("rejects an existing commit from a different line of history", () => {
    const { root, sha } = repository();
    writeFileSync(path.join(root, "different.txt"), "other branch");
    const unrelated = commit(root);
    git(root, "checkout", "--detach", sha);
    expect(reviewHistoryFailures(root, unrelated, scope, decision).join("\n")).toContain("not a verified ancestor");
  });
  it("refuses a shallow checkout that cannot prove the reviewed ancestor", () => {
    const { root, sha } = repository();
    writeFileSync(path.join(root, "later.txt"), "candidate"); commit(root);
    const shallow = mkdtempSync(path.join(tmpdir(), "review-shallow-")); roots.push(shallow);
    git(root, "clone", "-q", "--depth", "1", `file://${root}`, shallow);
    expect(reviewHistoryFailures(shallow, sha, scope, decision).join("\n")).toContain("complete repository history is required");
  });
  it("does not let a replacement object turn a different reviewed decision into a match", () => {
    const { root, sha } = repository({ ...decision, status: "prohibited" });
    const filename = path.join(root, "data/jurisdictions.json");
    writeFileSync(filename, readFileSync(filename, "utf8").replace('"prohibited"', '"permitted"'));
    const later = commit(root); git(root, "replace", sha, later);
    expect(reviewHistoryFailures(root, sha, scope, decision).join("\n")).toContain("candidate decision differs");
  });
  it("fails when the historical file, pointer or decision is missing or invalid", () => {
    const { root, sha } = repository();
    expect(reviewHistoryFailures(root, sha, scope + "/absent", decision).length).toBeGreaterThan(0);
    for (const content of [null, "decision", [decision]]) {
      const fixture = repository(content);
      expect(reviewHistoryFailures(fixture.root, fixture.sha, scope, decision).join("\n")).toContain("must be an object");
    }
    rmSync(path.join(root, "data/jurisdictions.json"));
    const missing = commit(root);
    expect(reviewHistoryFailures(root, missing, scope, decision).join("\n")).toContain("missing or invalid");
    writeFileSync(path.join(root, "data/jurisdictions.json"), "{");
    const malformed = commit(root);
    expect(reviewHistoryFailures(root, malformed, scope, decision).join("\n")).toContain("missing or invalid");
  });
});

describe("JSON Pointer and tracked record boundary", () => {
  it("decodes escapes once, preserves empty keys and indexes arrays exactly", () => {
    const document = { "": { "a/b": { "~1": ["zero", null] } } };
    expect(jsonPointer(document, "")).toBe(document);
    expect(jsonPointer(document, "//a~1b/~01/1")).toBeNull();
    for (const pointer of ["x", "/~2", "/constructor", "//a~1b/~01/01", "//a~1b/~01/-", "//a~1b/~01/length"]) {
      expect(() => jsonPointer(document, pointer)).toThrow();
    }
  });
  it("requires a tracked regular file, rejecting untracked or symlinked records", () => {
    const { root } = repository();
    mkdirSync(path.dirname(path.join(root, record)), { recursive: true });
    writeFileSync(path.join(root, record), "Synthetic record, not a legal review");
    expect(trackedReviewFailure(root, record)).toContain("must be tracked");
    git(root, "add", record); expect(trackedReviewFailure(root, record)).toBeNull();
    rmSync(path.join(root, record));
    symlinkSync(path.join(root, "data/jurisdictions.json"), path.join(root, record));
    expect(trackedReviewFailure(root, record)).toContain("only regular");
  });
  it("rejects symlinked parents and dot traversal even when the leaf looks regular", () => {
    const { root } = repository();
    mkdirSync(path.join(root, "outside"));
    writeFileSync(path.join(root, "outside/carrier_match.md"), "Synthetic record");
    mkdirSync(path.join(root, "docs/reviews/jurisdictions"), { recursive: true });
    symlinkSync(path.join(root, "outside"), path.join(root, "docs/reviews/jurisdictions/ZZ"));
    expect(trackedReviewFailure(root, record)).toContain("only regular");
    expect(trackedReviewFailure(root, "docs/reviews/jurisdictions/../outside.md")).toContain("outside");
  });
});
