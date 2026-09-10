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
 * What this cannot do: judge whether the test that names a table actually
 * attacks its policy. Naming is presence of coverage, not proof of its
 * quality, and a gate that reads SQL text cannot tell the difference.
 */
const MIGRATIONS = "supabase/migrations";
const POLICY = /create policy\s+"([^"]+)"\s+on\s+(public\.[a-z_]+)([\s\S]*?);/gi;
const CALLER_IDENTITY = /auth\.uid\(\)|auth\.jwt\(\)/i;

function migrations(): string {
  return readdirSync(MIGRATIONS).filter(file => file.endsWith(".sql"))
    .map(file => readFileSync(path.join(MIGRATIONS, file), "utf8")).join("\n");
}
function testCorpus(): string {
  const sql = readdirSync("supabase/tests").filter(file => file.endsWith(".sql"))
    .map(file => readFileSync(path.join("supabase/tests", file), "utf8")).join("\n");
  return `${sql}\n${readFileSync("e2e/rls.spec.ts", "utf8")}`;
}
function callerScopedTables(source: string): string[] {
  const tables = new Set<string>();
  for (const [, , table, body] of source.matchAll(POLICY)) {
    if (CALLER_IDENTITY.test(body!)) tables.add(table!);
  }
  return [...tables].sort();
}

describe("row-level policies that read the caller's identity", () => {
  const source = migrations();
  const scoped = callerScopedTables(source);
  it("finds the policies at all, so a passing run is not a broken pattern", () => {
    expect(source.length).toBeGreaterThan(100_000);
    expect(scoped.length).toBeGreaterThanOrEqual(10);
  });
  it("is named by a test for every such table", () => {
    const corpus = testCorpus();
    const unnamed = scoped.filter(table =>
      !corpus.includes(table) && !corpus.includes(table.slice("public.".length)));
    expect(unnamed).toEqual([]);
  });
});
