import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const directory = path.join(root, "supabase/migrations");
const current = readFileSync(path.join(directory, "20260930233000_future_person_claim_custody.sql"), "utf8");
const held = readFileSync(path.join(directory, "20260928150000_other_adult_held_upload.sql"), "utf8");
const bridge = readFileSync(path.join(directory, "20261001025000_path_b_future_rights_activation.sql"), "utf8");
const noticeFile = "20261001022000_future_person_notice_provider_execution.sql";
const notice = existsSync(path.join(directory, noticeFile)) ? readFileSync(path.join(directory, noticeFile), "utf8") : null;
const noticeReplacements = notice ? [noticeFile] : [];
const appealMailFile = "20261009200845_new_public_appeal_intake.sql";
const appealNoticeFile = "20261009224501_public_appeal_decision_notice_continuation.sql";
const appealNoticeReplacements = ["private.authorize_mail_submission_v1", "public.claim_mail_outbox", "public.activate_rights_session_v1"].map(name => `${appealNoticeFile}|${name}`);
const appealEvidenceFile = "20261009204626_public_appeal_evidence_session.sql";
const appealMailReplacements = ["private.authorize_mail_submission_v1", "public.claim_mail_outbox"].map(name => `${appealMailFile}|${name}`);
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
    expect(later).toEqual(["20260930232000_embryo_parent_withdrawal.sql", "20260930233000_future_person_claim_custody.sql", ...(replacements.includes("20261001023000_future_person_owner_objection_prerequisite.sql") ? ["20261001023000_future_person_owner_objection_prerequisite.sql"] : []), appealEvidenceFile, appealNoticeFile]);
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
      if (notice) expect(md5(functionBody(notice, name!))).toBe(hash);
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
  it("supports only the exact direct canonical or paired denied-alias installation", () => {
    expect(bridge).toContain("if (to_regprocedure('public.claim_mail_outbox_before_keyless_notice_v1()') is null)");
    expect(bridge).toContain("is distinct from (to_regprocedure('private.authorize_mail_submission_before_keyless_notice_v1(uuid,smallint)') is null)");
    expect(bridge).toContain("message='mail wrapper pair predecessor differs'");
    expect(bridge.match(/if v_mail_target is null then v_mail_target:=v_mail_canonical;end if;/gu)).toHaveLength(2);
    expect(bridge.match(/v_mail_target<>v_mail_canonical and \(md5\(v_mail_wrapper_body\)/gu)).toHaveLength(2);
    expect(bridge).not.toContain("e486e7e418358d3e5e7429c143ff3b71");
    expect(bridge).toContain("p.oid<>v_mail_canonical");
    expect(bridge).toContain("a.grantee<>(select oid from pg_roles where rolname='service_role')");
    expect(bridge).toContain("case when p.oid=v_mail_canonical then 2 else 1 end");
    expect(bridge).not.toMatch(/revoke |grant |on conflict/iu);
  });
  it("audits every later shared mail replacement instead of accepting an unknown dispatcher", () => {
    for (const name of ["public.claim_mail_outbox", "private.authorize_mail_submission_v1"]) {
      const pattern = new RegExp(`create (?:or replace )?function ${name.replaceAll(".", "\\.")}\\b`, "iu");
      const files = readdirSync(directory).sort().filter(file => file > "20260928150000_other_adult_held_upload.sql" && pattern.test(readFileSync(path.join(directory,file),"utf8")));
      expect(files).toEqual(["20260930232000_embryo_parent_withdrawal.sql", "20260930233000_future_person_claim_custody.sql", ...noticeReplacements, "20261001028000_future_person_keyless_human_decisions.sql", appealMailFile, appealNoticeFile]);
    }
  });
});

