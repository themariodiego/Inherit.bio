import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G8.5, Copilot for one other adult's record (owner decision of 19 November
 * 2026, "G8.5: Copilot for another adult's record opens";
 * 20261120130000_subject_copilot_scope.sql). The migration pins the bodies
 * it calls, adds the scope, its dispatcher and one purge trigger, and patches
 * one body in place under the md5-guarded convention: Path B's grant door
 * accepts copilot.local for the person who added the file. pg_get_functiondef
 * keeps a body verbatim, so the patched body and the two Family helpers
 * defined once are rebuilt here from the migration that defined them and
 * every md5 is recomputed. The pgTAP suites (supabase/tests/subject_copilot_scope.sql,
 * supabase/tests/subject_copilot_path_b.sql) drive the scope, the turns and
 * every way access ends against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261120130000_subject_copilot_scope.sql";
const migration = read(`supabase/migrations/${NAME}`);
const grantee = read("supabase/tests/subject_copilot_scope.sql");
const uploader = read("supabase/tests/subject_copilot_path_b.sql");
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
const header = (signature: string, returns: string, language: string, volatility: string) =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n LANGUAGE ${language}\n${volatility ? ` ${volatility} SECURITY DEFINER\n` : " SECURITY DEFINER\n"}`
  + " SET search_path TO 'pg_catalog'\n";

const PATH_B_GRANT = definition(read("supabase/migrations/20260930220000_path_b_reading_layer.sql"),
  "create function private.grant_path_b_purpose_v1(",
  header("private.grant_path_b_purpose_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_purpose text, "
    + "p_direction text, p_artifact_version integer, p_artifact_body_sha256 text, p_nonce_hash text, "
    + "p_expires_at timestamp with time zone, p_test_jurisdiction boolean)", "jsonb", "plpgsql", ""));
const FAMILY = read("supabase/migrations/20260929140000_family_copilot_scope.sql");
const DIRECTIONAL_GRANT = definition(FAMILY, "create function private.family_copilot_directional_grant_v1(",
  header("private.family_copilot_directional_grant_v1(p_owner uuid, p_subject uuid, p_recipient uuid, p_endpoints jsonb, p_purpose text)",
    "jsonb", "plpgsql", "STABLE"));
const TURN_STATE = definition(FAMILY, "create function private.family_copilot_turn_state_v1(",
  header("private.family_copilot_turn_state_v1(p_account uuid, p_chat uuid, p_turn uuid)", "text", "sql", "STABLE"));

const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const patchBlock = between(migration, "do $patch_copilot_choice$", "$patch_copilot_choice$;");
const OLD = between(patchBlock, "old_fragment constant text:=$old$", "$old$;");
const NEW = between(patchBlock, "new_fragment constant text:=$new$", "$new$;");
const body = (name: string) => between(migration, `create function ${name}(`, "$$;");

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose objects it calls, pins or patches", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260929140000", "20260930220000", "20260930236000", "20261009224500", "20261016181000",
      "20261016221000", "20261119160000", "20261120120000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    // 2026-11-22: 20261122100000 now follows it in release 4. What being the
    // newest guaranteed is that nothing later undoes it: the file is present,
    // and no later migration restates or patches a function it creates or
    // names its trigger (its pins and its patch are held by the "last word"
    // test below).
    expect(files).toContain(NAME);
    for (const file of files.filter(file => file > NAME)) {
      const sql = read(`supabase/migrations/${file}`);
      for (const created of ["subject_copilot_uploader_grant_v1", "subject_copilot_authority_v1", "subject_copilot_scope_v1",
        "subject_copilot_prune_v1", "subject_copilot_chat_v1", "purge_subject_copilot_chats_v1"]) {
        expect(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${created}\\s*\\(`, "iu").test(sql)
          || (sql.includes(`.${created}(`) && sql.includes("replace(definition")), `${file}: ${created}`).toBe(false);
      }
      expect(sql.includes("purge_subject_copilot_chats"), file).toBe(false);
    }
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });

  it("creates six functions and one trigger, patches one body, and adds no table, column, policy or constraint", () => {
    expect([...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1])).toEqual([
      "private.subject_copilot_uploader_grant_v1", "private.subject_copilot_authority_v1", "public.subject_copilot_scope_v1",
      "private.subject_copilot_prune_v1", "public.subject_copilot_chat_v1", "private.purge_subject_copilot_chats_v1"]);
    expect([...migration.matchAll(/^\s*(alter|drop|create)\s+(table|index|trigger|policy|type|constraint)\b[^\n]*/gimu)].map(match => match[0]))
      .toEqual(["create trigger purge_subject_copilot_chats after update of lifecycle on public.subjects for each row"]);
    expect(migration).not.toMatch(/\balter\s+table\b/iu);
    expect(count(migration, "execute replace(definition,old_fragment,new_fragment);")).toBe(1);
  });

  it("restates or patches nothing an earlier 19 or 20 November migration pins, so it undoes none of them", () => {
    for (const pinned of ["'private.adult_subject_invitation_response_v1(", "'private.confirm_path_b_subject_account_core_v1(",
      "'private.other_adult_mitigation_before_public_appeal_v1(", "'private.path_b_normalization_authority_v1(",
      "'public.claim_invitation_terminal_mail_v1(", "'public.authorize_invitation_terminal_mail_v1(",
      "'private.enqueue_path_b_normalization_v1(", "'public.delete_subject_v1(", "'private.delete_path_b_subject_for_route_v1(",
      "'private.empty_self_subject_v1(", "'private.invitation_notice_recipient_current_v1(", "consume_session_csrf_v1",
      "prepare_genome_file_deletion_body_v1", "restrict_embryo_cohort_core_v1"]) {
      expect(migration.includes(pinned), pinned).toBe(false);
    }
  });

  it("is the last word on nothing it pins or patches: no later migration restates or patches those bodies", () => {
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    // 2026-11-22: 20261122110000 (D-156, owner decision of 22 November 2026)
    // patches two of these bodies in place, each md5-guarded from exactly the
    // predecessor pinned here and with every line of it kept, to ask whether
    // the reader is the inviter of a held Path A acceptance. It is the only
    // later migration allowed to, and only for those two.
    const D156 = "20261122110000_adult_acceptance_inviter_reads.sql";
    const allowed: Record<string, string[]> = {
      "private.family_copilot_turn_state_v1": [D156], "private.family_report_recipient_v1": [D156] };
    for (const qualified of ["private.grant_path_b_purpose_v1", "private.other_adult_mitigation_v1",
      "private.family_copilot_directional_grant_v1", "private.family_copilot_turn_state_v1", "private.family_report_recipient_v1",
      "private.family_report_endpoints_v1", "private.path_b_result_read_v1", "private.delete_pair_derived_rows_v1"]) {
      expect(files.filter(file => file > NAME && rewrites(file, qualified)), qualified).toEqual(allowed[qualified] ?? []);
    }
    const d156 = read(`supabase/migrations/${D156}`);
    expect(d156).toContain("(1,'private.family_report_recipient_v1(uuid,uuid,uuid,text)','692a52e391045b96addc465c8afbce0e',");
    expect(d156).toContain("(5,'private.family_copilot_turn_state_v1(uuid,uuid,uuid)','ecaa3458595f82351127ec80e26cd4c2',");
    expect(d156).toContain("if (length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1 then");
  });
});

