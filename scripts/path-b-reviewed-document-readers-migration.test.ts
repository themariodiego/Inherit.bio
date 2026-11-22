import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20261122180000_path_b_reviewed_document_readers.sql (D-165): every Path B
 * reader that joined drafts of the e-signature flow only now takes a confirmed
 * draft of either Path B flow, exactly where it took a confirmed e-signature
 * draft. Fifteen bodies are patched in place at sixteen anchors under the
 * md5-guarded convention. pg_get_functiondef keeps a body verbatim, so each
 * predecessor is rebuilt here from the migration that defined it (the two
 * export bodies with 20261122160000's patches replayed), every md5 the
 * migration names is recomputed, and each patch is replayed to its successor.
 * The pgTAP suite (supabase/tests/path_b_reviewed_document_readers.sql) drives
 * every reader against a real database.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122180000_path_b_reviewed_document_readers.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/path_b_reviewed_document_readers.sql");
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
  const close = source.indexOf(open[1]!, bodyStart); // a dollar-quoted body ends at the first repeat of its tag
  return `${header}AS $function$${source.slice(bodyStart, close)}$function$\n`;
}
const header = (signature: string, returns: string, rest: string) =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n LANGUAGE plpgsql\n SECURITY DEFINER\n${rest}`;
const PATH = (value: string) => ` SET search_path TO ${value}\n`;
function apply(text: string, old: string, next: string): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}
interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const PATCH = /\((\d+),'([^']+)','([0-9a-f]{32})',\n {3}'([0-9a-f]{32})','(\{[^}]+\})',\n {3}\$old\$([\s\S]*?)\$old\$,\n {3}\$new\$([\s\S]*?)\$new\$,\n {3}'([^']+)'\)/gu;
const parse = (block: string): Patch[] => [...block.matchAll(PATCH)].map(match => ({ ordinal: Number(match[1]), target: match[2]!,
  before: match[3]!, after: match[4]!, acl: match[5]!, old: match[6]!, next: match[7]!, label: match[8]! }));

// The sources: each body as the migration that last defined it wrote it.
const READING = read("supabase/migrations/20260930220000_path_b_reading_layer.sql");
const ACCOUNT_BRANCH = read("supabase/migrations/20260930210000_path_b_account_branch.sql");
const REPORT_READING = read("supabase/migrations/20260930236000_path_b_report_reading.sql");
const READABLE_GRAPH = read("supabase/migrations/20261001039000_account_archive_readable_graph.sql");
const APPEAL = read("supabase/migrations/20261009224500_public_appeal_matched_review.sql");
const REVIEWED = read("supabase/migrations/20261016190000_path_b_reviewed_document.sql");
const COPILOT = read("supabase/migrations/20261120130000_subject_copilot_scope.sql");
const TRANSFERRED = read("supabase/migrations/20261122160000_transferred_record_exports.sql");
const TRANSFERRED_PATCHES = parse(between(TRANSFERRED, "do $patch_transferred$", "$patch_transferred$;"));
const replayTransferred = (target: string, start: string) => TRANSFERRED_PATCHES.filter(patch => patch.target === target)
  .reduce((text, patch) => {
    expect(md5(text), `${target} ${patch.ordinal}`).toBe(patch.before);
    return apply(text, patch.old, patch.next);
  }, start);

const READABLE_TARGET = "private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)";
const SNAPSHOT_TARGET = "private.export_account_path_b_snapshot_v1(jsonb,uuid)";
const BASES: Record<string, string> = {
  "private.path_b_person_v1(uuid,uuid,uuid)": definition(READING, "create function private.path_b_person_v1(",
    header("private.path_b_person_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid)", "jsonb", PATH("'pg_catalog'"))),
  "private.path_b_person_choices_v1(uuid,uuid,boolean)": definition(READING, "create function private.path_b_person_choices_v1(",
    header("private.path_b_person_choices_v1(p_account_id uuid, p_session_id uuid, p_test_jurisdiction boolean)", "jsonb",
      PATH("'pg_catalog'"))),
  "private.path_b_uploader_shares_v1(uuid,uuid,boolean)": definition(READING, "create function private.path_b_uploader_shares_v1(",
    header("private.path_b_uploader_shares_v1(p_account_id uuid, p_session_id uuid, p_test_jurisdiction boolean)", "jsonb",
      PATH("'pg_catalog'"))),
  "private.path_b_report_metadata_v1(uuid,uuid,uuid,boolean)": definition(REPORT_READING, "create function private.path_b_report_metadata_v1(",
    header("private.path_b_report_metadata_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid, p_test_jurisdiction boolean)",
      "jsonb", PATH("''"))),
  "private.subject_held_files_v1(uuid,uuid,boolean)": definition(ACCOUNT_BRANCH, "create function private.subject_held_files_v1(",
    header("private.subject_held_files_v1(p_account_id uuid, p_session_id uuid, p_test_jurisdiction boolean)", "jsonb",
      PATH("'pg_catalog', 'private'"))),
  "private.subject_copilot_authority_v1(uuid,uuid,uuid)": definition(COPILOT, "create function private.subject_copilot_authority_v1(",
    header("private.subject_copilot_authority_v1(p_account uuid, p_session uuid, p_subject uuid)", "jsonb", PATH("''"))),
  "private.export_account_path_b_file_v1(uuid)": definition(READABLE_GRAPH, "create function private.export_account_path_b_file_v1(",
    "CREATE OR REPLACE FUNCTION private.export_account_path_b_file_v1(p_file uuid)\n RETURNS boolean\n LANGUAGE sql\n"
    + " STABLE SECURITY DEFINER\n SET search_path TO ''\n SET lock_timeout TO '250ms'\n"),
  [SNAPSHOT_TARGET]: replayTransferred(SNAPSHOT_TARGET, definition(READABLE_GRAPH, "create function private.export_account_path_b_snapshot_v1(",
    header("private.export_account_path_b_snapshot_v1(p_origin jsonb, p_subject uuid)", "jsonb",
      PATH("''") + " SET lock_timeout TO '250ms'\n SET extra_float_digits TO '3'\n"))),
  [READABLE_TARGET]: replayTransferred(READABLE_TARGET, definition(READABLE_GRAPH,
    "create function private.export_account_ordinary_readable_authority_v1(",
    header("private.export_account_ordinary_readable_authority_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)", "jsonb",
      PATH("'pg_catalog', 'private'")))),
  "private.transferred_export_person_v1(uuid,uuid,uuid)": definition(TRANSFERRED, "create function private.transferred_export_person_v1(",
    header("private.transferred_export_person_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid)", "jsonb", PATH("''"))),
  "private.transferred_export_confirmation_v1(uuid)": definition(TRANSFERRED, "create function private.transferred_export_confirmation_v1(",
    header("private.transferred_export_confirmation_v1(p_subject_id uuid)", "jsonb", PATH("''"))),
  "public.expire_due_other_adult_held_uploads_v1()": definition(ACCOUNT_BRANCH,
    "create or replace function public.expire_due_other_adult_held_uploads_v1(",
    header("public.expire_due_other_adult_held_uploads_v1()", "integer", PATH("'pg_catalog', 'private'"))),
  "private.end_purged_path_b_grants_v1()": definition(READING, "create function private.end_purged_path_b_grants_v1(",
    header("private.end_purged_path_b_grants_v1()", "trigger", PATH("'pg_catalog'"))),
  "private.public_appeal_provisional_binding_v1(uuid)": definition(APPEAL, "create function private.public_appeal_provisional_binding_v1(",
    header("private.public_appeal_provisional_binding_v1(p_case uuid)", "jsonb", PATH("''"))),
  "private.assert_account_path_b_deletion_supported_v1(uuid)": definition(REVIEWED,
    "create or replace function private.assert_account_path_b_deletion_supported_v1(",
    header("private.assert_account_path_b_deletion_supported_v1(p_account_id uuid)", "void", PATH("''"))),
};
// Pinned and unchanged: what makes a confirmed reviewed-document draft one a
// named reviewer approved, and the confirmation read the capture keeps calling.
const PINNED: Record<string, string> = {
  "private.path_b_reviewed_document_basis_current_v1(uuid,uuid)": definition(REVIEWED,
    "create function private.path_b_reviewed_document_basis_current_v1(",
    header("private.path_b_reviewed_document_basis_current_v1(p_subject_id uuid, p_invitation_id uuid)", "boolean", PATH("''"))),
  "private.path_b_reviewed_document_approval_v1(uuid,uuid,uuid)": definition(REVIEWED,
    "create function private.path_b_reviewed_document_approval_v1(",
    header("private.path_b_reviewed_document_approval_v1(p_subject_id uuid, p_document_id uuid, p_review_id uuid)",
      "private.permission_document_reviews", PATH("''"))),
  "private.guard_permission_document_transition_v1()": definition(REVIEWED, "create function private.guard_permission_document_transition_v1(",
    header("private.guard_permission_document_transition_v1()", "trigger", PATH("''"))),
  "private.path_b_subject_v1(uuid,uuid)": definition(REVIEWED, "create or replace function private.path_b_subject_v1(",
    header("private.path_b_subject_v1(p_account_id uuid, p_subject_id uuid)", "jsonb", PATH("'pg_catalog', 'private'"))),
};
/** The defining migration of each body; only 20261122160000 patched any of them since. */
const DEFINED_IN: Record<string, string> = {
  "private.path_b_person_v1": "20260930220000_path_b_reading_layer.sql",
  "private.path_b_person_choices_v1": "20260930220000_path_b_reading_layer.sql",
  "private.path_b_uploader_shares_v1": "20260930220000_path_b_reading_layer.sql",
  "private.path_b_report_metadata_v1": "20260930236000_path_b_report_reading.sql",
  "private.subject_held_files_v1": "20260930210000_path_b_account_branch.sql",
  "private.subject_copilot_authority_v1": "20261120130000_subject_copilot_scope.sql",
  "private.export_account_path_b_file_v1": "20261001039000_account_archive_readable_graph.sql",
  "private.export_account_path_b_snapshot_v1": "20261001039000_account_archive_readable_graph.sql",
  "private.export_account_ordinary_readable_authority_v1": "20261001039000_account_archive_readable_graph.sql",
  "private.transferred_export_person_v1": "20261122160000_transferred_record_exports.sql",
  "private.transferred_export_confirmation_v1": "20261122160000_transferred_record_exports.sql",
  "public.expire_due_other_adult_held_uploads_v1": "20260930210000_path_b_account_branch.sql",
  "private.end_purged_path_b_grants_v1": "20260930220000_path_b_reading_layer.sql",
  "private.public_appeal_provisional_binding_v1": "20261009224500_public_appeal_matched_review.sql",
  "private.assert_account_path_b_deletion_supported_v1": "20261016190000_path_b_reviewed_document.sql",
  "private.path_b_reviewed_document_basis_current_v1": "20261016190000_path_b_reviewed_document.sql",
  "private.path_b_reviewed_document_approval_v1": "20261016190000_path_b_reviewed_document.sql",
  "private.guard_permission_document_transition_v1": "20261016190000_path_b_reviewed_document.sql",
  "private.path_b_subject_v1": "20261016190000_path_b_reviewed_document.sql",
};
const rewrites = (file: string, qualified: string) => {
  const sql = read(`supabase/migrations/${file}`);
  const local = qualified.slice(qualified.indexOf(".") + 1);
  return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
    || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
};

const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const postflight = between(migration, "do $postflight$", "$postflight$;");
const patchBlock = between(migration, "do $patch_readers$", "$patch_readers$;");
const patches = parse(patchBlock);
const TARGETS = [...new Set(patches.map(patch => patch.target))];
/** Each body after this migration's patches, replayed from its rebuilt predecessor. */
const successors = new Map<string, string>();
for (const patch of patches) successors.set(patch.target, apply(successors.get(patch.target) ?? BASES[patch.target]!, patch.old, patch.next));
const BOTH = "in('path-b-subject-esignature','path-b-reviewed-document')";
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pinOf = (signature: string, digest: string, acl: string) => new RegExp(`\\('${escape(signature)}','${digest}','${escape(acl)}'\\)`, "u");

describe("the release it belongs to", () => {
  it("is a guarded production release after every migration whose bodies it patches or pins, and after the decision's own widening", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20260930210000", "20260930220000", "20260930236000", "20261001039000", "20261009224500", "20261016190000",
      "20261120130000", "20261122160000", "20261122170000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(files.filter(file => file.startsWith("20261122180000_"))).toEqual([NAME]);
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(`# Release notes: \`${NAME}\``);
  });

  it("creates nothing and patches fifteen bodies at sixteen anchors: no function, table, trigger, policy, grant or row write", () => {
    expect(statements).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/iu);
    expect(statements).not.toMatch(/\b(alter|drop|create)\s+(table|index|trigger|policy|type|constraint|view|schema)\b/iu);
    expect(statements).not.toMatch(/\b(insert\s+into|update\s+public\.|update\s+private\.|delete\s+from)\b/iu);
    expect(statements).not.toMatch(/^\s*(grant|revoke)\s/imu);
    expect(patches.map(patch => patch.ordinal)).toEqual([...Array(16).keys()].map(index => index + 1));
    expect(TARGETS).toEqual(Object.keys(BASES));
    expect(TARGETS).toHaveLength(15);
    expect(count(migration, "execute replace(definition,item.old_fragment,item.new_fragment);")).toBe(1);
    expect(patchBlock).toContain("and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner");
  });

  it("names no body an earlier migration only pins, and patches through the one md5-guarded loop only", () => {
    // Bodies earlier migrations hold as pinned-only (their "last word" tests):
    // this migration neither names them for a patch nor pins them.
    for (const pinned of ["'private.other_adult_mitigation_before_public_appeal_v1(", "'private.confirm_path_b_subject_account_core_v1(",
      "'private.adult_subject_invitation_response_v1(", "'private.path_b_normalization_authority_v1(", "'private.grant_path_b_purpose_v1(",
      "'private.other_adult_mitigation_v1(", "'private.path_b_result_read_v1(", "'private.adult_acceptance_inviter_held_v1(",
      "'private.adult_acceptance_clock_state_v1(", "'private.export_account_class_projection_v1(", "'private.own_export_source_v1(",
      "'private.transfer_subject_v1(", "'public.delete_subject_v1(", "'public.withdraw_other_adult_upload_v1(",
      "'private.account_archive_other_adult_export_gate_v1(", "'private.subject_original_download_authority_v1("]) {
      expect(migration.includes(pinned), pinned).toBe(false);
    }
    expect(migration).not.toContain("pg_get_functiondef('");
    for (const qualified of TARGETS.map(target => target.slice(0, target.indexOf("(")))) {
      const local = qualified.slice(qualified.indexOf(".") + 1);
      expect(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(migration), local).toBe(false);
    }
  });

  it("is the last word on what it patches: no later migration restates or patches those bodies", () => {
    for (const qualified of TARGETS.map(target => target.slice(0, target.indexOf("(")))) {
      expect(files.filter(file => file > NAME && rewrites(file, qualified)), qualified).toEqual([]);
    }
  });
});

