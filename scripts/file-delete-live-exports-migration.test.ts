import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-152, both halves (20261122130000_file_delete_live_exports_only.sql; owner
 * decisions of 22 November 2026, "Only a live download copy blocks deleting a
 * single file" and "Withdrawing consent for one's own file ends a finished
 * download copy too"): the per-file guard api.file-delete prepares and
 * finishes every file through now refuses only while a download copy of the
 * record is live, still being made or still downloadable; and the self
 * emptying the own-file withdrawal runs now ends every whole-account copy
 * that includes the record, a finished one too. pg_get_functiondef keeps a
 * plpgsql body verbatim, so both bodies are rebuilt here from the migration
 * that last defined them, D-144's patches replayed, their md5s recomputed,
 * and this migration's patches replayed to the successor md5s it asserts;
 * every door it pins is rebuilt from its source and its pin recomputed. The
 * pgTAP suites (supabase/tests/file_delete_live_exports_only.sql and
 * supabase/tests/self_withdrawal_ends_finished_copies.sql) drive every state
 * of every copy against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122130000_file_delete_live_exports_only.sql";
const D144 = "20261120100000_self_withdrawal_deletes_exports.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/file_delete_live_exports_only.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();

/** The text between two markers, the first occurrence after `after`. */
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
/** A function as pg_get_functiondef prints it: its normalized header around the verbatim body. */
const definition = (body: string, header: string) => `${header}AS $function$${body}$function$\n`;

const GUARD_TARGET = "private.prepare_genome_file_deletion_body_v1(uuid,uuid)";
const EMPTY_TARGET = "private.empty_self_subject_v1(uuid,uuid)";
const EMPTY_BASE = definition(source("20261016181000_subject_delete.sql", "create function private.empty_self_subject_v1("),
  "CREATE OR REPLACE FUNCTION private.empty_self_subject_v1(p_account_id uuid, p_subject_id uuid)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n");
const GUARD_BASE = definition(source("20261016181000_subject_delete.sql", "create or replace function private.prepare_genome_file_deletion_body_v1("),
  "CREATE OR REPLACE FUNCTION private.prepare_genome_file_deletion_body_v1(p_account_id uuid, p_file_id uuid)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n");

// The doors "live" is read from, each as the migration that last defined it left it.
const CURRENT_SOURCE = source("20260923123240_export_archive_persistence.sql", "create function private.export_archive_current_v1(");
const REQUEST_SOURCE = source("20260923123240_export_archive_persistence.sql", "create function public.export_archive_request_v1(");
const CLAIMANT_SOURCE = source("20261016211000_future_person_export_open_ready.sql", "create function private.future_person_ready_export_v1(");
const DELIVERY_SOURCE = source("20261016196000_subject_export.sql",
  "CREATE OR REPLACE FUNCTION private.account_archive_r2_completed_context_v1(");
const LEGACY_SOURCE = source("20260831224124_exports_and_generated_artifacts.sql", "create or replace function private.download_target_authorized_v1(");
const OWN_SOURCE = source("20260909001117_own_prepared_original_retirement.sql", "create or replace function private.own_export_source_v1(");
const CLEANUP_SOURCE = source("20260923123240_export_archive_persistence.sql", "create function public.export_archive_cleanup_v1(");
const DOWNLOAD_CONTEXT_SOURCE = source("20261009201500_account_archive_test_completion.sql",
  "function private.account_archive_test_download_context_v1(");
const PINNED = [
  { signature: "public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)", acl: "{postgres=X/postgres,service_role=X/postgres}", by: "def",
    hash: md5(definition(CLEANUP_SOURCE, "CREATE OR REPLACE FUNCTION public.export_archive_cleanup_v1(p_operation text, p_export_id uuid, "
      + "p_attempt_id uuid, p_payload jsonb DEFAULT NULL::jsonb)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n")) },
  { signature: "private.export_archive_current_v1(uuid,text)", acl: "{postgres=X/postgres}", by: "def",
    hash: md5(definition(CURRENT_SOURCE, "CREATE OR REPLACE FUNCTION private.export_archive_current_v1(p_export uuid, p_expected text)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n")) },
  { signature: "public.export_archive_request_v1(text,jsonb,text,uuid,jsonb,text)", acl: "{postgres=X/postgres,service_role=X/postgres}", by: "def",
    hash: md5(definition(REQUEST_SOURCE, "CREATE OR REPLACE FUNCTION public.export_archive_request_v1(p_operation text, p_origin jsonb, "
      + "p_target_kind text, p_target_id uuid, p_payload jsonb DEFAULT NULL::jsonb, p_csrf_binding text DEFAULT NULL::text)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n")) },
  { signature: "private.future_person_ready_export_v1(text,uuid,text)", acl: "{postgres=X/postgres}", by: "src", hash: md5(CLAIMANT_SOURCE) },
  { signature: "private.account_archive_r2_completed_context_v1(uuid,text,boolean)", acl: "{postgres=X/postgres}", by: "src",
    hash: md5(DELIVERY_SOURCE) },
  { signature: "private.download_target_authorized_v1(uuid,text,uuid,text,bigint,bigint)", acl: "{postgres=X/postgres,service_role=X/postgres}",
    by: "def", hash: md5(definition(LEGACY_SOURCE, "CREATE OR REPLACE FUNCTION private.download_target_authorized_v1(p_account_id uuid, "
      + "p_target_kind text, p_target_id uuid, p_purpose text, p_lifecycle_revision bigint, p_grant_revision bigint)\n"
      + " RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n")) },
  { signature: "private.own_export_source_v1(uuid,uuid,uuid)", acl: "{postgres=X/postgres,service_role=X/postgres}", by: "def",
    hash: md5(definition(OWN_SOURCE, "CREATE OR REPLACE FUNCTION private.own_export_source_v1(p_account_id uuid, p_session_id uuid, p_file_id uuid)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n")) },
] as const;

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const parse = (sql: string): Patch[] => [...sql.matchAll(
  /\((\d+),'([^']+)','([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/g,
)].map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
  old: match[6]!, next: match[7]!, label: match[8]! }));
