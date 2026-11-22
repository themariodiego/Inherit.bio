import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-141: the 72-hour hold on an account created from an invitation, the
 * second notice and the re-notice (20261120120000_adult_acceptance_hold_and_renotice.sql;
 * register other-adult-mitigation-state-v1, coded to under the owner's rule of
 * 19 November 2026). The migration pins the bodies it relies on and patches six
 * in place under the md5-guarded convention. pg_get_functiondef keeps a body
 * verbatim, so each pinned body is rebuilt here from the migration that last
 * defined it, every earlier patch is replayed from its own source, and every
 * md5 (predecessor and successor) is recomputed. The pgTAP suite
 * (supabase/tests/adult_acceptance_hold_and_renotice.sql) drives the clocks,
 * the decision, the notices and the checkpoint callers against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261120120000_adult_acceptance_hold_and_renotice.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/adult_acceptance_hold_and_renotice.sql");
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

/** The md5-guarded patches of one block: [old, new] fragments in order. */
function fragments(source: string): [string, string][] {
  return [...source.matchAll(/\$old\$([\s\S]*?)\$old\$[\s\S]*?\$new\$([\s\S]*?)\$new\$/gu)].map(match => [match[1]!, match[2]!]);
}
function apply(text: string, [old, next]: [string, string]): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}

