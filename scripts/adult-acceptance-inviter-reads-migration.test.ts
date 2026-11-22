import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-156: the 72-hour hold and the 30-day reminder cover an inviter's reads of
 * the invited adult's own record (20261122110000_adult_acceptance_inviter_reads.sql;
 * owner decision of 22 November 2026, docs/protocol/decisions.md). The
 * migration adds one question and the Family graph's door to it, and patches
 * five Family readers in place under the md5-guarded convention.
 * pg_get_functiondef keeps a body verbatim, so each predecessor is rebuilt
 * here from the migration that defined it and every md5 (predecessor and
 * successor) is recomputed. The pgTAP suite
 * (supabase/tests/adult_acceptance_inviter_reads.sql) drives every reader
 * through the hold, the release, the reminder and the cases it must not touch.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122110000_adult_acceptance_inviter_reads.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/adult_acceptance_inviter_reads.sql");
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
const header = (signature: string, returns: string, language: string, volatility: string, searchPath: string) =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n LANGUAGE ${language}\n`
  + `${volatility ? ` ${volatility} SECURITY DEFINER\n` : " SECURITY DEFINER\n"} SET search_path TO ${searchPath}\n`;
function apply(text: string, [old, next]: [string, string]): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}

// Each predecessor from the one migration that defined it; no later migration
// restated or patched any of them before this one (asserted below).
const RECIPIENT = definition(read("supabase/migrations/20260907124212_family_shared_report_results.sql"),
  "create function private.family_report_recipient_v1(",
  header("private.family_report_recipient_v1(p_account uuid, p_session uuid, p_subject uuid, p_purpose text)", "jsonb", "plpgsql", "",
    "'pg_catalog'"));
const ANCESTRY = definition(read("supabase/migrations/20260915120846_family_ancestry_shared_authority.sql"),
  "create function private.family_ancestry_recipient_v1(",
  header("private.family_ancestry_recipient_v1(p_account uuid, p_session uuid, p_subject uuid, p_purpose text)", "jsonb", "plpgsql", "",
    "'pg_catalog'"));
const DIRECTION = definition(read("supabase/migrations/20260907153506_health_picture_canonical_results.sql"),
  "create function private.health_picture_direction_v1(",
  header("private.health_picture_direction_v1(p_viewer uuid, p_session uuid, p_account uuid, p_subject uuid, p_purpose text)",
    "jsonb", "plpgsql", "", "'pg_catalog'"));
const PORTRAIT = definition(read("supabase/migrations/20260923101135_family_portrait_navigation.sql"),
  "create function private.family_portrait_authority_v1(",
  header("private.family_portrait_authority_v1(p_account_id uuid, p_session_id uuid, p_pair_id uuid, p_counterpart_account_id uuid)",
    "jsonb", "plpgsql", "", "'pg_catalog'"));
const TURN_STATE = definition(read("supabase/migrations/20260929140000_family_copilot_scope.sql"),
  "create function private.family_copilot_turn_state_v1(",
  header("private.family_copilot_turn_state_v1(p_account uuid, p_chat uuid, p_turn uuid)", "text", "sql", "STABLE", "'pg_catalog'"));
const CLOCK_STATE = definition(read("supabase/migrations/20261120120000_adult_acceptance_hold_and_renotice.sql"),
  "create function private.adult_acceptance_clock_state_v1(",
  header("private.adult_acceptance_clock_state_v1(p_invitation_id uuid)", "jsonb", "sql", "STABLE", "''"));

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const patchBlock = between(migration, "do $patch_inviter_reads$", "$patch_inviter_reads$;");
const patches: Patch[] = [...patchBlock.matchAll(
  /\((\d+),'([^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/gu,
)].map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
  old: match[6]!, next: match[7]!, label: match[8]! }));
const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const question = between(migration, "create function private.adult_acceptance_inviter_held_v1(", "$$;");
const door = between(migration, "create function public.adult_acceptance_inviter_held_subjects_v1(", "end $$;");
const TARGETS = ["private.family_report_recipient_v1(uuid,uuid,uuid,text)", "private.family_ancestry_recipient_v1(uuid,uuid,uuid,text)",
  "private.health_picture_direction_v1(uuid,uuid,uuid,uuid,text)", "private.family_portrait_authority_v1(uuid,uuid,uuid,uuid)",
  "private.family_copilot_turn_state_v1(uuid,uuid,uuid)"];
const SUCCESSORS = ["5e36eec0ee7f83911fd0966730081145", "9ba008dab0144ba55a6ac57fb68f7172", "d496bc699608053982ded60110a64628",
  "437d6400ed4b83a6cb1da08be2195abf", "3ed921e9d872a5c557389a126a1af7ff"];

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose objects it calls, pins or patches", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260907124212", "20260907153506", "20260915120846", "20260923101135", "20260929140000",
      "20261120120000", "20261120130000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });

  it("creates two functions and patches five bodies, and adds no table, column, trigger, policy or constraint", () => {
    expect([...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1])).toEqual([
      "private.adult_acceptance_inviter_held_v1", "public.adult_acceptance_inviter_held_subjects_v1"]);
    expect(migration).not.toMatch(/^\s*(alter|drop|create)\s+(table|index|trigger|policy|type|constraint|view)\b/gimu);
    expect(migration).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from)\b/iu);
    expect(patches.map(patch => patch.target)).toEqual(TARGETS);
    expect(patches.map(patch => patch.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(count(migration, "execute replace(definition,item.old_fragment,item.new_fragment);")).toBe(1);
  });

  it("touches nothing another 22 November change or an earlier 19 or 20 November migration owns", () => {
    // The transfer, the other-adult withdrawal door, the subject delete and the
    // one-record Copilot purge belong to another change of the same day; the
    // acceptance clocks and the mitigation decision belong to 20261120120000.
    for (const owned of ["transfer_subject", "withdraw_other_adult_upload", "delete_subject_v1", "purge_subject_copilot_chats",
      "other_adult_mitigation", "start_adult_acceptance_clocks_v1", "run_due_adult_acceptance_notices_v1",
      "settle_adult_acceptance_notice_v1", "adult_acceptance_notice_current_v1", "subject_copilot_authority_v1",
      "family_copilot_member_v1", "family_copilot_directional_grant_v1", "family_report_endpoints_v1", "empty_self_subject_v1",
      "consume_session_csrf", "restrict_embryo_cohort_core_v1", "grant_path_b_purpose_v1", "path_b_result_read_v1"]) {
      expect(migration.includes(owned), owned).toBe(false);
    }
  });

  it("is the last word on what it patches and adds: no later migration restates or patches those bodies", () => {
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    for (const qualified of [...TARGETS.map(target => target.slice(0, target.indexOf("("))),
      "private.adult_acceptance_inviter_held_v1", "public.adult_acceptance_inviter_held_subjects_v1",
      "private.adult_acceptance_clock_state_v1"]) {
      expect(files.filter(file => file > NAME && rewrites(file, qualified)), qualified).toEqual([]);
    }
  });
});

describe("the predecessor block and the patches", () => {
  it("pins every body it patches or reads to the md5 recomputed from its source, and to its ACL", () => {
    const pins: [string, string][] = [
      [TARGETS[0]!, md5(RECIPIENT)], [TARGETS[1]!, md5(ANCESTRY)], [TARGETS[2]!, md5(DIRECTION)], [TARGETS[3]!, md5(PORTRAIT)],
      [TARGETS[4]!, md5(TURN_STATE)], ["private.adult_acceptance_clock_state_v1(uuid)", md5(CLOCK_STATE)]];
    expect(pins.map(([, hash]) => hash)).toEqual(["692a52e391045b96addc465c8afbce0e", "5d379a615e41ef4a05ce84f1c8455d51",
      "5433a806e2f7ff6319dd2989a677b130", "1ff3da517b6bc473985e8fd3e073bcaa", "ecaa3458595f82351127ec80e26cd4c2",
      "6f566115c807f64e1c2a9413f2669fe1"]);
    for (const [signature, hash] of pins) {
      expect(preflight).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${hash}' and p.proacl::text='{postgres=X/postgres}')`);
    }
    // The two bodies 20261120130000 pins are pinned here at the same md5, so this patches exactly what it relied on.
    const subjectScope = read("supabase/migrations/20261120130000_subject_copilot_scope.sql");
    expect(subjectScope).toContain("md5(pg_get_functiondef(p.oid))='692a52e391045b96addc465c8afbce0e'");
    expect(subjectScope).toContain("md5(pg_get_functiondef(p.oid))='ecaa3458595f82351127ec80e26cd4c2'");
    expect(preflight).toContain("to_regprocedure('private.adult_acceptance_inviter_held_v1(uuid,uuid)') is not null");
    expect(preflight).toContain("raise exception using errcode='55000',message='adult acceptance inviter reads prerequisite differs'");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration and the pgTAP suite assert", () => {
    const current = new Map<string, string>([[TARGETS[0]!, RECIPIENT], [TARGETS[1]!, ANCESTRY], [TARGETS[2]!, DIRECTION],
      [TARGETS[3]!, PORTRAIT], [TARGETS[4]!, TURN_STATE]]);
    for (const patch of patches) {
      const before = current.get(patch.target)!;
      expect(md5(before), patch.label).toBe(patch.before);
      expect(patch.acl, patch.label).toBe("{postgres=X/postgres}");
      const after = apply(before, [patch.old, patch.next]);
      expect(md5(after), patch.label).toBe(patch.after);
      current.set(patch.target, after);
    }
    expect(patches.map(patch => patch.after)).toEqual(SUCCESSORS);
    for (const hash of SUCCESSORS) expect(pgtap).toContain(hash);
    expect(patchBlock).toContain("and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner");
  });

  it("only adds the question to each reader: every predecessor line survives, and each answers as with no grant", () => {
    for (const patch of patches) {
      // Nothing the reader already checked is removed or reordered.
      for (const line of patch.old.split("\n").filter(Boolean)) {
        const kept = line.replace("    and private.family_sharing_paused_v1", "    and (private.family_sharing_paused_v1")
          .replace(" is not false) then 'paused'", " is not false");
        expect(patch.next, `${patch.label}: ${line}`).toContain(kept);
      }
      expect(count(patch.next, "private.adult_acceptance_inviter_held_v1("), patch.label).toBe(1);
      expect(patch.next, patch.label).toContain("20261122110000 (D-156)");
    }
    const [recipient, ancestry, direction, portrait, turnState] = patches;
    for (const reader of [recipient!, ancestry!]) {
      expect(reader.next).toContain("if private.adult_acceptance_inviter_held_v1(p_account,p_subject) then\n"
        + "  raise exception using errcode='42501',message='not_found'; end if;");
    }
    // Health picture asks for the viewer's own inbound direction only: the adult's own view of the pair is never held.
    expect(direction!.next).toContain("if p_account=p_viewer and private.adult_acceptance_inviter_held_v1(p_account,p_subject) then");
    // Portrait asks for the reader's counterpart's record, and answers null as with no grant.
    expect(portrait!.next).toContain("private.adult_acceptance_inviter_held_v1(p_account_id,\n"
      + "   case when a.subject_account_id=p_account_id then b.id else a.id end) then return null; end if;");
    // The turn state reads a held turn as paused (unreadable, nothing deleted), never as ended (deleted).
    expect(turnState!.next).toContain("or private.adult_acceptance_inviter_held_v1(p_account,s.id))) then 'paused'");
    expect(turnState!.next).not.toContain("'ended'");
  });
});

