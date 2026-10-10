import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const original = readFileSync(path.join(root, "supabase/migrations/20260928150000_other_adult_held_upload.sql"), "utf8");
const successor = readFileSync(path.join(root, "supabase/migrations/20261010063629_adult_upload_notice_context.sql"), "utf8");
function definition(source: string, name: string) {
  const escaped = name.replaceAll(".", "\\.");
  const match = source.match(new RegExp(`create (?:or replace )?function ${escaped}\\([^;]*?\\bas\\s+(\\$[a-z_]*\\$)[\\s\\S]*?\\1;`, "u"));
  expect(match, name).not.toBeNull();
  return match![0]!.replace("create function ", "create or replace function ");
}

describe("the native adult upload notice context", () => {
  it("preserves the whole finalizer outside the single captured safe uploader field", () => {
    const added = "\n    'uploaderName',private.embryo_notice_display_name_v1(p_account_id),";
    const current = definition(successor, "private.complete_own_upload_finalization_v1");
    expect(current.split(added)).toHaveLength(2);
    expect(current.replace(added, "")).toBe(definition(original, "private.complete_own_upload_finalization_v1"));
  });
  it("retains the original current rights gate and uses only that revision's notice", () => {
    const read = definition(successor, "public.read_adult_upload_revision_v1");
    expect(read).toContain("r:=private.adult_upload_revision_session_v1(p_session_hash);");
    expect(read).toContain("if r is null then return null; end if;");
    expect(read).toContain("m.id=h.notice_outbox_id");
    expect(read).toContain("h.id=(r->>'revisionId')::uuid and m.target_id=h.id");
    expect(read).toContain("m.template_id='adult-upload-notice' and m.purpose='adult-upload-confirmation'");
    expect(read).toContain("jsonb_typeof(m.template_payload->'uploaderName')='string'");
    expect(read).toContain("r-'sessionId'-'revisionId'-'subjectId'");
    expect(read).not.toMatch(/from public\.profiles|update |insert |grant |token_hash|contact_ciphertext/u);
  });
  it("adds no new credential, row store or API grant, and retains native negative coverage", () => {
    expect(successor).not.toMatch(/create table|alter table|disable trigger|grant execute[^;]+to (?:anon|authenticated|inherit_upload_only)/iu);
    for (const signature of ["private.complete_own_upload_finalization_v1(uuid,uuid,uuid,uuid,uuid,text,text)",
      "public.read_adult_upload_revision_v1(text)"]) {
      expect(successor).toContain(`revoke all on function ${signature}`);
      expect(successor).toContain(`grant execute on function ${signature} to service_role;`);
    }
    const native = readFileSync(path.join(root, "supabase/tests/other_adult_held_upload.sql"), "utf8");
    for (const text of ["the notice captures only the exact native uploader account display name",
      "a later unsafe profile edit cannot change", "the expanded safe view retains its exact service-only RPC admission",
      "another session reads nothing", "a fixed 30-day deadline", "before and after"]) {
      expect(native).toContain(text);
    }
  });
});
