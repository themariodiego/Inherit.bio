import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The uploader's withdrawal of its consent for another adult's file
 * (20261119160000_other_adult_upload_consent_withdrawal.sql; owner decision of
 * 19 November 2026, "An uploader's withdrawal for another adult's file deletes
 * it, unless that adult holds the record themselves"). The migration pins
 * the bodies it relies on and patches two in place under the md5-guarded
 * convention. pg_get_functiondef keeps a body verbatim, so each pinned body
 * is rebuilt here from the migration that last defined it, every earlier
 * patch is replayed from its own source, and every md5 (predecessor and
 * successor) is recomputed. The page's read must refuse where the door
 * refuses, so their predicates are compared as text. The pgTAP suite
 * (supabase/tests/other_adult_upload_consent_withdrawal.sql) drives the door,
 * the notice and the read against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261119160000_other_adult_upload_consent_withdrawal.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/other_adult_upload_consent_withdrawal.sql");
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

/** The md5-guarded patches of one migration: [old, new] fragments in order. */
function fragments(source: string): [string, string][] {
  return [...source.matchAll(/\$old\$([\s\S]*?)\$old\$[\s\S]*?\$new\$([\s\S]*?)\$new\$/gu)].map(match => [match[1]!, match[2]!]);
}
function apply(text: string, [old, next]: [string, string]): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}

const DOOR_HEADER = "CREATE OR REPLACE FUNCTION public.delete_subject_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, "
  + "p_nonce_hash text, p_nonce_expires_at timestamp with time zone)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n"
  + " SET search_path TO ''\n";
const SUBJECT_DELETE = read("supabase/migrations/20261016181000_subject_delete.sql");
/** delete_subject_v1 as 20261016181000 wrote it and its two later patches left it. */
const DOOR = [read("supabase/migrations/20261016220000_subject_delete_reviewed_document.sql"),
  read("supabase/migrations/20261016221000_subject_transfer.sql")]
  .map(sql => fragments(between(sql, "do $patch_door$", "$patch_door$;")))
  .reduce((text, patches) => patches.reduce(apply, text),
    definition(SUBJECT_DELETE, "create function public.delete_subject_v1(", DOOR_HEADER));
const PATH_B_DELETE = definition(SUBJECT_DELETE, "create function private.delete_path_b_subject_for_route_v1(",
  "CREATE OR REPLACE FUNCTION private.delete_path_b_subject_for_route_v1(p_subject_id uuid, p_state text)\n RETURNS integer\n"
  + " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n");
const TERMINAL = read("supabase/migrations/20260906053451_invitation_terminal_mail.sql");
const RECIPIENT = definition(TERMINAL, "create or replace function private.invitation_notice_recipient_current_v1(",
  "CREATE OR REPLACE FUNCTION private.invitation_notice_recipient_current_v1(p_notice_id uuid)\n RETURNS boolean\n LANGUAGE sql\n"
  + " STABLE\n SET search_path TO ''\n");
const ENQUEUE = definition(TERMINAL, "create or replace function private.enqueue_invitation_terminal_notice_v1(",
  "CREATE OR REPLACE FUNCTION private.enqueue_invitation_terminal_notice_v1()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO ''\n");
const BARRED = definition(read("supabase/migrations/20260906061029_invitation_transition_guards.sql"),
  "create or replace function private.invitation_contact_barred_v1(",
  "CREATE OR REPLACE FUNCTION private.invitation_contact_barred_v1(p_hmac text)\n RETURNS boolean\n LANGUAGE sql\n STABLE\n"
  + " SET search_path TO ''\n");
