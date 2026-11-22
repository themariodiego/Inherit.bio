import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-103, Path A's typed name (20261025400000_path_a_account_accept_typed_name.sql;
 * owner decision of 23 October 2026, "D-103: Path A acceptance includes a
 * typed name"). The migration patches the shared adult acceptance body in
 * place under the md5-guarded convention: the exact reviewed predecessor and
 * ACL, one anchor per patch, the reviewed successor and the unchanged ACL,
 * 55000 on any mismatch. pg_get_functiondef keeps a plpgsql body verbatim, so
 * the predecessor's definition is rebuilt here from the migration that last
 * defined it and every md5 of the chain is recomputed from source. The
 * pgTAP suite (supabase/tests/path_a_account_accept_typed_name.sql) runs the
 * migration and drives the guard body itself through each of its paths; it
 * must be this migration's guard body byte for byte.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261025400000_path_a_account_accept_typed_name.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/path_a_account_accept_typed_name.sql");
const TARGET = "private.adult_subject_invitation_response_v1(uuid,uuid,text,uuid,text)";
const ACL = "{postgres=X/postgres}";

/** The predecessor as pg_get_functiondef prints it: its normalized header around the verbatim body. */
function predecessorDefinition(): string {
  const source = read("supabase/migrations/20260928150000_other_adult_held_upload.sql");
  const start = source.lastIndexOf("create or replace function private.adult_subject_invitation_response_v1(");
  const open = source.indexOf("as $$\n", start) + "as $$\n".length;
  const close = source.indexOf("\n$$;", open) + 1;
  return "CREATE OR REPLACE FUNCTION private.adult_subject_invitation_response_v1(p_token_hash_id uuid, "
    + "p_session_id uuid, p_action text, p_account_id uuid, p_account_email_hmac text)\n RETURNS text\n"
    + " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n"
    + source.slice(open, close) + "$function$\n";
}

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const patches: Patch[] = [...migration.matchAll(
  /\((\d+),'([^']+)','([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/g,
)].map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
  old: match[6]!, next: match[7]!, label: match[8]! }));

/** The successor definitions, step by step, as the patch loop computes them. */
function successors(): string[] {
  const steps: string[] = [];
  let definition = predecessorDefinition();
  for (const patch of patches) {
    definition = definition.replace(patch.old, () => patch.next);
    steps.push(definition);
  }
  return steps;
}

/** The text between two markers, the first occurrence after `after`. */
function between(text: string, start: string, end: string, after = 0): string {
  const from = text.indexOf(start, after);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}

describe("the release it belongs to", () => {
  it("is a guarded production release in the D-103 range, after every migration it patches", () => {
    const version = Number(NAME.slice(0, 14));
    expect(version).toBeGreaterThanOrEqual(20261025400000);
    expect(version).toBeLessThanOrEqual(20261025499999);
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
    expect(files.filter(file => /^202610254\d{5}_/.test(file))).toEqual([NAME]);
    expect(NAME > "20260928150000_other_adult_held_upload.sql").toBe(true);
  });
});

describe("the guarded in-place patch of the shared acceptance body", () => {
  it("names the exact reviewed predecessor and ACL, in the patch and in the preflight", () => {
    expect(md5(predecessorDefinition())).toBe("824901bf47066e4e974bd90f2b1c7110");
    expect(patches.map(patch => patch.ordinal)).toEqual([1, 2, 3, 4]);
    for (const patch of patches) {
      expect(patch.target).toBe(TARGET);
      expect(patch.acl).toBe(ACL);
    }
    expect(patches[0]!.before).toBe(md5(predecessorDefinition()));
    const preflight = between(migration, "do $predecessor$", "$predecessor$;");
    expect(preflight).toContain(`p.oid='${TARGET}'::regprocedure`);
    expect(preflight).toContain(`md5(pg_get_functiondef(p.oid))='${md5(predecessorDefinition())}'`);
    expect(preflight).toContain(`p.proacl::text='${ACL}'`);
    expect(preflight).toContain("raise exception using errcode='55000'");
  });

  it("finds each anchor exactly once at its step, and each successor is the reviewed md5 the next step requires", () => {
    let definition = predecessorDefinition();
    for (const [index, patch] of patches.entries()) {
      expect(count(definition, patch.old), patch.label).toBe(1);
      expect(md5(definition), patch.label).toBe(patch.before);
      definition = definition.replace(patch.old, () => patch.next);
      expect(md5(definition), patch.label).toBe(patch.after);
      if (index + 1 < patches.length) expect(patches[index + 1]!.before).toBe(patch.after);
    }
    // The pgTAP suite holds the database to the same final successor.
    expect(pgtap).toContain(`'${patches.at(-1)!.after} ${ACL}'`);
  });

  it("requires the declared name, writes its ciphertext, names the new route, and leaves refusing and deleting as they were", () => {
    const before = predecessorDefinition();
    const after = successors().at(-1)!;
    expect(after).toContain("  v_signing_name bytea;\nbegin");
    const declared = after.indexOf("v_signing_name := pg_catalog.decode(nullif(pg_catalog.current_setting(\n"
      + "      'inherit.adult_subject_signing_name', true), ''), 'hex');");
    const cleared = after.indexOf("perform pg_catalog.set_config('inherit.adult_subject_signing_name', '', true);");
    const refused = after.indexOf("if v_signing_name is null or octet_length(v_signing_name) < 16 then\n      return 'unavailable';");
    const written = after.indexOf("insert into public.consent_signatures (");
    expect(after.indexOf("if v_draft.adult_flow <> 'path-a-own-account' then")).toBeLessThan(declared);
    expect(declared).toBeLessThan(cleared);
    expect(cleared).toBeLessThan(refused);
    expect(refused).toBeLessThan(written);
    expect(after.indexOf("update public.subjects")).toBeGreaterThan(refused);
    const signature = between(after, "insert into public.consent_signatures (", ") returning id into v_signature_id;");
    expect(signature).toContain("purpose, statement_keys, signing_name_encrypted, jurisdiction_code,");
    expect(signature).toMatch(/'identity-not-verified', 'revocable'\],\n {6}v_signing_name,\n {6}coalesce\(v_profile\.jurisdiction_code, 'ZZ'\)/);
    expect(after).toContain("'invitation.accepted', null, 'api.invitation-accept', 'accepted',");
    expect(after).not.toContain("'invitation.accepted', null, 'api.withdraw'");
    // Everything from the refusal branch on is the predecessor's, byte for byte.
    const refusal = "  v_terminal_status := case when p_action = 'refuse' then 'refused' else 'revoked' end;";
    expect(after.slice(after.indexOf(refusal))).toBe(before.slice(before.indexOf(refusal)));
    expect(after.slice(0, after.indexOf("  if p_action = 'confirm' then")).replace("  v_signing_name bytea;\n", ""))
      .toBe(before.slice(0, before.indexOf("  if p_action = 'confirm' then")));
  });

  it("uses the convention's guard body, which the pgTAP suite runs byte for byte", () => {
    const guard = between(migration, "order by ordinal loop\n", "\n end loop;");
    expect(guard).toContain("md5(pg_get_functiondef(p.oid))=item.before_md5 and p.proacl::text=item.acl;");
    expect(guard).toContain("if definition is null then raise exception using errcode='55000',message=item.label||' predecessor differs';end if;");
    expect(guard).toContain("(length(definition)-length(replace(definition,item.old_fragment,'')))/length(item.old_fragment)<>1");
    expect(guard).toContain("raise exception using errcode='55000',message=item.label||' anchor differs';end if;");
    expect(guard).toContain("md5(pg_get_functiondef(p.oid))=item.after_md5\n    and p.proacl is not distinct from before_acl");
    expect(guard).toContain("raise exception using errcode='55000',message=item.label||' successor differs';end if;");
    // The convention, as 20261024110000 applies it.
    const reference = read("supabase/migrations/20261024110000_copilot_settings_delete_nonce.sql");
    expect(between(reference, "order by ordinal loop\n", "\n end loop;")).toBe(guard);
    // And the body the pgTAP suite drives through every path.
    const tested = between(pgtap, "declare definition text;before_acl aclitem[];\nbegin\n", "\nend $guarded$;");
    expect(tested).toBe(guard);
  });
});

