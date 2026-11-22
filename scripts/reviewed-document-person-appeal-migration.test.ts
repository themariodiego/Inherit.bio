import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20261122200000_reviewed_document_person_appeal.sql (D-166, the public
 * appeal): under the owner's decision that only the uploader's access to a
 * path-b-reviewed-document record depends on the approved document still being
 * retained, the public appeal's resolution of a subject objection (the
 * person's protective right, not the uploader's access) rechecks a Path B
 * record's confirmed binding through the record's confirmation
 * (private.path_b_confirmation_v1, 20261122190000) instead of the uploader's
 * confirmation read (private.path_b_subject_v1). One body is patched in place
 * at one md5-guarded anchor. pg_get_functiondef keeps a body verbatim, so the
 * predecessor is rebuilt here from the migration that defined it with every
 * later in-place patch replayed, every md5 the migration names is recomputed,
 * and the patch is replayed to its successor. The pgTAP suite
 * (supabase/tests/reviewed_document_person_appeal.sql) drives the objection
 * against a real database before and after the document's retention ends.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122200000_reviewed_document_person_appeal.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/reviewed_document_person_appeal.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
/** The migration's statements, without its comment lines. */
const statements = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}
/** A function as pg_get_functiondef prints it: its normalized header around the verbatim body. */
function definition(source: string, marker: string, header: string): string {
  const start = source.lastIndexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = /\bas\s+(\$[a-z_]*\$)/iu.exec(source.slice(start))!;
  const bodyStart = start + open.index + open[0].length;
  const close = source.indexOf(open[1]!, bodyStart); // a dollar-quoted body ends at the first repeat of its tag
  return `${header}AS $function$${source.slice(bodyStart, close)}$function$\n`;
}
const header = (signature: string, returns: string, rest: string) =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n LANGUAGE plpgsql\n SECURITY DEFINER\n${rest}`;
const PATH = (value: string) => ` SET search_path TO ${value}\n`;
function apply(text: string, old: string, next: string): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}
interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const PATCH = /\((\d+),'([^']+)','([0-9a-f]{32})',\n {3}'([0-9a-f]{32})','(\{[^}]+\})',\n {3}\$old\$([\s\S]*?)\$old\$,\n {3}\$new\$([\s\S]*?)\$new\$,\n {3}'([^']+)'\)/gu;
const parse = (block: string): Patch[] => [...block.matchAll(PATCH)].map(match => ({ ordinal: Number(match[1]), target: match[2]!,
  before: match[3]!, after: match[4]!, acl: match[5]!, old: match[6]!, next: match[7]!, label: match[8]! }));
const replay = (patches: Patch[], target: string, start: string) => patches.filter(patch => patch.target === target)
  .reduce((text, patch) => {
    expect(md5(text), `${target} ${patch.ordinal}`).toBe(patch.before);
    return apply(text, patch.old, patch.next);
  }, start);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pinOf = (signature: string, digest: string, acl: string) => new RegExp(`\\('${escape(signature)}','${digest}','${escape(acl)}'\\)`, "u");
const code = (text: string) => text.split("\n").filter(line => !line.trimStart().startsWith("--")).join(" ").replace(/\s+/gu, " ").trim();
/** The signatures 20261122190000 lists after a regex, in its `unnest(array[…]) x order by 1)`, as schema-qualified names. */
const signatures = (block: string, after: string) => {
  const part = between(block, after, "]) x order by 1)");
  return part.slice(part.indexOf("unnest(array[\n") + "unnest(array[\n".length).split(",\n")
    .map(line => line.trim().replace(/^'|'$/gu, "").replace(/\(.*$/u, ""));
};
/** The schema-qualified names this migration lists for the bodies asking a read. */
const names = (block: string, read: string) => {
  const from = block.indexOf(`p.prosrc ~ '[^a-z_]${read}\\s*\\('`);
  expect(from, read).toBeGreaterThanOrEqual(0);
  const rest = block.slice(block.indexOf("is distinct from '", from) + "is distinct from '".length);
  return rest.slice(0, rest.search(/'( then|\n {2}or )/u)).replace(/'\n {4}\|\|'/gu, "").split(",");
};

// The sources: each body as the migration that last defined it wrote it, with every later in-place patch replayed.
const APPEAL_SOURCE = read("supabase/migrations/20261009224500_public_appeal_matched_review.sql");
const REVIEWED = read("supabase/migrations/20261016190000_path_b_reviewed_document.sql");
const READERS_NAME = "20261122180000_path_b_reviewed_document_readers.sql";
const ACCESS_NAME = "20261122190000_reviewed_document_person_access.sql";
const READERS = read(`supabase/migrations/${READERS_NAME}`);
const ACCESS = read(`supabase/migrations/${ACCESS_NAME}`);
const READERS_PATCHES = parse(between(READERS, "do $patch_readers$", "$patch_readers$;"));

const APPEAL = "private.public_appeal_provisional_binding_v1(uuid)";
const HELPER = "private.path_b_confirmation_v1(uuid,uuid)";
const UPLOADER_READ = "private.path_b_subject_v1(uuid,uuid)";
const BASE = replay(READERS_PATCHES, APPEAL, definition(APPEAL_SOURCE, "create function private.public_appeal_provisional_binding_v1(",
  header("private.public_appeal_provisional_binding_v1(p_case uuid)", "jsonb", PATH("''"))));
const PINNED: Record<string, string> = {
  [HELPER]: definition(ACCESS, "create function private.path_b_confirmation_v1(",
    header("private.path_b_confirmation_v1(p_account_id uuid, p_subject_id uuid)", "jsonb", PATH("'pg_catalog', 'private'"))),
  [UPLOADER_READ]: definition(REVIEWED, "create or replace function private.path_b_subject_v1(",
    header("private.path_b_subject_v1(p_account_id uuid, p_subject_id uuid)", "jsonb", PATH("'pg_catalog', 'private'"))),
};
const ACL: Record<string, string> = { [APPEAL]: "{postgres=X/postgres}", [HELPER]: "{postgres=X/postgres}",
  [UPLOADER_READ]: "{postgres=X/postgres,service_role=X/postgres}" };
const rewrites = (file: string, qualified: string) => {
  const sql = read(`supabase/migrations/${file}`);
  const local = qualified.slice(qualified.indexOf(".") + 1);
  return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
    || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
};

const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const postflight = between(migration, "do $postflight$", "$postflight$;");
const patchBlock = between(migration, "do $patch_appeal$", "$patch_appeal$;");
const patches = parse(patchBlock);
const successor = apply(BASE, patches[0]!.old, patches[0]!.next);

describe("the release it belongs to", () => {
  it("is a guarded production release after every migration whose bodies it patches or pins", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20261009224500_public_appeal_matched_review.sql", "20261016190000_path_b_reviewed_document.sql",
      READERS_NAME, ACCESS_NAME]) {
      expect(files, earlier).toContain(earlier);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(files.filter(file => file.startsWith("20261122200000_"))).toEqual([NAME]);
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(`# Release notes: \`${NAME}\``);
  });

  it("creates nothing and patches one body at one anchor through the md5-guarded loop", () => {
    expect(statements).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/iu);
    expect(statements).not.toMatch(/\b(alter|drop|create)\s+(table|index|trigger|policy|type|constraint|view|schema)\b/iu);
    expect(statements).not.toMatch(/\b(insert\s+into|update\s+public\.|update\s+private\.|delete\s+from)\b/iu);
    expect(statements).not.toMatch(/^\s*(grant|revoke)\s/imu);
    expect(patches.map(patch => [patch.ordinal, patch.target])).toEqual([[1, APPEAL]]);
    expect(count(migration, "execute replace(definition,item.old_fragment,item.new_fragment);")).toBe(1);
    expect(patchBlock).toContain("and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner");
    expect(migration).not.toContain("pg_get_functiondef('");
  });

  it("is the last word on what it patches: no later migration restates or patches the appeal's resolution", () => {
    expect(files.filter(file => file > NAME && rewrites(file, "private.public_appeal_provisional_binding_v1"))).toEqual([]);
  });
});

