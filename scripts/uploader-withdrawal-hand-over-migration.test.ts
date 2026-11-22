import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The uploader's withdrawal hands a record its adult holds to that adult
 * (20261122100000_uploader_withdrawal_hands_record_to_adult.sql; owner
 * decision of 22 November 2026, "An uploader's withdrawal hands a record its
 * adult holds to that adult"). The migration adds the uploader's withdrawal
 * as a second act of the existing transfer, behind the transfer's one switch,
 * and fixes D-147 and D-151 in the transfer. It patches three bodies in place
 * under the md5-guarded convention. pg_get_functiondef keeps a body verbatim,
 * so each pinned body is rebuilt here from the migration that last defined
 * it, every md5 the migration names (predecessor and successor) is
 * recomputed, and each patch is replayed. The pgTAP suite
 * (supabase/tests/uploader_withdrawal_hand_over.sql) drives the closed and
 * the opened switch against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122100000_uploader_withdrawal_hands_record_to_adult.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/uploader_withdrawal_hand_over.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();

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

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string }
/** The md5-guarded patches of this migration, in order. */
function patchesOf(source: string): Patch[] {
  return [...source.matchAll(/\((\d+),'([^']+)','([0-9a-f]{32})',\n {3}'([0-9a-f]{32})','(\{[^}]+\})',\n {3}\$old\$([\s\S]*?)\$old\$,\n {3}\$new\$([\s\S]*?)\$new\$/gu)]
    .map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
      old: match[6]!, next: match[7]! }));
}
function apply(text: string, old: string, next: string): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}

const TRANSFER_SOURCE = read("supabase/migrations/20261016221000_subject_transfer.sql");
const WITHDRAWAL_SOURCE = read("supabase/migrations/20261119160000_other_adult_upload_consent_withdrawal.sql");
const TRANSFER = definition(TRANSFER_SOURCE, "create function private.transfer_subject_v1(",
  header("private.transfer_subject_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_nonce_hash text, "
    + "p_nonce_expires_at timestamp with time zone)", "jsonb"));
const DOOR = definition(TRANSFER_SOURCE, "create function public.transfer_subject_v1(",
  header("public.transfer_subject_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_nonce_hash text, "
    + "p_nonce_expires_at timestamp with time zone)", "jsonb"));
const SWITCH = definition(TRANSFER_SOURCE, "create function private.subject_transfer_open_v1(",
  header("private.subject_transfer_open_v1()", "boolean", " LANGUAGE sql\n IMMUTABLE\n SET search_path TO ''\n"));
const WITHDRAW = definition(WITHDRAWAL_SOURCE, "create function public.withdraw_other_adult_upload_v1(",
  header("public.withdraw_other_adult_upload_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_nonce_hash text, "
    + "p_nonce_expires_at timestamp with time zone)", "jsonb"));
const READINESS = definition(WITHDRAWAL_SOURCE, "create function public.other_adult_withdrawal_readiness_v1(",
  header("public.other_adult_withdrawal_readiness_v1(p_account_id uuid, p_subject_id uuid)", "text",
    " LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n"));
const CLEANUP = definition(read("supabase/migrations/20260923123240_export_archive_persistence.sql"),
  "create function public.export_archive_cleanup_v1(",
  header("public.export_archive_cleanup_v1(p_operation text, p_export_id uuid, p_attempt_id uuid, p_payload jsonb DEFAULT NULL::jsonb)",
    "jsonb", " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n"));
const HELD_END = definition(read("supabase/migrations/20260928150000_other_adult_held_upload.sql"),
  "create function private.end_other_adult_held_upload_v1(",
  header("private.end_other_adult_held_upload_v1(p_revision_id uuid, p_state text)", "boolean",
    " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n"));
/** The notice kinds as 20261120120000 left them, as pg_get_constraintdef prints them. */
const kindCheck = (kinds: string[]) => `CHECK ((notice_kind = ANY (ARRAY[${kinds.map(kind => `'${kind}'::text`).join(", ")}])))`;
const KINDS_BEFORE = ["invitation-refused", "draft-cancelled", "donor-attribution-ended", "upload-permission-withdrawn",
  "adult-acceptance-second-notice", "adult-revocation-renotice"];
