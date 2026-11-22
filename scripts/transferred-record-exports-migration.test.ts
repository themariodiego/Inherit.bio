import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A record transferred to its person is theirs to export (D-162), a hand-over
 * refused at that moment says so (D-158), and the hand-over's audit event is
 * on the closed list of person-caused events (D-159):
 * 20261122160000_transferred_record_exports.sql. The migration creates two
 * read helpers and patches five bodies in place under the md5-guarded
 * convention. pg_get_functiondef keeps a body verbatim, so each body is
 * rebuilt here from the migration that last defined it (replaying
 * 20261122100000's patches on the transfer), every md5 the migration names is
 * recomputed, and each of its fourteen patches is replayed; a body several
 * migrations wrote is traced to the md5 the last of them asserts. The pgTAP
 * suite (supabase/tests/transferred_record_exports.sql) drives it against a
 * real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122160000_transferred_record_exports.sql";
const migration = read(`supabase/migrations/${NAME}`);
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
const pgtap = read("supabase/tests/transferred_record_exports.sql");

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
  const close = source.indexOf(open[1], bodyStart); // a dollar-quoted body ends at the first repeat of its tag
  return `${header}AS $function$${source.slice(bodyStart, close)}$function$\n`;
}
const header = (signature: string, returns: string, rest = " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n") =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n${rest}`;
function apply(text: string, old: string, next: string): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}
interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string }
function patchesOf(block: string): Patch[] {
  return [...block.matchAll(/\((\d+),'([^']+)','([0-9a-f]{32})',\n {3}'([0-9a-f]{32})','(\{[^}]+\})',\n {3}\$old\$([\s\S]*?)\$old\$,\n {3}\$new\$([\s\S]*?)\$new\$/gu)]
    .map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
      old: match[6]!, next: match[7]! }));
}

const READABLE_GRAPH = read("supabase/migrations/20261001039000_account_archive_readable_graph.sql");
const TRANSFER_SOURCE = read("supabase/migrations/20261016221000_subject_transfer.sql");
const HAND_OVER_SOURCE = read("supabase/migrations/20261122100000_uploader_withdrawal_hands_record_to_adult.sql");
const READABLE = definition(READABLE_GRAPH, "create function private.export_account_ordinary_readable_authority_v1(",
  header("private.export_account_ordinary_readable_authority_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)", "jsonb",
    " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n"));
const SNAPSHOT = definition(READABLE_GRAPH, "create function private.export_account_path_b_snapshot_v1(",
  header("private.export_account_path_b_snapshot_v1(p_origin jsonb, p_subject uuid)", "jsonb",
    " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n SET lock_timeout TO '250ms'\n SET extra_float_digits TO '3'\n"));
const PATH_B_FILE = definition(READABLE_GRAPH, "create function private.export_account_path_b_file_v1(",
  header("private.export_account_path_b_file_v1(p_file uuid)", "boolean",
    " LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n SET lock_timeout TO '250ms'\n"));
const OWN_SOURCE = definition(read("supabase/migrations/20260909001117_own_prepared_original_retirement.sql"),
  "create or replace function private.own_export_source_v1(",
  header("private.own_export_source_v1(p_account_id uuid, p_session_id uuid, p_file_id uuid)", "jsonb",
    " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'private'\n"));
const BINDING_CURRENT = definition(TRANSFER_SOURCE, "create function private.transferred_report_binding_current_v1(",
  header("private.transferred_report_binding_current_v1(p_binding_id uuid, p_account_id uuid)", "boolean",
    " LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n"));
const transferSignature = "private.transfer_subject_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, "
  + "p_nonce_hash text, p_nonce_expires_at timestamp with time zone)";
/** The transfer as 20261122100000 left it: 20261016221000's body with that migration's eight patches replayed. */
const TRANSFER = patchesOf(between(HAND_OVER_SOURCE, "do $patch_handover$", "$patch_handover$;"))
  .filter(patch => patch.target.startsWith("private.transfer_subject_v1("))
  .reduce((text, patch) => {
    expect(md5(text)).toBe(patch.before);
    return apply(text, patch.old, patch.next);
  }, definition(TRANSFER_SOURCE, "create function private.transfer_subject_v1(", header(transferSignature, "jsonb")));

const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const postflight = between(migration, "do $postflight$", "$postflight$;");
const patches = patchesOf(between(migration, "do $patch_transferred$", "$patch_transferred$;"));
const PERSON = between(migration, "create function private.transferred_export_person_v1(", "end $$;");
const CONFIRMATION = between(migration, "create function private.transferred_export_confirmation_v1(", "end $$;");
const BASES: Record<string, string> = {
  "private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)": READABLE,
  "private.export_account_path_b_snapshot_v1(jsonb,uuid)": SNAPSHOT,
  "private.own_export_source_v1(uuid,uuid,uuid)": OWN_SOURCE,
  "private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)": TRANSFER,
};
/** Each body after this migration's patches, replayed from its rebuilt predecessor. */
const successors = new Map<string, string>();
for (const patch of patches) {
  const base = successors.get(patch.target) ?? BASES[patch.target];
  if (base === undefined) continue; // the person-event list is traced below
  successors.set(patch.target, apply(base, patch.old, patch.next));
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

describe("the release it belongs to", () => {
  it("is a guarded production release after every migration whose bodies it patches or calls, and after the switch", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260909001117", "20261001039000", "20261016221000", "20261119170000", "20261122100000",
      "20261122120000", "20261122130000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(files.filter(file => file.startsWith("20261122160000_"))).toEqual([NAME]);
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(`# Release notes: \`${NAME}\``);
  });

  it("creates the two read helpers, patches five bodies in fourteen anchors, and nothing else", () => {
    expect([...migration.matchAll(/^create (?:or replace )?function ([a-z0-9_.]+)\(/gmu)].map(match => match[1]))
      .toEqual(["private.transferred_export_person_v1", "private.transferred_export_confirmation_v1"]);
    expect(migration).not.toMatch(/^\s*(alter|drop|create)\s+(table|index|trigger|policy|type|view|schema)\b/gimu);
    expect([...migration.matchAll(/^(grant|revoke)[^;]*;/gmu)].map(match => match[0].replace(/\s+/gu, " "))).toEqual([
      "revoke all on function private.transferred_export_person_v1(uuid,uuid,uuid) from public,anon,authenticated,inherit_upload_only,service_role;",
      "revoke all on function private.transferred_export_confirmation_v1(uuid) from public,anon,authenticated,inherit_upload_only,service_role;"]);
    expect(patches.map(patch => `${patch.ordinal} ${patch.target}`)).toEqual([
      "1 private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)",
      "2 private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)",
      "3 private.export_account_path_b_snapshot_v1(jsonb,uuid)", "4 private.export_account_path_b_snapshot_v1(jsonb,uuid)",
      "5 private.export_account_path_b_snapshot_v1(jsonb,uuid)",
      ...[6, 7, 8, 9, 10].map(ordinal => `${ordinal} private.own_export_source_v1(uuid,uuid,uuid)`),
      ...[11, 12, 13].map(ordinal => `${ordinal} private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)`),
      "14 private.legal_audit_person_event_v1(text,text)"]);
    // Not the switch, not the doors, not an export door: those are untouched.
    for (const untouched of ["subject_transfer_open_v1", "'public.transfer_subject_v1(", "'public.withdraw_other_adult_upload_v1(",
      "export_archive_request_v1", "export_archive_current_v1", "generated_exports set", "inherit.subject_transfer_withdrawal"]) {
      expect(migration.includes(untouched), untouched).toBe(false);
    }
  });
});

