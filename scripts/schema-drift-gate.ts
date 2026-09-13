/**
 * Does the database this deployment talks to have the migrations this
 * repository expects?
 *
 * D-106. On 2026-09-13 production ran twelve migrations behind the code
 * deployed against it. Every genome upload failed, because the deployed
 * finalization path called two checkpoint functions the database did not
 * have. Nothing caught it and nothing could have: the finalize route returns
 * a deliberately opaque 503 and logs no private detail, so the error
 * aggregator was empty; and CI applies every migration to a FRESH database on
 * every run, so the suite was green the whole time. The gap was invisible from
 * both ends at once, and the only signal was a person saying their upload did
 * not work.
 *
 * That is the shape this check exists for. It is not a CI gate: in CI the
 * database is built from these same files seconds earlier, so the comparison
 * is a tautology. It belongs against a DEPLOYED environment, after a deploy —
 * `SUPABASE_DB_URL=... pnpm gate:schema-drift`.
 *
 * IT FAILS WHEN IT CANNOT CHECK. A guard against an invisible condition must
 * not have a silent no-op mode, or it reproduces the bug it was written for.
 * No URL, no connection, no ledger table: all of those are failures with a
 * message saying so, never a pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIGRATIONS = "supabase/migrations";
const OPERATOR_APPLIED = "data/gates/operator-applied-migrations.json";
/** `20260913071000_adult_subject_session_response.sql` -> the name after the stamp. */
const FILE_NAME = /^\d{14}_([A-Za-z0-9_]+)\.sql$/;

export interface DriftResult {
  findings: string[];
  expectedCount: number;
  appliedCount: number;
}

/**
 * NAMES, not version stamps, and that is not a shortcut.
 *
 * Measured against production 2026-09-13: the deployed ledger has NEVER
 * carried this repository's version numbers. Every row records the timestamp
 * at which it was applied, so `subjects_and_principals` is `20260831221537` in
 * the repository and `20260831233339` in the database. Comparing stamps
 * reported all 106 migrations missing and all 107 unknown, which is a gate
 * nobody would keep. The names are unique on both sides and they match, so the
 * name is the identity this comparison can actually use.
 */
export function expectedNames(repositoryRoot: string): string[] {
  return readdirSync(path.join(repositoryRoot, MIGRATIONS))
    .map((file) => FILE_NAME.exec(file)?.[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

/** Names a deployed database is expected to carry without a file behind them. */
export function operatorApplied(repositoryRoot: string): string[] {
  const file = JSON.parse(readFileSync(path.join(repositoryRoot, OPERATOR_APPLIED), "utf8")) as {
    migrations?: { name?: unknown }[];
  };
  return (file.migrations ?? [])
    .map((entry) => entry?.name)
    .filter((name): name is string => typeof name === "string")
    .sort();
}

/**
 * Every way the two lists can disagree, said in the direction that matters.
 *
 * BEHIND is the outage: the code is deployed and the schema it needs is not
 * there. AHEAD is not cosmetic either — it means the database carries a
 * migration this repository cannot account for, so either someone applied one
 * by hand or a file was lost, and in both cases nobody can say what the schema
 * is from reading the repository.
 */
export function driftFindings(
  expected: string[],
  applied: string[],
  operator: string[] = [],
): string[] {
  const findings: string[] = [];
  const appliedSet = new Set(applied);
  const expectedSet = new Set(expected);
  const operatorSet = new Set(operator);

  const behind = expected.filter((name) => !appliedSet.has(name));
  const ahead = applied.filter((name) => !expectedSet.has(name) && !operatorSet.has(name));
  // An allowlisted name that is not actually deployed is a stale exemption,
  // and a stale exemption is how a real extra migration hides later.
  const staleExemptions = operator.filter((name) => !appliedSet.has(name));

  if (behind.length) {
    findings.push(
      `the deployment is BEHIND by ${behind.length} migration(s); code deployed against this database ` +
        `may call functions or tables it does not have: ${behind.join(", ")}`,
    );
  }
  if (ahead.length) {
    findings.push(
      `the deployment has ${ahead.length} migration(s) this repository cannot account for; add the file, ` +
        `or record it in ${OPERATOR_APPLIED} with the reason it cannot be one: ${ahead.join(", ")}`,
    );
  }
  for (const name of staleExemptions) {
    findings.push(`${OPERATOR_APPLIED} exempts a migration the deployment does not have: ${name}`);
  }
  // A reader that silently found nothing must not read as a clean deployment.
  if (!expected.length) findings.push(`no migration files were read from ${MIGRATIONS}`);
  return findings;
}

async function appliedNames(url: string): Promise<string[]> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
  try {
    const rows = await sql<{ name: string | null }[]>`
      select name from supabase_migrations.schema_migrations order by version
    `;
    return rows.map((row) => row.name).filter((name): name is string => Boolean(name)).sort();
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function runSchemaDriftGate(repositoryRoot: string, url: string): Promise<DriftResult> {
  const expected = expectedNames(repositoryRoot);
  const applied = await appliedNames(url);
  return {
    findings: driftFindings(expected, applied, operatorApplied(repositoryRoot)),
    expectedCount: expected.length,
    appliedCount: applied.length,
  };
}

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  // Read from the environment and never from a file in the repository: this
  // string carries a database password.
  const url = process.env.SUPABASE_DB_URL ?? process.env.SUPABASE_MIGRATION_DB_URL;
  if (!url) {
    console.error(
      "SCHEMA DRIFT GATE DID NOT RUN\n" +
        "  Set SUPABASE_DB_URL to the deployed database this build talks to, then run it again.\n" +
        "  Not running is a failure on purpose (D-106): the condition this checks for is one\n" +
        "  nothing else can see, so a skipped check would be indistinguishable from a healthy one.",
    );
    process.exitCode = 1;
    return;
  }

  let result: DriftResult;
  try {
    result = await runSchemaDriftGate(repositoryRoot, url);
  } catch (error) {
    // The message can carry a host but never the password: postgres.js keeps
    // credentials out of its errors, and nothing here re-adds them.
    console.error(`SCHEMA DRIFT GATE COULD NOT READ THE DEPLOYED LEDGER: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (result.findings.length) {
    console.error(`SCHEMA DRIFT GATE FAILED (${result.findings.length})`);
    for (const finding of result.findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `schema drift gate passed: ${result.expectedCount} migrations in the repository, ` +
      `${result.appliedCount} applied to the deployed database, none missing on either side`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  // Not top-level `await`: that makes this module async, and a require-based
  // loader refuses it with ERR_REQUIRE_ASYNC_MODULE. The pending query keeps
  // the event loop alive, and `process.exitCode` is honoured at natural exit.
  void main().catch((error: unknown) => {
    console.error(`SCHEMA DRIFT GATE FAILED TO RUN: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
