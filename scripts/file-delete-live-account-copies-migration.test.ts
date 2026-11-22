import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-152, follow-up (20261122150000_file_delete_live_account_copies.sql; owner
 * decision of 22 November 2026, "Only a live download copy blocks deleting a
 * single file"): a whole-account copy whose parts include the record is a
 * live download copy of that record, and blocks deleting one file by the
 * rule 20261122130000 set for the record's own copies. pg_get_functiondef
 * keeps a plpgsql body verbatim, so the guard and the emptying are rebuilt
 * here from the migration that last defined them, D-144's and D-152's
 * patches replayed, and this migration's patch replayed to the successor it
 * asserts; every pinned door's md5 is recomputed from its source. The pgTAP
 * suite (supabase/tests/file_delete_live_account_copies.sql) drives every
 * state of a whole-account copy, with and without the record.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122150000_file_delete_live_account_copies.sql";
const D144 = "20261120100000_self_withdrawal_deletes_exports.sql";
const D152 = "20261122130000_file_delete_live_exports_only.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/file_delete_live_account_copies.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();

function between(text: string, start: string, end: string, after = 0): string {
  const from = text.indexOf(start, after);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}
/** The verbatim body (prosrc) of the last definition of a function in a migration file. */
function source(file: string, marker: string): string {
  const sql = read(`supabase/migrations/${file}`);
  const start = sql.lastIndexOf(marker);
  expect(start, `${file}: ${marker}`).toBeGreaterThanOrEqual(0);
  const quote = /\bas\s+(\$[A-Za-z_]*\$)/iu.exec(sql.slice(start));
  expect(quote, marker).not.toBeNull();
  const open = start + quote!.index + quote![0].length;
  return sql.slice(open, sql.indexOf(quote![1], open));
}
const definition = (body: string, header: string) => `${header}AS $function$${body}$function$\n`;

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const parse = (sql: string): Patch[] => [...sql.matchAll(
  /\((\d+),'([^']+)','([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/g,
)].map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
  old: match[6]!, next: match[7]!, label: match[8]! }));
function replay(base: string, steps: Patch[]): string {
  let body = base;
  for (const patch of steps) {
    expect(md5(body), patch.label).toBe(patch.before);
    expect(count(body, patch.old), patch.label).toBe(1);
    body = body.replace(patch.old, () => patch.next);
    expect(md5(body), patch.label).toBe(patch.after);
  }
  return body;
}

const GUARD_TARGET = "private.prepare_genome_file_deletion_body_v1(uuid,uuid)";
const EMPTY_TARGET = "private.empty_self_subject_v1(uuid,uuid)";
const earlier = [...parse(read(`supabase/migrations/${D144}`)), ...parse(read(`supabase/migrations/${D152}`))];
const GUARD_D152 = replay(definition(source("20261016181000_subject_delete.sql", "create or replace function private.prepare_genome_file_deletion_body_v1("),
  "CREATE OR REPLACE FUNCTION private.prepare_genome_file_deletion_body_v1(p_account_id uuid, p_file_id uuid)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n"), earlier.filter(patch => patch.target === GUARD_TARGET));
const EMPTY_D152 = replay(definition(source("20261016181000_subject_delete.sql", "create function private.empty_self_subject_v1("),
  "CREATE OR REPLACE FUNCTION private.empty_self_subject_v1(p_account_id uuid, p_subject_id uuid)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n"), earlier.filter(patch => patch.target === EMPTY_TARGET));
