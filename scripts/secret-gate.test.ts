import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { scanText, validateAllowlist } from "./secret-gate";

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
});
