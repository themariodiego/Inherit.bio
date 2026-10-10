import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const root = path.resolve(__dirname, "..");
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const migration = read("supabase/migrations/20261003030000_path_b_confirmed_array_normalization.sql");
const old = read("supabase/migrations/20260930231000_path_b_normalization.sql");
function assertClosedGuards(source: string) {
  for (const tag of ["array_predecessor", "array_successor"]) {
    const guard = source.match(new RegExp(`do \\$${tag}\\$([\\s\\S]*?)end \\$${tag}\\$;`, "u"))?.[1];
    expect(guard, tag).toBeDefined();
    for (const required of ["p.procost is distinct from 100", "p.prorows is distinct from 0", "p.probin is not null",
      "p.prosupport is distinct from 0::oid", "p.prosqlbody is not null", "md5(p.prosrc) is distinct from",
      "from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))<>1",
      "a.grantee<>p.proowner or a.grantor<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable"])
      expect(guard, `${tag}: ${required}`).toContain(required);
    const hash = tag === "array_predecessor" ? "d760bae87d3146dedb8d8c13cd3bd0ab" : "6908fe88715d613b8b1efd15eebda757";
    expect(guard).toContain(`md5(p.prosrc) is distinct from '${hash}'`);
  }
}
function body(source: string) {
  const match = source.match(/create (?:or replace )?function private\.enqueue_path_b_normalization_v1\(p_revision_id uuid\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/u);
  expect(match).not.toBeNull(); return match![1];
}
describe("registered confirmed Path B array source extension", () => {
  it("changes only the exact existing accepted-format queue whitelist in the complete function body", () => {
    const predecessor = body(old), successor = body(migration);
    const before = "if h.file_type not in('vcf','gvcf') then return null; end if;", after = "if h.file_type not in('array_23andme','array_ancestry','array_myheritage','array_ftdna','vcf','gvcf') then return null; end if;";
    expect(predecessor.split(before)).toHaveLength(2); expect(successor.split(after)).toHaveLength(2);
    expect(successor.replace(after, before)).toBe(predecessor);
    expect(createHash("md5").update(predecessor).digest("hex")).toBe("d760bae87d3146dedb8d8c13cd3bd0ab");
    expect(createHash("md5").update(successor).digest("hex")).toBe("6908fe88715d613b8b1efd15eebda757");
    expect([...migration.matchAll(/create (?:or replace )?function ([\w.]+)/gu)].map(m => m[1]))
      .toEqual(["private.enqueue_path_b_normalization_v1"]);
  });
  it("requires complete predecessor and successor source, attributes, owner and exact ACL before accepting replacement", () => {
    assertClosedGuards(migration);
    for (const value of ["d760bae87d3146dedb8d8c13cd3bd0ab", "6908fe88715d613b8b1efd15eebda757"]) expect(migration).toContain(`md5(p.prosrc) is distinct from '${value}'`);
    for (const guard of ["p.proowner is distinct from 'postgres'::regrole", "p.prokind<>'f'", "p.provolatile<>'v'",
      "p.proparallel<>'u'", "p.proisstrict", "not p.prosecdef", "p.proleakproof", "p.proretset",
      "p.pronargs<>1", "p.pronargdefaults<>0", "p.provariadic<>0", "p.proallargtypes is not null",
      "p.proargmodes is not null", "p.proargtypes[0] is distinct from 'uuid'::regtype",
      "p.proargnames is distinct from array['p_revision_id']::text[]", "p.proargdefaults is not null",
      "p.proconfig is distinct from array['search_path=\"\"']::text[]",
      "a.grantee<>p.proowner",
      "a.grantor<>p.proowner", "a.privilege_type<>'EXECUTE'", "a.is_grantable"])
      expect(migration.split(guard), guard).toHaveLength(3);
    // Both guards independently check the ACL row count and every full member.
    expect(migration.split("aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))")).toHaveLength(5);
    expect(migration.split("p.prolang is distinct from (select oid from pg_language where lanname='plpgsql')")).toHaveLength(3);
    expect(migration.split("p.prorettype is distinct from 'uuid'::regtype")).toHaveLength(3);
    expect(migration.split("from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))<>1")).toHaveLength(3);
    expect(migration).not.toMatch(/create table|alter table|grant |revoke |update public\.purpose_grants|insert into public\.purpose_grants/iu);
  });
  it.each([
    ["p.procost is distinct from 100", "p.procost is distinct from 97"],
    ["p.prorows is distinct from 0", "p.prorows is distinct from 1000"],
    ["a.grantee<>p.proowner", "false"],
    ["a.privilege_type<>'EXECUTE'", "false"],
    ["md5(p.prosrc) is distinct from 'd760bae87d3146dedb8d8c13cd3bd0ab'", "false"],
    ["p.prosupport is distinct from 0::oid", "false"],
  ])("detects planted planner/ACL/source guard drift: %s", (before, after) => {
    expect(migration.split(before).length).toBeGreaterThan(1);
    expect(() => assertClosedGuards(migration.replace(before, after))).toThrow();
  });
  it("retains complete own source, VCF parser and original operator commands byte-exact", () => {
    expect(hash(read("src/lib/uploads/own-preparation-source.ts"))).toBe("c6cbd7ec666035ff45d784ac5066eebd92cf519a6d129071f957c27c44fc222a");
    expect(hash(read("src/lib/uploads/incremental-vcf-normalization.ts"))).toBe("a11ec80efc265f90f43a913116452bcda350eef20b5e3ff1bbc3015062f22573");
    expect(hash(read("scripts/path-b-normalization-worker.run.mts"))).toBe("3a39226c00f9ee20152d41be66e2aa1e9da7097249d2d4a0eff2ba2347ff61f9");
    const worker = read("src/lib/uploads/path-b-normalization-worker.ts");
    const start = worker.indexOf("    const source = ownPreparationOriginalSchema.parse");
    expect(hash(worker.slice(start, worker.indexOf("\n  } catch", start)))).toBe("cb3e5ea9f1c2ea1690228caa707489ee5c1dbd74603b54c90e27265b49286bf4");
    expect(read("src/lib/uploads/own-preparation-source.ts")).toContain('fileType: z.enum(["vcf", "gvcf"])');
  });
  it("uses only the original current Path B claim, range, position and publication doors", () => {
    const worker = read("src/lib/uploads/path-b-normalization-worker.ts");
    expect(worker).toContain('pathBNormalizationOriginalSchema = ownPreparationOriginalSchema.extend');
    expect(worker).toContain('fileType: z.enum(["array_23andme", "array_ancestry", "array_myheritage", "array_ftdna", "vcf", "gvcf"])');
    expect(worker).toContain('scanPathBArraySource(original)'); expect(worker).toContain('readPathBArrayLines(original, scan)');
    expect(worker).toContain('kind: source.fileType, build: scan.build');
    const array = read("src/lib/uploads/incremental-array-normalization.ts");
    expect(array).toContain('arrayRow(fields, options.kind)'); expect(array).toContain('liftSingleBaseVariant(record, options.lift!)');
    expect(array).toContain('observedCallCount: 0');
    for (const file of [worker, array, read("src/lib/uploads/path-b-array-source.ts")])
      expect(file).not.toMatch(/currentOwnUploadAccount|own_upload_normalization_v1|createAdminClient|normalizeSubjectFile\(/u);
  });
});
