import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The record transfer is switched on (20261122120000_subject_transfer_open.sql;
 * owner decision of 22 November 2026, "The transfer notices are approved,
 * with one added line, and the transfer is switched on"). The migration
 * replaces exactly one body, private.subject_transfer_open_v1(), the one
 * switch of both acts, from the closed body 20261016221000 made to one that
 * answers true, and refuses unless every body the open transfer runs is the
 * one reviewed. pg_get_functiondef keeps a body verbatim, so each body the
 * migration pins is rebuilt here from the migration that last defined it
 * (replaying 20261122100000's patches where it patched one) and its md5
 * recomputed; a body patched by several migrations is traced to the md5 the
 * migration that last wrote it asserts. The pgTAP suite
 * (supabase/tests/subject_transfer_open.sql) drives both acts against a real
 * database with the switch as this migration leaves it.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122120000_subject_transfer_open.sql";
const migration = read(`supabase/migrations/${NAME}`);
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
const pgtap = read("supabase/tests/subject_transfer_open.sql");

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
  const close = source.indexOf(`${open[1]};`, bodyStart);
  return `${header}AS $function$${source.slice(bodyStart, close)}$function$\n`;
}
const header = (signature: string, returns: string, rest = " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n") =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n${rest}`;
function apply(text: string, old: string, next: string): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}

const TRANSFER_SOURCE = read("supabase/migrations/20261016221000_subject_transfer.sql");
const WITHDRAWAL_SOURCE = read("supabase/migrations/20261119160000_other_adult_upload_consent_withdrawal.sql");
const HAND_OVER = "20261122100000_uploader_withdrawal_hands_record_to_adult.sql";
const HAND_OVER_SOURCE = read(`supabase/migrations/${HAND_OVER}`);
const SWITCH_HEADER = header("private.subject_transfer_open_v1()", "boolean", " LANGUAGE sql\n IMMUTABLE\n SET search_path TO ''\n");
const SWITCH_BEFORE = definition(TRANSFER_SOURCE, "create function private.subject_transfer_open_v1(", SWITCH_HEADER);
const SWITCH_AFTER = definition(migration, "create or replace function private.subject_transfer_open_v1(", SWITCH_HEADER);
const transferSignature = (schema: string) => `${schema}.transfer_subject_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, `
  + "p_nonce_hash text, p_nonce_expires_at timestamp with time zone)";
const DOOR = definition(TRANSFER_SOURCE, "create function public.transfer_subject_v1(", header(transferSignature("public"), "jsonb"));

/** 20261122100000's md5-guarded patches, replayed on the bodies they patch. */
const handOverPatches = [...between(HAND_OVER_SOURCE, "do $patch_handover$", "$patch_handover$;")
  .matchAll(/\((\d+),'([^']+)','([0-9a-f]{32})',\n {3}'([0-9a-f]{32})','(\{[^}]+\})',\n {3}\$old\$([\s\S]*?)\$old\$,\n {3}\$new\$([\s\S]*?)\$new\$/gu)]
  .map(match => ({ target: match[2]!, before: match[3]!, after: match[4]!, old: match[6]!, next: match[7]! }));
function patched(target: string, base: string): string {
  return handOverPatches.filter(patch => patch.target === target).reduce((text, patch) => {
    expect(md5(text), `${target} before`).toBe(patch.before);
    const next = apply(text, patch.old, patch.next);
    expect(md5(next), `${target} after`).toBe(patch.after);
    return next;
  }, base);
}
const TRANSFER = patched("private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)",
  definition(TRANSFER_SOURCE, "create function private.transfer_subject_v1(", header(transferSignature("private"), "jsonb")));
const WITHDRAW = patched("public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)",
  definition(WITHDRAWAL_SOURCE, "create function public.withdraw_other_adult_upload_v1(",
    header("public.withdraw_other_adult_upload_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_nonce_hash text, "
      + "p_nonce_expires_at timestamp with time zone)", "jsonb")));
const READINESS = patched("public.other_adult_withdrawal_readiness_v1(uuid,uuid)",
  definition(WITHDRAWAL_SOURCE, "create function public.other_adult_withdrawal_readiness_v1(",
    header("public.other_adult_withdrawal_readiness_v1(p_account_id uuid, p_subject_id uuid)", "text",
      " LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n")));
const QUEUE = definition(HAND_OVER_SOURCE, "create function private.queue_subject_transfer_notices_v1(",
  header("private.queue_subject_transfer_notices_v1(p_transfer_id uuid, p_withdrawal boolean, p_grants uuid[], p_relationships uuid[])",
    "integer"));
const CLEANUP = definition(read("supabase/migrations/20260923123240_export_archive_persistence.sql"),
  "create function public.export_archive_cleanup_v1(",
  header("public.export_archive_cleanup_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_payload jsonb DEFAULT NULL::jsonb)",
    "jsonb", " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n"));
const HELD_END = definition(read("supabase/migrations/20260928150000_other_adult_held_upload.sql"),
  "create function private.end_other_adult_held_upload_v1(",
  header("private.end_other_adult_held_upload_v1(p_revision_id uuid, p_state text)", "boolean",
    " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n"));
/** The relocation worker's six service doors, as 20261016221000 made them. */
const RELOCATION: [string, string, string][] = [
  ["subject_transfer_relocation_work_v1", "p_test_jurisdiction boolean", "jsonb"],
  ["claim_subject_transfer_relocation_v1", "p_relocation_id uuid, p_token_hash text, p_test_jurisdiction boolean", "jsonb"],
  ["swap_subject_transfer_relocation_v1", "p_attempt_id uuid, p_token_hash text, p_new_object_id uuid, p_byte_count bigint, "
    + "p_sha256 text, p_test_jurisdiction boolean", "boolean"],
  ["fence_subject_transfer_relocation_v1", "p_attempt_id uuid, p_token_hash text, p_test_jurisdiction boolean", "boolean"],
  ["claim_subject_transfer_retirement_v1", "p_relocation_id uuid, p_token_hash text, p_test_jurisdiction boolean", "jsonb"],
  ["finish_subject_transfer_retirement_v1", "p_relocation_id uuid, p_token_hash text, p_test_jurisdiction boolean", "boolean"],
];
/** The notice kinds as 20261122100000 widened them, as pg_get_constraintdef prints them. */
const KINDS = ["invitation-refused", "draft-cancelled", "donor-attribution-ended", "upload-permission-withdrawn",
  "adult-acceptance-second-notice", "adult-revocation-renotice", "subject-transfer-new-owner", "subject-transfer-former-owner",
  "subject-transfer-access-revoked", "withdrawal-transfer-new-owner", "withdrawal-transfer-former-owner"];
const KIND_CHECK = `CHECK ((notice_kind = ANY (ARRAY[${KINDS.map(kind => `'${kind}'::text`).join(", ")}])))`;

const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const postflight = between(migration, "do $postflight$", "$postflight$;");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pinnedBySignature = (block: string, signature: string, body: string, acl: string) =>
  expect(block, signature).toMatch(new RegExp(`'${escape(signature)}'(?:\\)|::regprocedure)\\n\\s+and md5\\(pg_get_functiondef\\(p\\.oid\\)\\)='${
    md5(body)}'(?:\\s+and p\\.proacl::text='${escape(acl)}')`, "u"));

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose bodies it replaces or pins", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260906053451", "20260923123240", "20260928150000", "20261016221000", "20261119160000",
      "20261120120000", "20261120130000", "20261122100000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(files.filter(file => file.startsWith("20261122120000_"))).toEqual([NAME]);
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(`# Release notes: \`${NAME}\``);
  });

  it("replaces one body, the switch, and nothing else: no table, check, trigger, grant or other function", () => {
    expect([...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1]))
      .toEqual(["private.subject_transfer_open_v1"]);
    expect(migration).not.toMatch(/^\s*(alter|drop|create)\s+(table|index|trigger|policy|type|view|schema)\b/gimu);
    expect(migration).not.toMatch(/^\s*(grant|revoke|insert|update|delete)\b/gimu);
    expect(migration).not.toContain("replace(definition");
    expect(migration).not.toContain("set_config(");
    // The only migrations that ever define the switch: the one that built it closed, and this one.
    expect(files.filter(file => /create\s+(?:or\s+replace\s+)?function\s+private\.subject_transfer_open_v1\s*\(/iu
      .test(read(`supabase/migrations/${file}`)))).toEqual(["20261016221000_subject_transfer.sql", NAME]);
  });
});