describe("the predecessor block and the patch", () => {
  it("pins the bodies it relies on to their md5 and ACL, and the chat target constraint that already admits a subject chat", () => {
    expect(md5(PATH_B_GRANT)).toBe("9489db2b7f1295f4d1ec114b6c40402a");
    expect(md5(DIRECTIONAL_GRANT)).toBe("b3a2114bf265870a2fad94337087d733");
    expect(md5(TURN_STATE)).toBe("ecaa3458595f82351127ec80e26cd4c2");
    for (const [signature, hash] of [
      ["private.grant_path_b_purpose_v1(uuid,uuid,uuid,text,text,integer,text,text,timestamptz,boolean)", "9489db2b7f1295f4d1ec114b6c40402a"],
      ["private.other_adult_mitigation_v1(uuid,uuid,text)", "c5d5145da3cd9d178ebc87ea6c19702a"],
      ["private.family_copilot_directional_grant_v1(uuid,uuid,uuid,jsonb,text)", "b3a2114bf265870a2fad94337087d733"],
      ["private.family_copilot_turn_state_v1(uuid,uuid,uuid)", "ecaa3458595f82351127ec80e26cd4c2"],
      ["private.family_report_recipient_v1(uuid,uuid,uuid,text)", "692a52e391045b96addc465c8afbce0e"],
      ["private.family_report_endpoints_v1(uuid,uuid,uuid,boolean)", "70683c77cef0f00c9803414a394fbd64"],
      ["private.path_b_result_read_v1(uuid,uuid,text)", "d39c35dab17636d453a18f41bde4ede4"],
      ["private.delete_pair_derived_rows_v1(uuid[],uuid,uuid[],text)", "8a094ce1d0a7ff92e00260204008dc07"],
    ]) {
      expect(preflight).toContain(`to_regprocedure('${signature}')`);
      expect(preflight).toContain(`md5(pg_get_functiondef(p.oid))='${hash}'`);
    }
    expect(preflight).toContain("conname='chats_scope_target_check' and c.contype='c' and c.convalidated)\n   is distinct from '62a1bbb1b82b05d2e9267e691f28cf99'");
    // The constraint it pins already admits scope_kind 'subject' with its subject and no other target.
    expect(read("supabase/migrations/20260929140000_family_copilot_scope.sql"))
      .toContain("(scope_kind in ('self', 'subject') and subject_id is not null and num_nonnulls(cohort_id, family_pair_id, report_id) = 0)");
    expect(preflight).toContain("raise exception using errcode='55000',message='subject copilot scope prerequisite differs'");
  });

  it("replays the one patch on its rebuilt predecessor to exactly the successor the migration asserts", () => {
    expect(count(PATH_B_GRANT, OLD)).toBe(1);
    const after = PATH_B_GRANT.replace(OLD, () => NEW);
    expect(md5(after)).toBe("31c75e79e6660f3ab92d2e640fca693f");
    expect(patchBlock).toContain("md5(pg_get_functiondef(p.oid))='9489db2b7f1295f4d1ec114b6c40402a'");
    expect(patchBlock).toContain("md5(pg_get_functiondef(p.oid))='31c75e79e6660f3ab92d2e640fca693f'");
    expect(patchBlock).toContain("and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner");
    // copilot.local, and only in the uploader direction; every other refusal of the door stands.
    expect(NEW).toContain("not in ('reports.monogenic','reports.polygenic','ancestry','copilot.local')");
    expect(NEW).toContain("or (p_purpose='copilot.local' and p_direction is distinct from 'uploader')");
    expect(after).toContain("c:=private.path_b_person_v1(p_account_id,p_session_id,p_subject_id);");
    expect(after).toContain("m:=private.other_adult_mitigation_v1(p_subject_id,(c->>'uploaderAccountId')::uuid,'purpose-grant-create');");
  });
});