describe("the question and its door", () => {
  it("holds only the inviter of a Path A acceptance, for the invited adult's own record, from the clocks the acceptance recorded", () => {
    expect(question).toContain("returns boolean language sql stable security definer set search_path=''");
    // The subject is another account's own record; the reader is that acceptance's inviter; never the adult.
    expect(question).toContain("where d.id=p_subject_id and d.subject_class='self' and d.subject_account_id<>p_reader_account_id");
    expect(question).toContain("join public.subject_principals ip on ip.id=i.inviter_principal_id and ip.account_id=p_reader_account_id");
    expect(question).toContain("join public.subjects t on t.subject_account_id=d.subject_account_id and t.subject_class='other_adult'");
    // Path A only: a Path B record keeps its draft.
    expect(question).toContain("and not exists(select 1 from public.adult_subject_drafts x where x.subject_id=t.id)");
    // The clocks 20261120120000 records, read through its own reader, and the decision's own two boundaries.
    expect(question).toContain("private.adult_acceptance_clock_state_v1(i.id)");
    expect(question).toContain("else (k.clock->>'held')::boolean\n"
      + "      and (clock_timestamp()<i.accepted_at+interval '72 hours' or not (k.clock->>'holdReleased')::boolean) end");
    expect(question).toContain("or (clock_timestamp()>=i.accepted_at+interval '30 days'\n"
      + "     and not coalesce((k.clock->>'reNoticeDone')::boolean,false))");
    // An acceptance with no clock keeps the decision's creation-time comparison.
    expect(question).toContain("then coalesce((select u.created_at from auth.users u where u.id=d.subject_account_id)>=i.created_at,true)");
    expect(question).not.toMatch(/current_setting|request\.|insert|update|delete/iu);
    expect(migration).toContain("revoke all on function private.adult_acceptance_inviter_held_v1(uuid,uuid)\n"
      + " from public,anon,authenticated,inherit_upload_only,service_role;");
  });

  it("gives the Family graph a bounded, service-only door that answers only which records, never why", () => {
    expect(door).toContain("if p_account_id is null or p_subject_ids is null or cardinality(p_subject_ids)>1000 then");
    expect(door).toContain("where private.adult_acceptance_inviter_held_v1(p_account_id,x.id));");
    expect(migration).toContain("revoke all on function public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[])\n"
      + " from public,anon,authenticated,inherit_upload_only;\n"
      + "grant execute on function public.adult_acceptance_inviter_held_subjects_v1(uuid,uuid[]) to service_role;");
    const graph = read("src/lib/family/graph.ts");
    expect(graph).toContain('rpc("adult_acceptance_inviter_held_subjects_v1", {');
    expect(graph).toContain("heldSharedSubjectIds,\n  };");
    // The Portrait page reads its pair's grants itself, so it asks the same question.
    expect(read("src/lib/family/portrait.ts")).toContain(
      "await readHeldSharedSubjects(admin.rpc.bind(admin) as unknown as HeldSharedSubjectsRpc, viewerAccountId, [other.id])");
  });

  it("is driven by its pgTAP suite through the hold, the release, the reminder and every reader", () => {
    for (const fragment of ["(hold) A, who invited B, reads nothing B shares", "(hold) C, whom B also shares with, reads normally",
      "(hold) B''s own Health picture beside A opens", "(hold) B reads their own saved report", "(71 h 59 m)",
      "(72 h) with the second notice unsent", "(72 h) queued but not accepted by the provider", "(released) A reads what B shares",
      "(30 d) from 30 days A reads nothing B shares", "(30 d) A''s conversation about B is unreadable", "(30 d) nothing is deleted",
      "(reminded) A reads what B shares again, with no job run", "never released without the notice",
      "(existing) at 72 hours, with no notice of any kind, E is not held", "(unrecorded)", "(Path B)",
      "public.family_shared_report_results_v1(", "public.confirm_family_shared_report_results_v1(", "private.family_ancestry_recipient_v1(",
      "private.health_picture_context_v1(", "private.family_portrait_authority_v1(", "public.family_copilot_scope_v1(",
      "public.subject_copilot_scope_v1(", "public.subject_copilot_chat_v1(", "public.adult_acceptance_inviter_held_subjects_v1("]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    expect(pgtap.startsWith("-- ")).toBe(true);
    expect(pgtap).toContain("\nbegin;\n");
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
