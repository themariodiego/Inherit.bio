import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-156, the inviter's account archive (20261122140000_adult_acceptance_inviter_archive_reads.sql;
 * owner decision of 22 November 2026, docs/protocol/decisions.md). The
 * migration creates nothing; it patches the native complete archive's four
 * recipient checkpoints in place under the md5-guarded convention, asking the
 * question 20261122110000 added. pg_get_functiondef keeps a body verbatim, so
 * each predecessor (and the question it pins) is rebuilt here from the
 * migration that defined it and every md5 is recomputed. The pgTAP suite
 * (supabase/tests/adult_acceptance_inviter_archive_reads.sql) drives the
 * archive through the hold, the release, a request made before the reminder
 * and the reminder itself.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261122140000_adult_acceptance_inviter_archive_reads.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/adult_acceptance_inviter_archive_reads.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
/** The migration's statements, without its comment lines (which name what it leaves alone). */
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
const archiveHeader = (signature: string, returns: string) =>
  `CREATE OR REPLACE FUNCTION ${signature}\n RETURNS ${returns}\n LANGUAGE plpgsql\n SECURITY DEFINER\n`
  + " SET search_path TO ''\n SET lock_timeout TO '250ms'\n";
function apply(text: string, [old, next]: [string, string]): string {
  expect(count(text, old), old.slice(0, 80)).toBe(1);
  return text.replace(old, () => next);
}

const ARCHIVE = read("supabase/migrations/20261010190500_account_archive_complete.sql");
const SUBJECTS = definition(ARCHIVE, "create function private.account_archive_complete_subjects_v1(",
  archiveHeader("private.account_archive_complete_subjects_v1(p_origin jsonb)", "uuid[]"));
const AUTHORITY = definition(ARCHIVE, "create function private.account_archive_complete_subject_authority_v1(",
  archiveHeader("private.account_archive_complete_subject_authority_v1(p_origin jsonb, p_subject uuid, p_legacy jsonb)", "jsonb"));
const RECIPIENT = definition(ARCHIVE, "create function private.account_archive_export_recipient_v1(",
  archiveHeader("private.account_archive_export_recipient_v1(p_origin jsonb, p_subject uuid)", "jsonb"));
const RAW = definition(ARCHIVE, "create function private.account_archive_raw_authority_v1(",
  archiveHeader("private.account_archive_raw_authority_v1(p_origin jsonb, p_subject uuid)", "jsonb"));
const QUESTION = definition(read("supabase/migrations/20261122110000_adult_acceptance_inviter_reads.sql"),
  "create function private.adult_acceptance_inviter_held_v1(",
  "CREATE OR REPLACE FUNCTION private.adult_acceptance_inviter_held_v1(p_reader_account_id uuid, p_subject_id uuid)\n"
  + " RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\n");

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const patchBlock = between(migration, "do $patch_inviter_archive$", "$patch_inviter_archive$;");
const patches: Patch[] = [...patchBlock.matchAll(
  /\((\d+),'([^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/gu,
)].map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
  old: match[6]!, next: match[7]!, label: match[8]! }));
const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const TARGETS = ["private.account_archive_complete_subjects_v1(jsonb)",
  "private.account_archive_complete_subject_authority_v1(jsonb,uuid,jsonb)",
  "private.account_archive_export_recipient_v1(jsonb,uuid)", "private.account_archive_raw_authority_v1(jsonb,uuid)"];
const SUCCESSORS = ["f63e4c494c07b5c2055a6570df1f4a13", "6982e98c2b441d2e7eda98eabd5a002d", "8ca5bc23ad2ae076b417ef39f414dd99",
  "4100fff709c7e10d486d135b5f418a6d"];