const DEFINER = " SECURITY DEFINER\n";
const header = (signature: string, returns: string, searchPath: string, volatility = "") =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n LANGUAGE plpgsql\n${volatility ? ` ${volatility} SECURITY DEFINER\n` : DEFINER}`
  + ` SET search_path TO ${searchPath}\n`;

// Path A's shared acceptance body: 20260928150000's definition and 20261025400000's patch.
const PATH_A = fragments(between(read("supabase/migrations/20261025400000_path_a_account_accept_typed_name.sql"),
  "do $patch_path_a_typed_name$", "$patch_path_a_typed_name$;")).reduce(apply, definition(read("supabase/migrations/20260928150000_other_adult_held_upload.sql"),
  "create or replace function private.adult_subject_invitation_response_v1(",
  header("private.adult_subject_invitation_response_v1(p_token_hash_id uuid, p_session_id uuid, p_action text, "
    + "p_account_id uuid, p_account_email_hmac text)", "text", "''")));
const PATH_B_CORE = definition(read("supabase/migrations/20261016190000_path_b_reviewed_document.sql"),
  "create or replace function private.confirm_path_b_subject_account_core_v1(",
  header("private.confirm_path_b_subject_account_core_v1(p_session_hash text, p_nonce text, p_artifact_version integer, "
    + "p_artifact_body_sha256 text, p_statement_keys text[], p_signing_name_ciphertext bytea, p_account_id uuid, "
    + "p_auth_session_id uuid, p_account_email_hmac text, p_test_jurisdiction boolean)", "text", "'pg_catalog', 'private'"));
// The decision: 20260930220000's body, renamed by 20261009224500, its no-account branch patched by 20261016204000.
const DECISION = fragments(between(read("supabase/migrations/20261016204000_path_b_no_account_uploader_gate.sql"),
  "do $patch_gate$", "$patch_gate$;")).reduce(apply, definition(read("supabase/migrations/20260930220000_path_b_reading_layer.sql"),
  "create function private.other_adult_mitigation_v1(",
  header("private.other_adult_mitigation_before_public_appeal_v1(p_subject_id uuid, p_account_id uuid, p_checkpoint text)",
    "jsonb", "'pg_catalog'", "STABLE")));
const AUTHORITY = definition(read("supabase/migrations/20260930231000_path_b_normalization.sql"),
  "create function private.path_b_normalization_authority_v1(",
  header("private.path_b_normalization_authority_v1(p_revision_id uuid, p_checkpoint text)", "jsonb", "''"));
const TERMINAL = read("supabase/migrations/20260906053451_invitation_terminal_mail.sql");
const CLAIM = definition(TERMINAL, "create or replace function public.claim_invitation_terminal_mail_v1(",
  header("public.claim_invitation_terminal_mail_v1()", "TABLE(outbox_id uuid, attempt_ordinal smallint, idempotency_key text, "
    + "notice_kind text, contact_ciphertext bytea, recipient_account_id uuid)", "''"));
const AUTHORIZE = definition(TERMINAL, "create or replace function public.authorize_invitation_terminal_mail_v1(",
  header("public.authorize_invitation_terminal_mail_v1(p_outbox_id uuid, p_attempt_ordinal smallint)", "boolean", "''"));
const ENQUEUE = definition(read("supabase/migrations/20261003030000_path_b_confirmed_array_normalization.sql"),
  "create or replace function private.enqueue_path_b_normalization_v1(",
  header("private.enqueue_path_b_normalization_v1(p_revision_id uuid)", "uuid", "''"));

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const patchBlock = between(migration, "do $patch_hold$", "$patch_hold$;");
const patches: Patch[] = [...patchBlock.matchAll(
  /\((\d+),'([^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/gu,
)].map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
  old: match[6]!, next: match[7]!, label: match[8]! }));
const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const body = (name: string) => between(migration, `create function ${name}(`, "$$;");

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose objects it calls, pins or patches", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260906053451", "20260930210000", "20260930220000", "20260930231000", "20261003030000",
      "20261009224500", "20261016190000", "20261016204000", "20261025400000", "20261119160000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });

  it("creates six functions and one trigger, widens one check and patches six bodies, and nothing else", () => {
    expect([...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1])).toEqual([
      "private.start_adult_acceptance_clocks_v1", "private.adult_acceptance_clock_state_v1",
      "private.adult_acceptance_notice_current_v1", "private.settle_adult_acceptance_notice_v1",
      "public.run_due_adult_acceptance_notices_v1", "public.adult_subject_acceptance_origin_v1"]);
    expect([...migration.matchAll(/^\s*(alter|drop|create)\s+(table|index|trigger|policy|type)\b[^\n]*/gimu)].map(match => match[0]))
      .toEqual(["alter table private.invitation_terminal_notices drop constraint invitation_terminal_notices_notice_kind_check;",
        "alter table private.invitation_terminal_notices add constraint invitation_terminal_notices_notice_kind_check",
        "create trigger settle_adult_acceptance_notice after update of state or delete on private.invitation_terminal_notices"]);
    expect([...new Set(patches.map(patch => patch.target))]).toEqual([
      "private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)",
      "private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)",
      "private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)",
      "private.path_b_normalization_authority_v1(uuid,text)",
      "public.claim_invitation_terminal_mail_v1()", "public.authorize_invitation_terminal_mail_v1(uuid,smallint)"]);
    expect(patches.map(patch => patch.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("restates or patches nothing an earlier 19 or 20 November migration pins, so it undoes none of them", () => {
    for (const pinned of ["genomes-staging", "generated-artifacts", "account_deletion_storage_entries_bucket_id_check",
      "embryo_ingest_delete_objects_bucket_id_check", "genome_storage_objects_bucket_id_check", "consume_session_csrf_v1",
      "consume_session_csrf_v2", "session_csrf_token_uses", "empty_self_subject_v1", "prepare_genome_file_deletion_body_v1",
      "create_adult_subject_invitation", "clear_adult_invitation_note_envelope_v1", "restrict_embryo_cohort_core_v1",
      "legal_audit_person_event_v1", "queue_refused_invitation_draft_v1", "consume_account_operation_nonce_v1",
      "'private.invitation_notice_recipient_current_v1(", "'private.invitation_contact_barred_v1(",
      "'private.enqueue_invitation_terminal_notice_v1(", "'private.delete_path_b_subject_for_route_v1(",
      "'public.delete_subject_v1("]) {
      expect(migration.includes(pinned), pinned).toBe(false);
    }
  });

  it("is the last word on nothing it pins: no later migration restates or patches those bodies", () => {
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    // 2026-11-22: 20261122170000 (D-154) patches the decision's Path B lookup in
    // place, md5-guarded from exactly this migration's successor, and pins Path
    // B's account core at this migration's successor in its predecessor block
    // (it relies on that core starting both clocks for both flows). For that one
    // file the case checks instead that the decision is patched only through
    // the one-anchor md5 guard from this successor, and that the core occurs
    // only in its predecessor block, pinned at this successor.
    const D154 = "20261122170000_inviter_grants_and_reviewed_document_decision.sql";
    const exempt = (file: string, qualified: string) => file === D154 && (qualified === "private.other_adult_mitigation_before_public_appeal_v1"
      || qualified === "private.confirm_path_b_subject_account_core_v1");
    for (const qualified of ["private.adult_subject_invitation_response_v1", "private.confirm_path_b_subject_account_core_v1",
      "private.other_adult_mitigation_before_public_appeal_v1", "private.path_b_normalization_authority_v1",
      "public.claim_invitation_terminal_mail_v1", "public.authorize_invitation_terminal_mail_v1",
      "private.enqueue_path_b_normalization_v1"]) {
      expect(files.filter(file => file > NAME && rewrites(file, qualified) && !exempt(file, qualified)), qualified).toEqual([]);
    }
    const d154 = read(`supabase/migrations/${D154}`);
    const d154Preflight = between(d154, "do $predecessor$", "$predecessor$;");
    expect(d154).not.toMatch(/create\s+(?:or\s+replace\s+)?function\s+(?:\w+\.)?(other_adult_mitigation_before_public_appeal_v1|confirm_path_b_subject_account_core_v1)\s*\(/iu);
    expect(d154Preflight).toContain("to_regprocedure('private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)')\n"
      + "   and md5(pg_get_functiondef(p.oid))='91dfb6e4abf766e3da6e5827d4381daf' and p.proacl::text='{postgres=X/postgres}')");
    expect(d154).toContain("(2,'private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)','91dfb6e4abf766e3da6e5827d4381daf',");
    expect(d154).toContain("if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then");
    expect(d154.replace(d154Preflight, "").includes("'private.confirm_path_b_subject_account_core_v1(")).toBe(false);
    expect(d154Preflight).toContain("to_regprocedure('private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)')\n"
      + "   and md5(pg_get_functiondef(p.oid))='63c6c510a724cbe747af5db354cb344b' and p.proacl::text='{postgres=X/postgres}')");
  });
});

describe("the predecessor block and the patches", () => {
  it("pins every body it relies on to the md5 recomputed from its source, and to its ACL", () => {
    const pins: [string, string, string][] = [
      ["private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)", md5(PATH_A), "{postgres=X/postgres}"],
      ["private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)", md5(PATH_B_CORE),
        "{postgres=X/postgres}"],
      ["private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)", md5(DECISION), "{postgres=X/postgres}"],
      ["private.path_b_normalization_authority_v1(uuid,text)", md5(AUTHORITY), "{postgres=X/postgres}"],
      ["public.claim_invitation_terminal_mail_v1()", md5(CLAIM), "{postgres=X/postgres,service_role=X/postgres}"],
      ["public.authorize_invitation_terminal_mail_v1(uuid,smallint)", md5(AUTHORIZE), "{postgres=X/postgres,service_role=X/postgres}"],
      ["private.enqueue_path_b_normalization_v1(uuid)", md5(ENQUEUE), "{postgres=X/postgres}"],
    ];
    expect(pins.map(([, hash]) => hash)).toEqual(["99dfdec657617a2b4850f6632693ef51", "2b25a1fb389738bb23397c418612dd63",
      "55892f3ffba0f229626ca024647c134a", "969bc88e9758fe1b2425289c6e4dd3a5", "a725fd9deff71e8d32a3d76400112366",
      "a4448da4d509e964b4cfe493dc6c8996", "8299149090c6d48d6ec52cfe75ab1af6"]);
    for (const [signature, hash, acl] of pins) {
      expect(preflight).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${hash}' and p.proacl::text='${acl}')`);
    }
    // The bar is pinned by name and md5, never by the quoted signature 20261119160000 pins.
    expect(preflight).toContain("p.proname='invitation_contact_barred_v1'\n   and md5(pg_get_functiondef(p.oid))='78c6413be21d2c662e515764a39748b3'");
    expect(preflight).toContain("is distinct from '237de83b1bd70e3587147bb307883b96'");
    expect(preflight).toContain("exists(select 1 from public.retention_rows where retention_id in ('adult.acceptance-hold-72h','adult.re-notice-30d'))");
    expect(preflight).toContain("raise exception using errcode='55000',message='adult acceptance hold prerequisite differs'");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration asserts, chained per body", () => {
    const current = new Map<string, string>([
      [patches[0]!.target, PATH_A], [patches[1]!.target, PATH_B_CORE], [patches[2]!.target, DECISION],
      [patches[6]!.target, AUTHORITY], [patches[7]!.target, CLAIM], [patches[8]!.target, AUTHORIZE]]);
    for (const patch of patches) {
      const before = current.get(patch.target)!;
      expect(md5(before), patch.label).toBe(patch.before);
      const after = apply(before, [patch.old, patch.next]);
      expect(md5(after), patch.label).toBe(patch.after);
      current.set(patch.target, after);
    }
    expect(patches.map(patch => patch.after)).toEqual(["bb4234666d681aeb85f3d41ed9e5121a", "63c6c510a724cbe747af5db354cb344b",
      "8864524071b266426d978e106b6711d0", "99b4ddcb5f80f2a4fb384b530b2c1502", "4aa844173516d17aa462fb4ff2048e67",
      "91dfb6e4abf766e3da6e5827d4381daf", "591fc9f913fb7177ed86144a7ce654f4", "3524eba4d0dd916bef2c4dac1e5c25cb",
      "5ba9fd2ef4bfa2c36ec0e2be4b97aeb5"]);
    // The pgTAP suite asserts the same live successors.
    for (const hash of ["bb4234666d681aeb85f3d41ed9e5121a", "63c6c510a724cbe747af5db354cb344b", "91dfb6e4abf766e3da6e5827d4381daf",
      "591fc9f913fb7177ed86144a7ce654f4", "3524eba4d0dd916bef2c4dac1e5c25cb", "5ba9fd2ef4bfa2c36ec0e2be4b97aeb5"]) {
      expect(pgtap).toContain(hash);
    }
    expect(patchBlock).toContain("and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner");
  });

  it("removes the decision's old creation-time comparison only for acceptances the migration records", () => {
    const decision = patches.filter(patch => patch.target.startsWith("private.other_adult_mitigation_before_public_appeal_v1"))
      .reduce((text, patch) => apply(text, [patch.old, patch.next]), DECISION);
    // The legacy comparison survives, behind "no clock recorded".
    expect(decision).toContain(" if v_clock is null then\n  select u.created_at into v_created from auth.users u where u.id=s.subject_account_id;\n"
      + "  if v_created is null or v_created>=v_invited_at then");
    expect(count(decision, "'adult.acceptance-hold-72h'")).toBe(3);
    expect(decision).toContain("and not coalesce((v_clock->>'reNoticeDone')::boolean,false) then");
    // The no-account branch 20261016204000 wrote is untouched: its re-notice is not built.
    expect(decision).toContain("  if clock_timestamp()>=v_accepted_at+interval '30 days' then\n   return jsonb_build_object('decision','deny','gate','adult.re-notice-30d'); end if;\n  return jsonb_build_object('decision','allow','gate',null);\n end if;");
    // The person's own rights never wait: export, download and purpose choices are not in the held list.
    const own = patches.find(patch => patch.label === "mitigation own account")!.next;
    for (const right of ["'purpose-grant-create'", "'export-create'", "'export-source-read'", "'download-session-create'", "'every-download-chunk'"]) {
      expect(own.includes(right), right).toBe(false);
    }
  });
});