describe("the predecessor block, the patches and the postflight", () => {
  it("pins every body it patches or relies on to the md5 recomputed from its source, with its ACL", () => {
    const acl = new Map(patches.map(patch => [patch.target, patch.acl]));
    for (const [signature, body] of Object.entries(BASES)) {
      expect(preflight, signature).toMatch(pinOf(signature, md5(body), acl.get(signature)!));
      expect(patches.find(patch => patch.target === signature)!.before, signature).toBe(md5(body));
    }
    const pinnedAcl: Record<string, string> = { "private.path_b_subject_v1(uuid,uuid)": "{postgres=X/postgres,service_role=X/postgres}" };
    for (const [signature, body] of Object.entries(PINNED)) {
      expect(preflight, signature).toMatch(pinOf(signature, md5(body), pinnedAcl[signature] ?? "{postgres=X/postgres}"));
    }
    expect(Object.values(PINNED).map(md5)).toEqual(["43f3bf4e7782e176523b12851fa6b97b", "ab0681555da11ebc1f9c3c456d95e76e",
      "8631df4b82bcc03e8acfa8de6f07798d", "d174a83682e35479797ac7e738a65d79"]);
    expect(preflight).toContain(")<>19\n");
    // Since the migration that last wrote each body, only 20261122160000 patched any of them (the two
    // export bodies, replayed above). The detector also flags a file that names a body beside a patch
    // of another: 20261001039000 checks the person read's privileges, and 20261122160000 pins the
    // person read, the Path B file test and the confirmation read. Each of those is pinned here at the
    // md5 rebuilt from its defining migration, which is the md5 20261122160000 pins.
    const flagged: Record<string, string[]> = {
      "private.path_b_person_v1": ["20261001039000_account_archive_readable_graph.sql", "20261122160000_transferred_record_exports.sql"],
      "private.export_account_path_b_file_v1": ["20261122160000_transferred_record_exports.sql"],
      "private.export_account_path_b_snapshot_v1": ["20261122160000_transferred_record_exports.sql"],
      "private.export_account_ordinary_readable_authority_v1": ["20261122160000_transferred_record_exports.sql"],
      "private.path_b_subject_v1": ["20261122160000_transferred_record_exports.sql"],
    };
    for (const [qualified, source] of Object.entries(DEFINED_IN)) {
      expect(files.filter(file => file > source && file < NAME && rewrites(file, qualified)), qualified).toEqual(flagged[qualified] ?? []);
    }
    const transferredPreflight = between(TRANSFERRED, "do $predecessor$", "$predecessor$;");
    for (const signature of ["private.path_b_person_v1(uuid,uuid,uuid)", "private.export_account_path_b_file_v1(uuid)",
      "private.path_b_subject_v1(uuid,uuid)"]) {
      expect(transferredPreflight, signature).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${
        md5(BASES[signature] ?? PINNED[signature]!)}'`);
    }
    expect(TRANSFERRED_PATCHES.map(patch => patch.target)).not.toContain("private.path_b_person_v1(uuid,uuid,uuid)");
    expect(READABLE_GRAPH).not.toMatch(/'private\.path_b_person_v1\(uuid,uuid,uuid\)',\s*'[0-9a-f]{32}'/u);
    // The draft table: the three flows, each flow with its own evidence kind, and the five states.
    const checks: [string, string, string][] = [
      ["adult_subject_drafts_adult_flow_check",
        "CHECK ((adult_flow = ANY (ARRAY['path-a-own-account'::text, 'path-b-subject-esignature'::text, 'path-b-reviewed-document'::text])))",
        "check (adult_flow in ('path-a-own-account','path-b-subject-esignature','path-b-reviewed-document'));"],
      ["adult_subject_drafts_flow_check",
        "CHECK ((((adult_flow = 'path-a-own-account'::text) AND (confirmation_mode = 'path-a-account-required'::text) AND (evidence_kind = 'none'::text) "
        + "AND (request_key IS NULL)) OR ((adult_flow = 'path-b-subject-esignature'::text) AND (confirmation_mode = 'path-b-token-or-account'::text) "
        + "AND (evidence_kind = 'esignature'::text) AND (request_key IS NOT NULL)) OR ((adult_flow = 'path-b-reviewed-document'::text) "
        + "AND (confirmation_mode = 'path-b-token-or-account'::text) AND (evidence_kind = 'uploaded_document'::text) AND (request_key IS NOT NULL))))",
        " or (adult_flow='path-b-reviewed-document' and confirmation_mode='path-b-token-or-account'\n  and evidence_kind='uploaded_document' and request_key is not null));"],
      ["adult_subject_drafts_state_check", "CHECK ((state = ANY (ARRAY['draft'::text, 'invited'::text, 'confirmed'::text, 'expired'::text, 'cancelled'::text])))",
        "state text not null default 'draft' check (state in ('draft', 'invited', 'confirmed', 'expired', 'cancelled')),"],
    ];
    const sources = REVIEWED + read("supabase/migrations/20260831224126_reference_registries_and_constraints.sql");
    for (const [name, printed, source] of checks) {
      expect(sources, name).toContain(source);
      expect(preflight, name).toContain(`'${name} ${md5(printed)}`);
    }
    expect(preflight).toContain("raise exception using errcode='55000',message='path b reviewed document readers prerequisite differs'");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration, its postflight and the pgTAP suite assert", () => {
    const seen = new Map<string, string>();
    for (const patch of patches) {
      const base = seen.get(patch.target) ?? BASES[patch.target]!;
      expect(md5(base), `${patch.ordinal} before`).toBe(patch.before);
      const next = apply(base, patch.old, patch.next);
      expect(md5(next), `${patch.ordinal} after`).toBe(patch.after);
      seen.set(patch.target, next);
    }
    const acl = new Map(patches.map(patch => [patch.target, patch.acl]));
    for (const [target, body] of successors) expect(postflight, target).toMatch(pinOf(target, md5(body), acl.get(target)!));
    expect(postflight).toContain(")<>15 then");
    expect(postflight).toContain("raise exception using errcode='55000',message='path b reviewed document readers successor differs'");
  });

  it("widens only the flow, exactly where the e-signature lookup stood, and keeps every other line of each body", () => {
    for (const patch of patches) {
      expect(count(patch.old, "'path-b-subject-esignature'"), patch.label).toBe(1);
      expect(patch.old, patch.label).not.toContain("path-b-reviewed-document");
      expect(patch.next, patch.label).toMatch(/^\s*-- 20261122180000 \(D-165\): /u);
      // The confirmed state stays exactly where the e-signature lookup had it: never added, never dropped.
      expect(count(patch.next, "state='confirmed'"), patch.label).toBe(count(patch.old, "state='confirmed'"));
      expect(patch.next, patch.label).not.toMatch(/state\s*(in|<>|!=)|state='(draft|invited|expired|cancelled)'/u);
      const code = (text: string) => text.split("\n").filter(line => !line.trimStart().startsWith("--")).join(" ").replace(/\s+/gu, " ").trim();
      const paired = patch.old.includes("evidence_kind='esignature'");
      const widened = paired
        ? code(patch.old).replace(/(d\.)?adult_flow='path-b-subject-esignature' and (d\.)?evidence_kind='esignature'/u,
          (_match, d = "") => `((${d}adult_flow='path-b-subject-esignature' and ${d}evidence_kind='esignature') or (${d}adult_flow='path-b-reviewed-document' and ${d}evidence_kind='uploaded_document'))`)
        : code(patch.old).replace(/adult_flow='path-b-subject-esignature'/u, `adult_flow ${BOTH}`);
      expect(code(patch.next).replace(/\( \(/gu, "((").replace(/\) \)/gu, "))"), patch.label).toBe(widened);
    }
    for (const [target, body] of successors) {
      const own = patches.filter(patch => patch.target === target);
      let before = BASES[target]!; let after = body;
      for (const patch of own) { before = before.replace(patch.old, ""); after = after.replace(patch.next, ""); }
      expect(after, target).toBe(before);
    }
    // The held-upload job's last pass still expires only e-signature drafts never requested: a
    // reviewed-document draft has its own sweep (public.expire_due_path_b_reviewed_documents_v1).
    const job = successors.get("public.expire_due_other_adult_held_uploads_v1()")!;
    expect(job).toContain("  where d.adult_flow='path-b-subject-esignature' and d.state='draft' and d.fixed_expires_at<=v_now\n");
    expect(REVIEWED).toContain("  where d.adult_flow='path-b-reviewed-document' and d.state in ('draft','invited','cancelled') and d.fixed_expires_at<=v_now\n");
    // No patched body still joins the e-signature flow alone, but that pass.
    for (const [target, body] of successors) {
      const alone = body.split("\n").filter(line => line.includes("'path-b-subject-esignature'") && !line.includes("path-b-reviewed-document")
        && !line.includes("evidence_kind='esignature'"));
      expect(alone, target).toEqual(target.startsWith("public.expire_due_other_adult_held_uploads_v1") ? [
        "  where d.adult_flow='path-b-subject-esignature' and d.state='draft' and d.fixed_expires_at<=v_now"] : []);
    }
  });
});