describe("the account door api.invitation-accept calls", () => {
  const door = between(migration, "create function private.accept_adult_subject_invitation_v1(", "\n$$;");
  it("refuses a missing or short ciphertext before it reads or consumes anything", () => {
    const check = door.indexOf("or p_signing_name_ciphertext is null or octet_length(p_signing_name_ciphertext) < 16");
    expect(check).toBeGreaterThan(0);
    for (const later of ["from auth.sessions", "from public.rights_sessions", "consume_embryo_operation_nonce_v1",
      "current_adult_subject_invitation_v1", "adult_subject_invitation_response_v1"]) {
      expect(door.indexOf(later), later).toBeGreaterThan(check);
    }
  });

  it("requires the account's own live auth session, then spends the account-bound nonce before reading the invitation", () => {
    const auth = door.indexOf("where x.id = p_auth_session_id and x.user_id = p_account_id\n"
      + "    and (x.not_after is null or x.not_after > clock_timestamp());");
    const session = door.indexOf("and rs.purpose = 'adult-subject-invitation'");
    const nonce = door.indexOf("p_nonce, p_account_id, p_auth_session_id, 'invitation_accept',\n    'rights_session', v_session.id");
    const invitation = door.indexOf("v_invitation := private.current_adult_subject_invitation_v1(");
    expect(auth).toBeGreaterThan(0);
    expect(auth).toBeLessThan(session);
    expect(session).toBeLessThan(nonce);
    expect(nonce).toBeLessThan(invitation);
    expect(door).toContain("for update;");
  });

  it("declares the name for exactly one call of the shared body and clears it", () => {
    const declared = door.indexOf("perform pg_catalog.set_config('inherit.adult_subject_signing_name',\n"
      + "    pg_catalog.encode(p_signing_name_ciphertext, 'hex'), true);");
    const call = door.indexOf("v_result := private.adult_subject_invitation_response_v1(\n"
      + "    v_session.token_hash_id, v_session.id, 'confirm', p_account_id, v_contact\n  );");
    const cleared = door.indexOf("perform pg_catalog.set_config('inherit.adult_subject_signing_name', '', true);");
    expect(declared).toBeGreaterThan(0);
    expect(declared).toBeLessThan(call);
    expect(call).toBeLessThan(cleared);
    expect(count(door, "set_config('inherit.adult_subject_signing_name'")).toBe(2);
    expect(count(door, "adult_subject_invitation_response_v1(")).toBe(1);
    expect(door).toContain("if v_result is distinct from 'accepted' then return null; end if;\n  return v_invitation.target_id;");
  });

  it("is service-only, and the postflight holds both functions to that ACL", () => {
    for (const exact of [
      "revoke all on function private.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)\n"
        + " from public,anon,authenticated,inherit_upload_only,service_role;",
      "grant execute on function private.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea) to service_role;",
      "revoke all on function public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)\n"
        + " from public,anon,authenticated,inherit_upload_only;",
      "grant execute on function public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea) to service_role;",
      "and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')<>2 then",
    ]) expect(migration).toContain(exact);
    expect(migration).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
  });
});
