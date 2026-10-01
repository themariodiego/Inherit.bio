import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const directory = path.join(root, "supabase/migrations");
const current = readFileSync(path.join(directory, "20260930233000_future_person_claim_custody.sql"), "utf8");
const held = readFileSync(path.join(directory, "20260928150000_other_adult_held_upload.sql"), "utf8");
const bridge = readFileSync(path.join(directory, "20261001025000_path_b_future_rights_activation.sql"), "utf8");
const notice = readFileSync(path.join(directory, "20261001022000_future_person_notice_provider_execution.sql"), "utf8");
const functionBody = (source: string, name: string): string => {
  const escaped = name.replaceAll(".", "\\.");
  const match = source.match(new RegExp(`create (?:or replace )?function ${escaped}\\([^;]*?\\bas\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1;`, "iu"));
  expect(match, name).not.toBeNull();
  return match![2]!;
};
const md5 = (value: string) => createHash("md5").update(value).digest("hex");
const body = current.match(/create or replace function public\.activate_rights_session_v1\([^;]+?as \$\$([\s\S]*?)\$\$;/u)![1]!;
const anchor = "  if v_purpose is distinct from 'co-parent-invitation' then return; end if;";
const declaration = "  v_expires_at timestamptz;";
const exactArm = held.slice(held.indexOf("  -- 20260928150000: the upload-time notice's credential opens a session for"), held.indexOf(anchor));
const replacement = bridge.match(/\$held\$([\s\S]*?)\$held\$/u)![1]!;

describe("the exact Path B bridge across shared rights dispatchers", () => {
  it("pins the complete latest old dispatcher and exact resulting full body", () => {
    expect(md5(body)).toBe("4777886cd6cd45b883e5e8c5ead6c8ee");
    expect(bridge).toContain(`v_current_md5 is distinct from '${md5(body)}'`);
    const result = body.replace(declaration, declaration + "\n  v_held public.other_adult_held_uploads%rowtype;").replace(anchor, replacement);
    expect(md5(result)).toBe("7c176e100123ecbdf9aedd8ee41b0539");
    expect(bridge).toContain(`is distinct from '${md5(result)}'`);
  });
  it("retains every current dispatcher byte outside the two exact insertions", () => {
    expect(replacement).toBe(exactArm + anchor);
    expect(body.split(anchor)).toHaveLength(2);
    expect(body.split(declaration)).toHaveLength(2);
    const result = body.replace(declaration, declaration + "\n  v_held public.other_adult_held_uploads%rowtype;").replace(anchor, replacement);
    expect(result.replace("\n  v_held public.other_adult_held_uploads%rowtype;", "").replace(exactArm, "")).toBe(body);
  });
  it("preserves genuine token, principal, revision and fixed-deadline checks", () => {
    for (const source of ["tc.state = 'issued' and tc.expires_at > v_now", "tc.token_revision = v_token.token_revision", "h.notice_outbox_id = tc.outbox_id", "h.state = 'pending' and h.fixed_deadline > v_now", "sp.subject_id = s.id and sp.status = 'active'", "s.subject_binding_revision = v_held.subject_binding_revision", "least(v_now + interval '24 hours', v_held.fixed_deadline)"]) expect(replacement).toContain(source);
  });
  it("keeps the reviewed023 canonical owner-objection wrapper and denied delegate", () => {
    expect(bridge).toContain("md5(v_wrapper_body) is distinct from '5f92f26f9e5f94f7593f833d17db7d6c'");
    expect(bridge).toContain("v_target:=v_alias");
    expect(bridge).toContain("v_target:=v_canonical");
    expect(bridge).toContain("where has_function_privilege(r,v_alias,'execute')");
    expect(bridge).toContain("is distinct from v_wrapper_body");
    expect(bridge).not.toMatch(/grant execute|alter function.*rename|create or replace function public\.activate/iu);
  });
  it("audits all actual later activation replacement sites", () => {
    const replacements = readdirSync(directory).sort().filter(file => readFileSync(path.join(directory,file),"utf8").match(/create (?:or replace )?function public\.activate_rights_session_v1\b/iu));
    const later = replacements.filter(file => file > "20260928150000_other_adult_held_upload.sql");
    expect(later).toEqual(["20260930232000_embryo_parent_withdrawal.sql", "20260930233000_future_person_claim_custody.sql", ...(replacements.includes("20261001023000_future_person_owner_objection_prerequisite.sql") ? ["20261001023000_future_person_owner_objection_prerequisite.sql"] : [])]);
    if (replacements.includes("20261001023000_future_person_owner_objection_prerequisite.sql")) {
      const wrapper = readFileSync(path.join(directory,"20261001023000_future_person_owner_objection_prerequisite.sql"),"utf8");
      const exact = wrapper.match(/create function public\.activate_rights_session_v1\([^;]+?as \$\$([\s\S]*?)\$\$;/u)![1]!;
      expect(md5(exact)).toBe("5f92f26f9e5f94f7593f833d17db7d6c");
    }
  });
  it("registers exactly the existing held-revision issuer without source grants or backfill", () => {
    expect(bridge).toContain("values('adult-upload-confirmation','adult-upload-confirmation',null,'adult_upload_revision')");
    expect(bridge).not.toMatch(/on conflict|create table|update public\.rights_sessions|disable trigger|grant execute/iu);
  });
});


describe("held mail restoration behind the exact keyless notice wrappers", () => {
  const claimAnchor = "  select m.* into v_outbox";
  const mintAnchor = "  return query\n  select";
  const submissionAnchor = " if m.template_id='report-ready' and private.file_ready_mail_current_v1(m) is not true then return false; end if;";
  const oldClaim = functionBody(held, "public.claim_mail_outbox");
  const oldSubmission = functionBody(held, "private.authorize_mail_submission_v1");
  const stale = oldClaim.slice(oldClaim.indexOf("  -- 20260928150000: an upload notice is current only while its revision is."), oldClaim.indexOf(claimAnchor));
  const mint = oldClaim.slice(oldClaim.indexOf("  -- 20260928150000: the upload-time notice's confirmation credential."), oldClaim.indexOf(mintAnchor));
  const submission = oldSubmission.slice(oldSubmission.indexOf(" -- 20260928150000: an upload notice goes out only while its revision is pending."), oldSubmission.indexOf(submissionAnchor));
  const claim = functionBody(current, "public.claim_mail_outbox");
  const authorize = functionBody(current, "private.authorize_mail_submission_v1");

  it("inserts only the original exact stale-row and opaque-token claim arms", () => {
    expect(bridge.match(/\$held_mail_current\$([\s\S]*?)\$held_mail_current\$/u)![1]).toBe(stale + claimAnchor);
    expect(bridge.match(/\$held_mail_token\$([\s\S]*?)\$held_mail_token\$/u)![1]).toBe(mint + mintAnchor);
    expect(claim.split(claimAnchor)).toHaveLength(2);
    expect(claim.split(mintAnchor)).toHaveLength(2);
    const restored = claim.replace(claimAnchor, stale + claimAnchor).replace(mintAnchor, mint + mintAnchor);
    expect(md5(claim)).toBe("12222529081824e4e71833c2997911b3");
    expect(md5(restored)).toBe("c14b060235af46b3046205d3b95a4976");
    for (const value of [md5(claim), md5(restored)]) expect(bridge).toContain(`is distinct from '${value}'`);
    expect(restored.replace(stale, "").replace(mint, "")).toBe(claim);
    expect(restored).toContain("private.mail_provider_attempt_key_v1(v_outbox)");
    expect(restored).not.toContain("v_outbox.idempotency_key");
  });
  it("inserts only the original pending-revision pre-submit arm", () => {
    expect(bridge.match(/\$held_mail_submission\$([\s\S]*?)\$held_mail_submission\$/u)![1]).toBe(submission + submissionAnchor);
    expect(authorize.split(submissionAnchor)).toHaveLength(2);
    const restored = authorize.replace(submissionAnchor, submission + submissionAnchor);
    expect(md5(authorize)).toBe("0ecf82fc522f48e52d3f86298a7a71cb");
    expect(md5(restored)).toBe("62c932b7c2b4863a23280a793fe7c264");
    for (const value of [md5(authorize), md5(restored)]) expect(bridge).toContain(`is distinct from '${value}'`);
    expect(restored.replace(submission, "")).toBe(authorize);
    expect(submission).toContain("private.adult_upload_mail_current_v1(m)");
    expect(submission).toContain("tc.state='issued' and th.status='current'");
  });
  it("preserves both full022 canonical wrappers and all denied delegate roles", () => {
    for (const [name, hash] of [["public.claim_mail_outbox", "abb70e7d8ec45731aebcbaa870ab9c13"], ["private.authorize_mail_submission_v1", "448f258385a4c6f4392a1ca1781f0f2a"]]) {
      expect(md5(functionBody(notice, name!))).toBe(hash);
      expect(bridge).toContain(`md5(v_mail_wrapper_body) is distinct from '${hash}'`);
    }
    expect(bridge).toContain("to_regprocedure('public.claim_mail_outbox_before_keyless_notice_v1()')");
    expect(bridge).toContain("to_regprocedure('private.authorize_mail_submission_before_keyless_notice_v1(uuid,smallint)')");
    expect(bridge).toContain("is distinct from v_mail_wrapper_body");
    expect(bridge).toContain("where has_function_privilege(r,v_mail_target,'execute')");
    expect(bridge).toContain("aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))");
    expect(bridge).toContain("and p.proconfig=array['search_path=\"\"','lock_timeout=250ms']::text[]");
    expect(bridge.match(/^do \$bridge\$/gmu)).toHaveLength(1);
    expect(bridge.match(/^\$bridge\$;/gmu)).toHaveLength(1);
  });
  it("audits every later shared mail replacement instead of accepting an unknown dispatcher", () => {
    for (const name of ["public.claim_mail_outbox", "private.authorize_mail_submission_v1"]) {
      const pattern = new RegExp(`create (?:or replace )?function ${name.replaceAll(".", "\\.")}\\b`, "iu");
      const files = readdirSync(directory).sort().filter(file => file > "20260928150000_other_adult_held_upload.sql" && pattern.test(readFileSync(path.join(directory,file),"utf8")));
      expect(files).toEqual(["20260930232000_embryo_parent_withdrawal.sql", "20260930233000_future_person_claim_custody.sql", "20261001022000_future_person_notice_provider_execution.sql"]);
    }
  });
});

it("closes the complete later Path B replacement inventory, including dynamic response patches", () => {
  const names = new Set([...held.matchAll(/create (?:or replace )?function ((?:public|private)\.[a-zA-Z0-9_]+)/giu)].map(match => match[1]!));
  const definitions: string[] = [];
  const patches: string[] = [];
  for (const file of readdirSync(directory).sort().filter(file => file > "20260928150000_other_adult_held_upload.sql")) {
    const source = readFileSync(path.join(directory,file),"utf8");
    for (const match of source.matchAll(/create (?:or replace )?function ((?:public|private)\.[a-zA-Z0-9_]+)/giu)) if (names.has(match[1]!)) definitions.push(`${file}|${match[1]}`);
    for (const match of source.matchAll(/pg_get_functiondef\('((?:public|private)\.[a-zA-Z0-9_]+)/gu)) if (names.has(match[1]!)) patches.push(`${file}|${match[1]}`);
  }
  expect(definitions.sort()).toEqual([
    "20260930210000_path_b_account_branch.sql|private.delete_path_b_subject_v1",
    "20260930210000_path_b_account_branch.sql|private.path_b_signing_target_v1",
    "20260930210000_path_b_account_branch.sql|private.path_b_subject_v1",
    "20260930210000_path_b_account_branch.sql|public.expire_due_other_adult_held_uploads_v1",
    "20260930210000_path_b_account_branch.sql|public.respond_adult_upload_revision_v1",
    ...["20260930232000_embryo_parent_withdrawal.sql", "20260930233000_future_person_claim_custody.sql"].flatMap(file => ["private.authorize_mail_submission_v1", "public.activate_rights_session_v1", "public.claim_mail_outbox"].map(name => `${file}|${name}`)),
    "20261001022000_future_person_notice_provider_execution.sql|private.authorize_mail_submission_v1",
    "20261001022000_future_person_notice_provider_execution.sql|public.claim_mail_outbox",
    ...(readdirSync(directory).includes("20261001023000_future_person_owner_objection_prerequisite.sql") ? ["20261001023000_future_person_owner_objection_prerequisite.sql|public.activate_rights_session_v1"] : []),
  ].sort());
  expect(patches).toEqual(["20260930231000_path_b_normalization.sql|public.respond_adult_upload_revision_v1"]);
});

it("reviews shared replacements across all six authored Path B migration stages", () => {
  const stages = ["20260928150000_other_adult_held_upload.sql", "20260930210000_path_b_account_branch.sql", "20260930220000_path_b_reading_layer.sql", "20260930231000_path_b_normalization.sql", "20260930234000_path_b_queued_reports.sql", "20260930236000_path_b_report_reading.sql"];
  const first = new Map<string, string>();
  for (const file of stages) for (const match of readFileSync(path.join(directory,file),"utf8").matchAll(/create (?:or replace )?function ((?:public|private)\.[a-zA-Z0-9_]+)/giu)) if (!first.has(match[1]!)) first.set(match[1]!,file);
  const outsideReplacements: string[] = [];
  const allPatches: string[] = [];
  for (const file of readdirSync(directory).sort()) {
    const source = readFileSync(path.join(directory,file),"utf8");
    if (!stages.includes(file)) for (const match of source.matchAll(/create (?:or replace )?function ((?:public|private)\.[a-zA-Z0-9_]+)/giu)) if (first.has(match[1]!) && first.get(match[1]!)! < file) outsideReplacements.push(`${file}|${match[1]}`);
    for (const match of source.matchAll(/pg_get_functiondef\('((?:public|private)\.[a-zA-Z0-9_]+)/gu)) if (first.has(match[1]!) && first.get(match[1]!)! < file) allPatches.push(`${file}|${match[1]}`);
  }
  expect(outsideReplacements.sort()).toEqual([
    ...["20260930232000_embryo_parent_withdrawal.sql", "20260930233000_future_person_claim_custody.sql"].flatMap(file => ["private.authorize_mail_submission_v1", "public.activate_rights_session_v1", "public.claim_mail_outbox"].map(name => `${file}|${name}`)),
    "20261001022000_future_person_notice_provider_execution.sql|private.authorize_mail_submission_v1",
    "20261001022000_future_person_notice_provider_execution.sql|public.claim_mail_outbox",
    ...(readdirSync(directory).includes("20261001023000_future_person_owner_objection_prerequisite.sql") ? ["20261001023000_future_person_owner_objection_prerequisite.sql|public.activate_rights_session_v1"] : []),
  ].sort());
  expect(allPatches).toEqual([
    "20260930231000_path_b_normalization.sql|public.respond_adult_upload_revision_v1",
    "20260930234000_path_b_queued_reports.sql|private.path_b_result_read_v1",
    "20260930236000_path_b_report_reading.sql|private.path_b_normalization_v1",
  ]);
});