it("delegates all existing mail and activation branches behind only the new appeal authority", () => {
  const mail = readFileSync(path.join(directory, appealMailFile), "utf8");
  const evidence = readFileSync(path.join(directory, appealEvidenceFile), "utf8");
  expect(mail).toContain("alter function private.authorize_mail_submission_v1(uuid,smallint) rename to authorize_mail_submission_before_public_appeal_v1;");
  expect(mail).toContain("alter function public.claim_mail_outbox() rename to claim_mail_outbox_before_public_appeal_v1;");
  expect(functionBody(mail, "private.authorize_mail_submission_v1")).toContain("return private.authorize_mail_submission_before_public_appeal_v1(p_outbox,p_attempt);");
  expect(functionBody(mail, "public.claim_mail_outbox")).toContain("if mail.id is null then return query select * from public.claim_mail_outbox_before_public_appeal_v1();return;end if;");
  expect(evidence).toContain("alter function public.activate_rights_session_v1(text,text,text) rename to activate_rights_session_before_public_appeal_v1;");
  expect(functionBody(evidence, "public.activate_rights_session_v1")).toContain("if selected_purpose is distinct from 'appeal-evidence' then\n  return query select * from public.activate_rights_session_before_public_appeal_v1(p_token_hash,p_session_hash,p_form_nonce);return;end if;");
  for (const source of [mail, evidence]) {
    expect(source).not.toMatch(/create (?:or replace )?function (?:private|public)\.[a-z_]+_before_public_appeal_v1\(/iu);
    expect(source).not.toMatch(/grant execute[^;]*_before_public_appeal_v1/iu);
  }
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
    ...noticeReplacements.flatMap(file => ["private.authorize_mail_submission_v1", "public.claim_mail_outbox"].map(name => `${file}|${name}`)),
    ...(readdirSync(directory).includes("20261001023000_future_person_owner_objection_prerequisite.sql") ? ["20261001023000_future_person_owner_objection_prerequisite.sql|public.activate_rights_session_v1"] : []),
    "20261001028000_future_person_keyless_human_decisions.sql|private.authorize_mail_submission_v1",
    "20261001028000_future_person_keyless_human_decisions.sql|public.claim_mail_outbox",
    ...appealMailReplacements,
    `${appealEvidenceFile}|public.activate_rights_session_v1`,
    ...appealNoticeReplacements,
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
    ...noticeReplacements.flatMap(file => ["private.authorize_mail_submission_v1", "public.claim_mail_outbox"].map(name => `${file}|${name}`)),
    ...(readdirSync(directory).includes("20261001023000_future_person_owner_objection_prerequisite.sql") ? ["20261001023000_future_person_owner_objection_prerequisite.sql|public.activate_rights_session_v1"] : []),
    "20261001028000_future_person_keyless_human_decisions.sql|private.authorize_mail_submission_v1",
    "20261001028000_future_person_keyless_human_decisions.sql|public.claim_mail_outbox",
    "20261002132000_embryo_observed_carrier_producer.sql|private.claim_worker_job_v2",
    "20261003030000_path_b_confirmed_array_normalization.sql|private.enqueue_path_b_normalization_v1",
    "20261009224500_public_appeal_matched_review.sql|private.other_adult_mitigation_v1",
    ...appealMailReplacements,
    `${appealEvidenceFile}|public.activate_rights_session_v1`,
    ...appealNoticeReplacements,
    "20261009224500_public_appeal_matched_review.sql|private.other_adult_mitigation_v1",
  ].sort());
  expect(allPatches).toEqual([
    "20260930231000_path_b_normalization.sql|public.respond_adult_upload_revision_v1",
    "20260930234000_path_b_queued_reports.sql|private.path_b_result_read_v1",
    "20260930236000_path_b_report_reading.sql|private.path_b_normalization_v1",
  ]);
});


it("preserves the entire corrected mail dispatcher behind the token-free information branch", () => {
  const source = readFileSync(path.join(directory, "20261001028000_future_person_keyless_human_decisions.sql"), "utf8");
  const wrapped = functionBody(source, "private.authorize_mail_submission_v1");
  const preflight = source.slice(source.indexOf("do $information_mail_predecessor$"), source.indexOf("$information_mail_predecessor$;"));
  expect(preflight).toContain("md5(p.prosrc)='448f258385a4c6f4392a1ca1781f0f2a'");
  for (const exact of ["owner_role.rolname='postgres'", "language.lanname='plpgsql' and p.prosecdef",
    "p.prorettype='boolean'::regtype", "p.pronargs=2 and p.pronargdefaults=0", "p.provariadic=0 and p.proallargtypes is null",
    "p.proargtypes[0]='uuid'::regtype and p.proargtypes[1]='smallint'::regtype",
    "p.proargnames=array['p_outbox','p_attempt']::text[]", "p.proconfig=array['search_path=\"\"','lock_timeout=250ms']::text[]",
    "array['anon','authenticated','inherit_upload_only','service_role']", "acl.grantee<>p.proowner",
    "message='information mail predecessor differs'"]) expect(preflight).toContain(exact);
  expect(preflight).not.toMatch(/or md5|v_target:=|execute |grant |return;/iu);
  expect(source.indexOf("$information_mail_predecessor$;")).toBeLessThan(source.indexOf("alter function private.authorize_mail_submission_v1"));
  expect(source).toContain("alter function private.authorize_mail_submission_v1(uuid,smallint) rename to authorize_mail_submission_before_keyless_information_v1;");
  expect(source).toContain("revoke all on function private.authorize_mail_submission_before_keyless_information_v1(uuid,smallint)\n from public,anon,authenticated,inherit_upload_only,service_role;");
  expect(wrapped).toContain("if m.purpose is distinct from 'future-person-claim-more-information' then\n    return private.authorize_mail_submission_before_keyless_information_v1(p_outbox,p_attempt);end if;");
  for (const guard of ["m.template_payload='{}'", "m.token_purpose is null and m.token_target_id is null",
    "m.attempt_count=p_attempt", "m.expires_at=o.timely_deadline", "m.semantic_revision=r.review_revision",
    "private.keyless_owner_notice_current_v1(r.id)", "sp.status='pending'", "d.decision='needs-more-information'"])
    expect(wrapped).toContain(guard);
});