const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const patchBlock = between(migration, "do $patch_withdrawal$", "$patch_withdrawal$;");
const patches = fragments(patchBlock);
const door = between(migration, "create function public.withdraw_other_adult_upload_v1(", "$$;");
const readiness = between(migration, "create function public.other_adult_withdrawal_readiness_v1(", "$$;");

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose objects it calls, pins or patches", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260906053451", "20260906061029", "20260930210000", "20261016181000", "20261016220000",
      "20261016221000", "20261023120000", "20261119150000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });

  it("creates two functions, widens one check and patches two bodies, and nothing else", () => {
    expect([...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1]))
      .toEqual(["public.withdraw_other_adult_upload_v1", "public.other_adult_withdrawal_readiness_v1"]);
    expect([...migration.matchAll(/^\s*(alter|drop|create)\s+(table|index|trigger|policy|type)\b[^\n]*/gimu)].map(match => match[0]))
      .toEqual(["alter table private.invitation_terminal_notices drop constraint invitation_terminal_notices_notice_kind_check;",
        "alter table private.invitation_terminal_notices add constraint invitation_terminal_notices_notice_kind_check"]);
    expect([...patchBlock.matchAll(/\(\d,'([a-z0-9_.]+)\(/gu)].map(match => match[1]))
      .toEqual(["public.delete_subject_v1", "private.invitation_notice_recipient_current_v1"]);
  });

  it("names none of what the earlier 19 November migrations pin, so it undoes none of them", () => {
    for (const pinned of ["genomes-staging", "generated-artifacts", "account_deletion_storage_entries_bucket_id_check",
      "embryo_ingest_delete_objects_bucket_id_check", "genome_storage_objects_bucket_id_check",
      "'private.empty_self_subject_v1(", "'private.prepare_genome_file_deletion_body_v1(", "create_adult_subject_invitation"]) {
      expect(migration.includes(pinned), pinned).toBe(false);
    }
  });
});

describe("the predecessor block and the patches", () => {
  it("pins every body it relies on to the md5 recomputed from its source, and to its ACL", () => {
    expect(md5(DOOR)).toBe("2f2c32f48e4a223617ba6d31f493a92c");
    expect(md5(PATH_B_DELETE)).toBe("f30283fb54afaf87da2462c9a469c85f");
    expect(md5(RECIPIENT)).toBe("261f743d84e3615d4ae56ab2e4e26b9a");
    expect(md5(ENQUEUE)).toBe("689008df933e852391c20f6e8b3afd4a");
    expect(md5(BARRED)).toBe("78c6413be21d2c662e515764a39748b3");
    for (const [signature, hash] of [["public.delete_subject_v1(uuid,uuid,uuid,text,timestamptz)", md5(DOOR)],
      ["private.delete_path_b_subject_for_route_v1(uuid,text)", md5(PATH_B_DELETE)],
      ["private.invitation_notice_recipient_current_v1(uuid)", md5(RECIPIENT)],
      ["private.enqueue_invitation_terminal_notice_v1()", md5(ENQUEUE)], ["private.invitation_contact_barred_v1(text)", md5(BARRED)]]) {
      expect(preflight).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${hash}'`);
    }
    expect(preflight).toContain("is distinct from '9a5c55221b44fc6b6b80079b9460b790'");
    expect(preflight).toContain("raise exception using errcode='55000',message='other adult upload withdrawal prerequisite differs'");
    expect(preflight).toContain("or to_regprocedure('public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz)') is not null");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration asserts", () => {
    const door = apply(DOOR, patches[0]!);
    const recipient = apply(RECIPIENT, patches[1]!);
    expect(patchBlock).toContain(`'2f2c32f48e4a223617ba6d31f493a92c',\n   '${md5(door)}'`);
    expect(patchBlock).toContain(`'261f743d84e3615d4ae56ab2e4e26b9a',\n   '${md5(recipient)}'`);
    expect(md5(door)).toBe("e994afb4410ad008aa959efc65726895");
    expect(md5(recipient)).toBe("e0728613189f2cbdfa05029c962767a5");
    const postflight = between(migration, "do $postflight$", "$postflight$;");
    expect(postflight).toContain("md5(pg_get_functiondef(p.oid))='e994afb4410ad008aa959efc65726895'");
    expect(postflight).toContain("md5(pg_get_functiondef(p.oid))='e0728613189f2cbdfa05029c962767a5'");
    expect(postflight).toContain("md5(pg_get_functiondef(p.oid))='f30283fb54afaf87da2462c9a469c85f'");
  });

  it("touches only the door's Path B branch: its self branch, pinned by 20261119150000, stays as it was", () => {
    const [old, next] = patches[0]!;
    expect(old).not.toContain("s.subject_class='self'");
    expect(next.startsWith(old.slice(0, old.indexOf("\n") + 1))).toBe(true);
    expect(next).toContain("if s.subject_account_id is not null and s.subject_account_id is distinct from p_account_id then\n"
      + "    raise exception using errcode='42501',message='not_found'; end if;");
    expect(next.endsWith(old.slice(old.indexOf("\n")))).toBe(true);
    const self = between(read("supabase/migrations/20261119150000_own_upload_consent_withdrawal.sql"), "self_branch text:=$self$", "$self$;");
    expect(count(apply(DOOR, patches[0]!), self)).toBe(1);
  });

  it("rechecks the bar at send time for the new kind only", () => {
    const [, next] = patches[1]!;
    expect(next).toContain("and (n.notice_kind<>'upload-permission-withdrawn' or exists(select 1 from public.subject_invitations i");
    expect(next).toContain("and not private.invitation_contact_barred_v1(i.email_hmac)))");
  });

  it("is the last word on nothing it pins: no later migration restates or patches those bodies", () => {
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    for (const qualified of ["private.delete_path_b_subject_for_route_v1", "private.enqueue_invitation_terminal_notice_v1",
      "private.invitation_contact_barred_v1", "private.invitation_notice_recipient_current_v1", "public.delete_subject_v1"]) {
      expect(files.filter(file => file > NAME && rewrites(file, qualified)), qualified).toEqual([]);
    }
  });
});

describe("the door, the notice and the page's read", () => {
  it("takes the invitation-transition lock first, refuses before it writes, then runs the delete unchanged, then the notice", () => {
    const order = ["perform private.lock_invitation_transitions_v1();",
      "or s.ownership_transferred_at is not null or s.owner_account_id is distinct from p_account_id",
      "message='other_adult_withdrawal_account_held'", "message='withdrawal_notice_unavailable'",
      "v_result:=public.delete_subject_v1(p_account_id,p_session_id,s.id,p_nonce_hash,p_nonce_expires_at);",
      "if not private.invitation_contact_barred_v1(i.email_hmac) then",
      "insert into private.invitation_terminal_notices("];
    const at = order.map(fragment => door.indexOf(fragment));
    expect(at.every(index => index > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(door).not.toMatch(/for update/iu);
  });

  it("queues one notice per spent code to the sealed contact, bound to the accepted request, for seven days", () => {
    expect(door).toContain("values(i.id,'upload-permission-withdrawn','contact',v_contact,i.invitation_revision,");
    expect(door).toContain("'upload-permission-withdrawn-v1|'||s.id::text||'|'||p_nonce_hash");
    expect(door).toContain("v_now,v_now+interval '7 days')\n  on conflict(idempotency_key) do nothing;");
    // The queue's trigger writes the mail row; the worker and the template read the kind.
    expect(ENQUEUE).toContain("jsonb_build_object('kind',new.notice_kind)");
    expect(read("src/lib/embryos/invitation-terminal-mail.ts")).toContain('"upload-permission-withdrawn"]);');
    expect(read("src/emails/invitation-terminal-notice.tsx")).toContain('"upload-permission-withdrawn": UPLOAD_PERMISSION_WITHDRAWN_NOTICE_COPY,');
  });

  it("reads 'account-held' and 'unsupported' on the door's own predicates, in its order, and writes nothing", () => {
    const guard = (text: string) => {
      const start = text.indexOf(" select * into s from public.subjects where id=p_subject_id;");
      expect(start).toBeGreaterThan(0);
      return text.slice(start, text.indexOf("raise exception using errcode='42501',message='not_found'; end if;", start));
    };
    expect(guard(readiness)).toBe(guard(door));
    expect(readiness).toContain(" if s.subject_account_id is not null then return 'account-held'; end if;");
    expect(door).toContain(" if s.subject_account_id is not null then\n  raise exception using errcode='42501',message='other_adult_withdrawal_account_held'; end if;");
    for (const predicate of ["sp.principal_kind='non_account_subject' and sp.account_id is null and sp.status='active'",
      "e.status='current' and e.contact_ciphertext is not null\n   and e.authority_revision=sp.principal_revision",
      "x.invitation_kind='adult_subject' and x.status='accepted' and x.invitee_principal_id=v_principal"]) {
      expect(door, predicate).toContain(predicate);
    }
    expect(readiness).toContain("sp.principal_kind='non_account_subject' and sp.account_id is null and sp.status='active'");
    expect(readiness).toContain("and x.invitation_kind='adult_subject' and x.status='accepted' and x.invitee_principal_id=v_principal) then\n  return 'unsupported';");
    expect(readiness).toContain("returns text language plpgsql stable security definer set search_path=''");
    expect(readiness).not.toMatch(/\b(?:insert|update|delete)\s/iu);
  });

  it("is reachable only as granted, and the route and the card's server half are its callers", () => {
    expect(migration).toContain("grant execute on function public.withdraw_other_adult_upload_v1(uuid,uuid,uuid,text,timestamptz) to service_role;");
    expect(migration).toContain("grant execute on function public.other_adult_withdrawal_readiness_v1(uuid,uuid) to service_role;");
    expect(read("src/app/api/subjects/[id]/route.ts")).toContain('answer = await admin.rpc("withdraw_other_adult_upload_v1", args);');
    expect(read("src/lib/uploads/other-adult-upload-server.ts")).toContain('heldUploadRpc(admin, "other_adult_withdrawal_readiness_v1", {');
  });

  it("is driven by its pgTAP suite through the refusals, the bar, the withdrawal, the notice and the untouched record", () => {
    // 2026-11-22 (20261122120000): the transfer is open, so the suite now
    // probes the own-account branch handing the record over instead of its
    // refusal; uploader_withdrawal_hand_over.sql keeps the refusal, with the
    // switch closed inside a savepoint.
    for (const fragment of ["'hand-over'", "the own-account branch hands the record to the person through the transfer",
      "55000 withdrawal_notice_unavailable", "contact_refusal_bars",
      "public.claim_invitation_terminal_mail_v1()", "public.authorize_invitation_terminal_mail_v1(",
      "'f30283fb54afaf87da2462c9a469c85f'", "'e994afb4410ad008aa959efc65726895'"]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    expect(pgtap.startsWith("-- ")).toBe(true);
    expect(pgtap).toContain("\nbegin;\n");
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