describe("the scope and its conversations", () => {
  it("asks the mitigation decision first, then copilot.local, then each report layer, and reads no ancestry or variant", () => {
    const scope = body("private.subject_copilot_authority_v1");
    const uploaderBranch = scope.slice(scope.indexOf("if s.subject_class<>'other_adult'"));
    const order = ["m:=private.other_adult_mitigation_v1(s.id,p_account,'model-context-before-retrieval');",
      "v_copilot:=private.subject_copilot_uploader_grant_v1(s.id,'copilot.local'",
      "if private.path_b_result_read_v1(p_account,s.id,v_purpose)='{\"allowed\":true,\"gate\":\"ready\"}'::jsonb then"];
    const at = order.map(fragment => uploaderBranch.indexOf(fragment));
    expect(at.every(index => index > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const granteeBranch = scope.slice(0, scope.indexOf("if s.subject_class<>'other_adult'"));
    expect(granteeBranch.indexOf("'copilot.local');")).toBeLessThan(granteeBranch.indexOf("private.family_report_recipient_v1("));
    expect(count(scope, "array['reports.monogenic','reports.polygenic']")).toBe(2);
    expect(scope).not.toMatch(/ancestry|raw\.export|user_variants/u);
    // The decision alone says who may: anything but allow for an uploader is a hold or not found.
    expect(scope).toContain("if m->>'decision' is distinct from 'allow' then return jsonb_build_object('state','held'); end if;");
  });

  it("binds every turn to the record and its Copilot grant, refuses a cloud provider, and spends the page's token once", () => {
    const chat = body("public.subject_copilot_chat_v1");
    expect(chat).toContain("if v_provider->>'providerClass' is distinct from 'local'");
    expect(chat).toContain("v_purposes text[]:=array['copilot.local']");
    expect(chat).toContain("array[v_subject],v_purposes,array[(v_authority->>'accountId')::uuid],v_revisions,");
    expect(chat).toContain("values(p_account_id,'subject',v_subject,");
    expect(chat).toContain("jsonb_build_object('scope','subject-adult','relationship',v_authority->>'case','provider',v_provider)");
    expect(chat).toContain("exception when unique_violation then raise exception using errcode='42501',message='not_found';");
    expect(chat).toContain("private.valid_family_copilot_citations_v1(p_payload->'citations') is not true");
    // The prune hides a held record's conversations; only ended turns are deleted.
    const prune = body("private.subject_copilot_prune_v1");
    expect(prune).toContain("private.other_adult_mitigation_v1(s.id,p_account,'derived-write-and-read')");
  });

  it("purges a purged other_adult record's conversations through the shared revocation purge", () => {
    const purge = body("private.purge_subject_copilot_chats_v1");
    expect(purge).toContain("perform private.delete_pair_derived_rows_v1('{}'::uuid[],v_reader,array[new.id],null);");
    expect(purge).toContain("delete from public.chats where id=any(v_chats);");
    expect(migration).toContain("when (new.lifecycle='purged' and old.lifecycle<>'purged' and new.subject_class='other_adult')");
  });

  it("keeps every new function off the browser roles", () => {
    expect(migration).toContain("revoke all on function private.subject_copilot_uploader_grant_v1(uuid,text,uuid,uuid,bigint,bigint,uuid,uuid,uuid,bigint),");
    expect(migration).toContain(" from public,anon,authenticated,inherit_upload_only,service_role;");
    expect(migration).toContain("grant execute on function public.subject_copilot_scope_v1(uuid,uuid,uuid),\n public.subject_copilot_chat_v1(text,uuid,uuid,uuid,uuid,jsonb)\n to service_role;");
  });

  it("is wired: the chat route, the history route and the Path B door call these doors", () => {
    expect(read("src/lib/copilot/subject-chat.ts")).toContain("rpc()('subject_copilot_chat_v1'");
    expect(read("src/lib/copilot/subject-chat.ts")).toContain("rpc()('subject_copilot_scope_v1'");
    expect(read("src/app/api/chat/route.ts")).toContain("if (await isSubjectChatRequest(raw)) return subjectChatResponse(request, raw, { refusal: refusalResponse });");
    expect(read("src/app/api/chats/[id]/route.ts")).toContain("?? await readSubjectChatHistory(id);");
    expect(read("src/lib/uploads/path-b-purpose.ts")).toContain('export const PATH_B_CHOICE_PURPOSES = [...PATH_B_PURPOSES, "copilot.local"] as const;');
  });

  it("is driven by its pgTAP suites through every gate and every way access ends", () => {
    for (const [suite, fragments] of [[grantee, ["copilot.local is signed by the exact current adult subject principal",
      "a pause closes the scope", "a revoked copilot.local closes the scope", "with its only layer withdrawn",
      "stopping sharing", "when B empties their record", "when B withdraws their own-file consent", "a turn never commits under a cloud provider",
      "the page context is single use", "an authority for B cannot be checked against another person's record".replace("'", "''")]],
    [uploader, ["the uploader cannot sign the person''s Copilot choice for themselves", "from 30 days the mitigation decision holds the record",
      "the person turning Copilot off closes the scope", "every conversation about the purged record is deleted",
      "the uploader''s withdrawal is refused for a record the person holds", "a turn never commits under a cloud provider"]]] as const) {
      for (const fragment of fragments) expect(suite, fragment).toContain(fragment);
      expect(suite.trimEnd().endsWith("rollback;")).toBe(true);
    }
  });
});
