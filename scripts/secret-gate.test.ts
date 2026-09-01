import { describe, expect, it } from "vitest";
import { scanText } from "./secret-gate";

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
});
