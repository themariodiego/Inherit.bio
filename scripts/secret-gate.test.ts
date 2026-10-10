import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAllowedFinding, scanText, validateAllowlist } from "./secret-gate";

function readAllowlist() {
  return JSON.parse(fs.readFileSync("scripts/secret-allowlist.json", "utf8")) as Parameters<typeof validateAllowlist>[0];
}
const reviewedIds = ["historical-owned-target-unit-marker", "browser-origin-credential-refusal", "storage-proxy-credential-refusal",
  "model-endpoint-credential-refusal", "ready-origin-credential-refusal", "chat-token-deterministic-expression",
  "prepared-storage-credential-refusal", "isolated-webhook-generated-reference",
  "isolated-webhook-malformed-reference", "isolated-webhook-cross-variant-reference"];
const lineHash = (line: string) => createHash("sha256").update(line).digest("hex");
function reviewedFinding(text: string, entry: ReturnType<typeof readAllowlist>["entries"][number]) {
  return scanText(text, entry.paths[0]).find(item => item.value === entry.value
    && lineHash(text.split(/\r?\n/u)[item.line - 1]) === entry.sourceLineSha256)!;
}

describe("secret gate detector", () => {
  it("keeps both T6 ambient-refusal inputs bound in current and committed history", () => {
    const { entries } = readAllowlist();
    const entry = entries.find(item => item.id === "fresh-t6-ambient-verifier-refusal")!;
    expect(entry.sourceLineSha256).toBeUndefined();
    expect(entry.sourceLineSha256s).toHaveLength(2);
    expect(validateAllowlist(readAllowlist(), process.cwd())).toEqual([]);
    for (const commit of [undefined, "2549ed14b93f7ed0503a34319137f288bcf6a1b8"]) {
      const source = commit
        ? execFileSync("git", ["show", `${commit}:${entry.paths[0]}`], { encoding: "utf8" })
        : fs.readFileSync(entry.paths[0], "utf8");
      const findings = scanText(source, entry.paths[0]).filter(item => item.value === entry.value);
      expect(findings).toHaveLength(2); // Both assignments remain detected.
      for (const finding of findings) {
        const actual = { ...finding, ...(commit ? { commit } : {}) };
        expect(isAllowedFinding(actual, entries, process.cwd())).toBe(true);
        expect(isAllowedFinding({ ...actual, path: "unreviewed.test.ts" }, entries, process.cwd())).toBe(false);
        expect(isAllowedFinding({ ...actual, value: entry.value + "changed" }, entries, process.cwd())).toBe(false);
      }
    }
  });

  it.each(["value", "path", "line", "duplicate", "order", "extra", "singleton"])(
    "rejects a changed T6 marker binding: %s", field => {
      const allowlist = readAllowlist();
      const entry = allowlist.entries.find(item => item.id === "fresh-t6-ambient-verifier-refusal")!;
      if (field === "value") entry.value += "changed";
      if (field === "path") entry.paths = ["scripts/secret-gate.test.ts"];
      if (field === "line") entry.sourceLineSha256s![0] = "a".repeat(64);
      if (field === "duplicate") entry.sourceLineSha256s![1] = entry.sourceLineSha256s![0];
      if (field === "order") entry.sourceLineSha256s!.reverse();
      if (field === "extra") entry.sourceLineSha256s!.push("b".repeat(64));
      if (field === "singleton") entry.sourceLineSha256 = entry.sourceLineSha256s![0];
      expect(validateAllowlist(allowlist, process.cwd()))
        .toContain(`${entry.id}: unverified reviewed fixture binding`);
    },
  );

  it("refuses an identical extra source assignment in both current and historical files", () => {
    const allowlist = readAllowlist();
    const entry = allowlist.entries.find(item => item.id === "fresh-t6-ambient-verifier-refusal")!;
    const source = fs.readFileSync(entry.paths[0], "utf8");
    const originalLines = source.split(/\r?\n/u).filter(line => entry.sourceLineSha256s!.includes(lineHash(line)));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-gate-t6-duplicate-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", root,
      "-c", "user.name=Secret gate fixture", "-c", "user.email=fixture@synthetic.invalid", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      const target = path.join(root, entry.paths[0]);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const duplicate = "// Synthetic complete source fixture\n" + [...originalLines, originalLines[0]].join("\n");
      fs.writeFileSync(target, duplicate);
      const adr = path.join(root, entry.adr);
      fs.mkdirSync(path.dirname(adr), { recursive: true });
      fs.copyFileSync(entry.adr, adr);
      expect(validateAllowlist({ ...allowlist, entries: [entry] }, root))
        .toContain(`${entry.id}: reviewed source lines must each occur once`);
      git("init"); git("add", "."); git("commit", "-m", "Duplicated synthetic assignment");
      const changed = git("rev-parse", "HEAD");
      const findings = scanText(duplicate, entry.paths[0]);
      expect(findings).toHaveLength(3);
      fs.writeFileSync(target, "// Synthetic complete source fixture\n" + originalLines.join("\n"));
      expect(findings.every(finding => !isAllowedFinding({ ...finding, commit: changed }, [entry], root))).toBe(true);
      fs.writeFileSync(target, duplicate);
      expect(findings.every(finding => !isAllowedFinding(finding, [entry], root))).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses copied T6 marker assignments and altered historical lines", () => {
    const { entries } = readAllowlist();
    const entry = entries.find(item => item.id === "fresh-t6-ambient-verifier-refusal")!;
    const source = fs.readFileSync(entry.paths[0], "utf8");
    const originalLines = source.split(/\r?\n/u).filter(line => entry.sourceLineSha256s!.includes(lineHash(line)));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-gate-t6-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", root,
      "-c", "user.name=Secret gate fixture", "-c", "user.email=fixture@synthetic.invalid", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    try {
      const target = path.join(root, entry.paths[0]);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "// Synthetic complete source fixture\n" + originalLines.join("\n") + "\n");
      git("init"); git("add", "."); git("commit", "-m", "Reviewed synthetic input lines");
      const approved = git("rev-parse", "HEAD");
      const changedLines = originalLines.map(line => line + " // altered context");
      fs.writeFileSync(target, "// Synthetic complete source fixture\n" + changedLines.join("\n") + "\n");
      git("add", "."); git("commit", "-m", "Altered input context");
      const changed = git("rev-parse", "HEAD");
      fs.writeFileSync(target, "// Synthetic complete source fixture\n" + [...originalLines, ...changedLines].join("\n"));
      const findings = scanText(fs.readFileSync(target, "utf8"), entry.paths[0]);
      expect(findings).toHaveLength(4);
      for (const finding of findings.slice(0, 2)) {
        expect(isAllowedFinding(finding, entries, root)).toBe(true);
        expect(isAllowedFinding({ ...finding, commit: approved }, entries, root)).toBe(true);
        expect(isAllowedFinding({ ...finding, commit: changed }, entries, root)).toBe(false);
      }
      for (const finding of findings.slice(2)) expect(isAllowedFinding(finding, entries, root)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

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

  it("distinguishes comparisons from assignments without hiding literal credentials", () => {
    const secretName = ["SUPABASE", "_SERVICE_ROLE_KEY"].join("");
    for (const operator of ["==", "==="]) {
      expect(scanText(`typeof env.${secretName} ${operator} "string"`, "checks.ts")).toEqual([]);
      expect(scanText(`env.${secretName} ${operator} candidate`, "checks.ts")).toEqual([]);
    }
    for (const operator of ["=", ":"]) {
      expect(scanText(`${secretName} ${operator} "unsafe-value"`, "checks.ts")).toEqual([
        { rule: "secret-assignment", path: "checks.ts", line: 1, value: "unsafe-value" },
      ]);
    }
    const literal = `sb_${"secret"}_${"A".repeat(24)}`;
    expect(scanText(`env.${secretName} === "${literal}"`, "checks.ts")).toEqual([
      { rule: "supabase-platform-key", path: "checks.ts", line: 1, value: literal },
    ]);
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
    const finding = reviewedFinding(text, entry);
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
        const sourceLine = original.split(/\r?\n/).find(line => lineHash(line) === entry.sourceLineSha256)!;
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
        const finding = reviewedFinding(source, entry);
        expect(isAllowedFinding({ ...finding, commit: approved }, entries, root)).toBe(true);
        expect(isAllowedFinding({ ...finding, commit: changed }, entries, root)).toBe(false);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("keeps three unique webhook expressions and refuses literal replacements in their actual reviewed contexts", () => {
    const { entries } = readAllowlist();
    const selected = entries.filter(entry => entry.id.startsWith("isolated-webhook-"));
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map(entry => entry.value)).size).toBe(3);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-gate-webhook-literal-"));
    try {
      for (const entry of selected) {
        const source = fs.readFileSync(entry.paths[0], "utf8");
        const original = source.split(/\r?\n/u).find(line => lineHash(line) === entry.sourceLineSha256)!;
        const target = path.join(root, entry.paths[0]);fs.mkdirSync(path.dirname(target), { recursive: true });
        const changed = original.replace(entry.value, '"unapproved-literal"');fs.writeFileSync(target, changed);
        const findings = scanText(changed, entry.paths[0]);
        expect(findings).toHaveLength(1);expect(findings[0].rule).toBe("secret-assignment");
        expect(isAllowedFinding(findings[0], entries, root)).toBe(false);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it("keeps the historical target marker bound to its exact pure unit-test context", () => {
    const { entries } = readAllowlist();
    const entry = entries.find(item => item.id === "historical-owned-target-unit-marker")!;
    const source = fs.readFileSync(entry.paths[0], "utf8");
    const original = source.split(/\r?\n/u).find(line => lineHash(line) === entry.sourceLineSha256)!;
    expect(source).toContain("historicalAccountOwnedTarget(config, env)");
    expect(entry.value).toBe("unit-marker");
    expect(original).toContain(["NEXT_PUBLIC_SUPABASE", "_ANON_KEY: ", JSON.stringify(entry.value)].join(""));
    expect(original).toContain(["BYOK", "_ENCRYPTION_KEY: ", JSON.stringify(entry.value)].join(""));
    const frozen = "920cdbf9beb11eb677bd7fe4e30d1cad3ea5d514";
    const historical = execFileSync("git", ["show", `${frozen}:${entry.paths[0]}`], { encoding: "utf8" });
    const historicalFinding = reviewedFinding(historical, entry);
    expect(historicalFinding).toBeDefined();
    expect(isAllowedFinding({ ...historicalFinding, commit: frozen }, entries, process.cwd())).toBe(true);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-gate-target-marker-"));
    try {
      const target = path.join(root, entry.paths[0]);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const copied = ["const unrelated = { BYOK", "_ENCRYPTION_KEY: ", JSON.stringify(entry.value), " };"].join("");
      fs.writeFileSync(target, original + "\n" + copied);
      const findings = scanText(fs.readFileSync(target, "utf8"), entry.paths[0]);
      expect(findings).toHaveLength(2);
      expect(isAllowedFinding(findings[0], entries, root)).toBe(true);
      expect(isAllowedFinding(findings[1], entries, root)).toBe(false);
      const replacement = original.replaceAll(entry.value, "unapproved-literal");
      expect(replacement).not.toBe(original);
      fs.writeFileSync(target, replacement);
      const changed = scanText(replacement, entry.paths[0]);
      expect(changed).toHaveLength(1);
      expect(changed[0].rule).toBe("secret-assignment");
      expect(isAllowedFinding(changed[0], entries, root)).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