describe("the release it belongs to", () => {
  it("is a guarded production release that follows the archive it patches and the question it asks", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    for (const earlier of ["20261010190500", "20261122110000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier, earlier).toBe(true);
    }
    expect(read("docs/evidence/release-4-notes-20261119.md")).toContain(NAME);
  });

  it("creates nothing and patches four bodies: no function, table, trigger, policy, constraint or row write", () => {
    expect(statements).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/iu);
    expect(statements).not.toMatch(/\b(alter|drop|create)\s+(table|index|trigger|policy|type|constraint|view)\b/iu);
    expect(statements).not.toMatch(/\b(insert\s+into|update\s+public\.|update\s+private\.|delete\s+from)\b/iu);
    expect(statements).not.toMatch(/^\s*(grant|revoke)\s/imu);
    expect(patches.map(patch => patch.target)).toEqual(TARGETS);
    expect(patches.map(patch => patch.ordinal)).toEqual([1, 2, 3, 4]);
    expect(count(migration, "execute replace(definition,item.old_fragment,item.new_fragment);")).toBe(1);
  });

  it("touches nothing another change of 22 November owns, and leaves the question and the Family readers alone", () => {
    for (const owned of ["transfer_subject", "subject_transfer_open_v1", "withdraw_other_adult_upload", "delete_subject_v1",
      "purge_subject_copilot_chats", "genome_file_deletion", "delete_genome_file", "family_report_recipient_v1",
      "family_copilot_turn_state_v1", "family_portrait_authority_v1", "health_picture_direction_v1", "family_ancestry_recipient_v1",
      "adult_acceptance_clock_state_v1", "other_adult_mitigation", "export_archive_current_v1", "export_account_class_projection_v1",
      "export_account_ordinary_readable_authority_v1", "export_archive_ordinary_account_authority_v1"]) {
      expect(statements.includes(owned), owned).toBe(false);
    }
    // The question is named only where it is pinned and called, never rewritten.
    expect(migration.replace(preflight, "").includes("'private.adult_acceptance_inviter_held_v1(")).toBe(false);
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
  it("pins every body it patches, and the question, to the md5 recomputed from its source, and to its ACL", () => {
    const pins: [string, string][] = [[TARGETS[0]!, md5(SUBJECTS)], [TARGETS[1]!, md5(AUTHORITY)], [TARGETS[2]!, md5(RECIPIENT)],
      [TARGETS[3]!, md5(RAW)], ["private.adult_acceptance_inviter_held_v1(uuid,uuid)", md5(QUESTION)]];
    expect(pins.map(([, hash]) => hash)).toEqual(["43920b19954c11add72cf3a2949cdaa1", "5ee7f9ac82e3bb982e213f675bdb2e43",
      "26872ed747d7fd37b3824d61a7fa563d", "13ee8d5c3055d3dd2aef841fb14060ed", "bd8cde3a947a35f7ae07d24175418515"]);
    for (const [signature, hash] of pins) {
      expect(preflight).toContain(`to_regprocedure('${signature}')\n   and md5(pg_get_functiondef(p.oid))='${hash}' and p.proacl::text='{postgres=X/postgres}')`);
    }
    expect(preflight).toContain("raise exception using errcode='55000',message='adult acceptance inviter archive reads prerequisite differs'");
  });

  it("replays each patch on its rebuilt predecessor to exactly the successor the migration and the pgTAP suite assert", () => {
    const sources = [SUBJECTS, AUTHORITY, RECIPIENT, RAW];
    patches.forEach((patch, index) => {
      expect(md5(sources[index]!), patch.label).toBe(patch.before);
      expect(patch.acl, patch.label).toBe("{postgres=X/postgres}");
      expect(md5(apply(sources[index]!, [patch.old, patch.next])), patch.label).toBe(patch.after);
    });
    expect(patches.map(patch => patch.after)).toEqual(SUCCESSORS);
    for (const hash of SUCCESSORS) expect(pgtap).toContain(hash);
    expect(patchBlock).toContain("and p.proacl is not distinct from before_acl and p.provolatile=before_volatile and p.proowner=before_owner");
  });

  it("only adds the question: every predecessor line survives, and each answers exactly as with no grant", () => {
    for (const patch of patches) {
      for (const line of patch.old.split("\n").filter(Boolean)) {
        const kept = line.replace("   or exists(select 1 from public.directional_grants", "   or (exists(select 1 from public.directional_grants")
          .replace(" if s.subject_class in('self','other_adult') and exists(select 1 from public.purpose_grants g",
            "  and exists(select 1 from public.purpose_grants g");
        expect(patch.next, `${patch.label}: ${line}`).toContain(kept);
      }
      expect(count(patch.next, "private.adult_acceptance_inviter_held_v1(a,s.id)"), patch.label).toBe(1);
      expect(patch.next, patch.label).toContain("20261122140000 (D-156)");
    }
    const [subjects, authority, recipient, raw] = patches;
    // Not listed by its grants to the inviter; any other link still lists it.
    expect(subjects!.next).toContain("    and not private.adult_acceptance_inviter_held_v1(a,s.id))");
    // Listed: as with no live export permission, so excluded with that reason and no raw authority.
    expect(authority!.next).toContain(" if s.subject_class in('self','other_adult') and not private.adult_acceptance_inviter_held_v1(a,s.id)\n"
      + "  and exists(select 1 from public.purpose_grants g");
    // The two authorities refuse exactly as they do when no grant is found.
    for (const reader of [recipient!, raw!]) {
      expect(reader.next).toContain(" if private.adult_acceptance_inviter_held_v1(a,s.id) then raise exception using errcode='42501',message='not_found';end if;");
      expect(reader.old).toBe(" if relationship.id is null then raise exception using errcode='42501',message='not_found';end if;\n");
    }
    // The build and delivery currentness this relies on stays as 20261010190500 and later left it.
    expect(ARCHIVE).toContain("if p_operation is null or p_operation not in('context','rows','row-bytes','original','member-rows','member-bytes',");
  });

  it("is driven by its pgTAP suite through the hold, the release, a request before the reminder and the reminder", () => {
    for (const fragment of ["(hold) A''s archive covers A''s own record only",
      "(hold) what A''s archive reads is exactly what it reads when B has granted A nothing",
      "(hold) the recipient, raw and source authorities refuse A", "(hold, pair)", "(hold) C, whom B also shares with",
      "(hold) B''s own archive is unaffected", "(hold, native off) the preserved export refuses A, as before",
      "(released) A''s archive covers B''s record", "(30 d) the archive requested a minute earlier can no longer be built",
      "(30 d) nor delivered", "(reminded) the same archive is current and builds again, with no job run",
      "public.export_archive_request_v1('create'", "public.export_archive_account_complete_v1(", "private.export_archive_current_v1(",
      "private.account_archive_raw_source_v1("]) {
      expect(pgtap, fragment).toContain(fragment);
    }
    expect(pgtap.startsWith("-- ")).toBe(true);
    expect(pgtap).toContain("\nbegin;\n");
    expect(pgtap.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
