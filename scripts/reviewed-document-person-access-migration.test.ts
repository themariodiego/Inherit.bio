import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20261122190000_reviewed_document_person_access.sql (D-166, owner decision of
 * 22 November 2026): only the uploader's access to a path-b-reviewed-document
 * record depends on the approved document still being retained; the person's
 * own saved results and exports continue after its retention ends, as after
 * an e-signature. One new helper (the record's confirmation: the uploader's
 * confirmation read without its retention clause) and four bodies patched in
 * place under the md5-guarded convention. pg_get_functiondef keeps a body
 * verbatim, so each predecessor is rebuilt here from the migration that
 * defined it, with every later in-place patch replayed, every md5 the
 * migration names is recomputed, and each patch is replayed to its successor.
 * The pgTAP suite (supabase/tests/reviewed_document_person_access.sql) drives
 * both sides against a real database before and after the retention ends.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122190000_reviewed_document_person_access.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/reviewed_document_person_access.sql");
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
const sqlHeader = (signature: string) =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n`;
const PATH = (value: string) => ` SET search_path TO ${value}\n`;
function apply(text: string, old: string, next: string): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}
interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const PATCH = /\((\d+),'([^']+)','([0-9a-f]{32})',\n {3}'([0-9a-f]{32})','(\{[^}]+\})',\n {3}\$old\$([\s\S]*?)\$old\$,\n {3}\$new\$([\s\S]*?)\$new\$,\n {3}'([^']+)'\)/gu;
const parse = (block: string): Patch[] => [...block.matchAll(PATCH)].map(match => ({ ordinal: Number(match[1]), target: match[2]!,
  before: match[3]!, after: match[4]!, acl: match[5]!, old: match[6]!, next: match[7]!, label: match[8]! }));
/** Replays the md5-guarded patches of one earlier migration on a body, checking each predecessor md5. */
const replay = (patches: Patch[], target: string, start: string) => patches.filter(patch => patch.target === target)
  .reduce((text, patch) => {
    expect(md5(text), `${target} ${patch.ordinal}`).toBe(patch.before);
    return apply(text, patch.old, patch.next);
  }, start);
/** An earlier unguarded or single-anchor DO patch: its literal old and new fragments. */
const fragments = (block: string): [string, string] =>
  [between(block, "old_fragment text:=$old$", "$old$;"), between(block, "new_fragment text:=$new$", "$new$;")];

// The sources: each body as the migration that last defined it wrote it, with
// every later in-place patch replayed.
const HELD_UPLOAD = read("supabase/migrations/20260928150000_other_adult_held_upload.sql");
const NOTICE_CONTEXT = read("supabase/migrations/20261010063629_adult_upload_notice_context.sql");
const NORMALIZATION = read("supabase/migrations/20260930231000_path_b_normalization.sql");
const QUEUED = read("supabase/migrations/20260930234000_path_b_queued_reports.sql");
const READABLE_GRAPH = read("supabase/migrations/20261001039000_account_archive_readable_graph.sql");
const APPEAL = read("supabase/migrations/20261009224500_public_appeal_matched_review.sql");
const REVIEWED = read("supabase/migrations/20261016190000_path_b_reviewed_document.sql");
const TRANSFER = read("supabase/migrations/20261016221000_subject_transfer.sql");
const HOLD = read("supabase/migrations/20261120120000_adult_acceptance_hold_and_renotice.sql");
const TRANSFERRED = read("supabase/migrations/20261122160000_transferred_record_exports.sql");
const READERS = read("supabase/migrations/20261122180000_path_b_reviewed_document_readers.sql");
const HOLD_PATCHES = parse(between(HOLD, "do $patch_hold$", "$patch_hold$;"));
const TRANSFERRED_PATCHES = parse(between(TRANSFERRED, "do $patch_transferred$", "$patch_transferred$;"));
const READERS_PATCHES = parse(between(READERS, "do $patch_readers$", "$patch_readers$;"));

const SOURCE = "private.path_b_normalization_authority_v1(uuid,text)";
const READ = "private.path_b_result_read_v1(uuid,uuid,text)";
const REPORT = "private.path_b_report_authority_v1(uuid,uuid,text)";
const CAPTURE = "private.export_account_ordinary_readable_authority_v1(jsonb,text,uuid)";
const UPLOADER_READ = "private.path_b_subject_v1(uuid,uuid)";
const HELPER = "private.path_b_confirmation_v1(uuid,uuid)";
const STORE = "private.other_adult_upload_store_authority_v1(uuid,uuid,uuid)";
const FINALIZE = "private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)";
const APPEAL_BINDING = "private.public_appeal_provisional_binding_v1(uuid)";

const readBase = (() => {
  let body = definition(NORMALIZATION, "create or replace function private.path_b_result_read_v1(",
    header("private.path_b_result_read_v1(p_account_id uuid, p_subject_id uuid, p_purpose text)", "jsonb", PATH("'pg_catalog'")));
  const [queuedOld, queuedNew] = fragments(between(QUEUED,
    "do $patch$\ndeclare body text:=pg_get_functiondef('private.path_b_result_read_v1(uuid,uuid,text)'::regprocedure);", "$patch$;"));
  body = apply(body, queuedOld, queuedNew);
  const [transferOld, transferNew] = fragments(between(TRANSFER, "do $patch_read$", "$patch_read$;"));
  return apply(body, transferOld, transferNew);
})();
/** The four bodies this migration patches, as the migrations before it left them. */
const BASES: Record<string, string> = {
  [SOURCE]: replay(HOLD_PATCHES, SOURCE, definition(NORMALIZATION, "create function private.path_b_normalization_authority_v1(",
    header("private.path_b_normalization_authority_v1(p_revision_id uuid, p_checkpoint text)", "jsonb", PATH("''")))),
  [READ]: readBase,
  [REPORT]: definition(QUEUED, "create function private.path_b_report_authority_v1(",
    header("private.path_b_report_authority_v1(p_file_id uuid, p_grant_id uuid, p_checkpoint text)", "jsonb", PATH("''"))),
  [CAPTURE]: replay(READERS_PATCHES, CAPTURE, replay(TRANSFERRED_PATCHES, CAPTURE, definition(READABLE_GRAPH,
    "create function private.export_account_ordinary_readable_authority_v1(",
    header("private.export_account_ordinary_readable_authority_v1(p_origin jsonb, p_target_kind text, p_target_id uuid)", "jsonb",
      PATH("'pg_catalog', 'private'"))))),
};
/** Pinned and unchanged: the uploader's confirmation read, what its retention clause asks, and its three other callers. */
const PINNED: Record<string, string> = {
  [UPLOADER_READ]: definition(REVIEWED, "create or replace function private.path_b_subject_v1(",
    header("private.path_b_subject_v1(p_account_id uuid, p_subject_id uuid)", "jsonb", PATH("'pg_catalog', 'private'"))),
  "private.path_b_reviewed_document_retained_v1(uuid)": definition(REVIEWED, "create function private.path_b_reviewed_document_retained_v1(",
    sqlHeader("private.path_b_reviewed_document_retained_v1(p_subject_id uuid)")),
  "private.permission_document_live_v1(private.permission_documents)": definition(REVIEWED, "create function private.permission_document_live_v1(",
    sqlHeader("private.permission_document_live_v1(p_document private.permission_documents)")),
  [STORE]: definition(HELD_UPLOAD, "create function private.other_adult_upload_store_authority_v1(",
    header("private.other_adult_upload_store_authority_v1(p_account_id uuid, p_session_id uuid, p_subject_id uuid)", "jsonb",
      PATH("'pg_catalog', 'private'"))),
  [FINALIZE]: definition(NOTICE_CONTEXT, "create or replace function private.complete_own_upload_finalization_v1(",
    header("private.complete_own_upload_finalization_v1(p_account_id uuid, p_session_id uuid, p_upload_id uuid, p_claim uuid, "
      + "p_storage_object_id uuid, p_raw_sha256 text, p_decoded_sha256 text)", "jsonb", PATH("'pg_catalog', 'private'"))),
  [APPEAL_BINDING]: replay(READERS_PATCHES, APPEAL_BINDING, definition(APPEAL, "create function private.public_appeal_provisional_binding_v1(",
    header("private.public_appeal_provisional_binding_v1(p_case uuid)", "jsonb", PATH("''")))),
};
/** The migration that last restated each body, before this one. */
const DEFINED_IN: Record<string, string> = {
  "private.path_b_normalization_authority_v1": "20260930231000_path_b_normalization.sql",
  "private.path_b_result_read_v1": "20260930231000_path_b_normalization.sql",
  "private.path_b_report_authority_v1": "20260930234000_path_b_queued_reports.sql",
  "private.export_account_ordinary_readable_authority_v1": "20261001039000_account_archive_readable_graph.sql",
  "private.path_b_subject_v1": "20261016190000_path_b_reviewed_document.sql",
  "private.path_b_reviewed_document_retained_v1": "20261016190000_path_b_reviewed_document.sql",
  "private.permission_document_live_v1": "20261016190000_path_b_reviewed_document.sql",
  "private.other_adult_upload_store_authority_v1": "20260928150000_other_adult_held_upload.sql",
  "private.complete_own_upload_finalization_v1": "20261010063629_adult_upload_notice_context.sql",
  "private.public_appeal_provisional_binding_v1": "20261009224500_public_appeal_matched_review.sql",
};
const rewrites = (file: string, qualified: string) => {
  const sql = read(`supabase/migrations/${file}`);
  const local = qualified.slice(qualified.indexOf(".") + 1);
  return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "iu").test(sql)
    || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
};

const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const postflight = between(migration, "do $postflight$", "$postflight$;");
const patchBlock = between(migration, "do $patch_access$", "$patch_access$;");
const patches = parse(patchBlock);
const helper = definition(migration, "create function private.path_b_confirmation_v1(",
  header("private.path_b_confirmation_v1(p_account_id uuid, p_subject_id uuid)", "jsonb", PATH("'pg_catalog', 'private'")));
/** Each body after this migration's patch, replayed from its rebuilt predecessor. */
const successors = new Map(patches.map(patch => [patch.target, apply(BASES[patch.target]!, patch.old, patch.next)]));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pinOf = (signature: string, digest: string, acl: string) => new RegExp(`\\('${escape(signature)}','${digest}','${escape(acl)}'\\)`, "u");
const code = (text: string) => text.split("\n").filter(line => !line.trimStart().startsWith("--")).join(" ").replace(/\s+/gu, " ").trim();
const ACL: Record<string, string> = { [UPLOADER_READ]: "{postgres=X/postgres,service_role=X/postgres}",
  [STORE]: "{postgres=X/postgres,service_role=X/postgres}", [FINALIZE]: "{postgres=X/postgres,service_role=X/postgres}" };
const aclOf = (signature: string) => ACL[signature] ?? "{postgres=X/postgres}";
/** The retention clause of the uploader's confirmation read, and the helper's in its place. */
const RETAINED = "  -- 20261016190000: or the reviewed-document flow, with its approved document still live.\n"
  + "  and ((adult_flow='path-b-subject-esignature' and evidence_kind='esignature')\n"
  + "   or (adult_flow='path-b-reviewed-document' and evidence_kind='uploaded_document'\n"
  + "    and private.path_b_reviewed_document_retained_v1(s.id)))\n";
const EITHER = "  -- 20261122190000 (D-166): either Path B flow, each with its own evidence; the\n"
  + "  -- approved document's retention is the uploader's (private.path_b_subject_v1).\n"
  + "  and ((adult_flow='path-b-subject-esignature' and evidence_kind='esignature')\n"
  + "   or (adult_flow='path-b-reviewed-document' and evidence_kind='uploaded_document'))\n";
const PERSON_GATE = "if m->>'decision' is distinct from 'subject-own-right-only' then perform private.path_b_subject_v1(p_account_id,p_subject_id); end if;";
const LAYER_GATE = "if d.direction is distinct from 'self' then perform private.path_b_subject_v1(s.owner_account_id,s.id); end if;";

describe("the release it belongs to", () => {
  it("is a guarded production release after every migration whose bodies it patches or pins", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of [...new Set(Object.values(DEFINED_IN)), "20260930234000_path_b_queued_reports.sql",
      "20261016221000_subject_transfer.sql", "20261120120000_adult_acceptance_hold_and_renotice.sql",
      "20261122160000_transferred_record_exports.sql", "20261122180000_path_b_reviewed_document_readers.sql"]) {
      expect(files, earlier).toContain(earlier);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(files.filter(file => file.startsWith("20261122190000_"))).toEqual([NAME]);
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(`# Release notes: \`${NAME}\``);
  });

  it("creates one helper, callable by no API role, and patches four bodies through one md5-guarded loop: nothing else", () => {
    expect([...statements.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/giu)].map(match => match[1]))
      .toEqual(["private.path_b_confirmation_v1"]);
    expect(statements).toContain("revoke all on function private.path_b_confirmation_v1(uuid,uuid)\n"
      + " from public,anon,authenticated,inherit_upload_only,service_role;");
    expect(statements.match(/^\s*(grant|revoke)\s/gimu)).toHaveLength(1);
    expect(statements).not.toMatch(/\b(alter|drop|create)\s+(table|index|trigger|policy|type|constraint|view|schema)\b/iu);
    expect(statements).not.toMatch(/\b(insert\s+into|update\s+public\.|update\s+private\.|delete\s+from)\b/iu);
    expect(patches.map(patch => patch.ordinal)).toEqual([1, 2, 3, 4]);
    expect(patches.map(patch => patch.target)).toEqual([SOURCE, READ, REPORT, CAPTURE]);
    expect(count(migration, "execute replace(definition,item.old_fragment,item.new_fragment);")).toBe(1);
    expect(patchBlock).toContain("and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner");
    expect(migration).not.toContain("pg_get_functiondef('");
  });

  it("is the last word on what it patches and creates: no later migration restates or patches those bodies", () => {
    // 2026-11-22: 20261122200000 (D-166, the public appeal) has the appeal's resolution ask
    // the helper. It is the only later migration allowed to name the helper beside a patch,
    // and only the helper: it pins it at this migration's md5 (and excludes it from its own
    // list of the helper's askers) and calls it in its one patch row, and never restates
    // or patches it.
    const D166_APPEAL = "20261122200000_reviewed_document_person_appeal.sql";
    const allowed: Record<string, string[]> = { "private.path_b_confirmation_v1": [D166_APPEAL] };
    for (const qualified of [...patches.map(patch => patch.target), HELPER].map(target => target.slice(0, target.indexOf("(")))) {
      expect(files.filter(file => file > NAME && rewrites(file, qualified)), qualified).toEqual(allowed[qualified] ?? []);
    }
    const appeal = read(`supabase/migrations/${D166_APPEAL}`);
    expect(appeal).not.toMatch(/create\s+(?:or\s+replace\s+)?function\s+(?:\w+\.)?path_b_confirmation_v1\s*\(/iu);
    expect(count(appeal, "'private.path_b_confirmation_v1(")).toBe(3);
    for (const block of [between(appeal, "do $predecessor$", "$predecessor$;"), between(appeal, "do $postflight$", "$postflight$;")]) {
      expect(block).toMatch(pinOf(HELPER, md5(helper), "{postgres=X/postgres}"));
    }
    expect(parse(between(appeal, "do $patch_appeal$", "$patch_appeal$;")).map(row => row.target))
      .toEqual(["private.public_appeal_provisional_binding_v1(uuid)"]);
  });
});

