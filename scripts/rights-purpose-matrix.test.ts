import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The database's rights-purpose matrix (supabase/migrations/
 * 20260929150000_rights_purpose_matrix.sql) against the register's
 * policyResolvers.withdrawal-target-v1.purposeMatrix, in both directions.
 *
 * The register states each purpose's actions and, in one of four shapes, the
 * routes they reach: one `route`, a `routes` list, one route per invitation
 * action, or none, where the purpose uses the token routes api.withdraw
 * names in its refuse-or-delete rule. The seed must hold exactly those rows:
 * a purpose, action or route the register does not name fails here, and so
 * does one the register names that the seed leaves out.
 */

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(ROOT, "supabase/migrations/20260929150000_rights_purpose_matrix.sql");

type Row = { purpose: string; kind: string | null; action: string; route: string };

interface Register {
  policyResolvers: {
    "withdrawal-target-v1": {
      purposeMatrix: Record<string, Record<string, unknown>>;
      databaseConstraint: string;
    };
  };
  routes: { id: string; [key: string]: unknown }[];
}

const register = JSON.parse(readFileSync(path.join(ROOT, "docs/route-register.json"), "utf8")) as Register;
const resolver = register.policyResolvers["withdrawal-target-v1"];
const matrix = resolver.purposeMatrix;
const routeIds = new Set(register.routes.map((route) => route.id));
const sql = readFileSync(MIGRATION, "utf8");

/** The value tuples of one `insert into <table> (...) values ...;` in a migration. */
function seedTuples(table: string, text = sql): string[][] {
  const statement = new RegExp(`insert into ${table.replace(".", "\\.")} \\([^)]*\\)\\s*values([\\s\\S]*?);`, "u").exec(text);
  if (!statement) throw new Error(`no seed for ${table}`);
  return [...statement[1]!.matchAll(/\(([^()]*)\)/gu)].map((tuple) =>
    tuple[1]!.split(",").map((value) => {
      const trimmed = value.trim();
      return trimmed === "null" ? "" : trimmed.replace(/^'|'$/gu, "");
    }),
  );
}

const seed: Row[] = readMigrations().filter(text => text.includes("insert into private.rights_purpose_matrix"))
  .flatMap(text => seedTuples("private.rights_purpose_matrix", text)).map(([purpose, kind, action, route]) => ({
  purpose: purpose!,
  kind: kind || null,
  action: action!,
  route: route!,
}));
// A purpose gains its row when its issuer lands, in that issuer's migration
// (the matrix migration seeds the first two), so every migration is read.
const sessionPurposes = readMigrations().filter((text) => text.includes("insert into private.rights_session_purposes"))
  .flatMap((text) => seedTuples("private.rights_session_purposes", text)).map(([sessionPurpose, matrixPurpose, kind, targetKind]) => ({
  sessionPurpose: sessionPurpose!,
  matrixPurpose: matrixPurpose!,
  kind: kind || null,
  targetKind: targetKind!,
}));

const key = (row: Row) => `${row.purpose}|${row.kind ?? ""}|${row.action}|${row.route}`;

function constOf(value: unknown): string | undefined {
  return value && typeof value === "object" && "const" in value ? String((value as { const: unknown }).const) : undefined;
}

/** The purposes api.withdraw's refuse-or-delete rule lets its token routes serve. */
function withdrawTokenPurposes(): string[] {
  const withdraw = JSON.stringify(register.routes.find((route) => route.id === "api.withdraw"));
  const rule = /token-purpose-matrix-must-resolve-to-([a-z-]+?)-or-one-exact-pending-invitation/u.exec(withdraw);
  if (!rule) throw new Error("api.withdraw no longer names the purposes its token routes serve");
  return Object.keys(matrix).filter((purpose) => rule[1]!.includes(purpose));
}

/** The route the default token routes give an action with no route of its own. */
function tokenRoute(action: string): string {
  return action === "export" ? "api.third-party-subject-export" : "api.withdraw";
}