const patches = parse(migration);
const GUARD = replay(GUARD_D152, patches);
const OWN_SOURCE = source("20260909001117_own_prepared_original_retirement.sql", "create or replace function private.own_export_source_v1(");
const PINNED = [
  { signature: EMPTY_TARGET, acl: "{postgres=X/postgres}", by: "def", hash: md5(EMPTY_D152) },
  { signature: "private.export_archive_current_v1(uuid,text)", acl: "{postgres=X/postgres}", by: "def",
    hash: md5(definition(source("20260923123240_export_archive_persistence.sql", "create function private.export_archive_current_v1("),
      "CREATE OR REPLACE FUNCTION private.export_archive_current_v1(p_export uuid, p_expected text)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n")) },
  { signature: "public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)", acl: "{postgres=X/postgres,service_role=X/postgres}", by: "def",
    hash: md5(definition(source("20260923123240_export_archive_persistence.sql", "create function public.export_archive_request_v1("),
      "CREATE OR REPLACE FUNCTION public.export_archive_request_v1(p_operation text, p_origin jsonb, "
      + "p_target_kind text, p_target_id uuid, p_payload jsonb DEFAULT NULL::jsonb, p_csrf_binding text DEFAULT NULL::text)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n")) },
  { signature: "private.account_archive_r2_completed_context_v1(uuid,text,boolean)", acl: "{postgres=X/postgres}", by: "src",
    hash: md5(source("20261016196000_subject_export.sql", "CREATE OR REPLACE FUNCTION private.account_archive_r2_completed_context_v1(")) },
  { signature: "private.own_export_source_v1(uuid,uuid,uuid)", acl: "{postgres=X/postgres,service_role=X/postgres}", by: "def",
    hash: md5(definition(OWN_SOURCE, "CREATE OR REPLACE FUNCTION private.own_export_source_v1(p_account_id uuid, p_session_id uuid, p_file_id uuid)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n")) },
] as const;
/** A restatement, or a patch in place naming the body as its target (a pin is neither). */
const rewrites = (file: string, qualified: string) => {
  const sql = read(`supabase/migrations/${file}`);
  const local = qualified.slice(qualified.indexOf(".") + 1);
  return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
    || new RegExp(`\\(\\d+,'${qualified.replace(".", "\\.")}\\(`, "u").test(sql);
};
const RECORD_CLAUSE = patches[0]!.old;
const ACCOUNT_CLAUSE = patches[0]!.next.slice(RECORD_CLAUSE.length);

describe("the release it belongs to", () => {
  it("is a guarded production release that follows D-152 and every door it pins", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlierFile of ["20260909001117", "20260923123240", "20261016196000", "20261120100000", "20261122130000"]) {
      expect(files.some(file => file.startsWith(`${earlierFile}_`)), earlierFile).toBe(true);
      expect(NAME > earlierFile, earlierFile).toBe(true);
    }
  });

  it("creates nothing and patches the guard once: no function, table, column, constraint, trigger or grant", () => {
    const statements = migration.replace(/^--.*$/gmu, "");
    expect(statements).not.toMatch(/^create (?:or replace )?function/imu);
    expect(statements).not.toMatch(/^\s*(?:alter|drop|create)\s+(?:table|index|trigger|policy|type|view)\b/imu);
    expect(statements).not.toMatch(/^\s*(?:grant|revoke)\b/imu);
    expect(patches.map(patch => `${patch.ordinal} ${patch.target} ${patch.acl}`)).toEqual([`1 ${GUARD_TARGET} {postgres=X/postgres}`]);
    expect(count(migration, "execute replace(definition,item.old_fragment,item.new_fragment);")).toBe(1);
  });

  it("is the last word on the guard and restates or patches no door it pins", () => {
    expect(files.filter(file => file > NAME && rewrites(file, "private.prepare_genome_file_deletion_body_v1"))).toEqual([]);
    // 2026-11-22 (D-162): 20261122160000, after this migration, patches
    // private.own_export_source_v1 in place for a file transferred to its
    // person, starting from exactly the body pinned here; it is the only later
    // migration that may, and this migration's pre- and postflight still read
    // that predecessor because it runs first.
    const TRANSFERRED = "20261122160000_transferred_record_exports.sql";
    const laterAllowed: Record<string, string[]> = { "private.own_export_source_v1": [TRANSFERRED] };
    expect(TRANSFERRED > NAME).toBe(true);
    expect(read(`supabase/migrations/${TRANSFERRED}`))
      .toContain("(6,'private.own_export_source_v1(uuid,uuid,uuid)','27abc582be0eb4a227a7cdeb57c29d6f',");
    for (const pinned of PINNED) {
      const qualified = pinned.signature.slice(0, pinned.signature.indexOf("("));
      expect(files.filter(file => file > D152 && rewrites(file, qualified)), qualified).toEqual(laterAllowed[qualified] ?? []);
    }
  });
});