const TRANSFER_KINDS = ["subject-transfer-new-owner", "subject-transfer-former-owner", "subject-transfer-access-revoked",
  "withdrawal-transfer-new-owner", "withdrawal-transfer-former-owner"];

const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const postflight = between(migration, "do $postflight$", "$postflight$;");
const patchBlock = between(migration, "do $patch_handover$", "$patch_handover$;");
const patches = patchesOf(patchBlock);
const queue = between(migration, "create function private.queue_subject_transfer_notices_v1(", "end $$;");
const transferAfter = patches.filter(patch => patch.target.startsWith("private.transfer_subject_v1"))
  .reduce((text, patch) => apply(text, patch.old, patch.next), TRANSFER);
const withdrawAfter = apply(WITHDRAW, patches[8]!.old, patches[8]!.next);
const readinessAfter = apply(READINESS, patches[9]!.old, patches[9]!.next);

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose objects it calls, pins or patches", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260906053451", "20260923123240", "20260928150000", "20261016221000", "20261119160000",
      "20261120100000", "20261120120000", "20261120130000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(files.filter(file => file.startsWith("20261122100000_"))).toEqual([NAME]);
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });

  it("creates one function, widens one check and patches three bodies, and nothing else", () => {
    expect([...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1]))
      .toEqual(["private.queue_subject_transfer_notices_v1"]);
    expect([...migration.matchAll(/^\s*(alter|drop|create)\s+(table|index|trigger|policy|type)\b[^\n]*/gimu)].map(match => match[0]))
      .toEqual(["alter table private.invitation_terminal_notices drop constraint invitation_terminal_notices_notice_kind_check;",
        "alter table private.invitation_terminal_notices add constraint invitation_terminal_notices_notice_kind_check"]);
    expect(patches.map(patch => `${patch.ordinal} ${patch.target}`)).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(ordinal => `${ordinal} private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)`),
      "9 public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)",
      "10 public.other_adult_withdrawal_readiness_v1(uuid,uuid)"]);
    expect(migration).not.toMatch(/\b(grant|revoke)\b[^;]*\bon (table|schema)\b/iu);
    expect([...migration.matchAll(/^(grant|revoke)[^;]*;/gmu)].map(match => match[0].replace(/\s+/gu, " ")))
      .toEqual(["revoke all on function private.queue_subject_transfer_notices_v1(uuid,boolean,uuid[],uuid[]) "
        + "from public,anon,authenticated,inherit_upload_only,service_role;"]);
  });

  it("names nothing an earlier migration's test holds as its last word, and revokes no export by status", () => {
    // Each of these is a body an earlier test says no later migration restates
    // or patches (its rewrite check reads a quoted signature next to
    // replace(definition), which this migration uses), or a check another
    // test says no later migration names.
    for (const pinned of ["'public.delete_subject_v1(", "'private.delete_path_b_subject_for_route_v1(",
      "'private.invitation_notice_recipient_current_v1(", "'private.enqueue_invitation_terminal_notice_v1(",
      "'private.invitation_contact_barred_v1(", "'public.export_archive_cleanup_v1(", "'private.empty_self_subject_v1(",
      "'private.prepare_genome_file_deletion_body_v1(", "'public.self_subject_withdrawal_readiness_v1(",
      "legal_audit_person_event_v1", "restrict_embryo_cohort_core_v1", "queue_refused_invitation_draft_v1",
      "consume_account_operation_nonce_v1", "'public.claim_invitation_terminal_mail_v1(",
      "'public.authorize_invitation_terminal_mail_v1(", "'private.delete_pair_derived_rows_v1(",
      "'private.grant_path_b_purpose_v1(", "'private.path_b_result_read_v1(", "account_operation_nonces_operation_check",
      "consume_session_csrf", "genomes-staging", "generated-artifacts"]) {
      expect(migration.includes(pinned), pinned).toBe(false);
    }
    // D-144's census of every statement that revokes an export is unchanged:
    // the D-151 fix stops attempts first and leaves the transfer's own
    // revocation as 20261016221000 wrote it.
    expect(migration).not.toMatch(/update public\.generated_exports(?: e)? set status='revoked'/u);
    expect(count(transferAfter, "update public.generated_exports set status='revoked' where id=any(v_exports);")).toBe(1);
  });
});