describe("the predecessor block, the patches and the postflight", () => {
  it("pins every body it patches or calls to the md5 recomputed from its source (or traced), with its ACL", () => {
    const pins: [string, string, string][] = [
      ["private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)", md5(READABLE), "{postgres=X/postgres}"],
      ["private.export_account_path_b_snapshot_v1(jsonb,uuid)", md5(SNAPSHOT), "{postgres=X/postgres}"],
      ["private.own_export_source_v1(uuid,uuid,uuid)", md5(OWN_SOURCE), "{postgres=X/postgres,service_role=X/postgres}"],
      ["private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)", md5(TRANSFER), "{postgres=X/postgres}"],
      ["private.legal_audit_person_event_v1(text,text)", "73bd0200b7e272bec503eab70499e877", "{postgres=X/postgres}"],
      ["private.export_account_path_b_file_v1(uuid)", md5(PATH_B_FILE), "{postgres=X/postgres}"],
      ["private.transferred_report_binding_current_v1(uuid,uuid)", md5(BINDING_CURRENT), "{postgres=X/postgres}"],
      ["private.path_b_person_v1(uuid,uuid,uuid)", "9f0434499b394a5c8ece4151838918e3", "{postgres=X/postgres}"],
      ["private.path_b_subject_v1(uuid,uuid)", "d174a83682e35479797ac7e738a65d79", "{postgres=X/postgres,service_role=X/postgres}"],
      ["private.path_b_account_current_v1(uuid)", "6372a00f8c0f10e512a31dcf7455333b", "{postgres=X/postgres}"],
    ];
    for (const [signature, digest, acl] of pins) {
      expect(preflight, signature).toMatch(new RegExp(`to_regprocedure\\('${escape(signature)}'\\)\\n\\s+and md5\\(pg_get_functiondef\\(p\\.oid\\)\\)='${
        digest}'(?:\\s+and p\\.proacl::text='${escape(acl)}')`, "u"));
    }
    // The md5s rebuilt from source are the ones the migrations that last wrote these bodies assert.
    expect(md5(READABLE)).toBe("611957debd6025a4f5c4710a596d67cf");
    expect(md5(SNAPSHOT)).toBe("4cc6a1afc5be8b0d8163f3c14a6f23e8");
    expect(md5(OWN_SOURCE)).toBe("27abc582be0eb4a227a7cdeb57c29d6f");
    expect(read("supabase/migrations/20261122130000_file_delete_live_exports_only.sql")).toContain("'27abc582be0eb4a227a7cdeb57c29d6f'");
    expect(md5(TRANSFER)).toBe("e481de5f5eab53b6c596da66bc7b30fa");
    expect(HAND_OVER_SOURCE).toContain("'e481de5f5eab53b6c596da66bc7b30fa'");
    expect(read("supabase/migrations/20261119170000_embryo_uploader_consent_withdrawal.sql")).toContain("'73bd0200b7e272bec503eab70499e877'");
    // Bodies several migrations wrote, pinned by the md5 the database holds today; no migration since this
    // release's base rewrites them (the earlier tests' own detector).
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    for (const qualified of ["private.path_b_person_v1", "private.path_b_subject_v1", "private.path_b_account_current_v1",
      "private.export_account_path_b_file_v1", "private.transferred_report_binding_current_v1"]) {
      expect(files.filter(file => file > "20261016221000_subject_transfer.sql" && file < NAME && rewrites(file, qualified)), qualified)
        .toEqual([]);
    }
    expect(preflight).toContain("raise exception using errcode='55000',message='transferred record exports prerequisite differs'");
    expect(preflight).toContain("to_regprocedure('private.transferred_export_person_v1(uuid,uuid,uuid)') is not null");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration asserts", () => {
    const seen = new Map<string, string>();
    for (const patch of patches) {
      if (patch.target === "private.legal_audit_person_event_v1(text,text)") {
        expect(patch.before).toBe("73bd0200b7e272bec503eab70499e877");
        continue;
      }
      const base = seen.get(patch.target) ?? BASES[patch.target]!;
      expect(md5(base), `${patch.ordinal} before`).toBe(patch.before);
      const next = apply(base, patch.old, patch.next);
      expect(md5(next), `${patch.ordinal} after`).toBe(patch.after);
      seen.set(patch.target, next);
    }
    for (const [target, body] of successors) {
      expect(postflight, target).toContain(`md5(pg_get_functiondef(p.oid))='${md5(body)}'`);
    }
    expect(postflight).toContain(`md5(pg_get_functiondef(p.oid))='${patches[13]!.after}'`);
    expect(postflight).toContain("raise exception using errcode='55000',message='transferred record exports successor differs'");
  });

  it("marks every change with this migration and its defect, and keeps every other statement of each body", () => {
    for (const patch of patches) {
      if (patch.ordinal === 6 || patch.ordinal === 10) continue; // declarations; one value
      expect(patch.next, String(patch.ordinal)).toMatch(/20261122160000 \(D-1(58|59|62)\)/u);
    }
    for (const [target, body] of successors) {
      const before = BASES[target]!.split("\n");
      const olds = patches.filter(patch => patch.target === target).flatMap(patch => patch.old.split("\n")).filter(line => line.trim());
      const kept = before.filter(line => !olds.some(old => line.includes(old)));
      expect(kept.length, target).toBeGreaterThan(before.length - 40);
      for (const line of kept) expect(body.split("\n"), `${target}: ${line}`).toContain(line);
    }
  });
});