const patches = parse(migration);
const d144All = parse(read(`supabase/migrations/${D144}`));
const d144 = d144All.filter(patch => patch.target === GUARD_TARGET);
/** Each step checking its predecessor md5, its single anchor and its successor md5. */
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
const GUARD_D144 = replay(GUARD_BASE, d144);
const GUARD = replay(GUARD_D144, patches.filter(patch => patch.target === GUARD_TARGET));
const CLAUSE = patches[0]!.next;
const EMPTY_D144 = replay(EMPTY_BASE, d144All.filter(patch => patch.target === EMPTY_TARGET));
const EMPTY = replay(EMPTY_D144, patches.filter(patch => patch.target === EMPTY_TARGET));
const ENDING = patches[1]!.next;

describe("the release it belongs to", () => {
  it("is a guarded production release that follows the guard's last patch and every door it pins", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260831224124", "20260909001117", "20260923123240", "20261016181000", "20261016196000",
      "20261016211000", "20261120100000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
  });

  it("creates nothing and patches two bodies once each: no function, table, column, constraint, trigger or grant", () => {
    const statements = migration.replace(/^--.*$/gmu, "");
    expect(statements).not.toMatch(/^create (?:or replace )?function/imu);
    expect(statements).not.toMatch(/^\s*(?:alter|drop|create)\s+(?:table|index|trigger|policy|type|view)\b/imu);
    expect(statements).not.toMatch(/^\s*(?:grant|revoke)\b/imu);
    expect(patches.map(patch => `${patch.ordinal} ${patch.target} ${patch.acl}`))
      .toEqual([`1 ${GUARD_TARGET} {postgres=X/postgres}`, `2 ${EMPTY_TARGET} {postgres=X/postgres}`]);
    expect(count(migration, "execute replace(definition,item.old_fragment,item.new_fragment);")).toBe(1);
  });

  it("is the last word on the guard and the emptying and touches no door it pins: no other migration patches or restates them later", () => {
    // A restatement, or a patch in place naming the body as its target (a
    // pin in a predecessor or postflight block is neither).
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || new RegExp(`\\(\\d+,'${qualified.replace(".", "\\.")}\\(`, "u").test(sql);
    };
    // 2026-11-22 (D-152 follow-up): 20261122150000 patches the guard once
    // more, from exactly this migration's successor, keeping this clause word
    // for word and adding the whole-account copies after it. It is the one
    // later migration allowed to, and only for the guard.
    const D152B = "20261122150000_file_delete_live_account_copies.sql";
    expect(files.filter(file => file > D144 && rewrites(file, "private.prepare_genome_file_deletion_body_v1")), "guard").toEqual([NAME, D152B]);
    const followUp = parse(read(`supabase/migrations/${D152B}`));
    expect(followUp.map(patch => [patch.target, patch.before])).toEqual([[GUARD_TARGET, md5(GUARD)]]);
    expect(followUp[0]!.old).toBe(CLAUSE.slice(CLAUSE.indexOf("    or exists (")));
    expect(followUp[0]!.next.startsWith(followUp[0]!.old)).toBe(true);
    expect(files.filter(file => file > D144 && rewrites(file, "private.empty_self_subject_v1")), "emptying").toEqual([NAME]);
    const lastDefinitions: Record<string, string> = {
      "public.export_archive_cleanup_v1": "20260923123240_export_archive_persistence.sql",
      "private.export_archive_current_v1": "20260923123240_export_archive_persistence.sql",
      "public.export_archive_request_v1": "20260923123240_export_archive_persistence.sql",
      "private.future_person_ready_export_v1": "20261016211000_future_person_export_open_ready.sql",
      "private.account_archive_r2_completed_context_v1": "20261016196000_subject_export.sql",
      "private.download_target_authorized_v1": "20260831224124_exports_and_generated_artifacts.sql",
      "private.own_export_source_v1": "20260909001117_own_prepared_original_retirement.sql",
    };
    // This migration names each of them only in its pins; its patches are the two bodies' (held above).
    for (const [qualified, last] of Object.entries(lastDefinitions)) {
      expect(files.filter(file => file > last && file !== NAME && rewrites(file, qualified)), qualified).toEqual([]);
      expect(patches.some(patch => patch.target.startsWith(`${qualified}(`)), qualified).toBe(false);
    }
  });
});

