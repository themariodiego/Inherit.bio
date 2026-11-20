import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The withdrawal of a person's consent to store their own DNA file
 * (20261119150000_own_upload_consent_withdrawal.sql; owner decision of 19
 * November 2026, "Withdrawing consent for a person's own DNA file deletes the
 * files and all made from them"). The migration wraps api.subject-delete's
 * self case unchanged and adds the confirmation email and the page's read.
 * pg_get_functiondef keeps a plpgsql body verbatim, so each pinned body is
 * rebuilt here from the migration that last defined it and its md5 is
 * recomputed from source. The page's read must refuse exactly where the
 * emptying refuses, so its predicates are compared to the emptying's text.
 * The pgTAP suite (supabase/tests/own_upload_consent_withdrawal.sql) drives
 * the door, the email and the read against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261119150000_own_upload_consent_withdrawal.sql";
const SUBJECT_DELETE = "supabase/migrations/20261016181000_subject_delete.sql";
const migration = read(`supabase/migrations/${NAME}`);
const subjectDelete = read(SUBJECT_DELETE);
const pgtap = read("supabase/tests/own_upload_consent_withdrawal.sql");
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
function definition(source: string, marker: string, header: string): string {
  const start = source.lastIndexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("as $$", start) + "as $$".length;
  const close = source.indexOf("$$;", open);
  return `${header}AS $function$${source.slice(open, close)}$function$\n`;
}

const EMPTY_SELF = definition(subjectDelete, "create function private.empty_self_subject_v1(",
  "CREATE OR REPLACE FUNCTION private.empty_self_subject_v1(p_account_id uuid, p_subject_id uuid)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n");
const FILE_GUARD = definition(subjectDelete, "create or replace function private.prepare_genome_file_deletion_body_v1(",
  "CREATE OR REPLACE FUNCTION private.prepare_genome_file_deletion_body_v1(p_account_id uuid, p_file_id uuid)\n"
  + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n");

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose objects it wraps or pins", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20261016181000", "20261016220000", "20261016221000", "20261023120000", "20261119110000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
  });

  it("restates and patches nothing: three new functions, no table, column, constraint or existing body", () => {
    const created = [...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1]);
    expect(created).toEqual(["private.enqueue_self_withdrawal_notice_v1", "public.empty_self_subject_with_notice_v1",
      "public.self_subject_withdrawal_readiness_v1"]);
    expect(migration).not.toMatch(/^\s*(?:alter|drop|create)\s+(?:table|index|trigger|policy|type)\b/imu);
    expect(migration).not.toContain("replace(definition");
    expect(migration).not.toMatch(/create or replace function/iu);
  });

  it("pins functions that only D-144's migration patches later, and that one from exactly the bodies pinned here", () => {
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    // 2026-11-20 (D-144): 20261120100000 patches both bodies in place, so this
    // migration is no longer the last word on them. What being the last word
    // guaranteed is that every later body starts from the reviewed one: the
    // only later patch names exactly the md5s pinned here as its predecessors.
    const D144 = "20261120100000_self_withdrawal_deletes_exports.sql";
    for (const qualified of ["private.empty_self_subject_v1", "private.prepare_genome_file_deletion_body_v1"]) {
      expect(files.filter(file => file > "20261016181000_subject_delete.sql" && file !== NAME && rewrites(file, qualified)),
        qualified).toEqual([D144]);
    }
    const later = read(`supabase/migrations/${D144}`);
    expect(later).toContain("(1,'private.empty_self_subject_v1(uuid,uuid)','85a9ab8159fa7e5bfb18deada62c1215',");
    expect(later).toContain("(4,'private.prepare_genome_file_deletion_body_v1(uuid,uuid)','e9f3f4692f0c6d10f6827410db8a0102',");
  });
});

