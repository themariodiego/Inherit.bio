import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {expect,it} from "vitest";

const read=(name:string)=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),"utf8");
const previous=read("20261001022000_future_person_notice_provider_execution.sql");
const current=read("20261001028000_future_person_keyless_human_decisions.sql");
function body(source:string,name:string){
  const start=source.indexOf(`function ${name}(`);if(start<0)throw new Error("Missing dispatcher");
  const text=source.slice(start).match(/\bas\s*\$\$([\s\S]*?)\$\$/u)?.[1];
  if(text===undefined)throw new Error("Missing body");return text;
}

it("delegates every old branch to the complete strictly pinned canonical dispatcher without replacing its inner queue",()=>{
  expect(createHash("md5").update(body(previous,"public.claim_mail_outbox")).digest("hex")).toBe("abb70e7d8ec45731aebcbaa870ab9c13");
  for(const guard of ["md5(p.prosrc)='abb70e7d8ec45731aebcbaa870ab9c13'","owner_role.rolname='postgres'",
    "p.proconfig=array['search_path=\"\"','lock_timeout=250ms']","acl.grantor<>p.proowner","acl.is_grantable",
    "message='information claim predecessor differs'"])expect(current).toContain(guard);
  const claim=body(current,"public.claim_mail_outbox");
  expect(claim).toContain("return query select * from public.claim_mail_outbox_before_keyless_information_v1();return;");
  expect(current).toContain("revoke all on function public.claim_mail_outbox_before_keyless_information_v1()\n from public,anon,authenticated,inherit_upload_only,service_role;");
  expect(current).not.toMatch(/(?:create|replace|alter)[^;]*claim_mail_outbox_before_keyless_notice_v1/iu);
});

it("keeps information contact bytes behind the identical current pre-submit predicate and emits no credential",()=>{
  const claim=body(current,"public.claim_mail_outbox"),check=body(current,"private.authorize_mail_submission_v1");
  expect(claim.indexOf("public.subjects")).toBeLessThan(claim.indexOf("public.retention_rows"));
  expect(claim.indexOf("public.retention_rows")).toBeLessThan(claim.indexOf("private.lock_invitation_transitions_v1()"));
  expect(claim.indexOf("private.authorize_mail_submission_v1(queued_information.id,queued_information.attempt_count)")).toBeLessThan(
    claim.indexOf("contact.contact_ciphertext,null::text"));
  for(const exact of ["package.state='objected'","sp.status='pending' and sp.principal_kind='future_person'",
    "f.status='objected'","d.decision='needs-more-information'","m.semantic_revision=r.review_revision",
    "m.template_payload='{}' and m.token_purpose is null and m.token_target_id is null",
    "m.attempt_count=p_attempt","m.expires_at=o.timely_deadline","private.keyless_owner_notice_current_v1(r.id)"])
    expect(check).toContain(exact);
  expect(claim).not.toMatch(/gen_random_bytes|insert into public\.token|update public\.token|activate_rights|update public\.subject_principals/u);
});