describe("D-162: a record transferred to its person is theirs to export", () => {
  it("answers for a transferred record what the two Path B helpers answer before a transfer, with no uploader identity", () => {
    expect(PERSON).toContain("and lifecycle='active' and ownership_transferred_at is not null\n"
      + "  and owner_account_id=p_account_id and subject_account_id=p_account_id for share;");
    expect(PERSON).toContain("select * into t from private.subject_ownership_transfers where subject_id=s.id and to_account_id=p_account_id;");
    expect(PERSON).toContain("d.owner_account_id=t.from_account_id and d.adult_flow='path-b-subject-esignature' and d.state='confirmed'");
    expect(PERSON).toContain("if not found or not private.path_b_account_current_v1(p_account_id) then");
    expect(PERSON).toContain("'uploaderAccountId',null,'uploaderPrincipalId',null");
    expect(CONFIRMATION).toContain("and adult_flow='path-b-subject-esignature' and evidence_kind='esignature' and state='confirmed' for share;");
    expect(CONFIRMATION).toContain("and cs.purpose='adult-subject-path-b-confirmation' and cs.subject_binding_revision=s.subject_binding_revision");
    // The keys the two captures read, in the same shape as the Path B helpers'.
    for (const key of ["subjectId", "subjectBindingRevision", "principalId", "principalRevision", "jurisdictionCode", "jurisdictionRevision"]) {
      expect(PERSON, key).toContain(`'${key}'`);
    }
    for (const key of ["subjectBindingRevision", "subjectLifecycleRevision", "principalId", "principalRevision", "contactReferenceId",
      "confirmationSignatureId"]) {
      expect(CONFIRMATION, key).toContain(`'${key}'`);
    }
  });

  it("asks them only for a transferred record; every other record reads exactly as before", () => {
    const readable = successors.get("private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)")!;
    expect(readable).toContain("   if s.ownership_transferred_at is not null then\n    person:=private.transferred_export_person_v1(a,sess,s.id);\n"
      + "    confirmation:=private.transferred_export_confirmation_v1(s.id);\n   else\n    person:=private.path_b_person_v1(a,sess,s.id);\n"
      + "    confirmation:=private.path_b_subject_v1(s.owner_account_id,s.id);\n   end if;");
    const snapshot = successors.get("private.export_account_path_b_snapshot_v1(jsonb,uuid)")!;
    expect(snapshot).toContain("   if not private.transferred_report_binding_current_v1(b.id,(p_origin->>'accountId')::uuid) then");
    expect(snapshot).toContain("  and s.ownership_transferred_at is null\n  and not exists(");
    expect(count(snapshot, "a:=private.path_b_report_authority_v1(b.file_id,b.grant_id,'export-source-read');")).toBe(1);
    const own = successors.get("private.own_export_source_v1(uuid,uuid,uuid)")!;
    expect(own).toContain(" if b.id is null and s.subject_class='other_adult' and s.ownership_transferred_at is not null\n"
      + "  and s.owner_account_id=p_account_id and f.user_id=p_account_id\n"
      + "  and not exists(select 1 from private.genome_file_deletions d where d.file_id=f.id) then");
    expect(own).toContain("and new_owner_account_id=p_account_id and state in ('queued','copying');");
    expect(own).toContain("and obj.name=r.old_object_key and obj.name=f.bucket_path and r.sha256=f.sha256 and r.byte_count=f.size_bytes");
    expect(own).toContain(" if not found and transferred and f.storage_object_id is null then");
    expect(own).toContain(" if transferred and not normalized then");
    expect(own).toContain("'storage_object_id',coalesce(f.storage_object_id,r.old_object_id)");
  });
});