describe("D-165: what a confirmed reviewed document is", () => {
  it("reaches 'confirmed' only in the two confirmation transactions, after the named reviewer's approval is rechecked", () => {
    // Every write of the confirmed draft state, in every migration.
    const writes = files.flatMap(file => count(read(`supabase/migrations/${file}`),
      "update public.adult_subject_drafts set state='confirmed'") > 0 ? [file] : []);
    expect(writes).toEqual(["20260928150000_other_adult_held_upload.sql", "20260930210000_path_b_account_branch.sql",
      "20261016190000_path_b_reviewed_document.sql"]);
    expect(count(REVIEWED, "update public.adult_subject_drafts set state='confirmed' where id=d.id;")).toBe(2);
    for (const marker of ["create or replace function private.confirm_path_b_subject_v1(",
      "create or replace function private.confirm_path_b_subject_account_core_v1("]) {
      const body = REVIEWED.slice(REVIEWED.indexOf(marker), REVIEWED.indexOf("$function$;", REVIEWED.indexOf(marker)));
      const basis = body.indexOf(" if d.adult_flow='path-b-reviewed-document'\n  and not private.path_b_reviewed_document_basis_current_v1(s.id,v_invitation.id) then");
      expect(basis, marker).toBeGreaterThan(0);
      expect(body.indexOf("update public.adult_subject_drafts set state='confirmed' where id=d.id;"), marker).toBeGreaterThan(basis);
    }
    // The request is sent (draft -> invited) only after that approval, and a refusal cancels the draft.
    const finalize = REVIEWED.slice(REVIEWED.indexOf("create function private.finalize_path_b_reviewed_document_core_v1("));
    expect(finalize.indexOf("v_review:=private.path_b_reviewed_document_approval_v1(s.id,p_document_id,p_review_id);"))
      .toBeLessThan(finalize.indexOf("update public.adult_subject_drafts set state='invited' where id=d.id;"));
    expect(REVIEWED).toContain("  update public.adult_subject_drafts set state='cancelled' where id=v_draft.id and state='draft';");
    expect(REVIEWED).toContain("raise exception using errcode='42501',message='a decided review is final'; end if;");
    // Every lookup patched here keeps the confirmed state wherever the e-signature lookup had it.
    expect(patches.filter(patch => patch.old.includes("state='confirmed'")).map(patch => patch.ordinal))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12]);
    // The capture's own draft read (9) sits under its existing confirmed-state line, and the
    // appeal's confirmation (14) under its join's.
    expect(successors.get(READABLE_TARGET)).toContain("    and d.state='confirmed'\n    -- 20261122180000 (D-165): ");
    expect(successors.get("private.public_appeal_provisional_binding_v1(uuid)")).toContain(
      "     join public.adult_subject_drafts d on d.subject_id=subject_row.id and d.state='confirmed'\n");
    // The rest: those two, and the three e-signature lookups that named no state (the cleanup 13, the
    // appeal's recheck 15, which then asks the confirmed binding, and the deletion refusal 16), which name none.
    expect(patches.filter(patch => !patch.old.includes("state='confirmed'")).map(patch => patch.ordinal)).toEqual([9, 13, 14, 15, 16]);
  });
});