describe("the predecessor block, the patches and the postflight", () => {
  it("pins every body it relies on to the md5 recomputed from its source, and to its ACL", () => {
    const pins: [string, string, string][] = [
      ["private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)", TRANSFER, "{postgres=X/postgres}"],
      ["public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)", WITHDRAW, "{postgres=X/postgres,service_role=X/postgres}"],
      ["public.other_adult_withdrawal_readiness_v1(uuid,uuid)", READINESS, "{postgres=X/postgres,service_role=X/postgres}"],
      ["private.subject_transfer_open_v1()", SWITCH, "{postgres=X/postgres}"],
      ["public.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)", DOOR, "{postgres=X/postgres,service_role=X/postgres}"],
      ["private.end_other_adult_held_upload_v1(uuid,text)", HELD_END, "{postgres=X/postgres}"],
    ];
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    for (const [signature, body, acl] of pins) {
      expect(preflight, signature).toMatch(new RegExp(`to_regprocedure\\('${escape(signature)}'\\)\\n\\s+and md5\\(pg_get_functiondef\\(p\\.oid\\)\\)='${
        md5(body)}'\\s+and p\\.proacl::text='${escape(acl)}'\\)`, "u"));
    }
    expect(md5(TRANSFER)).toBe("3707a210e8fab9361b15a1ab6adbe8e0");
    expect(md5(SWITCH)).toBe("c4b160e966711cf513e267673c4b5e2f");
    expect(SWITCH).toContain("AS $function$ select false $function$");
    // The switch must still answer false before and after.
    expect(preflight).toContain("  or private.subject_transfer_open_v1()\n");
    expect(postflight).toContain("  or private.subject_transfer_open_v1()\n");
    // The cleanup door as 20260923123240 left it, pinned by name, never by its quoted signature.
    expect(md5(CLEANUP)).toBe("25fa3ce71b73fb0c371d1bb9af836bd7");
    expect(preflight).toContain("p.pronamespace='public'::regnamespace and p.proname='export_archive_cleanup_v1'\n"
      + `   and md5(pg_get_functiondef(p.oid))='${md5(CLEANUP)}'`);
    // The notice kinds as 20261120120000 left them, and the widened check.
    expect(preflight).toContain(`is distinct from '${md5(kindCheck(KINDS_BEFORE))}'`);
    expect(migration).toContain(`check (notice_kind in (${[...KINDS_BEFORE.slice(0, 4)].map(kind => `'${kind}'`).join(",")},\n`
      + `  ${KINDS_BEFORE.slice(4).map(kind => `'${kind}'`).join(",")},\n`
      + `  ${TRANSFER_KINDS.slice(0, 3).map(kind => `'${kind}'`).join(",")},\n`
      + `  ${TRANSFER_KINDS.slice(3).map(kind => `'${kind}'`).join(",")}));`);
    const widened = kindCheck([...KINDS_BEFORE, ...TRANSFER_KINDS]);
    expect(postflight.replace(/'\n {3}\|\|'/gu, "").replace(/''/gu, "'")).toContain(widened);
    expect(preflight).toContain("raise exception using errcode='55000',message='uploader withdrawal hand-over prerequisite differs'");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration asserts", () => {
    let transfer = TRANSFER;
    for (const patch of patches) {
      const base = patch.target.startsWith("private.transfer_subject_v1") ? transfer
        : patch.target.startsWith("public.withdraw") ? WITHDRAW : READINESS;
      expect(md5(base), `${patch.ordinal} before`).toBe(patch.before);
      const next = apply(base, patch.old, patch.next);
      expect(md5(next), `${patch.ordinal} after`).toBe(patch.after);
      if (patch.target.startsWith("private.transfer_subject_v1")) transfer = next;
    }
    expect(transfer).toBe(transferAfter);
    expect(postflight).toContain(`md5(pg_get_functiondef(p.oid))='${md5(transferAfter)}'`);
    expect(postflight).toContain(`md5(pg_get_functiondef(p.oid))='${md5(withdrawAfter)}'`);
    expect(postflight).toContain(`md5(pg_get_functiondef(p.oid))='${md5(readinessAfter)}'`);
    expect(postflight).toContain(`md5(pg_get_functiondef(p.oid))='${md5(DOOR)}'`);
    expect(postflight).toContain(`md5(pg_get_functiondef(p.oid))='${md5(SWITCH)}'`);
  });

  it("marks every change it makes to the transfer, and keeps every other statement of it", () => {
    for (const patch of patches.slice(0, 8)) {
      if (patch.ordinal === 1) continue; // declarations only
      expect(patch.next, String(patch.ordinal)).toContain("20261122100000");
    }
    // Every statement of the old body survives, except the four the patches rewrite.
    const rewritten = new Set(["  or s.subject_account_id is distinct from p_account_id",
      "  or s.owner_account_id is null or s.owner_account_id=p_account_id",
      "  and sp.principal_kind='account_subject' and sp.account_id=p_account_id and sp.status='active' for share;",
      " if not found or not private.path_b_account_current_v1(p_account_id) then",
      " if exists(select 1 from public.other_adult_held_uploads x where x.id=any(v_revisions) and x.state='pending')",
      " perform private.record_subject_operation_nonce_v1(p_account_id,p_session_id,'subject_transfer',s.id,",
      "  p_nonce_hash,p_nonce_expires_at);",
      " -- 5. Audit, with no raw contact or token.",
      " perform private.append_legal_audit_event('subject.ownership_transferred',null,'api.subject-transfer','accepted',",
      "   'results_removed',n_results,'chats',cardinality(v_chats),'revision',v_transfer.transfer_revision));"]);
    const kept = TRANSFER.split("\n").filter(line => !rewritten.has(line));
    const after = transferAfter.split("\n");
    for (const line of kept) expect(after, line).toContain(line);
  });
});