describe("D-158 and D-159", () => {
  it("refuses the hand-over for now only on the withdrawal, at the three refusals the decision names, and nowhere else", () => {
    const transfer = successors.get("private.transfer_subject_v1(uuid,uuid,uuid,text,timestamptz)")!;
    expect(count(transfer, "raise exception using errcode=case when v_withdrawal then '55000' else '42501' end,\n"
      + "   message=case when v_withdrawal then 'hand_over_not_now' else 'not_found' end; end if;")).toBe(3);
    expect(count(transfer, "hand_over_not_now")).toBe(3);
    for (const before of ["if not exists(select 1 from auth.users u where u.id=v_new and u.deleted_at is null) then",
      "or exists(select 1 from public.upload_sessions u where u.subject_id=s.id and u.status='validating') then",
      "    or f.cohort_id is not null)) then"]) {
      expect(count(transfer, `${before}\n  -- 20261122160000 (D-158): on the withdrawal, refused for now.\n`
        + "  raise exception using errcode=case when v_withdrawal then '55000' else '42501' end,\n"
        + "   message=case when v_withdrawal then 'hand_over_not_now' else 'not_found' end; end if;"), before).toBe(1);
    }
    // The route answers it with its own registered response, and the card with the approved line.
    const route = read("src/app/api/subjects/[id]/route.ts");
    expect(route).toContain('const HAND_OVER_NOT_NOW = "hand_over_not_now";');
    expect(route).toContain('return closedResponse("api.subject-delete", ["error"], { error: "try_later" }, 409);');
    const register = JSON.parse(read("docs/route-register.json")) as { responseContracts: Record<string, unknown>;
      responseContractBindings: { routes: Record<string, string[]> } };
    expect(register.responseContracts["hand-over-not-now-v1"]).toMatchObject({ status: 409, body: { error: { const: "try_later" } } });
    expect(register.responseContractBindings.routes["api.subject-delete"]).toEqual(
      ["lifecycle-accepted-v1", "resource-not-found-v1", "hand-over-not-now-v1"]);
    expect(read("src/copy/upload/other-adult-withdrawal.ts"))
      .toContain('notNowStatus: "This cannot be done right now. Nothing was deleted. Try again later.",');
  });

  it("adds exactly the hand-over's pair to the closed list of person-caused events", () => {
    const list = patches[13]!;
    expect(list.next.replace(list.old.replace("),false);", ""), "")).toBe(",\n"
      + "      -- 20261122160000 (D-159): the uploader's hand-over, recorded on the route it used.\n"
      + "      ('api.subject-delete','subject.ownership_transferred')),false);");
  });
});