describe("the switch", () => {
  it("starts from exactly the closed body 20261016221000 made, recomputed from source", () => {
    expect(SWITCH_BEFORE).toBe(`${SWITCH_HEADER}AS $function$ select false $function$\n`);
    expect(md5(SWITCH_BEFORE)).toBe("c4b160e966711cf513e267673c4b5e2f");
    expect(preflight).toContain(`p.oid=to_regprocedure('private.subject_transfer_open_v1()')\n`
      + `   and md5(pg_get_functiondef(p.oid))='${md5(SWITCH_BEFORE)}' and p.proacl::text='{postgres=X/postgres}'\n`
      + "   and p.provolatile='i' and not p.prosecdef and p.proconfig=array['search_path=\"\"']::text[])");
    // ... and it must still answer false: anything else refuses the whole migration.
    expect(preflight).toContain("\n  or private.subject_transfer_open_v1()\n");
  });

  it("ends as one immutable body answering true, its ACL, volatility and search_path kept", () => {
    expect(SWITCH_AFTER).toBe(`${SWITCH_HEADER}AS $function$ select true $function$\n`);
    expect(md5(SWITCH_AFTER)).toBe("8d2e22d1e0c41c8bce0e43b9e45378d3");
    expect(migration).toContain("create or replace function private.subject_transfer_open_v1()\n"
      + "returns boolean language sql immutable set search_path='' as $$ select true $$;");
    expect(postflight).toContain(`p.oid='private.subject_transfer_open_v1()'::regprocedure\n`
      + `   and md5(pg_get_functiondef(p.oid))='${md5(SWITCH_AFTER)}' and p.proacl::text='{postgres=X/postgres}'\n`
      + "   and p.provolatile='i' and not p.prosecdef and p.proconfig=array['search_path=\"\"']::text[])");
    expect(postflight).toContain("\n  or private.subject_transfer_open_v1() is not true\n");
  });

  it("refuses loudly before anything changes, and checks its work after", () => {
    expect(migration.indexOf("do $predecessor$")).toBeLessThan(migration.indexOf("create or replace function"));
    expect(migration.indexOf("create or replace function")).toBeLessThan(migration.indexOf("do $postflight$"));
    expect(count(preflight, "raise exception using errcode='55000',message='subject transfer open prerequisite differs'")).toBe(1);
    expect(count(postflight, "raise exception using errcode='55000',message='subject transfer open successor differs'")).toBe(1);
  });

  it("is read by exactly the two doors and the page's read it opens", () => {
    for (const [name, body] of [["public.transfer_subject_v1", DOOR], ["public.withdraw_other_adult_upload_v1", WITHDRAW],
      ["public.other_adult_withdrawal_readiness_v1", READINESS]] as const) {
      const code = body.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");
      expect(count(code, "private.subject_transfer_open_v1()"), name).toBe(1);
    }
    expect(DOOR).toContain(" if not private.subject_transfer_open_v1() then\n  raise exception using errcode='42501',message='not_found'; end if;\n"
      + " return private.transfer_subject_v1(");
    expect(WITHDRAW).toContain("  if not private.subject_transfer_open_v1() then\n"
      + "   raise exception using errcode='42501',message='other_adult_withdrawal_account_held'; end if;");
    expect(READINESS).toContain("return case when private.subject_transfer_open_v1() then 'hand-over' else 'account-held' end;");
    expect(TRANSFER).not.toContain("subject_transfer_open_v1");
    expect(QUEUE).not.toContain("subject_transfer_open_v1");
  });
});