describe("the registered private Embryo claimant successor", () => {
  const file = "20261002132000_embryo_observed_carrier_producer.sql";
  const source = readFileSync(path.join(directory, file), "utf8");
  const claimant = "private.claim_worker_job_v2";
  const predecessor = functionBody(readFileSync(path.join(directory,
    "20260930231000_path_b_normalization.sql"), "utf8"), claimant);

  it("preserves the whole reviewed generic claimant except for the one private Embryo queue exclusion", () => {
    const successor = functionBody(source, claimant);
    const exclusion = "  and w.kind<>'score_embryo'\n";
    expect(md5(predecessor)).toBe("a23d7320907f9f80433ee60d6d43c692");
    expect(successor.split(exclusion)).toHaveLength(2);
    expect(successor.replace(exclusion, "")).toBe(predecessor);
    expect(source.match(/create or replace function private\.claim_worker_job_v2\(/gu)).toHaveLength(1);
    expect(source.slice(source.indexOf("create or replace function private.claim_worker_job_v2("),
      source.indexOf("as $generic$"))).toBe(`create or replace function private.claim_worker_job_v2(p_worker_id text,p_claim_token_hash text,p_lease_seconds integer default 60)
returns public.worker_jobs language plpgsql security definer set search_path=''
`);
  });

  it("retains the complete predecessor owner, attributes, arguments, defaults and exact EXECUTE ACL guard before replacement", () => {
    const start = source.indexOf("do $predecessor$");
    const end = source.indexOf("end $predecessor$;", start) + "end $predecessor$;".length;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(source.slice(start, end)).toBe(`do $predecessor$
declare p pg_proc;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.claim_worker_job_v2(text,text,integer)');
 if p.oid is null or md5(p.prosrc) is distinct from 'a23d7320907f9f80433ee60d6d43c692'
  or p.proowner is distinct from 'postgres'::regrole or p.prolang is distinct from (select oid from pg_language where lanname='plpgsql')
  or p.prokind<>'f' or p.provolatile<>'v' or p.proparallel<>'u' or p.proisstrict or not p.prosecdef or p.proleakproof
  or p.prorettype is distinct from 'public.worker_jobs'::regtype or p.proretset or p.pronargs<>3 or p.pronargdefaults<>1
  or p.proargnames is distinct from array['p_worker_id','p_claim_token_hash','p_lease_seconds']
  or pg_get_expr(p.proargdefaults,0) is distinct from '60'
  or p.proconfig is distinct from array['search_path=""']
  or (select array_agg(pg_get_userbyid(a.grantee)::text order by pg_get_userbyid(a.grantee))
    from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.privilege_type='EXECUTE' and not a.is_grantable and a.grantor='postgres'::regrole)
      is distinct from array['postgres','service_role']
  or (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))<>2 then
  raise exception using errcode='55000',message='embryo_carrier_predecessor_changed';end if;
end $predecessor$;`);
    expect(end).toBeLessThan(source.indexOf("alter table public.embryo_scores add column computation_receipt jsonb;"));
    expect(end).toBeLessThan(source.indexOf("create or replace function private.claim_worker_job_v2("));
    expect(source).not.toMatch(/(?:grant|revoke|alter function)[^;]*private\.claim_worker_job_v2/iu);
  });
});


it("preserves all prior dispatchers behind recipient-only notice delivery and activation", () => {
 const source = readFileSync(path.join(directory, appealNoticeFile), "utf8");
 expect(functionBody(source, "private.authorize_mail_submission_v1")).toContain("return private.authorize_mail_submission_before_appeal_notice_v1(p_outbox,p_attempt);");
 expect(functionBody(source, "public.claim_mail_outbox")).toContain("if mail.id is null then return query select * from public.claim_mail_outbox_before_appeal_notice_v1();return;end if;");
 expect(functionBody(source, "public.activate_rights_session_v1")).toContain("if selected_purpose is distinct from 'appeal-decision-notice' then\n  return query select * from public.activate_rights_before_appeal_notice_v1(p_token_hash,p_session_hash,p_form_nonce);return;end if;");
 expect(source).not.toMatch(/grant execute[^;]*_before_appeal_notice_v1/iu);
});