describe("the predecessor block", () => {
  const preflight = between(migration, "do $predecessor$", "$predecessor$;");

  it("pins the self emptying and the per-file guard to the md5 recomputed from their source, and to their ACL", () => {
    expect(md5(EMPTY_SELF)).toBe("85a9ab8159fa7e5bfb18deada62c1215");
    expect(md5(FILE_GUARD)).toBe("e9f3f4692f0c6d10f6827410db8a0102");
    expect(preflight).toContain("'private.empty_self_subject_v1(uuid,uuid)')\n"
      + "   and md5(pg_get_functiondef(p.oid))='85a9ab8159fa7e5bfb18deada62c1215' and p.proacl::text='{postgres=X/postgres}')");
    expect(preflight).toContain("'private.prepare_genome_file_deletion_body_v1(uuid,uuid)')\n"
      + "   and md5(pg_get_functiondef(p.oid))='e9f3f4692f0c6d10f6827410db8a0102' and p.proacl::text='{postgres=X/postgres}')");
    expect(preflight).toContain("raise exception using errcode='55000',message='own upload consent withdrawal prerequisite differs'");
  });

  it("requires the door's self branch exactly as 20261016181000 wrote it, and no later patch of the door touches it", () => {
    const branch = between(preflight, "self_branch text:=$self$", "$self$;");
    expect(count(subjectDelete, branch)).toBe(1);
    expect(branch).toContain("return private.empty_self_subject_v1(p_account_id,s.id);");
    expect(preflight).toContain("(length(door)-length(replace(door,self_branch,'')))/length(self_branch)<>1");
    // The two later patches of the door replace other fragments only.
    for (const file of ["20261016220000_subject_delete_reviewed_document.sql", "20261016221000_subject_transfer.sql"]) {
      const sql = read(`supabase/migrations/${file}`);
      for (const fragment of [...sql.matchAll(/\$old\$([\s\S]*?)\$old\$/gu)].map(match => match[1]!)) {
        expect(branch.includes(fragment) || fragment.includes("s.subject_class='self'"), file).toBe(false);
      }
    }
  });

  it("refuses to run twice", () => {
    for (const signature of ["public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb)",
      "private.enqueue_self_withdrawal_notice_v1(uuid,uuid,jsonb,text)", "public.self_subject_withdrawal_readiness_v1(uuid,uuid)"]) {
      expect(preflight).toContain(`or to_regprocedure('${signature}') is not null`);
    }
  });
});

describe("the page's read refuses exactly where the emptying does", () => {
  const emptying = between(subjectDelete, "create function private.empty_self_subject_v1(", "$$;");
  const readiness = between(migration, "create function public.self_subject_withdrawal_readiness_v1(", "$$;");
  const condition = (text: string, message: string) => {
    const end = text.indexOf(message);
    expect(end, message).toBeGreaterThan(0);
    const start = text.lastIndexOf(" if exists(", end);
    return text.slice(start, text.lastIndexOf(" then", end));
  };

  it("reads unsupported on the emptying's own subject_delete_unsupported_graph predicate", () => {
    expect(condition(readiness, "return 'unsupported'")).toBe(condition(emptying, "message='subject_delete_unsupported_graph'"));
  });

  it("reads processing on the emptying's subject_delete_processing predicate, and on the per-file guard's for the two jobs the emptying leaves running", () => {
    const processing = condition(readiness, "return 'processing'");
    const refused = condition(emptying, "message='subject_delete_processing'");
    expect(processing.startsWith(refused)).toBe(true);
    expect(processing.slice(refused.length)).toBe("\n  or exists(select 1 from public.worker_jobs j where j.file_id=any(v_files) and j.status in ('queued','running')\n"
      + "   and j.kind in ('revoke_purge','retention_purge'))");
    expect(emptying).toContain("where status in ('queued','running') and kind not in ('revoke_purge','retention_purge')");
    expect(FILE_GUARD).toContain("select 1 from public.worker_jobs where file_id=f.id and status in ('queued','running')");
    // Unsupported is checked first, as the emptying checks it first.
    expect(readiness.indexOf("return 'unsupported'")).toBeLessThan(readiness.indexOf("return 'processing'"));
    expect(emptying.indexOf("subject_delete_unsupported_graph")).toBeLessThan(emptying.indexOf("subject_delete_processing"));
  });

  it("refuses another account's record as the emptying does, and writes nothing", () => {
    expect(readiness).toContain("returns text language plpgsql stable security definer set search_path=''");
    expect(readiness).not.toMatch(/\b(?:insert|update|delete)\s/iu);
    expect(readiness).toContain("or s.subject_account_id is distinct from p_account_id or s.lifecycle<>'active' then\n"
      + "  raise exception using errcode='42501',message='not_found'; end if;");
  });
});

