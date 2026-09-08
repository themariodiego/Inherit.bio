import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isAllowedFinding, scanText, validateAllowlist } from "./secret-gate";

function readAllowlist() {
  return JSON.parse(fs.readFileSync("scripts/secret-allowlist.json", "utf8")) as Parameters<typeof validateAllowlist>[0];
}
const reviewedIds = ["browser-origin-credential-refusal", "storage-proxy-credential-refusal",
  "model-endpoint-credential-refusal", "ready-origin-credential-refusal", "chat-token-deterministic-expression"];

describe("secret gate detector", () => {
  it("detects provider keys, JWTs, private keys, and contextual assignments", () => {
    const hostedSupabase = `sb_${"publishable"}_${"A".repeat(24)}`;
    const githubToken = `gh${"p"}_${"B".repeat(24)}`;
    const jwt = [
      Buffer.from('{"alg":"HS256"}').toString("base64url"),
      Buffer.from('{"iss":"not-local"}').toString("base64url"),
      "C".repeat(32),
    ].join(".");
    const privateKeyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const cronAssignment = ["CRON", "_SECRET=", "browser-contract-secret"].join("");
    const futureAssignment = [
      "FUTURE_VENDOR",
      "_API_KEY=",
      "future-provider-secret",
    ].join("");
    const text = [
      hostedSupabase,
      githubToken,
      jwt,
      privateKeyHeader,
      cronAssignment,
      futureAssignment,
    ].join("\n");

    expect(new Set(scanText(text, "fixture.txt").map((finding) => finding.rule))).toEqual(
      new Set([
        "supabase-platform-key",
        "github-token",
        "jwt",
        "private-key",
        "secret-assignment",
      ]),
    );
  });

  it("does not report placeholders or environment lookups", () => {
    const text = [
      "RESEND_API_KEY=re_YOUR_KEY",
      "SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY",
      "JOBS_SECRET=GENERATE-ME",
      'CRON_SECRET: process.env.CRON_SECRET',
    ].join("\n");
    expect(scanText(text, ".env.example")).toEqual([]);
  });

  it("reports the exact line and value for review", () => {
    const assignment = ["JOBS", "_SECRET=", "unsafe-value"].join("");
    const findings = scanText(`safe=true\n${assignment}\n`, "config.env");
    expect(findings).toEqual([
      {
        rule: "secret-assignment",
        path: "config.env",
        line: 2,
        value: "unsafe-value",
      },
    ]);
  });

  it("still detects fixture references and literal replacements before exact allowlist review", () => {
    const prefix = ["BYOK", "_ENCRYPTION_KEY = "].join("");
    expect(scanText(prefix + "testKey", "unapproved.ts")).toEqual([
      { rule: "secret-assignment", path: "unapproved.ts", line: 1, value: "testKey" },
    ]);
    expect(scanText(prefix + '"new-unapproved-value"', "e2e/co-parent-invitation.spec.ts")[0])
      .toMatchObject({ rule: "secret-assignment", value: "new-unapproved-value" });
  });

  it.each(["value", "path", "declaration"])("rejects a changed fixture-reference %s", (field) => {
    const allowlist = JSON.parse(fs.readFileSync("scripts/secret-allowlist.json", "utf8")) as Parameters<typeof validateAllowlist>[0];
    const entry = allowlist.entries.find(item => item.id === "co-parent-local-fixture-reference")!;
    if (field === "value") entry.value = "differentReference";
    if (field === "path") entry.paths = ["playwright.config.ts"];
    if (field === "declaration") entry.sourceDeclaration = 'const testKey = "changed";';
    expect(validateAllowlist(allowlist, process.cwd()))
      .toContain("co-parent-local-fixture-reference: unverified non-secret fixture reference");
  });

  it.each(reviewedIds)("allows only the exact reviewed occurrence: %s", id => {
    const { entries } = readAllowlist();
    const entry = entries.find(item => item.id === id)!;
    const text = fs.readFileSync(entry.paths[0], "utf8");
    const finding = scanText(text, entry.paths[0]).find(item => item.value === entry.value)!;
    expect(finding).toBeDefined(); // The detector still reports the fixture.
    expect(isAllowedFinding(finding, entries, process.cwd())).toBe(true);
    expect(isAllowedFinding({ ...finding, path: "src/unapproved.test.ts" }, entries, process.cwd())).toBe(false);
    expect(isAllowedFinding({ ...finding, value: entry.value + "changed" }, entries, process.cwd())).toBe(false);
    expect(isAllowedFinding({ ...finding, line: finding.line + 1 }, entries, process.cwd())).toBe(false);
    if (entry.classification === "reviewed-negative-url") {
      const changedUrl = new URL(entry.value);
      changedUrl.password = "unapproved-credential";
      const changed = scanText(changedUrl.toString(), entry.paths[0]);
      expect(changed.some(item => item.rule === "credential-url")).toBe(true);
      expect(changed.every(item => !isAllowedFinding(item, entries, process.cwd()))).toBe(true);
    }
  });

  it.each(["value", "paths", "sourceLineSha256", "id"])("rejects JSON-only changes to reviewed bindings: %s", field => {
    for (const id of reviewedIds) {
      const allowlist = readAllowlist(), entry = allowlist.entries.find(item => item.id === id)!;
      if (field === "value") entry.value = entry.value.replace(/password|pass/, "different-credential") + "changed";
      if (field === "paths") entry.paths = ["playwright.config.ts"];
      if (field === "sourceLineSha256") entry.sourceLineSha256 = "a".repeat(64);
      if (field === "id") entry.id = "unreviewed-fixture";
      expect(validateAllowlist(allowlist, process.cwd()))
        .toContain(`${entry.id}: unverified reviewed fixture binding`);
    }
  });

  it("rejects altered contexts and assignments even while the approved line remains present", () => {
    const { entries } = readAllowlist();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-gate-context-"));
    try {
      for (const id of reviewedIds) {
        const entry = entries.find(item => item.id === id)!;
        const original = fs.readFileSync(entry.paths[0], "utf8");
        const sourceLine = original.split(/\r?\n/).find(line => line.includes(entry.value))!;
        const target = path.join(root, entry.paths[0]);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const changed = sourceLine.replace("Buffer.alloc(32, 9)", "Buffer.alloc(32, 10)") + " // changed context";
        fs.writeFileSync(target, sourceLine + "\n" + changed);
        const findings = scanText(fs.readFileSync(target, "utf8"), entry.paths[0]).filter(item => item.value === entry.value);
        expect(findings).toHaveLength(2);
        expect(isAllowedFinding(findings[0], entries, root)).toBe(true);
        expect(isAllowedFinding(findings[1], entries, root)).toBe(false);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("checks historical source lines rather than approving history from the current declaration", () => {
    const { entries } = readAllowlist();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-gate-history-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", root,
      "-c", "user.name=Secret gate fixture", "-c", "user.email=fixture@synthetic.invalid", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      git("init");
      const records = reviewedIds.map(id => {
        const entry = entries.find(item => item.id === id)!;
        const source = fs.readFileSync(entry.paths[0], "utf8");
        const target = path.join(root, entry.paths[0]);
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source);
        return { entry, target, source };
      });
      git("add", "."); git("commit", "-m", "Original synthetic fixture context");
      const approved = git("rev-parse", "HEAD");
      for (const { target, source } of records) fs.writeFileSync(target, source.split(/\r?\n/).map(line => line + " // altered context").join("\n"));
      git("add", "."); git("commit", "-m", "Changed synthetic fixture context");
      const changed = git("rev-parse", "HEAD");
      for (const { entry, target, source } of records) {
        fs.writeFileSync(target, source);
        const finding = scanText(source, entry.paths[0]).find(item => item.value === entry.value)!;
        expect(isAllowedFinding({ ...finding, commit: approved }, entries, root)).toBe(true);
        expect(isAllowedFinding({ ...finding, commit: changed }, entries, root)).toBe(false);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
