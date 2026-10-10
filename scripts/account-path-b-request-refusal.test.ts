import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const root = path.resolve(__dirname, "..");
const migration = readFileSync(path.join(root, "supabase/migrations/20261001030000_account_path_b_request_refusal.sql"), "utf8");
const fixture = readFileSync(path.join(root, "supabase/tests/account_path_b_request_refusal.sql"), "utf8");
const targets = [
  {
    "signature": "private.request_account_deletion_v2(uuid,uuid,text,timestamptz,bytea,text,text)",
    "name": "private.request_account_deletion_v2",
    "source": "20260930140200_account_operation_nonce_rendered.sql",
    "before_md5": "c638d84a1298b2bdd991173da7f3a3e7",
    "after_md5": "f89dcda65e30d4223387d63843c291e0",
    "anchor": "begin\n  perform private.record_account_operation_nonce_v1(",
    "replacement": "begin\n  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);\n  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);\n  perform private.record_account_operation_nonce_v1("
  },
  {
    "signature": "public.request_account_deletion_v1(uuid,uuid,text,bytea,text,text)",
    "name": "public.request_account_deletion_v1",
    "source": "20260930238000_account_cohort_notices.sql",
    "before_md5": "0a280b4a71a35caad7dccffc4500c893",
    "after_md5": "cc02de010c27a714ff5ba96226016d60",
    "anchor": "  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);",
    "replacement": "  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);\n  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);"
  },
  {
    "signature": "private.assert_supported_self_deletion_graph_v1(uuid)",
    "name": "private.assert_supported_self_deletion_graph_v1",
    "source": "20260930235000_account_cohort_purge.sql",
    "before_md5": "624b7aa17cfb8c20dbf0f0c7f600ff3c",
    "after_md5": "be1e996ec3bf2c0e585c7a4b39decbc1",
    "anchor": "begin\n  perform private.assert_account_owned_cohorts_v1(p_account_id);",
    "replacement": "begin\n  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);\n  perform private.assert_account_owned_cohorts_v1(p_account_id);"
  }
] as const;
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
describe("closed current Path B account deletion preflight", () => {
  for (const target of targets) it(`preserves all other ${target.signature} bytes`, () => {
    const source = readFileSync(path.join(root, "supabase/migrations", target.source), "utf8");
    const pattern = new RegExp(`create (?:or replace )?function ${target.name.replaceAll(".", "\\.")}\\([^;]*?\\bas\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1;`, "iu");
    const body = source.match(pattern)![2]!;
    expect(md5(body)).toBe(target.before_md5);
    expect(body.split(target.anchor)).toHaveLength(2);
    const patched = body.replace(target.anchor, target.replacement);
    expect(md5(patched)).toBe(target.after_md5);
    expect(patched.replace(target.replacement, target.anchor)).toBe(body);
    for (const hash of [target.before_md5,target.after_md5]) expect(migration).toContain(`'${hash}'`);
  });
  it("requires actual authentication and graph refusal before recording any nonce", () => {
    const wrapper = targets[0]!.replacement;
    expect(wrapper.indexOf("validate_sensitive_account_session_v1")).toBeLessThan(wrapper.indexOf("assert_account_path_b_deletion_supported_v1"));
    expect(wrapper.indexOf("assert_account_path_b_deletion_supported_v1")).toBeLessThan(wrapper.indexOf("record_account_operation_nonce_v1"));
    const body = migration.match(/as \$body\$([\s\S]*?)\$body\$;/u)![1]!;
    expect(md5(body)).toBe("6382fbb06d5525dc983806ecefebb629");
    for (const evidence of ["d.owner_account_id=p_account_id", "s.subject_account_id=p_account_id", "h.uploader_account_id=p_account_id", "b.recipient_account_id=p_account_id", "d.recipient_account_id=p_account_id", "u.upload_authority_kind='other-adult-held'"]) expect(body).toContain(evidence);
    expect(body).toContain("public.profiles where id=p_account_id for update");
    expect(body).not.toMatch(/delete from|update public|state in|state=|status=/iu);
    expect(migration).not.toMatch(/grant execute|disable trigger|delete from|update public|create table/iu);
    expect(migration).toContain("proacl is not distinct from before_acl");
  });
  it("uses native signatures, held publication and worker producers for whole-graph rollback", () => {
    for (const evidence of ["pg_temp.requested", "pg_temp.account_confirms", "pg_temp.hold", "public.respond_adult_upload_revision_v1", "public.path_b_normalization_v1('stage'", "public.path_b_normalization_v1('complete'", "from private.path_b_report_bindings b", "set local role service_role", "'auth.users','auth.sessions','storage.objects'", "select distinct store_name from public.purge_target_stores", "pg_temp.path_b_graph_snapshot(),graph"]) expect(fixture).toContain(evidence);
    expect(fixture).not.toMatch(/insert into public\.worker_jobs|insert into private\.path_b_report_bindings|delete from storage\.objects|disable trigger/iu);
    expect(fixture).toContain("'not_generated'");
    expect(fixture).toContain("b.result is null and b.staged_result is null");
  });
});
