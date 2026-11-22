import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-144 (20261120100000_self_withdrawal_deletes_exports.sql): a saved export
 * of a person's own record no longer blocks the withdrawal of their upload
 * consent. The self emptying ends every export of the record through the
 * export cleanup door's own stop and revokes it; the per-file guard and the
 * page's read follow. pg_get_functiondef keeps a plpgsql body verbatim, so
 * each pinned body is rebuilt here from the migration that last defined it,
 * its md5 recomputed, and every patch replayed to the successor md5 the
 * migration asserts. The pgTAP suite
 * (supabase/tests/self_withdrawal_deletes_exports.sql) drives the emptying,
 * the guard and the read against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261120100000_self_withdrawal_deletes_exports.sql";
/** The one later migration that patches a body this one patches: the per-file guard (D-152). */
const D152 = "20261122130000_file_delete_live_exports_only.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/self_withdrawal_deletes_exports.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();

/** The text between two markers, the first occurrence after `after`. */
function between(text: string, start: string, end: string, after = 0): string {
  const from = text.indexOf(start, after);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}

/** A function as pg_get_functiondef prints it: its normalized header around the verbatim body. */
function definition(file: string, marker: string, header: string): string {
  const source = read(`supabase/migrations/${file}`);
  const start = source.lastIndexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("as $$", start) + "as $$".length;
  const close = source.indexOf("$$;", open);
  return `${header}AS $function$${source.slice(open, close)}$function$\n`;
}

const EMPTY_SELF = definition("20261016181000_subject_delete.sql", "create function private.empty_self_subject_v1(",
  "CREATE OR REPLACE FUNCTION private.empty_self_subject_v1(p_account_id uuid, p_subject_id uuid)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n");
const FILE_GUARD = definition("20261016181000_subject_delete.sql", "create or replace function private.prepare_genome_file_deletion_body_v1(",
  "CREATE OR REPLACE FUNCTION private.prepare_genome_file_deletion_body_v1(p_account_id uuid, p_file_id uuid)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n");
const READINESS = definition("20261119150000_own_upload_consent_withdrawal.sql", "create function public.self_subject_withdrawal_readiness_v1(",
  "CREATE OR REPLACE FUNCTION public.self_subject_withdrawal_readiness_v1(p_account_id uuid, p_subject_id uuid)\n"
  + " RETURNS text\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n");
const CLEANUP = definition("20260923123240_export_archive_persistence.sql", "create function public.export_archive_cleanup_v1(",
  "CREATE OR REPLACE FUNCTION public.export_archive_cleanup_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_payload jsonb DEFAULT NULL::jsonb)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n");

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const patches: Patch[] = [...migration.matchAll(
  /\((\d+),'([^']+)','([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/g,
)].map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
  old: match[6]!, next: match[7]!, label: match[8]! }));