describe("the predecessor block, the patch and the postflight", () => {
  const preflight = between(migration, "do $predecessor$", "$predecessor$;");
  const postflight = between(migration, "do $postflight$", "$postflight$;");

  it("starts from exactly D-144's successors of the guard and the emptying, recomputed from source, and keeps their ACL", () => {
    expect(md5(GUARD_BASE)).toBe("e9f3f4692f0c6d10f6827410db8a0102");
    expect(md5(GUARD_D144)).toBe("c78d66691786e656a063b2dfe7b78a28");
    expect(md5(EMPTY_BASE)).toBe("85a9ab8159fa7e5bfb18deada62c1215");
    expect(md5(EMPTY_D144)).toBe("5c35b1a9eafbfe7fd3e16f54b648dee7");
    expect(patches[0]!.before).toBe(md5(GUARD_D144));
    expect(patches[0]!.old).toBe(d144.at(-1)!.next);
    expect(patches[1]!.before).toBe(md5(EMPTY_D144));
    for (const [target, body] of [[GUARD_TARGET, GUARD_D144], [EMPTY_TARGET, EMPTY_D144]] as const) {
      expect(preflight).toContain(`to_regprocedure('${target}')\n   and md5(pg_get_functiondef(p.oid))='${md5(body)}'`
        + " and p.proacl::text='{postgres=X/postgres}')");
    }
    expect(preflight).toContain("raise exception using errcode='55000',message='file delete live exports prerequisite differs'");
  });

  it("pins every door live is read from to the md5 recomputed from its source, and to its ACL, before and after", () => {
    for (const pinned of PINNED) {
      const pin = pinned.by === "def" ? `md5(pg_get_functiondef(p.oid))='${pinned.hash}'` : `md5(p.prosrc)='${pinned.hash}'`;
      expect(count(preflight, `to_regprocedure('${pinned.signature}')`), pinned.signature).toBe(1);
      expect(count(postflight, `'${pinned.signature}'::regprocedure`), pinned.signature).toBe(1);
      for (const block of [preflight, postflight]) {
        const at = block.indexOf(pinned.signature);
        const clause = block.slice(at, block.indexOf("\n  or ", at) > 0 ? block.indexOf("\n  or ", at) : block.indexOf(" then", at));
        expect(clause, pinned.signature).toContain(pin);
        expect(clause, pinned.signature).toContain(`p.proacl::text='${pinned.acl}'`);
      }
    }
    // A header that prints a table type would make the md5 depend on the
    // search path; those two are pinned by their body.
    expect(PINNED.filter(pinned => pinned.by === "src").map(pinned => pinned.signature)).toEqual([
      "private.future_person_ready_export_v1(text,uuid,text)", "private.account_archive_r2_completed_context_v1(uuid,text,boolean)"]);
  });

  it("replays each patch on the rebuilt body, one anchor each, to exactly the successor it asserts", () => {
    expect(md5(GUARD)).toBe("9753a5d9d38d09f6b17664826247f070");
    expect(md5(EMPTY)).toBe("768b5433d639f9c8578fbd59a5a0d703");
    expect(postflight).toContain(`'${EMPTY_TARGET}'::regprocedure\n   and md5(pg_get_functiondef(p.oid))='${md5(EMPTY)}'`
      + " and p.prosecdef and p.proconfig=array['search_path=\"\"']::text[]\n   and p.proacl::text='{postgres=X/postgres}')");
    const loop = between(migration, "do $patch_d152$", "$patch_d152$;");
    expect(loop).toContain("where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;");
    expect(loop).toContain("(length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1");
    expect(loop).toContain("and p.proacl is not distinct from before_acl) then");
    expect(postflight).toContain(`'${GUARD_TARGET}'::regprocedure\n   and md5(pg_get_functiondef(p.oid))='${md5(GUARD)}'`
      + " and p.prosecdef and p.proconfig=array['search_path=\"\"']::text[]\n   and p.proacl::text='{postgres=X/postgres}')");
    expect(postflight).toContain("raise exception using errcode='55000',message='file delete live exports successor differs'");
  });
});