describe("the bodies the open transfer runs, pinned before and after", () => {
  it("pins each one rebuilt from source to its recomputed md5 and its ACL", () => {
    const pins: [string, string, string][] = [
      ["public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)", DOOR, "{postgres=X/postgres,service_role=X/postgres}"],
      ["public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)", WITHDRAW, "{postgres=X/postgres,service_role=X/postgres}"],
      ["public.other_adult_withdrawal_readiness_v1(uuid,uuid)", READINESS, "{postgres=X/postgres,service_role=X/postgres}"],
      ["private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)", TRANSFER, "{postgres=X/postgres}"],
      ["private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[])", QUEUE, "{postgres=X/postgres}"],
      ["private.end_other_adult_held_upload_v1(uuid,text)", HELD_END, "{postgres=X/postgres}"],
    ];
    for (const [signature, body, acl] of pins) pinnedBySignature(preflight, signature, body, acl);
    // The transfer, its doors and its queue must be unchanged after, too.
    for (const [signature, body, acl] of pins.slice(0, 5)) pinnedBySignature(postflight, signature, body, acl);
    // They are exactly what 20261122100000 left (its postflight, or the new function it made).
    for (const body of [DOOR, WITHDRAW, READINESS, TRANSFER]) expect(HAND_OVER_SOURCE).toContain(md5(body));
    expect(md5(TRANSFER)).toBe("e481de5f5eab53b6c596da66bc7b30fa");
    expect(md5(QUEUE)).toBe("341a5dcd5f5d4dd8592efe4d4cc487eb");
    // Pinned by name, never by quoted signature: the cleanup door as 20260923123240 left it.
    expect(md5(CLEANUP)).toBe("25fa3ce71b73fb0c371d1bb9af836bd7");
    expect(preflight).toContain("p.pronamespace='public'::regnamespace and p.proname='export_archive_cleanup_v1'\n"
      + `   and md5(pg_get_functiondef(p.oid))='${md5(CLEANUP)}'`);
  });

  it("pins the relocation worker's six doors to the md5s recomputed from 20261016221000", () => {
    for (const [name, args, returns] of RELOCATION) {
      const body = definition(TRANSFER_SOURCE, `create function public.${name}(`, header(`public.${name}(${args})`, returns));
      expect(preflight, name).toContain(`('${name}','${md5(body)}')`);
      // Defined once, and never restated or patched since.
      expect(files.filter(file => read(`supabase/migrations/${file}`).includes(`function public.${name}(`)), name)
        .toEqual(["20261016221000_subject_transfer.sql"]);
    }
    expect(preflight).toContain(")<>6 then");
  });

  it("pins the notice kinds to the check 20261122100000 widened, recomputed from its kinds", () => {
    expect(md5(KIND_CHECK)).toBe("13f8b2c8222dfff225325f6b0bb152c5");
    expect(preflight).toContain(`and c.contype='c' and c.convalidated) is distinct from '${md5(KIND_CHECK)}'`);
    expect(HAND_OVER_SOURCE.replace(/'\n {3}\|\|'/gu, "").replace(/''/gu, "'")).toContain(KIND_CHECK);
  });

  it("pins each body several migrations wrote to the md5 the migration that last wrote it asserts", () => {
    const traced: [string, string, string][] = [
      ["private.enqueue_invitation_terminal_notice_v1", "689008df933e852391c20f6e8b3afd4a",
        "20261119160000_other_adult_upload_consent_withdrawal.sql"],
      ["private.invitation_notice_recipient_current_v1", "e0728613189f2cbdfa05029c962767a5",
        "20261119160000_other_adult_upload_consent_withdrawal.sql"],
      ["public.claim_invitation_terminal_mail_v1", "3524eba4d0dd916bef2c4dac1e5c25cb", "20261120120000_adult_acceptance_hold_and_renotice.sql"],
      ["public.authorize_invitation_terminal_mail_v1", "5ba9fd2ef4bfa2c36ec0e2be4b97aeb5", "20261120120000_adult_acceptance_hold_and_renotice.sql"],
      ["private.delete_pair_derived_rows_v1", "8a094ce1d0a7ff92e00260204008dc07", "20261120130000_subject_copilot_scope.sql"],
      ["private.legal_audit_actor_principal_v1", "7d74f4fc739c03a14c928b5c529ca83a", HAND_OVER],
    ];
    // The detector every earlier migration test uses for "restates or patches".
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    for (const [qualified, digest, source] of traced) {
      const local = qualified.slice(qualified.indexOf(".") + 1);
      expect(preflight, qualified).toMatch(new RegExp(`proname='${local}'[\\s\\S]{0,120}md5\\(pg_get_functiondef\\(p\\.oid\\)\\)='${digest}'|`
        + `to_regprocedure\\('${escape(qualified)}\\([^)]*\\)'\\)\\n\\s+and md5\\(pg_get_functiondef\\(p\\.oid\\)\\)='${digest}'`, "u"));
      expect(read(`supabase/migrations/${source}`), `${qualified} in ${source}`).toContain(digest);
      // No migration since that one writes the body again.
      expect(files.filter(file => file > source && file < NAME && rewrites(file, qualified)), qualified).toEqual([]);
    }
  });
});