describe("its tests", () => {
  it("is driven by its pgTAP suite through both acts, the swap, both account captures, the former uploader, the three refusals and the list", () => {
    expect(pgtap.startsWith("-- A record transferred to its person is theirs to export (migration")).toBe(true);
    expect(pgtap).toMatch(/\nbegin;\n/u);
    expect(pgtap.trimEnd().endsWith("select * from finish();\nrollback;")).toBe(true);
    for (const target of successors.keys()) expect(pgtap).toContain(md5(successors.get(target)!));
    for (const fragment of ["public.transfer_subject_v1(pg_temp.a('2')", "pg_temp.wd('1','withdraw')", "pg_temp.relocate('own','c')",
      "pg_temp.relocate('main','e')", "'record true / account true'", "'works / works'",
      "'record 42501 not_found / account 0A000 export_result_projection_unavailable'", "pg_temp.listed('own')", "pg_temp.variants('main')",
      "'55000 hand_over_not_now / '", "'subject.ownership_transferred','api.subject-delete'", "own_subject_export_content_v1('check'",
      "private.account_archive_complete_enabled_v1(pg_temp.origin(%L))", "pg_temp.can_export_archive('2','main')",
      "pg_temp.can_export_archive('1','own')"]) {
      expect(pgtap, fragment).toContain(fragment);
    }
  });
});