describe("what live means, read from the doors", () => {
  it("blocks on a copy of the record being made or downloadable, each with its job before the deadline, and on nothing else", () => {
    expect(CLAUSE.replace(/^\s*--.*\n/gmu, "")).toBe(
      "    or exists (select 1 from public.generated_exports e join private.export_archive_jobs j on j.export_id=e.id\n"
      + "      where e.target_kind='subject' and e.target_id=s.id and j.deadline>clock_timestamp()\n"
      + "      and (e.status in ('queued','building') or (e.status='ready' and e.expires_at>clock_timestamp())))\n");
    // Only the export clause changes; the refusal it feeds is the same.
    expect(GUARD.replace(CLAUSE, () => d144.at(-1)!.next)).toBe(GUARD_D144);
    expect(GUARD.slice(GUARD.indexOf(CLAUSE))).toContain("raise exception using errcode='55000', message='file_delete_shared_graph';");
  });

  it("matches what every step, poll, open and chunk read still accepts", () => {
    // The currentness check every worker step, poll, open and chunk read runs:
    // no job, another status or a passed deadline is refused.
    expect(CURRENT_SOURCE).toContain("if e.id is null or j.export_id is null or e.archive_version is distinct from 'archive-segments-v1'\n"
      + "  or e.status not in ('queued','building','ready') or j.deadline<=clock_timestamp()");
    expect(REQUEST_SOURCE).toContain("perform private.export_archive_current_v1(e.id,capture->>'authorityReceipt');");
    // Opening a READY copy: refused at or past its expiry.
    expect(REQUEST_SOURCE).toContain("e.status<>'ready' or e.expires_at<=clock_timestamp()");
    expect(REQUEST_SOURCE).toContain("expiry:=least(e.expires_at,clock_timestamp()+interval '1 hour');");
    expect(CLAIMANT_SOURCE).toContain("or e.status<>'ready' or e.expires_at is null or e.expires_at<=clock_timestamp() or j.deadline<=clock_timestamp()");
    // Every READY chunk issue and acknowledgement: refused past the expiry or the deadline.
    expect(DELIVERY_SOURCE).toContain("perform private.export_archive_current_v1(ar.export_id,p_receipt);");
    expect(DELIVERY_SOURCE).toContain("jr.deadline<=clock_timestamp()");
    expect(DELIVERY_SOURCE).toContain("(p_ready and (ar.account_r2_completion is null or er.expires_at<=clock_timestamp()");
    // The legacy download-session authorizer: READY and before the expiry.
    expect(LEGACY_SOURCE).toContain("and e.status = 'ready'\n        and e.expires_at > clock_timestamp()");
  });

  it("finds the legacy download authorizer unreachable: only an uncalled function calls it, and nothing calls that", () => {
    const mentions = (name: string) => files.filter(file => read(`supabase/migrations/${file}`).includes(name));
    expect(mentions("authorize_download_range_v1(")).toEqual(["20260831224054_storage_and_download_sessions.sql"]);
    const defining = read("supabase/migrations/20260831224054_storage_and_download_sessions.sql");
    expect(count(defining, "authorize_download_range_v1(")).toBe(3); // its create, revoke and grant
    expect(read("supabase/config.toml")).toMatch(/^schemas = \["public", "graphql_public"\]$/mu);
  });

  it("finds that nothing makes a copy live again: every write of a copy's status, deadline or expiry", () => {
    const writes = files.flatMap(file => [...read(`supabase/migrations/${file}`).matchAll(
      /update\s+(public\.generated_exports|private\.export_archive_jobs)(?:\s+\w+)?\s+set\s+([^;]*?)(?:\s+where\b[^;]*)?;/giu)]
      .map(match => `${match[1]} set ${match[2]!.replace(/\s+/gu, " ")}`));
    expect([...new Set(writes)].sort()).toEqual([
      "private.export_archive_jobs set active_attempt=null",
      "private.export_archive_jobs set active_attempt=p_attempt_id",
      "public.generated_exports set status='building'",
      "public.generated_exports set status='failed',completed_at=null,expires_at=null",
      "public.generated_exports set status='ready',completed_at=clock_timestamp(),expires_at=expires, "
        + "archive_sha256=ar.archive_sha256,manifest_sha256=ar.manifest_sha256,byte_count=ar.byte_count",
      "public.generated_exports set status='revoked'",
    ]);
    // Building only from queued or building; READY only from building, with
    // an expiry no later than the job's deadline.
    const persistence = read("supabase/migrations/20260923123240_export_archive_persistence.sql");
    expect(between(persistence, "if p_operation='begin' then", "update public.generated_exports set status='building'"))
      .toContain("e.status not in ('queued','building')");
    const completion = read("supabase/migrations/20261009201500_account_archive_test_completion.sql");
    expect(completion).toContain("select least(jr.deadline,min(original_deadline)) into expires from private.account_archive_r2_allocations");
    expect(DELIVERY_SOURCE).toContain("er.status is distinct from (case when p_ready then 'ready' else 'building' end)");
  });
});

