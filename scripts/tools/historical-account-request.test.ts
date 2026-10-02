import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20261001040000_historical_account_request_clock.sql");
const predecessor = read("supabase/migrations/20260930238000_account_cohort_notices.sql");
const pins = JSON.parse(read("docs/historical-account-request-function-pins.json")) as {
  predecessors: Array<{ signature: string; bodyMd5: string; successorBodyMd5: string; serviceExecute: boolean }>;
  newFunctions: Array<{ signature: string; bodyMd5: string; serviceExecute: boolean }>;
};
function body(text: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`create (?:or replace )?function ${escaped}\\([\\s\\S]*?as (\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1;`, "iu").exec(text);
  if (!match) throw new Error("Missing historical source function");
  return match[2];
}
function once(text: string, from: string, to: string): string {
  if (text.split(from).length !== 2) throw new Error("Historical source boundary differs");
  return text.replace(from, to);
}
const oldRequest = once(body(predecessor, "public.request_account_deletion_v1"),
  "  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);",
  "  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);\n" +
  "  perform private.assert_account_path_b_deletion_supported_v1(p_account_id);");
const oldNotice = body(predecessor, "private.enqueue_account_affected_notice_v1");
const core = body(migration, "private.request_account_deletion_clock_core_v1");
const notice = body(migration, "private.enqueue_account_affected_notice_clock_core_v1");

// Select the ordinary arms independently from the source builder. Everything
// else must match the complete previous body, including whitespace and order.
function ordinaryRequest(text: string): string {
  let projected = once(text, "  v_effective_at timestamptz := coalesce(p_effective_at, v_now);\n", "");
  projected = once(projected,
    "  if p_effective_at is not null and (not isfinite(p_effective_at) or p_effective_at>v_now) then\n" +
    "    raise exception using errcode='22023',message='invalid historical account clock';end if;\n", "");
  let selected = 0;
  projected = projected.replace(/^( {2}| {4})if p_effective_at is null then\n([\s\S]*?)^\1end if;/gmu,
    (_whole: string, indent: string, alternatives: string) => {
      selected += 1;
      const split = alternatives.indexOf(`${indent}else\n`);
      return split < 0 ? alternatives : alternatives.slice(0, split);
    });
  if (selected !== 4) throw new Error("Historical ordinary-arm count differs");
  // The two early arms wrap an original block already ending in two newlines;
  // their wrapper also ends in two. Restore the original separator exactly.
  projected = projected.replace(/\n{4}(?=  select ecr\.id into v_contact_id|  for v_binding)/gu, "\n\n");
  projected = projected.replace(/\n{2}(?=    v_bound:=)/gu, "\n");
  projected = projected.replace(/\n{3}(?=  -- Keep only)/gu, "\n\n");
  return once(projected, "'notice_period', v_effective_at,\n    v_effective_at + interval '7 days'",
    "'notice_period', v_now,\n    v_now + interval '7 days'");
}
function ordinaryNotice(text: string): string {
  const projected = once(text,
    " if p_created_at is not null and (not isfinite(p_created_at) or p_created_at>pg_catalog.clock_timestamp()) then\n" +
    "  raise exception using errcode='22023',message='invalid historical account mail clock';end if;\n", "");
  return once(projected,
    "t timestamptz:=case when p_created_at is null then pg_catalog.clock_timestamp() else p_created_at end;",
    "t timestamptz:=pg_catalog.clock_timestamp();");
}
function md5(value: string): string { return createHash("md5").update(value).digest("hex"); }