describe("the door and the email", () => {
  const door = between(migration, "create function public.empty_self_subject_with_notice_v1(", "$$;");
  const notice = between(migration, "create function private.enqueue_self_withdrawal_notice_v1(", "$$;");

  it("checks the envelope and the class before anything, then runs the registered operation unchanged, then queues the email", () => {
    const order = ["raise exception using errcode='22023',message='invalid_request'", "v_class is distinct from 'self'",
      "public.delete_subject_v1(p_account_id,p_session_id,p_subject_id,p_nonce_hash,p_nonce_expires_at)",
      "v_result->>'case' is distinct from 'self'", "private.enqueue_self_withdrawal_notice_v1(p_account_id,p_subject_id,p_notice,p_nonce_hash)"];
    const at = order.map(fragment => door.indexOf(fragment));
    expect(at.every(index => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("queues one token-free 'upload-consent-withdrawn' row per spent nonce, which the mail worker and its template read", () => {
    expect(notice).toContain("values('upload-consent-withdrawn','upload-consent-withdrawn','subject',p_subject_id,principal.id,contact,");
    expect(notice).toContain("jsonb_build_object('withdrawnAt',v_now)");
    expect(notice).toContain("'upload-consent-withdrawn-v1|'||p_account_id::text||'|'||p_nonce_hash");
    expect(notice).toContain("mail_contact_revision=(p_notice->>'contactRevision')::bigint");
    const mailRoute = read("src/app/api/jobs/mail/route.ts");
    expect(mailRoute).toContain('if (templateId === "upload-consent-withdrawn") {');
    expect(mailRoute).toContain("z.object({ withdrawnAt: z.iso.datetime({ offset: true }) }).strict()");
    expect(read("src/lib/email.ts")).toContain('"upload-consent-withdrawn": UploadConsentWithdrawnProps;');
  });

  it("is reachable only as the migration grants it, and the route is its one caller", () => {
    expect(migration).toContain("grant execute on function public.empty_self_subject_with_notice_v1(uuid,uuid,uuid,text,timestamptz,jsonb) to service_role;");
    expect(migration).toContain("revoke all on function private.enqueue_self_withdrawal_notice_v1(uuid,uuid,jsonb,text)\n"
      + " from public,anon,authenticated,inherit_upload_only,service_role;");
    expect(migration).toContain("grant execute on function public.self_subject_withdrawal_readiness_v1(uuid,uuid) to service_role;");
    expect(read("src/app/api/subjects/[id]/route.ts")).toContain('admin.rpc("empty_self_subject_with_notice_v1", { ...args, p_notice: notice })');
    expect(read("src/lib/uploads/own-upload-withdrawal.ts")).toContain('admin.rpc("self_subject_withdrawal_readiness_v1", {');
  });

  it("is driven by its pgTAP suite through every refusal, the withdrawal, the email and the consent given again", () => {
    // 2026-11-20 (D-144): the suite now pins the self emptying at
    // 20261120100000's successor, which patches the body pinned here.
    for (const fragment of ["'subject_delete_processing'", "'subject_delete_unsupported_graph'", "'file_delete_processing'",
      "'withdrawal_notice_recipient_stale'", "'withdrawal_notice_unavailable'", "'invalid_operation_nonce'",
      "public.authorize_mail_submission_v1(", "public.claim_mail_outbox()", "'5c35b1a9eafbfe7fd3e16f54b648dee7'"]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    expect(pgtap.startsWith("begin;\n")).toBe(true);
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
  });

  it("is in the release notes of the guarded release it joins", () => {
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });
});