describe("what the own-file withdrawal now ends", () => {
  it("ends every whole-account copy that includes the record, a finished one too, before the record's own copies and the files", () => {
    const order = [
      "v_exports:=array(select e.id from public.generated_exports e where e.target_kind='account' and e.target_id=p_account_id\n"
        + "  and e.status in ('queued','building','ready') and e.subject_partitions @> jsonb_build_array(s.id) order by e.id);",
      "perform 1 from public.generated_exports where id=any(v_exports) order by id for update;",
      "where a.export_id=any(v_exports) and a.state in ('writing','bytes_complete') order by a.export_id,a.id loop",
      "perform public.export_archive_cleanup_v1('stop',v_attempt.export_id,v_attempt.id,null);",
      "update public.generated_exports set status='revoked' where id=any(v_exports) and status<>'revoked';",
      "update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1\n"
        + "  where status='active' and target_kind='export' and target_id=any(v_exports);",
      "update public.generated_exports set status='revoked'\n  where status in ('queued','building') and target_kind='account' and target_id=p_account_id;"];
    const at = order.map(fragment => ENDING.indexOf(fragment));
    expect(at.every(index => index >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(EMPTY.indexOf(ENDING)).toBeLessThan(EMPTY.indexOf("-- 20261120100000 (D-144): every export of the record ends with it."));
    expect(EMPTY.indexOf(ENDING)).toBeLessThan(EMPTY.indexOf("foreach v_file in array v_files loop"));
    // Nothing else changes: the account-level statement stays, after the new
    // block, and the record's own copies still end as D-144 wrote it.
    expect(ENDING.endsWith(patches[1]!.old)).toBe(true);
    expect(EMPTY.replace(ENDING, () => patches[1]!.old)).toBe(EMPTY_D144);
    // Nothing is deleted, and the audit event and its payload are unchanged.
    expect(ENDING).not.toMatch(/\bdelete\s+from\b/iu);
    expect(between(EMPTY, "perform private.append_legal_audit_event('subject.emptied'", ";"))
      .toBe(between(EMPTY_D144, "perform private.append_legal_audit_event('subject.emptied'", ";"));
  });

  it("finds every door that opens, polls or serves a copy refusing an ended one, an open download included", () => {
    // The stop: objects queued behind the fence, download rows revoked, a READY completion cleared.
    expect(CLEANUP_SOURCE).toContain("update private.export_archive_attempts set state='cleanup_pending'");
    expect(CLEANUP_SOURCE).toContain("update private.export_archive_downloads set revoked_at=coalesce(revoked_at,clock_timestamp()) where attempt_id=a.id;");
    expect(CLEANUP_SOURCE).toContain("update public.generated_exports set status='failed',completed_at=null,expires_at=null where id=e.id;");
    // Every poll, open and chunk read refuses a revoked copy; every READY
    // chunk a copy no longer READY; every download step a revoked download row.
    expect(CURRENT_SOURCE).toContain("e.status not in ('queued','building','ready')");
    expect(DELIVERY_SOURCE).toContain("er.status is distinct from (case when p_ready then 'ready' else 'building' end)");
    expect(DOWNLOAD_CONTEXT_SOURCE).toContain("dr.revoked_at is not null");
  });
});

describe("the race", () => {
  it("serialises every capture with the deletion on the account's profile row, and no capture answers for a file being deleted", () => {
    // The guard's first statement locks the profile.
    expect(between(GUARD, "begin\n", ";\n")).toBe("  -- Match canonical model/read locks: account, subject, then source.\n"
      + "  perform 1 from public.profiles where id=p_account_id for update");
    expect(GUARD.indexOf("perform 1 from public.profiles where id=p_account_id for update;")).toBeLessThan(GUARD.indexOf(CLAUSE));
    // The source every capture reads locks the same row before it reads the file.
    const lock = OWN_SOURCE.indexOf("perform 1 from public.profiles where id=p_account_id for update;");
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(OWN_SOURCE.indexOf("select * into f from public.genome_files where id=p_file_id;"));
    // It answers only for a file whose stored object is current, which the
    // guard's preparation ends.
    expect(OWN_SOURCE).toContain("o.state='current' and o.revoked_at is null");
    expect(GUARD).toContain("update public.genome_storage_objects set state='purge_queued',revoked_at=coalesce(revoked_at,clock_timestamp())");
    // The finish runs the guard again.
    const finish = read("supabase/migrations/20260918113000_source_revocation_inline.sql");
    expect(finish).toContain("perform private.prepare_genome_file_deletion_body_v1(d.account_id,p_file_id);");
  });
});

describe("its tests and its notes", () => {
  it("is driven by its pgTAP suites through every state of every copy, another record, the race and the withdrawal", () => {
    for (const fragment of ["pg_temp.make_export('queued','queued')", "pg_temp.make_export('writing','writing')",
      "pg_temp.make_export('bytes','bytes')", "pg_temp.make_export('ready','ready')", "pg_temp.expire('expired')",
      "pg_temp.age('aged-ready')", "pg_temp.age('aged-queued')", "pg_temp.age('aged-writing')",
      "public.export_archive_cleanup_v1('stop',pg_temp.export_id('failed')", "set status='revoked' where id=pg_temp.export_id('revoked')",
      "pg_temp.make_export('retired','ready')", "set status='expired'", "set status='purged'", "'independent-rights'",
      "'export_publication_not_integrated'", "pg_temp.make_export('account-ready','ready')", "pg_temp.make_export('beta','ready')",
      "'export_source_unavailable'", "public.finish_genome_file_deletion_v1(", "'file_delete_shared_graph'", md5(GUARD)]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    // The four live states of the record's own copy and the claimant's two,
    // and (2026-11-22, D-152 follow-up) a queued and a READY whole-account copy.
    expect(count(pgtap, "select throws_ok($$select pg_temp.delete_file()$$,'55000','file_delete_shared_graph'")).toBe(8);
    // 2026-11-22 (D-152 follow-up): the suites pin the guard at
    // 20261122150000's successor, which patches exactly this one (held by
    // the "last word" test), and name this one in a comment.
    const followUpAfter = [...read("supabase/migrations/20261122150000_file_delete_live_account_copies.sql")
      .matchAll(/\(1,'private\.prepare_genome_file_deletion_body_v1\(uuid,uuid\)','9753a5d9d38d09f6b17664826247f070',\s*'([0-9a-f]{32})',/gu)]
      .map(match => match[1]);
    expect(followUpAfter).toHaveLength(1);
    expect(pgtap).toContain(`'${followUpAfter[0]}'`);
    expect(pgtap.startsWith("begin;\n")).toBe(true);
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
    const withdrawal = read("supabase/tests/self_withdrawal_ends_finished_copies.sql");
    for (const fragment of ["pg_temp.make_export('account-ready','ready')", "private.issue_account_archive_test_chunk_v1(",
      "private.ack_account_archive_test_chunk_v1(", "private.account_archive_test_delivery_context_v1(",
      "pg_temp.make_export('account-queued','queued')", "pg_temp.make_export('account-writing','writing')",
      "pg_temp.make_export('account-bytes','bytes')", "pg_temp.make_export('account-expired','ready')",
      "pg_temp.make_export('account-failed','writing')", "pg_temp.make_export('account-revoked','writing')",
      "pg_temp.make_export('account-elsewhere','ready')", "pg_temp.make_export('beta-account','ready')",
      "pg_temp.make_export('beta-record','ready')", "public.empty_self_subject_with_notice_v1(", "'revoked cleanup_pending'",
      "'ready bytes_complete'", `'${md5(EMPTY)}'`]) {
      expect(withdrawal, fragment).toContain(fragment);
    }
    expect(withdrawal.startsWith("begin;\n")).toBe(true);
    expect(withdrawal.trimEnd().endsWith("rollback;")).toBe(true);
    // The other suites that pin the emptying pin this successor too.
    for (const suite of ["self_withdrawal_deletes_exports.sql", "own_upload_consent_withdrawal.sql"]) {
      expect(read(`supabase/tests/${suite}`), suite).toContain(`'${md5(EMPTY)}'`);
    }
    // The D-144 suite pins the guard's later successor and names this one.
    expect(read("supabase/tests/self_withdrawal_deletes_exports.sql")).toContain(`'${followUpAfter[0]}'`);
    expect(read("supabase/tests/self_withdrawal_deletes_exports.sql")).toContain(md5(GUARD));
  });

  it("is in the release notes of the guarded release it joins", () => {
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });
});