/** Each body as the migration leaves it, with no check: the rebuilt predecessor with its patches applied in order. */
function apply(base: string, target: string): string {
  return patches.filter(item => item.target === target).reduce((body, patch) => body.replace(patch.old, () => patch.next), base);
}
/** The same, checking each step's predecessor md5, its single anchor and its successor md5. */
function replay(base: string, target: string): string {
  let body = base;
  for (const patch of patches.filter(item => item.target === target)) {
    expect(md5(body), patch.label).toBe(patch.before);
    expect(count(body, patch.old), patch.label).toBe(1);
    body = body.replace(patch.old, () => patch.next);
    expect(md5(body), patch.label).toBe(patch.after);
  }
  return body;
}
const EMPTY_TARGET = "private.empty_self_subject_v1(uuid,uuid)";
const GUARD_TARGET = "private.prepare_genome_file_deletion_body_v1(uuid,uuid)";
const READY_TARGET = "public.self_subject_withdrawal_readiness_v1(uuid,uuid)";

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose bodies it pins or patches", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260923123240", "20261016181000", "20261119150000", "20261119160000", "20261119170000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
  });

  it("creates nothing and patches five bodies: no function, table, column, constraint, trigger or grant", () => {
    const statements = migration.replace(/^--.*$/gmu, "");
    expect(statements).not.toMatch(/^create (?:or replace )?function/imu);
    expect(statements).not.toMatch(/^\s*(?:alter|drop|create)\s+(?:table|index|trigger|policy|type|view)\b/imu);
    expect(statements).not.toMatch(/^\s*(?:grant|revoke)\b/imu);
    expect(patches.map(patch => `${patch.ordinal} ${patch.target}`)).toEqual([`1 ${EMPTY_TARGET}`, `2 ${EMPTY_TARGET}`,
      `3 ${EMPTY_TARGET}`, `4 ${GUARD_TARGET}`, `5 ${READY_TARGET}`]);
    expect(patches.map(patch => patch.acl)).toEqual(["{postgres=X/postgres}", "{postgres=X/postgres}", "{postgres=X/postgres}",
      "{postgres=X/postgres}", "{postgres=X/postgres,service_role=X/postgres}"]);
  });

  it("names none of what the earlier 19 November migrations pin, nor any door they patch", () => {
    for (const pinned of ["genomes-staging", "generated-artifacts", "account_deletion_storage_entries_bucket_id_check",
      "embryo_ingest_delete_objects_bucket_id_check", "genome_storage_objects_bucket_id_check", "consume_session_csrf_v1",
      "consume_session_csrf_v2", "session_csrf_token_uses", "claim_due_account_deletion_v1", "prepare_embryo_ingest_unwind_v1",
      "create_adult_subject_invitation", "create_embryo_cohort_draft_core_v1", "create_embryo_draft_invitation_core_v1",
      "'public.delete_subject_v1(", "restrict_embryo_cohort_core_v1", "legal_audit_person_event_v1",
      "invitation_notice_recipient_current_v1", "empty_self_subject_with_notice_v1("]) {
      expect(migration.includes(pinned), pinned).toBe(false);
    }
  });

  it("is the last word on the three bodies it patches: no later migration restates or patches them", () => {
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    expect(files.filter(file => file > NAME && rewrites(file, "public.self_subject_withdrawal_readiness_v1"))).toEqual([]);
    // 2026-11-22 (D-152): 20261122130000 names the cleanup door with
    // replace(definition) in the same file, as this migration does, only to
    // pin it at the md5 pinned here; it neither restates nor patches it.
    expect(files.filter(file => file > NAME && rewrites(file, "public.export_archive_cleanup_v1"))).toEqual([D152]);
    expect(read(`supabase/migrations/${D152}`)).not.toMatch(/\(\d+,'public\.export_archive_cleanup_v1\(/u);
    expect(read(`supabase/migrations/${D152}`)).toContain("to_regprocedure('public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)')\n"
      + "   and md5(pg_get_functiondef(p.oid))='25fa3ce71b73fb0c371d1bb9af836bd7'");
    // 2026-11-22 (D-152): 20261122130000 patches the per-file guard again (its
    // export clause) and the self emptying again (the account's whole-account
    // copies), each from exactly this migration's successor. It is the one
    // later migration allowed to, and only for those two bodies.
    // 2026-11-22 (D-152 follow-up): 20261122150000 patches the guard once more,
    // only from 20261122130000's successor (held by that migration's test).
    expect(files.filter(file => file > NAME && rewrites(file, "private.empty_self_subject_v1")))
      .toEqual([D152, "20261122150000_file_delete_live_account_copies.sql"]);
    // It names the self emptying only to pin it at 20261122130000's
    // successor (the file convention flags a pin in a file that uses
    // replace(definition)); it has no patch tuple for it.
    const followUpSql = read("supabase/migrations/20261122150000_file_delete_live_account_copies.sql");
    expect(followUpSql).not.toMatch(/\(\d+,'private\.empty_self_subject_v1\(/u);
    expect(followUpSql).toContain("to_regprocedure('private.empty_self_subject_v1(uuid,uuid)')\n"
      + "   and md5(pg_get_functiondef(p.oid))='768b5433d639f9c8578fbd59a5a0d703'");
    expect(files.filter(file => file > NAME && rewrites(file, "private.prepare_genome_file_deletion_body_v1")))
      .toEqual([D152, "20261122150000_file_delete_live_account_copies.sql"]);
    expect([...read("supabase/migrations/20261122150000_file_delete_live_account_copies.sql").matchAll(/\((\d+),'([^']+)','([0-9a-f]{32})',/gu)]
      .map(match => [match[2], match[3]])).toEqual([[GUARD_TARGET, "9753a5d9d38d09f6b17664826247f070"]]);
    const d152 = read(`supabase/migrations/${D152}`);
    const last = (target: string) => patches.filter(patch => patch.target === target).at(-1)!;
    expect([...d152.matchAll(/\((\d+),'([^']+)','([0-9a-f]{32})',/gu)].map(match => [match[2], match[3]]))
      .toEqual([[GUARD_TARGET, last(GUARD_TARGET).after], [EMPTY_TARGET, last(EMPTY_TARGET).after]]);
    // The guard's anchor is this migration's clause; the emptying's is the
    // account-level statement this migration kept, and its own block stays.
    expect(count(d152, last(GUARD_TARGET).next)).toBe(1);
    expect(d152).toContain("$old$ update public.generated_exports set status='revoked'\n"
      + "  where status in ('queued','building') and target_kind='account' and target_id=p_account_id;\n$old$");
    expect(d152).not.toContain("-- 20261120100000 (D-144): every export of the record ends with it.");
    // The cleanup door it calls has never been restated since 20260923123240.
    expect(files.filter(file => file !== "20260923123240_export_archive_persistence.sql"
      && /function\s+public\.export_archive_cleanup_v1\s*\(/iu.test(read(`supabase/migrations/${file}`)))).toEqual([]);
  });
});

describe("the predecessor block, the patches and the postflight", () => {
  const preflight = between(migration, "do $predecessor$", "$predecessor$;");
  const postflight = between(migration, "do $postflight$", "$postflight$;");

  it("pins every body it patches or calls to the md5 recomputed from its source, and to its ACL", () => {
    expect(md5(EMPTY_SELF)).toBe("85a9ab8159fa7e5bfb18deada62c1215");
    expect(md5(FILE_GUARD)).toBe("e9f3f4692f0c6d10f6827410db8a0102");
    expect(md5(READINESS)).toBe("81917a7dcc51887ab4cb06735cfca1a1");
    expect(md5(CLEANUP)).toBe("25fa3ce71b73fb0c371d1bb9af836bd7");
    for (const [signature, hash] of [[EMPTY_TARGET, md5(EMPTY_SELF)], [GUARD_TARGET, md5(FILE_GUARD)]]) {
      expect(preflight).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${hash}' and p.proacl::text='{postgres=X/postgres}')`);
    }
    for (const [signature, hash] of [[READY_TARGET, md5(READINESS)], ["public.export_archive_cleanup_v1(text,uuid,uuid,jsonb)", md5(CLEANUP)]]) {
      expect(preflight).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${hash}'\n`
        + "   and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')");
    }
    expect(preflight).toContain("raise exception using errcode='55000',message='self withdrawal export prerequisite differs'");
    // The same bodies 20261119150000 pinned at its time: this patch starts from them.
    const earlier = read("supabase/migrations/20261119150000_own_upload_consent_withdrawal.sql");
    expect(earlier).toContain(`md5(pg_get_functiondef(p.oid))='${md5(EMPTY_SELF)}'`);
    expect(earlier).toContain(`md5(pg_get_functiondef(p.oid))='${md5(FILE_GUARD)}'`);
  });

  it("replays each patch on the rebuilt body, one anchor each, to exactly the successor the migration asserts", () => {
    replay(EMPTY_SELF, EMPTY_TARGET);
    replay(FILE_GUARD, GUARD_TARGET);
    replay(READINESS, READY_TARGET);
    const loop = between(migration, "do $patch_d144$", "$patch_d144$;");
    expect(loop).toContain("where p.oid=item.target::regprocedure and md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;");
    expect(loop).toContain("(length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1");
    expect(loop).toContain("and p.proacl is not distinct from before_acl) then");
  });

  it("asserts the final successors, the read still stable, and the cleanup door unchanged", () => {
    const last = (target: string) => patches.filter(patch => patch.target === target).at(-1)!.after;
    expect(postflight).toContain(`'${EMPTY_TARGET}'::regprocedure\n   and md5(pg_get_functiondef(p.oid))='${last(EMPTY_TARGET)}'`);
    expect(postflight).toContain(`'${GUARD_TARGET}'::regprocedure\n   and md5(pg_get_functiondef(p.oid))='${last(GUARD_TARGET)}'`);
    expect(postflight).toContain(`'${READY_TARGET}'::regprocedure\n   and md5(pg_get_functiondef(p.oid))='${last(READY_TARGET)}' and p.prosecdef and p.provolatile='s'`);
    expect(postflight).toContain(`md5(pg_get_functiondef(p.oid))='${md5(CLEANUP)}'`);
    expect(postflight).toContain("raise exception using errcode='55000',message='self withdrawal export successor differs'");
  });
});

describe("what the patched bodies do", () => {
  const emptying = apply(EMPTY_SELF, EMPTY_TARGET);
  const guard = apply(FILE_GUARD, GUARD_TARGET);
  const readiness = apply(READINESS, READY_TARGET);
  const condition = (text: string, message: string) => {
    const end = text.indexOf(message);
    expect(end, message).toBeGreaterThan(0);
    const start = text.lastIndexOf(" if exists(", end);
    return text.slice(start, text.lastIndexOf(" then", end));
  };
  const HELD_ATTEMPT = "state in ('writing','bytes_complete')";

  it("drops only the export cause from the refusal: a foreign file and an embryo-tied file still refuse", () => {
    const refused = condition(emptying, "message='subject_delete_unsupported_graph'");
    expect(refused).not.toContain("generated_exports");
    expect(refused).toContain("(f.user_id<>p_account_id or f.cohort_id is not null)");
    expect(refused).toContain("public.embryo_variants v where v.source_file_id=any(v_files)");
    expect(condition(EMPTY_SELF, "message='subject_delete_unsupported_graph'"))
      .toBe(refused.replace("\n  or exists(select 1 from public.embryo_variants",
        "\n  or exists(select 1 from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id)\n"
        + "  or exists(select 1 from public.embryo_variants"));
  });

  it("ends every export of the record before the files, through the cleanup door's stop, then revokes it", () => {
    const block = between(emptying, "-- 20261120100000 (D-144): every export of the record ends with it.", "\n\n");
    const order = ["v_exports:=array(select e.id from public.generated_exports e where e.target_kind='subject' and e.target_id=s.id order by e.id);",
      "perform 1 from public.generated_exports where id=any(v_exports) order by id for update;",
      `where a.export_id=any(v_exports) and a.${HELD_ATTEMPT} order by a.export_id,a.id loop`,
      "perform public.export_archive_cleanup_v1('stop',v_attempt.export_id,v_attempt.id,null);",
      "update public.generated_exports set status='revoked' where id=any(v_exports) and status<>'revoked';",
      "update public.download_sessions set status='revoked',ended_at=v_now,session_revision=session_revision+1\n"
      + "  where status='active' and target_kind='export' and target_id=any(v_exports);"];
    const at = order.map(fragment => block.indexOf(fragment));
    expect(at.every(index => index >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(emptying.indexOf("export_archive_cleanup_v1('stop'")).toBeLessThan(emptying.indexOf("foreach v_file in array v_files loop"));
    // Exports are ended, never deleted: their rows, segments and reservations stay.
    expect(emptying).not.toMatch(/delete from (?:public\.generated_exports|private\.export_archive|private\.account_archive)/u);
    // The stop is the very transition the cleanup sweep makes before disposal.
    expect(CLEANUP).toContain("update private.export_archive_attempts set state='cleanup_pending'");
    expect(CLEANUP).toContain("update private.export_archive_downloads set revoked_at=coalesce(revoked_at,clock_timestamp()) where attempt_id=a.id;");
    expect(read("src/lib/exports/account-archive-test-disposal.ts")).toContain("public.export_archive_cleanup_v1('stop',");
    // The audit event and its payload are unchanged.
    expect(between(emptying, "perform private.append_legal_audit_event('subject.emptied'", ";"))
      .toBe(between(EMPTY_SELF, "perform private.append_legal_audit_event('subject.emptied'", ";"));
  });

  it("lets every export block a single file unless the emptying has retired it", () => {
    // This migration's own clause. 20261122130000 (D-152) replaces it with the
    // live-copy clause; scripts/file-delete-live-exports-migration.test.ts holds that.
    const marker = "\n    -- 20261120100000 (D-144)";
    const clause = between(guard, marker, "\n    or exists (select 1 from public.report_artifacts");
    expect(clause).toContain("and (e.status<>'revoked' or exists (select 1 from private.export_archive_attempts a\n"
      + `        where a.export_id=e.id and a.${HELD_ATTEMPT})))`);
    // Nothing else of the guard changes.
    expect(guard.replace(marker + clause,
      () => "\n    or exists (select 1 from public.generated_exports where target_kind='subject' and target_id=s.id)")).toBe(FILE_GUARD);
  });

  it("is narrower than before only on an emptied record: no other migration revokes an export of a self record", () => {
    // Every statement that revokes generated_exports rows, by file. Each other
    // one is scoped away from a self record's subject export: an account
    // target, a claimed record's claimant, an adult record being transferred.
    const revokers = Object.fromEntries(files.map(file => [file,
      [...read(`supabase/migrations/${file}`).matchAll(/update public\.generated_exports(?: e)? set status='revoked'[^;]*;/gu)]
        .map(match => match[0].replace(/\s+/gu, " "))]).filter(([, statements]) => statements.length > 0));
    expect(revokers).toEqual({
      "20260930245000_future_person_claimant_erasure.sql": ["update public.generated_exports e set status='revoked' where e.target_kind='subject' and e.target_id=s.id and e.status in('queued','building');"],
      "20261001018000_future_person_documentary_recovery.sql": [expect.stringMatching(/^update public\.generated_exports set status='revoked' where requester_principal_id=sp\.id/u)],
      "20261016181000_subject_delete.sql": ["update public.generated_exports set status='revoked' where status in ('queued','building') and target_kind='account' and target_id=p_account_id;"],
      "20261016221000_subject_transfer.sql": ["update public.generated_exports set status='revoked' where id=any(v_exports);",
        "update public.generated_exports set status='revoked' where status in ('queued','building') and target_kind='account' and target_id=v_uploader;"],
      // The account-level statement twice: the anchor of patch 3, in its old and its new fragment.
      [NAME]: [...Array(2).fill("update public.generated_exports set status='revoked' where status in ('queued','building') and target_kind='account' and target_id=p_account_id;"),
        "update public.generated_exports set status='revoked' where id=any(v_exports) and status<>'revoked';"],
      // 2026-11-22 (D-152): the account-level statement as its anchor and kept
      // in its new fragment, and the revocation of the account's whole-account
      // copies that include the record (v_exports is selected there with
      // target_kind='account', held by scripts/file-delete-live-exports-migration.test.ts).
      [D152]: ["update public.generated_exports set status='revoked' where status in ('queued','building') and target_kind='account' and target_id=p_account_id;",
        "update public.generated_exports set status='revoked' where id=any(v_exports) and status<>'revoked';",
        "update public.generated_exports set status='revoked' where status in ('queued','building') and target_kind='account' and target_id=p_account_id;"],
    });
    expect(read(`supabase/migrations/${D152}`)).toContain("v_exports:=array(select e.id from public.generated_exports e where e.target_kind='account' and e.target_id=p_account_id\n");
    // The claimant erasure's record is a claimed one, and the transfer's an adult record.
    expect(read("supabase/migrations/20260930245000_future_person_claimant_erasure.sql")).toContain("claimed");
    expect(read("supabase/migrations/20261016221000_subject_transfer.sql"))
      .toMatch(/s\.subject_class<>'other_adult'|subject_class='other_adult'|subject_class is distinct from 'other_adult'/u);
  });

  it("reads unsupported on exactly the patched emptying's refusal, and processing as before", () => {
    expect(condition(readiness, "return 'unsupported'")).toBe(condition(emptying, "message='subject_delete_unsupported_graph'"));
    expect(condition(readiness, "return 'processing'")).toBe(condition(READINESS, "return 'processing'"));
    expect(readiness).toContain(" RETURNS text\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n");
    expect(readiness).not.toMatch(/\b(?:insert|update|delete)\s/iu);
  });
});

describe("its tests and its notes", () => {
  it("is driven by its pgTAP suite through every kind of export, the refusals, the guard and the read", () => {
    for (const fragment of ["pg_temp.make_export('ready','ready')", "pg_temp.make_export('building','reserved')",
      "pg_temp.make_export('queued','queued')", "pg_temp.age('expired')", "set status='revoked' where id=pg_temp.export_id('revoked')",
      "\\gset", ":'door_state'::jsonb", "'subject_delete_unsupported_graph'", "'file_delete_shared_graph'",
      "public.finish_genome_file_deletion_v1(", "'upload-consent-withdrawn'", "'subject.emptied'",
      "private.claim_account_archive_r2_disposal_v1(", "private.complete_account_archive_r2_write_v1(",
      ...[READY_TARGET].map(target => `'${patches.filter(patch => patch.target === target).at(-1)!.after}'`),
      `'${md5(CLEANUP)}'`]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    // 2026-11-22 (D-152): the suite pins the per-file guard and the self
    // emptying at 20261122130000's successors, which patch exactly this
    // migration's successors (held by the "last word" test above), and names
    // those predecessors; so does the own-upload withdrawal suite for the emptying.
    const d152After = Object.fromEntries([...read(`supabase/migrations/${D152}`)
      .matchAll(/\((\d+),'([^']+)','[0-9a-f]{32}',\s*'([0-9a-f]{32})',/gu)].map(match => [match[2], match[3]]));
    expect(Object.keys(d152After)).toEqual([GUARD_TARGET, EMPTY_TARGET]);
    expect(pgtap).toContain(`'${EMPTY_TARGET}'::regprocedure))),'${d152After[EMPTY_TARGET]}'`);
    // 2026-11-22 (D-152 follow-up): the guard is pinned at 20261122150000's
    // successor, which patches exactly 20261122130000's (named in a comment).
    const followUpAfter = [...read("supabase/migrations/20261122150000_file_delete_live_account_copies.sql")
      .matchAll(/\(1,'[^']+','([0-9a-f]{32})',\s*'([0-9a-f]{32})',/gu)].map(match => [match[1], match[2]]);
    expect(followUpAfter).toEqual([[d152After[GUARD_TARGET], expect.stringMatching(/^[0-9a-f]{32}$/u)]]);
    expect(pgtap).toContain(`'${GUARD_TARGET}'::regprocedure))),'${followUpAfter[0]![1]}'`);
    expect(pgtap).toContain(d152After[GUARD_TARGET]!);
    for (const target of [GUARD_TARGET, EMPTY_TARGET]) {
      expect(pgtap, target).toContain(patches.filter(patch => patch.target === target).at(-1)!.after);
    }
    expect(pgtap.startsWith("begin;\n")).toBe(true);
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
    const ownWithdrawal = read("supabase/tests/own_upload_consent_withdrawal.sql");
    expect(ownWithdrawal).toContain(`'${d152After[EMPTY_TARGET]}'`);
    expect(ownWithdrawal).toContain(patches.filter(patch => patch.target === EMPTY_TARGET).at(-1)!.after);
  });

  it("is in the release notes of the guarded release it joins", () => {
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });
});