describe("bounded historical creation preserves the complete ordinary algorithms", () => {
  it("projects every NULL arm to the exact whole current request and affected-notice bodies", () => {
    expect(md5(oldRequest)).toBe("cc02de010c27a714ff5ba96226016d60");
    expect(ordinaryRequest(core)).toBe(oldRequest);
    expect(ordinaryNotice(notice)).toBe(oldNotice);
  });
  it.each([
    ["  v_now timestamptz := clock_timestamp();", "  v_now timestamptz := p_effective_at;"],
    ["  set consumed_at = v_now", "  set consumed_at = v_effective_at"],
    ["    and expires_at > v_now;", "    and expires_at > v_effective_at;"],
    ["  set deletion_requested_at = v_now,", "  set deletion_requested_at = v_effective_at,"],
    ["status = 'rotated', ended_at = v_now", "status = 'rotated', ended_at = v_effective_at"],
    ["  where sp.account_id = p_account_id", "  where sp.account_id is not null"],
  ])("detects planted ordinary authority/clock changes at %s", (from, to) => {
    expect(core).toContain(from);
    expect(ordinaryRequest(core.replace(from, to))).not.toBe(oldRequest);
  });
  it("detects a planted affected-notice authority change without weakening the projection", () => {
    expect(ordinaryNotice(notice.replace("e.authority_revision<>p.principal_revision", "false"))).not.toBe(oldNotice);
  });
  it("retains current v2, session, nonce, due, graph and 035 mail pins with their exact successor bodies", () => {
    expect(pins.predecessors).toHaveLength(17);
    const replacements = pins.predecessors.filter(pin => pin.bodyMd5 !== pin.successorBodyMd5);
    expect(replacements.map(pin => pin.signature)).toEqual([
      "public.request_account_deletion_v1(uuid,uuid,text,bytea,text,text)",
      "private.enqueue_account_affected_notice_v1(uuid,jsonb,boolean,timestamptz)",
    ]);
    for (const pin of replacements) {
      expect(md5(body(migration, pin.signature.split("(")[0])))).toBe(pin.successorBodyMd5);
      expect(pin.serviceExecute).toBe(false);
    }
    expect(pins.predecessors.find(pin => pin.signature.startsWith("private.enqueue_embryo_principal_mail_v1("))?.bodyMd5)
      .toBe("ef221766cf9a9df289468466c4077f52");
    expect(pins.predecessors.find(pin => pin.signature === "private.lock_invitation_transitions_v1()"))
      .toMatchObject({ bodyMd5: "8efac632f9dad73d9af1056a8d81c480", successorBodyMd5: "8efac632f9dad73d9af1056a8d81c480", serviceExecute: true });
    const restoredGrant = read("supabase/migrations/20260906055142_refused_invitation_draft_cleanup.sql");
    expect(restoredGrant).toMatch(/grant execute on function[\s\S]*?private\.lock_invitation_transitions_v1\(\),[\s\S]*?to service_role;/u);
    expect(migration).not.toMatch(/(?:grant|revoke)\s+(?:execute|all)\s+on function private\.lock_invitation_transitions_v1/iu);
    expect(pins.newFunctions).toHaveLength(3);
    for (const pin of pins.newFunctions) {
      expect(pin.serviceExecute).toBe(false);
      expect(md5(body(migration, pin.signature.split("(")[0])))).toBe(pin.bodyMd5);
      expect(migration).toContain(`revoke all on function ${pin.signature} from public,anon,authenticated,inherit_upload_only,service_role;`);
    }
    for (const guard of ["p.proowner='postgres'::regrole", "p.proargmodes", "p.proallargtypes", "p.proacl",
      "pg_get_function_result", "pg_get_expr(p.proargdefaults,0)", "has_function_privilege(api,target,'execute')",
      "actual is distinct from before_metadata", "is distinct from expected->>'successorBodyMd5'"])
      expect(migration).toContain(guard);
  });
  it("creates complete historical phase and manifest only after every actual notice ID", () => {
    const mail = core.indexOf("    v_bound:=v_bound||jsonb_build_array(v_binding||jsonb_build_object('outboxId',v_mail));");
    const complete = core.indexOf("  else\n  insert into public.retention_due_phases", mail);
    const manifest = core.indexOf("  insert into public.purge_manifests", complete);
    expect(mail).toBeGreaterThan(core.indexOf("private.enqueue_account_affected_notice_clock_core_v1("));
    expect(complete).toBeGreaterThan(mail);
    expect(manifest).toBeGreaterThan(complete);
    expect(core.slice(complete, manifest)).toContain("'affectedNotice', jsonb_set(v_notice,'{recipients}',v_bound)");
    expect(core.slice(complete)).not.toMatch(/update public\.(?:retention_due_phases|purge_manifests|mail_outbox)/iu);
    expect(core).not.toMatch(/set_config|session_replication_role|disable trigger|update public\.account_deletion_requests/iu);
  });
  it("captures real authority separately from effective creation and denies explicit NULL/nonfinite/future time", () => {
    const at = body(migration, "private.request_account_deletion_at_v1");
    expect(at).toContain("p_effective_at is null or not isfinite(p_effective_at) or p_effective_at>pg_catalog.clock_timestamp()");
    expect(at.indexOf("private.validate_sensitive_account_session_v1(")).toBeLessThan(at.indexOf("private.record_account_operation_nonce_v1("));
    expect(at.indexOf("private.record_account_operation_nonce_v1(")).toBeLessThan(at.indexOf("private.request_account_deletion_clock_core_v1("));
    expect(at.match(/private\.record_account_operation_nonce_v1\(/gu)).toHaveLength(1);
    expect(at.match(/private\.request_account_deletion_clock_core_v1\(/gu)).toHaveLength(1);
    expect(body(migration, "public.request_account_deletion_v1")).toContain("p_contact_hmac,p_notice_idempotency_key,null);");
    expect(body(migration, "private.enqueue_account_affected_notice_v1")).toContain("p_cancelled,p_at,null);");
    expect(at).not.toMatch(/get_config|current_setting|set_config|p_test|p_now|p_historical/iu);
  });
});