describe("the predecessor block, the helper, the patches and the postflight", () => {
  it("pins every body it patches or relies on to the md5 recomputed from its source, with its ACL", () => {
    for (const [signature, body] of [...Object.entries(BASES), ...Object.entries(PINNED)]) {
      expect(preflight, signature).toMatch(pinOf(signature, md5(body), aclOf(signature)));
    }
    for (const patch of patches) expect(patch.before, patch.label).toBe(md5(BASES[patch.target]!));
    expect(Object.values(BASES).map(md5)).toEqual(["591fc9f913fb7177ed86144a7ce654f4", "d39c35dab17636d453a18f41bde4ede4",
      "a77b3f10be091726b10930ba06b82680", "5c9fee7018806a025ad537664cd23b69"]);
    expect(md5(PINNED[UPLOADER_READ]!)).toBe("d174a83682e35479797ac7e738a65d79");
    expect(preflight).toContain(")<>10\n");
    expect(preflight).toContain("or to_regprocedure('private.path_b_confirmation_v1(uuid,uuid)') is not null then");
    expect(preflight).toContain("raise exception using errcode='55000',message='reviewed document person access prerequisite differs'");
    // Since the migration that last restated each body, only the replayed patches touched it. The detector also
    // flags a file that names a body beside a patch of another; each such file only checks or pins it (below).
    const replayed: Record<string, string[]> = {
      "private.path_b_report_authority_v1": ["20261001039000_account_archive_readable_graph.sql", "20261016221000_subject_transfer.sql"],
      "private.path_b_normalization_authority_v1": ["20261120120000_adult_acceptance_hold_and_renotice.sql"],
      "private.path_b_result_read_v1": ["20261016221000_subject_transfer.sql", "20261120130000_subject_copilot_scope.sql"],
      "private.export_account_ordinary_readable_authority_v1": ["20261122160000_transferred_record_exports.sql",
        "20261122180000_path_b_reviewed_document_readers.sql"],
      "private.path_b_subject_v1": ["20261122160000_transferred_record_exports.sql", "20261122180000_path_b_reviewed_document_readers.sql"],
      "private.public_appeal_provisional_binding_v1": ["20261122180000_path_b_reviewed_document_readers.sql"],
      "private.path_b_reviewed_document_retained_v1": ["20261016220000_subject_delete_reviewed_document.sql"],
    };
    for (const [qualified, source] of Object.entries(DEFINED_IN)) {
      expect(files.filter(file => file > source && file < NAME && rewrites(file, qualified)), qualified).toEqual(replayed[qualified] ?? []);
    }
    // 20260930234000 also patched the read decision, through `replace(body,…` (replayed above, and
    // not a pattern the detector sees); 20261120130000 and 20261122160000 only pin bodies here, at the
    // md5 rebuilt here, and 20261122180000 pins the uploader's read and patches the appeal (replayed).
    expect(read("supabase/migrations/20261120130000_subject_copilot_scope.sql"))
      .toContain(`'${READ}')\n   and md5(pg_get_functiondef(p.oid))='${md5(BASES[READ]!)}'`);
    expect(TRANSFERRED).toContain(`to_regprocedure('${UPLOADER_READ}')\n   and md5(pg_get_functiondef(p.oid))='${md5(PINNED[UPLOADER_READ]!)}'`);
    expect(TRANSFERRED_PATCHES.map(patch => patch.target)).not.toContain(UPLOADER_READ);
    expect(READERS).toContain(`('${UPLOADER_READ}','${md5(PINNED[UPLOADER_READ]!)}','{postgres=X/postgres,service_role=X/postgres}')`);
    // 20261001039000 checks the report authority's source md5 and privileges; 20261016221000 that it exists;
    // 20261016220000 that the retention question exists.
    expect(read("supabase/migrations/20261016220000_subject_delete_reviewed_document.sql"))
      .toContain(" if to_regprocedure('private.path_b_reviewed_document_retained_v1(uuid)') is null\n");
    const reportSource = between(BASES[REPORT]!, "AS $function$", "$function$\n");
    expect(md5(reportSource)).toBe("36e5de75cf5a37a46e42c970ea3da4f3");
    expect(READABLE_GRAPH).toContain(`  and md5(p.prosrc)='${md5(reportSource)}') or exists(`);
    expect(TRANSFER).toContain("  or to_regprocedure('private.path_b_report_authority_v1(uuid,uuid,text)') is null\n");
  });

  it("pins in the predecessor block exactly the five callers of the uploader's confirmation read, and in the postflight its five askers", () => {
    const callers = between(preflight, "from unnest(array[\n", "]) x order by 1)").split(",\n").map(line => line.trim().replace(/^'|'$/gu, ""));
    expect(callers).toEqual([FINALIZE, CAPTURE, STORE, SOURCE, APPEAL_BINDING]);
    const askers = between(postflight, "from unnest(array[\n", "]) x order by 1)").split(",\n").map(line => line.trim().replace(/^'|'$/gu, ""));
    expect(askers).toEqual([FINALIZE, STORE, REPORT, READ, APPEAL_BINDING]);
    // Before: each of the five calls it, from its source.
    for (const caller of callers) {
      const body = BASES[caller] ?? PINNED[caller]!;
      expect(body, caller).toMatch(/[^a-z_]path_b_subject_v1\s*\(/u);
    }
    // The uploader's doors ask it for the uploader's own account and the record.
    expect(PINNED[STORE]).toContain(" t:=private.path_b_subject_v1(p_account_id,p_subject_id);\n");
    expect(PINNED[FINALIZE]).toContain("  t:=private.path_b_subject_v1(p_account_id,u.subject_id);\n");
    // After: the four patched bodies and the helper; only the two gates ask it among them.
    for (const [target, body] of successors) {
      expect(count(body, "private.path_b_subject_v1("), target).toBe(target === READ || target === REPORT ? 1 : 0);
      expect(count(body, "private.path_b_confirmation_v1("), target).toBe(target === SOURCE || target === CAPTURE ? 1 : 0);
    }
    expect(helper).not.toMatch(/[^a-z_]path_b_subject_v1\s*\(/u);
  });

  it("restates the uploader's confirmation read as the helper, line for line, without its retention clause", () => {
    expect(count(PINNED[UPLOADER_READ]!, RETAINED)).toBe(1);
    const restated = PINNED[UPLOADER_READ]!.replace(RETAINED, () => EITHER)
      .replace("CREATE OR REPLACE FUNCTION private.path_b_subject_v1(", "CREATE OR REPLACE FUNCTION private.path_b_confirmation_v1(");
    expect(helper).toBe(restated);
    expect(code(helper)).not.toContain("retained");
    expect(code(EITHER)).toBe(code(RETAINED).replace(" and private.path_b_reviewed_document_retained_v1(s.id))", ")"));
    expect(migration).toContain("create function private.path_b_confirmation_v1(p_account_id uuid, p_subject_id uuid)\n"
      + "returns jsonb language plpgsql security definer set search_path='pg_catalog','private' as $function$\n");
    expect(postflight).toMatch(pinOf(HELPER, md5(helper), "{postgres=X/postgres}"));
    expect(postflight).toContain("and p.prosecdef and p.provolatile='v' and p.proowner='postgres'::regrole\n"
      + "   and p.proconfig=array['search_path=pg_catalog, private']::text[])");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration, its postflight and the pgTAP suite assert", () => {
    for (const patch of patches) {
      expect(md5(successors.get(patch.target)!), patch.label).toBe(patch.after);
      expect(postflight, patch.target).toMatch(pinOf(patch.target, patch.after, patch.acl));
      expect(patch.acl, patch.label).toBe("{postgres=X/postgres}");
    }
    for (const [signature, body] of Object.entries(PINNED)) expect(postflight, signature).toMatch(pinOf(signature, md5(body), aclOf(signature)));
    expect(postflight).toContain(")<>11\n");
    expect(postflight).toContain("raise exception using errcode='55000',message='reviewed document person access successor differs'");
  });
});

describe("D-166: only the uploader's access needs the retained document", () => {
  it("changes only the one line each patch anchors, and every other line of each body stays", () => {
    for (const patch of patches) {
      expect(patch.next, patch.label).toMatch(/^\s*(?:if private\.path_b_normalization_authority_v1[^\n]*\n)?\s*-- 20261122190000 \(D-166\): /u);
      let before = BASES[patch.target]!; let after = successors.get(patch.target)!;
      before = before.replace(patch.old, ""); after = after.replace(patch.next, "");
      expect(after, patch.target).toBe(before);
    }
  });

  it("asks the record's confirmation in place of the uploader's where the person reads (the capture) and where the source is read", () => {
    const [source, , , capture] = patches;
    expect(code(source!.old)).toBe("t:=private.path_b_subject_v1(h.uploader_account_id,h.subject_id);");
    expect(code(source!.next)).toBe("t:=private.path_b_confirmation_v1(h.uploader_account_id,h.subject_id);");
    expect(code(capture!.old)).toBe("confirmation:=private.path_b_subject_v1(s.owner_account_id,s.id);");
    expect(code(capture!.next)).toBe("confirmation:=private.path_b_confirmation_v1(s.owner_account_id,s.id);");
    // The capture is reached only for a record whose person is the exporting account.
    expect(BASES[CAPTURE]).toContain(" for s in select * from public.subjects where subject_account_id=a and lifecycle<>'purged'\n");
    // The source authority's only reader-specific caller paths are the read decision and the report authority.
    expect(BASES[READ]).toContain("private.path_b_normalization_authority_v1((c->>'fileId')::uuid,'derived-write-and-read')");
    expect(BASES[REPORT]).toContain(" a:=private.path_b_normalization_authority_v1(p_file_id,p_checkpoint);\n");
  });

  it("keeps the uploader's read for any reader but the person, and any layer but the person's own, where the source used to ask it", () => {
    const [, read, report] = patches;
    expect(code(read!.next)).toBe(`${code(read!.old)} ${PERSON_GATE}`);
    expect(code(report!.next)).toBe(`${LAYER_GATE} ${code(report!.old)}`);
    // The decision is 'subject-own-right-only' only for the person's own account (20261120120000, unchanged since but by D-154's lookup).
    const person = HOLD_PATCHES.find(patch => patch.label === "mitigation own account")!;
    expect(person.next.startsWith(" if p_account_id=s.subject_account_id then\n")).toBe(true);
    expect(count(person.next, "'subject-own-right-only'")).toBe(1);
    expect(code(person.next).endsWith("return jsonb_build_object('decision','subject-own-right-only','gate',null); end if;")).toBe(true);
    // In the report authority a 'self' layer is the person's own, every other layer is shared with the uploader.
    expect(BASES[REPORT]).toContain(" if d.direction='self' then\n  if d.relationship_id is not null or rp.id<>sp.id or d.recipient_account_id<>sp.account_id\n");
    expect(BASES[REPORT]).toContain(" elsif d.direction='subject_to_recipient' then\n");
    expect(BASES[REPORT]).toContain("or rel.recipient_account_id<>pr.id or pr.id<>s.owner_account_id\n");
    expect(BASES[REPORT]).toContain(" else raise exception using errcode='42501',message='not_found'; end if;\n");
    // The read decision's gate sits inside the loop's insufficient_privilege handler, as the source authority's refusal did.
    const loop = between(successors.get(READ)!, "  begin\n   if private.path_b_normalization_authority_v1(", "  exception when insufficient_privilege then null;");
    expect(loop).toContain("perform private.path_b_subject_v1(p_account_id,p_subject_id); end if;");
    // The report authority's gate follows the source authority and the grant's own checks, before the person read.
    const authority = successors.get(REPORT)!;
    expect(authority.indexOf(" a:=private.path_b_normalization_authority_v1(p_file_id,p_checkpoint);"))
      .toBeLessThan(authority.indexOf(LAYER_GATE));
    expect(authority.indexOf(LAYER_GATE)).toBeLessThan(authority.indexOf(" c:=private.path_b_person_v1("));
  });

  it("leaves the uploader's upload rule where the register puts it", () => {
    const register = read("docs/route-register.json");
    expect(() => JSON.parse(register) as unknown).not.toThrow();
    const rule = between(register, "\"path-b-reviewed-document\": \"the-subject-row-retains-immutable-adult_flow-path-b-reviewed-document", "\",\n");
    expect(rule).toContain("the-exact-adult-signed-permission-document-plus-current-named-human-approved-review-revisions-remain-current");
    expect(rule).toContain("registered-2026-11-22-D-166");
    // 2026-11-22: 20261122200000 (D-166, the public appeal) marks one more statement, the
    // appeal's subject-objection resolver, with the same decision; nothing else carries it.
    expect(count(register, "registered-2026-11-22-D-166")).toBe(2);
    expect(count(rule, "registered-2026-11-22-D-166")).toBe(1);
    expect(count(between(register, "\"subject-objection\": \"constant-time-match-only-the-activated-random-case-principals", "\",\n"),
      "registered-2026-11-22-D-166")).toBe(1);
  });
});

describe("its tests", () => {
  it("is driven by its pgTAP suite, which rebuilds each predecessor by reversing exactly this migration's anchors", () => {
    expect(pgtap.startsWith("-- D-166: after a reviewed-document record's approved document is no longer")).toBe(true);
    expect(pgtap).toMatch(/\nbegin;\n/u);
    expect(pgtap.trimEnd().endsWith("select * from finish();\nrollback;")).toBe(true);
    const rows = between(patchBlock, " for item in select * from (values\n", "\n ) as patch(");
    expect(pgtap).toContain(`insert into d166_patches values\n${rows};\n`);
    expect(pgtap).toContain("replace(t.def,t.new_fragment,t.old_fragment)");
    expect(pgtap).toContain(`'${md5(helper)} {postgres=X/postgres} true v search_path=pg_catalog, private'`);
    for (const fragment of ["\\ir fixtures/path_b_source_setup.inc", "public.finalize_path_b_reviewed_document_v1(",
      "public.decide_permission_document_v1(", "alter table private.permission_documents disable trigger permission_document_transition;",
      "set retain_until=clock_timestamp()-interval '1 minute'", "(retained) from them, every answer about the reviewed-document record is the same",
      "(predecessor) D-166: the person''s own saved results and exports stopped with the uploader''s access",
      "(ended) the person''s own saved results and exports continue; the uploader''s saved results and Copilot do not",
      "(ended) the person exports the record and their whole account, with the complete archive off and on",
      "(ended) their copies made before still work, as the e-signature record''s person''s do",
      "(ended) every uploader path answers exactly as before the migration",
      "(late) the person''s own result of it is made; none for the uploader, who has one of the e-signature record''s",
      "private.permission_document_objects_due_v1(1000)", "public.transfer_subject_v1(pg_temp.a('5')",
      "public.withdraw_other_adult_upload_v1(pg_temp.a('1')", "(moved, predecessor) after a transfer the retention was never read",
      "and the same as before the document''s retention ended"]) {
      expect(pgtap, fragment).toContain(fragment);
    }
  });
});