describe("its tests", () => {
  it("is driven by its pgTAP suite, which rebuilds each predecessor by reversing exactly this migration's anchors", () => {
    expect(pgtap.startsWith("-- D-165: a Path B record made from a reviewed permission document reaches")).toBe(true);
    expect(pgtap).toMatch(/\nbegin;\n/u);
    expect(pgtap.trimEnd().endsWith("select * from finish();\nrollback;")).toBe(true);
    // The suite's patch rows are this migration's own, byte for byte.
    const rows = between(patchBlock, " for item in select * from (values\n", "\n ) as patch(");
    expect(pgtap).toContain(`insert into d165_patches values\n${rows};\n`);
    expect(pgtap).toContain("    d:=replace(d,r.new_fragment,r.old_fragment);");
    for (const fragment of ["(predecessor) D-165: the reviewed-document record reaches none of them",
      "(rd) the reviewed-document record reaches every reader", "public.finalize_path_b_reviewed_document_v1(",
      "public.decide_permission_document_v1(", "(choices) the person''s choices page lists the record exactly as",
      "(shares) the uploader''s list shows what the person shared", "(metadata) the uploader''s saved results of the record",
      "(held files) the person''s held files are listed", "(Copilot) the uploader''s scope for the record opens",
      "(export) the person exports the record and their whole account, with the complete archive off and on",
      "(moved) any copy made before has stopped working, for either record", "public.transfer_subject_v1(pg_temp.a('5')",
      "public.withdraw_other_adult_upload_v1(pg_temp.a('1')", "(swapped) the person still exports both",
      "(unconfirmed) a draft still awaiting the person''s answer reaches no reader, for either flow",
      "(refused) nor a cancelled draft, as a refused document leaves it", "(held-upload job) a person who asks to delete their account",
      "(purged-grant cleanup) when the person deletes the record", "(deletion) a grant on the reviewed-document record",
      "(appeal) an objection from the reviewed-document record''s person resolves to the record and holds it",
      "public.expire_due_other_adult_held_uploads_v1()", "private.account_archive_complete_enabled_v1(pg_temp.origin(%L))"]) {
      expect(pgtap, fragment).toContain(fragment);
    }
  });
});
