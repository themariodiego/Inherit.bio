import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALLOWLIST_PATH = "scripts/secret-allowlist.json";
const GENOME_FIXTURE_ROOTS = ["data/samples", "e2e/fixtures"];
const SECRET_NAME_PATTERN =
  "(?:DATABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|[A-Z][A-Z0-9_]*(?:API_KEY|ENCRYPTION_KEY|PRIVATE_KEY|SERVICE_ROLE_KEY|SECRET|TOKEN|PASSWORD))";

const VALUE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ["supabase-platform-key", /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{16,}\b/g],
  ["resend-key", /\bre_[A-Za-z0-9_]{8,}\b/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ["openai-key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ["stripe-secret", /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["google-api-key", /\bAIza[A-Za-z0-9_-]{32,}\b/g],
  ["npm-token", /\bnpm_[A-Za-z0-9]{20,}\b/g],
  ["credential-url", /\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/g],
];

export interface SecretFinding {
  rule: string;
  path: string;
  line: number;
  value: string;
  commit?: string;
}

interface AllowlistEntry {
  id: string;
  classification:
    | "supabase-local-jwt"
    | "deterministic-e2e-key"
    | "deterministic-e2e-secret"
    | "non-secret-code-reference";
  sourceDeclaration?: string;
  value: string;
  paths: string[];
  historyOnly?: boolean;
  justification: string;
  adr: string;
}

interface SecretAllowlist {
  schemaVersion: number;
  historyBaseline: string;
  entries: AllowlistEntry[];
}

function isPlaceholder(value: string): boolean {
  return (
    /(?:YOUR|GENERATE|EXAMPLE|PLACEHOLDER|REPLACE|CHANGEME)/i.test(value) ||
    /^(?:process\.env|requireEnv|Deno\.env|env\.)/.test(value) ||
    /[<>{}$]/.test(value) ||
    value.includes("...") ||
    /^(?:string|number|boolean|null|undefined)$/.test(value)
  );
}

function normalizeAssignedValue(value: string): string {
  return value.replace(/^[`"']|[`"';,]+$/g, "").trim();
}

export function scanText(
  text: string,
  relativePath: string,
  startingLine = 1,
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const assignment = new RegExp(
    `(?:["']?${SECRET_NAME_PATTERN}["']?)\\s*[:=]\\s*(?:["']([^"'\\n]+)["']|([^\\s,}\\]#]+))`,
    "g",
  );

  const add = (rule: string, line: number, value: string) => {
    const normalized = normalizeAssignedValue(value);
    if (!normalized || isPlaceholder(normalized)) return;
    const identity = `${rule}\0${relativePath}\0${line}\0${normalized}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    findings.push({ rule, path: relativePath, line, value: normalized });
  };

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const lineNumber = startingLine + index;
    for (const [rule, expression] of VALUE_PATTERNS) {
      expression.lastIndex = 0;
      for (const match of line.matchAll(expression)) {
        add(rule, lineNumber, match[0]);
      }
    }
    assignment.lastIndex = 0;
    for (const match of line.matchAll(assignment)) {
      add("secret-assignment", lineNumber, match[1] ?? match[2] ?? "");
    }
  }
  return findings;
}

function git(repositoryRoot: string, ...arguments_: string[]): string {
  return execFileSync("git", ["-C", repositoryRoot, ...arguments_], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function trackedPaths(repositoryRoot: string): string[] {
  return git(repositoryRoot, "ls-files", "-z")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function isProductionEnvironmentPath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((part) => part === ".env.production" || part.startsWith(".env.production."));
}

function isProbablyBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function parseJwtPayload(value: string): Record<string, unknown> {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("JWT must have three segments");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

export function validateAllowlist(
  allowlist: SecretAllowlist,
  repositoryRoot: string,
): string[] {
  const failures: string[] = [];
  if (allowlist.schemaVersion !== 1) failures.push("allowlist schemaVersion must be 1");
  if (!/^[0-9a-f]{40}$/.test(allowlist.historyBaseline)) {
    failures.push("historyBaseline must be a full 40-character Git SHA");
  }

  const ids = new Set<string>();
  const values = new Set<string>();
  for (const entry of allowlist.entries) {
    if (!/^[a-z0-9-]+$/.test(entry.id)) failures.push(`${entry.id}: invalid id`);
    if (ids.has(entry.id)) failures.push(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    if (values.has(entry.value)) failures.push(`${entry.id}: duplicate value`);
    values.add(entry.value);
    if (entry.justification.length < 30 || /\r|\n/.test(entry.justification)) {
      failures.push(`${entry.id}: justification must be one substantive line`);
    }
    if (!/^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/.test(entry.adr)) {
      failures.push(`${entry.id}: adr must name a numbered ADR`);
    } else {
      const adrPath = path.join(repositoryRoot, entry.adr);
      if (!fs.existsSync(adrPath)) {
        failures.push(`${entry.id}: missing ADR ${entry.adr}`);
      } else {
        const adr = fs.readFileSync(adrPath, "utf8");
        if (!adr.includes("Status: Accepted")) {
          failures.push(`${entry.id}: ADR is not accepted`);
        }
        if (!adr.includes(`Secret-Allowlist-ID: ${entry.id}`)) {
          failures.push(`${entry.id}: ADR lacks its Secret-Allowlist-ID marker`);
        }
      }
    }

    const sortedPaths = [...new Set(entry.paths)].sort();
    if (JSON.stringify(entry.paths) !== JSON.stringify(sortedPaths)) {
      failures.push(`${entry.id}: paths must be unique and sorted`);
    }
    for (const relativePath of entry.paths) {
      if (relativePath === ALLOWLIST_PATH || path.isAbsolute(relativePath) || relativePath.includes("..")) {
        failures.push(`${entry.id}: invalid occurrence path ${relativePath}`);
        continue;
      }
      const absolutePath = path.join(repositoryRoot, relativePath);
      if (!fs.existsSync(absolutePath)) {
        failures.push(`${entry.id}: missing occurrence path ${relativePath}`);
      } else if (
        !entry.historyOnly &&
        !fs.readFileSync(absolutePath, "utf8").includes(entry.value)
      ) {
        failures.push(`${entry.id}: declared value absent from ${relativePath}`);
      }
    }

    if (/^sb_(?:publishable|secret)_/.test(entry.value)) {
      failures.push(`${entry.id}: hosted Supabase platform keys cannot be allowlisted`);
    }
    if (entry.classification === "supabase-local-jwt") {
      try {
        const payload = parseJwtPayload(entry.value);
        if (payload.iss !== "supabase-demo") {
          failures.push(`${entry.id}: local Supabase JWT issuer must be supabase-demo`);
        }
        if (payload.role !== "anon" && payload.role !== "service_role") {
          failures.push(`${entry.id}: unexpected local Supabase JWT role`);
        }
      } catch (error) {
        failures.push(`${entry.id}: invalid local Supabase JWT (${String(error)})`);
      }
    } else if (entry.classification === "deterministic-e2e-key") {
      const decoded = Buffer.from(entry.value, "base64");
      if (decoded.length !== 32 || decoded.toString("base64") !== entry.value) {
        failures.push(`${entry.id}: deterministic E2E key must be canonical 32-byte base64`);
      }
    } else if (entry.classification === "non-secret-code-reference") {
      // This does not exempt credentials: only one reviewed fixture identifier,
      // with its exact declaration still present, is eligible. The scanner
      // continues to report the assignment in all other paths.
      if (entry.value !== "testKey" || entry.paths.length !== 1
        || entry.paths[0] !== "e2e/co-parent-invitation.spec.ts"
        || entry.sourceDeclaration !== "const testKey = servers[0]?.env?.BYOK_ENCRYPTION_KEY;"
        || !fs.existsSync(path.join(repositoryRoot, entry.paths[0]))
        || !fs.readFileSync(path.join(repositoryRoot, entry.paths[0]), "utf8")
          .split(/\r?\n/u).includes(entry.sourceDeclaration)) {
        failures.push(`${entry.id}: unverified non-secret fixture reference`);
      }
    } else if (!/(?:e2e|mock|baseline)/i.test(entry.value)) {
      failures.push(`${entry.id}: deterministic E2E secret must visibly identify itself as test-only`);
    }
  }
  return failures;
}

function scanTrackedTree(repositoryRoot: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const relativePath of trackedPaths(repositoryRoot)) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const buffer = fs.readFileSync(absolutePath);
    if (isProbablyBinary(buffer)) continue;
    findings.push(...scanText(buffer.toString("utf8"), relativePath));
  }
  return findings;
}

function scanExactAllowlistOccurrences(
  text: string,
  relativePath: string,
  entries: AllowlistEntry[],
  startingLine = 1,
  commit?: string,
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const entry of entries) {
      // Source identifiers are not credential literals in prose or tests.
      // scanText still detects secret assignments using the identifier.
      if (entry.classification === "non-secret-code-reference") continue;
      if (line.includes(entry.value)) {
        findings.push({
          rule: "allowlisted-literal",
          path: relativePath,
          line: startingLine + index,
          value: entry.value,
          ...(commit ? { commit } : {}),
        });
      }
    }
  }
  return findings;
}

function scanTrackedAllowlistOccurrences(
  repositoryRoot: string,
  entries: AllowlistEntry[],
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const relativePath of trackedPaths(repositoryRoot)) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const buffer = fs.readFileSync(absolutePath);
    if (isProbablyBinary(buffer)) continue;
    findings.push(
      ...scanExactAllowlistOccurrences(
        buffer.toString("utf8"),
        relativePath,
        entries,
      ),
    );
  }
  return findings;
}

function parseAddedLines(
  patch: string,
  commit: string,
  entries: AllowlistEntry[],
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  let relativePath = "";
  let newLine = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      relativePath = line.slice(6);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!relativePath || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      for (const finding of scanText(line.slice(1), relativePath, newLine)) {
        findings.push({ ...finding, commit });
      }
      findings.push(
        ...scanExactAllowlistOccurrences(
          line.slice(1),
          relativePath,
          entries,
          newLine,
          commit,
        ),
      );
      newLine++;
    } else if (!line.startsWith("-")) {
      newLine++;
    }
  }
  return findings;
}

function scanAuthoredHistory(
  repositoryRoot: string,
  baseline: string,
  entries: AllowlistEntry[],
): { findings: SecretFinding[]; productionEnvAdds: string[]; commitCount: number } {
  git(repositoryRoot, "merge-base", "--is-ancestor", baseline, "HEAD");
  const commits = git(
    repositoryRoot,
    "rev-list",
    "--reverse",
    "--no-merges",
    `${baseline}..HEAD`,
  )
    .split("\n")
    .filter(Boolean);
  const findings: SecretFinding[] = [];
  const productionEnvAdds: string[] = [];
  for (const commit of commits) {
    const patch = git(
      repositoryRoot,
      "show",
      "--format=",
      "--unified=0",
      "--no-ext-diff",
      "--no-renames",
      commit,
      "--",
    );
    findings.push(...parseAddedLines(patch, commit, entries));
    const addedPaths = git(
      repositoryRoot,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--diff-filter=A",
      commit,
    )
      .split("\n")
      .filter(Boolean);
    for (const relativePath of addedPaths) {
      if (isProductionEnvironmentPath(relativePath)) {
        productionEnvAdds.push(`${commit.slice(0, 12)}:${relativePath}`);
      }
    }
  }
  return { findings, productionEnvAdds, commitCount: commits.length };
}

function verifyGenomeFixtures(repositoryRoot: string): string[] {
  const failures: string[] = [];
  const allPaths = trackedPaths(repositoryRoot);
  for (const root of GENOME_FIXTURE_ROOTS) {
    const provenancePath = `${root}/PROVENANCE.md`;
    const absoluteProvenance = path.join(repositoryRoot, provenancePath);
    if (!fs.existsSync(absoluteProvenance)) {
      failures.push(`${root}: missing PROVENANCE.md`);
      continue;
    }
    const provenance = fs.readFileSync(absoluteProvenance, "utf8");
    if (!/(?:synthetic|public reference)/i.test(provenance) || !/no real/i.test(provenance)) {
      failures.push(`${provenancePath}: must state classification and that no real private/person genome is present`);
    }
    const fixturePaths = allPaths.filter(
      (relativePath) =>
        relativePath.startsWith(`${root}/`) &&
        /(?:\.vcf(?:\.gz)?|\.bam|\.cram|23andme\.txt)$/i.test(relativePath),
    );
    for (const fixturePath of fixturePaths) {
      const buffer = fs.readFileSync(path.join(repositoryRoot, fixturePath));
      const digest = crypto.createHash("sha256").update(buffer).digest("hex");
      const basename = path.basename(fixturePath);
      if (!provenance.includes(basename)) {
        failures.push(`${provenancePath}: missing fixture ${basename}`);
      }
      if (!provenance.includes(digest)) {
        failures.push(`${provenancePath}: missing current SHA-256 for ${basename}`);
      }
      if (!isProbablyBinary(buffer) && !/(?:synthetic|public reference|GIAB)/i.test(buffer.subarray(0, 8192).toString("utf8"))) {
        failures.push(`${fixturePath}: text fixture must identify itself as synthetic or public reference data in-file`);
      }
    }
  }
  return failures;
}

function isAllowedFinding(
  finding: SecretFinding,
  entries: AllowlistEntry[],
): boolean {
  const entry = entries.find((candidate) => candidate.value === finding.value);
  return Boolean(
    entry &&
      (finding.path === ALLOWLIST_PATH ||
        (!entry.historyOnly || Boolean(finding.commit)) &&
          entry.paths.includes(finding.path)),
  );
}

function runSelfTest(): string[] {
  const failures: string[] = [];
  const hostedSupabase = `sb_${"secret"}_${"A".repeat(24)}`;
  const fakeGithub = `gh${"p"}_${"B".repeat(24)}`;
  const samples = [
    [`SUPABASE_SERVICE_ROLE_KEY=${hostedSupabase}`, "supabase-platform-key"],
    [`token=${fakeGithub}`, "github-token"],
    [
      ["DATABASE", "_URL=", "https://", "admin:password@invalid.test/db"].join(""),
      "credential-url",
    ],
    [["JOBS", "_SECRET=", "unsafe-value"].join(""), "secret-assignment"],
  ] as const;
  for (const [sample, rule] of samples) {
    if (!scanText(sample, "self-test.txt").some((finding) => finding.rule === rule)) {
      failures.push(`self-test failed to detect ${rule}`);
    }
  }
  if (scanText("RESEND_API_KEY=re_YOUR_KEY", "self-test.txt").length !== 0) {
    failures.push("self-test treated a documented placeholder as a credential");
  }
  return failures;
}

export function runSecretGate(repositoryRoot: string): {
  failures: string[];
  trackedFileCount: number;
  historyCommitCount: number;
  findingCount: number;
  fixtureCount: number;
} {
  const allowlist = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, ALLOWLIST_PATH), "utf8"),
  ) as SecretAllowlist;
  const failures = [
    ...runSelfTest(),
    ...validateAllowlist(allowlist, repositoryRoot),
    ...verifyGenomeFixtures(repositoryRoot),
  ];
  const paths = trackedPaths(repositoryRoot);
  for (const relativePath of paths.filter(isProductionEnvironmentPath)) {
    failures.push(`${relativePath}: production environment file is tracked`);
  }
  const treeFindings = scanTrackedTree(repositoryRoot);
  const exactTreeFindings = scanTrackedAllowlistOccurrences(
    repositoryRoot,
    allowlist.entries,
  );
  const history = scanAuthoredHistory(
    repositoryRoot,
    allowlist.historyBaseline,
    allowlist.entries,
  );
  for (const added of history.productionEnvAdds) {
    failures.push(`${added}: production environment file was added in authored history`);
  }
  const allFindings = [
    ...treeFindings,
    ...exactTreeFindings,
    ...history.findings,
  ];
  for (const finding of allFindings) {
    if (!isAllowedFinding(finding, allowlist.entries)) {
      const location = `${finding.path}:${finding.line}`;
      const commit = finding.commit ? ` in ${finding.commit.slice(0, 12)}` : "";
      failures.push(`${location}${commit}: ${finding.rule} (${finding.value.slice(0, 12)}…)`);
    }
  }

  return {
    failures: [...new Set(failures)].sort(),
    trackedFileCount: paths.length,
    historyCommitCount: history.commitCount,
    findingCount: allFindings.length,
    fixtureCount: paths.filter((relativePath) =>
      GENOME_FIXTURE_ROOTS.some(
        (root) =>
          relativePath.startsWith(`${root}/`) &&
          /(?:\.vcf(?:\.gz)?|\.bam|\.cram|23andme\.txt)$/i.test(relativePath),
      ),
    ).length,
  };
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "..");
  const result = runSecretGate(repositoryRoot);
  if (result.failures.length > 0) {
    console.error(`SECRET GATE FAILED (${result.failures.length})`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `secret gate passed: ${result.trackedFileCount} tracked files, ` +
      `${result.historyCommitCount} authored commits, ${result.findingCount} allowlisted detections, ` +
      `${result.fixtureCount} genome fixtures`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
