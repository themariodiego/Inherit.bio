import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20261122170000_inviter_grants_and_reviewed_document_decision.sql, two
 * changes of 22 November 2026, each patched in place under the md5-guarded
 * convention: the inviter's class of grants received leaves out the held
 * adult's grants (D-156), and the mitigation decision finds a confirmed draft
 * of either Path B flow (D-154). pg_get_functiondef keeps a body verbatim, so
 * each pinned body is rebuilt here from the migration that defined it, every
 * earlier patch is replayed from its own source, and every md5 is recomputed.
 * The pgTAP suites (supabase/tests/inviter_grants_received.sql and
 * supabase/tests/reviewed_document_decision.sql) drive both against a real
 * database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122170000_inviter_grants_and_reviewed_document_decision.sql";
const migration = read(`supabase/migrations/${NAME}`);
const grantsSuite = read("supabase/tests/inviter_grants_received.sql");
const decisionSuite = read("supabase/tests/reviewed_document_decision.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
/** The migration's statements, without its comment lines. */
const statements = migration.split("\n").filter(line => !line.trimStart().startsWith("--")).join("\n");

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
interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const PATCH = /\((\d+),'([^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/gu;
const parse = (block: string): Patch[] => [...block.matchAll(PATCH)].map(match => ({ ordinal: Number(match[1]), target: match[2]!,
  before: match[3]!, after: match[4]!, acl: match[5]!, old: match[6]!, next: match[7]!, label: match[8]! }));
const header = (signature: string, returns: string, language: string, volatility: string, searchPath: string, extra = "") =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n LANGUAGE ${language}\n${volatility ? ` ${volatility} SECURITY DEFINER\n` : " SECURITY DEFINER\n"}`
  + ` SET search_path TO ${searchPath}\n${extra}`;

// The class projection: 20261001029000's body, never patched since.
const PROJECTION = definition(read("supabase/migrations/20261001029000_account_archive_class_inventory.sql"),
  "create function private.export_account_class_projection_v1(",
  header("private.export_account_class_projection_v1(p_account uuid, p_subjects uuid[], p_kind text)",
    "TABLE(projected_id uuid, projected_subject uuid, projected_row jsonb)", "plpgsql", "", "''", " SET lock_timeout TO '250ms'\n"));
// The decision and Path B's account core as 20261120120000 left them: their
// definitions, every earlier patch, then 20261120120000's own patches.
const HOLD = read("supabase/migrations/20261120120000_adult_acceptance_hold_and_renotice.sql");
const holdPatches = parse(between(HOLD, "do $patch_hold$", "$patch_hold$;"));
const replayHold = (target: string, start: string) => holdPatches.filter(patch => patch.target === target)
  .reduce((text, patch) => apply(text, [patch.old, patch.next]), start);
const DECISION_TARGET = "private.other_adult_mitigation_before_public_appeal_v1(uuid,uuid,text)";
const CORE_TARGET = "private.confirm_path_b_subject_account_core_v1(text,text,integer,text,text[],bytea,uuid,uuid,text,boolean)";
const DECISION = replayHold(DECISION_TARGET, fragments(between(read("supabase/migrations/20261016204000_path_b_no_account_uploader_gate.sql"),
  "do $patch_gate$", "$patch_gate$;")).reduce(apply, definition(read("supabase/migrations/20260930220000_path_b_reading_layer.sql"),
  "create function private.other_adult_mitigation_v1(",
  header("private.other_adult_mitigation_before_public_appeal_v1(p_subject_id uuid, p_account_id uuid, p_checkpoint text)",
    "jsonb", "plpgsql", "STABLE", "'pg_catalog'"))));
const CORE = replayHold(CORE_TARGET, definition(read("supabase/migrations/20261016190000_path_b_reviewed_document.sql"),
  "create or replace function private.confirm_path_b_subject_account_core_v1(",
  header("private.confirm_path_b_subject_account_core_v1(p_session_hash text, p_nonce text, p_artifact_version integer, "
    + "p_artifact_body_sha256 text, p_statement_keys text[], p_signing_name_ciphertext bytea, p_account_id uuid, "
    + "p_auth_session_id uuid, p_account_email_hmac text, p_test_jurisdiction boolean)", "text", "plpgsql", "", "'pg_catalog', 'private'")));
const CLOCK = definition(HOLD, "create function private.adult_acceptance_clock_state_v1(",
  header("private.adult_acceptance_clock_state_v1(p_invitation_id uuid)", "jsonb", "sql", "STABLE", "''"));
const QUESTION = definition(read("supabase/migrations/20261122110000_adult_acceptance_inviter_reads.sql"),
  "create function private.adult_acceptance_inviter_held_v1(",
  header("private.adult_acceptance_inviter_held_v1(p_reader_account_id uuid, p_subject_id uuid)", "boolean", "sql", "STABLE", "''"));

const patchBlock = between(migration, "do $patch_grants_and_decision$", "$patch_grants_and_decision$;");
const patches = parse(patchBlock);
const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const TARGETS = ["private.export_account_class_projection_v1(uuid,uuid[],text)", DECISION_TARGET];
const SUCCESSORS = ["f90fe19ebd711a84f020556cbb46373b", "85be478145319e0c69dad7575e262941"];

describe("the release it belongs to", () => {
  it("is a guarded production release that follows every migration whose bodies it patches, pins or asks", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20261001029000", "20261016190000", "20261120120000", "20261122110000", "20261122140000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });

  it("creates nothing and patches two bodies: no function, table, trigger, policy, constraint, grant or row write", () => {
    expect(statements).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/iu);
    expect(statements).not.toMatch(/\b(alter|drop|create)\s+(table|index|trigger|policy|type|constraint|view)\b/iu);
    expect(statements).not.toMatch(/\b(insert\s+into|update\s+public\.|update\s+private\.|delete\s+from)\b/iu);
    expect(statements).not.toMatch(/^\s*(grant|revoke)\s/imu);
    expect(patches.map(patch => patch.target)).toEqual(TARGETS);
    expect(patches.map(patch => patch.ordinal)).toEqual([1, 2]);
    expect(count(migration, "execute replace(definition,item.old_fragment,item.new_fragment);")).toBe(1);
  });

  it("touches none of the class projection's callers, the archive, the readers or the doors another change owns", () => {
    for (const owned of ["export_account_class_inventory_v1", "account_archive_legacy_classes_v1", "account_archive_complete_source_rows_v1",
      "account_archive_complete_class_rows_v1", "export_subject_class_projection_v1", "export_scoped_class_projection_v1",
      "export_account_ordinary_readable_authority_v1", "account_archive_other_adult_export_gate_v1", "path_b_person_choices_v1",
      "subject_copilot_authority_v1", "subject_original_download_authority_v1", "path_b_normalization_authority_v1",
      "start_adult_acceptance_clocks_v1", "run_due_adult_acceptance_notices_v1", "transfer_subject", "delete_subject_v1",
      "withdraw_other_adult_upload", "genome_file_deletion", "family_report_recipient_v1", "account_archive_complete_subjects_v1"]) {
      expect(statements.includes(owned), owned).toBe(false);
    }
    // The question, the clocks and the account core are pinned, never patched.
    const rest = migration.replace(preflight, "");
    for (const pinned of ["'private.adult_acceptance_inviter_held_v1(", "'private.adult_acceptance_clock_state_v1(",
      "'private.confirm_path_b_subject_account_core_v1("]) {
      expect(rest.includes(pinned), pinned).toBe(false);
    }
  });

  it("is the last word on what it patches: no later migration restates or patches those bodies", () => {
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    for (const qualified of TARGETS.map(target => target.slice(0, target.indexOf("(")))) {
      expect(files.filter(file => file > NAME && rewrites(file, qualified)), qualified).toEqual([]);
    }
  });
});

describe("the predecessor block and the patches", () => {
  it("pins every body it patches or relies on to the md5 recomputed from its source, and to its ACL", () => {
    const pins: [string, string][] = [[TARGETS[0]!, md5(PROJECTION)], [DECISION_TARGET, md5(DECISION)],
      ["private.adult_acceptance_inviter_held_v1(uuid,uuid)", md5(QUESTION)], ["private.adult_acceptance_clock_state_v1(uuid)", md5(CLOCK)],
      [CORE_TARGET, md5(CORE)]];
    expect(pins.map(([, hash]) => hash)).toEqual(["d729235af961ceaf364b7127a00a89cb", "91dfb6e4abf766e3da6e5827d4381daf",
      "bd8cde3a947a35f7ae07d24175418515", "6f566115c807f64e1c2a9413f2669fe1", "63c6c510a724cbe747af5db354cb344b"]);
    for (const [signature, hash] of pins) {
      expect(preflight).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${hash}' and p.proacl::text='{postgres=X/postgres}')`);
    }
    // The draft table's flows, as 20261016190000 wrote them.
    const flows = "CHECK ((adult_flow = ANY (ARRAY['path-a-own-account'::text, 'path-b-subject-esignature'::text, 'path-b-reviewed-document'::text])))";
    expect(read("supabase/migrations/20261016190000_path_b_reviewed_document.sql"))
      .toContain("check (adult_flow in ('path-a-own-account','path-b-subject-esignature','path-b-reviewed-document'));");
    expect(preflight).toContain(`is distinct from '${md5(flows)}' then`);
    expect(preflight).toContain("raise exception using errcode='55000',message='inviter grants and reviewed document decision prerequisite differs'");
    // Path B's account core starts both clocks for both flows.
    expect(CORE).toContain("and adult_flow in ('path-b-subject-esignature','path-b-reviewed-document') and fixed_expires_at>v_now for update;");
    expect(CORE).toContain(" perform private.start_adult_acceptance_clocks_v1(v_invitation.id);\n");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration and the pgTAP suites assert", () => {
    const sources = [PROJECTION, DECISION];
    patches.forEach((patch, index) => {
      expect(md5(sources[index]!), patch.label).toBe(patch.before);
      expect(patch.acl, patch.label).toBe("{postgres=X/postgres}");
      expect(md5(apply(sources[index]!, [patch.old, patch.next])), patch.label).toBe(patch.after);
    });
    expect(patches.map(patch => patch.after)).toEqual(SUCCESSORS);
    expect(grantsSuite).toContain(SUCCESSORS[0]);
    expect(decisionSuite).toContain(SUCCESSORS[1]);
    // Each suite rebuilds the predecessor by reversing exactly this migration's anchor.
    for (const [suite, patch] of [[grantsSuite, patches[0]!], [decisionSuite, patches[1]!]] as const) {
      expect(suite).toContain(`v_old constant text:=$old$${patch.old}$old$; v_new constant text:=$new$${patch.next}$new$;`);
      expect(suite).toContain(patch.before);
    }
    expect(patchBlock).toContain("and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner");
  });

  it("only narrows the class for a held inviter, and only widens the decision's lookup to the other Path B flow", () => {
    const [grants, decision] = patches;
    // Every class but directional_grants is untouched; that branch keeps its row and adds one condition.
    const patched = apply(PROJECTION, [grants!.old, grants!.next]);
    expect(PROJECTION.replace(grants!.old, "")).toBe(patched.replace(grants!.next, ""));
    expect(grants!.old).toBe("   where d.recipient_account_id=p_account or d.recipient_principal_id in(select id from public.subject_principals where account_id=p_account)\n   order by d.grant_id;\n");
    expect(grants!.next).toContain("   where (d.recipient_account_id=p_account or d.recipient_principal_id in(select id from public.subject_principals where account_id=p_account))\n");
    expect(grants!.next).toContain("    and not(g.target_kind='subject' and private.adult_acceptance_inviter_held_v1(p_account,g.target_id))\n   order by d.grant_id;\n");
    expect(count(PROJECTION, "elsif p_kind='directional_grants' then")).toBe(1);
    expect(PROJECTION.indexOf(grants!.old)).toBeGreaterThan(PROJECTION.indexOf("elsif p_kind='directional_grants' then"));
    expect(PROJECTION.indexOf(grants!.old)).toBeLessThan(PROJECTION.indexOf("elsif p_kind='family_sharing_pauses' then"));
    // The decision's lookup takes either Path B flow's confirmed draft; nothing else changes.
    expect(decision!.old).toBe("  join public.adult_subject_drafts d on d.subject_id=i.target_id and d.adult_flow='path-b-subject-esignature'\n   and d.state='confirmed'\n");
    expect(decision!.next).toContain("   and d.adult_flow in('path-b-subject-esignature','path-b-reviewed-document')\n   and d.state='confirmed'\n");
    expect(count(DECISION, "path-b-subject-esignature")).toBe(1);
    const widened = apply(DECISION, [decision!.old, decision!.next]);
    expect(DECISION.replace(decision!.old, "")).toBe(widened.replace(decision!.next, ""));
  });

  it("is driven by its two pgTAP suites", () => {
    for (const fragment of ["(hold) only A''s reads differ: for B, C, D, E and every other account every caller and every class answers as before",
      "(hold) every caller answers for A exactly what it answers when B has granted A nothing", "(released) every caller answers for every account, A included, as before",
      "(30 d) from 30 days B''s grants are left out again", "private.export_account_owned_capture_pre_requester_v1(", "private.account_archive_legacy_capture_v1(",
      "private.account_archive_complete_capture_v1(", "private.export_subject_class_projection_v1(", "private.export_scoped_class_projection_v1(''subject''",
      "private.account_archive_complete_source_rows_v1(", "private.account_archive_complete_class_rows_v1(", "from public.profiles p;"]) {
      expect(grantsSuite, fragment).toContain(fragment);
    }
    for (const fragment of ["(predecessor) D-154: every reviewed-document record answers not-found", "public.finalize_path_b_reviewed_document_v1(",
      "public.decide_permission_document_v1(", "(rd-new) an account created after a reviewed-document request starts both clocks",
      "(rd-new) at each checkpoint, as for the e-signature record", "(72 h) the worker sends each to its person''s account",
      "(30 d) at each checkpoint, uploader and person, as for the e-signature records", "(rd-none) with a live 730-day clock",
      "(reminded) as the e-signature ones"]) {
      expect(decisionSuite, fragment).toContain(fragment);
    }
    for (const suite of [grantsSuite, decisionSuite]) {
      expect(suite).toContain("\nbegin;\n");
      expect(suite.trimEnd().endsWith("rollback;")).toBe(true);
    }
  });
});
