import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A public table whose row-level policy decides access from the caller's own
 * identity must be named by a test that exercises it.
 *
 * This is the case that can leak one person's rows to another, and it is the
 * narrow slice of G1.6 that can be enforced today. Most tables here take the
 * other approach — row-level security enabled with no policy at all, which
 * denies every role that does not bypass it, with reads and writes going
 * through security-definer functions instead. Those are not this gate's
 * subject: there is no predicate to get wrong.
 *
 * The invariant holds as this lands (10 of 10 covered), so the gate exists to
 * catch the next permissive policy that arrives without a test, not to freeze
 * a backlog. `docs/acceptance-matrix.md` G1.6 records the wider coverage gap
 * and what is in it.
 *
 * What this cannot do, and both limits were found the hard way. It cannot judge
 * whether the test that names a table actually attacks its policy: naming is
 * presence of coverage, not proof of its quality. And it reads migration
 * *history*, not live state — a policy created and later dropped still counts
 * here, which over-counts rather than under-counts and so fails loudly rather
 * than missing something. An earlier version of this pattern required a quoted
 * policy name and silently skipped every `create policy unquoted_name`, which
 * is the failure mode that matters; `supabase/tests/rls_deny_all_tables.sql`
 * checks the live side, where the database itself is the authority.
 */
const MIGRATIONS = "supabase/migrations";
const POLICY = /create policy\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)\s+on\s+(public\.[a-z_]+)([\s\S]*?);/gi;
const CALLER_IDENTITY = /auth\.uid\(\)|auth\.jwt\(\)/i;

function migrations(): string {
  return readdirSync(MIGRATIONS).filter(file => file.endsWith(".sql"))
    .map(file => readFileSync(path.join(MIGRATIONS, file), "utf8")).join("\n");
}
/**
 * `rls_deny_all_tables.sql` is excluded on purpose. It names tables to assert
 * they carry no policy, so counting it as coverage would let a table be
 * "covered" by a file that never attacks a policy — and it would do so for
 * exactly the tables that have none. Those tables are guarded by that file
 * instead: adding any policy to one fails it.
 */
const NOT_COVERAGE = new Set(["rls_deny_all_tables.sql"]);
function testCorpus(): string {
  const sql = readdirSync("supabase/tests")
    .filter(file => file.endsWith(".sql") && !NOT_COVERAGE.has(file))
    .map(file => readFileSync(path.join("supabase/tests", file), "utf8")).join("\n");
  return `${sql}\n${readFileSync("e2e/rls.spec.ts", "utf8")}`;
}
function callerScopedTables(source: string): string[] {
  const tables = new Set<string>();
  for (const [, table, body] of source.matchAll(POLICY)) {
    if (CALLER_IDENTITY.test(body!)) tables.add(table!);
  }
  return [...tables].sort();
}

/**
 * The other half of the same question: row-level security is bypassed by
 * `service_role`, which is what the admin client uses. So for the tables that
 * are closed by having no policy, the protection is not the database's — it is
 * that every read goes through a security-definer function that checks
 * authority first, and no route reaches the table directly.
 *
 * The list is read out of `supabase/tests/rls_deny_all_tables.sql` rather than
 * copied, so the two cannot drift apart. Reference tables in that list are
 * skipped: they are closed today but hold no one's data, and a direct read of
 * one is not the risk this guards.
 */
const CLOSED_LIST = "supabase/tests/rls_deny_all_tables.sql";
const REFERENCE_ONLY = new Set(["ancestry_regions", "research_releases"]);
function closedTables(): string[] {
  const source = readFileSync(CLOSED_LIST, "utf8");
  const block = source.slice(source.indexOf("insert into closed_tables"));
  return [...block.slice(0, block.indexOf(";")).matchAll(/'([a-z_]+)'/g)]
    .map(match => match[1]!).filter(table => !REFERENCE_ONLY.has(table));
}
function productionSources(): { file: string; source: string }[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [full] : [];
    });
  return walk("src").map(file => ({ file, source: readFileSync(file, "utf8") }));
}

describe("tables closed by having no policy", () => {
  const closed = closedTables();
  it("reads its list from the pgTAP file, so the two cannot drift", () => {
    expect(closed.length).toBeGreaterThanOrEqual(10);
    expect(closed).toContain("generated_exports");
    expect(closed).toContain("audit_principal_link_keys");
  });
  it("is reached by no route directly, only through an authority-checked function", () => {
    const sources = productionSources();
    const direct = sources.flatMap(({ file, source }) => closed
      .filter(table => source.includes(`from("${table}")`) || source.includes(`from('${table}')`))
      .map(table => `${file} reads ${table}`));
    expect(direct).toEqual([]);
  });
});

describe("row-level policies that read the caller's identity", () => {
  const source = migrations();
  const scoped = callerScopedTables(source);
  it("finds the policies at all, so a passing run is not a broken pattern", () => {
    expect(source.length).toBeGreaterThan(100_000);
    expect(scoped.length).toBeGreaterThanOrEqual(12);
  });
  it("is named by a test for every such table", () => {
    const corpus = testCorpus();
    const unnamed = scoped.filter(table =>
      !corpus.includes(table) && !corpus.includes(table.slice("public.".length)));
    expect(unnamed).toEqual([]);
  });
});