describe("the predecessor block, the patch and the postflight", () => {
  it("pins the body it patches and the two reads to the md5 recomputed from source, with their ACLs", () => {
    expect(md5(BASE)).toBe("7d7b1f82a7703c625b5695ba2aad57b4");
    expect(patches[0]!.before).toBe(md5(BASE));
    expect(preflight).toMatch(pinOf(APPEAL, md5(BASE), ACL[APPEAL]!));
    for (const [signature, body] of Object.entries(PINNED)) {
      expect(preflight, signature).toMatch(pinOf(signature, md5(body), ACL[signature]!));
      expect(postflight, signature).toMatch(pinOf(signature, md5(body), ACL[signature]!));
    }
    expect(Object.values(PINNED).map(md5)).toEqual(["87d1170f0ed36bd81845c4cbfd1ac622", "d174a83682e35479797ac7e738a65d79"]);
    // The md5s 20261122190000 itself pins and creates.
    expect(ACCESS).toContain(`   ('${APPEAL}','${md5(BASE)}','{postgres=X/postgres}')`);
    expect(between(ACCESS, "do $postflight$", "$postflight$;")).toMatch(pinOf(HELPER, md5(PINNED[HELPER]!), ACL[HELPER]!));
    expect(preflight).toContain(")<>3\n");
    expect(preflight).toContain("raise exception using errcode='55000',message='reviewed document person appeal prerequisite differs'");
    // Since 20261122180000, only 20261122190000 named the appeal's resolution, and only to pin it.
    expect(files.filter(file => file > READERS_NAME && file < NAME && rewrites(file, "private.public_appeal_provisional_binding_v1")))
      .toEqual([ACCESS_NAME]);
    expect(between(ACCESS, "do $patch_access$", "$patch_access$;")).not.toContain("public_appeal_provisional_binding_v1");
  });

  it("starts from the askers 20261122190000 left and ends with the appeal asking the record's confirmation", () => {
    const left = signatures(between(ACCESS, "do $postflight$", "$postflight$;"), "path_b_subject_v1\\s*\\(");
    const appeal = APPEAL.replace(/\(.*$/u, "");
    expect(names(preflight, "path_b_subject_v1")).toEqual(left);
    expect(left).toContain(appeal);
    expect(names(postflight, "path_b_subject_v1")).toEqual(left.filter(name => name !== appeal));
    expect(names(postflight, "path_b_confirmation_v1")).toEqual(["private.export_account_ordinary_readable_authority_v1",
      "private.path_b_normalization_authority_v1", appeal]);
    // Each name it lists is one function, and none is quoted as a signature, so no earlier test reads the lists as a pin.
    // Quoted as a signature: the three pins, and the uploader's read (and in the postflight the helper) once more, as excluded.
    const quoted = (signature: string) => `'${signature.replace(/\(.*$/u, "(")}`;
    expect(preflight.match(/'private\.[a-z_0-9]+\(/gu)!.sort())
      .toEqual([quoted(HELPER), quoted(UPLOADER_READ), quoted(UPLOADER_READ), quoted(APPEAL)].sort());
    expect(postflight.match(/'private\.[a-z_0-9]+\(/gu)!.sort())
      .toEqual([quoted(HELPER), quoted(HELPER), quoted(UPLOADER_READ), quoted(UPLOADER_READ), quoted(APPEAL)].sort());
    // 20261122190000's capture and source authority ask the helper (its two patch rows).
    const access = parse(between(ACCESS, "do $patch_access$", "$patch_access$;"));
    expect(access.filter(patch => patch.next.includes("private.path_b_confirmation_v1(")).map(patch => patch.target))
      .toEqual(["private.path_b_normalization_authority_v1(uuid,text)", "private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)"]);
    expect(postflight).toContain("raise exception using errcode='55000',message='reviewed document person appeal successor differs'");
  });

  it("replays the patch on the rebuilt predecessor to exactly the successor the migration, its postflight and the pgTAP suite assert", () => {
    expect(md5(successor)).toBe(patches[0]!.after);
    expect(postflight).toMatch(pinOf(APPEAL, patches[0]!.after, ACL[APPEAL]!));
    expect(patches[0]!.acl).toBe(ACL[APPEAL]);
    expect(postflight).toContain(")<>3\n");
  });
});

describe("D-166: the person's objection does not need the retained document", () => {
  it("asks the record's confirmation in place of the uploader's read, for the same record, and changes nothing else", () => {
    const [patch] = patches;
    expect(code(patch!.old)).toBe("confirmed_binding:=private.path_b_subject_v1(subject_row.owner_account_id,subject_row.id);");
    expect(code(patch!.next)).toBe("confirmed_binding:=private.path_b_confirmation_v1(subject_row.owner_account_id,subject_row.id);");
    expect(patch!.next).toMatch(/^ {6}-- 20261122200000 \(D-166\): /u);
    expect(successor.replace(patch!.next, "")).toBe(BASE.replace(patch!.old, ""));
    expect(count(successor, "private.path_b_subject_v1(")).toBe(0);
    // The recheck still runs only for a Path B record with a confirmation signature, and still
    // refuses (null) on any refusal of the read or any difference in principal, contact or signature.
    const recheck = between(successor, "    if signature_id is not null and exists(", "    end if;\n");
    expect(recheck).toContain("     exception when insufficient_privilege or object_not_in_prerequisite_state then return null;end;\n");
    for (const key of ["principalId", "contactReferenceId", "confirmationSignatureId"]) expect(recheck).toContain(`confirmed_binding->>'${key}'`);
  });

  it("asks a read that answers what the uploader's read answers, without only its retention clause", () => {
    const returned = (body: string) => between(body, " return jsonb_build_object(", "end;\n$function$");
    expect(returned(PINNED[HELPER]!)).toBe(returned(PINNED[UPLOADER_READ]!));
    expect(code(PINNED[HELPER]!)).not.toContain("retained");
    expect(code(PINNED[UPLOADER_READ]!)).toContain("private.path_b_reviewed_document_retained_v1(s.id)");
  });

  it("leaves the register's resolver statement marked with the decision", () => {
    const register = read("docs/route-register.json");
    expect(() => JSON.parse(register) as unknown).not.toThrow();
    const resolver = between(register, "\"subject-objection\": \"constant-time-match-only-the-activated-random-case-principals", "\",\n");
    expect(resolver).toContain("registered-2026-11-22-D-166");
    expect(resolver).toContain("20261122200000");
  });
});

describe("its tests", () => {
  it("is driven by its pgTAP suite, which rebuilds the predecessor by reversing exactly this migration's anchor", () => {
    expect(pgtap.startsWith("-- D-166, the public appeal: after a reviewed-document record's approved")).toBe(true);
    expect(pgtap).toMatch(/\nbegin;\n/u);
    expect(pgtap.trimEnd().endsWith("select * from finish();\nrollback;")).toBe(true);
    const rows = between(patchBlock, " for item in select * from (values\n", "\n ) as patch(");
    expect(pgtap).toContain(`insert into d166b_patches values\n${rows};\n`);
    expect(pgtap).toContain("replace(t.def,t.new_fragment,t.old_fragment)");
    for (const fragment of ["\\ir fixtures/path_b_source_setup.inc", "public.finalize_path_b_reviewed_document_v1(",
      "public.decide_permission_document_v1(", "public.prepare_new_public_appeal_v1('subject-objection'",
      "alter table private.permission_documents disable trigger permission_document_transition;",
      "set retain_until=clock_timestamp()-interval '1 minute'", "private.permission_document_objects_due_v1(1000)",
      "pg_temp.token_confirms(", "(predecessor) D-166: the objection no longer resolved to the reviewed-document record and held nothing",
      "(ended) exactly as it does the e-signature record", "(no account, ended) it resolves to either record and holds it",
      "(unanswered) an objection resolves to no record a request never answered made, for either flow"]) {
      expect(pgtap, fragment).toContain(fragment);
    }
  });
});
