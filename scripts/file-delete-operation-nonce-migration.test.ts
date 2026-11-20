import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * api.file-delete's one-time value (20261120110000_file_delete_operation_nonce.sql;
 * owner decision of 19 November 2026, "G8.5: where the register is stricter,
 * engineering codes to it"). The migration widens the account operation check
 * by file_delete, adds a recorder for that one operation and one door that
 * records the value before it runs the unchanged owner-path cleanup door, in
 * the same transaction. pg_get_functiondef keeps a plpgsql body verbatim, so
 * each pinned body is rebuilt here from the migration that last defined it
 * and its md5 recomputed from source. The pgTAP suite
 * (supabase/tests/file_delete_operation_nonce.sql) drives the door against a
 * real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261120110000_file_delete_operation_nonce.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/file_delete_operation_nonce.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
const DOOR = "public.prepare_own_prepared_file_cleanup_with_nonce_v1(uuid,uuid,uuid,text,timestamptz)";
const RECORDER = "private.record_file_delete_nonce_v1(uuid,uuid,text,timestamptz)";

/** The text between two markers, the first occurrence after `after`. */
function between(text: string, start: string, end: string, after = 0): string {
  const from = text.indexOf(start, after);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}

/** A function as pg_get_functiondef prints it: its normalized header around the verbatim body. */
function definition(source: string, marker: string, header: string): string {
  const start = source.lastIndexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("as $$", start) + "as $$".length;
  const close = source.indexOf("$$;", open);
  return `${header}AS $function$${source.slice(open, close)}$function$\n`;
}

/** Each function the migration pins, where it was last defined, and the md5 and ACL its guards compare. */
const PINNED = [
  {
    signature: "public.prepare_own_prepared_file_cleanup_v1(uuid,uuid,uuid)",
    source: "supabase/migrations/20260908234525_own_prepared_cleanup.sql",
    marker: "create function public.prepare_own_prepared_file_cleanup_v1(",
    header: "CREATE OR REPLACE FUNCTION public.prepare_own_prepared_file_cleanup_v1(p_account_id uuid, p_session_id uuid, p_file_id uuid)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n",
    md5: "8b6c62634d64e9058e2c503def867c4d", acl: "{postgres=X/postgres,service_role=X/postgres}",
  },
  {
    signature: "public.prepare_genome_file_deletion_v1(uuid,uuid,uuid)",
    source: "supabase/migrations/20260918113000_source_revocation_inline.sql",
    marker: "create or replace function public.prepare_genome_file_deletion_v1(",
    header: "CREATE OR REPLACE FUNCTION public.prepare_genome_file_deletion_v1(p_account_id uuid, p_session_id uuid, p_file_id uuid)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n",
    md5: "8f2f2fd4b5d9dd017c5330907b42e137", acl: "{postgres=X/postgres,service_role=X/postgres}",
  },
] as const;