describe("the rights-purpose matrix seed matches the register", () => {
  it("holds exactly the register's purposes", () => {
    expect([...new Set(seed.map((row) => row.purpose))].sort()).toEqual(Object.keys(matrix).sort());
  });

  it("gives each purpose, and each invitation kind, exactly its allowed actions", () => {
    for (const [purpose, entry] of Object.entries(matrix)) {
      const rows = seed.filter((row) => row.purpose === purpose);
      if (purpose === "invitation") {
        const byKind = entry.allowedActionsByKind as Record<string, string[]>;
        expect([...new Set(rows.map((row) => row.kind))].sort()).toEqual(Object.keys(byKind).sort());
        for (const [kind, actions] of Object.entries(byKind)) {
          expect(rows.filter((row) => row.kind === kind).map((row) => row.action).sort(), `${purpose} ${kind}`).toEqual([...actions].sort());
        }
      } else {
        expect(rows.every((row) => row.kind === null), purpose).toBe(true);
        expect(rows.map((row) => row.action).sort(), purpose).toEqual([...(entry.allowedActions as string[])].sort());
      }
    }
  });

  it("sends every action to the route the register names for it", () => {
    const tokenPurposes = withdrawTokenPurposes();
    for (const row of seed) {
      const entry = matrix[row.purpose]!;
      const where = `${row.purpose} ${row.kind ?? ""} ${row.action}`;
      expect(routeIds.has(row.route), `${where}: ${row.route} is a register route`).toBe(true);
      if (row.purpose === "invitation") {
        expect(row.route, where).toBe(constOf(entry[`${row.action}Route`]));
      } else if (constOf(entry.route)) {
        expect(row.route, where).toBe(constOf(entry.route));
      } else if (Array.isArray(entry.routes)) {
        expect(entry.routes, where).toContain(row.route);
      } else if (entry.routes === "future-person-specific-only") {
        expect(row.route, where).toMatch(/^api\.future-person-[a-z-]+$/u);
      } else {
        expect(entry.routes, where).toBeUndefined();
        expect(tokenPurposes, `${row.purpose} is served by api.withdraw's token routes`).toContain(row.purpose);
        expect(row.route, where).toBe(tokenRoute(row.action));
      }
    }
  });

  it("uses every route a purpose lists", () => {
    for (const [purpose, entry] of Object.entries(matrix)) {
      if (!Array.isArray(entry.routes)) continue;
      const used = new Set(seed.filter((row) => row.purpose === purpose).map((row) => row.route));
      expect([...used].sort(), purpose).toEqual([...new Set(entry.routes as string[])].sort());
    }
  });

  it("gives each future-person action its own route", () => {
    const release = seed.filter((row) => row.purpose === "approved-future-person-release");
    expect(new Set(release.map((row) => row.route)).size).toBe(release.length);
  });

  it("keeps a future-person purpose out of api.withdraw and token-target export (databaseConstraint)", () => {
    expect(resolver.databaseConstraint).toContain("a-future-person-token-can-never-enter-api.withdraw-or-token-target-export-v1");
    const futurePerson = seed.filter((row) => row.purpose.includes("future-person"));
    expect(futurePerson.length).toBeGreaterThan(0);
    for (const row of futurePerson) {
      expect(["api.withdraw", "api.third-party-subject-export"]).not.toContain(row.route);
    }
  });

  it("has no duplicate row", () => {
    expect(new Set(seed.map(key)).size).toBe(seed.length);
  });
});

describe("the stored session purposes", () => {
  it("name only matrix purposes and kinds", () => {
    for (const stored of sessionPurposes) {
      expect(
        seed.some((row) => row.purpose === stored.matrixPurpose && row.kind === stored.kind),
        stored.sessionPurpose,
      ).toBe(true);
    }
  });

  it("are the purpose and target-kind pairs today's issuers write, and no others", () => {
    const issued = new Set<string>();
    let inserts = 0;
    for (const file of readMigrations()) {
      for (const match of file.matchAll(/insert into public\.rights_sessions \(\s*token_hash_id, principal_id, purpose, target_kind,[^)]*\) values \(\s*[^,]+,\s*[^,]+,\s*'([a-z-]+)',\s*'([a-z_-]+)'/gu)) {
        inserts += 1;
        issued.add(`${match[1]}|${match[2]}`);
      }
    }
    expect(inserts).toBeGreaterThan(0);
    expect([...issued].sort()).toEqual(sessionPurposes.map((stored) => `${stored.sessionPurpose}|${stored.targetKind}`).sort());
  });

  it("every insert into rights_sessions writes literal, checkable values", () => {
    for (const file of readMigrations()) {
      const all = file.match(/insert into public\.rights_sessions\b/gu)?.length ?? 0;
      const literal = file.match(/insert into public\.rights_sessions \(\s*token_hash_id, principal_id, purpose, target_kind,[^)]*\) values \(\s*[^,]+,\s*[^,]+,\s*'[a-z-]+',\s*'[a-z_-]+'/gu)?.length ?? 0;
      expect(literal).toBe(all);
    }
  });
});

function readMigrations(): string[] {
  const directory = path.join(ROOT, "supabase/migrations");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(path.join(directory, name), "utf8"));
}