describe("the clocks, the executor and the reads", () => {
  it("decides the origin from the auth row and the invitation row only, and holds anything not shown to predate it", () => {
    const start = body("private.start_adult_acceptance_clocks_v1");
    expect(start).toContain("select u.created_at into v_created from auth.users u where u.id=s.subject_account_id;");
    expect(start).toContain("v_origin:=case when v_created<i.created_at then 'existing_account' else 'created_from_this_invitation' end;");
    expect(start).not.toMatch(/current_setting|request\.|p_origin|p_account_origin/u);
    expect(start).toContain("i.accepted_at+interval '30 days'");
    expect(start).toContain("i.accepted_at+interval '72 hours'");
    expect(count(start, "insert into public.retention_rows")).toBe(2);
    expect(start.indexOf("if v_origin='created_from_this_invitation' then")).toBeLessThan(start.lastIndexOf("insert into public.retention_rows"));
  });

  it("queues each notice once, to the account, after the bar and the record are checked under the invitation lock", () => {
    const executor = body("public.run_due_adult_acceptance_notices_v1");
    const order = ["perform private.lock_invitation_transitions_v1();", "when private.invitation_contact_barred_v1(i.email_hmac) then 'contact_barred'",
      "insert into private.invitation_terminal_notices(", "on conflict(idempotency_key) do nothing;",
      "perform private.enqueue_path_b_normalization_v1(r.id);"];
    const at = order.map(fragment => executor.indexOf(fragment));
    expect(at.every(index => index > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(executor).toContain("values(i.id,v.phase_id,'account',s.subject_account_id,p.principal_revision,v_key,v_now,v_expires)");
    expect(executor).not.toContain("contact_ciphertext");
    expect(executor).toContain("exception when insufficient_privilege then");
  });

  it("is wired: the retention job runs the executor, the mail worker knows the kinds, and the accept route reads the origin", () => {
    expect(read("src/app/api/jobs/retention/route.ts")).toContain('await admin.rpc("run_due_adult_acceptance_notices_v1")');
    expect(read("src/lib/embryos/invitation-terminal-mail.ts")).toContain('"adult-acceptance-second-notice", "adult-revocation-renotice", "upload-permission-withdrawn"]);');
    expect(read("src/lib/embryos/adult-subject-accept.ts")).toContain('rpc("adult_subject_acceptance_origin_v1"');
    expect(migration).toContain("grant execute on function public.run_due_adult_acceptance_notices_v1() to service_role;");
    expect(migration).toContain("grant execute on function public.adult_subject_acceptance_origin_v1(uuid,uuid) to service_role;");
  });

  it("is driven by its pgTAP suite through the hold, the release, both notices, the refusals and every caller", () => {
    for (const fragment of ["at 71 hours 59 minutes", "at 72 hours the second notice is queued",
      "never released without the notice", "(gone) nothing is queued for a deleted record", "(bar) once the address is barred",
      "a public-appeal hold still denies", "(Path A)", "an unrecorded acceptance", "public.claim_invitation_terminal_mail_v1()",
      "public.authorize_invitation_terminal_mail_v1(", "private.path_b_result_read_v1(", "public.path_b_person_choices_v1(",
      "private.account_archive_other_adult_export_gate_v1(", "private.path_b_normalization_authority_v1("]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    expect(pgtap.startsWith("-- ")).toBe(true);
    expect(pgtap).toContain("\nbegin;\n");
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