/** Whether a migration restates the function, or patches it in place under the house convention. */
const rewrites = (file: string, qualified: string) => {
  const sql = read(`supabase/migrations/${file}`);
  const local = qualified.slice(qualified.indexOf(".") + 1);
  return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
    || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
};

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose objects it wraps, pins or widens", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    expect(files.filter(file => file.startsWith("20261120110000_"))).toEqual([NAME]);
    for (const earlier of ["20260908234525", "20260918113000", "20261016181000", "20261023120000", "20261024110000",
      "20261119150000", "20261119170000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
  });

  it("adds two functions and widens one check: no table, column, trigger, policy, existing body or other grant", () => {
    const statements = migration.replace(/^--.*$/gmu, "");
    expect([...statements.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/giu)].map(match => match[1]))
      .toEqual(["private.record_file_delete_nonce_v1", "public.prepare_own_prepared_file_cleanup_with_nonce_v1"]);
    expect(statements).not.toMatch(/create\s+or\s+replace/iu);
    expect(statements).not.toMatch(/\b(?:create|drop)\s+(?:table|index|view|type|trigger|policy)\b/iu);
    expect(statements).not.toContain("replace(definition");
    expect([...statements.matchAll(/alter\s+table\s+([\w.]+)\s+(drop|add)\s+constraint\s+(\w+)/giu)].map(match => match.slice(1).join(" ")))
      .toEqual(["public.account_operation_nonces drop account_operation_nonces_operation_check",
        "public.account_operation_nonces add account_operation_nonces_operation_check"]);
    expect([...statements.matchAll(/\b(grant|revoke)\b[^;]*;/giu)].map(match => match[0].replace(/\s+/gu, " ")))
      .toEqual([`revoke all on function ${RECORDER} from public,anon,authenticated,inherit_upload_only,service_role;`,
        `revoke all on function ${DOOR} from public,anon,authenticated,inherit_upload_only;`,
        `grant execute on function ${DOOR} to service_role;`]);
  });

  it("names nothing an earlier release's test holds as its last word", () => {
    for (const untouched of ["consume_session_csrf_v1", "consume_session_csrf_v2", "session_csrf_token_uses",
      "genomes-staging", "generated-artifacts", "_bucket_id_check", "empty_self_subject_v1", "delete_subject_v1",
      "consume_account_operation_nonce_v1"]) {
      expect(migration.includes(untouched), untouched).toBe(false);
    }
  });

  it("pins each wrapped function where it was last defined: no other migration after it restates or patches them", () => {
    for (const pinned of PINNED) {
      const qualified = pinned.signature.slice(0, pinned.signature.indexOf("("));
      const later = files.filter(file => file > path.basename(pinned.source) && file !== NAME);
      expect(later.filter(file => rewrites(file, qualified)), qualified).toEqual([]);
    }
    for (const added of ["private.record_file_delete_nonce_v1", "public.prepare_own_prepared_file_cleanup_with_nonce_v1"]) {
      expect(files.filter(file => file !== NAME && rewrites(file, added)), added).toEqual([]);
    }
  });

  it("neither calls nor pins the per-file guard body, which an earlier migration of the release legitimately changes", () => {
    // 20261120100000 (D-144) patches that body before this migration runs;
    // this door only wraps the owner-path door that reaches it, and neither
    // pinned door is touched by that patch.
    const D144 = "20261120100000_self_withdrawal_deletes_exports.sql";
    expect(files).toContain(D144);
    expect(NAME > D144).toBe(true);
    expect(rewrites(D144, "private.prepare_genome_file_deletion_body_v1")).toBe(true);
    const statements = migration.replace(/^--.*$/gmu, "");
    expect(statements).not.toContain("prepare_genome_file_deletion_body_v1");
    for (const body of ["e9f3f4692f0c6d10f6827410db8a0102", "c78d66691786e656a063b2dfe7b78a28"]) {
      expect(statements).not.toContain(body);
      expect(pgtap).not.toContain(body);
    }
  });
});

describe("the predecessor and postflight blocks", () => {
  const preflight = between(migration, "do $predecessor$", "$predecessor$;");
  const postflight = between(migration, "do $postflight$", "$postflight$;");
  const tuple = (pinned: typeof PINNED[number]) => `('${pinned.signature}','${pinned.md5}',\n     '${pinned.acl}')`;

  it("pins each wrapped function to the md5 recomputed from its source and to its exact ACL, before and after", () => {
    for (const pinned of PINNED) {
      expect(md5(definition(read(pinned.source), pinned.marker, pinned.header)), pinned.signature).toBe(pinned.md5);
      expect(count(preflight, tuple(pinned)), pinned.signature).toBe(1);
      expect(count(postflight, tuple(pinned)), pinned.signature).toBe(1);
    }
    expect(preflight).toContain("where md5(pg_get_functiondef(p.oid))=x.body_md5 and p.proacl::text=x.acl)<>2");
    expect(postflight).toContain("where md5(pg_get_functiondef(p.oid))=x.body_md5 and p.proacl::text=x.acl)<>2");
    expect(preflight).toContain("raise exception using errcode='55000',message='file delete operation nonce prerequisite differs'");
    expect(postflight).toContain("raise exception using errcode='55000',message='file delete operation nonce successor differs'");
  });

  it("requires the trigger that names the actor of a value inserted consumed, and refuses to run twice", () => {
    expect(preflight).toContain("t.tgname='legal_audit_actor_on_consumed_insert'");
    expect(read("supabase/migrations/20261023120000_legal_audit_attribution_completeness.sql"))
      .toContain("for each row when (new.consumed_at is not null) execute function private.note_legal_audit_actor_from_nonce_v1();");
    for (const signature of [RECORDER, DOOR]) expect(preflight).toContain(`or to_regprocedure('${signature}') is not null`);
  });

  it("widens the check from the values it holds, after the last migration that widened it, and keeps them", () => {
    const widen = between(migration, "do $widen$", "$widen$;");
    expect(widen).toContain("if v_now is null or not ('provider_setting_delete'=any(v_now)) or 'file_delete'=any(v_now) then");
    expect(widen).toContain("unnest(v_now||array['file_delete'])");
    // The same reader as 20261024110000's, which added provider_setting_delete last.
    const previous = between(read("supabase/migrations/20261024110000_copilot_settings_delete_nonce.sql"), "do $widen$", "$widen$;");
    expect(widen.replace("'provider_setting_delete'=any(v_now)) or 'file_delete'=any(v_now)", "X").replace("array['file_delete']", "Y"))
      .toBe(previous.replace("'subject_download_open'=any(v_now)) or 'provider_setting_delete'=any(v_now)", "X")
        .replace("array['provider_setting_delete']", "Y"));
    expect(postflight).toContain("pg_get_constraintdef(c.oid) like '%''file_delete''%'");
    expect(files.filter(file => file > NAME && read(`supabase/migrations/${file}`).includes("account_operation_nonces_operation_check")))
      .toEqual([]);
  });
});