describe("the app and the tests around it", () => {
  it("sends the two emails to the person who now holds the record with the owner's added line", () => {
    const copy = read("src/copy/upload/subject-transfer-notices.ts");
    const line = "Any download copy of this record has stopped working. You can make a new one.";
    expect(count(copy, line)).toBe(2);
    expect(copy).not.toContain("NOT APPROVED");
    expect(copy).toContain("APPROVED by the owner on 22 November 2026");
  });

  it("is driven by a pgTAP suite that reads the switch as this migration leaves it, and never opens it itself", () => {
    expect(pgtap.startsWith("-- The record transfer, switched on (migration 20261122120000_subject_transfer_open;")).toBe(true);
    expect(pgtap).toMatch(/\nbegin;\n/u);
    expect(pgtap.trimEnd().endsWith("select * from finish();\nrollback;")).toBe(true);
    expect(pgtap).not.toMatch(/create\s+or\s+replace\s+function\s+private\.subject_transfer_open_v1/iu);
    expect(pgtap).toContain(`md5(pg_get_functiondef(p.oid))='${md5(SWITCH_AFTER)}'`);
    for (const fragment of ["public.transfer_subject_v1(pg_temp.a('2')", "public.withdraw_other_adult_upload_v1(pg_temp.a('1')",
      "'subject-transfer-new-owner 02'", "'subject-transfer-former-owner 01'", "'subject-transfer-access-revoked 04'",
      "'withdrawal-transfer-new-owner 02'", "'withdrawal-transfer-former-owner 01'", "'subject-transfer-access-revoked 09'",
      "pg_temp.all_transfer_notices()", "private.export_archive_current_v1(", "'stopped 42501 not_found'", "pg_temp.prior_grants_live(",
      "pg_temp.uploader_reads('main'),0::bigint", "'hand-over'", "public.claim_invitation_terminal_mail_v1()",
      "public.authorize_invitation_terminal_mail_v1("]) {
      expect(pgtap, fragment).toContain(fragment);
    }
  });

  it("marks every register statement it amends", () => {
    const register = read("docs/route-register.json");
    expect(count(register, "registered-2026-11-22-transfer-open")).toBeGreaterThanOrEqual(3);
    expect(register).not.toMatch(/while-the-transfer-is-closed-until-its-three-notices-are-worded-and-approved/u);
  });
});
