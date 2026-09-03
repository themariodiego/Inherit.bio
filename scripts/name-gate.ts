import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALLOWLIST_PATH = "data/allowed-external-names.json";
const PROVIDERS_PATH = "data/providers/providers.json";
const FIXTURES_PATH = "scripts/name-gate-fixtures.json";
const EVALUATIVE_PATH = "scripts/evaluative-tokens.json";
const ALLOWED_CATEGORIES = new Set([
  "dependency-platform",
  "public-reference-dataset",
  "file-format-producer",
  "cited-organisation",
]);

interface ProviderRow {
  slug: string;
  name: string;
  website: string;
  source_url?: string;
  source_urls: string[];
  last_verified?: string;
  last_verified_at: string;
}

interface ProviderAllowlistEntry {
  slug: string;
  reason: string;
  aliases?: string[];
}

interface ExternalNameEntry {
  name: string;
  category: string;
  aliases: string[];
  reason: string;
  evidence: string[];
}

interface NameAllowlist {
  schemaVersion: number;
  baselineSha: string;
  providerEntries: ProviderAllowlistEntry[];
  entries: ExternalNameEntry[];
}

interface EvaluativeTokens {
  schemaVersion: number;
  tokens: string[];
}

interface NameFixture {
  id: string;
  denylistParts: string[];
  textParts: string[];
}

interface NameFixtures {
  schemaVersion: number;
  cases: NameFixture[];
}

export interface NameFinding {
  rule: "denylist" | "external-host" | "organisation-shape" | "evaluative-proximity";
  path: string;
  line: number;
  value: string;
  commit?: string;
}

interface ResolvedAllowedName {
  name: string;
  aliases: string[];
  category: string;
  providerSlug?: string;
}

function git(repositoryRoot: string, ...arguments_: string[]): string {
  return execFileSync("git", ["-C", repositoryRoot, ...arguments_], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function workingTreePaths(repositoryRoot: string): string[] {
  return git(
    repositoryRoot,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  )
    .split("\0")
    .filter(Boolean)
    .sort();
}

function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

export function foldWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function phraseMatches(words: string[], phrase: string[]): boolean {
  if (phrase.length === 0) return false;
  const compactPhrase = phrase.join("");
  if (compactPhrase.length >= 6 && words.join("").includes(compactPhrase)) {
    return true;
  }
  for (let index = 0; index < words.length; index++) {
    if (words[index] === compactPhrase) return true;
    if (
      index + phrase.length <= words.length &&
      phrase.every((word, offset) => words[index + offset] === word)
    ) {
      return true;
    }
  }
  return false;
}

export function containsName(text: string, name: string): boolean {
  return phraseMatches(foldWords(text), foldWords(name));
}

function isProviderCarveout(relativePath: string, line: string): boolean {
  if (relativePath === PROVIDERS_PATH) return true;
  if (relativePath === "src/app/(marketing)/providers/page.tsx") return true;
  if (relativePath === "src/lib/providers.ts") return true;
  if (relativePath.startsWith("src/components/providers/")) return true;
  if (relativePath === "e2e/providers.spec.ts") return true;
  if (relativePath === "scripts/check-provider-links.ts") return true;
  return relativePath === "docs/acceptance-matrix.md" && line.includes("| A3 |");
}

function isIgnoredHost(host: string): boolean {
  if (/[${}]/.test(host)) return true;
  const normalized = host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[),.;]+$/, "")
    .replace(/:.*$/, "");
  return (
    normalized === "localhost" ||
    normalized === "inherit.bio" ||
    normalized.endsWith(".inherit.bio") ||
    normalized.endsWith(".e2e.local") ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".example.com") ||
    normalized.endsWith(".example.test") ||
    normalized.endsWith(".example.invalid") ||
    normalized === "example.com" ||
    normalized === "example.test" ||
    normalized === "example.invalid" ||
    normalized === "your-domain" ||
    normalized.startsWith("your-project-ref.") ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized) ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

function hostIsAllowed(host: string, allowed: ResolvedAllowedName[]): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  return allowed.some((entry) =>
    entry.aliases.some((alias) => {
      const candidate = alias.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      return (
        candidate.includes(".") &&
        (normalized === candidate || normalized.endsWith(`.${candidate}`))
      );
    }),
  );
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export function scanDenylist(
  text: string,
  relativePath: string,
  denylist: string[],
  commit?: string,
): NameFinding[] {
  const findings: NameFinding[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!commit && isProviderCarveout(relativePath, line)) continue;
    for (const denied of denylist) {
      if (containsName(line, denied)) {
        findings.push({
          rule: "denylist",
          path: relativePath,
          line: index + 1,
          value: denied,
          ...(commit ? { commit } : {}),
        });
      }
    }
  }
  return findings;
}