describe("the recorder and the door", () => {
  const recorder = between(migration, "create function private.record_file_delete_nonce_v1(", "$$;");
  const door = between(migration, "create function public.prepare_own_prepared_file_cleanup_with_nonce_v1(", "$$;");
  const consumer = between(read("supabase/migrations/20261023120000_legal_audit_attribution_completeness.sql"),
    "create function private.consume_account_operation_nonce_v1(", "$$;");

  it("is the account operation consumer's rule for the one operation: the same checks, one consumed insert, the same refusal", () => {
    for (const rule of ["or p_nonce_hash is null or p_nonce_hash!~'^[0-9a-f]{64}$'",
      "or p_expires_at is null or p_expires_at<=v_now or p_expires_at>v_now+interval '10 minutes' then",
      "raise exception using errcode='22023',message='invalid_operation_nonce'; end if;",
      "perform 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_account_id\n  and (s.not_after is null or s.not_after>v_now);",
      "on conflict(nonce_hash) do nothing;\n if not found then raise exception using errcode='22023',message='invalid_operation_nonce'; end if;"]) {
      expect(recorder, rule).toContain(rule);
      expect(consumer, rule).toContain(rule);
    }
    expect(recorder).toContain("delete from public.account_operation_nonces where operation='file_delete' and expires_at<=v_now;");
    expect(recorder).toContain("values(p_nonce_hash,p_account_id,p_session_id,'file_delete',p_expires_at,v_now)");
    // A session that is not live is the per-file door's own refusal, which the route reads as 401.
    expect(recorder).toContain("raise exception using errcode='42501',message='file_delete_unauthorized'");
    expect(read("supabase/migrations/20260918113000_source_revocation_inline.sql"))
      .toContain("raise exception using errcode='42501', message='file_delete_unauthorized';");
  });

  it("records the value first, then runs the unchanged owner-path door, in one function call and so one transaction", () => {
    const order = ["perform private.record_file_delete_nonce_v1(p_account_id,p_session_id,p_nonce_hash,p_nonce_expires_at);",
      "return public.prepare_own_prepared_file_cleanup_v1(p_account_id,p_session_id,p_file_id);"];
    const at = order.map(fragment => door.indexOf(fragment));
    expect(at.every(index => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(door).toContain("returns jsonb language plpgsql security definer set search_path='' as");
    expect(door).not.toMatch(/\bexception\b|\bcommit\b/iu);
  });

  it("is reached only by the route, which spends with its first call and falls back only while the door is absent", () => {
    const route = read("src/app/api/files/[id]/route.ts");
    expect(route).toContain('const spend: FileCleanupSpend = { procedure: "prepare_own_prepared_file_cleanup_with_nonce_v1", args: personOperationNonceArgs(nonce) };');
    expect(route).toContain("let prepared = await prepareFileCleanup(admin, args, request.signal, undefined, spend);");
    expect(route).toContain("if (prepared.error && FUNCTION_ABSENT.has(codeOf(prepared.error))) prepared = await prepareFileCleanup(admin, args, request.signal);");
    expect(route).toContain('const FUNCTION_ABSENT: ReadonlySet<string> = new Set(["PGRST202", "42883"]);');
    expect(read("src/lib/genome/prepared-source/cleanup-integration.ts"))
      .toContain("const result = spend ? await rpc(spend.procedure, { ...args, ...spend.args }) : await rpc(procedure, args);");
    const callers = ["src", "worker", "workers", "scripts"].flatMap(directory => {
      try { return readdirSync(path.join(root, directory), { recursive: true }).map(name => path.join(directory, String(name))); }
      catch { return []; }
    }).filter(file => /\.(?:ts|tsx|mts)$/u.test(file) && !file.endsWith(".test.ts")
      && read(file).includes("prepare_own_prepared_file_cleanup_with_nonce_v1"));
    expect(callers.sort()).toEqual(["src/app/api/files/[id]/route.ts", "src/lib/genome/prepared-source/cleanup-integration.ts"]);
  });

  it("is driven by its pgTAP suite through every refusal, the replay, the rollback and the deletion", () => {
    for (const fragment of ["'invalid_operation_nonce'", "'file_delete_unauthorized'", "'file_delete_processing'", "'file_delete_not_found'",
      "'the refused deletion spent nothing'", "'a replay for the same file is refused'", "'the spent value is refused for another file'",
      "'a value another operation spent is refused'", "'8b6c62634d64e9058e2c503def867c4d'", "'6869593d67ff37d93a6d4caea62f01c3'",
      "public.finish_genome_file_deletion_v1("]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    expect(pgtap.startsWith("begin;\n")).toBe(true);
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