describe("the second act, behind the one switch", () => {
  it("is named by the withdrawal door alone, around its one call of the transfer, and read by the transfer alone", () => {
    const marker = "inherit.subject_transfer_withdrawal";
    // Here: once in the header comment, twice in the door (set, then cleared), once in the transfer (read).
    for (const file of files) expect(count(read(`supabase/migrations/${file}`), marker), file).toBe(file === NAME ? 4 : 0);
    expect(count(withdrawAfter, marker)).toBe(2);
    expect(count(transferAfter, marker)).toBe(1);
    expect(withdrawAfter).toContain("  perform pg_catalog.set_config('inherit.subject_transfer_withdrawal',s.id::text,true);\n"
      + "  v_result:=private.transfer_subject_v1(p_account_id,p_session_id,s.id,p_nonce_hash,p_nonce_expires_at);\n"
      + "  perform pg_catalog.set_config('inherit.subject_transfer_withdrawal','',true);");
    expect(transferAfter).toContain(
      " v_withdrawal:=coalesce(pg_catalog.current_setting('inherit.subject_transfer_withdrawal',true),'')=p_subject_id::text;");
    expect(DOOR).not.toContain(marker);
  });

  it("refuses the branch as before while the switch is closed, and only then runs the transfer", () => {
    const branch = withdrawAfter.slice(withdrawAfter.indexOf(" if s.subject_account_id is not null then"));
    const order = ["if not private.subject_transfer_open_v1() then",
      "raise exception using errcode='42501',message='other_adult_withdrawal_account_held'; end if;",
      "perform pg_catalog.set_config('inherit.subject_transfer_withdrawal',s.id::text,true);",
      "v_result:=private.transfer_subject_v1(", "return jsonb_build_object('case','adult');",
      "-- The person, their current contact and the request they accepted."];
    const at = order.map(fragment => branch.indexOf(fragment));
    expect(at.every(index => index > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // Everything before the branch, the no-account branch and the read's other answers are unchanged.
    expect(withdrawAfter.slice(0, withdrawAfter.indexOf(" -- The person holds the record")))
      .toBe(WITHDRAW.slice(0, WITHDRAW.indexOf(" -- The person holds the record")));
    expect(withdrawAfter.slice(withdrawAfter.indexOf(" -- The person, their current contact")))
      .toBe(WITHDRAW.slice(WITHDRAW.indexOf(" -- The person, their current contact")));
    expect(readinessAfter).toContain("return case when private.subject_transfer_open_v1() then 'hand-over' else 'account-held' end;");
    expect(readinessAfter.replace(/ -- 20261122100000[\s\S]*?'account-held' end; end if;/u, "")).toBe(
      READINESS.replace(" if s.subject_account_id is not null then return 'account-held'; end if;", ""));
  });

  it("admits the uploader only on its withdrawal, spends its api.subject-delete code, ends the unconfirmed files, then moves the rest", () => {
    expect(patches[2]!.next).toContain("  or (not v_withdrawal and s.subject_account_id is distinct from p_account_id)\n"
      + "  or (v_withdrawal and s.owner_account_id is distinct from p_account_id)\n");
    const order = ["v_withdrawal:=", "perform 1 from public.profiles where id=p_account_id for update;",
      "select * into s from public.subjects where id=p_subject_id for update;", "v_new:=s.subject_account_id;",
      "case when v_withdrawal then 'subject_delete' else 'subject_transfer' end",
      "private.end_other_adult_held_upload_v1(h.id,'withdrawn')", "and x.state='confirmed'", " p_account_id:=v_new;",
      "update public.subjects set owner_account_id=p_account_id,ownership_transferred_at=v_now,",
      "perform public.export_archive_cleanup_v1('stop',v_attempt.export_id,v_attempt.id,null);",
      "update public.generated_exports set status='revoked' where id=any(v_exports);",
      "revocation_reason=case when v_withdrawal then 'withdrawn' else 'superseded' end",
      "n_notices:=private.queue_subject_transfer_notices_v1(v_transfer.id,v_withdrawal,v_grants,v_relationships);",
      "perform private.append_legal_audit_event('subject.ownership_transferred',"];
    const at = order.map(fragment => transferAfter.indexOf(fragment));
    expect(at.every(index => index > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The person's own act still refuses a pending file; only the withdrawal ends one.
    expect(transferAfter).toContain(" if (not v_withdrawal and exists(select 1 from public.other_adult_held_uploads x"
      + " where x.id=any(v_revisions) and x.state='pending'))");
    expect(count(transferAfter, "p_account_id:=")).toBe(1);
  });
});

describe("the notices", () => {
  it("queues the contract's three, by act, each once, to accounts only, bound to the request the person accepted", () => {
    expect(queue).toContain("(case when p_withdrawal then 'withdrawal-transfer-new-owner' else 'subject-transfer-new-owner' end,t.to_account_id,v_new_revision)");
    expect(queue).toContain("(case when p_withdrawal then 'withdrawal-transfer-former-owner' else 'subject-transfer-former-owner' end,t.from_account_id,");
    expect(queue).toContain("values(i.id,'subject-transfer-access-revoked','account',r.account_id,r.principal_revision,");
    expect(count(queue, "insert into private.invitation_terminal_notices(")).toBe(2);
    expect(count(queue, "on conflict(idempotency_key) do nothing;")).toBe(2);
    expect(queue).not.toContain("contact_ciphertext");
    expect(queue).toContain("encode(extensions.digest(convert_to('subject-transfer-notice-v1|'||x.kind||'|'||t.id::text||'|'||x.account::text,'UTF8'),");
    expect(queue).toContain("encode(extensions.digest(convert_to('subject-transfer-notice-v1|subject-transfer-access-revoked|'||t.id::text||'|'\n    ||r.account_id::text,'UTF8'),'sha256'),'hex')");
    expect(count(queue, "v_now+interval '7 days'")).toBe(2);
    expect(queue).toContain("where a.account_id is not null and a.account_id<>t.to_account_id and a.account_id<>t.from_account_id");
    expect(queue).toContain("raise exception using errcode='55000',message='subject_transfer_notice_unavailable'");
    expect(queue).toContain("where id=p_transfer_id and transaction_id=txid_current();");
  });

  it("is written in the app as five closed kinds of the same template, each with its own subject", () => {
    const copy = read("src/copy/upload/subject-transfer-notices.ts");
    for (const kind of TRANSFER_KINDS) {
      expect(copy, kind).toContain(`"${kind}":`);
      expect(read("src/lib/embryos/invitation-terminal-mail.ts"), kind).toContain(`"${kind}"`);
      expect(read("src/lib/claims/email-fixtures.ts"), kind).toContain(`"${kind}"`);
    }
    expect(copy).toContain("NOT APPROVED.");
    expect(read("src/emails/invitation-terminal-notice.tsx")).toContain("...SUBJECT_TRANSFER_NOTICES,");
  });
});

describe("the app around it", () => {
  it("offers the hand-over only on the read's answer, with the same api.subject-delete code, and sends it to the same door", () => {
    expect(read("src/lib/uploads/other-adult-upload-server.ts"))
      .toContain('new Set<OtherAdultWithdrawalReadiness>(["ready", "hand-over", "account-held", "unsupported"])');
    expect(read("src/lib/uploads/other-adult-upload-server.ts")).toContain('const sendable = readiness === "ready" || readiness === "hand-over";');
    expect(read("src/app/api/subjects/[id]/route.ts")).toContain('answer = await admin.rpc("withdraw_other_adult_upload_v1", args);');
    // Nothing in the app reaches the transfer but its own route.
    const callers = ["src/app/api/subjects/[id]/transfer/route.ts"];
    expect(read(callers[0]!)).toContain('admin.rpc("transfer_subject_v1", {');
  });
});

describe("its tests and its notes", () => {
  it("is driven by its pgTAP suite with the switch closed and then opened inside the rolled-back transaction", () => {
    expect(pgtap.startsWith("-- The uploader's withdrawal hands a record its adult holds")).toBe(true);
    expect(pgtap).toMatch(/\nbegin;\n/u);
    expect(pgtap.trimEnd().endsWith("select * from finish();\nrollback;")).toBe(true);
    const closed = pgtap.indexOf("select is(private.subject_transfer_open_v1(),false,");
    const opened = pgtap.indexOf("create or replace function private.subject_transfer_open_v1() returns boolean language sql immutable set search_path='' as\n $$ select true $$;");
    expect(closed).toBeGreaterThan(0);
    expect(opened).toBeGreaterThan(closed);
    expect(pgtap.slice(closed, opened)).toContain("'42501','other_adult_withdrawal_account_held'");
    expect(pgtap.slice(closed, opened)).toContain("select is(pg_temp.state(),(select value from before_state),");
    for (const fragment of ["'hand-over'", "'withdrawal-transfer-new-owner 02'", "'withdrawal-transfer-former-owner 01'",
      "'subject-transfer-access-revoked 09'", "D-151", "D-147", "revocation_reason='withdrawn'", "revocation_reason='superseded'",
      "public.claim_invitation_terminal_mail_v1()", "public.authorize_invitation_terminal_mail_v1(", "pg_temp.read_record()",
      "public.path_b_report_results_v1(pg_temp.a('1')", "subject_transfer_relocation_work_v1(true)",
      "public.delete_subject_v1(pg_temp.a('2')"]) {
      expect(pgtap, fragment).toContain(fragment);
    }
  });
});
