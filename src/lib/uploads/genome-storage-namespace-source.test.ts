import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const migrationPath = "supabase/migrations/20261010125904_genome_storage_namespace.sql";
const migration = readFileSync(migrationPath, "utf8");
function body(file: string, name: string): string {
  const source = readFileSync(file, "utf8");
  const pattern = new RegExp(`create(?: or replace)? function private\\.${name}\\b[\\s\\S]*?as (\\$function\\$|\\$\\$)[\\s\\S]*?\\1;`, "i");
  const match = pattern.exec(source);
  expect(match, name).not.toBeNull();
  return match![0].replace(/^create function/, "create or replace function");
}
const root = "supabase/migrations/";
const held = root + "20260928150000_other_adult_held_upload.sql";
const originalKey = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
describe("namespace changes preserve complete native authority bodies", () => {
  it.each([
    [root + "20260930125000_own_upload_allowance_excludes_embryo.sql", "issue_own_storage_upload_v1"],
    [held, "issue_other_adult_held_upload_v1"],
  ])("retains every issuance predicate/cap/current revision in %s", (file, name) => {
    const current = body(migrationPath, name)
      .replace("v_reserved numeric; v_upload uuid:=gen_random_uuid();", "v_reserved numeric;")
      .replace("insert into public.upload_sessions(id,account_id,", "insert into public.upload_sessions(account_id,")
      .replace("values(v_upload,p_account_id,p_session_id,p_subject_id,\n  private.subject_upload_object_key_v1(p_account_id,p_subject_id,v_upload,p_declared_format,true),p_size_bytes,p_sha256,",
        "values(p_account_id,p_session_id,p_subject_id,gen_random_uuid()::text,p_size_bytes,p_sha256,");
    expect(current).toBe(body(file, name));
  });
  it.each(["own_upload_finalization_v1", "begin_own_upload_finalization_v2"])("preserves complete authority/recovery/claim ordering in %s", name => {
    const current = body(migrationPath, name).replace("private.subject_upload_object_key_v1(u.account_id,u.subject_id,u.id,u.declared_format,false)", "gen_random_uuid()");
    expect(current).toBe(body(held, name));
  });
  it("keeps the RLS authority predicate exact apart from the locator syntax", () => {
    const current = body(migrationPath, "authorize_storage_upload_insert")
      .replace("not private.genome_original_key_shape_v1(claims->>'staging_key')", () => `coalesce(claims->>'staging_key','')!~'${originalKey}'`);
    expect(current).toBe(body(held, "authorize_storage_upload_insert"));
    expect(readFileSync(root + "20260922212423_own_upload_standard_transport_binding.sql", "utf8")).toContain("current_setting('storage.operation',true)='storage.object.upload'");
  });
  it("keeps complete normalization and original-retirement authority", () => {
    const normalization = body(migrationPath, "own_upload_normalization_v1")
      .replace("not private.genome_original_key_shape_v1(f.bucket_path)", () => `f.bucket_path!~'${originalKey}'`);
    expect(normalization).toBe(body(root + "20260918150000_own_upload_gvcf_ceiling.sql", "own_upload_normalization_v1"));
    const retirement = body(migrationPath, "track_own_original_retirement_v1").replace("f.bucket_path,object_version::uuid", "f.bucket_path::uuid,object_version::uuid");
    expect(retirement).toBe(body(root + "20260909001117_own_prepared_original_retirement.sql", "track_own_original_retirement_v1"));
  });
  it("preserves old locator bytes and never renames, moves or scans Storage", () => {
    expect(migration).toContain("alter column final_object_name type text using final_object_name::text");
    expect(migration).toContain("alter column object_key type text using object_key::text");
    expect(migration).not.toMatch(/(?:update|delete from|insert into) storage\.objects|create policy|grant (?:select|insert|update|delete)/i);
    expect(migration).toContain("old.final_object_name is not null and new.final_object_name is distinct from old.final_object_name");
    expect(migration).toContain("substring(new.final_object_name from length(prefix)+37) is distinct from expected_extension");
    for (const signature of ["genome_original_key_shape_v1(text)", "subject_upload_object_key_v1(uuid,uuid,uuid,text,boolean)", "guard_subject_upload_namespace_v1()"]) {
      expect(migration).toContain(`revoke all on function private.${signature}\n from public,anon,authenticated,inherit_upload_only,service_role;`);
    }
  });
});