describe("the predecessor block, the patch and the postflight", () => {
  const preflight = between(migration, "do $predecessor$", "$predecessor$;");
  const postflight = between(migration, "do $postflight$", "$postflight$;");

  it("starts from exactly D-152's successor of the guard, recomputed from source, with its ACL", () => {
    expect(md5(GUARD_D152)).toBe("9753a5d9d38d09f6b17664826247f070");
    expect(patches[0]!.before).toBe(md5(GUARD_D152));
    expect(preflight).toContain(`to_regprocedure('${GUARD_TARGET}')\n   and md5(pg_get_functiondef(p.oid))='${md5(GUARD_D152)}'`
      + " and p.proacl::text='{postgres=X/postgres}')");
    expect(preflight).toContain("raise exception using errcode='55000',message='file delete live account copies prerequisite differs'");
  });

  it("pins the emptying and every door live is read from to the md5 recomputed from its source, before and after", () => {
    expect(md5(EMPTY_D152)).toBe("768b5433d639f9c8578fbd59a5a0d703");
    for (const pinned of PINNED) {
      const pin = pinned.by === "def" ? `md5(pg_get_functiondef(p.oid))='${pinned.hash}'` : `md5(p.prosrc)='${pinned.hash}'`;
      expect(count(preflight, `to_regprocedure('${pinned.signature}')`), pinned.signature).toBe(1);
      expect(count(postflight, `'${pinned.signature}'::regprocedure`), pinned.signature).toBe(1);
      for (const block of [preflight, postflight]) {
        const at = block.indexOf(pinned.signature);
        const next = block.indexOf("\n  or ", at);
        const clause = block.slice(at, next > 0 ? next : block.indexOf(" then", at));
        expect(clause, pinned.signature).toContain(pin);
        expect(clause, pinned.signature).toContain(`p.proacl::text='${pinned.acl}'`);
      }
    }
  });

  it("replays its patch on the rebuilt guard, one anchor, to exactly the successor it asserts", () => {
    expect(md5(GUARD)).toBe("da3c101a8a28000656359a91254a6643");
    expect(postflight).toContain(`'${GUARD_TARGET}'::regprocedure\n   and md5(pg_get_functiondef(p.oid))='${md5(GUARD)}'`
      + " and p.prosecdef and p.proconfig=array['search_path=\"\"']::text[]\n   and p.proacl::text='{postgres=X/postgres}')");
    expect(postflight).toContain("raise exception using errcode='55000',message='file delete live account copies successor differs'");
  });
});