function scanExternalHosts(
  text: string,
  relativePath: string,
  allowed: ResolvedAllowedName[],
): NameFinding[] {
  const findings: NameFinding[] = [];
  const expression = /https?:\/\/([^\s/"'<>`)]+)/g;
  for (const match of text.matchAll(expression)) {
    const host = match[1];
    const line = lineNumberAt(text, match.index ?? 0);
    const lineText = text.split(/\r?\n/)[line - 1] ?? "";
    if (
      isProviderCarveout(relativePath, lineText) ||
      isIgnoredHost(host) ||
      hostIsAllowed(host, allowed)
    ) {
      continue;
    }
    findings.push({ rule: "external-host", path: relativePath, line, value: host });
  }
  return findings;
}

function isAllowedName(candidate: string, allowed: ResolvedAllowedName[]): boolean {
  return allowed.some((entry) =>
    [entry.name, ...entry.aliases].some(
      (name) => containsName(candidate, name) || containsName(name, candidate),
    ),
  );
}

function scanOrganisationShapes(
  text: string,
  relativePath: string,
  allowed: ResolvedAllowedName[],
): NameFinding[] {
  const findings: NameFinding[] = [];
  const suffix =
    "(?:Association|Corporation|Foundation|Genomics|Institute|Laboratories|Labs|Organisation|Organization|University)";
  const expression = new RegExp(
    `\\b[A-Z][A-Za-z0-9.-]*(?:\\s+[A-Z][A-Za-z0-9.-]*){0,4}\\s+${suffix}\\b`,
    "g",
  );
  for (const match of text.matchAll(expression)) {
    const line = lineNumberAt(text, match.index ?? 0);
    const lineText = text.split(/\r?\n/)[line - 1] ?? "";
    if (isProviderCarveout(relativePath, lineText) || isAllowedName(match[0], allowed)) {
      continue;
    }
    findings.push({
      rule: "organisation-shape",
      path: relativePath,
      line,
      value: match[0],
    });
  }
  return findings;
}

function commentCorpus(text: string): string {
  const parts: string[] = [];
  for (const match of text.matchAll(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(^|\s)(?:\/\/|#|--)[^\n]*/gm)) {
    parts.push(match[0]);
  }
  return parts.join("\n");
}

export function scanEvaluativeProximity(
  text: string,
  relativePath: string,
  providerNames: string[],
  tokens: string[],
): NameFinding[] {
  const corpus =
    relativePath.startsWith("docs/") || relativePath.startsWith("src/")
      ? text
      : commentCorpus(text);
  if (!corpus) return [];
  const findings: NameFinding[] = [];
  const lower = corpus.toLowerCase();
  for (const provider of providerNames) {
    const aliases = [
      ...new Set([
        provider.toLowerCase(),
        foldWords(provider).join(""),
        foldWords(provider).join("-"),
      ]),
    ];
    for (const alias of aliases) {
      let offset = 0;
      const needle = alias.toLowerCase();
      while ((offset = lower.indexOf(needle, offset)) !== -1) {
        const start = Math.max(0, offset - 200);
        const end = Math.min(corpus.length, offset + needle.length + 200);
        const window = lower.slice(start, end);
        for (const token of tokens) {
          if (window.includes(token.toLowerCase())) {
            findings.push({
              rule: "evaluative-proximity",
              path: relativePath,
              line: lineNumberAt(corpus, offset),
              value: `${provider} ~ ${token}`,
            });
          }
        }
        offset += Math.max(needle.length, 1);
      }
    }
  }
  return findings;
}

function readDenylist(repositoryRoot: string): { entries: string[]; failures: string[] } {
  const failures: string[] = [];
  const configured = process.env.NAME_DENYLIST_FILE;
  if (!configured) {
    return { entries: [], failures: ["NAME_DENYLIST_FILE is unset"] };
  }
  const absolute = path.resolve(configured);
  const relative = path.relative(repositoryRoot, absolute);
  if (!relative.startsWith("..") || relative === "") {
    failures.push("NAME_DENYLIST_FILE must be outside the repository");
  }
  if (!fs.existsSync(absolute)) {
    return { entries: [], failures: [...failures, `denylist file does not exist: ${absolute}`] };
  }
  const entries = fs
    .readFileSync(absolute, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (entries.length === 0) failures.push("denylist contains no entries");
  const normalized = entries.map((entry) => foldWords(entry).join(" "));
  if (new Set(normalized).size !== entries.length) failures.push("denylist entries must be unique");
  return { entries, failures };
}

function validateAllowlist(
  allowlist: NameAllowlist,
  providers: ProviderRow[],
  repositoryRoot: string,
): { allowed: ResolvedAllowedName[]; failures: string[] } {
  const failures: string[] = [];
  const allowed: ResolvedAllowedName[] = [];
  if (allowlist.schemaVersion !== 1) failures.push("allowlist schemaVersion must be 1");
  if (!/^[0-9a-f]{40}$/.test(allowlist.baselineSha)) failures.push("baselineSha must be a full Git SHA");
  if (providers.length !== 16) failures.push(`provider directory must contain 16 rows, found ${providers.length}`);
  const providerBySlug = new Map(providers.map((provider) => [provider.slug, provider]));
  if (allowlist.providerEntries.length !== providers.length) {
    failures.push("every provider must have exactly one provider-directory allowlist entry");
  }
  for (const entry of allowlist.providerEntries) {
    const provider = providerBySlug.get(entry.slug);
    if (!provider) {
      failures.push(`orphaned provider allowlist slug: ${entry.slug}`);
      continue;
    }
    if (entry.reason !== "provider-directory") {
      failures.push(`${entry.slug}: provider reason must be exactly provider-directory`);
    }
    if (!provider.source_url || provider.source_url !== provider.source_urls[0]) {
      failures.push(`${entry.slug}: source_url must equal the first source_urls entry`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(provider.last_verified ?? "")) {
      failures.push(`${entry.slug}: last_verified must be YYYY-MM-DD`);
    }
    if (provider.last_verified !== provider.last_verified_at.slice(0, 10)) {
      failures.push(`${entry.slug}: last_verified must match last_verified_at`);
    }
    let websiteHost = "";
    try {
      websiteHost = new URL(provider.website).hostname.replace(/^www\./, "");
    } catch {
      failures.push(`${entry.slug}: website must be an absolute URL`);
    }
    allowed.push({
      name: provider.name,
      aliases: [provider.slug, websiteHost, ...(entry.aliases ?? [])].filter(Boolean),
      category: "provider-directory",
      providerSlug: provider.slug,
    });
  }
  const normalizedNames = new Set<string>();
  for (const entry of allowlist.entries) {
    const normalized = foldWords(entry.name).join(" ");
    if (!normalized || normalizedNames.has(normalized)) failures.push(`${entry.name}: duplicate or empty name`);
    normalizedNames.add(normalized);
    if (!ALLOWED_CATEGORIES.has(entry.category)) failures.push(`${entry.name}: invalid category ${entry.category}`);
    if (entry.reason === "provider-directory" || entry.reason.length < 20 || /\r|\n/.test(entry.reason)) {
      failures.push(`${entry.name}: reason must be one substantive non-provider line`);
    }
    if (entry.evidence.length === 0) failures.push(`${entry.name}: evidence is required`);
    for (const evidence of entry.evidence) {
      if (path.isAbsolute(evidence) || evidence.includes("..")) {
        failures.push(`${entry.name}: invalid evidence path ${evidence}`);
      } else if (!fs.existsSync(path.join(repositoryRoot, evidence))) {
        failures.push(`${entry.name}: missing evidence path ${evidence}`);
      }
    }
    allowed.push({
      name: entry.name,
      aliases: entry.aliases,
      category: entry.category,
    });
  }
  for (const provider of providers) {
    if (!allowlist.providerEntries.some((entry) => entry.slug === provider.slug)) {
      failures.push(`${provider.slug}: missing provider allowlist entry`);
    }
  }
  return { allowed, failures };
}

function scanCommitMessages(
  repositoryRoot: string,
  baselineSha: string,
  denylist: string[],
  allowed: ResolvedAllowedName[],
): { findings: NameFinding[]; commitCount: number } {
  const baselineTimestamp = Number(git(repositoryRoot, "show", "-s", "--format=%ct", baselineSha));
  const commits = git(repositoryRoot, "rev-list", "HEAD").split("\n").filter(Boolean);
  const findings: NameFinding[] = [];
  let commitCount = 0;
  for (const commit of commits) {
    const timestamp = Number(git(repositoryRoot, "show", "-s", "--format=%ct", commit));
    if (timestamp <= baselineTimestamp) continue;
    commitCount++;
    const message = git(repositoryRoot, "show", "-s", "--format=%B", commit);
    findings.push(...scanDenylist(message, "<commit-message>", denylist, commit));
    for (const finding of scanExternalHosts(message, "<commit-message>", allowed)) {
      findings.push({ ...finding, commit });
    }
    for (const finding of scanOrganisationShapes(message, "<commit-message>", allowed)) {
      findings.push({ ...finding, commit });
    }
  }
  return { findings, commitCount };
}

function runFixtureSelfTest(fixtures: NameFixtures): string[] {
  const failures: string[] = [];
  if (fixtures.schemaVersion !== 1 || fixtures.cases.length < 2) {
    return ["name-gate fixtures must contain the two required cases"];
  }
  const required = new Set(["lowercase-domain-fragment", "camel-case-product-name"]);
  for (const fixture of fixtures.cases) {
    required.delete(fixture.id);
    const denied = fixture.denylistParts.join("");
    const text = fixture.textParts.join("");
    if (scanDenylist(text, "<self-test>", [denied]).length === 0) {
      failures.push(`${fixture.id}: detector did not match`);
    }
  }
  for (const missing of required) failures.push(`missing self-test fixture: ${missing}`);
  return failures;
}

export function runNameGate(repositoryRoot: string) {
  const allowlist = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, ALLOWLIST_PATH), "utf8"),
  ) as NameAllowlist;
  const providers = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, PROVIDERS_PATH), "utf8"),
  ) as ProviderRow[];
  const evaluative = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, EVALUATIVE_PATH), "utf8"),
  ) as EvaluativeTokens;
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, FIXTURES_PATH), "utf8"),
  ) as NameFixtures;
  const denylist = readDenylist(repositoryRoot);
  const validation = validateAllowlist(allowlist, providers, repositoryRoot);
  const failures = [...denylist.failures, ...validation.failures, ...runFixtureSelfTest(fixtures)];
  if (evaluative.schemaVersion !== 1 || evaluative.tokens.length === 0) {
    failures.push("evaluative token register is empty or invalid");
  }
  if (JSON.stringify(evaluative.tokens) !== JSON.stringify([...new Set(evaluative.tokens)].sort())) {
    failures.push("evaluative tokens must be unique and sorted");
  }

  const findings: NameFinding[] = [];
  const paths = workingTreePaths(repositoryRoot);
  for (const relativePath of paths) {
    const absolute = path.join(repositoryRoot, relativePath);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const buffer = fs.readFileSync(absolute);
    if (isProbablyBinary(buffer)) continue;
    const text = buffer.toString("utf8");
    findings.push(...scanDenylist(relativePath, relativePath, denylist.entries));
    findings.push(...scanDenylist(text, relativePath, denylist.entries));
    findings.push(...scanExternalHosts(text, relativePath, validation.allowed));
    findings.push(...scanOrganisationShapes(text, relativePath, validation.allowed));
    findings.push(
      ...scanEvaluativeProximity(
        text,
        relativePath,
        providers.map((provider) => provider.name),
        evaluative.tokens,
      ),
    );
  }
  const commits = scanCommitMessages(
    repositoryRoot,
    allowlist.baselineSha,
    denylist.entries,
    validation.allowed,
  );
  findings.push(...commits.findings);
  for (const finding of findings) {
    const commit = finding.commit ? ` in ${finding.commit.slice(0, 12)}` : "";
    failures.push(
      `${finding.path}:${finding.line}${commit}: ${finding.rule} (${finding.value})`,
    );
  }
  return {
    failures: [...new Set(failures)].sort(),
    pathCount: paths.length,
    commitCount: commits.commitCount,
    providerCount: providers.length,
    allowlistCount: validation.allowed.length,
    denylistCount: denylist.entries.length,
  };
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = runNameGate(repositoryRoot);
  if (result.failures.length > 0) {
    console.error(`NAME GATE FAILED (${result.failures.length})`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `name gate passed: ${result.pathCount} files, ${result.commitCount} post-baseline commits, ` +
      `${result.providerCount} providers, ${result.allowlistCount} allowed names, ` +
      `${result.denylistCount} private denylist entries`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