describe("what the guard now reads", () => {
  it("keeps the record's own clause word for word and adds the account's copies that include the record, by the same rule", () => {
    // The anchor is D-152's clause, without its comment, exactly.
    const d152Clause = parse(read(`supabase/migrations/${D152}`)).find(patch => patch.target === GUARD_TARGET)!.next;
    expect(d152Clause.endsWith(RECORD_CLAUSE)).toBe(true);
    expect(patches[0]!.next.startsWith(RECORD_CLAUSE)).toBe(true);
    expect(ACCOUNT_CLAUSE.replace(/^\s*--.*\n/gmu, "")).toBe(
      "    or exists (select 1 from public.generated_exports e join private.export_archive_jobs j on j.export_id=e.id\n"
      + "      where e.target_kind='account' and e.target_id=p_account_id and e.subject_partitions @> jsonb_build_array(s.id)\n"
      + "      and j.deadline>clock_timestamp()\n"
      + "      and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp())))\n");
    // The same liveness as the record's clause.
    const live = "and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp())))";
    expect(RECORD_CLAUSE).toContain(live);
    expect(RECORD_CLAUSE).toContain("j.deadline>clock_timestamp()");
    // Nothing else of the guard changes, and the refusal is the same.
    expect(GUARD.replace(patches[0]!.next, () => RECORD_CLAUSE)).toBe(GUARD_D152);
    expect(GUARD.slice(GUARD.indexOf(ACCOUNT_CLAUSE))).toContain("raise exception using errcode='55000', message='file_delete_shared_graph';");
  });

  it("does not block the own-file withdrawal: the emptying ends those copies before it prepares the files", () => {
    const block = between(EMPTY_D152, "-- 20261122130000 (D-152, owner decision of 22 November 2026): every copy", "\n\n");
    expect(block).toContain("e.target_kind='account' and e.target_id=p_account_id\n"
      + "  and e.status in ('queued','building','ready') and e.subject_partitions @> jsonb_build_array(s.id)");
    expect(block).toContain("update public.generated_exports set status='revoked' where id=any(v_exports) and status<>'revoked';");
    expect(EMPTY_D152.indexOf(block)).toBeLessThan(EMPTY_D152.indexOf("v_target:=private.prepare_genome_file_deletion_body_v1(p_account_id,v_file);"));
  });
});

describe("the race", () => {
  it("serialises a whole-account copy with the deletion on the profile row, as the deployed bodies are checked to do", () => {
    expect(between(GUARD, "begin\n", ";\n")).toBe("  -- Match canonical model/read locks: account, subject, then source.\n"
      + "  perform 1 from public.profiles where id=p_account_id for update");
    const lock = OWN_SOURCE.indexOf("perform 1 from public.profiles where id=p_account_id for update;");
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(OWN_SOURCE.indexOf("select * into f from public.genome_files where id=p_file_id;"));
    expect(OWN_SOURCE).toContain("o.state='current' and o.revoked_at is null");
    // The suite reads the row lock a whole-account capture holds on the
    // live database, so a later change to the capture is caught there.
    expect(pgtap).toContain("extensions.pgrowlocks('public.profiles')");
    expect(pgtap).toContain("'For Update'=any(r.modes)");
  });
});

describe("its tests and its notes", () => {
  it("is driven by its pgTAP suite through every state of a whole-account copy, with and without the record", () => {
    for (const fragment of ["pg_temp.make_export('queued','queued')", "pg_temp.make_export('writing','writing')",
      "pg_temp.make_export('bytes','bytes')", "pg_temp.make_export('ready','ready')", "pg_temp.expire('expired')",
      "pg_temp.age('aged-ready')", "pg_temp.age('aged-queued')", "pg_temp.age('aged-writing')",
      "public.export_archive_cleanup_v1('stop',pg_temp.export_id('failed')", "set status='revoked' where id=pg_temp.export_id('revoked')",
      "set status='expired'", "set status='purged'", "pg_temp.exclude_record('elsewhere-queued')",
      "pg_temp.exclude_record('elsewhere-writing')", "pg_temp.exclude_record('elsewhere-ready')",
      "pg_temp.make_export('beta-account','ready')", "pg_temp.withdraw('with-live-account-copy')",
      "'export_source_unavailable'", "public.finish_genome_file_deletion_v1(", `'${md5(GUARD)}'`]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    // Four live states block; the finish refuses a placed live copy.
    expect(count(pgtap, "select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph'")).toBe(4);
    expect(pgtap.startsWith("begin;\n")).toBe(true);
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
    for (const suite of ["file_delete_live_exports_only.sql", "self_withdrawal_deletes_exports.sql"]) {
      expect(read(`supabase/tests/${suite}`), suite).toContain(`'${md5(GUARD)}'`);
    }
  });

  it("is in the release notes of the guarded release it joins", () => {
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });
});
